import { useState } from "react";
import { useStore } from "../store";
import { SettingsSidebar } from "./settings/Sidebar";
import { ProfileTab } from "./settings/ProfileTab";
import { VoiceTab } from "./settings/VoiceTab";
import { KeybindsTab } from "./settings/KeybindsTab";
import { AnimatePresence, motion } from "framer-motion";

interface UserSettingsModalProps {
  onClose: () => void;
}

export function UserSettingsModal({ onClose }: UserSettingsModalProps) {
  const [activeTab, setActiveTab] = useState("profile");
  const currentUser = useStore((s) => s.currentUser);

  if (!currentUser) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-5xl h-[85vh] bg-bg-primary rounded-2xl shadow-2xl flex overflow-hidden border border-border/20"
        onClick={(e) => e.stopPropagation()}
      >
        <SettingsSidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onClose={onClose}
          currentUser={currentUser}
        />

        <div className="flex-1 flex flex-col min-w-0 bg-bg-primary">
          <div className="flex-1 overflow-y-auto w-full p-8 md:p-12 custom-scrollbar">
            <div className="max-w-3xl mx-auto">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.15 }}
                >
                  {activeTab === "profile" && <ProfileTab />}
                  {activeTab === "voice" && <VoiceTab />}
                  {activeTab === "keybinds" && <KeybindsTab />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
      {/* Backdrop click to close */}
      <div className="absolute inset-0 -z-10" onClick={onClose} />
    </div>
  );
}
