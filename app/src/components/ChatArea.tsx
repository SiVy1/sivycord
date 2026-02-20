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
import { ChannelPluginView } from "./ChannelPluginView";

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
      e2eEnabled: activeChannel?.encrypted || false,
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

      {activeChannel?.channel_type === "plugin" ? (
        // Iframe Sandbox View for Plugin Channels
        <ChannelPluginView channelId={activeChannelId} />
      ) : (
        // Standard Chat View
        <>
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
        </>
      )}
    </div>
  );
}
