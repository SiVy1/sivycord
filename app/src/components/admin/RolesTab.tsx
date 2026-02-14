import { useState, useEffect } from "react";
import type { RoleWithMembers, Role, ServerEntry } from "../../types";
import {
  PERMISSION_DEFS,
  PERMISSION_CATEGORIES,
  PERMISSION_PRESETS,
  permissionBitsToLabels,
  getApiUrl,
} from "../../types";

// ─── Permission Editor (checkbox grid grouped by category) ───
export function PermissionEditor({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const toggle = (bit: number) => {
    onChange(value ^ bit);
  };

  return (
    <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
      {PERMISSION_CATEGORIES.map((cat) => {
        const perms = PERMISSION_DEFS.filter((d) => d.category === cat.key);
        if (perms.length === 0) return null;
        return (
          <div key={cat.key}>
            <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-1.5">
              {cat.label}
            </h4>
            <div className="space-y-1">
              {perms.map((perm) => (
                <label
                  key={perm.key}
                  className="flex items-center gap-3 px-3 py-1.5 rounded-lg hover:bg-bg-hover cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    checked={(value & perm.value) !== 0}
                    onChange={() => toggle(perm.value)}
                    className="accent-accent w-4 h-4 rounded"
                  />
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-text-primary">
                      {perm.label}
                    </span>
                    <p className="text-xs text-text-muted leading-tight">
                      {perm.description}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Create Role Modal ───
function CreateRoleModal({
  server,
  onClose,
  onCreated,
}: {
  server: ServerEntry;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#5865F2");
  const [permissions, setPermissions] = useState(PERMISSION_PRESETS.MEMBER);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Role name is required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch(
        `${getApiUrl(server.config.host, server.config.port)}/api/roles`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${server.config.authToken}`,
            "X-Server-Id": server.config.guildId || "default",
          },
          body: JSON.stringify({
            name: name.trim(),
            color,
            permissions,
          }),
        },
      );

      if (!res.ok) throw new Error("Failed to create role");

      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-bg-primary rounded-3xl shadow-2xl p-6 max-w-md w-full mx-4">
        <h3 className="text-xl font-bold text-text-primary mb-4">
          Create New Role
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-text-secondary mb-2">
              Role Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VIP, Moderator, etc."
              className="w-full px-4 py-3 bg-bg-surface text-text-primary rounded-xl border border-border focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-text-secondary mb-2">
              Role Color
            </label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-full h-12 rounded-xl cursor-pointer"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-text-secondary mb-2">
              Preset
            </label>
            <div className="flex gap-2 mb-3">
              {(["MEMBER", "MODERATOR", "ADMIN"] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setPermissions(PERMISSION_PRESETS[preset])}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                    permissions === PERMISSION_PRESETS[preset]
                      ? "bg-accent text-white"
                      : "bg-bg-surface text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <PermissionEditor value={permissions} onChange={setPermissions} />

          {error && (
            <div className="text-danger text-sm bg-danger/10 p-3 rounded-xl">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-3 bg-bg-surface text-text-secondary rounded-xl font-bold hover:bg-bg-hover"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={loading}
              className="flex-1 py-3 bg-accent text-white rounded-xl font-bold hover:bg-accent/90 disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Role Modal ───
function EditRoleModal({
  server,
  role,
  onClose,
  onUpdated,
}: {
  server: ServerEntry;
  role: Role;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color || "#5865F2");
  const [permissions, setPermissions] = useState(role.permissions);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleUpdate = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch(
        `${getApiUrl(server.config.host, server.config.port)}/api/roles/${role.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${server.config.authToken}`,
            "X-Server-Id": server.config.guildId || "default",
          },
          body: JSON.stringify({
            name: name.trim(),
            color,
            permissions,
          }),
        },
      );

      if (!res.ok) throw new Error("Failed to update role");

      onUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete the role "${role.name}"?`))
      return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(
        `${getApiUrl(server.config.host, server.config.port)}/api/roles/${role.id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${server.config.authToken}`,
            "X-Server-Id": server.config.guildId || "default",
          },
        },
      );

      if (!res.ok) throw new Error("Failed to delete role");

      onUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-bg-primary rounded-3xl shadow-2xl p-6 max-w-md w-full mx-4">
        <h3 className="text-xl font-bold text-text-primary mb-4">Edit Role</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-text-secondary mb-2">
              Role Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 bg-bg-surface text-text-primary rounded-xl border border-border focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-text-secondary mb-2">
              Role Color
            </label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-full h-12 rounded-xl cursor-pointer"
            />
          </div>

          <PermissionEditor value={permissions} onChange={setPermissions} />

          {error && (
            <div className="text-danger text-sm bg-danger/10 p-3 rounded-xl">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleDelete}
              disabled={loading}
              className="px-4 py-3 bg-danger/10 text-danger rounded-xl font-bold hover:bg-danger hover:text-white disabled:opacity-50"
            >
              Delete
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-3 bg-bg-surface text-text-secondary rounded-xl font-bold hover:bg-bg-hover"
            >
              Cancel
            </button>
            <button
              onClick={handleUpdate}
              disabled={loading}
              className="flex-1 py-3 bg-accent text-white rounded-xl font-bold hover:bg-accent/90 disabled:opacity-50"
            >
              {loading ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Roles Tab ───
export function RolesTab({ server }: { server: ServerEntry }) {
  const [roles, setRoles] = useState<RoleWithMembers[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);

  const fetchRoles = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${getApiUrl(server.config.host, server.config.port)}/api/roles`,
        {
          headers: {
            "X-Server-Id": server.config.guildId || "default",
          },
        },
      );
      const data = await res.json();
      setRoles(data);
    } catch (err) {
      console.error("Failed to fetch roles:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-text-muted">Loading roles...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-bold text-text-primary">Server Roles</h3>
          <p className="text-sm text-text-muted">
            Manage roles and permissions
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-accent text-white rounded-xl font-bold hover:bg-accent/90 flex items-center gap-2"
        >
          <span>+</span>
          <span>Create Role</span>
        </button>
      </div>

      <div className="space-y-2">
        {roles.map((role) => (
          <div
            key={role.id}
            className="bg-bg-surface rounded-xl p-4 hover:bg-bg-hover transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: role.color || "#888" }}
                />
                <div>
                  <h4 className="font-bold text-text-primary">{role.name}</h4>
                  <p className="text-xs text-text-muted">
                    {role.member_count} members · Position: {role.position}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted bg-bg-primary px-2 py-1 rounded max-w-[200px] truncate" title={permissionBitsToLabels(role.permissions).join(', ')}>
                  {permissionBitsToLabels(role.permissions).slice(0, 3).join(', ')}
                  {permissionBitsToLabels(role.permissions).length > 3 && ` +${permissionBitsToLabels(role.permissions).length - 3}`}
                </span>
                <button
                  onClick={() => setEditingRole(role)}
                  className="px-3 py-1 text-sm bg-bg-primary text-text-secondary hover:text-accent rounded-lg transition-colors"
                >
                  Edit
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showCreate && (
        <CreateRoleModal
          server={server}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            fetchRoles();
          }}
        />
      )}

      {editingRole && (
        <EditRoleModal
          server={server}
          role={editingRole}
          onClose={() => setEditingRole(null)}
          onUpdated={() => {
            setEditingRole(null);
            fetchRoles();
          }}
        />
      )}
    </div>
  );
}
