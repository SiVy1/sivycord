import { useState, useCallback, useRef } from "react";
import { useStore } from "../store";

// Hooks
import { useChatConnection } from "../hooks/chat/useChatConnection";
import { useChatE2E } from "../hooks/chat/useChatE2E";
import { useChatMessages } from "../hooks/chat/useChatMessages";
import { useChatActions } from "../hooks/chat/useChatActions";

// Components
import { ChatHeader } from "./chat/ChatHeader";
import { ChatStreamGrid } from "./chat/ChatStreamGrid";
import { ChatPinsPanel } from "./chat/ChatPinsPanel";
import { MessageList } from "./chat/MessageList";
import { ChatInput } from "./chat/ChatInput";

interface ChatAreaProps {
  showMembers?: boolean;
  onToggleMembers?: () => void;
}

export function ChatArea({ showMembers, onToggleMembers }: ChatAreaProps = {}) {
  // Global Store
  const activeServerId = useStore((s) => s.activeServerId);
  const servers = useStore((s) => s.servers);
  const activeChannelId = useStore((s) => s.activeChannelId);
  const channels = useStore((s) => s.channels);
  const screenShares = useStore((s) => s.screenShares);
  const removeScreenShare = useStore((s) => s.removeScreenShare);
  const voiceMembers = useStore((s) => s.voiceMembers);
  const replyingTo = useStore((s) => s.replyingTo);
  const setReplyingTo = useStore((s) => s.setReplyingTo);

  const activeServer = servers.find((s) => s.id === activeServerId);
  const activeChannel = channels.find((c) => c.id === activeChannelId);
  const isAuthenticated = !!activeServer?.config.authToken;

  // Local State
  const [input, setInput] = useState("");
  const [showPins, setShowPins] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const lastTypingSentRef = useRef<number>(0);

  // 1. Connection Hook
  // We need to pass handleWsMessage to useChatConnection, but handleWsMessage comes from useChatMessages.
  // And useChatMessages needs connection info.
  // Ideally useChatConnection manages the socket and exposes it. activeChannel/Server changes are handled there.
  // useChatMessages should LISTEN to messages.
  // Let's look at how I structured it.
  // useChatConnection takes `onMessage`.
  // useChatMessages returns `handleWsMessage`.
  // This circle is fine if we init them in order.

  // 2. E2E Hook (needs wsRef from connection? connection hook exposes wsRef)
  // Actually useChatE2E needs wsRef to send key distribution.
  // So connection first.

  // Wait, I can't pass `handleWsMessage` to `useChatConnection` if `useChatMessages` isn't called yet.
  // But `useChatMessages` needs `channelKeysRef` from `useChatE2E`.
  // Cycle: Connection -> (calls onMessage) -> Messages -> (needs Keys) -> E2E -> (needs WS) -> Connection.

  // Resolution:
  // `useChatConnection` should probably NOT take onMessage in props if it causes cycle,
  // OR we use a ref for onMessage, OR we split the effect.
  // In my `useChatConnection` implementation:
  // It receives `onMessage` and calls it in `ws.onmessage`.
  // So I can define a stable callback ref or similar.

  // Let's initialize E2E first (it needs wsRef, but maybe we can pass the ref object before it's populated? Yes ref is stable object).

  // Let's create the ref manually here if needed, or better:
  // useChatConnection returns `wsRef`.

  // let's try to order nicely.

  // We need a stable ref for onMessage to break the cycle.
  const onMessageRef = useRef<((data: any) => void) | null>(null);

  const handleConnectionMessage = useCallback((data: any) => {
    onMessageRef.current?.(data);
  }, []);

  const { wsRef, wsStatus } = useChatConnection({
    activeServerId,
    activeChannelId,
    onMessage: handleConnectionMessage,
  });

  const { e2eReady, channelKeysRef } = useChatE2E(
    activeServerId,
    activeChannelId,
    wsRef,
  );

  const {
    messages,
    hasMoreMessages,
    isLoadingMore,
    loadOlderMessages,
    handleWsMessage,
  } = useChatMessages({
    activeServerId,
    activeChannelId,
    channelKeysRef,
  });

  // Assign the handler to the ref so connection hook can call it
  onMessageRef.current = handleWsMessage;

  const { uploadFile, handleSend, handleToggleReaction, handleTogglePin } =
    useChatActions({
      activeServerId,
      activeChannelId,
      wsRef,
      e2eEnabled: activeChannel?.encrypted || false, // Should use state from hook? useChatE2E returns e2eEnabled too.
      e2eReady,
      channelKeysRef,
      replyingTo,
      setReplyingTo,
      setUploading,
      setInput,
    });

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) uploadFile(file);
    },
    [uploadFile],
  );

  if (!activeChannelId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-bg-primary">
        <p className="text-text-muted text-sm">
          Select a channel to start chatting
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex flex-col bg-bg-primary"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <ChatHeader
        activeChannel={activeChannel}
        activeServer={activeServer}
        showMembers={!!showMembers} // type safety
        onToggleMembers={onToggleMembers}
        showPins={showPins}
        setShowPins={setShowPins}
        wsStatus={wsStatus}
        e2eReady={e2eReady}
      />

      {/* Drag overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-40 bg-accent/10 border-2 border-dashed border-accent rounded-xl flex items-center justify-center">
          <p className="text-accent font-medium">Drop file to upload</p>
        </div>
      )}

      {/* Stream Grid Area */}
      <ChatStreamGrid
        screenShares={screenShares}
        removeScreenShare={removeScreenShare}
        voiceMembers={voiceMembers}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Messages */}
        <MessageList
          messages={messages}
          activeServer={activeServer}
          activeChannelId={activeChannelId}
          loadOlderMessages={loadOlderMessages}
          hasMoreMessages={hasMoreMessages}
          isLoadingMore={isLoadingMore}
          wsRef={wsRef}
          setReplyingTo={setReplyingTo}
          handleTogglePin={handleTogglePin}
          handleToggleReaction={handleToggleReaction}
        />

        {/* Pins Sidebar Panel */}
        {showPins && (
          <ChatPinsPanel
            activeServer={activeServer}
            activeChannelId={activeChannelId}
            onClose={() => setShowPins(false)}
            onUnpin={(msgId) => handleTogglePin(msgId, true)}
          />
        )}
      </div>

      <ChatInput
        input={input}
        setInput={setInput}
        onSend={handleSend}
        activeServer={activeServer}
        activeChannelId={activeChannelId}
        wsStatus={wsStatus}
        isAuthenticated={isAuthenticated}
        uploading={uploading}
        onUploadFile={uploadFile}
        replyingTo={replyingTo}
        setReplyingTo={setReplyingTo}
        lastTypingSentRef={lastTypingSentRef}
        wsRef={wsRef}
      />
    </div>
  );
}
