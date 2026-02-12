import { useStore } from "../store";
import { useVoice } from "../hooks/useVoice";

export function VoiceStatusPanel() {
  const voiceChannelId = useStore((s) => s.voiceChannelId);
  const channels = useStore((s) => s.channels);
  const {
    leaveVoice,
    startScreenShare,
    stopScreenShare,
    isScreenSharing,
    toggleMute,
    toggleDeafen,
    isMuted,
    isDeafened,
  } = useVoice();

  if (!voiceChannelId) return null;

  const channel = channels.find((c) => c.id === voiceChannelId);

  return (
    <div className="border-t border-border/50 px-4 py-3 bg-success/5 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full bg-success animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)] shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-success uppercase tracking-widest">
              Connected
            </div>
            <div className="text-[11px] text-text-primary truncate font-bold tracking-tight">
              {channel?.name || "Voice"}
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

      {/* Mute / Deafen / Screen Share row */}
      <div className="flex gap-2">
        {/* Mute */}
        <button
          onClick={toggleMute}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer shadow-sm active:scale-95 ${
            isMuted
              ? "bg-danger text-white shadow-danger/20"
              : "bg-bg-surface text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          }`}
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? (
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 19 17.591 17.591 5.409 5.409 4 4"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 18.75a6 6 0 0 1-5.196-3M12 18.75v3m0-3a6 6 0 0 0 5.196-3M8.25 21h7.5M12 2.25A3.75 3.75 0 0 0 8.25 6v5.25c0 .392.06.77.173 1.125M15.75 6A3.75 3.75 0 0 0 12 2.25"
              />
              <line x1="3" y1="3" x2="21" y2="21" strokeLinecap="round" />
            </svg>
          ) : (
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
              />
            </svg>
          )}
          <span>{isMuted ? "Muted" : "Mute"}</span>
        </button>

        {/* Deafen */}
        <button
          onClick={toggleDeafen}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer shadow-sm active:scale-95 ${
            isDeafened
              ? "bg-danger text-white shadow-danger/20"
              : "bg-bg-surface text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          }`}
          title={isDeafened ? "Undeafen" : "Deafen"}
        >
          {isDeafened ? (
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 12a9 9 0 0 1 18 0v3a3 3 0 0 1-3 3h-1.5a1.5 1.5 0 0 1-1.5-1.5v-3A1.5 1.5 0 0 1 16.5 12H18a9 9 0 0 0-12 0h1.5A1.5 1.5 0 0 1 9 13.5v3A1.5 1.5 0 0 1 7.5 18H6a3 3 0 0 1-3-3v-3Z"
              />
              <line x1="3" y1="3" x2="21" y2="21" strokeLinecap="round" />
            </svg>
          ) : (
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 12a9 9 0 0 1 18 0v3a3 3 0 0 1-3 3h-1.5a1.5 1.5 0 0 1-1.5-1.5v-3A1.5 1.5 0 0 1 16.5 12H18a9 9 0 0 0-12 0h1.5A1.5 1.5 0 0 1 9 13.5v3A1.5 1.5 0 0 1 7.5 18H6a3 3 0 0 1-3-3v-3Z"
              />
            </svg>
          )}
          <span>{isDeafened ? "Deaf" : "Audio"}</span>
        </button>

        {/* Screen Share */}
        <button
          onClick={isScreenSharing ? stopScreenShare : startScreenShare}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer shadow-sm active:scale-95 ${
            isScreenSharing
              ? "bg-accent text-white shadow-accent/20"
              : "bg-bg-surface text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          }`}
          title={isScreenSharing ? "Stop Sharing" : "Share Screen"}
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
          <span>{isScreenSharing ? "Stop" : "Live"}</span>
        </button>
      </div>
    </div>
  );
}
