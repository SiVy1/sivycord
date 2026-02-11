import { useState } from "react";
import { useStore } from "../store";
import { AuthScreen } from "./AuthScreen";
import { decodeToken } from "../types";
import { v4 as uuidv4 } from "uuid";
import type { AuthUser } from "../types";

type Tab = "token" | "direct";
type Step = "connect" | "auth";

const CONNECT_TIMEOUT = 8000;

export function AddServerModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("direct");
  const [step, setStep] = useState<Step>("connect");
  const [token, setToken] = useState("");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("3000");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingServer, setPendingServer] = useState<{
    host: string;
    port: number;
    serverId: string;
    serverName: string;
    inviteCode: string;
  } | null>(null);

  const servers = useStore((s) => s.servers);
  const addServer = useStore((s) => s.addServer);
  const setActiveServer = useStore((s) => s.setActiveServer);
  const updateServerAuth = useStore((s) => s.updateServerAuth);
  const setCurrentUser = useStore((s) => s.setCurrentUser);
  const setDisplayName = useStore((s) => s.setDisplayName);

  const joinWithConfig = async (
    hostVal: string,
    portVal: number,
    inviteCode?: string,
  ) => {
    setError("");
    setLoading(true);

    // Check duplicate server
    const existing = servers.find(
      (s) => s.config.host === hostVal && s.config.port === portVal,
    );
    if (existing) {
      setActiveServer(existing.id);
      onClose();
      setLoading(false);
      return;
    }

    try {
      // Just check if server is reachable
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT);

      const res = await fetch(`http://${hostVal}:${portVal}/api/server`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();

      const serverId = uuidv4();
      const serverName = data.name || hostVal;

      // Create server entry without auth first
      addServer({
        id: serverId,
        config: {
          host: hostVal,
          port: portVal,
          inviteCode: inviteCode || "",
          serverName,
        },
        displayName: "",
        initial: serverName[0]?.toUpperCase() || "?",
      });

      // Show auth screen
      setPendingServer({
        host: hostVal,
        port: portVal,
        serverId,
        serverName,
        inviteCode: inviteCode || "",
      });
      setStep("auth");
    } catch (err: any) {
      if (err.name === "AbortError") {
        setError("Connection timed out — is the server running?");
      } else if (err.message?.includes("fetch")) {
        setError("Cannot reach server — check host and port");
      } else {
        setError(err instanceof Error ? err.message : "Connection failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = (user: AuthUser, authToken: string) => {
    if (!pendingServer) return;
    updateServerAuth(pendingServer.serverId, authToken, user.id);
    setCurrentUser(user);
    setDisplayName(user.display_name);
    setActiveServer(pendingServer.serverId);
    onClose();
  };

  const handleGuestSkip = () => {
    if (!pendingServer) return;
    setActiveServer(pendingServer.serverId);
    onClose();
  };

  const handleTokenJoin = async () => {
    const trimmed = token.trim();
    if (!trimmed) return;
    try {
      const decoded = decodeToken(trimmed);
      if (!decoded.host || !decoded.port) {
        setError("Invalid token format");
        return;
      }
      await joinWithConfig(decoded.host, decoded.port, decoded.invite_code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid token");
    }
  };

  const handleDirectJoin = async () => {
    const h = host.trim();
    const p = parseInt(port.trim());
    if (!h) {
      setError("Host cannot be empty");
      return;
    }
    if (isNaN(p) || p < 1 || p > 65535) {
      setError("Port must be between 1 and 65535");
      return;
    }
    await joinWithConfig(h, p);
  };

  // Auth step
  if (step === "auth" && pendingServer) {
    return (
      <AuthScreen
        serverHost={pendingServer.host}
        serverPort={pendingServer.port}
        onAuth={handleAuth}
        onSkip={handleGuestSkip}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md mx-4 bg-bg-secondary border border-border rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-text-primary mb-4">
          Join a server
        </h2>

        {/* Tabs */}
        <div className="flex gap-1 bg-bg-input rounded-lg p-1 mb-5">
          <button
            onClick={() => {
              setTab("direct");
              setError("");
            }}
            className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              tab === "direct"
                ? "bg-bg-hover text-text-primary"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            Direct Connect
          </button>
          <button
            onClick={() => {
              setTab("token");
              setError("");
            }}
            className={`flex-1 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              tab === "token"
                ? "bg-bg-hover text-text-primary"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            Invite Token
          </button>
        </div>

        {tab === "direct" ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-text-secondary mb-1 block">
                Host
              </label>
              <input
                type="text"
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  setError("");
                }}
                placeholder="localhost or IP"
                maxLength={253}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleDirectJoin()}
                className="w-full px-4 py-2.5 bg-bg-input border border-border rounded-xl text-text-primary placeholder:text-text-muted text-sm outline-none focus:border-accent transition-colors"
              />
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">
                Port
              </label>
              <input
                type="number"
                value={port}
                onChange={(e) => {
                  setPort(e.target.value);
                  setError("");
                }}
                placeholder="3000"
                min={1}
                max={65535}
                onKeyDown={(e) => e.key === "Enter" && handleDirectJoin()}
                className="w-full px-4 py-2.5 bg-bg-input border border-border rounded-xl text-text-primary placeholder:text-text-muted text-sm outline-none focus:border-accent transition-colors"
              />
            </div>
          </div>
        ) : (
          <textarea
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setError("");
            }}
            placeholder="Paste invite token here..."
            rows={3}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleTokenJoin();
              }
            }}
            className="w-full px-4 py-3 bg-bg-input border border-border rounded-xl text-text-primary placeholder:text-text-muted text-sm outline-none focus:border-accent transition-colors resize-none font-mono"
          />
        )}

        {error && <p className="text-danger text-xs mt-2">{error}</p>}

        <div className="flex gap-3 mt-5">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 border border-border rounded-xl text-sm text-text-secondary hover:bg-bg-hover transition-colors cursor-pointer disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={tab === "direct" ? handleDirectJoin : handleTokenJoin}
            disabled={
              loading || (tab === "token" ? !token.trim() : !host.trim())
            }
            className="flex-1 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors cursor-pointer"
          >
            {loading ? "Connecting..." : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
