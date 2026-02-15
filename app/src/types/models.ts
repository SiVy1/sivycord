// ─── Core Data Models ───

export interface Channel {
  id: string;
  name: string;
  description: string;
  position: number;
  createdAt: string;
  channel_type: "text" | "voice";
  encrypted?: boolean;
}

export interface Message {
  id: string;
  channelId: string;
  userId: string;
  userName: string;
  avatarUrl?: string | null;
  content: string;
  createdAt: string;
  editedAt?: string | null;
  replyTo?: string | null;
  repliedMessage?: RepliedMessage | null;
  attachments?: Attachment[];
  isBot?: boolean;
  reactions?: ReactionGroup[];
  pinned_at?: string | null;
  pinned_by?: string | null;
}

export interface ReactionGroup {
  emoji: string;
  count: number;
  user_ids: string[];
}

export interface RepliedMessage {
  id: string;
  content: string;
  userName: string;
  edited_at?: string;
  deleted_at?: string;
  reply_to?: string;
  pinned_at?: string;
  pinned_by?: string;
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
  /** Logical server / guild ID on the physical server (defaults to "default") */
  guildId?: string;
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

// ─── iroh-entry event payload (emitted by Tauri backend) ───
export interface ChatEntry {
  key: string;
  author: string;
  content: string;
}

// ─── Server Stats (from /api/stats) ───
export interface ServerStats {
  total_users: number;
  total_messages: number;
  total_channels: number;
  total_roles: number;
}

// ─── Invite info (from /api/invites) ───
export interface InviteInfo {
  code: string;
  uses: number;
  max_uses: number | null;
  created_at: string;
}

// ─── Audit log entry (from /api/audit-logs) ───
export interface AuditLogEntry {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  target_name: string | null;
  details: string | null;
  created_at: string;
}

// ─── Message data from server API ───
export interface ApiMessage {
  id?: string;
  channel_id?: string;
  user_id?: string;
  user_name?: string;
  avatar_url?: string | null;
  content?: string;
  created_at?: string;
  edited_at?: string | null;
  is_bot?: boolean;
  reply_to?: string | null;
  replied_message?: { id: string; content: string; user_name: string } | null;
  reactions?: ReactionGroup[];
  pinned_at?: string;
  pinned_by?: string;
}

export interface MessageWithReply {
  message: Message;
  replied_message: RepliedMessage | null;
  reactions: ReactionGroup[];
}

// ─── Bots ───
export interface BotInfo {
  id: string;
  name: string;
  avatar_url: string | null;
  owner_id: string;
  token: string;
  permissions: number;
  created_at: string;
}

// ─── Server Member Info (rich data for member list) ───
export interface MemberInfo {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  is_bot: boolean;
  is_online: boolean;
  joined_at: string;
  roles: RoleBrief[];
}

export interface RoleBrief {
  id: string;
  name: string;
  color: string | null;
  position: number;
}

// ─── Webhooks ───
export interface WebhookInfo {
  id: string;
  channel_id: string;
  name: string;
  avatar_url: string | null;
  token: string;
  created_by: string;
  created_at: string;
}

// ─── E2E Encryption ───
export interface UserPublicKey {
  user_id: string;
  public_key: string;
  created_at: string;
}

export interface ChannelKeysResponse {
  channel_id: string;
  encrypted: boolean;
  keys: UserPublicKey[];
}

// ─── Federation ───
export interface FederationPeer {
  id: string;
  name: string;
  host: string;
  port: number;
  status: string;
  direction: string;
  created_at: string;
  last_seen: string | null;
}

export interface FederatedChannel {
  id: string;
  local_channel_id: string;
  peer_id: string;
  remote_channel_id: string;
  created_at: string;
}

export interface FederationStatus {
  peers: FederationPeer[];
  linked_channels: FederatedChannel[];
}

export interface AddPeerResponse {
  peer: FederationPeer;
  shared_secret: string;
}
