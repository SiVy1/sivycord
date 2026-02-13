import { useEffect, useRef, useState, useCallback } from "react";
import { useStore } from "../store";
import { EmojiPicker } from "./EmojiPicker";
import { ScreenShareView } from "./ScreenShareView";
import {
  type WsClientMessage,
  type WsServerMessage,
  type ChatEntry,
  type ApiMessage,
  type ServerEntry,
  getApiUrl,
  getWsUrl,
} from "../types";

const MAX_MESSAGE_LENGTH = 2000;
const WS_RECONNECT_DELAY = 2000;
const WS_MAX_RETRIES = 10;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

export function ChatArea() {
  const activeServerId = useStore((s) => s.activeServerId);
  const servers = useStore((s) => s.servers);
  const activeChannelId = useStore((s) => s.activeChannelId);
  const channels = useStore((s) => s.channels);
  const messages = useStore((s) => s.messages);
  const setMessages = useStore((s) => s.setMessages);
  const addMessage = useStore((s) => s.addMessage);
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const prevChannelRef = useRef<string | null>(null);
  const retriesRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenMsgIds = useRef<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeServer = servers.find((s) => s.id === activeServerId);
  const activeChannel = channels.find((c) => c.id === activeChannelId);
  const isAuthenticated = !!activeServer?.config.authToken;

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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

    const controller = new AbortController();
    fetch(`${baseUrl}/api/channels/${activeChannelId}/messages?limit=50`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: ApiMessage[]) => {
        if (!Array.isArray(data)) {
          setMessages([]);
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
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error("Failed to fetch messages:", err);
          setMessages([]);
        }
      });

    return () => controller.abort();
  }, [activeChannelId, activeServer?.id]);

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
    const wsUrl = authToken
      ? `${wsBaseUrl}/ws?token=${encodeURIComponent(authToken)}`
      : `${wsBaseUrl}/ws`;
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

          addMessage({
            id: data.id,
            channelId: data.channel_id,
            userId: data.user_id,
            userName: data.user_name || "Unknown",
            avatarUrl: data.avatar_url,
            content: data.content || "",
            createdAt: data.created_at || "",
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
            headers: { Authorization: `Bearer ${authToken}` },
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

    const msg: WsClientMessage = {
      type: "send_message",
      channel_id: activeChannelId,
      content: trimmed,
      user_id: activeServer.config.userId || "unknown",
      user_name: displayName || "Anonymous",
    };
    wsRef.current.send(JSON.stringify(msg));
    setInput("");
  }, [input, activeChannelId, activeServer, displayName]);

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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <p className="text-text-muted text-sm">
              No messages yet. Say hi! 👋
            </p>
          </div>
        )}
        {messages.map((msg, i) => {
          const showHeader = i === 0 || messages[i - 1].userId !== msg.userId;

          // Try to find member for avatar (fallback to msg.avatarUrl)
          const avatarUrl = msg.avatarUrl;

          return (
            <div key={msg.id} className={`group ${showHeader ? "mt-3" : ""}`}>
              {showHeader && (
                <div className="flex items-center gap-3 mb-1">
                  {/* Avatar */}
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
                    <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                      {formatTime(msg.createdAt)}
                    </span>
                  </div>
                </div>
              )}
              <div className="pl-13 text-sm text-text-primary/90 leading-relaxed hover:bg-bg-secondary/40 transition-colors rounded-xl px-4 py-1.5 -mx-4 break-words whitespace-pre-wrap">
                <MessageContent content={msg.content} server={activeServer} />
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
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

// ─── Message content renderer ───
// Renders links as clickable, images as inline previews

function MessageContent({ content, server }: { content: string; server: ServerEntry }) {
  const { host, port } = server.config || {};
  const baseUrl = host && port ? getApiUrl(host, port) : "";

  // Parse markdown-style links: [text](url) AND custom emoji :name:
  const parts = content.split(/(\[[^\]]+\]\([^)]+\)|:[a-z0-9_]+:)/g);

  return (
    <>
      {parts.map((part, i) => {
        // Link match
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          const [, text, url] = linkMatch;
          const fullUrl = url.startsWith("/") ? `${baseUrl}${url}` : url;
          const isImage = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i.test(url);
          const isVideo = /\.(mp4|webm|mov|avi|mkv|ogv)$/i.test(url);
          // Uploads without recognizable extension — try to detect from path
          const isUpload =
            url.includes("/api/uploads/") && !text.startsWith("📎");

          if ((isImage || (isUpload && !isVideo)) && !text.startsWith("📎")) {
            return (
              <div key={i} className="mt-1 mb-1">
                <img
                  src={fullUrl}
                  alt={text}
                  className="max-w-xs max-h-64 rounded-lg border border-border cursor-pointer shadow-sm hover:shadow-md transition-shadow"
                  onClick={() => window.open(fullUrl, "_blank")}
                  onError={(e) => {
                    // If it fails as image, try video fallback
                    const img = e.target as HTMLImageElement;
                    const container = img.parentElement;
                    if (container) {
                      const video = document.createElement("video");
                      video.src = fullUrl;
                      video.controls = true;
                      video.className =
                        "max-w-md max-h-80 rounded-lg border border-border shadow-sm";
                      video.playsInline = true;
                      container.replaceChild(video, img);
                    }
                  }}
                />
              </div>
            );
          }

          if (isVideo) {
            return (
              <div key={i} className="mt-1 mb-1">
                <video
                  src={fullUrl}
                  controls
                  playsInline
                  className="max-w-md max-h-80 rounded-lg border border-border shadow-sm"
                />
              </div>
            );
          }

          const isSafeUrl = /^https?:\/\//i.test(fullUrl) || fullUrl.startsWith('/');

          return (
            <a
              key={i}
              href={isSafeUrl ? fullUrl : '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline font-medium"
            >
              {text}
            </a>
          );
        }

        // Emoji match
        const emojiMatch = part.match(/^:([a-z0-9_]+):$/);
        if (emojiMatch) {
          return (
            <img
              key={i}
              src={`${baseUrl}/api/uploads/emoji/${emojiMatch[1]}`} // Note: backend needs to map name to path, or we fetch emoji list
              // Actually, since we don't know the ID here easily without a map,
              // we might need a better strategy.
              // For now, let's assume a simplified endpoint /api/emoji/:name/image
              // OR we can just render the text if we don't have the map.
              // Given the complexity of fetching the map in every MessageContent,
              // I'll add a quick emoji map fetch in ChatArea and pass it down.
              alt={part}
              title={part}
              className="inline-block w-6 h-6 object-contain align-bottom mx-0.5"
              onError={(e) => {
                // If not found, revert to text safely
                const el = e.target as HTMLElement;
                const text = document.createTextNode(part);
                el.parentNode?.replaceChild(text, el);
              }}
            />
          );
        }

        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function formatTime(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const normalized = dateStr.includes("T")
      ? dateStr
      : dateStr.replace(" ", "T") + "Z";
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return dateStr;
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return (
      date.toLocaleDateString([], { month: "short", day: "numeric" }) +
      " " +
      date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  } catch {
    return dateStr;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
