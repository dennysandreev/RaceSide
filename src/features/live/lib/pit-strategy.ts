import type { DriverLiveState, LiveSessionState, LiveStint } from "./types";

export type LivePit = LiveSessionState["pits"][number];
export type TyreSegment = {
  id: string;
  start: number;
  end: number;
  compound: string | null;
  ageAtStart: number | null;
  estimated: boolean;
};

// A stint is a tyre set, not a compound. Equal compounds must stay separate.
export function tyreSegments(driver: DriverLiveState, stints: LiveStint[], pits: LivePit[], race: boolean): TyreSegment[] {
  const completed = Math.max(0, driver.lap - 1);
  if (!completed) return [];
  const stops = pits.filter((pit) => pit.driverNumber === driver.driverNumber && pit.lap > 0 && pit.lap <= completed).sort((a, b) => a.lap - b.lap);
  const starts = stints.filter((stint) => stint.driverNumber === driver.driverNumber && stint.startLap > 0 && stint.startLap <= driver.lap).sort((a, b) => a.startLap - b.startLap || a.stintNumber - b.stintNumber);
  const boundaries = new Map<number, { id: string; compound: string | null; ageAtStart: number | null; estimated: boolean; endLap?: number | null }>();
  for (const stint of starts) boundaries.set(stint.startLap, {
    id: `stint-${driver.driverNumber}-${stint.stintNumber}`,
    compound: stint.compound, ageAtStart: stint.ageAtStart, estimated: false, endLap: stint.endLap,
  });
  if (!boundaries.size) boundaries.set(1, {
    id: `initial-${driver.driverNumber}`, compound: stops[0]?.before ?? (stops.length ? null : driver.compound),
    ageAtStart: stops.length || driver.tyreAge == null ? null : Math.max(0, driver.tyreAge - completed), estimated: true,
  });
  if (race) for (const pit of stops) {
    const start = pit.lap + 1;
    if (pit.duration === 0 || start > completed || boundaries.has(start)) continue;
    // A late stint update must not stretch the previous set past a new pit.
    // Until confirmed, leave its replacement compound unknown.
    boundaries.set(start, { id: `pit-set-${pit.id}`, compound: pit.after, ageAtStart: null, estimated: true });
  }
  const ordered = [...boundaries].sort((a, b) => a[0] - b[0]);
  return ordered.map(([start, set], index) => ({
    ...set, start,
    end: Math.min(completed, (ordered[index + 1]?.[0] ?? completed + 1) - 1, set.endLap ?? completed),
  })).filter((segment) => segment.end >= segment.start - 1);
}

export function pitTyres(pit: LivePit, segments: TyreSegment[]) {
  const before = segments.find((segment) => segment.start <= pit.lap && segment.end >= pit.lap);
  const after = segments.find((segment) => segment.start === pit.lap + 1 || (segment.start <= pit.lap + 1 && segment.end >= pit.lap + 1));
  return {
    before: before?.compound ?? pit.before,
    after: after?.compound ?? pit.after,
    ageBefore: before?.ageAtStart == null ? null : before.ageAtStart + pit.lap - before.start + 1,
    lapsBefore: before ? pit.lap - before.start + 1 : null,
    changed: after !== undefined && before !== undefined && after.id !== before.id,
    confirmedChange: after !== undefined && !after.estimated && after.start === pit.lap + 1,
  };
}

export const pitSeconds = (seconds: number | null, digits = 2) =>
  seconds !== null && Number.isFinite(seconds) && seconds >= 0 ? `${seconds.toFixed(digits).replace(".", ",")} с` : "—";
