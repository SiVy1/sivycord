import React from "react";
import type { ShortCut } from "../types";
import { useStore } from "../store";
import { broadcastTalkingState } from "./voiceHelpers";

const DEFAULT_SHORTCUTS: ShortCut[] = [
  { key: "m", ctrl: true, shift: true, action: "toggle_mute" },
  { key: "d", ctrl: true, shift: true, action: "toggle_deafen" },
  { key: "ArrowUp", alt: true, action: "prev_channel" },
  { key: "ArrowDown", alt: true, action: "next_channel" },
  { key: "Escape", action: "close_modal" },
];

const hotkeyFunctions = {
  toggle_mute: () => {
    const { isMuted, setMuted } = useStore.getState();
    setMuted(!isMuted);
    let userId = useStore.getState().currentUser?.id;
    if (userId) {
      useStore.getState().updateVoiceStatus(userId, !isMuted, false);
    }
    console.log("Mute toggled:", !isMuted);
  },
  toggle_deafen: () => {
    const { isDeafened, setDeafened } = useStore.getState();
    setDeafened(!isDeafened);
    let userId = useStore.getState().currentUser?.id;
    if (userId) {
      useStore.getState().updateVoiceStatus(userId, !isDeafened, !isDeafened);
    }
    console.log("Deafen toggled:", !isDeafened);
  },
  prev_channel: () => {
    console.log("Previous channel action");
  },
  next_channel: () => {
    console.log("Next channel action");
  },
  close_modal: () => {
    console.log("Close modal action");
  },
};

export function useHotkey(shortcuts: ShortCut[] = DEFAULT_SHORTCUTS) {
  const { pttKey, mode } = useStore((s) => s.voiceSettings);
  const isPttMode = mode === "ptt";

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      console.log(
        "Key down:",
        event.key,
        "Ctrl:",
        event.ctrlKey,
        "Alt:",
        event.altKey,
        "Shift:",
        event.shiftKey,
      );
      const target = event.target as HTMLElement;
      const isInputActive =
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable;

      if (isInputActive && event.key !== "Escape") {
        return;
      }

      if (isPttMode && event.code === pttKey && !event.repeat) {
        broadcastTalkingState(true);
        return;
      }

      for (const shortcut of shortcuts) {
        const ctrlMatch = !!shortcut.ctrl === event.ctrlKey;
        const altMatch = !!shortcut.alt === event.altKey;
        const shiftMatch = !!shortcut.shift === event.shiftKey;
        // const metaMatch = !!shortcut.meta === event.metaKey;
        if (
          event.key === shortcut.key &&
          ctrlMatch &&
          altMatch &&
          shiftMatch
          //   metaMatch
        ) {
          event.preventDefault();

          const action = shortcut.action;
          console.log(`Hotkey triggered: ${action}`);
          if (action in hotkeyFunctions) {
            const actionFunction =
              hotkeyFunctions[action as keyof typeof hotkeyFunctions];
            actionFunction();
          } else {
            console.warn(`No function defined for action: ${action}`);
          }
          break;
        }
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (isPttMode && event.code === pttKey) {
        broadcastTalkingState(false);
      }
    }

    function handleMouseDown(event: MouseEvent) {
      if (isPttMode && pttKey === `Mouse${event.button}`) {
        broadcastTalkingState(true);
      }
    }

    function handleMouseUp(event: MouseEvent) {
      if (isPttMode && pttKey === `Mouse${event.button}`) {
        broadcastTalkingState(false);
      }
    }

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
  }, [shortcuts, pttKey, isPttMode]);
}
