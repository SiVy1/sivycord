import { useState } from "react";

interface P2PInviteModalProps {
  ticket: string;
  serverName: string;
  onClose: () => void;
}

export function P2PInviteModal({ ticket, serverName, onClose }: P2PInviteModalProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(ticket);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl mx-4 bg-bg-secondary border border-border/50 rounded-3xl p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-4 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-accent/20 flex items-center justify-center shrink-0">
            <svg
              className="w-6 h-6 text-accent"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-text-primary mb-1 tracking-tight">
              P2P Server Created!
            </h2>
            <p className="text-sm text-text-secondary">
              Share this invite ticket with others to let them join <span className="text-accent font-semibold">{serverName}</span>
            </p>
          </div>
        </div>

        {/* Ticket Display */}
        <div className="mb-6">
          <label className="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2">
            Invite Ticket
          </label>
          <div className="relative">
            <div className="w-full p-4 bg-bg-input border border-border/50 rounded-xl font-mono text-xs text-text-primary break-all max-h-48 overflow-y-auto">
              {ticket}
            </div>
            <button
              onClick={copyToClipboard}
              className={`absolute top-2 right-2 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                copied
                  ? "bg-success text-white"
                  : "bg-accent text-white hover:bg-accent/90"
              }`}
            >
              {copied ? (
                <span className="flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                  Copied!
                </span>
              ) : (
                "Copy"
              )}
            </button>
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-accent/5 border border-accent/20 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <svg
              className="w-5 h-5 text-accent shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
              />
            </svg>
            <div className="text-xs text-text-secondary space-y-1">
              <p className="font-semibold text-text-primary">How P2P works:</p>
              <ul className="list-disc list-inside space-y-0.5 ml-1">
                <li>No port forwarding required - automatic NAT traversal</li>
                <li>Direct connections when possible, relay fallback</li>
                <li>This ticket can be used multiple times</li>
                <li>Data is synchronized via CRDT (offline-first)</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={copyToClipboard}
            className="flex-1 py-3 bg-accent text-white rounded-xl font-bold hover:bg-accent/90 transition-all flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5A3.375 3.375 0 0 0 6.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0 0 15 2.25h-1.5a2.251 2.251 0 0 0-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 0 0-9-9Z"
              />
            </svg>
            Copy Ticket
          </button>
          <button
            onClick={onClose}
            className="px-6 py-3 bg-bg-surface text-text-primary rounded-xl font-bold hover:bg-bg-hover transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
