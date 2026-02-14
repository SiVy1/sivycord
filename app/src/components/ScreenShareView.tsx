import { useEffect, useRef, useState, memo } from "react";

interface ScreenShareViewProps {
  stream: MediaStream;
  userName: string;
  onClose?: () => void;
}

export const ScreenShareView = memo(function ScreenShareView({
  stream,
  userName,
  onClose,
}: ScreenShareViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const toggleFullscreen = () => {
    if (!videoRef.current) return;
    if (!document.fullscreenElement) {
      videoRef.current.requestFullscreen().catch((err) => {
        console.error(
          `Error attempting to enable full-screen mode: ${err.message}`,
        );
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  // Sync fullscreen state with document events (e.g. Esc key)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  return (
    <div className="relative group bg-black/90 rounded-2xl overflow-hidden border border-white/5 shadow-2xl aspect-video flex items-center justify-center transition-all duration-300 hover:border-accent/30">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-contain"
      />

      {/* Overlay: Top Left (User Info) */}
      <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 bg-black/40 backdrop-blur-md rounded-full border border-white/10 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-[-10px] group-hover:translate-y-0">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-accent shadow-[0_0_8px_rgba(59,130,246,0.6)] animate-pulse" />
          <span className="text-white text-[11px] font-bold tracking-tight">
            LIVE
          </span>
        </div>
        <div className="w-px h-3 bg-white/20" />
        <span className="text-white/90 text-[11px] font-medium">
          {userName}
        </span>
      </div>

      {/* Overlay: Top Right (Actions) */}
      <div className="absolute top-4 right-4 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-[-10px] group-hover:translate-y-0">
        <button
          onClick={toggleFullscreen}
          className="p-2 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-xl text-white/80 hover:text-white border border-white/10 transition-all cursor-pointer overflow-hidden"
          title="Full Screen"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            {isFullscreen ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 9L4 4m0 0h5M4 4v5m11-5l5 5m0 0h-5m5 0V4m-5 11l5 5m0 0h-5m5 0v-5m-11 5l-5-5m0 0h5m-5 0v5"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
              />
            )}
          </svg>
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 bg-danger/20 hover:bg-danger/40 backdrop-blur-md rounded-xl text-danger-light hover:text-white border border-danger/20 transition-all cursor-pointer"
            title="Stop Viewing"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Subtle bottom gradient for depth */}
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/60 to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
    </div>
  );
});
