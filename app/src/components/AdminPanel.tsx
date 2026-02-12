import { useState, useEffect } from "react";
import { useStore } from "../store";
import type { RoleWithMembers, Role, AuthUser } from "../types";
import { PERMISSIONS, hasPermission } from "../types";

interface AdminPanelProps {
  onClose: () => void;
}

export function AdminPanel({ onClose }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<"roles" | "users" | "server">(
    "roles",
  );
  const servers = useStore((s) => s.servers);
  const activeServerId = useStore((s) => s.activeServerId);
  const currentUser = useStore((s) => s.currentUser);

  const activeServer = servers.find((s) => s.id === activeServerId);

  // Check if user has admin permissions
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!currentUser || !activeServer) return;

    // Fetch user's roles
    fetch(
      `http://${activeServer.config.host}:${activeServer.config.port}/api/users/${currentUser.id}/roles`,
    )
      .then((res) => res.json())
      .then((roles: Role[]) => {
        const maxPerms = Math.max(...roles.map((r) => r.permissions), 0);
        setIsAdmin(hasPermission(maxPerms, PERMISSIONS.MANAGE_ROLES));
      })
      .catch(console.error);
  }, [currentUser, activeServer]);

  if (!activeServer || !currentUser) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-bg-primary rounded-3xl shadow-2xl p-6 max-w-md w-full mx-4">
          <h2 className="text-xl font-bold text-text-primary mb-4">
            Not Connected
          </h2>
          <p className="text-text-secondary mb-6">
            You need to be logged in to access the admin panel.
          </p>
          <button
            onClick={onClose}
            className="w-full py-3 bg-accent text-white rounded-xl font-bold hover:bg-accent/90"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-bg-primary rounded-3xl shadow-2xl p-6 max-w-md w-full mx-4">
          <h2 className="text-xl font-bold text-danger mb-4">Access Denied</h2>
          <p className="text-text-secondary mb-6">
            You don't have permission to access the admin panel.
            <br />
            Required: MANAGE_ROLES permission
          </p>
          <button
            onClick={onClose}
            className="w-full py-3 bg-accent text-white rounded-xl font-bold hover:bg-accent/90"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-bg-primary rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border/50">
          <div>
            <h2 className="text-2xl font-bold text-text-primary">
              🛡️ Admin Panel
            </h2>
            <p className="text-sm text-text-muted mt-1">
              Manage server settings, roles, and users
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-bg-hover rounded-xl transition-colors text-text-muted hover:text-text-primary"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 px-6 pt-4 border-b border-border/30">
          <button
            onClick={() => setActiveTab("roles")}
            className={`px-6 py-3 text-sm font-bold rounded-t-xl transition-all ${
              activeTab === "roles"
                ? "bg-bg-surface text-accent border-b-2 border-accent"
                : "text-text-muted hover:text-text-secondary hover:bg-bg-hover/50"
            }`}
          >
            🎭 Roles
          </button>
          <button
            onClick={() => setActiveTab("users")}
            className={`px-6 py-3 text-sm font-bold rounded-t-xl transition-all ${
              activeTab === "users"
                ? "bg-bg-surface text-accent border-b-2 border-accent"
                : "text-text-muted hover:text-text-secondary hover:bg-bg-hover/50"
            }`}
          >
            👥 Users
          </button>
          <button
            onClick={() => setActiveTab("server")}
            className={`px-6 py-3 text-sm font-bold rounded-t-xl transition-all ${
              activeTab === "server"
                ? "bg-bg-surface text-accent border-b-2 border-accent"
                : "text-text-muted hover:text-text-secondary hover:bg-bg-hover/50"
            }`}
          >
            ⚙️ Server
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "roles" && <RolesTab server={activeServer} />}
          {activeTab === "users" && <UsersTab server={activeServer} />}
          {activeTab === "server" && <ServerTab server={activeServer} />}
        </div>
      </div>
    </div>
  );
}

// ─── Roles Tab ───
function RolesTab({ server }: { server: any }) {
  const [roles, setRoles] = useState<RoleWithMembers[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);

  const fetchRoles = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `http://${server.config.host}:${server.config.port}/api/roles`,
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
                <span className="text-xs text-text-muted font-mono bg-bg-primary px-2 py-1 rounded">
                  {role.permissions}
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

// ─── Users Tab ───
function UsersTab({ server }: { server: any }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [roles, setRoles] = useState<RoleWithMembers[]>([]);
  const [userRoles, setUserRoles] = useState<Map<string, Role[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch roles
        const rolesRes = await fetch(
          `http://${server.config.host}:${server.config.port}/api/roles`,
        );
        const rolesData = await rolesRes.json();
        setRoles(rolesData);

        // Get members from server.members (if available)
        if (server.members) {
          setUsers(server.members);

          // Fetch roles for each user
          const roleMap = new Map<string, Role[]>();
          for (const user of server.members) {
            try {
              const userRolesRes = await fetch(
                `http://${server.config.host}:${server.config.port}/api/users/${user.id}/roles`,
              );
              const userRolesData = await userRolesRes.json();
              roleMap.set(user.id, userRolesData);
            } catch {
              roleMap.set(user.id, []);
            }
          }
          setUserRoles(roleMap);
        }
      } catch (err) {
        console.error("Failed to fetch users:", err);
      }
      setLoading(false);
    };

    fetchData();
  }, [server]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-text-muted">Loading users...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="mb-6">
        <h3 className="text-lg font-bold text-text-primary">Server Members</h3>
        <p className="text-sm text-text-muted">View and manage user roles</p>
      </div>

      <div className="space-y-2">
        {users.map((user) => (
          <div
            key={user.id}
            className="bg-bg-surface rounded-xl p-4 hover:bg-bg-hover transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt=""
                    className="w-10 h-10 rounded-full"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center text-white font-bold">
                    {user.display_name[0].toUpperCase()}
                  </div>
                )}
                <div>
                  <h4 className="font-bold text-text-primary">
                    {user.display_name}
                  </h4>
                  <p className="text-xs text-text-muted">@{user.username}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {(userRoles.get(user.id) || []).map((role) => (
                    <span
                      key={role.id}
                      className="px-2 py-1 text-xs rounded-full"
                      style={{
                        backgroundColor: role.color || "#888",
                        color: "#fff",
                      }}
                    >
                      {role.name}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => setSelectedUser(user.id)}
                  className="px-3 py-1 text-sm bg-bg-primary text-text-secondary hover:text-accent rounded-lg transition-colors"
                >
                  Manage
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {selectedUser && (
        <ManageUserRolesModal
          server={server}
          userId={selectedUser}
          user={users.find((u) => u.id === selectedUser)!}
          availableRoles={roles}
          currentRoles={userRoles.get(selectedUser) || []}
          onClose={() => setSelectedUser(null)}
          onUpdated={() => {
            // Refresh
            setSelectedUser(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Server Tab ───
function ServerTab({ server }: { server: any }) {
  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h3 className="text-lg font-bold text-text-primary">Server Settings</h3>
        <p className="text-sm text-text-muted">
          Configure server-wide settings
        </p>
      </div>

      <div className="bg-bg-surface rounded-xl p-6">
        <h4 className="font-bold text-text-primary mb-4">Server Information</h4>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-text-muted">Server Name:</span>
            <span className="text-text-primary font-mono">
              {server.config.serverName || "Unnamed Server"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Host:</span>
            <span className="text-text-primary font-mono">
              {server.config.host}:{server.config.port}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Invite Code:</span>
            <span className="text-text-primary font-mono">
              {server.config.inviteCode}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-bg-surface rounded-xl p-6">
        <h4 className="font-bold text-text-primary mb-4">Coming Soon</h4>
        <p className="text-sm text-text-muted">
          More server management features will be available here, including:
        </p>
        <ul className="mt-3 space-y-2 text-sm text-text-muted">
          <li>• Server name and description editing</li>
          <li>• Audit log viewer</li>
          <li>• Ban/kick management</li>
          <li>• Invite link management</li>
          <li>• Server statistics</li>
        </ul>
      </div>
    </div>
  );
}

// ─── Create Role Modal ───
function CreateRoleModal({
  server,
  onClose,
  onCreated,
}: {
  server: any;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#5865F2");
  const [permissions, setPermissions] = useState(66560); // default member perms
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
        `http://${server.config.host}:${server.config.port}/api/roles`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${server.config.authToken}`,
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
    } catch (err: any) {
      setError(err.message);
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
              Permissions (numeric)
            </label>
            <input
              type="number"
              value={permissions}
              onChange={(e) => setPermissions(parseInt(e.target.value) || 0)}
              className="w-full px-4 py-3 bg-bg-surface text-text-primary rounded-xl border border-border focus:border-accent focus:outline-none font-mono"
            />
            <p className="text-xs text-text-muted mt-1">
              Default: 66560 (Member), 523263 (Moderator), 1073741824 (Admin)
            </p>
          </div>

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
  server: any;
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
        `http://${server.config.host}:${server.config.port}/api/roles/${role.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${server.config.authToken}`,
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
    } catch (err: any) {
      setError(err.message);
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
        `http://${server.config.host}:${server.config.port}/api/roles/${role.id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${server.config.authToken}`,
          },
        },
      );

      if (!res.ok) throw new Error("Failed to delete role");

      onUpdated();
    } catch (err: any) {
      setError(err.message);
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

          <div>
            <label className="block text-sm font-bold text-text-secondary mb-2">
              Permissions (numeric)
            </label>
            <input
              type="number"
              value={permissions}
              onChange={(e) => setPermissions(parseInt(e.target.value) || 0)}
              className="w-full px-4 py-3 bg-bg-surface text-text-primary rounded-xl border border-border focus:border-accent focus:outline-none font-mono"
            />
          </div>

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

// ─── Manage User Roles Modal ───
function ManageUserRolesModal({
  server,
  userId,
  user,
  availableRoles,
  currentRoles,
  onClose,
  onUpdated,
}: {
  server: any;
  userId: string;
  user: AuthUser;
  availableRoles: RoleWithMembers[];
  currentRoles: Role[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const hasRole = (roleId: string) => currentRoles.some((r) => r.id === roleId);

  const handleToggleRole = async (roleId: string) => {
    setLoading(true);
    setError("");

    try {
      if (hasRole(roleId)) {
        // Remove role
        const res = await fetch(
          `http://${server.config.host}:${server.config.port}/api/users/${userId}/roles/${roleId}`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${server.config.authToken}`,
            },
          },
        );
        if (!res.ok) throw new Error("Failed to remove role");
      } else {
        // Add role
        const res = await fetch(
          `http://${server.config.host}:${server.config.port}/api/roles/assign`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${server.config.authToken}`,
            },
            body: JSON.stringify({
              user_id: userId,
              role_id: roleId,
            }),
          },
        );
        if (!res.ok) throw new Error("Failed to assign role");
      }

      onUpdated();
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-bg-primary rounded-3xl shadow-2xl p-6 max-w-md w-full mx-4">
        <h3 className="text-xl font-bold text-text-primary mb-2">
          Manage Roles
        </h3>
        <p className="text-sm text-text-muted mb-4">
          {user.display_name} (@{user.username})
        </p>

        <div className="space-y-2 mb-6">
          {availableRoles.map((role) => (
            <button
              key={role.id}
              onClick={() => handleToggleRole(role.id)}
              disabled={loading}
              className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                hasRole(role.id)
                  ? "border-accent bg-accent/10"
                  : "border-border/50 bg-bg-surface hover:border-border"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: role.color || "#888" }}
                  />
                  <span className="font-bold text-text-primary">
                    {role.name}
                  </span>
                </div>
                {hasRole(role.id) && (
                  <span className="text-accent text-xl">✓</span>
                )}
              </div>
            </button>
          ))}
        </div>

        {error && (
          <div className="text-danger text-sm bg-danger/10 p-3 rounded-xl mb-4">
            {error}
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full py-3 bg-bg-surface text-text-secondary rounded-xl font-bold hover:bg-bg-hover"
        >
          Close
        </button>
      </div>
    </div>
  );
}
