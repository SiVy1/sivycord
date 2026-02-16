import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { getApiUrl, type MemberInfo } from "../../types";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function UserProfileModal() {
  const { userId, isOpen } = useStore((s) => s.userProfileModal);
  const closeUserProfile = useStore((s) => s.closeUserProfile);
  const activeServerId = useStore((s) => s.activeServerId);
  const servers = useStore((s) => s.servers);

  // Extended type to include username which MemberInfo might lack
  const [userProfile, setUserProfile] = useState<
    (MemberInfo & { username?: string; bio?: string }) | null
  >(null);

  const activeServer = servers.find((s) => s.id === activeServerId);

  useEffect(() => {
    if (!isOpen || !userId) {
      setUserProfile(null);
      return;
    }

    const fetchUser = async () => {
      if (
        !activeServer ||
        activeServer.type === "p2p" ||
        !activeServer.config.host
      ) {
        // Mock data for P2P or offline for now
        setUserProfile({
          user_id: userId,
          username: "unknown",
          display_name: "User " + userId.substr(0, 4),
          avatar_url: null,
          is_online: false,
          is_bot: false,
          joined_at: new Date().toISOString(),
          roles: [],
          bio: "No bio available.",
        });
        return;
      }

      try {
        const guildId = activeServer.config.guildId || "default";

        // Fetch ALL members effectively because we lack a single-user endpoint that works reliably
        const res = await fetch(
          `${getApiUrl(activeServer.config.host, activeServer.config.port!)}/api/servers/${encodeURIComponent(guildId)}/members`,
          {
            headers: {
              Authorization: `Bearer ${activeServer.config.authToken}`,
              "X-Server-Id": guildId,
            },
          },
        );

        if (res.ok) {
          const members: MemberInfo[] = await res.json();
          const foundMember = members.find((m) => m.user_id === userId);

          if (foundMember) {
            // MemberInfo doesn't explicitly have username in our types (it uses user_id as identifier?)
            // But the actual API likely returns it. Let's cast or use display_name fallback.
            const memberWithUser = foundMember as MemberInfo & {
              username?: string;
            };
            setUserProfile({
              ...foundMember,
              username:
                memberWithUser.username ||
                foundMember.display_name.toLowerCase().replace(/\s+/g, "."),
              bio: "No bio available.",
            });
          } else {
            // Member not in list? Fallback to basic fetch just in case user exists but not in member list (unlikely)
            // or just fallback to basic info
            throw new Error("User not found in member list");
          }
        } else {
          throw new Error("Failed to fetch member list");
        }
      } catch (e) {
        console.error("Failed to fetch user profile", e);
        // Fallback to basic display
        setUserProfile({
          user_id: userId,
          username: "user",
          display_name: "User",
          avatar_url: null,
          is_online: false,
          is_bot: false,
          joined_at: new Date().toISOString(),
          roles: [],
          bio: "No bio available.",
        });
      }
    };

    fetchUser();

    // Add close on escape
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeUserProfile();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, userId, activeServer]);

  if (!isOpen) return null;

  // Find highest role
  const topRole =
    userProfile?.roles && userProfile.roles.length > 0
      ? userProfile.roles.reduce((a, b) => (b.position > a.position ? b : a))
      : null;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={closeUserProfile}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="w-[400px] bg-[#09090b] border border-border/20 rounded-2xl shadow-2xl overflow-hidden relative"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Banner / Header Area (could be an image, using role color or gradient for now) */}
          <div
            className="h-24 relative transition-colors duration-300"
            style={{
              background: topRole?.color
                ? `linear-gradient(to right, ${topRole.color}20, ${topRole.color}40, var(--bg-tertiary))`
                : "linear-gradient(to right, var(--bg-tertiary), var(--bg-secondary))",
            }}
          >
            <div
              className="absolute inset-0 opacity-30"
              style={{ backgroundColor: topRole?.color || "transparent" }}
            />
            <button
              onClick={closeUserProfile}
              className="absolute top-2 right-2 p-2 bg-black/20 hover:bg-black/40 text-white/70 hover:text-white rounded-full transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Avatar & Basic Info */}
          <div className="px-6 pb-6 -mt-10 relative">
            <div className="w-24 h-24 rounded-[24px] bg-[#1a1a1a] p-1.5 shadow-xl relative group">
              {userProfile?.avatar_url ? (
                <img
                  src={
                    activeServer?.type === "legacy"
                      ? `${getApiUrl(activeServer.config.host!, activeServer.config.port!)}${userProfile.avatar_url}`
                      : userProfile.avatar_url
                  }
                  alt={userProfile.display_name}
                  className="w-full h-full rounded-[18px] object-cover bg-bg-tertiary"
                />
              ) : (
                <div className="w-full h-full rounded-[18px] bg-bg-tertiary flex items-center justify-center text-3xl font-bold text-text-muted">
                  {(userProfile?.display_name || "?")[0].toUpperCase()}
                </div>
              )}
              {/* Online Status Indicator */}
              <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-[#09090b] rounded-full flex items-center justify-center">
                <div
                  className={`w-4 h-4 rounded-full border-2 border-[#09090b] ${userProfile?.is_online ? "bg-green-500" : "bg-gray-500"}`}
                ></div>
              </div>
            </div>

            <div className="mt-3">
              <h2 className="text-2xl font-bold text-white tracking-tight leading-tight flex items-center gap-2">
                {userProfile?.display_name || "Loading..."}
                {userProfile?.is_bot && (
                  <span className="text-[10px] bg-accent px-1.5 py-0.5 rounded text-white font-bold uppercase tracking-wider align-middle">
                    BOT
                  </span>
                )}
              </h2>
              <div className="text-text-muted font-medium text-sm">
                @{userProfile?.username || "..."}
              </div>
            </div>

            {/* Divider */}
            <div className="h-px bg-border/20 my-4" />

            {/* Bio Section */}
            <div className="space-y-4">
              {/* Role */}
              {topRole && (
                <div>
                  <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                    Role
                  </h3>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: topRole.color || "#9ca3af" }}
                    ></div>
                    <span
                      className="text-sm font-medium"
                      style={{ color: topRole.color || "var(--text-primary)" }}
                    >
                      {topRole.name}
                    </span>
                  </div>
                </div>
              )}

              {/* Bio (Still placeholder as MemberInfo often doesn't carry bio, would need specific user fetch) */}
              <div>
                <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1.5">
                  Bio
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed italic opacity-50">
                  {userProfile?.bio || "Bio not available."}
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
