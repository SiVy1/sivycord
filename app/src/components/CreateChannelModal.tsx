import { useState } from "react";
import type { ServerEntry } from "../types";
import { getApiUrl } from "../types";
import { Mic } from "lucide-react";

export function CreateChannelModal({
  server,
  onClose,
  onCreated,
}: {
  server: ServerEntry;
  onClose: () => void;
  onCreated: () => void;
}) {
  const baseUrl = getApiUrl(server.config.host, server.config.port);
  const [name, setName] = useState("");
  const [type, setType] = useState<"text" | "voice">("text");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    const trimmed = name.trim().toLowerCase().replace(/\s+/g, "-");
    if (!trimmed) return;

    setLoading(true);
    setError("");

    try {
      const guildId = server.config.guildId || "default";
      const res = await fetch(`${baseUrl}/api/channels`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Server-Id": guildId,
          ...(server.config.authToken
            ? { Authorization: `Bearer ${server.config.authToken}` }
            : {}),
        },
        body: JSON.stringify({
          name: trimmed,
          description: "",
          channel_type: type,
        }),
      });

      if (!res.ok) throw new Error("Failed to create channel");

      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm mx-4 bg-bg-secondary border border-border rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-text-primary mb-4">
          Create Channel
        </h3>

        {/* Type selector */}
        <div className="flex gap-1 bg-bg-input rounded-lg p-1 mb-4">
          <button
            onClick={() => setType("text")}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
              type === "text"
                ? "bg-bg-hover text-text-primary"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <span>#</span> Text
          </button>
          <button
            onClick={() => setType("voice")}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
              type === "voice"
                ? "bg-bg-hover text-text-primary"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
            Voice
          </button>
        </div>

        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          placeholder="channel-name"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          className="w-full px-4 py-2.5 bg-bg-input border border-border rounded-xl text-text-primary placeholder:text-text-muted text-sm outline-none focus:border-accent transition-colors"
        />

        {error && <p className="text-danger text-xs mt-2">{error}</p>}

        <div className="flex gap-3 mt-4">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-border rounded-xl text-sm text-text-secondary hover:bg-bg-hover transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading || !name.trim()}
            className="flex-1 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors cursor-pointer"
          >
            {loading ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
