CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE channels ADD COLUMN category_id TEXT REFERENCES categories(id);