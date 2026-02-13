use hickory_resolver::Resolver;
use hickory_resolver::config::*;
use serde::Serialize;
use std::str::FromStr;

#[derive(Serialize)]
pub struct SrvResult {
  host: String,
  port: u16,
}

#[tauri::command]
async fn get_node_id(state: tauri::State<'_, IrohState>) -> Result<String, String> {
  Ok(state.node.node_id().to_string())
}

#[tauri::command]
async fn create_doc(state: tauri::State<'_, IrohState>) -> Result<String, String> {
  let doc = state.node.docs().create().await.map_err(|e| e.to_string())?;
  let ticket = doc.share(iroh::docs::ShareMode::Write, iroh::docs::AddrInfoOptions::RelayAndAddresses).await.map_err(|e| e.to_string())?;
  Ok(ticket.to_string())
}

#[tauri::command]
async fn join_doc(state: tauri::State<'_, IrohState>, ticket_str: String) -> Result<String, String> {
  let ticket = iroh::docs::DocTicket::from_str(&ticket_str).map_err(|e| e.to_string())?;
  let doc = state.node.docs().import(ticket).await.map_err(|e| e.to_string())?;
  Ok(doc.id().to_string())
}

#[tauri::command]
async fn active_docs(state: tauri::State<'_, IrohState>) -> Result<Vec<String>, String> {
  let docs = state.node.docs().list().await.map_err(|e| e.to_string())?;
  let ids = docs.into_iter().map(|(id, _)| id.to_string()).collect();
  Ok(ids)
}

#[derive(Serialize)]
pub struct ChatEntry {
    author: String,
    key: String,
    content: String,
}

#[tauri::command]
async fn list_entries(state: tauri::State<'_, IrohState>, doc_id: String) -> Result<Vec<ChatEntry>, String> {
    let doc_id = iroh::docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    let doc = state.node.docs().get_by_id(doc_id).await.map_err(|e| e.to_string())?.ok_or("Document not found")?;
    
    let mut entries = doc.get_many(iroh::docs::store::Query::all()).await.map_err(|e| e.to_string())?;
    let mut chat_entries = Vec::new();
    
    use futures_util::StreamExt;
    while let Some(entry) = entries.next().await {
        let entry = entry.map_err(|e| e.to_string())?;
        let content = entry.content_bytes(&state.node).await.map_err(|e| e.to_string())?;
        chat_entries.push(ChatEntry {
            author: entry.author().to_string(),
            key: String::from_utf8_lossy(entry.key()).to_string(),
            content: String::from_utf8_lossy(&content).to_string(),
        });
    }
    
    Ok(chat_entries)
}
  let resolver = Resolver::new(ResolverConfig::default(), ResolverOpts::default())
    .map_err(|e| e.to_string())?;
  
  let query = format!("_sivycord._tcp.{}", domain);
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

use iroh::node::Node;
use iroh::endpoint::SecretKey;

use iroh::docs::AuthorId;

pub struct IrohState {
  pub node: Node,
  pub author_id: AuthorId,
}

#[tauri::command]
async fn send_message(state: tauri::State<'_, IrohState>, doc_id: String, message: String) -> Result<(), String> {
  let doc_id = iroh::docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
  let doc = state.node.docs().get_by_id(doc_id).await.map_err(|e| e.to_string())?.ok_or("Document not found")?;
  
  let timestamp = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap()
    .as_millis();
  
  let key = format!("chat/{}", timestamp);
  doc.set_bytes(state.author_id, key.as_bytes().to_vec(), message.as_bytes().to_vec())
    .await
    .map_err(|e| e.to_string())?;
    
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

      // Initialize Iroh Node with Persistent Secret Key
      let rt = tokio::runtime::Runtime::new().unwrap();
      let node = rt.block_on(async {
        let entry = keyring::Entry::new("sivyspeak", "default-identity").unwrap();
        let secret_key = match entry.get_password() {
            Ok(pw) => {
                let bytes = hex::decode(pw).expect("invalid secret key in keychain");
                SecretKey::from_bytes(&bytes.try_into().expect("invalid key length"))
            }
            Err(_) => {
                let sk = SecretKey::generate();
                let hex_sk = hex::encode(sk.to_bytes());
                entry.set_password(&hex_sk).expect("failed to save secret key to keychain");
                sk
            }
        };

        Node::memory()
          .secret_key(secret_key)
          .spawn()
          .await
          .unwrap()
      });

      let author_id = rt.block_on(async {
        let entry = keyring::Entry::new("sivyspeak", "default-author").unwrap();
        match entry.get_password() {
            Ok(pw) => {
                let bytes = hex::decode(pw).expect("invalid author id in keychain");
                AuthorId::from_bytes(&bytes.try_into().expect("invalid key length"))
            }
            Err(_) => {
                let ai = node.authors().create().await.unwrap();
                let hex_ai = hex::encode(ai.to_bytes());
                entry.set_password(&hex_ai).expect("failed to save author id to keychain");
                ai
            }
        }
      });

      app.manage(IrohState { node, author_id });

      // Background Task: Subscribe to Document Events
      let app_handle = app.handle().clone();
      let node_sub = node.clone();
      rt.spawn(async move {
        let mut sub = node_sub.docs().subscribe_all().await.unwrap();
        while let Ok(event) = sub.recv().await {
            match event {
                iroh::docs::engine::LiveEvent::InsertRemote { entry, .. } | 
                iroh::docs::engine::LiveEvent::InsertLocal { entry } => {
                    let content = entry.content_bytes(&node_sub).await.unwrap_or_default();
                    let payload = ChatEntry {
                        author: entry.author().to_string(),
                        key: String::from_utf8_lossy(entry.key()).to_string(),
                        content: String::from_utf8_lossy(&content).to_string(),
                    };
                    let _ = app_handle.emit("iroh-entry", payload);
                }
                _ => {}
            }
        }
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        resolve_srv, 
        get_node_id, 
        create_doc, 
        join_doc, 
        send_message,
        active_docs,
        list_entries
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
