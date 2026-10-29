// Liveness through the real server: `node server.mjs` against a tmp HUD_ROOT
// whose two open runs name an owner, one a pid that has exited and one this
// test's own. The card answers the first as abandoned and the second as
// running, with nothing stubbed, so the probe serve.mjs passes is the one
// that runs. Helpers follow live-smoke.mjs; nothing here reads a real tree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const SERVER = path.join(import.meta.dirname, "..", "server.mjs");
const CONFIG = `[cards.reviews]
kind    = "fs"
glob    = "projects/*/raw/PR-*/state.json"
shape   = "review-state"
key     = "pr_url"
title   = "Review runs"
scope   = "open"
`;

/** A port nothing holds: bind an ephemeral one, then release it. */
async function freePort() {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** `node server.mjs` against `root`; resolves once it says it is listening. */
async function startServer(t, root, port) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, HUD_ROOT: root, HUD_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  let out = "";
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${err}`)), 3000);
    child.stdout.on("data", (d) => {
      out += d;
      if (out.includes(`http://127.0.0.1:${port}/`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code) => reject(new Error(`server exited ${code}: ${err}`)));
  });
  return `http://127.0.0.1:${port}`;
}

test("a run whose owner pid has exited reads abandoned on the card; a live owner reads running", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hud-liveness-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "hud.toml"), CONFIG);

  // A pid known to be dead: a child that has already exited and been reaped.
  const dead = spawnSync(process.execPath, ["-e", "0"]).pid;
  assert.ok(Number.isInteger(dead) && dead > 0);

  const started = new Date(Date.now() - 60 * 1000).toISOString();
  const write = (n, pid) => {
    const file = path.join(root, `projects/example-one/raw/PR-${n}/state.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      version: 1, repo: "owner/repo", pr: n, mode: "default", phase: "settle", started, ended: null, posted: null,
      phases: { settle: { started, ended: null } },
      owner: { session_id: `sess-${n}`, pid, transcript_path: null },
    }));
  };
  write(1, dead);
  write(2, process.pid);

  const base = await startServer(t, root, await freePort());
  const res = await fetch(base + "/api/card/reviews?scope=all", { cache: "no-store" });
  assert.equal(res.status, 200);
  const body = await res.json();
  const byPr = Object.fromEntries(body.items.map((item) => [item.pr, item]));
  assert.equal(byPr[1].liveness, "abandoned");
  assert.equal(byPr[1].running, false);
  assert.equal(byPr[2].liveness, "running");
  assert.equal(byPr[2].running, true);
  assert.ok(!JSON.stringify(body).includes("sess-1"), "owner never reaches the page");
});
