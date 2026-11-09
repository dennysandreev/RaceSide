import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { utm32nFromWgs84 } from "./export-monza-track-data.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "../..");

export async function writeMonzaClientModel({
  configPath = path.join(projectRoot, ".track-model-build/monza.json"),
  metadataPath = path.join(projectRoot, "public/f1/tracks/3d/monza-metadata.json"),
  outputPath = path.join(projectRoot, "src/data/monza-model.ts"),
} = {}) {
  const preparedDirectory = path.join(projectRoot, ".track-model-build/monza-prepared");
  const assetVersion = createHash("sha256")
    .update(await readFile(path.join(path.dirname(metadataPath), "monza.glb")))
    .digest("hex").slice(0, 12);
  const [config, metadata, rasterMetadata, dtmBuffer] = await Promise.all([
    readJson(configPath),
    readJson(metadataPath),
    readJson(path.join(preparedDirectory, "raster-metadata.json")),
    readFile(path.join(preparedDirectory, "monza-dtm.f32le")),
  ]);
  const osm = await readJson(path.join(config.sourceDirectory, "openstreetmap-raceway.json"));
  const centerline = metadata.drivingLine;
  if (!centerline?.length) throw new Error("Rebuild Monza: the road-aligned driving line is missing");
  const cumulative = cumulativeDistances(centerline);
  const totalLength = cumulative.at(-1);
  const dtm = createHeightRasterSampler(
    dtmBuffer,
    rasterMetadata.rasters.dtm,
    config.model.bounds,
  );
  const pointCount = 720;
  const points = Array.from({ length: pointCount + 1 }, (_, index) => {
    const distanceAlongTrack = totalLength * index / pointCount;
    const point = index === pointCount
      ? centerline[0]
      : sampleLine(centerline, cumulative, distanceAlongTrack);
    const elevation = point[2];
    return [
      round(index / pointCount, 6),
      round(point[0] - config.model.center.x, 3),
      round(point[1] - config.model.center.y, 3),
      round(elevation * 10, 3),
    ];
  });
  points.at(-1).splice(1, 3, ...points[0].slice(1));
  const pitWay = osm.elements.find((element) =>
    element.type === "way" && element.id === config.model.pitLaneWayId
  );
  if (!pitWay?.geometry?.length) {
    throw new Error(`OSM pit-lane way ${config.model.pitLaneWayId} is missing or has no geometry`);
  }
  const pitCenterline = pitWay.geometry.map(({ lat, lon }) => utm32nFromWgs84(lat, lon));
  const pitCumulative = cumulativeDistances(pitCenterline);
  const pitLength = pitCumulative.at(-1);
  const pitPointCount = 96;
  const pitLanePoints = Array.from({ length: pitPointCount + 1 }, (_, index) => {
    const distanceAlongPit = pitLength * index / pitPointCount;
    const point = sampleLine(pitCenterline, pitCumulative, distanceAlongPit);
    return [
      round(index / pitPointCount, 6),
      round(point[0] - config.model.center.x, 3),
      round(point[1] - config.model.center.y, 3),
      round(dtm.sample(point[0], point[1]) * 10, 3),
    ];
  });
  const elevations = metadata.elevationProfile.map((sample) => sample.elevationMeters);
  const slopes = metadata.elevationProfile.slice(1).map((sample, index) => {
    const previous = metadata.elevationProfile[index];
    return (sample.elevationMeters - previous.elevationMeters)
      / (sample.distanceMeters - previous.distanceMeters) * 100;
  });
  const turns = config.model.turns.map((turn) => ({
    name: turn.name,
    number: turn.number,
    progress: round((turn.anchorDistanceMeters ?? turn.distanceMeters) / totalLength, 6),
  }));
  const speedTrap = config.officialControlPoints.speedTrap;
  const speedTrapDistance = config.model.turns[speedTrap.turn - 1].distanceMeters
    - speedTrap.beforeTurnMeters;
  const sectorBreaks = config.officialControlPoints.sectorBoundaries
    .map((boundary) => round(boundary.absoluteDistanceMeters / totalLength, 6));
  const turnLabelOffsets = Object.fromEntries(turns.map(({ number }) => [number, [0, 0]]));
  const content = `import type {
  CircuitModelPoint,
  CircuitModelTurn,
  TrackModelDefinition,
} from "@/data/track-model-types";

/**
 * Generated from the Monza Blender digital twin. Do not hand-edit.
 * Geometry: current OSM; elevations: Terrarium DEM; markers: pinned FIA 2025 operational map.
 * Run \`pnpm track:3d:build monza\` to regenerate this controller metadata.
 */

export const MONZA_MODEL = ${JSON.stringify({
    circuitName: "Monza",
    lapLengthKm: 5.793,
    elevationChangeM: round(metadata.elevationsMeters.high - metadata.elevationsMeters.low, 1),
    maxDownhillPercent: round(Math.abs(Math.min(...slopes)), 1),
    maxUphillPercent: round(Math.max(...slopes), 1),
    points: "__POINTS__",
    sectorBreaks,
    speedTrapProgress: round(speedTrapDistance / totalLength, 6),
    turns: "__TURNS__",
  }, null, 2)
    .replace('"__POINTS__"', `${JSON.stringify(points, null, 2)} satisfies readonly CircuitModelPoint[]`)
    .replace('"__TURNS__"', `${JSON.stringify(turns, null, 2)} satisfies readonly CircuitModelTurn[]`)} as const;

export const MONZA_TERRAIN = ${JSON.stringify({
    attribution: "Geoportale Nazionale PCN orthophoto 2012 · OSM · VersaTiles elevation",
    attributionUrl: "https://wms.pcn.minambiente.it/ogc?map=/ms_ogc/WMS_v1.3/raster/ortofoto_colore_12.map&service=WMS&request=GetCapabilities&version=1.3.0",
    bounds: { maxX: 1, maxY: 1, minX: -1, minY: -1 },
    columns: 2,
    elevationMaxM: round(Math.max(...elevations), 3),
    elevationMinM: round(Math.min(...elevations), 3),
    rows: 2,
    values: [
      [round(metadata.elevationsMeters.low, 3), round(metadata.elevationsMeters.high, 3)],
      [round(metadata.elevationsMeters.high, 3), round(metadata.elevationsMeters.low, 3)],
    ],
  }, null, 2)} as const;

export const MONZA_REPLAY_PATH = ${JSON.stringify({
    baseElevationMeters: round(rasterMetadata.rasters.dtm.minimum, 5),
    pitLanePoints: "__PIT_POINTS__",
    startFinishProgress: 0,
    surfaceOffsetMeters: 1,
    trackPoints: "__TRACK_POINTS__",
    trackWidthMeters: config.model.trackWidthMeters,
  }, null, 2)
    .replace('"__PIT_POINTS__"', `${JSON.stringify(pitLanePoints, null, 2)} satisfies readonly CircuitModelPoint[]`)
    .replace('"__TRACK_POINTS__"', `${JSON.stringify(points, null, 2)} satisfies readonly CircuitModelPoint[]`)} as const;

export const MONZA_TRACK_MODEL = ${JSON.stringify({
    aliases: [
      "monza",
      "autodromo nazionale monza",
      "autodromo nazionale di monza",
      "монца",
      "italian grand prix",
      "гран-при италии",
    ],
    camera: { centerY: 0, rotationDeg: 0, scale: 1, tiltDeg: 10, verticalExaggeration: 1 },
    data: "__MODEL__",
    id: "monza",
    rendering: {
      annotationOffsets: {},
      contourIntervalM: 5,
      curbTurnNumbers: turns.map(({ number }) => number),
      gravelTurnNumbers: [...GRAVEL_TURNS],
      runoffTurnNumbers: turns.map(({ number }) => number),
      turnLabelOffsets,
    },
    terrain: "__TERRAIN__",
    webgl: {
      assetPath: `/f1/tracks/3d/monza.glb?v=${assetVersion}`,
      camera: { fitHeight: 4_100, fitWidth: 3_700, lookAtY: 18, radius: 5_800 },
      elevationDatumLabel: "м DEM",
      previewPath: `/f1/tracks/3d/monza-preview.webp?v=${assetVersion}`,
      turnCount: 11,
    },
  }, null, 2)
    .replace('"__MODEL__"', "MONZA_MODEL")
    .replace('"__TERRAIN__"', "MONZA_TERRAIN")} satisfies TrackModelDefinition;
`;
  await writeFile(outputPath, content, "utf8");
  return { outputPath, pointCount: points.length, totalLength };
}

const GRAVEL_TURNS = [1, 2, 4, 5, 6, 7, 8, 9, 10, 11];

function cumulativeDistances(points) {
  const result = [0];
  for (let index = 1; index < points.length; index += 1) {
    result.push(result.at(-1) + distance(points[index - 1], points[index]));
  }
  return result;
}

function sampleLine(points, cumulative, requestedDistance) {
  const distanceAlongLine = Math.min(Math.max(requestedDistance, 0), cumulative.at(-1));
  const upper = cumulative.findIndex((value) => value >= distanceAlongLine);
  if (upper <= 0) return points[0];
  const lower = upper - 1;
  const blend = (distanceAlongLine - cumulative[lower])
    / Math.max(cumulative[upper] - cumulative[lower], 1e-9);
  return points[lower].map((value, axis) => value * (1 - blend) + points[upper][axis] * blend);
}

function createHeightRasterSampler(buffer, metadata, bounds) {
  const width = Number(metadata.width);
  const height = Number(metadata.height);
  const values = Array.from({ length: width * height }, (_, index) => buffer.readFloatLE(index * 4));
  const sample = (x, y) => {
    const fx = clamp((x - bounds.minX) / (bounds.maxX - bounds.minX) * (width - 1), 0, width - 1);
    const fy = clamp((bounds.maxY - y) / (bounds.maxY - bounds.minY) * (height - 1), 0, height - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);
    const tx = fx - x0;
    const ty = fy - y0;
    return values[y0 * width + x0] * (1 - tx) * (1 - ty)
      + values[y0 * width + x1] * tx * (1 - ty)
      + values[y1 * width + x0] * (1 - tx) * ty
      + values[y1 * width + x1] * tx * ty;
  };
  return { sample };
}

function distance(first, second) {
  return Math.hypot(second[0] - first[0], second[1] - first[1]);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
