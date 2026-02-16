import { useStore } from "../../store";
import { type ServerEntry, type Channel } from "../../types";
import { Lock, Pin, Users2 } from "lucide-react";

interface ChatHeaderProps {
  activeChannel: Channel | undefined;
  activeServer: ServerEntry | undefined;
  showMembers: boolean;
  onToggleMembers?: () => void;
  showPins: boolean;
  setShowPins: (show: boolean) => void;
  wsStatus: "connecting" | "connected" | "disconnected";
  e2eReady: boolean;
}

export function ChatHeader({
  activeChannel,
  activeServer,
  showMembers,
  onToggleMembers,
  showPins,
  setShowPins,
  wsStatus,
  e2eReady,
}: ChatHeaderProps) {
  const nodeId = useStore((s) => s.nodeId);
  console.log(wsStatus, "wsStatus in ChatHeader");
  return (
    <div className="h-14 flex items-center px-6 border-b border-border/50 gap-3 bg-bg-primary/80 backdrop-blur-md sticky top-0 z-10">
      <span className="text-xl font-medium text-text-muted">#</span>
      <h3 className="text-sm font-bold text-text-primary tracking-tight">
        {activeChannel?.name || "channel"}
      </h3>
      {activeChannel?.description && (
        <>
          <div className="w-px h-4 bg-border/50 mx-1" />
          <span className="text-xs text-text-muted truncate max-w-md">
            {activeChannel.description}
          </span>
        </>
      )}
      {/* E2E encryption indicator */}
      {activeChannel?.encrypted && (
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider ${
            e2eReady
              ? "bg-green-500/10 border-green-500/30 text-green-400"
              : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400 animate-pulse"
          }`}
          title={e2eReady ? "End-to-End Encrypted" : "Setting up encryption..."}
        >
          <Lock className="w-3 h-3" />
          {e2eReady ? "E2E" : "..."}
        </div>
      )}
      <div className="ml-auto flex items-center gap-3">
        {activeServer?.type === "p2p" ? (
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-2 bg-accent/10 hover:bg-accent/20 px-3 py-1 rounded-full border border-accent/20 cursor-pointer transition-all active:scale-95"
              onClick={() => {
                if (activeServer.config.p2p?.ticket) {
                  navigator.clipboard.writeText(activeServer.config.p2p.ticket);
                  // Could add a toast here
                }
              }}
              title="Click to copy Invite Ticket"
            >
              <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              <span className="text-[10px] font-bold text-accent uppercase tracking-widest">
                P2P Network
              </span>
            </div>
            <div className="bg-bg-secondary px-2.5 py-1 rounded-full border border-border/50">
              <span className="text-[10px] font-bold text-text-muted">
                ID:{" "}
              </span>
              <span className="text-[10px] font-mono font-bold text-text-secondary">
                {nodeId?.substring(0, 8)}...
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 bg-bg-secondary px-2.5 py-1 rounded-full border border-border/50">
              <div
                className={`w-2 h-2 rounded-full ${
                  wsStatus === "connected"
                    ? "bg-success shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                    : wsStatus === "connecting"
                      ? "bg-yellow-400 animate-pulse"
                      : "bg-danger shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                }`}
              />
              <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">
                {wsStatus === "connected"
                  ? "Online"
                  : wsStatus === "connecting"
                    ? "Connecting"
                    : "Offline"}
              </span>
            </div>

            {/* Pins Button */}
            <button
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                showPins
                  ? "bg-accent/20 text-accent"
                  : "text-text-muted hover:text-text-primary hover:bg-bg-surface/60"
              }`}
              title="Pinned Messages"
              onClick={() => setShowPins(!showPins)}
            >
              <Pin className="w-5 h-5" />
            </button>
          </>
        )}
        {/* Members toggle button */}
        {onToggleMembers && (
          <button
            onClick={onToggleMembers}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              showMembers
                ? "bg-accent/20 text-accent"
                : "text-text-muted hover:text-text-primary hover:bg-bg-surface/60"
            }`}
            title={showMembers ? "Hide Members" : "Show Members"}
          >
            <Users2 className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}
