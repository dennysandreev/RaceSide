import assert from "node:assert/strict";
import test from "node:test";
import registry from "./tracks/2026.json" with { type: "json" };
import validation from "./tracks/validation-2026.json" with { type: "json" };
import { bundledSessionTrack, bundledTrackEntry, resolveSessionTrack } from "./track-registry.mjs";
import { mapLocation, projectLocation } from "./state.mjs";

test("every 2026 calendar venue has a map before its first practice, without database or lap data", async () => {
  assert.equal(registry.length, 23);
  assert.equal(new Set(registry.map((entry) => entry.circuitKey)).size, 23);
  for (const entry of registry) {
    const track = await bundledSessionTrack({ year: 2026, circuit_key: entry.circuitKey, session_name: "Practice 1" });
    assert.ok(track.centerline.length > 50, entry.id);
    assert.ok(track.svg.technicalPathD.length > 100, entry.id);
    assert.ok(track.transform.scale > 0, entry.id);
    for (let i = 0; i < track.centerline.length; i++) {
      const point = track.centerline[i];
      assert.ok([point.svgX, point.svgY, point.worldX, point.worldY, point.progress].every(Number.isFinite), entry.id);
      if (i) assert.ok(point.progress > track.centerline[i - 1].progress, entry.id);
      const mapped = mapLocation(track, { x: point.worldX, y: point.worldY, date: "2026-10-05T12:00:00Z" });
      assert.ok(Math.hypot(mapped.x - point.svgX, mapped.y - point.svgY) < .001, entry.id);
    }
  }
});

test("venue keys and names resolve before an OpenF1 session is linked to the calendar", () => {
  for (const entry of registry) {
    assert.equal(bundledTrackEntry({ year: 2026, circuit_key: entry.circuitKey })?.id, entry.id);
    for (const name of entry.aliases) {
      assert.equal(bundledTrackEntry({ date_start: "2026-10-09T08:30:00Z", circuit_short_name: name })?.id, entry.id);
    }
  }
  assert.equal(bundledTrackEntry({ year: 2026, circuit_key: 12, race_name: "Bahrain Grand Prix" })?.id, "sepang");
  assert.equal(bundledTrackEntry({ year: 2026, circuit_key: 63, race_name: "Malaysian Grand Prix", location: "Kuala Lumpur" }), null);
  assert.equal(bundledTrackEntry({ year: 2025, circuit_key: 153 }), null);
  assert.equal(bundledTrackEntry({ year: 2027, circuit_key: 61 }), null);
});

test("session hydration cannot change the bundled map for the next practice", async () => {
  const session = { year: 2026, circuit_key: 144 };
  const track = await bundledSessionTrack(session);
  track.centerline[0].svgX = -999;
  assert.notEqual((await bundledSessionTrack(session)).centerline[0].svgX, -999);
});

test("current database geometry resolves by venue slug before the session has a calendar link", async () => {
  const session = { year: 2026, circuit_key: 61 };
  const bundled = await bundledSessionTrack(session);
  const current = { ...bundled, id: "current-session-map" };
  const old = { ...bundled, id: "old-session-map" };
  const maps = [{ circuit_key: "marina_bay", season_source: 2025, definition: old },
    { circuit_key: "marina_bay", season_source: 2027, definition: old },
    { circuit_key: "marina_bay", season_source: 2026, definition: current }];
  assert.equal((await resolveSessionTrack(session, maps)).id, current.id);
  assert.equal((await resolveSessionTrack(session, maps.slice(0, 2))).id, bundled.id);
  assert.equal((await resolveSessionTrack(session, [{ circuit_key: "marina_bay", season_source: 2026, definition: null }])).id, bundled.id);
  assert.equal((await resolveSessionTrack({ year: 2026, circuit_key: 153 }, maps)).id,
    (await bundledSessionTrack({ year: 2026, circuit_key: 153 })).id);
});

test("prepared remaining venues follow independent historical laps in racing direction", async () => {
  assert.equal(validation.length, 7);
  for (const sample of validation) {
    const entry = registry.find((entry) => entry.id === sample.id);
    const track = await bundledSessionTrack({ year: 2026, circuit_key: entry.circuitKey });
    assert.notEqual(sample.lap, track.debug.sourceLapNumber, "Validation must use a different lap");
    const errors = [];
    let previous = null;
    for (const [x, y] of sample.samples) {
      const location = mapLocation(track, { x, y });
      errors.push(projectLocation(track.centerline, location.x, location.y).distance /
        (track.transform.scale * track.liveModelAlignment.scale));
      if (previous !== null) assert.ok((location.progress - previous + 1) % 1 < .15, `${sample.id}: car must not reverse or jump`);
      previous = location.progress;
    }
    const rms = Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length);
    assert.ok(rms < 15, `${sample.id}: RMS ${rms} metres`);
    assert.ok(Math.max(...errors) < 30, `${sample.id}: car deviates from the circuit`);
    assert.ok(track.pitLane.points.length > 100, sample.id);
    const entryPoint = track.pitLane.points[0], exitPoint = track.pitLane.points.at(-1);
    assert.ok(projectLocation(track.centerline, entryPoint.svgX, entryPoint.svgY).distance < .001, sample.id);
    assert.ok(projectLocation(track.centerline, exitPoint.svgX, exitPoint.svgY).distance < .001, sample.id);
  }
});
