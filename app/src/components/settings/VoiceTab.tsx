import { useState, useEffect } from "react";
import { useStore } from "../../store";

export function VoiceTab() {
    const voiceSettings = useStore((s) => s.voiceSettings);
    const updateVoiceSettings = useStore((s) => s.updateVoiceSettings);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div>
                <h2 className="text-2xl font-bold mb-1">Voice & Video</h2>
                <p className="text-text-secondary text-sm">Configure your input mode and sound preferences.</p>
            </div>

            {/* Input Mode */}
            <section>
                <h4 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-4 border-b border-border/20 pb-2">
                    Input Mode
                </h4>
                <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <button
                            onClick={() => updateVoiceSettings({ mode: "activity" })}
                            className={`flex flex-col items-center justify-center py-6 px-4 rounded-xl border-2 transition-all cursor-pointer ${voiceSettings.mode === "activity"
                                ? "bg-accent/10 border-accent text-accent shadow-md shadow-accent/5"
                                : "bg-bg-secondary/30 border-transparent hover:bg-bg-secondary text-text-secondary hover:text-text-primary"
                                }`}
                        >
                            <div className="font-bold mb-1">Voice Activity</div>
                            <div className="text-[10px] opacity-70">Microphone is always open</div>
                        </button>

                        <button
                            onClick={() => updateVoiceSettings({ mode: "ptt" })}
                            className={`flex flex-col items-center justify-center py-6 px-4 rounded-xl border-2 transition-all cursor-pointer ${voiceSettings.mode === "ptt"
                                ? "bg-accent/10 border-accent text-accent shadow-md shadow-accent/5"
                                : "bg-bg-secondary/30 border-transparent hover:bg-bg-secondary text-text-secondary hover:text-text-primary"
                                }`}
                        >
                            <div className="font-bold mb-1">Push to Talk</div>
                            <div className="text-[10px] opacity-70">Press a key to speak</div>
                        </button>
                    </div>

                    {voiceSettings.mode === "ptt" && (
                        <div className="bg-bg-secondary/30 p-4 rounded-xl border border-border/50">
                            <PttKeyBinder
                                currentKey={voiceSettings.pttKey}
                                onChange={(key) => updateVoiceSettings({ pttKey: key })}
                            />
                        </div>
                    )}
                </div>
            </section>

            {/* Sound Settings */}
            <section>
                <h4 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-4 border-b border-border/20 pb-2">
                    Sound Effects
                </h4>
                <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 rounded-lg hover:bg-bg-secondary/30 transition-colors">
                        <div>
                            <div className="text-sm font-medium">Join/Leave Sounds</div>
                            <div className="text-xs text-text-muted">Play a sound when users join or leave the channel</div>
                        </div>
                        {/* Toggle generic placeholder (no real backend setting for this explicit toggle yet, assuming implied by URLs) */}
                    </div>
                    <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-200/80">
                        Advanced sound configuration is coming soon.
                    </div>
                </div>
            </section>
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

    useEffect(() => {
        if (!listening) return;
        const timeout = setTimeout(() => {
            setListening(false);
        }, 5000);
        return () => clearTimeout(timeout);
    }, [listening]);

    return (
        <div className="flex items-center justify-between">
            <div>
                <div className="text-sm font-medium text-text-primary">ShortCut</div>
                <div className="text-xs text-text-muted">Key used to activate microphone</div>
            </div>

            <div className="flex items-center gap-3">
                <button
                    onClick={() => setListening(true)}
                    className={`px-4 py-2 rounded-lg text-sm font-mono min-w-[140px] text-center transition-all cursor-pointer border ${listening
                        ? "bg-accent/10 border-accent text-accent animate-pulse shadow-[0_0_15px_rgba(59,130,246,0.5)]"
                        : "bg-bg-input border-border text-text-primary hover:border-text-muted"
                        }`}
                >
                    {listening
                        ? "Press any key..."
                        : getKeyLabel(currentKey)}
                </button>
            </div>
        </div>
    );
}
