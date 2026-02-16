import { useState, useEffect } from "react";
import { useStore } from "../store";
import type { Role } from "../types";
import { PERMISSIONS, hasPermission, getApiUrl } from "../types";
import { AdminSidebar } from "./admin/Sidebar"; // New import
import { RolesTab } from "./admin/RolesTab";
import { UsersTab } from "./admin/UsersTab";
import { ServerTab } from "./admin/ServerTab";
import { InvitesTab, AuditLogsTab } from "./admin/InvitesTab";
import { BotsTab } from "./admin/BotsTab";
import { FederationTab } from "./admin/FederationTab";
import { AnimatePresence, motion } from "framer-motion";

interface AdminPanelProps {
  onClose: () => void;
}

export function AdminPanel({ onClose }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<string>("overview"); // Changed default to generic string
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

  // Handle ESC key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  if (!activeServer || (activeServer.type === "legacy" && !currentUser)) {
    return null; // Or a simpler loading state, main layout handles global auth checks usually
  }

  if (!isAdmin) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
        <div className="bg-bg-primary rounded-3xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center border border-danger/20">
          <h2 className="text-2xl font-bold text-danger mb-2">Access Denied</h2>
          <p className="text-text-muted mb-6">
            You lack the permissions to view this panel.
          </p>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-bg-surface hover:bg-bg-hover text-text-primary rounded-lg font-medium transition-colors border border-border"
          >
            Return
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-10 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-6xl h-full md:h-[85vh] bg-bg-primary rounded-none md:rounded-2xl shadow-2xl flex overflow-hidden border border-border/20">
        {/* Sidebar Navigation */}
        <AdminSidebar
          server={activeServer}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onClose={onClose}
        />

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-bg-primary">
          <div className="flex-1 overflow-y-auto w-full p-8 md:p-12">
            <div className="max-w-4xl mx-auto">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.15 }}
                >
                  {/* Tab Content Mapping */}
                  {activeTab === "overview" && (
                    <ServerTab server={activeServer} />
                  )}
                  {activeTab === "roles" && <RolesTab server={activeServer} />}
                  {activeTab === "users" && <UsersTab server={activeServer} />}
                  {activeTab === "invites" && (
                    <InvitesTab server={activeServer} />
                  )}
                  {activeTab === "audit" && (
                    <AuditLogsTab server={activeServer} />
                  )}
                  {activeTab === "bots" && <BotsTab server={activeServer} />}
                  {activeTab === "federation" && (
                    <FederationTab server={activeServer} />
                  )}

                  {/* Fallback for disabled/placeholder tabs */}
                  {["emojis", "bans"].includes(activeTab) && (
                    <div className="flex flex-col items-center justify-center h-64 text-text-muted border-2 border-dashed border-border/30 rounded-xl">
                      <p className="text-lg font-medium">Coming Soon</p>
                      <p className="text-sm">
                        This feature is not yet implemented.
                      </p>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
