import { useState, useEffect } from "react";
import type { RoleWithMembers, Role, ServerEntry } from "../../types";
import {
  PERMISSION_DEFS,
  PERMISSION_CATEGORIES,
  PERMISSION_PRESETS,
  permissionBitsToLabels,
  getApiUrl,
} from "../../types";
import {
  Copy,
  Plus,
  MoreVertical,
  Shield,
  Users,
  Edit2,
  Trash2,
  Check,
  ExternalLink,
} from "lucide-react"; // Icons

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
    <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
      {PERMISSION_CATEGORIES.map((cat) => {
        const perms = PERMISSION_DEFS.filter((d) => d.category === cat.key);
        if (perms.length === 0) return null;
        return (
          <div
            key={cat.key}
            className="bg-bg-tertiary/30 rounded-xl p-3 border border-border/10"
          >
            <h4 className="text-xs font-bold text-accent uppercase tracking-wider mb-2 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
              {cat.label}
            </h4>
            <div className="grid grid-cols-1 gap-1">
              {perms.map((perm) => (
                <label
                  key={perm.key}
                  className="flex items-start gap-3 p-2 rounded-lg hover:bg-bg-hover cursor-pointer group transition-colors"
                >
                  <div className="mt-0.5 relative flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={(value & perm.value) !== 0}
                      onChange={() => toggle(perm.value)}
                      className="peer appearance-none w-5 h-5 rounded-md border-2 border-text-muted/30 checked:bg-accent checked:border-accent transition-all cursor-pointer"
                    />
                    <Check
                      className="w-3.5 h-3.5 text-white absolute opacity-0 peer-checked:opacity-100 pointer-events-none"
                      strokeWidth={3}
                    />
                  </div>
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-text-primary group-hover:text-accent transition-colors">
                      {perm.label}
                    </span>
                    <p className="text-xs text-text-muted leading-tight mt-0.5">
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

// ─── Create/Edit Role Modal ───
// Combined into one component for cleaner code
function RoleModal({
  server,
  role,
  onClose,
  onSaved,
}: {
  server: ServerEntry;
  role?: Role; // If undefined, we are creating
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEditing = !!role;
  const [name, setName] = useState(role?.name || "");
  const [color, setColor] = useState(role?.color || "#5865F2");
  const [permissions, setPermissions] = useState(
    role?.permissions || PERMISSION_PRESETS.MEMBER,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Role name is required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const url = isEditing
        ? `${getApiUrl(server.config.host, server.config.port)}/api/roles/${role.id}`
        : `${getApiUrl(server.config.host, server.config.port)}/api/roles`;

      const method = isEditing ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
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
      });

      if (!res.ok)
        throw new Error(`Failed to ${isEditing ? "update" : "create"} role`);

      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  };

  const handleDelete = async () => {
    if (
      !role ||
      !confirm(`Are you sure you want to delete the role "${role.name}"?`)
    )
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

      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] animate-in fade-in duration-200 p-4">
      <div className="bg-bg-primary rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-border/20">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border/10">
          <h3 className="text-xl font-bold text-text-primary flex items-center gap-3">
            <div
              className="w-4 h-4 rounded-full shadow-sm ring-2 ring-white/10"
              style={{ backgroundColor: color }}
            />
            {isEditing ? "Edit Role" : "Create New Role"}
          </h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-bg-hover rounded-lg text-text-muted hover:text-text-primary transition-colors"
          >
            <ExternalLink className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          {/* Basic Info split */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-bold text-text-secondary uppercase mb-2">
                Role Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Moderator"
                className="w-full px-4 py-3 bg-bg-tertiary text-text-primary rounded-xl border border-border/20 focus:border-accent focus:outline-none transition-all placeholder:text-text-muted/30"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-text-secondary uppercase mb-2">
                Role Color
              </label>
              <div className="flex gap-3">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-12 h-12 rounded-xl cursor-pointer border-0 p-0 overflow-hidden shadow-sm"
                />
                <input
                  type="text"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="flex-1 px-4 py-3 bg-bg-tertiary text-text-primary rounded-xl border border-border/20 focus:border-accent focus:outline-none uppercase font-mono text-sm"
                />
              </div>
            </div>
          </div>

          {/* Presets */}
          <div>
            <label className="block text-xs font-bold text-text-secondary uppercase mb-2">
              Quick Permissions
            </label>
            <div className="flex flex-wrap gap-2">
              {(["MEMBER", "MODERATOR", "ADMIN"] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setPermissions(PERMISSION_PRESETS[preset])}
                  className={`px-4 py-2 text-xs font-bold rounded-lg transition-all border ${
                    permissions === PERMISSION_PRESETS[preset]
                      ? "bg-accent/10 border-accent text-accent"
                      : "bg-bg-tertiary border-transparent text-text-secondary hover:bg-bg-hover hover:border-border/30"
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Standard Permissions */}
          <div>
            <label className="block text-xs font-bold text-text-secondary uppercase mb-2">
              Detailed Permissions
            </label>
            <div className="bg-bg-secondary/50 rounded-xl border border-border/10 p-1">
              <PermissionEditor value={permissions} onChange={setPermissions} />
            </div>
          </div>

          {error && (
            <div className="text-danger text-sm bg-danger/10 p-4 rounded-xl flex items-center gap-2 border border-danger/20">
              <Shield className="w-4 h-4" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border/10 flex items-center justify-between bg-bg-secondary/30">
          {isEditing ? (
            <button
              onClick={handleDelete}
              disabled={loading}
              className="px-4 py-2 text-danger hover:bg-danger/10 rounded-lg text-sm font-bold transition-colors flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete Role
            </button>
          ) : (
            <div /> // Spacer
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2 text-text-secondary hover:text-text-primary hover:underline transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="px-8 py-2 bg-accent text-white rounded-xl font-bold hover:bg-accent/90 disabled:opacity-50 shadow-lg shadow-accent/20 transition-all active:scale-95"
            >
              {loading ? "Saving..." : "Save Changes"}
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
  // Helper state:
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role | undefined>(undefined); // undefined for CREATE, Role for EDIT

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

  const openCreate = () => {
    setSelectedRole(undefined);
    setIsModalOpen(true);
  };

  const openEdit = (role: Role) => {
    setSelectedRole(role);
    setIsModalOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Header Section */}
      <div className="flex items-end justify-between border-b border-border/10 pb-6">
        <div>
          <h3 className="text-2xl font-bold text-text-primary">Server Roles</h3>
          <p className="text-text-muted mt-1 max-w-xl text-sm">
            Use roles to group your server members and assign permissions.
            Members usually have the highest role's color.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-5 py-2.5 bg-accent text-white rounded-xl font-bold hover:bg-accent/90 flex items-center gap-2 shadow-lg shadow-accent/20 transition-all hover:scale-105 active:scale-95"
        >
          <Plus className="w-5 h-5" />
          <span>Create Role</span>
        </button>
      </div>

      {/* Roles Grid */}
      <div className="grid grid-cols-1 gap-3">
        {roles.map((role) => (
          <div
            key={role.id}
            onClick={() => openEdit(role)}
            className="group bg-bg-secondary/40 hover:bg-bg-secondary border border-border/5 rounded-xl p-4 transition-all cursor-pointer hover:border-border/20 hover:shadow-md flex items-center gap-4"
          >
            {/* Drag Handle (Visual Only for now) */}
            <div className="text-text-muted/20 group-hover:text-text-muted transition-colors cursor-grab active:cursor-grabbing">
              <MoreVertical className="w-5 h-5" />
            </div>

            {/* Role Icon/Color */}
            <div className="relative">
              <div
                className="w-10 h-10 rounded-full shadow-sm ring-4 ring-bg-primary group-hover:ring-bg-tertiary transition-all"
                style={{ backgroundColor: role.color || "#888" }}
              />
              <div className="absolute -bottom-1 -right-1 bg-bg-primary rounded-full p-0.5">
                <Shield className="w-4 h-4 text-text-secondary" />
              </div>
            </div>

            {/* Role Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <h4 className="font-bold text-lg text-text-primary group-hover:text-accent transition-colors truncate">
                  {role.name}
                </h4>
                {/* Permission Badges */}
                <div className="hidden sm:flex gap-1">
                  {permissionBitsToLabels(role.permissions)
                    .slice(0, 3)
                    .map((label) => (
                      <span
                        key={label}
                        className="px-2 py-0.5 bg-bg-tertiary text-text-secondary text-[10px] uppercase font-bold rounded-md tracking-wider"
                      >
                        {label}
                      </span>
                    ))}
                  {permissionBitsToLabels(role.permissions).length > 3 && (
                    <span className="px-2 py-0.5 bg-bg-tertiary text-text-muted text-[10px] font-bold rounded-md">
                      +{permissionBitsToLabels(role.permissions).length - 3}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4 mt-1">
                <div className="flex items-center gap-1.5 text-xs text-text-muted">
                  <Users className="w-3.5 h-3.5" />
                  <span>{role.member_count} members</span>
                </div>
                {/* ID for nerds */}
                <div className="hidden group-hover:flex items-center gap-1.5 text-xs text-text-muted/50 font-mono">
                  <Copy className="w-3 h-3" />
                  <span>{role.id}</span>
                </div>
              </div>
            </div>

            {/* Action Button */}
            <button className="opacity-0 group-hover:opacity-100 p-2 bg-bg-tertiary hover:bg-accent hover:text-white rounded-lg transition-all text-text-secondary">
              <Edit2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {isModalOpen && (
        <RoleModal
          server={server}
          role={selectedRole}
          onClose={() => setIsModalOpen(false)}
          onSaved={() => {
            setIsModalOpen(false);
            fetchRoles();
          }}
        />
      )}
    </div>
  );
}
