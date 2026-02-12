use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use dashmap::DashMap;
use sqlx::SqlitePool;
use tokio::sync::broadcast;

use crate::models::{VoicePeer, WsServerMessage};

/// Shared application state
#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    /// Per-channel broadcast senders (for text + voice signaling)
    pub channels: Arc<DashMap<String, broadcast::Sender<WsServerMessage>>>,
    /// Number of connected WebSocket clients
    pub online: Arc<AtomicUsize>,
    /// Voice channel members: channel_id -> Vec<VoicePeer>
    pub voice_members: Arc<DashMap<String, Vec<VoicePeer>>>,
    /// JWT signing secret
    pub jwt_secret: String,
}

impl AppState {
    pub fn new(db: SqlitePool, jwt_secret: String) -> Self {
        Self {
            db,
            channels: Arc::new(DashMap::new()),
            online: Arc::new(AtomicUsize::new(0)),
            voice_members: Arc::new(DashMap::new()),
            jwt_secret,
        }
    }

    /// Get or create a broadcast channel for the given channel ID
    pub fn get_channel_tx(&self, channel_id: &str) -> broadcast::Sender<WsServerMessage> {
        self.channels
            .entry(channel_id.to_string())
            .or_insert_with(|| broadcast::channel(256).0)
            .clone()
    }

    pub fn online_count(&self) -> usize {
        self.online.load(Ordering::Relaxed)
    }

    pub fn inc_online(&self) {
        self.online.fetch_add(1, Ordering::Relaxed);
    }

    pub fn dec_online(&self) {
        self.online.fetch_sub(1, Ordering::Relaxed);
    }

    // ─── Voice member tracking ───

    pub fn join_voice(
        &self,
        channel_id: &str,
        user_id: &str,
        user_name: &str,
        is_muted: bool,
        is_deafened: bool,
    ) -> Vec<VoicePeer> {
        let mut members = self
            .voice_members
            .entry(channel_id.to_string())
            .or_default();
        // Remove if already present (re-join)
        members.retain(|p| p.user_id != user_id);
        members.push(VoicePeer {
            user_id: user_id.to_string(),
            user_name: user_name.to_string(),
            is_muted,
            is_deafened,
        });
        members.clone()
    }

    pub fn update_voice_status(
        &self,
        channel_id: &str,
        user_id: &str,
        is_muted: bool,
        is_deafened: bool,
    ) {
        if let Some(mut members) = self.voice_members.get_mut(channel_id) {
            if let Some(peer) = members.iter_mut().find(|p| p.user_id == user_id) {
                peer.is_muted = is_muted;
                peer.is_deafened = is_deafened;
            }
        }
    }

    pub fn leave_voice(&self, channel_id: &str, user_id: &str) {
        if let Some(mut members) = self.voice_members.get_mut(channel_id) {
            members.retain(|p| p.user_id != user_id);
        }
    }

    /// Remove user from ALL voice channels (on disconnect)
    pub fn leave_all_voice(&self, user_id: &str) -> Vec<(String, String)> {
        let mut left_channels = vec![];
        for mut entry in self.voice_members.iter_mut() {
            let before = entry.value().len();
            entry.value_mut().retain(|p| p.user_id != user_id);
            if entry.value().len() < before {
                left_channels.push((entry.key().clone(), user_id.to_string()));
            }
        }
        left_channels
    }

    pub fn get_voice_members(&self, channel_id: &str) -> Vec<VoicePeer> {
        self.voice_members
            .get(channel_id)
            .map(|m| m.clone())
            .unwrap_or_default()
    }
}
