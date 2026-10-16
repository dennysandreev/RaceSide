import { fitTrackModelFrame, orbitTrackModelFrame, type TrackModelCameraFrame } from "./track-model-camera";
import type {
  CircuitModelPoint,
  CircuitTerrainData,
  TrackModelDefinition,
} from "@/data/track-model-types";
import {
  createClosedLoopSegments,
  getBankingElevationM,
  getLeveledTrackElevations,
  getTrackClearanceHalfWidths,
} from "@/lib/track-model-geometry";

export const TRACK_MODEL_VIEW_SIZE = 900;
export const TRACK_MODEL_ROTATION_STEP = 16;
export const TRACK_MODEL_TILT_MAX = 82;
export const TRACK_MODEL_TILT_MIN = 0;
export const TRACK_MODEL_TILT_STEP = 4;

const TERRAIN_COLUMNS = 37;
const TERRAIN_ROWS = 27;
const TRACK_SAMPLES = 480;
const TRACK_HALF_WIDTH = 0.023;

type WorldPoint = {
  elevationM: number;
  progress: number;
  x: number;
  y: number;
};

type TerrainPoint = WorldPoint & {
  sourceElevationM: number;
};

type ProjectedPoint = {
  depth: number;
  x: number;
  y: number;
};

type TrackFramePoint = WorldPoint & {
  bankAngleDeg: number;
  bankingVerticalExaggeration: number;
  clearanceHalfWidth: number;
  normalX: number;
  normalY: number;
};

export type TrackModelPalette = {
  asphalt: string;
  asphaltEdge: string;
  asphaltHighlight: string;
  contour: string;
  curbRed: string;
  curbWhite: string;
  fog: string;
  grassHigh: string;
  grassLow: string;
  gravel: string;
  runoff: string;
  sectorOne: string;
  sectorThree: string;
  sectorTwo: string;
  shadow: string;
  skyBottom: string;
  skyTop: string;
  slab: string;
  speedTrap: string;
  turnBackground: string;
  turnBorder: string;
  turnText: string;
};

export type TrackModelAnnotation = {
  elevationM: number;
  progress: number;
  x: number;
  y: number;
};

export type TrackModelProjection = {
  highPoint: TrackModelAnnotation;
  lowPoint: TrackModelAnnotation;
  sectorBreaks: TrackModelAnnotation[];
  speedTrap: TrackModelAnnotation;
  turns: Array<TrackModelAnnotation & { number: number }>;
};

export type TrackModelScene = {
  definition: TrackModelDefinition;
  elevationDatumOffsetM: number;
  elevationReferenceM: number;
  horizontalHalfSpanM: number;
  highPoint: WorldPoint;
  lowPoint: WorldPoint;
  terrain: TerrainPoint[][];
  track: TrackFramePoint[];
};

type Projector = (point: WorldPoint) => ProjectedPoint;

type TerrainTriangle = {
  depth: number;
  points: [TerrainPoint, TerrainPoint, TerrainPoint];
};

export function createTrackModelScene(definition: TrackModelDefinition): TrackModelScene {
  const rawPoints = normalizeTrackPoints(definition.data.points);
  const terrainResiduals = rawPoints.map((point) => ({
    point,
    residualM: point.elevationM - sampleTerrainSource(definition.terrain, point.x, point.y),
  }));
  const elevationDatumOffsetM = average(terrainResiduals.map(({ residualM }) => residualM));
  const alignedPoints = rawPoints.map((point) => ({
    ...point,
    elevationM: point.elevationM - elevationDatumOffsetM,
  }));
  const alignedResiduals = alignedPoints.map((point) => ({
    point,
    residualM: point.elevationM - sampleTerrainSource(definition.terrain, point.x, point.y),
  }));
  const denseTrack = sampleClosedTrack(alignedPoints, TRACK_SAMPLES);
  const track = addTrackFrames(denseTrack, definition);
  const terrain = buildTerrain(definition.terrain, alignedResiduals);
  const highPoint = denseTrack.reduce((highest, point) =>
    point.elevationM > highest.elevationM ? point : highest,
  );
  const lowPoint = denseTrack.reduce((lowest, point) =>
    point.elevationM < lowest.elevationM ? point : lowest,
  );

  return {
    definition,
    elevationDatumOffsetM,
    elevationReferenceM: definition.terrain.elevationMinM - 4,
    horizontalHalfSpanM: getHorizontalHalfSpanM(definition.data.points),
    highPoint,
    lowPoint,
    terrain,
    track,
  };
}

export function projectTrackModel(
  scene: TrackModelScene,
  rotationDeg: number,
  zoom = 1,
  tiltDeg = scene.definition.camera.tiltDeg,
  panX = 0,
  panY = 0,
  frame?: TrackModelCameraFrame,
): TrackModelProjection {
  const project = createProjector(scene, rotationDeg, zoom, tiltDeg, panX, panY, frame);

  return {
    highPoint: toAnnotation(scene.highPoint, project),
    lowPoint: toAnnotation(scene.lowPoint, project),
    sectorBreaks: scene.definition.data.sectorBreaks.map((progress) =>
      toAnnotation(pointAtProgress(scene.track, progress), project),
    ),
    speedTrap: toAnnotation(
      pointAtProgress(scene.track, scene.definition.data.speedTrapProgress),
      project,
    ),
    turns: scene.definition.data.turns.map((turn) => ({
      ...toAnnotation(pointAtProgress(scene.track, turn.progress), project),
      number: turn.number,
    })),
  };
}

export function getTrackModelCanvasFrame(scene: TrackModelScene, frameRotationDeg: number, frameTiltDeg: number, rotationDeg = frameRotationDeg, tiltDeg = frameTiltDeg) {
  const project = createProjector(scene, frameRotationDeg, 1, frameTiltDeg);
  const points = scene.track.map(project);
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  const frame = orbitTrackModelFrame({
    centerX: (minX + maxX) / 2 - TRACK_MODEL_VIEW_SIZE / 2,
    centerY: (minY + maxY) / 2 - scene.definition.camera.centerY,
    width: (maxX - minX) * 1.12, height: (maxY - minY) * 1.12,
  }, rotationDeg - frameRotationDeg, Math.cos(frameTiltDeg * Math.PI / 180), Math.cos(tiltDeg * Math.PI / 180));
  return { ...frame, centerX: frame.centerX + TRACK_MODEL_VIEW_SIZE / 2, centerY: frame.centerY + scene.definition.camera.centerY };
}

export function drawTrackModel(
  canvas: HTMLCanvasElement,
  scene: TrackModelScene,
  rotationDeg: number,
  palette: TrackModelPalette,
  zoom = 1,
  tiltDeg = scene.definition.camera.tiltDeg,
  panX = 0,
  panY = 0,
  frame?: TrackModelCameraFrame,
) {
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(bounds.width * pixelRatio));
  const height = Math.max(1, Math.round(bounds.height * pixelRatio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  context.setTransform(
    (bounds.width * pixelRatio) / TRACK_MODEL_VIEW_SIZE,
    0,
    0,
    (bounds.height * pixelRatio) / TRACK_MODEL_VIEW_SIZE,
    0,
    0,
  );
  context.clearRect(0, 0, TRACK_MODEL_VIEW_SIZE, TRACK_MODEL_VIEW_SIZE);

  const horizon = context.createLinearGradient(0, 0, 0, TRACK_MODEL_VIEW_SIZE);
  horizon.addColorStop(0, palette.skyTop);
  horizon.addColorStop(1, palette.skyBottom);
  context.fillStyle = horizon;
  context.fillRect(0, 0, TRACK_MODEL_VIEW_SIZE, TRACK_MODEL_VIEW_SIZE);

  const project = createProjector(scene, rotationDeg, zoom, tiltDeg, panX, panY, frame);
  drawGroundShadow(context, palette);
  drawTerrainSkirt(context, scene, project, palette);
  drawTerrainSurface(context, scene, project, palette);
  drawContours(context, scene, project, palette);
  drawTrack(context, scene, project, palette);
  drawTurnMarkers(context, scene, project, palette, bounds.width, bounds.height, pixelRatio);
}

function normalizeTrackPoints(points: readonly CircuitModelPoint[]) {
  const minX = Math.min(...points.map(([, x]) => x));
  const maxX = Math.max(...points.map(([, x]) => x));
  const minY = Math.min(...points.map(([, , y]) => y));
  const maxY = Math.max(...points.map(([, , y]) => y));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const horizontalHalfSpan = Math.max(maxX - minX, maxY - minY) / 2;

  return points.map(([progress, x, y, z]) => ({
    elevationM: z / 10,
    progress,
    x: (x - centerX) / horizontalHalfSpan,
    y: (y - centerY) / horizontalHalfSpan,
  }));
}

function getHorizontalHalfSpanM(points: readonly CircuitModelPoint[]) {
  const minX = Math.min(...points.map(([, x]) => x));
  const maxX = Math.max(...points.map(([, x]) => x));
  const minY = Math.min(...points.map(([, , y]) => y));
  const maxY = Math.max(...points.map(([, , y]) => y));

  return Math.max(maxX - minX, maxY - minY) / 20;
}

function sampleClosedTrack(points: WorldPoint[], sampleCount: number) {
  const elevationMin = Math.min(...points.map((point) => point.elevationM));
  const elevationMax = Math.max(...points.map((point) => point.elevationM));

  return Array.from({ length: sampleCount }, (_, index) => {
    const progress = index / sampleCount;
    const nextIndex = points.findIndex((point) => point.progress > progress);
    const secondIndex = nextIndex <= 0 ? 1 : nextIndex;
    const firstIndex = secondIndex - 1;
    const first = points[firstIndex];
    const second = points[secondIndex];
    const before = points[firstIndex === 0 ? points.length - 2 : firstIndex - 1];
    const after = points[secondIndex === points.length - 1 ? 1 : secondIndex + 1];
    const range = Math.max(second.progress - first.progress, 1e-6);
    const ratio = clamp((progress - first.progress) / range, 0, 1);

    return {
      elevationM: clamp(
        catmullRom(before.elevationM, first.elevationM, second.elevationM, after.elevationM, ratio),
        elevationMin,
        elevationMax,
      ),
      progress,
      x: catmullRom(before.x, first.x, second.x, after.x, ratio),
      y: catmullRom(before.y, first.y, second.y, after.y, ratio),
    };
  });
}

function addTrackFrames(points: WorldPoint[], definition: TrackModelDefinition) {
  const leveledElevations = getLeveledTrackElevations(
    points,
    definition.rendering.overpasses,
  );
  const leveledPoints = points.map((point, index) => ({
    ...point,
    elevationM: leveledElevations[index],
  }));
  const clearanceHalfWidths = getTrackClearanceHalfWidths(
    leveledPoints,
    definition.rendering.overpasses,
  );

  return leveledPoints.map((point, index) => {
    const previous = leveledPoints[(index - 1 + leveledPoints.length) % leveledPoints.length];
    const next = leveledPoints[(index + 1) % leveledPoints.length];
    const tangentX = next.x - previous.x;
    const tangentY = next.y - previous.y;
    const length = Math.hypot(tangentX, tangentY) || 1;

    return {
      ...point,
      bankAngleDeg: getBankAngle(definition, point.progress),
      bankingVerticalExaggeration: definition.camera.verticalExaggeration,
      clearanceHalfWidth: clearanceHalfWidths[index],
      normalX: -tangentY / length,
      normalY: tangentX / length,
    };
  });
}

function buildTerrain(
  terrainSource: CircuitTerrainData,
  residuals: Array<{ point: WorldPoint; residualM: number }>,
) {
  const { bounds } = terrainSource;

  return Array.from({ length: TERRAIN_ROWS }, (_, row) =>
    Array.from({ length: TERRAIN_COLUMNS }, (_, column) => {
      const x = lerp(bounds.minX, bounds.maxX, column / (TERRAIN_COLUMNS - 1));
      const y = lerp(bounds.minY, bounds.maxY, row / (TERRAIN_ROWS - 1));
      const sourceElevationM = sampleTerrainSource(terrainSource, x, y);
      let correctionM = 0;
      let totalWeight = 0;
      let nearestDistanceSquared = Number.POSITIVE_INFINITY;

      for (const residual of residuals) {
        const distanceSquared =
          (residual.point.x - x) ** 2 + (residual.point.y - y) ** 2;
        const weight = Math.exp(-distanceSquared / 0.035);
        correctionM += residual.residualM * weight;
        totalWeight += weight;
        nearestDistanceSquared = Math.min(nearestDistanceSquared, distanceSquared);
      }

      const trackInfluence = Math.exp(-nearestDistanceSquared / 0.055);
      const alignedCorrectionM = totalWeight > 0 ? correctionM / totalWeight : 0;

      return {
        elevationM: sourceElevationM + alignedCorrectionM * trackInfluence,
        progress: 0,
        sourceElevationM,
        x,
        y,
      };
    }),
  );
}

function sampleTerrainSource(terrain: CircuitTerrainData, x: number, y: number) {
  const columnPosition =
    ((clamp(x, terrain.bounds.minX, terrain.bounds.maxX) - terrain.bounds.minX) /
      (terrain.bounds.maxX - terrain.bounds.minX)) *
    (terrain.columns - 1);
  const rowPosition =
    ((clamp(y, terrain.bounds.minY, terrain.bounds.maxY) - terrain.bounds.minY) /
      (terrain.bounds.maxY - terrain.bounds.minY)) *
    (terrain.rows - 1);
  const column = Math.min(terrain.columns - 2, Math.floor(columnPosition));
  const row = Math.min(terrain.rows - 2, Math.floor(rowPosition));
  const columnRatio = columnPosition - column;
  const rowRatio = rowPosition - row;
  const top = lerp(
    terrain.values[row][column],
    terrain.values[row][column + 1],
    columnRatio,
  );
  const bottom = lerp(
    terrain.values[row + 1][column],
    terrain.values[row + 1][column + 1],
    columnRatio,
  );

  return lerp(top, bottom, rowRatio);
}

function createProjector(
  scene: TrackModelScene,
  rotationDeg: number,
  zoom = 1,
  tiltDeg = scene.definition.camera.tiltDeg,
  panX = 0,
  panY = 0,
  frame?: TrackModelCameraFrame,
): Projector {
  const rotation = (rotationDeg * Math.PI) / 180;
  const tilt = (tiltDeg * Math.PI) / 180;
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  const { centerY, scale, verticalExaggeration } = scene.definition.camera;

  return (point) => {
    const rotatedX = point.x * cosRotation - point.y * sinRotation;
    const rotatedY = point.x * sinRotation + point.y * cosRotation;
    const liftedZ =
      ((point.elevationM - scene.elevationReferenceM) / scene.horizontalHalfSpanM) *
      verticalExaggeration;

    const rawX = -rotatedX * scale;
    const rawY = rotatedY * cosTilt * scale - liftedZ * sinTilt * scale;
    if (frame) {
      const fitted = fitTrackModelFrame(frame.bounds, frame.viewport);
      const { width, height, top, bottom } = frame.viewport;
      return {
        depth: rotatedY * sinTilt + liftedZ * cosTilt,
        x: (width / 2 + (rawX - (frame.bounds.centerX - TRACK_MODEL_VIEW_SIZE / 2)) * fitted.scale * zoom + panX * width) / width * TRACK_MODEL_VIEW_SIZE,
        y: (height / 2 + (rawY - (frame.bounds.centerY - centerY)) * fitted.scale * zoom + (top - bottom) / 2 + panY * height) / height * TRACK_MODEL_VIEW_SIZE,
      };
    }
    return {
      depth: rotatedY * sinTilt + liftedZ * cosTilt,
      x: TRACK_MODEL_VIEW_SIZE / 2 + rawX * zoom + panX * TRACK_MODEL_VIEW_SIZE,
      y: centerY + rawY * zoom + panY * TRACK_MODEL_VIEW_SIZE,
    };
  };
}

function drawGroundShadow(context: CanvasRenderingContext2D, palette: TrackModelPalette) {
  const shadow = context.createRadialGradient(470, 630, 40, 470, 630, 380);
  shadow.addColorStop(0, colorWithAlpha(palette.shadow, 0.34));
  shadow.addColorStop(1, colorWithAlpha(palette.shadow, 0));
  context.fillStyle = shadow;
  context.beginPath();
  context.ellipse(470, 635, 390, 120, -0.08, 0, Math.PI * 2);
  context.fill();
}

function drawTerrainSkirt(
  context: CanvasRenderingContext2D,
  scene: TrackModelScene,
  project: Projector,
  palette: TrackModelPalette,
) {
  const perimeter = getTerrainPerimeter(scene.terrain);
  const baseElevationM = scene.elevationReferenceM - 18;
  const segments = perimeter.map((point, index) => {
    const next = perimeter[(index + 1) % perimeter.length];
    const topStart = project(point);
    const topEnd = project(next);
    const bottomStart = project({ ...point, elevationM: baseElevationM });
    const bottomEnd = project({ ...next, elevationM: baseElevationM });

    return {
      depth: average([topStart.depth, topEnd.depth]),
      points: [topStart, topEnd, bottomEnd, bottomStart],
    };
  });

  for (const segment of segments.sort((left, right) => left.depth - right.depth)) {
    context.fillStyle = palette.slab;
    drawPolygon(context, segment.points);
  }
}

function drawTerrainSurface(
  context: CanvasRenderingContext2D,
  scene: TrackModelScene,
  project: Projector,
  palette: TrackModelPalette,
) {
  const triangles: TerrainTriangle[] = [];

  for (let row = 0; row < scene.terrain.length - 1; row += 1) {
    for (let column = 0; column < scene.terrain[row].length - 1; column += 1) {
      const topLeft = scene.terrain[row][column];
      const topRight = scene.terrain[row][column + 1];
      const bottomRight = scene.terrain[row + 1][column + 1];
      const bottomLeft = scene.terrain[row + 1][column];

      triangles.push(
        makeTerrainTriangle([topLeft, topRight, bottomRight], project),
        makeTerrainTriangle([topLeft, bottomRight, bottomLeft], project),
      );
    }
  }

  const grassLow = parseHexColor(palette.grassLow);
  const grassHigh = parseHexColor(palette.grassHigh);
  const fog = parseHexColor(palette.fog);

  for (const triangle of triangles.sort((left, right) => left.depth - right.depth)) {
    const projected = triangle.points.map(project);
    const elevationRatio = clamp(
      (average(triangle.points.map((point) => point.sourceElevationM)) -
        scene.definition.terrain.elevationMinM) /
        (scene.definition.terrain.elevationMaxM - scene.definition.terrain.elevationMinM),
      0,
      1,
    );
    const shade = triangleShade(triangle.points, scene.horizontalHalfSpanM);
    const fogRatio = clamp((triangle.depth + 0.9) * 0.055, 0, 0.12);
    const grass = scaleColor(mixColor(grassLow, grassHigh, elevationRatio), shade);
    const fill = mixColor(grass, fog, fogRatio);

    context.fillStyle = toRgb(fill);
    context.strokeStyle = toRgb(fill);
    context.lineWidth = 1.2;
    drawPolygon(context, projected, true);
  }
}

function drawContours(
  context: CanvasRenderingContext2D,
  scene: TrackModelScene,
  project: Projector,
  palette: TrackModelPalette,
) {
  context.save();
  context.strokeStyle = palette.contour;
  context.lineWidth = 1.15;

  const { contourIntervalM } = scene.definition.rendering;
  const terrainMin = Math.floor(scene.definition.terrain.elevationMinM / contourIntervalM) * contourIntervalM;
  const terrainMax = Math.ceil(scene.definition.terrain.elevationMaxM / contourIntervalM) * contourIntervalM;

  for (let level = terrainMin; level <= terrainMax; level += contourIntervalM) {
    context.globalAlpha = Math.round(level / contourIntervalM) % 2 === 0 ? 0.44 : 0.26;

    for (let row = 0; row < scene.terrain.length - 1; row += 1) {
      for (let column = 0; column < scene.terrain[row].length - 1; column += 1) {
        const corners = [
          scene.terrain[row][column],
          scene.terrain[row][column + 1],
          scene.terrain[row + 1][column + 1],
          scene.terrain[row + 1][column],
        ];
        const intersections: WorldPoint[] = [];

        for (let edge = 0; edge < corners.length; edge += 1) {
          const start = corners[edge];
          const end = corners[(edge + 1) % corners.length];

          if ((start.elevationM < level && end.elevationM >= level) ||
              (end.elevationM < level && start.elevationM >= level)) {
            const ratio = (level - start.elevationM) / (end.elevationM - start.elevationM);
            intersections.push({
              elevationM: level,
              progress: 0,
              x: lerp(start.x, end.x, ratio),
              y: lerp(start.y, end.y, ratio),
            });
          }
        }

        for (let index = 0; index + 1 < intersections.length; index += 2) {
          const start = project(intersections[index]);
          const end = project(intersections[index + 1]);
          context.beginPath();
          context.moveTo(start.x, start.y);
          context.lineTo(end.x, end.y);
          context.stroke();
        }
      }
    }
  }

  context.restore();
}

function drawTrack(
  context: CanvasRenderingContext2D,
  scene: TrackModelScene,
  project: Projector,
  palette: TrackModelPalette,
) {
  const widthScale = getTrackWidthScale(scene);

  drawRibbon(
    context,
    scene.track,
    project,
    0.045 * widthScale,
    palette.shadow,
    -1.8,
    scene.horizontalHalfSpanM,
  );
  drawCornerRunoffs(context, scene, project, palette);
  drawRibbon(
    context,
    scene.track,
    project,
    0.033 * widthScale,
    palette.asphaltEdge,
    0.8,
    scene.horizontalHalfSpanM,
  );
  drawRibbon(
    context,
    scene.track,
    project,
    0.028 * widthScale,
    palette.runoff,
    1.2,
    scene.horizontalHalfSpanM,
  );
  drawRibbon(
    context,
    scene.track,
    project,
    TRACK_HALF_WIDTH * widthScale,
    palette.asphalt,
    1.8,
    scene.horizontalHalfSpanM,
  );
  drawSectorEdgeBands(context, scene, project, palette);
  drawCurbs(context, scene, project, palette);
  drawSectorMarkers(context, scene, project, palette);
  drawStartFinish(context, scene, project, palette);
  drawSpeedTrap(context, scene, project, palette);
  drawOverpasses(context, scene, project, palette);
}

function drawOverpasses(
  context: CanvasRenderingContext2D,
  scene: TrackModelScene,
  project: Projector,
  palette: TrackModelPalette,
) {
  const overpasses = scene.definition.rendering.overpasses;

  if (!overpasses?.length) {
    return;
  }

  const widthScale = getTrackWidthScale(scene);
  const railHalfWidth = 0.039 * widthScale;

  for (const overpass of overpasses) {
    const isOverpass = (point: TrackFramePoint) =>
      progressInRange(point.progress, overpass.from, overpass.to);

    drawRibbon(
      context,
      scene.track,
      project,
      0.041 * widthScale,
      colorWithAlpha(palette.shadow, 0.58),
      -5,
      scene.horizontalHalfSpanM,
      isOverpass,
    );
    drawRibbon(
      context,
      scene.track,
      project,
      0.033 * widthScale,
      palette.asphaltEdge,
      0.8,
      scene.horizontalHalfSpanM,
      isOverpass,
    );
    drawRibbon(
      context,
      scene.track,
      project,
      0.028 * widthScale,
      palette.runoff,
      1.2,
      scene.horizontalHalfSpanM,
      isOverpass,
    );
    drawRibbon(
      context,
      scene.track,
      project,
      TRACK_HALF_WIDTH * widthScale,
      palette.asphalt,
      1.8,
      scene.horizontalHalfSpanM,
      isOverpass,
    );
    drawBridgeSectorBands(context, scene, project, palette, isOverpass, widthScale);
    drawBridgeVerticalSides(
      context,
      scene,
      project,
      isOverpass,
      railHalfWidth,
      -3.8,
      4.8,
      palette.asphaltHighlight,
    );
    drawBridgeRailCaps(context, scene, project, palette, isOverpass, widthScale);
  }
}

function drawBridgeVerticalSides(
  context: CanvasRenderingContext2D,
  scene: TrackModelScene,
  project: Projector,
  shouldDraw: (point: TrackFramePoint) => boolean,
  halfWidth: number,
  bottomElevationM: number,
  topElevationM: number,
  color: string,
) {
  const faces: Array<{ depth: number; points: ProjectedPoint[] }> = [];

  for (const [point, next] of createClosedLoopSegments(scene.track)) {
    if (!shouldDraw(point)) {
      continue;
    }

    for (const side of [-1, 1] as const) {
      const points = [
        project(
          offsetTrackPoint(
            point,
            halfWidth * side,
            topElevationM,
            scene.horizontalHalfSpanM,
            false,
          ),
        ),
        project(
          offsetTrackPoint(
            next,
            halfWidth * side,
            topElevationM,
            scene.horizontalHalfSpanM,
            false,
          ),
        ),
        project(
          offsetTrackPoint(
            next,
            halfWidth * side,
            bottomElevationM,
            scene.horizontalHalfSpanM,
            false,
          ),
        ),
        project(
          offsetTrackPoint(
            point,
            halfWidth * side,
            bottomElevationM,
            scene.horizontalHalfSpanM,
            false,
          ),
        ),
      ];

      faces.push({
        depth: average(points.map((projectedPoint) => projectedPoint.depth)),
        points,
      });
    }
  }

  context.save();
  context.fillStyle = color;
  context.strokeStyle = color;
  context.lineWidth = 1;

  for (const face of faces.sort((left, right) => left.depth - right.depth)) {
    drawPolygon(context, face.points, true);
  }

  context.restore();
}

function drawBridgeRailCaps(
  context: CanvasRenderingContext2D,
  scene: TrackModelScene,
  project: Projector,
  palette: TrackModelPalette,
  shouldDraw: (point: TrackFramePoint) => boolean,
  widthScale: number,
) {
  context.save();

  for (const [point, next] of createClosedLoopSegments(scene.track)) {
    if (!shouldDraw(point)) {
      continue;
    }

    drawRibbonSegment(
      context,
      point,
      next,
      project,
      0.037 * widthScale,
      0.039 * widthScale,
      palette.asphaltHighlight,
      4.8,
      scene.horizontalHalfSpanM,
    );
  }

  context.restore();
}

function drawBridgeSectorBands(
  context: CanvasRenderingContext2D,
  scene: TrackModelScene,
  project: Projector,
  palette: TrackModelPalette,
  shouldDraw: (point: TrackFramePoint) => boolean,
  widthScale: number,
) {
  const [firstBreak, secondBreak] = scene.definition.data.sectorBreaks;

  context.save();

  for (const [point, next] of createClosedLoopSegments(scene.track)) {
    if (!shouldDraw(point)) {
      continue;
    }

    const color = point.progress < firstBreak
      ? palette.sectorOne
      : point.progress < secondBreak
        ? palette.sectorTwo
        : palette.sectorThree;

    drawRibbonSegment(
      context,
      point,
      next,
      project,
      0.03 * widthScale,
      0.036 * widthScale,
      color,
      2.8,
      scene.horizontalHalfSpanM,
    );
  }

  context.restore();
}

function drawTurnMarkers(
  context: CanvasRenderingContext2D,
  scene: TrackModelScene,
  project: Projector,
  palette: TrackModelPalette,
  width: number,
  height: number,
  pixelRatio: number,
) {
  const isWideModel = width >= 520;
  const radius = isWideModel ? 12 : 8;
  const fontSize = isWideModel ? 10.5 : 7.5;
  const markers = scene.definition.data.turns.map((turn) => {
    const point = pointAtProgress(scene.track, turn.progress);
    const trackOffset = scene.definition.rendering.turnLabelTrackOffsets?.[turn.number];
    const projected = project(
      trackOffset === undefined
        ? { ...point, elevationM: point.elevationM + 5 }
        : offsetTrackPoint(point, trackOffset, 5, scene.horizontalHalfSpanM, false),
    );
    const anchor = project({ ...point, elevationM: point.elevationM + 3.5 });
    const [offsetX, offsetY] = scene.definition.rendering.turnLabelOffsets[turn.number] ?? [0, 0];

    return {
      anchorX: (anchor.x / TRACK_MODEL_VIEW_SIZE) * width,
      anchorY: (anchor.y / TRACK_MODEL_VIEW_SIZE) * height,
      number: turn.number,
      x: (projected.x / TRACK_MODEL_VIEW_SIZE) * width - offsetX,
      y: (projected.y / TRACK_MODEL_VIEW_SIZE) * height + offsetY,
    };
  });

  resolveMarkerCollisions(markers, radius, width, height);

  context.save();
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.lineWidth = 1.25;
  context.textAlign = "center";
  context.textBaseline = "middle";

  for (const marker of markers) {
    const distanceFromTrack = Math.hypot(marker.x - marker.anchorX, marker.y - marker.anchorY);

    if (distanceFromTrack > radius + 3) {
      context.strokeStyle = colorWithAlpha(palette.turnBorder, 0.62);
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(marker.anchorX, marker.anchorY);
      context.lineTo(marker.x, marker.y);
      context.stroke();
    }

    context.fillStyle = palette.turnBackground;
    context.strokeStyle = palette.turnBorder;
    context.shadowColor = "rgb(0 0 0 / 0.18)";
    context.shadowBlur = 2;
    context.shadowOffsetY = 1;
    context.beginPath();
    context.arc(marker.x, marker.y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.shadowColor = "transparent";
    context.fillStyle = palette.turnText;
    context.font = `900 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    context.fillText(String(marker.number), marker.x, marker.y + 0.5);
  }

  context.restore();
}

function resolveMarkerCollisions(
  markers: Array<{ x: number; y: number }>,
  radius: number,
  width: number,
  height: number,
) {
  const minimumDistance = radius * 2 + 3;

  for (let iteration = 0; iteration < 10; iteration += 1) {
    for (let leftIndex = 0; leftIndex < markers.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < markers.length; rightIndex += 1) {
        const left = markers[leftIndex];
        const right = markers[rightIndex];
        const deltaX = right.x - left.x;
        const deltaY = right.y - left.y;
        const distance = Math.hypot(deltaX, deltaY);

        if (distance >= minimumDistance) {
          continue;
        }

        const angle = distance > 0.1
          ? Math.atan2(deltaY, deltaX)
          : ((leftIndex + rightIndex) * Math.PI) / markers.length;
        const shift = (minimumDistance - distance) / 2;
        const shiftX = Math.cos(angle) * shift;
        const shiftY = Math.sin(angle) * shift;
        left.x -= shiftX;
        left.y -= shiftY;
        right.x += shiftX;
        right.y += shiftY;
      }
    }
  }

  for (const marker of markers) {
    marker.x = clamp(marker.x, radius + 3, width - radius - 3);
    marker.y = clamp(marker.y, radius + 3, height - radius - 3);
  }
}

function drawCornerRunoffs(
  context: CanvasRenderingContext2D,
  scene: TrackModelScene,
  project: Projector,
  palette: TrackModelPalette,
) {
  const runoffTurns = new Set(scene.definition.rendering.runoffTurnNumbers);
  const gravelTurns = new Set(scene.definition.rendering.gravelTurnNumbers);
  const widthScale = getTrackWidthScale(scene);

  for (const [point, next] of createClosedLoopSegments(scene.track)) {
    if (isProgressOnOverpass(scene, point.progress)) {
      continue;
    }

    const turn = scene.definition.data.turns.find(
      (candidate) =>
        runoffTurns.has(candidate.number) &&
        circularProgressDistance(point.progress, candidate.progress) < 0.034,
    );

    if (!turn) {
      continue;
    }

    const configuredSide = scene.definition.rendering.runoffTurnSides?.[turn.number];
    const runoffSides = configuredSide === undefined ? undefined : [configuredSide];

    drawRibbonSegment(
      context,
      point,
      next,
      project,
      0.033 * widthScale,
      0.054 * widthScale,
      palette.runoff,
      0.5,
      scene.horizontalHalfSpanM,
      runoffSides,
    );

    if (gravelTurns.has(turn.number)) {
      drawRibbonSegment(
        context,
        point,
        next,
        project,
        0.054 * widthScale,
        0.068 * widthScale,
        palette.gravel,
        0.2,
        scene.horizontalHalfSpanM,
        runoffSides,
      );
    }
  }
}

function drawCurbs(
  context: CanvasRenderingContext2D,
  scene: TrackModelScene,
  project: Projector,
  palette: TrackModelPalette,
  shouldDraw: (point: TrackFramePoint) => boolean = () => true,
) {
  const curbTurns = new Set(scene.definition.rendering.curbTurnNumbers);
  const widthScale = getTrackWidthScale(scene);

  for (let index = 0; index < scene.track.length; index += 1) {
    const point = scene.track[index];
    const next = scene.track[(index + 1) % scene.track.length];

    if (!shouldDraw(point)) {
      continue;
    }

    if (isProgressOnOverpass(scene, point.progress)) {
      continue;
    }

    const turn = scene.definition.data.turns.find(
      (candidate) =>
        curbTurns.has(candidate.number) &&
        circularProgressDistance(point.progress, candidate.progress) <
        (candidate.number === 9 ? 0.05 : 0.027),
    );

    if (!turn) {
      continue;
    }

    const color = Math.floor(index / 4) % 2 === 0 ? palette.curbRed : palette.curbWhite;
    const outerWidth = (turn.number === 9 ? 0.034 : 0.029) * widthScale;
    const configuredSide = scene.definition.rendering.curbTurnSides?.[turn.number];
    const curbSides = configuredSide === undefined ? undefined : [configuredSide];
    drawRibbonSegment(
      context,
      point,
      next,
      project,
      TRACK_HALF_WIDTH * widthScale,
      outerWidth,
      color,
      2.4,
      scene.horizontalHalfSpanM,
      curbSides,
    );
  }
}

function drawSectorEdgeBands(
  context: CanvasRenderingContext2D,
  scene: TrackModelScene,
  project: Projector,
  palette: TrackModelPalette,
  shouldDraw: (point: TrackFramePoint) => boolean = () => true,
) {
  const [firstBreak, secondBreak] = scene.definition.data.sectorBreaks;
  const widthScale = getTrackWidthScale(scene);

  context.save();

  for (const [point, next] of createClosedLoopSegments(scene.track)) {
    if (!shouldDraw(point)) {
      continue;
    }

    if (isProgressOnOverpass(scene, point.progress)) {
      continue;
    }

    const color = point.progress < firstBreak
      ? palette.sectorOne
      : point.progress < secondBreak
        ? palette.sectorTwo
        : palette.sectorThree;
    const oneSidedTurn = scene.definition.data.turns.find(
      (turn) =>
        scene.definition.rendering.curbTurnSides?.[turn.number] !== undefined &&
        circularProgressDistance(point.progress, turn.progress) < 0.027,
    );
    const configuredSide = oneSidedTurn
      ? scene.definition.rendering.curbTurnSides?.[oneSidedTurn.number]
      : undefined;
    const sectorSides = configuredSide === undefined ? undefined : [configuredSide];

    drawRibbonSegment(
      context,
      point,
      next,
      project,
      0.03 * widthScale,
      0.036 * widthScale,
      color,
      2.8,
      scene.horizontalHalfSpanM,
      sectorSides,
    );
  }

  context.restore();
}

function drawSectorMarkers(
  context: CanvasRenderingContext2D,
  scene: TrackModelScene,
  project: Projector,
  palette: TrackModelPalette,
) {
  const [firstBreak, secondBreak] = scene.definition.data.sectorBreaks;
  const widthScale = getTrackWidthScale(scene);
  const sectors = [
    { color: palette.sectorOne, progress: 0 },
    { color: palette.sectorTwo, progress: firstBreak },
    { color: palette.sectorThree, progress: secondBreak },
  ];

  context.save();
  context.lineCap = "round";
  context.lineWidth = 4.5;

  for (const sector of sectors) {
    const point = pointAtProgress(scene.track, sector.progress) as TrackFramePoint;
    context.strokeStyle = sector.color;

    for (const side of [-1, 1]) {
      const inner = project(
        offsetTrackPoint(
          point,
          TRACK_HALF_WIDTH * widthScale * side,
          4,
          scene.horizontalHalfSpanM,
        ),
      );
      const outer = project(
        offsetTrackPoint(point, 0.045 * widthScale * side, 4, scene.horizontalHalfSpanM),
      );
      context.beginPath();
      context.moveTo(inner.x, inner.y);
      context.lineTo(outer.x, outer.y);
      context.stroke();
    }
  }

  context.restore();
}

function drawStartFinish(
  context: CanvasRenderingContext2D,
  scene: TrackModelScene,
  project: Projector,
  palette: TrackModelPalette,
) {
  const point = scene.track[0];
  const width = TRACK_HALF_WIDTH * getTrackWidthScale(scene);
  const start = project(
    offsetTrackPoint(point, -width, 3.8, scene.horizontalHalfSpanM),
  );
  const end = project(
    offsetTrackPoint(point, width, 3.8, scene.horizontalHalfSpanM),
  );

  context.save();
  context.strokeStyle = palette.curbWhite;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.restore();
}

function drawSpeedTrap(
  context: CanvasRenderingContext2D,
  scene: TrackModelScene,
  project: Projector,
  palette: TrackModelPalette,
) {
  const point = pointAtProgress(
    scene.track,
    scene.definition.data.speedTrapProgress,
  ) as TrackFramePoint;
  const width = 0.026 * getTrackWidthScale(scene);
  const start = project(offsetTrackPoint(point, -width, 4.2, scene.horizontalHalfSpanM));
  const end = project(offsetTrackPoint(point, width, 4.2, scene.horizontalHalfSpanM));

  context.save();
  context.strokeStyle = palette.speedTrap;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.restore();
}

function drawRibbon(
  context: CanvasRenderingContext2D,
  track: TrackFramePoint[],
  project: Projector,
  halfWidth: number,
  color: string,
  elevationOffsetM: number,
  horizontalHalfSpanM: number,
  shouldDraw: (point: TrackFramePoint) => boolean = () => true,
) {
  context.save();
  context.fillStyle = color;
  context.strokeStyle = color;
  context.lineWidth = 1;

  for (const [point, next] of createClosedLoopSegments(track)) {
    if (!shouldDraw(point)) {
      continue;
    }

    const segment = [
      project(offsetTrackPoint(point, halfWidth, elevationOffsetM, horizontalHalfSpanM)),
      project(offsetTrackPoint(next, halfWidth, elevationOffsetM, horizontalHalfSpanM)),
      project(offsetTrackPoint(next, -halfWidth, elevationOffsetM, horizontalHalfSpanM)),
      project(offsetTrackPoint(point, -halfWidth, elevationOffsetM, horizontalHalfSpanM)),
    ];

    drawPolygon(context, segment, true);
  }

  context.restore();
}

function getTrackWidthScale(scene: TrackModelScene) {
  return scene.definition.rendering.trackWidthScale ?? 1;
}

function isProgressOnOverpass(scene: TrackModelScene, progress: number) {
  return scene.definition.rendering.overpasses?.some((overpass) =>
    progressInRange(progress, overpass.from, overpass.to),
  ) ?? false;
}

function drawRibbonSegment(
  context: CanvasRenderingContext2D,
  start: TrackFramePoint,
  end: TrackFramePoint,
  project: Projector,
  innerWidth: number,
  outerWidth: number,
  color: string,
  elevationOffsetM: number,
  horizontalHalfSpanM: number,
  sides: readonly (-1 | 1)[] = [-1, 1],
) {
  context.fillStyle = color;
  context.strokeStyle = color;
  context.lineWidth = 1;

  for (const side of sides) {
    const points = [
      project(
        offsetTrackPoint(start, innerWidth * side, elevationOffsetM, horizontalHalfSpanM),
      ),
      project(
        offsetTrackPoint(start, outerWidth * side, elevationOffsetM, horizontalHalfSpanM),
      ),
      project(
        offsetTrackPoint(end, outerWidth * side, elevationOffsetM, horizontalHalfSpanM),
      ),
      project(
        offsetTrackPoint(end, innerWidth * side, elevationOffsetM, horizontalHalfSpanM),
      ),
    ];
    drawPolygon(context, points, true);
  }
}

function offsetTrackPoint(
  point: TrackFramePoint,
  offset: number,
  elevationOffsetM: number,
  horizontalHalfSpanM: number,
  clampToClearance = true,
): WorldPoint {
  const resolvedOffset = clampToClearance
    ? Math.sign(offset) * Math.min(Math.abs(offset), point.clearanceHalfWidth)
    : offset;
  const bankingElevationM = getBankingElevationM(
    point.bankAngleDeg,
    resolvedOffset * horizontalHalfSpanM,
    point.bankingVerticalExaggeration,
  );

  return {
    elevationM: point.elevationM + elevationOffsetM + bankingElevationM,
    progress: point.progress,
    x: point.x + point.normalX * resolvedOffset,
    y: point.y + point.normalY * resolvedOffset,
  };
}

function getBankAngle(definition: TrackModelDefinition, progress: number) {
  return definition.rendering.banking?.find(({ from, to }) =>
    progressInRange(progress, from, to),
  )?.angleDeg ?? 0;
}

function progressInRange(progress: number, from: number, to: number) {
  return from <= to
    ? progress >= from && progress <= to
    : progress >= from || progress <= to;
}

function makeTerrainTriangle(points: TerrainTriangle["points"], project: Projector) {
  return {
    depth: average(points.map((point) => project(point).depth)),
    points,
  };
}

function triangleShade(points: TerrainTriangle["points"], horizontalHalfSpanM: number) {
  const [first, second, third] = points;
  const firstVector = {
    x: (second.x - first.x) * horizontalHalfSpanM,
    y: (second.y - first.y) * horizontalHalfSpanM,
    z: second.elevationM - first.elevationM,
  };
  const secondVector = {
    x: (third.x - first.x) * horizontalHalfSpanM,
    y: (third.y - first.y) * horizontalHalfSpanM,
    z: third.elevationM - first.elevationM,
  };
  const normal = normalizeVector({
    x: firstVector.y * secondVector.z - firstVector.z * secondVector.y,
    y: firstVector.z * secondVector.x - firstVector.x * secondVector.z,
    z: firstVector.x * secondVector.y - firstVector.y * secondVector.x,
  });
  const light = normalizeVector({ x: -0.42, y: -0.58, z: 0.7 });
  const dot = Math.abs(normal.x * light.x + normal.y * light.y + normal.z * light.z);

  return clamp(0.64 + dot * 0.46, 0.62, 1.1);
}

function getTerrainPerimeter(terrain: TerrainPoint[][]) {
  const top = terrain[0];
  const right = terrain.slice(1).map((row) => row[row.length - 1]);
  const bottom = [...terrain[terrain.length - 1]].reverse().slice(1);
  const left = terrain.slice(1, -1).reverse().map((row) => row[0]);

  return [...top, ...right, ...bottom, ...left];
}

function pointAtProgress<T extends WorldPoint>(points: T[], progress: number): T {
  const index = Math.min(points.length - 1, Math.round(clamp(progress, 0, 1) * points.length));
  return points[index % points.length];
}

function toAnnotation(point: WorldPoint, project: Projector): TrackModelAnnotation {
  const projected = project({ ...point, elevationM: point.elevationM + 5 });

  return {
    elevationM: point.elevationM,
    progress: point.progress,
    x: projected.x,
    y: projected.y,
  };
}

function drawPolygon(
  context: CanvasRenderingContext2D,
  points: ProjectedPoint[],
  stroke = false,
) {
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      context.moveTo(point.x, point.y);
    } else {
      context.lineTo(point.x, point.y);
    }
  });
  context.closePath();
  context.fill();

  if (stroke) {
    context.stroke();
  }
}

function circularProgressDistance(left: number, right: number) {
  const distance = Math.abs(left - right);
  return Math.min(distance, 1 - distance);
}

function catmullRom(before: number, first: number, second: number, after: number, ratio: number) {
  const ratioSquared = ratio * ratio;
  const ratioCubed = ratioSquared * ratio;

  return 0.5 * (
    2 * first +
    (-before + second) * ratio +
    (2 * before - 5 * first + 4 * second - after) * ratioSquared +
    (-before + 3 * first - 3 * second + after) * ratioCubed
  );
}

type RgbColor = { blue: number; green: number; red: number };

function parseHexColor(value: string): RgbColor {
  const normalized = value.trim().replace("#", "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((part) => `${part}${part}`).join("")
    : normalized;

  return {
    blue: Number.parseInt(expanded.slice(4, 6), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    red: Number.parseInt(expanded.slice(0, 2), 16),
  };
}

function mixColor(first: RgbColor, second: RgbColor, ratio: number): RgbColor {
  return {
    blue: lerp(first.blue, second.blue, ratio),
    green: lerp(first.green, second.green, ratio),
    red: lerp(first.red, second.red, ratio),
  };
}

function scaleColor(color: RgbColor, scale: number): RgbColor {
  return {
    blue: clamp(color.blue * scale, 0, 255),
    green: clamp(color.green * scale, 0, 255),
    red: clamp(color.red * scale, 0, 255),
  };
}

function toRgb(color: RgbColor) {
  return `rgb(${Math.round(color.red)} ${Math.round(color.green)} ${Math.round(color.blue)})`;
}

function colorWithAlpha(color: string, alpha: number) {
  const parsed = parseHexColor(color);
  return `rgb(${parsed.red} ${parsed.green} ${parsed.blue} / ${alpha})`;
}

function normalizeVector(vector: { x: number; y: number; z: number }) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function lerp(start: number, end: number, ratio: number) {
  return start + (end - start) * ratio;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
