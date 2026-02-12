-- Roles table
CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT, -- hex color for role display
    position INTEGER NOT NULL DEFAULT 0, -- higher = more important
    permissions INTEGER NOT NULL DEFAULT 0, -- bitfield
    created_at TEXT NOT NULL
);

-- User roles (many-to-many)
CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    assigned_at TEXT NOT NULL,
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

-- Insert default roles
INSERT INTO roles (id, name, color, position, permissions, created_at)
VALUES 
    ('admin-role', 'Admin', '#ff5555', 100, 2147483647, datetime('now')),
    ('moderator-role', 'Moderator', '#55ff55', 50, 523263, datetime('now')),
    ('member-role', 'Member', '#5555ff', 10, 66560, datetime('now'));

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_roles_position ON roles(position);
