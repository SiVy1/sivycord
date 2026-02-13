import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../store";
import { AuthScreen } from "./AuthScreen";
import { decodeToken, getApiUrl } from "../types";
import { v4 as uuidv4 } from "uuid";
import type { AuthUser } from "../types";

type Tab = "token" | "direct";
type Step = "connect" | "auth";

const CONNECT_TIMEOUT = 8000;

export function AddServerModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<
    "choice" | "legacy" | "p2p-create" | "p2p-join"
  >("choice");
  const [name, setName] = useState("");
  const [ticket, setTicket] = useState("");
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

      const baseUrl = getApiUrl(hostVal, portVal);
      const res = await fetch(`${baseUrl}/api/server`, {
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
        type: "legacy",
        config: {
          host: hostVal,
          port: portVal,
          inviteCode: inviteCode || "",
          serverName,
        },
        displayName: serverName,
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
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Connection timed out — is the server running?");
      } else if (err instanceof Error && err.message?.includes("fetch")) {
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
    let h = host.trim();
    let p = parseInt(port.trim());

    if (!h) {
      setError("Host cannot be empty");
      return;
    }

    // Handle host:port syntax
    if (h.includes(":")) {
      const [addr, portStr] = h.split(":");
      h = addr;
      const parsed = parseInt(portStr);
      if (!isNaN(parsed)) p = parsed;
    }

    setLoading(true);
    setError("");

    try {
      // Try SRV resolution
      const srv: { host: string; port: number } | null = await invoke(
        "resolve_srv",
        { domain: h },
      );
      if (srv) {
        h = srv.host;
        p = srv.port;
      }
    } catch (err) {
      console.warn("SRV resolution failed or not available:", err);
    }

    if (isNaN(p) || p < 1 || p > 65535) {
      setError("Port must be between 1 and 65535");
      setLoading(false);
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

  if (mode === "choice") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md"
        onClick={onClose}
      >
        <div
          className="w-full max-w-md mx-4 bg-bg-secondary border border-border/50 rounded-3xl p-8 shadow-2xl relative"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <h2 className="text-2xl font-bold text-text-primary mb-2 tracking-tight">
            Add a Server
          </h2>
          <p className="text-sm text-text-secondary mb-8">
            Choose how you want to connect.
          </p>

          <div className="grid grid-cols-1 gap-4">
            <button
              onClick={() => setMode("p2p-create")}
              className="group p-6 bg-bg-surface border border-border/40 hover:border-accent/40 rounded-2xl text-left transition-all hover:shadow-lg hover:shadow-accent/5"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center text-accent group-hover:bg-accent group-hover:text-white transition-all">
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="font-bold text-text-primary">
                    Create P2P Server
                  </h3>
                  <p className="text-xs text-text-muted">
                    Private, decentralized, and serverless.
                  </p>
                </div>
              </div>
            </button>

            <button
              onClick={() => setMode("p2p-join")}
              className="group p-6 bg-bg-surface border border-border/40 hover:border-accent/40 rounded-2xl text-left transition-all hover:shadow-lg hover:shadow-accent/5"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center text-accent group-hover:bg-accent group-hover:text-white transition-all">
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="font-bold text-text-primary">
                    Join P2P Server
                  </h3>
                  <p className="text-xs text-text-muted">
                    Enter a Ticket (invite code) to join.
                  </p>
                </div>
              </div>
            </button>

            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border/20"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-bg-secondary px-2 text-text-muted uppercase tracking-widest font-bold">
                  Or
                </span>
              </div>
            </div>

            <button
              onClick={() => setMode("legacy")}
              className="group p-6 bg-bg-surface/50 border border-border/20 hover:border-text-muted/40 rounded-2xl text-left transition-all"
            >
              <div className="flex items-center gap-4 opacity-70 group-hover:opacity-100 transition-opacity">
                <div className="w-12 h-12 rounded-xl bg-text-muted/10 flex items-center justify-center text-text-muted group-hover:bg-text-muted group-hover:text-white transition-all">
                  <svg
                    className="w-6 h-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="font-bold text-text-primary">
                    Classic Server
                  </h3>
                  <p className="text-xs text-text-muted">
                    Connect to a self-hosted instance.
                  </p>
                </div>
              </div>
            </button>
          </div>

          <button
            onClick={onClose}
            className="w-full mt-8 py-3 text-sm font-bold text-text-muted hover:text-text-primary transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (mode === "p2p-create") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md"
        onClick={onClose}
      >
        <div
          className="w-full max-w-md mx-4 bg-bg-secondary border border-border/50 rounded-3xl p-8 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-2xl font-bold text-text-primary mb-2">
            Create P2P Server
          </h2>
          <p className="text-sm text-text-secondary mb-6">
            Give your new server a name.
          </p>
          <input
            type="text"
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setName(e.target.value)
            }
            placeholder="e.g. Secret Lair"
            autoFocus
            className="w-full px-4 py-3 bg-bg-input border border-border/50 rounded-xl text-text-primary outline-none focus:border-accent transition-all mb-8"
          />
          <div className="flex gap-3">
            <button
              onClick={() => setMode("choice")}
              className="flex-1 py-3 text-sm font-bold text-text-muted"
            >
              Back
            </button>
            <button
              onClick={async () => {
                await useStore.getState().createP2PServer(name);
                onClose();
              }}
              className="flex-[2] py-3 bg-accent text-white rounded-xl font-bold"
            >
              Create Server
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "p2p-join") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md"
        onClick={onClose}
      >
        <div
          className="w-full max-w-md mx-4 bg-bg-secondary border border-border/50 rounded-3xl p-8 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-2xl font-bold text-text-primary mb-2">
            Join P2P Server
          </h2>
          <p className="text-sm text-text-secondary mb-6">
            Enter the ticket provided by your friend.
          </p>
          <textarea
            value={ticket}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setTicket(e.target.value)
            }
            placeholder="Paste ticket here..."
            className="w-full px-4 py-3 bg-bg-input border border-border/50 rounded-xl text-text-primary outline-none focus:border-accent transition-all h-32 mb-8 font-mono text-xs"
          />
          <div className="flex gap-3">
            <button
              onClick={() => setMode("choice")}
              className="flex-1 py-3 text-sm font-bold text-text-muted"
            >
              Back
            </button>
            <button
              onClick={async () => {
                await useStore.getState().joinP2PServer("GXP Server", ticket);
                onClose();
              }}
              className="flex-[2] py-3 bg-accent text-white rounded-xl font-bold"
            >
              Join
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md mx-4 bg-bg-secondary border border-border/50 rounded-3xl p-8 shadow-2xl relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setMode("choice")}
          className="absolute top-4 left-4 text-text-muted hover:text-text-primary text-xs font-bold uppercase tracking-widest"
        >
          Back
        </button>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-accent/0 via-accent to-accent/0 opacity-50" />

        <h2 className="text-2xl font-bold text-text-primary mb-2 mt-4 tracking-tight">
          Join Classic Server
        </h2>
        <p className="text-sm text-text-secondary mb-6">
          Connect to a SivySpeak instance via address or token.
        </p>

        {/* Tabs */}
        <div className="flex gap-1 bg-bg-input/50 border border-border/50 rounded-xl p-1 mb-6">
          <button
            onClick={() => {
              setTab("direct");
              setError("");
            }}
            className={`flex-1 py-2 text-xs font-bold uppercase tracking-widest rounded-lg transition-all cursor-pointer ${
              tab === "direct"
                ? "bg-bg-surface text-accent shadow-sm"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            Direct
          </button>
          <button
            onClick={() => {
              setTab("token");
              setError("");
            }}
            className={`flex-1 py-2 text-xs font-bold uppercase tracking-widest rounded-lg transition-all cursor-pointer ${
              tab === "token"
                ? "bg-bg-surface text-accent shadow-sm"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            Token
          </button>
        </div>

        {tab === "direct" ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest ml-1">
                Server Address
              </label>
              <input
                type="text"
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  setError("");
                }}
                placeholder="e.g. sync.example.com"
                maxLength={253}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleDirectJoin()}
                className="w-full px-4 py-3 bg-bg-input border border-border/50 rounded-xl text-text-primary placeholder:text-text-muted/50 text-sm outline-none focus:border-accent ring-0 focus:ring-4 focus:ring-accent/5 transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest ml-1">
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
                className="w-full px-4 py-3 bg-bg-input border border-border/50 rounded-xl text-text-primary placeholder:text-text-muted/50 text-sm outline-none focus:border-accent ring-0 focus:ring-4 focus:ring-accent/5 transition-all"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest ml-1">
              Invite Token
            </label>
            <textarea
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setError("");
              }}
              placeholder="Paste your invite token here..."
              rows={4}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleTokenJoin();
                }
              }}
              className="w-full px-4 py-3 bg-bg-input border border-border/50 rounded-xl text-text-primary placeholder:text-text-muted/50 text-sm outline-none focus:border-accent ring-0 focus:ring-4 focus:ring-accent/5 transition-all resize-none font-mono"
            />
          </div>
        )}

        {error && (
          <div className="bg-danger/10 border border-danger/20 rounded-lg p-3 mt-4">
            <p className="text-danger text-xs font-medium text-center">
              {error}
            </p>
          </div>
        )}

        <div className="flex gap-3 mt-8">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-3.5 border border-border/50 rounded-xl text-sm font-bold text-text-secondary hover:bg-bg-surface hover:text-text-primary transition-all cursor-pointer disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={tab === "direct" ? handleDirectJoin : handleTokenJoin}
            disabled={
              loading || (tab === "token" ? !token.trim() : !host.trim())
            }
            className="flex-1 py-3.5 bg-accent hover:bg-accent-hover disabled:bg-bg-surface disabled:text-text-muted text-white text-sm font-bold rounded-xl shadow-lg shadow-accent/20 transition-all cursor-pointer active:scale-[0.98]"
          >
            {loading ? "Connecting..." : "Join Server"}
          </button>
        </div>
      </div>
    </div>
  );
}
