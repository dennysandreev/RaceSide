import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import tracks from "./tracks.json" with { type: "json" };
import { TRACK_MODEL_ALIASES } from "../../src/data/track-models.ts";
import { normalizeTelemetryMeeting, orientComparison, verifiedTrack } from "./track-geometry.mjs";

test("Malaysia uses its venue even when OpenF1 retains the former Bahrain name", () => {
  const meeting = { name: "Bahrain Grand Prix", circuit: "Kuala Lumpur", country: "Malaysia" };
  assert.equal(normalizeTelemetryMeeting(meeting).name, "Malaysian Grand Prix");
  assert.equal(verifiedTrack(meeting.circuit, 2026)?.id, "sepang");
  const bahrain = { name: "Bahrain Grand Prix", circuit: "Sakhir", country: "Bahrain" };
  assert.equal(normalizeTelemetryMeeting(bahrain), bahrain);
  const old = {
    track: { id: "bahrain", name: "Bahrain", version: "old", length: 5390, points: [], corners: [], sectors: [] },
    traces: [{ session: { circuit: "Kuala Lumpur", season: 2026 } }],
    distance: [0, 5390],
  };
  const corrected = orientComparison(old);
  assert.equal(corrected.track.id, "sepang");
  assert.equal(corrected.track.name, "Sepang International Circuit");
  assert.equal(corrected.track.corners.length, 15);
  assert.equal(corrected.track.length, 5390);
  assert.equal(corrected.distance, old.distance);
  assert.equal(orientComparison(corrected), corrected);
});

test("correcting a cached venue also rebuilds its corner details without changing lap measurements", () => {
  const old = JSON.parse(readFileSync(new URL("../../docs/telemetry/fixtures/comparison.json", import.meta.url), "utf8"));
  old.traces.forEach((trace) => {
    trace.session.circuit = "Kuala Lumpur";
    trace.corners = [];
  });
  const corrected = orientComparison(old);
  assert.equal(corrected.track.id, "sepang");
  for (let index = 0; index < old.traces.length; index++) {
    const trace = corrected.traces[index];
    assert.equal(trace.points, old.traces[index].points);
    assert.equal(trace.metrics, old.traces[index].metrics);
    assert.equal(trace.corners.length, 15);
    assert.ok(trace.corners.every((corner) => corner.time > 0));
    assert.ok(trace.corners.every((corner) => corner.entry > 0));
  }
  assert.equal(orientComparison(corrected), corrected);
});

test("every available 2026 track model is registered for telemetry", () => {
  for (const id of Object.keys(TRACK_MODEL_ALIASES)) {
    const track = tracks.find((track) => track.id === id && track.seasons.includes(2026));
    assert.ok(
      track,
      `${id} has no verified telemetry geometry`,
    );
    assert.deepEqual(track.aliases, TRACK_MODEL_ALIASES[id], `${id} aliases drifted`);
    for (const alias of track.aliases)
      assert.equal(verifiedTrack(alias, 2026)?.id, id, `${id}: ${alias}`);
  }
});

test("cached Baku comparisons use the verified orientation without changing telemetry", () => {
  const model = verifiedTrack("Baku", 2026);
  assert.ok(model);
  assert.equal(verifiedTrack("Гран-при Азербайджана", 2026)?.id, "baku");
  assert.equal(verifiedTrack("Bahrain Grand Prix in Malaysia", 2026)?.id, "sepang");
  const old = {
    track: {
      id: "meeting-123",
      version: "telemetry-2:lap-7",
      name: "Baku",
      length: 5918,
      points: [{ distance: 0, x: 1, y: 2 }],
      sectors: [1900, 3900],
      corners: [],
    },
    traces: [{ session: { season: 2026 }, points: [{ distance: 0, speed: 300 }] }],
    distance: [0, 5918],
  };
  const corrected = orientComparison(old);
  assert.notEqual(corrected, old);
  assert.equal(corrected.track.points.length, model.points.length);
  assert.deepEqual(corrected.track.points[0], { ...model.points[0], distance: 0 });
  assert.equal(corrected.track.points.at(-1).distance, old.track.length);
  assert.deepEqual(corrected.track.sectors, model.sectors.map((distance) => distance * old.track.length / model.length));
  assert.equal(corrected.traces, old.traces);
  assert.equal(corrected.distance, old.distance);
  assert.deepEqual(old.track.points, [{ distance: 0, x: 1, y: 2 }]);
});

test("older OpenF1-only maps are flipped once when read from cache", () => {
  const comparison = {
    track: {
      id: "meeting-999",
      version: "telemetry-2:lap-1",
      name: "Future Circuit",
      length: 5000,
      points: [{ distance: 0, x: 10, y: 123 }],
      sectors: [],
      corners: [],
      source: "OpenF1 reference lap lap-1",
      estimated: true,
    },
    traces: [{ session: { season: 2026 } }],
  };
  const corrected = orientComparison(comparison);
  assert.equal(corrected.track.points[0].y, -123);
  assert.equal(corrected.track.version, "telemetry-2:lap-1:svg-y");
  assert.equal(orientComparison(corrected), corrected);
});

test("telemetry maps use the model horizontal plane, never elevation", async () => {
  for (const track of tracks) {
    const modelExports = await import(
      new URL(`../../${track.source.split(": ")[1]}`, import.meta.url)
    );
    const model = Object.values(modelExports).find(
      (value) => value.points && value.lapLengthKm,
    );
    assert.equal(track.points.length, model.points.length, track.id);
    for (let i = 0; i < model.points.length; i++) {
      const [progress, x, y] = model.points[i];
      assert.deepEqual(
        track.points[i],
        { distance: progress * track.length, x, y: -y },
        `${track.id} point ${i}`,
      );
    }
  }
});
test("Monza retains a closed two-dimensional circuit with all eleven corners", () => {
  const track = tracks.find((t) => t.id === "monza");
  const xs = track.points.map((p) => p.x),
    ys = track.points.map((p) => p.y);
  const aspect =
    (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys));
  assert.ok(aspect > 0.3 && aspect < 0.9, `Monza aspect ${aspect}`);
  assert.equal(track.corners.length, 11);
  assert.equal(track.length, 5793);
  assert.ok(
    Math.hypot(
      track.points[0].x - track.points.at(-1).x,
      track.points[0].y - track.points.at(-1).y,
    ) < 1,
  );
});
