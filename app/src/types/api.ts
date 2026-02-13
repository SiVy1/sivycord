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
