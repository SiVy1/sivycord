import { useEffect, useRef, useState, useCallback } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useStore } from "../store";
import { setTalkingDirect } from "../hooks/talkingStore";
import { EmojiPicker } from "./EmojiPicker";
import { ScreenShareView } from "./ScreenShareView";
import {
  MessageContent,
  EmojiImage,
  formatTime,
  formatFileSize,
} from "./MessageContent";
import {
  type WsClientMessage,
  type WsServerMessage,
  type ChatEntry,
  type ApiMessage,
  type ChannelKeysResponse,
  type Message,
  type Channel,
  type ServerEntry,
  type MessageWithReply,
  getApiUrl,
  getWsUrl,
} from "../types";
import type { ChannelParticipantKey } from "../lib/crypto";
import {
  generateKeyPair,
  hasLocalKeyPair,
  getLocalPublicKey,
  encryptWithSenderKey,
  decryptWithSenderKey,
  decryptChannelMessage,
  isChannelEncrypted as isMsgChannelEncrypted,
  isSenderKeyDistribution,
  isSenderKeyMessage,
  processSenderKeyDistribution,
  createSenderKeyDistribution,
  hasSenderKey,
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
  const replyingTo = useStore((s) => s.replyingTo);
  const setReplyingTo = useStore((s) => s.setReplyingTo);
  const addReaction = useStore((s) => s.addReaction);
  const removeReaction = useStore((s) => s.removeReaction);

  const [input, setInput] = useState("");
  const [showStreams, setShowStreams] = useState(true);
  const [wsStatus, setWsStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("disconnected");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<
    string | null
  >(null);
  const [showPins, setShowPins] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);
  const [isLoadingPins, setIsLoadingPins] = useState(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const lastTypingSentRef = useRef<number>(0);
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
          const entries = await invoke<ChatEntry[]>(
            "list_p2p_channel_messages",
            {
              docId: namespaceId,
              channelId: activeChannelId,
            },
          );

          const mapped = entries.map((e) => {
            // Try to parse the content as JSON (P2PMessage format)
            let content = e.content;
            let userName = e.author.substring(0, 8);
            try {
              const parsed = JSON.parse(e.content);
              if (parsed.content) content = parsed.content;
              if (parsed.author) userName = parsed.author;
            } catch {
              /* raw string fallback */
            }
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
    const authToken = activeServer.config.authToken;
    fetch(
      `${baseUrl}/api/channels/${activeChannelId}/messages?limit=${MESSAGES_PER_PAGE}`,
      {
        signal: controller.signal,
        headers: {
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          "X-Server-Id": activeServer.config.guildId || "default",
        },
      },
    )
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
          editedAt: m.edited_at,
          isBot: m.is_bot,
          avatarUrl: m.avatar_url,
          replyTo: m.reply_to,
          repliedMessage: m.replied_message
            ? {
                id: m.replied_message.id,
                content: m.replied_message.content,
                userName: m.replied_message.user_name,
              }
            : undefined,
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

    if (
      !activeServer ||
      activeServer.type === "p2p" ||
      !activeChannelId ||
      !isAuthenticated
    )
      return;
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
            headers: {
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
              "X-Server-Id": guildId,
            },
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
        const keysRes = await fetch(
          `${baseUrl}/api/channels/${activeChannelId}/keys`,
          {
            headers: {
              Authorization: `Bearer ${authToken}`,
              "X-Server-Id": guildId,
            },
          },
        );
        if (!keysRes.ok) throw new Error("Failed to fetch channel keys");

        const keysData: ChannelKeysResponse = await keysRes.json();
        if (cancelled) return;

        const participants: ChannelParticipantKey[] = keysData.keys.map(
          (k) => ({
            user_id: k.user_id,
            public_key: k.public_key,
          }),
        );

        setChannelKeys(participants);
        channelKeysRef.current = participants;
        setE2eEnabled(true);
        setE2eReady(true);

        // Distribute our sender key to channel participants if they don't have it yet
        if (participants.length > 1) {
          const hasKey = await hasSenderKey(activeChannelId, userId);
          if (!hasKey || true) {
            // Always distribute on channel join so new members get it
            try {
              const distribution = await createSenderKeyDistribution(
                userId,
                activeChannelId,
                participants,
              );
              // Send distribution via WS if connected
              const ws = wsRef.current;
              if (ws && ws.readyState === WebSocket.OPEN) {
                const msg: WsClientMessage = {
                  type: "send_message",
                  channel_id: activeChannelId,
                  content: distribution,
                  user_id: userId,
                  user_name: displayName || "Anonymous",
                };
                ws.send(JSON.stringify(msg));
              }
            } catch (err) {
              console.warn("Failed to distribute sender key:", err);
            }
          }
        }
      } catch (err) {
        console.error("E2E setup failed:", err);
        setE2eEnabled(false);
        setE2eReady(false);
      }
    })();

    return () => {
      cancelled = true;
    };
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

          // Handle sender key distribution messages (hidden from UI)
          if (isSenderKeyDistribution(content)) {
            const myUserId = activeServer?.config.userId;
            const senderKey = channelKeysRef.current.find(
              (k) => k.user_id === data.user_id,
            );
            if (myUserId && senderKey) {
              processSenderKeyDistribution(
                content,
                myUserId,
                senderKey.public_key,
              ).catch((err) =>
                console.warn("Failed to process SK distribution:", err),
              );
            }
            return; // don't show distribution messages in chat
          }

          // Attempt E2E decryption if the message is encrypted
          if (isSenderKeyMessage(content)) {
            // New sender-key encrypted message — O(1) decrypt
            decryptWithSenderKey(content, data.channel_id)
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
            return;
          }

          if (isMsgChannelEncrypted(content)) {
            // Legacy per-message wrapped key format
            const myUserId = activeServer?.config.userId;
            const senderKey = channelKeysRef.current.find(
              (k) => k.user_id === data.user_id,
            );
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
            replyTo: data.reply_to ?? undefined,
            repliedMessage: data.replied_message
              ? {
                  id: data.replied_message.id,
                  content: data.replied_message.content,
                  userName: data.replied_message.user_name,
                }
              : undefined,
          });
        } else if (data.type === "message_edited") {
          useStore.getState().updateMessage(data.id, {
            content: data.content,
            editedAt: data.edited_at,
          });
        } else if (data.type === "reaction_add") {
          useStore
            .getState()
            .addReaction(
              data.message_id,
              data.emoji,
              data.user_id,
              data.user_name,
            );
        } else if (data.type === "reaction_remove") {
          useStore
            .getState()
            .removeReaction(data.message_id, data.emoji, data.user_id);
        } else if (data.type === "message_deleted") {
          useStore.getState().removeMessage(data.id);
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
          setTalkingDirect(data.user_id, data.talking);
        } else if (data.type === "typing_start") {
          useStore
            .getState()
            .setTyping(data.channel_id, data.user_id, data.user_name);
        } else if (data.type === "message_pinned") {
          useStore.getState().updateMessage(data.message_id, {
            pinned_at: data.pinned ? data.pinned_at : undefined,
            pinned_by: data.pinned ? data.pinned_by : undefined,
          });
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
  }, [activeServer?.id, addMessage]);
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

  // Periodic cleanup for typing indicators
  useEffect(() => {
    const interval = setInterval(() => {
      useStore.getState().clearExpiredTyping();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

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

  const handleTogglePin = async (messageId: string, isPinned: boolean) => {
    if (!activeServer?.config.host || !activeServer?.config.port) return;
    const url = `${getApiUrl(activeServer.config.host, activeServer.config.port)}/api/messages/${messageId}/pin`;
    try {
      const resp = await fetch(url, {
        method: isPinned ? "DELETE" : "POST",
        headers: {
          Authorization: `Bearer ${activeServer.config.authToken}`,
        },
      });
      if (!resp.ok) {
        throw new Error(await resp.text());
      }
    } catch (err) {
      console.error("Failed to toggle pin:", err);
    }
  };

  const fetchPins = async () => {
    if (
      !activeServer?.config.host ||
      !activeServer?.config.port ||
      !activeChannelId
    )
      return;
    setIsLoadingPins(true);
    const url = `${getApiUrl(activeServer.config.host, activeServer.config.port)}/api/channels/${activeChannelId}/pins`;
    try {
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${activeServer.config.authToken}`,
        },
      });
      if (resp.ok) {
        const data = await resp.json();
        setPinnedMessages(data);
      }
    } catch (err) {
      console.error("Failed to fetch pins:", err);
    } finally {
      setIsLoadingPins(false);
    }
  };

  useEffect(() => {
    if (showPins) {
      fetchPins();
    }
  }, [showPins, activeServer, activeChannelId]);

  // Load older messages (infinite scroll upward)
  const loadOlderMessages = useCallback(async () => {
    if (!activeServer || !activeChannelId || isLoadingMore || !hasMoreMessages)
      return;
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
        {
          headers: {
            ...(activeServer.config.authToken
              ? { Authorization: `Bearer ${activeServer.config.authToken}` }
              : {}),
            "X-Server-Id": guildId,
          },
        },
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
        editedAt: m.edited_at,
        isBot: m.is_bot,
        avatarUrl: m.avatar_url,
        replyTo: m.reply_to,
        repliedMessage: m.replied_message
          ? {
              id: m.replied_message.id,
              content: m.replied_message.content,
              userName: m.replied_message.user_name,
            }
          : undefined,
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
  }, [
    activeServer,
    activeChannelId,
    messages,
    isLoadingMore,
    hasMoreMessages,
    prependMessages,
    setHasMoreMessages,
    setIsLoadingMore,
  ]);

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
        const userId = activeServer.config.userId || "unknown";
        finalContent = await encryptWithSenderKey(
          trimmed,
          userId,
          activeChannelId,
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
      ...(replyingTo ? { reply_to: replyingTo.id } : {}),
    };
    wsRef.current.send(JSON.stringify(msg));
    setInput("");
    setReplyingTo(null);
  }, [
    input,
    activeChannelId,
    activeServer,
    displayName,
    e2eEnabled,
    e2eReady,
    replyingTo,
    setReplyingTo,
  ]);

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    if (!activeServer || !activeChannelId) return;
    const { host, port, authToken, userId } = activeServer.config;
    if (!host || !port || !authToken || !userId) return;

    const message = messages.find((m) => m.id === messageId);
    const hasOwn = message?.reactions
      ?.find((g) => g.emoji === emoji)
      ?.user_ids.includes(userId);

    const baseUrl = getApiUrl(host, port);
    try {
      if (hasOwn) {
        // Optimistic UI
        removeReaction(messageId, emoji, userId);
        await fetch(
          `${baseUrl}/api/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${authToken}` },
          },
        );
      } else {
        // Optimistic UI
        addReaction(messageId, emoji, userId, displayName);
        await fetch(`${baseUrl}/api/messages/${messageId}/reactions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ emoji }),
        });
      }
    } catch (err) {
      console.error("Failed to toggle reaction:", err);
      // Fallback is implicit: the store will eventually be updated correctly by the broadcast
    }
  };

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
            title={
              e2eReady ? "End-to-End Encrypted" : "Setting up encryption..."
            }
          >
            <svg
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
              />
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

              {/* Pins Button */}
              <button
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  showPins
                    ? "bg-accent/20 text-accent"
                    : "text-text-muted hover:text-text-primary hover:bg-bg-surface/60"
                }`}
                title="Pinned Messages"
                onClick={() => setShowPins(!showPins)}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
                  />
                </svg>
              </button>
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
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
                />
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
                        <svg
                          className="w-4 h-4 animate-spin"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
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
              const showHeader =
                index === 0 || messages[index - 1].userId !== msg.userId;
              const avatarUrl = msg.avatarUrl;
              const isOwnMessage = msg.userId === activeServer?.config.userId;
              const isEditing = editingMessageId === msg.id;

              return (
                <div
                  className={`group relative px-4 ${showHeader ? "mt-3" : ""}`}
                >
                  {/* Hover action buttons */}
                  {!isEditing && (
                    <div className="absolute right-4 -top-2 hidden group-hover:flex items-center gap-0.5 bg-bg-secondary border border-border/50 rounded-lg shadow-lg px-1 py-0.5 z-10">
                      {/* Quick Reactions */}
                      <div className="flex items-center gap-0.5 pr-1 mr-1 border-r border-border/50">
                        {["👍", "❤️", "😂", "🎉"].map((emoji) => (
                          <button
                            key={emoji}
                            className="p-1 rounded-md hover:bg-bg-surface/80 text-text-muted hover:text-text-primary transition-colors cursor-pointer text-sm leading-none"
                            onClick={() => handleToggleReaction(msg.id, emoji)}
                          >
                            {emoji}
                          </button>
                        ))}
                        <button
                          className="p-1 rounded-md hover:bg-bg-surface/80 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                          title="Add reaction"
                          onClick={() => setReactionPickerMessageId(msg.id)}
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M12 10.5h.008v.008H12v-.008zM12 4.5v.75m0 0a1.5 1.5 0 01-3 0V4.5m3 .75a1.5 1.5 0 003 0V4.5M6 10.5h.008v.008H6v-.008zm12 0h.008v.008H18v-.008zM6 16.5h.008v.008H6v-.008zm12 0h.008v.008H18v-.008zM12 16.5h.008v.008H12v-.008z"
                            />
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                        </button>
                      </div>
                      {/* Reply button — for all messages */}
                      <button
                        className="p-1.5 rounded-md hover:bg-bg-surface/80 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                        title="Reply"
                        onClick={() => setReplyingTo(msg)}
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3"
                          />
                        </svg>
                      </button>
                      {isOwnMessage && (
                        <>
                          <button
                            className="p-1.5 rounded-md hover:bg-bg-surface/80 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                            title="Edit message"
                            onClick={() => {
                              setEditingMessageId(msg.id);
                              setEditContent(msg.content);
                            }}
                          >
                            <svg
                              className="w-3.5 h-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
                              />
                            </svg>
                          </button>
                          <button
                            className="p-1.5 rounded-md hover:bg-danger/20 text-text-muted hover:text-danger transition-colors cursor-pointer"
                            title="Delete message"
                            onClick={() => {
                              useStore.getState().removeMessage(msg.id);
                              const ws = wsRef.current;
                              if (ws && ws.readyState === WebSocket.OPEN) {
                                const deleteMsg: WsClientMessage = {
                                  type: "delete_message",
                                  message_id: msg.id,
                                  channel_id: msg.channelId,
                                };
                                ws.send(JSON.stringify(deleteMsg));
                              }
                            }}
                          >
                            <svg
                              className="w-3.5 h-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                              />
                            </svg>
                          </button>
                        </>
                      )}
                      {/* Pin/Unpin */}
                      {activeServer?.type !== "p2p" && (
                        <button
                          className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                            msg.pinned_at
                              ? "text-accent bg-accent/10 hover:bg-accent/20"
                              : "text-text-muted hover:bg-bg-surface/80 hover:text-text-primary"
                          }`}
                          title={
                            msg.pinned_at ? "Unpin message" : "Pin message"
                          }
                          onClick={() =>
                            handleTogglePin(msg.id, !!msg.pinned_at)
                          }
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill={msg.pinned_at ? "currentColor" : "none"}
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                  <div
                    className={`${
                      msg.pinned_at
                        ? "bg-accent/5 border-l-2 border-accent/40 rounded-r-lg"
                        : ""
                    } transition-colors pb-1`}
                  >
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
                          {msg.editedAt && (
                            <span
                              className="text-[10px] text-text-muted italic"
                              title={`Edited ${formatTime(msg.editedAt)}`}
                            >
                              (edited)
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {isEditing ? (
                      <div className="pl-13 py-1">
                        <input
                          className="w-full bg-bg-secondary border border-accent/50 rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              const trimmed = editContent.trim();
                              if (trimmed && trimmed !== msg.content) {
                                // Optimistic edit
                                useStore.getState().updateMessage(msg.id, {
                                  content: trimmed,
                                  editedAt: new Date().toISOString(),
                                });
                                const ws = wsRef.current;
                                if (ws && ws.readyState === WebSocket.OPEN) {
                                  const editMsg: WsClientMessage = {
                                    type: "edit_message",
                                    message_id: msg.id,
                                    content: trimmed,
                                  };
                                  ws.send(JSON.stringify(editMsg));
                                }
                              }
                              setEditingMessageId(null);
                              setEditContent("");
                            } else if (e.key === "Escape") {
                              setEditingMessageId(null);
                              setEditContent("");
                            }
                          }}
                          autoFocus
                        />
                        <div className="text-[10px] text-text-muted mt-1">
                          Escape to{" "}
                          <span
                            className="text-text-secondary cursor-pointer hover:underline"
                            onClick={() => {
                              setEditingMessageId(null);
                              setEditContent("");
                            }}
                          >
                            cancel
                          </span>{" "}
                          · Enter to{" "}
                          <span
                            className="text-text-secondary cursor-pointer hover:underline"
                            onClick={() => {
                              const trimmed = editContent.trim();
                              if (trimmed && trimmed !== msg.content) {
                                // Optimistic edit
                                useStore.getState().updateMessage(msg.id, {
                                  content: trimmed,
                                  editedAt: new Date().toISOString(),
                                });
                                const ws = wsRef.current;
                                if (ws && ws.readyState === WebSocket.OPEN) {
                                  ws.send(
                                    JSON.stringify({
                                      type: "edit_message",
                                      message_id: msg.id,
                                      content: trimmed,
                                    }),
                                  );
                                }
                              }
                              setEditingMessageId(null);
                              setEditContent("");
                            }}
                          >
                            save
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="pl-13">
                        {/* Quoted replied message */}
                        {msg.repliedMessage && (
                          <div
                            className="flex items-center gap-2 mb-1 px-3 py-1.5 border-l-2 border-accent/60 bg-bg-surface/40 rounded-r-lg cursor-pointer hover:bg-bg-surface/70 transition-colors"
                            onClick={() => {
                              const idx = messages.findIndex(
                                (m) => m.id === msg.repliedMessage!.id,
                              );
                              if (idx >= 0) {
                                virtuosoRef.current?.scrollToIndex({
                                  index: idx,
                                  align: "center",
                                  behavior: "smooth",
                                });
                              }
                            }}
                          >
                            <svg
                              className="w-3 h-3 text-accent/60 flex-shrink-0"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3"
                              />
                            </svg>
                            <span className="text-[11px] text-accent font-semibold">
                              @{msg.repliedMessage.userName}
                            </span>
                            <span className="text-[11px] text-text-muted truncate">
                              {msg.repliedMessage.content}
                            </span>
                          </div>
                        )}
                        <div className="text-sm text-text-primary/90 leading-relaxed hover:bg-bg-secondary/40 transition-colors rounded-xl px-4 py-1.5 -mx-4 break-words whitespace-pre-wrap">
                          <MessageContent
                            content={msg.content}
                            server={activeServer!}
                          />
                        </div>
                      </div>
                    )}

                    {/* Reactions */}
                    {msg.reactions && msg.reactions.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2 ml-11">
                        {msg.reactions.map((g) => {
                          const hasOwn = g.user_ids.includes(
                            activeServer?.config.userId || "",
                          );
                          return (
                            <button
                              key={g.emoji}
                              title={`${g.emoji} (${g.count})`}
                              onClick={() =>
                                handleToggleReaction(msg.id, g.emoji)
                              }
                              className={`px-2 py-0.5 rounded-lg border text-[11px] font-bold flex items-center gap-1.5 transition-all duration-200 hover:scale-105 active:scale-95 ${
                                hasOwn
                                  ? "bg-primary/20 border-primary/40 text-primary shadow-sm shadow-primary/10"
                                  : "bg-bg-surface/40 border-border/40 text-text-muted hover:bg-bg-surface/60 hover:border-border/60"
                              }`}
                            >
                              <span className="text-[14px] leading-none drop-shadow-sm select-none">
                                {g.emoji.startsWith(":") ? (
                                  <EmojiImage
                                    name={g.emoji.slice(1, -1)}
                                    server={activeServer!}
                                    className="w-4 h-4 object-contain"
                                  />
                                ) : (
                                  g.emoji
                                )}
                              </span>
                              <span className="min-w-[8px] text-center tabular-nums">
                                {g.count}
                              </span>
                            </button>
                          );
                        })}
                        {/* Add reaction button (+ icon) */}
                        <button
                          className="px-2 py-0.5 rounded-lg border border-border/30 bg-bg-surface/20 text-text-muted/60 hover:text-text-muted hover:bg-bg-surface/40 hover:border-border/50 transition-all flex items-center justify-center cursor-pointer"
                          title="Add reaction"
                          onClick={() => setReactionPickerMessageId(msg.id)}
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M12 4.5v15m7.5-7.5h-15"
                            />
                          </svg>
                        </button>
                      </div>
                    )}

                    {/* Emoji Picker for this message */}
                    {reactionPickerMessageId === msg.id && (
                      <div className="absolute z-50 mt-1 ml-11">
                        <EmojiPicker
                          serverHost={activeServer!.config.host!}
                          serverPort={activeServer!.config.port!}
                          authToken={activeServer!.config.authToken}
                          guildId={activeServer!.config.guildId}
                          onSelect={(emoji) => {
                            handleToggleReaction(msg.id, emoji);
                            setReactionPickerMessageId(null);
                          }}
                          onClose={() => setReactionPickerMessageId(null)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            }}
          />
        )}
      </div>

      {/* Pins Sidebar Panel */}
      {showPins && (
        <div className="w-80 bg-bg-secondary border-l border-border/50 flex-shrink-0 overflow-y-auto">
          <PinsPanel />
        </div>
      )}

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
        {/* Reply preview bar */}
        {replyingTo && (
          <div className="flex items-center gap-2 bg-bg-secondary/80 border border-border/50 rounded-t-xl px-4 py-2 -mb-1">
            <svg
              className="w-4 h-4 text-accent flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3"
              />
            </svg>
            <span className="text-xs text-text-muted truncate flex-1">
              Replying to{" "}
              <span className="font-semibold text-accent">
                @{replyingTo.userName}
              </span>{" "}
              <span className="text-text-muted/60">
                {replyingTo.content.length > 80
                  ? replyingTo.content.slice(0, 80) + "…"
                  : replyingTo.content}
              </span>
            </span>
            <button
              className="p-1 rounded-md hover:bg-bg-surface/80 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
              onClick={() => setReplyingTo(null)}
              title="Cancel reply"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18 18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        )}

        {/* Typing Indicators Display */}
        {activeChannelId &&
          useStore.getState().typingUsers[activeChannelId] && (
            <div className="px-4 py-1 flex items-center gap-2">
              <div className="flex gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-[bounce_1s_infinite_0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-[bounce_1s_infinite_200ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-[bounce_1s_infinite_400ms]" />
              </div>
              <span className="text-[11px] text-text-muted font-medium">
                {Object.values(useStore.getState().typingUsers[activeChannelId])
                  .map((u) => u.name)
                  .join(", ")}{" "}
                {Object.keys(useStore.getState().typingUsers[activeChannelId])
                  .length === 1
                  ? "is typing..."
                  : "are typing..."}
              </span>
            </div>
          )}

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
            onChange={(e) => {
              const val = e.target.value.slice(0, MAX_MESSAGE_LENGTH);
              setInput(val);

              // Typing Start Event
              const now = Date.now();
              if (
                val.length > 0 &&
                now - lastTypingSentRef.current > 5000 &&
                wsRef.current?.readyState === WebSocket.OPEN &&
                activeChannelId
              ) {
                lastTypingSentRef.current = now;
                wsRef.current.send(
                  JSON.stringify({
                    type: "typing_start",
                    channel_id: activeChannelId,
                  }),
                );
              }
            }}
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

  // Sub-component for the pins panel to keep the main component cleaner
  function PinsPanel() {
    return (
      <div className="flex flex-col h-full bg-bg-surface shadow-2xl relative z-10">
        <div className="p-4 border-b border-border/50 flex items-center justify-between bg-bg-surface/80 backdrop-blur-md sticky top-0 z-20">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-accent/20 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-accent"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary leading-none">
                Pinned Messages
              </h3>
              <span className="text-[10px] text-text-muted font-medium uppercase tracking-wider">
                {pinnedMessages.length}{" "}
                {pinnedMessages.length === 1 ? "Pin" : "Pins"}
              </span>
            </div>
          </div>
          <button
            onClick={() => setShowPins(false)}
            className="p-1.5 rounded-lg hover:bg-bg-secondary text-text-muted hover:text-text-primary transition-all"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {isLoadingPins ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
              <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
              <span className="text-[10px] font-bold uppercase tracking-widest">
                Loading pins...
              </span>
            </div>
          ) : pinnedMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-bg-primary/20 rounded-2xl border border-dashed border-border/30">
              <div className="w-12 h-12 rounded-full bg-bg-surface flex items-center justify-center mb-4">
                <svg
                  className="w-6 h-6 text-text-muted/40"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
                  />
                </svg>
              </div>
              <h4 className="text-sm font-bold text-text-primary mb-1">
                No Pins Yet
              </h4>
              <p className="text-[11px] text-text-muted leading-relaxed">
                Important messages can be pinned to keep them accessible for
                everyone.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {pinnedMessages.map((msgWithReply) => {
                if (!msgWithReply.content) return null;
                return (
                  <div
                    key={msgWithReply.id}
                    className="group/pin p-3 rounded-xl bg-bg-surface/40 border border-border/30 hover:border-accent/30 transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded-lg bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent">
                        {msgWithReply.userName}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[11px] font-bold text-text-primary truncate leading-tight">
                          {msgWithReply.userName}
                        </span>
                        <span className="text-[9px] text-text-muted uppercase tracking-tighter">
                          {formatTime(msgWithReply.createdAt)}
                        </span>
                      </div>
                      <button
                        className="ml-auto p-1 rounded-md opacity-0 group-hover/pin:opacity-100 hover:bg-danger/10 text-text-muted hover:text-danger transition-all"
                        title="Unpin"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTogglePin(msgWithReply.id, true);
                        }}
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 18 18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                    <p className="text-xs text-text-secondary line-clamp-3 break-words">
                      {msgWithReply.content}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }
}
