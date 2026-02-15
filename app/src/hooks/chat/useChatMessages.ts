import { useRef } from "react";
import { useStore } from "../../store";
import { type ChannelParticipantKey } from "../../lib/crypto";
import { useMessageFetcher } from "./messages/useMessageFetcher";
import { useMessageSocket } from "./messages/useMessageSocket";

interface UseChatMessagesProps {
  activeServerId: string | null;
  activeChannelId: string | null;
  channelKeysRef: React.MutableRefObject<ChannelParticipantKey[]>;
}

export function useChatMessages({
  activeServerId,
  activeChannelId,
  channelKeysRef,
}: UseChatMessagesProps) {
  const messages = useStore((s) => s.messages);
  const hasMoreMessages = useStore((s) => s.hasMoreMessages);
  const isLoadingMore = useStore((s) => s.isLoadingMore);

  const seenMsgIds = useRef<Set<string>>(new Set());

  const { loadOlderMessages } = useMessageFetcher({
    activeServerId,
    activeChannelId,
    seenMsgIds,
  });

  const { handleWsMessage } = useMessageSocket({
    activeServerId,
    channelKeysRef,
    seenMsgIds,
  });

  return {
    messages,
    hasMoreMessages,
    isLoadingMore,
    loadOlderMessages,
    handleWsMessage,
  };
}
