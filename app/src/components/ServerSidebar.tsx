import { useState } from "react";
import { useStore } from "../store";
import { AddServerModal } from "./AddServerModal";
import { ArrowLeft, Plus } from "lucide-react";

export function ServerSidebar() {
  const [showModal, setShowModal] = useState(false);
  const servers = useStore((s) => s.servers);
  const activeServerId = useStore((s) => s.activeServerId);
  const setActiveServer = useStore((s) => s.setActiveServer);

  return (
    <>
      <div className="w-[72px] min-w-[72px] bg-bg-secondary flex flex-col items-center py-3 gap-2 border-r border-border overflow-y-auto">
        {/* Home button — back to server grid */}
        <button
          onClick={() => setActiveServer(null)}
          title="Back to servers"
          className={`
            w-12 h-12 rounded-[18px] flex items-center justify-center
            transition-all duration-300 ease-out cursor-pointer
            bg-bg-surface text-text-secondary hover:bg-accent hover:text-white hover:rounded-[12px] hover:shadow-lg hover:shadow-accent/20
          `}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="w-8 h-px bg-border my-1" />

        {/* Server list */}
        {servers.map((server) => (
          <button
            key={server.id}
            onClick={() => setActiveServer(server.id)}
            title={server.config.serverName || server.config.host}
            className={`
              group relative w-12 h-12 rounded-[18px] flex items-center justify-center text-sm font-bold
              transition-all duration-300 ease-out cursor-pointer
              ${
                activeServerId === server.id
                  ? "bg-accent text-white rounded-[12px] shadow-lg shadow-accent/20"
                  : "bg-bg-surface text-text-secondary hover:bg-accent hover:text-white hover:rounded-[12px] hover:shadow-lg hover:shadow-accent/20"
              }
            `}
          >
            {server.initial}

            {/* Active indicator */}
            {activeServerId === server.id && (
              <div className="absolute -left-3 w-1.5 h-10 bg-accent rounded-r-full shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
            )}
          </button>
        ))}

        {/* Divider */}
        {servers.length > 0 && <div className="w-8 h-px bg-border my-1" />}

        {/* Add server button */}
        <button
          onClick={() => setShowModal(true)}
          title="Add a server"
          className="w-12 h-12 rounded-[18px] bg-bg-surface text-success hover:bg-success hover:text-white flex items-center justify-center transition-all duration-300 ease-out hover:rounded-[12px] hover:shadow-lg hover:shadow-success/20 cursor-pointer group"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {showModal && <AddServerModal onClose={() => setShowModal(false)} />}
    </>
  );
}
