use std::str::FromStr;
use std::sync::Arc;
use crate::state::IrohState;

#[tauri::command]
pub async fn start_voice(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
) -> Result<(), String> {
    // Cancel any existing voice session first
    {
        let mut guard = state.voice_cancel.lock().await;
        if let Some(cancel) = guard.take() {
            let _ = cancel.send(());
        }
    }

    let doc_id = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    let topic = iroh_gossip::proto::TopicId::from_bytes(*doc_id.as_bytes());

    // Subscribe to gossip topic for voice – returns (sink, stream)
    let client = state.node.client();
    let (gossip_sender, gossip_receiver) = client
        .gossip()
        .subscribe(topic, Vec::<iroh_base::key::PublicKey>::new())
        .await
        .map_err(|e| e.to_string())?;

    // Channel to bridge sync audio capture callback → async gossip broadcast
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

    // Ring buffer for decoded audio: producer (network) → consumer (audio callback)
    let ring_size: usize = 48000; // 1s buffer at 48kHz mono
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
                eprintln!("No output audio device available");
                return;
            }
        };
        let out_config = cpal::StreamConfig {
            channels: 1,
            sample_rate: cpal::SampleRate(48000),
            buffer_size: cpal::BufferSize::Default,
        };

        let ring_reader = ring_for_output;
        let output_stream = match out_device.build_output_stream(
            &out_config,
            move |data: &mut [f32], _: &_| {
                let mut rb = ring_reader.lock().unwrap();
                for sample in data.iter_mut() {
                    *sample = rb.pop_front().unwrap_or(0.0);
                }
            },
            |err| eprintln!("Audio output error: {}", err),
            None,
        ) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Failed to build output stream: {}", e);
                return;
            }
        };

        if let Err(e) = output_stream.play() {
            eprintln!("Failed to play output stream: {}", e);
            return;
        }

        // Block this thread until stop signal
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
                eprintln!("Failed to create Opus decoder: {}", e);
                return;
            }
        };

        let mut stream = gossip_receiver;
        let mut decode_buf = vec![0f32; 960]; // 20ms at 48kHz
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
                        Err(e) => eprintln!("Opus decode error: {}", e),
                    }
                }
                _ => {}
            }
        }
    });

    // Audio Capture Setup (send side — microphone)
    // cpal::Stream is !Send, so we run capture on a dedicated OS thread too
    let (input_stop_tx, input_stop_rx) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                eprintln!("No input audio device available");
                return;
            }
        };
        let input_config = cpal::StreamConfig {
            channels: 1,
            sample_rate: cpal::SampleRate(48000),
            buffer_size: cpal::BufferSize::Default,
        };

        let mut encoder =
            match opus::Encoder::new(48000, opus::Channels::Mono, opus::Application::Voip) {
                Ok(e) => e,
                Err(e) => {
                    eprintln!("Failed to create Opus encoder: {}", e);
                    return;
                }
            };
        let mut denoiser = nnnoiseless::DenoiseState::new();
        let mut frame_buf = Vec::<f32>::with_capacity(960);

        let input_stream = match device.build_input_stream(
            &input_config,
            move |data: &[f32], _: &_| {
                // Accumulate samples into 960-sample frames (20ms at 48kHz)
                for &sample in data {
                    frame_buf.push(sample);
                    if frame_buf.len() == 960 {
                        // Denoise
                        let mut denoised = vec![0.0f32; 960];
                        denoiser.process_frame(&mut denoised, &frame_buf);
                        frame_buf.clear();

                        // Encode with Opus
                        let mut compressed = vec![0u8; 1275];
                        if let Ok(len) = encoder.encode_float(&denoised, &mut compressed) {
                            let _ = audio_tx.send(compressed[..len].to_vec());
                        }
                    }
                }
            },
            |err| eprintln!("Audio input error: {}", err),
            None,
        ) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("Failed to build input stream: {}", e);
                return;
            }
        };

        if let Err(e) = input_stream.play() {
            eprintln!("Failed to play input stream: {}", e);
            return;
        }

        // Block this thread until stop signal
        let _ = input_stop_rx.recv();
        drop(input_stream);
    });

    // Spawn a task that waits for cancellation and cleans up
    tokio::spawn(async move {
        let _ = cancel_rx.await;
        // Stop audio threads and abort async tasks
        let _ = output_stop_tx.send(());
        let _ = input_stop_tx.send(());
        send_task.abort();
        recv_task.abort();
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_voice(state: tauri::State<'_, IrohState>) -> Result<(), String> {
    let mut guard = state.voice_cancel.lock().await;
    if let Some(cancel) = guard.take() {
        let _ = cancel.send(());
    }
    Ok(())
}
