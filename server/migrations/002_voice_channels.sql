-- Add channel_type to channels table
ALTER TABLE channels ADD COLUMN channel_type TEXT NOT NULL DEFAULT 'text';

-- Seed a default voice channel
INSERT OR IGNORE INTO channels (id, name, description, position, channel_type)
VALUES ('00000000-0000-0000-0000-000000000002', 'Voice', 'General voice chat', 1, 'voice');
