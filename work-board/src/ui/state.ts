import type { WorkBoardItem } from "../shared/board";

export type BoardFilter = "all" | "author" | "reviewer" | "needs";

function matchesFilter(item: WorkBoardItem, filter: BoardFilter): boolean {
  if (filter === "needs") return item.waitingOn === "me";
  if (filter === "author" || filter === "reviewer") return item.role === filter;
  return true;
}

export function filteredBoardState(
  items: readonly WorkBoardItem[],
  filter: BoardFilter,
  showLowSignal: boolean
): { items: WorkBoardItem[]; lowSignalCount: number } {
  const matching = items.filter((item) => matchesFilter(item, filter));
  return {
    items: showLowSignal ? matching : matching.filter((item) => !item.lowSignal),
    lowSignalCount: matching.filter((item) => item.lowSignal).length
  };
}

export function visibleItems(
  items: readonly WorkBoardItem[],
  filter: BoardFilter,
  showLowSignal: boolean
): WorkBoardItem[] {
  return filteredBoardState(items, filter, showLowSignal).items;
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
