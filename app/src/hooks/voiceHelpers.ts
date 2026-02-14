import { useStore } from "../store";
import { getApiUrl } from "../types";
import { setTalkingDirect, clearAllTalking } from "./talkingStore";

// ─── Module-level singleton state ───
// These live outside the hook so every component calling useVoice()
// shares the exact same WebSocket, peer connections, streams, etc.

export let ws: WebSocket | null = null;
export let localStream: MediaStream | null = null;
export let displayStream: MediaStream | null = null;
export let localUserId = "unknown";
export let currentChannelId: string | null = null;

export const peerConnections = new Map<string, RTCPeerConnection>();
export const makingOffer = new Map<string, boolean>();
export const audioElements = new Map<string, HTMLAudioElement>();
export const screenTrackSenders = new Map<string, RTCRtpSender>();

// VAD (voice activity detection)
let audioContext: AudioContext | null = null;
let analyserNode: AnalyserNode | null = null;
let vadInterval: ReturnType<typeof setInterval> | null = null;
let isTalkingLocal = false;

// Mute / Deafen state
export let isMutedLocal = false;
export let isDeafenedLocal = false;

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

// ─── Setters for module-level state ───
export function setWs(v: WebSocket | null) { ws = v; }
export function setLocalStream(v: MediaStream | null) { localStream = v; }
export function setDisplayStream(v: MediaStream | null) { displayStream = v; }
export function setLocalUserId(v: string) { localUserId = v; }
export function setCurrentChannelId(v: string | null) { currentChannelId = v; }
export function setIsMutedLocal(v: boolean) { isMutedLocal = v; }
export function setIsDeafenedLocal(v: boolean) { isDeafenedLocal = v; }

// ─── Helper: play toggle sound ───
export function playToggleSound(on: boolean) {
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
export function playVoiceSound(type: "join" | "leave") {
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
        const { host, port } = activeServer.config;
        if (activeServer.type === "legacy" && host && port) {
          const fullUrl = serverSoundUrl.startsWith("http")
            ? serverSoundUrl
            : `${getApiUrl(host, port)}${serverSoundUrl}`;

          const audio = new Audio(fullUrl);
          audio.volume = 0.4;
          audio.play().catch(() => {});
          return;
        }
      } catch {
        // Fall back
      }
    } else {
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
export function broadcastTalkingState(talking: boolean) {
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
  setTalkingDirect(localUserId, talking);
}

// ─── Helper: start VAD ───
export function startVAD(stream: MediaStream) {
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
      analyserNode.getByteFrequencyData(dataArray);
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

export function stopVAD() {
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
export function createPeerConnection(
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
export function cleanupAll() {
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
  clearAllTalking();
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
