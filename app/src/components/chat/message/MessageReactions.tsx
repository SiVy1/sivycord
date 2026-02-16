import { type Message, type ServerEntry } from "../../../types";
import { EmojiImage } from "../../MessageContent";
import { Plus } from "lucide-react";

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
            className={`px-2 py-0.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer border ${
              hasOwn
                ? "bg-accent/20 border-accent/30 text-accent"
                : "bg-bg-tertiary/50 border-transparent hover:bg-bg-tertiary hover:border-bg-tertiary text-text-muted"
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
        className="px-2 py-0.5 rounded-lg bg-bg-tertiary/30 text-text-muted/60 hover:text-text-primary hover:bg-bg-tertiary transition-all flex items-center justify-center cursor-pointer"
        title="Add reaction"
        onClick={onOpenPicker}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
