use serde::{Deserialize, Serialize};

// ─── Database Models ───

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub description: String,
    pub position: i64,
    pub created_at: String,
    #[serde(default = "default_channel_type")]
    pub channel_type: String,
}

fn default_channel_type() -> String {
    "text".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Message {
    pub id: String,
    pub channel_id: String,
    pub user_id: String,
    pub user_name: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct InviteCode {
    pub code: String,
    pub created_at: String,
    pub uses: i64,
    pub max_uses: Option<i64>,
}

// ─── API Types ───

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateChannelRequest {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_channel_type")]
    pub channel_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
    pub user_id: String,
    pub user_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JoinRequest {
    pub invite_code: String,
    pub display_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JoinResponse {
    pub user_id: String,
    pub server_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerInfo {
    pub name: String,
    pub channels: usize,
    pub online: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateInviteRequest {
    pub max_uses: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InviteResponse {
    pub code: String,
    pub token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MessagesQuery {
    pub before: Option<String>,
    pub limit: Option<i64>,
}

// ─── WebSocket Types ───

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsClientMessage {
    #[serde(rename = "join_channel")]
    JoinChannel { channel_id: String },
    #[serde(rename = "leave_channel")]
    LeaveChannel { channel_id: String },
    #[serde(rename = "send_message")]
    SendMessage {
        channel_id: String,
        content: String,
        user_id: String,
        user_name: String,
    },
    // ─── Voice signaling ───
    #[serde(rename = "join_voice")]
    JoinVoice {
        channel_id: String,
        user_id: String,
        user_name: String,
    },
    #[serde(rename = "leave_voice")]
    LeaveVoice {
        channel_id: String,
        user_id: String,
    },
    #[serde(rename = "voice_offer")]
    VoiceOffer {
        channel_id: String,
        target_user_id: String,
        from_user_id: String,
        sdp: String,
    },
    #[serde(rename = "voice_answer")]
    VoiceAnswer {
        channel_id: String,
        target_user_id: String,
        from_user_id: String,
        sdp: String,
    },
    #[serde(rename = "ice_candidate")]
    IceCandidate {
        channel_id: String,
        target_user_id: String,
        from_user_id: String,
        candidate: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsServerMessage {
    #[serde(rename = "new_message")]
    NewMessage {
        id: String,
        channel_id: String,
        user_id: String,
        user_name: String,
        content: String,
        created_at: String,
    },
    #[serde(rename = "user_joined")]
    UserJoined {
        channel_id: String,
        user_id: String,
        user_name: String,
    },
    #[serde(rename = "user_left")]
    UserLeft {
        channel_id: String,
        user_id: String,
        user_name: String,
    },
    #[serde(rename = "error")]
    Error { message: String },
    // ─── Voice signaling ───
    #[serde(rename = "voice_peer_joined")]
    VoicePeerJoined {
        channel_id: String,
        user_id: String,
        user_name: String,
    },
    #[serde(rename = "voice_peer_left")]
    VoicePeerLeft {
        channel_id: String,
        user_id: String,
    },
    #[serde(rename = "voice_members")]
    VoiceMembers {
        channel_id: String,
        members: Vec<VoicePeer>,
    },
    #[serde(rename = "voice_offer")]
    VoiceOffer {
        channel_id: String,
        from_user_id: String,
        sdp: String,
    },
    #[serde(rename = "voice_answer")]
    VoiceAnswer {
        channel_id: String,
        from_user_id: String,
        sdp: String,
    },
    #[serde(rename = "ice_candidate")]
    IceCandidate {
        channel_id: String,
        from_user_id: String,
        candidate: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoicePeer {
    pub user_id: String,
    pub user_name: String,
}

// ─── Connection Token ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionToken {
    pub host: String,
    pub port: u16,
    pub invite_code: String,
}
