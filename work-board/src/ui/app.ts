/// <reference types="vite/client" />

import "./style.css";
import type { WorkBoardView } from "../shared/board";
import { renderBoard, type LayoutMode, type RenderState } from "./render";
import type { BoardFilter } from "./state";

let state: RenderState | null = null;
let refreshPromise: Promise<void> | null = null;

const controls = document.querySelector<HTMLElement>("#controls")!;
controls.innerHTML = `
  <div class="toggle" aria-label="Layout">
    <button type="button" data-mode="dial" aria-label="dial" aria-pressed="true">◷ dial</button>
    <button type="button" data-mode="sweep" aria-label="sweep" aria-pressed="false">◴ sweep</button>
    <button type="button" data-mode="stack" aria-label="stack" aria-pressed="false">▤ stack</button>
  </div>
  <div class="toggle" aria-label="Filter">
    <button type="button" data-filter="all" aria-pressed="true">all</button>
    <button type="button" data-filter="author" aria-label="mine" aria-pressed="false">mine</button>
    <button type="button" data-filter="reviewer" aria-label="reviewing" aria-pressed="false">reviewing</button>
    <button type="button" data-filter="needs" aria-label="needs me" aria-pressed="false">needs me</button>
  </div>
  <button id="noisebtn" type="button" aria-pressed="false">⌁ low-signal</button>
  <button id="reloadbtn" type="button" aria-busy="false">↻ refresh</button>
`;

function showError(message?: string): void {
  const element = document.querySelector<HTMLElement>("#error")!;
  element.hidden = !message;
  element.textContent = message ?? "";
}

function showStatus(board: WorkBoardView): void {
  const element = document.querySelector<HTMLElement>("#provenance")!;
  element.hidden = false;
  element.dataset.status = board.tickStatus;
  if (board.tickStatus === "example") {
    element.textContent = "EXAMPLE / FIXTURE DATA — this board is not live.";
    return;
  }
  if (board.tickStatus === "degraded") {
    element.textContent = "DEGRADED — one or more sources did not complete.";
    return;
  }
  if (board.tickStatus === "all_clear") {
    element.textContent = "ALL CLEAR — live sources report no outstanding work.";
    return;
  }
  element.textContent = `${board.tickStatus.toUpperCase()} — board source status.`;
}

function showBoardWarnings(board: WorkBoardView): void {
  showStatus(board);
  showError(board.degradations.length
    ? `Degraded board: ${board.degradations.join(" · ")}`
    : undefined);
}

function syncControls(): void {
  if (!state) return;
  controls.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === state!.mode));
  });
  controls.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.filter === state!.filter));
  });
  document.querySelector<HTMLButtonElement>("#noisebtn")!
    .setAttribute("aria-pressed", String(state.showLowSignal));
}

function draw(): void {
  if (!state) return;
  syncControls();
  renderBoard(state);
}

async function requestBoard(
  path: "/api/board" | "/api/refresh",
  method: "GET" | "POST"
): Promise<WorkBoardView> {
  const response = await fetch(path, { method, cache: "no-store" });
  const body = await response.json() as WorkBoardView | { message?: string };
  if (!response.ok) {
    throw new Error("message" in body && body.message ? body.message : `request failed: ${response.status}`);
  }
  return body as WorkBoardView;
}

async function load(): Promise<void> {
  const board = await requestBoard("/api/board", "GET");
  state = { board, mode: "dial", filter: "all", showLowSignal: false };
  showBoardWarnings(board);
  draw();
}

function refresh(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  const button = document.querySelector<HTMLButtonElement>("#reloadbtn")!;
  const idleLabel = "↻ refresh";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "refreshing…";
  refreshPromise = requestBoard("/api/refresh", "POST")
    .then((board) => {
      if (!state) return;
      state = { ...state, board };
      showBoardWarnings(board);
      draw();
    })
    .catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      showError(`${detail} · showing the last successful board.`);
    })
    .finally(() => {
      button.disabled = false;
      button.setAttribute("aria-busy", "false");
      button.textContent = idleLabel;
      refreshPromise = null;
    });
  return refreshPromise;
}

controls.addEventListener("click", (event) => {
  if (!state || !(event.target instanceof HTMLButtonElement)) return;
  if (event.target.dataset.mode) state.mode = event.target.dataset.mode as LayoutMode;
  if (event.target.dataset.filter) state.filter = event.target.dataset.filter as BoardFilter;
  if (event.target.id === "noisebtn") state.showLowSignal = !state.showLowSignal;
  if (event.target.id === "reloadbtn") {
    void refresh();
    return;
  }
  draw();
});

document.querySelector<HTMLButtonElement>("#copybtn")!.addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  const text = document.querySelector("#listtext")!.textContent ?? "";
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "copied ✓";
    window.setTimeout(() => {
      button.textContent = "⧉ copy list";
    }, 1_200);
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("#listtext")!);
    selection?.removeAllRanges();
    selection?.addRange(range);
    button.textContent = "select + copy";
  }
});

void load().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  showError(`Unable to load board: ${detail}`);
});
