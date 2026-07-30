import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
const bindingNames = [
  "CANONICAL_HOURS_URL",
  "WORK_BOARD_FIXTURE",
  "WORK_BOARD_REFRESH_MODE",
];
const args = [
  wrangler,
  "dev",
  "--local",
  "--ip",
  "0.0.0.0",
  "--port",
  "8791",
];

for (const name of bindingNames) {
  if (process.env[name] !== undefined) {
    args.push("--var", `${name}:${process.env[name]}`);
  }
}

const child = spawn(process.execPath, args, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
