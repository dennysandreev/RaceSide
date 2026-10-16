import test from "node:test";
import assert from "node:assert/strict";
import { speedExtrema, speedAnnotations, speedAtDistance } from "./share-chart.ts";

const points = (values) => values.map((speed, index) => ({ distance: index * 50, speed }));
test("speed labels capture braking minima and straight peaks, ignoring sampling noise", () => {
  const extremes = speedExtrema(points([200, 250, 299, 300, 298, 300, 250, 100, 102, 99, 150, 280, 290, 240, 80, 120]));
  assert.deepEqual(extremes.map(({ value, kind }) => [value, kind]), [
    [300, "peak"], [99, "low"], [290, "peak"], [80, "low"],
  ]);
});
test("missing samples and telemetry gaps never create an invented extremum or speed", () => {
  assert.deepEqual(speedExtrema(points([200, 250, null, 100, 200])), []);
  assert.equal(speedAtDistance(points([300, null, 100]), 25), null);
  assert.equal(speedAtDistance([{ distance: 0, speed: 300 }, { distance: 500, speed: 100 }], 250), null);
  assert.equal(speedAtDistance(points([100, 200]), 25), 150);
  assert.equal(speedAtDistance(points([null]), 0), null);
});

test("share annotations skip medium speed wiggles and keep the actual dominant peaks and lows", () => {
  const source = points([200, 300, 100, 250, 230, 260, 240, 250, 80, 310, 100, 300]);
  assert.deepEqual(speedAnnotations(source).map(({ distance, value, kind }) => [distance, value, kind]), [
    [50, 300, "peak"], [100, 100, "low"], [250, 260, "peak"],
    [400, 80, "low"], [450, 310, "peak"], [500, 100, "low"],
  ]);
});

test("share annotations cap and space each kind, keeping the strongest samples", () => {
  const source = points([200, 290, 100, 300, 70, 320, 90, 310, 80, 330, 60, 340, 50, 350, 40, 200]);
  const annotations = speedAnnotations(source);
  const span = source.at(-1).distance;
  for (const kind of ["peak", "low"]) {
    const selected = annotations.filter((point) => point.kind === kind);
    assert.equal(selected.length, 4);
    for (let i = 1; i < selected.length; i++) assert.ok(selected[i].distance - selected[i - 1].distance >= span * 0.07);
  }
  assert.deepEqual(annotations.filter(({ kind }) => kind === "peak").map(({ value }) => value), [320, 330, 340, 350]);
  for (const point of annotations) assert.ok(source.some((sample) => sample.distance === point.distance && sample.speed === point.value));
});

test("share annotations do not bridge gaps or label flat and empty traces", () => {
  assert.deepEqual(speedAnnotations([]), []);
  assert.deepEqual(speedAnnotations(points([290, 295, 292, 299, 291])), []);
  assert.deepEqual(speedAnnotations(points([200, 300, null, 70, 300])), []);
  assert.deepEqual(speedAnnotations([{ distance: 0, speed: 200 }, { distance: 50, speed: 300 }, { distance: 500, speed: 70 }, { distance: 550, speed: 300 }]), []);
});

test("a prominent first straight peak survives even when the lap starts near top speed", () => {
  const annotations = speedAnnotations(points([290, 321, 300, 110, 73, 110, 71, 200, 300]));
  assert.deepEqual(annotations.map(({ value, kind }) => [value, kind]), [[321, "peak"], [71, "low"]]);
  assert.deepEqual(speedAnnotations(points([321, 300, 110, 200, 300])).map(({ value, kind }) => [value, kind]), [[110, "low"]]);
});
