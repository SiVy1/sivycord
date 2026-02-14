import { useEffect, useState, useCallback } from "react";
import { useStore } from "../store";
import { type MemberInfo, getApiUrl } from "../types";

interface MemberListPanelProps {
  visible: boolean;
}

export function MemberListPanel({ visible }: MemberListPanelProps) {
  const activeServerId = useStore((s) => s.activeServerId);
  const servers = useStore((s) => s.servers);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const activeServer = servers.find((s) => s.id === activeServerId);

  const fetchMembers = useCallback(async () => {
    if (!activeServer || activeServer.type !== "legacy") return;
    const { host, port, authToken } = activeServer.config;
    if (!host || !port || !authToken) return;

    setLoading(true);
    try {
      const guildId = activeServer.config.guildId || "default";
      const res = await fetch(
        `${getApiUrl(host, port)}/api/servers/${encodeURIComponent(guildId)}/members`,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
            "X-Server-Id": guildId,
          },
        },
      );
      if (res.ok) {
        const data: MemberInfo[] = await res.json();
        setMembers(data);
      }
    } catch (err) {
      console.error("Failed to fetch members:", err);
    } finally {
      setLoading(false);
    }
  }, [activeServer]);

  useEffect(() => {
    if (!visible) return;
    fetchMembers();
    // Refresh every 30s
    const interval = setInterval(fetchMembers, 30_000);
    return () => clearInterval(interval);
  }, [visible, fetchMembers]);

  if (!visible) return null;

  const onlineMembers = members.filter((m) => m.is_online);
  const offlineMembers = members.filter((m) => !m.is_online);
  const bots = members.filter((m) => m.is_bot);
  const onlineHumans = onlineMembers.filter((m) => !m.is_bot);
  const offlineHumans = offlineMembers.filter((m) => !m.is_bot);

  return (
    <div className="w-60 bg-bg-secondary border-l border-border flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
          Members — {members.length}
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {loading && members.length === 0 && (
          <div className="text-center text-text-muted text-xs py-4">
            Loading...
          </div>
        )}

        {/* Online */}
        {onlineHumans.length > 0 && (
          <MemberGroup
            label={`Online — ${onlineHumans.length}`}
            members={onlineHumans}
            server={activeServer}
          />
        )}

        {/* Bots */}
        {bots.length > 0 && (
          <MemberGroup
            label={`Bots — ${bots.length}`}
            members={bots}
            server={activeServer}
          />
        )}

        {/* Offline */}
        {offlineHumans.length > 0 && (
          <MemberGroup
            label={`Offline — ${offlineHumans.length}`}
            members={offlineHumans}
            server={activeServer}
            dimmed
          />
        )}
      </div>
    </div>
  );
}

function MemberGroup({
  label,
  members,
  server,
  dimmed,
}: {
  label: string;
  members: MemberInfo[];
  server: ReturnType<typeof useStore.getState>["servers"][number] | undefined;
  dimmed?: boolean;
}) {
  return (
    <div>
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1.5 px-1">
        {label}
      </h4>
      <div className="space-y-0.5">
        {members.map((m) => (
          <MemberItem
            key={m.user_id}
            member={m}
            server={server}
            dimmed={dimmed}
          />
        ))}
      </div>
    </div>
  );
}

function MemberItem({
  member,
  server,
  dimmed,
}: {
  member: MemberInfo;
  server: ReturnType<typeof useStore.getState>["servers"][number] | undefined;
  dimmed?: boolean;
}) {
  const apiUrl =
    server?.type === "legacy" && server.config.host && server.config.port
      ? getApiUrl(server.config.host, server.config.port)
      : null;

  // Highest role color
  const topRole =
    member.roles.length > 0
      ? member.roles.reduce((a, b) => (b.position > a.position ? b : a))
      : null;

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-surface/60 transition-colors ${dimmed ? "opacity-40" : ""}`}
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        {member.avatar_url && apiUrl ? (
          <img
            src={`${apiUrl}${member.avatar_url}`}
            alt={member.display_name}
            className="w-8 h-8 rounded-full object-cover bg-bg-surface"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-bg-surface flex items-center justify-center text-xs font-bold text-accent border border-border/50">
            {(member.display_name || "?")[0]?.toUpperCase()}
          </div>
        )}
        {/* Online indicator */}
        <div
          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-bg-secondary ${
            member.is_online
              ? "bg-green-500"
              : member.is_bot
                ? "bg-accent"
                : "bg-gray-500"
          }`}
        />
      </div>

      {/* Name + role + badge */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span
            className="text-sm font-medium truncate"
            style={{ color: topRole?.color || undefined }}
          >
            {member.display_name}
          </span>
          {member.is_bot && (
            <span className="text-[8px] font-bold uppercase tracking-wider bg-accent/90 text-white px-1 py-0.5 rounded-sm leading-none flex-shrink-0">
              BOT
            </span>
          )}
        </div>
        {topRole && (
          <span className="text-[10px] text-text-muted truncate block">
            {topRole.name}
          </span>
        )}
      </div>
    </div>
  );
}
