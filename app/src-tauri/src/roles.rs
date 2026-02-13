/// P2P Roles — stored in iroh-doc (CRDT) with key structure:
///
///   roles/{role_id}               → JSON { id, name, color, position, permissions }
///   members/{node_id}/roles       → JSON array of role IDs
///
/// Permission bits match the PERMISSION_DEFS in types/permissions.ts.
/// The doc owner (meta/owner) always has ADMINISTRATOR regardless of roles.

use std::str::FromStr;
use serde::{Deserialize, Serialize};
use crate::state::IrohState;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct P2PRole {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub position: u32,
    /// Bitflags, same encoding as PERMISSION_DEFS
    pub permissions: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[allow(dead_code)]
pub struct P2PMemberRoles {
    pub node_id: String,
    pub role_ids: Vec<String>,
}

/// Create or update a role in a P2P server document.
#[tauri::command]
pub async fn set_p2p_role(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    role: P2PRole,
) -> Result<P2PRole, String> {
    let doc = open_doc(&state, &doc_id).await?;

    let key = format!("roles/{}", role.id);
    let json = serde_json::to_string(&role).map_err(|e| e.to_string())?;

    doc.set_bytes(
        state.author_id,
        key.as_bytes().to_vec(),
        json.as_bytes().to_vec(),
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(role)
}

/// Delete a role from a P2P server document.
#[tauri::command]
pub async fn delete_p2p_role(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    role_id: String,
) -> Result<(), String> {
    let doc = open_doc(&state, &doc_id).await?;

    let key = format!("roles/{}", role_id);
    doc.del(state.author_id, key.as_bytes().to_vec())
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// List all roles in a P2P server document.
#[tauri::command]
pub async fn list_p2p_roles(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
) -> Result<Vec<P2PRole>, String> {
    let doc = open_doc(&state, &doc_id).await?;
    let client = state.node.client();

    use futures_util::StreamExt;
    let mut entries = doc
        .get_many(iroh_docs::store::Query::key_prefix(b"roles/"))
        .await
        .map_err(|e| e.to_string())?;

    let mut roles = Vec::new();
    while let Some(Ok(entry)) = entries.next().await {
        let content = entry
            .content_bytes(client)
            .await
            .map_err(|e| e.to_string())?;
        if let Ok(role) = serde_json::from_slice::<P2PRole>(&content) {
            roles.push(role);
        }
    }

    roles.sort_by_key(|r| r.position);
    Ok(roles)
}

/// Assign roles to a member (by their node ID).
#[tauri::command]
pub async fn set_member_roles(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    node_id: String,
    role_ids: Vec<String>,
) -> Result<(), String> {
    let doc = open_doc(&state, &doc_id).await?;

    let key = format!("members/{}/roles", node_id);
    let json = serde_json::to_string(&role_ids).map_err(|e| e.to_string())?;

    doc.set_bytes(
        state.author_id,
        key.as_bytes().to_vec(),
        json.as_bytes().to_vec(),
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Get the role IDs assigned to a member.
#[tauri::command]
pub async fn get_member_roles(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    node_id: String,
) -> Result<Vec<String>, String> {
    let doc = open_doc(&state, &doc_id).await?;
    let client = state.node.client();

    use futures_util::StreamExt;
    let key = format!("members/{}/roles", node_id);
    let mut entries = doc
        .get_many(iroh_docs::store::Query::key_exact(key.as_bytes()))
        .await
        .map_err(|e| e.to_string())?;

    if let Some(Ok(entry)) = entries.next().await {
        let content = entry
            .content_bytes(client)
            .await
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = serde_json::from_slice(&content).unwrap_or_default();
        return Ok(ids);
    }

    Ok(vec![])
}

/// Compute the combined permission bits for a member.
/// Owner always gets full admin (1 << 30).
#[tauri::command]
pub async fn get_member_permissions(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    node_id: String,
) -> Result<u64, String> {
    let doc = open_doc(&state, &doc_id).await?;
    let client = state.node.client();

    // Check if this node is the owner
    {
        use futures_util::StreamExt;
        let mut owner_entries = doc
            .get_many(iroh_docs::store::Query::key_exact(b"meta/owner"))
            .await
            .map_err(|e| e.to_string())?;

        if let Some(Ok(entry)) = owner_entries.next().await {
            let content = entry
                .content_bytes(client)
                .await
                .map_err(|e| e.to_string())?;
            let owner = String::from_utf8_lossy(&content).to_string();
            if owner == node_id {
                return Ok(1 << 30); // ADMINISTRATOR
            }
        }
    }

    // Get member's role IDs
    let role_ids = {
        use futures_util::StreamExt;
        let key = format!("members/{}/roles", node_id);
        let mut entries = doc
            .get_many(iroh_docs::store::Query::key_exact(key.as_bytes()))
            .await
            .map_err(|e| e.to_string())?;

        if let Some(Ok(entry)) = entries.next().await {
            let content = entry
                .content_bytes(client)
                .await
                .map_err(|e| e.to_string())?;
            serde_json::from_slice::<Vec<String>>(&content).unwrap_or_default()
        } else {
            vec![]
        }
    };

    if role_ids.is_empty() {
        // Default member permissions: VIEW_CHANNELS | SEND_MESSAGES | READ_HISTORY | CONNECT | SPEAK
        return Ok((1 << 0) | (1 << 9) | (1 << 15) | (1 << 17) | (1 << 18));
    }

    // Fetch all roles and OR their permissions together
    use futures_util::StreamExt;
    let mut role_entries = doc
        .get_many(iroh_docs::store::Query::key_prefix(b"roles/"))
        .await
        .map_err(|e| e.to_string())?;

    let mut combined: u64 = 0;
    while let Some(Ok(entry)) = role_entries.next().await {
        let content = entry
            .content_bytes(client)
            .await
            .map_err(|e| e.to_string())?;
        if let Ok(role) = serde_json::from_slice::<P2PRole>(&content) {
            if role_ids.contains(&role.id) {
                combined |= role.permissions;
            }
        }
    }

    Ok(combined)
}

/// Create default roles for a new P2P server (Member + Admin).
pub async fn create_default_roles(
    author_id: iroh_docs::AuthorId,
    doc: &iroh::client::docs::Doc,
) -> Result<(), String> {
    let member_role = P2PRole {
        id: "member".to_string(),
        name: "Member".to_string(),
        color: Some("#99AAB5".to_string()),
        position: 0,
        // VIEW_CHANNELS | CREATE_INVITE | SEND_MESSAGES | SEND_FILES | EMBED_LINKS |
        // ADD_REACTIONS | USE_EMOJIS | READ_HISTORY | CONNECT | SPEAK | VIDEO | USE_VOICE_ACTIVITY
        permissions: (1 << 0) | (1 << 6) | (1 << 9) | (1 << 10) | (1 << 11)
            | (1 << 12) | (1 << 13) | (1 << 15) | (1 << 17) | (1 << 18) | (1 << 19) | (1 << 23),
    };
    let admin_role = P2PRole {
        id: "admin".to_string(),
        name: "Admin".to_string(),
        color: Some("#E74C3C".to_string()),
        position: 100,
        permissions: 1 << 30, // ADMINISTRATOR
    };

    for role in [&member_role, &admin_role] {
        let key = format!("roles/{}", role.id);
        let json = serde_json::to_string(role).map_err(|e| e.to_string())?;
        doc.set_bytes(
            author_id,
            key.as_bytes().to_vec(),
            json.as_bytes().to_vec(),
        )
        .await
        .map_err(|e| e.to_string())?;
    }

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
