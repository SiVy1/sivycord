import { useEffect, useState } from "react";
import { useStore } from "../../store";
import {
  type ServerEntry,
  type Message,
  type WsClientMessage,
  PERMISSIONS,
  hasPermissionForUser,
} from "../../types";
import { MessageContent } from "../MessageContent";
import { EmojiPicker } from "../EmojiPicker";
import { MessageActions } from "./message/MessageActions";
import { MessageHeader } from "./message/MessageHeader";
import { MessageReactions } from "./message/MessageReactions";

interface MessageItemProps {
  msg: Message;
  previousMessageUserId: string;
  activeServer: ServerEntry | undefined;
  activeChannelId: string;
  wsRef: React.MutableRefObject<WebSocket | null>;
  setReplyingTo: (msg: Message) => void;
  handleTogglePin: (messageId: string, isPinned: boolean) => void;
  handleToggleReaction: (messageId: string, emoji: string) => void;
}

export function MessageItem({
  msg,
  previousMessageUserId,
  activeServer,
  activeChannelId,
  wsRef,
  setReplyingTo,
  handleTogglePin,
  handleToggleReaction,
}: MessageItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [canTimeout, setCanTimeout] = useState<boolean>(false);

  const activeUserId = activeServer?.config.userId;
  const isOwnMessage = msg.userId === activeUserId;
  const showHeader = previousMessageUserId !== msg.userId;

  const handleDelete = () => {
    useStore.getState().removeMessage(msg.id);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const deleteMsg: WsClientMessage = {
        type: "delete_message",
        message_id: msg.id,
        channel_id: activeChannelId,
      };
      ws.send(JSON.stringify(deleteMsg));
    }
  };

  const handleEditSave = () => {
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
    setIsEditing(false);
    setEditContent("");
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!activeServer || !activeUserId) {
        if (mounted) setCanTimeout(false);
        return;
      }
      try {
        const ok = await hasPermissionForUser(
          activeServer,
          activeUserId,
          PERMISSIONS.KICK_MEMBERS,
        );
        if (mounted) setCanTimeout(!!ok);
      } catch (e) {
        if (mounted) setCanTimeout(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [activeServer, activeUserId]);

  const timeOutUser = async (userId: string, duration: number = 300) => {
    if (!activeServer) return;
    if (canTimeout) {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        const timeoutMsg: WsClientMessage = {
          type: "timeout_user",
          user_id: userId,
          duration_seconds: duration,
        };
        ws.send(JSON.stringify(timeoutMsg));
      }
    } else {
      alert("You do not have permission to timeout users.");
    }
  };

  return (
    <div className={`group relative px-4 ${showHeader ? "mt-3" : ""}`}>
      {/* Hover action buttons */}
      {!isEditing && (
        <MessageActions
          msg={msg}
          isOwnMessage={isOwnMessage}
          activeServer={activeServer}
          onToggleReaction={(emoji) => handleToggleReaction(msg.id, emoji)}
          onOpenReactionPicker={() => setReactionPickerOpen(true)}
          onReply={() => setReplyingTo(msg)}
          onEdit={() => {
            setIsEditing(true);
            setEditContent(msg.content);
          }}
          onDelete={handleDelete}
          onTogglePin={() => handleTogglePin(msg.id, !!msg.pinned_at)}
          timeOutUser={timeOutUser}
          canTimeout={canTimeout}
        />
      )}

      <div
        className={`${
          msg.pinned_at
            ? "bg-accent/5 border-l-2 border-accent/40 rounded-r-lg"
            : ""
        } transition-colors pb-1`}
      >
        {showHeader && <MessageHeader msg={msg} activeServer={activeServer} />}

        {isEditing ? (
          <div className="pl-13 py-1">
            <input
              className="w-full bg-bg-secondary border border-accent/50 rounded-lg px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleEditSave();
                } else if (e.key === "Escape") {
                  setIsEditing(false);
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
                  setIsEditing(false);
                  setEditContent("");
                }}
              >
                cancel
              </span>{" "}
              · Enter to{" "}
              <span
                className="text-text-secondary cursor-pointer hover:underline"
                onClick={handleEditSave}
              >
                save
              </span>
            </div>
          </div>
        ) : (
          <div className="pl-13">
            {/* Quoted replied message */}
            {msg.repliedMessage && (
              <div className="flex items-center gap-2 mb-1 px-3 py-1.5 border-l-2 border-accent/60 bg-bg-surface/40 rounded-r-lg cursor-pointer hover:bg-bg-surface/70 transition-colors">
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
              <MessageContent content={msg.content} server={activeServer!} />
            </div>
          </div>
        )}

        {/* Reactions */}
        <MessageReactions
          msg={msg}
          activeUserId={activeUserId}
          activeServer={activeServer}
          onToggleReaction={(emoji) => handleToggleReaction(msg.id, emoji)}
          onOpenPicker={() => setReactionPickerOpen(true)}
        />

        {/* Emoji Picker for this message */}
        {reactionPickerOpen && activeServer && (
          <div className="absolute z-50 mt-1 ml-11">
            <EmojiPicker
              serverHost={activeServer.config.host || ""}
              serverPort={activeServer.config.port || 0}
              authToken={activeServer.config.authToken}
              guildId={activeServer.config.guildId}
              onSelect={(emoji) => {
                handleToggleReaction(msg.id, emoji);
                setReactionPickerOpen(false);
              }}
              onClose={() => setReactionPickerOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
