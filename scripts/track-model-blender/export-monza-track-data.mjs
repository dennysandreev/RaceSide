import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { downloadMonzaData, MONZA_BOUNDS_UTM32N } from "./download-monza-data.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "../..");

export const MONZA_MAIN_CIRCUIT_WAY_IDS = [
  19_842_206, 179_968_242, 179_968_264, 179_968_220, 179_968_262,
  179_968_245, 179_968_263, 179_968_229, 179_968_251, 179_968_230,
  179_968_252, 179_968_228, 1_443_867_792, 1_443_867_793, 179_968_254,
  179_968_226, 179_968_249, 179_968_239, 179_968_257, 179_968_234,
];
const START_FINISH_REFERENCE = { lat: 45.6155357, lon: 9.2806996 };

export const MONZA_TURNS = [
  [1, 934, "Prima Variante"], [2, 969, "Prima Variante"], [3, 1_420, "Curva Grande"],
  [4, 2_152, "Variante della Roggia"], [5, 2_196, "Variante della Roggia"],
  [6, 2_523, "Curva di Lesmo 1"], [7, 2_891, "Curva di Lesmo 2"],
  [8, 3_960, "Variante Ascari"], [9, 4_086, "Variante Ascari"],
  [10, 4_150, "Variante Ascari"], [11, 5_139, "Curva Alboreto"],
].map(([number, distanceMeters, name]) => ({
  anchorHeightMeters: 5,
  anchorOffsetMeters: 16,
  distanceMeters,
  name,
  number,
  ...(number === 11
    ? {
        anchorDistanceMeters: 5_240,
        curbEndMeters: 5_550,
        curbStartMeters: 5_120,
      }
    : {}),
}));

const GRANDSTANDS = [
  stand("Centrale 1", 5_610, 5_780, "left", 28, 22, 14, 24),
  stand("Laterale Sinistra 4", 35, 260, "left", 30, 19, 12, 20),
  stand("Laterale Destra 26", 45, 260, "right", 31, 20, 13, 22),
  stand("Prima Variante Esterna 8", 790, 1_035, "right", 31, 20, 12, 22),
  stand("Uscita Prima Variante 8 bis", 1_020, 1_155, "left", 28, 18, 10, 18),
  stand("Alta Velocità A–C", 1_225, 1_700, "right", 32, 20, 12, 22),
  stand("Biassono 7", 1_345, 1_635, "left", 29, 19, 11, 20),
  stand("Seconda Variante 9", 2_015, 2_250, "left", 28, 19, 11, 20),
  stand("Roggia 10", 2_020, 2_245, "right", 29, 19, 11, 20),
  stand("Lesmo 1 Esterna 34", 2_410, 2_620, "right", 29, 18, 10, 18),
  stand("Serraglio 11", 3_220, 3_510, "left", 30, 18, 10, 18),
  stand("Ascari 12–14", 3_770, 4_270, "left", 30, 20, 12, 22),
  stand("Ascari Esterna 17", 3_805, 4_260, "right", 32, 21, 13, 22),
  stand("Uscita Ascari 18", 4_250, 4_420, "right", 30, 18, 10, 18),
  stand("Rettilineo Parabolica Esterna 20", 4_590, 4_890, "right", 31, 19, 11, 20),
  stand("Laterale Parabolica 21", 4_930, 5_300, "right", 32, 21, 13, 22),
  stand("Parabolica 22", 5_020, 5_340, "left", 30, 20, 12, 22),
  stand("Parabolica Interna 23", 5_230, 5_480, "left", 27, 18, 10, 18),
  stand("Vedano 24", 5_380, 5_565, "right", 28, 18, 10, 18),
];

export async function exportMonzaTrackData({ forceSources = false, outputPath, sourceDirectory }) {
  const resolvedSourceDirectory = sourceDirectory ? path.resolve(sourceDirectory) : path.join(projectRoot, ".track-model-build/monza-source");
  const sourceManifest = await downloadMonzaData({ force: forceSources, sourceDirectory: resolvedSourceDirectory });
  const osm = JSON.parse(await readFile(path.join(resolvedSourceDirectory, "openstreetmap-raceway.json"), "utf8"));
  const centerline = assembleMainCircuit(osm, MONZA_MAIN_CIRCUIT_WAY_IDS);
  const sourceStartFinishOffsetMeters = nearestDistance(centerline, utm32nFromWgs84(START_FINISH_REFERENCE.lat, START_FINISH_REFERENCE.lon));
  const payload = {
    generatorVersion: "2.0.0",
    grandstands: GRANDSTANDS,
    model: {
      bounds: MONZA_BOUNDS_UTM32N,
      center: { x: (MONZA_BOUNDS_UTM32N.minX + MONZA_BOUNDS_UTM32N.maxX) / 2, y: (MONZA_BOUNDS_UTM32N.minY + MONZA_BOUNDS_UTM32N.maxY) / 2 },
      id: "monza", lapLengthMeters: 5_793, mainCircuitWayIds: MONZA_MAIN_CIRCUIT_WAY_IDS,
      pitBoxes: 60, pitLaneWayId: 38_168_747, pitLaneWidthMeters: 12,
      sourceStartFinishOffsetMeters: round(sourceStartFinishOffsetMeters), startFinishDistanceMeters: 0,
      trackWidthMeters: 12, turns: MONZA_TURNS,
    },
    officialControlPoints: {
      drs: [
        { distanceFromTurnMeters: 95, kind: "detection-before", turn: 7, zone: 1 },
        { distanceFromTurnMeters: 170, kind: "activation-after", turn: 7, zone: 1 },
        { distanceFromTurnMeters: 20, kind: "detection-after", turn: 11, zone: 2 },
        { distanceFromTurnMeters: 922, kind: "activation-before", turn: 1, zone: 2 },
      ],
      sectorBoundaries: [{ absoluteDistanceMeters: 1_919, sector: 2 }, { absoluteDistanceMeters: 3_745, sector: 3 }],
      speedTrap: { beforeTurnMeters: 212, turn: 1 },
    },
    officialSources: [
      { role: "photographic reference for hospitality glazing, pit-side structures and the north/south towers; dimensions reconstructed", url: "https://www.monzanet.it/wp-content/uploads/2026/01/Brochure_Hospitality_GP_2026F1.pdf" },
      { role: "historic oval reference, including the published maximum 80 percent banking", url: "https://www.monzanet.it/en/the-flyover-of-monza/" },
      { role: "official venue specifications: 5.793 km, 11 turns, 10–12 m width and clockwise direction", url: "https://www.monzanet.it/en/circuit/" },
      { role: "pinned FIA 2025 operational circuit map: sectors, speed trap, DRS and pit-lane drawing", url: "https://www.fia.com/system/files/decision-document/2025_italian_grand_prix_-_event_notes_-_circuit_map_pit_lane_emergency_exit_map_quarantine_zone_and_red_zones.pdf" },
      { role: "official 2026 Monza named grandstand inventory", url: "https://www.monzanet.it/wp-content/uploads/2026/06/GP_F1_2026_LISTINO_PREZZI_6_17.pdf" },
      { role: "Italian National Geoportal 2012 colour orthophoto WMS", url: "https://wms.pcn.minambiente.it/ogc?map=/ms_ogc/WMS_v1.3/raster/ortofoto_colore_12.map&service=WMS&request=GetCapabilities&version=1.3.0" },
      { role: "Terrarium elevation format and attribution", url: "https://docs.versatiles.org/basics/tilesets.html#elevation" },
    ],
    schemaVersion: 1, sourceDirectory: resolvedSourceDirectory, sourceManifest,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

function stand(name, start, end, side, offset, depth, height, rows) {
  return { depth, end, height, name, offset, rows, sectionLengthMeters: 45, side, start };
}
function assembleMainCircuit(osm, wayIds) {
  const ways = new Map(osm.elements.filter((item) => item.type === "way").map((way) => [way.id, way]));
  const points = [];
  for (const wayId of wayIds) {
    const way = ways.get(wayId); if (!way?.geometry?.length) throw new Error(`OSM way ${wayId} is missing`);
    let geometry = way.geometry.map(({ lat, lon }) => utm32nFromWgs84(lat, lon));
    if (points.length) { if (distance(points.at(-1), geometry.at(-1)) < distance(points.at(-1), geometry[0])) geometry.reverse(); if (distance(points.at(-1), geometry[0]) < 0.5) geometry = geometry.slice(1); }
    points.push(...geometry);
  }
  if (distance(points[0], points.at(-1)) > 0.05) points.push(points[0]);
  return points;
}
function nearestDistance(points, target) {
  let total = 0; let nearest = { distance: Infinity, progress: 0 };
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1], b = points[index], dx = b[0] - a[0], dy = b[1] - a[1], length2 = dx * dx + dy * dy;
    const blend = Math.max(0, Math.min(1, ((target[0] - a[0]) * dx + (target[1] - a[1]) * dy) / Math.max(length2, 1e-9)));
    const separation = distance([a[0] + dx * blend, a[1] + dy * blend], target);
    if (separation < nearest.distance) nearest = { distance: separation, progress: total + Math.sqrt(length2) * blend };
    total += Math.sqrt(length2);
  }
  return nearest.progress;
}
export function utm32nFromWgs84(lat, lon) {
  const a0 = 6_378_137, f = 1 / 298.257223563, k = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2), latitude = lat * Math.PI / 180, dlon = (lon - 9) * Math.PI / 180;
  const sin = Math.sin(latitude), cos = Math.cos(latitude), tan = Math.tan(latitude), n = a0 / Math.sqrt(1 - e2 * sin ** 2), t = tan ** 2, c = ep2 * cos ** 2, aa = cos * dlon;
  const m = a0 * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * latitude - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * latitude) + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * latitude) - 35 * e2 ** 3 / 3072 * Math.sin(6 * latitude));
  return [500_000 + k * n * (aa + (1 - t + c) * aa ** 3 / 6 + (5 - 18 * t + t ** 2 + 72 * c - 58 * ep2) * aa ** 5 / 120), k * (m + n * tan * (aa ** 2 / 2 + (5 - t + 9 * c + 4 * c ** 2) * aa ** 4 / 24 + (61 - 58 * t + t ** 2 + 600 * c - 330 * ep2) * aa ** 6 / 720))];
}
function distance(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }
function round(value) { return Math.round(value * 1_000) / 1_000; }
