import { useRef, useCallback } from "react";
import { useStore } from "../store";
import type { WsClientMessage, WsServerMessage } from "../types";

export function useVoice() {
  const voiceChannelId = useStore((s) => s.voiceChannelId);
  const setVoiceChannel = useStore((s) => s.setVoiceChannel);
  const setVoiceMembers = useStore((s) => s.setVoiceMembers);
  const addVoiceMember = useStore((s) => s.addVoiceMember);
  const removeVoiceMember = useStore((s) => s.removeVoiceMember);
  const activeServerId = useStore((s) => s.activeServerId);
  const servers = useStore((s) => s.servers);
  const displayName = useStore((s) => s.displayName);

  const activeServer = servers.find((s) => s.id === activeServerId);

  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  const userId = activeServer?.config.userId || "unknown";

  const cleanup = useCallback(() => {
    peerConnectionsRef.current.forEach((pc) => {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    });
    peerConnectionsRef.current.clear();

    localStreamRef.current?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
    localStreamRef.current = null;

    audioElementsRef.current.forEach((el) => {
      try {
        el.srcObject = null;
        el.remove();
      } catch {
        /* ignore */
      }
    });
    audioElementsRef.current.clear();

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const createPeerConnection = useCallback(
    (remoteUserId: string, channelId: string): RTCPeerConnection => {
      // Close existing if re-creating
      const existing = peerConnectionsRef.current.get(remoteUserId);
      if (existing) {
        try {
          existing.close();
        } catch {
          /* ignore */
        }
        peerConnectionsRef.current.delete(remoteUserId);
      }

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });

      localStreamRef.current?.getTracks().forEach((track) => {
        try {
          pc.addTrack(track, localStreamRef.current!);
        } catch {
          /* ignore */
        }
      });

      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (!stream) return;
        let audio = audioElementsRef.current.get(remoteUserId);
        if (!audio) {
          audio = document.createElement("audio");
          audio.autoplay = true;
          audio.setAttribute("playsinline", "");
          document.body.appendChild(audio);
          audioElementsRef.current.set(remoteUserId, audio);
        }
        audio.srcObject = stream;
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
          const msg: WsClientMessage = {
            type: "ice_candidate",
            channel_id: channelId,
            target_user_id: remoteUserId,
            from_user_id: userId,
            candidate: JSON.stringify(event.candidate),
          };
          wsRef.current.send(JSON.stringify(msg));
        }
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          const audio = audioElementsRef.current.get(remoteUserId);
          if (audio) {
            audio.srcObject = null;
            audio.remove();
            audioElementsRef.current.delete(remoteUserId);
          }
          peerConnectionsRef.current.delete(remoteUserId);
        }
      };

      peerConnectionsRef.current.set(remoteUserId, pc);
      return pc;
    },
    [userId],
  );

  const joinVoice = useCallback(
    async (channelId: string) => {
      if (!activeServer) return;

      // Leave current voice channel first
      cleanup();
      setVoiceMembers([]);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        localStreamRef.current = stream;
      } catch (err: any) {
        const msg =
          err.name === "NotAllowedError"
            ? "Microphone access denied. Check browser permissions."
            : err.name === "NotFoundError"
              ? "No microphone found."
              : "Could not access microphone.";
        console.error(msg, err);
        // Still allow joining to listen (without mic)
        // But in this case, don't proceed since we need audio
        return;
      }

      setVoiceChannel(channelId);

      const { host, port } = activeServer.config;
      let ws: WebSocket;
      try {
        ws = new WebSocket(`ws://${host}:${port}/ws`);
      } catch {
        console.error("Failed to create WebSocket");
        cleanup();
        setVoiceChannel(null);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        const msg: WsClientMessage = {
          type: "join_voice",
          channel_id: channelId,
          user_id: userId,
          user_name: displayName || "Anonymous",
        };
        ws.send(JSON.stringify(msg));
      };

      ws.onmessage = async (event) => {
        let data: WsServerMessage;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }

        try {
          if (data.type === "voice_members") {
            const members = Array.isArray(data.members) ? data.members : [];
            setVoiceMembers(members);
            for (const member of members) {
              if (member.user_id !== userId) {
                const pc = createPeerConnection(member.user_id, channelId);
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                const msg: WsClientMessage = {
                  type: "voice_offer",
                  channel_id: channelId,
                  target_user_id: member.user_id,
                  from_user_id: userId,
                  sdp: JSON.stringify(offer),
                };
                if (ws.readyState === WebSocket.OPEN)
                  ws.send(JSON.stringify(msg));
              }
            }
          }

          if (data.type === "voice_peer_joined") {
            addVoiceMember({
              user_id: data.user_id,
              user_name: data.user_name || "Unknown",
            });
          }

          if (data.type === "voice_peer_left") {
            removeVoiceMember(data.user_id);
            const pc = peerConnectionsRef.current.get(data.user_id);
            if (pc) {
              try {
                pc.close();
              } catch {}
              peerConnectionsRef.current.delete(data.user_id);
            }
            const audio = audioElementsRef.current.get(data.user_id);
            if (audio) {
              audio.srcObject = null;
              audio.remove();
              audioElementsRef.current.delete(data.user_id);
            }
          }

          if (data.type === "voice_offer" && data.from_user_id !== userId) {
            const pc =
              peerConnectionsRef.current.get(data.from_user_id) ||
              createPeerConnection(data.from_user_id, channelId);
            await pc.setRemoteDescription(JSON.parse(data.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            const msg: WsClientMessage = {
              type: "voice_answer",
              channel_id: channelId,
              target_user_id: data.from_user_id,
              from_user_id: userId,
              sdp: JSON.stringify(answer),
            };
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
          }

          if (data.type === "voice_answer" && data.from_user_id !== userId) {
            const pc = peerConnectionsRef.current.get(data.from_user_id);
            if (pc && pc.signalingState === "have-local-offer") {
              await pc.setRemoteDescription(JSON.parse(data.sdp));
            }
          }

          if (data.type === "ice_candidate" && data.from_user_id !== userId) {
            const pc = peerConnectionsRef.current.get(data.from_user_id);
            if (pc && pc.remoteDescription) {
              await pc.addIceCandidate(JSON.parse(data.candidate));
            }
          }
        } catch (err) {
          console.error("Voice signaling error:", err);
        }
      };

      ws.onerror = () => {
        console.error("Voice WebSocket error");
      };

      ws.onclose = () => {
        wsRef.current = null;
      };
    },
    [
      activeServer,
      userId,
      displayName,
      createPeerConnection,
      setVoiceChannel,
      setVoiceMembers,
      addVoiceMember,
      removeVoiceMember,
      cleanup,
    ],
  );

  const leaveVoice = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && voiceChannelId) {
      try {
        const msg: WsClientMessage = {
          type: "leave_voice",
          channel_id: voiceChannelId,
          user_id: userId,
        };
        wsRef.current.send(JSON.stringify(msg));
      } catch {
        /* closing anyway */
      }
    }
    cleanup();
    setVoiceChannel(null);
    setVoiceMembers([]);
  }, [voiceChannelId, userId, cleanup, setVoiceChannel, setVoiceMembers]);

  return { joinVoice, leaveVoice };
}
