import { spawnSync } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("Docker build context", () => {
  it("excludes personal board and secret files while retaining examples", async () => {
    const root = await mkdtemp(join(tmpdir(), "work-board-context-"));
    cleanup.push(root);
    const context = join(root, "context");
    const output = join(root, "output");
    await mkdir(join(context, "data"), { recursive: true });
    await copyFile(".dockerignore", join(context, ".dockerignore"));
    await writeFile(join(context, "Dockerfile"), "FROM scratch\nCOPY . /context\n");
    await Promise.all([
      writeFile(join(context, "data", "board.json"), "personal"),
      writeFile(join(context, "data", "board.example.json"), "example"),
      writeFile(join(context, ".env.production"), "SECRET=personal"),
      writeFile(join(context, ".env.production.example"), "SECRET=example"),
      writeFile(join(context, ".dev.vars.local"), "TOKEN=personal"),
      writeFile(join(context, ".dev.vars.example"), "TOKEN=example")
    ]);

    const build = spawnSync("docker", [
      "build",
      "--output",
      `type=local,dest=${output}`,
      context
    ], { encoding: "utf8" });
    expect(build.status, build.stderr).toBe(0);
    expect(await exists(join(output, "context", "data", "board.json"))).toBe(false);
    expect(await exists(join(output, "context", ".env.production"))).toBe(false);
    expect(await exists(join(output, "context", ".dev.vars.local"))).toBe(false);
    expect(await exists(join(output, "context", "data", "board.example.json"))).toBe(true);
    expect(await exists(join(output, "context", ".env.production.example"))).toBe(true);
    expect(await exists(join(output, "context", ".dev.vars.example"))).toBe(true);
  });
});
