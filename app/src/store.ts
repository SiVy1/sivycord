import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ServerEntry,
  ServerConfig,
  Channel,
  Message,
  VoicePeer,
  AuthUser,
} from "./types";

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
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  // Voice
  voiceChannelId: string | null;
  voiceMembers: VoicePeer[];
  screenShares: Map<string, MediaStream>;
  talkingUsers: Set<string>; // Who is currently talking
  voiceSettings: {
    mode: "activity" | "ptt";
    pttKey: string;
  };
  soundSettings: {
    joinSound: string | null; // null = default, string = custom audio URL/data
    leaveSound: string | null;
    muteSound: string | null;
    deafenSound: string | null;
  };
  setVoiceChannel: (id: string | null) => void;
  setVoiceMembers: (members: VoicePeer[]) => void;
  addVoiceMember: (peer: VoicePeer) => void;
  removeVoiceMember: (userId: string) => void;
  addScreenShare: (userId: string, stream: MediaStream) => void;
  removeScreenShare: (userId: string) => void;
  setTalking: (userId: string, talking: boolean) => void;
  updateVoiceSettings: (settings: Partial<AppState["voiceSettings"]>) => void;
  updateSoundSettings: (settings: Partial<AppState["soundSettings"]>) => void;
  updateServerConfig: (serverId: string, config: Partial<ServerConfig>) => void;
  // Iroh P2P
  nodeId: string | null;
  irohReady: boolean;
  p2pVoiceActive: boolean;
  fetchNodeId: () => Promise<void>;
  createP2PServer: (name: string) => Promise<void>;
  joinP2PServer: (name: string, ticket: string) => Promise<void>;
  startP2PVoice: (docId: string) => Promise<void>;
  stopP2PVoice: () => Promise<void>;

  logout: () => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
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
      setActiveChannel: (id) => set({ activeChannelId: id, messages: [] }),

      // Messages
      messages: [],
      setMessages: (messages) => set({ messages }),
      addMessage: (message) =>
        set((s) => ({ messages: [...s.messages, message] })),

      // Voice
      voiceChannelId: null,
      voiceMembers: [],
      screenShares: new Map(),
      setVoiceChannel: (id) =>
        set({ voiceChannelId: id, voiceMembers: [], screenShares: new Map() }),
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
      talkingUsers: new Set(),
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
      setTalking: (userId, talking) =>
        set((s) => {
          const newSet = new Set(s.talkingUsers);
          if (talking) newSet.add(userId);
          else newSet.delete(userId);
          return { talkingUsers: newSet };
        }),
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
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const ticket = await invoke<string>("create_doc");
          const namespaceId = ticket.split(":")[0]; // Simplification for now
          const server: ServerEntry = {
            id: namespaceId,
            type: "p2p",
            displayName: name,
            initial: name[0].toUpperCase(),
            config: {
              p2p: {
                ticket,
                namespaceId,
                isOwner: true,
              },
            },
          };
          // Publish DID identity to the new server
          const dn = useStore.getState().displayName || name;
          await invoke("set_identity", { docId: namespaceId, displayName: dn, bio: null });
          set((s) => ({
            servers: [...s.servers, server],
            activeServerId: namespaceId,
          }));
        } catch (err) {
          console.error("Failed to create P2P server", err);
        }
      },
      joinP2PServer: async (name: string, ticket: string) => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const namespaceId = await invoke<string>("join_doc", {
            ticketStr: ticket,
          });
          const newServer: ServerEntry = {
            id: namespaceId,
            type: "p2p",
            displayName: name,
            initial: name[0].toUpperCase(),
            config: {
              p2p: { ticket, namespaceId, isOwner: false },
            },
          };
          // Publish DID identity to the joined server
          const dn = useStore.getState().displayName || name;
          await invoke("set_identity", { docId: namespaceId, displayName: dn, bio: null });
          set((s) => ({
            servers: [...s.servers, newServer],
            activeServerId: namespaceId,
          }));
        } catch (err) {
          console.error("Failed to join P2P server", err);
        }
      },
      startP2PVoice: async (docId: string) => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          // Use MoQ voice with channel-specific topic
          const channelId = useStore.getState().voiceChannelId || "voice-lounge";
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
          const state = useStore.getState();
          const server = state.servers.find((s) => s.id === state.activeServerId);
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
          };
        }),
    }),

    {
      name: "sivyspeak-storage",
      partialize: (state) => ({
        displayName: state.displayName,
        servers: state.servers,
        voiceSettings: state.voiceSettings,
        soundSettings: state.soundSettings,
      }),
    },
  ),
);
