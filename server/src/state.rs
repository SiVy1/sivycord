use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

use dashmap::DashMap;
use sea_orm::DatabaseConnection;
use tokio::sync::broadcast;
use tokio::sync::Mutex;

use crate::models::{VoicePeer, WsServerMessage};

/// Simple per-IP rate limiter
pub struct RateLimiter {
    /// Maps IP → (request count, window start)
    limits: DashMap<String, (u32, Instant)>,
    max_requests: u32,
    window_secs: u64,
}

impl RateLimiter {
    pub fn new(max_requests: u32, window_secs: u64) -> Self {
        Self {
            limits: DashMap::new(),
            max_requests,
            window_secs,
        }
    }

    /// Returns true if the request is allowed, false if rate-limited.
    pub fn check(&self, ip: &str) -> bool {
        let now = Instant::now();
        let mut entry = self.limits.entry(ip.to_string()).or_insert((0, now));
        let (count, window_start) = entry.value_mut();
        if now.duration_since(*window_start).as_secs() >= self.window_secs {
            // Reset window
            *count = 1;
            *window_start = now;
            true
        } else if *count < self.max_requests {
            *count += 1;
            true
        } else {
            false
        }
    }

    /// Periodically clean up old entries (call from a background task)
    pub fn cleanup(&self) {
        let now = Instant::now();
        self.limits.retain(|_, (_, start)| {
            now.duration_since(*start).as_secs() < self.window_secs * 2
        });
    }
}

/// Shared application state
#[derive(Clone)]
pub struct AppState {
    pub db: DatabaseConnection,
    /// Per-channel broadcast senders (for text + voice signaling)
    pub channels: Arc<DashMap<String, broadcast::Sender<WsServerMessage>>>,
    /// Number of connected WebSocket clients
    pub online: Arc<AtomicUsize>,
    /// Set of currently online user IDs (for member list presence)
    pub online_users: Arc<Mutex<HashSet<String>>>,
    /// Voice channel members: channel_id -> Vec<VoicePeer>
    pub voice_members: Arc<DashMap<String, Vec<VoicePeer>>>,
    /// Server-wide broadcast channel (for global presence)
    pub global_tx: broadcast::Sender<WsServerMessage>,
    /// JWT signing secret
    pub jwt_secret: String,
    pub external_host: String,
    pub external_port: u16,
    /// One-time setup key for first admin claim (None = already claimed)
    pub setup_key: Arc<Mutex<Option<String>>>,
    /// Rate limiter for auth endpoints (login/register)
    pub auth_rate_limiter: Arc<RateLimiter>,
    /// last typing event: (channel_id, user_id) -> Instant
    pub typing_limits: Arc<DashMap<(String, String), Instant>>,
    pub is_user_timed_out: Arc<Mutex<HashSet<String>>>, // Set of user IDs currently timed out
}

impl AppState {
    pub fn new(db: DatabaseConnection, jwt_secret: String, external_host: String, external_port: u16) -> Self {
        let (global_tx, _) = broadcast::channel(1024);
        Self {
            db,
            channels: Arc::new(DashMap::new()),
            online: Arc::new(AtomicUsize::new(0)),
            online_users: Arc::new(Mutex::new(HashSet::new())),
            voice_members: Arc::new(DashMap::new()),
            global_tx,
            jwt_secret,
            external_host,
            external_port,
            setup_key: Arc::new(Mutex::new(None)),
            auth_rate_limiter: Arc::new(RateLimiter::new(10, 60)), // 10 req/min per IP
            typing_limits: Arc::new(DashMap::new()),
            is_user_timed_out: Arc::new(Mutex::new(HashSet::new())),
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

    /// Mark a user as online
    pub async fn user_online(&self, user_id: &str) {
        self.online_users.lock().await.insert(user_id.to_string());
    }

    /// Mark a user as offline
    pub async fn user_offline(&self, user_id: &str) {
        self.online_users.lock().await.remove(user_id);
    }

    /// Check if a user is online
    pub async fn is_user_online(&self, user_id: &str) -> bool {
        self.online_users.lock().await.contains(user_id)
    }

    /// Check if a user is timed out
    pub async fn is_user_timed_out(&self, user_id: &str) -> bool {
        self.is_user_timed_out.lock().await.contains(user_id)
    }

    /// Get the set of all online user IDs
    pub async fn get_online_user_ids(&self) -> HashSet<String> {
        self.online_users.lock().await.clone()
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
            channel_id: channel_id.to_string(),
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

    pub fn get_all_voice_members(&self) -> Vec<VoicePeer> {
        let mut all = vec![];
        for entry in self.voice_members.iter() {
            all.extend(entry.value().clone());
        }
        all
    }

    /// Remove broadcast channels that have no active subscribers (WARN-3: prevent memory leak)
    pub fn cleanup_empty_channels(&self) {
        self.channels.retain(|_, tx| tx.receiver_count() > 0);
    }

    /// Check if a user is allowed to send a typing event (5s cooldown)
    pub fn check_typing_limit(&self, channel_id: &str, user_id: &str) -> bool {
        let now = Instant::now();
        let key = (channel_id.to_string(), user_id.to_string());
        
        let mut entry = self.typing_limits.entry(key).or_insert(Instant::now());
        if now.duration_since(*entry.value()).as_secs() >= 5 || now == *entry.value() {
            *entry.value_mut() = now;
            true
        } else {
            false
        }
    }

    /// Periodically clean up old typing limit entries
    pub fn cleanup_typing_limits(&self) {
        let now = Instant::now();
        self.typing_limits.retain(|_, last_time| {
            now.duration_since(*last_time).as_secs() < 30
        });
    }

        
}
