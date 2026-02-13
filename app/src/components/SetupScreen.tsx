import { useState } from "react";
import { useStore } from "../store";

export function SetupScreen() {
  const [name, setName] = useState("");
  const setDisplayName = useStore((s) => s.setDisplayName);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length >= 2) {
      setDisplayName(trimmed);
    }
  };

  return (
    <div className="h-full flex items-center justify-center bg-bg-primary">
      <div className="w-full max-w-sm px-8 py-10 bg-bg-secondary border border-border rounded-3xl shadow-2xl">
        <div className="text-center mb-10">
          <div className="w-20 h-20 rounded-2xl bg-accent/15 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-accent/5">
            <svg
              className="w-10 h-10 text-accent transition-transform hover:scale-110 duration-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.75}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-text-primary mb-3 tracking-tight">
            SivySpeak
          </h1>
          <p className="text-base text-text-secondary font-medium">
            Welcome! How should we call you?
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider ml-1">
              Display Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name..."
              maxLength={32}
              autoFocus
              className="w-full px-5 py-3.5 bg-bg-input border border-border rounded-xl text-text-primary placeholder:text-text-muted text-sm outline-none focus:border-accent ring-0 focus:ring-2 focus:ring-accent/20 transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={name.trim().length < 2}
            className="w-full py-4 bg-accent hover:bg-accent-hover disabled:bg-bg-surface disabled:text-text-muted disabled:cursor-not-allowed text-white font-semibold text-sm rounded-xl shadow-lg shadow-accent/20 active:scale-[0.98] transition-all cursor-pointer"
          >
            Get Started
          </button>
        </form>
      </div>
    </div>
  );
}
