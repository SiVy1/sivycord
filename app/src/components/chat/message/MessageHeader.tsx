import { type Message, type ServerEntry, getApiUrl } from "../../../types";
import { formatTime } from "../../MessageContent";

interface MessageHeaderProps {
  msg: Message;
  activeServer: ServerEntry | undefined;
}

export function MessageHeader({ msg, activeServer }: MessageHeaderProps) {
  const avatarUrl = msg.avatarUrl;

  return (
    <div className="flex items-center gap-3 mb-1">
      {avatarUrl && activeServer ? (
        <>
          {activeServer.type === "legacy" &&
            activeServer.config.host &&
            activeServer.config.port && (
              <img
                src={`${getApiUrl(activeServer.config.host, activeServer.config.port)}${avatarUrl}`}
                alt={msg.userName}
                className="w-10 h-10 rounded-full object-cover shadow-sm bg-bg-surface"
              />
            )}
          {activeServer.type === "p2p" && (
            <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center text-white font-bold">
              {msg.userName[0].toUpperCase()}
            </div>
          )}
        </>
      ) : (
        <div className="w-10 h-10 rounded-xl bg-bg-surface flex items-center justify-center text-sm font-bold text-accent shadow-sm flex-shrink-0 border border-border/50">
          {(msg.userName || "?")[0]?.toUpperCase()}
        </div>
      )}
      <div className="flex items-baseline gap-2.5">
        <span className="text-sm font-bold text-text-primary tracking-tight">
          {msg.userName || "Unknown"}
        </span>
        {msg.isBot && (
          <span className="text-[9px] font-bold uppercase tracking-wider bg-accent/90 text-white px-1.5 py-0.5 rounded-sm leading-none">
            BOT
          </span>
        )}
        <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
          {formatTime(msg.createdAt)}
        </span>
        {msg.editedAt && (
          <span
            className="text-[10px] text-text-muted italic"
            title={`Edited ${formatTime(msg.editedAt)}`}
          >
            (edited)
          </span>
        )}
      </div>
    </div>
  );
}
