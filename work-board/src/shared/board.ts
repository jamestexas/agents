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
  tickStatus: "ok" | "degraded" | "live" | "all_clear" | "example";
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
    tickStatus: board.tick_status,
    degradations: board.degradations.map((d) => typeof d === "string" ? d : `${d.source}: ${d.error}`),
    items: board.items.map((item) => {
      const role = item.role ?? (item.kind === "pr" ? "author" : "participant");
      const waitingOn = item.waiting_on ?? (item.state === "needs_you" ? "me" : "others");
      const activity = item.last_activity
        ?? item.start
        ?? item.new_items?.reduce<string | undefined>((latest, entry) =>
          !latest || Date.parse(entry.at) > Date.parse(latest) ? entry.at : latest,
        undefined)
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
