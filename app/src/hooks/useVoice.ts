import { useCallback, useEffect } from "react";
import { useStore } from "../store";
import type { WsServerMessage } from "../types";

// ─── Module-level singleton state ───
// These live outside the hook so every component calling useVoice()
// shares the exact same WebSocket, peer connections, streams, etc.

let ws: WebSocket | null = null;
let localStream: MediaStream | null = null;
let displayStream: MediaStream | null = null;
let localUserId = "unknown";
let currentChannelId: string | null = null;

const peerConnections = new Map<string, RTCPeerConnection>();
const makingOffer = new Map<string, boolean>();
const audioElements = new Map<string, HTMLAudioElement>();
const screenTrackSenders = new Map<string, RTCRtpSender>();

// VAD (voice activity detection)
let audioContext: AudioContext | null = null;
let analyserNode: AnalyserNode | null = null;
let vadInterval: ReturnType<typeof setInterval> | null = null;
let isTalkingLocal = false;

// Mute / Deafen state
let isMutedLocal = false;
let isDeafenedLocal = false;

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

// ─── Helper: play toggle sound ───
function playToggleSound(on: boolean) {
  const soundSettings = useStore.getState().soundSettings;
  const soundType = on ? null : on === false ? "muteSound" : null;

  // Try custom sound first
  if (soundType && soundSettings[soundType as keyof typeof soundSettings]) {
    try {
      const audio = new Audio(
        soundSettings[soundType as keyof typeof soundSettings] as string,
      );
      audio.volume = 0.3;
      audio.play().catch(() => {});
      return;
    } catch {
      // Fall back to default
    }
  }

  // Default beep sound
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    // Higher pitch = on, lower = off
    osc.frequency.value = on ? 480 : 340;
    gain.gain.value = 0.12;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => ctx.close();
  } catch {
    // ignore
  }
}

// ─── Helper: play join/leave sound ───
function playVoiceSound(type: "join" | "leave") {
  const state = useStore.getState();
  const soundSettings = state.soundSettings;
  const activeServerId = state.activeServerId;
  const servers = state.servers;
  const activeServer = servers.find((s) => s.id === activeServerId);

  const soundKey = type === "join" ? "joinSound" : "leaveSound";
  const serverSoundKey = type === "join" ? "joinSoundUrl" : "leaveSoundUrl";

  // 1. Try server-wide sound first (Admin configured)
  const serverSoundUrl = activeServer?.config[serverSoundKey];
  const soundChance = activeServer?.config.soundChance ?? 100;

  if (serverSoundUrl) {
    // Only play server-wide sound if chance roll is successful
    if (Math.random() * 100 < soundChance) {
      try {
        // Ensure absolute URL if it's a relative path from the server
        const fullUrl = serverSoundUrl.startsWith("http")
          ? serverSoundUrl
          : `http://${activeServer.config.host}:${activeServer.config.port}${serverSoundUrl}`;

        const audio = new Audio(fullUrl);
        audio.volume = 0.4;
        audio.play().catch(() => {});
        return;
      } catch {
        // Fall back
      }
    } else {
      // Chance roll failed. We skip the server-wide sound.
      // We still fall back to local settings/defaults though?
      // User said "chciałbym że nie zawsze się to włączało", which usually implies
      // they want the *feature* to be random. If chance fails, we should probably
      // just not play ANY sound for this event, or fall back to default?
      // Usually "chance" on a custom sound means "maybe it plays, maybe it doesn't".
      // I'll skip playing anything if the chance roll for the server sound fails.
      return;
    }
  }

  // 2. Try local user preference
  if (soundSettings[soundKey]) {
    try {
      const audio = new Audio(soundSettings[soundKey] as string);
      audio.volume = 0.4;
      audio.play().catch(() => {});
      return;
    } catch {
      // Fall back to default
    }
  }

  // 3. Default generated sound
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";

    if (type === "join") {
      // Rising tone for join
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.1);
    } else {
      // Falling tone for leave
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.1);
    }

    gain.gain.value = 0.15;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
    osc.onended = () => ctx.close();
  } catch {
    // ignore
  }
}

// ─── Helper: broadcast talking state ───
function broadcastTalkingState(talking: boolean) {
  if (talking === isTalkingLocal) return; // debounce
  isTalkingLocal = talking;

  const channelId = currentChannelId;
  if (ws?.readyState === WebSocket.OPEN && channelId) {
    ws.send(
      JSON.stringify({
        type: "voice_talking",
        channel_id: channelId,
        user_id: localUserId,
        talking,
      }),
    );
  }
  useStore.getState().setTalking(localUserId, talking);
}

// ─── Helper: start VAD ───
function startVAD(stream: MediaStream) {
  stopVAD();
  try {
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 512;
    analyserNode.smoothingTimeConstant = 0.4;
    source.connect(analyserNode);

    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
    const THRESHOLD = 15; // volume threshold (0-255)
    let silenceFrames = 0;
    const SILENCE_DELAY = 8; // ~8 * 50ms = 400ms of silence to stop

    vadInterval = setInterval(() => {
      if (!analyserNode) return;
      analyserNode.getByteFrequencyData(dataArray); // Average volume across frequency bins
      let sum = 0;
      for (const value of dataArray) {
        sum += value;
      }
      const avg = sum / dataArray.length;

      if (avg > THRESHOLD) {
        silenceFrames = 0;
        broadcastTalkingState(true);
      } else {
        silenceFrames++;
        if (silenceFrames >= SILENCE_DELAY) {
          broadcastTalkingState(false);
        }
      }
    }, 50);
  } catch (e) {
    console.error("VAD init failed", e);
  }
}

function stopVAD() {
  if (vadInterval) {
    clearInterval(vadInterval);
    vadInterval = null;
  }
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  analyserNode = null;
  isTalkingLocal = false;
}

// ─── Helper: create peer connection ───
function createPeerConnection(
  remoteUserId: string,
  channelId: string,
): RTCPeerConnection {
  let pc = peerConnections.get(remoteUserId);
  if (pc) return pc;

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  makingOffer.set(remoteUserId, false);

  // Add ALL current local tracks
  localStream?.getTracks().forEach((track) => {
    pc!.addTrack(track, localStream!);
  });
  if (displayStream) {
    displayStream.getVideoTracks().forEach((track) => {
      const sender = pc!.addTrack(track, displayStream!);
      screenTrackSenders.set(remoteUserId, sender);
    });
  }

  pc.ontrack = (event) => {
    const stream = event.streams[0];
    if (!stream) return;
    const track = event.track;
    if (track.kind === "audio") {
      let audio = audioElements.get(remoteUserId);
      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        audio.setAttribute("playsinline", "");
        document.body.appendChild(audio);
        audioElements.set(remoteUserId, audio);
      }
      audio.srcObject = stream;
    } else if (track.kind === "video") {
      useStore.getState().addScreenShare(remoteUserId, stream);
      track.onended = () => {
        useStore.getState().removeScreenShare(remoteUserId);
      };
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate && ws?.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "ice_candidate",
          channel_id: channelId,
          target_user_id: remoteUserId,
          from_user_id: localUserId,
          candidate: JSON.stringify(event.candidate),
        }),
      );
    }
  };
  pc.onnegotiationneeded = async () => {
    try {
      if (makingOffer.get(remoteUserId)) return;

      // Check if we're in a valid state to negotiate
      if (pc!.signalingState !== "stable") {
        console.warn(`Negotiation skipped, state: ${pc!.signalingState}`);
        return;
      }

      makingOffer.set(remoteUserId, true);

      // Double-check state before creating offer
      if (pc!.signalingState !== "stable") {
        makingOffer.set(remoteUserId, false);
        return;
      }

      const offer = await pc!.createOffer();

      // Check state again before setting local description
      if (pc!.signalingState !== "stable") {
        makingOffer.set(remoteUserId, false);
        return;
      }

      await pc!.setLocalDescription(offer);

      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "voice_offer",
            channel_id: channelId,
            target_user_id: remoteUserId,
            from_user_id: localUserId,
            sdp: JSON.stringify(pc!.localDescription),
          }),
        );
      }
    } catch (err) {
      if (
        err instanceof Error &&
        (err.name === "InvalidStateError" || err.name === "InvalidAccessError")
      ) {
        console.warn("Negotiation error (ignored):", err.message);
        return;
      }
      console.error("Negotiation failed", err);
    } finally {
      makingOffer.set(remoteUserId, false);
    }
  };

  peerConnections.set(remoteUserId, pc);
  return pc;
}

// ─── Helper: cleanup everything ───
function cleanupAll() {
  peerConnections.forEach((pc) => {
    try {
      pc.close();
    } catch {
      // Ignore errors during cleanup
    }
  });
  peerConnections.clear();
  makingOffer.clear();

  localStream?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      // Ignore errors during cleanup
    }
  });
  localStream = null;

  displayStream?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      // Ignore errors during cleanup
    }
  });
  displayStream = null;

  audioElements.forEach((el) => {
    try {
      el.srcObject = null;
      el.remove();
    } catch {
      // Ignore errors during cleanup
    }
  });
  audioElements.clear();
  screenTrackSenders.clear();

  stopVAD();
  broadcastTalkingState(false);
  isMutedLocal = false;
  isDeafenedLocal = false;

  useStore.getState().removeScreenShare(localUserId);

  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }

  currentChannelId = null;
}

// ─── The hook ───
export function useVoice() {
  const voiceChannelId = useStore((s) => s.voiceChannelId);
  const setVoiceChannel = useStore((s) => s.setVoiceChannel);
  const setVoiceMembers = useStore((s) => s.setVoiceMembers);
  const addVoiceMember = useStore((s) => s.addVoiceMember);
  const removeVoiceMember = useStore((s) => s.removeVoiceMember);
  const activeServerId = useStore((s) => s.activeServerId);
  const servers = useStore((s) => s.servers);
  const displayName = useStore((s) => s.displayName);
  const currentUser = useStore((s) => s.currentUser);
  const voiceSettings = useStore((s) => s.voiceSettings);
  const setTalking = useStore((s) => s.setTalking);
  const isScreenSharing = displayStream !== null;

  const activeServer = servers.find((s) => s.id === activeServerId);
  // PTT key handling
  useEffect(() => {
    if (!voiceChannelId) return; // not in voice, no need for key listeners

    if (voiceSettings.mode !== "ptt") {
      // Activity mode: enable tracks, start VAD
      localStream?.getAudioTracks().forEach((t) => (t.enabled = true));
      if (localStream) startVAD(localStream);
      return () => {
        stopVAD();
      };
    }

    // PTT mode: disable tracks by default
    localStream?.getAudioTracks().forEach((t) => (t.enabled = false));
    stopVAD();

    const pttKey = voiceSettings.pttKey;
    const isMouseButton = pttKey.startsWith("Mouse");

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isMouseButton && e.code === pttKey) {
        localStream?.getAudioTracks().forEach((t) => (t.enabled = true));
        broadcastTalkingState(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isMouseButton && e.code === pttKey) {
        localStream?.getAudioTracks().forEach((t) => (t.enabled = false));
        broadcastTalkingState(false);
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (isMouseButton && `Mouse${e.button}` === pttKey) {
        e.preventDefault();
        localStream?.getAudioTracks().forEach((t) => (t.enabled = true));
        broadcastTalkingState(true);
      }
    };
    const handleMouseUp = (e: MouseEvent) => {
      if (isMouseButton && `Mouse${e.button}` === pttKey) {
        e.preventDefault();
        localStream?.getAudioTracks().forEach((t) => (t.enabled = false));
        broadcastTalkingState(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [voiceSettings.mode, voiceSettings.pttKey, voiceChannelId]);

  const joinVoice = useCallback(
    async (channelId: string) => {
      if (!activeServer) return;
      cleanupAll();
      setVoiceMembers([]);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        localStream = stream;
      } catch (err) {
        console.error("Mic failed", err);
        return;
      }

      setVoiceChannel(channelId);
      currentChannelId = channelId;

      const { host, port, authToken } = activeServer.config;
      try {
        const wsUrl = `ws://${host}:${port}/ws${
          authToken ? `?token=${authToken}` : ""
        }`;
        const socket = new WebSocket(wsUrl);
        ws = socket;

        socket.onopen = () => {
          // Wait for identity message
        };

        socket.onmessage = async (event) => {
          const data: WsServerMessage = JSON.parse(event.data);

          if (data.type === "identity") {
            localUserId = data.user_id; // Register joining voice on server
            socket.send(
              JSON.stringify({
                type: "join_voice",
                channel_id: channelId,
                user_id: data.user_id,
                user_name:
                  displayName || currentUser?.display_name || "Anonymous",
              }),
            );

            // Play join sound
            playVoiceSound("join");

            // Start VAD if in activity mode
            if (
              useStore.getState().voiceSettings.mode === "activity" &&
              localStream
            ) {
              startVAD(localStream);
            }
          } else if (data.type === "voice_members") {
            const members = Array.isArray(data.members) ? data.members : [];
            const current = useStore.getState().voiceMembers;
            const others = current.filter(
              (m) => m.channel_id !== data.channel_id,
            );
            setVoiceMembers([...others, ...members]);

            members.forEach((m) => {
              if (m.user_id !== localUserId)
                createPeerConnection(m.user_id, channelId);
            });
          } else if (data.type === "voice_peer_joined") {
            addVoiceMember({
              user_id: data.user_id,
              user_name: data.user_name || "Unknown",
              channel_id: data.channel_id,
              is_muted: false,
              is_deafened: false,
            });
            if (data.user_id !== localUserId) {
              // Play join sound for others
              playVoiceSound("join");
              if (data.channel_id === channelId) {
                createPeerConnection(data.user_id, channelId);
              }
            }
          } else if (data.type === "voice_peer_left") {
            // Remove from global store
            const current = useStore.getState().voiceMembers;
            setVoiceMembers(
              current.filter(
                (m) =>
                  !(
                    m.user_id === data.user_id &&
                    m.channel_id === data.channel_id
                  ),
              ),
            );

            if (data.user_id !== localUserId) {
              // Play leave sound for others
              playVoiceSound("leave");
            }

            // If it was someone in our channel, cleanup peer connection
            if (data.channel_id === channelId) {
              const pc = peerConnections.get(data.user_id);
              if (pc) {
                pc.close();
                peerConnections.delete(data.user_id);
              }
              const audio = audioElements.get(data.user_id);
              if (audio) {
                audio.srcObject = null;
                audio.remove();
                audioElements.delete(data.user_id);
              }
              useStore.getState().removeScreenShare(data.user_id);
            }
          } else if (data.type === "voice_offer") {
            if (data.target_user_id !== localUserId) return;
            const pc =
              peerConnections.get(data.from_user_id) ||
              createPeerConnection(data.from_user_id, channelId);

            const description = JSON.parse(data.sdp);
            const readyForOffer =
              !makingOffer.get(data.from_user_id) &&
              (pc.signalingState === "stable" ||
                pc.signalingState === "have-local-offer");

            const polite = localUserId < data.from_user_id;

            try {
              if (description.type === "offer" && !readyForOffer) {
                if (!polite) return;
                // Only rollback if in have-local-offer state
                if (pc.signalingState === "have-local-offer") {
                  await pc.setLocalDescription({ type: "rollback" });
                }
              }

              // Check if we're in a valid state to accept the offer
              if (description.type === "offer") {
                if (
                  pc.signalingState !== "stable" &&
                  pc.signalingState !== "have-local-offer"
                ) {
                  console.warn(
                    `Cannot accept offer in state: ${pc.signalingState}`,
                  );
                  return;
                }
                await pc.setRemoteDescription(description);
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                socket.send(
                  JSON.stringify({
                    type: "voice_answer",
                    channel_id: channelId,
                    target_user_id: data.from_user_id,
                    from_user_id: localUserId,
                    sdp: JSON.stringify(pc.localDescription),
                  }),
                );
              }
            } catch (err) {
              if (
                err instanceof Error &&
                (err.name === "InvalidStateError" ||
                  err.name === "InvalidAccessError")
              ) {
                // Ignore invalid state errors during negotiation
                console.warn("Negotiation error (ignored):", err.message);
                return;
              }
              console.error("Error handling voice offer:", err);
            }
          } else if (data.type === "voice_answer") {
            if (data.target_user_id !== localUserId) return;
            const pc = peerConnections.get(data.from_user_id);
            if (!pc) return;

            // Only accept answer if we're in the right state
            if (pc.signalingState !== "have-local-offer") {
              console.warn(
                `Cannot accept answer in state: ${pc.signalingState}`,
              );
              return;
            }

            try {
              await pc.setRemoteDescription(JSON.parse(data.sdp));
            } catch (err) {
              if (
                err instanceof Error &&
                (err.name === "InvalidStateError" ||
                  err.name === "InvalidAccessError")
              ) {
                console.warn("Answer error (ignored):", err.message);
                return;
              }
              console.error("Error handling voice answer:", err);
            }
          } else if (data.type === "ice_candidate") {
            if (data.target_user_id !== localUserId) return;
            const pc = peerConnections.get(data.from_user_id);
            if (pc) {
              try {
                await pc.addIceCandidate(JSON.parse(data.candidate));
              } catch {
                // Ignore ICE candidate errors
              }
            }
          } else if (data.type === "voice_talking") {
            setTalking(data.user_id, data.talking);
          } else if (data.type === "voice_status_update") {
            const currentMembers = useStore.getState().voiceMembers;
            const updated = currentMembers.map((m) =>
              m.user_id === data.user_id
                ? {
                    ...m,
                    is_muted: data.is_muted,
                    is_deafened: data.is_deafened,
                  }
                : m,
            );
            setVoiceMembers(updated);
          }
        };

        socket.onclose = () => {
          ws = null;
        };
      } catch (err) {
        console.error("WS Voice failed", err);
        cleanupAll();
        setVoiceChannel(null);
      }
    },
    [
      activeServer,
      displayName,
      currentUser?.display_name,
      setVoiceChannel,
      setVoiceMembers,
      addVoiceMember,
      removeVoiceMember,
      setTalking,
    ],
  );
  const stopScreenShareInternal = () => {
    displayStream?.getTracks().forEach((t) => t.stop());
    displayStream = null;
    useStore.getState().removeScreenShare(localUserId);
    peerConnections.forEach((pc, remoteUserId) => {
      const sender = screenTrackSenders.get(remoteUserId);
      if (sender) {
        try {
          pc.removeTrack(sender);
        } catch {
          // ignore
        }
        screenTrackSenders.delete(remoteUserId);
      }
    });
  };

  const startScreenShare = useCallback(async () => {
    if (!currentChannelId || displayStream) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      displayStream = stream;
      useStore.getState().addScreenShare(localUserId, stream);

      const videoTrack = stream.getVideoTracks()[0];
      peerConnections.forEach((pc, remoteUserId) => {
        try {
          const sender = pc.addTrack(videoTrack, stream);
          screenTrackSenders.set(remoteUserId, sender);
        } catch (e) {
          console.error("Screen track add failed", e);
        }
      });

      videoTrack.onended = () => stopScreenShareInternal();
    } catch (err) {
      console.error("Screen share failed", err);
    }
  }, []);

  const stopScreenShare = useCallback(() => {
    stopScreenShareInternal();
  }, []);
  const leaveVoice = useCallback(() => {
    if (ws?.readyState === WebSocket.OPEN && currentChannelId) {
      try {
        ws.send(
          JSON.stringify({
            type: "leave_voice",
            channel_id: currentChannelId,
            user_id: localUserId,
          }),
        );
      } catch {
        // ignore
      }
    }

    // Play leave sound
    playVoiceSound("leave");

    cleanupAll();
    setVoiceChannel(null);
    setVoiceMembers([]);
  }, [setVoiceChannel, setVoiceMembers]);

  const toggleMute = useCallback(() => {
    isMutedLocal = !isMutedLocal;
    playToggleSound(!isMutedLocal);
    localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !isMutedLocal;
    });
    if (isMutedLocal) {
      broadcastTalkingState(false);
      stopVAD();
    } else if (
      useStore.getState().voiceSettings.mode === "activity" &&
      localStream
    ) {
      startVAD(localStream);
    }

    if (ws?.readyState === WebSocket.OPEN && currentChannelId) {
      ws.send(
        JSON.stringify({
          type: "voice_status_update",
          channel_id: currentChannelId,
          user_id: localUserId,
          is_muted: isMutedLocal,
          is_deafened: isDeafenedLocal,
        }),
      );
    }
  }, []);

  const toggleDeafen = useCallback(() => {
    isDeafenedLocal = !isDeafenedLocal;
    playToggleSound(!isDeafenedLocal);
    audioElements.forEach((audio) => {
      audio.muted = isDeafenedLocal;
    });
    // Also mute mic when deafened
    if (isDeafenedLocal && !isMutedLocal) {
      isMutedLocal = true;
      localStream?.getAudioTracks().forEach((t) => {
        t.enabled = false;
      });
      broadcastTalkingState(false);
      stopVAD();
    } else if (!isDeafenedLocal && isMutedLocal) {
      // Un-deafen also un-mutes
      isMutedLocal = false;
      localStream?.getAudioTracks().forEach((t) => {
        t.enabled = true;
      });
      if (
        useStore.getState().voiceSettings.mode === "activity" &&
        localStream
      ) {
        startVAD(localStream);
      }
    }

    if (ws?.readyState === WebSocket.OPEN && currentChannelId) {
      ws.send(
        JSON.stringify({
          type: "voice_status_update",
          channel_id: currentChannelId,
          user_id: localUserId,
          is_muted: isMutedLocal,
          is_deafened: isDeafenedLocal,
        }),
      );
    }
  }, []);

  return {
    joinVoice,
    leaveVoice,
    startScreenShare,
    stopScreenShare,
    isScreenSharing,
    toggleMute,
    toggleDeafen,
    isMuted: isMutedLocal,
    isDeafened: isDeafenedLocal,
  };
}
