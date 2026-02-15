// ─── WebSocket Messages ───

import type { VoicePeer } from "./models";

export type WsClientMessage =
  | { type: "join_channel"; channel_id: string }
  | { type: "leave_channel"; channel_id: string }
  | {
      type: "send_message";
      channel_id: string;
      content: string;
      user_id: string;
      user_name: string;
      reply_to?: string;
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
    }
  | {
      type: "edit_message";
      message_id: string;
      content: string;
    }
  | {
      type: "delete_message";
      message_id: string;
      channel_id: string;
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
      is_bot?: boolean;
      reply_to?: string | null;
      replied_message?: {
        id: string;
        content: string;
        user_name: string;
      } | null;
    }
  | {
      type: "message_edited";
      id: string;
      content: string;
      edited_at: string;
    }
  | {
      type: "message_deleted";
      id: string;
      channel_id: string;
    }
  | {
      type: "reaction_add";
      message_id: string;
      channel_id: string;
      user_id: string;
      user_name: string;
      emoji: string;
    }
  | {
      type: "reaction_remove";
      message_id: string;
      channel_id: string;
      user_id: string;
      emoji: string;
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
