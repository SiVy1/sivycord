import { useStore } from "../../store";
import { type ServerEntry, type Channel } from "../../types";

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
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
            />
          </svg>
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
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
                />
              </svg>
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
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
