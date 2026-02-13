// ─── DID (Decentralized Identity) Types ───

export interface P2PIdentity {
  node_id: string;
  display_name: string;
  /** iroh blob hash for avatar, if set */
  avatar_hash: string | null;
  bio: string | null;
  created_at: string;
}
