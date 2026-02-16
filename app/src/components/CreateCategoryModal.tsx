import { useState } from "react";
import type { ServerEntry } from "../types";
import { getApiUrl } from "../types";
import { FolderPlus } from "lucide-react";

export function CreateCategoryModal({
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    setLoading(true);
    setError("");

    try {
      const guildId = server.config.guildId || "default";
      const res = await fetch(`${baseUrl}/api/servers/${guildId}/categories`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(server.config.authToken
            ? { Authorization: `Bearer ${server.config.authToken}` }
            : {}),
        },
        body: JSON.stringify({
          name: trimmed,
          position: 0, // Backend will recalculate
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to create category");
      }

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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm mx-4 bg-bg-secondary border border-border rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <FolderPlus className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">
            Create Category
          </h3>
        </div>

        <div className="mb-4">
          <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest px-1 mb-1.5 block">
            Category Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
            placeholder="New Category"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            className="w-full px-4 py-2.5 bg-bg-input border border-border rounded-xl text-text-primary placeholder:text-text-muted text-sm outline-none focus:border-accent transition-colors"
          />
        </div>

        {error && <p className="text-danger text-xs mt-2 mb-4">{error}</p>}

        <div className="flex gap-3">
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
            {loading ? "Creating..." : "Create Category"}
          </button>
        </div>
      </div>
    </div>
  );
}
