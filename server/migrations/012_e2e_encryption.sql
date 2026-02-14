-- E2E Encryption: public key storage per user
CREATE TABLE IF NOT EXISTS user_keys (
    user_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    key_type TEXT NOT NULL DEFAULT 'x25519',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, key_type),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Channel encryption settings
ALTER TABLE channels ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0;
