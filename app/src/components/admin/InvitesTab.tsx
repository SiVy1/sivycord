import { useState, useEffect } from "react";
import type { ServerEntry, InviteInfo, AuditLogEntry } from "../../types";
import { getApiUrl } from "../../types";

// ─── Invites Tab ───
export function InvitesTab({ server }: { server: ServerEntry }) {
  const [invites, setInvites] = useState<InviteInfo[]>([]);

  const fetchInvites = async () => {
    try {
      const res = await fetch(
        `${getApiUrl(server.config.host, server.config.port)}/api/invites`,
      );
      setInvites(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const deleteInvite = async (code: string) => {
    if (!confirm("Are you sure you want to revoke this invite?")) return;
    try {
      await fetch(
        `${getApiUrl(server.config.host, server.config.port)}/api/invites/${code}`,
        { method: "DELETE" },
      );
      fetchInvites();
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchInvites();
  }, [server]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-lg font-bold text-text-primary">
            Active Invites
          </h3>
          <p className="text-sm text-text-muted">Manage server access links</p>
        </div>
      </div>

      <div className="bg-bg-surface rounded-2xl overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg-primary text-text-muted uppercase text-xs font-bold">
            <tr>
              <th className="px-6 py-4">Code</th>
              <th className="px-6 py-4">Uses</th>
              <th className="px-6 py-4">Max Uses</th>
              <th className="px-6 py-4">Created</th>
              <th className="px-6 py-4">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {invites.map((invite) => (
              <tr
                key={invite.code}
                className="hover:bg-bg-hover transition-colors"
              >
                <td className="px-6 py-4 font-mono text-accent">
                  {invite.code}
                </td>
                <td className="px-6 py-4 font-bold">{invite.uses}</td>
                <td className="px-6 py-4 text-text-muted">
                  {invite.max_uses || "∞"}
                </td>
                <td className="px-6 py-4 text-text-muted">
                  {new Date(invite.created_at).toLocaleDateString()}
                </td>
                <td className="px-6 py-4">
                  <button
                    onClick={() => deleteInvite(invite.code)}
                    className="text-danger hover:underline"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Audit Logs Tab ───
export function AuditLogsTab({ server }: { server: ServerEntry }) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);

  useEffect(() => {
    fetch(`http://${server.config.host}:${server.config.port}/api/audit-logs`)
      .then((res) => res.json())
      .then(setLogs);
  }, [server]);

  return (
    <div className="space-y-4">
      <div className="mb-6">
        <h3 className="text-lg font-bold text-text-primary">Audit Logs</h3>
        <p className="text-sm text-text-muted">
          Security and management history
        </p>
      </div>

      <div className="space-y-2">
        {logs.map((log) => (
          <div
            key={log.id}
            className="bg-bg-surface p-4 rounded-xl border border-border/30"
          >
            <div className="flex justify-between items-start">
              <div>
                <span className="font-bold text-accent">{log.user_name}</span>
                <span className="mx-2 text-text-muted">actioned</span>
                <span className="font-bold text-text-primary">
                  {log.action.replace("_", " ")}
                </span>
                {log.target_name && (
                  <>
                    <span className="mx-2 text-text-muted">on</span>
                    <span className="text-text-primary italic">
                      "{log.target_name}"
                    </span>
                  </>
                )}
              </div>
              <span className="text-xs text-text-muted">
                {new Date(log.created_at).toLocaleString()}
              </span>
            </div>
            {log.details && (
              <p className="mt-2 text-xs text-text-muted bg-bg-primary p-2 rounded font-mono">
                {log.details}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
