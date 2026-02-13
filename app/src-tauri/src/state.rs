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

impl IrohState {
    /// Spawn an async closure on the iroh runtime and await its result.
    /// This avoids deadlocks when Tauri commands run on a different async runtime
    /// than the one the iroh node was created on.
    pub async fn on_rt<F, Fut, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(iroh::node::Node<iroh_blobs::store::fs::Store>, iroh_docs::AuthorId) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = Result<T, String>> + Send + 'static,
        T: Send + 'static,
    {
        let node = self.node.clone();
        let author_id = self.author_id;
        self._runtime
            .spawn(f(node, author_id))
            .await
            .map_err(|e| format!("Task join error: {}", e))?
    }
}
