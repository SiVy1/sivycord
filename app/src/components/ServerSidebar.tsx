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
            w-12 h-12 rounded-[16px] flex items-center justify-center
            transition-all duration-200 ease-out cursor-pointer
            bg-bg-tertiary text-text-secondary hover:bg-accent hover:text-white hover:rounded-[12px]
          `}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="w-8 h-px bg-border/50 my-1" />

        {/* Server list */}
        {servers.map((server) => (
          <div
            key={server.id}
            className="relative group flex items-center justify-center w-full"
          >
            {/* Active indicator */}
            <div
              className={`absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200 
               ${activeServerId === server.id ? "h-8 opacity-100" : "h-2 opacity-0 group-hover:opacity-50 group-hover:h-4"}`}
            />

            <button
              onClick={() => setActiveServer(server.id)}
              title={server.config.serverName || server.config.host}
              className={`
                w-12 h-12 rounded-[16px] flex items-center justify-center text-sm font-bold
                transition-all duration-200 ease-out cursor-pointer overflow-hidden
                ${
                  activeServerId === server.id
                    ? "bg-accent text-white rounded-[12px]"
                    : "bg-bg-tertiary text-text-secondary hover:bg-accent hover:text-white hover:rounded-[12px]"
                }
              `}
            >
              {server.initial}
            </button>
          </div>
        ))}

        {/* Divider */}
        {servers.length > 0 && <div className="w-8 h-px bg-border/50 my-1" />}

        {/* Add server button */}
        <button
          onClick={() => setShowModal(true)}
          title="Add a server"
          className="w-12 h-12 rounded-[16px] bg-bg-tertiary text-success hover:bg-success hover:text-white flex items-center justify-center transition-all duration-200 ease-out hover:rounded-[12px] cursor-pointer group"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {showModal && <AddServerModal onClose={() => setShowModal(false)} />}
    </>
  );
}
