import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Forward frontend console.log/warn/error to Tauri terminal logs
import { attachConsole } from "@tauri-apps/plugin-log";
attachConsole();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
