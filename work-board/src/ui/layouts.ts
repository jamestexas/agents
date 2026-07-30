import type { WorkBoardItem } from "../shared/board";

export interface Point extends WorkBoardItem {
  x: number;
  y: number;
  angle: number;
  radius: number;
}

const CX = 450;
const CY = 360;
const INNER = 72;
const OUTER = 270;
const MAX_AGE_HOURS = 48;
const stateAngle = { opened: 0, active: 90, needs_you: 180, resolved: 270 } as const;

const ageHours = (item: WorkBoardItem, now: number) =>
  Math.max(0, (now - Date.parse(item.lastActivity)) / 3_600_000);

function polar(angle: number, radius: number): [number, number] {
  const radians = (angle - 90) * Math.PI / 180;
  return [CX + radius * Math.cos(radians), CY + radius * Math.sin(radians)];
}

export function dialLayout(items: readonly WorkBoardItem[], now: number): Point[] {
  const groups = new Map<WorkBoardItem["state"], WorkBoardItem[]>();
  for (const item of items) {
    const group = groups.get(item.state) ?? [];
    group.push(item);
    groups.set(item.state, group);
  }
  return items.map((item) => {
    const group = groups.get(item.state) ?? [item];
    const index = group.findIndex((entry) => entry.artifactUri === item.artifactUri);
    const step = group.length > 1 ? Math.min(18, 76 / (group.length - 1)) : 0;
    const angle = stateAngle[item.state] + (index - (group.length - 1) / 2) * step;
    const radius = INNER + Math.min(ageHours(item, now), MAX_AGE_HOURS) / MAX_AGE_HOURS * (OUTER - INNER);
    const [x, y] = polar(angle, radius);
    return { ...item, x, y, angle, radius };
  });
}

export function sweepLayout(items: readonly WorkBoardItem[], now: number): Point[] {
  return items.map((item, index) => {
    const angle = Math.min(ageHours(item, now), MAX_AGE_HOURS) / MAX_AGE_HOURS * 300;
    const radius = INNER + 70 + (item.state === "needs_you" ? 54 : 0) + (index * 26) % 88;
    const [x, y] = polar(angle, radius);
    return { ...item, x, y, angle, radius };
  });
}

export function stackLayout(items: readonly WorkBoardItem[], now: number) {
  const futureEvents = items.filter((item) =>
    item.kind === "event" && Date.parse(item.lastActivity) > now
  )
    .toSorted((a, b) => Date.parse(a.lastActivity) - Date.parse(b.lastActivity));
  const presentAndPast = items.filter((item) =>
    item.kind !== "event" || Date.parse(item.lastActivity) <= now
  )
    .toSorted((a, b) => Date.parse(b.lastActivity) - Date.parse(a.lastActivity));
  const ordered = [...futureEvents, ...presentAndPast];
  const rowHeight = Math.max(24, Math.min(46, (700 - 64) / Math.max(ordered.length + 1, 1)));
  return {
    nowMarkers: 1,
    nowY: 64 + futureEvents.length * rowHeight + rowHeight * 0.5,
    rows: ordered.map((item, index) => ({
      ...item,
      y: 64 + (index + (index >= futureEvents.length ? 1 : 0)) * rowHeight,
      future: Date.parse(item.lastActivity) > now
    }))
  };
}
