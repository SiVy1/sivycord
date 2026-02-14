import { useState } from "react";
import { useStore } from "../store";
import { AddServerModal } from "./AddServerModal";
import { AuthScreen } from "./AuthScreen";
import type { AuthUser, ServerEntry } from "../types";

export function ServerGrid() {
  const servers = useStore((s) => s.servers);
  const setActiveServer = useStore((s) => s.setActiveServer);
  const updateServerAuth = useStore((s) => s.updateServerAuth);
  const setCurrentUser = useStore((s) => s.setCurrentUser);
  const setDisplayName = useStore((s) => s.setDisplayName);

  const [showAddModal, setShowAddModal] = useState(false);
  const [authTarget, setAuthTarget] = useState<ServerEntry | null>(null);

  const handleServerClick = (server: ServerEntry) => {
    if (server.type === "p2p") {
      // P2P servers don't need auth
      setActiveServer(server.id);
      return;
    }

    // Legacy server — check if already authenticated
    if (server.config.authToken) {
      setActiveServer(server.id);
      return;
    }

    // Need authentication
    setAuthTarget(server);
  };

  const handleAuth = (user: AuthUser, token: string) => {
    if (!authTarget) return;
    updateServerAuth(authTarget.id, token, user.id);
    setCurrentUser(user);
    setDisplayName(user.display_name);
    setActiveServer(authTarget.id);
    setAuthTarget(null);
  };

  const handleRemoveServer = (e: React.MouseEvent, serverId: string) => {
    e.stopPropagation();
    useStore.getState().removeServer(serverId);
  };

  return (
    <div className="h-full flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex-shrink-0 px-8 pt-10 pb-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-2">
            <div className="w-12 h-12 rounded-2xl bg-accent/15 flex items-center justify-center shadow-lg shadow-accent/5">
              <svg
                className="w-6 h-6 text-accent"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.75}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-text-primary tracking-tight">
                SivySpeak
              </h1>
              <p className="text-sm text-text-muted">
                Select a server to get started
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {servers.map((server) => (
              <button
                key={server.id}
                onClick={() => handleServerClick(server)}
                className="group relative flex flex-col items-center p-6 bg-bg-secondary border border-border/50 rounded-2xl hover:border-accent/40 hover:shadow-lg hover:shadow-accent/5 transition-all duration-200 cursor-pointer text-center"
              >
                {/* Remove button */}
                <div
                  onClick={(e) => handleRemoveServer(e, server.id)}
                  className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 hover:bg-danger/20 text-text-muted hover:text-danger transition-all cursor-pointer"
                  title="Remove server"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>

                {/* Server icon */}
                <div
                  className={`w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold mb-3 transition-all duration-200 ${
                    server.type === "p2p"
                      ? "bg-accent/15 text-accent group-hover:bg-accent group-hover:text-white"
                      : "bg-bg-surface text-text-secondary group-hover:bg-accent group-hover:text-white"
                  }`}
                >
                  {server.initial}
                </div>

                {/* Server name */}
                <span className="text-sm font-semibold text-text-primary truncate w-full">
                  {server.displayName}
                </span>

                {/* Type badge */}
                <span
                  className={`mt-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    server.type === "p2p"
                      ? "bg-accent/10 text-accent"
                      : "bg-text-muted/10 text-text-muted"
                  }`}
                >
                  {server.type === "p2p" ? "P2P" : "Dedicated"}
                </span>

                {/* Connection info */}
                {server.type === "legacy" && server.config.host && (
                  <span className="mt-1 text-[10px] text-text-muted truncate w-full">
                    {server.config.host}
                    {server.config.port ? `:${server.config.port}` : ""}
                  </span>
                )}

                {/* Auth status indicator */}
                {server.type === "legacy" && (
                  <div className="mt-2 flex items-center gap-1">
                    <div
                      className={`w-1.5 h-1.5 rounded-full ${
                        server.config.authToken
                          ? "bg-success"
                          : "bg-yellow-500"
                      }`}
                    />
                    <span className="text-[10px] text-text-muted">
                      {server.config.authToken ? "Logged in" : "Login required"}
                    </span>
                  </div>
                )}
              </button>
            ))}

            {/* Add Server card */}
            <button
              onClick={() => setShowAddModal(true)}
              className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-border/50 rounded-2xl hover:border-accent/40 hover:bg-accent/5 transition-all duration-200 cursor-pointer min-h-[180px]"
            >
              <div className="w-16 h-16 rounded-2xl bg-bg-surface flex items-center justify-center mb-3 text-text-muted group-hover:text-accent transition-colors">
                <svg
                  className="w-8 h-8"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4.5v15m7.5-7.5h-15"
                  />
                </svg>
              </div>
              <span className="text-sm font-semibold text-text-secondary">
                Add Server
              </span>
              <span className="text-[10px] text-text-muted mt-1">
                P2P or Dedicated
              </span>
            </button>
          </div>

          {/* Empty state */}
          {servers.length === 0 && (
            <div className="text-center mt-12">
              <p className="text-text-muted text-sm">
                You haven't joined any servers yet. Add one to get started!
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Auth overlay for legacy servers */}
      {authTarget && authTarget.config.host && authTarget.config.port && (
        <AuthScreen
          serverHost={authTarget.config.host}
          serverPort={authTarget.config.port}
          onAuth={handleAuth}
        />
      )}

      {showAddModal && (
        <AddServerModal onClose={() => setShowAddModal(false)} />
      )}
    </div>
  );
}
