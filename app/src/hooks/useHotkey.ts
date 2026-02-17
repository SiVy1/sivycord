import React from "react";
import { useStore } from "../store";
import {
  broadcastTalkingState,
  toggleMute,
  toggleDeafen,
} from "./voiceHelpers";


type HotkeyCallbacks = {
  onCommandPalette?: () => void;
  onCloseModal?: () => void;
};

function getHotkeyFunctions(callbacks: HotkeyCallbacks) {
  return {
    toggle_mute: () => {
      toggleMute();
      console.log("Mute toggled via hotkey");
    },
    toggle_deafen: () => {
      toggleDeafen();
      console.log("Deafen toggled via hotkey");
    },
    prev_channel: () => {
      console.log("Previous channel action");
    },
    next_channel: () => {
      console.log("Next channel action");
    },
    close_modal: () => {
      if (callbacks.onCloseModal) {
        callbacks.onCloseModal();
      } else {
        console.log("Close modal action");
      }
    },
    command_palette: () => {
      if (callbacks.onCommandPalette) {
        callbacks.onCommandPalette();
      } else {
        console.log("Toggle command palette");
      }
    },
  };
}


export function useHotkey(callbacks: HotkeyCallbacks = {}) {
  const { pttKey, mode } = useStore((s) => s.voiceSettings);
  const shortcuts = useStore((s) => s.shortcuts);
  const isPttMode = mode === "ptt";
  const hotkeyFunctions = React.useMemo(() => getHotkeyFunctions(callbacks), [callbacks]);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
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

      // Check shortcuts
      for (const [action, combo] of Object.entries(shortcuts)) {
        const parts = combo.split("+");
        const key = parts[parts.length - 1].toLowerCase();
        const modifiers = parts.slice(0, -1);

        const ctrlReq =
          modifiers.includes("Control") || modifiers.includes("Ctrl");
        const altReq = modifiers.includes("Alt");
        const shiftReq = modifiers.includes("Shift");
        const metaReq =
          modifiers.includes("Meta") ||
          modifiers.includes("Command") ||
          modifiers.includes("Win");

        if (
          event.key.toLowerCase() === key &&
          event.ctrlKey === ctrlReq &&
          event.altKey === altReq &&
          event.shiftKey === shiftReq &&
          event.metaKey === metaReq
        ) {
          event.preventDefault();
          event.stopPropagation(); // Stop bubbling
          console.log(`Hotkey triggered: ${action}`);
          if (action in hotkeyFunctions) {
            const actionFunction =
              hotkeyFunctions[action as keyof typeof hotkeyFunctions];
            actionFunction();
          } else {
            console.warn(`No function defined for action: ${action}`);
          }
          return; // Stop checking other shortcuts
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
  }, [shortcuts, pttKey, isPttMode, hotkeyFunctions]);
}
