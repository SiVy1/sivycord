import { useState } from "react";
import { AddServerChoice } from "./add-server/AddServerChoice";
import { AddServerLegacy } from "./add-server/AddServerLegacy";
import { AddServerP2PCreate } from "./add-server/AddServerP2PCreate";
import { AddServerP2PJoin } from "./add-server/AddServerP2PJoin";

type Mode = "choice" | "legacy" | "p2p-create" | "p2p-join";

export function AddServerModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("choice");

  switch (mode) {
    case "legacy":
      return (
        <AddServerLegacy onClose={onClose} onBack={() => setMode("choice")} />
      );
    case "p2p-create":
      return (
        <AddServerP2PCreate
          onClose={onClose}
          onBack={() => setMode("choice")}
        />
      );
    case "p2p-join":
      return (
        <AddServerP2PJoin onClose={onClose} onBack={() => setMode("choice")} />
      );
    case "choice":
    default:
      return <AddServerChoice onClose={onClose} setMode={setMode} />;
  }
}
