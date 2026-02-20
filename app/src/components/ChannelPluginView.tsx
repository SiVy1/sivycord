import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

interface ChannelPluginViewProps {
  channelId: string;
}

export function ChannelPluginView({ channelId }: ChannelPluginViewProps) {
  const channel = useStore((s) => s.channels.find((c) => c.id === channelId));
  const [messagesFromPlugin, setMessagesFromPlugin] = useState<string[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const pluginUrl = channel?.plugin_url || "/wasm-plugin-fixture.html";

  useEffect(() => {
    // Listen for messages coming from the Iframe
    const handleMessage = (event: MessageEvent) => {
      // In a real implementation you would verify origin or channel ID
      if (event.data?.type === "PLUGIN_ACTION") {
        const str = JSON.stringify(event.data);
        setMessagesFromPlugin((prev) =>
          [...prev, `[Channel ${channelId}] ` + str].slice(-5),
        ); // keep last 5
        console.log("Received from Plugin sandbox:", event.data);

        // Acknowledge receipt back to the iframe
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage(
            { type: "SIVYSPEAK_ACK" },
            "*",
          );
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full bg-bg-primary relative overflow-hidden">
      {/* Invisible overlay if we needed to block pointer events during drag, etc */}

      {/* The isolated Plugin / HTML environment */}
      <iframe
        ref={iframeRef}
        src={pluginUrl}
        title={`Plugin Sandbox: ${channel?.name || "Unknown"}`}
        className="flex-1 w-full h-full border-none"
        sandbox="allow-scripts allow-same-origin"
      />

      {/* SivySpeak Debug Overlay overlay */}
      <div className="absolute bottom-4 right-4 bg-bg-secondary/90 border border-accent p-3 rounded-lg w-80 text-xs shadow-xl backdrop-blur-md pointer-events-none">
        <h4 className="font-bold text-accent mb-2 uppercase tracking-wider">
          Host Logs (postMessage)
        </h4>
        {messagesFromPlugin.length === 0 ? (
          <p className="text-text-muted">No messages received yet...</p>
        ) : (
          <ul className="space-y-1">
            {messagesFromPlugin.map((msg, idx) => (
              <li key={idx} className="truncate text-text-secondary font-mono">
                {msg}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
