// ─── Shared Types ───

export interface Channel {
  id: string;
  name: string;
  description: string;
  position: number;
  createdAt: string;
  channel_type: "text" | "voice";
}

export interface Message {
  id: string;
  channelId: string;
  userId: string;
  userName: string;
  avatarUrl?: string | null;
  content: string;
  createdAt: string;
  attachments?: Attachment[];
}

export interface Attachment {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
  url: string;
}

export interface ServerConfig {
  host: string;
  port: number;
  inviteCode: string;
  userId?: string;
  serverName?: string;
  authToken?: string;
  joinSoundUrl?: string | null;
  leaveSoundUrl?: string | null;
  soundChance?: number;
}

export interface ServerEntry {
  id: string;
  config: ServerConfig;
  displayName: string;
  initial: string;
  members?: AuthUser[];
}

export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
}

export interface VoicePeer {
  user_id: string;
  user_name: string;
  channel_id: string;
  is_muted: boolean;
  is_deafened: boolean;
}

// ─── Roles & Permissions ───
export interface Role {
  id: string;
  name: string;
  color: string | null;
  position: number;
  permissions: number;
  created_at: string;
}

export interface RoleWithMembers extends Role {
  member_count: number;
}

export const PERMISSIONS = {
  VIEW_CHANNELS: 1 << 0,
  MANAGE_CHANNELS: 1 << 1,
  MANAGE_ROLES: 1 << 2,
  MANAGE_EMOJIS: 1 << 3,
  VIEW_AUDIT_LOG: 1 << 4,
  MANAGE_SERVER: 1 << 5,
  CREATE_INVITE: 1 << 6,
  KICK_MEMBERS: 1 << 7,
  BAN_MEMBERS: 1 << 8,
  SEND_MESSAGES: 1 << 9,
  SEND_FILES: 1 << 10,
  EMBED_LINKS: 1 << 11,
  ADD_REACTIONS: 1 << 12,
  USE_EMOJIS: 1 << 13,
  MANAGE_MESSAGES: 1 << 14,
  READ_HISTORY: 1 << 15,
  MENTION_EVERYONE: 1 << 16,
  CONNECT: 1 << 17,
  SPEAK: 1 << 18,
  VIDEO: 1 << 19,
  MUTE_MEMBERS: 1 << 20,
  DEAFEN_MEMBERS: 1 << 21,
  MOVE_MEMBERS: 1 << 22,
  USE_VOICE_ACTIVITY: 1 << 23,
  PRIORITY_SPEAKER: 1 << 24,
  ADMINISTRATOR: 1 << 30,
} as const;

export function hasPermission(
  userPerms: number,
  requiredPerm: number,
): boolean {
  // Administrator bypasses all checks
  if (userPerms & PERMISSIONS.ADMINISTRATOR) return true;
  return (userPerms & requiredPerm) !== 0;
}

// ─── WebSocket Messages ───

export type WsClientMessage =
  | { type: "join_channel"; channel_id: string }
  | { type: "leave_channel"; channel_id: string }
  | {
      type: "send_message";
      channel_id: string;
      content: string;
      user_id: string;
      user_name: string;
    }
  | {
      type: "join_voice";
      channel_id: string;
      user_id: string;
      user_name: string;
    }
  | { type: "leave_voice"; channel_id: string; user_id: string }
  | {
      type: "voice_offer";
      channel_id: string;
      target_user_id: string;
      from_user_id: string;
      sdp: string;
    }
  | {
      type: "voice_answer";
      channel_id: string;
      target_user_id: string;
      from_user_id: string;
      sdp: string;
    }
  | {
      type: "ice_candidate";
      channel_id: string;
      target_user_id: string;
      from_user_id: string;
      candidate: string;
    }
  | {
      type: "voice_talking";
      channel_id: string;
      user_id: string;
      talking: boolean;
    }
  | {
      type: "voice_status_update";
      channel_id: string;
      user_id: string;
      is_muted: boolean;
      is_deafened: boolean;
    };

export type WsServerMessage =
  | { type: "identity"; user_id: string }
  | {
      type: "new_message";
      id: string;
      channel_id: string;
      user_id: string;
      user_name: string;
      avatar_url?: string | null;
      content: string;
      created_at: string;
    }
  | {
      type: "user_joined";
      channel_id: string;
      user_id: string;
      user_name: string;
    }
  | {
      type: "user_left";
      channel_id: string;
      user_id: string;
      user_name: string;
    }
  | { type: "error"; message: string }
  | {
      type: "voice_peer_joined";
      channel_id: string;
      user_id: string;
      user_name: string;
    }
  | { type: "voice_peer_left"; channel_id: string; user_id: string }
  | { type: "voice_members"; channel_id: string; members: VoicePeer[] }
  | {
      type: "voice_offer";
      channel_id: string;
      target_user_id: string;
      from_user_id: string;
      sdp: string;
    }
  | {
      type: "voice_answer";
      channel_id: string;
      target_user_id: string;
      from_user_id: string;
      sdp: string;
    }
  | {
      type: "ice_candidate";
      channel_id: string;
      target_user_id: string;
      from_user_id: string;
      candidate: string;
    }
  | {
      type: "voice_talking";
      channel_id: string;
      user_id: string;
      talking: boolean;
    }
  | {
      type: "voice_status_update";
      channel_id: string;
      user_id: string;
      is_muted: boolean;
      is_deafened: boolean;
    }
  | {
      type: "voice_state_sync";
      voice_states: VoicePeer[];
    };

// ─── Connection Token ───

export interface ConnectionToken {
  host: string;
  port: number;
  invite_code: string;
}

export function decodeToken(encoded: string): ConnectionToken {
  const json = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json);
}
