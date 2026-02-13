mod state;
mod docs;
mod voice;
mod dns;
mod channels;
mod roles;
mod identity;
mod moq;

pub use state::*;

use tauri::{Manager, Emitter};
use std::sync::Arc;
use iroh_base::key::SecretKey;

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
        dns::resolve_srv,
        docs::get_node_id,
        docs::create_doc,
        docs::get_doc_ticket,
        docs::join_doc,
        docs::get_doc_owner,
        docs::send_message,
        docs::active_docs,
        docs::list_entries,
        voice::start_voice,
        voice::stop_voice,
        // P2P Channels
        channels::create_p2p_channel,
        channels::list_p2p_channels,
        channels::delete_p2p_channel,
        channels::send_p2p_channel_message,
        channels::list_p2p_channel_messages,
        // P2P Roles
        roles::set_p2p_role,
        roles::delete_p2p_role,
        roles::list_p2p_roles,
        roles::set_member_roles,
        roles::get_member_roles,
        roles::get_member_permissions,
        // DID Identity
        identity::get_did,
        identity::set_identity,
        identity::get_identity,
        identity::list_identities,
        identity::set_avatar_blob,
        // MoQ Voice
        moq::moq_join_voice,
        moq::moq_leave_voice,
        moq::moq_list_voice_peers,
        moq::moq_start_voice,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
