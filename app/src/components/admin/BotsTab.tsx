import { useState, useEffect } from "react";
import type { ServerEntry, BotInfo, WebhookInfo, Channel } from "../../types";
import { getApiUrl } from "../../types";

export function BotsTab({ server }: { server: ServerEntry }) {
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookInfo[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [newBotName, setNewBotName] = useState("");
  const [newWebhookName, setNewWebhookName] = useState("");
  const [newWebhookChannelId, setNewWebhookChannelId] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [createdWebhookUrl, setCreatedWebhookUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"bots" | "webhooks">("bots");

  const baseUrl = getApiUrl(server.config.host, server.config.port);
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${server.config.authToken}`,
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [botsRes, webhooksRes, channelsRes] = await Promise.all([
        fetch(`${baseUrl}/api/bots`, { headers: authHeaders }),
        fetch(`${baseUrl}/api/webhooks`, { headers: authHeaders }),
        fetch(`${baseUrl}/api/channels`),
      ]);
      if (botsRes.ok) setBots(await botsRes.json());
      if (webhooksRes.ok) setWebhooks(await webhooksRes.json());
      if (channelsRes.ok) {
        const chs: Channel[] = await channelsRes.json();
        setChannels(chs.filter((c) => c.channel_type === "text"));
        if (chs.length > 0 && !newWebhookChannelId) {
          const textCh = chs.find((c) => c.channel_type === "text");
          if (textCh) setNewWebhookChannelId(textCh.id);
        }
      }
    } catch (err) {
      console.error("Failed to fetch bots/webhooks:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [server.id]);

  const createBot = async () => {
    if (!newBotName.trim()) return;
    try {
      const res = await fetch(`${baseUrl}/api/bots`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name: newBotName.trim() }),
      });
      if (!res.ok) {
        const errText = await res.text();
        alert(`Error: ${errText}`);
        return;
      }
      const data = await res.json();
      setCreatedToken(data.token);
      setNewBotName("");
      fetchData();
    } catch (err) {
      console.error("Failed to create bot:", err);
    }
  };

  const deleteBot = async (botId: string) => {
    if (!confirm("Are you sure you want to delete this bot?")) return;
    try {
      await fetch(`${baseUrl}/api/bots/${botId}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      fetchData();
    } catch (err) {
      console.error("Failed to delete bot:", err);
    }
  };

  const regenerateToken = async (botId: string) => {
    if (!confirm("Regenerate token? The old token will stop working immediately.")) return;
    try {
      const res = await fetch(`${baseUrl}/api/bots/${botId}/regenerate-token`, {
        method: "POST",
        headers: authHeaders,
      });
      if (res.ok) {
        const data = await res.json();
        setCreatedToken(data.token);
      }
    } catch (err) {
      console.error("Failed to regenerate token:", err);
    }
  };

  const createWebhook = async () => {
    if (!newWebhookChannelId) return;
    try {
      const res = await fetch(`${baseUrl}/api/webhooks`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          channel_id: newWebhookChannelId,
          name: newWebhookName.trim() || "Webhook",
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        alert(`Error: ${errText}`);
        return;
      }
      const wh: WebhookInfo = await res.json();
      setCreatedWebhookUrl(`${baseUrl}/api/webhooks/${wh.id}/${wh.token}`);
      setNewWebhookName("");
      fetchData();
    } catch (err) {
      console.error("Failed to create webhook:", err);
    }
  };

  const deleteWebhook = async (webhookId: string) => {
    if (!confirm("Delete this webhook?")) return;
    try {
      await fetch(`${baseUrl}/api/webhooks/${webhookId}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      fetchData();
    } catch (err) {
      console.error("Failed to delete webhook:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setTab("bots")}
          className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
            tab === "bots"
              ? "bg-accent text-white shadow-lg shadow-accent/25"
              : "bg-bg-surface text-text-muted hover:text-text-primary"
          }`}
        >
          Bots ({bots.length})
        </button>
        <button
          onClick={() => setTab("webhooks")}
          className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
            tab === "webhooks"
              ? "bg-accent text-white shadow-lg shadow-accent/25"
              : "bg-bg-surface text-text-muted hover:text-text-primary"
          }`}
        >
          Webhooks ({webhooks.length})
        </button>
      </div>

      {/* Token reveal banner */}
      {createdToken && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-yellow-400 uppercase tracking-wider mb-1">
                Bot Token — Copy it now! (shown only once)
              </p>
              <code className="text-xs text-text-primary bg-bg-secondary px-3 py-2 rounded-lg block break-all font-mono">
                {createdToken}
              </code>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(createdToken);
                }}
                className="text-xs px-3 py-1.5 bg-accent text-white rounded-lg font-bold hover:bg-accent/90 cursor-pointer"
              >
                Copy
              </button>
              <button
                onClick={() => setCreatedToken(null)}
                className="text-xs px-3 py-1.5 bg-bg-surface text-text-muted rounded-lg font-bold hover:text-text-primary cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Webhook URL reveal */}
      {createdWebhookUrl && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-green-400 uppercase tracking-wider mb-1">
                Webhook URL — Send POST requests here
              </p>
              <code className="text-xs text-text-primary bg-bg-secondary px-3 py-2 rounded-lg block break-all font-mono">
                {createdWebhookUrl}
              </code>
              <p className="text-[10px] text-text-muted mt-2">
                Body: {'{"content": "Hello from webhook!", "username": "Optional Name"}'} 
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => navigator.clipboard.writeText(createdWebhookUrl)}
                className="text-xs px-3 py-1.5 bg-accent text-white rounded-lg font-bold hover:bg-accent/90 cursor-pointer"
              >
                Copy
              </button>
              <button
                onClick={() => setCreatedWebhookUrl(null)}
                className="text-xs px-3 py-1.5 bg-bg-surface text-text-muted rounded-lg font-bold hover:text-text-primary cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === "bots" && (
        <>
          {/* Create Bot */}
          <div className="bg-bg-secondary rounded-2xl p-5 border border-border/50">
            <h3 className="text-sm font-bold text-text-primary mb-3">Create Bot</h3>
            <div className="flex gap-3">
              <input
                type="text"
                value={newBotName}
                onChange={(e) => setNewBotName(e.target.value)}
                placeholder="Bot name..."
                maxLength={32}
                className="flex-1 bg-bg-primary border border-border/50 rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10"
              />
              <button
                onClick={createBot}
                disabled={!newBotName.trim()}
                className="px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-bold hover:bg-accent/90 disabled:opacity-40 transition-all cursor-pointer"
              >
                Create
              </button>
            </div>
          </div>

          {/* Bot List */}
          <div className="space-y-3">
            {bots.length === 0 && (
              <p className="text-text-muted text-sm text-center py-8">
                No bots yet. Create one above.
              </p>
            )}
            {bots.map((bot) => (
              <div
                key={bot.id}
                className="bg-bg-secondary rounded-2xl p-4 border border-border/50 flex items-center gap-4"
              >
                <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center text-accent font-bold text-lg flex-shrink-0">
                  🤖
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-text-primary">
                      {bot.name}
                    </span>
                    <span className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                      BOT
                    </span>
                  </div>
                  <div className="text-[10px] text-text-muted mt-0.5">
                    ID: {bot.id.substring(0, 8)}... · Created{" "}
                    {new Date(bot.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => regenerateToken(bot.id)}
                    className="text-xs px-3 py-1.5 bg-bg-surface text-text-muted rounded-lg font-bold hover:text-yellow-400 transition-colors cursor-pointer"
                    title="Regenerate token"
                  >
                    🔑 Regen
                  </button>
                  <button
                    onClick={() => deleteBot(bot.id)}
                    className="text-xs px-3 py-1.5 bg-danger/10 text-danger rounded-lg font-bold hover:bg-danger/20 transition-colors cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* API Docs */}
          <div className="bg-bg-secondary rounded-2xl p-5 border border-border/50">
            <h3 className="text-sm font-bold text-text-primary mb-3">Bot API Reference</h3>
            <div className="space-y-3 text-xs text-text-secondary">
              <div className="bg-bg-primary rounded-xl p-3 border border-border/30">
                <p className="font-bold text-text-primary mb-1">Send Message</p>
                <code className="text-[10px] text-accent block font-mono">
                  POST /api/bots/message
                </code>
                <code className="text-[10px] text-text-muted block font-mono mt-1">
                  Headers: Authorization: Bot {'<token>'}
                </code>
                <code className="text-[10px] text-text-muted block font-mono mt-1">
                  Body: {'{"channel_id": "...", "content": "Hello!"}'}
                </code>
              </div>
              <div className="bg-bg-primary rounded-xl p-3 border border-border/30">
                <p className="font-bold text-text-primary mb-1">List Channels</p>
                <code className="text-[10px] text-accent block font-mono">
                  GET /api/channels
                </code>
              </div>
              <div className="bg-bg-primary rounded-xl p-3 border border-border/30">
                <p className="font-bold text-text-primary mb-1">Read Messages</p>
                <code className="text-[10px] text-accent block font-mono">
                  GET /api/channels/:channel_id/messages?limit=50
                </code>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "webhooks" && (
        <>
          {/* Create Webhook */}
          <div className="bg-bg-secondary rounded-2xl p-5 border border-border/50">
            <h3 className="text-sm font-bold text-text-primary mb-3">Create Webhook</h3>
            <div className="flex gap-3">
              <input
                type="text"
                value={newWebhookName}
                onChange={(e) => setNewWebhookName(e.target.value)}
                placeholder="Webhook name (optional)"
                maxLength={32}
                className="flex-1 bg-bg-primary border border-border/50 rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10"
              />
              <select
                value={newWebhookChannelId}
                onChange={(e) => setNewWebhookChannelId(e.target.value)}
                className="bg-bg-primary border border-border/50 rounded-xl px-4 py-2.5 text-sm text-text-primary outline-none focus:border-accent/50"
              >
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    #{ch.name}
                  </option>
                ))}
              </select>
              <button
                onClick={createWebhook}
                disabled={!newWebhookChannelId}
                className="px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-bold hover:bg-accent/90 disabled:opacity-40 transition-all cursor-pointer"
              >
                Create
              </button>
            </div>
          </div>

          {/* Webhook List */}
          <div className="space-y-3">
            {webhooks.length === 0 && (
              <p className="text-text-muted text-sm text-center py-8">
                No webhooks yet. Create one above.
              </p>
            )}
            {webhooks.map((wh) => {
              const channel = channels.find((c) => c.id === wh.channel_id);
              return (
                <div
                  key={wh.id}
                  className="bg-bg-secondary rounded-2xl p-4 border border-border/50 flex items-center gap-4"
                >
                  <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center text-green-400 font-bold text-lg flex-shrink-0">
                    🔗
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-text-primary">
                        {wh.name}
                      </span>
                      <span className="text-[10px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                        WEBHOOK
                      </span>
                    </div>
                    <div className="text-[10px] text-text-muted mt-0.5">
                      Channel: #{channel?.name || wh.channel_id.substring(0, 8)} · Created{" "}
                      {new Date(wh.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteWebhook(wh.id)}
                    className="text-xs px-3 py-1.5 bg-danger/10 text-danger rounded-lg font-bold hover:bg-danger/20 transition-colors cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
