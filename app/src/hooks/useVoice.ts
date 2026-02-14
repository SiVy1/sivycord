import { useCallback, useEffect } from "react";
import { useStore } from "../store";
import { type WsServerMessage, getWsUrl } from "../types";
import { setTalkingDirect } from "./talkingStore";
import {
  ws, localStream, displayStream, localUserId, currentChannelId,
  peerConnections, makingOffer, audioElements, screenTrackSenders,
  isMutedLocal, isDeafenedLocal,
  setWs, setLocalStream, setDisplayStream, setLocalUserId, setCurrentChannelId,
  setIsMutedLocal, setIsDeafenedLocal,
  playToggleSound, playVoiceSound, broadcastTalkingState,
  startVAD, stopVAD, createPeerConnection, cleanupAll,
} from "./voiceHelpers";

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
        setLocalStream(stream);
      } catch (err) {
        console.error("Mic failed", err);
        return;
      }

      setVoiceChannel(channelId);
      setCurrentChannelId(channelId);

      if (activeServer.type === "p2p") {
        const docId = activeServer.config.p2p?.namespaceId;
        if (docId) {
          await useStore.getState().startP2PVoice(docId);
          playVoiceSound("join");
        }
        return;
      }

      const { host, port, authToken } = activeServer.config;
      if (!host || !port) return;
      try {
        const wsUrl = `${getWsUrl(host, port)}/ws${
          authToken ? `?token=${authToken}` : ""
        }`;
        const socket = new WebSocket(wsUrl);
        setWs(socket);

        socket.onopen = () => {
          // Wait for identity message
        };

        socket.onmessage = async (event) => {
          const data: WsServerMessage = JSON.parse(event.data);

          if (data.type === "identity") {
            setLocalUserId(data.user_id);
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
            setTalkingDirect(data.user_id, data.talking);
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
          setWs(null);
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
    ],
  );

  const stopScreenShareInternal = () => {
    displayStream?.getTracks().forEach((t) => t.stop());
    setDisplayStream(null);
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
      setDisplayStream(stream);
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

    if (activeServer?.type === "p2p") {
      useStore.getState().stopP2PVoice();
    }

    // Play leave sound
    playVoiceSound("leave");

    cleanupAll();
    setVoiceChannel(null);
    setVoiceMembers([]);
  }, [setVoiceChannel, setVoiceMembers]);

  const toggleMute = useCallback(() => {
    const wasMuted = isMutedLocal;
    const newMuted = !wasMuted;
    setIsMutedLocal(newMuted);
    useStore.getState().setMuted(newMuted);
    playToggleSound(newMuted);
    localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !newMuted;
    });
    if (newMuted) {
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
          is_muted: newMuted,
          is_deafened: isDeafenedLocal,
        }),
      );
    }
  }, []);

  const toggleDeafen = useCallback(() => {
    const wasDeafened = isDeafenedLocal;
    const newDeafened = !wasDeafened;
    setIsDeafenedLocal(newDeafened);
    useStore.getState().setDeafened(newDeafened);
    playToggleSound(newDeafened);
    audioElements.forEach((audio) => {
      audio.muted = newDeafened;
    });
    // Also mute mic when deafened
    if (newDeafened && !isMutedLocal) {
      setIsMutedLocal(true);
      useStore.getState().setMuted(true);
      localStream?.getAudioTracks().forEach((t) => {
        t.enabled = false;
      });
      broadcastTalkingState(false);
      stopVAD();
    } else if (!newDeafened && isMutedLocal) {
      // Un-deafen also un-mutes
      setIsMutedLocal(false);
      useStore.getState().setMuted(false);
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
          is_deafened: newDeafened,
        }),
      );
    }
  }, []);

  const isMuted = useStore((s) => s.isMuted);
  const isDeafened = useStore((s) => s.isDeafened);

  return {
    joinVoice,
    leaveVoice,
    startScreenShare,
    stopScreenShare,
    isScreenSharing,
    toggleMute,
    toggleDeafen,
    isMuted,
    isDeafened,
  };
}
