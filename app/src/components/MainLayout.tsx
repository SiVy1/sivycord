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
          key.startsWith("presence/") ||
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

  // P2P presence heartbeat — write presence/{nodeId} every 30s
  useEffect(() => {
    if (!activeServer || activeServer.type !== "p2p") return;
    const docId = activeServer.config.p2p?.namespaceId;
    if (!docId) return;

    const sendHeartbeat = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_presence", { docId });
      } catch (err) {
        console.warn("Presence heartbeat failed:", err);
      }
    };

    // Send immediately, then every 30s
    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 30_000);
    return () => clearInterval(interval);
  }, [activeServerId, activeServer?.type]);

  return (
    <div className="h-full flex">
      {/* Server icons sidebar */}
      <ServerSidebar />

      {/* Channel list + chat area + member panel */}
      <ChannelSidebar />
      <ChatArea
        showMembers={showMembers}
        onToggleMembers={() => setShowMembers((v) => !v)}
      />
      <MemberListPanel visible={showMembers} />
    </div>
  );
}
