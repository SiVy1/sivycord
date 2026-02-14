import { useEffect, useState } from "react";
import { ServerSidebar } from "./ServerSidebar.tsx";
import { ChannelSidebar } from "./ChannelSidebar.tsx";
import { ChatArea } from "./ChatArea.tsx";
import { MemberListPanel } from "./MemberListPanel.tsx";
import { useStore } from "../store";
import { type ChatEntry, getApiUrl } from "../types";

export function MainLayout() {
  const activeServerId = useStore((s) => s.activeServerId);
  const servers = useStore((s) => s.servers);
  const setCurrentUser = useStore((s) => s.setCurrentUser);
  const [showMembers, setShowMembers] = useState(true);

  const activeServer = servers.find((s) => s.id === activeServerId);

  const fetchNodeId = useStore((s) => s.fetchNodeId);
  const addMessage = useStore((s) => s.addMessage);

  // Initialize Iroh
  useEffect(() => {
    fetchNodeId();
  }, [fetchNodeId]);

  // Listen for Iroh messages
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<ChatEntry>("iroh-entry", (event) => {
        const payload = event.payload;
        // Only show actual chat messages, filter out metadata entries
        const key = payload.key;
        if (
          key.startsWith("meta/") ||
          key.startsWith("identity/") ||
          key.startsWith("roles/") ||
          key.startsWith("voice/") ||
          (key.startsWith("channels/") && key.includes("/meta"))
        ) {
          return; // Skip non-message entries
        }

        // Try to parse P2PMessage JSON for proper author/content
        let content = payload.content;
        let userName = payload.author.substring(0, 8);
        let channelId = "p2p";
        try {
          const parsed = JSON.parse(payload.content);
          if (parsed.content) content = parsed.content;
          if (parsed.author) userName = parsed.author;
          if (parsed.channel_id) channelId = parsed.channel_id;
        } catch { /* raw string fallback */ }

        addMessage({
          id: payload.key,
          channelId,
          userId: payload.author,
          userName,
          content,
          createdAt: new Date().toISOString(),
        });
      });
    };

    setupListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, [addMessage]);

  // Auto-fetch profile on server switch if authToken exists
  useEffect(() => {
    if (!activeServer || !activeServer.config.authToken) {
      setCurrentUser(null);
      return;
    }

    const fetchProfile = async () => {
      const { host, port } = activeServer.config;
      if (activeServer.type !== "legacy" || !host || !port) return;
      try {
        const guildId = activeServer.config.guildId || "default";
        const res = await fetch(`${getApiUrl(host, port)}/api/me`, {
          headers: {
            Authorization: `Bearer ${activeServer.config.authToken}`,
            "X-Server-Id": guildId,
          },
        });
        if (res.ok) {
          const user = await res.json();
          setCurrentUser(user);
        } else {
          // Token might be invalid
          setCurrentUser(null);
        }
      } catch (err) {
        console.error("Failed to fetch profile", err);
        setCurrentUser(null);
      }
    };

    fetchProfile();
  }, [activeServerId, activeServer?.config.authToken, setCurrentUser]);

  return (
    <div className="h-full flex">
      {/* Server icons sidebar */}
      <ServerSidebar />

      {/* Channel list + chat area + member panel */}
      {activeServerId ? (
        <>
          <ChannelSidebar />
          <ChatArea
            showMembers={showMembers}
            onToggleMembers={() => setShowMembers((v) => !v)}
          />
          <MemberListPanel visible={showMembers} />
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-bg-primary">
          <div className="text-center px-8">
            <div className="w-20 h-20 rounded-full bg-bg-surface flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-10 h-10 text-text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7m0 0a3 3 0 0 1-3 3m0 3h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Zm-3 6h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-medium text-text-secondary mb-1">
              No server selected
            </h2>
            <p className="text-sm text-text-muted">
              Select a server from the sidebar or add a new one
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
