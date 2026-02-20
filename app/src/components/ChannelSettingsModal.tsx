import { useState, useEffect } from "react";
import type { ServerEntry, Role } from "../types";
import { getApiUrl, PERMISSION_CATEGORIES, PERMISSION_DEFS } from "../types";
import { X, ShieldAlert, Check, Trash2, Shield, User } from "lucide-react";

export interface ChannelOverride {
  id?: number;
  channel_id: string;
  target_id: string;
  target_type: "role" | "member";
  allow: number;
  deny: number;
}

export function ChannelSettingsModal({
  server,
  channelId,
  onClose,
  onUpdate,
}: {
  server: ServerEntry;
  channelId: string;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const baseUrl = getApiUrl(server.config.host, server.config.port);
  const guildId = server.config.guildId || "default";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [overrides, setOverrides] = useState<ChannelOverride[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);

  // The currently selected target (role id or member id) to edit its overrides
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      try {
        const fetchOpts = {
          headers: {
            "Content-Type": "application/json",
            "X-Server-Id": guildId,
            ...(server.config.authToken
              ? { Authorization: `Bearer ${server.config.authToken}` }
              : {}),
          },
        };

        const [overridesRes, rolesRes] = await Promise.all([
          fetch(`${baseUrl}/api/channels/${channelId}/overrides`, fetchOpts),
          fetch(`${baseUrl}/api/roles`, fetchOpts),
        ]);

        if (isMounted) {
          if (overridesRes.ok) {
            setOverrides(await overridesRes.json());
          }
          if (rolesRes.ok) {
            setRoles(await rolesRes.json());
          }
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError("Failed to fetch settings.");
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, [baseUrl, channelId, guildId, server.config.authToken]);

  const handleDeleteOverride = async (targetId: string) => {
    try {
      setSaving(true);
      const res = await fetch(
        `${baseUrl}/api/channels/${channelId}/overrides/${targetId}`,
        {
          method: "DELETE",
          headers: {
            "X-Server-Id": guildId,
            ...(server.config.authToken
              ? { Authorization: `Bearer ${server.config.authToken}` }
              : {}),
          },
        },
      );

      if (!res.ok) throw new Error("Failed to delete override");
      setOverrides((prev) => prev.filter((o) => o.target_id !== targetId));
      if (selectedTargetId === targetId) setSelectedTargetId(null);
      onUpdate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error deleting override");
    } finally {
      setSaving(false);
    }
  };

  // Check state of a specific permission for the selected target
  const getPermissionState = (
    targetId: string,
    bit: number,
  ): "inherit" | "allow" | "deny" => {
    const override = overrides.find((o) => o.target_id === targetId);
    if (!override) return "inherit";
    if ((override.allow & bit) !== 0) return "allow";
    if ((override.deny & bit) !== 0) return "deny";
    return "inherit";
  };

  const togglePermission = (
    targetId: string,
    targetType: "role" | "member",
    bit: number,
    newState: "inherit" | "allow" | "deny",
  ) => {
    setOverrides((prev) => {
      const existingIdx = prev.findIndex((o) => o.target_id === targetId);
      let newOverride: ChannelOverride;

      if (existingIdx >= 0) {
        newOverride = { ...prev[existingIdx] };
      } else {
        newOverride = {
          channel_id: channelId,
          target_id: targetId,
          target_type: targetType,
          allow: 0,
          deny: 0,
        };
      }

      // Clear the bit from both
      newOverride.allow &= ~bit;
      newOverride.deny &= ~bit;

      if (newState === "allow") {
        newOverride.allow |= bit;
      } else if (newState === "deny") {
        newOverride.deny |= bit;
      }

      const nextOverrides = [...prev];
      if (existingIdx >= 0) {
        nextOverrides[existingIdx] = newOverride;
      } else {
        nextOverrides.push(newOverride);
      }

      // Attempt to save immediately just like typical role permissions editors
      // But we will just throttle or use the update button
      return nextOverrides;
    });
  };

  // Add the Save button functionality we lost previously
  const handleSave = async () => {
    try {
      setSaving(true);
      setError("");

      // Update all overrides sequentially (simplistic approach for now)
      for (const override of overrides) {
        await fetch(
          `${baseUrl}/api/channels/${channelId}/overrides/${override.target_id}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "X-Server-Id": guildId,
              ...(server.config.authToken
                ? { Authorization: `Bearer ${server.config.authToken}` }
                : {}),
            },
            body: JSON.stringify({
              target_type: override.target_type,
              allow: override.allow,
              deny: override.deny,
            }),
          },
        );
      }
      onUpdate();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error saving overrides");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl mx-4 bg-bg-secondary border border-border rounded-2xl flex flex-col overflow-hidden max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-bg-tertiary shrink-0">
          <div>
            <h3 className="text-sm font-bold text-text-primary">
              Channel Settings
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              Manage permissions and overrides for this channel
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-bg-hover rounded-lg text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0">
            {/* Sidebar */}
            <div className="w-64 border-r border-border bg-bg-secondary flex flex-col">
              <div className="p-3 border-b border-border">
                <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
                  Roles/Members
                </h4>
                <div className="space-y-1 max-h-[40vh] overflow-y-auto custom-scrollbar pr-1">
                  {/* List all roles that have overrides, plus @everyone (default guildId) */}
                  <button
                    onClick={() => setSelectedTargetId(guildId)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left ${selectedTargetId === guildId ? "bg-bg-tertiary text-text-primary font-medium" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"}`}
                  >
                    <Shield className="w-4 h-4 text-text-muted" />
                    @everyone
                  </button>
                  {overrides
                    .filter((o) => o.target_id !== guildId)
                    .map((o) => {
                      const role = roles.find((r) => r.id === o.target_id);
                      return (
                        <div
                          key={o.target_id}
                          onClick={() => setSelectedTargetId(o.target_id)}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left cursor-pointer group ${selectedTargetId === o.target_id ? "bg-bg-tertiary text-text-primary font-medium" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"}`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            {o.target_type === "role" ? (
                              <Shield
                                className="w-4 h-4 shrink-0"
                                style={{ color: role?.color || undefined }}
                              />
                            ) : (
                              <User className="w-4 h-4 shrink-0 text-text-muted" />
                            )}
                            <span className="truncate">
                              {role?.name || "Member"}
                            </span>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteOverride(o.target_id);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:text-danger hover:bg-danger/10 rounded transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                </div>

                <div className="mt-3">
                  <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
                    Add Override
                  </h4>
                  <select
                    className="w-full bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary p-2 outline-none focus:border-accent"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        setSelectedTargetId(e.target.value);
                      }
                    }}
                  >
                    <option value="" disabled>
                      Select Role...
                    </option>
                    {roles
                      .filter(
                        (r) =>
                          r.id !== guildId &&
                          !overrides.some((o) => o.target_id === r.id),
                      )
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto p-6 bg-bg-primary custom-scrollbar">
              {selectedTargetId ? (
                <div className="space-y-6">
                  <div className="flex items-center gap-2 mb-4 p-3 bg-accent/10 border border-accent/20 rounded-xl">
                    <ShieldAlert className="w-5 h-5 text-accent shrink-0" />
                    <p className="text-xs text-text-secondary leading-relaxed">
                      Permissions configured here will override the server's
                      base permissions for the selected role/member.
                    </p>
                  </div>

                  {PERMISSION_CATEGORIES.map((cat) => {
                    const perms = PERMISSION_DEFS.filter(
                      (d) => d.category === cat.key,
                    );
                    if (perms.length === 0) return null;
                    return (
                      <div
                        key={cat.key}
                        className="bg-bg-secondary border border-border/40 rounded-xl p-4"
                      >
                        <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-4 border-b border-border/40 pb-2 flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-text-muted"></div>
                          {cat.label}
                        </h4>
                        <div className="space-y-3">
                          {perms.map((p) => {
                            const state = getPermissionState(
                              selectedTargetId,
                              p.value,
                            );
                            const targetType =
                              selectedTargetId === guildId ||
                              roles.some((r) => r.id === selectedTargetId)
                                ? "role"
                                : "member";
                            return (
                              <div
                                key={p.key}
                                className="flex items-center justify-between gap-4 p-2 rounded-lg hover:bg-bg-tertiary transition-colors"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-text-primary truncate">
                                    {p.label}
                                  </div>
                                  <div className="text-xs text-text-muted truncate">
                                    {p.description}
                                  </div>
                                </div>
                                <div className="flex items-center bg-bg-tertiary border border-border rounded-lg overflow-hidden shrink-0">
                                  <button
                                    onClick={() =>
                                      togglePermission(
                                        selectedTargetId,
                                        targetType,
                                        p.value,
                                        "deny",
                                      )
                                    }
                                    className={`p-1.5 w-10 flex items-center justify-center transition-colors ${state === "deny" ? "bg-danger text-white" : "text-text-muted hover:bg-bg-hover hover:text-danger"}`}
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() =>
                                      togglePermission(
                                        selectedTargetId,
                                        targetType,
                                        p.value,
                                        "inherit",
                                      )
                                    }
                                    className={`p-1.5 w-10 flex items-center justify-center transition-colors border-l border-r border-border ${state === "inherit" ? "bg-bg-hover text-text-secondary font-medium outline-1 outline -outline-offset-1 outline-border" : "text-text-muted hover:bg-bg-hover"} text-xl leading-none`}
                                  >
                                    /
                                  </button>
                                  <button
                                    onClick={() =>
                                      togglePermission(
                                        selectedTargetId,
                                        targetType,
                                        p.value,
                                        "allow",
                                      )
                                    }
                                    className={`p-1.5 w-10 flex items-center justify-center transition-colors ${state === "allow" ? "bg-success text-white" : "text-text-muted hover:bg-bg-hover hover:text-success"}`}
                                  >
                                    <Check className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-text-muted">
                  <ShieldAlert className="w-12 h-12 mb-4 opacity-20" />
                  <p className="text-sm">
                    Select a role or member from the sidebar to manage
                    overrides.
                  </p>
                </div>
              )}

              {error && <p className="text-danger text-xs mt-4">{error}</p>}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-border bg-bg-tertiary flex justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-border rounded-xl text-sm font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors cursor-pointer flex items-center gap-2"
          >
            {saving ? (
              "Saving..."
            ) : (
              <>
                <Check className="w-4 h-4" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
