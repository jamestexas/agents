import { createHash } from "node:crypto";

const boardUrl = process.env.WORK_BOARD_URL ?? "http://127.0.0.1:8791";
const declaredSource = process.env.CANONICAL_HOURS_URL;
if (!declaredSource) {
  throw new Error("CANONICAL_HOURS_URL is required; start the real Canonical Hours Worker first");
}

function sourceBoardEndpoint() {
  let url;
  try {
    url = new URL(declaredSource);
  } catch {
    throw new Error("CANONICAL_HOURS_URL must be a valid HTTP(S) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("CANONICAL_HOURS_URL must be a valid HTTP(S) URL");
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/board`;
  return url;
}

async function readJson(url, label, init) {
  let response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error(`${label} request failed`);
  }
  if (!response.ok) throw new Error(`${label} failed: ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function sourceSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("declared source board is not an object");
  }
  const generatedAt = value.generated_at;
  if (typeof generatedAt !== "string" || !Number.isFinite(Date.parse(generatedAt))) {
    throw new Error("declared source board has no valid generated_at");
  }
  return {
    generatedAt,
    marker: createHash("sha256").update(JSON.stringify(value)).digest("hex")
  };
}

function workBoardSnapshot(value, label) {
  if (!value || typeof value !== "object" || !Array.isArray(value.items)) {
    throw new Error(`${label} response has no items array`);
  }
  if (typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))) {
    throw new Error(`${label} response has no valid generatedAt`);
  }
  return value;
}

const healthBody = await readJson(`${boardUrl}/health`, "work-board health");
if (healthBody.source !== "http") {
  throw new Error("work-board is not using the required real HTTP source");
}

const sourceEndpoint = sourceBoardEndpoint();
const sourceBefore = sourceSnapshot(
  await readJson(sourceEndpoint, "declared source board read")
);
const boardBefore = workBoardSnapshot(
  await readJson(`${boardUrl}/api/board`, "real board read"),
  "real board"
);
if (boardBefore.generatedAt !== sourceBefore.generatedAt) {
  throw new Error("work-board snapshot does not match the declared source before refresh");
}

const board = workBoardSnapshot(
  await readJson(`${boardUrl}/api/refresh`, "real board refresh", { method: "POST" }),
  "real board"
);
if (board.tickStatus === "example") {
  throw new Error("real board response was produced by example fixture mode");
}

const sourceAfter = sourceSnapshot(
  await readJson(sourceEndpoint, "declared source board read")
);
if (sourceAfter.marker === sourceBefore.marker) {
  throw new Error("declared source snapshot did not change after refresh");
}
if (sourceAfter.generatedAt === sourceBefore.generatedAt) {
  throw new Error("declared source generated_at did not change after refresh");
}
if (board.generatedAt !== sourceAfter.generatedAt) {
  throw new Error("refreshed work-board does not match the declared source generated_at");
}

console.log(`live source ok: ${board.items.length} item(s), generated ${board.generatedAt}`);
