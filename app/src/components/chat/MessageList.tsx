import { useRef, useEffect, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { type ServerEntry, type Message } from "../../types";
import { MessageItem } from "./MessageItem";

interface MessageListProps {
  messages: Message[];
  activeServer: ServerEntry | undefined;
  activeChannelId: string | null;
  loadOlderMessages: () => void;
  hasMoreMessages: boolean;
  isLoadingMore: boolean;
  wsRef: React.MutableRefObject<WebSocket | null>;
  setReplyingTo: (msg: Message) => void;
  handleTogglePin: (messageId: string, isPinned: boolean) => void;
  handleToggleReaction: (messageId: string, emoji: string) => void;
}

export function MessageList({
  messages,
  activeServer,
  activeChannelId,
  loadOlderMessages,
  hasMoreMessages,
  isLoadingMore,
  wsRef,
  setReplyingTo,
  handleTogglePin,
  handleToggleReaction,
}: MessageListProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);

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
  }, [messages.length, atBottom]);

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
    <div className="flex-1 overflow-hidden">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-text-muted text-sm">No messages yet. Say hi! 👋</p>
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
            return (
              <MessageItem
                key={msg.id}
                msg={msg}
                previousMessageUserId={
                  index > 0 ? messages[index - 1].userId : ""
                }
                activeServer={activeServer}
                activeChannelId={activeChannelId}
                wsRef={wsRef}
                setReplyingTo={setReplyingTo}
                handleTogglePin={handleTogglePin}
                handleToggleReaction={handleToggleReaction}
              />
            );
          }}
        />
      )}
    </div>
  );
}
