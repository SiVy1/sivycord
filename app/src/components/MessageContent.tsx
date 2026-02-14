import { memo, useState } from "react";
import type { ServerEntry } from "../types";
import { getApiUrl } from "../types";

// ─── Helpers ───
function isSameOriginUrl(url: string, baseUrl: string): boolean {
  if (url.startsWith("/")) return true;
  if (!baseUrl) return false;
  try {
    const urlOrigin = new URL(url).origin;
    const baseOrigin = new URL(baseUrl).origin;
    return urlOrigin === baseOrigin;
  } catch {
    return false;
  }
}

function isSafeScheme(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith("/");
}

function ExternalImagePlaceholder({ url, alt }: { url: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  if (loaded) {
    return (
      <div className="mt-1 mb-1">
        <img
          src={url}
          alt={alt}
          className="max-w-xs max-h-64 rounded-lg border border-border cursor-pointer shadow-sm hover:shadow-md transition-shadow"
          onClick={() => window.open(url, "_blank")}
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setLoaded(true)}
      className="mt-1 mb-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-bg-surface text-text-secondary text-xs hover:bg-bg-hover transition-colors"
    >
      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <span>External image — click to load</span>
    </button>
  );
}

// ─── Message content renderer ───
// Renders links as clickable, images as inline previews

export const MessageContent = memo(function MessageContent({ content, server }: { content: string; server: ServerEntry }) {
  const { host, port } = server.config || {};
  const baseUrl = host && port ? getApiUrl(host, port) : "";

  // Parse markdown-style links: [text](url) AND custom emoji :name:
  const parts = content.split(/(\[[^\]]+\]\([^)]+\)|:[a-z0-9_]+:)/g);

  return (
    <>
      {parts.map((part, i) => {
        // Link match
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          const [, text, url] = linkMatch;

          // Block data: URIs entirely
          if (/^data:/i.test(url)) {
            return <span key={i} className="text-text-secondary italic">[blocked data: URI]</span>;
          }

          const fullUrl = url.startsWith("/") ? `${baseUrl}${url}` : url;

          // Block javascript: URIs
          if (/^javascript:/i.test(fullUrl)) {
            return <span key={i} className="text-text-secondary italic">[blocked link]</span>;
          }

          const isLocal = isSameOriginUrl(url, baseUrl);
          const isImage = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i.test(url);
          const isVideo = /\.(mp4|webm|mov|avi|mkv|ogv)$/i.test(url);
          // Uploads without recognizable extension — try to detect from path
          const isUpload =
            url.includes("/api/uploads/") && !text.startsWith("📎");

          if ((isImage || (isUpload && !isVideo)) && !text.startsWith("📎")) {
            // External images require click-to-load to prevent IP logging
            if (!isLocal) {
              return <ExternalImagePlaceholder key={i} url={fullUrl} alt={text} />;
            }
            return (
              <div key={i} className="mt-1 mb-1">
                <img
                  src={fullUrl}
                  alt={text}
                  className="max-w-xs max-h-64 rounded-lg border border-border cursor-pointer shadow-sm hover:shadow-md transition-shadow"
                  onClick={() => window.open(fullUrl, "_blank")}
                  onError={(e) => {
                    // If it fails as image, try video fallback
                    const img = e.target as HTMLImageElement;
                    const container = img.parentElement;
                    if (container) {
                      const video = document.createElement("video");
                      video.src = fullUrl;
                      video.controls = true;
                      video.className =
                        "max-w-md max-h-80 rounded-lg border border-border shadow-sm";
                      video.playsInline = true;
                      container.replaceChild(video, img);
                    }
                  }}
                />
              </div>
            );
          }

          if (isVideo) {
            if (!isLocal) {
              return (
                <a
                  key={i}
                  href={fullUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline font-medium"
                >
                  {text} (external video)
                </a>
              );
            }
            return (
              <div key={i} className="mt-1 mb-1">
                <video
                  src={fullUrl}
                  controls
                  playsInline
                  className="max-w-md max-h-80 rounded-lg border border-border shadow-sm"
                />
              </div>
            );
          }

          const safe = isSafeScheme(fullUrl);

          return (
            <a
              key={i}
              href={safe ? fullUrl : '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline font-medium"
            >
              {text}
            </a>
          );
        }

        // Emoji match
        const emojiMatch = part.match(/^:([a-z0-9_]+):$/);
        if (emojiMatch) {
          return (
            <img
              key={i}
              src={`${baseUrl}/api/uploads/emoji/${emojiMatch[1]}`}
              alt={part}
              title={part}
              className="inline-block w-6 h-6 object-contain align-bottom mx-0.5"
              onError={(e) => {
                // If not found, revert to text safely
                const el = e.target as HTMLElement;
                const text = document.createTextNode(part);
                el.parentNode?.replaceChild(text, el);
              }}
            />
          );
        }

        return <span key={i}>{part}</span>;
      })}
    </>
  );
});

export function formatTime(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const normalized = dateStr.includes("T")
      ? dateStr
      : dateStr.replace(" ", "T") + "Z";
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return dateStr;
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return (
      date.toLocaleDateString([], { month: "short", day: "numeric" }) +
      " " +
      date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  } catch {
    return dateStr;
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
