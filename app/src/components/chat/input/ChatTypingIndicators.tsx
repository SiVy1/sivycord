import { useStore } from "../../../store";

interface ChatTypingIndicatorsProps {
  activeChannelId: string | null;
}

export function ChatTypingIndicators({
  activeChannelId,
}: ChatTypingIndicatorsProps) {
  const typingUsers = useStore((s) =>
    activeChannelId ? s.typingUsers[activeChannelId] : undefined,
  );

  if (!activeChannelId || !typingUsers) return null;

  return (
    <div className="px-4 py-1 flex items-center gap-2">
      <div className="flex gap-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-[bounce_1s_infinite_0ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-[bounce_1s_infinite_200ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-[bounce_1s_infinite_400ms]" />
      </div>
      <span className="text-[11px] text-text-muted font-medium">
        {Object.values(typingUsers)
          .map((u) => u.name)
          .join(", ")}{" "}
        {Object.keys(typingUsers).length === 1
          ? "is typing..."
          : "are typing..."}
      </span>
    </div>
  );
}
