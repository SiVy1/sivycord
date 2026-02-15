import { useRef } from "react";

interface ChatFileUploadProps {
  isAuthenticated: boolean;
  isConnected: boolean;
  uploading: boolean;
  onUploadFile: (file: File) => void;
}

export function ChatFileUpload({
  isAuthenticated,
  isConnected,
  uploading,
  onUploadFile,
}: ChatFileUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isAuthenticated) return null;

  return (
    <>
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading || !isConnected}
        className="p-3 text-text-muted hover:text-accent transition-colors cursor-pointer disabled:opacity-40"
        title="Upload file"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13"
          />
        </svg>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUploadFile(file);
          e.target.value = "";
        }}
      />
    </>
  );
}
