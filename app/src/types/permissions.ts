// ─── Roles & Permissions ───
//
// SYNC NOTE: Permission bit positions must match server/src/models.rs Permissions bitflags.
// When adding/removing permissions, update BOTH this file and the Rust Permissions struct.
//

export type PermissionCategory = "general" | "text" | "voice" | "advanced";

export interface PermissionDef {
  /** Key matching the PERMISSIONS object, e.g. "VIEW_CHANNELS" */
  key: string;
  /** Bit value, e.g. 1 << 0 */
  value: number;
  /** Human-readable label */
  label: string;
  /** Short description shown in UI */
  description: string;
  /** Category for grouping in the permission editor */
  category: PermissionCategory;
}

/**
 * Single source of truth for all permission definitions.
 * Both the PERMISSIONS lookup object and the UI are derived from this array.
 */
export const PERMISSION_DEFS: PermissionDef[] = [
  // ── General ──
  { key: "VIEW_CHANNELS",    value: 1 << 0,  label: "View Channels",       description: "View text and voice channels",                   category: "general" },
  { key: "MANAGE_CHANNELS",  value: 1 << 1,  label: "Manage Channels",     description: "Create, edit, and delete channels",              category: "general" },
  { key: "MANAGE_ROLES",     value: 1 << 2,  label: "Manage Roles",        description: "Create, edit, and assign roles",                 category: "general" },
  { key: "MANAGE_EMOJIS",    value: 1 << 3,  label: "Manage Emojis",       description: "Upload and delete custom emojis",                category: "general" },
  { key: "VIEW_AUDIT_LOG",   value: 1 << 4,  label: "View Audit Log",      description: "View the server audit log",                      category: "general" },
  { key: "MANAGE_SERVER",    value: 1 << 5,  label: "Manage Server",       description: "Change server name, description, and settings",  category: "general" },
  { key: "CREATE_INVITE",    value: 1 << 6,  label: "Create Invite",       description: "Create invite links to the server",              category: "general" },
  { key: "KICK_MEMBERS",     value: 1 << 7,  label: "Kick Members",        description: "Remove members from the server",                 category: "general" },
  { key: "BAN_MEMBERS",      value: 1 << 8,  label: "Ban Members",         description: "Permanently ban members from the server",        category: "general" },
  // ── Text ──
  { key: "SEND_MESSAGES",    value: 1 << 9,  label: "Send Messages",       description: "Send messages in text channels",                 category: "text" },
  { key: "SEND_FILES",       value: 1 << 10, label: "Send Files",          description: "Upload files and images",                        category: "text" },
  { key: "EMBED_LINKS",      value: 1 << 11, label: "Embed Links",         description: "Links show embedded previews",                   category: "text" },
  { key: "ADD_REACTIONS",    value: 1 << 12, label: "Add Reactions",       description: "Add reactions to messages",                      category: "text" },
  { key: "USE_EMOJIS",       value: 1 << 13, label: "Use Emojis",          description: "Use custom emojis in messages",                  category: "text" },
  { key: "MANAGE_MESSAGES",  value: 1 << 14, label: "Manage Messages",     description: "Delete or pin messages from other users",        category: "text" },
  { key: "READ_HISTORY",     value: 1 << 15, label: "Read History",        description: "View message history",                           category: "text" },
  { key: "MENTION_EVERYONE", value: 1 << 16, label: "Mention Everyone",    description: "Use @everyone and @here mentions",               category: "text" },
  // ── Voice ──
  { key: "CONNECT",            value: 1 << 17, label: "Connect",             description: "Join voice channels",                          category: "voice" },
  { key: "SPEAK",              value: 1 << 18, label: "Speak",               description: "Speak in voice channels",                      category: "voice" },
  { key: "VIDEO",              value: 1 << 19, label: "Video",               description: "Share video in voice channels",                category: "voice" },
  { key: "MUTE_MEMBERS",      value: 1 << 20, label: "Mute Members",        description: "Server-mute other members",                    category: "voice" },
  { key: "DEAFEN_MEMBERS",    value: 1 << 21, label: "Deafen Members",      description: "Server-deafen other members",                  category: "voice" },
  { key: "MOVE_MEMBERS",      value: 1 << 22, label: "Move Members",        description: "Move members between voice channels",          category: "voice" },
  { key: "USE_VOICE_ACTIVITY", value: 1 << 23, label: "Voice Activity",     description: "Use voice activity detection instead of PTT",   category: "voice" },
  { key: "PRIORITY_SPEAKER",  value: 1 << 24, label: "Priority Speaker",    description: "Others' volume is lowered when you speak",      category: "voice" },
  // ── Advanced ──
  { key: "ADMINISTRATOR",     value: 1 << 30, label: "Administrator",       description: "Full access — bypasses all permission checks",  category: "advanced" },
];

/**
 * Flat lookup object for quick permission checks: PERMISSIONS.VIEW_CHANNELS etc.
 * Derived from PERMISSION_DEFS so there's only one place to edit.
 */
export const PERMISSIONS = Object.fromEntries(
  PERMISSION_DEFS.map((d) => [d.key, d.value]),
) as { [K in (typeof PERMISSION_DEFS)[number]["key"]]: number };

/** Category metadata for the permission editor UI */
export const PERMISSION_CATEGORIES: {
  key: PermissionCategory;
  label: string;
}[] = [
  { key: "general",  label: "General" },
  { key: "text",     label: "Text Channels" },
  { key: "voice",    label: "Voice Channels" },
  { key: "advanced", label: "Advanced" },
];

/** Check if a user's combined permission bits include a required permission. */
export function hasPermission(
  userPerms: number,
  requiredPerm: number,
): boolean {
  if (userPerms & PERMISSIONS.ADMINISTRATOR) return true;
  return (userPerms & requiredPerm) !== 0;
}

/** Convert a raw permission bitmask to a list of human-readable labels. */
export function permissionBitsToLabels(bits: number): string[] {
  return PERMISSION_DEFS.filter((d) => (bits & d.value) !== 0).map((d) => d.label);
}

/** Preset permission values for quick role creation. */
export const PERMISSION_PRESETS = {
  MEMBER:    PERMISSION_DEFS.filter((d) =>
    ["VIEW_CHANNELS", "CREATE_INVITE", "SEND_MESSAGES", "SEND_FILES",
     "EMBED_LINKS", "ADD_REACTIONS", "USE_EMOJIS", "READ_HISTORY",
     "CONNECT", "SPEAK", "VIDEO", "USE_VOICE_ACTIVITY"].includes(d.key),
  ).reduce((acc, d) => acc | d.value, 0),

  MODERATOR: PERMISSION_DEFS.filter((d) =>
    ["VIEW_CHANNELS", "MANAGE_CHANNELS", "CREATE_INVITE", "KICK_MEMBERS",
     "SEND_MESSAGES", "SEND_FILES", "EMBED_LINKS", "ADD_REACTIONS",
     "USE_EMOJIS", "MANAGE_MESSAGES", "READ_HISTORY", "CONNECT",
     "SPEAK", "VIDEO", "MUTE_MEMBERS", "USE_VOICE_ACTIVITY"].includes(d.key),
  ).reduce((acc, d) => acc | d.value, 0),

  ADMIN: 1 << 30,
} as const;
