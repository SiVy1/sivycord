import { useEffect, useCallback } from "react";
import { useStore } from "../../../store";
import { type ApiMessage, type ChatEntry, getApiUrl } from "../../../types";

const MESSAGES_PER_PAGE = 50;

interface UseMessageFetcherProps {
  activeServerId: string | null;
  activeChannelId: string | null;
  seenMsgIds: React.MutableRefObject<Set<string>>;
}

export function useMessageFetcher({
  activeServerId,
  activeChannelId,
  seenMsgIds,
}: UseMessageFetcherProps) {
  const servers = useStore((s) => s.servers);
  const messages = useStore((s) => s.messages);
  const setMessages = useStore((s) => s.setMessages);
  const prependMessages = useStore((s) => s.prependMessages);
  const hasMoreMessages = useStore((s) => s.hasMoreMessages);
  const isLoadingMore = useStore((s) => s.isLoadingMore);
  const setHasMoreMessages = useStore((s) => s.setHasMoreMessages);
  const setIsLoadingMore = useStore((s) => s.setIsLoadingMore);

  const activeServer = servers.find((s) => s.id === activeServerId);

  // Fetch initial message history
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

  // Load older messages (infinite scroll)
  const loadOlderMessages = useCallback(async () => {
    if (!activeServer || !activeChannelId || isLoadingMore || !hasMoreMessages)
      return;
    if (activeServer.type === "p2p") return;

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

  return { loadOlderMessages };
}
