import { useEffect, useRef, useState, useCallback } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useStore } from "../store";
import { EmojiPicker } from "./EmojiPicker";
import { ScreenShareView } from "./ScreenShareView";
import { MessageContent, formatTime, formatFileSize } from "./MessageContent";
import {
  type WsClientMessage,
  type WsServerMessage,
  type ChatEntry,
  type ApiMessage,
  type ChannelKeysResponse,
  getApiUrl,
  getWsUrl,
} from "../types";
import type { ChannelParticipantKey } from "../lib/crypto";
import {
  generateKeyPair,
  hasLocalKeyPair,
  getLocalPublicKey,
  encryptChannelMessage,
  decryptChannelMessage,
  isChannelEncrypted as isMsgChannelEncrypted,
} from "../lib/crypto";

const MAX_MESSAGE_LENGTH = 2000;
const WS_RECONNECT_DELAY = 2000;
const WS_MAX_RETRIES = 10;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MESSAGES_PER_PAGE = 50;

interface ChatAreaProps {
  showMembers?: boolean;
  onToggleMembers?: () => void;
}

export function ChatArea({ showMembers, onToggleMembers }: ChatAreaProps = {}) {
  const activeServerId = useStore((s) => s.activeServerId);
  const servers = useStore((s) => s.servers);
  const activeChannelId = useStore((s) => s.activeChannelId);
  const channels = useStore((s) => s.channels);
  const messages = useStore((s) => s.messages);
  const setMessages = useStore((s) => s.setMessages);
  const addMessage = useStore((s) => s.addMessage);
  const prependMessages = useStore((s) => s.prependMessages);
  const hasMoreMessages = useStore((s) => s.hasMoreMessages);
  const isLoadingMore = useStore((s) => s.isLoadingMore);
  const setHasMoreMessages = useStore((s) => s.setHasMoreMessages);
  const setIsLoadingMore = useStore((s) => s.setIsLoadingMore);
  const displayName = useStore((s) => s.displayName);
  const screenShares = useStore((s) => s.screenShares);
  const removeScreenShare = useStore((s) => s.removeScreenShare);
  const voiceMembers = useStore((s) => s.voiceMembers);

  const [input, setInput] = useState("");
  const [showStreams, setShowStreams] = useState(true);
  const [wsStatus, setWsStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("disconnected");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const prevChannelRef = useRef<string | null>(null);
  const retriesRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenMsgIds = useRef<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeServer = servers.find((s) => s.id === activeServerId);
  const activeChannel = channels.find((c) => c.id === activeChannelId);
  const isAuthenticated = !!activeServer?.config.authToken;

  // E2E encryption state
  const [e2eEnabled, setE2eEnabled] = useState(false);
  const [e2eReady, setE2eReady] = useState(false);
  const [, setChannelKeys] = useState<ChannelParticipantKey[]>([]);
  const channelKeysRef = useRef<ChannelParticipantKey[]>([]);

  // Scroll to bottom on new messages only if already at bottom
  useEffect(() => {
    if (atBottom && messages.length > 0) {
      // Small delay so Virtuoso finishes rendering
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({
          index: messages.length - 1,
          align: "end",
          behavior: "smooth",
        });
      });
    }
  }, [messages.length]);

  // Fetch message history
  useEffect(() => {
    if (!activeServer || !activeChannelId) return;
    seenMsgIds.current.clear();

    if (activeServer.type === "p2p") {
      const fetchP2PHistory = async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const namespaceId = activeServer.config.p2p?.namespaceId;
          if (!namespaceId) return;
          const entries = await invoke<ChatEntry[]>("list_p2p_channel_messages", {
            docId: namespaceId,
            channelId: activeChannelId,
          });

          const mapped = entries.map((e) => {
            // Try to parse the content as JSON (P2PMessage format)
            let content = e.content;
            let userName = e.author.substring(0, 8);
            try {
              const parsed = JSON.parse(e.content);
              if (parsed.content) content = parsed.content;
              if (parsed.author) userName = parsed.author;
            } catch { /* raw string fallback */ }
            return {
              id: e.key,
              channelId: activeChannelId,
              userId: e.author,
              userName,
              content,
              createdAt: new Date().toISOString(),
            };
          });
          mapped.forEach((m) => seenMsgIds.current.add(m.id));
          setMessages(mapped);
        } catch (err) {
          console.error("Failed to fetch P2P history", err);
          setMessages([]);
        }
      };
      fetchP2PHistory();
      return;
    }

    const { host, port } = activeServer.config;
    if (!host || !port) return;
    const baseUrl = getApiUrl(host, port);

    setHasMoreMessages(true);
    const controller = new AbortController();
    fetch(`${baseUrl}/api/channels/${activeChannelId}/messages?limit=${MESSAGES_PER_PAGE}`, {
      signal: controller.signal,
      headers: { "X-Server-Id": activeServer.config.guildId || "default" },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: ApiMessage[]) => {
        if (!Array.isArray(data)) {
          setMessages([]);
          setHasMoreMessages(false);
          return;
        }
        const mapped = data.map((m) => ({
          id: m.id || crypto.randomUUID(),
          channelId: m.channel_id || "",
          userId: m.user_id || "",
          userName: m.user_name || "Unknown",
          content: m.content || "",
          createdAt: m.created_at || "",
        }));
        mapped.forEach((m) => seenMsgIds.current.add(m.id));
        setMessages(mapped);
        // If we got fewer messages than requested, there are no more
        if (mapped.length < MESSAGES_PER_PAGE) {
          setHasMoreMessages(false);
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error("Failed to fetch messages:", err);
          setMessages([]);
        }
      });

    return () => controller.abort();
  }, [activeChannelId, activeServer?.id]);

  // E2E encryption setup — detect encrypted channel and fetch/upload keys
  useEffect(() => {
    setE2eEnabled(false);
    setE2eReady(false);
    setChannelKeys([]);
    channelKeysRef.current = [];

    if (!activeServer || activeServer.type === "p2p" || !activeChannelId || !isAuthenticated) return;
    if (!activeChannel?.encrypted) return;

    const { host, port, authToken, userId } = activeServer.config;
    if (!host || !port || !authToken || !userId) return;

    const baseUrl = getApiUrl(host, port);
    const guildId = activeServer.config.guildId || "default";
    let cancelled = false;

    (async () => {
      try {
        // Ensure we have a local key pair
        const haveKey = await hasLocalKeyPair(userId);
        if (!haveKey) {
          const pubKey = await generateKeyPair(userId);
          // Upload our public key to the server
          await fetch(`${baseUrl}/api/keys`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`,
              "X-Server-Id": guildId,
            },
            body: JSON.stringify({ public_key: pubKey }),
          });
        } else {
          // Check if key is already on the server; upload if not
          const res = await fetch(`${baseUrl}/api/keys/${userId}`, {
            headers: { "X-Server-Id": guildId },
          });
          if (res.status === 404) {
            const pubKey = await getLocalPublicKey(userId);
            if (pubKey) {
              await fetch(`${baseUrl}/api/keys`, {
                method: "PUT",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${authToken}`,
                  "X-Server-Id": guildId,
                },
                body: JSON.stringify({ public_key: pubKey }),
              });
            }
          }
        }

        // Fetch all participant keys for this channel
        const keysRes = await fetch(`${baseUrl}/api/channels/${activeChannelId}/keys`, {
          headers: { Authorization: `Bearer ${authToken}`, "X-Server-Id": guildId },
        });
        if (!keysRes.ok) throw new Error("Failed to fetch channel keys");

        const keysData: ChannelKeysResponse = await keysRes.json();
        if (cancelled) return;

        const participants: ChannelParticipantKey[] = keysData.keys.map((k) => ({
          user_id: k.user_id,
          public_key: k.public_key,
        }));

        setChannelKeys(participants);
        channelKeysRef.current = participants;
        setE2eEnabled(true);
        setE2eReady(true);
      } catch (err) {
        console.error("E2E setup failed:", err);
        setE2eEnabled(false);
        setE2eReady(false);
      }
    })();

    return () => { cancelled = true; };
  }, [activeChannelId, activeServer?.id, activeChannel?.encrypted]);

  // WebSocket connection with auto-reconnect
  const connectWs = useCallback(() => {
    if (!activeServer) return;
    const { host, port, authToken } = activeServer.config;

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    if (!host || !port) return;
    setWsStatus("connecting");
    const wsBaseUrl = getWsUrl(host, port);
    const guildId = activeServer.config.guildId || "default";
    const wsUrl = authToken
      ? `${wsBaseUrl}/ws?token=${encodeURIComponent(authToken)}&server_id=${encodeURIComponent(guildId)}`
      : `${wsBaseUrl}/ws?server_id=${encodeURIComponent(guildId)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus("connected");
      retriesRef.current = 0;

      if (activeChannelId) {
        const msg: WsClientMessage = {
          type: "join_channel",
          channel_id: activeChannelId,
        };
        ws.send(JSON.stringify(msg));
        prevChannelRef.current = activeChannelId;
      }
    };
    ws.onmessage = (event) => {
      try {
        const data: WsServerMessage = JSON.parse(event.data);
        if (data.type === "new_message") {
          if (seenMsgIds.current.has(data.id)) return;
          seenMsgIds.current.add(data.id);

          let content = data.content || "";

          // Attempt E2E decryption if the message is encrypted
          if (isMsgChannelEncrypted(content)) {
            const myUserId = activeServer?.config.userId;
            const senderKey = channelKeysRef.current.find((k) => k.user_id === data.user_id);
            if (myUserId && senderKey) {
              decryptChannelMessage(content, myUserId, senderKey.public_key)
                .then((decrypted) => {
                  addMessage({
                    id: data.id,
                    channelId: data.channel_id,
                    userId: data.user_id,
                    userName: data.user_name || "Unknown",
                    avatarUrl: data.avatar_url,
                    content: decrypted,
                    createdAt: data.created_at || "",
                    isBot: data.is_bot,
                  });
                })
                .catch(() => {
                  addMessage({
                    id: data.id,
                    channelId: data.channel_id,
                    userId: data.user_id,
                    userName: data.user_name || "Unknown",
                    avatarUrl: data.avatar_url,
                    content: "🔒 [Encrypted message — cannot decrypt]",
                    createdAt: data.created_at || "",
                    isBot: data.is_bot,
                  });
                });
              return; // handled async
            }
            // No key available — show locked
            content = "🔒 [Encrypted message — cannot decrypt]";
          }

          addMessage({
            id: data.id,
            channelId: data.channel_id,
            userId: data.user_id,
            userName: data.user_name || "Unknown",
            avatarUrl: data.avatar_url,
            content,
            createdAt: data.created_at || "",
            isBot: data.is_bot,
          });
        } else if (data.type === "voice_state_sync") {
          useStore.getState().setVoiceMembers(data.voice_states);
        } else if (data.type === "voice_peer_joined") {
          useStore.getState().addVoiceMember({
            user_id: data.user_id,
            user_name: data.user_name,
            channel_id: data.channel_id,
            is_muted: false,
            is_deafened: false,
          });
        } else if (data.type === "voice_peer_left") {
          useStore.getState().removeVoiceMember(data.user_id);
        } else if (data.type === "voice_status_update") {
          const currentMembers = useStore.getState().voiceMembers;
          const updated = currentMembers.map((m) =>
            m.user_id === data.user_id && m.channel_id === data.channel_id
              ? {
                  ...m,
                  is_muted: data.is_muted,
                  is_deafened: data.is_deafened,
                }
              : m,
          );
          useStore.getState().setVoiceMembers(updated);
        } else if (data.type === "voice_talking") {
          useStore.getState().setTalking(data.user_id, data.talking);
        }
      } catch (err) {
        console.error("Failed to parse WS message:", err);
      }
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      wsRef.current = null;
      setWsStatus("disconnected");

      if (retriesRef.current < WS_MAX_RETRIES) {
        retriesRef.current++;
        const delay = WS_RECONNECT_DELAY * Math.min(retriesRef.current, 5);
        reconnectTimerRef.current = setTimeout(connectWs, delay);
      }
    };
  }, [activeServer?.id, activeChannelId, addMessage]);
  useEffect(() => {
    connectWs();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsStatus("disconnected");
    };
  }, [connectWs]);

  // Switch channel subscription
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !activeChannelId) return;

    if (prevChannelRef.current && prevChannelRef.current !== activeChannelId) {
      ws.send(
        JSON.stringify({
          type: "leave_channel",
          channel_id: prevChannelRef.current,
        }),
      );
    }
    ws.send(
      JSON.stringify({ type: "join_channel", channel_id: activeChannelId }),
    );
    prevChannelRef.current = activeChannelId;
  }, [activeChannelId]);

  // Load older messages (infinite scroll upward)
  const loadOlderMessages = useCallback(async () => {
    if (!activeServer || !activeChannelId || isLoadingMore || !hasMoreMessages) return;
    if (activeServer.type === "p2p") return; // P2P loads all at once

    const { host, port } = activeServer.config;
    if (!host || !port) return;

    const oldest = messages[0];
    if (!oldest) return;

    setIsLoadingMore(true);
    try {
      const baseUrl = getApiUrl(host, port);
      const guildId = activeServer.config.guildId || "default";
      const res = await fetch(
        `${baseUrl}/api/channels/${activeChannelId}/messages?limit=${MESSAGES_PER_PAGE}&before=${encodeURIComponent(oldest.createdAt)}`,
        { headers: { "X-Server-Id": guildId } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ApiMessage[] = await res.json();

      if (!Array.isArray(data) || data.length === 0) {
        setHasMoreMessages(false);
        return;
      }

      const mapped = data.map((m) => ({
        id: m.id || crypto.randomUUID(),
        channelId: m.channel_id || "",
        userId: m.user_id || "",
        userName: m.user_name || "Unknown",
        content: m.content || "",
        createdAt: m.created_at || "",
      }));

      mapped.forEach((m) => seenMsgIds.current.add(m.id));
      prependMessages(mapped);

      if (mapped.length < MESSAGES_PER_PAGE) {
        setHasMoreMessages(false);
      }
    } catch (err) {
      console.error("Failed to load older messages:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [activeServer, activeChannelId, messages, isLoadingMore, hasMoreMessages, prependMessages, setHasMoreMessages, setIsLoadingMore]);

  // File upload
  const uploadFile = useCallback(
    async (file: File) => {
      if (!activeServer || !isAuthenticated) return;
      if (file.size > MAX_FILE_SIZE) {
        alert("File too large (max 25MB)");
        return;
      }

      if (activeServer.type === "legacy") {
        setUploading(true);
        try {
          const { host, port, authToken } = activeServer.config;
          if (!host || !port) return;
          const baseUrl = getApiUrl(host, port);
          const formData = new FormData();
          formData.append("file", file);

          const res = await fetch(`${baseUrl}/api/upload`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${authToken}`,
              "X-Server-Id": activeServer.config.guildId || "default",
            },
            body: formData,
          });

          if (!res.ok) throw new Error("Upload failed");
          const data = await res.json();

          // Send message with file link
          const fileUrl = `${baseUrl}${data.url}`;
          const isMedia =
            data.mime_type?.startsWith("image/") ||
            data.mime_type?.startsWith("video/");
          const content = isMedia
            ? `[${data.filename}](${fileUrl})`
            : `📎 [${data.filename}](${fileUrl}) (${formatFileSize(data.size)})`;

          if (
            wsRef.current &&
            wsRef.current.readyState === WebSocket.OPEN &&
            activeChannelId
          ) {
            const msg: WsClientMessage = {
              type: "send_message",
              channel_id: activeChannelId,
              content,
              user_id: activeServer.config.userId || "unknown",
              user_name: displayName || "Anonymous",
            };
            wsRef.current.send(JSON.stringify(msg));
          }
        } catch (err) {
          console.error("Upload failed:", err);
        } finally {
          setUploading(false);
        }
      }
    },
    [activeServer, activeChannelId, displayName, isAuthenticated],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    [uploadFile],
  );

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || !activeServer) return;
    if (trimmed.length > MAX_MESSAGE_LENGTH) return;

    if (activeServer.type === "p2p") {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const namespaceId = activeServer.config.p2p?.namespaceId;
        if (!namespaceId || !activeChannelId) return;
        await invoke("send_p2p_channel_message", {
          docId: namespaceId,
          channelId: activeChannelId,
          content: trimmed,
          authorName: displayName || "Anonymous",
        });
        setInput("");
      } catch (err) {
        console.error("Failed to send P2P message", err);
      }
      return;
    }

    if (
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN ||
      !activeChannelId
    )
      return;

    // Encrypt if E2E is enabled for this channel
    let finalContent = trimmed;
    if (e2eEnabled && e2eReady && channelKeysRef.current.length > 0) {
      try {
        finalContent = await encryptChannelMessage(
          trimmed,
          activeServer.config.userId || "unknown",
          channelKeysRef.current,
        );
      } catch (err) {
        console.error("E2E encryption failed, sending plaintext:", err);
      }
    }

    const msg: WsClientMessage = {
      type: "send_message",
      channel_id: activeChannelId,
      content: finalContent,
      user_id: activeServer.config.userId || "unknown",
      user_name: displayName || "Anonymous",
    };
    wsRef.current.send(JSON.stringify(msg));
    setInput("");
  }, [input, activeChannelId, activeServer, displayName, e2eEnabled, e2eReady]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!activeChannelId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg-primary">
        <p className="text-text-muted text-sm">
          Select a channel to start chatting
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col bg-bg-primary"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Channel header */}
      <div className="h-14 flex items-center px-6 border-b border-border/50 gap-3 bg-bg-primary/80 backdrop-blur-md sticky top-0 z-10">
        <span className="text-xl font-medium text-text-muted">#</span>
        <h3 className="text-sm font-bold text-text-primary tracking-tight">
          {activeChannel?.name || "channel"}
        </h3>
        {activeChannel?.description && (
          <>
            <div className="w-px h-4 bg-border/50 mx-1" />
            <span className="text-xs text-text-muted truncate max-w-md">
              {activeChannel.description}
            </span>
          </>
        )}
        {/* E2E encryption indicator */}
        {activeChannel?.encrypted && (
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider ${
              e2eReady
                ? "bg-green-500/10 border-green-500/30 text-green-400"
                : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400 animate-pulse"
            }`}
            title={e2eReady ? "End-to-End Encrypted" : "Setting up encryption..."}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            {e2eReady ? "E2E" : "..."}
          </div>
        )}
        <div className="ml-auto flex items-center gap-3">
          {activeServer?.type === "p2p" ? (
            <div className="flex items-center gap-3">
              <div
                className="flex items-center gap-2 bg-accent/10 hover:bg-accent/20 px-3 py-1 rounded-full border border-accent/20 cursor-pointer transition-all active:scale-95"
                onClick={() => {
                  if (activeServer.config.p2p?.ticket) {
                    navigator.clipboard.writeText(
                      activeServer.config.p2p.ticket,
                    );
                    // Could add a toast here
                  }
                }}
                title="Click to copy Invite Ticket"
              >
                <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                <span className="text-[10px] font-bold text-accent uppercase tracking-widest">
                  P2P Network
                </span>
              </div>
              <div className="bg-bg-secondary px-2.5 py-1 rounded-full border border-border/50">
                <span className="text-[10px] font-bold text-text-muted">
                  ID:{" "}
                </span>
                <span className="text-[10px] font-mono font-bold text-text-secondary">
                  {useStore.getState().nodeId?.substring(0, 8)}...
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 bg-bg-secondary px-2.5 py-1 rounded-full border border-border/50">
                <div
                  className={`w-2 h-2 rounded-full ${
                    wsStatus === "connected"
                      ? "bg-success shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                      : wsStatus === "connecting"
                        ? "bg-yellow-400 animate-pulse"
                        : "bg-danger shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                  }`}
                />
                <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">
                  {wsStatus === "connected"
                    ? "Online"
                    : wsStatus === "connecting"
                      ? "Connecting"
                      : "Offline"}
                </span>
              </div>
              {!isAuthenticated && (
                <span className="text-[10px] font-bold text-yellow-500/80 bg-yellow-500/10 px-2 py-0.5 rounded-full border border-yellow-500/20 uppercase tracking-widest">
                  Guest
                </span>
              )}
            </>
          )}
          {/* Members toggle button */}
          {onToggleMembers && (
            <button
              onClick={onToggleMembers}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                showMembers
                  ? "bg-accent/20 text-accent"
                  : "text-text-muted hover:text-text-primary hover:bg-bg-surface/60"
              }`}
              title={showMembers ? "Hide Members" : "Show Members"}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Drag overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-40 bg-accent/10 border-2 border-dashed border-accent rounded-xl flex items-center justify-center">
          <p className="text-accent font-medium">Drop file to upload</p>
        </div>
      )}

      {/* Stream Grid Area */}
      {screenShares.size > 0 && (
        <div className="border-b border-border/50 bg-bg-secondary/30">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-accent shadow-[0_0_8px_rgba(59,130,246,0.5)] animate-pulse" />
              <span className="text-[10px] font-bold text-text-primary uppercase tracking-widest">
                Active Streams ({screenShares.size})
              </span>
            </div>
            <button
              onClick={() => setShowStreams(!showStreams)}
              className="text-[10px] font-bold text-text-muted hover:text-text-primary uppercase tracking-wider transition-colors cursor-pointer"
            >
              {showStreams ? "Collapse" : "Expand"}
            </button>
          </div>

          {showStreams && (
            <div className="px-4 pb-4">
              <div
                className={`grid gap-4 ${
                  screenShares.size === 1
                    ? "grid-cols-1"
                    : screenShares.size === 2
                      ? "grid-cols-2"
                      : "grid-cols-3"
                }`}
              >
                {Array.from(screenShares.entries()).map(([uid, stream]) => {
                  const m = voiceMembers.find((v) => v.user_id === uid);
                  return (
                    <ScreenShareView
                      key={uid}
                      stream={stream}
                      userName={m?.user_name || "Unknown"}
                      onClose={() => removeScreenShare(uid)}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Messages — virtualized with infinite scroll */}
      <div className="flex-1 overflow-hidden">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-muted text-sm">
              No messages yet. Say hi! 👋
            </p>
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={messages}
            initialTopMostItemIndex={messages.length - 1}
            followOutput={(isAtBottom) => (isAtBottom ? "smooth" : false)}
            atBottomStateChange={setAtBottom}
            startReached={loadOlderMessages}
            increaseViewportBy={{ top: 400, bottom: 100 }}
            components={{
              Header: () =>
                hasMoreMessages && activeServer?.type !== "p2p" ? (
                  <div className="flex justify-center py-3">
                    {isLoadingMore ? (
                      <div className="flex items-center gap-2 text-text-muted text-xs">
                        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Loading older messages...
                      </div>
                    ) : (
                      <span className="text-text-muted text-[10px] uppercase tracking-wider font-bold">
                        Scroll up for more
                      </span>
                    )}
                  </div>
                ) : messages.length > 0 ? (
                  <div className="flex justify-center py-4">
                    <span className="text-text-muted text-[10px] uppercase tracking-wider font-bold">
                      Beginning of conversation
                    </span>
                  </div>
                ) : null,
            }}
            itemContent={(index, msg) => {
              const showHeader = index === 0 || messages[index - 1].userId !== msg.userId;
              const avatarUrl = msg.avatarUrl;

              return (
                <div className={`px-4 ${showHeader ? "mt-3" : ""}`}>
                  {showHeader && (
                    <div className="flex items-center gap-3 mb-1">
                      {avatarUrl && activeServer ? (
                        <>
                          {activeServer.type === "legacy" &&
                            activeServer.config.host &&
                            activeServer.config.port && (
                              <img
                                src={`${getApiUrl(activeServer.config.host, activeServer.config.port)}${avatarUrl}`}
                                alt={msg.userName}
                                className="w-10 h-10 rounded-full object-cover shadow-sm bg-bg-surface"
                              />
                            )}
                          {activeServer.type === "p2p" && (
                            <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center text-white font-bold">
                              {msg.userName[0].toUpperCase()}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-bg-surface flex items-center justify-center text-sm font-bold text-accent shadow-sm flex-shrink-0 border border-border/50">
                          {(msg.userName || "?")[0]?.toUpperCase()}
                        </div>
                      )}
                      <div className="flex items-baseline gap-2.5">
                        <span className="text-sm font-bold text-text-primary tracking-tight">
                          {msg.userName || "Unknown"}
                        </span>
                        {msg.isBot && (
                          <span className="text-[9px] font-bold uppercase tracking-wider bg-accent/90 text-white px-1.5 py-0.5 rounded-sm leading-none">
                            BOT
                          </span>
                        )}
                        <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                          {formatTime(msg.createdAt)}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="pl-13 text-sm text-text-primary/90 leading-relaxed hover:bg-bg-secondary/40 transition-colors rounded-xl px-4 py-1.5 -mx-4 break-words whitespace-pre-wrap">
                    <MessageContent content={msg.content} server={activeServer!} />
                  </div>
                </div>
              );
            }}
          />
        )}
      </div>

      {/* Input */}
      <div className="px-4 pb-4">
        <div className="relative">
          {showEmoji && activeServer && (
            <>
              {activeServer.type === "legacy" &&
                activeServer.config.host &&
                activeServer.config.port && (
                  <EmojiPicker
                    onSelect={(emoji: string) =>
                      setInput((s: string) => s + emoji)
                    }
                    serverHost={activeServer.config.host}
                    serverPort={activeServer.config.port}
                    authToken={activeServer.config.authToken}
                    guildId={activeServer.config.guildId}
                    onClose={() => setShowEmoji(false)}
                  />
                )}
            </>
          )}
        </div>
        <div className="bg-bg-secondary border border-border/50 rounded-2xl flex items-end shadow-lg focus-within:border-accent/50 focus-within:ring-4 focus-within:ring-accent/5 transition-all">
          {/* File upload button */}
          {isAuthenticated && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || wsStatus !== "connected"}
              className="p-3 text-text-muted hover:text-accent transition-colors cursor-pointer disabled:opacity-40"
              title="Upload file"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13"
                />
              </svg>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadFile(file);
              e.target.value = "";
            }}
          />
          <textarea
            value={input}
            onChange={(e) =>
              setInput(e.target.value.slice(0, MAX_MESSAGE_LENGTH))
            }
            onKeyDown={handleKeyDown}
            placeholder={
              activeServer?.type === "p2p"
                ? "Message P2P Namespace..."
                : !isAuthenticated
                  ? "Log in to send messages"
                  : wsStatus !== "connected"
                    ? "Reconnecting..."
                    : `Message #${activeChannel?.name || "channel"}`
            }
            disabled={
              activeServer?.type !== "p2p" &&
              (wsStatus !== "connected" || !isAuthenticated)
            }
            rows={1}
            className="flex-1 bg-transparent resize-none px-4 py-3.5 text-sm text-text-primary placeholder:text-text-muted outline-none disabled:opacity-50"
          />
          {/* Emoji button */}
          {isAuthenticated && (
            <button
              onClick={() => setShowEmoji(!showEmoji)}
              className={`p-3 transition-colors cursor-pointer ${
                showEmoji ? "text-accent" : "text-text-muted hover:text-accent"
              }`}
              disabled={wsStatus !== "connected"}
              title="Emoji"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z"
                />
              </svg>
            </button>
          )}
          <button
            onClick={handleSend}
            disabled={
              !input.trim() || wsStatus !== "connected" || !isAuthenticated
            }
            className="p-3 text-accent disabled:text-text-muted hover:scale-110 active:scale-95 transition-all cursor-pointer"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"
              />
            </svg>
          </button>
        </div>
        {uploading && (
          <div className="text-[10px] text-accent mt-1 animate-pulse">
            Uploading file...
          </div>
        )}
        {input.length > MAX_MESSAGE_LENGTH - 100 && (
          <div className="text-[10px] text-text-muted text-right mt-1">
            {input.length}/{MAX_MESSAGE_LENGTH}
          </div>
        )}
      </div>
    </div>
  );
}
