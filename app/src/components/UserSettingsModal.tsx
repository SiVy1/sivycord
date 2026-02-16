import { useState, useEffect } from "react";
import { useStore } from "../store";
import { getApiUrl } from "../types";
import { AuthScreen } from "./AuthScreen";
import { X, Camera } from "lucide-react";

interface UserSettingsModalProps {
  onClose: () => void;
}

export function UserSettingsModal({ onClose }: UserSettingsModalProps) {
  const currentUser = useStore((s) => s.currentUser);
  const setCurrentUser = useStore((s) => s.setCurrentUser);
  const servers = useStore((s) => s.servers);
  const activeServerId = useStore((s) => s.activeServerId);
  const updateServerAuth = useStore((s) => s.updateServerAuth);
  const voiceSettings = useStore((s) => s.voiceSettings);
  const updateVoiceSettings = useStore((s) => s.updateVoiceSettings);
  const logout = useStore((s) => s.logout);

  const [showAuth, setShowAuth] = useState(false);
  const [editingDisplayName, setEditingDisplayName] = useState(false);
  const [newName, setNewName] = useState(currentUser?.display_name || "");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const activeServer = servers.find((s) => s.id === activeServerId);

  const handleLogout = () => {
    logout();
    onClose();
  };

  const handleUpdateProfile = async () => {
    if (
      !currentUser ||
      !activeServer ||
      activeServer.type !== "legacy" ||
      !activeServer.config.authToken
    )
      return;
    const { host, port } = activeServer.config;
    if (!host || !port) return;
    try {
      const guildId = activeServer.config.guildId || "default";
      const res = await fetch(`${getApiUrl(host, port)}/api/me`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeServer.config.authToken}`,
          "X-Server-Id": guildId,
        },
        body: JSON.stringify({ display_name: newName.trim() }),
      });
      if (res.ok) {
        const updated = await res.json();
        setCurrentUser(updated);
        setEditingDisplayName(false);
      }
    } catch (err) {
      console.error("Failed to update profile", err);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (
      !file ||
      !activeServer ||
      activeServer.type !== "legacy" ||
      !activeServer.config.authToken
    )
      return;
    const { host, port } = activeServer.config;
    if (!host || !port) return;

    setUploadingAvatar(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const guildId = activeServer.config.guildId || "default";
      const res = await fetch(`${getApiUrl(host, port)}/api/me/avatar`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${activeServer.config.authToken}`,
          "X-Server-Id": guildId,
        },
        body: formData,
      });
      if (res.ok) {
        const updated = await res.json();
        setCurrentUser(updated);
      }
    } catch (err) {
      console.error("Avatar upload failed", err);
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="w-full max-w-lg bg-bg-secondary border border-border/50 rounded-3xl flex flex-col max-h-[85vh] overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-border/50 bg-bg-primary/50">
          <h3 className="text-xl font-bold text-text-primary tracking-tight">
            Settings
          </h3>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-bg-surface text-text-muted hover:text-text-primary transition-all cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 space-y-10">
          {/* Profile Section */}
          <section>
            <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-4">
              Your Profile
            </h4>
            {currentUser ? (
              <div className="bg-bg-primary/50 rounded-2xl border border-border/50 p-6 flex items-center gap-6 shadow-sm">
                <div className="relative group">
                  {activeServer &&
                  activeServer.type === "legacy" &&
                  activeServer.config.host &&
                  activeServer.config.port &&
                  currentUser.avatar_url ? (
                    <img
                      src={`${getApiUrl(activeServer.config.host, activeServer.config.port)}${currentUser.avatar_url}`}
                      className="w-20 h-20 rounded-3xl object-cover border-2 border-border/50 shadow-md group-hover:border-accent/50 transition-all"
                      alt={currentUser.display_name}
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-3xl bg-accent/15 flex items-center justify-center text-3xl font-bold text-accent border border-accent/20">
                      {currentUser.display_name[0].toUpperCase()}
                    </div>
                  )}
                  <label className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-3xl opacity-0 group-hover:opacity-100 transition-all cursor-pointer backdrop-blur-[2px]">
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      disabled={uploadingAvatar}
                    />
                    <Camera className="w-7 h-7 text-white" />
                  </label>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    {editingDisplayName ? (
                      <div className="flex gap-2 w-full">
                        <input
                          type="text"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          className="flex-1 px-3 py-1.5 bg-bg-input border border-accent/50 rounded-lg text-sm text-text-primary outline-none ring-4 ring-accent/5"
                          autoFocus
                          onKeyDown={(e) =>
                            e.key === "Enter" && handleUpdateProfile()
                          }
                        />
                        <button
                          onClick={handleUpdateProfile}
                          className="px-3 py-1 bg-accent text-white rounded-lg text-xs font-bold hover:bg-accent-hover transition-colors"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <>
                        <h5 className="text-lg font-bold text-text-primary truncate tracking-tight">
                          {currentUser.display_name}
                        </h5>
                        <button
                          onClick={() => setEditingDisplayName(true)}
                          className="text-xs font-bold text-accent hover:text-accent-hover px-2 py-1 rounded-lg hover:bg-accent/5 transition-all"
                        >
                          Edit
                        </button>
                      </>
                    )}
                  </div>
                  <p className="text-xs font-medium text-text-muted bg-bg-surface w-fit px-2 py-0.5 rounded-md border border-border/50">
                    @{currentUser.username}
                  </p>
                </div>
              </div>
            ) : null}
          </section>
          {/* Voice Section */}
          <section>
            <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-4">
              Voice & Video
            </h4>
            <div className="space-y-6 bg-bg-primary/50 rounded-2xl border border-border/50 p-6 shadow-sm">
              <div>
                <label className="text-xs font-bold text-text-secondary mb-3 block opacity-80 uppercase tracking-wider">
                  Input Mode
                </label>
                <div className="flex gap-3">
                  <button
                    onClick={() => updateVoiceSettings({ mode: "activity" })}
                    className={`flex-1 py-3 text-xs font-bold rounded-xl border-2 transition-all cursor-pointer ${
                      voiceSettings.mode === "activity"
                        ? "bg-accent/10 border-accent text-accent shadow-md shadow-accent/5"
                        : "border-border/50 text-text-muted hover:border-text-muted/50 hover:bg-bg-surface"
                    }`}
                  >
                    Voice Activity
                  </button>
                  <button
                    onClick={() => updateVoiceSettings({ mode: "ptt" })}
                    className={`flex-1 py-3 text-xs font-bold rounded-xl border-2 transition-all cursor-pointer ${
                      voiceSettings.mode === "ptt"
                        ? "bg-accent/10 border-accent text-accent shadow-md shadow-accent/5"
                        : "border-border/50 text-text-muted hover:border-text-muted/50 hover:bg-bg-surface"
                    }`}
                  >
                    Push to Talk
                  </button>
                </div>
              </div>{" "}
              {voiceSettings.mode === "ptt" && (
                <PttKeyBinder
                  currentKey={voiceSettings.pttKey}
                  onChange={(key) => updateVoiceSettings({ pttKey: key })}
                />
              )}
            </div>
          </section>
          {/* Keybinds Section */}
          <section>
            <h4 className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-4">
              Keybinds
            </h4>
            <div className="space-y-4 bg-bg-primary/50 rounded-2xl border border-border/50 p-6 shadow-sm">
              <KeybindsSettings />
            </div>
          </section>{" "}
          {/* Logout Section */}
          {currentUser && (
            <section className="pt-6 border-t border-border/50">
              <button
                onClick={handleLogout}
                className="w-full py-4 bg-danger/10 hover:bg-danger text-danger hover:text-white text-xs font-bold rounded-2xl transition-all shadow-sm cursor-pointer active:scale-[0.98]"
              >
                Log Out of Server
              </button>
            </section>
          )}
        </div>
      </div>

      {showAuth &&
        activeServer &&
        activeServer.type === "legacy" &&
        activeServer.config.host &&
        activeServer.config.port && (
          <AuthScreen
            serverHost={activeServer.config.host}
            serverPort={activeServer.config.port}
            onAuth={(user, token) => {
              setCurrentUser(user);
              updateServerAuth(activeServer.id, token, user.id);
              setShowAuth(false);
            }}
          />
        )}
    </div>
  );
}

function KeybindsSettings() {
  const shortcuts = useStore((s) => s.shortcuts);
  const setShortcut = useStore((s) => s.setShortcut);
  const resetShortcuts = useStore((s) => s.resetShortcuts);
  const [recordingAction, setRecordingAction] = useState<string | null>(null);

  // Friendly names for actions
  const ACTION_LABELS: Record<string, string> = {
    toggle_mute: "Toggle Mute",
    toggle_deafen: "Toggle Deafen",
    prev_channel: "Previous Channel",
    next_channel: "Next Channel",
    close_modal: "Close Modal/Settings",
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!recordingAction) return;

    if (e.key === "Escape") {
      setRecordingAction(null);
      return;
    }

    const modifiers = [];
    if (e.ctrlKey) modifiers.push("Ctrl");
    if (e.altKey) modifiers.push("Alt");
    if (e.shiftKey) modifiers.push("Shift");
    if (e.metaKey) modifiers.push("Meta");

    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    // Don't register just modifiers
    if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;

    const combo = [...modifiers, key].join("+");
    setShortcut(recordingAction, combo);
    setRecordingAction(null);
  };

  useEffect(() => {
    if (recordingAction) {
      window.addEventListener("keydown", handleKeyDown, true);
      return () => window.removeEventListener("keydown", handleKeyDown, true);
    }
  }, [recordingAction]);

  return (
    <div className="space-y-3">
      {Object.entries(shortcuts).map(([action, combo]) => (
        <div
          key={action}
          className="flex items-center justify-between p-3 rounded-xl bg-bg-surface border border-border/50"
        >
          <span className="text-sm font-medium text-text-primary">
            {ACTION_LABELS[action] || action}
          </span>
          <button
            onClick={() => setRecordingAction(action)}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold min-w-[80px] transition-all border ${
              recordingAction === action
                ? "bg-accent/10 border-accent text-accent animate-pulse"
                : "bg-bg-input border-border/50 text-text-secondary hover:border-accent/50 hover:text-accent"
            }`}
          >
            {recordingAction === action ? "Press keys..." : combo}
          </button>
        </div>
      ))}
      <div className="pt-2 flex justify-end">
        <button
          onClick={resetShortcuts}
          className="text-xs text-text-muted hover:text-danger hover:underline transition-all"
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}

// ─── Friendly key labels ───
const KEY_LABELS: Record<string, string> = {
  ControlLeft: "Left Ctrl",
  ControlRight: "Right Ctrl",
  ShiftLeft: "Left Shift",
  ShiftRight: "Right Shift",
  AltLeft: "Left Alt",
  AltRight: "Right Alt",
  MetaLeft: "Left Win",
  MetaRight: "Right Win",
  Space: "Space",
  CapsLock: "Caps Lock",
  Tab: "Tab",
  Backquote: "`",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  // Mouse buttons
  Mouse0: "Left Click",
  Mouse1: "Middle Click",
  Mouse2: "Right Click",
  Mouse3: "Mouse Button 4",
  Mouse4: "Mouse Button 5",
};

function getKeyLabel(code: string): string {
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  // KeyA -> A, Digit1 -> 1, F1 -> F1, etc.
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "Num " + code.slice(6);
  if (code.startsWith("Arrow"))
    return (
      "↑↓←→".charAt(["Up", "Down", "Left", "Right"].indexOf(code.slice(5))) ||
      code
    );
  if (code.startsWith("Mouse")) return KEY_LABELS[code] || code;
  return code;
}

function PttKeyBinder({
  currentKey,
  onChange,
}: {
  currentKey: string;
  onChange: (key: string) => void;
}) {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;

    const keyHandler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onChange(e.code);
      setListening(false);
    };

    const mouseHandler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onChange(`Mouse${e.button}`);
      setListening(false);
    };

    window.addEventListener("keydown", keyHandler, true);
    window.addEventListener("mousedown", mouseHandler, true);
    return () => {
      window.removeEventListener("keydown", keyHandler, true);
      window.removeEventListener("mousedown", mouseHandler, true);
    };
  }, [listening, onChange]);

  // Cancel on click outside / Escape
  useEffect(() => {
    if (!listening) return;
    const timeout = setTimeout(() => {
      // Auto-cancel after 5 seconds
      setListening(false);
    }, 5000);
    return () => clearTimeout(timeout);
  }, [listening]);

  return (
    <div>
      <label className="text-xs text-text-secondary mb-1.5 block">
        PTT Shortcut
      </label>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setListening(true)}
          className={`px-4 py-2 rounded-lg text-xs font-mono min-w-[100px] text-center transition-all cursor-pointer ${
            listening
              ? "bg-accent/10 border-2 border-accent text-accent animate-pulse"
              : "bg-bg-input border border-border text-accent hover:border-accent/50"
          }`}
        >
          {listening
            ? "Press a key or mouse button..."
            : getKeyLabel(currentKey)}
        </button>
        {!listening && (
          <p className="text-[10px] text-text-muted">Click to change</p>
        )}
      </div>
    </div>
  );
}
