import { type ServerEntry, type Channel } from "../../types";
import { Lock, Users2, Pin } from "lucide-react";

interface ChatHeaderProps {
  activeChannel: Channel | undefined;
  activeServer: ServerEntry | undefined;
  showMembers: boolean;
  onToggleMembers?: () => void;
  showPins: boolean;
  setShowPins: (show: boolean) => void;
  e2eReady: boolean;
}

export function ChatHeader({
  activeChannel,
  activeServer,
  showMembers,
  onToggleMembers,
  showPins,
  setShowPins,
  e2eReady,
}: ChatHeaderProps) {
  return (
    <div className="h-12 flex items-center px-4 border-b border-border/20 bg-bg-primary sticky top-0 z-10 backdrop-blur-sm bg-opacity-95">
      <div className="flex items-center gap-2 text-text-secondary/80 text-sm">
        <span className="font-medium hover:text-text-primary transition-colors cursor-pointer">
          {activeServer?.config.serverName ||
            activeServer?.config.host ||
            "Server"}
        </span>
        <span className="text-text-muted/50">/</span>
        <div className="flex items-center gap-1.5 text-text-primary font-bold">
          <span className="text-text-muted">#</span>
          {activeChannel?.name || "channel"}
        </div>
      </div>

      {/* E2E encryption indicator */}
      {activeChannel?.encrypted && (
        <div
          className={`ml-3 flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-wider ${
            e2eReady
              ? "bg-green-500/5 border-green-500/20 text-green-500/80"
              : "bg-yellow-500/5 border-yellow-500/20 text-yellow-500/80 animate-pulse"
          }`}
          title={e2eReady ? "End-to-End Encrypted" : "Setting up encryption..."}
        >
          <Lock className="w-2.5 h-2.5" />
          {e2eReady ? "E2E" : "..."}
        </div>
      )}

      <div className="ml-auto flex items-center gap-4">
        {/* Search could go here */}

        {/* Pins Button */}
        {activeServer?.type !== "p2p" && (
          <button
            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
              showPins
                ? "bg-accent/20 text-accent"
                : "text-text-muted hover:text-text-primary hover:bg-bg-surface/50"
            }`}
            title="Pinned Messages"
            onClick={() => setShowPins(!showPins)}
          >
            <Pin className="w-4 h-4" />
          </button>
        )}

        {/* Members toggle button */}
        {onToggleMembers && (
          <button
            onClick={onToggleMembers}
            className={`p-1 rounded-md transition-colors cursor-pointer group relative ${
              showMembers
                ? "text-text-primary"
                : "text-text-muted hover:text-text-primary"
            }`}
            title={showMembers ? "Hide Members" : "Show Members"}
          >
            <Users2 className="w-5 h-5" />
            {/* Simple badge if needed, or overlay overlapping avatars */}
          </button>
        )}
      </div>
    </div>
  );
}
