-- ============================================================
-- 014: Multi-Server (Guild) Support
-- One physical server can host multiple logical SivyCord servers
-- ============================================================

-- Servers table (replaces singleton server_settings for per-server data)
CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT 'Welcome to SivySpeak!',
    icon_url TEXT,
    owner_id TEXT NOT NULL DEFAULT 'system',
    join_sound_url TEXT,
    leave_sound_url TEXT,
    sound_chance INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT
);

-- Server membership: which users belong to which servers
CREATE TABLE IF NOT EXISTS server_members (
    server_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (server_id, user_id)
);

-- Add server_id to channels
ALTER TABLE channels ADD COLUMN server_id TEXT NOT NULL DEFAULT 'default';

-- Add server_id to roles
ALTER TABLE roles ADD COLUMN server_id TEXT NOT NULL DEFAULT 'default';

-- Add server_id to invite_codes
ALTER TABLE invite_codes ADD COLUMN server_id TEXT NOT NULL DEFAULT 'default';

-- Add server_id to bots
ALTER TABLE bots ADD COLUMN server_id TEXT NOT NULL DEFAULT 'default';

-- Add server_id to audit_logs
ALTER TABLE audit_logs ADD COLUMN server_id TEXT NOT NULL DEFAULT 'default';

-- Add server_id to bans
ALTER TABLE bans ADD COLUMN server_id TEXT NOT NULL DEFAULT 'default';

-- Migrate existing server_settings into the default server row
INSERT OR IGNORE INTO servers (id, name, description, join_sound_url, leave_sound_url, sound_chance, owner_id)
SELECT 'default', server_name, server_description, join_sound_url, leave_sound_url, sound_chance, 'system'
FROM server_settings WHERE id = 1;

-- Ensure a default server always exists
INSERT OR IGNORE INTO servers (id, name, description, owner_id)
VALUES ('default', 'SivySpeak Server', 'Welcome to SivySpeak!', 'system');

-- Add all existing users as members of the default server
INSERT OR IGNORE INTO server_members (server_id, user_id)
SELECT 'default', id FROM users;
