import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cloister = resolve(root, process.env.CLOISTER_REPO ?? "../../../art/cloister");
const { parseTomlToCluster } = await import(
  pathToFileURL(join(cloister, "scripts/toml-to-cluster.mjs"))
);
const { emitCompose } = await import(
  pathToFileURL(join(cloister, "scripts/emit-compose.mjs"))
);

const candidates = [
  ["docker", "compose"],
  ["podman", "compose"],
  ["nerdctl", "compose"],
];
const compose = candidates.find(([command, ...args]) =>
  spawnSync(command, [...args, "version"], { stdio: "ignore" }).status === 0
);
if (!compose) throw new Error("no compose-capable runtime found");

const [engine, ...composePrefix] = compose;
const temp = mkdtempSync(join(tmpdir(), "work-board-cloister-"));
const composeFile = join(temp, "compose.yaml");
const project = `work-board-${process.pid}`;
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });

const cluster = await parseTomlToCluster(
  readFileSync(join(root, "cloister/cluster.toml"), "utf8")
);
writeFileSync(composeFile, emitCompose(cluster));

try {
  run(engine, ["build", "-t", "work-board:smoke", "-f", "Dockerfile", "."]);
  run(engine, [
    "build",
    "-t",
    "canonical-hours-fixture:work-board-smoke",
    "-f",
    "cloister/fixture.Dockerfile",
    ".",
  ]);
  run(engine, [...composePrefix, "-p", project, "-f", composeFile, "up", "-d"]);

  const deadline = Date.now() + 30_000;
  let health;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:8791/health");
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {}
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 250));
  }
  if (health?.source !== "http") {
    throw new Error(`container environment did not reach Worker bindings: ${JSON.stringify(health)}`);
  }

  const beforeResponse = await fetch("http://127.0.0.1:8791/api/board");
  if (!beforeResponse.ok) throw new Error(`board read failed: ${beforeResponse.status}`);
  const before = await beforeResponse.json();
  if (!before.items.some((item) => item.artifactUri === "pr:acme/demo#1")) {
    throw new Error("fixture item missing from normalized board");
  }

  const refreshResponse = await fetch("http://127.0.0.1:8791/api/refresh", { method: "POST" });
  if (!refreshResponse.ok) throw new Error(`refresh failed: ${refreshResponse.status}`);
  const refreshed = await refreshResponse.json();
  if (refreshed.generatedAt !== "2026-07-30T12:01:00Z") {
    throw new Error(`refresh timestamp did not change: ${refreshed.generatedAt}`);
  }

  const ui = await fetch("http://127.0.0.1:8791/board/ui");
  if (!ui.ok || !(await ui.text()).includes("work-board")) {
    throw new Error("board UI asset was not served");
  }
  console.log("cloister smoke ok: http bindings, normalized read, refresh, UI");
} finally {
  spawnSync(
    engine,
    [
      ...composePrefix,
      "-p",
      project,
      "-f",
      composeFile,
      "down",
      "--volumes",
      "--remove-orphans",
    ],
    { cwd: root, stdio: "inherit" }
  );
  rmSync(temp, { recursive: true, force: true });
}
