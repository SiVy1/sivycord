import { useState, useEffect } from "react";
import type { AuthUser } from "../types";
import { getApiUrl } from "../types";

type AuthMode = "login" | "register";

interface AuthScreenProps {
  serverHost: string;
  serverPort: number;
  onAuth: (user: AuthUser, token: string) => void;
}

export function AuthScreen({
  serverHost,
  serverPort,
  onAuth,
}: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [setupKey, setSetupKey] = useState("");
  const [setupKeyAvailable, setSetupKeyAvailable] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Check if server has an unclaimed setup key
  useEffect(() => {
    const baseUrl = getApiUrl(serverHost, serverPort);
    fetch(`${baseUrl}/api/setup-status`)
      .then((r) => r.json())
      .then((data) => setSetupKeyAvailable(!!data.setup_key_available))
      .catch(() => setSetupKeyAvailable(false));
  }, [serverHost, serverPort]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint = mode === "register" ? "register" : "login";
      const body =
        mode === "register"
          ? {
              username: username.trim().toLowerCase(),
              password,
              display_name: displayName.trim() || username.trim(),
              ...(setupKey.trim() ? { setup_key: setupKey.trim() } : {}),
            }
          : { username: username.trim().toLowerCase(), password };

      const baseUrl = getApiUrl(serverHost, serverPort);
      const res = await fetch(`${baseUrl}/api/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        if (res.status === 409) throw new Error("Username already taken");
        if (res.status === 401) throw new Error("Invalid username or password");
        if (res.status === 403) throw new Error("Invalid setup key");
        if (res.status === 410) throw new Error("Setup key already used");
        throw new Error(text || `Server error ${res.status}`);
      }

      const data = await res.json();
      onAuth(data.user, data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4 bg-bg-secondary border border-border rounded-2xl p-6">
        <div className="mb-6">
          <div className="text-center">
            <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-3">
              <svg
                className="w-7 h-7 text-accent"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-text-primary">
              {mode === "login" ? "Log in to server" : "Create account"}
            </h2>
            <p className="text-xs text-text-muted mt-1">
              {serverHost}:{serverPort}
            </p>
          </div>

        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-text-secondary mb-1 block">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError("");
              }}
              placeholder="your_username"
              maxLength={32}
              autoFocus
              className="w-full px-4 py-2.5 bg-bg-input border border-border rounded-xl text-text-primary placeholder:text-text-muted text-sm outline-none focus:border-accent transition-colors"
            />
          </div>

          {mode === "register" && (
            <div>
              <label className="text-xs text-text-secondary mb-1 block">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How others see you"
                maxLength={32}
                className="w-full px-4 py-2.5 bg-bg-input border border-border rounded-xl text-text-primary placeholder:text-text-muted text-sm outline-none focus:border-accent transition-colors"
              />
            </div>
          )}

          {mode === "register" && setupKeyAvailable && (
            <div>
              <label className="text-xs text-text-secondary mb-1 block">
                🔑 Setup Key <span className="text-accent">(become admin)</span>
              </label>
              <input
                type="text"
                value={setupKey}
                onChange={(e) => setSetupKey(e.target.value)}
                placeholder="Paste setup key from server console"
                className="w-full px-4 py-2.5 bg-bg-input border border-amber-500/30 rounded-xl text-text-primary placeholder:text-text-muted text-sm outline-none focus:border-amber-500 transition-colors"
              />
              <p className="text-[10px] text-amber-400/70 mt-1">
                One-time key from the server console. Grants admin role.
              </p>
            </div>
          )}

          <div>
            <label className="text-xs text-text-secondary mb-1 block">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              placeholder={
                mode === "register" ? "Min. 4 characters" : "Your password"
              }
              className="w-full px-4 py-2.5 bg-bg-input border border-border rounded-xl text-text-primary placeholder:text-text-muted text-sm outline-none focus:border-accent transition-colors"
            />
          </div>

          {error && <p className="text-danger text-xs">{error}</p>}

          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="w-full py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors cursor-pointer"
          >
            {loading
              ? "Please wait..."
              : mode === "login"
                ? "Log In"
                : "Create Account"}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
            }}
            className="text-xs text-accent hover:text-accent-hover transition-colors cursor-pointer"
          >
            {mode === "login"
              ? "Don't have an account? Register"
              : "Already have an account? Log in"}
          </button>
        </div>


      </div>
    </div>
  );
}
