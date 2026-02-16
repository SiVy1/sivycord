import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const updateState = async () => {
      try {
        const win = getCurrentWindow();
        setIsMaximized(await win.isMaximized());
      } catch (e) {
        console.error("Failed to get window state", e);
      }
    };

    updateState();

    const unlistenResize = getCurrentWindow().onResized(() => {
      updateState();
    });

    return () => {
      unlistenResize.then((f) => f());
    };
  }, []);

  const handleMinimize = () => getCurrentWindow().minimize();
  const handleMaximize = async () => {
    const win = getCurrentWindow();
    if (await win.isMaximized()) {
      win.unmaximize();
      setIsMaximized(false);
    } else {
      win.maximize();
      setIsMaximized(true);
    }
  };
  const handleClose = () => getCurrentWindow().close();

  return (
    <div className="h-[32px] bg-[#09090b] flex items-center justify-between select-none z-[9999] border-b border-white/5 shrink-0">
      {/* Left: Logo/Title - Drag Region */}
      <div
        data-tauri-drag-region
        className="flex items-center px-3 gap-2 flex-1 h-full"
      >
        <div className="w-4 h-4 rounded bg-cyan-500/20 flex items-center justify-center text-[10px] font-bold text-cyan-500 pointer-events-none">
          S
        </div>
        <span className="text-xs font-semibold text-white/50 pointer-events-none">
          SivySpeak
        </span>
      </div>

      {/* Right: Window Controls - No Drag */}
      <div className="flex items-center h-full">
        <button
          onClick={handleMinimize}
          className="h-full w-12 flex items-center justify-center text-white/50 hover:bg-white/5 hover:text-white transition-colors"
          tabIndex={-1}
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          onClick={handleMaximize}
          className="h-full w-12 flex items-center justify-center text-white/50 hover:bg-white/5 hover:text-white transition-colors"
          tabIndex={-1}
          title={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            <div className="relative w-3.5 h-3.5">
              <Square
                className="w-2.5 h-2.5 absolute bottom-0 left-0 bg-[#09090b] z-10"
                strokeWidth={2.5}
              />
              <Square
                className="w-2.5 h-2.5 absolute top-0 right-0 opacity-70"
                strokeWidth={2.5}
              />
            </div>
          ) : (
            <Square className="w-3.5 h-3.5" />
          )}
        </button>
        <button
          onClick={handleClose}
          className="h-full w-12 flex items-center justify-center text-white/50 hover:bg-red-500 hover:text-white transition-colors"
          tabIndex={-1}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
