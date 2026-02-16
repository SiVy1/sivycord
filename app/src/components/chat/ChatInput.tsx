import { useState, useEffect } from "react";
import { EmojiPicker } from "../EmojiPicker";
import { type ServerEntry, type Message } from "../../types";
import { useStore } from "../../store";
import { ChatReplyPreview } from "./input/ChatReplyPreview";
import { ChatTypingIndicators } from "./input/ChatTypingIndicators";

import { Clock, ArrowUp, Plus, AtSign, Braces } from "lucide-react";

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
  const timeoutFinishTime = useStore((s) => s.timeoutFinishTime);
  const [now, setNow] = useState(Date.now());

  // Update timer every second if timed out
  useEffect(() => {
    if (!timeoutFinishTime || timeoutFinishTime < now) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [timeoutFinishTime, now]);

  const isTimedOut = timeoutFinishTime ? timeoutFinishTime > now : false;

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

      {isTimedOut && timeoutFinishTime && (
        <div className="mb-2 bg-red-500/10 border border-red-500/20 text-red-500 text-xs px-3 py-1.5 rounded flex items-center gap-2">
          <Clock className="w-4 h-4" />
          <span>
            You are timed out. You can send messages again in{" "}
            <span className="font-bold">
              {Math.ceil((timeoutFinishTime - now) / 1000)}s
            </span>
            .
          </span>
        </div>
      )}

      <div className="bg-bg-primary/50 border border-border/30 hover:border-border/50 focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/50 rounded-xl transition-all mx-2 flex flex-col">
        {/* Top: Text Input */}
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
                  : isTimedOut
                    ? `You are timed out for ${Math.ceil((timeoutFinishTime! - now) / 1000)}s`
                    : `Message #${activeChannel?.name || "channel"}...`
          }
          disabled={
            isTimedOut ||
            (activeServer?.type !== "p2p" &&
              (wsStatus !== "connected" || !isAuthenticated))
          }
          rows={1}
          className="w-full bg-transparent resize-none px-4 py-3 text-sm text-text-primary placeholder:text-text-muted/40 outline-none disabled:opacity-50 min-h-[44px] max-h-[300px]"
        />

        {/* Bottom: Toolbar */}
        <div className="flex items-center justify-between px-2 pb-2">
          {/* Left Actions */}
          <div className="flex items-center gap-1">
            <button
              className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors"
              onClick={() => document.getElementById("file-upload")?.click()}
              title="Upload File"
            >
              <Plus className="w-5 h-5" />
            </button>
            {/* Hidden File Upload Input */}
            <input
              type="file"
              id="file-upload"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  onUploadFile(e.target.files[0]);
                }
              }}
              disabled={!isAuthenticated || !activeChannelId || uploading}
            />

            <button
              className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors"
              onClick={() => setInput(input + "@")}
              title="Mention User"
            >
              <AtSign className="w-5 h-5" />
            </button>
            <button
              className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors"
              onClick={() => setInput(input + "```\n\n```")}
              title="Code Block"
            >
              <Braces className="w-5 h-5" />
            </button>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => onSend(input)}
              disabled={
                !input.trim() || wsStatus !== "connected" || !isAuthenticated
              }
              className="p-2 rounded-lg bg-bg-tertiary text-text-primary disabled:text-text-muted disabled:bg-transparent hover:bg-accent hover:text-white transition-all cursor-pointer"
            >
              <ArrowUp className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {uploading && (
        <div className="text-[10px] text-accent mt-1 animate-pulse px-2">
          Uploading file...
        </div>
      )}
      {input.length > MAX_MESSAGE_LENGTH - 100 && (
        <div className="text-[10px] text-text-muted text-right mt-1 px-2">
          {input.length}/{MAX_MESSAGE_LENGTH}
        </div>
      )}
    </div>
  );
}
