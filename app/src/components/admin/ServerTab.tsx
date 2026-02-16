import { useState, useEffect } from "react";
import { useStore } from "../../store";
import type { ServerEntry, ServerStats } from "../../types";
import { getApiUrl } from "../../types";
import {
  Play,
  Server,
  Users,
  MessageSquare,
  Hash,
  Shield,
  Save,
  Upload,
  Globe,
  Copy,
  Check,
  Volume2,
  Music,
} from "lucide-react";
import { motion } from "framer-motion";

export function ServerTab({ server }: { server: ServerEntry }) {
  const [name, setName] = useState(server.config.serverName || "");
  const [description, setDescription] = useState("");
  const [joinSoundUrl, setJoinSoundUrl] = useState<string | null>(null);
  const [leaveSoundUrl, setLeaveSoundUrl] = useState<string | null>(null);
  const [soundChance, setSoundChance] = useState<number>(100);
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"join" | "leave" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const updateServerConfig = useStore((s) => s.updateServerConfig);

  useEffect(() => {
    const baseUrl = getApiUrl(server.config.host, server.config.port);
    const guildId = server.config.guildId || "default";

    const fetchData = async () => {
      try {
        const serverRes = await fetch(`${baseUrl}/api/server`, {
          headers: { "X-Server-Id": guildId },
        });
        if (serverRes.ok) {
          const data = await serverRes.json();
          setName(data.name);
          setDescription(data.description || "");
          setJoinSoundUrl(data.join_sound_url);
          setLeaveSoundUrl(data.leave_sound_url);
          setSoundChance(data.sound_chance ?? 100);
        }

        const statsRes = await fetch(`${baseUrl}/api/stats`, {
          headers: { "X-Server-Id": guildId },
        });
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(statsData);
        }
      } catch (error) {
        console.error("Failed to fetch server data:", error);
      }
    };

    fetchData();
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

      // Show success feedback (could use toast in future)
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

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-8 max-w-5xl mx-auto pb-10"
    >
      {/* Hero Section */}
      <motion.div
        variants={itemVariants}
        className="flex items-center gap-6 p-6 bg-gradient-to-r from-bg-secondary to-bg-tertiary rounded-2xl border border-border/20 shadow-lg"
      >
        <div className="w-20 h-20 rounded-2xl bg-accent/20 flex items-center justify-center text-accent shadow-inner border border-accent/20">
          {server.config.serverName ? (
            <span className="text-3xl font-bold">
              {server.config.serverName.substring(0, 2).toUpperCase()}
            </span>
          ) : (
            <Server className="w-10 h-10" />
          )}
        </div>
        <div>
          <h1 className="text-3xl font-bold text-text-primary tracking-tight">
            {name || "Unnamed Server"}
          </h1>
          <p className="text-text-muted mt-1 flex items-center gap-2">
            <Globe className="w-4 h-4" />
            {server.config.host}:{server.config.port}
          </p>
        </div>
        <div className="ml-auto">
          <button
            onClick={handleUpdate}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-3 bg-accent hover:bg-accent/90 text-white rounded-xl font-bold transition-all shadow-lg shadow-accent/20 disabled:opacity-50 disabled:shadow-none"
          >
            {saving ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </motion.div>

      {/* Stats Grid */}
      <motion.div
        variants={itemVariants}
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        <StatsCard
          icon={Users}
          label="Members"
          value={stats?.total_users || 0}
          color="text-blue-400"
          bg="bg-blue-400/10"
        />
        <StatsCard
          icon={MessageSquare}
          label="Messages"
          value={stats?.total_messages || 0}
          color="text-green-400"
          bg="bg-green-400/10"
        />
        <StatsCard
          icon={Hash}
          label="Channels"
          value={stats?.total_channels || 0}
          color="text-yellow-400"
          bg="bg-yellow-400/10"
        />
        <StatsCard
          icon={Shield}
          label="Roles"
          value={stats?.total_roles || 0}
          color="text-red-400"
          bg="bg-red-400/10"
        />
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Settings */}
        <div className="lg:col-span-2 space-y-8">
          {/* General Settings */}
          <motion.div
            variants={itemVariants}
            className="bg-bg-surface rounded-2xl p-6 border border-border/10 shadow-sm"
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-text-primary/5 rounded-lg">
                <Server className="w-5 h-5 text-text-primary" />
              </div>
              <h3 className="text-lg font-bold text-text-primary">
                General Settings
              </h3>
            </div>

            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-wider ml-1">
                  Server Name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-bg-primary text-text-primary px-4 py-3 rounded-xl border border-border/50 focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all placeholder:text-text-muted/30"
                  placeholder="My Awesome Server"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-wider ml-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full bg-bg-primary text-text-primary px-4 py-3 rounded-xl border border-border/50 focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all placeholder:text-text-muted/30 resize-none"
                  placeholder="Tell us what this server is about..."
                />
              </div>
            </div>
          </motion.div>

          {/* Audio Configuration */}
          <motion.div
            variants={itemVariants}
            className="bg-bg-surface rounded-2xl p-6 border border-border/10 shadow-sm"
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-pink-500/10 rounded-lg">
                <Music className="w-5 h-5 text-pink-500" />
              </div>
              <h3 className="text-lg font-bold text-text-primary">
                Sound Effects
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <SoundUploader
                label="Join Sound"
                url={joinSoundUrl}
                uploading={uploading === "join"}
                onUpload={(e) => handleFileUpload(e, "join")}
                onPreview={() => playPreview(joinSoundUrl)}
                color="text-green-400"
              />
              <SoundUploader
                label="Leave Sound"
                url={leaveSoundUrl}
                uploading={uploading === "leave"}
                onUpload={(e) => handleFileUpload(e, "leave")}
                onPreview={() => playPreview(leaveSoundUrl)}
                color="text-red-400"
              />
            </div>

            <div className="bg-bg-primary/40 rounded-xl p-5 border border-border/30">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-text-muted" />
                  <span className="text-sm font-bold text-text-secondary">
                    Playback Probability
                  </span>
                </div>
                <span className="px-2 py-1 bg-accent/10 text-accent text-xs font-bold rounded-md">
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
                className="w-full h-2 bg-bg-tertiary rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent/80 transition-all"
              />
              <div className="flex justify-between text-[10px] text-text-muted mt-2 font-medium uppercase tracking-wider">
                <span>Never</span>
                <span>Always</span>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Right Column: Connection Info */}
        <motion.div variants={itemVariants} className="lg:col-span-1 space-y-6">
          <div className="bg-bg-surface rounded-2xl p-6 border border-border/10 sticky top-4">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Globe className="w-5 h-5 text-blue-500" />
              </div>
              <h3 className="text-lg font-bold text-text-primary">
                Connection
              </h3>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-wider">
                  Host Address
                </label>
                <div className="group relative">
                  <div className="bg-bg-primary text-text-secondary font-mono text-sm px-4 py-3 rounded-xl border border-border/50 truncate pr-10">
                    {server.config.host}:{server.config.port}
                  </div>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        `${server.config.host}:${server.config.port}`,
                        "host",
                      )
                    }
                    className="absolute right-2 top-2 p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors"
                  >
                    {copied === "host" ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-text-muted uppercase tracking-wider">
                  Invite Code
                </label>
                <div className="group relative">
                  <div className="bg-bg-primary text-text-secondary font-mono text-sm px-4 py-3 rounded-xl border border-border/50 truncate pr-10">
                    {server.config.inviteCode || "No invite code"}
                  </div>
                  <button
                    onClick={() =>
                      copyToClipboard(server.config.inviteCode || "", "invite")
                    }
                    className="absolute right-2 top-2 p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors"
                  >
                    {copied === "invite" ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-border/10">
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Protocol</span>
                    <span className="text-text-primary font-medium">
                      {server.type === "p2p"
                        ? "P2P (Iroh)"
                        : "WebSocket (Legacy)"}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Guild ID</span>
                    <span className="text-text-primary font-mono text-xs">
                      {server.config.guildId || "default"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

function StatsCard({
  icon: Icon,
  label,
  value,
  color,
  bg,
}: {
  icon: any;
  label: string;
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <div className="bg-bg-surface hover:bg-bg-surface/80 transition-colors p-5 rounded-xl border border-border/10 flex flex-col items-center justify-center text-center gap-3 shadow-sm group">
      <div
        className={`p-3 rounded-xl ${bg} ${color} group-hover:scale-110 transition-transform`}
      >
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <div className="text-2xl font-bold text-text-primary">{value}</div>
        <div className="text-xs font-bold text-text-muted uppercase tracking-wider">
          {label}
        </div>
      </div>
    </div>
  );
}

function SoundUploader({
  label,
  url,
  uploading,
  onUpload,
  onPreview,
  color,
}: {
  label: string;
  url: string | null;
  uploading: boolean;
  onUpload: (e: any) => void;
  onPreview: () => void;
  color: string;
}) {
  const id = `sound-upload-${label.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-text-muted uppercase tracking-wider ml-1">
        {label}
      </label>
      <div className="relative group">
        <input
          type="file"
          accept="audio/*"
          onChange={onUpload}
          className="hidden"
          id={id}
        />
        <label
          htmlFor={id}
          className={`block w-full h-12 dashed-border rounded-xl flex items-center justify-center text-xs font-bold text-text-muted cursor-pointer transition-all ${
            uploading
              ? "opacity-50 cursor-not-allowed bg-bg-primary/50"
              : "hover:bg-bg-primary hover:text-accent hover:border-accent/30"
          } ${url ? "bg-bg-primary border-solid border-border/30" : "bg-bg-tertiary/30 border-dashed border-border/50"}`}
        >
          {uploading ? (
            <span className="flex items-center gap-2">
              <Upload className="w-3 h-3 animate-bounce" /> Uploading...
            </span>
          ) : url ? (
            <div className="flex items-center justify-between w-full px-4">
              <span
                className={`flex items-center gap-2 ${color} truncate max-w-[120px]`}
              >
                <Music className="w-3 h-3" />
                {url.split("/").pop()}
              </span>
              <span className="text-[10px] bg-bg-surface py-1 px-2 rounded text-text-muted">
                Change
              </span>
            </div>
          ) : (
            <span className="flex items-center gap-2">
              <Upload className="w-3 h-3" /> Upload Audio File
            </span>
          )}
        </label>

        {url && (
          <button
            onClick={(e) => {
              e.preventDefault();
              onPreview();
            }}
            className="absolute right-14 top-1/2 -translate-y-1/2 p-1.5 hover:bg-bg-surface rounded-lg text-text-muted hover:text-accent transition-colors z-10"
            title="Play Preview"
          >
            <Play className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
