/// P2P Channels — stored in iroh-doc with key structure:
///
///   channels/{channel_id}/meta  → JSON { name, channel_type, position, created_at }
///   channels/{channel_id}/messages/{timestamp_nanos}  → JSON message content
///
/// A default "general" text channel and "voice-lounge" voice channel are
/// created automatically when a new doc is created (see docs::create_doc).

use std::str::FromStr;
use serde::{Deserialize, Serialize};
use crate::state::{IrohState, ChatEntry};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct P2PChannel {
    pub id: String,
    pub name: String,
    pub channel_type: String, // "text" | "voice"
    pub position: u32,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct P2PMessage {
    pub author: String,
    pub author_node: String,
    pub content: String,
    pub timestamp: String,
    pub channel_id: String,
}

/// Create a new channel in a P2P server document.
#[tauri::command]
pub async fn create_p2p_channel(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    name: String,
    channel_type: String,
) -> Result<P2PChannel, String> {
    let doc_id_parsed = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    let client = state.node.client();
    let doc = client
        .docs()
        .open(doc_id_parsed)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Document {} not found", doc_id))?;

    let channel_id = format!("{:x}", rand_id());
    let now = iso_now();

    let channel = P2PChannel {
        id: channel_id.clone(),
        name,
        channel_type,
        position: 0, // Will be set based on existing count
        created_at: now,
    };

    let meta_key = format!("channels/{}/meta", channel_id);
    let meta_json = serde_json::to_string(&channel).map_err(|e| e.to_string())?;

    doc.set_bytes(
        state.author_id,
        meta_key.as_bytes().to_vec(),
        meta_json.as_bytes().to_vec(),
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(channel)
}

/// List all channels in a P2P server document.
#[tauri::command]
pub async fn list_p2p_channels(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
) -> Result<Vec<P2PChannel>, String> {
    let doc_id_parsed = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    let client = state.node.client();
    let doc = client
        .docs()
        .open(doc_id_parsed)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Document {} not found", doc_id))?;

    use futures_util::StreamExt;
    let prefix = b"channels/";
    let mut entries = doc
        .get_many(iroh_docs::store::Query::key_prefix(prefix))
        .await
        .map_err(|e| e.to_string())?;

    let mut channels = Vec::new();
    while let Some(Ok(entry)) = entries.next().await {
        let key = String::from_utf8_lossy(entry.key()).to_string();
        // Only process /meta keys, skip /messages/*
        if key.ends_with("/meta") {
            let content = entry
                .content_bytes(client)
                .await
                .map_err(|e| e.to_string())?;
            if let Ok(channel) = serde_json::from_slice::<P2PChannel>(&content) {
                channels.push(channel);
            }
        }
    }

    channels.sort_by_key(|c| c.position);
    Ok(channels)
}

/// Delete a channel from a P2P server document.
#[tauri::command]
pub async fn delete_p2p_channel(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    channel_id: String,
) -> Result<(), String> {
    let doc_id_parsed = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    let client = state.node.client();
    let doc = client
        .docs()
        .open(doc_id_parsed)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Document {} not found", doc_id))?;

    // Delete the channel meta entry by writing an empty tombstone
    let meta_key = format!("channels/{}/meta", channel_id);
    doc.del(state.author_id, meta_key.as_bytes().to_vec())
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Send a message to a specific P2P channel.
#[tauri::command]
pub async fn send_p2p_channel_message(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    channel_id: String,
    content: String,
    author_name: String,
) -> Result<(), String> {
    let doc_id_parsed = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    let client = state.node.client();
    let doc = client
        .docs()
        .open(doc_id_parsed)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Document {} not found", doc_id))?;

    let ts = timestamp_nanos();
    let node_id = state.node.node_id().to_string();

    let message = P2PMessage {
        author: author_name,
        author_node: node_id,
        content,
        timestamp: ts.to_string(),
        channel_id: channel_id.clone(),
    };

    let key = format!("channels/{}/messages/{}", channel_id, ts);
    let json = serde_json::to_string(&message).map_err(|e| e.to_string())?;

    doc.set_bytes(
        state.author_id,
        key.as_bytes().to_vec(),
        json.as_bytes().to_vec(),
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// List messages in a specific P2P channel.
#[tauri::command]
pub async fn list_p2p_channel_messages(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    channel_id: String,
) -> Result<Vec<ChatEntry>, String> {
    let doc_id_parsed = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    let client = state.node.client();
    let doc = client
        .docs()
        .open(doc_id_parsed)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Document {} not found", doc_id))?;

    use futures_util::StreamExt;
    let prefix = format!("channels/{}/messages/", channel_id);
    let mut entries = doc
        .get_many(iroh_docs::store::Query::key_prefix(prefix.as_bytes()))
        .await
        .map_err(|e| e.to_string())?;

    let mut messages = Vec::new();
    while let Some(Ok(entry)) = entries.next().await {
        let content = entry
            .content_bytes(client)
            .await
            .map_err(|e| e.to_string())?;

        messages.push(ChatEntry {
            author: entry.author().to_string(),
            key: String::from_utf8_lossy(entry.key()).to_string(),
            content: String::from_utf8_lossy(&content).to_string(),
        });
    }

    Ok(messages)
}

/// Create default channels (general text + voice lounge) for a new P2P server.
pub async fn create_default_channels(
    _node: &iroh::node::Node<iroh_blobs::store::fs::Store>,
    author_id: iroh_docs::AuthorId,
    doc: &iroh::client::docs::Doc,
) -> Result<(), String> {
    let now = iso_now();

    let general = P2PChannel {
        id: "general".to_string(),
        name: "general".to_string(),
        channel_type: "text".to_string(),
        position: 0,
        created_at: now.clone(),
    };
    let voice = P2PChannel {
        id: "voice-lounge".to_string(),
        name: "Voice Lounge".to_string(),
        channel_type: "voice".to_string(),
        position: 1,
        created_at: now,
    };

    for ch in [&general, &voice] {
        let meta_key = format!("channels/{}/meta", ch.id);
        let json = serde_json::to_string(ch).map_err(|e| e.to_string())?;
        doc.set_bytes(
            author_id,
            meta_key.as_bytes().to_vec(),
            json.as_bytes().to_vec(),
        )
        .await
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ─── Helpers ───

fn rand_id() -> u64 {
    use std::time::SystemTime;
    let t = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64;
    // Simple hash to avoid collisions with timestamps
    t ^ (t >> 16)
}

fn timestamp_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}

fn iso_now() -> String {
    let dur = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    let secs = dur.as_secs();
    format!("{}Z", secs)
}
