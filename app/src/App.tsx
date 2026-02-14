import { useStore } from "./store";
import { SetupScreen } from "./components/SetupScreen";
import { ServerGrid } from "./components/ServerGrid";
import { MainLayout } from "./components/MainLayout";

function App() {
  const displayName = useStore((s) => s.displayName);
  const activeServerId = useStore((s) => s.activeServerId);

  if (!displayName) {
    return <SetupScreen />;
  }

  if (!activeServerId) {
    return <ServerGrid />;
  }

  return <MainLayout />;
}

export default App;
