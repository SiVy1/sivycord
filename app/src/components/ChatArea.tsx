import { useEffect, useRef, useState, useCallback } from "react";
import { useStore } from "../store";
import type { WsClientMessage, WsServerMessage } from "../types";

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

  const [input, setInput] = useState("");
  const [wsStatus, setWsStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("disconnected");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
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
    const { host, port } = activeServer.config;

    const controller = new AbortController();
    fetch(
      `http://${host}:${port}/api/channels/${activeChannelId}/messages?limit=50`,
      { signal: controller.signal },
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: any[]) => {
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
    const { host, port } = activeServer.config;

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    setWsStatus("connecting");
    const authToken = activeServer.config.authToken;
    const wsUrl = authToken
      ? `ws://${host}:${port}/ws?token=${encodeURIComponent(authToken)}`
      : `ws://${host}:${port}/ws`;
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
            content: data.content || "",
            createdAt: data.created_at || "",
          });
        }
      } catch {
        // Ignore malformed JSON
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
  }, [activeServer?.id]);

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

      setUploading(true);
      try {
        const { host, port, authToken } = activeServer.config;
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch(`http://${host}:${port}/api/upload`, {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}` },
          body: formData,
        });

        if (!res.ok) throw new Error("Upload failed");
        const data = await res.json();

        // Send message with file link
        const fileUrl = `http://${host}:${port}${data.url}`;
        const isImage = data.mime_type?.startsWith("image/");
        const content = isImage
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

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (
      !trimmed ||
      !wsRef.current ||
      wsRef.current.readyState !== WebSocket.OPEN ||
      !activeChannelId ||
      !activeServer
    )
      return;
    if (trimmed.length > MAX_MESSAGE_LENGTH) return;

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
      <div className="h-12 flex items-center px-4 border-b border-border gap-2">
        <span className="text-text-muted">#</span>
        <h3 className="text-sm font-semibold text-text-primary">
          {activeChannel?.name || "channel"}
        </h3>
        {activeChannel?.description && (
          <>
            <div className="w-px h-5 bg-border mx-1" />
            <span className="text-xs text-text-muted truncate">
              {activeChannel.description}
            </span>
          </>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              wsStatus === "connected"
                ? "bg-success"
                : wsStatus === "connecting"
                  ? "bg-yellow-400 animate-pulse"
                  : "bg-danger"
            }`}
          />
          <span className="text-[10px] text-text-muted">
            {wsStatus === "connected"
              ? "Connected"
              : wsStatus === "connecting"
                ? "Connecting..."
                : "Offline"}
          </span>
          {!isAuthenticated && (
            <span className="text-[10px] text-yellow-400 ml-2">
              Guest (read-only)
            </span>
          )}
        </div>
      </div>

      {/* Drag overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-40 bg-accent/10 border-2 border-dashed border-accent rounded-xl flex items-center justify-center">
          <p className="text-accent font-medium">Drop file to upload</p>
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
          return (
            <div key={msg.id} className={`group ${showHeader ? "mt-3" : ""}`}>
              {showHeader && (
                <div className="flex items-center gap-2 mb-0.5">
                  {/* Avatar placeholder */}
                  <div className="w-8 h-8 rounded-full bg-bg-tertiary flex items-center justify-center text-xs font-medium text-text-secondary flex-shrink-0">
                    {(msg.userName || "?")[0]?.toUpperCase()}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-text-primary">
                      {msg.userName || "Unknown"}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {formatTime(msg.createdAt)}
                    </span>
                  </div>
                </div>
              )}
              <div className="pl-10 text-sm text-text-primary/90 leading-relaxed hover:bg-bg-hover/30 rounded px-2 py-0.5 -mx-2 break-words whitespace-pre-wrap">
                <MessageContent content={msg.content} server={activeServer!} />
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-4">
        <div className="bg-bg-input border border-border rounded-xl flex items-end">
          {/* File upload button */}
          {isAuthenticated && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || wsStatus !== "connected"}
              className="px-3 py-3 text-text-muted hover:text-text-primary transition-colors cursor-pointer disabled:opacity-40"
              title="Upload file"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
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
              !isAuthenticated
                ? "Log in to send messages"
                : wsStatus !== "connected"
                  ? "Reconnecting to server..."
                  : `Message #${activeChannel?.name || "channel"}`
            }
            disabled={wsStatus !== "connected" || !isAuthenticated}
            rows={1}
            className="flex-1 bg-transparent resize-none px-4 py-3 text-sm text-text-primary placeholder:text-text-muted outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={
              !input.trim() || wsStatus !== "connected" || !isAuthenticated
            }
            className="px-3 py-3 text-accent disabled:text-text-muted transition-colors cursor-pointer"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
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

function MessageContent({
  content,
  server,
}: {
  content: string;
  server: { config: { host: string; port: number } };
}) {
  const { host, port } = server.config;
  const baseUrl = `http://${host}:${port}`;

  // Parse markdown-style links: [text](url)
  const parts = content.split(/(\[[^\]]+\]\([^)]+\))/g);

  return (
    <>
      {parts.map((part, i) => {
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          const [, text, url] = linkMatch;
          const fullUrl = url.startsWith("/") ? `${baseUrl}${url}` : url;
          const isImage =
            /\.(png|jpe?g|gif|webp)$/i.test(url) ||
            url.includes("/api/uploads/");

          if (isImage && !text.startsWith("📎")) {
            return (
              <div key={i} className="mt-1 mb-1">
                <img
                  src={fullUrl}
                  alt={text}
                  className="max-w-xs max-h-64 rounded-lg border border-border cursor-pointer"
                  onClick={() => window.open(fullUrl, "_blank")}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
            );
          }

          return (
            <a
              key={i}
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              {text}
            </a>
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
