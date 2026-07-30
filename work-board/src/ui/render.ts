import * as d3 from "d3";
import type { WorkBoardItem, WorkBoardView } from "../shared/board";
import { dialLayout, stackLayout, sweepLayout } from "./layouts";
import { actionList, visibleItems, type BoardFilter } from "./state";

export type LayoutMode = "dial" | "sweep" | "stack";

export interface RenderState {
  board: WorkBoardView;
  mode: LayoutMode;
  filter: BoardFilter;
  showLowSignal: boolean;
}

const stateColor: Record<WorkBoardItem["state"], string> = {
  opened: "#8b949e",
  active: "#1f6feb",
  needs_you: "#f85149",
  resolved: "#238636"
};

const stateAngle: Record<WorkBoardItem["state"], number> = {
  opened: 0,
  active: 90,
  needs_you: 180,
  resolved: 270
};

const stateSubtitle: Record<WorkBoardItem["state"], string> = {
  opened: "no reviews yet",
  active: "in review",
  needs_you: "your move",
  resolved: "done"
};

const actionColor: Record<NonNullable<WorkBoardItem["nextAction"]>, string> = {
  merge: "#238636",
  ci: "#f0883e",
  respond: "#a371f7",
  review: "#58a6ff",
  promote: "#8b949e",
  attend: "#d2a8ff"
};

const modeNotes: Record<LayoutMode, string> = {
  dial: "Quadrant is state; radius is staleness. Obligations drift toward the rim as they age.",
  sweep: "Angle is recency from the top; state remains encoded by colour.",
  stack: "Future events sit above now; open work descends from freshest to stalest."
};

const modeAxes: Record<LayoutMode, string> = {
  dial: "<span><b>quadrant</b> state</span><span><b>radius</b> staleness</span><span><b>label</b> next action</span>",
  sweep: "<span><b>angle</b> recency</span><span><b>colour</b> state</span><span><b>fill</b> responsibility</span>",
  stack: "<span><b>vertical</b> time</span><span><b>shape</b> role</span><span><b>tag</b> next action</span>"
};

function symbolFor(item: WorkBoardItem): d3.SymbolType {
  if (item.kind === "event") return d3.symbolSquare;
  return item.role === "reviewer" ? d3.symbolDiamond : d3.symbolCircle;
}

function glyph(item: WorkBoardItem): string {
  return d3.symbol(symbolFor(item), item.state === "needs_you" || item.kind === "event" ? 300 : 210)() ?? "";
}

function polar(angle: number, radius: number): [number, number] {
  const radians = (angle - 90) * Math.PI / 180;
  return [450 + radius * Math.cos(radians), 360 + radius * Math.sin(radians)];
}

function arcPath(from: number, to: number, radius: number): string {
  const [x0, y0] = polar(from, radius);
  const [x1, y1] = polar(to, radius);
  return `M450,360 L${x0},${y0} A${radius},${radius} 0 0,1 ${x1},${y1} Z`;
}

function addDialScaffold(
  svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>,
  mode: Exclude<LayoutMode, "stack">
): void {
  if (mode === "dial") {
    svg.append("path").attr("d", arcPath(135, 225, 270)).attr("fill", "#f8514910");
    [45, 135, 225, 315].forEach((angle) => {
      const [x, y] = polar(angle, 270);
      svg.append("line")
        .attr("x1", 450).attr("y1", 360).attr("x2", x).attr("y2", y)
        .attr("stroke", "#1c2128");
    });
  }

  [72, 171, 270].forEach((radius, index) => {
    svg.append("circle")
      .attr("cx", 450).attr("cy", 360).attr("r", radius)
      .attr("fill", "none")
      .attr("stroke", index === 2 ? "#30363d" : "#1c2128");
  });

  if (mode === "dial") {
    (Object.keys(stateAngle) as WorkBoardItem["state"][]).forEach((state) => {
      const [x, y] = polar(stateAngle[state], 296);
      svg.append("text")
        .attr("class", "quadrant")
        .attr("x", x).attr("y", y)
        .attr("text-anchor", "middle")
        .attr("fill", stateColor[state])
        .text(state.toUpperCase().replace("_", " "));
      svg.append("text")
        .attr("class", "zone-sub")
        .attr("x", x).attr("y", y + 14)
        .attr("text-anchor", "middle")
        .text(stateSubtitle[state]);
    });
    ([[72, "now"], [171, "~1d"], [270, "2d+ stale"]] as const).forEach(([radius, label]) => {
      const [x, y] = polar(315, radius);
      svg.append("text")
        .attr("class", "ring-label")
        .attr("x", x - 6).attr("y", y)
        .attr("text-anchor", "end")
        .text(label);
    });
  } else {
    ["now", "~12h", "~1d", "~2d+"].forEach((label, index) => {
      const [x, y] = polar(index * 75, 294);
      svg.append("text")
        .attr("class", "ring-label")
        .attr("x", x).attr("y", y)
        .attr("text-anchor", "middle")
        .text(label);
    });
  }
}

function styleGlyph<T extends WorkBoardItem, P extends d3.BaseType>(
  path: d3.Selection<SVGPathElement, T, P, unknown>
): void {
  path
    .attr("d", glyph)
    .attr("fill", (item) => item.waitingOn === "me" ? "currentColor" : "none")
    .attr("stroke", (item) => item.mergeReady ? "#238636" : "currentColor")
    .attr("stroke-width", (item) => item.mergeReady ? 3 : item.waitingOn === "me" ? 1.2 : 2.2)
    .attr("stroke-dasharray", (item) => item.isDraft ? "3,2.5" : null);
}

function tooltipText(item: WorkBoardItem): string {
  const identity = item.kind === "event"
    ? "square event"
    : item.role === "reviewer" ? "diamond reviewer" : "circle author";
  const responsibility = item.waitingOn === "me" ? "waiting on you" : "waiting on others";
  const id = item.number ? `#${item.number} · ` : "";
  return `${id}${item.title} · ${item.repo ?? "work item"} · ${identity} · ${responsibility} · ${item.reason || item.state}`;
}

function addTooltip<T extends WorkBoardItem, P extends d3.BaseType>(
  nodes: d3.Selection<SVGGElement, T, P, unknown>
): void {
  const tooltip = d3.select<HTMLElement, unknown>("#tip");
  const show = (event: MouseEvent | FocusEvent, item: WorkBoardItem) => {
    const [x, y] = event instanceof MouseEvent ? [event.clientX, event.clientY] : [24, 24];
    tooltip
      .attr("hidden", null)
      .style("left", `${x + 12}px`)
      .style("top", `${y + 12}px`)
      .text(tooltipText(item));
  };
  nodes
    .attr("aria-label", tooltipText)
    .on("mouseenter focus", show)
    .on("mousemove", show)
    .on("mouseleave blur", () => tooltip.attr("hidden", ""))
    .on("click", (_event, item) => {
      if (item.url) window.open(item.url, "_blank", "noopener,noreferrer");
    });
}

function renderDial(
  svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>,
  items: readonly WorkBoardItem[],
  mode: Exclude<LayoutMode, "stack">,
  now: number
): void {
  addDialScaffold(svg, mode);
  const points = mode === "dial" ? dialLayout(items, now) : sweepLayout(items, now);
  const nodes = svg.selectAll<SVGGElement, WorkBoardItem>("g.node")
    .data(points, (item) => item.artifactUri)
    .join("g")
    .attr("class", "node")
    .attr("tabindex", 0)
    .attr("color", (item) => stateColor[item.state])
    .attr("transform", (item) => `translate(${item.x},${item.y})`);

  styleGlyph(nodes.append("path"));
  nodes.append("text")
    .attr("class", "number")
    .attr("y", -17)
    .attr("text-anchor", "middle")
    .text((item) => item.number ? `#${item.number}` : item.title);
  nodes.append("text")
    .attr("class", "action")
    .attr("y", 25)
    .attr("text-anchor", "middle")
    .attr("fill", (item) => item.nextAction ? actionColor[item.nextAction] : "transparent")
    .text((item) => item.nextAction ?? "");
  addTooltip(nodes);
}

function formatAge(item: WorkBoardItem, now: number): string {
  const hours = (now - Date.parse(item.lastActivity)) / 3_600_000;
  if (item.kind === "event" && hours < 0) return `in ${Math.max(1, Math.round(-hours))}h`;
  if (hours < 1.5) return "just now";
  if (hours < 48) return `~${Math.round(hours)}h ago`;
  return `~${Math.round(hours / 24)}d ago`;
}

function renderStack(
  svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>,
  items: readonly WorkBoardItem[],
  now: number
): void {
  const layout = stackLayout(items, now);
  svg.append("line")
    .attr("data-now-line", "")
    .attr("x1", 60).attr("x2", 840)
    .attr("y1", layout.nowY).attr("y2", layout.nowY)
    .attr("stroke", "#f0883e")
    .attr("stroke-dasharray", "4,4")
    .attr("opacity", 0.8);
  svg.append("text")
    .attr("class", "axis-caption")
    .attr("x", 60).attr("y", layout.nowY - 7)
    .attr("fill", "#f0883e")
    .text("— now · upcoming ↑ · open work ages ↓");

  const nodes = svg.selectAll<SVGGElement, WorkBoardItem>("g.node")
    .data(layout.rows, (item) => item.artifactUri)
    .join("g")
    .attr("class", "node")
    .attr("tabindex", 0)
    .attr("color", (item) => stateColor[item.state])
    .attr("transform", (item) => `translate(0,${item.y})`);

  nodes.append("rect")
    .attr("class", "row-hit")
    .attr("x", 56).attr("y", -15)
    .attr("width", 788).attr("height", 30)
    .attr("rx", 6);
  styleGlyph(nodes.append("path").attr("transform", "translate(90,0)"));
  nodes.append("text")
    .attr("class", "action")
    .attr("x", 118).attr("dy", 4)
    .attr("fill", (item) => item.nextAction ? actionColor[item.nextAction] : "transparent")
    .text((item) => item.nextAction ?? "");
  nodes.append("text")
    .attr("class", "row-title")
    .attr("x", 196).attr("dy", 4)
    .attr("fill", (item) => item.waitingOn === "me" ? "#e6edf3" : "#8b949e")
    .text((item) => `${item.number ? `#${item.number}  ` : ""}${item.title}`);
  nodes.append("text")
    .attr("class", "row-age")
    .attr("x", 832).attr("dy", 4)
    .attr("text-anchor", "end")
    .text((item) => formatAge(item, now));
  addTooltip(nodes);
}

export function renderBoard(state: RenderState, now = Date.parse(state.board.generatedAt)): void {
  const items = visibleItems(state.board.items, state.filter, state.showLowSignal);
  const svg = d3.select<SVGSVGElement, unknown>("#dial").attr("data-mode", state.mode);
  svg.selectAll("*").remove();

  if (state.mode === "stack") renderStack(svg, items, now);
  else renderDial(svg, items, state.mode, now);

  const need = items.filter((item) => item.waitingOn === "me");
  const monitoring = items.filter((item) => item.waitingOn === "others");
  const reviewing = items.filter((item) => item.role === "reviewer");
  document.querySelector("#meta")!.textContent =
    `${items.length} items · ${need.length} need you · ${monitoring.length} monitoring · ${reviewing.length} reviewing`
    + ` · ${state.board.generatedAt.slice(0, 16).replace("T", " ")}`;
  document.querySelector("#listtext")!.textContent = actionList(items);
  document.querySelector<HTMLElement>("#empty")!.hidden = items.length !== 0;
  document.querySelector<HTMLElement>("#note")!.textContent = modeNotes[state.mode];
  document.querySelector<HTMLElement>("#axes")!.innerHTML = modeAxes[state.mode];
  document.querySelector<HTMLElement>("#listwrap")!.hidden = state.mode === "stack";
}
