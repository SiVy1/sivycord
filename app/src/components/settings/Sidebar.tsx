import { User, Mic, Keyboard } from "lucide-react";

interface SidebarProps {
    activeTab: string;
    onTabChange: (tab: string) => void;
    onClose: () => void;
}

export function SettingsSidebar({ activeTab, onTabChange, onClose }: SidebarProps) {
    const tabs = [
        { id: "profile", label: "My Account", icon: User },
        { id: "voice", label: "Voice & Video", icon: Mic },
        { id: "keybinds", label: "Keybinds", icon: Keyboard },
    ];

    return (
        <div className="w-64 bg-bg-secondary flex flex-col border-r border-border/10 shrink-0">
            <div className="p-6 pb-2">
                <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-4 px-2">
                    User Settings
                </h2>
            </div>

            <div className="flex-1 overflow-y-auto px-4 space-y-1">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => onTabChange(tab.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all group ${activeTab === tab.id
                            ? "bg-bg-tertiary text-text-primary shadow-sm"
                            : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                            }`}
                    >
                        <tab.icon
                            className={`w-4 h-4 transition-colors ${activeTab === tab.id
                                ? "text-text-primary"
                                : "text-text-muted group-hover:text-text-secondary"
                                }`}
                        />
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="p-4 mt-auto border-t border-border/10">
                <button
                    onClick={onClose}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors group"
                >
                    <span>Close</span>
                    <div className="border border-text-muted/30 rounded px-1.5 text-[10px] text-text-muted group-hover:border-text-muted/60">
                        ESC
                    </div>
                </button>
            </div>
        </div>
    );
}
