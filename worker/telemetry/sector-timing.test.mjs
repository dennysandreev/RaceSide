import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildComparison, interpolate, alignLapToSectorTiming, rebuildComparisonTiming } from "./core.mjs";
import { buildTelemetryAnalysis } from "./analysis.mjs";

const { comparisons } = JSON.parse(readFileSync(new URL("./fixtures/sector-timing-2026.json", import.meta.url)));
const tolerance = 0.01;

for (const fixture of comparisons) {
  test(`${fixture.track.id}: real sector crossings recover the profile without altering measured channels`, () => {
    const original = structuredClone(fixture);
    const c = buildComparison(fixture.traces, fixture.track, fixture.config);
    const analysis = buildTelemetryAnalysis(c);
    assert.equal(analysis.quality.timingAvailable, true);
    assert.ok(analysis.quality.sectorError < tolerance);
    assert.ok(analysis.profile.every((row) => row.available > 0));
    c.traces.forEach((trace, driver) => {
      const before = original.traces[driver];
      assert.deepEqual(trace.lap, before.lap);
      assert.equal(trace.points.length, before.points.length);
      trace.points.forEach(({ distance, ...point }, i) => {
        const { distance: oldDistance, ...oldPoint } = before.points[i];
        assert.deepEqual(point, oldPoint);
        assert.ok(Number.isFinite(distance));
        assert.ok(!i || distance > trace.points[i - 1].distance);
        assert.ok(Math.abs(distance - oldDistance) < 50);
      });
      assert.equal(trace.points[0].distance, 0);
      assert.equal(trace.points.at(-1).distance, c.track.length);
      c.track.sectors.forEach((distance, sector) => {
        const elapsed = trace.lap.sectors.slice(0, sector + 1).reduce((sum, time) => sum + time, 0);
        assert.ok(Math.abs(interpolate(trace.points, distance, "elapsed", 0.6) - elapsed) < tolerance);
      });
      assert.ok(Math.abs(c.delta[driver].at(-1) - (before.lap.time - original.traces[c.config.reference].lap.time)) < 1e-6);
    });
    assert.deepEqual(fixture, original, "input is never mutated");
  });
}

test("sector timing alignment is independent of trace order and reference", () => {
  const { traces, track, config } = comparisons[0];
  const a = buildComparison(traces, track, config);
  const b = buildComparison([...traces].reverse(), track, { ...config, reference: 1 });
  assert.deepEqual(a.track.sectors, b.track.sectors);
  assert.deepEqual(a.traces.map((t) => t.points), b.traces.map((t) => t.points).reverse());
  assert.deepEqual(a.delta, [...b.delta].reverse());
});

test("old saved comparisons rebuild their delta and remain stable on repeated reads", () => {
  const fixture = comparisons[0];
  const old = { ...fixture, evolution: { retained: true }, analysis: { version: "track-analysis-5" } };
  const c = rebuildComparisonTiming(old);
  assert.equal(c.analysis, undefined);
  assert.deepEqual(c.evolution, old.evolution);
  assert.deepEqual(rebuildComparisonTiming(c), c);
  c.track.sectors.forEach((distance, sector) => {
    const index = c.distance.findIndex((d) => d >= distance);
    const fraction = (distance - c.distance[index - 1]) / (c.distance[index] - c.distance[index - 1]);
    const graphDelta = c.delta[1][index - 1] + (c.delta[1][index] - c.delta[1][index - 1]) * fraction;
    const official = c.traces[1].lap.sectors.slice(0, sector + 1).reduce((sum, time, i) => sum + time - c.traces[0].lap.sectors[i], 0);
    assert.ok(Math.abs(graphDelta - official) < tolerance);
  });
});

test("repeatability aligns other real laps to the same control lines and rejects excessive corrections", () => {
  const { traces, track, config } = comparisons[0];
  const c = buildComparison(traces, track, config);
  traces.forEach((trace, i) => {
    const candidate = alignLapToSectorTiming(trace, c.track);
    assert.deepEqual(candidate.points, c.traces[i].points);
    const inconsistent = structuredClone(trace);
    inconsistent.lap.sectors[0] += 1;
    inconsistent.lap.sectors[2] -= 1;
    assert.equal(alignLapToSectorTiming(inconsistent, c.track), null);
  });
});

test("a gap inside a corrected interval stays unavailable", () => {
  const fixture = structuredClone(comparisons[0]);
  fixture.traces[0].points = fixture.traces[0].points.filter((p) => p.elapsed < 9 || p.elapsed > 11);
  const c = buildComparison(fixture.traces, fixture.track, fixture.config);
  assert.equal(c.traces[0].quality.method, "speed-integral/sector-timing");
  const analysis = buildTelemetryAnalysis(c);
  const gaps = c.traces[0].points.slice(1).map((p, i) => [c.traces[0].points[i], p]).filter(([a, b]) => b.elapsed - a.elapsed > 0.6);
  assert.ok(gaps.length > 0);
  gaps.forEach(([a, b]) => {
    const affected = analysis.sections.filter((s) => s.to > a.distance && s.from < b.distance);
    assert.ok(affected.length > 0);
    assert.ok(affected.every((s) => s.gain === null));
  });
});

test("distance correction is bounded even when its time shift is small", () => {
  const { traces, track, config } = comparisons[0];
  const c = buildComparison(traces, track, config);
  const shortened = { ...c.track, sectors: [10, c.track.sectors[1]] };
  assert.equal(alignLapToSectorTiming(traces[0], shortened), null);
});

test("alignment supports three and four traces without choosing a reference anchor", () => {
  const { traces, track, config } = comparisons[0];
  const pair = buildComparison(traces, track, config);
  for (const count of [3, 4]) {
    const samples = [...pair.traces, ...pair.traces].slice(0, count);
    const c = buildComparison(samples, pair.track, config);
    assert.equal(c.traces.length, count);
    c.traces.forEach((trace) => c.track.sectors.forEach((distance, i) => {
      assert.ok(Math.abs(interpolate(trace.points, distance, "elapsed", 0.6) - trace.lap.sectors.slice(0, i + 1).reduce((a, b) => a + b, 0)) < tolerance);
    }));
  }
});

test("a majority of similar laps cannot force another trace beyond the time correction limit", () => {
  const { traces, track, config } = comparisons[0];
  const samples = [traces[0], traces[1], traces[0]];
  const c = buildComparison(samples, track, config);
  assert.deepEqual(c.traces.map((t) => t.points), samples.map((t) => t.points));
  assert.deepEqual(c.track.sectors, track.sectors);
});

for (const [reason, change] of [
  ["missing timing", (c) => { c.traces[0].lap.sectors[0] = null; }],
  ["inconsistent sector sum", (c) => { c.traces[0].lap.sectors[0] += 1; }],
  ["excessive correction", (c) => { c.traces[0].lap.sectors[0] += 1; c.traces[0].lap.sectors[2] -= 1; }],
  ["race average", (c) => { c.traces[0].lap.kind = "race_average"; }],
  ["missing samples at a sector crossing", (c) => {
    const elapsed = c.traces[0].lap.sectors[0];
    c.traces[0].points = c.traces[0].points.filter((p) => Math.abs(p.elapsed - elapsed) > 0.5);
  }],
]) {
  test(`alignment preserves the original distance when there is ${reason}`, () => {
    const fixture = structuredClone(comparisons[0]);
    change(fixture);
    const c = buildComparison(fixture.traces, fixture.track, fixture.config);
    assert.deepEqual(c.traces.map((t) => t.points), fixture.traces.map((t) => t.points));
    assert.deepEqual(c.track.sectors, fixture.track.sectors);
  });
}
