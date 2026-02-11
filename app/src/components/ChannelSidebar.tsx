import { useEffect, useState } from "react";
import { useStore } from "../store";
import { VoiceStatusPanel } from "./VoiceStatusBar";
import { useVoice } from "../hooks/useVoice";
import type { Channel } from "../types";

export function ChannelSidebar() {
  const activeServerId = useStore((s) => s.activeServerId);
  const servers = useStore((s) => s.servers);
  const channels = useStore((s) => s.channels);
  const activeChannelId = useStore((s) => s.activeChannelId);
  const setChannels = useStore((s) => s.setChannels);
  const setActiveChannel = useStore((s) => s.setActiveChannel);
  const voiceChannelId = useStore((s) => s.voiceChannelId);
  const voiceMembers = useStore((s) => s.voiceMembers);
  const { joinVoice, leaveVoice } = useVoice();
  const [showCreate, setShowCreate] = useState(false);

  const activeServer = servers.find((s) => s.id === activeServerId);

  const textChannels = channels.filter(
    (c) => c.channel_type === "text" || !c.channel_type,
  );
  const voiceChannels = channels.filter((c) => c.channel_type === "voice");

  const fetchChannels = () => {
    if (!activeServer) return;
    const { host, port } = activeServer.config;
    fetch(`http://${host}:${port}/api/channels`)
      .then((r) => r.json())
      .then((data: Channel[]) => {
        setChannels(data);
        const textCh = data.filter(
          (c) => c.channel_type === "text" || !c.channel_type,
        );
        if (textCh.length > 0 && !activeChannelId) {
          setActiveChannel(textCh[0].id);
        }
      })
      .catch((err) => console.error("Failed to fetch channels:", err));
  };

  useEffect(() => {
    fetchChannels();
  }, [activeServer?.id]);

  return (
    <div className="w-60 min-w-60 bg-bg-secondary border-r border-border flex flex-col">
      {/* Server header */}
      <div className="h-12 flex items-center px-4 border-b border-border justify-between">
        <h2 className="text-sm font-semibold text-text-primary truncate">
          {activeServer?.config.serverName ||
            activeServer?.config.host ||
            "Server"}
        </h2>
        <button
          onClick={() => setShowCreate(true)}
          className="text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          title="Create channel"
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
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
        </button>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto py-2 px-2">
        {/* Text channels */}
        <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider px-2 mb-1">
          Text Channels
        </div>
        {textChannels.map((channel) => (
          <button
            key={channel.id}
            onClick={() => setActiveChannel(channel.id)}
            className={`
              w-full text-left px-3 py-1.5 rounded-lg text-sm flex items-center gap-2 cursor-pointer
              transition-colors duration-100
              ${
                activeChannelId === channel.id
                  ? "bg-bg-hover text-text-primary"
                  : "text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary"
              }
            `}
          >
            <span className="text-text-muted">#</span>
            <span className="truncate">{channel.name}</span>
          </button>
        ))}

        {/* Voice channels */}
        {voiceChannels.length > 0 && (
          <>
            <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider px-2 mb-1 mt-4">
              Voice Channels
            </div>
            {voiceChannels.map((channel) => {
              const isConnected = voiceChannelId === channel.id;
              return (
                <div key={channel.id}>
                  <button
                    onClick={() =>
                      isConnected ? leaveVoice() : joinVoice(channel.id)
                    }
                    className={`
                      w-full text-left px-3 py-1.5 rounded-lg text-sm flex items-center gap-2 cursor-pointer
                      transition-colors duration-100
                      ${
                        isConnected
                          ? "bg-bg-hover text-text-primary"
                          : "text-text-secondary hover:bg-bg-hover/50 hover:text-text-primary"
                      }
                    `}
                  >
                    <svg
                      className="w-4 h-4 text-text-muted shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z"
                      />
                    </svg>
                    <span className="truncate">{channel.name}</span>
                    {isConnected && (
                      <div className="ml-auto w-2 h-2 rounded-full bg-success animate-pulse" />
                    )}
                  </button>
                  {isConnected && voiceMembers.length > 0 && (
                    <div className="ml-6 mt-0.5 mb-1 space-y-0.5">
                      {voiceMembers.map((m) => (
                        <div
                          key={m.user_id}
                          className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-text-muted"
                        >
                          <div className="w-1.5 h-1.5 rounded-full bg-success" />
                          {m.user_name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Voice status bar */}
      <VoiceStatusPanel leaveVoice={leaveVoice} />

      {/* User footer */}
      <div className="h-12 flex items-center px-3 border-t border-border gap-2">
        <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-xs font-semibold text-accent">
          {useStore.getState().displayName[0]?.toUpperCase()}
        </div>
        <span className="text-xs text-text-secondary truncate">
          {useStore.getState().displayName}
        </span>
      </div>

      {/* Create channel modal */}
      {showCreate && activeServer && (
        <CreateChannelModal
          server={activeServer}
          onClose={() => setShowCreate(false)}
          onCreated={fetchChannels}
        />
      )}
    </div>
  );
}

function CreateChannelModal({
  server,
  onClose,
  onCreated,
}: {
  server: { config: { host: string; port: number } };
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"text" | "voice">("text");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    const trimmed = name.trim().toLowerCase().replace(/\s+/g, "-");
    if (!trimmed) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(
        `http://${server.config.host}:${server.config.port}/api/channels`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmed,
            description: "",
            channel_type: type,
          }),
        },
      );

      if (!res.ok) throw new Error("Failed to create channel");

      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm mx-4 bg-bg-secondary border border-border rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-text-primary mb-4">
          Create Channel
        </h3>

        {/* Type selector */}
        <div className="flex gap-1 bg-bg-input rounded-lg p-1 mb-4">
          <button
            onClick={() => setType("text")}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
              type === "text"
                ? "bg-bg-hover text-text-primary"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <span>#</span> Text
          </button>
          <button
            onClick={() => setType("voice")}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
              type === "voice"
                ? "bg-bg-hover text-text-primary"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z"
              />
            </svg>
            Voice
          </button>
        </div>

        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          placeholder="channel-name"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          className="w-full px-4 py-2.5 bg-bg-input border border-border rounded-xl text-text-primary placeholder:text-text-muted text-sm outline-none focus:border-accent transition-colors"
        />

        {error && <p className="text-danger text-xs mt-2">{error}</p>}

        <div className="flex gap-3 mt-4">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-border rounded-xl text-sm text-text-secondary hover:bg-bg-hover transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading || !name.trim()}
            className="flex-1 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors cursor-pointer"
          >
            {loading ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
