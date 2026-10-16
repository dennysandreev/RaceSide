import type { Comparison, Point } from "./types";

function interpolatePosition(
  points: Point[], value: number, axis: "distance" | "elapsed",
  result: "distance" | "elapsed",
  maxGapSeconds: number,
) {
  if (!points.length || !Number.isFinite(value)) return null;
  const first = points[0], last = points[points.length - 1];
  if (Number.isFinite(first[axis]) && value <= first[axis])
    return Number.isFinite(first[result]) ? first[result] : null;
  if (Number.isFinite(last[axis]) && value >= last[axis])
    return Number.isFinite(last[result]) ? last[result] : null;
  let left = 0;
  let right = points.length - 1;
  if (axis === "elapsed") {
    // Missing timing samples are null in the API payload, so they cannot be
    // treated as zero by a binary search or interpolated across.
    right = points.findIndex((point) => Number.isFinite(point.elapsed) && point.elapsed >= value);
    if (right < 0) return null;
    left = Math.max(0, right - 1);
  } else {
    while (left + 1 < right) {
      const middle = Math.floor((left + right) / 2);
      if (points[middle][axis] < value) left = middle;
      else right = middle;
    }
  }
  const a = points[left], b = points[right];
  if (value === b[axis]) return Number.isFinite(b[result]) ? b[result] : null;
  if (!Number.isFinite(a.elapsed) || !Number.isFinite(b.elapsed) ||
    !Number.isFinite(a[result]) || !Number.isFinite(b[result]) || b.elapsed - a.elapsed > maxGapSeconds)
    return null;
  const ratio = (value - a[axis]) / (b[axis] - a[axis] || 1);
  return a[result] + (b[result] - a[result]) * ratio;
}

function timingLimit(trace: Comparison["traces"][number]) {
  // Chart compaction may put valid samples more than two seconds apart in a
  // slow corner. Quality describes the original samples, before compaction.
  return trace.quality?.comparable && trace.quality.maxGapSeconds <= 1.5 ? Infinity : 2;
}

// Lap starts are aligned at t=0; timestamp would compare unrelated sessions.
export function trackPositionsAtCursor(comparison: Comparison, distance: number) {
  const reference = comparison.traces[comparison.config.reference];
  const elapsed = reference ? interpolatePosition(reference.points, distance, "distance", "elapsed", timingLimit(reference)) : null;
  const positions = comparison.traces.map((trace) => elapsed == null ? null
    : interpolatePosition(trace.points, elapsed, "elapsed", "distance", timingLimit(trace)));
  const times = comparison.traces.map((trace) => interpolatePosition(trace.points, distance, "distance", "elapsed", timingLimit(trace)));
  const timeGap = times[0] == null || times[1] == null ? null : times[1] - times[0];
  const distanceGap = positions[0] == null || positions[1] == null ? null : positions[0] - positions[1];
  return { elapsed, positions, timeGap, distanceGap };
}
