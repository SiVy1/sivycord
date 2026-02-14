import { useState, useEffect } from "react";
import type {
  ServerEntry,
  FederationPeer,
  FederatedChannel,
  FederationStatus,
  AddPeerResponse,
  Channel,
} from "../../types";
import { getApiUrl } from "../../types";

export function FederationTab({ server }: { server: ServerEntry }) {
  const [peers, setPeers] = useState<FederationPeer[]>([]);
  const [linkedChannels, setLinkedChannels] = useState<FederatedChannel[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);

  // Add peer form
  const [peerName, setPeerName] = useState("");
  const [peerHost, setPeerHost] = useState("");
  const [peerPort, setPeerPort] = useState("3000");

  // Accept peer form
  const [showAccept, setShowAccept] = useState(false);
  const [acceptName, setAcceptName] = useState("");
  const [acceptHost, setAcceptHost] = useState("");
  const [acceptPort, setAcceptPort] = useState("3000");
  const [acceptSecret, setAcceptSecret] = useState("");

  // Link channel form
  const [showLink, setShowLink] = useState(false);
  const [linkPeerId, setLinkPeerId] = useState("");
  const [linkLocalChannelId, setLinkLocalChannelId] = useState("");
  const [linkRemoteChannelId, setLinkRemoteChannelId] = useState("");

  // Info banner
  const [sharedSecret, setSharedSecret] = useState<string | null>(null);

  const baseUrl = getApiUrl(server.config.host, server.config.port);
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${server.config.authToken}`,
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [fedRes, chRes] = await Promise.all([
        fetch(`${baseUrl}/api/federation`, { headers: authHeaders }),
        fetch(`${baseUrl}/api/channels`),
      ]);
      if (fedRes.ok) {
        const data: FederationStatus = await fedRes.json();
        setPeers(data.peers);
        setLinkedChannels(data.linked_channels);
      }
      if (chRes.ok) {
        const chs: Channel[] = await chRes.json();
        setChannels(chs.filter((c) => c.channel_type === "text"));
        if (chs.length > 0 && !linkLocalChannelId) {
          const first = chs.find((c) => c.channel_type === "text");
          if (first) setLinkLocalChannelId(first.id);
        }
      }
    } catch (err) {
      console.error("Failed to fetch federation data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [server.id]);

  useEffect(() => {
    if (peers.length > 0 && !linkPeerId) {
      setLinkPeerId(peers[0].id);
    }
  }, [peers]);

  const addPeer = async () => {
    if (!peerName.trim() || !peerHost.trim()) return;
    try {
      const res = await fetch(`${baseUrl}/api/federation/peers`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          name: peerName.trim(),
          host: peerHost.trim(),
          port: parseInt(peerPort) || 3000,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        alert(`Failed: ${err}`);
        return;
      }
      const data: AddPeerResponse = await res.json();
      setSharedSecret(data.shared_secret);
      setPeerName("");
      setPeerHost("");
      setPeerPort("3000");
      fetchData();
    } catch (err) {
      console.error("Failed to add peer:", err);
    }
  };

  const acceptPeer = async () => {
    if (!acceptName.trim() || !acceptHost.trim() || !acceptSecret.trim()) return;
    try {
      const res = await fetch(`${baseUrl}/api/federation/accept`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          name: acceptName.trim(),
          host: acceptHost.trim(),
          port: parseInt(acceptPort) || 3000,
          shared_secret: acceptSecret.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        alert(`Failed: ${err}`);
        return;
      }
      setShowAccept(false);
      setAcceptName("");
      setAcceptHost("");
      setAcceptPort("3000");
      setAcceptSecret("");
      fetchData();
    } catch (err) {
      console.error("Failed to accept peer:", err);
    }
  };

  const removePeer = async (peerId: string) => {
    if (!confirm("Remove this peer and all linked channels?")) return;
    try {
      await fetch(`${baseUrl}/api/federation/peers/${peerId}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      fetchData();
    } catch (err) {
      console.error("Failed to remove peer:", err);
    }
  };

  const activatePeer = async (peerId: string) => {
    try {
      await fetch(`${baseUrl}/api/federation/peers/${peerId}/activate`, {
        method: "POST",
        headers: authHeaders,
      });
      fetchData();
    } catch (err) {
      console.error("Failed to activate peer:", err);
    }
  };

  const linkChannel = async () => {
    if (!linkPeerId || !linkLocalChannelId || !linkRemoteChannelId.trim()) return;
    try {
      const res = await fetch(`${baseUrl}/api/federation/channels`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          peer_id: linkPeerId,
          local_channel_id: linkLocalChannelId,
          remote_channel_id: linkRemoteChannelId.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        alert(`Failed: ${err}`);
        return;
      }
      setShowLink(false);
      setLinkRemoteChannelId("");
      fetchData();
    } catch (err) {
      console.error("Failed to link channel:", err);
    }
  };

  const unlinkChannel = async (linkId: string) => {
    try {
      await fetch(`${baseUrl}/api/federation/channels/${linkId}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      fetchData();
    } catch (err) {
      console.error("Failed to unlink channel:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-text-muted text-sm animate-pulse">Loading federation data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Shared Secret Banner */}
      {sharedSecret && (
        <div className="bg-accent/10 border border-accent/30 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-accent">🔑 Shared Secret Created</span>
            <button
              onClick={() => setSharedSecret(null)}
              className="text-text-muted hover:text-text-primary text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>
          <p className="text-xs text-text-secondary mb-2">
            Give this secret to the remote server admin. They need it to accept your federation request.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-bg-primary px-3 py-2 rounded-lg text-xs font-mono text-text-primary break-all border border-border/50">
              {sharedSecret}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(sharedSecret)}
              className="text-xs text-accent hover:text-accent/80 bg-accent/10 px-3 py-2 rounded-lg border border-accent/20 cursor-pointer"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {/* Add Peer */}
      <div className="bg-bg-secondary/50 rounded-xl p-4 border border-border/30">
        <h4 className="text-sm font-bold text-text-primary mb-3">Initiate Federation</h4>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <input
            value={peerName}
            onChange={(e) => setPeerName(e.target.value)}
            placeholder="Server name"
            className="bg-bg-primary border border-border/50 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50"
          />
          <input
            value={peerHost}
            onChange={(e) => setPeerHost(e.target.value)}
            placeholder="Host (e.g. 192.168.1.50)"
            className="bg-bg-primary border border-border/50 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50"
          />
          <input
            value={peerPort}
            onChange={(e) => setPeerPort(e.target.value)}
            placeholder="Port"
            className="bg-bg-primary border border-border/50 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={addPeer}
            disabled={!peerName.trim() || !peerHost.trim()}
            className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-accent/90 transition-colors cursor-pointer"
          >
            Send Federation Request
          </button>
          <button
            onClick={() => setShowAccept(!showAccept)}
            className="px-4 py-2 bg-bg-surface text-text-primary rounded-lg text-sm font-medium border border-border/50 hover:bg-bg-secondary transition-colors cursor-pointer"
          >
            Accept Incoming Request
          </button>
        </div>
      </div>

      {/* Accept Peer Form */}
      {showAccept && (
        <div className="bg-bg-secondary/50 rounded-xl p-4 border border-accent/30">
          <h4 className="text-sm font-bold text-accent mb-3">Accept Federation Request</h4>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <input
              value={acceptName}
              onChange={(e) => setAcceptName(e.target.value)}
              placeholder="Remote server name"
              className="bg-bg-primary border border-border/50 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50"
            />
            <input
              value={acceptHost}
              onChange={(e) => setAcceptHost(e.target.value)}
              placeholder="Remote host"
              className="bg-bg-primary border border-border/50 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50"
            />
            <input
              value={acceptPort}
              onChange={(e) => setAcceptPort(e.target.value)}
              placeholder="Remote port"
              className="bg-bg-primary border border-border/50 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50"
            />
            <input
              value={acceptSecret}
              onChange={(e) => setAcceptSecret(e.target.value)}
              placeholder="Shared secret from remote admin"
              className="bg-bg-primary border border-border/50 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50"
            />
          </div>
          <button
            onClick={acceptPeer}
            disabled={!acceptName.trim() || !acceptHost.trim() || !acceptSecret.trim()}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-green-700 transition-colors cursor-pointer"
          >
            Accept & Activate
          </button>
        </div>
      )}

      {/* Peers List */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-bold text-text-primary">
            Federation Peers ({peers.length})
          </h4>
        </div>

        {peers.length === 0 ? (
          <p className="text-text-muted text-sm py-4 text-center">
            No federation peers yet. Use the form above to connect to another server.
          </p>
        ) : (
          <div className="space-y-2">
            {peers.map((peer) => (
              <div
                key={peer.id}
                className="bg-bg-secondary/50 rounded-xl p-4 border border-border/30 flex items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-sm text-text-primary">{peer.name}</span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                        peer.status === "active"
                          ? "bg-green-500/10 text-green-400 border border-green-500/30"
                          : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30"
                      }`}
                    >
                      {peer.status}
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {peer.direction === "outgoing" ? "→ Out" : "← In"}
                    </span>
                  </div>
                  <div className="text-xs text-text-muted font-mono">
                    {peer.host}:{peer.port}
                  </div>
                  {peer.last_seen && (
                    <div className="text-[10px] text-text-muted mt-1">
                      Last seen: {new Date(peer.last_seen).toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  {peer.status === "pending" && (
                    <button
                      onClick={() => activatePeer(peer.id)}
                      className="text-xs text-green-400 hover:text-green-300 bg-green-500/10 px-3 py-1.5 rounded-lg border border-green-500/20 cursor-pointer"
                    >
                      Activate
                    </button>
                  )}
                  <button
                    onClick={() => removePeer(peer.id)}
                    className="text-xs text-danger hover:text-red-300 bg-danger/10 px-3 py-1.5 rounded-lg border border-danger/20 cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Linked Channels */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-bold text-text-primary">
            Linked Channels ({linkedChannels.length})
          </h4>
          {peers.length > 0 && (
            <button
              onClick={() => setShowLink(!showLink)}
              className="text-xs text-accent hover:text-accent/80 bg-accent/10 px-3 py-1.5 rounded-lg border border-accent/20 cursor-pointer"
            >
              + Link Channel
            </button>
          )}
        </div>

        {/* Link Channel Form */}
        {showLink && (
          <div className="bg-bg-secondary/50 rounded-xl p-4 border border-accent/30 mb-3">
            <h4 className="text-sm font-bold text-accent mb-3">Link Channel to Remote</h4>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <select
                value={linkPeerId}
                onChange={(e) => setLinkPeerId(e.target.value)}
                className="bg-bg-primary border border-border/50 rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
              >
                {peers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={linkLocalChannelId}
                onChange={(e) => setLinkLocalChannelId(e.target.value)}
                className="bg-bg-primary border border-border/50 rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
              >
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    #{ch.name}
                  </option>
                ))}
              </select>
              <input
                value={linkRemoteChannelId}
                onChange={(e) => setLinkRemoteChannelId(e.target.value)}
                placeholder="Remote channel ID"
                className="bg-bg-primary border border-border/50 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50"
              />
            </div>
            <button
              onClick={linkChannel}
              disabled={!linkPeerId || !linkLocalChannelId || !linkRemoteChannelId.trim()}
              className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-accent/90 transition-colors cursor-pointer"
            >
              Link Channels
            </button>
          </div>
        )}

        {linkedChannels.length === 0 ? (
          <p className="text-text-muted text-sm py-4 text-center">
            No linked channels. Link a local channel to a remote one to bridge messages.
          </p>
        ) : (
          <div className="space-y-2">
            {linkedChannels.map((link) => {
              const localCh = channels.find((c) => c.id === link.local_channel_id);
              const peer = peers.find((p) => p.id === link.peer_id);
              return (
                <div
                  key={link.id}
                  className="bg-bg-secondary/50 rounded-xl p-4 border border-border/30 flex items-center gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-bold text-text-primary">
                        #{localCh?.name || link.local_channel_id.substring(0, 8)}
                      </span>
                      <span className="text-text-muted">↔</span>
                      <span className="text-accent font-medium">
                        {peer?.name || "Unknown"} / {link.remote_channel_id.substring(0, 8)}
                      </span>
                    </div>
                    <div className="text-[10px] text-text-muted mt-1">
                      Linked {new Date(link.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={() => unlinkChannel(link.id)}
                    className="text-xs text-danger hover:text-red-300 bg-danger/10 px-3 py-1.5 rounded-lg border border-danger/20 cursor-pointer"
                  >
                    Unlink
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="bg-bg-secondary/30 rounded-xl p-4 border border-border/20">
        <h4 className="text-xs font-bold text-text-primary mb-2 uppercase tracking-wider">How Federation Works</h4>
        <ul className="text-xs text-text-muted space-y-1.5">
          <li>1. <strong>Initiate</strong> — send a federation request to a remote server by entering its address.</li>
          <li>2. <strong>Share secret</strong> — give the generated shared secret to the remote admin.</li>
          <li>3. <strong>Accept</strong> — the remote admin uses "Accept Incoming Request" with your secret.</li>
          <li>4. <strong>Link channels</strong> — connect local channels to remote channels for message bridging.</li>
          <li>5. Messages sent in a linked channel are forwarded to the remote server and vice versa.</li>
        </ul>
      </div>
    </div>
  );
}
