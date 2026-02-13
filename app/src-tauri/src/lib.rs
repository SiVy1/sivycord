use tauri::{Manager, Emitter};
use serde::Serialize;
use std::str::FromStr;
use std::sync::Arc;
use hickory_resolver::Resolver;
use hickory_resolver::config::*;
use iroh_base::key::SecretKey;
use iroh_docs::AuthorId;

#[derive(Serialize)]
pub struct SrvResult {
  host: String,
  port: u16,
}

/// Application state holding the iroh Node and default author.
/// We use the high-level `iroh::Node` API which internally manages
/// stores, gossip, downloader, and the sync engine.
pub struct IrohState {
  pub node: iroh::node::Node<iroh_blobs::store::fs::Store>,
  pub author_id: AuthorId,
  /// Keep the tokio runtime alive for the lifetime of the app.
  pub _runtime: Arc<tokio::runtime::Runtime>,
  /// Handle to cancel an active P2P voice session.
  pub voice_cancel: Arc<tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ChatEntry {
    author: String,
    key: String,
    content: String,
}

#[tauri::command]
async fn get_node_id(state: tauri::State<'_, IrohState>) -> Result<String, String> {
  Ok(state.node.node_id().to_string())
}

#[tauri::command]
async fn create_doc(state: tauri::State<'_, IrohState>) -> Result<String, String> {
  let client = state.node.client();
  let doc = client.docs().create().await.map_err(|e| e.to_string())?;

  // Mark the creator as the owner/admin of this P2P server
  let owner_id = state.node.node_id().to_string();
  doc
    .set_bytes(state.author_id, b"meta/owner".to_vec(), owner_id.as_bytes().to_vec())
    .await
    .map_err(|e| e.to_string())?;

  let ticket = doc
    .share(
      iroh::client::docs::ShareMode::Write,
      iroh_base::node_addr::AddrInfoOptions::RelayAndAddresses,
    )
    .await
    .map_err(|e| e.to_string())?;
  Ok(ticket.to_string())
}

#[tauri::command]
async fn get_doc_owner(state: tauri::State<'_, IrohState>, doc_id: String) -> Result<Option<String>, String> {
  let doc_id = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
  let client = state.node.client();
  let doc = client
    .docs()
    .open(doc_id)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Document {} not found", doc_id))?;

  use futures_util::StreamExt;
  let mut entries = doc
    .get_many(iroh_docs::store::Query::key_exact(b"meta/owner"))
    .await
    .map_err(|e| e.to_string())?;

  if let Some(Ok(entry)) = entries.next().await {
    let content = entry.content_bytes(client).await.map_err(|e| e.to_string())?;
    return Ok(Some(String::from_utf8_lossy(&content).to_string()));
  }

  Ok(None)
}

#[tauri::command]
async fn join_doc(state: tauri::State<'_, IrohState>, ticket_str: String) -> Result<String, String> {
  let ticket = iroh_docs::DocTicket::from_str(&ticket_str).map_err(|e| e.to_string())?;
  let client = state.node.client();
  let doc = client.docs().import(ticket).await.map_err(|e| e.to_string())?;
  Ok(doc.id().to_string())
}

#[tauri::command]
async fn active_docs(state: tauri::State<'_, IrohState>) -> Result<Vec<String>, String> {
  use futures_util::StreamExt;
  let client = state.node.client();
  let docs_stream = client.docs().list().await.map_err(|e| e.to_string())?;
  let ids: Vec<String> = docs_stream
    .filter_map(|r| async { r.ok().map(|(ns, _)| ns.to_string()) })
    .collect()
    .await;
  Ok(ids)
}

#[tauri::command]
async fn list_entries(state: tauri::State<'_, IrohState>, doc_id: String) -> Result<Vec<ChatEntry>, String> {
    let doc_id = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    let client = state.node.client();
    let doc = client
      .docs()
      .open(doc_id)
      .await
      .map_err(|e| e.to_string())?
      .ok_or_else(|| format!("Document {} not found", doc_id))?;

    use futures_util::StreamExt;
    let mut entries_stream = doc.get_many(iroh_docs::store::Query::all()).await.map_err(|e| e.to_string())?;
    let mut chat_entries = Vec::new();

    while let Some(result) = entries_stream.next().await {
        let entry = result.map_err(|e| e.to_string())?;
        let content = entry
          .content_bytes(client)
          .await
          .map_err(|e| e.to_string())?;

        chat_entries.push(ChatEntry {
            author: entry.author().to_string(),
            key: String::from_utf8_lossy(entry.key()).to_string(),
            content: String::from_utf8_lossy(&content).to_string(),
        });
    }

    Ok(chat_entries)
}

#[tauri::command]
async fn send_message(state: tauri::State<'_, IrohState>, doc_id: String, message: String) -> Result<(), String> {
  let doc_id = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
  let client = state.node.client();
  let doc = client
    .docs()
    .open(doc_id)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| format!("Document {} not found", doc_id))?;

  let timestamp = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap()
    .as_millis();

  let key = format!("chat/{}", timestamp);

  doc
    .set_bytes(state.author_id, key.as_bytes().to_vec(), message.as_bytes().to_vec())
    .await
    .map_err(|e| e.to_string())?;

  Ok(())
}

#[tauri::command]
async fn resolve_srv(domain: String) -> Result<Option<SrvResult>, String> {
  let resolver = Resolver::new(ResolverConfig::default(), ResolverOpts::default())
    .map_err(|e| e.to_string())?;

  let query = format!("_sivyspeak._tcp.{}", domain);
  match resolver.srv_lookup(query) {
    Ok(lookup) => {
      if let Some(srv) = lookup.iter().next() {
        let host = srv.target().to_string().trim_end_matches('.').to_string();
        return Ok(Some(SrvResult {
          host,
          port: srv.port(),
        }));
      }
      Ok(None)
    }
    Err(_) => Ok(None),
  }
}

#[tauri::command]
async fn start_voice(state: tauri::State<'_, IrohState>, doc_id: String) -> Result<(), String> {
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

    // Background task: receive audio from gossip and play (receive side)
    // cpal::Stream is !Send, so we decode in an async task and push samples
    // to a shared ring buffer. The output stream runs on a dedicated OS thread.
    use futures_util::StreamExt;

    // Ring buffer for decoded audio: producer (network) → consumer (audio callback)
    let ring_size: usize = 48000; // 1s buffer at 48kHz mono
    let ring = Arc::new(std::sync::Mutex::new(std::collections::VecDeque::<f32>::with_capacity(ring_size)));
    let ring_for_output = ring.clone();
    let ring_for_decoder = ring.clone();

    // Spawn a dedicated OS thread for the cpal output stream (it's !Send)
    let (output_stop_tx, output_stop_rx) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        let audio_host = cpal::default_host();
        let out_device = match audio_host.default_output_device() {
            Some(d) => d,
            None => { eprintln!("No output audio device available"); return; }
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
            Err(e) => { eprintln!("Failed to build output stream: {}", e); return; }
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
    let recv_task = tokio::spawn(async move {
        use iroh_gossip::net::{Event, GossipEvent};

        let mut decoder = match opus::Decoder::new(48000, opus::Channels::Mono) {
            Ok(d) => d,
            Err(e) => { eprintln!("Failed to create Opus decoder: {}", e); return; }
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
            None => { eprintln!("No input audio device available"); return; }
        };
        let input_config = cpal::StreamConfig {
            channels: 1,
            sample_rate: cpal::SampleRate(48000),
            buffer_size: cpal::BufferSize::Default,
        };

        let mut encoder = match opus::Encoder::new(48000, opus::Channels::Mono, opus::Application::Voip) {
            Ok(e) => e,
            Err(e) => { eprintln!("Failed to create Opus encoder: {}", e); return; }
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
            None
        ) {
            Ok(s) => s,
            Err(e) => { eprintln!("Failed to build input stream: {}", e); return; }
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
async fn stop_voice(state: tauri::State<'_, IrohState>) -> Result<(), String> {
    let mut guard = state.voice_cancel.lock().await;
    if let Some(cancel) = guard.take() {
        let _ = cancel.send(());
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let rt = Arc::new(tokio::runtime::Runtime::new().unwrap());
      let rt_clone = rt.clone();

      let result: Result<_, String> = rt.block_on(async {
        let app_data_dir = app.path().app_local_data_dir().unwrap();
        let iroh_dir = app_data_dir.join("iroh");
        std::fs::create_dir_all(&iroh_dir).unwrap();

        // Load or generate persistent secret key via system keychain
        let ek_entry = keyring::Entry::new("sivyspeak", "default-identity").unwrap();
        let secret_key = match ek_entry.get_password() {
            Ok(pw) => {
                let bytes = hex::decode(pw).expect("invalid secret key in keychain");
                SecretKey::from_bytes(&bytes.try_into().expect("invalid key length"))
            }
            Err(_) => {
                let sk = SecretKey::generate();
                let hex_sk = hex::encode(sk.to_bytes());
                ek_entry.set_password(&hex_sk).expect("failed to save secret key to keychain");
                sk
            }
        };

        // Build and spawn the iroh Node – handles stores, gossip, downloader, sync engine
        let node = iroh::node::FsNode::persistent(&iroh_dir)
            .await
            .map_err(|e| format!("Failed to initialize iroh: {}", e))?
            .secret_key(secret_key)
            .spawn()
            .await
            .map_err(|e| format!("Failed to spawn iroh node: {}", e))?;

        // Use the default author (creates one if it doesn't exist)
        let author_id = node
          .client()
          .authors()
          .default()
          .await
          .map_err(|e| format!("Failed to get default author: {}", e))?;

        Ok((node, author_id))
      });
      let (node, author_id) = result?;

      // Subscribe to doc events in background
      let app_handle = app.handle().clone();
      let client_for_sub = node.client().clone();
      rt_clone.spawn(async move {
        use futures_util::StreamExt;
        // List all existing docs and subscribe to events
        if let Ok(mut docs_list) = client_for_sub.docs().list().await {
            while let Some(Ok((namespace_id, _))) = docs_list.next().await {
                let client = client_for_sub.clone();
                let handle = app_handle.clone();
                tokio::spawn(async move {
                    if let Ok(Some(doc)) = client.docs().open(namespace_id).await {
                        if let Ok(mut sub) = doc.subscribe().await {
                            while let Some(Ok(event)) = sub.next().await {
                                match event {
                                    iroh::client::docs::LiveEvent::InsertRemote { entry, .. } |
                                    iroh::client::docs::LiveEvent::InsertLocal { entry } => {
                                        let content = entry
                                            .content_bytes(&client)
                                            .await
                                            .unwrap_or_default();
                                        let payload = ChatEntry {
                                            author: entry.author().to_string(),
                                            key: String::from_utf8_lossy(entry.key()).to_string(),
                                            content: String::from_utf8_lossy(&content).to_string(),
                                        };
                                        let _ = handle.emit("iroh-entry", payload);
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                });
            }
        }
      });

      app.manage(IrohState {
        node,
        author_id,
        _runtime: rt_clone,
        voice_cancel: Arc::new(tokio::sync::Mutex::new(None)),
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        resolve_srv,
        get_node_id,
        create_doc,
        join_doc,
        get_doc_owner,
        send_message,
        active_docs,
        list_entries,
        start_voice,
        stop_voice
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
