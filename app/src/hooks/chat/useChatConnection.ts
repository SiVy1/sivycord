import { useEffect, useRef, useState, useCallback } from "react";
import { useStore } from "../../store";
import {
  getWsUrl,
  type WsClientMessage,
  type WsServerMessage,
} from "../../types";

const WS_RECONNECT_DELAY = 2000;
const WS_MAX_RETRIES = 10;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds

interface UseChatConnectionProps {
  activeServerId: string | null;
  activeChannelId: string | null;
  onMessage: (data: WsServerMessage) => void;
}

export function useChatConnection({
  activeServerId,
  activeChannelId,
  onMessage,
}: UseChatConnectionProps) {
  const [wsStatus, setWsStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("disconnected");

  const servers = useStore((s) => s.servers);

  const activeServer = servers.find((s) => s.id === activeServerId);

  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevChannelRef = useRef<string | null>(null);

  // WebSocket connection with auto-reconnect
  const connectWs = useCallback(() => {
    if (!activeServer) return;
    // Don't connect for P2P servers via WS in this hook (handled differently or not needed depending on architecture,
    // but original ChatArea.tsx checked for host/port which implied non-P2P for this specific logic,
    // though P2P handling was separate. We'll stick to the original logic which checks host/port).
    const { host, port, authToken } = activeServer.config;

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    // Clear existing heartbeat
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }

    if (!host || !port) return;

    setWsStatus("connecting");
    const wsBaseUrl = getWsUrl(host, port);
    const guildId = activeServer.config.guildId || "default";
    const wsUrl = authToken
      ? `${wsBaseUrl}/ws?token=${encodeURIComponent(authToken)}&server_id=${encodeURIComponent(guildId)}`
      : `${wsBaseUrl}/ws?server_id=${encodeURIComponent(guildId)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus("connected");
      retriesRef.current = 0;

      // Start heartbeat
      heartbeatTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, HEARTBEAT_INTERVAL);

      if (activeChannelId) {
        const msg: WsClientMessage = {
          type: "join_channel",
          channel_id: activeChannelId,
        };
        ws.send(JSON.stringify(msg));
        prevChannelRef.current = activeChannelId;
      }
    };

    ws.onmessage = (event) => {
      try {
        const data: WsServerMessage = JSON.parse(event.data);
        if (data.type === "pong" || (data as any).type === "ping_response") return;

        onMessage(data);
      } catch (err) {
        console.error("Failed to parse WS message:", err);
      }
    };

    ws.onerror = () => { };

    ws.onclose = () => {
      wsRef.current = null;
      setWsStatus("disconnected");

      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }

      if (retriesRef.current < WS_MAX_RETRIES) {
        retriesRef.current++;
        const delay = WS_RECONNECT_DELAY * Math.min(retriesRef.current, 5);
        reconnectTimerRef.current = setTimeout(connectWs, delay);
      }
    };
  }, [activeServer, activeChannelId, onMessage]);

  useEffect(() => {
    connectWs();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsStatus("disconnected");
    };
  }, [connectWs]);

  // Periodic cleanup for typing indicators (originally in ChatArea)
  useEffect(() => {
    const interval = setInterval(() => {
      useStore.getState().clearExpiredTyping();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Switch channel subscription
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !activeChannelId) return;

    if (prevChannelRef.current && prevChannelRef.current !== activeChannelId) {
      ws.send(
        JSON.stringify({
          type: "leave_channel",
          channel_id: prevChannelRef.current,
        }),
      );
    }
    ws.send(
      JSON.stringify({ type: "join_channel", channel_id: activeChannelId }),
    );
    prevChannelRef.current = activeChannelId;
  }, [activeChannelId]);

  return { wsRef, wsStatus };
}
