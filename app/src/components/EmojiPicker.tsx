import { useEffect, useState, useRef } from "react";
import { getApiUrl } from "../types";

interface Emoji {
  id: string;
  name: string;
  url: string;
  user_id: string;
}

interface EmojiPickerProps {
  serverHost: string;
  serverPort: number;
  authToken?: string;
  guildId?: string;
  onSelect: (emojiText: string) => void;
  onClose: () => void;
}

export function EmojiPicker({
  serverHost,
  serverPort,
  authToken,
  guildId,
  onSelect,
  onClose,
}: EmojiPickerProps) {
  const [emojis, setEmojis] = useState<Emoji[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const baseUrl = getApiUrl(serverHost, serverPort);

  useEffect(() => {
    fetchEmojis();
  }, []);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const fetchEmojis = async () => {
    try {
      const res = await fetch(`${baseUrl}/api/emoji`, {
        headers: { "X-Server-Id": guildId || "default" },
      });
      if (res.ok) {
        setEmojis(await res.json());
      }
    } catch {
      // silent
    }
  };

  const handleUpload = async () => {
    if (!name.trim() || !file || !authToken) return;
    setUploading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("name", name.trim().toLowerCase());
      formData.append("file", file);

      const res = await fetch(`${baseUrl}/api/emoji`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "X-Server-Id": guildId || "default",
        },
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Upload failed");
      }

      setName("");
      setFile(null);
      setShowUpload(false);
      fetchEmojis();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      ref={ref}
      className="absolute bottom-full mb-3 left-0 w-80 bg-bg-secondary border border-border/50 rounded-2xl shadow-2xl overflow-hidden z-50 backdrop-blur-xl"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-bg-primary/50">
        <span className="text-xs font-bold text-text-primary uppercase tracking-widest">
          Emojis
        </span>
        {authToken && (
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="text-xs text-accent hover:text-accent-hover transition-colors cursor-pointer"
          >
            {showUpload ? "Cancel" : "+ Add"}
          </button>
        )}
      </div>

      {showUpload && (
        <div className="p-3 border-b border-border space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) =>
              setName(e.target.value.replace(/[^a-z0-9_]/gi, ""))
            }
            placeholder="emoji_name"
            maxLength={32}
            className="w-full px-3 py-1.5 bg-bg-input border border-border rounded-lg text-text-primary text-xs outline-none focus:border-accent"
          />
          <input
            type="file"
            accept="image/png,image/gif,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="text-xs text-text-muted"
          />
          {error && <p className="text-danger text-xs">{error}</p>}
          <button
            onClick={handleUpload}
            disabled={!name.trim() || !file || uploading}
            className="w-full py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-xs rounded-lg transition-colors cursor-pointer"
          >
            {uploading ? "Uploading..." : "Upload Emoji"}
          </button>
        </div>
      )}

      <div className="p-2 max-h-48 overflow-y-auto">
        {emojis.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-4">
            No custom emoji yet
          </p>
        ) : (
          <div className="grid grid-cols-6 gap-1">
            {emojis.map((emoji) => (
              <button
                key={emoji.id}
                onClick={() => {
                  onSelect(`:${emoji.name}:`);
                  onClose();
                }}
                title={`:${emoji.name}:`}
                className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-bg-hover transition-colors cursor-pointer"
              >
                <img
                  src={`${baseUrl}${emoji.url}`}
                  alt={emoji.name}
                  className="w-7 h-7 object-contain"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
