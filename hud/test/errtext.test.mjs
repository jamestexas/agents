// `errText` must not report a filesystem error as a missing binary.
//
// ENOENT means two unrelated things — a spawn whose binary is absent, and a
// filesystem call whose path is absent — and `errText` used to render every
// ENOENT as "command not found". That is right for a spawn and actively
// misleading for the rest: a read-only bind mount showed up in the container
// log as `command not found: /hud/.generated`, which sends whoever reads it
// looking for a missing executable instead of a writable path.
//
// The whole fix rests on a claim about Node's error shapes: a spawn failure
// carries `syscall: "spawn <binary>"`, a filesystem failure carries the
// syscall that failed. So these tests use errors Node actually threw rather
// than hand-written literals — a fixture object asserting the shape I believe
// Node produces would keep passing after Node stopped producing it, which is
// the one failure that would make the fix silently wrong.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { errText } from "../server.mjs";

/** A genuine fs ENOENT: mkdir, non-recursive, under a parent that is absent. */
function realFsEnoent() {
  const missing = path.join(os.tmpdir(), `hud-errtext-absent-${process.pid}`, "child");
  try {
    fs.mkdirSync(missing);
    throw new Error(`precondition failed: ${missing} was creatable`);
  } catch (err) {
    return err;
  }
}

/** A genuine spawn ENOENT: execFile against a name that is not on PATH. */
function realSpawnEnoent() {
  return new Promise((resolve, reject) => {
    execFile(`hud-errtext-no-such-binary-${process.pid}`, [], (err) => {
      if (err) resolve(err);
      else reject(new Error("precondition failed: the fake binary ran"));
    });
  });
}

test("a filesystem ENOENT is not reported as a missing command", () => {
  const err = realFsEnoent();

  // Guard the premise: if Node ever stops labelling fs errors this way, this
  // assertion fails and says so, rather than the branch quietly misfiring.
  assert.equal(err.code, "ENOENT", "premise broken: expected an ENOENT");
  assert.ok(
    !String(err.syscall).startsWith("spawn"),
    `premise broken: fs error carried syscall '${err.syscall}'`,
  );

  const text = errText(err);
  assert.match(text, /no such file or directory/);
  assert.doesNotMatch(text, /command not found/, "filesystem error still reported as a missing binary");
  assert.match(text, /hud-errtext-absent/, "message names no path, so it is not actionable");
});

test("a spawn ENOENT is still reported as a missing command", async () => {
  const err = await realSpawnEnoent();

  assert.equal(err.code, "ENOENT", "premise broken: expected an ENOENT");
  assert.ok(
    String(err.syscall).startsWith("spawn"),
    `premise broken: spawn error carried syscall '${err.syscall}'`,
  );

  // The branch that was always correct must stay correct — this is the
  // regression the narrower fix could easily have traded away.
  const text = errText(err);
  assert.match(text, /command not found/);
  assert.match(text, /hud-errtext-no-such-binary/, "message names no binary, so it is not actionable");
});

test("non-ENOENT errors and absent errors are unchanged", () => {
  // A read-only filesystem — the condition actually hit in the container — has
  // its own code, so it passes through with Node's own message.
  const erofs = Object.assign(new Error("EROFS: read-only file system, mkdir '/hud/.generated'"), {
    code: "EROFS",
    syscall: "mkdir",
    path: "/hud/.generated",
  });
  assert.match(errText(erofs), /read-only file system/);
  assert.doesNotMatch(errText(erofs), /command not found/);

  assert.equal(errText(new Error("plain failure")), "plain failure");
  assert.equal(errText(null), "unknown error");
  assert.equal(errText(undefined), "unknown error");
});
