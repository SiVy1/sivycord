import { useStore } from "./store";
import { SetupScreen } from "./components/SetupScreen";
import { ServerGrid } from "./components/ServerGrid";
import { MainLayout } from "./components/MainLayout";

import { TitleBar } from "./components/TitleBar";

function App() {
  const displayName = useStore((s) => s.displayName);
  const activeServerId = useStore((s) => s.activeServerId);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#09090b] text-text-primary overflow-hidden">
      <TitleBar />
      <div className="flex-1 h-full overflow-hidden">
        {!displayName ? (
          <SetupScreen />
        ) : !activeServerId ? (
          <ServerGrid />
        ) : (
          <MainLayout />
        )}
      </div>
    </div>
  );
}

export default App;
