import React, { useState } from "react";
import { useStore } from "../../store";
import { P2PInviteModal } from "../P2PInviteModal";

interface AddServerP2PCreateProps {
  onClose: () => void;
  onBack: () => void;
}

export function AddServerP2PCreate({
  onClose,
  onBack,
}: AddServerP2PCreateProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState<{
    ticket: string;
    serverName: string;
  } | null>(null);

  if (showInviteModal) {
    return (
      <P2PInviteModal
        ticket={showInviteModal.ticket}
        serverName={showInviteModal.serverName}
        onClose={() => {
          setShowInviteModal(null);
          onClose();
        }}
      />
    );
  }

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
          Create P2P Server
        </h2>
        <p className="text-sm text-text-secondary mb-6">
          Give your new server a name.
        </p>
        <input
          type="text"
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setName(e.target.value)
          }
          placeholder="e.g. Secret Lair"
          autoFocus
          className="w-full px-4 py-3 bg-bg-input border border-border/50 rounded-xl text-text-primary outline-none focus:border-accent transition-all"
        />
        {error && <p className="text-red-400 text-sm mt-2 mb-4">{error}</p>}
        <div className="flex gap-3 mt-8">
          <button
            onClick={onBack}
            className="flex-1 py-3 text-sm font-bold text-text-muted"
          >
            Back
          </button>
          <button
            onClick={async () => {
              if (!name.trim()) {
                setError("Server name cannot be empty");
                return;
              }
              setLoading(true);
              setError("");
              try {
                await useStore.getState().createP2PServer(name.trim());
                // Get the ticket from the newly created server
                const servers = useStore.getState().servers;
                const newServer = servers[servers.length - 1];
                if (newServer?.config.p2p?.ticket) {
                  setShowInviteModal({
                    ticket: newServer.config.p2p.ticket,
                    serverName: name.trim(),
                  });
                } else {
                  onClose();
                }
              } catch (err) {
                console.error("Failed to create P2P server", err);
                setError(
                  err instanceof Error
                    ? err.message
                    : "Failed to create server. Make sure the app is running in Tauri.",
                );
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            className="flex-[2] py-3 bg-accent text-white rounded-xl font-bold disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Server"}
          </button>
        </div>
      </div>
    </div>
  );
}
