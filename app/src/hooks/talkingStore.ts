import { useSyncExternalStore } from "react";

// ─── Module-level talking state (outside React/Zustand) ───
// This avoids creating a new Set on every voice update, which was causing
// the entire ChannelSidebar to re-render ~20 times/second.

const talkingMap = new Map<string, boolean>();
const listeners = new Set<() => void>();
let snapshotVersion = 0;
let cachedSnapshot: ReadonlySet<string> = new Set();

function emitChange() {
  snapshotVersion++;
  cachedSnapshot = new Set(talkingMap.keys());
  listeners.forEach((fn) => fn());
}

/** Set a user's talking state. No-ops if unchanged (debounce). */
export function setTalkingDirect(userId: string, talking: boolean) {
  const current = talkingMap.has(userId);
  if (current === talking) return; // no change, no re-render
  if (talking) {
    talkingMap.set(userId, true);
  } else {
    talkingMap.delete(userId);
  }
  emitChange();
}

/** Check if a specific user is talking (non-reactive, for one-off checks). */
export function isTalking(userId: string): boolean {
  return talkingMap.has(userId);
}

/** Clear all talking state (e.g. on voice disconnect). */
export function clearAllTalking() {
  if (talkingMap.size === 0) return;
  talkingMap.clear();
  emitChange();
}

// ─── React hook via useSyncExternalStore ───

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): ReadonlySet<string> {
  return cachedSnapshot;
}

/**
 * React hook that subscribes to talking-user changes.
 * Returns a ReadonlySet<string> of user IDs currently talking.
 * Only triggers re-render when the set actually changes.
 */
export function useTalkingUsers(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * React hook that returns whether a specific user is talking.
 * More granular — only re-renders when THAT user's state changes.
 */
export function useIsTalking(userId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => talkingMap.has(userId),
    () => talkingMap.has(userId),
  );
}
