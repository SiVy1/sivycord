import { useStore } from "../store";

export function VoiceStatusPanel({ leaveVoice }: { leaveVoice: () => void }) {
  const voiceChannelId = useStore((s) => s.voiceChannelId);
  const channels = useStore((s) => s.channels);

  if (!voiceChannelId) return null;

  const channel = channels.find((c) => c.id === voiceChannelId);

  return (
    <div className="border-t border-border px-3 py-2 bg-success/5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-medium text-success">
              Voice Connected
            </div>
            <div className="text-[10px] text-text-muted truncate">
              {channel?.name || "Unknown"}
            </div>
          </div>
        </div>
        <button
          onClick={leaveVoice}
          className="p-1.5 rounded-lg hover:bg-danger/20 text-text-muted hover:text-danger transition-colors cursor-pointer"
          title="Disconnect"
        >
          <svg
            className="w-4 h-4"
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
    </div>
  );
}
