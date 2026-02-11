-- SiVyCord initial schema

CREATE TABLE IF NOT EXISTS channels (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,
    channel_id  TEXT NOT NULL REFERENCES channels(id),
    user_id     TEXT NOT NULL,
    user_name   TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invite_codes (
    code        TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    uses        INTEGER NOT NULL DEFAULT 0,
    max_uses    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);

-- Seed default channel
INSERT OR IGNORE INTO channels (id, name, description, position)
VALUES ('00000000-0000-0000-0000-000000000001', 'general', 'General discussion', 0);
