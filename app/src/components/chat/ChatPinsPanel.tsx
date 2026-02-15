import { useEffect, useState } from "react";
import { getApiUrl, type ServerEntry, type Message } from "../../types";
import { formatTime } from "../MessageContent";

interface ChatPinsPanelProps {
  activeServer: ServerEntry | undefined;
  activeChannelId: string | null;
  onClose: () => void;
  onUnpin: (messageId: string) => void;
}

export function ChatPinsPanel({
  activeServer,
  activeChannelId,
  onClose,
  onUnpin,
}: ChatPinsPanelProps) {
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);
  const [isLoadingPins, setIsLoadingPins] = useState(false);

  const fetchPins = async () => {
    if (
      !activeServer?.config.host ||
      !activeServer?.config.port ||
      !activeChannelId
    )
      return;
    setIsLoadingPins(true);
    const url = `${getApiUrl(activeServer.config.host, activeServer.config.port)}/api/channels/${activeChannelId}/pins`;
    try {
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${activeServer.config.authToken}`,
        },
      });
      if (resp.ok) {
        const data = await resp.json();
        setPinnedMessages(data);
      }
    } catch (err) {
      console.error("Failed to fetch pins:", err);
    } finally {
      setIsLoadingPins(false);
    }
  };

  useEffect(() => {
    fetchPins();
  }, [activeServer, activeChannelId]);

  return (
    <div className="w-80 bg-bg-secondary border-l border-border/50 flex-shrink-0 overflow-y-auto">
      <div className="flex flex-col h-full bg-bg-surface shadow-2xl relative z-10">
        <div className="p-4 border-b border-border/50 flex items-center justify-between bg-bg-surface/80 backdrop-blur-md sticky top-0 z-20">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-accent/20 flex items-center justify-center">
              <svg
                className="w-4 h-4 text-accent"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-bold text-text-primary leading-none">
                Pinned Messages
              </h3>
              <span className="text-[10px] text-text-muted font-medium uppercase tracking-wider">
                {pinnedMessages.length}{" "}
                {pinnedMessages.length === 1 ? "Pin" : "Pins"}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-secondary text-text-muted hover:text-text-primary transition-all"
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
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {isLoadingPins ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
              <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
              <span className="text-[10px] font-bold uppercase tracking-widest">
                Loading pins...
              </span>
            </div>
          ) : pinnedMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-bg-primary/20 rounded-2xl border border-dashed border-border/30">
              <div className="w-12 h-12 rounded-full bg-bg-surface flex items-center justify-center mb-4">
                <svg
                  className="w-6 h-6 text-text-muted/40"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
                  />
                </svg>
              </div>
              <h4 className="text-sm font-bold text-text-primary mb-1">
                No Pins Yet
              </h4>
              <p className="text-[11px] text-text-muted leading-relaxed">
                Important messages can be pinned to keep them accessible for
                everyone.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {pinnedMessages.map((msgWithReply) => {
                if (!msgWithReply.content) return null;
                return (
                  <div
                    key={msgWithReply.id}
                    className="group/pin p-3 rounded-xl bg-bg-surface/40 border border-border/30 hover:border-accent/30 transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 rounded-lg bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent">
                        {msgWithReply.userName}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[11px] font-bold text-text-primary truncate leading-tight">
                          {msgWithReply.userName}
                        </span>
                        <span className="text-[9px] text-text-muted uppercase tracking-tighter">
                          {formatTime(msgWithReply.createdAt)}
                        </span>
                      </div>
                      <button
                        className="ml-auto p-1 rounded-md opacity-0 group-hover/pin:opacity-100 hover:bg-danger/10 text-text-muted hover:text-danger transition-all"
                        title="Unpin"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUnpin(msgWithReply.id);
                        }}
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 18 18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                    <p className="text-xs text-text-secondary line-clamp-3 break-words">
                      {msgWithReply.content}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
