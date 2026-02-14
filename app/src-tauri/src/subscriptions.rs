/// Module for managing iroh document subscriptions

use crate::state::ChatEntry;
use tauri::Emitter;

/// Subscribe to a specific document for live events and emit to frontend
pub async fn subscribe_to_doc(
    client: iroh::client::Iroh,
    handle: tauri::AppHandle,
    namespace_id: iroh_docs::NamespaceId,
) {
    tokio::spawn(async move {
        use futures_util::StreamExt;
        
        log::info!("[P2P] Subscribing to doc: {}", namespace_id);
        
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
