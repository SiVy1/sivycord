import { useState } from "react";
import { useStore } from "../../store";
import { getApiUrl } from "../../types";
import { Camera } from "lucide-react";
import { AuthScreen } from "../AuthScreen";

export function ProfileTab() {
    const currentUser = useStore((s) => s.currentUser);
    const setCurrentUser = useStore((s) => s.setCurrentUser);
    const activeServerId = useStore((s) => s.activeServerId);
    const servers = useStore((s) => s.servers);
    const updateServerAuth = useStore((s) => s.updateServerAuth);
    const logout = useStore((s) => s.logout);

    const activeServer = servers.find((s) => s.id === activeServerId);

    const [editingDisplayName, setEditingDisplayName] = useState(false);
    const [newName, setNewName] = useState(currentUser?.display_name || "");
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [showAuth, setShowAuth] = useState(false);

    const handleUpdateProfile = async () => {
        if (
            !currentUser ||
            !activeServer ||
            activeServer.type !== "legacy" ||
            !activeServer.config.authToken
        )
            return;
        const { host, port } = activeServer.config;
        if (!host || !port) return;
        try {
            const guildId = activeServer.config.guildId || "default";
            const res = await fetch(`${getApiUrl(host, port)}/api/me`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${activeServer.config.authToken}`,
                    "X-Server-Id": guildId,
                },
                body: JSON.stringify({ display_name: newName.trim() }),
            });
            if (res.ok) {
                const updated = await res.json();
                setCurrentUser(updated);
                setEditingDisplayName(false);
            }
        } catch (err) {
            console.error("Failed to update profile", err);
        }
    };

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (
            !file ||
            !activeServer ||
            activeServer.type !== "legacy" ||
            !activeServer.config.authToken
        )
            return;
        const { host, port } = activeServer.config;
        if (!host || !port) return;

        setUploadingAvatar(true);
        const formData = new FormData();
        formData.append("file", file);

        try {
            const guildId = activeServer.config.guildId || "default";
            const res = await fetch(`${getApiUrl(host, port)}/api/me/avatar`, {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${activeServer.config.authToken}`,
                    "X-Server-Id": guildId,
                },
                body: formData,
            });
            if (res.ok) {
                const updated = await res.json();
                setCurrentUser(updated);
            }
        } catch (err) {
            console.error("Avatar upload failed", err);
        } finally {
            setUploadingAvatar(false);
        }
    };

    if (!currentUser) return <div className="p-8">Please log in to edit profile.</div>;

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div>
                <h2 className="text-2xl font-bold mb-1">My Account</h2>
                <p className="text-text-secondary text-sm">Manage your account details and presence.</p>
            </div>

            <div className="bg-bg-secondary/30 rounded-2xl border border-border/50 p-6 flex items-center gap-6 shadow-sm">
                <div className="relative group shrink-0">
                    {activeServer &&
                        activeServer.type === "legacy" &&
                        activeServer.config.host &&
                        activeServer.config.port &&
                        currentUser.avatar_url ? (
                        <img
                            src={`${getApiUrl(activeServer.config.host, activeServer.config.port)}${currentUser.avatar_url}`}
                            className="w-24 h-24 rounded-full object-cover border-4 border-bg-primary shadow-md group-hover:border-accent/50 transition-all"
                            alt={currentUser.display_name}
                        />
                    ) : (
                        <div className="w-24 h-24 rounded-full bg-accent/20 flex items-center justify-center text-3xl font-bold text-accent border border-accent/20">
                            {currentUser.display_name[0].toUpperCase()}
                        </div>
                    )}
                    <label className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-full opacity-0 group-hover:opacity-100 transition-all cursor-pointer backdrop-blur-[2px]">
                        <input
                            type="file"
                            className="hidden"
                            accept="image/*"
                            onChange={handleAvatarUpload}
                            disabled={uploadingAvatar}
                        />
                        <Camera className="w-8 h-8 text-white" />
                    </label>
                </div>

                <div className="flex-1 min-w-0 space-y-4">
                    {/* Display Name Edit */}
                    <div>
                        <label className="text-xs font-bold text-text-muted uppercase tracking-widest mb-1.5 block">Display Name</label>
                        <div className="flex items-center gap-3">
                            {editingDisplayName ? (
                                <div className="flex gap-2 w-full max-w-sm">
                                    <input
                                        type="text"
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        className="flex-1 px-3 py-2 bg-bg-input border border-accent/50 rounded-lg text-sm text-text-primary outline-none ring-2 ring-accent/20"
                                        autoFocus
                                        onKeyDown={(e) =>
                                            e.key === "Enter" && handleUpdateProfile()
                                        }
                                    />
                                    <button
                                        onClick={handleUpdateProfile}
                                        className="px-4 py-2 bg-accent text-white rounded-lg text-xs font-bold hover:bg-accent-hover transition-colors"
                                    >
                                        Save
                                    </button>
                                    <button
                                        onClick={() => setEditingDisplayName(false)}
                                        className="px-3 py-2 text-text-muted hover:text-text-primary text-xs transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between w-full max-w-sm bg-bg-input rounded-lg border border-border/50 px-4 py-2.5">
                                    <span className="font-medium text-text-primary">{currentUser.display_name}</span>
                                    <button
                                        onClick={() => setEditingDisplayName(true)}
                                        className="text-xs font-bold text-accent hover:text-accent-hover px-2 py-1 rounded bg-accent/5 hover:bg-accent/10 transition-all"
                                    >
                                        Edit
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Username Readonly */}
                    <div>
                        <label className="text-xs font-bold text-text-muted uppercase tracking-widest mb-1.5 block">Username</label>
                        <div className="text-sm font-mono text-text-secondary">@{currentUser.username}</div>
                    </div>
                </div>
            </div>

            {/* Auth / Server Connection */}
            <div className="pt-6 border-t border-border/10">
                <h3 className="text-lg font-semibold mb-4">Authentication</h3>
                <div className="bg-bg-secondary/30 rounded-xl p-5 border border-border/50">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="font-medium text-sm">Server Access Token</div>
                            <div className="text-xs text-text-muted mt-1">You are authenticated with the current server.</div>
                        </div>
                        <button
                            onClick={() => setShowAuth(true)}
                            className="px-4 py-2 bg-bg-surface border border-border hover:bg-bg-hover rounded-md text-xs font-medium transition-colors"
                        >
                            Relogin / Switch Account
                        </button>
                    </div>
                </div>
            </div>

            {/* Logout Zone */}
            <div className="pt-6">
                <button
                    onClick={logout}
                    className="px-5 py-2.5 bg-danger/10 hover:bg-danger text-danger hover:text-white border border-danger/20 rounded-lg text-sm font-semibold transition-all"
                >
                    Log Out
                </button>
            </div>

            {/* Auth Modal for Relogin */}
            {showAuth &&
                activeServer &&
                activeServer.type === "legacy" &&
                activeServer.config.host &&
                activeServer.config.port && (
                    <AuthScreen
                        serverHost={activeServer.config.host}
                        serverPort={activeServer.config.port}
                        onAuth={(user, token) => {
                            setCurrentUser(user);
                            updateServerAuth(activeServer.id, token, user.id);
                            setShowAuth(false);
                        }}
                    />
                )}
        </div>
    );
}
