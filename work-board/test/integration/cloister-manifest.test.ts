import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Cloister topology", () => {
  it("declares isolated work-board and source bundles with an explicit source URL", async () => {
    const cloisterRepo = process.env.CLOISTER_REPO;
    if (!cloisterRepo) throw new Error("CLOISTER_REPO is required for Cloister contract tests");
    const moduleUrl = pathToFileURL(resolve(cloisterRepo, "scripts/toml-to-cluster.mjs")).href;
    const { parseTomlToCluster } = await import(moduleUrl) as {
      parseTomlToCluster(text: string): Promise<{
        bundles: Array<{
          name: string;
          kind: {
            external?: {
              env: Array<{ name: string; value: string }>;
            };
          };
        }>;
      }>;
    };
    const cluster = await parseTomlToCluster(await readFile("cloister/cluster.toml", "utf8"));
    expect(cluster.bundles.map((bundle) => bundle.name)).toEqual([
      "canonical-hours-fixture",
      "work-board",
    ]);
    const board = cluster.bundles[1]!.kind.external!;
    expect(board.env).toContainEqual({
      name: "CANONICAL_HOURS_URL",
      value: "http://canonical-hours-fixture:8790",
    });
    expect(board.env).toContainEqual({
      name: "WORK_BOARD_REFRESH_MODE",
      value: "source-authorized",
    });
  });
});
