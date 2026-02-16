import { useStore } from "../store";
import { useVoice } from "../hooks/useVoice";
import {
  PhoneOff,
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  MonitorUp,
  MonitorX,
} from "lucide-react";

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
          <PhoneOff className="w-4 h-4" />
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
            <MicOff className="w-4 h-4" />
          ) : (
            <Mic className="w-4 h-4" />
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
            <HeadphoneOff className="w-4 h-4" />
          ) : (
            <Headphones className="w-4 h-4" />
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
          {isScreenSharing ? (
            <MonitorX className="w-4 h-4" />
          ) : (
            <MonitorUp className="w-4 h-4" />
          )}
          <span>{isScreenSharing ? "Stop" : "Live"}</span>
        </button>
      </div>
    </div>
  );
}
