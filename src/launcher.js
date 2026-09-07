import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const relaunchCode = 75;
const delayMs = Number(process.env.MACHINE_BASE_RELAUNCH_DELAY_MS || 1000);
let generation = 0;
let currentChild;

function run() {
  generation += 1;
  const child = currentChild = spawn(process.execPath, [fileURLToPath(new URL("./server.js", import.meta.url))], { stdio: "inherit", env: { ...process.env, MACHINE_BASE_LAUNCH_GENERATION: String(generation) }, windowsHide: true });
  child.on("exit", (code, signal) => {
    if (code === relaunchCode) return setTimeout(run, delayMs);
    process.exitCode = typeof code === "number" ? code : 1;
    if (signal) process.exitCode = 1;
  });
  return child;
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => currentChild?.kill(signal));
run();
