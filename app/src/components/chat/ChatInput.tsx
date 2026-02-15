import { useState } from "react";
import { EmojiPicker } from "../EmojiPicker";
import { type ServerEntry, type Message } from "../../types";
import { useStore } from "../../store";
import { ChatReplyPreview } from "./input/ChatReplyPreview";
import { ChatTypingIndicators } from "./input/ChatTypingIndicators";
import { ChatFileUpload } from "./input/ChatFileUpload";

const MAX_MESSAGE_LENGTH = 2000;

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  onSend: (input: string) => void;
  activeServer: ServerEntry | undefined;
  activeChannelId: string | null;
  wsStatus: "connecting" | "connected" | "disconnected";
  isAuthenticated: boolean;
  uploading: boolean;
  onUploadFile: (file: File) => void;
  replyingTo: Message | null;
  setReplyingTo: (msg: Message | null) => void;
  lastTypingSentRef: React.MutableRefObject<number>;
  wsRef: React.MutableRefObject<WebSocket | null>;
}

export function ChatInput({
  input,
  setInput,
  onSend,
  activeServer,
  activeChannelId,
  wsStatus,
  isAuthenticated,
  uploading,
  onUploadFile,
  replyingTo,
  setReplyingTo,
  lastTypingSentRef,
  wsRef,
}: ChatInputProps) {
  const [showEmoji, setShowEmoji] = useState(false);
  const activeChannel = useStore((s) =>
    s.channels.find((c) => c.id === activeChannelId),
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend(input);
    }
  };

  return (
    <div className="px-4 pb-4">
      <div className="relative">
        {showEmoji && activeServer && (
          <>
            {activeServer.type === "legacy" &&
              activeServer.config.host &&
              activeServer.config.port && (
                <EmojiPicker
                  onSelect={(emoji: string) => setInput(input + emoji)}
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

      <ChatReplyPreview
        replyingTo={replyingTo}
        onCancel={() => setReplyingTo(null)}
      />

      <ChatTypingIndicators activeChannelId={activeChannelId} />

      <div className="bg-bg-secondary border border-border/50 rounded-2xl flex items-end shadow-lg focus-within:border-accent/50 focus-within:ring-4 focus-within:ring-accent/5 transition-all">
        <ChatFileUpload
          isAuthenticated={isAuthenticated}
          isConnected={wsStatus === "connected"}
          uploading={uploading}
          onUploadFile={onUploadFile}
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
          onClick={() => onSend(input)}
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
  );
}
