import { useState, useEffect } from "react";
import type { RoleWithMembers, Role, AuthUser, ServerEntry } from "../../types";
import { getApiUrl } from "../../types";

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
  server: ServerEntry;
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
          `${getApiUrl(server.config.host, server.config.port)}/api/users/${userId}/roles/${roleId}`,
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
          `${getApiUrl(server.config.host, server.config.port)}/api/roles/assign`,
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
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

// ─── Users Tab ───
export function UsersTab({ server }: { server: ServerEntry }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [roles, setRoles] = useState<RoleWithMembers[]>([]);
  const [userRoles, setUserRoles] = useState<Map<string, Role[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const rolesRes = await fetch(
        `${getApiUrl(server.config.host, server.config.port)}/api/roles`,
      );
      const rolesData = await rolesRes.json();
      setRoles(rolesData);

      if (server.members) {
        setUsers(server.members);
        const roleMap = new Map<string, Role[]>();
        for (const user of server.members) {
          try {
            const userRolesRes = await fetch(
              `${getApiUrl(server.config.host, server.config.port)}/api/users/${user.id}/roles`,
            );
            roleMap.set(user.id, await userRolesRes.json());
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

  useEffect(() => {
    fetchData();
  }, [server]);

  const handleKick = async (id: string) => {
    if (!confirm("Are you sure you want to kick this user?")) return;
    try {
      await fetch(
        `${getApiUrl(server.config.host, server.config.port)}/api/members/${id}/kick`,
        { method: "POST" },
      );
      alert("User kicked!");
    } catch (err) {
      console.error(err);
    }
  };

  const handleBan = async (id: string) => {
    const reason = prompt("Reason for ban?");
    if (reason === null) return;
    try {
      await fetch(
        `${getApiUrl(server.config.host, server.config.port)}/api/members/${id}/ban`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );
      alert("User banned!");
    } catch (err) {
      console.error(err);
    }
  };

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
                  Roles
                </button>
                <button
                  onClick={() => handleKick(user.id)}
                  className="px-3 py-1 text-sm bg-danger/10 text-danger hover:bg-danger hover:text-white rounded-lg transition-colors"
                >
                  Kick
                </button>
                <button
                  onClick={() => handleBan(user.id)}
                  className="px-3 py-1 text-sm bg-danger text-white hover:bg-danger/90 rounded-lg transition-colors"
                >
                  Ban
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
            setSelectedUser(null);
            fetchData();
          }}
        />
      )}
    </div>
  );
}
