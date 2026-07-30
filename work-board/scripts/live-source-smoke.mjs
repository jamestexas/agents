const boardUrl = process.env.WORK_BOARD_URL ?? "http://127.0.0.1:8791";
if (!process.env.CANONICAL_HOURS_URL) {
  throw new Error("CANONICAL_HOURS_URL is required; start the real Canonical Hours Worker first");
}

const health = await fetch(`${boardUrl}/health`);
if (!health.ok) throw new Error(`work-board health failed: ${health.status}`);
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
console.log(`live source ok: ${board.items.length} item(s), generated ${board.generatedAt}`);
