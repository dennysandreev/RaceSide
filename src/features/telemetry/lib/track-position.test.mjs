import test from "node:test";
import assert from "node:assert/strict";
import { trackPositionsAtCursor } from "./track-position.ts";

const comparison = (reference = 0) => ({
  config: { reference },
  traces: [10, 12].map((duration) => ({
    points: Array.from({ length: 11 }, (_, index) => ({ distance: index * 100, elapsed: index * duration / 10 })),
  })),
});
test("map markers show different distances at the same lap time and respect the reference", () => {
  const normal = trackPositionsAtCursor(comparison(), 600);
  assert.equal(normal.elapsed, 6);
  assert.deepEqual(normal.positions, [600, 500]);
  assert.ok(Math.abs(normal.timeGap - 1.2) < 1e-10);
  const reversed = trackPositionsAtCursor(comparison(1), 500);
  assert.deepEqual(reversed.positions, normal.positions);
  assert.equal(reversed.timeGap, 1);
});
test("identical laps coincide, finish clamps and unavailable timing does not invent a position", () => {
  const data = comparison();
  data.traces[1] = data.traces[0];
  assert.deepEqual(trackPositionsAtCursor(data, 450).positions, [450, 450]);
  assert.deepEqual(trackPositionsAtCursor(data, 1000).positions, [1000, 1000]);
  data.traces[1] = { points: [{ distance: 0, elapsed: 0 }, { distance: 1000, elapsed: 12 }] };
  assert.equal(trackPositionsAtCursor(data, 500).positions[1], null);
});

test("compacted slow-corner samples stay visible while missing timing remains a gap", () => {
  const data = comparison();
  const trace = {
    quality: { comparable: true, maxGapSeconds: 0.5 },
    points: [{ distance: 0, elapsed: 0 }, { distance: 100, elapsed: 4 }, { distance: 200, elapsed: 6 }],
  };
  data.traces = [trace, structuredClone(trace)];
  assert.deepEqual(trackPositionsAtCursor(data, 50).positions, [50, 50]);
  data.traces[1].points.splice(1, 0, { distance: 50, elapsed: null });
  assert.equal(trackPositionsAtCursor(data, 50).positions[1], null);
  assert.equal(trackPositionsAtCursor(data, 50).timeGap, null);
});
