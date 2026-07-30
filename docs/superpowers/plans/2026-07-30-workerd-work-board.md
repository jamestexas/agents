# Workerd Work Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the local Python/`gh` work-board prototype with a tested, portable workerd bundle in `agents/work-board` that consumes Canonical Hours through a `BoardSource`, runs through a Cloister-declared topology, and is ready to move into Canonical Hours.

**Architecture:** An isolated TypeScript package serves bundled UI assets and same-origin board routes from a Worker. A transport-neutral `BoardSource` reads and refreshes Canonical Hours over a service binding or HTTP; a strict normalizer projects storage data into the presentation model. Pure layout/state modules feed a D3 renderer, while workerd, Playwright, live-source, and Cloister-compose smokes verify the complete path.

**Tech Stack:** TypeScript 7, Vite 7, D3 7, Zod 4, Cloudflare Workers/workerd, Wrangler 4, Vitest 4 with `@cloudflare/vitest-pool-workers`, Playwright 1.60, Cloister manifest APIs, pnpm 10.

## Global Constraints

- Stage all implementation under `agents/work-board`; do not move code into Canonical Hours in this plan.
- The eventual owner is `canonical-hours`; portable code must not import from the agents repository.
- Keep `/pr-board` installed and unchanged.
- Do not modify `skills/handoff/`, `docs/ADR-003-handoff-at-the-seam.md`, `docs/handoff-skill-plan.md`, or session park/resume work.
- A Worker never spawns `gh`, `jq`, Python, or an arbitrary command.
- Provider credentials never enter HTML, browser storage, board JSON, or log messages.
- Prefer the Canonical Hours service binding; fall back to an explicitly configured URL; use fixtures only under an explicit development flag.
- Production never silently substitutes example data when live data is unavailable.
- Static executable assets are local; there is no CDN script dependency.
- Read and refresh authority stay separate; refresh defaults to the upstream action gate.
- No production behavior is added without first observing its test fail for the expected reason.
- Every commit uses bead `agents-151ffb` and the repository's conventional commit format.

## File Structure

### Package and host

- `work-board/package.json` — isolated scripts and dependency versions.
- `work-board/pnpm-lock.yaml` — reproducible dependency graph.
- `work-board/tsconfig.json` — Worker, DOM, and test TypeScript settings.
- `work-board/vite.config.ts` — browser asset build.
- `work-board/vitest.config.ts` — Node-side unit tests.
- `work-board/vitest.worker.config.ts` — real workerd route tests.
- `work-board/playwright.config.ts` — Chromium contract suite and fixture server.
- `work-board/wrangler.toml` — Worker entrypoint, assets binding, compatibility date.
- `work-board/src/worker.ts` — HTTP router only.

### Portable contract and source boundary

- `work-board/src/shared/board.ts` — Zod input schemas, normalized view types, compatibility defaults.
- `work-board/src/runtime/board-source.ts` — `BoardSource`, service-binding/HTTP/fixture resolution, read/refresh calls.
- `work-board/src/runtime/errors.ts` — typed source/configuration/validation error mapping.
- `work-board/src/runtime/fixture.ts` — explicit dev-only fixture source.

### Portable UI

- `work-board/index.html` — semantic shell; no inline behavior or CDN code.
- `work-board/src/ui/style.css` — existing visual system.
- `work-board/src/ui/state.ts` — filters, low-signal classification, action-list projection.
- `work-board/src/ui/layouts.ts` — pure dial, sweep, and stack geometry.
- `work-board/src/ui/render.ts` — D3 SVG/DOM rendering.
- `work-board/src/ui/app.ts` — fetch, refresh, busy/error state, event wiring.

### Verification and packaging

- `work-board/test/unit/*.test.ts` — normalizer, source selection, state, and layout tests.
- `work-board/test/worker/worker.test.ts` — route behavior in a real workerd pool.
- `work-board/test/fixtures/canonical-hours-server.mjs` — deterministic external source bundle.
- `work-board/e2e/work-board.spec.ts` — visible browser behavior.
- `work-board/cloister/cluster.toml` — two-bundle staging topology.
- `work-board/cloister/fixture.Dockerfile` — deterministic Canonical Hours-compatible fixture image.
- `work-board/Dockerfile` — work-board workerd image.
- `work-board/server.json` — package/bundle identity for Cloister consumers.
- `work-board/scripts/cloister-smoke.mjs` — validate with Cloister APIs, emit compose, build, run, and probe.
- `work-board/scripts/live-source-smoke.mjs` — exercise a running real Canonical Hours source.

### Documentation and retirement

- `work-board/README.md` — staging status, setup, runtime contract, tests, and Cloister use.
- `README.md` — accurate repository positioning and map.
- `work-board/.gitignore` — generated Node/Worker/browser output.
- Delete `work-board/scripts/serve.py` and `work-board/scripts/refresh.sh` only after their replacements pass.

---

### Task 1: Scaffold the isolated package and normalize board data

**Files:**

- Create: `work-board/package.json`
- Create: `work-board/pnpm-lock.yaml`
- Create: `work-board/tsconfig.json`
- Create: `work-board/vite.config.ts`
- Create: `work-board/vitest.config.ts`
- Create: `work-board/src/shared/board.ts`
- Create: `work-board/test/unit/board.test.ts`
- Modify: `work-board/.gitignore`

**Interfaces:**

- Consumes: Canonical Hours-shaped unknown JSON and the richer prototype JSON.
- Produces: `normalizeBoard(input: unknown): WorkBoardView`, `WorkBoardView`, `WorkBoardItem`, and `NextAction`.

- [ ] **Step 1: Add package and test configuration**

Create `work-board/package.json`:

```json
{
  "name": "@jamestexas/work-board-staging",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.30.3",
  "scripts": {
    "build": "vite build",
    "dev": "pnpm build && wrangler dev --local",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run --config vitest.config.ts",
    "test:worker": "vitest run --config vitest.worker.config.ts",
    "test:e2e": "pnpm build && playwright test",
    "test:cloister": "node scripts/cloister-smoke.mjs",
    "test:live": "node scripts/live-source-smoke.mjs",
    "check": "pnpm typecheck && pnpm test:unit && pnpm test:worker && pnpm build"
  },
  "dependencies": {
    "d3": "^7.9.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "0.18.7",
    "@cloudflare/workers-types": "^5.20260722.1",
    "@playwright/test": "^1.60.0",
    "@types/d3": "^7.4.3",
    "typescript": "7.0.2",
    "vite": "^7.3.5",
    "vitest": "4.1.10",
    "wrangler": "^4.113.0"
  }
}
```

Create `work-board/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "WebWorker"],
    "types": ["@cloudflare/workers-types", "vitest/globals"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "*.ts"]
}
```

Create `work-board/vite.config.ts`:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
```

Create `work-board/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
  },
});
```

Extend `work-board/.gitignore`:

```gitignore
node_modules/
dist/
.wrangler/
playwright-report/
test-results/
```

- [ ] **Step 2: Install and lock dependencies**

Run:

```bash
cd work-board
pnpm install
```

Expected: `pnpm-lock.yaml` is created and installation exits 0.

- [ ] **Step 3: Write failing normalization tests**

Create `work-board/test/unit/board.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeBoard } from "../../src/shared/board";

describe("normalizeBoard", () => {
  it("projects the Canonical Hours board without reading semantics from reason prose", () => {
    const board = normalizeBoard({
      generated_at: "2026-07-30T12:00:00Z",
      tick_status: "ok",
      degradations: [],
      items: [{
        kind: "pr",
        artifact_uri: "pr:acme/demo#7",
        repo: "acme/demo",
        number: 7,
        title: "fix ci wording without a CI failure",
        state: "needs_you",
        reason: "the words fail and ci appear here but are not typed state",
        new_items: [{ at: "2026-07-30T11:00:00Z" }],
        merge_ready: true
      }]
    });

    expect(board.items[0]).toMatchObject({
      artifactUri: "pr:acme/demo#7",
      role: "author",
      waitingOn: "me",
      lastActivity: "2026-07-30T11:00:00Z",
      nextAction: "merge"
    });
  });

  it("preserves richer prototype fields and marks bot/stale review asks low-signal", () => {
    const board = normalizeBoard({
      generated_at: "2026-07-30T12:00:00Z",
      tick_status: "live",
      items: [{
        kind: "pr",
        artifact_uri: "pr:acme/demo#8",
        number: 8,
        title: "deps",
        state: "needs_you",
        role: "reviewer",
        waiting_on: "me",
        last_activity: "2026-07-01T00:00:00Z",
        is_draft: false,
        merge_ready: false,
        bot: true,
        reason: "your review requested"
      }]
    });

    expect(board.items[0]).toMatchObject({
      role: "reviewer",
      waitingOn: "me",
      nextAction: "review",
      lowSignal: true
    });
  });

  it("rejects invalid timestamps and unknown kinds", () => {
    expect(() => normalizeBoard({
      generated_at: "not-a-time",
      tick_status: "ok",
      items: [{ kind: "mystery" }]
    })).toThrow();
  });
});
```

- [ ] **Step 4: Run the tests and verify RED**

Run:

```bash
cd work-board
pnpm test:unit -- board.test.ts
```

Expected: FAIL because `src/shared/board.ts` does not exist.

- [ ] **Step 5: Implement the normalized contract**

Create `work-board/src/shared/board.ts` with these exact public types and rules:

```ts
import { z } from "zod";

const IsoTime = z.iso.datetime({ offset: true });
const State = z.enum(["opened", "active", "needs_you", "resolved"]);
const Kind = z.enum(["pr", "issue", "event"]);
const Role = z.enum(["author", "reviewer", "participant"]);
const WaitingOn = z.enum(["me", "others"]);

export type NextAction = "merge" | "ci" | "respond" | "review" | "promote" | "attend";

export interface WorkBoardItem {
  kind: z.infer<typeof Kind>;
  artifactUri: string;
  repo?: string;
  number?: number;
  title: string;
  url?: string;
  state: z.infer<typeof State>;
  role: z.infer<typeof Role>;
  waitingOn: z.infer<typeof WaitingOn>;
  lastActivity: string;
  nextAction?: NextAction;
  isDraft: boolean;
  mergeReady: boolean;
  lowSignal: boolean;
  reason: string;
}

export interface WorkBoardView {
  generatedAt: string;
  tickStatus: "ok" | "degraded" | "live" | "all_clear";
  degradations: string[];
  items: WorkBoardItem[];
}

const RawActivity = z.object({ at: IsoTime }).passthrough();
const RawItem = z.object({
  kind: Kind,
  artifact_uri: z.string().min(1).optional(),
  repo: z.string().optional(),
  number: z.number().int().positive().optional(),
  title: z.string().min(1),
  url: z.string().url().optional().or(z.literal("")),
  state: State,
  role: Role.optional(),
  waiting_on: WaitingOn.optional(),
  last_activity: IsoTime.optional(),
  start: IsoTime.optional(),
  next_action: z.enum(["merge", "ci", "respond", "review", "promote", "attend"]).optional(),
  is_draft: z.boolean().optional(),
  merge_ready: z.boolean().optional(),
  bot: z.boolean().optional(),
  reason: z.string().default(""),
  new_items: z.array(RawActivity).optional()
}).passthrough();

const RawBoard = z.object({
  generated_at: IsoTime,
  tick_status: z.enum(["ok", "degraded", "live", "all_clear", "example"]),
  degradations: z.array(z.union([z.string(), z.object({ source: z.string(), error: z.string() })])).default([]),
  items: z.array(RawItem)
}).passthrough();

function actionOf(item: z.infer<typeof RawItem>): NextAction | undefined {
  if (item.next_action) return item.next_action;
  if (item.kind === "event") return "attend";
  const waiting = item.waiting_on ?? (item.state === "needs_you" ? "me" : "others");
  if (waiting !== "me") return undefined;
  if (item.role === "reviewer") return "review";
  if (item.is_draft) return "promote";
  if (item.merge_ready) return "merge";
  return "respond";
}

export function normalizeBoard(input: unknown): WorkBoardView {
  const board = RawBoard.parse(input);
  return {
    generatedAt: board.generated_at,
    tickStatus: board.tick_status === "example" ? "live" : board.tick_status,
    degradations: board.degradations.map((d) => typeof d === "string" ? d : `${d.source}: ${d.error}`),
    items: board.items.map((item) => {
      const role = item.role ?? (item.kind === "pr" ? "author" : "participant");
      const waitingOn = item.waiting_on ?? (item.state === "needs_you" ? "me" : "others");
      const activity = item.last_activity
        ?? item.start
        ?? item.new_items?.map((entry) => entry.at).sort().at(-1)
        ?? board.generated_at;
      const ageMs = Date.parse(board.generated_at) - Date.parse(activity);
      return {
        kind: item.kind,
        artifactUri: item.artifact_uri ?? `${item.kind}:${item.repo ?? "local"}#${item.number ?? item.title}`,
        repo: item.repo,
        number: item.number,
        title: item.title,
        url: item.url || undefined,
        state: item.state,
        role,
        waitingOn,
        lastActivity: activity,
        nextAction: actionOf(item),
        isDraft: item.is_draft ?? false,
        mergeReady: item.merge_ready ?? false,
        lowSignal: (item.bot ?? false) || (role === "reviewer" && ageMs > 14 * 24 * 60 * 60 * 1000),
        reason: item.reason
      };
    })
  };
}
```

- [ ] **Step 6: Run unit tests and typecheck**

Run:

```bash
cd work-board
pnpm test:unit -- board.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the contract**

```bash
git add work-board/package.json work-board/pnpm-lock.yaml work-board/tsconfig.json \
  work-board/vite.config.ts work-board/vitest.config.ts work-board/.gitignore \
  work-board/src/shared/board.ts work-board/test/unit/board.test.ts
git commit -m "[agents-151ffb] feat(work-board): add portable board contract"
```

---

### Task 2: Add the transport-neutral BoardSource

**Files:**

- Create: `work-board/src/runtime/errors.ts`
- Create: `work-board/src/runtime/fixture.ts`
- Create: `work-board/src/runtime/board-source.ts`
- Create: `work-board/test/unit/board-source.test.ts`

**Interfaces:**

- Consumes: optional `CANONICAL_HOURS: Fetcher`, `CANONICAL_HOURS_URL`, explicit fixture mode, request authorization, and `AbortSignal`.
- Produces: `createBoardSource(env, authHeaders): BoardSource`; `read()` and `refresh()` return normalized `WorkBoardView`.

- [ ] **Step 1: Write failing source-selection and refresh tests**

Create `work-board/test/unit/board-source.test.ts`:

```ts
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

  it("keeps fixture refresh state for the read that follows tick", async () => {
    const source = createBoardSource(
      { WORK_BOARD_FIXTURE: "true" },
      new Headers()
    );

    expect((await source.read(AbortSignal.timeout(1000))).board.generatedAt)
      .toBe("2026-01-01T09:00:00Z");
    expect((await source.refresh(AbortSignal.timeout(1000))).board.generatedAt)
      .toBe("2026-01-01T09:01:00Z");
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd work-board
pnpm test:unit -- board-source.test.ts
```

Expected: FAIL because the runtime modules do not exist.

- [ ] **Step 3: Implement typed errors and the source resolver**

Create `work-board/src/runtime/errors.ts`:

```ts
export class BoardSourceError extends Error {
  constructor(
    message: string,
    readonly kind: "configuration" | "timeout" | "upstream" | "validation",
    readonly status: number
  ) {
    super(message);
  }
}
```

Create `work-board/src/runtime/fixture.ts`:

```ts
import example from "../../data/board.example.json";

export function fixtureBoard(refreshed = false): unknown {
  return {
    ...example,
    generated_at: refreshed ? "2026-01-01T09:01:00Z" : example.generated_at,
    tick_status: "live"
  };
}
```

Create `work-board/src/runtime/board-source.ts`:

```ts
import { normalizeBoard, type WorkBoardView } from "../shared/board";
import { BoardSourceError } from "./errors";
import { fixtureBoard } from "./fixture";

export interface BoardEnv {
  CANONICAL_HOURS?: Fetcher;
  CANONICAL_HOURS_URL?: string;
  WORK_BOARD_FIXTURE?: string;
  WORK_BOARD_REFRESH_MODE?: string;
}

export interface BoardSourceResult {
  board: WorkBoardView;
  source: "service-binding" | "http" | "fixture";
  refreshed: boolean;
}

export interface BoardSource {
  read(signal: AbortSignal): Promise<BoardSourceResult>;
  refresh(signal: AbortSignal): Promise<BoardSourceResult>;
}

function forwardedAuthorization(headers: Headers): Headers {
  const out = new Headers();
  const value = headers.get("authorization");
  if (value) out.set("authorization", value);
  return out;
}

export function createBoardSource(
  env: BoardEnv,
  requestHeaders: Headers,
  fetchImpl: typeof fetch = fetch
): BoardSource {
  const auth = forwardedAuthorization(requestHeaders);
  const kind = env.CANONICAL_HOURS ? "service-binding"
    : env.CANONICAL_HOURS_URL?.trim() ? "http"
    : env.WORK_BOARD_FIXTURE === "true" ? "fixture"
    : null;
  if (!kind) throw new BoardSourceError("board source is not configured", "configuration", 503);
  let fixtureRefreshed = false;

  const call = async (path: "/board" | "/tick", method: "GET" | "POST", signal: AbortSignal) => {
    if (kind === "fixture") {
      if (method === "POST") {
        fixtureRefreshed = true;
        return Response.json({ result: "live" });
      }
      return Response.json(fixtureBoard(fixtureRefreshed));
    }
    const base = env.CANONICAL_HOURS_URL?.replace(/\/$/, "") ?? "https://canonical-hours.internal";
    const request = new Request(`${base}${path}`, { method, headers: auth, signal });
    return env.CANONICAL_HOURS ? env.CANONICAL_HOURS.fetch(request) : fetchImpl(request);
  };

  const read = async (signal: AbortSignal, refreshed: boolean): Promise<BoardSourceResult> => {
    try {
      const response = await call("/board", "GET", signal);
      if (!response.ok) {
        throw new BoardSourceError(`board source returned ${response.status}`, "upstream", 502);
      }
      return { board: normalizeBoard(await response.json()), source: kind, refreshed };
    } catch (error) {
      if (error instanceof BoardSourceError) throw error;
      if (signal.aborted) throw new BoardSourceError("board source timed out", "timeout", 504);
      throw new BoardSourceError(error instanceof Error ? error.message : String(error), "validation", 502);
    }
  };

  return {
    read: (signal) => read(signal, false),
    refresh: async (signal) => {
      const response = await call("/tick", "POST", signal);
      if (!response.ok) throw new BoardSourceError(`tick source returned ${response.status}`, "upstream", 502);
      return read(signal, true);
    }
  };
}
```

- [ ] **Step 4: Run the focused and complete unit suite**

Run:

```bash
cd work-board
pnpm test:unit -- board-source.test.ts
pnpm test:unit
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the source boundary**

```bash
git add work-board/src/runtime work-board/test/unit/board-source.test.ts
git commit -m "[agents-151ffb] feat(work-board): add canonical-hours board source"
```

---

### Task 3: Serve the board and assets from workerd

**Files:**

- Create: `work-board/src/worker.ts`
- Create: `work-board/wrangler.toml`
- Create: `work-board/vitest.worker.config.ts`
- Create: `work-board/test/worker/worker.test.ts`
- Modify: `work-board/index.html`

**Interfaces:**

- Consumes: `BoardSource`, `ASSETS: Fetcher`, and Worker request headers.
- Produces: `GET /`, `GET /board/ui`, `GET /api/board`, `POST /api/refresh`, `GET /health`, and static assets.

- [ ] **Step 1: Write failing Worker route tests**

Create `work-board/test/worker/worker.test.ts`:

```ts
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
    expect((await SELF.fetch("https://work-board.test/api/board", { method: "POST" })).status).toBe(405);
    expect((await SELF.fetch("https://work-board.test/nope")).status).toBe(404);
  });

  it("denies refresh by default outside explicit fixture/source-authorized modes", async () => {
    const response = await handleRequest(
      new Request("https://work-board.test/api/refresh", { method: "POST" }),
      { ASSETS: { fetch: () => Promise.resolve(new Response()) } } as Parameters<typeof handleRequest>[1]
    );
    expect(response.status).toBe(403);
  });
});
```

- [ ] **Step 2: Add workerd configuration and verify RED**

Create `work-board/wrangler.toml`:

```toml
name = "work-board-staging"
main = "src/worker.ts"
compatibility_date = "2026-03-01"

[assets]
directory = "./dist"
binding = "ASSETS"
run_worker_first = true

[vars]
WORK_BOARD_FIXTURE = "true"
```

Create `work-board/vitest.worker.config.ts`:

```ts
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/worker.ts",
      miniflare: {
        compatibilityDate: "2026-03-01",
        bindings: { WORK_BOARD_FIXTURE: "true" }
      }
    })
  ],
  test: { include: ["test/worker/**/*.test.ts"] }
});
```

Run:

```bash
cd work-board
pnpm test:worker
```

Expected: FAIL because `src/worker.ts` does not exist.

- [ ] **Step 3: Implement the router**

Create `work-board/src/worker.ts`:

```ts
import { createBoardSource, type BoardEnv } from "./runtime/board-source";
import { BoardSourceError } from "./runtime/errors";

export interface Env extends BoardEnv {
  ASSETS: Fetcher;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" }
  });
}

async function boardResponse(request: Request, env: Env, refresh: boolean): Promise<Response> {
  try {
    const source = createBoardSource(env, request.headers);
    const signal = AbortSignal.timeout(45_000);
    const result = refresh ? await source.refresh(signal) : await source.read(signal);
    return json(result.board);
  } catch (error) {
    const sourceError = error instanceof BoardSourceError
      ? error
      : new BoardSourceError(String(error), "upstream", 502);
    return json({ error: sourceError.kind, message: sourceError.message }, sourceError.status);
  }
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/") {
    return Response.redirect(new URL("/board/ui", url), 302);
  }
  if (request.method === "GET" && url.pathname === "/health") {
    const source = env.CANONICAL_HOURS ? "service-binding"
      : env.CANONICAL_HOURS_URL?.trim() ? "http"
      : env.WORK_BOARD_FIXTURE === "true" ? "fixture"
      : "unconfigured";
    return json({ ok: true, source });
  }
  if (url.pathname === "/api/board") {
    return request.method === "GET" ? boardResponse(request, env, false) : new Response(null, { status: 405 });
  }
  if (url.pathname === "/api/refresh") {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const refreshAllowed = env.WORK_BOARD_FIXTURE === "true"
      || env.WORK_BOARD_REFRESH_MODE === "source-authorized";
    return refreshAllowed
      ? boardResponse(request, env, true)
      : json({ error: "forbidden", message: "refresh is disabled for this deployment" }, 403);
  }
  if (request.method === "GET" && (url.pathname === "/board/ui" || url.pathname.startsWith("/assets/"))) {
    const assetUrl = new URL(request.url);
    if (url.pathname === "/board/ui") assetUrl.pathname = "/";
    return env.ASSETS.fetch(new Request(assetUrl, request));
  }
  return new Response(null, { status: 404 });
}

export default {
  fetch: handleRequest
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: Replace the HTML with a buildable semantic shell**

Replace `work-board/index.html` with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>work-board · canonical-hours</title>
  </head>
  <body>
    <main class="wrap">
      <header>
        <h1>work-board</h1>
        <span class="meta" id="meta">loading…</span>
      </header>
      <div id="error" role="status" hidden></div>
      <nav id="controls" aria-label="Board controls"></nav>
      <p class="note" id="note"></p>
      <p id="empty" hidden>No work in this view.</p>
      <svg id="dial" viewBox="0 0 900 760" aria-label="Work board"></svg>
      <div class="axes" id="axes"></div>
      <section class="listwrap" id="listwrap">
        <button id="copybtn" type="button">⧉ copy list</button>
        <pre id="listtext" class="listtext"></pre>
      </section>
    </main>
    <div class="tip" id="tip" hidden></div>
    <script type="module" src="/src/ui/app.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Run route tests**

Run:

```bash
cd work-board
pnpm test:worker
pnpm typecheck
```

Expected: PASS. Asset requests may remain untested until Task 5 builds the UI; API and health routes must pass now.

- [ ] **Step 6: Commit the Worker host**

```bash
git add work-board/src/worker.ts work-board/wrangler.toml \
  work-board/vitest.worker.config.ts work-board/test/worker/worker.test.ts \
  work-board/index.html
git commit -m "[agents-151ffb] feat(work-board): serve board through workerd"
```

---

### Task 4: Extract pure board state and layouts

**Files:**

- Create: `work-board/src/ui/state.ts`
- Create: `work-board/src/ui/layouts.ts`
- Create: `work-board/test/unit/state.test.ts`
- Create: `work-board/test/unit/layouts.test.ts`

**Interfaces:**

- Consumes: `WorkBoardView`, current time, layout mode, filter, and low-signal visibility.
- Produces: `visibleItems`, `actionList`, `dialLayout`, `sweepLayout`, and `stackLayout`; no DOM access.

- [ ] **Step 1: Write failing state tests**

Create `work-board/test/unit/state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { actionList, visibleItems } from "../../src/ui/state";
import type { WorkBoardItem } from "../../src/shared/board";

const item = (patch: Partial<WorkBoardItem>): WorkBoardItem => ({
  kind: "pr",
  artifactUri: "pr:acme/demo#1",
  number: 1,
  title: "Example",
  state: "active",
  role: "author",
  waitingOn: "others",
  lastActivity: "2026-07-30T10:00:00Z",
  isDraft: false,
  mergeReady: false,
  lowSignal: false,
  reason: "",
  ...patch
});

describe("visibleItems", () => {
  it("applies role and needs-me filters without mutating input", () => {
    const input = [
      item({ artifactUri: "a", role: "author" }),
      item({ artifactUri: "b", role: "reviewer", waitingOn: "me" })
    ];
    expect(visibleItems(input, "reviewer", false).map((x) => x.artifactUri)).toEqual(["b"]);
    expect(visibleItems(input, "needs", false).map((x) => x.artifactUri)).toEqual(["b"]);
    expect(input).toHaveLength(2);
  });

  it("hides low-signal items until explicitly revealed", () => {
    const input = [item({ artifactUri: "noise", lowSignal: true })];
    expect(visibleItems(input, "all", false)).toEqual([]);
    expect(visibleItems(input, "all", true)).toHaveLength(1);
  });
});

describe("actionList", () => {
  it("ranks attend, merge, respond, ci, review, and promote actions deterministically", () => {
    const lines = actionList([
      item({ artifactUri: "review", nextAction: "review", waitingOn: "me" }),
      item({ artifactUri: "merge", nextAction: "merge", waitingOn: "me" })
    ]);
    expect(lines.indexOf("[merge]")).toBeLessThan(lines.indexOf("[review]"));
  });
});
```

- [ ] **Step 2: Write failing layout tests**

Create `work-board/test/unit/layouts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dialLayout, stackLayout, sweepLayout } from "../../src/ui/layouts";
import type { WorkBoardItem } from "../../src/shared/board";

const base: WorkBoardItem = {
  kind: "pr",
  artifactUri: "pr:acme/demo#1",
  number: 1,
  title: "Example",
  state: "active",
  role: "author",
  waitingOn: "others",
  lastActivity: "2026-07-30T10:00:00Z",
  isDraft: false,
  mergeReady: false,
  lowSignal: false,
  reason: ""
};

describe("board layouts", () => {
  it("places older dial items farther from center", () => {
    const points = dialLayout([
      base,
      { ...base, artifactUri: "older", lastActivity: "2026-07-28T10:00:00Z" }
    ], Date.parse("2026-07-30T12:00:00Z"));
    expect(points[1]!.radius).toBeGreaterThan(points[0]!.radius);
  });

  it("sweep angle increases with age", () => {
    const points = sweepLayout([
      base,
      { ...base, artifactUri: "older", lastActivity: "2026-07-29T10:00:00Z" }
    ], Date.parse("2026-07-30T12:00:00Z"));
    expect(points[1]!.angle).toBeGreaterThan(points[0]!.angle);
  });

  it("stack keeps one now gap and never duplicates its marker", () => {
    const result = stackLayout([
      { ...base, kind: "event", artifactUri: "event", lastActivity: "2026-07-30T13:00:00Z" },
      base
    ], Date.parse("2026-07-30T12:00:00Z"));
    expect(result.nowMarkers).toBe(1);
    expect(new Set(result.rows.map((row) => row.y)).size).toBe(result.rows.length);
  });
});
```

- [ ] **Step 3: Run and verify RED**

Run:

```bash
cd work-board
pnpm test:unit -- state.test.ts layouts.test.ts
```

Expected: FAIL because `state.ts` and `layouts.ts` do not exist.

- [ ] **Step 4: Implement pure state**

Create `work-board/src/ui/state.ts`:

```ts
import type { WorkBoardItem } from "../shared/board";

export type BoardFilter = "all" | "author" | "reviewer" | "needs";

export function visibleItems(items: readonly WorkBoardItem[], filter: BoardFilter, showLowSignal: boolean): WorkBoardItem[] {
  return items.filter((item) => {
    if (!showLowSignal && item.lowSignal) return false;
    if (filter === "needs") return item.waitingOn === "me";
    if (filter === "author" || filter === "reviewer") return item.role === filter;
    return true;
  });
}

const rank = { attend: 0, merge: 1, respond: 2, ci: 3, review: 4, promote: 5 } as const;

export function actionList(items: readonly WorkBoardItem[]): string {
  const need = items
    .filter((item) => item.waitingOn === "me")
    .toSorted((a, b) => (rank[a.nextAction ?? "promote"] - rank[b.nextAction ?? "promote"])
      || Date.parse(a.lastActivity) - Date.parse(b.lastActivity));
  const monitoring = items.filter((item) => item.waitingOn === "others");
  const line = (item: WorkBoardItem) =>
    `- [${item.nextAction ?? "monitor"}] ${item.kind === "event" ? "▢" : item.role === "reviewer" ? "◆" : "●"} `
    + `${item.number ? `#${item.number} ` : ""}${item.title}${item.url ? `  ${item.url}` : ""}`;
  return [
    need.length ? `NEEDS YOU (${need.length})\n${need.map(line).join("\n")}` : "",
    monitoring.length ? `MONITORING (${monitoring.length})\n${monitoring.map(line).join("\n")}` : ""
  ].filter(Boolean).join("\n\n") || "(nothing in view)";
}
```

- [ ] **Step 5: Implement pure layouts**

Create `work-board/src/ui/layouts.ts` with:

```ts
import type { WorkBoardItem } from "../shared/board";

export interface Point extends WorkBoardItem {
  x: number;
  y: number;
  angle: number;
  radius: number;
}

const CX = 450;
const CY = 360;
const INNER = 72;
const OUTER = 270;
const MAX_AGE_HOURS = 48;
const stateAngle = { opened: 0, active: 90, needs_you: 180, resolved: 270 } as const;

const ageHours = (item: WorkBoardItem, now: number) =>
  Math.max(0, (now - Date.parse(item.lastActivity)) / 3_600_000);

function polar(angle: number, radius: number): [number, number] {
  const radians = (angle - 90) * Math.PI / 180;
  return [CX + radius * Math.cos(radians), CY + radius * Math.sin(radians)];
}

export function dialLayout(items: readonly WorkBoardItem[], now: number): Point[] {
  const groups = new Map<WorkBoardItem["state"], WorkBoardItem[]>();
  for (const item of items) {
    const group = groups.get(item.state) ?? [];
    group.push(item);
    groups.set(item.state, group);
  }
  return items.map((item) => {
    const group = groups.get(item.state) ?? [item];
    const index = group.findIndex((entry) => entry.artifactUri === item.artifactUri);
    const step = group.length > 1 ? Math.min(18, 76 / (group.length - 1)) : 0;
    const angle = stateAngle[item.state] + (index - (group.length - 1) / 2) * step;
    const radius = INNER + Math.min(ageHours(item, now), MAX_AGE_HOURS) / MAX_AGE_HOURS * (OUTER - INNER);
    const [x, y] = polar(angle, radius);
    return { ...item, x, y, angle, radius };
  });
}

export function sweepLayout(items: readonly WorkBoardItem[], now: number): Point[] {
  return items.map((item, index) => {
    const angle = Math.min(ageHours(item, now), MAX_AGE_HOURS) / MAX_AGE_HOURS * 300;
    const radius = INNER + 70 + (item.state === "needs_you" ? 54 : 0) + (index * 26) % 88;
    const [x, y] = polar(angle, radius);
    return { ...item, x, y, angle, radius };
  });
}

export function stackLayout(items: readonly WorkBoardItem[], now: number) {
  const events = items.filter((item) => item.kind === "event")
    .toSorted((a, b) => Date.parse(a.lastActivity) - Date.parse(b.lastActivity));
  const work = items.filter((item) => item.kind !== "event")
    .toSorted((a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity));
  const ordered = [...events, ...work];
  const rowHeight = Math.max(24, Math.min(46, (700 - 64) / Math.max(ordered.length + 1, 1)));
  return {
    nowMarkers: 1,
    nowY: 64 + events.length * rowHeight + rowHeight * 0.5,
    rows: ordered.map((item, index) => ({
      ...item,
      y: 64 + (index + (index >= events.length ? 1 : 0)) * rowHeight,
      future: Date.parse(item.lastActivity) > now
    }))
  };
}
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
cd work-board
pnpm test:unit -- state.test.ts layouts.test.ts
pnpm typecheck
```

Expected: PASS.

```bash
git add work-board/src/ui/state.ts work-board/src/ui/layouts.ts \
  work-board/test/unit/state.test.ts work-board/test/unit/layouts.test.ts
git commit -m "[agents-151ffb] feat(work-board): extract board state and layouts"
```

---

### Task 5: Port the interactive UI and browser contracts

**Files:**

- Create: `work-board/src/ui/style.css`
- Create: `work-board/src/ui/render.ts`
- Create: `work-board/src/ui/app.ts`
- Create: `work-board/playwright.config.ts`
- Create: `work-board/e2e/work-board.spec.ts`
- Modify: `work-board/index.html`
- Modify: `work-board/src/runtime/fixture.ts`

**Interfaces:**

- Consumes: `GET /api/board`, `POST /api/refresh`, pure state/layout functions.
- Produces: three rendered layouts, filters, low-signal toggle, tooltip, copyable list, busy state, stale/degraded banner.

- [ ] **Step 1: Add Playwright configuration and failing browser tests**

Create `work-board/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:8791",
    browserName: "chromium"
  },
  webServer: {
    command: "pnpm exec wrangler dev --local --port 8791",
    url: "http://127.0.0.1:8791/health",
    reuseExistingServer: false,
    timeout: 30_000
  }
});
```

Create `work-board/e2e/work-board.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("renders all layouts and filters the fixture board", async ({ page }) => {
  await page.goto("/board/ui");
  await expect(page.locator("#meta")).toContainText("need you");
  await expect(page.locator("g.node")).toHaveCount(6);

  await page.getByRole("button", { name: "reviewing" }).click();
  await expect(page.locator("g.node")).toHaveCount(2);

  await page.getByRole("button", { name: /low-signal/ }).click();
  await expect(page.locator("g.node")).toHaveCount(3);

  await page.getByRole("button", { name: "stack" }).click();
  await expect(page.locator("[data-now-line]")).toHaveCount(1);

  await page.getByRole("button", { name: "sweep" }).click();
  await expect(page.locator("svg#dial")).toHaveAttribute("data-mode", "sweep");
});

test("refresh is single-flight and preserves the last board on failure", async ({ page }) => {
  await page.goto("/board/ui");
  const refresh = page.getByRole("button", { name: /refresh/ });
  await Promise.all([refresh.click(), refresh.click()]);
  await expect(refresh).toBeEnabled();
  await expect(page.locator("#meta")).toContainText("09:01");

  await page.route("**/api/refresh", (route) => route.fulfill({
    status: 502,
    contentType: "application/json",
    body: JSON.stringify({ error: "upstream", message: "fixture failed" })
  }));
  await refresh.click();
  await expect(page.locator("#error")).toContainText("fixture failed");
  await expect(page.locator("g.node")).not.toHaveCount(0);
});

test("copies the action list", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/board/ui");
  await page.getByRole("button", { name: /copy list/ }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("NEEDS YOU");
});

test("surfaces degradations and an explicit empty state", async ({ page }) => {
  await page.route("**/api/board", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: "2026-07-30T12:00:00Z",
      tickStatus: "degraded",
      degradations: ["github slice timed out"],
      items: []
    })
  }));
  await page.goto("/board/ui");
  await expect(page.locator("#error")).toContainText("github slice timed out");
  await expect(page.locator("#empty")).toBeVisible();
  await expect(page.locator("g.node")).toHaveCount(0);
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd work-board
pnpm test:e2e
```

Expected: FAIL because the controls, renderer, and application modules do not exist.

- [ ] **Step 3: Port styles without changing the visual vocabulary**

Move the existing inline CSS into `work-board/src/ui/style.css`. Preserve the
existing color variables and add:

```css
#error {
  margin: 10px 0;
  border: 1px solid #f0883e;
  border-radius: 6px;
  padding: 8px 10px;
  color: #f0b36a;
  background: #2b1d0e;
}

button[aria-pressed="true"] {
  background: var(--active);
  color: #fff;
}
```

- [ ] **Step 4: Implement the renderer as one exported unit**

Create `work-board/src/ui/render.ts` with this public surface:

```ts
import * as d3 from "d3";
import type { WorkBoardItem, WorkBoardView } from "../shared/board";
import { dialLayout, stackLayout, sweepLayout } from "./layouts";
import { actionList, visibleItems, type BoardFilter } from "./state";

export type LayoutMode = "dial" | "sweep" | "stack";

export interface RenderState {
  board: WorkBoardView;
  mode: LayoutMode;
  filter: BoardFilter;
  showLowSignal: boolean;
}

const stateColor: Record<WorkBoardItem["state"], string> = {
  opened: "#58a6ff",
  active: "#bc8cff",
  needs_you: "#f0883e",
  resolved: "#3fb950"
};

function symbolFor(item: WorkBoardItem): d3.SymbolType {
  if (item.kind === "event") return d3.symbolSquare;
  return item.role === "reviewer" ? d3.symbolDiamond : d3.symbolCircle;
}

function addScaffold(svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>): void {
  const labels = [
    { text: "OPENED", x: 450, y: 34 },
    { text: "ACTIVE", x: 852, y: 360 },
    { text: "NEEDS YOU", x: 450, y: 694 },
    { text: "RESOLVED", x: 48, y: 360 }
  ];
  svg.selectAll("text.quadrant").data(labels).join("text")
    .attr("class", "quadrant")
    .attr("x", (d) => d.x).attr("y", (d) => d.y)
    .attr("text-anchor", "middle").text((d) => d.text);
}

function addTooltip(nodes: d3.Selection<SVGGElement, WorkBoardItem, SVGSVGElement, unknown>): void {
  const tooltip = d3.select<HTMLElement, unknown>("#tip");
  nodes.on("mouseenter focus", (event, item) => {
    const pointer = event instanceof MouseEvent ? [event.clientX, event.clientY] : [24, 24];
    tooltip
      .attr("hidden", null)
      .style("left", `${pointer[0] + 12}px`)
      .style("top", `${pointer[1] + 12}px`)
      .text(`${item.repo ?? "calendar"} · ${item.reason ?? item.state}`);
  }).on("mouseleave blur", () => tooltip.attr("hidden", ""));
}

export function renderBoard(state: RenderState, now = Date.parse(state.board.generatedAt)): void {
  const items = visibleItems(state.board.items, state.filter, state.showLowSignal);
  const svg = d3.select<SVGSVGElement, unknown>("#dial").attr("data-mode", state.mode);
  svg.selectAll("*").remove();
  addScaffold(svg);

  if (state.mode === "stack") {
    const layout = stackLayout(items, now);
    svg.append("line")
      .attr("data-now-line", "")
      .attr("x1", 60).attr("x2", 840)
      .attr("y1", layout.nowY).attr("y2", layout.nowY)
      .attr("stroke", "#f0883e").attr("stroke-dasharray", "4,4");
    const rows = svg.selectAll("g.node").data(layout.rows, (d) => (d as WorkBoardItem).artifactUri)
      .join("g").attr("class", "node").attr("transform", (d) => `translate(0,${d.y})`);
    rows.append("text").attr("x", 90).text((d) => d.kind === "event" ? "▢" : d.role === "reviewer" ? "◆" : "●");
    rows.append("text").attr("x", 118).text((d) => d.nextAction ?? "");
    rows.append("text").attr("x", 196).text((d) => `${d.number ? `#${d.number}  ` : ""}${d.title}`);
    addTooltip(rows as d3.Selection<SVGGElement, WorkBoardItem, SVGSVGElement, unknown>);
  } else {
    const points = state.mode === "dial" ? dialLayout(items, now) : sweepLayout(items, now);
    const nodes = svg.selectAll("g.node").data(points, (d) => (d as WorkBoardItem).artifactUri)
      .join<SVGGElement>("g").attr("class", "node")
      .attr("tabindex", 0)
      .attr("color", (d) => stateColor[d.state])
      .attr("transform", (d) => `translate(${d.x},${d.y})`);
    nodes.append("path")
      .attr("d", (d) => d3.symbol(symbolFor(d), d.state === "needs_you" ? 320 : 220)())
      .attr("fill", (d) => d.waitingOn === "me" ? "currentColor" : "none")
      .attr("stroke", (d) => d.mergeReady ? "#238636" : "currentColor")
      .attr("stroke-width", (d) => d.mergeReady ? 3 : 2)
      .attr("stroke-dasharray", (d) => d.isDraft ? "3,2.5" : null);
    nodes.append("text").attr("y", -16).attr("text-anchor", "middle")
      .text((d) => d.number ? `#${d.number}` : d.title);
    addTooltip(nodes as d3.Selection<SVGGElement, WorkBoardItem, SVGSVGElement, unknown>);
  }

  const need = items.filter((item) => item.waitingOn === "me");
  document.querySelector("#meta")!.textContent =
    `${items.length} items · ${need.length} need you · ${state.board.generatedAt.slice(0, 16).replace("T", " ")}`;
  document.querySelector("#listtext")!.textContent = actionList(items);
  document.querySelector<HTMLElement>("#empty")!.hidden = items.length !== 0;
}
```

Add the legend to `index.html` with these exact encodings: circle = author,
diamond = reviewer, square = event; filled = waiting on me, hollow = waiting on
others; dashed = draft; green outline = merge-ready. Keep `renderBoard` as the
only public rendering function and keep all placement math in `layouts.ts`.

- [ ] **Step 5: Implement application state and controls**

Create `work-board/src/ui/app.ts`:

```ts
import "./style.css";
import type { WorkBoardView } from "../shared/board";
import { renderBoard, type LayoutMode, type RenderState } from "./render";
import type { BoardFilter } from "./state";

let state: RenderState | null = null;
let refreshPromise: Promise<void> | null = null;

const controls = document.querySelector<HTMLElement>("#controls")!;
controls.innerHTML = `
  <div class="toggle" aria-label="Layout">
    <button data-mode="dial" aria-pressed="true">◷ dial</button>
    <button data-mode="sweep" aria-pressed="false">◴ sweep</button>
    <button data-mode="stack" aria-pressed="false">▤ stack</button>
  </div>
  <div class="toggle" aria-label="Filter">
    <button data-filter="all" aria-pressed="true">all</button>
    <button data-filter="author" aria-pressed="false">mine</button>
    <button data-filter="reviewer" aria-pressed="false">reviewing</button>
    <button data-filter="needs" aria-pressed="false">needs me</button>
  </div>
  <button id="noisebtn" type="button" aria-pressed="false">⌁ low-signal</button>
  <button id="reloadbtn" type="button">↻ refresh</button>
`;

function showError(message?: string): void {
  const element = document.querySelector<HTMLElement>("#error")!;
  element.hidden = !message;
  element.textContent = message ?? "";
}

async function requestBoard(path: "/api/board" | "/api/refresh", method: "GET" | "POST"): Promise<WorkBoardView> {
  const response = await fetch(path, { method, cache: "no-store" });
  const body = await response.json() as WorkBoardView | { message?: string };
  if (!response.ok) throw new Error("message" in body ? body.message : `request failed: ${response.status}`);
  return body as WorkBoardView;
}

async function load(): Promise<void> {
  const board = await requestBoard("/api/board", "GET");
  state = { board, mode: "dial", filter: "all", showLowSignal: false };
  renderBoard(state);
}

function refresh(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  const button = document.querySelector<HTMLButtonElement>("#reloadbtn")!;
  button.disabled = true;
  refreshPromise = requestBoard("/api/refresh", "POST")
    .then((board) => {
      if (!state) return;
      state = { ...state, board };
      showError(board.degradations.length ? board.degradations.join(" · ") : undefined);
      renderBoard(state);
    })
    .catch((error) => showError(error instanceof Error ? error.message : String(error)))
    .finally(() => {
      button.disabled = false;
      refreshPromise = null;
    });
  return refreshPromise;
}

controls.addEventListener("click", (event) => {
  if (!state || !(event.target instanceof HTMLButtonElement)) return;
  if (event.target.dataset.mode) state.mode = event.target.dataset.mode as LayoutMode;
  if (event.target.dataset.filter) state.filter = event.target.dataset.filter as BoardFilter;
  if (event.target.id === "noisebtn") state.showLowSignal = !state.showLowSignal;
  if (event.target.id === "reloadbtn") void refresh();
  renderBoard(state);
});

document.querySelector("#copybtn")!.addEventListener("click", () =>
  navigator.clipboard.writeText(document.querySelector("#listtext")!.textContent ?? "")
);

void load()
  .then(() => {
    if (state?.board.degradations.length) showError(state.board.degradations.join(" · "));
  })
  .catch((error) => showError(error instanceof Error ? error.message : String(error)));
```

Update `work-board/index.html` so the control and legend labels match the
existing prototype and so `src/ui/app.ts` remains the only script entry.

- [ ] **Step 6: Run browser, unit, Worker, and build gates**

Run:

```bash
cd work-board
pnpm test:e2e
pnpm test:unit
pnpm test:worker
pnpm typecheck
pnpm build
```

Expected: PASS with no console errors or CDN requests.

- [ ] **Step 7: Commit the UI**

```bash
git add work-board/index.html work-board/src/ui work-board/src/runtime/fixture.ts \
  work-board/playwright.config.ts work-board/e2e/work-board.spec.ts
git commit -m "[agents-151ffb] feat(work-board): restore interactive board UI"
```

---

### Task 6: Prove the bundle through Cloister and a live source

**Files:**

- Create: `work-board/server.json`
- Create: `work-board/Dockerfile`
- Create: `work-board/cloister/cluster.toml`
- Create: `work-board/cloister/fixture.Dockerfile`
- Create: `work-board/test/fixtures/canonical-hours-server.mjs`
- Create: `work-board/scripts/cloister-smoke.mjs`
- Create: `work-board/scripts/live-source-smoke.mjs`
- Create: `work-board/test/unit/cloister-manifest.test.ts`

**Interfaces:**

- Consumes: Cloister's exported `parseTomlToCluster` and `emitCompose` APIs, a compose-capable container runtime, and optional real `CANONICAL_HOURS_URL`.
- Produces: a validated two-bundle topology, local images, a live board read/refresh smoke, and a real-source smoke.

- [ ] **Step 1: Write the failing manifest contract test**

Create `work-board/test/unit/cloister-manifest.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Cloister topology", () => {
  it("declares isolated work-board and source bundles with an explicit source URL", async () => {
    const cloisterRepo = process.env.CLOISTER_REPO ?? resolve("../../../art/cloister");
    const moduleUrl = pathToFileURL(resolve(cloisterRepo, "scripts/toml-to-cluster.mjs")).href;
    const { parseTomlToCluster } = await import(moduleUrl) as {
      parseTomlToCluster(text: string): Promise<{ bundles: Array<{ name: string; kind: { external?: { env: Array<{ name: string; value: string }> } } }> }>
    };
    const cluster = await parseTomlToCluster(await readFile("cloister/cluster.toml", "utf8"));
    expect(cluster.bundles.map((bundle) => bundle.name)).toEqual([
      "canonical-hours-fixture",
      "work-board"
    ]);
    const board = cluster.bundles[1]!.kind.external!;
    expect(board.env).toContainEqual({
      name: "CANONICAL_HOURS_URL",
      value: "http://canonical-hours-fixture:8790"
    });
    expect(board.env).toContainEqual({
      name: "WORK_BOARD_REFRESH_MODE",
      value: "source-authorized"
    });
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd work-board
CLOISTER_REPO="${CLOISTER_REPO:-../../../art/cloister}" pnpm test:unit -- cloister-manifest.test.ts
```

Expected: FAIL because `cloister/cluster.toml` does not exist.

- [ ] **Step 3: Add package identity and topology**

Create `work-board/server.json`:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.jamestexas.agents-work-board-staging",
  "title": "work-board staging",
  "description": "Workerd-native visual projection of a Canonical Hours board; staged in agents before transfer.",
  "version": "0.1.0",
  "repository": {
    "url": "https://github.com/jamestexas/agents",
    "source": "github"
  },
  "packages": [{
    "registryType": "oci",
    "identifier": "work-board",
    "version": "0.1.0"
  }],
  "_meta": {
    "art.cloister/v1": {
      "bundles": [{
        "name": "work-board",
        "tier": "cluster",
        "kind": "external",
        "package": "work-board",
        "httpPort": 8791,
        "rationale": "Read-only operational UI; no credential or trust mediation."
      }]
    }
  }
}
```

Create `work-board/cloister/cluster.toml`:

```toml
[metadata]
name = "work-board-smoke"
version = "0.1.0"

[[bundles]]
name = "canonical-hours-fixture"
description = "Deterministic Canonical Hours-compatible HTTP source"
kind = "external"
tier = "cluster"

  [bundles.external]
  image = "canonical-hours-fixture:work-board-smoke"
  httpPort = 8790

[[bundles]]
name = "work-board"
description = "Staged workerd UI and BoardSource adapter"
kind = "external"
tier = "cluster"

  [bundles.external]
  image = "work-board:smoke"
  httpPort = 8791
  env = [
    "CANONICAL_HOURS_URL=http://canonical-hours-fixture:8790",
    "WORK_BOARD_FIXTURE=false",
    "WORK_BOARD_REFRESH_MODE=source-authorized"
  ]

[storage]
```

- [ ] **Step 4: Add deterministic source server and images**

Create `work-board/test/fixtures/canonical-hours-server.mjs`:

```js
import { createServer } from "node:http";

let refreshed = false;
const board = () => ({
  generated_at: refreshed ? "2026-07-30T12:01:00Z" : "2026-07-30T12:00:00Z",
  tick_status: "ok",
  degradations: [],
  items: [{
    kind: "pr",
    artifact_uri: "pr:acme/demo#1",
    repo: "acme/demo",
    number: 1,
    title: "Cloister smoke",
    state: "needs_you",
    reason: "typed fixture",
    new_items: [],
    merge_ready: true
  }]
});

createServer((request, response) => {
  if (request.method === "POST" && request.url === "/tick") {
    refreshed = true;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ result: "ok" }));
    return;
  }
  if (request.method === "GET" && request.url === "/board") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(board()));
    return;
  }
  response.writeHead(404).end();
}).listen(8790, "0.0.0.0");
```

Create `work-board/Dockerfile`:

```dockerfile
FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 8791
CMD ["pnpm", "exec", "wrangler", "dev", "--local", "--ip", "0.0.0.0", "--port", "8791"]
```

Create `work-board/cloister/fixture.Dockerfile`:

```dockerfile
FROM node:22-bookworm-slim
WORKDIR /app
COPY test/fixtures/canonical-hours-server.mjs ./server.mjs
EXPOSE 8790
CMD ["node", "server.mjs"]
```

- [ ] **Step 5: Implement the Cloister API/compose smoke**

Create `work-board/scripts/cloister-smoke.mjs`:

```js
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cloister = resolve(root, process.env.CLOISTER_REPO ?? "../../../art/cloister");
const { parseTomlToCluster } = await import(pathToFileURL(join(cloister, "scripts/toml-to-cluster.mjs")));
const { emitCompose } = await import(pathToFileURL(join(cloister, "scripts/emit-compose.mjs")));

const candidates = process.env.COMPOSE_CMD
  ? [process.env.COMPOSE_CMD.trim().split(/\s+/)]
  : [["docker", "compose"], ["podman", "compose"], ["nerdctl", "compose"]];
const compose = candidates.find(([command, ...args]) =>
  spawnSync(command, [...args, "version"], { stdio: "ignore" }).status === 0
);
if (!compose) throw new Error("no compose-capable runtime found");

const [engine, ...composePrefix] = compose;
const temp = mkdtempSync(join(tmpdir(), "work-board-cloister-"));
const composeFile = join(temp, "compose.yaml");
const project = `work-board-${process.pid}`;
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });

const cluster = await parseTomlToCluster(readFileSync(join(root, "cloister/cluster.toml"), "utf8"));
writeFileSync(composeFile, emitCompose(cluster));

try {
  run(engine, ["build", "-t", "work-board:smoke", "-f", "Dockerfile", "."]);
  run(engine, [
    "build", "-t", "canonical-hours-fixture:work-board-smoke",
    "-f", "cloister/fixture.Dockerfile", "."
  ]);
  run(engine, [...composePrefix, "-p", project, "-f", composeFile, "up", "-d"]);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch("http://127.0.0.1:8791/health")).ok) break;
    } catch {}
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 250));
  }

  const beforeResponse = await fetch("http://127.0.0.1:8791/api/board");
  if (!beforeResponse.ok) throw new Error(`board read failed: ${beforeResponse.status}`);
  const before = await beforeResponse.json();
  if (!before.items.some((item) => item.artifactUri === "pr:acme/demo#1")) {
    throw new Error("fixture item missing from normalized board");
  }

  const refreshResponse = await fetch("http://127.0.0.1:8791/api/refresh", { method: "POST" });
  if (!refreshResponse.ok) throw new Error(`refresh failed: ${refreshResponse.status}`);
  const refreshed = await refreshResponse.json();
  if (refreshed.generatedAt !== "2026-07-30T12:01:00Z") {
    throw new Error(`refresh timestamp did not change: ${refreshed.generatedAt}`);
  }

  const ui = await fetch("http://127.0.0.1:8791/board/ui");
  if (!ui.ok || !(await ui.text()).includes("work-board")) {
    throw new Error("board UI asset was not served");
  }
  console.log("cloister smoke ok: read, refresh, UI");
} finally {
  spawnSync(engine, [
    ...composePrefix, "-p", project, "-f", composeFile, "down", "--volumes", "--remove-orphans"
  ], { cwd: root, stdio: "inherit" });
  rmSync(temp, { recursive: true, force: true });
}
```

- [ ] **Step 6: Implement the live-source smoke**

Create `work-board/scripts/live-source-smoke.mjs`:

```js
const boardUrl = process.env.WORK_BOARD_URL ?? "http://127.0.0.1:8791";
if (!process.env.CANONICAL_HOURS_URL) {
  throw new Error("CANONICAL_HOURS_URL is required; start the real Canonical Hours Worker first");
}

const health = await fetch(`${boardUrl}/health`);
if (!health.ok) throw new Error(`work-board health failed: ${health.status}`);
const before = await fetch(`${boardUrl}/api/board`);
if (!before.ok) throw new Error(`real board read failed: ${before.status} ${await before.text()}`);
const refresh = await fetch(`${boardUrl}/api/refresh`, { method: "POST" });
if (!refresh.ok) throw new Error(`real board refresh failed: ${refresh.status} ${await refresh.text()}`);
const board = await refresh.json();
if (!Array.isArray(board.items)) throw new Error("real board response has no items array");
console.log(`live source ok: ${board.items.length} item(s), generated ${board.generatedAt}`);
```

- [ ] **Step 7: Run topology and bundle tests**

Run:

```bash
cd work-board
CLOISTER_REPO="${CLOISTER_REPO:-../../../art/cloister}" pnpm test:unit -- cloister-manifest.test.ts
CLOISTER_REPO="${CLOISTER_REPO:-../../../art/cloister}" pnpm test:cloister
```

Expected: PASS; the smoke logs one successful board read and refresh and leaves no running compose project.

For the real source proof, start Canonical Hours without provider credentials
on port 8790, start work-board with fixture mode disabled,
`CANONICAL_HOURS_URL=http://127.0.0.1:8790`, and
`WORK_BOARD_REFRESH_MODE=source-authorized`, then run:

```bash
cd work-board
CANONICAL_HOURS_URL=http://127.0.0.1:8790 WORK_BOARD_URL=http://127.0.0.1:8791 pnpm test:live
```

Expected: `live source ok: ...` and exit 0.

- [ ] **Step 8: Commit Cloister packaging**

```bash
git add work-board/server.json work-board/Dockerfile work-board/cloister \
  work-board/test/fixtures work-board/test/unit/cloister-manifest.test.ts \
  work-board/scripts/cloister-smoke.mjs work-board/scripts/live-source-smoke.mjs
git commit -m "[agents-151ffb] feat(work-board): prove cloister bundle"
```

---

### Task 7: Remove the local subprocess host and rewrite documentation

**Files:**

- Delete: `work-board/scripts/serve.py`
- Delete: `work-board/scripts/refresh.sh`
- Modify: `work-board/README.md`
- Modify: `README.md`
- Modify: `work-board/.gitignore`

**Interfaces:**

- Consumes: the completed commands and verified runtime from Tasks 1–6.
- Produces: accurate installation/runtime documentation and no active Python/`gh` host path.

- [ ] **Step 1: Write the documentation acceptance assertions**

Before editing, run:

```bash
rg -n "Claude Code Agents & Skills|contains no executable code|serve\\.py|refresh\\.sh|cdn\\.jsdelivr|gh \\+ jq" README.md work-board
```

Expected: matches demonstrate the stale framing and local host references.

- [ ] **Step 2: Rewrite `work-board/README.md`**

Use this section order and concrete content:

````markdown
# work-board

`work-board` is the staging implementation of Canonical Hours' visual board.
It runs as a workerd Worker, reads Canonical Hours through a service binding or
explicit HTTP URL, and serves the UI at `/board/ui`.

This package is intentionally staged in `agents/`. Once the workerd, browser,
live-source, and Cloister proofs pass, its portable files move to
`canonical-hours`. The `/pr-board` skill remains available during that move.

## Run with fixtures

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm dev
open http://127.0.0.1:8787/board/ui
```

## Run with Canonical Hours

Set `WORK_BOARD_FIXTURE=false` and provide either the
`CANONICAL_HOURS` service binding or
`CANONICAL_HOURS_URL=http://127.0.0.1:2000`. Refresh remains disabled unless
fixture mode is active or `WORK_BOARD_REFRESH_MODE=source-authorized` delegates
authorization to the configured source.

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/board/ui` | bundled visual board |
| GET | `/api/board` | validated presentation projection |
| POST | `/api/refresh` | upstream tick followed by board read |
| GET | `/health` | host/source configuration liveness |

## Verification

```bash
pnpm check
pnpm test:e2e
CLOISTER_REPO=../../../art/cloister pnpm test:cloister
CANONICAL_HOURS_URL=http://127.0.0.1:8790 pnpm test:live
```

## Security

The browser receives board data, never provider credentials. The Worker cannot
spawn a CLI. A future CLI collector must run as a sibling Cloister bundle
behind the same fixed `read`/`refresh` source contract.
````

Retain the existing encoding/layout explanation after these operational
sections, updating field names to the normalized camelCase view model.

- [ ] **Step 3: Rewrite the first screen and repository map in root `README.md`**

Replace the opening with:

````markdown
# Agents, skills, and operational tools

This repository is James Gardner's installable agent workspace: specialized
agent definitions, reusable skills, the scripts that validate and symlink
them, and a small number of operational tools developed beside the workflows
they support.

- `agents/` — focused subagent definitions with enforced tool posture.
- `skills/` — user-invocable workflows such as review, handoff, and work-board
  access.
- `scripts/` — lint, generation, and idempotent local installation.
- `work-board/` — a workerd-native UI staged here before transfer to
  Canonical Hours.

## Install

```bash
scripts/install.sh
scripts/install.sh --apply
scripts/install.sh --doctor
```
````

Keep the generated agent/skill tables and their managed markers intact. Update
the creation guidance so it describes agent definitions, skills, and isolated
operational packages separately.

- [ ] **Step 4: Delete the superseded host scripts and update ignores**

Delete:

```text
work-board/scripts/serve.py
work-board/scripts/refresh.sh
```

Remove `data/board.json` and `.env` comments tied only to those scripts from
`work-board/.gitignore`. Keep generated build/test directories ignored.

- [ ] **Step 5: Prove the old path is gone and existing repo lint passes**

Run:

```bash
! rg -n "serve\\.py|refresh\\.sh|cdn\\.jsdelivr|gh \\+ jq" README.md work-board
scripts/build.sh check
cd work-board
pnpm check
pnpm test:e2e
CLOISTER_REPO="${CLOISTER_REPO:-../../../art/cloister}" pnpm test:cloister
git diff --check
```

Expected: no stale-host matches; every command exits 0.

- [ ] **Step 6: Verify transferability and handoff isolation**

Run:

```bash
! rg -n "/Users/|jamestexas/agents|skills/handoff|ADR-003-handoff|handoff-skill-plan" \
  work-board/src work-board/index.html work-board/package.json work-board/wrangler.toml
if git diff --name-only HEAD~6..HEAD | rg -v \
  '^(README\\.md|work-board/|\\.beads/beads\\.jsonl|docs/superpowers/)'; then
  echo "unexpected files changed during work-board implementation" >&2
  exit 1
fi
```

Expected: first command exits 0; second command prints nothing. If fewer than
six implementation commits exist because tasks were combined after review,
replace `HEAD~6` with the first parent of the Task 1 commit.

- [ ] **Step 7: Commit documentation and cleanup**

```bash
git add README.md work-board/README.md work-board/.gitignore
git add -u work-board/scripts/serve.py work-board/scripts/refresh.sh
git commit -m "[agents-151ffb] docs(work-board): document staged runtime"
```

---

### Task 8: Final verification and bead handoff

**Files:**

- No production file changes expected.
- Update through rsry: bead `agents-151ffb`.

**Interfaces:**

- Consumes: all committed implementation tasks.
- Produces: fresh verification evidence and a pushed implementation branch.

- [ ] **Step 1: Run the entire gate from clean processes**

Run:

```bash
scripts/build.sh check
cd work-board
pnpm install --frozen-lockfile
pnpm check
pnpm test:e2e
CLOISTER_REPO="${CLOISTER_REPO:-../../../art/cloister}" pnpm test:cloister
```

Expected: every command exits 0 with no warnings or browser console errors.

- [ ] **Step 2: Run the live Canonical Hours proof**

With real local Canonical Hours and work-board Workers running:

```bash
cd work-board
CANONICAL_HOURS_URL=http://127.0.0.1:8790 \
WORK_BOARD_URL=http://127.0.0.1:8791 \
pnpm test:live
```

Expected: exit 0 with the live board item count and generation timestamp.

- [ ] **Step 3: Verify repository state**

Run:

```bash
git diff --check
git status --short --branch
git log --oneline -8
```

Expected: only known concurrent `.beads`/handoff artifacts may remain
uncommitted; all work-board implementation files are committed.

- [ ] **Step 4: Record verification without closing incomplete work**

Add an rsry comment to `agents-151ffb` containing:

```text
Implementation complete. Verified scripts/build.sh check, pnpm check,
Playwright E2E, Cloister two-bundle read+refresh smoke, and real local
Canonical Hours read+refresh. Portable work-board code has no agents-repo
imports; /pr-board and handoff/session-lifecycle files are unchanged.
```

Close `agents-151ffb` only after the commits are pushed and every command above
has passed.

- [ ] **Step 5: Rebase safely and push**

Do not stash or absorb concurrent handoff bead changes. Fetch first and push
only when the branch is a fast-forward of `origin/main`:

```bash
git fetch origin
git merge-base --is-ancestor origin/main HEAD
git push origin HEAD
git status --short --branch
```

Expected: push succeeds and the branch reports up to date with its upstream.
