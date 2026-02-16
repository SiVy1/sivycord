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
import {
  MicOff,
  HeadphoneOff,
  Copy,
  Plus,
  Hash,
  Volume2,
  Settings,
  ShieldAlert,
} from "lucide-react";

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
          <HeadphoneOff className="w-3.5 h-3.5 text-danger opacity-80" />
        ) : member.is_muted ? (
          <MicOff className="w-3.5 h-3.5 text-danger opacity-80" />
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
      {showInvite &&
        activeServer?.type === "p2p" &&
        activeServer.config.p2p?.ticket && (
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
              <Copy className="w-4 h-4" />
            </button>
          )}
          {/* Create Channel */}
          {activeServer?.type !== "p2p" && (
            <button
              onClick={() => setShowCreate(true)}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-surface transition-all cursor-pointer"
              title="Create channel"
            >
              <Plus className="w-4 h-4" />
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
                <Hash
                  className={`w-4 h-4 ${
                    activeChannelId === channel.id
                      ? "text-accent"
                      : "text-text-muted group-hover:text-text-secondary"
                  }`}
                />
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
                      <Volume2 className="w-4 h-4 shrink-0" />
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
          <ShieldAlert className="w-4 h-4" />
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors cursor-pointer"
        >
          <Settings className="w-4 h-4" />
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
