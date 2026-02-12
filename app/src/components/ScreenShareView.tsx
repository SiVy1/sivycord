import { useEffect, useRef } from "react";

interface ScreenShareViewProps {
  stream: MediaStream;
  userName: string;
  onClose?: () => void;
}

export function ScreenShareView({
  stream,
  userName,
  onClose,
}: ScreenShareViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative group bg-black rounded-xl overflow-hidden mb-4 border border-border aspect-video flex items-center justify-center">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-contain"
      />
      <div className="absolute top-3 left-3 px-2 py-1 bg-black/50 backdrop-blur-md rounded text-white text-[10px] font-medium flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
        {userName}'s Screen
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 bg-black/50 hover:bg-black/70 backdrop-blur-md rounded-lg text-white transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
