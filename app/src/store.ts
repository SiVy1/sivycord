import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ServerEntry,
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
  setVoiceChannel: (id: string | null) => void;
  setVoiceMembers: (members: VoicePeer[]) => void;
  addVoiceMember: (peer: VoicePeer) => void;
  removeVoiceMember: (userId: string) => void;
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
        set({
          activeServerId: id,
          channels: [],
          activeChannelId: null,
          messages: [],
          currentUser: null,
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
      setVoiceChannel: (id) => set({ voiceChannelId: id, voiceMembers: [] }),
      setVoiceMembers: (members) => set({ voiceMembers: members }),
      addVoiceMember: (peer) =>
        set((s) => ({
          voiceMembers: s.voiceMembers.some((m) => m.user_id === peer.user_id)
            ? s.voiceMembers
            : [...s.voiceMembers, peer],
        })),
      removeVoiceMember: (userId) =>
        set((s) => ({
          voiceMembers: s.voiceMembers.filter((m) => m.user_id !== userId),
        })),
    }),
    {
      name: "sivycord-storage",
      partialize: (state) => ({
        displayName: state.displayName,
        servers: state.servers,
      }),
    },
  ),
);
