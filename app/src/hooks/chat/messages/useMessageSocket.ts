import { useCallback } from "react";
import { useStore } from "../../../store";
import { type WsServerMessage } from "../../../types";
import {
  decryptWithSenderKey,
  decryptChannelMessage,
  isChannelEncrypted as isMsgChannelEncrypted,
  isSenderKeyDistribution,
  isSenderKeyMessage,
  processSenderKeyDistribution,
  type ChannelParticipantKey,
} from "../../../lib/crypto";
import { setTalkingDirect } from "../../../hooks/talkingStore";

interface UseMessageSocketProps {
  activeServerId: string | null;
  channelKeysRef: React.MutableRefObject<ChannelParticipantKey[]>;
  seenMsgIds: React.MutableRefObject<Set<string>>;
}

export function useMessageSocket({
  activeServerId,
  channelKeysRef,
  seenMsgIds,
}: UseMessageSocketProps) {
  const servers = useStore((s) => s.servers);
  const addMessage = useStore((s) => s.addMessage);

  const activeServer = servers.find((s) => s.id === activeServerId);

  const handleWsMessage = useCallback(
    (data: WsServerMessage) => {
      try {
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
        } else if (data.type === "user_timedout") {
          const myUserId = activeServer?.config.userId;
          if (myUserId && data.user_id === myUserId) {
            const finishTime = Date.now() + data.duration_seconds * 1000;
            useStore.getState().setTimeoutFinishTime(finishTime);
          }
        }
      } catch (err) {
        console.error("Failed to process WS message:", err);
      }
    },
    [activeServer, channelKeysRef, addMessage],
  );

  return { handleWsMessage };
}
