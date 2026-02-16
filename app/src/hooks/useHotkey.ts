import React from "react";
import type { ShortCut } from "../types";
import { useStore } from "../store";

const DEFAULT_SHORTCUTS: ShortCut[] = [
  { key: "m", ctrl: true, shift: true, action: "toggle_mute" },
  { key: "d", ctrl: true, shift: true, action: "toggle_deafen" },
  { key: "ArrowUp", alt: true, action: "prev_channel" },
  { key: "ArrowDown", alt: true, action: "next_channel" },
  { key: "Escape", action: "close_modal" },
];

export function useHotkey(shortcuts: ShortCut[] = DEFAULT_SHORTCUTS) {
  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      for (const shortcut of shortcuts) {
        const ctrlMatch = shortcut.ctrl ? event.ctrlKey : true;
        const altMatch = shortcut.alt ? event.altKey : true;
        const shiftMatch = shortcut.shift ? event.shiftKey : true;
        if (event.key === shortcut.key && ctrlMatch && altMatch && shiftMatch) {
          event.preventDefault();
          // Here you would dispatch the corresponding action based on shortcut.action
          console.log(`Hotkey triggered: ${shortcut.action}`);
          const actionFunction = hotkeyFunctions[shortcut.action];
          if (actionFunction) {
            actionFunction();
          } else {
            console.warn(`No function defined for action: ${shortcut.action}`);
          }
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [shortcuts]);
}
const hotkeyFunctions = {
  toggle_mute: () => {
    useStore.getState().setMuted(!useStore.getState().isMuted);
  },
  toggle_deafen: () => {
    useStore.getState().setDeafened(!useStore.getState().isDeafened);
  },
  push_to_talk: () => {
    // Implement logic for push-to-talk (e.g., set a state that enables mic while key is held down)
  },
  prev_channel: () => {
    // Implement logic to switch to previous channel
  },
  next_channel: () => {
    // Implement logic to switch to next channel
  },
  close_modal: () => {
    // Implement logic to close any open modal
  },
};
