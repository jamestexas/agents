import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type RequestListener } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((remove) => remove()));
});

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  cleanup.push(() => new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  }));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

async function runScript(
  script: string,
  env: Record<string, string>,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [resolve(script)], {
    cwd: resolve("."),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const status = await new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  return { status, stdout, stderr };
}

function boardHandler(source: "fixture" | "http", tickStatus: "example" | "ok"): RequestListener {
  return (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/health") {
      response.end(JSON.stringify({ ok: true, source }));
      return;
    }
    if (request.method === "GET" && request.url === "/api/board") {
      response.end(JSON.stringify({ items: [], tickStatus: "ok" }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/refresh") {
      response.end(JSON.stringify({
        items: [],
        tickStatus,
        generatedAt: "2026-07-30T12:01:00Z",
      }));
      return;
    }
    response.writeHead(404).end();
  };
}

describe("live-source smoke", () => {
  it("rejects a healthy work-board that is actually using fixture mode", async () => {
    const boardUrl = await listen(boardHandler("fixture", "example"));
    const result = await runScript("scripts/live-source-smoke.mjs", {
      CANONICAL_HOURS_URL: "https://configured-source-must-not-be-logged.invalid",
      WORK_BOARD_URL: boardUrl,
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain(
      "configured-source-must-not-be-logged.invalid",
    );
  });

  it("rejects an example board even when health claims an HTTP source", async () => {
    const boardUrl = await listen(boardHandler("http", "example"));
    const result = await runScript("scripts/live-source-smoke.mjs", {
      CANONICAL_HOURS_URL: "https://configured-source-must-not-be-logged.invalid",
      WORK_BOARD_URL: boardUrl,
    });

    expect(result.status).not.toBe(0);
  });
});

describe("Cloister smoke cleanup", () => {
  it("reports cleanup failure without replacing the primary smoke failure", async () => {
    const fakeBin = await mkdtemp(join(tmpdir(), "work-board-fake-compose-"));
    cleanup.push(() => rm(fakeBin, { recursive: true, force: true }));
    const docker = join(fakeBin, "docker");
    await writeFile(docker, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "compose" && args[1] === "version") process.exit(0);
if (args.includes("down")) {
  console.error("CLEANUP_FAILURE_MARKER");
  process.exit(19);
}
if (args[0] === "build") {
  console.error("PRIMARY_FAILURE_MARKER");
  process.exit(17);
}
process.exit(23);
`);
    await chmod(docker, 0o755);

    const result = await runScript("scripts/cloister-smoke.mjs", {
      CLOISTER_REPO: process.env.CLOISTER_REPO ?? resolve("../../../art/cloister"),
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("PRIMARY_FAILURE_MARKER");
    expect(result.stderr).toContain("CLEANUP_FAILURE_MARKER");
    expect(result.stderr).toContain("AggregateError");
    expect(result.stderr).toContain("compose cleanup failed with status 19");
  });
});
