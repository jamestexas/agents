/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleRequest } from "../../src/worker";

describe("work-board Worker", () => {
  it("reports source configuration without triggering work", async () => {
    const response = await SELF.fetch("https://work-board.test/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, source: "fixture" });
  });

  it("serves a normalized board and refreshes it", async () => {
    const before = await SELF.fetch("https://work-board.test/api/board");
    expect(before.status).toBe(200);
    expect((await before.json() as { items: unknown[] }).items.length).toBeGreaterThan(0);

    const refresh = await SELF.fetch("https://work-board.test/api/refresh", { method: "POST" });
    expect(refresh.status).toBe(200);
    expect((await refresh.json() as { generatedAt: string }).generatedAt).toBe("2026-01-01T09:01:00Z");
  });

  it("rejects unsupported methods and routes", async () => {
    const methodNotAllowed = await SELF.fetch("https://work-board.test/api/board", { method: "POST" });
    expect(methodNotAllowed.status).toBe(405);
    expect(methodNotAllowed.headers.get("cache-control")).toBe("no-store");
    expect(await methodNotAllowed.json()).toEqual({ error: "method_not_allowed", message: "method not allowed" });

    const notFound = await SELF.fetch("https://work-board.test/nope");
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get("cache-control")).toBe("no-store");
    expect(await notFound.json()).toEqual({ error: "not_found", message: "route not found" });
  });

  it("denies refresh by default outside explicit fixture/source-authorized modes", async () => {
    const response = await handleRequest(
      new Request("https://work-board.test/api/refresh", { method: "POST" }),
      { ASSETS: { fetch: () => Promise.resolve(new Response()) } } as unknown as Parameters<typeof handleRequest>[1]
    );

    expect(response.status).toBe(403);
  });
});
