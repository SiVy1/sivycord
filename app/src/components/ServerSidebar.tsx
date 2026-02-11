import { useState } from "react";
import { useStore } from "../store";
import { AddServerModal } from "./AddServerModal";

export function ServerSidebar() {
  const [showModal, setShowModal] = useState(false);
  const servers = useStore((s) => s.servers);
  const activeServerId = useStore((s) => s.activeServerId);
  const setActiveServer = useStore((s) => s.setActiveServer);

  return (
    <>
      <div className="w-[72px] min-w-[72px] bg-bg-secondary flex flex-col items-center py-3 gap-2 border-r border-border overflow-y-auto">
        {/* Server list */}
        {servers.map((server) => (
          <button
            key={server.id}
            onClick={() => setActiveServer(server.id)}
            title={server.config.serverName || server.config.host}
            className={`
              group relative w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-semibold
              transition-all duration-200 cursor-pointer
              ${
                activeServerId === server.id
                  ? "bg-accent text-white rounded-xl"
                  : "bg-bg-surface text-text-secondary hover:bg-bg-hover hover:text-text-primary hover:rounded-xl"
              }
            `}
          >
            {server.initial}

            {/* Active indicator */}
            {activeServerId === server.id && (
              <div className="absolute left-[-14px] w-1 h-8 bg-accent rounded-r-full" />
            )}
          </button>
        ))}

        {/* Divider */}
        {servers.length > 0 && <div className="w-8 h-px bg-border my-1" />}

        {/* Add server button */}
        <button
          onClick={() => setShowModal(true)}
          title="Add a server"
          className="w-12 h-12 rounded-2xl bg-bg-surface text-success hover:bg-success hover:text-white flex items-center justify-center transition-all duration-200 hover:rounded-xl cursor-pointer"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
        </button>
      </div>

      {showModal && <AddServerModal onClose={() => setShowModal(false)} />}
    </>
  );
}
