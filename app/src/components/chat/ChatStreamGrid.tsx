import { useState } from "react";
import { ScreenShareView } from "../ScreenShareView";
import { useStore } from "../../store";
import type { VoicePeer } from "../../types";

interface ChatStreamGridProps {
  screenShares: Map<string, MediaStream>;
  removeScreenShare: (userId: string) => void;
  voiceMembers: ReturnType<typeof useStore.getState>["voiceMembers"];
}

export function ChatStreamGrid({
  screenShares,
  removeScreenShare,
  voiceMembers,
}: ChatStreamGridProps) {
  const [showStreams, setShowStreams] = useState(true);

  if (screenShares.size === 0) return null;

  return (
    <div className="border-b border-border/50 bg-bg-secondary/30">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-accent shadow-[0_0_8px_rgba(59,130,246,0.5)] animate-pulse" />
          <span className="text-[10px] font-bold text-text-primary uppercase tracking-widest">
            Active Streams ({screenShares.size})
          </span>
        </div>
        <button
          onClick={() => setShowStreams(!showStreams)}
          className="text-[10px] font-bold text-text-muted hover:text-text-primary uppercase tracking-wider transition-colors cursor-pointer"
        >
          {showStreams ? "Collapse" : "Expand"}
        </button>
      </div>

      {showStreams && (
        <div className="px-4 pb-4">
          <div
            className={`grid gap-4 ${
              screenShares.size === 1
                ? "grid-cols-1"
                : screenShares.size === 2
                  ? "grid-cols-2"
                  : "grid-cols-3"
            }`}
          >
            {Array.from(screenShares.entries()).map(([uid, stream]) => {
              const m = voiceMembers.find((v: VoicePeer) => v.user_id === uid);
              return (
                <ScreenShareView
                  key={uid}
                  stream={stream}
                  userName={m?.user_name || "Unknown"}
                  onClose={() => removeScreenShare(uid)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
