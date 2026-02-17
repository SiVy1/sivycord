import { useState, useEffect, useMemo, useRef } from "react";
import { useStore } from "../store";

interface CommandPalleteProps {
    visible: boolean;
    onClose?: () => void;
}

type SearchResult =
    | { type: "channel"; id: string; name: string; channelId: string }
    | { type: "message"; id: string; content: string; channelId: string }
    | { type: "server"; id: string; name: string };

export function CommandPallete({ visible, onClose }: CommandPalleteProps) {
    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const channels = useStore((s) => s.channels);
    const messages = useStore((s) => s.messages);
    const servers = useStore((s) => s.servers);
    const setActiveChannel = useStore((s) => s.setActiveChannel);
    const setActiveServer = useStore((s) => s.setActiveServer);

    const results = useMemo(() => {
        if (!query) return [];
        const q = query.toLowerCase();
        const res: SearchResult[] = [];

        channels.forEach((c) => {
            if (c.name.toLowerCase().includes(q)) {
                res.push({
                    type: "channel",
                    id: `ch-${c.id}`,
                    name: c.name,
                    channelId: c.id,
                });
            }
        });

        messages.forEach((m) => {
            if (m.content.toLowerCase().includes(q)) {
                res.push({
                    type: "message",
                    id: `msg-${m.id}`,
                    content: m.content,
                    channelId: m.channelId,
                });
            }
        });

        servers.forEach((s) => {
            if (s.displayName.toLowerCase().includes(q)) {
                res.push({ type: "server", id: `srv-${s.id}`, name: s.displayName });
            }
        });

        return res.slice(0, 10);
    }, [query, channels, messages, servers]);

    useEffect(() => {
        if (visible && inputRef.current) {
            inputRef.current.focus();
            setQuery("");
            setSelectedIndex(0);
        }
    }, [visible]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if (!visible) return;

            if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (results[selectedIndex]) {
                    handleSelect(results[selectedIndex]);
                }
            } else if (e.key === "Escape") {
                e.preventDefault();
                onClose?.();
            }
        }

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [visible, results, selectedIndex, onClose]);

    const handleSelect = (result: SearchResult) => {
        if (result.type === "channel") {
            setActiveChannel(result.channelId);
        } else if (result.type === "server") {
            setActiveServer(result.id.replace("srv-", ""));
        } else if (result.type === "message") {
            setActiveChannel(result.channelId);
        }
        onClose?.();
    };

    if (!visible) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[20vh] z-50">
            <div
                className="w-full max-w-lg bg-[var(--color-bg-surface)] rounded-lg shadow-2xl border border-[var(--color-border)] flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-3 border-b border-[var(--color-border)]">
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder="Type a command or search..."
                        className="w-full bg-transparent text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none text-lg"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </div>

                <div className="max-h-[300px] overflow-y-auto py-2">
                    {results.length === 0 && query && (
                        <div className="px-4 py-3 text-[var(--color-text-muted)] text-center">
                            No results found.
                        </div>
                    )}

                    {results.length === 0 && !query && (
                        <div className="px-4 py-3 text-[var(--color-text-muted)] text-center text-sm">
                            Start typing to search channels, messages, or servers.
                        </div>
                    )}

                    {results.map((result, index) => (
                        <div
                            key={result.id}
                            className={`px-4 py-2 flex items-center cursor-pointer ${index === selectedIndex
                                ? "bg-[var(--color-accent)] text-white"
                                : "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
                                }`}
                            onClick={() => handleSelect(result)}
                            onMouseEnter={() => setSelectedIndex(index)}
                        >
                            <div className="flex-1 truncate">
                                {result.type === "channel" && <span className="opacity-70 mr-2">#</span>}
                                {result.type === "server" && <span className="opacity-70 mr-2">Server:</span>}
                                {result.type === "message" && <span className="opacity-70 mr-2">Message:</span>}
                                {result.type === "message" ? result.content : result.name}
                            </div>
                            {index === selectedIndex && (
                                <span className="text-xs opacity-80" style={{ userSelect: 'none' }}>Enter</span>
                            )}
                        </div>
                    ))}
                </div>

                <div className="px-3 py-2 bg-[var(--color-bg-secondary)] border-t border-[var(--color-border)] flex justify-between items-center text-xs text-[var(--color-text-muted)]">
                    <div className="flex gap-3">
                        <span><kbd className="font-sans bg-[var(--color-bg-tertiary)] px-1 rounded">↑↓</kbd> Navigate</span>
                        <span><kbd className="font-sans bg-[var(--color-bg-tertiary)] px-1 rounded">↵</kbd> Select</span>
                        <span><kbd className="font-sans bg-[var(--color-bg-tertiary)] px-1 rounded">esc</kbd> Close</span>
                    </div>
                </div>
            </div>

            <div className="absolute inset-0 -z-10" onClick={onClose} />
        </div>
    );
}