import { useState, useEffect } from "react";
import { useStore } from "../../store";
import type { ServerEntry, ServerStats } from "../../types";
import { getApiUrl } from "../../types";
import { Play } from "lucide-react";

export function ServerTab({ server }: { server: ServerEntry }) {
  const [name, setName] = useState(server.config.serverName || "");
  const [description, setDescription] = useState("");
  const [joinSoundUrl, setJoinSoundUrl] = useState<string | null>(null);
  const [leaveSoundUrl, setLeaveSoundUrl] = useState<string | null>(null);
  const [soundChance, setSoundChance] = useState<number>(100);
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"join" | "leave" | null>(null);
  const updateServerConfig = useStore((s) => s.updateServerConfig);

  useEffect(() => {
    const baseUrl = getApiUrl(server.config.host, server.config.port);
    const guildId = server.config.guildId || "default";
    fetch(`${baseUrl}/api/server`, {
      headers: { "X-Server-Id": guildId },
    })
      .then((res) => res.json())
      .then((data) => {
        setName(data.name);
        setDescription(data.description);
        setJoinSoundUrl(data.join_sound_url);
        setLeaveSoundUrl(data.leave_sound_url);
        setSoundChance(data.sound_chance ?? 100);
      })
      .catch(console.error);

    fetch(`${baseUrl}/api/stats`, {
      headers: { "X-Server-Id": guildId },
    })
      .then((res) => res.json())
      .then(setStats)
      .catch(console.error);
  }, [server]);

  const handleUpdate = async () => {
    setSaving(true);
    const baseUrl = getApiUrl(server.config.host, server.config.port);
    try {
      await fetch(`${baseUrl}/api/server`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${server.config.authToken}`,
          "X-Server-Id": server.config.guildId || "default",
        },
        body: JSON.stringify({
          name,
          description,
          join_sound_url: joinSoundUrl,
          leave_sound_url: leaveSoundUrl,
          sound_chance: soundChance,
        }),
      });

      // Update global state immediately
      if (server.id) {
        updateServerConfig(server.id, {
          serverName: name,
          joinSoundUrl: joinSoundUrl,
          leaveSoundUrl: leaveSoundUrl,
          soundChance: soundChance,
        });
      }

      alert("Server settings updated!");
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  };

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "join" | "leave",
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(type);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(
        `${getApiUrl(server.config.host, server.config.port)}/api/uploads`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${server.config.authToken}`,
            "X-Server-Id": server.config.guildId || "default",
          },
          body: formData,
        },
      );
      const data = await res.json();
      if (type === "join") setJoinSoundUrl(data.url);
      else setLeaveSoundUrl(data.url);
    } catch (err) {
      console.error("Upload failed", err);
      alert("Upload failed");
    } finally {
      setUploading(null);
    }
  };

  const playPreview = (url: string | null) => {
    if (!url) return;
    const fullUrl = url.startsWith("http")
      ? url
      : `${getApiUrl(server.config.host, server.config.port)}${url}`;
    const audio = new Audio(fullUrl);
    audio.volume = 0.5;
    audio.play().catch(console.error);
  };

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h3 className="text-lg font-bold text-text-primary">Server Settings</h3>
        <p className="text-sm text-text-muted">
          Configure server-wide settings
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Settings Form */}
        <div className="bg-bg-surface rounded-xl p-6 space-y-4">
          <h4 className="font-bold text-text-primary">Server Information</h4>
          <div>
            <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
              Server Name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-bg-primary text-text-primary px-4 py-2 rounded-lg border border-border/50 focus:border-accent outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-bg-primary text-text-primary px-4 py-2 rounded-lg border border-border/50 focus:border-accent outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
                Join Sound
              </label>
              <div className="flex flex-col gap-2">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => handleFileUpload(e, "join")}
                  className="hidden"
                  id="join-sound-upload"
                />
                <label
                  htmlFor="join-sound-upload"
                  className={`w-full py-2 px-3 bg-bg-primary border border-border/50 rounded-lg text-xs font-bold text-center cursor-pointer transition-colors ${
                    uploading === "join"
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:bg-bg-hover hover:border-accent/50"
                  }`}
                >
                  {uploading === "join"
                    ? "Uploading..."
                    : "📁 Upload Join Sound"}
                </label>
                {joinSoundUrl && (
                  <div className="flex items-center justify-between bg-bg-primary px-2 py-1 rounded-lg border border-border/30 overflow-hidden">
                    <span className="text-[10px] text-success font-medium truncate max-w-[100px]">
                      ✅ {joinSoundUrl.split("/").pop()}
                    </span>
                    <button
                      onClick={() => playPreview(joinSoundUrl)}
                      className="p-1 hover:bg-bg-hover rounded text-accent transition-colors flex-shrink-0"
                      title="Play Preview"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
                Leave Sound
              </label>
              <div className="flex flex-col gap-2">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => handleFileUpload(e, "leave")}
                  className="hidden"
                  id="leave-sound-upload"
                />
                <label
                  htmlFor="leave-sound-upload"
                  className={`w-full py-2 px-3 bg-bg-primary border border-border/50 rounded-lg text-xs font-bold text-center cursor-pointer transition-colors ${
                    uploading === "leave"
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:bg-bg-hover hover:border-accent/50"
                  }`}
                >
                  {uploading === "leave"
                    ? "Uploading..."
                    : "📁 Upload Leave Sound"}
                </label>
                {leaveSoundUrl && (
                  <div className="flex items-center justify-between bg-bg-primary px-2 py-1 rounded-lg border border-border/30 overflow-hidden">
                    <span className="text-[10px] text-success font-medium truncate max-w-[100px]">
                      ✅ {leaveSoundUrl.split("/").pop()}
                    </span>
                    <button
                      onClick={() => playPreview(leaveSoundUrl)}
                      className="p-1 hover:bg-bg-hover rounded text-accent transition-colors flex-shrink-0"
                      title="Play Preview"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-bg-primary/50 p-4 rounded-xl border border-border/30">
            <div className="flex justify-between mb-2">
              <label className="text-xs font-bold text-text-muted uppercase tracking-wider">
                🎲 Sound Playback Chance
              </label>
              <span className="text-sm font-bold text-accent">
                {soundChance}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={soundChance}
              onChange={(e) => setSoundChance(parseInt(e.target.value))}
              className="w-full h-1.5 bg-bg-surface rounded-lg appearance-none cursor-pointer accent-accent"
            />
            <p className="text-[10px] text-text-muted mt-2">
              Determines how often the custom sounds play. Set to 100% for every
              time.
            </p>
          </div>

          <button
            onClick={handleUpdate}
            disabled={saving || !!uploading}
            className="w-full py-2 bg-accent text-white rounded-lg font-bold hover:bg-accent/90 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>

        {/* Statistics */}
        <div className="bg-bg-surface rounded-xl p-6">
          <h4 className="font-bold text-text-primary mb-4">
            Server Statistics
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-bg-primary p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-accent">
                {stats?.total_users || 0}
              </div>
              <div className="text-xs text-text-muted">Users</div>
            </div>
            <div className="bg-bg-primary p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-success">
                {stats?.total_messages || 0}
              </div>
              <div className="text-xs text-text-muted">Messages</div>
            </div>
            <div className="bg-bg-primary p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-warning">
                {stats?.total_channels || 0}
              </div>
              <div className="text-xs text-text-muted">Channels</div>
            </div>
            <div className="bg-bg-primary p-3 rounded-lg text-center">
              <div className="text-2xl font-bold text-danger">
                {stats?.total_roles || 0}
              </div>
              <div className="text-xs text-text-muted">Roles</div>
            </div>
          </div>
        </div>
      </div>

      {/* Advanced Connection Info */}
      <div className="bg-bg-surface rounded-xl p-6">
        <h4 className="font-bold text-text-primary mb-4">Connection Details</h4>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-text-muted">Host:</span>
            <span className="text-text-primary font-mono">
              {server.config.host}:{server.config.port}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Direct Invite:</span>
            <span className="text-text-primary font-mono text-xs truncate max-w-[300px]">
              {server.config.inviteCode}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
