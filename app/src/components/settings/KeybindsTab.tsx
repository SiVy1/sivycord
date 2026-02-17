import { useState, useEffect } from "react";
import { useStore } from "../../store";
import { RotateCcw } from "lucide-react";

export function KeybindsTab() {
    const shortcuts = useStore((s) => s.shortcuts);
    const setShortcut = useStore((s) => s.setShortcut);
    const resetShortcuts = useStore((s) => s.resetShortcuts);
    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center justify-between border-b border-border/20 pb-4">
                <div>
                    <h2 className="text-2xl font-bold mb-1">Keybinds</h2>
                    <p className="text-text-secondary text-sm">Customize keyboard shortcuts for quick actions.</p>
                </div>
                <button
                    onClick={resetShortcuts}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-text-muted hover:text-danger border border-transparent hover:border-danger/20 hover:bg-danger/5 rounded-lg transition-all"
                >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset Defaults
                </button>
            </div>

            <div className="space-y-3">
                <KeybindRow action="toggle_mute" label="Toggle Mute" currentCombo={shortcuts.toggle_mute} onChange={setShortcut} />
                <KeybindRow action="toggle_deafen" label="Toggle Deafen" currentCombo={shortcuts.toggle_deafen} onChange={setShortcut} />
                <KeybindRow action="command_palette" label="Command Palette" currentCombo={shortcuts.command_palette} onChange={setShortcut} />
                <KeybindRow action="prev_channel" label="Previous Channel" currentCombo={shortcuts.prev_channel} onChange={setShortcut} />
                <KeybindRow action="next_channel" label="Next Channel" currentCombo={shortcuts.next_channel} onChange={setShortcut} />
                <KeybindRow action="close_modal" label="Close Modal" currentCombo={shortcuts.close_modal} onChange={setShortcut} />
            </div>
        </div>
    );
}


function KeybindRow({ action, label, currentCombo, onChange }: {
    action: string,
    label: string,
    currentCombo: string,
    onChange: (action: string, combo: string) => void
}) {
    const [recording, setRecording] = useState(false);

    useEffect(() => {
        if (!recording) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();

            if (e.key === "Escape") {
                setRecording(false);
                return;
            }

            // Don't register just modifiers
            if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;

            const modifiers = [];
            if (e.ctrlKey) modifiers.push("Ctrl");
            if (e.altKey) modifiers.push("Alt");
            if (e.shiftKey) modifiers.push("Shift");
            if (e.metaKey) modifiers.push("Meta");

            const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
            const combo = [...modifiers, key].join("+");
            onChange(action, combo);
            setRecording(false);
        };

        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [recording, action, onChange]);

    return (
        <div className="flex items-center justify-between p-4 bg-bg-secondary/30 border border-border/50 rounded-xl hover:bg-bg-secondary/50 transition-colors">
            <span className="font-medium text-sm text-text-primary">{label}</span>
            <button
                onClick={() => setRecording(true)}
                className={`min-w-[120px] px-3 py-1.5 rounded-lg text-xs font-mono font-bold border transition-all ${recording
                    ? "bg-accent/10 border-accent text-accent animate-pulse"
                    : "bg-bg-input border-border/50 text-text-secondary hover:border-accent/50 hover:text-accent"
                    }`}
            >
                {recording ? "Record Key..." : currentCombo || "None"}
            </button>
        </div>
    );
}
