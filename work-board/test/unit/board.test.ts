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
