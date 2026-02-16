import { useEffect, useState } from "react";
import type { ServerEntry, Category } from "../types";
import { getApiUrl } from "../types";
import { Mic, FolderTree } from "lucide-react";

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
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | "none">(
    "none",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const guildId = server.config.guildId || "default";

  useEffect(() => {
    fetch(`${baseUrl}/api/servers/${guildId}/categories`, {
      headers: {
        ...(server.config.authToken
          ? { Authorization: `Bearer ${server.config.authToken}` }
          : {}),
      },
    })
      .then((r) => r.json())
      .then((data: Category[]) => {
        setCategories(data);
        if (data.length > 0) {
          // Default to first category if available
          setSelectedCategoryId(data[0].id);
        }
      })
      .catch((err) => console.error("Failed to fetch categories:", err));
  }, [baseUrl, guildId, server.config.authToken]);

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
          category_id:
            selectedCategoryId === "none" ? null : selectedCategoryId,
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
          className="w-full px-4 py-2.5 bg-bg-input border border-border rounded-xl text-text-primary placeholder:text-text-muted text-sm outline-none focus:border-accent transition-colors mb-4"
        />

        {/* Category selector */}
        {categories.length > 0 && (
          <div className="mb-4">
            <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest px-1 mb-1.5 block">
              Category
            </label>
            <div className="relative group/select">
              <FolderTree className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted group-focus-within/select:text-accent transition-colors" />
              <select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-bg-input border border-border rounded-xl text-text-primary text-sm outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
              >
                <option value="none">No Category</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

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
