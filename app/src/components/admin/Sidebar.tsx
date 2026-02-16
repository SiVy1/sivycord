import {
  Shield,
  UserCog,
  Users,
  Mail,
  ClipboardList,
  Bot,
  Globe,
  LayoutDashboard,
  // Settings, // Unused
  // LogOut,   // Unused
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ServerEntry } from "../../types"; // Fix: type-only import

interface SidebarProps {
  server: ServerEntry;
  activeTab: string;
  onTabChange: (tab: any) => void;
  onClose: () => void;
}

type TabCategory = {
  name: string;
  items: {
    id: string;
    label: string;
    icon: LucideIcon;
    color?: string; // Optional accent color for the icon
    condition?: (server: ServerEntry) => boolean;
  }[];
};

export function AdminSidebar({
  server,
  activeTab,
  onTabChange,
  onClose,
}: SidebarProps) {
  const categories: TabCategory[] = [
    {
      name: "Server Management",
      items: [
        { id: "overview", label: "Overview", icon: LayoutDashboard },
        { id: "roles", label: "Roles", icon: UserCog },
        { id: "emojis", label: "Emoji", icon: Shield, condition: () => false }, // Placeholder
      ],
    },
    {
      name: "User Management",
      items: [
        { id: "users", label: "Members", icon: Users },
        { id: "invites", label: "Invites", icon: Mail },
        { id: "bans", label: "Bans", icon: Shield, condition: () => false }, // Placeholder
      ],
    },
    {
      name: "Advanced",
      items: [
        { id: "audit", label: "Audit Log", icon: ClipboardList },
        {
          id: "bots",
          label: "Bots",
          icon: Bot,
          condition: (s) => s.type === "legacy",
        },
        {
          id: "federation",
          label: "Federation",
          icon: Globe,
          condition: (s) => s.type === "legacy",
        },
      ],
    },
  ];

  return (
    <div className="w-64 bg-bg-secondary flex flex-col border-r border-border/10">
      {/* Header */}
      <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest mb-4 px-2">
        {server.displayName}
      </h2>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-4 space-y-6 custom-scrollbar">
        {categories.map((cat, i) => {
          const items = cat.items.filter((item) =>
            item.condition ? item.condition(server) : true,
          );

          if (items.length === 0) return null;

          return (
            <div key={i}>
              <h3 className="px-2 mb-1.5 text-xs font-bold text-text-muted/60 uppercase hover:text-text-muted transition-colors">
                {cat.name}
              </h3>
              <div className="space-y-0.5">
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => onTabChange(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all group ${
                      activeTab === item.id
                        ? "bg-bg-tertiary text-text-primary shadow-sm"
                        : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                    }`}
                  >
                    <item.icon
                      className={`w-4 h-4 transition-colors ${
                        activeTab === item.id
                          ? "text-text-primary"
                          : "text-text-muted group-hover:text-text-secondary"
                      }`}
                      style={
                        item.color && activeTab === item.id
                          ? { color: item.color }
                          : {}
                      }
                    />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer Actions */}
      <div className="p-4 mt-auto border-t border-border/10">
        <button
          onClick={onClose}
          className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors group"
        >
          <span>Exit Admin</span>
          <div className="border border-text-muted/30 rounded px-1.5 text-[10px] text-text-muted group-hover:border-text-muted/60">
            ESC
          </div>
        </button>
      </div>
    </div>
  );
}
