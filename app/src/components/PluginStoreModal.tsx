import { useState } from "react";
import { X, Puzzle, Download, Search } from "lucide-react";

export interface StorePlugin {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  icon_url?: string;
  bundle_url: string;
}

// Hardcoded registry for the PoC
const STORE_PLUGINS: StorePlugin[] = [
  {
    id: "sivyspeak-hello-world",
    name: "Terminal Sandbox",
    description: "A simple Wasm sandbox that logs UI commands via postMessage.",
    author: "SivySpeak Core",
    version: "1.0.0",
    bundle_url: "/wasm-plugin-fixture.html", // Our local test fixture
  },
  {
    id: "community-tictactoe",
    name: "P2P Tic-Tac-Toe",
    description: "Classic neon Tic-Tac-Toe synced over P2P! Play with anyone.",
    author: "SivySpeak Demos",
    version: "1.0.0",
    bundle_url: "/tictactoe-plugin.html",
  },
];

interface PluginStoreModalProps {
  onClose: () => void;
  onSelectPlugin: (plugin: StorePlugin) => void;
}

export function PluginStoreModal({
  onClose,
  onSelectPlugin,
}: PluginStoreModalProps) {
  const [search, setSearch] = useState("");

  const filtered = STORE_PLUGINS.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[80vh] flex flex-col bg-bg-secondary border border-border rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border/50 bg-bg-surface">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
              <Puzzle className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary leading-tight">
                Plugin Store
              </h2>
              <p className="text-xs text-text-muted">
                Discover community-built Wasm games and tools
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-hover rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-border/50 bg-bg-primary">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search plugins..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-bg-input border border-border rounded-xl font-medium text-sm text-text-primary placeholder:text-text-muted focus:border-purple-500 outline-none transition-colors"
            />
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4 bg-bg-primary">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((plugin) => (
              <div
                key={plugin.id}
                className="group flex flex-col bg-bg-surface border border-border rounded-xl p-4 hover:border-purple-500/50 hover:shadow-[0_0_15px_rgba(168,85,247,0.1)] transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-12 h-12 rounded-lg bg-bg-tertiary flex items-center justify-center">
                    {plugin.icon_url ? (
                      <img
                        src={plugin.icon_url}
                        alt=""
                        className="w-8 h-8 rounded"
                      />
                    ) : (
                      <Puzzle className="w-6 h-6 text-text-muted" />
                    )}
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400 bg-purple-500/10 px-2 py-1 rounded-md">
                    v{plugin.version}
                  </span>
                </div>

                <h3 className="font-bold text-text-primary mb-1">
                  {plugin.name}
                </h3>
                <p className="text-xs text-text-secondary leading-relaxed mb-4 flex-1">
                  {plugin.description}
                </p>

                <div className="flex items-center justify-between mt-auto pt-4 border-t border-border/50">
                  <span className="text-xs text-text-muted font-medium">
                    By {plugin.author}
                  </span>
                  <button
                    onClick={() => onSelectPlugin(plugin)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500 hover:bg-purple-600 active:scale-95 text-white text-xs font-bold rounded-lg transition-all cursor-pointer shadow-lg shadow-purple-500/20"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Install
                  </button>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-1 md:col-span-2 py-10 text-center text-text-muted">
                No plugins found matching your search.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
