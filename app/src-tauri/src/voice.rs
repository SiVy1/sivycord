use std::str::FromStr;
use std::sync::Arc;
use crate::state::IrohState;

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

    // Background task: forward captured audio packets to gossip (send side)
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

    // Ring buffer for decoded audio: producer (network) -> consumer (audio callback)
    let ring_size: usize = 48000;
    let ring = Arc::new(std::sync::Mutex::new(
        std::collections::VecDeque::<f32>::with_capacity(ring_size),
    ));
    let ring_for_output = ring.clone();
    let ring_for_decoder = ring.clone();

    // Spawn a dedicated OS thread for the cpal output stream (it's !Send)
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
        let step = 48000.0_f64 / dev_rate as f64;
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

    // Async task: decode incoming gossip audio and push to ring buffer
    use futures_util::StreamExt;
    let recv_task = tokio::spawn(async move {
        use iroh_gossip::net::{Event, GossipEvent};

        let mut decoder = match opus::Decoder::new(48000, opus::Channels::Mono) {
            Ok(d) => d,
            Err(e) => {
                log::error!("[Voice] Failed to create Opus decoder: {}", e);
                return;
            }
        };

        let mut stream = gossip_receiver;
        let mut decode_buf = vec![0f32; 960];
        while let Some(Ok(event)) = stream.next().await {
            match event {
                Event::Gossip(GossipEvent::Received(msg)) => {
                    match decoder.decode_float(&msg.content, &mut decode_buf, false) {
                        Ok(decoded_samples) => {
                            let mut rb = ring_for_decoder.lock().unwrap();
                            for &s in &decode_buf[..decoded_samples] {
                                if rb.len() < ring_size {
                                    rb.push_back(s);
                                }
                            }
                        }
                        Err(e) => log::error!("[Voice] Opus decode error: {}", e),
                    }
                }
                _ => {}
            }
        }
    });

    // Audio Capture Setup (send side)
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
            match opus::Encoder::new(48000, opus::Channels::Mono, opus::Application::Voip) {
                Ok(e) => e,
                Err(e) => {
                    log::error!("[Voice] Failed to create Opus encoder: {}", e);
                    return;
                }
            };
        let mut denoiser = nnnoiseless::DenoiseState::new();
        let mut frame_buf = Vec::<f32>::with_capacity(960);
        // Resample from device rate to 48kHz mono for Opus
        let step = 48000.0_f64 / dev_rate as f64;
        let mut resample_frac = 0.0f64;

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
                        frame_buf.push(mono);
                        resample_frac -= 1.0;

                        if frame_buf.len() == 960 {
                            let mut denoised = vec![0.0f32; 960];
                            denoiser.process_frame(&mut denoised, &frame_buf);
                            frame_buf.clear();

                            let mut compressed = vec![0u8; 1275];
                            if let Ok(len) = encoder.encode_float(&denoised, &mut compressed) {
                                let _ = audio_tx.send(compressed[..len].to_vec());
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
        log::info!("[Voice] Input stream started");

        let _ = input_stop_rx.recv();
        drop(input_stream);
    });

    // Spawn a task that waits for cancellation and cleans up
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
