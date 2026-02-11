import { ServerSidebar } from "./ServerSidebar";
import { ChannelSidebar } from "./ChannelSidebar";
import { ChatArea } from "./ChatArea";
import { useStore } from "../store";

export function MainLayout() {
  const activeServerId = useStore((s) => s.activeServerId);

  return (
    <div className="h-full flex">
      {/* Server icons sidebar */}
      <ServerSidebar />

      {/* Channel list + chat area */}
      {activeServerId ? (
        <>
          <ChannelSidebar />
          <ChatArea />
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-bg-primary">
          <div className="text-center px-8">
            <div className="w-20 h-20 rounded-full bg-bg-surface flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-10 h-10 text-text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7m0 0a3 3 0 0 1-3 3m0 3h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Zm-3 6h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Z"
                />
              </svg>
            </div>
            <h2 className="text-lg font-medium text-text-secondary mb-1">
              No server selected
            </h2>
            <p className="text-sm text-text-muted">
              Select a server from the sidebar or add a new one
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
