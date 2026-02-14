use serde::{Deserialize, Serialize};

// ─── Re-export entity models for backward compatibility ───
// Route handlers now use entities directly (e.g., entities::channel::Model).
// The types below are kept for API request/response DTOs and non-DB types.

// Aliases to entity models for routes that still reference the old names
pub use crate::entities::channel::Model as Channel;
pub use crate::entities::message::Model as Message;
pub use crate::entities::bot::Model as Bot;
pub use crate::entities::webhook::Model as Webhook;
pub use crate::entities::invite_code::Model as InviteCode;
pub use crate::entities::user_key::Model as UserPublicKey;
pub use crate::entities::federation_peer::Model as FederationPeer;
pub use crate::entities::federated_channel::Model as FederatedChannel;
pub use crate::entities::role::Model as Role;
pub use crate::entities::audit_log::Model as AuditLog;
pub use crate::entities::ban::Model as Ban;
pub use crate::entities::server::Model as Server;
pub use crate::entities::server_member::Model as ServerMember;

// ─── Permissions ───
// SYNC NOTE: Bit positions must match app/src/types.ts PERMISSION_DEFS.
// When adding/removing permissions, update BOTH this file and the frontend.
bitflags::bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct Permissions: i64 {
        // General
        const VIEW_CHANNELS      = 1 << 0;  // 1
        const MANAGE_CHANNELS    = 1 << 1;  // 2
        const MANAGE_ROLES       = 1 << 2;  // 4
        const MANAGE_EMOJIS      = 1 << 3;  // 8
        const VIEW_AUDIT_LOG     = 1 << 4;  // 16
        const MANAGE_SERVER      = 1 << 5;  // 32
        const CREATE_INVITE      = 1 << 6;  // 64
        const KICK_MEMBERS       = 1 << 7;  // 128
        const BAN_MEMBERS        = 1 << 8;  // 256
        
        // Text Channels
        const SEND_MESSAGES      = 1 << 9;  // 512
        const SEND_FILES         = 1 << 10; // 1024
        const EMBED_LINKS        = 1 << 11; // 2048
        const ADD_REACTIONS      = 1 << 12; // 4096
        const USE_EMOJIS         = 1 << 13; // 8192
        const MANAGE_MESSAGES    = 1 << 14; // 16384
        const READ_HISTORY       = 1 << 15; // 32768
        const MENTION_EVERYONE   = 1 << 16; // 65536
        
        // Voice Channels
        const CONNECT            = 1 << 17; // 131072
        const SPEAK              = 1 << 18; // 262144
        const VIDEO              = 1 << 19; // 524288
        const MUTE_MEMBERS       = 1 << 20; // 1048576
        const DEAFEN_MEMBERS     = 1 << 21; // 2097152
        const MOVE_MEMBERS       = 1 << 22; // 4194304
        const USE_VOICE_ACTIVITY = 1 << 23; // 8388608
        const PRIORITY_SPEAKER   = 1 << 24; // 16777216
        
        // Advanced
        const ADMINISTRATOR      = 1 << 30; // 1073741824
    }
}

impl Permissions {
    pub fn default_admin() -> Self {
        Self::ADMINISTRATOR
    }
    
    pub fn default_moderator() -> Self {
        Self::VIEW_CHANNELS
            | Self::MANAGE_CHANNELS
            | Self::CREATE_INVITE
            | Self::KICK_MEMBERS
            | Self::SEND_MESSAGES
            | Self::SEND_FILES
            | Self::EMBED_LINKS
            | Self::ADD_REACTIONS
            | Self::USE_EMOJIS
            | Self::MANAGE_MESSAGES
            | Self::READ_HISTORY
            | Self::CONNECT
            | Self::SPEAK
            | Self::VIDEO
            | Self::MUTE_MEMBERS
            | Self::USE_VOICE_ACTIVITY
    }
    
    pub fn default_member() -> Self {
        Self::VIEW_CHANNELS
            | Self::CREATE_INVITE
            | Self::SEND_MESSAGES
            | Self::SEND_FILES
            | Self::EMBED_LINKS
            | Self::ADD_REACTIONS
            | Self::USE_EMOJIS
            | Self::READ_HISTORY
            | Self::CONNECT
            | Self::SPEAK
            | Self::VIDEO
            | Self::USE_VOICE_ACTIVITY
    }
}

fn default_channel_type() -> String {
    "text".to_string()
}

// Role is re-exported from entities above

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRole {
    pub user_id: String,
    pub role_id: String,
    pub assigned_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleWithMembers {
    #[serde(flatten)]
    pub role: Role,
    pub member_count: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateRoleRequest {
    pub name: String,
    pub color: Option<String>,
    pub permissions: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateRoleRequest {
    pub name: Option<String>,
    pub color: Option<String>,
    pub permissions: Option<i64>,
    pub position: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AssignRoleRequest {
    pub user_id: String,
    pub role_id: String,
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
    pub description: String,
    pub join_sound_url: Option<String>,
    pub leave_sound_url: Option<String>,
    pub sound_chance: i64,
    pub channels: i64,
    pub online: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateServerRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub join_sound_url: Option<String>,
    pub leave_sound_url: Option<String>,
    pub sound_chance: Option<i64>,
}

// AuditLog and Ban are re-exported from entities above

#[derive(Debug, Serialize, Deserialize)]
pub struct BanRequest {
    pub reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerStats {
    pub total_users: i64,
    pub total_messages: i64,
    pub total_channels: i64,
    pub total_roles: i64,
    pub total_invites: i64,
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
    #[serde(rename = "voice_talking")]
    VoiceTalking {
        channel_id: String,
        user_id: String,
        talking: bool,
    },
    #[serde(rename = "voice_status_update")]
    VoiceStatusUpdate {
        channel_id: String,
        user_id: String,
        is_muted: bool,
        is_deafened: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsServerMessage {
    #[serde(rename = "identity")]
    Identity { user_id: String },
    #[serde(rename = "new_message")]
    NewMessage {
        id: String,
        channel_id: String,
        user_id: String,
        user_name: String,
        avatar_url: Option<String>,
        content: String,
        created_at: String,
        #[serde(default)]
        is_bot: bool,
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
    #[serde(rename = "voice_talking")]
    VoiceTalking {
        channel_id: String,
        user_id: String,
        talking: bool,
    },
    #[serde(rename = "voice_status_update")]
    VoiceStatusUpdate {
        channel_id: String,
        user_id: String,
        is_muted: bool,
        is_deafened: bool,
    },
    #[serde(rename = "voice_state_sync")]
    VoiceStateSync {
        voice_states: Vec<VoicePeer>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoicePeer {
    pub user_id: String,
    pub user_name: String,
    pub channel_id: String,
    pub is_muted: bool,
    pub is_deafened: bool,
}

// ─── Multi-Server (Guild) ───

// Server and ServerMember are re-exported from entities above

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateServerRequest {
    pub name: String,
    pub description: Option<String>,
}

// ─── Connection Token ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionToken {
    pub host: String,
    pub port: u16,
    pub invite_code: String,
}

// ─── Member Info (rich member data for member list) ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemberInfo {
    pub user_id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub is_bot: bool,
    pub is_online: bool,
    pub joined_at: String,
    pub roles: Vec<RoleBrief>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleBrief {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub position: i64,
}
