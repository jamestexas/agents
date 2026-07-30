import { describe, expect, it, vi } from "vitest";
import { createBoardSource } from "../../src/runtime/board-source";

const board = {
  generated_at: "2026-07-30T12:00:00Z",
  tick_status: "all_clear",
  items: []
};

function fetcher(fn: (request: Request) => Promise<Response>): Fetcher {
  return { fetch: fn } as Fetcher;
}

describe("createBoardSource", () => {
  it("prefers a service binding and refreshes tick before reading", async () => {
    const calls: string[] = [];
    const source = createBoardSource({
      CANONICAL_HOURS: fetcher(async (request) => {
        calls.push(`${request.method} ${new URL(request.url).pathname}`);
        return request.method === "POST" ? Response.json({ result: "all_clear" }) : Response.json(board);
      }),
      CANONICAL_HOURS_URL: "https://must-not-run.test"
    }, new Headers({ authorization: "DPoP proof" }));

    const result = await source.refresh(AbortSignal.timeout(1000));
    expect(calls).toEqual(["POST /tick", "GET /board"]);
    expect(result.source).toBe("service-binding");
    expect(result.board.tickStatus).toBe("all_clear");
  });

  it("uses explicit HTTP fallback and forwards only authorization headers", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test");
      expect(new Headers(init?.headers).get("cookie")).toBeNull();
      return Response.json(board);
    });
    const source = createBoardSource(
      { CANONICAL_HOURS_URL: "https://canonical.test" },
      new Headers({ authorization: "Bearer test", cookie: "browser=secret" }),
      fetchImpl as typeof fetch
    );

    expect((await source.read(AbortSignal.timeout(1000))).source).toBe("http");
  });

  it("fails configuration instead of silently loading fixtures", () => {
    expect(() => createBoardSource({}, new Headers())).toThrow("board source is not configured");
  });

  it("keeps fixture refresh state and example status for the read that follows tick", async () => {
    const source = createBoardSource(
      { WORK_BOARD_FIXTURE: "true" },
      new Headers()
    );

    expect((await source.read(AbortSignal.timeout(1000))).board).toMatchObject({
      generatedAt: "2026-01-01T09:00:00Z",
      tickStatus: "example"
    });
    expect((await source.refresh(AbortSignal.timeout(1000))).board).toMatchObject({
      generatedAt: "2026-01-01T09:01:00Z",
      tickStatus: "example"
    });
  });
});
