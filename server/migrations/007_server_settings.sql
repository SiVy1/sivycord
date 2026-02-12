-- Server settings table
CREATE TABLE IF NOT EXISTS server_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1), -- Only one row
    join_sound_url TEXT,
    leave_sound_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Insert default row
INSERT INTO server_settings (id) VALUES (1);
