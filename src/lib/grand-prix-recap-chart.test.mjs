import assert from "node:assert/strict";
import test from "node:test";
import { buildRecapPositionChart } from "./grand-prix-recap-chart.ts";

const driver = (code, points, finished = true) => ({ code, driver: code, color: "#ff0000", points, finished });

test("draws all 22 drivers with an inverted full-field position axis", () => {
  const chart = buildRecapPositionChart(Array.from({ length: 22 }, (_, index) => driver(String(index), [
    { lap: 1, value: index + 1 }, { lap: 2, value: index + 1 },
  ])), 55);
  assert.equal(chart.traces.length, 22);
  assert.equal(chart.positionTicks[0].value, 1);
  assert.equal(chart.positionTicks.at(-1).value, 22);
  assert.ok(chart.traces[0].last.y < chart.traces[21].last.y);
  assert.deepEqual(chart.lapTicks.map((tick) => tick.value), [1, 10, 20, 30, 40, 55]);
});

test("never connects missing laps, explicit nulls or invalid positions", () => {
  const chart = buildRecapPositionChart([driver("VER", [
    { lap: 1, value: 1 }, { lap: 2, value: 2 },
    { lap: 4, value: 1 }, { lap: 5, value: null }, { lap: 6, value: 2 },
    { lap: 7, value: 999 }, { lap: 8, value: 1 },
    { lap: 0, value: 1 }, { lap: 100, value: 1 },
  ])], 10);
  assert.equal(chart.traces[0].path.split("M").length - 1, 4);
  assert.equal(chart.traces[0].path.split("H").length - 1, 1);
  assert.deepEqual(chart.traces[0].samples.map((point) => point.lap), [1, 2, 4, 6, 8]);
  assert.doesNotMatch(chart.traces[0].path, /NaN|Infinity/);
});

test("retired drivers stop at their last stored observation and remain in the field", () => {
  const chart = buildRecapPositionChart([
    driver("VER", [{ lap: 1, value: 1 }, { lap: 10, value: 1 }]),
    driver("PER", [{ lap: 1, value: 2 }, { lap: 3, value: 2 }], false),
    driver("BOT", []),
  ], 10);
  assert.equal(chart.traces.length, 3);
  assert.ok(chart.traces[1].last.x < chart.right);
  assert.deepEqual(chart.endLabels.map((label) => label.code), ["VER"]);
  assert.equal(chart.traces[2].last, null);
});

test("no timing produces an empty chart rather than synthetic positions", () => {
  const chart = buildRecapPositionChart([driver("VER", []), driver("HAM", [])], 0);
  assert.equal(chart.hasTiming, false);
  assert.ok(chart.traces.every((trace) => trace.path === ""));
  assert.deepEqual(chart.endLabels, []);
});
