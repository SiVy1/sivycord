CREATE TABLE IF NOT EXISTS channel_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    allow BIGINT NOT NULL DEFAULT 0,
    deny BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_channel_overrides_channel_id ON channel_overrides(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_overrides_target_id ON channel_overrides(target_id);
