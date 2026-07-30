const boardUrl = process.env.WORK_BOARD_URL ?? "http://127.0.0.1:8791";
if (!process.env.CANONICAL_HOURS_URL) {
  throw new Error("CANONICAL_HOURS_URL is required; start the real Canonical Hours Worker first");
}

const health = await fetch(`${boardUrl}/health`);
if (!health.ok) throw new Error(`work-board health failed: ${health.status}`);
const healthBody = await health.json();
if (healthBody.source !== "http") {
  throw new Error("work-board is not using the required real HTTP source");
}
const before = await fetch(`${boardUrl}/api/board`);
if (!before.ok) {
  throw new Error(`real board read failed: ${before.status} ${await before.text()}`);
}
const refresh = await fetch(`${boardUrl}/api/refresh`, { method: "POST" });
if (!refresh.ok) {
  throw new Error(`real board refresh failed: ${refresh.status} ${await refresh.text()}`);
}
const board = await refresh.json();
if (!Array.isArray(board.items)) throw new Error("real board response has no items array");
if (board.tickStatus === "example") {
  throw new Error("real board response was produced by example fixture mode");
}
console.log(`live source ok: ${board.items.length} item(s), generated ${board.generatedAt}`);
