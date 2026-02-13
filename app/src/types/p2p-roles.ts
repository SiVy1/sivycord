// ─── P2P Role Types ───

export interface P2PRole {
  id: string;
  name: string;
  color: string | null;
  position: number;
  /** Permission bitflags — same encoding as PERMISSION_DEFS */
  permissions: number;
}

export interface P2PMemberRoles {
  node_id: string;
  role_ids: string[];
}
