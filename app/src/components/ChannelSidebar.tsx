import { useEffect, useState, memo, useRef } from "react";
import { useStore } from "../store";
import { VoiceStatusPanel } from "./VoiceStatusBar";
import { useVoice } from "../hooks/useVoice";
import { useIsTalking } from "../hooks/talkingStore";
import { UserSettingsModal } from "./UserSettingsModal";
import { AdminPanel } from "./AdminPanel";
import { CreateChannelModal } from "./CreateChannelModal";
import { CreateCategoryModal } from "./CreateCategoryModal";
import { P2PInviteModal } from "./P2PInviteModal";
import { AddServerModal } from "./AddServerModal";
import {
  type Channel,
  type Category,
  type P2PChannel,
  getApiUrl,
} from "../types";
import {
  MicOff,
  HeadphoneOff,
  Copy,
  Plus,
  Hash,
  Volume2,
  Settings,
  ShieldAlert,
  ChevronDown,
  X,
  LogOut,
  Check,
  ChevronRight,
  FolderPlus,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

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

const ChannelItem = memo(function ChannelItem({
  channel,
  isActive,
  onClick,
  isConnected,
  onVoiceClick,
  voiceMembers,
  screenShares,
}: {
  channel: Channel;
  isActive: boolean;
  onClick: () => void;
  isConnected: boolean;
  onVoiceClick: () => void;
  voiceMembers: VoiceMember[];
  screenShares: Map<string, MediaStream>;
}) {
  if (channel.channel_type === "voice") {
    return (
      <div>
        <div
          role="button"
          onClick={onVoiceClick}
          className={`
          w-full text-left px-2 py-1.5 rounded-md text-sm flex items-center gap-2 cursor-pointer
          transition-all duration-150 group relative select-none
          ${
            isConnected
              ? "bg-bg-tertiary text-text-primary font-medium"
              : "text-text-muted hover:bg-bg-tertiary/50 hover:text-text-secondary"
          }
        `}
        >
          <Volume2
            className={`w-4 h-4 shrink-0 ${
              isConnected
                ? "text-success"
                : "text-text-muted/50 group-hover:text-text-muted"
            }`}
          />
          <span className="truncate">{channel.name}</span>
        </div>

        {voiceMembers.length > 0 && (
          <div className="ml-6 mt-0.5 mb-1 space-y-0.5 border-l border-border/30 pl-2">
            {voiceMembers.map((m) => (
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
  }

  return (
    <div
      role="button"
      onClick={onClick}
      className={`
      w-full text-left px-2 py-1.5 rounded-md text-sm flex items-center gap-2 cursor-pointer
      transition-all duration-150 group select-none
      ${
        isActive
          ? "bg-bg-tertiary text-text-primary font-medium"
          : "text-text-muted hover:bg-bg-tertiary/50 hover:text-text-secondary"
      }
    `}
    >
      <Hash
        className={`w-4 h-4 shrink-0 ${
          isActive
            ? "text-text-secondary"
            : "text-text-muted/50 group-hover:text-text-muted"
        }`}
      />
      <span className="truncate">{channel.name}</span>
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
  const setActiveServer = useStore((s) => s.setActiveServer);
  const voiceChannelId = useStore((s) => s.voiceChannelId);
  const voiceMembers = useStore((s) => s.voiceMembers);
  const currentUser = useStore((s) => s.currentUser);
  const screenShares = useStore((s) => s.screenShares);
  const displayName = useStore((s) => s.displayName);
  const [categories, setCategories] = useState<Category[]>([]);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const { joinVoice, leaveVoice } = useVoice();

  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showServerDropdown, setShowServerDropdown] = useState(false);
  const [showAddServer, setShowAddServer] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeServer = servers.find((s) => s.id === activeServerId);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowServerDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

    // Fetch categories
    fetch(`${baseUrl}/api/servers/${guildId}/categories`, {
      headers: {
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
    })
      .then((r) => r.json())
      .then((data: Category[]) => setCategories(data))
      .catch((err) => console.error("Failed to fetch categories:", err));
  };

  useEffect(() => {
    fetchChannels();
  }, [activeServer?.id]);

  const toggleCategory = (id: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* Drag & Drop Handlers */

  const handleDragStart = (
    e: React.DragEvent,
    type: "channel" | "category",
    id: string,
  ) => {
    e.stopPropagation();
    e.dataTransfer.setData("dragType", type);
    e.dataTransfer.setData("id", id);
    e.dataTransfer.setData("text/plain", `${type}:${id}`);
    e.dataTransfer.effectAllowed = "move";

    // Optional: Set drag image or opacity
    const target = e.currentTarget;
    if (target instanceof HTMLElement) {
      setTimeout(() => {
        target.style.opacity = "0.5";
      }, 0);
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    const target = e.currentTarget;
    if (target instanceof HTMLElement) {
      target.style.opacity = "";
    }
    setDragOverId(null);
  };

  const handleDragOver = (e: React.DragEvent, id?: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";

    if (id && dragOverId !== id) {
      setDragOverId(id);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) {
      return;
    }
    setDragOverId(null);
  };

  const handleDropChannel = async (
    e: React.DragEvent,
    targetCategoryId: string | null,
  ) => {
    e.preventDefault();
    setDragOverId(null);
    let type = e.dataTransfer.getData("dragType");
    let draggedId = e.dataTransfer.getData("id");

    // Fallback if custom types are lost
    if (!type || !draggedId) {
      const plain = e.dataTransfer.getData("text/plain");
      if (plain && plain.includes(":")) {
        [type, draggedId] = plain.split(":");
      }
    }

    if (type !== "channel") return;

    // Local update for immediate feedback
    const draggedChannel = channels.find((c) => c.id === draggedId);
    if (!draggedChannel) return;

    // Simple reorder: move to the end of the category for now
    // In a full implementation, we'd check the exact drop position
    const updatedChannels = channels.map((c) =>
      c.id === draggedId ? { ...c, category_id: targetCategoryId } : c,
    );
    setChannels(updatedChannels);

    // Persist to backend
    try {
      const guildId = activeServer?.config.guildId || "default";
      await fetch(
        `${getApiUrl(activeServer?.config.host, activeServer?.config.port)}/api/channels/reorder`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Server-Id": guildId,
            ...(activeServer?.config.authToken
              ? { Authorization: `Bearer ${activeServer.config.authToken}` }
              : {}),
          },
          body: JSON.stringify({
            channels: updatedChannels.map((c, i) => ({
              id: c.id,
              position: i,
              category_id: c.category_id,
            })),
          }),
        },
      );
    } catch (err) {
      console.error("Failed to persist channel reorder:", err);
      fetchChannels(); // Rollback on error
    }
  };

  const handleDropCategory = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverId(null);
    let type = e.dataTransfer.getData("dragType");
    let draggedId = e.dataTransfer.getData("id");

    if (!type || !draggedId) {
      const plain = e.dataTransfer.getData("text/plain");
      if (plain && plain.includes(":")) {
        [type, draggedId] = plain.split(":");
      }
    }

    if (type !== "category" || draggedId === targetId) return;

    const dragIdx = categories.findIndex((c) => c.id === draggedId);
    const hoverIdx = categories.findIndex((c) => c.id === targetId);

    const newCategories = [...categories];
    const [dragged] = newCategories.splice(dragIdx, 1);
    newCategories.splice(hoverIdx, 0, dragged);

    setCategories(newCategories);

    // Persist to backend
    try {
      const guildId = activeServer?.config.guildId || "default";
      await fetch(
        `${getApiUrl(activeServer?.config.host, activeServer?.config.port)}/api/servers/${guildId}/categories/reorder`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(activeServer?.config.authToken
              ? { Authorization: `Bearer ${activeServer.config.authToken}` }
              : {}),
          },
          body: JSON.stringify({
            positions: newCategories.map((c, i) => ({
              id: c.id,
              position: i,
            })),
          }),
        },
      );
    } catch (err) {
      console.error("Failed to persist category reorder:", err);
      // Optional: rollback categories if needed
    }
  };

  return (
    <div className="w-64 min-w-64 bg-bg-secondary border-r border-border/50 flex flex-col relative z-20">
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
      {showCreateCategory && activeServer && (
        <CreateCategoryModal
          server={activeServer}
          onClose={() => setShowCreateCategory(false)}
          onCreated={fetchChannels}
        />
      )}
      {/* Server Header Dropdown */}
      <div ref={dropdownRef} className="relative">
        <div
          onClick={() => setShowServerDropdown(!showServerDropdown)}
          className={`h-12 flex items-center px-4 border-b border-border/50 justify-between bg-bg-secondary shadow-sm transition-colors hover:bg-bg-tertiary cursor-pointer ${showServerDropdown ? "bg-bg-tertiary" : ""}`}
        >
          <h2 className="text-sm font-bold text-text-primary truncate tracking-tight">
            {activeServer?.type === "p2p"
              ? "P2P Space"
              : activeServer?.config.serverName ||
                activeServer?.config.host ||
                "Select Server"}
          </h2>
          {showServerDropdown ? (
            <X className="w-4 h-4 text-text-primary" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-primary" />
          )}
        </div>

        <AnimatePresence>
          {showServerDropdown && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.1 }}
              className="absolute top-[52px] left-2 right-2 bg-black border border-border/50 rounded-xl shadow-xl overflow-hidden p-1 z-50"
            >
              {/* Server List */}
              <div className="max-h-[300px] overflow-y-auto custom-scrollbar mb-1">
                {servers.map((server) => (
                  <button
                    key={server.id}
                    onClick={() => {
                      setActiveServer(server.id);
                      setShowServerDropdown(false);
                    }}
                    className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg text-sm font-medium transition-colors ${activeServerId === server.id ? "bg-accent text-white" : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"}`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${activeServerId === server.id ? "bg-white/20 text-white" : "bg-bg-tertiary text-text-muted"}`}
                    >
                      {server.initial}
                    </div>
                    <span className="truncate flex-1 text-left">
                      {server.config.serverName || server.config.host}
                    </span>
                    {activeServerId === server.id && (
                      <Check className="w-4 h-4 shrink-0" />
                    )}
                  </button>
                ))}
              </div>

              <div className="h-px bg-border/50 my-1 mx-2" />

              {/* Actions */}
              {activeServer && (
                <>
                  {activeServer.type === "p2p" &&
                    activeServer.config.p2p?.isOwner && (
                      <button
                        onClick={() => {
                          setShowInvite(true);
                          setShowServerDropdown(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-accent hover:bg-accent/10 transition-colors text-left"
                      >
                        <Copy className="w-4 h-4" />
                        Invite People
                      </button>
                    )}
                  {activeServer.type !== "p2p" && (
                    <>
                      <button
                        onClick={() => {
                          setShowCreate(true);
                          setShowServerDropdown(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors text-left cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        Create Channel
                      </button>
                      <button
                        onClick={() => {
                          setShowCreateCategory(true);
                          setShowServerDropdown(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors text-left cursor-pointer"
                      >
                        <FolderPlus className="w-4 h-4" />
                        Create Category
                      </button>
                    </>
                  )}

                  <div className="h-px bg-border/50 my-1 mx-2" />
                </>
              )}

              <button
                onClick={() => {
                  setShowAddServer(true);
                  setShowServerDropdown(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-text-secondary hover:text-success hover:bg-success/10 transition-colors text-left"
              >
                <Plus className="w-4 h-4" />
                Add Server
              </button>

              {activeServer && (
                <button
                  onClick={() => {
                    // TODO: Implement leave server logic
                    alert("Leave Server implementation coming soon");
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-danger hover:bg-danger/10 transition-colors text-left"
                >
                  <LogOut className="w-4 h-4" />
                  Leave Server
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {/* Channel list */}
      <div className="flex-1 overflow-y-auto py-3 px-2 custom-scrollbar">
        {channels.some((c) => !c.category_id) && (
          <div
            className={`group/uncat transition-all duration-200 rounded-lg p-1 mb-6 ${dragOverId === "uncategorized" ? "bg-accent/10 ring-2 ring-accent/30 ring-inset" : ""}`}
            onDragOver={(e) => handleDragOver(e, "uncategorized")}
            onDragEnter={(e) => handleDragOver(e, "uncategorized")}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDropChannel(e, null)}
          >
            <div className="text-[10px] font-bold text-text-muted/70 uppercase tracking-widest px-2 mb-1 flex items-center justify-between">
              <span>Uncategorized</span>
            </div>
            <div className="space-y-0.5 min-h-[10px]">
              {channels
                .filter((c) => !c.category_id)
                .sort((a, b) => a.position - b.position)
                .map((channel) => (
                  <div
                    key={channel.id}
                    draggable
                    onDragStart={(e) =>
                      handleDragStart(e, "channel", channel.id)
                    }
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, "uncategorized")}
                    className="relative"
                  >
                    <ChannelItem
                      channel={channel}
                      isActive={activeChannelId === channel.id}
                      onClick={() => setActiveChannel(channel.id)}
                      isConnected={voiceChannelId === channel.id}
                      onVoiceClick={() =>
                        voiceChannelId === channel.id
                          ? leaveVoice()
                          : joinVoice(channel.id)
                      }
                      voiceMembers={voiceMembers.filter(
                        (m) => m.channel_id === channel.id,
                      )}
                      screenShares={screenShares}
                    />
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Categories */}
        {categories.map((cat) => {
          const catChannels = channels
            .filter((c) => c.category_id === cat.id)
            .sort((a, b) => a.position - b.position);
          const isCollapsed = collapsedCategories.has(cat.id);

          return (
            <div
              key={cat.id}
              onDragOver={(e) => handleDragOver(e, cat.id)}
              onDragEnter={(e) => handleDragOver(e, cat.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => {
                const type = e.dataTransfer.getData("dragType");
                if (
                  type === "category" ||
                  e.dataTransfer.types.includes("text/plain")
                ) {
                  const plain = e.dataTransfer.getData("text/plain");
                  if (
                    type === "category" ||
                    (plain && plain.startsWith("category:"))
                  ) {
                    handleDropCategory(e, cat.id);
                  } else {
                    handleDropChannel(e, cat.id);
                  }
                }
              }}
              className={`group/cat-section transition-all duration-200 rounded-lg mb-6 p-1 ${
                dragOverId === cat.id
                  ? "bg-accent/10 ring-2 ring-accent/30 ring-inset"
                  : ""
              }`}
            >
              <div
                draggable
                onDragStart={(e) => handleDragStart(e, "category", cat.id)}
                onDragEnd={handleDragEnd}
                className="cursor-move"
              >
                <button
                  onClick={() => toggleCategory(cat.id)}
                  className="w-full text-left text-[10px] font-bold text-text-muted/70 uppercase tracking-widest px-1 mb-1 flex items-center gap-1 hover:text-text-secondary transition-colors cursor-pointer"
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-3 h-3 transition-transform" />
                  ) : (
                    <ChevronDown className="w-3 h-3 transition-transform" />
                  )}
                  <span>{cat.name}</span>
                </button>
              </div>

              {!isCollapsed && (
                <div className="space-y-0.5 min-h-[10px]">
                  {catChannels.length > 0 ? (
                    catChannels.map((channel) => (
                      <div
                        key={channel.id}
                        draggable
                        onDragStart={(e) =>
                          handleDragStart(e, "channel", channel.id)
                        }
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(e, cat.id)}
                        className="relative"
                      >
                        <ChannelItem
                          channel={channel}
                          isActive={activeChannelId === channel.id}
                          onClick={() => setActiveChannel(channel.id)}
                          isConnected={voiceChannelId === channel.id}
                          onVoiceClick={() =>
                            voiceChannelId === channel.id
                              ? leaveVoice()
                              : joinVoice(channel.id)
                          }
                          voiceMembers={voiceMembers.filter(
                            (m) => m.channel_id === channel.id,
                          )}
                          screenShares={screenShares}
                        />
                      </div>
                    ))
                  ) : (
                    <div className="px-5 py-1 text-[10px] text-text-muted/40 italic">
                      No channels
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Fallback if no categories and no server info yet */}
        {categories.length === 0 && !channels.some((c) => !c.category_id) && (
          <div className="flex flex-col items-center justify-center h-20 text-text-muted/30">
            <Plus className="w-5 h-5 mb-1 opacity-20" />
            <span className="text-[10px] uppercase tracking-tighter">
              No channels yet
            </span>
          </div>
        )}
      </div>
      {/* Voice status bar */}
      <VoiceStatusPanel />
      {/* User footer */}
      <div className="h-14 flex items-center px-3 border-t border-border/50 gap-2 bg-bg-secondary">
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
          <span className="text-xs text-text-muted truncate">
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
      {/* Add Server Modal */}
      {showAddServer && (
        <AddServerModal onClose={() => setShowAddServer(false)} />
      )}
    </div>
  );
}
