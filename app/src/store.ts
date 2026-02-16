import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ServerEntry,
  ServerConfig,
  Channel,
  Message,
  VoicePeer,
  AuthUser,
  ReactionGroup,
  Role,
} from "./types";

interface ShortcutMap {
  [action: string]: string;
}

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  toggle_mute: "Control+Shift+M",
  toggle_deafen: "Control+Shift+D",
  prev_channel: "Alt+ArrowUp",
  next_channel: "Alt+ArrowDown",
  close_modal: "Escape",
};

interface AppState {
  // User identity
  displayName: string;
  setDisplayName: (name: string) => void;

  // Auth (per-server)
  currentUser: AuthUser | null;
  setCurrentUser: (user: AuthUser | null) => void;

  // Servers
  servers: ServerEntry[];
  activeServerId: string | null;
  addServer: (server: ServerEntry) => void;
  removeServer: (id: string) => void;
  setActiveServer: (id: string | null) => void;
  updateServerAuth: (
    serverId: string,
    authToken: string,
    userId: string,
  ) => void;

  // Channels (per active server)
  channels: Channel[];
  activeChannelId: string | null;
  setChannels: (channels: Channel[]) => void;
  setActiveChannel: (id: string | null) => void;

  // Messages (per active channel)
  messages: Message[];
  hasMoreMessages: boolean;
  isLoadingMore: boolean;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  prependMessages: (messages: Message[]) => void;
  setHasMoreMessages: (v: boolean) => void;
  setIsLoadingMore: (v: boolean) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  removeMessage: (id: string) => void;
  addReaction: (
    messageId: string,
    emoji: string,
    userId: string,
    userName: string,
  ) => void;
  removeReaction: (messageId: string, emoji: string, userId: string) => void;
  replyingTo: Message | null;
  setReplyingTo: (msg: Message | null) => void;
  // Voice
  voiceChannelId: string | null;
  voiceMembers: VoicePeer[];
  screenShares: Map<string, MediaStream>;
  isMuted: boolean;
  isDeafened: boolean;
  setMuted: (v: boolean) => void;
  setDeafened: (v: boolean) => void;
  voiceSettings: {
    mode: "activity" | "ptt";
    pttKey: string;
  };
  soundSettings: {
    joinSound: string | null;
    leaveSound: string | null;
    muteSound: string | null;
    deafenSound: string | null;
  };
  setVoiceChannel: (id: string | null) => void;
  setVoiceMembers: (members: VoicePeer[]) => void;
  addVoiceMember: (peer: VoicePeer) => void;
  removeVoiceMember: (userId: string) => void;
  updateVoiceStatus: (
    userId: string,
    isMuted: boolean,
    isDeafened: boolean,
  ) => void;
  addScreenShare: (userId: string, stream: MediaStream) => void;
  removeScreenShare: (userId: string) => void;
  updateVoiceSettings: (settings: Partial<AppState["voiceSettings"]>) => void;
  updateSoundSettings: (settings: Partial<AppState["soundSettings"]>) => void;
  updateServerConfig: (serverId: string, config: Partial<ServerConfig>) => void;

  // Typing
  typingUsers: Record<
    string,
    Record<string, { name: string; timestamp: number }>
  >;
  setTyping: (channelId: string, userId: string, userName: string) => void;
  removeTyping: (channelId: string, userId: string) => void;
  clearExpiredTyping: () => void;
  // Roles cache (per-server)
  rolesByServer: Record<string, Role[]>;
  fetchRolesForServer: (serverId: string) => Promise<Role[]>;
  // Iroh P2P
  nodeId: string | null;
  irohReady: boolean;
  p2pVoiceActive: boolean;
  fetchNodeId: () => Promise<void>;
  createP2PServer: (name: string) => Promise<void>;
  joinP2PServer: (name: string, ticket: string) => Promise<void>;
  startP2PVoice: (docId: string) => Promise<void>;
  stopP2PVoice: () => Promise<void>;

  // Timeout
  timeoutFinishTime: number | null;
  setTimeoutFinishTime: (time: number | null) => void;

  // Shortcuts
  shortcuts: ShortcutMap;
  setShortcut: (action: string, keyCombo: string) => void;
  resetShortcuts: () => void;

  // User Profile Modal
  userProfileModal: { userId: string | null; isOpen: boolean };
  openUserProfile: (userId: string) => void;
  closeUserProfile: () => void;

  logout: () => void;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // User
      displayName: "",
      setDisplayName: (name) => set({ displayName: name }),

      // Auth
      currentUser: null,
      setCurrentUser: (user) => set({ currentUser: user }),

      // Servers
      servers: [],
      activeServerId: null,
      addServer: (server) => set((s) => ({ servers: [...s.servers, server] })),
      removeServer: (id) =>
        set((s) => ({
          servers: s.servers.filter((srv) => srv.id !== id),
          activeServerId: s.activeServerId === id ? null : s.activeServerId,
        })),
      setActiveServer: (id) =>
        set(() => {
          return {
            activeServerId: id,
            channels: [],
            activeChannelId: null,
            messages: [],
            // Don't reset currentUser if we have a stored session for this server
            // Actually, we'll let a sidebar effect fetch the user profile if authToken exists
            currentUser: null,
            timeoutFinishTime: null,
          };
        }),
      updateServerAuth: (serverId, authToken, userId) =>
        set((s) => ({
          servers: s.servers.map((srv) =>
            srv.id === serverId
              ? { ...srv, config: { ...srv.config, authToken, userId } }
              : srv,
          ),
        })),

      // Channels
      channels: [],
      activeChannelId: null,
      setChannels: (channels) => set({ channels }),
      setActiveChannel: (id) =>
        set({
          activeChannelId: id,
          messages: [],
          hasMoreMessages: true,
          isLoadingMore: false,
        }),

      // Messages
      messages: [],
      hasMoreMessages: true,
      isLoadingMore: false,
      setMessages: (messages) => set({ messages }),
      addMessage: (message) =>
        set((s) => {
          if (s.messages.some((m) => m.id === message.id)) return s;
          const msgs = [...s.messages, message];
          return { messages: msgs.length > 500 ? msgs.slice(-500) : msgs };
        }),
      prependMessages: (older) =>
        set((s) => {
          const existingIds = new Set(s.messages.map((m) => m.id));
          const unique = older.filter((m) => !existingIds.has(m.id));
          return { messages: [...unique, ...s.messages] };
        }),
      setHasMoreMessages: (v) => set({ hasMoreMessages: v }),
      setIsLoadingMore: (v) => set({ isLoadingMore: v }),
      updateMessage: (id, updates) =>
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === id ? { ...m, ...updates } : m,
          ),
        })),
      removeMessage: (id) =>
        set((s) => ({
          messages: s.messages.filter((m) => m.id !== id),
        })),
      replyingTo: null,
      addReaction: (messageId, emoji, userId, _userName) =>
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== messageId) return m;
            const reactions = [...(m.reactions || [])];
            const groupIndex = reactions.findIndex((g) => g.emoji === emoji);

            if (groupIndex > -1) {
              const group = reactions[groupIndex];
              if (!group.user_ids.includes(userId)) {
                reactions[groupIndex] = {
                  ...group,
                  count: group.count + 1,
                  user_ids: [...group.user_ids, userId],
                };
              }
            } else {
              reactions.push({ emoji, count: 1, user_ids: [userId] });
            }
            return { ...m, reactions };
          }),
        })),

      removeReaction: (messageId, emoji, userId) =>
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== messageId) return m;
            const reactions = (m.reactions || [])
              .map((g: ReactionGroup) => {
                if (g.emoji !== emoji) return g;
                const newUserIds = g.user_ids.filter(
                  (id: string) => id !== userId,
                );
                if (newUserIds.length === 0) return null;
                return {
                  ...g,
                  count: Math.max(0, g.count - 1),
                  user_ids: newUserIds,
                };
              })
              .filter((g): g is ReactionGroup => g !== null);
            return { ...m, reactions };
          }),
        })),

      setReplyingTo: (msg) => set({ replyingTo: msg }),

      // Voice
      voiceChannelId: null,
      voiceMembers: [],
      screenShares: new Map(),
      isMuted: false,
      isDeafened: false,
      setMuted: (v) => set({ isMuted: v }),
      setDeafened: (v) => set({ isDeafened: v }),
      setVoiceChannel: (id) =>
        set({
          voiceChannelId: id,
          voiceMembers: [],
          screenShares: new Map(),
          isMuted: false,
          isDeafened: false,
        }),
      setVoiceMembers: (members) => set({ voiceMembers: members }),
      addVoiceMember: (peer) =>
        set((s) => ({
          voiceMembers: s.voiceMembers.some(
            (m) =>
              m.user_id === peer.user_id && m.channel_id === peer.channel_id,
          )
            ? s.voiceMembers
            : [...s.voiceMembers, peer],
        })),
      removeVoiceMember: (userId) =>
        set((s) => ({
          voiceMembers: s.voiceMembers.filter((m) => m.user_id !== userId),
          screenShares: new Map(
            [...s.screenShares].filter(([uid]) => uid !== userId),
          ),
        })),
      addScreenShare: (userId, stream) =>
        set((s) => ({
          screenShares: new Map(s.screenShares).set(userId, stream),
        })),
      removeScreenShare: (userId) =>
        set((s) => ({
          screenShares: new Map(
            [...s.screenShares].filter(([uid]) => uid !== userId),
          ),
        })),
      voiceSettings: {
        mode: "activity",
        pttKey: "ControlLeft",
      },
      soundSettings: {
        joinSound: null,
        leaveSound: null,
        muteSound: null,
        deafenSound: null,
      },
      updateVoiceStatus: (userId, isMuted, isDeafened) =>
        set((s) => ({
          voiceMembers: s.voiceMembers.map((m) =>
            m.user_id === userId
              ? { ...m, is_muted: isMuted, is_deafened: isDeafened }
              : m,
          ),
        })),
      updateVoiceSettings: (settings) =>
        set((s) => ({ voiceSettings: { ...s.voiceSettings, ...settings } })),
      updateSoundSettings: (settings) =>
        set((s) => ({ soundSettings: { ...s.soundSettings, ...settings } })),
      updateServerConfig: (serverId, config) =>
        set((s) => ({
          servers: s.servers.map((srv) =>
            srv.id === serverId
              ? { ...srv, config: { ...srv.config, ...config } }
              : srv,
          ),
        })),

      // Typing
      typingUsers: {},
      setTyping: (channelId, userId, userName) =>
        set((state) => {
          const channelTyping = { ...(state.typingUsers[channelId] || {}) };
          channelTyping[userId] = { name: userName, timestamp: Date.now() };
          return {
            typingUsers: { ...state.typingUsers, [channelId]: channelTyping },
          };
        }),
      removeTyping: (channelId, userId) =>
        set((state) => {
          const channelTyping = { ...(state.typingUsers[channelId] || {}) };
          delete channelTyping[userId];
          return {
            typingUsers: { ...state.typingUsers, [channelId]: channelTyping },
          };
        }),
      clearExpiredTyping: () =>
        set((state) => {
          const now = Date.now();
          const newTyping = { ...state.typingUsers };
          let changed = false;

          for (const [cid, users] of Object.entries(newTyping)) {
            const newUsers = { ...users };
            let channelChanged = false;
            for (const [uid, data] of Object.entries(newUsers)) {
              if (now - data.timestamp > 8000) {
                delete newUsers[uid];
                channelChanged = true;
                changed = true;
              }
            }
            if (channelChanged) {
              if (Object.keys(newUsers).length === 0) {
                delete newTyping[cid];
              } else {
                newTyping[cid] = newUsers;
              }
            }
          }

          return changed ? { typingUsers: newTyping } : state;
        }),
      // Iroh
      nodeId: null,
      irohReady: false,
      fetchNodeId: async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const nodeId = await invoke<string>("get_node_id");
          set({ nodeId, irohReady: true });
        } catch (err) {
          console.error("Failed to fetch NodeID", err);
        }
      },
      p2pVoiceActive: false,
      createP2PServer: async (name: string) => {
        console.log("[P2P] createP2PServer: starting, name=", name);
        const { invoke } = await import("@tauri-apps/api/core");
        console.log("[P2P] createP2PServer: calling create_doc...");
        const result = await Promise.race([
          invoke<{ namespace_id: string; ticket: string }>("create_doc"),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("create_doc timed out after 30s")),
              30000,
            ),
          ),
        ]);
        console.log(
          "[P2P] createP2PServer: doc created, namespace_id=",
          result.namespace_id,
          "ticket_len=",
          result.ticket.length,
        );
        const namespaceId = result.namespace_id;
        const ticket = result.ticket;
        const server: ServerEntry = {
          id: namespaceId,
          type: "p2p",
          displayName: name,
          initial: (name[0] || "?").toUpperCase(),
          config: {
            p2p: {
              ticket,
              namespaceId,
              isOwner: true,
            },
          },
        };
        // Publish DID identity to the new server
        const dn = get().displayName || name;
        try {
          await invoke("set_identity", {
            docId: namespaceId,
            displayName: dn,
            bio: null,
          });
        } catch (e) {
          console.warn("set_identity failed (non-critical)", e);
        }
        set((s) => ({
          servers: [...s.servers, server],
          activeServerId: namespaceId,
        }));
      },
      joinP2PServer: async (name: string, ticket: string) => {
        console.log(
          "[P2P] joinP2PServer: starting, ticket_len=",
          ticket.length,
        );
        const { invoke } = await import("@tauri-apps/api/core");
        console.log("[P2P] joinP2PServer: calling join_doc...");
        const namespaceId = await Promise.race([
          invoke<string>("join_doc", { ticketStr: ticket }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("join_doc timed out after 30s")),
              30000,
            ),
          ),
        ]);
        console.log("[P2P] joinP2PServer: joined, namespace_id=", namespaceId);
        const newServer: ServerEntry = {
          id: namespaceId,
          type: "p2p",
          displayName: name,
          initial: name[0].toUpperCase(),
          config: {
            p2p: { ticket, namespaceId, isOwner: false },
          },
        };
        // Publish DID identity to the joined server (non-critical)
        const dn = get().displayName || name;
        try {
          await invoke("set_identity", {
            docId: namespaceId,
            displayName: dn,
            bio: null,
          });
        } catch (e) {
          console.warn("set_identity failed (non-critical)", e);
        }
        set((s) => ({
          servers: [...s.servers, newServer],
          activeServerId: namespaceId,
        }));
      },
      startP2PVoice: async (docId: string) => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          // Use MoQ voice with channel-specific topic
          const channelId = get().voiceChannelId || "voice-lounge";
          await invoke("moq_join_voice", { docId, channelId });
          await invoke("moq_start_voice", { docId, channelId });
          set({ p2pVoiceActive: true });
        } catch (err) {
          console.error("Failed to start P2P voice", err);
        }
      },
      stopP2PVoice: async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("stop_voice");
          // Also remove voice presence from the doc
          const state = get();
          const server = state.servers.find(
            (s) => s.id === state.activeServerId,
          );
          if (server?.config.p2p?.namespaceId && state.voiceChannelId) {
            await invoke("moq_leave_voice", {
              docId: server.config.p2p.namespaceId,
              channelId: state.voiceChannelId,
            });
          }
        } catch (err) {
          console.error("Failed to stop P2P voice", err);
        }
        set({ p2pVoiceActive: false });
      },

      // Shortcuts
      shortcuts: DEFAULT_SHORTCUTS,
      setShortcut: (action, keyCombo) =>
        set((s) => ({ shortcuts: { ...s.shortcuts, [action]: keyCombo } })),
      resetShortcuts: () => set({ shortcuts: DEFAULT_SHORTCUTS }),

      // Timeout
      timeoutFinishTime: null,
      setTimeoutFinishTime: (time) => set({ timeoutFinishTime: time }),

      // User Profile Modal
      userProfileModal: { userId: null, isOpen: false },
      openUserProfile: (userId) =>
        set({ userProfileModal: { userId, isOpen: true } }),
      closeUserProfile: () =>
        set({ userProfileModal: { userId: null, isOpen: false } }),

      logout: () =>
        set((s) => {
          if (!s.activeServerId) return s;
          return {
            servers: s.servers.map((srv) =>
              srv.id === s.activeServerId
                ? {
                    ...srv,
                    config: {
                      ...srv.config,
                      authToken: undefined,
                      userId: undefined,
                    },
                  }
                : srv,
            ),
            currentUser: null,
            timeoutFinishTime: null,
          };
        }),
      // Roles cache
      rolesByServer: {},
      fetchRolesForServer: async (serverId: string) => {
        const state = get();
        const server = state.servers.find((s) => s.id === serverId);
        if (!server) return [];
        // Return cached if present
        if (state.rolesByServer[serverId]?.length)
          return state.rolesByServer[serverId];

        try {
          const { getApiUrl, authHeaders } = await import("./types");
          const res = await fetch(
            `${getApiUrl(server.config.host, server.config.port)}/api/roles`,
            {
              headers: authHeaders(
                server.config.authToken,
                server.config.guildId,
              ),
            },
          );
          if (!res.ok) throw new Error("Failed to fetch roles");
          const data: Role[] = await res.json();
          set((s) => ({
            rolesByServer: { ...(s.rolesByServer || {}), [serverId]: data },
          }));
          return data;
        } catch (err) {
          console.error("fetchRolesForServer failed", err);
          return [];
        }
      },
    }),

    {
      name: "sivyspeak-storage",
      partialize: (state) => ({
        displayName: state.displayName,
        servers: state.servers,
        activeServerId: state.activeServerId,
        activeChannelId: state.activeChannelId,
        voiceSettings: state.voiceSettings,
        soundSettings: state.soundSettings,
        timeoutFinishTime: state.timeoutFinishTime,
        shortcuts: state.shortcuts,
      }),
    },
  ),
);
