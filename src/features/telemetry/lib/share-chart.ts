type SpeedPoint = { distance: number; speed: number | null };
export type SpeedExtremum = {
  distance: number;
  value: number;
  kind: "peak" | "low";
};

// A reversal must exceed the threshold so sampling noise does not create labels.
export function speedExtrema(points: SpeedPoint[], reversal = 15): SpeedExtremum[] {
  const result: SpeedExtremum[] = [];
  let high: SpeedExtremum | null = null;
  let low: SpeedExtremum | null = null;
  let direction = 0;
  let previousDistance: number | null = null;
  let segmentStartDistance = 0;
  for (const point of points) {
    if (
      point.speed == null || !Number.isFinite(point.speed) ||
      !Number.isFinite(point.distance) ||
      (previousDistance != null && point.distance - previousDistance > 200)
    ) {
      high = low = null;
      direction = 0;
    }
    previousDistance = point.distance;
    if (point.speed == null || !Number.isFinite(point.speed) || !Number.isFinite(point.distance)) continue;
    const current = { distance: point.distance, value: point.speed };
    if (!high || !low) {
      segmentStartDistance = point.distance;
      high = { ...current, kind: "peak" };
      low = { ...current, kind: "low" };
      continue;
    }
    if (point.speed > high.value) high = { ...current, kind: "peak" };
    if (point.speed < low.value) low = { ...current, kind: "low" };
    if (direction >= 0 && high.value - point.speed >= reversal) {
      if (direction > 0 || high.distance > segmentStartDistance) result.push(high);
      direction = -1;
      low = { ...current, kind: "low" };
    } else if (direction <= 0 && point.speed - low.value >= reversal) {
      if (direction < 0 || low.distance > segmentStartDistance) result.push(low);
      direction = 1;
      high = { ...current, kind: "peak" };
    }
  }
  return result;
}

export function speedAnnotations(points: SpeedPoint[]): SpeedExtremum[] {
  const valid = points.filter((point) => point.speed != null && Number.isFinite(point.speed) && Number.isFinite(point.distance));
  if (valid.length < 3) return [];
  const speeds = valid.map((point) => point.speed!);
  const span = valid[valid.length - 1].distance - valid[0].distance;
  if (span <= 0) return [];
  // Ignore swings below 35 km/h or 18% of this lap's speed range. Keep only
  // the four highest peaks and four deepest lows, spaced by at least 7% of
  // the lap within each kind. Every annotation still points at a real sample.
  const reversal = Math.max(35, (Math.max(...speeds) - Math.min(...speeds)) * 0.18);
  const extrema = speedExtrema(points, reversal);
  const selected: SpeedExtremum[] = [];
  for (const kind of ["peak", "low"] as const) {
    const ranked = extrema.filter((point) => point.kind === kind)
      .sort((a, b) => (kind === "peak" ? b.value - a.value : a.value - b.value) || a.distance - b.distance);
    const kept: SpeedExtremum[] = [];
    for (const point of ranked) {
      if (kept.every((other) => Math.abs(other.distance - point.distance) >= span * 0.07)) kept.push(point);
      if (kept.length === 4) break;
    }
    selected.push(...kept);
  }
  return selected.sort((a, b) => a.distance - b.distance);
}

export function speedAtDistance(points: SpeedPoint[], distance: number) {
  const next = points.findIndex((point) => point.distance >= distance);
  if (next < 0) return null;
  const b = points[next];
  if (b.distance === distance) return Number.isFinite(b.speed) ? b.speed : null;
  if (next === 0) return null;
  const a = points[next - 1];
  if (
    a.speed == null || b.speed == null ||
    !Number.isFinite(a.speed) || !Number.isFinite(b.speed) ||
    b.distance - a.distance > 200
  ) return null;
  return a.speed + (b.speed - a.speed) *
    ((distance - a.distance) / (b.distance - a.distance));
}
