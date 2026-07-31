import { spawn } from "node:child_process";
import { createServer, type RequestListener } from "node:http";
import { resolve } from "node:path";
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
      response.end(JSON.stringify({
        items: [],
        tickStatus: "ok",
        generatedAt: "2026-07-30T12:00:00Z",
      }));
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

interface SourceState {
  sourceGeneratedAt: string;
  boardGeneratedAt: string;
  title: string;
  sourceReads: number;
}

function sourceHandler(state: SourceState): RequestListener {
  return (request, response) => {
    if (request.method !== "GET" || request.url !== "/private-source/board") {
      response.writeHead(404).end();
      return;
    }
    state.sourceReads += 1;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      generated_at: state.sourceGeneratedAt,
      tick_status: "ok",
      degradations: [],
      items: [{
        kind: "pr",
        title: state.title,
        state: "active"
      }]
    }));
  };
}

function correlatedBoardHandler(
  state: SourceState,
  mutateSource: boolean
): RequestListener {
  return (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/health") {
      response.end(JSON.stringify({ ok: true, source: "http" }));
      return;
    }
    if (request.method === "GET" && request.url === "/api/board") {
      response.end(JSON.stringify({
        items: [{ title: state.title }],
        tickStatus: "ok",
        generatedAt: state.boardGeneratedAt
      }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/refresh") {
      state.boardGeneratedAt = "2026-07-30T12:01:00Z";
      if (mutateSource) {
        state.sourceGeneratedAt = state.boardGeneratedAt;
        state.title = "after refresh";
      }
      response.end(JSON.stringify({
        items: [{ title: state.title }],
        tickStatus: "ok",
        generatedAt: state.boardGeneratedAt
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
    const state: SourceState = {
      sourceGeneratedAt: "2026-07-30T12:00:00Z",
      boardGeneratedAt: "2026-07-30T12:00:00Z",
      title: "before refresh",
      sourceReads: 0
    };
    const sourceUrl = await listen(sourceHandler(state));
    const boardUrl = await listen(boardHandler("http", "example"));
    const result = await runScript("scripts/live-source-smoke.mjs", {
      CANONICAL_HOURS_URL: `${sourceUrl}/private-source`,
      WORK_BOARD_URL: boardUrl,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("example fixture mode");
    expect(result.stderr).not.toContain("private-source");
  });

  it("rejects a work-board refresh that is not reflected by the declared source", async () => {
    const state: SourceState = {
      sourceGeneratedAt: "2026-07-30T12:00:00Z",
      boardGeneratedAt: "2026-07-30T12:00:00Z",
      title: "before refresh",
      sourceReads: 0
    };
    const sourceUrl = await listen(sourceHandler(state));
    const boardUrl = await listen(correlatedBoardHandler(state, false));

    const result = await runScript("scripts/live-source-smoke.mjs", {
      CANONICAL_HOURS_URL: `${sourceUrl}/private-source`,
      WORK_BOARD_URL: boardUrl,
    });

    expect(result.status).not.toBe(0);
    expect(state.sourceReads).toBe(2);
    expect(`${result.stdout}${result.stderr}`).not.toContain("private-source");
  });

  it("accepts a refresh correlated with a changed declared-source snapshot", async () => {
    const state: SourceState = {
      sourceGeneratedAt: "2026-07-30T12:00:00Z",
      boardGeneratedAt: "2026-07-30T12:00:00Z",
      title: "before refresh",
      sourceReads: 0
    };
    const sourceUrl = await listen(sourceHandler(state));
    const boardUrl = await listen(correlatedBoardHandler(state, true));

    const result = await runScript("scripts/live-source-smoke.mjs", {
      CANONICAL_HOURS_URL: `${sourceUrl}/private-source`,
      WORK_BOARD_URL: boardUrl,
    });

    expect(result.status).toBe(0);
    expect(state.sourceReads).toBe(2);
    expect(result.stdout).toContain("live source ok");
    expect(`${result.stdout}${result.stderr}`).not.toContain("private-source");
  });
});
