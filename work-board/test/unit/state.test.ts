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
