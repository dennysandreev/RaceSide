import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTelemetryAnalysis, analysisSections, detectTelemetrySignals, matchRepeatability, intervalTiming, ANALYSIS_VERSION } from "./analysis.mjs";
import { TelemetryStore } from "./store.mjs";
import { interpolate, resampleComparison, buildComparison } from "./core.mjs";
import { resultKey, TelemetryService } from "./service.mjs";

const track = {
  id: "analysis-fixture", version: "1", name: "Fixture", length: 3000, estimated: true,
  sectors: [1000, 2000], source: "Synthetic fixture",
  points: Array.from({ length: 61 }, (_, i) => ({ distance: i * 50, x: Math.cos(i / 60 * Math.PI * 2) * 100, y: Math.sin(i / 60 * Math.PI * 2) * 100 })),
  // Midpoint metadata covers 100% of the lap. The analytical cores must not.
  corners: [500, 1500, 2500].map((apex, i) => ({ number: i + 1, start: i * 1000, apex, end: (i + 1) * 1000 })),
};
function trace(driver = 1, lapNumber = 10, started = 0) {
  let elapsed = 0;
  const points = Array.from({ length: 301 }, (_, i) => {
    const distance = i * 10;
    const speed = Math.min(...track.corners.map((c, j) => 300 - (300 - [90, 180, 260][j]) * Math.exp(-(((distance - c.apex) / 65) ** 2)))) + (driver - 1) * 2;
    if (i) elapsed += 10 / (speed / 3.6);
    return { distance, elapsed, timestamp: 1790000000000 + elapsed * 1000, speed, throttle: 100, brake: 0, gear: 8, rpm: 11000, drs: null, x: null, y: null };
  });
  return {
    driver: { id: `1:${driver}`, number: driver, code: `D${driver}`, name: `Driver ${driver}`, color: driver === 1 ? "#ff8700" : "#00d2be" },
    session: { id: 1, meetingId: 1, season: 2026, circuitKey: 1, circuit: "Fixture", name: "Qualifying" },
    lap: { id: `1:${driver}:${lapNumber}`, driverNumber: driver, sessionId: 1, number: lapNumber,
      start: new Date(1790000000000 + started + driver * 1000).toISOString(), time: points.at(-1).elapsed,
      sectors: [interpolate(points, 1000, "elapsed"), interpolate(points, 2000, "elapsed") - interpolate(points, 1000, "elapsed"), points.at(-1).elapsed - interpolate(points, 2000, "elapsed")],
      compound: "SOFT", tyreAge: 1, weather: { rain: 0 }, complete: true, validityKnown: true, deleted: false, pitIn: false, pitOut: false, status: ["GREEN"] },
    quality: { comparable: true, coverage: 1, sampleIntervalSeconds: 0.24, maxGapSeconds: 0.4, warnings: ["ESTIMATED_DISTANCE"] },
    points, corners: [], metrics: { topSpeed: 300 }, datasetId: "fixture",
  };
}
function comparison(reference = 0) { return buildComparison([trace(), trace(2)], track, { mode: "lap", reference, traces: [] }); }
const sum = (values) => values.reduce((a, b) => a + b, 0);

test("shared corner cores leave real straight intervals and partition the entire lap", () => {
  const result = buildTelemetryAnalysis(comparison());
  assert.deepEqual(result.profile.filter((p) => p.category !== "straight").map((p) => p.count), [1, 1, 1]);
  assert.ok(result.sections.some((section) => section.category === "straight" && section.to - section.from > 500));
  assert.equal(sum(result.sections.map((s) => s.to - s.from)), track.length);
  assert.equal(result.sections[0].from, 0);
  assert.equal(result.sections.at(-1).to, track.length);
  assert.ok(result.sections.every((s, i) => !i || s.from === result.sections[i - 1].to));
  assert.ok(Math.abs(sum(result.profile.map((p) => p.gain)) - (trace(2).lap.time - trace().lap.time)) < 0.00001);
});
test("category boundaries are shared and reversing the reference only reverses gains", () => {
  const first = buildTelemetryAnalysis(comparison(0)), second = buildTelemetryAnalysis(comparison(1));
  assert.deepEqual(first.sections.map((s) => [s.category, s.from, s.to]), second.sections.map((s) => [s.category, s.from, s.to]));
  assert.ok(first.profile.every((p, i) => Math.abs(p.gain + second.profile[i].gain) < 1e-6));
  assert.deepEqual(first.profile.map((p) => p.speedValues), second.profile.map((p) => p.speedValues));
});
test("profile speeds use each driver's corner minima and straight maximum", () => {
  const c = comparison();
  c.traces[0].points.find((p) => p.distance === 100).speed = 335;
  c.traces[1].points.find((p) => p.distance === 100).speed = 331;
  c.analysis = buildTelemetryAnalysis(c);
  assert.deepEqual(c.analysis.profile.map((p) => p.speedValues), [[90, 92], [180, 182], [260, 262], [335, 331]]);
  const rendered = resampleComparison(c, { points: 100 });
  assert.deepEqual(rendered.analysis.profile, c.analysis.profile);
});
test("typical corner speed is the median across corners in the selected group", () => {
  const c = comparison();
  c.traces.forEach((t, driver) => t.points.forEach((p) => {
    const corner = track.corners.findIndex((s) => Math.abs(p.distance - s.apex) <= 100);
    p.speed = corner < 0 ? 300 : [155, 175, 215][corner] + driver * 10;
  }));
  const result = buildTelemetryAnalysis(c);
  assert.equal(result.profile.find((p) => p.category === "medium").count, 3);
  assert.deepEqual(result.profile.find((p) => p.category === "medium").speedValues, [175, 185]);
  assert.deepEqual(result.profile.find((p) => p.category === "slow").speedValues, [null, null]);
});
test("missing speeds stay unavailable and trace reversal preserves driver values", () => {
  const c = comparison(), forward = buildTelemetryAnalysis(c);
  const reverse = buildTelemetryAnalysis({ ...c, traces: [...c.traces].reverse() });
  assert.deepEqual(reverse.profile.map((p) => p.speedValues), forward.profile.map((p) => [...p.speedValues].reverse()));
  c.traces[0].points.forEach((p) => { p.speed = null; });
  const missing = buildTelemetryAnalysis(c);
  assert.ok(missing.profile.every((p) => p.speedValues[0] === null));
  assert.ok(missing.profile.every((p) => Number.isFinite(p.speedValues[1])));
  c.traces[1].points.forEach((p) => { p.speed = null; });
  assert.ok(buildTelemetryAnalysis(c).profile.every((p) => p.speedValues.every((value) => value === null)));
});
test("finish agreement cannot hide sector mismatch", () => {
  const c = comparison();
  c.traces[1].lap.sectors[0] += 1;
  c.traces[1].lap.sectors[2] -= 1;
  const a = buildTelemetryAnalysis(c);
  assert.equal(a.quality.timingAvailable, false);
  assert.ok(a.quality.sectorError > 0.99);
  assert.ok(a.profile.every((row) => row.gain == null));
  assert.equal(a.exits[0].exitGain, null);
  assert.ok(a.exits[1].exitGain != null); // An unrelated sector must not veto this exit.
  assert.ok(a.exits[0].speeds.every(Number.isFinite));
});
test("gaps inside an interval invalidate its time even when both endpoints exist", () => {
  const c = comparison();
  c.traces[1].points = c.traces[1].points.filter((p) => p.distance < 700 || p.distance > 900);
  const a = buildTelemetryAnalysis(c);
  const straights = a.profile.find((p) => p.category === "straight");
  assert.ok(straights.available < straights.count);
  assert.ok(a.sections.some((s) => s.category === "straight" && s.gain == null));
  assert.ok(straights.gain != null);
});
test("analysis is computed before rendering downsampling and exit plus straight sums consistently", () => {
  const c = comparison(); c.analysis = buildTelemetryAnalysis(c);
  const rendered = resampleComparison(c, { points: 100 });
  assert.deepEqual(rendered.analysis, c.analysis);
  for (const exit of c.analysis.exits) assert.ok(Math.abs(exit.totalGain - exit.exitGain - exit.straightGain) < 1e-6);
});
test("missing corner metadata does not invent a straight-only performance profile", () => {
  const c = comparison(); c.track = { ...track, corners: [] };
  const a = buildTelemetryAnalysis(c);
  assert.deepEqual(a.sections, []); assert.deepEqual(a.exits, []);
  assert.ok(a.profile.every((p) => p.count === 0 && p.gain == null));
  c.track.corners = [{ number: 1, start: 300, apex: 200, end: 100 }];
  assert.deepEqual(buildTelemetryAnalysis(c).sections, []);
});

function signalTrace(kind = "drop") {
  const t = trace();
  let distance = 0;
  t.points = Array.from({ length: 25 }, (_, i) => {
    const speed = kind === "weak" ? 220 + Math.min(i, 8) * 1.25 : kind === "coast" ? 100 : 312 - i * 13 / 24;
    if (i) distance += speed / 3.6 * 0.25;
    return { distance, elapsed: i * 0.25, speed, throttle: kind === "coast" ? 0 : 100,
      brake: kind === "coast" && i === 24 ? 100 : 0, gear: 8, drs: null };
  });
  return t;
}
const signalSections = [{ category: "straight", from: 0, to: 1000 }];
test("sustained speed loss at full throttle is an observation, with no energy estimates", () => {
  const events = detectTelemetrySignals(signalTrace(), 0, signalSections);
  assert.equal(events.length, 1); assert.equal(events[0].kind, "speed-drop");
  assert.equal(events[0].startSpeed, 312); assert.equal(events[0].endSpeed, 299);
  assert.equal(events[0].duration, 6);
  for (const forbidden of ["battery", "soc", "energy", "deployment", "confidence"]) assert.equal(forbidden in events[0], false);
});
test("superclipping requires full throttle in every sample", () => {
  const t = signalTrace();
  t.points.forEach((p) => { p.throttle = 60; });
  assert.deepEqual(detectTelemetrySignals(t, 0, signalSections), []);
  t.points.forEach((p) => { p.throttle = 98; });
  assert.equal(detectTelemetrySignals(t, 0, signalSections)[0].kind, "speed-drop");
  t.points[12].throttle = 97;
  assert.deepEqual(detectTelemetrySignals(t, 0, signalSections), []);
  t.points.forEach((p) => { p.throttle = 0; });
  assert.deepEqual(detectTelemetrySignals(t, 0, signalSections), []);
  const weak = signalTrace("weak");
  weak.points.forEach((p) => { p.throttle = 60; });
  assert.deepEqual(detectTelemetrySignals(weak, 0, signalSections), []);
});
test("superclipping starts at high speed but can continue below its entry threshold", () => {
  const t = signalTrace();
  t.points.forEach((p, i) => { p.speed = 300 - i * 20 / 24; });
  const event = detectTelemetrySignals(t, 0, signalSections)[0];
  assert.equal(event.startSpeed, 300); assert.equal(event.endSpeed, 280);
  for (const start of [243, 286, 299]) {
    t.points.forEach((p, i) => { p.speed = start - i * 13 / 24; });
    assert.deepEqual(detectTelemetrySignals(t, 0, signalSections), []);
  }
});

function splitSignalTrace() {
  const t = signalTrace();
  t.points = [
    ...Array.from({ length: 9 }, (_, i) => ({ elapsed: i * 0.25, speed: 330 - i * 1.25 })),
    ...Array.from({ length: 9 }, (_, i) => ({ elapsed: 3.2 + i * 0.25, speed: 318 - i * 1.25 })),
  ].map((p) => ({ ...p, distance: p.elapsed * 85, throttle: 100, brake: 0, gear: 8, drs: null }));
  return t;
}
test("one observed decline can span a short missing interval", () => {
  const t = splitSignalTrace();
  const events = detectTelemetrySignals(t, 0, signalSections);
  assert.equal(events.length, 1);
  assert.equal(events[0].startSpeed, 330); assert.equal(events[0].endSpeed, 308);
  assert.equal(events[0].duration, 5.2);
});
test("joining happens before the entry-speed gate so a slower continuation is preserved", () => {
  const t = splitSignalTrace();
  t.points.forEach((p, i) => { p.speed = i < 9 ? 330 - i * 30 / 8 : 298 - (i - 9) * 1.25; });
  const events = detectTelemetrySignals(t, 0, signalSections);
  assert.equal(events.length, 1); assert.equal(events[0].startSpeed, 330); assert.equal(events[0].endSpeed, 288);
  assert.equal(events[0].to, 442);
});
test("nearby declines stay separate after a lift, brake, shift, aero change or acceleration", () => {
  for (const mutate of [
    (t) => { t.points.splice(9, 0, { ...t.points[8], elapsed: 2.5, distance: 212.5, throttle: 0 }); },
    (t) => { t.points.splice(9, 0, { ...t.points[8], elapsed: 2.5, distance: 212.5, brake: 100 }); },
    (t) => t.points.slice(9).forEach((p) => { p.gear = 7; }),
    (t) => t.points.slice(9).forEach((p) => { p.drs = 10; }),
    (t) => { t.points.splice(9, 0, { ...t.points[8], elapsed: 2.5, distance: 212.5, speed: 314 }); },
    (t) => { t.points.splice(9, 0, { ...t.points[8], elapsed: 2.5, distance: 212.5, throttle: null }); },
  ]) {
    const t = splitSignalTrace(); mutate(t);
    assert.equal(detectTelemetrySignals(t, 0, signalSections).length, 2);
  }
});
test("merging bounds both elapsed time and distance and refuses slower intervening corners", () => {
  for (const change of [
    (t) => t.points.slice(9).forEach((p) => { p.elapsed += 0.4; }),
    (t) => t.points.slice(9).forEach((p) => { p.distance += 50; }),
  ]) {
    const t = splitSignalTrace(); change(t);
    assert.equal(detectTelemetrySignals(t, 0, signalSections).length, 2);
  }
  for (const category of ["slow", "medium", "fast"]) {
    const sections = [{ category: "straight", from: 0, to: 171 }, { category, from: 171, to: 271 }, { category: "straight", from: 271, to: 1000 }];
    assert.equal(detectTelemetrySignals(splitSignalTrace(), 0, sections).length, category === "fast" ? 1 : 2);
  }
});
test("a genuine recovery splits declines even within continuous full-throttle data", () => {
  const t = splitSignalTrace();
  t.points.splice(9, 0, ...[317, 313, 314, 315, 316].map((speed, i) => ({ ...t.points[8], speed, elapsed: 2.2 + i * 0.2, distance: (2.2 + i * 0.2) * 85 })));
  assert.equal(detectTelemetrySignals(t, 0, signalSections).length, 2);
});
test("two km/h of noise does not break one decline", () => {
  const t = splitSignalTrace();
  t.points.splice(9, 0, ...[319, 318, 320].map((speed, i) => ({ ...t.points[8], speed, elapsed: 2.3 + i * 0.3, distance: (2.3 + i * 0.3) * 85 })));
  assert.equal(detectTelemetrySignals(t, 0, signalSections).length, 1);
});
test("invalid or unknown timing, speed and gear cannot create a decline", () => {
  for (const [field, value] of [["elapsed", null], ["distance", NaN], ["speed", Infinity], ["gear", null], ["throttle", Infinity]]) {
    const t = signalTrace(); t.points.forEach((p) => { p[field] = value; });
    assert.deepEqual(detectTelemetrySignals(t, 0, signalSections), []);
  }
});
test("real Spa traces merge two fragments and suppress the 243 km/h approach", () => {
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/signal-spa-2026.json", import.meta.url), "utf8"));
  for (const fixture of fixtures) {
    const events = detectTelemetrySignals({ ...signalTrace(), points: fixture.points }, 0, fixture.sections);
    assert.equal(events.length, fixture.expected.length, fixture.name);
    assert.deepEqual(events.map((e) => [e.from, e.to, e.startSpeed, e.endSpeed]), fixture.expected, fixture.name);
  }
});
test("real Monza recovery cannot be counted as one uninterrupted decline", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/signal-monza-2026.json", import.meta.url), "utf8"));
  assert.deepEqual(detectTelemetrySignals({ ...signalTrace(), points: fixture.points }, 0, fixture.sections), []);
});
test("unknown pedals, braking, gear shifts, corners and telemetry gaps cannot confirm superclipping", () => {
  for (const mutate of [
    (t) => t.points.forEach((p) => { p.brake = null; }),
    (t) => t.points.forEach((p) => { p.throttle = null; }),
    (t) => { t.points[12].brake = 100; },
    (t) => t.points.forEach((p, i) => { p.gear = i < 12 ? 7 : 8; }),
    (t) => t.points.forEach((p, i) => { p.drs = i < 12 ? 8 : 10; }),
    (t) => t.points.forEach((p, i) => { p.elapsed = i; }),
  ]) {
    const t = signalTrace(); mutate(t);
    assert.deepEqual(detectTelemetrySignals(t, 0, signalSections), []);
  }
  assert.deepEqual(detectTelemetrySignals(signalTrace(), 0, [{ ...signalSections[0], category: "fast" }]), []);
});
test("coasting requires sustained released pedals immediately before braking", () => {
  const t = signalTrace("coast");
  const events = detectTelemetrySignals(t, 0, signalSections);
  assert.equal(events.length, 1); assert.equal(events[0].kind, "coasting");
  assert.ok(events[0].brakingAt > events[0].to);
  t.points[24].brake = 0;
  assert.deepEqual(detectTelemetrySignals(t, 0, signalSections), []);
});
test("weaker acceleration is distinct from a speed drop, and average traces produce no events", () => {
  const t = signalTrace("weak");
  assert.equal(detectTelemetrySignals(t, 0, signalSections)[0].kind, "weak-acceleration");
  t.lap.kind = "race_average";
  assert.deepEqual(detectTelemetrySignals(t, 0, signalSections), []);
});
test("the stricter superclipping gate does not expose a new weaker-acceleration event before a lift", () => {
  const t = signalTrace("weak"); t.points.at(-1).throttle = 60;
  assert.deepEqual(detectTelemetrySignals(t, 0, signalSections), []);
});

test("repeatability uses distinct real lap pairs without whole-lap flag, weather or tyre-age vetoes", () => {
  const a = trace(), b = trace(2), extra = [trace(1, 12, 300000), trace(2, 13, 301000)];
  assert.equal(matchRepeatability([a, b], [...extra, extra[0]]).pairs.length, 2);
  for (const mutate of [
    (t) => { t.lap.tyreAge = null; },
    (t) => { t.lap.weather = null; },
    (t) => { t.lap.weather.rain = 1; },
    (t) => { t.lap.status = ["YELLOW"]; },
    (t) => { t.lap.deleted = true; },
    (t) => { t.lap.compound = "MEDIUM"; },
    (t) => { t.lap.tyreAge = 20; },
    (t) => { t.lap.complete = false; t.quality.comparable = false; },
  ]) {
    const candidate = trace(2, 13, 301000); mutate(candidate);
    assert.equal(matchRepeatability([a, b], [extra[0], candidate]).pairs.length, 2);
  }
});
test("repeatability excludes average traces and different sessions", () => {
  const a = trace(), b = trace(2);
  b.session.id = 2;
  assert.equal(matchRepeatability([a, b]).reason, "sessions");
  b.session.id = 1; a.lap.kind = "race_average";
  assert.equal(matchRepeatability([a, b]).reason, "average");
});
test("comparison keys version analysis without invalidating raw telemetry", () => {
  const config = { mode: "lap", traces: [{ session: 1, driver: 1, lap: 10 }, { session: 1, driver: 2, lap: 10 }], reference: 0 };
  assert.match(resultKey({ kind: "compare", config }), /^telemetry-3:/);
  assert.ok(ANALYSIS_VERSION);
});
test("optional repeatability fetches are bounded and failures preserve selected comparison", async () => {
  const traces = [trace(), trace(2)];
  const catalogs = traces.map((t) => ({ laps: [t.lap, ...Array.from({ length: 10 }, (_, i) => trace(t.driver.number, i + 20, (i + 1) * 1000).lap)] }));
  const service = new TelemetryService({ store: {}, provider: {} });
  let calls = 0;
  service.normalize = async () => { calls++; throw new Error("PROVIDER_UNAVAILABLE"); };
  assert.deepEqual(await service.analysisCandidates(catalogs, traces, track), []);
  assert.equal(calls, 8);
  traces[0].lap.weather = null; calls = 0;
  assert.deepEqual(await service.analysisCandidates(catalogs, traces, track), []);
  assert.equal(calls, 8);
});
test("corridor construction is independent of trace order", () => {
  const forward = analysisSections([trace(), trace(2)], track), reverse = analysisSections([trace(2), trace()], track);
  const geometry = (sections) => sections.map((section) => {
    const shared = { ...section };
    delete shared.minimumSpeeds;
    return shared;
  });
  assert.deepEqual(geometry(forward), geometry(reverse));
  assert.deepEqual(reverse.filter((s) => s.corner != null).map((s) => s.minimumSpeeds),
    forward.filter((s) => s.corner != null).map((s) => [...s.minimumSpeeds].reverse()));
});

test("interval matching rejects gaps only where measured and does not reuse a lap", () => {
  const a = trace(), b = trace(2), extra = [trace(1, 12, 300000), trace(2, 13, 301000)];
  b.points = b.points.filter((p) => p.distance < 700 || p.distance > 900);
  const intact = matchRepeatability([a, b], [...extra, ...extra], { track, from: 400, to: 550 });
  assert.equal(intact.pairs.length, 2);
  assert.equal(new Set(intact.pairs.flat().map((t) => t.lap.id)).size, 4);
  const interrupted = matchRepeatability([a, b], extra, { track, from: 650, to: 950 });
  assert.equal(interrupted.pairs.length, 1);
  assert.ok(interrupted.pairs.every((p) => !p.some((t) => t.lap.id === b.lap.id)));
});
test("interval timing verifies all intersected sectors and preserves unverified estimates without wins", () => {
  const a = trace(), b = trace(2);
  b.lap.sectors[1] = null;
  assert.equal(intervalTiming(a, b, track, 400, 550).verified, true);
  const crossing = intervalTiming(a, b, track, 950, 1100);
  assert.ok(crossing.gain != null); assert.equal(crossing.verified, false);
  const c = buildComparison([a, b], track, { mode: "lap", reference: 0, traces: [] });
  const result = buildTelemetryAnalysis(c, [trace(1, 12, 300000), trace(2, 13, 301000)]);
  assert.ok(result.exits[1].repeats.some((row) => !row.exitVerified && row.exitGain != null));
  assert.equal(result.exits[1].repeatSummary.exit.pairs, 1);
});
test("exit and straight pick independent pairs and count only checked traversals", () => {
  const c = comparison(), extra = [trace(1, 12, 300000), trace(2, 13, 301000)];
  c.traces[0].lap.status = ["YELLOW"]; c.traces[0].lap.tyreAge = null;
  extra[1].lap.tyreAge = 10;
  c.traces[1].points = c.traces[1].points.filter((p) => p.distance < 700 || p.distance > 900);
  const exit = buildTelemetryAnalysis(c, extra).exits[0];
  assert.equal(exit.repeatSummary.exit.pairs, 2);
  assert.equal(exit.repeatSummary.straight.pairs, 1);
  assert.equal(exit.repeats[0].tyreAges[0], null);
  assert.ok(exit.repeats.some((row) => row.tyreAges[1] === 10));
});
test("reference reversal preserves repeat counts and reverses median gains", () => {
  const extras = [trace(1, 12, 300000), trace(2, 13, 301000)];
  const a = buildTelemetryAnalysis(comparison(), extras), b = buildTelemetryAnalysis(comparison(1), extras);
  for (let i = 0; i < a.exits.length; i++) for (const part of ["exit", "straight"]) {
    const x = a.exits[i].repeatSummary[part], y = b.exits[i].repeatSummary[part];
    assert.equal(x.pairs, y.pairs); assert.deepEqual(x.wins, [...y.wins].reverse());
    assert.ok(Math.abs(x.medianGain + y.medianGain) < 1e-6);
  }
});
test("nearby candidate loads include unknown ages, yellow flags and unknown weather, but remain bounded", async () => {
  const traces = [trace(), trace(2)];
  traces[0].lap.status = ["YELLOW"]; traces[0].lap.tyreAge = null;
  const catalogs = traces.map((t) => ({ laps: [t.lap, ...Array.from({ length: 8 }, (_, i) => {
    const lap = trace(t.driver.number, 20 + i, (i + 1) * 1000).lap;
    lap.weather = null; lap.status = ["YELLOW"]; lap.tyreAge = 30; return lap;
  })] }));
  const service = new TelemetryService({ store: {}, provider: {} }), loaded = [];
  service.normalize = async (_, lap) => { loaded.push(lap.id); return { ...trace(lap.driverNumber), lap }; };
  const result = await service.analysisCandidates(catalogs, traces, track);
  assert.equal(result.length, 8);
  assert.deepEqual(loaded, [1, 2].flatMap((driver) => [20, 21, 22, 23].map((lap) => `1:${driver}:${lap}`)));
});
test("cached full-resolution laps are scoped to session and driver with a bounded read", async () => {
  const requests = [];
  const query = { select: (...args) => { requests.push(["select", ...args]); return query; },
    like: (...args) => { requests.push(["like", ...args]); return query; },
    order: (...args) => { requests.push(["order", ...args]); return query; },
    limit: async (n) => { requests.push(["limit", n]); return { data: [{ payload: trace(), expires_at: null }, { payload: trace(1, 12), expires_at: "2000-01-01" }], error: null }; } };
  const store = new TelemetryStore({ from: () => query });
  assert.equal((await store.getNormalizedLaps(1, 1)).length, 1);
  assert.ok(requests.some((r) => r[0] === "like" && r[2] === "normalized:telemetry-%:1:1:%"));
  assert.ok(requests.some((r) => r[0] === "limit" && r[1] === 24));
});
