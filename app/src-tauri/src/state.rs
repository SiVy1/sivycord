use serde::Serialize;
use std::sync::Arc;
use iroh_docs::AuthorId;

#[derive(Serialize)]
pub struct SrvResult {
    pub host: String,
    pub port: u16,
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
    pub author: String,
    pub key: String,
    pub content: String,
}
