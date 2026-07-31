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
        return Response.json({ result: "example" });
      }
      return Response.json(fixtureBoard(fixtureRefreshed));
    }
    const base = env.CANONICAL_HOURS_URL?.replace(/\/$/, "") ?? "https://canonical-hours.internal";
    const url = `${base}${path}`;
    if (env.CANONICAL_HOURS) {
      return env.CANONICAL_HOURS.fetch(new Request(url, { method, headers: auth, signal }));
    }
    return fetchImpl(url, { method, headers: auth, signal });
  };

  const read = async (signal: AbortSignal, refreshed: boolean): Promise<BoardSourceResult> => {
    let response: Response;
    try {
      response = await call("/board", "GET", signal);
    } catch (error) {
      if (error instanceof BoardSourceError) throw error;
      if (signal.aborted) throw new BoardSourceError("board source timed out", "timeout", 504);
      throw new BoardSourceError(error instanceof Error ? error.message : String(error), "upstream", 502);
    }
    if (!response.ok) {
      throw new BoardSourceError(`board source returned ${response.status}`, "upstream", 502);
    }
    try {
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
      try {
        const response = await call("/tick", "POST", signal);
        if (!response.ok) throw new BoardSourceError(`tick source returned ${response.status}`, "upstream", 502);
        return read(signal, true);
      } catch (error) {
        if (error instanceof BoardSourceError) throw error;
        if (signal.aborted) throw new BoardSourceError("board source timed out", "timeout", 504);
        throw new BoardSourceError(error instanceof Error ? error.message : String(error), "upstream", 502);
      }
    }
  };
}
