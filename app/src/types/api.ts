// ─── Connection Token & API Helpers ───

export interface ConnectionToken {
  host: string;
  port: number;
  invite_code: string;
}

export function decodeToken(encoded: string): ConnectionToken {
  const json = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(json);
}

export function getApiUrl(host?: string, port?: number): string {
  const protocol = port === 443 ? "https" : "http";
  return `${protocol}://${host ?? "localhost"}:${port ?? 80}`;
}

export function getWsUrl(host: string, port: number): string {
  const protocol = port === 443 ? "wss" : "ws";
  return `${protocol}://${host}:${port}`;
}

/**
 * Build standard headers for API requests, including Authorization and X-Server-Id.
 * @param authToken JWT auth token (optional)
 * @param guildId Logical server / guild ID (defaults to "default")
 */
export function authHeaders(
  authToken?: string,
  guildId?: string,
): Record<string, string> {
  const h: Record<string, string> = {
    "X-Server-Id": guildId || "default",
  };
  if (authToken) {
    h["Authorization"] = `Bearer ${authToken}`;
  }
  return h;
}
