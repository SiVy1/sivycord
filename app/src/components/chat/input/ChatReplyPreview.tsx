import { type Message } from "../../../types";

interface ChatReplyPreviewProps {
  replyingTo: Message | null;
  onCancel: () => void;
}

export function ChatReplyPreview({
  replyingTo,
  onCancel,
}: ChatReplyPreviewProps) {
  if (!replyingTo) return null;

  return (
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
        onClick={onCancel}
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
  );
}
