import { useStore } from "./store";
import { SetupScreen } from "./components/SetupScreen";
import { MainLayout } from "./components/MainLayout";

function App() {
  const displayName = useStore((s) => s.displayName);

  if (!displayName) {
    return <SetupScreen />;
  }

  return <MainLayout />;
}

export default App;
