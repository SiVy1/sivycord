import { type Message, type ServerEntry } from "../../../types";

interface MessageActionsProps {
  msg: Message;
  isOwnMessage: boolean;
  activeServer: ServerEntry | undefined;
  onToggleReaction: (emoji: string) => void;
  onOpenReactionPicker: () => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  timeOutUser: (userId: string) => void;
  canTimeout: boolean;
}

export function MessageActions({
  msg,
  isOwnMessage,
  activeServer,
  onToggleReaction,
  onOpenReactionPicker,
  onReply,
  onEdit,
  onDelete,
  onTogglePin,
  timeOutUser,
  canTimeout,
}: MessageActionsProps) {
  return (
    <div className="absolute right-4 -top-2 hidden group-hover:flex items-center gap-0.5 bg-bg-secondary border border-border/50 rounded-lg shadow-lg px-1 py-0.5 z-10 transition-all animate-in fade-in duration-200">
      {/* Quick Reactions */}
      <div className="flex items-center gap-0.5 pr-1 mr-1 border-r border-border/50">
        {["👍", "❤️", "😂", "🎉"].map((emoji) => (
          <button
            key={emoji}
            className="p-1 rounded-md hover:bg-bg-surface/80 text-text-muted hover:text-text-primary transition-colors cursor-pointer text-sm leading-none"
            onClick={() => onToggleReaction(emoji)}
          >
            {emoji}
          </button>
        ))}
        <button
          className="p-1 rounded-md hover:bg-bg-surface/80 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          title="Add reaction"
          onClick={onOpenReactionPicker}
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
              d="M12 10.5h.008v.008H12v-.008zM12 4.5v.75m0 0a1.5 1.5 0 01-3 0V4.5m3 .75a1.5 1.5 0 003 0V4.5M6 10.5h.008v.008H6v-.008zm12 0h.008v.008H18v-.008zM6 16.5h.008v.008H6v-.008zm12 0h.008v.008H18v-.008zM12 16.5h.008v.008H12v-.008z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>
      </div>

      {/* Timeout */}
      {canTimeout && (
        <button
          className="p-1.5 rounded-md hover:bg-bg-surface/80 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          title="Timeout user"
          onClick={() => timeOutUser(msg.userId)}
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
              d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3"
            />
          </svg>
        </button>
      )}
      {/* Reply button */}
      <button
        className="p-1.5 rounded-md hover:bg-bg-surface/80 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
        title="Reply"
        onClick={onReply}
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
            d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3"
          />
        </svg>
      </button>

      {/* Edit/Delete for own messages */}
      {isOwnMessage && (
        <>
          <button
            className="p-1.5 rounded-md hover:bg-bg-surface/80 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
            title="Edit message"
            onClick={onEdit}
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
                d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
              />
            </svg>
          </button>
          <button
            className="p-1.5 rounded-md hover:bg-danger/20 text-text-muted hover:text-danger transition-colors cursor-pointer"
            title="Delete message"
            onClick={onDelete}
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
                d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
              />
            </svg>
          </button>
        </>
      )}

      {/* Pin/Unpin */}
      {activeServer?.type !== "p2p" && (
        <button
          className={`p-1.5 rounded-md transition-colors cursor-pointer ${
            msg.pinned_at
              ? "text-accent bg-accent/10 hover:bg-accent/20"
              : "text-text-muted hover:bg-bg-surface/80 hover:text-text-primary"
          }`}
          title={msg.pinned_at ? "Unpin message" : "Pin message"}
          onClick={onTogglePin}
        >
          <svg
            className="w-3.5 h-3.5"
            fill={msg.pinned_at ? "currentColor" : "none"}
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
