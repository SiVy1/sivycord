use std::str::FromStr;
use crate::state::{IrohState, ChatEntry};
use crate::channels;
use crate::roles;

#[tauri::command]
pub async fn get_node_id(state: tauri::State<'_, IrohState>) -> Result<String, String> {
    let id = state.node.node_id().to_string();
    log::info!("[P2P] get_node_id: {}", id);
    Ok(id)
}

#[derive(serde::Serialize)]
pub struct CreateDocResult {
    pub namespace_id: String,
    pub ticket: String,
}

#[tauri::command]
pub async fn create_doc(state: tauri::State<'_, IrohState>) -> Result<CreateDocResult, String> {
    log::info!("[P2P] create_doc: starting");
    let result = state.on_rt(|node, author_id| async move {
        let client = node.client();
        log::info!("[P2P] create_doc: creating new document");
        let doc = client.docs().create().await.map_err(|e| {
            log::error!("[P2P] create_doc: failed to create doc: {}", e);
            e.to_string()
        })?;
        let namespace_id = doc.id().to_string();
        log::info!("[P2P] create_doc: doc created with namespace_id={}", namespace_id);

        let owner_id = node.node_id().to_string();
        doc.set_bytes(
            author_id,
            b"meta/owner".to_vec(),
            owner_id.as_bytes().to_vec(),
        )
        .await
        .map_err(|e| {
            log::error!("[P2P] create_doc: failed to set owner: {}", e);
            e.to_string()
        })?;
        log::info!("[P2P] create_doc: owner set to {}", owner_id);

        channels::create_default_channels(&node, author_id, &doc).await?;
        roles::create_default_roles(author_id, &doc).await?;
        log::info!("[P2P] create_doc: default channels & roles created");

        // Generate a shareable ticket so others can join
        let ticket = doc
            .share(
                iroh::client::docs::ShareMode::Write,
                iroh_base::node_addr::AddrInfoOptions::RelayAndAddresses,
            )
            .await
            .map_err(|e| {
                log::error!("[P2P] create_doc: failed to generate ticket: {}", e);
                e.to_string()
            })?;
        let ticket_str = ticket.to_string();
        log::info!("[P2P] create_doc: ticket generated (len={})", ticket_str.len());

        Ok(CreateDocResult {
            namespace_id,
            ticket: ticket_str,
        })
    }).await;
    match &result {
        Ok(r) => log::info!("[P2P] create_doc: success ns={}", r.namespace_id),
        Err(e) => log::error!("[P2P] create_doc: failed: {}", e),
    }
    result
}

/// Get a shareable ticket for an existing doc.
#[tauri::command]
pub async fn get_doc_ticket(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
) -> Result<String, String> {
    log::info!("[P2P] get_doc_ticket: doc_id={}", doc_id);
    let doc_id_parsed = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| {
        log::error!("[P2P] get_doc_ticket: invalid doc_id: {}", e);
        e.to_string()
    })?;
    state.on_rt(move |node, _author_id| async move {
        let client = node.client();
        let doc = client
            .docs()
            .open(doc_id_parsed)
            .await
            .map_err(|e| {
                log::error!("[P2P] get_doc_ticket: failed to open doc: {}", e);
                e.to_string()
            })?
            .ok_or_else(|| {
                log::error!("[P2P] get_doc_ticket: document not found");
                "Document not found".to_string()
            })?;

        log::info!("[P2P] get_doc_ticket: generating share ticket");
        let ticket = doc
            .share(
                iroh::client::docs::ShareMode::Write,
                iroh_base::node_addr::AddrInfoOptions::RelayAndAddresses,
            )
            .await
            .map_err(|e| {
                log::error!("[P2P] get_doc_ticket: share failed: {}", e);
                e.to_string()
            })?;
        let ticket_str = ticket.to_string();
        log::info!("[P2P] get_doc_ticket: ticket generated (len={})", ticket_str.len());
        Ok(ticket_str)
    }).await
}

#[tauri::command]
pub async fn get_doc_owner(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
) -> Result<Option<String>, String> {
    let doc_id = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    state.on_rt(move |node, _author_id| async move {
        let client = node.client();
        let doc = client
            .docs()
            .open(doc_id)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Document not found".to_string())?;

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
    }).await
}

#[tauri::command]
pub async fn join_doc(
    state: tauri::State<'_, IrohState>,
    ticket_str: String,
) -> Result<String, String> {
    log::info!("[P2P] join_doc: parsing ticket (len={})", ticket_str.len());
    let ticket = iroh_docs::DocTicket::from_str(&ticket_str).map_err(|e| {
        log::error!("[P2P] join_doc: invalid ticket: {}", e);
        e.to_string()
    })?;
    log::info!("[P2P] join_doc: ticket parsed OK, importing doc...");
    let result = state.on_rt(move |node, _author_id| async move {
        let client = node.client();
        log::info!("[P2P] join_doc: calling docs().import()");
        let doc = client
            .docs()
            .import(ticket)
            .await
            .map_err(|e| {
                log::error!("[P2P] join_doc: import failed: {}", e);
                e.to_string()
            })?;
        let ns_id = doc.id().to_string();
        log::info!("[P2P] join_doc: import succeeded, namespace_id={}", ns_id);
        Ok(ns_id)
    }).await;
    match &result {
        Ok(ns) => log::info!("[P2P] join_doc: completed successfully, ns={}", ns),
        Err(e) => log::error!("[P2P] join_doc: failed: {}", e),
    }
    result
}

#[tauri::command]
pub async fn active_docs(state: tauri::State<'_, IrohState>) -> Result<Vec<String>, String> {
    state.on_rt(|node, _author_id| async move {
        use futures_util::StreamExt;
        let client = node.client();
        let docs_stream = client.docs().list().await.map_err(|e| e.to_string())?;
        let ids: Vec<String> = docs_stream
            .filter_map(|r| async { r.ok().map(|(ns, _)| ns.to_string()) })
            .collect()
            .await;
        Ok(ids)
    }).await
}

#[tauri::command]
pub async fn list_entries(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
) -> Result<Vec<ChatEntry>, String> {
    let doc_id = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    state.on_rt(move |node, _author_id| async move {
        let client = node.client();
        let doc = client
            .docs()
            .open(doc_id)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Document not found".to_string())?;

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
    }).await
}

#[tauri::command]
pub async fn send_message(
    state: tauri::State<'_, IrohState>,
    doc_id: String,
    message: String,
) -> Result<(), String> {
    let doc_id = iroh_docs::NamespaceId::from_str(&doc_id).map_err(|e| e.to_string())?;
    state.on_rt(move |node, author_id| async move {
        let client = node.client();
        let doc = client
            .docs()
            .open(doc_id)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Document not found".to_string())?;

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();

        let key = format!("chat/{}", timestamp);

        doc.set_bytes(
            author_id,
            key.as_bytes().to_vec(),
            message.as_bytes().to_vec(),
        )
        .await
        .map_err(|e| e.to_string())?;

        Ok(())
    }).await
}
