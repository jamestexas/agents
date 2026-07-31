import example from "../../data/board.example.json";

export function fixtureBoard(refreshed = false): unknown {
  return {
    ...example,
    generated_at: refreshed ? "2026-01-01T09:01:00Z" : example.generated_at,
    tick_status: "example",
    degradations: []
  };
}
