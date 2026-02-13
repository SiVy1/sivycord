use std::str::FromStr;
use crate::state::{IrohState, ChatEntry};
use crate::channels;
use crate::roles;

#[tauri::command]
pub async fn get_node_id(state: tauri::State<'_, IrohState>) -> Result<String, String> {
    Ok(state.node.node_id().to_string())
}

#[tauri::command]
pub async fn create_doc(state: tauri::State<'_, IrohState>) -> Result<String, String> {
    let client = state.node.client();
    let doc = client.docs().create().await.map_err(|e| e.to_string())?;

    // Mark the creator as the owner/admin of this P2P server
    let owner_id = state.node.node_id().to_string();
    doc.set_bytes(
        state.author_id,
        b"meta/owner".to_vec(),
        owner_id.as_bytes().to_vec(),
    )
    .await
    .map_err(|e| e.to_string())?;

    // Create default channels (general text + voice lounge)
    channels::create_default_channels(&state.node, state.author_id, &doc).await?;
    // Create default roles (Member + Admin)
    roles::create_default_roles(state.author_id, &doc).await?;

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
pub async fn get_doc_owner(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
) -> Result<Option<String>, String> {
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
        let content = entry
            .content_bytes(client)
            .await
            .map_err(|e| e.to_string())?;
        return Ok(Some(String::from_utf8_lossy(&content).to_string()));
    }

    Ok(None)
}

#[tauri::command]
pub async fn join_doc(
    state: tauri::State<'_, IrohState>,
    ticket_str: String,
) -> Result<String, String> {
    let ticket = iroh_docs::DocTicket::from_str(&ticket_str).map_err(|e| e.to_string())?;
    let client = state.node.client();
    let doc = client
        .docs()
        .import(ticket)
        .await
        .map_err(|e| e.to_string())?;
    Ok(doc.id().to_string())
}

#[tauri::command]
pub async fn active_docs(state: tauri::State<'_, IrohState>) -> Result<Vec<String>, String> {
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
pub async fn list_entries(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
) -> Result<Vec<ChatEntry>, String> {
    let doc_id = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    let client = state.node.client();
    let doc = client
        .docs()
        .open(doc_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Document {} not found", doc_id))?;

    use futures_util::StreamExt;
    let mut entries_stream = doc
        .get_many(iroh_docs::store::Query::all())
        .await
        .map_err(|e| e.to_string())?;
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
pub async fn send_message(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    message: String,
) -> Result<(), String> {
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

    doc.set_bytes(
        state.author_id,
        key.as_bytes().to_vec(),
        message.as_bytes().to_vec(),
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}
