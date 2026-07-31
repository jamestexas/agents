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
    return request.method === "GET"
      ? boardResponse(request, env, false)
      : json({ error: "method_not_allowed", message: "method not allowed" }, 405);
  }
  if (url.pathname === "/api/refresh") {
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed", message: "method not allowed" }, 405);
    }
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
  return json({ error: "not_found", message: "route not found" }, 404);
}

export default {
  fetch: handleRequest
} satisfies ExportedHandler<Env>;
