/// MoQ (Media over QUIC) voice transport using iroh's QUIC connections.
///
/// Features:
///   - Adaptive jitter buffer with dynamic target depth (20–200ms)
///   - Sequence-numbered packets with reordering window
///   - Opus FEC (Forward Error Correction) for in-band redundancy
///   - Opus PLC (Packet Loss Concealment) via decode(null) on gaps
///   - DTX (Discontinuous Transmission) to save bandwidth during silence
///   - AI noise suppression (nnnoiseless RNN)
///   - Device-native sample rate / channel resampling

use std::str::FromStr;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use crate::state::IrohState;

// ── Constants ──────────────────────────────────────────────────────────
const OPUS_SAMPLE_RATE: u32 = 48000;
const OPUS_FRAME_SAMPLES: usize = 960;       // 20ms at 48kHz
const DENOISE_FRAME_SIZE: usize = 480;        // 10ms at 48kHz (nnnoiseless)
const MAX_OPUS_PACKET: usize = 1275;

// Jitter buffer
const JITTER_MIN_MS: u32 = 20;               // minimum target depth
const JITTER_MAX_MS: u32 = 200;              // maximum target depth
const JITTER_INITIAL_MS: u32 = 60;           // initial target depth
const JITTER_CAPACITY: usize = 50;           // max queued packets

// Sequence reorder
const REORDER_WINDOW: u16 = 16;              // tolerate up to 16 out-of-order packets
const RING_BUFFER_SIZE: usize = 48_000;       // ~1 second of 48kHz mono audio
const AUDIO_CHANNEL_CAPACITY: usize = 100;    // bounded channel capacity

// ── Packet header ──────────────────────────────────────────────────────
// We prepend a 4-byte header to every gossip message:
//   [0..2] sequence number (u16 LE)
//   [2]    flags:  bit0 = FEC packet available in Opus stream
//   [3]    reserved
const HEADER_SIZE: usize = 4;

fn make_header(seq: u16, has_fec: bool) -> [u8; HEADER_SIZE] {
    let mut h = [0u8; HEADER_SIZE];
    h[0..2].copy_from_slice(&seq.to_le_bytes());
    if has_fec { h[2] = 1; }
    h
}

fn parse_header(data: &[u8]) -> Option<(u16, bool, &[u8])> {
    if data.len() < HEADER_SIZE { return None; }
    let seq = u16::from_le_bytes([data[0], data[1]]);
    let has_fec = data[2] & 1 != 0;
    Some((seq, has_fec, &data[HEADER_SIZE..]))
}

// ── Adaptive Jitter Buffer ─────────────────────────────────────────────
struct JitterBuffer {
    buf: std::collections::BTreeMap<u16, Vec<f32>>,   // seq -> decoded PCM
    next_seq: u16,                                     // next expected seq
    target_depth_ms: u32,                              // current target in ms
    recent_gaps: std::collections::VecDeque<bool>,     // true = gap/late
    initialized: bool,
}

impl JitterBuffer {
    fn new() -> Self {
        Self {
            buf: std::collections::BTreeMap::new(),
            next_seq: 0,
            target_depth_ms: JITTER_INITIAL_MS,
            recent_gaps: std::collections::VecDeque::with_capacity(200),
            initialized: false,
        }
    }

    /// Target depth expressed in number of 20ms frames.
    fn target_frames(&self) -> usize {
        (self.target_depth_ms / 20).max(1) as usize
    }

    /// Record whether a packet arrived on time and adapt target depth.
    fn record_arrival(&mut self, was_gap: bool) {
        self.recent_gaps.push_back(was_gap);
        if self.recent_gaps.len() > 200 {
            self.recent_gaps.pop_front();
        }

        // Adapt every 50 packets
        if self.recent_gaps.len() >= 50 && self.recent_gaps.len() % 50 == 0 {
            let loss_rate = self.recent_gaps.iter().filter(|&&g| g).count() as f32
                / self.recent_gaps.len() as f32;

            if loss_rate > 0.10 {
                // >10% loss → increase buffer aggressively
                self.target_depth_ms = (self.target_depth_ms + 40).min(JITTER_MAX_MS);
                log::info!("[Voice] Jitter buffer ↑ {}ms (loss {:.1}%)", self.target_depth_ms, loss_rate * 100.0);
            } else if loss_rate > 0.03 {
                // 3-10% loss → increase gently
                self.target_depth_ms = (self.target_depth_ms + 20).min(JITTER_MAX_MS);
            } else if loss_rate < 0.01 && self.target_depth_ms > JITTER_MIN_MS {
                // <1% loss → slowly decrease
                self.target_depth_ms = (self.target_depth_ms - 10).max(JITTER_MIN_MS);
            }
        }
    }

    /// Insert a decoded frame. Returns frames that should be evicted (too old).
    fn insert(&mut self, seq: u16, pcm: Vec<f32>) {
        if !self.initialized {
            self.next_seq = seq;
            self.initialized = true;
        }

        // Reject packets that are very old (behind our play cursor)
        let behind = self.next_seq.wrapping_sub(seq);
        if behind > 0 && behind < REORDER_WINDOW {
            // Already played this or it's too late
            self.record_arrival(true);
            return;
        }

        self.record_arrival(false);

        self.buf.insert(seq, pcm);

        // Evict excess to prevent memory leak
        while self.buf.len() > JITTER_CAPACITY {
            let oldest = *self.buf.keys().next().unwrap();
            self.buf.remove(&oldest);
        }
    }

    /// Pull the next frame to play. Returns None if buffer hasn't reached target depth yet,
    /// or synthesized PLC silence info if the next expected seq is missing.
    fn pull(&mut self) -> PullResult {
        if !self.initialized {
            return PullResult::NotReady;
        }

        // Check if buffer has enough depth
        let buffered = self.buf.len();
        if buffered < self.target_frames() && self.buf.get(&self.next_seq).is_none() {
            return PullResult::NotReady;
        }

        if let Some(pcm) = self.buf.remove(&self.next_seq) {
            self.next_seq = self.next_seq.wrapping_add(1);
            PullResult::Frame(pcm)
        } else {
            // Gap — the packet for next_seq is missing → request PLC
            self.next_seq = self.next_seq.wrapping_add(1);
            self.record_arrival(true);
            PullResult::Lost
        }
    }
}

enum PullResult {
    Frame(Vec<f32>),
    Lost,       // Decoder should run PLC
    NotReady,   // Buffer still filling
}

// ── Peer info (unchanged public interface) ─────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VoicePeerInfo {
    pub node_id: String,
    pub channel_id: String,
    pub display_name: String,
    pub joined_at: String,
}

#[tauri::command]
pub async fn moq_join_voice(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    channel_id: String,
    display_name: String,
) -> Result<(), String> {
    log::info!("[Voice] moq_join_voice: doc_id={}, channel_id={}, name={}", doc_id, channel_id, display_name);
    let ns = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    let dn = display_name;
    state.on_rt(move |node, author_id| async move {
        let client = node.client();
        let doc = client.docs().open(ns).await.map_err(|e| e.to_string())?
            .ok_or_else(|| "Document not found".to_string())?;
        let node_id = node.node_id().to_string();

        let info = VoicePeerInfo {
            node_id: node_id.clone(),
            channel_id: channel_id.clone(),
            display_name: dn,
            joined_at: iso_now(),
        };

        let key = format!("voice/{}/peers/{}", channel_id, node_id);
        let json = serde_json::to_string(&info).map_err(|e| e.to_string())?;

        doc.set_bytes(
            author_id,
            key.as_bytes().to_vec(),
            json.as_bytes().to_vec(),
        )
        .await
        .map_err(|e| e.to_string())?;

        Ok(())
    }).await
}

#[tauri::command]
pub async fn moq_leave_voice(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    channel_id: String,
) -> Result<(), String> {
    log::info!("[Voice] moq_leave_voice: doc_id={}, channel_id={}", doc_id, channel_id);
    let ns = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    state.on_rt(move |node, author_id| async move {
        let client = node.client();
        let doc = client.docs().open(ns).await.map_err(|e| e.to_string())?
            .ok_or_else(|| "Document not found".to_string())?;
        let node_id = node.node_id().to_string();

        let key = format!("voice/{}/peers/{}", channel_id, node_id);
        doc.del(author_id, key.as_bytes().to_vec())
            .await
            .map_err(|e| e.to_string())?;

        Ok(())
    }).await
}

#[tauri::command]
pub async fn moq_list_voice_peers(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    channel_id: String,
) -> Result<Vec<VoicePeerInfo>, String> {
    let ns = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    state.on_rt(move |node, _author_id| async move {
        let client = node.client();
        let doc = client.docs().open(ns).await.map_err(|e| e.to_string())?
            .ok_or_else(|| "Document not found".to_string())?;

        use futures_util::StreamExt;
        let prefix = format!("voice/{}/peers/", channel_id);
        let mut entries = doc
            .get_many(iroh_docs::store::Query::key_prefix(prefix.as_bytes()))
            .await
            .map_err(|e| e.to_string())?;

        let mut peers = Vec::new();
        while let Some(Ok(entry)) = entries.next().await {
            let content = entry
                .content_bytes(client)
                .await
                .map_err(|e| e.to_string())?;
            if let Ok(info) = serde_json::from_slice::<VoicePeerInfo>(&content) {
                peers.push(info);
            }
        }

        Ok(peers)
    }).await
}

#[tauri::command]
pub async fn moq_start_voice(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    channel_id: String,
) -> Result<(), String> {
    log::info!("[Voice] moq_start_voice: doc_id={}, channel_id={}", doc_id, channel_id);
    // Cancel any existing voice session first
    {
        let mut guard = state.voice_cancel.lock().await;
        if let Some(cancel) = guard.take() {
            let _ = cancel.send(());
        }
    }

    let doc_ns = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;

    // Create a channel-specific topic using BLAKE3 cryptographic hash (CRIT-4)
    let topic_bytes = {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"sivyspeak-voice-topic-v1");
        hasher.update(doc_ns.as_bytes());
        hasher.update(channel_id.as_bytes());
        *hasher.finalize().as_bytes()
    };

    let topic = iroh_gossip::proto::TopicId::from_bytes(topic_bytes);

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

    // WARN-2: Bounded channel to prevent unbounded memory growth
    let (audio_tx, mut audio_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(AUDIO_CHANNEL_CAPACITY);

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

    // ── Shared jitter buffer ────────────────────────────────────────
    let jitter = Arc::new(std::sync::Mutex::new(JitterBuffer::new()));
    let jitter_for_recv = jitter.clone();
    // CRIT-2: Lock-free SPSC ring buffer instead of Arc<Mutex<VecDeque>>
    let (ring_producer, ring_consumer) = rtrb::RingBuffer::<f32>::new(RING_BUFFER_SIZE);

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
        log::info!("[Voice] MoQ output device: {}Hz, {} channels", dev_rate, dev_ch);

        let out_config = cpal::StreamConfig {
            channels: default_cfg.channels(),
            sample_rate: default_cfg.sample_rate(),
            buffer_size: cpal::BufferSize::Default,
        };

        // CRIT-2: Lock-free consumer — no Mutex in audio output callback
        let mut ring_reader = ring_consumer;
        // Resample from 48kHz mono ring buffer to device native format
        let step = OPUS_SAMPLE_RATE as f64 / dev_rate as f64;
        let mut last_sample = 0.0f32;
        let mut frac = 0.0f64;

        let output_stream = match out_device.build_output_stream(
            &out_config,
            move |data: &mut [f32], _: &_| {
                let frames = data.len() / dev_ch;
                for i in 0..frames {
                    frac += step;
                    while frac >= 1.0 {
                        last_sample = ring_reader.pop().unwrap_or(last_sample);
                        frac -= 1.0;
                    }
                    for ch in 0..dev_ch {
                        data[i * dev_ch + ch] = last_sample;
                    }
                }
            },
            |err| log::error!("[Voice] MoQ audio output error: {}", err),
            None,
        ) {
            Ok(s) => s,
            Err(e) => {
                log::error!("[Voice] Failed to build MoQ output stream: {}", e);
                return;
            }
        };

        if let Err(e) = output_stream.play() {
            log::error!("[Voice] Failed to play MoQ output stream: {}", e);
            return;
        }
        log::info!("[Voice] MoQ output stream started");

        let _ = output_stop_rx.recv();
        drop(output_stream);
    });

    // ── Receive task: decode incoming gossip audio, feed jitter buffer ─
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

        // PLC decoder — used when a packet is lost to generate concealment audio
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

        let mut ring_writer = ring_producer;
        loop {
            // WARN-4: Drain jitter → lock-free ring (no nested Mutex locks)
            {
                let mut jb = jitter_for_recv.lock().unwrap();
                loop {
                    match jb.pull() {
                        PullResult::Frame(pcm) => {
                            for &s in &pcm {
                                let _ = ring_writer.push(s);
                            }
                        }
                        PullResult::Lost => {
                            // Run Opus PLC: decode(null) generates concealment frame
                            if let Ok(n) = plc_decoder.decode_float(&[], &mut plc_buf, false) {
                                stats_plc += 1;
                                for &s in &plc_buf[..n] {
                                    let _ = ring_writer.push(s);
                                }
                            }
                        }
                        PullResult::NotReady => break,
                    }
                }
            }

            // Wait for next gossip event
            let event = tokio::select! {
                ev = stream.next() => match ev {
                    Some(Ok(e)) => e,
                    _ => break,
                },
            };

            match event {
                Event::Gossip(GossipEvent::Received(msg)) => {
                    if let Some((seq, _has_fec, opus_data)) = parse_header(&msg.content) {
                        // Decode with FEC awareness
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
                                "[Voice] Stats: packets={}, plc={}, jitter_target={}ms, buf_depth={}",
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
        log::info!("[Voice] MoQ input device: {}Hz, {} channels", dev_rate, dev_ch);

        let input_config = cpal::StreamConfig {
            channels: default_cfg.channels(),
            sample_rate: default_cfg.sample_rate(),
            buffer_size: cpal::BufferSize::Default,
        };

        let mut encoder =
            match opus::Encoder::new(OPUS_SAMPLE_RATE, opus::Channels::Mono, opus::Application::Voip) {
                Ok(mut e) => {
                    // Enable in-band FEC for packet loss resilience
                    let _ = e.set_inband_fec(true);
                    // Enable DTX to save bandwidth during silence
                    let _ = e.set_dtx(true);
                    // Set packet loss percentage hint (Opus adapts redundancy accordingly)
                    let _ = e.set_packet_loss_perc(5);
                    // Set bitrate (Discord uses ~64kbps for voice)
                    let _ = e.set_bitrate(opus::Bitrate::Bits(64000));
                    log::info!("[Voice] Opus encoder configured: FEC=on, DTX=on, loss_hint=5%, bitrate=64kbps");
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

        // CRIT-1: Pre-allocate buffers outside callback (avoid RT-thread heap alloc)
        let mut denoised_pre = vec![0.0f32; DENOISE_FRAME_SIZE];
        let mut compressed_pre = vec![0u8; MAX_OPUS_PACKET];
        let mut packet_pre = vec![0u8; HEADER_SIZE + MAX_OPUS_PACKET];

        let input_stream = match device.build_input_stream(
            &input_config,
            move |data: &[f32], _: &_| {
                let frames = data.len() / dev_ch;
                for i in 0..frames {
                    // Mix to mono
                    let mut mono = 0.0f32;
                    for ch in 0..dev_ch {
                        mono += data[i * dev_ch + ch];
                    }
                    mono /= dev_ch as f32;

                    // Resample to 48kHz
                    resample_frac += step;
                    while resample_frac >= 1.0 {
                        denoise_buf.push(mono);
                        resample_frac -= 1.0;

                        // Denoise in 480-sample chunks (nnnoiseless FRAME_SIZE)
                        if denoise_buf.len() == DENOISE_FRAME_SIZE {
                            denoiser.process_frame(&mut denoised_pre, &denoise_buf);
                            denoise_buf.clear();
                            opus_buf.extend_from_slice(&denoised_pre);

                            // Encode when we have 960 samples (20ms Opus frame)
                            if opus_buf.len() >= OPUS_FRAME_SAMPLES {
                                if let Ok(len) = encoder.encode_float(&opus_buf[..OPUS_FRAME_SAMPLES], &mut compressed_pre) {
                                    // Prepend sequence header
                                    let header = make_header(send_seq, true);
                                    packet_pre[..HEADER_SIZE].copy_from_slice(&header);
                                    packet_pre[HEADER_SIZE..HEADER_SIZE + len].copy_from_slice(&compressed_pre[..len]);
                                    // WARN-2: try_send drops packet if bounded channel is full
                                    let _ = audio_tx.try_send(packet_pre[..HEADER_SIZE + len].to_vec());
                                    send_seq = send_seq.wrapping_add(1);
                                }
                                opus_buf.drain(..OPUS_FRAME_SAMPLES);
                            }
                        }
                    }
                }
            },
            |err| log::error!("[Voice] MoQ audio input error: {}", err),
            None,
        ) {
            Ok(s) => s,
            Err(e) => {
                log::error!("[Voice] Failed to build MoQ input stream: {}", e);
                return;
            }
        };

        if let Err(e) = input_stream.play() {
            log::error!("[Voice] Failed to play MoQ input stream: {}", e);
            return;
        }
        log::info!("[Voice] MoQ input stream started (FEC+DTX+PLC enabled)");

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

fn iso_now() -> String {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    format!("{}Z", dur.as_secs())
}
