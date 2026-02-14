-- Server Federation
CREATE TABLE IF NOT EXISTS federation_peers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    shared_secret TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    direction TEXT NOT NULL DEFAULT 'outgoing',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen TEXT,
    UNIQUE(host, port)
);

-- Channels linked across federated servers
CREATE TABLE IF NOT EXISTS federated_channels (
    id TEXT PRIMARY KEY,
    local_channel_id TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    remote_channel_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (local_channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    FOREIGN KEY (peer_id) REFERENCES federation_peers(id) ON DELETE CASCADE,
    UNIQUE(local_channel_id, peer_id)
);
