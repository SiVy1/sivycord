import { useEffect, useState, memo } from "react";
import { useStore } from "../store";
import { VoiceStatusPanel } from "./VoiceStatusBar";
import { useVoice } from "../hooks/useVoice";
import { useIsTalking } from "../hooks/talkingStore";
import { UserSettingsModal } from "./UserSettingsModal";
import { AdminPanel } from "./AdminPanel";
import { CreateChannelModal } from "./CreateChannelModal";
import { P2PInviteModal } from "./P2PInviteModal";
import { type Channel, type P2PChannel, getApiUrl } from "../types";

interface VoiceMember {
  user_id: string;
  user_name: string;
  is_muted: boolean;
  is_deafened: boolean;
}

const VoiceMemberRow = memo(function VoiceMemberRow({
  member,
  hasScreenShare,
}: {
  member: VoiceMember;
  hasScreenShare: boolean;
}) {
  const isTalking = useIsTalking(member.user_id);
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1 text-xs transition-all duration-200 rounded-lg group ${
        isTalking
          ? "bg-success/5 text-success font-medium"
          : "text-text-secondary hover:bg-bg-hover/40"
      }`}
    >
      <div className="relative shrink-0">
        <div
          className={`w-5 h-5 rounded-full bg-bg-surface flex items-center justify-center text-[8px] font-bold border ${
            isTalking
              ? "border-success shadow-[0_0_8px_rgba(16,185,129,0.3)]"
              : "border-border"
          }`}
        >
          {member.user_name[0].toUpperCase()}
        </div>
        {isTalking && (
          <div className="absolute -inset-1 rounded-full border border-success/40 animate-ping opacity-20" />
        )}
      </div>
      <span className="truncate flex-1">{member.user_name}</span>
      <div className="flex items-center gap-1 shrink-0 px-0.5">
        {hasScreenShare && (
          <span className="text-[8px] font-bold bg-accent text-white px-1 rounded-[4px] leading-3 shadow-[0_0_8px_rgba(59,130,246,0.3)]">
            LIVE
          </span>
        )}
        {member.is_deafened ? (
          <svg
            className="w-3.5 h-3.5 text-danger opacity-80"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path d="M3 11a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5v-2Z" />
            <path d="M12 6v12" />
            <line x1="2" y1="2" x2="22" y2="22" />
          </svg>
        ) : member.is_muted ? (
          <svg
            className="w-3.5 h-3.5 text-danger opacity-80"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path d="m12 8-4 4 4 4" />
            <path d="M12 2v20" />
            <path d="M19 12h.01" />
            <path d="M19 6h.01" />
            <path d="M19 18h.01" />
            <line x1="2" y1="2" x2="22" y2="22" />
          </svg>
        ) : null}
      </div>
    </div>
  );
});

export function ChannelSidebar() {
  const activeServerId = useStore((s) => s.activeServerId);
  const servers = useStore((s) => s.servers);
  const channels = useStore((s) => s.channels);
  const activeChannelId = useStore((s) => s.activeChannelId);
  const setChannels = useStore((s) => s.setChannels);
  const setActiveChannel = useStore((s) => s.setActiveChannel);
  const voiceChannelId = useStore((s) => s.voiceChannelId);
  const voiceMembers = useStore((s) => s.voiceMembers);
  const currentUser = useStore((s) => s.currentUser);
  const screenShares = useStore((s) => s.screenShares);
  const displayName = useStore((s) => s.displayName);
  const { joinVoice, leaveVoice } = useVoice();
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  const activeServer = servers.find((s) => s.id === activeServerId);

  const textChannels = channels.filter(
    (c) => c.channel_type === "text" || !c.channel_type,
  );
  const voiceChannels = channels.filter((c) => c.channel_type === "voice");

  const fetchChannels = async () => {
    if (!activeServer) return;
    if (activeServer.type === "p2p") {
      // Fetch real P2P channels from iroh-doc
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const p2pChannels = await invoke<P2PChannel[]>("list_p2p_channels", {
          docId: activeServer.config.p2p?.namespaceId,
        });
        const mapped: Channel[] = p2pChannels.map((ch) => ({
          id: ch.id,
          name: ch.name,
          description: "",
          position: ch.position,
          createdAt: ch.created_at,
          channel_type: ch.channel_type as "text" | "voice",
        }));
        setChannels(mapped);
        const textCh = mapped.filter(
          (c) => c.channel_type === "text" || !c.channel_type,
        );
        if (textCh.length > 0 && !activeChannelId) {
          setActiveChannel(textCh[0].id);
        }
      } catch (err) {
        console.error("Failed to fetch P2P channels:", err);
        // Fallback to defaults if iroh-doc has no channels yet
        setChannels([
          {
            id: "general",
            name: "general",
            description: "General Chat",
            position: 0,
            createdAt: new Date().toISOString(),
            channel_type: "text",
          },
          {
            id: "voice-lounge",
            name: "Voice Lounge",
            description: "Voice",
            position: 1,
            createdAt: new Date().toISOString(),
            channel_type: "voice",
          },
        ]);
        setActiveChannel("general");
      }
      return;
    }
    const { host, port, authToken } = activeServer.config;
    if (!host || !port) return;
    const baseUrl = getApiUrl(host, port);
    const guildId = activeServer.config.guildId || "default";
    fetch(`${baseUrl}/api/channels`, {
      headers: {
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        "X-Server-Id": guildId,
      },
    })
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
    <div className="w-64 min-w-64 bg-bg-secondary border-r border-border flex flex-col">
      {/* Invite Modal */}
      {showInvite && activeServer?.type === "p2p" && activeServer.config.p2p?.ticket && (
        <P2PInviteModal
          ticket={activeServer.config.p2p.ticket}
          serverName={activeServer.displayName}
          onClose={() => setShowInvite(false)}
        />
      )}

      {/* Server header */}
      <div className="h-14 flex items-center px-4 border-b border-border/50 justify-between bg-bg-secondary/80 backdrop-blur-md sticky top-0 z-10">
        <h2 className="text-sm font-bold text-text-primary truncate tracking-tight">
          {activeServer?.type === "p2p"
            ? "P2P Space"
            : activeServer?.config.serverName ||
              activeServer?.config.host ||
              "Server"}
        </h2>
        <div className="flex items-center gap-1">
          {/* Copy Invite (P2P owner only) */}
          {activeServer?.type === "p2p" && activeServer.config.p2p?.isOwner && (
            <button
              onClick={() => setShowInvite(true)}
              className="p-1.5 rounded-lg text-text-muted hover:text-accent hover:bg-bg-surface transition-all cursor-pointer"
              title="Copy Invite"
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
                  d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
                />
              </svg>
            </button>
          )}
          {/* Create Channel */}
          {activeServer?.type !== "p2p" && (
            <button
              onClick={() => setShowCreate(true)}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-surface transition-all cursor-pointer"
              title="Create channel"
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
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
      {/* Channel list */}
      <div className="flex-1 overflow-y-auto py-4 px-2.5 space-y-4">
        {/* Text channels */}
        <div>
          <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest px-2 mb-2 flex items-center justify-between">
            <span>Text Channels</span>
          </div>
          <div className="space-y-0.5">
            {textChannels.map((channel: Channel) => (
              <button
                key={channel.id}
                onClick={() => setActiveChannel(channel.id)}
                className={`
                  w-full text-left px-3 py-2 rounded-xl text-sm flex items-center gap-2.5 cursor-pointer
                  transition-all duration-200 group
                  ${
                    activeChannelId === channel.id
                      ? "bg-accent/10 text-accent font-semibold"
                      : "text-text-secondary hover:bg-bg-surface hover:text-text-primary"
                  }
                `}
              >
                <span
                  className={`text-lg leading-none ${
                    activeChannelId === channel.id
                      ? "text-accent"
                      : "text-text-muted group-hover:text-text-secondary"
                  }`}
                >
                  #
                </span>
                <span className="truncate">{channel.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Voice channels */}
        {voiceChannels.length > 0 && (
          <>
            <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider px-2 mb-1 mt-4">
              Voice Channels
            </div>
            {voiceChannels.map((channel: Channel) => {
              const isConnected = voiceChannelId === channel.id;
              const voiceMembersInThisChannel = voiceMembers.filter(
                (m) => m.channel_id === channel.id,
              );
              return (
                <div key={channel.id}>
                  <button
                    onClick={() =>
                      isConnected ? leaveVoice() : joinVoice(channel.id)
                    }
                    className={`
                      w-full text-left px-3 py-2 rounded-xl text-sm flex items-center gap-2.5 cursor-pointer
                      transition-all duration-200 group relative
                      ${
                        isConnected
                          ? "bg-accent/15 text-text-primary font-semibold shadow-sm"
                          : "text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary"
                      }
                    `}
                  >
                    <div
                      className={`p-1 rounded-lg ${
                        isConnected
                          ? "bg-accent/20 text-accent"
                          : "bg-bg-surface text-text-muted group-hover:text-text-secondary"
                      }`}
                    >
                      <svg
                        className="w-4 h-4 shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z"
                        />
                      </svg>
                    </div>
                    <span className="truncate">{channel.name}</span>
                    {isConnected && (
                      <div className="ml-auto flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-success shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
                      </div>
                    )}
                  </button>

                  {voiceMembersInThisChannel.length > 0 && (
                    <div className="ml-10 mt-1 mb-2 space-y-1">
                      {voiceMembersInThisChannel.map((m) => (
                        <VoiceMemberRow
                          key={m.user_id}
                          member={m}
                          hasScreenShare={screenShares.has(m.user_id)}
                        />
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
      <VoiceStatusPanel />
      {/* User footer */}
      <div className="h-14 flex items-center px-3 border-t border-border gap-2 bg-bg-surface/50">
        {currentUser?.avatar_url ? (
          <img
            src={`${getApiUrl(activeServer?.config.host, activeServer?.config.port)}${currentUser.avatar_url}`}
            className="w-8 h-8 rounded-full object-cover border border-border"
            alt={currentUser.display_name}
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-xs font-semibold text-accent shrink-0">
            {(currentUser?.display_name || displayName)[0]?.toUpperCase()}
          </div>
        )}
        <div className="flex flex-col min-w-0">
          <span className="text-xs text-text-primary truncate font-medium">
            {currentUser?.display_name || displayName}
          </span>
          <span className="text-[10px] text-text-muted truncate">
            {currentUser ? `@${currentUser.username}` : ""}
          </span>
        </div>{" "}
        <button
          onClick={() => setShowAdmin(true)}
          title="Admin Panel"
          className="ml-auto p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-amber-400 transition-colors cursor-pointer"
        >
          🛡️
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors cursor-pointer"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </div>{" "}
      {/* User Settings Modal */}
      {showSettings && (
        <UserSettingsModal onClose={() => setShowSettings(false)} />
      )}
      {/* Admin Panel */}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
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
