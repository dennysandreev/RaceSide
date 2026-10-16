import type { GrandPrixRecapData } from "./grand-prix-recap.ts";

// Export uses the report's actual lap samples. Nulls and absent laps begin a
// new segment; neither a missing lap nor a retirement extends a driver's line.
export function buildRecapPositionChart(
  drivers: GrandPrixRecapData["positionDrivers"],
  totalLaps: number,
  width = 1016,
  height = 400,
) {
  const laps = Number.isSafeInteger(totalLaps) && totalLaps > 0 ? totalLaps : 1;
  const field = Math.max(2, drivers.length);
  const left = 44, right = width - 62, top = 10, bottom = height - 34;
  const x = (lap: number) => left + (lap - 1) / Math.max(1, laps - 1) * (right - left);
  const y = (position: number) => top + (position - 1) / (field - 1) * (bottom - top);
  const traces = drivers.map((driver) => {
    const samples = [...new Map(driver.points
      .filter((point) => Number.isSafeInteger(point.lap) && point.lap >= 1 && point.lap <= laps)
      .map((point) => [point.lap, point])).values()]
      .sort((a, b) => a.lap - b.lap);
    let path = "", previousLap: number | null = null;
    const points: Array<{ lap: number; position: number; x: number; y: number }> = [];
    for (const sample of samples) {
      if (sample.value === null || !Number.isInteger(sample.value) || sample.value < 1 || sample.value > field) {
        previousLap = null;
        continue;
      }
      const point = { lap: sample.lap, position: sample.value, x: x(sample.lap), y: y(sample.value) };
      path += previousLap === sample.lap - 1
        ? `H${point.x.toFixed(2)}V${point.y.toFixed(2)}`
        : `M${point.x.toFixed(2)},${point.y.toFixed(2)}`;
      previousLap = sample.lap;
      points.push(point);
    }
    return { ...driver, path, samples: points, last: points.at(-1) ?? null };
  });
  const endLabels = traces.filter((trace) => trace.finished && trace.last)
    .map((trace) => ({ code: trace.code, color: trace.color, point: trace.last!, y: trace.last!.y }))
    .sort((a, b) => a.y - b.y);
  const spacing = Math.min(17, (bottom - top) / Math.max(1, endLabels.length - 1));
  for (let i = 1; i < endLabels.length; i++)
    endLabels[i].y = Math.max(endLabels[i].y, endLabels[i - 1].y + spacing);
  if (endLabels.length) {
    endLabels[endLabels.length - 1].y = Math.min(bottom, endLabels[endLabels.length - 1].y);
    for (let i = endLabels.length - 2; i >= 0; i--)
      endLabels[i].y = Math.min(endLabels[i].y, endLabels[i + 1].y - spacing);
  }
  const lapTicks = [1];
  const step = laps > 80 ? 20 : laps > 20 ? 10 : Math.max(1, Math.round(laps / 5));
  for (let lap = step; lap < laps - step / 2; lap += step)
    if (lap > 1) lapTicks.push(lap);
  if (laps > 1) lapTicks.push(laps);
  const positionTicks = [...new Set([1, ...[5, 10, 15, 20].filter((value) => value < field), field])];
  return {
    width, height, left, right, top, bottom, traces, endLabels,
    lapTicks: lapTicks.map((lap) => ({ value: lap, x: x(lap) })),
    positionTicks: positionTicks.map((position) => ({ value: position, y: y(position) })),
    hasTiming: traces.some((trace) => trace.samples.length > 0),
  };
}
