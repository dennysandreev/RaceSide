import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildReplayTrackDefinition } from "../worker/index.mjs";
import { registerCircuit } from "../src/lib/replay-pit-lane.mjs";
import { connectModelPitLane } from "../src/features/race-replay/lib/pit-path.ts";
import { readMadringMeshes, surfaceIndex } from "./track-model-blender/audit-madring-surfaces.mjs";
import registry from "../worker/live/tracks/2026.json" with { type: "json" };

// Input: cached OpenF1 {session, laps, locations} per venue, with no DB writes.
// Existing reviewed GLBs/configs supply the current finish line and pit lane.
const historyDirectory = process.argv[2];
if (!historyDirectory) throw new Error("Usage: node scripts/prepare-live-track-maps.mjs <history-directory>");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const round = (n) => Number(n.toFixed(6));
const paths = {};
const reports = [];

for (const entry of registry.filter((track) => track.round >= 17)) {
  const { id } = entry;
  const source = await readJson(resolve(historyDirectory, `${id}.json`));
  const config = await readJson(`.track-model-build/${id}.json`);
  const metadata = await readJson(`public/f1/tracks/3d/${id}-metadata.json`);
  const exports = await import(`../src/data/${id}-model.ts`);
  const model = Object.values(exports).find((value) => value.id === id && value.data);
  const raw = buildReplayTrackDefinition({
    circuit: { id, external_id: id, name: model.data.circuitName, country: source.session.country_name },
    lapsPayload: source.laps, locationByDriver: new Map([[44, source.locations]]),
    sourceSeason: source.session.year, sourceSession: source.session, sourceSessionKey: source.session.session_key,
  });
  if (!raw) throw new Error(`${id}: no complete historical lap`);
  const fit = registerCircuit(model.data.points.map((p) => [p[1], p[2]]), raw.centerline.map((p) => [p.worldX, p.worldY]));
  const origin = fit.transform([0, 0]), unit = fit.transform([1, 0]);
  const scale = Math.hypot(unit[0] - origin[0], unit[1] - origin[1]);
  const rmsMeters = fit.rms / scale;
  if (fit.direction !== 1 || rmsMeters > 60) throw new Error(`${id}: unsafe registration (${fit.direction}, ${rmsMeters.toFixed(1)} m)`);

  const meshes = await readMadringMeshes(await readFile(`public/f1/tracks/3d/${id}.glb`));
  const pitFloor = surfaceIndex([...meshes].filter(([name]) => /Pit_Lane_Mesh/.test(name)).flatMap(([, triangles]) => triangles));
  const pit = config.model.pitCenterline;
  const distances = [0];
  for (let i = 1; i < pit.length; i++) distances.push(distances.at(-1) + Math.hypot(pit[i][0] - pit[i - 1][0], pit[i][1] - pit[i - 1][1]));
  const pitLength = distances.at(-1);
  const pitLanePoints = [];
  for (let i = 0; i <= 256; i++) {
    const d = i / 256 * pitLength;
    const upper = Math.max(1, distances.findIndex((value) => value >= d));
    const blend = (d - distances[upper - 1]) / Math.max(1e-9, distances[upper] - distances[upper - 1]);
    const point = pit[upper].map((v, axis) => pit[upper - 1][axis] + (v - pit[upper - 1][axis]) * blend);
    const x = point[0] - config.model.center.x, y = point[1] - config.model.center.y;
    // Meshopt quantization can move a boundary by centimetres. Sample either
    // side of the same centre point, never an unrelated surface or a guess.
    const floor = pitFloor(x, -y) ?? [[.05, 0], [-.05, 0], [0, .05], [0, -.05]]
      .map(([dx, dy]) => pitFloor(x + dx, -y + dy)).find((height) => height !== null);
    if (floor == null) throw new Error(`${id}: pit path is outside the delivered road at ${i}`);
    pitLanePoints.push([round(i / 256), round(x), round(y), round((floor - .55) * 10)]);
  }
  paths[id] = { baseElevationMeters: metadata.baseElevationMeters, pitLanePoints, startFinishProgress: 0,
    surfaceOffsetMeters: .85, trackWidthMeters: config.model.trackWidthMeters ?? 12 };
  const joined = connectModelPitLane(model.data.points, pitLanePoints);
  const main = model.data.points.slice(0, -1);
  const worldPoints = [...main, ...joined.points].map((p) => fit.transform([p[1], p[2]]));
  const bounds = {
    minX: Math.min(...worldPoints.map((p) => p[0])), maxX: Math.max(...worldPoints.map((p) => p[0])),
    minY: Math.min(...worldPoints.map((p) => p[1])), maxY: Math.max(...worldPoints.map((p) => p[1])),
    minZ: Math.min(...main.map((p) => p[3])), maxZ: Math.max(...main.map((p) => p[3])),
  };
  const viewBox = { width: 1000, height: 720 };
  const projectionScale = Math.min(884 / (bounds.maxX - bounds.minX), 604 / (bounds.maxY - bounds.minY));
  const transform = { invertY: true, scale: projectionScale,
    offsetX: (viewBox.width - (bounds.maxX - bounds.minX) * projectionScale) / 2,
    offsetY: (viewBox.height - (bounds.maxY - bounds.minY) * projectionScale) / 2 };
  const point = (p) => {
    const [worldX, worldY] = fit.transform([p[1], p[2]]);
    return { progress: p[0], worldX: round(worldX), worldY: round(worldY), worldZ: p[3],
      elevationM: p[3] / 10, distanceM: p[0] * model.data.lapLengthKm * 1000,
      svgX: round(transform.offsetX + (worldX - bounds.minX) * projectionScale),
      svgY: round(viewBox.height - transform.offsetY - (worldY - bounds.minY) * projectionScale) };
  };
  const centerline = main.map(point), lane = joined.points.map(point);
  const pathD = (points) => points.map((p, i) => `${i ? "L" : "M"}${p.svgX.toFixed(3)} ${p.svgY.toFixed(3)}`).join(" ");
  const track = {
    ...raw, id: `${id}-live-2026`, centerline, worldBounds: bounds, transform,
    startFinish: { progress: 0, svgX: centerline[0].svgX, svgY: centerline[0].svgY },
    svg: { viewBox, visualPathD: `${pathD(centerline)} Z`, technicalPathD: `${pathD(centerline)} Z` },
    pitLane: { points: lane, visualPathD: pathD(lane), source: "verified_circuit_geometry",
      labelX: lane[Math.floor(lane.length / 2)].svgX, labelY: lane[Math.floor(lane.length / 2)].svgY,
      metadata: { source: "RaceSide current 3D model", referenceUrl: model.terrain.attributionUrl,
        entry: joined.anchors.entry, exit: joined.anchors.exit } },
    liveModelAlignment: { scale: round(scale), rmsMeters: round(rmsMeters),
      source: "OpenF1 historical lap registered to RaceSide current circuit model", sourceSeason: source.session.year,
      sourceSessionKey: source.session.session_key, sourceLapNumber: raw.debug.sourceLapNumber },
    elevation: main.map((p, i) => {
      const next = main[(i + 1) % main.length];
      const distance = Math.hypot(next[1] - p[1], next[2] - p[2]);
      return { progress: p[0], z: p[3],
        normalizedZ: (p[3] - bounds.minZ) / Math.max(1e-9, bounds.maxZ - bounds.minZ),
        gradient: (next[3] - p[3]) / 10 / Math.max(1e-9, distance) * 100 };
    }),
  };
  await writeFile(`worker/live/tracks/${id}-2026.json`, JSON.stringify(track) + "\n");
  reports.push({ id, sourceSessionKey: source.session.session_key, sourceSeason: source.session.year,
    calibrationRmsMeters: round(rmsMeters), scale: round(scale), pitPoints: lane.length });
  console.info(`${id}: ${rmsMeters.toFixed(1)} m RMS; map and pit ready`);
}
await writeFile("src/data/live-2026-paths.json", JSON.stringify(paths) + "\n");
await writeFile("docs/live-track-preparation-2026.json", JSON.stringify(reports, null, 2) + "\n");
