import { useCallback } from "react";
import { formatFileSize } from "../../components/MessageContent";
import { useStore } from "../../store";
import { type WsClientMessage, getApiUrl, type Message } from "../../types";
import {
  encryptWithSenderKey,
  type ChannelParticipantKey,
} from "../../lib/crypto";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

interface UseChatActionsProps {
  activeServerId: string | null;
  activeChannelId: string | null;
  wsRef: React.MutableRefObject<WebSocket | null>;
  e2eEnabled: boolean;
  e2eReady: boolean;
  channelKeysRef: React.MutableRefObject<ChannelParticipantKey[]>;
  replyingTo: Message | null;
  setReplyingTo: (msg: Message | null) => void;
  setUploading: (uploading: boolean) => void;
  setInput: (input: string) => void; // Passed as a callback to clear input
}

export function useChatActions({
  activeServerId,
  activeChannelId,
  wsRef,
  e2eEnabled,
  e2eReady,
  channelKeysRef,
  replyingTo,
  setReplyingTo,
  setUploading,
  setInput,
}: UseChatActionsProps) {
  const servers = useStore((s) => s.servers);
  const displayName = useStore((s) => s.displayName);
  const messages = useStore((s) => s.messages);
  const addReaction = useStore((s) => s.addReaction);
  const removeReaction = useStore((s) => s.removeReaction);

  const activeServer = servers.find((s) => s.id === activeServerId);
  const isAuthenticated = !!activeServer?.config.authToken;

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
    [
      activeServer,
      activeChannelId,
      displayName,
      isAuthenticated,
      setUploading,
      wsRef,
    ],
  );

  const handleSend = useCallback(
    async (input: string) => {
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
    },
    [
      activeChannelId,
      activeServer,
      displayName,
      e2eEnabled,
      e2eReady,
      replyingTo,
      setReplyingTo,
      wsRef,
      channelKeysRef,
      setInput,
    ],
  );

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

  return { uploadFile, handleSend, handleToggleReaction, handleTogglePin };
}
