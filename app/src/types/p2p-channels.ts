// ─── P2P Channel Types ───

export interface P2PChannel {
  id: string;
  name: string;
  channel_type: "text" | "voice";
  position: number;
  created_at: string;
}

export interface P2PMessage {
  author: string;
  author_node: string;
  content: string;
  timestamp: string;
  channel_id: string;
}
