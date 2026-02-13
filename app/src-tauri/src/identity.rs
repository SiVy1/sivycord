/// DID (Decentralized Identity) — based on iroh's Ed25519 NodeID.
///
/// Each peer's identity is stored in iroh-doc under:
///   identity/{node_id}  → JSON { node_id, display_name, avatar_blob, bio, created_at }
///
/// The NodeID (Ed25519 public key) serves as a permanent decentralized identifier.
/// Display names, avatars, and other profile data are synced via CRDT.
/// Avatar data can be stored as iroh blobs, referenced by hash.

use std::str::FromStr;
use serde::{Deserialize, Serialize};
use crate::state::IrohState;

/// A DID profile stored in the P2P network.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct P2PIdentity {
    pub node_id: String,
    pub display_name: String,
    /// iroh blob hash for avatar, if set
    pub avatar_hash: Option<String>,
    pub bio: Option<String>,
    pub created_at: String,
}

/// Get the current node's DID string (did:key:<base58-ed25519-pubkey>).
#[tauri::command]
pub async fn get_did(state: tauri::State<'_, IrohState>) -> Result<String, String> {
    let node_id = state.node.node_id();
    Ok(format!("did:key:{}", node_id))
}

/// Publish (or update) this node's identity profile to a P2P server document.
#[tauri::command]
pub async fn set_identity(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    display_name: String,
    bio: Option<String>,
) -> Result<P2PIdentity, String> {
    let doc = open_doc(&state, &doc_id).await?;
    let node_id = state.node.node_id().to_string();

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
        state.author_id,
        key.as_bytes().to_vec(),
        json.as_bytes().to_vec(),
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(identity)
}

/// Get the identity profile for a specific node.
#[tauri::command]
pub async fn get_identity(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    node_id: String,
) -> Result<Option<P2PIdentity>, String> {
    let doc = open_doc(&state, &doc_id).await?;
    let client = state.node.client();

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
}

/// List all known identities in a P2P server document.
#[tauri::command]
pub async fn list_identities(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
) -> Result<Vec<P2PIdentity>, String> {
    let doc = open_doc(&state, &doc_id).await?;
    let client = state.node.client();

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
}

/// Set avatar by importing a file as an iroh blob and storing its hash in the identity.
#[tauri::command]
pub async fn set_avatar_blob(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    file_path: String,
) -> Result<P2PIdentity, String> {
    let client = state.node.client();
    let node_id = state.node.node_id().to_string();

    // Import file as a blob
    let path = std::path::PathBuf::from(&file_path);
    if !path.exists() {
        return Err("File not found".to_string());
    }

    let import = client
        .blobs()
        .add_from_path(path, false, iroh_blobs::util::SetTagOption::Auto, iroh::client::blobs::WrapOption::NoWrap)
        .await
        .map_err(|e| e.to_string())?;

    use futures_util::StreamExt;
    // Consume the progress stream to get the final outcome
    let outcome = import
        .finish()
        .await
        .map_err(|e| e.to_string())?;

    let blob_hash = outcome.hash.to_string();

    // Now update identity with avatar hash
    let doc = open_doc(&state, &doc_id).await?;
    let key = format!("identity/{}", node_id);

    // Read existing identity or create new one
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
        state.author_id,
        key.as_bytes().to_vec(),
        json.as_bytes().to_vec(),
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(identity)
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
