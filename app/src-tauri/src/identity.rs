/// DID (Decentralized Identity)  based on iroh's Ed25519 NodeID.
///
/// Each peer's identity is stored in iroh-doc under:
///   identity/{node_id}   JSON { node_id, display_name, avatar_blob, bio, created_at }

use std::str::FromStr;
use serde::{Deserialize, Serialize};
use crate::state::IrohState;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct P2PIdentity {
    pub node_id: String,
    pub display_name: String,
    pub avatar_hash: Option<String>,
    pub bio: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub async fn get_did(state: tauri::State<'_, IrohState>) -> Result<String, String> {
    let node_id = state.node.node_id();
    Ok(format!("did:key:{}", node_id))
}

#[tauri::command]
pub async fn set_identity(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    display_name: String,
    bio: Option<String>,
) -> Result<P2PIdentity, String> {
    log::info!("[P2P] set_identity: doc_id={}, display_name={}", doc_id, display_name);
    let ns = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| {
        log::error!("[P2P] set_identity: invalid doc_id: {}", e);
        e.to_string()
    })?;
    state.on_rt(move |node, author_id| async move {
        let client = node.client();
        let doc = client.docs().open(ns).await.map_err(|e| {
            log::error!("[P2P] set_identity: failed to open doc: {}", e);
            e.to_string()
        })?
            .ok_or_else(|| {
                log::error!("[P2P] set_identity: document not found");
                "Document not found".to_string()
            })?;
        let node_id = node.node_id().to_string();

        let identity = P2PIdentity {
            node_id: node_id.clone(),
            display_name,
            avatar_hash: None,
            bio,
            created_at: iso_now(),
        };

        let key = format!("identity/{}", node_id);
        let json = serde_json::to_string(&identity).map_err(|e| e.to_string())?;

        doc.set_bytes(
            author_id,
            key.as_bytes().to_vec(),
            json.as_bytes().to_vec(),
        )
        .await
        .map_err(|e| {
            log::error!("[P2P] set_identity: failed to write: {}", e);
            e.to_string()
        })?;

        log::info!("[P2P] set_identity: identity saved for node_id={}", node_id);
        Ok(identity)
    }).await
}

#[tauri::command]
pub async fn get_identity(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    node_id: String,
) -> Result<Option<P2PIdentity>, String> {
    let ns = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    state.on_rt(move |node, _author_id| async move {
        let client = node.client();
        let doc = client.docs().open(ns).await.map_err(|e| e.to_string())?
            .ok_or_else(|| "Document not found".to_string())?;

        use futures_util::StreamExt;
        let key = format!("identity/{}", node_id);
        let mut entries = doc
            .get_many(iroh_docs::store::Query::key_exact(key.as_bytes()))
            .await
            .map_err(|e| e.to_string())?;

        if let Some(Ok(entry)) = entries.next().await {
            let content = entry
                .content_bytes(client)
                .await
                .map_err(|e| e.to_string())?;
            if let Ok(identity) = serde_json::from_slice::<P2PIdentity>(&content) {
                return Ok(Some(identity));
            }
        }

        Ok(None)
    }).await
}

#[tauri::command]
pub async fn list_identities(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
) -> Result<Vec<P2PIdentity>, String> {
    let ns = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    state.on_rt(move |node, _author_id| async move {
        let client = node.client();
        let doc = client.docs().open(ns).await.map_err(|e| e.to_string())?
            .ok_or_else(|| "Document not found".to_string())?;

        use futures_util::StreamExt;
        let mut entries = doc
            .get_many(iroh_docs::store::Query::key_prefix(b"identity/"))
            .await
            .map_err(|e| e.to_string())?;

        let mut identities = Vec::new();
        while let Some(Ok(entry)) = entries.next().await {
            let content = entry
                .content_bytes(client)
                .await
                .map_err(|e| e.to_string())?;
            if let Ok(identity) = serde_json::from_slice::<P2PIdentity>(&content) {
                identities.push(identity);
            }
        }

        Ok(identities)
    }).await
}

#[tauri::command]
pub async fn set_avatar_blob(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    file_path: String,
) -> Result<P2PIdentity, String> {
    let ns = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    let path = std::path::PathBuf::from(&file_path);
    if !path.exists() {
        return Err("File not found".to_string());
    }

    state.on_rt(move |node, author_id| async move {
        let client = node.client();
        let node_id = node.node_id().to_string();

        let import = client
            .blobs()
            .add_from_path(path, false, iroh_blobs::util::SetTagOption::Auto, iroh::client::blobs::WrapOption::NoWrap)
            .await
            .map_err(|e| e.to_string())?;

        let outcome = import
            .finish()
            .await
            .map_err(|e| e.to_string())?;

        let blob_hash = outcome.hash.to_string();

        let doc = client.docs().open(ns).await.map_err(|e| e.to_string())?
            .ok_or_else(|| "Document not found".to_string())?;
        let key = format!("identity/{}", node_id);

        use futures_util::StreamExt;
        let mut identity = {
            let mut entries = doc
                .get_many(iroh_docs::store::Query::key_exact(key.as_bytes()))
                .await
                .map_err(|e| e.to_string())?;

            if let Some(Ok(entry)) = entries.next().await {
                let content = entry
                    .content_bytes(client)
                    .await
                    .map_err(|e| e.to_string())?;
                serde_json::from_slice::<P2PIdentity>(&content).unwrap_or_else(|_| P2PIdentity {
                    node_id: node_id.clone(),
                    display_name: node_id[..8].to_string(),
                    avatar_hash: None,
                    bio: None,
                    created_at: iso_now(),
                })
            } else {
                P2PIdentity {
                    node_id: node_id.clone(),
                    display_name: node_id[..8].to_string(),
                    avatar_hash: None,
                    bio: None,
                    created_at: iso_now(),
                }
            }
        };

        identity.avatar_hash = Some(blob_hash);

        let json = serde_json::to_string(&identity).map_err(|e| e.to_string())?;
        doc.set_bytes(
            author_id,
            key.as_bytes().to_vec(),
            json.as_bytes().to_vec(),
        )
        .await
        .map_err(|e| e.to_string())?;

        Ok(identity)
    }).await
}

// ── Presence ───────────────────────────────────────────────────────────
// Key format: presence/{node_id}  →  JSON { node_id, timestamp }
// Heartbeat every ~30s; anyone with timestamp within last 90s is "online".

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PresenceInfo {
    pub node_id: String,
    pub timestamp: u64, // unix seconds
}

#[tauri::command]
pub async fn set_presence(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
) -> Result<(), String> {
    let ns = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    state.on_rt(move |node, author_id| async move {
        let client = node.client();
        let doc = client.docs().open(ns).await.map_err(|e| e.to_string())?
            .ok_or_else(|| "Document not found".to_string())?;
        let node_id = node.node_id().to_string();

        let info = PresenceInfo {
            node_id: node_id.clone(),
            timestamp: now_secs(),
        };

        let key = format!("presence/{}", node_id);
        let json = serde_json::to_string(&info).map_err(|e| e.to_string())?;
        doc.set_bytes(author_id, key.as_bytes().to_vec(), json.as_bytes().to_vec())
            .await.map_err(|e| e.to_string())?;
        Ok(())
    }).await
}

#[tauri::command]
pub async fn list_presences(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
) -> Result<Vec<PresenceInfo>, String> {
    let ns = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    state.on_rt(move |node, _author_id| async move {
        let client = node.client();
        let doc = client.docs().open(ns).await.map_err(|e| e.to_string())?
            .ok_or_else(|| "Document not found".to_string())?;

        use futures_util::StreamExt;
        let mut entries = doc
            .get_many(iroh_docs::store::Query::key_prefix(b"presence/"))
            .await
            .map_err(|e| e.to_string())?;

        let cutoff = now_secs().saturating_sub(90); // 90s TTL
        let mut presences = Vec::new();
        while let Some(Ok(entry)) = entries.next().await {
            let content = entry.content_bytes(client).await.map_err(|e| e.to_string())?;
            if let Ok(info) = serde_json::from_slice::<PresenceInfo>(&content) {
                if info.timestamp >= cutoff {
                    presences.push(info);
                }
            }
        }
        Ok(presences)
    }).await
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn iso_now() -> String {
    format!("{}Z", now_secs())
}
