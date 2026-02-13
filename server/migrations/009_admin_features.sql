-- Add server name and description to server_settings
ALTER TABLE server_settings ADD COLUMN server_name TEXT NOT NULL DEFAULT 'SivySpeak Server';
ALTER TABLE server_settings ADD COLUMN server_description TEXT NOT NULL DEFAULT 'Welcome to SivySpeak!';

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    user_name   TEXT NOT NULL,
    action      TEXT NOT NULL, -- e.g., 'KICK_USER', 'UPDATE_ROLE', 'CREATE_CHANNEL'
    target_id   TEXT,          -- ID of the affected resource
    target_name TEXT,          -- Name of the affected resource for easier reading
    details     TEXT,          -- JSON or string details
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create bans table
CREATE TABLE IF NOT EXISTS bans (
    user_id     TEXT PRIMARY KEY,
    user_name   TEXT NOT NULL,
    reason      TEXT,
    banned_by   TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Create an index for audit logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
