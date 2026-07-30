import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function runScript(
  script: string,
  env: Record<string, string>,
): Promise<{ status: number | null; stderr: string }> {
  const child = spawn(process.execPath, [resolve(script)], {
    cwd: resolve("."),
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const status = await new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  return { status, stderr };
}

describe("Cloister smoke cleanup", () => {
  it("reports cleanup failure without replacing the primary smoke failure", async () => {
    const cloisterRepo = process.env.CLOISTER_REPO;
    if (!cloisterRepo) throw new Error("CLOISTER_REPO is required for Cloister contract tests");
    const fakeBin = resolve("test/fixtures/fake-compose-bin");

    const result = await runScript("scripts/cloister-smoke.mjs", {
      CLOISTER_REPO: cloisterRepo,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("PRIMARY_FAILURE_MARKER");
    expect(result.stderr).toContain("CLEANUP_FAILURE_MARKER");
    expect(result.stderr).toContain("AggregateError");
    expect(result.stderr).toContain("compose cleanup failed with status 19");
  });
});
