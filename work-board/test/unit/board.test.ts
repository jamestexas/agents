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

  it("preserves the example fixture status for the UI banner", () => {
    const board = normalizeBoard({
      generated_at: "2026-07-30T12:00:00Z",
      tick_status: "example",
      items: []
    });

    expect(board.tickStatus).toBe("example");
  });

  it("uses chronological time rather than ISO text order for activity entries", () => {
    const board = normalizeBoard({
      generated_at: "2026-07-30T12:00:00Z",
      tick_status: "ok",
      items: [{
        kind: "pr",
        title: "mixed timestamp offsets",
        state: "active",
        new_items: [
          { at: "2026-07-30T11:00:00+02:00" },
          { at: "2026-07-30T10:00:00Z" }
        ]
      }]
    });

    expect(board.items[0]).toMatchObject({
      lastActivity: "2026-07-30T10:00:00Z"
    });
  });

  it("normalizes HTTP artifact URLs before exposing them to the browser", () => {
    const board = normalizeBoard({
      generated_at: "2026-07-30T12:00:00Z",
      tick_status: "ok",
      items: [{
        kind: "pr",
        title: "normalized artifact",
        url: "HTTPS://Example.COM:443/pulls/../pull/7?view=review#files",
        state: "active"
      }]
    });

    expect(board.items[0]?.url).toBe(
      "https://example.com/pull/7?view=review#files"
    );
  });

  it.each([
    "javascript:alert(document.domain)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "custom://artifact/7"
  ])("rejects a non-HTTP artifact URL: %s", (url) => {
    expect(() => normalizeBoard({
      generated_at: "2026-07-30T12:00:00Z",
      tick_status: "ok",
      items: [{
        kind: "pr",
        title: "unsafe artifact",
        url,
        state: "active"
      }]
    })).toThrow();
  });

  it("rejects invalid timestamps and unknown kinds", () => {
    expect(() => normalizeBoard({
      generated_at: "not-a-time",
      tick_status: "ok",
      items: [{ kind: "mystery" }]
    })).toThrow();
  });
  it("gives recurring same-titled events distinct identities", () => {
    // A calendar event carries no repo and no number, so the synthesized
    // identity fell back to `kind:local#title` and every occurrence of a
    // recurring meeting shared it. render.ts joins on this as D3's key, where
    // duplicates are dropped from the join — the second standup was not drawn
    // at all, and the board looked correct because nothing reported a loss.
    const view = normalizeBoard({
      generated_at: "2026-07-30T12:00:00Z",
      tick_status: "ok",
      items: [
        { kind: "event", title: "standup", state: "active", last_activity: "2026-07-30T09:00:00Z" },
        { kind: "event", title: "standup", state: "active", last_activity: "2026-07-30T11:00:00Z" }
      ]
    });
    const uris = view.items.map((item) => item.artifactUri);
    expect(new Set(uris).size).toBe(2);
  });

  it("leaves a numbered artifact's identity free of the activity time", () => {
    // The control for the case above, and the reason the time is not simply
    // appended everywhere: a number already discriminates, and folding activity
    // into the key would re-enter a PR on every update instead of transitioning
    // it — object constancy lost to fix a collision that does not exist here.
    const identity = (lastActivity: string) => normalizeBoard({
      generated_at: "2026-07-30T12:00:00Z",
      tick_status: "ok",
      items: [{
        kind: "pr", repo: "acme/demo", number: 7, title: "renamed since",
        state: "active", last_activity: lastActivity
      }]
    }).items[0]!.artifactUri;

    expect(identity("2026-07-30T09:00:00Z")).toBe("pr:acme/demo#7");
    // Same artifact, later activity, same key.
    expect(identity("2026-07-30T11:00:00Z")).toBe(identity("2026-07-30T09:00:00Z"));
  });
});
