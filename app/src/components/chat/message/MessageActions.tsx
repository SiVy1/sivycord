import React, { useState } from "react";
import { type Message, type ServerEntry } from "../../../types";
import { Plus, Clock, Reply, Pencil, Trash2, Pin, PinOff } from "lucide-react";

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
  timeOutUser: (userId: string, duration?: number) => void;
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
  const [showTimeoutModal, setShowTimeoutModal] = React.useState(false);

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
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Timeout */}
      {canTimeout && (
        <button
          className="p-1.5 rounded-md hover:bg-bg-surface/80 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          title="Timeout user"
          onClick={() => setShowTimeoutModal(true)}
        >
          <Clock className="w-3.5 h-3.5" />
        </button>
      )}
      {/* Reply button */}
      <button
        className="p-1.5 rounded-md hover:bg-bg-surface/80 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
        title="Reply"
        onClick={onReply}
      >
        <Reply className="w-3.5 h-3.5" />
      </button>

      {/* Edit/Delete for own messages */}
      {isOwnMessage && (
        <>
          <button
            className="p-1.5 rounded-md hover:bg-bg-surface/80 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
            title="Edit message"
            onClick={onEdit}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            className="p-1.5 rounded-md hover:bg-danger/20 text-text-muted hover:text-danger transition-colors cursor-pointer"
            title="Delete message"
            onClick={onDelete}
          >
            <Trash2 className="w-3.5 h-3.5" />
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
          {msg.pinned_at ? (
            <PinOff className="w-3.5 h-3.5" />
          ) : (
            <Pin className="w-3.5 h-3.5" />
          )}
        </button>
      )}
      {showTimeoutModal ? (
        <TimeoutModal
          onClose={() => setShowTimeoutModal(false)}
          timeOutUser={timeOutUser}
          msg={msg}
        />
      ) : null}
    </div>
  );
}

const TimeoutModal = ({
  msg,
  onClose,
  timeOutUser,
}: {
  msg: Message;
  timeOutUser: (userId: string, duration?: number) => void;
  onClose: () => void;
}) => {
  const [duration, setDuration] = useState("");

  const handleConfirm = () => {
    // Parse duration logic
    // simple: "10m", "1h", "30s"
    // default to seconds if no suffix
    let seconds = 300;
    const match = duration.match(/^(\d+)([smhd])?$/);
    if (match) {
      const val = parseInt(match[1]);
      const unit = match[2] || "s";
      if (unit === "m") seconds = val * 60;
      else if (unit === "h") seconds = val * 60 * 60;
      else if (unit === "d") seconds = val * 60 * 60 * 24;
      else seconds = val;
    }

    timeOutUser(msg.userId, seconds);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-bg-primary border border-border rounded-lg p-6 w-96 max-w-full shadow-2xl">
        <h3 className="text-lg font-bold text-text-primary mb-2">
          Timeout {msg.userName}
        </h3>
        <p className="text-sm text-text-muted mb-4">
          Enter duration (e.g. 10m, 1h). Default is 5m.
        </p>
        <input
          type="text"
          placeholder="5m"
          autoFocus
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          className="w-full p-2 bg-bg-secondary border border-border rounded-md mb-4 text-text-primary focus:border-accent outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleConfirm();
            if (e.key === "Escape") onClose();
          }}
        />
        <div className="flex gap-2">
          <button
            className="flex-1 bg-bg-secondary hover:bg-bg-surface text-text-primary py-2 rounded-md transition-colors"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="flex-1 bg-danger hover:bg-danger/90 text-white py-2 rounded-md transition-colors font-medium"
            onClick={handleConfirm}
          >
            Timeout
          </button>
        </div>
      </div>
    </div>
  );
};
