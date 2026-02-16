import React from "react";
import { Network, Ticket, Server } from "lucide-react";

type Mode = "choice" | "legacy" | "p2p-create" | "p2p-join";

interface AddServerChoiceProps {
  onClose: () => void;
  setMode: (mode: Mode) => void;
}

export function AddServerChoice({ onClose, setMode }: AddServerChoiceProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md mx-4 bg-bg-secondary border border-border/50 rounded-3xl p-8 shadow-2xl relative"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <h2 className="text-2xl font-bold text-text-primary mb-2 tracking-tight">
          Add a Server
        </h2>
        <p className="text-sm text-text-secondary mb-8">
          Choose how you want to connect.
        </p>

        <div className="grid grid-cols-1 gap-4">
          <button
            onClick={() => setMode("p2p-create")}
            className="group p-6 bg-bg-surface border border-border/40 hover:border-accent/40 rounded-2xl text-left transition-all hover:shadow-lg hover:shadow-accent/5"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center text-accent group-hover:bg-accent group-hover:text-white transition-all">
                <Network className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-text-primary">
                  Create P2P Server
                </h3>
                <p className="text-xs text-text-muted">
                  Private, decentralized, and serverless.
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => setMode("p2p-join")}
            className="group p-6 bg-bg-surface border border-border/40 hover:border-accent/40 rounded-2xl text-left transition-all hover:shadow-lg hover:shadow-accent/5"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center text-accent group-hover:bg-accent group-hover:text-white transition-all">
                <Ticket className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-text-primary">Join P2P Server</h3>
                <p className="text-xs text-text-muted">
                  Enter a Ticket (invite code) to join.
                </p>
              </div>
            </div>
          </button>

          <div className="relative py-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border/20"></div>
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-bg-secondary px-2 text-text-muted uppercase tracking-widest font-bold">
                Or
              </span>
            </div>
          </div>

          <button
            onClick={() => setMode("legacy")}
            className="group p-6 bg-bg-surface/50 border border-border/20 hover:border-text-muted/40 rounded-2xl text-left transition-all"
          >
            <div className="flex items-center gap-4 opacity-70 group-hover:opacity-100 transition-opacity">
              <div className="w-12 h-12 rounded-xl bg-text-muted/10 flex items-center justify-center text-text-muted group-hover:bg-text-muted group-hover:text-white transition-all">
                <Server className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-text-primary">Classic Server</h3>
                <p className="text-xs text-text-muted">
                  Connect to a self-hosted instance.
                </p>
              </div>
            </div>
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full mt-8 py-3 text-sm font-bold text-text-muted hover:text-text-primary transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}
