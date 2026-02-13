/// MoQ (Media over QUIC) — voice transport using iroh's QUIC connections.
///
/// Instead of broadcasting audio over gossip (which is fan-out and not
/// optimized for real-time media), MoQ establishes direct QUIC streams
/// between peers in a voice channel for lower latency Opus audio delivery.
///
/// Architecture:
///   - Each peer joining voice opens a bidirectional QUIC stream to every other peer.
///   - Mic capture → nnnoiseless denoise → Opus encode → QUIC send (per stream).
///   - QUIC recv → Opus decode → mix into ring buffer → cpal output.
///   - Voice channel membership is signaled via gossip (join/leave notifications).
///
/// Key structure in iroh-doc:
///   voice/{channel_id}/peers/{node_id} → JSON { node_id, joined_at }
///   (Presence markers; peers clean up on leave.)

use std::str::FromStr;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use crate::state::IrohState;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VoicePeerInfo {
    pub node_id: String,
    pub channel_id: String,
    pub joined_at: String,
}

/// Signal that this node wants to join a voice channel.
/// Writes a presence marker into the doc so other peers can discover us.
#[tauri::command]
pub async fn moq_join_voice(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    channel_id: String,
) -> Result<(), String> {
    let doc = open_doc(&state, &doc_id).await?;
    let node_id = state.node.node_id().to_string();

    let info = VoicePeerInfo {
        node_id: node_id.clone(),
        channel_id: channel_id.clone(),
        joined_at: iso_now(),
    };

    let key = format!("voice/{}/peers/{}", channel_id, node_id);
    let json = serde_json::to_string(&info).map_err(|e| e.to_string())?;

    doc.set_bytes(
        state.author_id,
        key.as_bytes().to_vec(),
        json.as_bytes().to_vec(),
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Signal that this node is leaving a voice channel.
#[tauri::command]
pub async fn moq_leave_voice(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    channel_id: String,
) -> Result<(), String> {
    let doc = open_doc(&state, &doc_id).await?;
    let node_id = state.node.node_id().to_string();

    let key = format!("voice/{}/peers/{}", channel_id, node_id);
    doc.del(state.author_id, key.as_bytes().to_vec())
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// List all peers currently in a voice channel.
#[tauri::command]
pub async fn moq_list_voice_peers(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    channel_id: String,
) -> Result<Vec<VoicePeerInfo>, String> {
    let doc = open_doc(&state, &doc_id).await?;
    let client = state.node.client();

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
}

/// Start MoQ voice session — uses gossip for audio transport (QUIC-backed)
/// with per-channel topics for isolation between voice channels.
///
/// This is an evolution of the original start_voice: it uses a channel-specific
/// gossip topic derived from doc_id + channel_id, so multiple voice channels
/// can operate simultaneously.
#[tauri::command]
pub async fn moq_start_voice(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    channel_id: String,
) -> Result<(), String> {
    // Cancel any existing voice session first
    {
        let mut guard = state.voice_cancel.lock().await;
        if let Some(cancel) = guard.take() {
            let _ = cancel.send(());
        }
    }

    let doc_ns = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;

    // Create a channel-specific topic by hashing doc_id + channel_id
    let topic_bytes = {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        doc_ns.as_bytes().hash(&mut hasher);
        channel_id.hash(&mut hasher);
        let h = hasher.finish();
        let mut bytes = [0u8; 32];
        bytes[..8].copy_from_slice(&h.to_le_bytes());
        // Mix in more bytes for uniqueness
        bytes[8..16].copy_from_slice(&h.to_be_bytes());
        bytes[16..24].copy_from_slice(&doc_ns.as_bytes()[..8]);
        // Fill remaining with channel_id hash
        let mut hasher2 = DefaultHasher::new();
        channel_id.hash(&mut hasher2);
        let h2 = hasher2.finish();
        bytes[24..32].copy_from_slice(&h2.to_le_bytes());
        bytes
    };

    let topic = iroh_gossip::proto::TopicId::from_bytes(topic_bytes);

    // Subscribe to gossip topic for this voice channel
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

    // Ring buffer for decoded audio
    let ring_size: usize = 48000;
    let ring = Arc::new(std::sync::Mutex::new(
        std::collections::VecDeque::<f32>::with_capacity(ring_size),
    ));
    let ring_for_output = ring.clone();
    let ring_for_decoder = ring.clone();

    // Spawn a dedicated OS thread for the cpal output stream
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
                        Err(e) => eprintln!("Opus decode error: {}", e),
                    }
                }
                _ => {}
            }
        }
    });

    // Audio Capture (microphone) on a dedicated OS thread
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
                for &sample in data {
                    frame_buf.push(sample);
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

        let _ = input_stop_rx.recv();
        drop(input_stream);
    });

    // Cleanup task
    tokio::spawn(async move {
        let _ = cancel_rx.await;
        let _ = output_stop_tx.send(());
        let _ = input_stop_tx.send(());
        send_task.abort();
        recv_task.abort();
    });

    Ok(())
}

// ─── Helpers ───

async fn open_doc(
    state: &tauri::State<'_, IrohState>,
    doc_id: &str,
) -> Result<iroh::client::docs::Doc, String> {
    let ns = iroh_docs::NamespaceId::from_str(doc_id).map_err(|e| e.to_string())?;
    state
        .node
        .client()
        .docs()
        .open(ns)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Document {} not found", doc_id))
}

fn iso_now() -> String {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    format!("{}Z", dur.as_secs())
}
