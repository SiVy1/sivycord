use std::str::FromStr;
use std::sync::Arc;
use std::collections::{BTreeMap, VecDeque};
use crate::state::IrohState;

// ── Voice constants (shared with moq.rs) ────────────────────────────
const OPUS_SAMPLE_RATE: u32 = 48_000;
const OPUS_FRAME_SAMPLES: usize = 960; // 20 ms @ 48 kHz
const DENOISE_FRAME_SIZE: usize = 480; // nnnoiseless FRAME_SIZE
const MAX_OPUS_PACKET: usize = 1_275;

// Jitter-buffer constants
const JITTER_MIN_MS: u32 = 20;
const JITTER_MAX_MS: u32 = 200;
const JITTER_INITIAL_MS: u32 = 60;
const JITTER_CAPACITY: usize = 50;
const REORDER_WINDOW: u16 = 16;
const HEADER_SIZE: usize = 4;

// ── Packet header helpers ───────────────────────────────────────────
fn make_header(seq: u16, has_fec: bool) -> [u8; HEADER_SIZE] {
    let mut h = [0u8; HEADER_SIZE];
    h[0..2].copy_from_slice(&seq.to_le_bytes());
    h[2] = if has_fec { 1 } else { 0 };
    h[3] = 0; // reserved
    h
}

fn parse_header(data: &[u8]) -> Option<(u16, bool, &[u8])> {
    if data.len() < HEADER_SIZE {
        return None;
    }
    let seq = u16::from_le_bytes([data[0], data[1]]);
    let has_fec = data[2] != 0;
    Some((seq, has_fec, &data[HEADER_SIZE..]))
}

// ── Adaptive Jitter Buffer ──────────────────────────────────────────
enum PullResult {
    Frame(Vec<f32>),
    Lost,
    NotReady,
}

struct JitterBuffer {
    buf: BTreeMap<u16, Vec<f32>>,
    next_seq: Option<u16>,
    target_depth_ms: u32,
    recent_gaps: VecDeque<bool>,
}

impl JitterBuffer {
    fn new() -> Self {
        Self {
            buf: BTreeMap::new(),
            next_seq: None,
            target_depth_ms: JITTER_INITIAL_MS,
            recent_gaps: VecDeque::with_capacity(100),
        }
    }

    fn target_frames(&self) -> usize {
        ((self.target_depth_ms as usize) * OPUS_SAMPLE_RATE as usize)
            / (1000 * OPUS_FRAME_SAMPLES)
    }

    fn record_arrival(&mut self, was_gap: bool) {
        self.recent_gaps.push_back(was_gap);
        if self.recent_gaps.len() > 100 {
            self.recent_gaps.pop_front();
        }
        if self.recent_gaps.len() >= 20 {
            let loss_rate =
                self.recent_gaps.iter().filter(|&&g| g).count() as f32 / self.recent_gaps.len() as f32;
            let ideal = if loss_rate < 0.01 {
                JITTER_MIN_MS
            } else if loss_rate < 0.05 {
                40
            } else if loss_rate < 0.15 {
                80
            } else {
                JITTER_MAX_MS
            };
            // Exponential smoothing
            self.target_depth_ms = ((self.target_depth_ms as f32) * 0.9 + ideal as f32 * 0.1) as u32;
            self.target_depth_ms = self.target_depth_ms.clamp(JITTER_MIN_MS, JITTER_MAX_MS);
        }
    }

    fn insert(&mut self, seq: u16, pcm: Vec<f32>) {
        if let Some(next) = self.next_seq {
            let diff = seq.wrapping_sub(next);
            if diff > u16::MAX / 2 {
                return; // late / duplicate
            }
        }
        if self.buf.len() >= JITTER_CAPACITY {
            if let Some(&oldest) = self.buf.keys().next() {
                self.buf.remove(&oldest);
            }
        }
        self.buf.insert(seq, pcm);
    }

    fn pull(&mut self) -> PullResult {
        let target = self.target_frames().max(1);
        if self.buf.len() < target && self.next_seq.is_none() {
            return PullResult::NotReady;
        }
        let seq = match self.next_seq {
            Some(s) => s,
            None => {
                if let Some(&first) = self.buf.keys().next() {
                    self.next_seq = Some(first);
                    first
                } else {
                    return PullResult::NotReady;
                }
            }
        };
        self.next_seq = Some(seq.wrapping_add(1));
        if let Some(pcm) = self.buf.remove(&seq) {
            self.record_arrival(false);
            PullResult::Frame(pcm)
        } else {
            self.record_arrival(true);
            PullResult::Lost
        }
    }
}

#[tauri::command]
pub async fn start_voice(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
) -> Result<(), String> {
    log::info!("[Voice] start_voice: doc_id={}", doc_id);
    // Cancel any existing voice session first
    {
        let mut guard = state.voice_cancel.lock().await;
        if let Some(cancel) = guard.take() {
            let _ = cancel.send(());
        }
    }

    let doc_id = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    let topic = iroh_gossip::proto::TopicId::from_bytes(*doc_id.as_bytes());

    // Subscribe to gossip on the iroh runtime to avoid cross-runtime deadlock
    let rt = state._runtime.clone();
    let node = state.node.clone();
    let (gossip_sender, gossip_receiver) = rt.spawn(async move {
        let client = node.client();
        client
            .gossip()
            .subscribe(topic, Vec::<iroh_base::key::PublicKey>::new())
            .await
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| e.to_string())?;

    // Channel to bridge sync audio capture callback -> async gossip broadcast
    let (audio_tx, mut audio_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();

    // Cancellation signal
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    {
        let mut guard = state.voice_cancel.lock().await;
        *guard = Some(cancel_tx);
    }

    // ── Send task: forward captured audio packets to gossip ──────────
    use futures_util::SinkExt;
    let send_task = tokio::spawn(async move {
        let mut sink = gossip_sender;
        while let Some(packet) = audio_rx.recv().await {
            let update = iroh_gossip::net::Command::Broadcast(packet.into());
            if sink.send(update).await.is_err() {
                break;
            }
        }
    });

    // ── Shared jitter buffer + ring buffer ──────────────────────────
    let jitter = Arc::new(std::sync::Mutex::new(JitterBuffer::new()));
    let jitter_for_recv = jitter.clone();
    let ring_size: usize = 48000; // ~1 second buffer
    let ring = Arc::new(std::sync::Mutex::new(
        VecDeque::<f32>::with_capacity(ring_size),
    ));
    let ring_for_output = ring.clone();
    let ring_for_drainer = ring.clone();

    // ── Output thread ───────────────────────────────────────────────
    let (output_stop_tx, output_stop_rx) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        let audio_host = cpal::default_host();
        let out_device = match audio_host.default_output_device() {
            Some(d) => d,
            None => {
                log::error!("[Voice] No output audio device available");
                return;
            }
        };
        let default_cfg = match out_device.default_output_config() {
            Ok(c) => c,
            Err(e) => {
                log::error!("[Voice] Failed to get default output config: {}", e);
                return;
            }
        };
        let dev_rate = default_cfg.sample_rate().0;
        let dev_ch = default_cfg.channels() as usize;
        log::info!("[Voice] Output device: {}Hz, {} channels", dev_rate, dev_ch);

        let out_config = cpal::StreamConfig {
            channels: default_cfg.channels(),
            sample_rate: default_cfg.sample_rate(),
            buffer_size: cpal::BufferSize::Default,
        };

        let ring_reader = ring_for_output;
        // Resample from 48kHz mono ring buffer to device native format
        let step = OPUS_SAMPLE_RATE as f64 / dev_rate as f64;
        let mut last_sample = 0.0f32;
        let mut frac = 0.0f64;

        let output_stream = match out_device.build_output_stream(
            &out_config,
            move |data: &mut [f32], _: &_| {
                let mut rb = ring_reader.lock().unwrap();
                let frames = data.len() / dev_ch;
                for i in 0..frames {
                    frac += step;
                    while frac >= 1.0 {
                        last_sample = rb.pop_front().unwrap_or(last_sample);
                        frac -= 1.0;
                    }
                    for ch in 0..dev_ch {
                        data[i * dev_ch + ch] = last_sample;
                    }
                }
            },
            |err| log::error!("[Voice] Audio output error: {}", err),
            None,
        ) {
            Ok(s) => s,
            Err(e) => {
                log::error!("[Voice] Failed to build output stream: {}", e);
                return;
            }
        };

        if let Err(e) = output_stream.play() {
            log::error!("[Voice] Failed to play output stream: {}", e);
            return;
        }
        log::info!("[Voice] Output stream started");

        let _ = output_stop_rx.recv();
        drop(output_stream);
    });

    // ── Receive task: decode gossip audio, feed jitter buffer ────────
    use futures_util::StreamExt;
    let recv_task = tokio::spawn(async move {
        use iroh_gossip::net::{Event, GossipEvent};

        let mut decoder = match opus::Decoder::new(OPUS_SAMPLE_RATE, opus::Channels::Mono) {
            Ok(d) => d,
            Err(e) => {
                log::error!("[Voice] Failed to create Opus decoder: {}", e);
                return;
            }
        };
        let mut plc_decoder = match opus::Decoder::new(OPUS_SAMPLE_RATE, opus::Channels::Mono) {
            Ok(d) => d,
            Err(e) => {
                log::error!("[Voice] Failed to create PLC decoder: {}", e);
                return;
            }
        };

        let mut stream = gossip_receiver;
        let mut decode_buf = vec![0f32; OPUS_FRAME_SAMPLES];
        let mut plc_buf = vec![0f32; OPUS_FRAME_SAMPLES];
        let mut stats_packets: u64 = 0;
        let mut stats_plc: u64 = 0;

        loop {
            // Drain jitter buffer → ring buffer
            {
                let mut jb = jitter_for_recv.lock().unwrap();
                loop {
                    match jb.pull() {
                        PullResult::Frame(pcm) => {
                            let mut rb = ring_for_drainer.lock().unwrap();
                            for &s in &pcm {
                                if rb.len() < ring_size {
                                    rb.push_back(s);
                                }
                            }
                        }
                        PullResult::Lost => {
                            if let Ok(n) = plc_decoder.decode_float(&[], &mut plc_buf, false) {
                                stats_plc += 1;
                                let mut rb = ring_for_drainer.lock().unwrap();
                                for &s in &plc_buf[..n] {
                                    if rb.len() < ring_size {
                                        rb.push_back(s);
                                    }
                                }
                            }
                        }
                        PullResult::NotReady => break,
                    }
                }
            }

            let event = tokio::select! {
                ev = stream.next() => match ev {
                    Some(Ok(e)) => e,
                    _ => break,
                },
            };

            match event {
                Event::Gossip(GossipEvent::Received(msg)) => {
                    if let Some((seq, _has_fec, opus_data)) = parse_header(&msg.content) {
                        match decoder.decode_float(opus_data, &mut decode_buf, false) {
                            Ok(decoded_samples) => {
                                stats_packets += 1;
                                let pcm = decode_buf[..decoded_samples].to_vec();
                                let mut jb = jitter_for_recv.lock().unwrap();
                                jb.insert(seq, pcm);
                            }
                            Err(e) => {
                                log::error!("[Voice] Opus decode error (seq={}): {}", seq, e);
                            }
                        }

                        if stats_packets % 500 == 0 && stats_packets > 0 {
                            let jb = jitter_for_recv.lock().unwrap();
                            log::info!(
                                "[Voice] Stats: packets={}, plc={}, jitter_target={}ms, buf={}",
                                stats_packets, stats_plc, jb.target_depth_ms, jb.buf.len()
                            );
                        }
                    }
                }
                _ => {}
            }
        }
    });

    // ── Input thread: capture → denoise → encode → send ─────────────
    let (input_stop_tx, input_stop_rx) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                log::error!("[Voice] No input audio device available");
                return;
            }
        };
        let default_cfg = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                log::error!("[Voice] Failed to get default input config: {}", e);
                return;
            }
        };
        let dev_rate = default_cfg.sample_rate().0;
        let dev_ch = default_cfg.channels() as usize;
        log::info!("[Voice] Input device: {}Hz, {} channels", dev_rate, dev_ch);

        let input_config = cpal::StreamConfig {
            channels: default_cfg.channels(),
            sample_rate: default_cfg.sample_rate(),
            buffer_size: cpal::BufferSize::Default,
        };

        let mut encoder =
            match opus::Encoder::new(OPUS_SAMPLE_RATE, opus::Channels::Mono, opus::Application::Voip) {
                Ok(mut e) => {
                    let _ = e.set_inband_fec(true);
                    let _ = e.set_dtx(true);
                    let _ = e.set_packet_loss_perc(5);
                    let _ = e.set_bitrate(opus::Bitrate::Bits(64000));
                    log::info!("[Voice] Opus encoder: FEC=on, DTX=on, loss_hint=5%, bitrate=64kbps");
                    e
                }
                Err(e) => {
                    log::error!("[Voice] Failed to create Opus encoder: {}", e);
                    return;
                }
            };
        let mut denoiser = nnnoiseless::DenoiseState::new();
        let mut denoise_buf = Vec::<f32>::with_capacity(DENOISE_FRAME_SIZE);
        let mut opus_buf = Vec::<f32>::with_capacity(OPUS_FRAME_SAMPLES);
        let step = OPUS_SAMPLE_RATE as f64 / dev_rate as f64;
        let mut resample_frac = 0.0f64;
        let mut send_seq: u16 = 0;

        let input_stream = match device.build_input_stream(
            &input_config,
            move |data: &[f32], _: &_| {
                let frames = data.len() / dev_ch;
                for i in 0..frames {
                    let mut mono = 0.0f32;
                    for ch in 0..dev_ch {
                        mono += data[i * dev_ch + ch];
                    }
                    mono /= dev_ch as f32;

                    resample_frac += step;
                    while resample_frac >= 1.0 {
                        denoise_buf.push(mono);
                        resample_frac -= 1.0;

                        if denoise_buf.len() == DENOISE_FRAME_SIZE {
                            let mut denoised = vec![0.0f32; DENOISE_FRAME_SIZE];
                            denoiser.process_frame(&mut denoised, &denoise_buf);
                            denoise_buf.clear();
                            opus_buf.extend_from_slice(&denoised);

                            if opus_buf.len() >= OPUS_FRAME_SAMPLES {
                                let mut compressed = vec![0u8; MAX_OPUS_PACKET];
                                if let Ok(len) = encoder.encode_float(&opus_buf[..OPUS_FRAME_SAMPLES], &mut compressed) {
                                    let header = make_header(send_seq, true);
                                    let mut packet = Vec::with_capacity(HEADER_SIZE + len);
                                    packet.extend_from_slice(&header);
                                    packet.extend_from_slice(&compressed[..len]);
                                    let _ = audio_tx.send(packet);
                                    send_seq = send_seq.wrapping_add(1);
                                }
                                opus_buf.drain(..OPUS_FRAME_SAMPLES);
                            }
                        }
                    }
                }
            },
            |err| log::error!("[Voice] Audio input error: {}", err),
            None,
        ) {
            Ok(s) => s,
            Err(e) => {
                log::error!("[Voice] Failed to build input stream: {}", e);
                return;
            }
        };

        if let Err(e) = input_stream.play() {
            log::error!("[Voice] Failed to play input stream: {}", e);
            return;
        }
        log::info!("[Voice] Input stream started (FEC+DTX+PLC enabled)");

        let _ = input_stop_rx.recv();
        drop(input_stream);
    });

    tokio::spawn(async move {
        let _ = cancel_rx.await;
        let _ = output_stop_tx.send(());
        let _ = input_stop_tx.send(());
        send_task.abort();
        recv_task.abort();
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_voice(state: tauri::State<'_, IrohState>) -> Result<(), String> {
    log::info!("[Voice] stop_voice called");
    let mut guard = state.voice_cancel.lock().await;
    if let Some(cancel) = guard.take() {
        let _ = cancel.send(());
        log::info!("[Voice] voice session stopped");
    } else {
        log::warn!("[Voice] stop_voice: no active session to stop");
    }
    Ok(())
}
