import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createConnection } from "node:net";

const root = process.cwd();
const exePath = join(root, "src-tauri", "target", "debug", "app.exe");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until tcp port is accepting connections */
function waitForPort(port, host = "127.0.0.1", timeoutMs = 180_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Port ${port} not available after ${timeoutMs / 1000}s`));
      }
      const sock = createConnection({ port, host }, () => {
        sock.destroy();
        resolve();
      });
      sock.on("error", () => {
        setTimeout(tryConnect, 500);
      });
    };
    tryConnect();
  });
}

async function main() {
  console.log("Starting first Tauri instance (tauri dev)...");

  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const firstInstance = spawn(`${npmCmd} run tauri dev`, {
    cwd: root,
    shell: true,
    stdio: "inherit",
    env: process.env,
  });

  // Wait for Vite dev server to be ready on port 5173
  console.log("Waiting for Vite dev server on port 5173...");
  await waitForPort(5173);
  console.log("Vite dev server is up.");

  // Wait for the compiled exe to appear (first build may take a while)
  console.log(`Waiting for compiled executable: ${exePath}`);
  const maxWaitSeconds = 180;
  let found = false;
  for (let i = 0; i < maxWaitSeconds; i += 1) {
    if (existsSync(exePath)) {
      found = true;
      break;
    }
    await sleep(1000);
  }
  if (!found) {
    throw new Error(`Executable not found after ${maxWaitSeconds}s: ${exePath}`);
  }

  // Give the first instance a moment to fully start and lock its WebView2 data
  await sleep(5000);

  // Separate WebView2 user data folder so the second instance doesn't conflict
  const wv2DataDir = join(root, "src-tauri", "target", "debug", "webview2-inst2");
  mkdirSync(wv2DataDir, { recursive: true });

  // Create a small .bat launcher so the second instance runs fully detached
  const batPath = join(root, "src-tauri", "target", "debug", "_launch_inst2.bat");
  writeFileSync(
    batPath,
    `@echo off\r\nset SIVY_PROFILE=inst2\r\nset WEBVIEW2_USER_DATA_FOLDER=${wv2DataDir}\r\nstart "" "${exePath}"\r\n`,
  );

  console.log("Starting second instance with SIVY_PROFILE=inst2...");
  execSync(`"${batPath}"`, { cwd: root, stdio: "ignore" });

  console.log("Done. Two instances should now be running (default + inst2).");
  console.log("Press Ctrl+C to stop the first instance.");

  // Keep this process alive so the first tauri dev stays running
  await new Promise((resolve) => {
    firstInstance.on("exit", resolve);
  });
}


main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
