import { createServer } from "node:http";

let refreshed = false;
const board = () => ({
  generated_at: refreshed ? "2026-07-30T12:01:00Z" : "2026-07-30T12:00:00Z",
  tick_status: "ok",
  degradations: [],
  items: [{
    kind: "pr",
    artifact_uri: "pr:acme/demo#1",
    repo: "acme/demo",
    number: 1,
    title: "Cloister smoke",
    state: "needs_you",
    reason: "typed fixture",
    new_items: [],
    merge_ready: true,
  }],
});

createServer((request, response) => {
  if (request.method === "POST" && request.url === "/tick") {
    refreshed = true;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ result: "ok" }));
    return;
  }
  if (request.method === "GET" && request.url === "/board") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(board()));
    return;
  }
  response.writeHead(404).end();
}).listen(8790, "0.0.0.0");
