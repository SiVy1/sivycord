import { type Message, type ServerEntry } from "../../../types";
import { EmojiImage } from "../../MessageContent";

interface MessageReactionsProps {
  msg: Message;
  activeUserId: string | undefined;
  activeServer: ServerEntry | undefined;
  onToggleReaction: (emoji: string) => void;
  onOpenPicker: () => void;
}

export function MessageReactions({
  msg,
  activeUserId,
  activeServer,
  onToggleReaction,
  onOpenPicker,
}: MessageReactionsProps) {
  if (!msg.reactions || msg.reactions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2 ml-11">
      {msg.reactions.map((g) => {
        const hasOwn = g.user_ids.includes(activeUserId || "");
        return (
          <button
            key={g.emoji}
            title={`${g.emoji} (${g.count})`}
            onClick={() => onToggleReaction(g.emoji)}
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
        onClick={onOpenPicker}
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
  );
}
