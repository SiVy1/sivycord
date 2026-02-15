import { useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import {
  getApiUrl,
  type ChannelKeysResponse,
  type WsClientMessage,
} from "../../types";
import {
  type ChannelParticipantKey,
  generateKeyPair,
  hasLocalKeyPair,
  getLocalPublicKey,
  hasSenderKey,
  createSenderKeyDistribution,
} from "../../lib/crypto";

export function useChatE2E(
  activeServerId: string | null,
  activeChannelId: string | null,
  wsRef: React.MutableRefObject<WebSocket | null>,
) {
  const servers = useStore((s) => s.servers);
  const channels = useStore((s) => s.channels);
  const displayName = useStore((s) => s.displayName);

  const activeServer = servers.find((s) => s.id === activeServerId);
  const activeChannel = channels.find((c) => c.id === activeChannelId);
  const isAuthenticated = !!activeServer?.config.authToken;

  const [e2eEnabled, setE2eEnabled] = useState(false);
  const [e2eReady, setE2eReady] = useState(false);
  const [channelKeys, setChannelKeys] = useState<ChannelParticipantKey[]>([]);
  const channelKeysRef = useRef<ChannelParticipantKey[]>([]);

  useEffect(() => {
    setE2eEnabled(false);
    setE2eReady(false);
    setChannelKeys([]);
    channelKeysRef.current = [];

    if (
      !activeServer ||
      activeServer.type === "p2p" ||
      !activeChannelId ||
      !isAuthenticated
    )
      return;
    if (!activeChannel?.encrypted) return;

    const { host, port, authToken, userId } = activeServer.config;
    if (!host || !port || !authToken || !userId) return;

    const baseUrl = getApiUrl(host, port);
    const guildId = activeServer.config.guildId || "default";
    let cancelled = false;

    (async () => {
      try {
        // Ensure we have a local key pair
        const haveKey = await hasLocalKeyPair(userId);
        if (!haveKey) {
          const pubKey = await generateKeyPair(userId);
          // Upload our public key to the server
          await fetch(`${baseUrl}/api/keys`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`,
              "X-Server-Id": guildId,
            },
            body: JSON.stringify({ public_key: pubKey }),
          });
        } else {
          // Check if key is already on the server; upload if not
          const res = await fetch(`${baseUrl}/api/keys/${userId}`, {
            headers: {
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
              "X-Server-Id": guildId,
            },
          });
          if (res.status === 404) {
            const pubKey = await getLocalPublicKey(userId);
            if (pubKey) {
              await fetch(`${baseUrl}/api/keys`, {
                method: "PUT",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${authToken}`,
                  "X-Server-Id": guildId,
                },
                body: JSON.stringify({ public_key: pubKey }),
              });
            }
          }
        }

        // Fetch all participant keys for this channel
        const keysRes = await fetch(
          `${baseUrl}/api/channels/${activeChannelId}/keys`,
          {
            headers: {
              Authorization: `Bearer ${authToken}`,
              "X-Server-Id": guildId,
            },
          },
        );
        if (!keysRes.ok) throw new Error("Failed to fetch channel keys");

        const keysData: ChannelKeysResponse = await keysRes.json();
        if (cancelled) return;

        const participants: ChannelParticipantKey[] = keysData.keys.map(
          (k) => ({
            user_id: k.user_id,
            public_key: k.public_key,
          }),
        );

        setChannelKeys(participants);
        channelKeysRef.current = participants;
        setE2eEnabled(true);
        setE2eReady(true);

        // Distribute our sender key to channel participants if they don't have it yet
        if (participants.length > 1) {
          const hasKey = await hasSenderKey(activeChannelId, userId);
          if (!hasKey || true) {
            // Always distribute on channel join so new members get it
            try {
              const distribution = await createSenderKeyDistribution(
                userId,
                activeChannelId,
                participants,
              );
              // Send distribution via WS if connected
              const ws = wsRef.current;
              if (ws && ws.readyState === WebSocket.OPEN) {
                const msg: WsClientMessage = {
                  type: "send_message",
                  channel_id: activeChannelId,
                  content: distribution,
                  user_id: userId,
                  user_name: displayName || "Anonymous",
                };
                ws.send(JSON.stringify(msg));
              }
            } catch (err) {
              console.warn("Failed to distribute sender key:", err);
            }
          }
        }
      } catch (err) {
        console.error("E2E setup failed:", err);
        setE2eEnabled(false);
        setE2eReady(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeChannelId,
    activeServer?.id,
    activeChannel?.encrypted,
    isAuthenticated,
  ]);

  return { e2eEnabled, e2eReady, channelKeys, channelKeysRef };
}
