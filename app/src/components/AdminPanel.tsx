import { useState, useEffect } from "react";
import { useStore } from "../store";
import type { RoleWithMembers, Role, AuthUser } from "../types";
import {
  PERMISSIONS,
  PERMISSION_DEFS,
  PERMISSION_CATEGORIES,
  PERMISSION_PRESETS,
  hasPermission,
  permissionBitsToLabels,
  getApiUrl,
} from "../types";

interface AdminPanelProps {
  onClose: () => void;
}

export function AdminPanel({ onClose }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<
    "roles" | "users" | "server" | "audit" | "invites"
  >("roles");
  const servers = useStore((s) => s.servers);
  const activeServerId = useStore((s) => s.activeServerId);
  const currentUser = useStore((s) => s.currentUser);

  const activeServer = servers.find((s) => s.id === activeServerId);

  // Check if user has admin permissions
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // P2P server: owner is admin
    if (activeServer?.type === "p2p") {
      setIsAdmin(!!activeServer.config.p2p?.isOwner);
      return;
    }

    if (!currentUser || !activeServer || activeServer.type !== "legacy") return;

    const { host, port } = activeServer.config;
    if (!host || !port) return;

    // Fetch user's roles
    fetch(`${getApiUrl(host, port)}/api/users/${currentUser.id}/roles`)
      .then((res) => res.json())
      .then((roles: Role[]) => {
        const maxPerms = Math.max(...roles.map((r) => r.permissions), 0);
        setIsAdmin(hasPermission(maxPerms, PERMISSIONS.MANAGE_ROLES));
      })
      .catch(console.error);
  }, [currentUser, activeServer]);

  if (!activeServer || (activeServer.type === "legacy" && !currentUser)) {
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
          <button
            onClick={() => setActiveTab("invites")}
            className={`px-6 py-3 text-sm font-bold rounded-t-xl transition-all ${
              activeTab === "invites"
                ? "bg-bg-surface text-accent border-b-2 border-accent"
                : "text-text-muted hover:text-text-secondary hover:bg-bg-hover/50"
            }`}
          >
            ✉️ Invites
          </button>
          <button
            onClick={() => setActiveTab("audit")}
            className={`px-6 py-3 text-sm font-bold rounded-t-xl transition-all ${
              activeTab === "audit"
                ? "bg-bg-surface text-accent border-b-2 border-accent"
                : "text-text-muted hover:text-text-secondary hover:bg-bg-hover/50"
            }`}
          >
            📜 Audit Logs
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "roles" && <RolesTab server={activeServer} />}
          {activeTab === "users" && <UsersTab server={activeServer} />}
          {activeTab === "server" && <ServerTab server={activeServer} />}
          {activeTab === "invites" && <InvitesTab server={activeServer} />}
          {activeTab === "audit" && <AuditLogsTab server={activeServer} />}
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
        `${getApiUrl(server.config.host, server.config.port)}/api/roles`,
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

// ─── Users Tab ───
function UsersTab({ server }: { server: any }) {
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

// ─── Server Tab ───
function ServerTab({ server }: { server: any }) {
  const [name, setName] = useState(server.config.serverName || "");
  const [description, setDescription] = useState("");
  const [joinSoundUrl, setJoinSoundUrl] = useState<string | null>(null);
  const [leaveSoundUrl, setLeaveSoundUrl] = useState<string | null>(null);
  const [soundChance, setSoundChance] = useState<number>(100);
  const [stats, setStats] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"join" | "leave" | null>(null);
  const updateServerConfig = useStore((s) => s.updateServerConfig);

  useEffect(() => {
    const baseUrl = getApiUrl(server.config.host, server.config.port);
    fetch(`${baseUrl}/api/server`)
      .then((res) => res.json())
      .then((data) => {
        setName(data.name);
        setDescription(data.description);
        setJoinSoundUrl(data.join_sound_url);
        setLeaveSoundUrl(data.leave_sound_url);
        setSoundChance(data.sound_chance ?? 100);
      })
      .catch(console.error);

    fetch(`${baseUrl}/api/stats`)
      .then((res) => res.json())
      .then(setStats)
      .catch(console.error);
  }, [server]);

  const handleUpdate = async () => {
    setSaving(true);
    const baseUrl = getApiUrl(server.config.host, server.config.port);
    try {
      await fetch(`${baseUrl}/api/server`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${server.config.authToken}`,
        },
        body: JSON.stringify({
          name,
          description,
          join_sound_url: joinSoundUrl,
          leave_sound_url: leaveSoundUrl,
          sound_chance: soundChance,
        }),
      });

      // Update global state immediately
      if (server.id) {
        updateServerConfig(server.id, {
          serverName: name,
          joinSoundUrl: joinSoundUrl,
          leaveSoundUrl: leaveSoundUrl,
          soundChance: soundChance,
        });
      }

      alert("Server settings updated!");
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  };

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "join" | "leave",
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(type);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(
        `${getApiUrl(server.config.host, server.config.port)}/api/uploads`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${server.config.authToken}`,
          },
          body: formData,
        },
      );
      const data = await res.json();
      if (type === "join") setJoinSoundUrl(data.url);
      else setLeaveSoundUrl(data.url);
    } catch (err) {
      console.error("Upload failed", err);
      alert("Upload failed");
    } finally {
      setUploading(null);
    }
  };

  const playPreview = (url: string | null) => {
    if (!url) return;
    const fullUrl = url.startsWith("http")
      ? url
      : `${getApiUrl(server.config.host, server.config.port)}${url}`;
    const audio = new Audio(fullUrl);
    audio.volume = 0.5;
    audio.play().catch(console.error);
  };

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h3 className="text-lg font-bold text-text-primary">Server Settings</h3>
        <p className="text-sm text-text-muted">
          Configure server-wide settings
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Settings Form */}
        <div className="bg-bg-surface rounded-xl p-6 space-y-4">
          <h4 className="font-bold text-text-primary">Server Information</h4>
          <div>
            <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
              Server Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-bg-primary text-text-primary px-4 py-2 rounded-lg border border-border/50 focus:border-accent outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-bg-primary text-text-primary px-4 py-2 rounded-lg border border-border/50 focus:border-accent outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
                Join Sound
              </label>
              <div className="flex flex-col gap-2">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => handleFileUpload(e, "join")}
                  className="hidden"
                  id="join-sound-upload"
                />
                <label
                  htmlFor="join-sound-upload"
                  className={`w-full py-2 px-3 bg-bg-primary border border-border/50 rounded-lg text-xs font-bold text-center cursor-pointer transition-colors ${
                    uploading === "join"
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:bg-bg-hover hover:border-accent/50"
                  }`}
                >
                  {uploading === "join"
                    ? "Uploading..."
                    : "📁 Upload Join Sound"}
                </label>
                {joinSoundUrl && (
                  <div className="flex items-center justify-between bg-bg-primary px-2 py-1 rounded-lg border border-border/30 overflow-hidden">
                    <span className="text-[10px] text-success font-medium truncate max-w-[100px]">
                      ✅ {joinSoundUrl.split("/").pop()}
                    </span>
                    <button
                      onClick={() => playPreview(joinSoundUrl)}
                      className="p-1 hover:bg-bg-hover rounded text-accent transition-colors flex-shrink-0"
                      title="Play Preview"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
                Leave Sound
              </label>
              <div className="flex flex-col gap-2">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => handleFileUpload(e, "leave")}
                  className="hidden"
                  id="leave-sound-upload"
                />
                <label
                  htmlFor="leave-sound-upload"
                  className={`w-full py-2 px-3 bg-bg-primary border border-border/50 rounded-lg text-xs font-bold text-center cursor-pointer transition-colors ${
                    uploading === "leave"
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:bg-bg-hover hover:border-accent/50"
                  }`}
                >
                  {uploading === "leave"
                    ? "Uploading..."
                    : "📁 Upload Leave Sound"}
                </label>
                {leaveSoundUrl && (
                  <div className="flex items-center justify-between bg-bg-primary px-2 py-1 rounded-lg border border-border/30 overflow-hidden">
                    <span className="text-[10px] text-success font-medium truncate max-w-[100px]">
                      ✅ {leaveSoundUrl.split("/").pop()}
                    </span>
                    <button
                      onClick={() => playPreview(leaveSoundUrl)}
                      className="p-1 hover:bg-bg-hover rounded text-accent transition-colors flex-shrink-0"
                      title="Play Preview"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-bg-primary/50 p-4 rounded-xl border border-border/30">
            <div className="flex justify-between mb-2">
              <label className="text-xs font-bold text-text-muted uppercase tracking-wider">
                🎲 Sound Playback Chance
              </label>
              <span className="text-sm font-bold text-accent">
                {soundChance}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={soundChance}
              onChange={(e) => setSoundChance(parseInt(e.target.value))}
              className="w-full h-1.5 bg-bg-surface rounded-lg appearance-none cursor-pointer accent-accent"
            />
            <p className="text-[10px] text-text-muted mt-2">
              Determines how often the custom sounds play. Set to 100% for every
              time.
            </p>
          </div>

          <button
            onClick={handleUpdate}
            disabled={saving || !!uploading}
            className="w-full py-2 bg-accent text-white rounded-lg font-bold hover:bg-accent/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>

        {/* Statistics */}
        <div className="bg-bg-surface rounded-xl p-6">
          <h4 className="font-bold text-text-primary mb-4">
            Server Statistics
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-bg-primary p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-accent">
                {stats?.total_users || 0}
              </div>
              <div className="text-xs text-text-muted">Users</div>
            </div>
            <div className="bg-bg-primary p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-success">
                {stats?.total_messages || 0}
              </div>
              <div className="text-xs text-text-muted">Messages</div>
            </div>
            <div className="bg-bg-primary p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-warning">
                {stats?.total_channels || 0}
              </div>
              <div className="text-xs text-text-muted">Channels</div>
            </div>
            <div className="bg-bg-primary p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-danger">
                {stats?.total_roles || 0}
              </div>
              <div className="text-xs text-text-muted">Roles</div>
            </div>
          </div>
        </div>
      </div>

      {/* Advanced Connection Info */}
      <div className="bg-bg-surface rounded-xl p-6">
        <h4 className="font-bold text-text-primary mb-4">Connection Details</h4>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-text-muted">Host:</span>
            <span className="text-text-primary font-mono">
              {server.config.host}:{server.config.port}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Direct Invite:</span>
            <span className="text-text-primary font-mono text-xs truncate max-w-[300px]">
              {server.config.inviteCode}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Invites Tab ───
function InvitesTab({ server }: { server: any }) {
  const [invites, setInvites] = useState<any[]>([]);

  const fetchInvites = async () => {
    try {
      const res = await fetch(
        `${getApiUrl(server.config.host, server.config.port)}/api/invites`,
      );
      setInvites(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const deleteInvite = async (code: string) => {
    if (!confirm("Are you sure you want to revoke this invite?")) return;
    try {
      await fetch(
        `http://${server.config.host}:${server.config.port}/api/invites/${code}`,
        { method: "DELETE" },
      );
      fetchInvites();
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchInvites();
  }, [server]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-lg font-bold text-text-primary">
            Active Invites
          </h3>
          <p className="text-sm text-text-muted">Manage server access links</p>
        </div>
      </div>

      <div className="bg-bg-surface rounded-2xl overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-primary text-text-muted uppercase text-xs font-bold">
            <tr>
              <th className="px-6 py-4">Code</th>
              <th className="px-6 py-4">Uses</th>
              <th className="px-6 py-4">Max Uses</th>
              <th className="px-6 py-4">Created</th>
              <th className="px-6 py-4">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {invites.map((invite) => (
              <tr
                key={invite.code}
                className="hover:bg-bg-hover transition-colors"
              >
                <td className="px-6 py-4 font-mono text-accent">
                  {invite.code}
                </td>
                <td className="px-6 py-4 font-bold">{invite.uses}</td>
                <td className="px-6 py-4 text-text-muted">
                  {invite.max_uses || "∞"}
                </td>
                <td className="px-6 py-4 text-text-muted">
                  {new Date(invite.created_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-4">
                  <button
                    onClick={() => deleteInvite(invite.code)}
                    className="text-danger hover:underline"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Audit Logs Tab ───
function AuditLogsTab({ server }: { server: any }) {
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    fetch(`http://${server.config.host}:${server.config.port}/api/audit-logs`)
      .then((res) => res.json())
      .then(setLogs);
  }, [server]);

  return (
    <div className="space-y-4">
      <div className="mb-6">
        <h3 className="text-lg font-bold text-text-primary">Audit Logs</h3>
        <p className="text-sm text-text-muted">
          Security and management history
        </p>
      </div>

      <div className="space-y-2">
        {logs.map((log) => (
          <div
            key={log.id}
            className="bg-bg-surface p-4 rounded-xl border border-border/30"
          >
            <div className="flex justify-between items-start">
              <div>
                <span className="font-bold text-accent">{log.user_name}</span>
                <span className="mx-2 text-text-muted">actioned</span>
                <span className="font-bold text-text-primary">
                  {log.action.replace("_", " ")}
                </span>
                {log.target_name && (
                  <>
                    <span className="mx-2 text-text-muted">on</span>
                    <span className="text-text-primary italic">
                      "{log.target_name}"
                    </span>
                  </>
                )}
              </div>
              <span className="text-xs text-text-muted">
                {new Date(log.created_at).toLocaleString()}
              </span>
            </div>
            {log.details && (
              <p className="mt-2 text-xs text-text-muted bg-bg-primary p-2 rounded font-mono">
                {log.details}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Permission Editor (checkbox grid grouped by category) ───
function PermissionEditor({
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
  server: any;
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
