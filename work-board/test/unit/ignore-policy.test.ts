import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function isIgnored(path: string): boolean {
  const result = spawnSync("git", ["check-ignore", "--no-index", "--quiet", path], {
    cwd: process.cwd()
  });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git check-ignore failed for ${path}`);
  }
  return result.status === 0;
}

describe("local work-board exclusions", () => {
  it.each([
    "data/board.json",
    ".env",
    ".env.production",
    ".dev.vars",
    ".dev.vars.local"
  ])("keeps personal runtime data out of Git: %s", (path) => {
    expect(isIgnored(path)).toBe(true);
  });

  it.each([
    "data/board.example.json",
    ".env.example",
    ".env.production.example",
    ".dev.vars.example"
  ])("allows an explicit checked-in example: %s", (path) => {
    expect(isIgnored(path)).toBe(false);
  });
});
