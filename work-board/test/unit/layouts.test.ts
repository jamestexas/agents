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

  it("places future events above now and past events below now", () => {
    const result = stackLayout([
      { ...base, kind: "event", artifactUri: "future", lastActivity: "2026-07-30T13:00:00Z" },
      { ...base, kind: "event", artifactUri: "past", lastActivity: "2026-07-30T11:00:00Z" },
      base
    ], Date.parse("2026-07-30T12:00:00Z"));
    const future = result.rows.find((row) => row.artifactUri === "future")!;
    const past = result.rows.find((row) => row.artifactUri === "past")!;

    expect(future.future).toBe(true);
    expect(future.y).toBeLessThan(result.nowY);
    expect(past.future).toBe(false);
    expect(past.y).toBeGreaterThan(result.nowY);
  });
});
