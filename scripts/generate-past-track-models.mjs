import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDirectory = path.join(os.tmpdir(), "raceside-track-model-cache");
const outputDirectory = path.join(projectRoot, "src/data");
const geoJsonCommit = "394d8fbe70ef2c0b0c8d23ff7bee61fa09606055";
const geoJsonUrl = `https://raw.githubusercontent.com/bacinger/f1-circuits/${geoJsonCommit}/f1-circuits.geojson`;
const terrainBounds = { maxX: 1.28, maxY: 1.12, minX: -1.28, minY: -1.12 };
const terrainColumns = 25;
const terrainRows = 19;
const trackSampleCount = 100;
const sharedVerticalExaggeration = 3.6;

const tracks = [
  {
    aliases: [
      "albert park grand prix circuit",
      "albert park circuit",
      "albert park",
      "melbourne",
      "мельбурн",
      "australian grand prix",
      "гран-при австралии",
    ],
    circuitName: "Albert Park Circuit",
    elevationDataset: "aster30m",
    elevationLabel: "ASTER GDEM 30 м · OpenTopoData",
    fileName: "albert-park-model.ts",
    geoJsonId: "au-1953",
    gravelTurns: [11, 12],
    id: "albert-park",
    mapFile: "public/f1/circuits/2026/01-australia.webp",
    multiViewerKey: 10,
    round: 1,
    runoffTurns: [1, 2, 3, 5, 6, 9, 10, 11, 12, 13, 14],
    sectorBreaks: [
      { after: 5, before: 6, ratio: 0.75 },
      { after: 8, before: 9, ratio: 0.9 },
    ],
    speedTrap: { before: 1, ratioFromStart: 0.65 },
    variablePrefix: "ALBERT_PARK",
  },
  {
    aliases: [
      "shanghai international circuit",
      "shanghai circuit",
      "shanghai",
      "шанхай",
      "chinese grand prix",
      "гран-при китая",
    ],
    circuitName: "Shanghai International Circuit",
    elevationDataset: "aster30m",
    elevationLabel: "ASTER GDEM 30 м · OpenTopoData",
    fileName: "shanghai-model.ts",
    geoJsonId: "cn-2004",
    gravelTurns: [1, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16],
    id: "shanghai",
    mapFile: "public/f1/circuits/2026/02-china.webp",
    multiViewerKey: 49,
    round: 2,
    runoffTurns: [1, 2, 3, 4, 6, 9, 11, 12, 13, 14, 16],
    sectorBreaks: [
      { after: 4, before: 5, ratio: 0.55 },
      { after: 10, before: 11, ratio: 0.75 },
    ],
    speedTrap: { after: 13, before: 14, ratio: 0.72 },
    variablePrefix: "SHANGHAI",
  },
  {
    aliases: [
      "suzuka international racing course",
      "suzuka circuit",
      "suzuka",
      "сузука",
      "japanese grand prix",
      "гран-при японии",
    ],
    circuitName: "Suzuka International Racing Course",
    curbTurnSides: { 11: -1 },
    elevationDataset: "aster30m",
    elevationLabel: "ASTER GDEM 30 м · OpenTopoData",
    fileName: "suzuka-model.ts",
    geoJsonId: "jp-1962",
    gravelTurns: [1, 2, 7, 8, 9, 11, 13, 14, 15, 18],
    id: "suzuka",
    mapFile: "public/f1/circuits/2026/03-japan.webp",
    multiViewerKey: 46,
    overpasses: [{ from: 0.824, to: 0.86, level: true }],
    round: 3,
    runoffTurns: [1, 2, 7, 8, 9, 11, 13, 14, 15, 16, 17, 18],
    runoffTurnSides: { 11: -1 },
    sectorBreaks: [
      { after: 7, before: 8, ratio: 0.35 },
      { after: 14, before: 15, ratio: 0.3 },
    ],
    speedTrap: { after: 15, before: 16, ratio: 0.55 },
    variablePrefix: "SUZUKA",
  },
  {
    aliases: [
      "miami international autodrome",
      "miami autodrome",
      "miami",
      "майами",
      "miami grand prix",
      "гран-при майами",
    ],
    circuitName: "Miami International Autodrome",
    elevationDataset: "aster30m",
    elevationLabel: "ASTER GDEM 30 м · OpenTopoData",
    fileName: "miami-model.ts",
    geoJsonId: "us-2022",
    gravelTurns: [],
    id: "miami",
    mapFile: "public/f1/circuits/2026/04-miami.webp",
    multiViewerKey: 151,
    round: 4,
    runoffTurns: [1, 2, 3, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    sectorBreaks: [
      { after: 8, before: 9, ratio: 0.45 },
      { after: 16, before: 17, ratio: 0.1 },
    ],
    speedTrap: { after: 16, before: 17, ratio: 0.72 },
    trackWidthScale: 0.68,
    variablePrefix: "MIAMI",
  },
  {
    aliases: [
      "circuit gilles-villeneuve",
      "circuit gilles villeneuve",
      "gilles villeneuve",
      "montreal",
      "монреаль",
      "canadian grand prix",
      "гран-при канады",
    ],
    circuitName: "Circuit Gilles-Villeneuve",
    elevationDataset: "aster30m",
    elevationLabel: "ASTER GDEM 30 м · OpenTopoData",
    fileName: "montreal-model.ts",
    geoJsonId: "ca-1978",
    gravelTurns: [],
    id: "montreal",
    mapFile: "public/f1/circuits/2026/05-canada.webp",
    multiViewerKey: 23,
    round: 5,
    runoffTurns: [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 13, 14],
    sectorBreaks: [
      { after: 5, before: 6, ratio: 0.5 },
      { after: 9, before: 10, ratio: 0.8 },
    ],
    speedTrap: { after: 12, before: 13, ratio: 0.65 },
    trackWidthScale: 0.65,
    variablePrefix: "MONTREAL",
  },
  {
    aliases: [
      "circuit de monaco",
      "monaco circuit",
      "monte carlo",
      "monaco",
      "монако",
      "monaco grand prix",
      "гран-при монако",
    ],
    annotationOffsets: {
      lowPoint: [-65, -55],
    },
    circuitName: "Circuit de Monaco",
    elevationDataset: "eudem25m",
    elevationLabel: "EU-DEM 25 м · OpenTopoData",
    fileName: "monaco-model.ts",
    geoJsonId: "mc-1929",
    gravelTurns: [],
    id: "monaco",
    mapFile: "public/f1/circuits/2026/06-monaco.webp",
    multiViewerKey: 22,
    round: 6,
    runoffTurns: [1, 5, 10, 11, 15, 16, 18, 19],
    sectorBreaks: [
      { after: 4, before: 5, ratio: 0.65 },
      { after: 12, before: 13, ratio: 0.4 },
    ],
    speedTrap: { after: 9, before: 10, ratio: 0.55 },
    terrainReliefScale: 0.48,
    variablePrefix: "MONACO",
  },
  {
    aliases: [
      "circuit de barcelona-catalunya",
      "circuit de barcelona catalunya",
      "barcelona-catalunya",
      "catalunya",
      "каталунья",
      "barcelona grand prix",
      "гран-при барселоны",
    ],
    circuitName: "Circuit de Barcelona-Catalunya",
    elevationDataset: "eudem25m",
    elevationLabel: "EU-DEM 25 м · OpenTopoData",
    fileName: "catalunya-model.ts",
    geoJsonId: "es-1991",
    gravelTurns: [1, 3, 4, 5, 10, 12, 13, 14],
    id: "catalunya",
    mapFile: "public/f1/circuits/2026/07-barcelona-catalunya.webp",
    multiViewerKey: 15,
    round: 7,
    runoffTurns: [1, 2, 3, 4, 5, 7, 9, 10, 12, 13, 14],
    sectorBreaks: [
      { after: 3, before: 4, ratio: 0.55 },
      { after: 9, before: 10, ratio: 0.45 },
    ],
    speedTrap: { before: 1, ratioFromStart: 0.45 },
    variablePrefix: "CATALUNYA",
  },
  {
    aliases: [
      "silverstone circuit",
      "silverstone",
      "сильверстоун",
      "british grand prix",
      "гран-при великобритании",
      "great britain",
    ],
    circuitName: "Silverstone Circuit",
    elevationDataset: "eudem25m",
    elevationLabel: "EU-DEM 25 м · OpenTopoData",
    fileName: "silverstone-model.ts",
    geoJsonId: "gb-1948",
    gravelTurns: [1, 3, 4, 5, 6, 7, 9, 15, 16, 18],
    id: "silverstone",
    mapFile: "public/f1/circuits/2026/09-great-britain.webp",
    multiViewerKey: 2,
    round: 9,
    runoffTurns: [1, 3, 4, 5, 6, 7, 9, 13, 14, 15, 16, 17, 18],
    sectorBreaks: [
      { after: 5, before: 6, ratio: 0.28 },
      { after: 14, before: 15, ratio: 0.12 },
    ],
    speedTrap: { after: 14, before: 15, ratio: 0.65 },
    variablePrefix: "SILVERSTONE",
  },
  {
    aliases: [
      "circuit de spa-francorchamps",
      "spa-francorchamps",
      "spa francorchamps",
      "spa",
      "спа-франкоршам",
      "belgian grand prix",
      "гран-при бельгии",
    ],
    circuitName: "Circuit de Spa-Francorchamps",
    elevationDataset: "eudem25m",
    elevationLabel: "EU-DEM 25 м · OpenTopoData",
    fileName: "spa-model.ts",
    geoJsonId: "be-1925",
    gravelTurns: [1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    id: "spa",
    mapFile: "public/f1/circuits/2026/10-belgium.webp",
    multiViewerKey: 7,
    round: 10,
    runoffTurns: [1, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    sectorBreaks: [
      { after: 4, before: 5, ratio: 0.4 },
      { after: 14, before: 15, ratio: 0.55 },
    ],
    speedTrap: { after: 4, before: 5, ratio: 0.48 },
    variablePrefix: "SPA",
  },
  {
    aliases: [
      "hungaroring",
      "хунгароринг",
      "hungarian grand prix",
      "гран-при венгрии",
      "budapest",
      "будапешт",
    ],
    circuitName: "Hungaroring",
    elevationDataset: "eudem25m",
    elevationLabel: "EU-DEM 25 м · OpenTopoData",
    fileName: "hungaroring-model.ts",
    geoJsonId: "hu-1986",
    gravelTurns: [1, 2, 4, 5, 6, 7, 11, 12, 13, 14],
    id: "hungaroring",
    mapFile: "public/f1/circuits/2026/11-hungary.webp",
    multiViewerKey: 4,
    round: 11,
    runoffTurns: [1, 2, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14],
    sectorBreaks: [
      { after: 3, before: 4, ratio: 0.55 },
      { after: 11, before: 12, ratio: 0.2 },
    ],
    speedTrap: { before: 1, ratioFromStart: 0.44 },
    variablePrefix: "HUNGARORING",
  },
];

await fs.mkdir(cacheDirectory, { recursive: true });

const geoJson = await readCachedJson("f1-circuits.geojson", geoJsonUrl);

for (const track of tracks) {
  // These tracks are built from pinned geodata in Blender. Do not overwrite them
  // with the legacy schematic generator when refreshing the other circuits.
  if (track.id === "albert-park") continue;
  if (track.id === "miami") continue;
  if (track.id === "suzuka") continue;
  if (track.id === "shanghai") continue;
  const feature = geoJson.features.find(({ properties }) => properties.id === track.geoJsonId);

  if (!feature || feature.geometry.type !== "LineString") {
    throw new Error(`Missing LineString geometry for ${track.id}`);
  }

  const multiViewer = await readCachedJson(
    `multiviewer-${track.id}.json`,
    `https://api.multiviewer.app/api/v1/circuits/${track.multiViewerKey}/2025`,
  );
  const geographicLine = createGeographicLine(feature.geometry.coordinates);
  const alignment = alignGeographicLine(geographicLine, multiViewer);
  const orderedCoordinates = Array.from({ length: trackSampleCount }, (_, index) =>
    sampleClosedLine(
      geographicLine.points,
      modulo(alignment.startProgress + alignment.direction * (index / trackSampleCount), 1),
    ),
  );
  const trackLocations = orderedCoordinates.map((point) =>
    localMetersToLonLat(point, geographicLine.reference),
  );
  const terrainLocations = createTerrainLocations(geographicLine);
  const elevations = await readElevationData(track, [...trackLocations, ...terrainLocations]);
  const rawTrackElevations = fillMissingElevations(elevations.slice(0, trackSampleCount));
  const rawElevationChangeM = Math.max(...rawTrackElevations) - Math.min(...rawTrackElevations);
  const smoothingRadius = rawElevationChangeM <= 18 ? 5 : 2;
  const trackElevations = smoothCircular(rawTrackElevations, smoothingRadius);
  const terrainElevations = scaleTerrainRelief(
    fillMissingElevations(elevations.slice(trackSampleCount)),
    track.terrainReliefScale ?? 1,
  );
  const turnProgresses = getTurnProgresses(multiViewer);
  const sectorBreaks = track.sectorBreaks.map((boundary) =>
    interpolateTurnProgress(turnProgresses, boundary),
  );
  const speedTrapProgress = getSpeedTrapProgress(turnProgresses, track.speedTrap);
  const modelSource = applyRenderingOverrides(
    renderModelSource({
      alignment,
      geographicLine,
      orderedCoordinates,
      sectorBreaks,
      speedTrapProgress,
      terrainElevations,
      track,
      trackElevations,
      turnProgresses,
    }),
    track,
  );

  await fs.writeFile(path.join(outputDirectory, track.fileName), modelSource);
  process.stdout.write(
    `${track.id}: fit ${(alignment.error * 100).toFixed(1)}%, ` +
      `camera ${alignment.cameraRotationDeg.toFixed(1)}°, ` +
      `elevation ${getElevationChange(trackElevations)} m\n`,
  );
}

async function readCachedJson(fileName, url) {
  const filePath = path.join(cacheDirectory, fileName);

  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    const response = await fetch(url, { headers: { "User-Agent": "RaceSide-track-model/1.0" } });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    const value = await response.json();
    await fs.writeFile(filePath, `${JSON.stringify(value)}\n`);
    return value;
  }
}

async function readElevationData(track, locations) {
  const cacheName = `elevation-${track.id}-${track.elevationDataset}.json`;
  const cachePath = path.join(cacheDirectory, cacheName);

  try {
    const cached = JSON.parse(await fs.readFile(cachePath, "utf8"));

    if (cached.length === locations.length) {
      return cached;
    }
  } catch {
    // A missing or stale cache is rebuilt below.
  }

  const values = [];

  for (let offset = 0; offset < locations.length; offset += 100) {
    const batch = locations.slice(offset, offset + 100);
    const query = batch.map(([lon, lat]) => `${lat.toFixed(6)},${lon.toFixed(6)}`).join("|");
    const url = `https://api.opentopodata.org/v1/${track.elevationDataset}?locations=${encodeURIComponent(query)}&interpolation=cubic`;
    const response = await fetchWithRetry(url);
    const payload = await response.json();

    if (payload.status !== "OK" || !Array.isArray(payload.results)) {
      throw new Error(`Invalid elevation response for ${track.id}`);
    }

    values.push(...payload.results.map(({ elevation }) => elevation));

    if (offset + batch.length < locations.length) {
      await delay(1_150);
    }
  }

  const normalized = fillMissingElevations(values);
  await fs.writeFile(cachePath, `${JSON.stringify(normalized)}\n`);
  return normalized;
}

async function fetchWithRetry(url) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": "RaceSide-track-model/1.0" } });

    if (response.ok) {
      return response;
    }

    if (response.status !== 429 && response.status < 500) {
      throw new Error(`Elevation request failed: ${response.status}`);
    }

    await delay(1_500 * (attempt + 1));
  }

  throw new Error("Elevation request failed after retries");
}

function createGeographicLine(coordinates) {
  const source = coordinates.map(([lon, lat]) => ({ lat, lon }));
  const reference = {
    lat: average(source.map(({ lat }) => lat)),
    lon: average(source.map(({ lon }) => lon)),
  };
  const points = source.map(({ lat, lon }) => lonLatToLocalMeters(lon, lat, reference));
  const bounds = getBounds(points);

  return {
    center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
    halfSpan: Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2,
    points,
    reference,
  };
}

function alignGeographicLine(geographicLine, multiViewer) {
  const sampleCount = 384;
  const geographicSamples = Array.from({ length: sampleCount }, (_, index) =>
    sampleClosedLine(geographicLine.points, index / sampleCount),
  );
  const telemetryPoints = multiViewer.x.map((x, index) => ({ x, y: multiViewer.y[index] }));
  const telemetrySamples = Array.from({ length: sampleCount }, (_, index) =>
    sampleClosedLine(telemetryPoints, index / sampleCount),
  );
  let best = null;

  for (const direction of [1, -1]) {
    for (let shift = 0; shift < sampleCount; shift += 1) {
      const candidate = Array.from({ length: sampleCount }, (_, index) =>
        geographicSamples[modulo(shift + direction * index, sampleCount)],
      );
      const fit = fitSimilarity(telemetrySamples, candidate);

      if (!best || fit.error < best.error) {
        best = { ...fit, direction, shift };
      }
    }
  }

  const fitAngleDeg = (Math.atan2(best.imaginaryScale, best.realScale) * 180) / Math.PI;

  return {
    cameraRotationDeg: normalizeDegrees(Number(multiViewer.rotation) + 180 - fitAngleDeg),
    direction: best.direction,
    error: best.error,
    startProgress: best.shift / sampleCount,
  };
}

function fitSimilarity(source, target) {
  const sourceCenter = {
    x: average(source.map(({ x }) => x)),
    y: average(source.map(({ y }) => y)),
  };
  const targetCenter = {
    x: average(target.map(({ x }) => x)),
    y: average(target.map(({ y }) => y)),
  };
  let denominator = 0;
  let realNumerator = 0;
  let imaginaryNumerator = 0;

  for (let index = 0; index < source.length; index += 1) {
    const sourceX = source[index].x - sourceCenter.x;
    const sourceY = source[index].y - sourceCenter.y;
    const targetX = target[index].x - targetCenter.x;
    const targetY = target[index].y - targetCenter.y;
    denominator += sourceX ** 2 + sourceY ** 2;
    realNumerator += targetX * sourceX + targetY * sourceY;
    imaginaryNumerator += targetY * sourceX - targetX * sourceY;
  }

  const realScale = realNumerator / denominator;
  const imaginaryScale = imaginaryNumerator / denominator;
  let squaredError = 0;
  let targetVariance = 0;

  for (let index = 0; index < source.length; index += 1) {
    const sourceX = source[index].x - sourceCenter.x;
    const sourceY = source[index].y - sourceCenter.y;
    const targetX = target[index].x - targetCenter.x;
    const targetY = target[index].y - targetCenter.y;
    const predictedX = realScale * sourceX - imaginaryScale * sourceY;
    const predictedY = imaginaryScale * sourceX + realScale * sourceY;
    squaredError += (predictedX - targetX) ** 2 + (predictedY - targetY) ** 2;
    targetVariance += targetX ** 2 + targetY ** 2;
  }

  return {
    error: Math.sqrt(squaredError / Math.max(targetVariance, 1)),
    imaginaryScale,
    realScale,
  };
}

function createTerrainLocations(geographicLine) {
  return Array.from({ length: terrainRows }, (_, row) =>
    Array.from({ length: terrainColumns }, (_, column) => {
      const normalizedX = lerp(terrainBounds.minX, terrainBounds.maxX, column / (terrainColumns - 1));
      const normalizedY = lerp(terrainBounds.minY, terrainBounds.maxY, row / (terrainRows - 1));
      const orderedPoint = {
        x: geographicLine.center.x + normalizedX * geographicLine.halfSpan,
        y: geographicLine.center.y + normalizedY * geographicLine.halfSpan,
      };

      return localMetersToLonLat(orderedPoint, geographicLine.reference);
    }),
  ).flat();
}

function getTurnProgresses(multiViewer) {
  const telemetryPoints = multiViewer.x.map((x, index) => ({ x, y: multiViewer.y[index] }));
  const cumulative = getCumulativeDistances(telemetryPoints);
  const total = cumulative.at(-1) + distance(telemetryPoints.at(-1), telemetryPoints[0]);
  const turnProgresses = new Map();

  for (const corner of multiViewer.corners) {
    if (corner.letter || turnProgresses.has(corner.number)) {
      continue;
    }

    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < telemetryPoints.length; index += 1) {
      const currentDistance = distance(telemetryPoints[index], corner.trackPosition);

      if (currentDistance < nearestDistance) {
        nearestDistance = currentDistance;
        nearestIndex = index;
      }
    }

    turnProgresses.set(Number(corner.number), cumulative[nearestIndex] / total);
  }

  return turnProgresses;
}

function interpolateTurnProgress(turnProgresses, { after, before, ratio }) {
  return round(lerp(requiredTurn(turnProgresses, after), requiredTurn(turnProgresses, before), ratio), 4);
}

function getSpeedTrapProgress(turnProgresses, speedTrap) {
  if ("ratioFromStart" in speedTrap) {
    return round(requiredTurn(turnProgresses, speedTrap.before) * speedTrap.ratioFromStart, 4);
  }

  return round(
    lerp(
      requiredTurn(turnProgresses, speedTrap.after),
      requiredTurn(turnProgresses, speedTrap.before),
      speedTrap.ratio,
    ),
    4,
  );
}

function requiredTurn(turnProgresses, turnNumber) {
  const value = turnProgresses.get(turnNumber);

  if (value === undefined) {
    throw new Error(`Missing turn ${turnNumber}`);
  }

  return value;
}

function renderModelSource({
  alignment,
  geographicLine,
  orderedCoordinates,
  sectorBreaks,
  speedTrapProgress,
  terrainElevations,
  track,
  trackElevations,
  turnProgresses,
}) {
  const modelPoints = orderedCoordinates.map((point, index) => [
    index / trackSampleCount,
    (point.x - geographicLine.center.x) * 10,
    (point.y - geographicLine.center.y) * 10,
    trackElevations[index] * 10,
  ]);
  modelPoints.push([1, modelPoints[0][1], modelPoints[0][2], modelPoints[0][3]]);
  const terrainRowsData = Array.from({ length: terrainRows }, (_, row) =>
    terrainElevations.slice(row * terrainColumns, (row + 1) * terrainColumns),
  );
  const elevationChangeM = getElevationChange(trackElevations);
  const grades = getTrackGrades(trackElevations, geographicLine.points);
  const turnNumbers = [...turnProgresses.keys()].sort((left, right) => left - right);
  const verticalExaggeration = sharedVerticalExaggeration;
  const contourIntervalM = elevationChangeM < 18 ? 2 : elevationChangeM < 55 ? 5 : 10;
  const terrainMin = Math.min(...terrainElevations);
  const terrainMax = Math.max(...terrainElevations);
  const sourceComment = [
    "/**",
    " * Sources checked 2026-08-06:",
    ` * - official 2026 F1 map: ${track.mapFile};`,
    ` * - centreline: bacinger/f1-circuits ${geoJsonCommit} (MIT), ${track.geoJsonId};`,
    ` * - turn markers cross-checked with MultiViewer circuit API, key ${track.multiViewerKey}, 2025;`,
    ` * - terrain and centreline elevations: ${track.elevationLabel}.`,
    ` * Alignment RMS: ${(alignment.error * 100).toFixed(1)}% of track radius.`,
    " */",
  ].join("\n");

  const serializedPoints = modelPoints.map(([progress, x, y, elevation]) => [
    round(progress, 2),
    round(x, 1),
    round(y, 1),
    round(elevation, 1),
  ]);

  return `import type {\n  CircuitModelPoint,\n  CircuitModelTurn,\n  CircuitTerrainRow,\n  TrackModelDefinition,\n} from "@/data/track-model-types";\n\n${sourceComment}\n\nexport const ${track.variablePrefix}_MODEL = {\n  circuitName: ${JSON.stringify(track.circuitName)},\n  elevationChangeM: ${elevationChangeM},\n  maxDownhillPercent: ${grades.downhill},\n  maxUphillPercent: ${grades.uphill},\n  points: ${formatArray(serializedPoints, 2)} satisfies readonly CircuitModelPoint[],\n  sectorBreaks: [${sectorBreaks.join(", ")}] as const,\n  speedTrapProgress: ${speedTrapProgress},\n  turns: ${formatArray(turnNumbers.map((number) => ({ number, progress: round(turnProgresses.get(number), 4) })), 2)} satisfies readonly CircuitModelTurn[],\n} as const;\n\nexport const ${track.variablePrefix}_TERRAIN = {\n  attribution: ${JSON.stringify(track.elevationLabel)},\n  attributionUrl: "https://www.opentopodata.org/",\n  bounds: ${JSON.stringify(terrainBounds)},\n  columns: ${terrainColumns},\n  elevationMaxM: ${round(terrainMax, 1)},\n  elevationMinM: ${round(terrainMin, 1)},\n  rows: ${terrainRows},\n  values: ${formatArray(terrainRowsData.map((row) => row.map((value) => round(value, 1))), 2)} satisfies readonly CircuitTerrainRow[],\n} as const;\n\nexport const ${track.variablePrefix}_TRACK_MODEL = {\n  aliases: ${formatArray(track.aliases, 2)},\n  camera: {\n    centerY: 520,\n    rotationDeg: ${round(alignment.cameraRotationDeg, 1)},\n    scale: 300,\n    tiltDeg: 10,\n    verticalExaggeration: ${verticalExaggeration},\n  },\n  data: ${track.variablePrefix}_MODEL,\n  id: ${JSON.stringify(track.id)},\n  rendering: {\n${track.annotationOffsets ? `    annotationOffsets: ${formatObject(track.annotationOffsets, 4)},\n` : ""}    contourIntervalM: ${contourIntervalM},\n    curbTurnNumbers: ${track.variablePrefix}_MODEL.turns.map(({ number }) => number),\n    gravelTurnNumbers: ${JSON.stringify(track.gravelTurns)},\n    runoffTurnNumbers: ${JSON.stringify(track.runoffTurns)},\n    turnLabelOffsets: ${formatObject(Object.fromEntries(turnNumbers.map((number) => [number, [0, 0]])), 4)},\n    turnLabelTrackOffsets: ${formatObject(Object.fromEntries(turnNumbers.map((number) => [number, 0.07])), 4)},\n  },\n  terrain: ${track.variablePrefix}_TERRAIN,\n} satisfies TrackModelDefinition;\n`;
}

function applyRenderingOverrides(source, track) {
  let result = source;

  if (track.curbTurnSides) {
    result = result.replace(
      "    gravelTurnNumbers:",
      `    curbTurnSides: ${JSON.stringify(track.curbTurnSides)},\n    gravelTurnNumbers:`,
    );
  }

  if (track.overpasses) {
    result = result.replace(
      "    runoffTurnNumbers:",
      `    overpasses: ${JSON.stringify(track.overpasses)},\n    runoffTurnNumbers:`,
    );
  }

  if (track.trackWidthScale) {
    result = result.replace(
      "    turnLabelOffsets:",
      `    trackWidthScale: ${track.trackWidthScale},\n    turnLabelOffsets:`,
    );
  }

  if (track.runoffTurnSides) {
    result = result.replace(
      "    turnLabelOffsets:",
      `    runoffTurnSides: ${JSON.stringify(track.runoffTurnSides)},\n    turnLabelOffsets:`,
    );
  }

  return result;
}

function scaleTerrainRelief(elevations, scale) {
  if (scale === 1) {
    return elevations;
  }

  const minimumElevation = Math.min(...elevations);
  return elevations.map(
    (elevation) => minimumElevation + (elevation - minimumElevation) * scale,
  );
}

function getTrackGrades(elevations, sourcePoints) {
  const totalLengthM = getClosedLength(sourcePoints);
  const distancePerSampleM = totalLengthM / elevations.length;
  let maximumUphill = 0;
  let maximumDownhill = 0;
  const windowSize = 4;

  for (let index = 0; index < elevations.length; index += 1) {
    const before = elevations[modulo(index - windowSize, elevations.length)];
    const after = elevations[modulo(index + windowSize, elevations.length)];
    const grade = ((after - before) / (distancePerSampleM * windowSize * 2)) * 100;
    maximumUphill = Math.max(maximumUphill, grade);
    maximumDownhill = Math.min(maximumDownhill, grade);
  }

  return {
    downhill: round(Math.abs(maximumDownhill), 1),
    uphill: round(maximumUphill, 1),
  };
}

function getElevationChange(elevations) {
  return Math.max(1, Math.round(Math.max(...elevations) - Math.min(...elevations)));
}

function smoothCircular(values, radius) {
  return values.map((_, index) => {
    const samples = [];

    for (let offset = -radius; offset <= radius; offset += 1) {
      samples.push(values[modulo(index + offset, values.length)]);
    }

    return average(samples);
  });
}

function fillMissingElevations(values) {
  const finiteValues = values.filter(Number.isFinite);

  if (finiteValues.length === 0) {
    throw new Error("Elevation dataset returned no finite values");
  }

  return values.map((value, index) => {
    if (Number.isFinite(value)) {
      return Number(value);
    }

    for (let distanceFromIndex = 1; distanceFromIndex < values.length; distanceFromIndex += 1) {
      const before = values[index - distanceFromIndex];
      const after = values[index + distanceFromIndex];

      if (Number.isFinite(before)) {
        return Number(before);
      }

      if (Number.isFinite(after)) {
        return Number(after);
      }
    }

    return average(finiteValues);
  });
}

function sampleClosedLine(points, progress) {
  const cumulative = getCumulativeDistances(points);
  const closingDistance = distance(points.at(-1), points[0]);
  const total = cumulative.at(-1) + closingDistance;
  const target = modulo(progress, 1) * total;

  for (let index = 0; index < points.length; index += 1) {
    const startDistance = cumulative[index];
    const endDistance = index === points.length - 1 ? total : cumulative[index + 1];

    if (target <= endDistance || index === points.length - 1) {
      const next = points[(index + 1) % points.length];
      const segmentLength = Math.max(endDistance - startDistance, 1e-9);
      const ratio = clamp((target - startDistance) / segmentLength, 0, 1);

      return {
        x: lerp(points[index].x, next.x, ratio),
        y: lerp(points[index].y, next.y, ratio),
      };
    }
  }

  return points[0];
}

function getCumulativeDistances(points) {
  const cumulative = [0];

  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative.at(-1) + distance(points[index - 1], points[index]));
  }

  return cumulative;
}

function getClosedLength(points) {
  const cumulative = getCumulativeDistances(points);
  return cumulative.at(-1) + distance(points.at(-1), points[0]);
}

function lonLatToLocalMeters(lon, lat, reference) {
  const earthRadiusM = 6_371_008.8;
  const radians = Math.PI / 180;

  return {
    x: (lon - reference.lon) * radians * earthRadiusM * Math.cos(reference.lat * radians),
    y: (lat - reference.lat) * radians * earthRadiusM,
  };
}

function localMetersToLonLat(point, reference) {
  const earthRadiusM = 6_371_008.8;
  const degrees = 180 / Math.PI;

  return [
    reference.lon + (point.x / (earthRadiusM * Math.cos((reference.lat * Math.PI) / 180))) * degrees,
    reference.lat + (point.y / earthRadiusM) * degrees,
  ];
}

function getBounds(points) {
  return {
    maxX: Math.max(...points.map(({ x }) => x)),
    maxY: Math.max(...points.map(({ y }) => y)),
    minX: Math.min(...points.map(({ x }) => x)),
    minY: Math.min(...points.map(({ y }) => y)),
  };
}

function formatArray(value, indentation) {
  const json = JSON.stringify(value);
  const parsed = JSON.parse(json);
  const prefix = " ".repeat(indentation);

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return json;
  }

  return `[\n${parsed.map((item) => `${prefix}${JSON.stringify(item)}`).join(",\n")}\n${" ".repeat(Math.max(0, indentation - 2))}]`;
}

function formatObject(value, indentation) {
  const prefix = " ".repeat(indentation);
  const closingPrefix = " ".repeat(Math.max(0, indentation - 2));
  const entries = Object.entries(value);

  return `{\n${entries.map(([key, item]) => `${prefix}${JSON.stringify(key)}: ${JSON.stringify(item)}`).join(",\n")}\n${closingPrefix}}`;
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function lerp(start, end, ratio) {
  return start + (end - start) * ratio;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function normalizeDegrees(value) {
  return modulo(value + 180, 360) - 180;
}

function round(value, digits) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
