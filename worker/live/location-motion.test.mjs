import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mapLocation, projectLocation } from "./state.mjs";
import { LiveStore, initialState } from "../../src/features/live/lib/store.ts";
import {
  readMadringMeshes,
  surfaceIndex,
} from "../../scripts/track-model-blender/audit-madring-surfaces.mjs";

const point = (svgX, svgY, progress) => ({ svgX, svgY, progress });
test("continuous projection moves between vertices and through the closing segment", () => {
  const points = [
    point(0, 0, 0),
    point(100, 0, 0.25),
    point(100, 100, 0.5),
    point(0, 100, 0.75),
  ];
  assert.equal(projectLocation(points, 20, 3).progress, 0.05);
  assert.equal(projectLocation(points, 21, 3).progress, 0.0525);
  assert.equal(projectLocation(points, 0, 10).progress, 0.975);
  assert.equal(projectLocation(points, 0, 0).progress, 0);
});
test("pit projection is open and does not connect exit back to entry", () => {
  const pit = [point(0, 0, 0), point(100, 0, 0.5), point(100, 100, 1)];
  assert.equal(projectLocation(pit, 50, 50, false).distance, 50);
  assert.equal(projectLocation(pit, 100, 100, false).progress, 1);
});
test("parallel pit road uses hysteresis instead of toggling on coordinate noise", () => {
  const track = {
    worldBounds: { minX: 0, minY: 0 },
    transform: { offsetX: 0, offsetY: 0, scale: 0.1 },
    svg: { viewBox: { height: 100 } },
    centerline: [point(0, 0, 0), point(100, 0, 1)],
    pitLane: { points: [point(0, 20, 0), point(100, 20, 1)] },
  };
  const pit = mapLocation(track, { x: 500, y: 180 });
  assert.equal(pit.pitLaneProgress, 0.5);
  assert.equal(
    mapLocation(track, { x: 500, y: 100 }, pit).pitLaneProgress,
    0.5,
  );
  assert.equal(mapLocation(track, { x: 500, y: 0 }, pit).pitLaneProgress, null);
});
test("delayed client sampling interpolates pit progress without wrapping the open lane", () => {
  const store = new LiveStore();
  store.state = { ...initialState, drivers: { 44: { status: "RUNNING" } } };
  const start = Date.now();
  for (const [offset, progress, pitLaneProgress] of [
    [0, 0.99, 0.8],
    [1000, 0.01, 1],
  ])
    store.addLocation(44, {
      timestamp: new Date(start + offset).toISOString(),
      x: 0,
      y: 0,
      z: 0,
      progress,
      pitLaneProgress,
    });
  const p = store.sample(44, start + 500);
  assert.ok(Math.abs(p.progress) < 1e-9);
  assert.equal(p.pitLaneProgress, 0.9);
});
test("network latency spikes cannot rewind the client playback clock", () => {
  const store = new LiveStore();
  store.accept({ type: "samples", serverTime: Date.now(), samples: [] });
  const before = store.clockOffset;
  store.accept({ type: "samples", serverTime: Date.now() - 900, samples: [] });
  assert.ok(Math.abs(store.clockOffset - before) <= 1);
});
test("client playback delay includes the observed OpenF1 transport delay", () => {
  const store = new LiveStore();
  const serverTime = Date.parse("2026-09-12T10:30:04Z");
  store.accept({
    type: "samples",
    serverTime,
    samples: [
      {
        type: "location",
        driverNumber: 44,
        timestamp: "2026-09-12T10:30:01Z",
        x: 1,
        y: 2,
        z: 0,
        progress: 0.1,
      },
    ],
  });
  assert.equal(store.getPlaybackDelay(), 3900);
});
test("Madring pit route lies on the actual delivered GLB surface and agrees with 2D", async () => {
  const track = JSON.parse(
    await readFile(new URL("./tracks/madring-2026.json", import.meta.url)),
  );
  const path = JSON.parse(
    await readFile(
      new URL("../../src/data/madring-live-path.json", import.meta.url),
    ),
  );
  const meshes = await readMadringMeshes(
    await readFile(
      new URL("../../public/f1/tracks/3d/madring.glb", import.meta.url),
    ),
  );
  const floor = surfaceIndex(meshes.get("Madring_Pit_Lane_Mesh"));
  assert.equal(path.pitLanePoints.length, 456);
  assert.ok(Math.abs(path.lengthMeters - 909.5167702032596) < 1);
  let previous;
  for (const [i, [progress, x, y, z]] of path.pitLanePoints.entries()) {
    const height = floor(x, -y);
    assert.notEqual(height, null);
    assert.ok(Math.abs(height - (z / 10 - 640 + 0.18)) < 0.001);
    const point = track.pitLane.points[i];
    assert.equal(point.progress, progress);
    const mapped = mapLocation(
      track,
      { x: point.worldX, y: point.worldY },
      previous,
    );
    // At the junction the main road and pit are the same surface.
    if (projectLocation(track.centerline, point.svgX, point.svgY).distance > 2)
      assert.ok(Math.abs(mapped.pitLaneProgress - progress) < 0.001);
    previous = mapped;
  }
});

test("Baku LIVE map follows an independent FP1 lap", async () => {
  const track = JSON.parse(
    await readFile(new URL("./tracks/baku-2026.json", import.meta.url)),
  );
  const lap = [
    { x: 2552, y: 3549 },
    { x: -5360, y: -264 },
    { x: -11397, y: -4470 },
    { x: -14235, y: -10992 },
    { x: -6729, y: -3769 },
  ];
  const projected = lap.map((point) => {
    const location = mapLocation(track, point);
    const distanceMeters =
      projectLocation(track.centerline, location.x, location.y).distance /
      track.transform.scale /
      10;
    assert.ok(distanceMeters < 10);
    return location.progress;
  });
  assert.ok(projected.every((progress, index) => index === 0 || progress > projected[index - 1]));
  assert.ok(Math.abs(track.centerline.at(-1).distanceM / 10 - 6003) < 300);
});
