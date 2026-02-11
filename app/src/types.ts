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
}

export interface ServerEntry {
  id: string;
  config: ServerConfig;
  displayName: string;
  initial: string;
}

export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export interface VoicePeer {
  user_id: string;
  user_name: string;
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
    };

export type WsServerMessage =
  | {
      type: "new_message";
      id: string;
      channel_id: string;
      user_id: string;
      user_name: string;
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
      from_user_id: string;
      sdp: string;
    }
  | {
      type: "voice_answer";
      channel_id: string;
      from_user_id: string;
      sdp: string;
    }
  | {
      type: "ice_candidate";
      channel_id: string;
      from_user_id: string;
      candidate: string;
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
