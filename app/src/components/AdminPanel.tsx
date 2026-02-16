import { useState, useEffect } from "react";
import { useStore } from "../store";
import type { Role } from "../types";
import { PERMISSIONS, hasPermission, getApiUrl } from "../types";
import { RolesTab } from "./admin/RolesTab";
import { UsersTab } from "./admin/UsersTab";
import { ServerTab } from "./admin/ServerTab";
import { InvitesTab, AuditLogsTab } from "./admin/InvitesTab";
import { BotsTab } from "./admin/BotsTab";
import { FederationTab } from "./admin/FederationTab";
import {
  X,
  Shield,
  UserCog,
  Users,
  Settings,
  Mail,
  ClipboardList,
  Bot,
  Globe,
} from "lucide-react";

interface AdminPanelProps {
  onClose: () => void;
}

export function AdminPanel({ onClose }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<
    "roles" | "users" | "server" | "audit" | "invites" | "bots" | "federation"
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
    const guildId = activeServer.config.guildId || "default";
    fetch(`${getApiUrl(host, port)}/api/users/${currentUser.id}/roles`, {
      headers: { "X-Server-Id": guildId },
    })
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
            <h2 className="text-2xl font-bold text-text-primary flex items-center gap-2">
              <Shield className="w-6 h-6 text-accent" />
              Admin Panel
            </h2>
            <p className="text-sm text-text-muted mt-1">
              Manage server settings, roles, and users
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-bg-hover rounded-xl transition-colors text-text-muted hover:text-text-primary"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 px-6 pt-4 border-b border-border/30 overflow-x-auto">
          <button
            onClick={() => setActiveTab("roles")}
            className={`px-4 py-3 text-sm font-bold rounded-t-xl transition-all flex items-center gap-2 flex-shrink-0 ${
              activeTab === "roles"
                ? "bg-bg-surface text-accent border-b-2 border-accent"
                : "text-text-muted hover:text-text-secondary hover:bg-bg-hover/50"
            }`}
          >
            <UserCog className="w-4 h-4" />
            Roles
          </button>
          <button
            onClick={() => setActiveTab("users")}
            className={`px-4 py-3 text-sm font-bold rounded-t-xl transition-all flex items-center gap-2 flex-shrink-0 ${
              activeTab === "users"
                ? "bg-bg-surface text-accent border-b-2 border-accent"
                : "text-text-muted hover:text-text-secondary hover:bg-bg-hover/50"
            }`}
          >
            <Users className="w-4 h-4" />
            Users
          </button>
          <button
            onClick={() => setActiveTab("server")}
            className={`px-4 py-3 text-sm font-bold rounded-t-xl transition-all flex items-center gap-2 flex-shrink-0 ${
              activeTab === "server"
                ? "bg-bg-surface text-accent border-b-2 border-accent"
                : "text-text-muted hover:text-text-secondary hover:bg-bg-hover/50"
            }`}
          >
            <Settings className="w-4 h-4" />
            Server
          </button>
          <button
            onClick={() => setActiveTab("invites")}
            className={`px-4 py-3 text-sm font-bold rounded-t-xl transition-all flex items-center gap-2 flex-shrink-0 ${
              activeTab === "invites"
                ? "bg-bg-surface text-accent border-b-2 border-accent"
                : "text-text-muted hover:text-text-secondary hover:bg-bg-hover/50"
            }`}
          >
            <Mail className="w-4 h-4" />
            Invites
          </button>
          <button
            onClick={() => setActiveTab("audit")}
            className={`px-4 py-3 text-sm font-bold rounded-t-xl transition-all flex items-center gap-2 flex-shrink-0 ${
              activeTab === "audit"
                ? "bg-bg-surface text-accent border-b-2 border-accent"
                : "text-text-muted hover:text-text-secondary hover:bg-bg-hover/50"
            }`}
          >
            <ClipboardList className="w-4 h-4" />
            Audit Logs
          </button>
          {activeServer.type === "legacy" && (
            <button
              onClick={() => setActiveTab("bots")}
              className={`px-4 py-3 text-sm font-bold rounded-t-xl transition-all flex items-center gap-2 flex-shrink-0 ${
                activeTab === "bots"
                  ? "bg-bg-surface text-accent border-b-2 border-accent"
                  : "text-text-muted hover:text-text-secondary hover:bg-bg-hover/50"
              }`}
            >
              <Bot className="w-4 h-4" />
              Bots
            </button>
          )}
          {activeServer.type === "legacy" && (
            <button
              onClick={() => setActiveTab("federation")}
              className={`px-4 py-3 text-sm font-bold rounded-t-xl transition-all flex items-center gap-2 flex-shrink-0 ${
                activeTab === "federation"
                  ? "bg-bg-surface text-accent border-b-2 border-accent"
                  : "text-text-muted hover:text-text-secondary hover:bg-bg-hover/50"
              }`}
            >
              <Globe className="w-4 h-4" />
              Federation
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "roles" && <RolesTab server={activeServer} />}
          {activeTab === "users" && <UsersTab server={activeServer} />}
          {activeTab === "server" && <ServerTab server={activeServer} />}
          {activeTab === "invites" && <InvitesTab server={activeServer} />}
          {activeTab === "audit" && <AuditLogsTab server={activeServer} />}
          {activeTab === "bots" && <BotsTab server={activeServer} />}
          {activeTab === "federation" && (
            <FederationTab server={activeServer} />
          )}
        </div>
      </div>
    </div>
  );
}
