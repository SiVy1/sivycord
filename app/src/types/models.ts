// ─── Core Data Models ───

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

export interface P2PServerConfig {
  ticket: string;
  namespaceId: string;
  isOwner?: boolean;
}

export interface ServerConfig {
  host?: string;
  port?: number;
  inviteCode?: string;
  userId?: string;
  serverName?: string;
  authToken?: string;
  joinSoundUrl?: string | null;
  leaveSoundUrl?: string | null;
  soundChance?: number;
  p2p?: P2PServerConfig;
}

export interface ServerEntry {
  id: string;
  type: "legacy" | "p2p";
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
