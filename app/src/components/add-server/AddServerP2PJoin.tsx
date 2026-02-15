import React, { useState } from "react";
import { useStore } from "../../store";

interface AddServerP2PJoinProps {
  onClose: () => void;
  onBack: () => void;
}

export function AddServerP2PJoin({ onClose, onBack }: AddServerP2PJoinProps) {
  const [ticket, setTicket] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md mx-4 bg-bg-secondary border border-border/50 rounded-3xl p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-2xl font-bold text-text-primary mb-2">
          Join P2P Server
        </h2>
        <p className="text-sm text-text-secondary mb-6">
          Enter the ticket provided by your friend.
        </p>
        <textarea
          value={ticket}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            setTicket(e.target.value)
          }
          placeholder="Paste ticket here..."
          className="w-full px-4 py-3 bg-bg-input border border-border/50 rounded-xl text-text-primary outline-none focus:border-accent transition-all h-32 mb-8 font-mono text-xs"
        />
        {error && (
          <p className="text-danger text-xs mb-4 text-center">{error}</p>
        )}
        <div className="flex gap-3">
          <button
            onClick={onBack}
            className="flex-1 py-3 text-sm font-bold text-text-muted"
          >
            Back
          </button>
          <button
            onClick={async () => {
              if (!ticket.trim()) {
                setError("Ticket cannot be empty");
                return;
              }
              setLoading(true);
              setError("");
              try {
                await useStore
                  .getState()
                  .joinP2PServer("P2P Server", ticket.trim());
                onClose();
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Failed to join P2P server",
                );
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            className="flex-[2] py-3 bg-accent text-white rounded-xl font-bold disabled:opacity-50"
          >
            {loading ? "Joining..." : "Join"}
          </button>
        </div>
      </div>
    </div>
  );
}
