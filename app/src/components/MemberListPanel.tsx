import { useEffect, useState, useCallback, useRef, memo } from "react";
import { useStore } from "../store";
import { type MemberInfo, getApiUrl } from "../types";
import type { P2PIdentity } from "../types/p2p-identity";

interface PresenceInfo {
  node_id: string;
  timestamp: number;
}

interface MemberListPanelProps {
  visible: boolean;
}

function membersEqual(a: MemberInfo[], b: MemberInfo[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].user_id !== b[i].user_id || a[i].is_online !== b[i].is_online || a[i].display_name !== b[i].display_name) return false;
  }
  return true;
}

export function MemberListPanel({ visible }: MemberListPanelProps) {
  const activeServerId = useStore((s) => s.activeServerId);
  const servers = useStore((s) => s.servers);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const membersRef = useRef<MemberInfo[]>([]);

  const activeServer = servers.find((s) => s.id === activeServerId);

  // Legacy server member fetching
  const fetchLegacyMembers = useCallback(async () => {
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
        if (!membersEqual(membersRef.current, data)) {
          membersRef.current = data;
          setMembers(data);
        }
      }
    } catch (err) {
      console.error("Failed to fetch members:", err);
    } finally {
      setLoading(false);
    }
  }, [activeServer]);

  // P2P member fetching via Iroh identities + presence
  const fetchP2PMembers = useCallback(async () => {
    if (!activeServer || activeServer.type !== "p2p") return;
    const docId = activeServer.config.p2p?.namespaceId;
    if (!docId) return;

    setLoading(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const [identities, presences] = await Promise.all([
        invoke<P2PIdentity[]>("list_identities", { docId }),
        invoke<PresenceInfo[]>("list_presences", { docId }),
      ]);

      const onlineSet = new Set(presences.map((p) => p.node_id));

      const data: MemberInfo[] = identities.map((id) => ({
        user_id: id.node_id,
        username: id.node_id.substring(0, 8),
        display_name: id.display_name,
        avatar_url: null,
        is_online: onlineSet.has(id.node_id),
        is_bot: false,
        roles: [],
        joined_at: new Date().toISOString(),
      }));

      // Sort: online first
      data.sort((a, b) => (a.is_online === b.is_online ? 0 : a.is_online ? -1 : 1));

      if (!membersEqual(membersRef.current, data)) {
        membersRef.current = data;
        setMembers(data);
      }
    } catch (err) {
      console.error("Failed to fetch P2P members:", err);
    } finally {
      setLoading(false);
    }
  }, [activeServer]);

  const fetchMembers = useCallback(async () => {
    if (!activeServer) return;
    if (activeServer.type === "p2p") {
      await fetchP2PMembers();
    } else {
      await fetchLegacyMembers();
    }
  }, [activeServer, fetchP2PMembers, fetchLegacyMembers]);

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

const MemberGroup = memo(function MemberGroup({
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
});

const MemberItem = memo(function MemberItem({
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
});
