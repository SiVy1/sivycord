import { useState, useEffect } from "react";
import type { RoleWithMembers, Role, AuthUser, ServerEntry } from "../../types";
import { getApiUrl } from "../../types";
import { Search, Shield, UserX, Ban, Check, X, Plus } from "lucide-react";

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
              "X-Server-Id": server.config.guildId || "default",
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
              "X-Server-Id": server.config.guildId || "default",
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] animate-in fade-in duration-200">
      <div className="bg-bg-primary rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4 border border-border/20">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="text-xl font-bold text-text-primary">
              Manage Roles
            </h3>
            <p className="text-sm text-text-muted">
              {user.display_name} (@{user.username})
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg-hover rounded text-text-muted"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2 mb-6 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
          {availableRoles.map((role) => {
            const isAssigned = hasRole(role.id);
            return (
              <button
                key={role.id}
                onClick={() => handleToggleRole(role.id)}
                disabled={loading}
                className={`w-full p-3 rounded-xl border transition-all text-left flex items-center justify-between group ${
                  isAssigned
                    ? "border-accent/50 bg-accent/10 hover:bg-accent/20"
                    : "border-border/30 bg-bg-surface hover:border-border hover:bg-bg-hover"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: role.color || "#888" }}
                  />
                  <span
                    className={`font-bold ${isAssigned ? "text-text-primary" : "text-text-secondary"}`}
                  >
                    {role.name}
                  </span>
                </div>
                {isAssigned && (
                  <div className="bg-accent text-white rounded-full p-0.5">
                    <Check className="w-3 h-3" />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {error && (
          <div className="text-danger text-sm bg-danger/10 p-3 rounded-xl mb-4 border border-danger/20">
            {error}
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full py-2.5 bg-bg-surface text-text-secondary rounded-xl font-bold hover:bg-bg-hover border border-border/10"
        >
          Done
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
  const [searchQuery, setSearchQuery] = useState("");

  const fetchData = async () => {
    setLoading(true);
    try {
      const rolesRes = await fetch(
        `${getApiUrl(server.config.host, server.config.port)}/api/roles`,
        {
          headers: {
            "X-Server-Id": server.config.guildId || "default",
          },
        },
      );
      const rolesData = await rolesRes.json();
      setRoles(rolesData);

      if (server.members) {
        setUsers(server.members);
        const roleMap = new Map<string, Role[]>();
        // Optimize: verify if we really need to fetch roles for ALL users one by one?
        // Ideally backend should return members with roles.
        // For now, let's stick to existing logic but maybe don't block render on it perfectly?
        // Or just do parallel fetch
        const promises = server.members.map(async (user) => {
          try {
            const userRolesRes = await fetch(
              `${getApiUrl(server.config.host, server.config.port)}/api/users/${user.id}/roles`,
              {
                headers: {
                  "X-Server-Id": server.config.guildId || "default",
                },
              },
            );
            const r = await userRolesRes.json();
            return { id: user.id, roles: r };
          } catch {
            return { id: user.id, roles: [] };
          }
        });

        const results = await Promise.all(promises);
        results.forEach((r) => roleMap.set(r.id, r.roles));
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
        {
          method: "POST",
          headers: {
            "X-Server-Id": server.config.guildId || "default",
          },
        },
      );
      // alert("User kicked!"); // Use toast ideally
      fetchData(); // Refresh list
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
          headers: {
            "Content-Type": "application/json",
            "X-Server-Id": server.config.guildId || "default",
          },
          body: JSON.stringify({ reason }),
        },
      );
      // alert("User banned!");
      fetchData(); // Refresh
    } catch (err) {
      console.error(err);
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.username.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300 h-full flex flex-col">
      {/* Header & Tools */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/10 pb-6 shrink-0">
        <div>
          <h3 className="text-2xl font-bold text-text-primary">
            Server Members
          </h3>
          <p className="text-text-muted text-sm mt-1">
            {users.length} members found
          </p>
        </div>

        <div className="flex items-center gap-2 bg-bg-tertiary rounded-xl px-3 py-2 border border-border/10 focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/20 transition-all w-full md:w-auto">
          <Search className="w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-muted/50 w-full md:w-64"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="flex-1 overflow-hidden rounded-xl border border-border/10 bg-bg-secondary/20 flex flex-col">
        {/* Table Header */}
        <div className="grid grid-cols-12 bg-bg-tertiary/50 p-3 text-xs font-bold text-text-secondary uppercase tracking-wider shrink-0">
          <div className="col-span-5 md:col-span-4 pl-2">User</div>
          <div className="col-span-0 hidden md:flex md:col-span-5">Roles</div>
          <div className="col-span-7 md:col-span-3 text-right pr-4">
            Actions
          </div>
        </div>

        {/* Table Body */}
        <div className="overflow-y-auto custom-scrollbar flex-1">
          {filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-text-muted">
              <p>No members found matching "{searchQuery}"</p>
            </div>
          ) : (
            <div className="divide-y divide-border/5">
              {filteredUsers.map((user) => (
                <div
                  key={user.id}
                  className="grid grid-cols-12 items-center p-3 hover:bg-bg-hover/30 transition-colors group"
                >
                  {/* User Info */}
                  <div className="col-span-5 md:col-span-4 flex items-center gap-3 pl-2">
                    <div className="relative">
                      {user.avatar_url ? (
                        <img
                          src={user.avatar_url}
                          alt=""
                          className="w-9 h-9 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center text-white font-bold text-sm">
                          {user.display_name[0].toUpperCase()}
                        </div>
                      )}
                      {/* Online Status (fake for now) */}
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 border-2 border-bg-primary rounded-full"></div>
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-text-primary text-sm truncate">
                        {user.display_name}
                      </div>
                      <div className="text-xs text-text-muted truncate">
                        @{user.username}
                      </div>
                    </div>
                  </div>

                  {/* Roles */}
                  <div className="col-span-0 hidden md:flex md:col-span-5 flex-wrap gap-1.5 min-h-[24px] items-center">
                    {(userRoles.get(user.id) || []).map((role) => (
                      <span
                        key={role.id}
                        className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-bg-tertiary text-text-secondary border border-border/10 flex items-center gap-1.5"
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: role.color || "#888" }}
                        />
                        {role.name}
                      </span>
                    ))}
                    <button
                      onClick={() => setSelectedUser(user.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-bg-tertiary rounded text-text-muted transition-all"
                      title="Edit Roles"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Actions */}
                  <div className="col-span-7 md:col-span-3 flex justify-end gap-2 pr-2 opacity-50 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setSelectedUser(user.id)}
                      className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors md:hidden"
                    >
                      <Shield className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleKick(user.id)}
                      className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                      title="Kick Member"
                    >
                      <UserX className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleBan(user.id)}
                      className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                      title="Ban Member"
                    >
                      <Ban className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
