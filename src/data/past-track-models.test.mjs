import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { ALBERT_PARK_TRACK_MODEL } from "./albert-park-model.ts";
import { QATAR_TRACK_MODEL } from "./qatar-model.ts";
import { INTERLAGOS_TRACK_MODEL } from "./interlagos-model.ts";
import { SINGAPORE_TRACK_MODEL } from "./singapore-model.ts";
import { AUSTIN_TRACK_MODEL } from "./austin-model.ts";
import { LAS_VEGAS_TRACK_MODEL } from "./las-vegas-model.ts";
import { MEXICO_TRACK_MODEL } from "./mexico-model.ts";
import { BAKU_TRACK_MODEL } from "./baku-model.ts";
import { CATALUNYA_TRACK_MODEL } from "./catalunya-model.ts";
import { HUNGARORING_TRACK_MODEL } from "./hungaroring-model.ts";
import { MIAMI_TRACK_MODEL } from "./miami-model.ts";
import { MONACO_TERRAIN, MONACO_TRACK_MODEL } from "./monaco-model.ts";
import { MONTREAL_TRACK_MODEL } from "./montreal-model.ts";
import { MONZA_TRACK_MODEL } from "./monza-model.ts";
import { MADRING_TRACK_MODEL } from "./madring-model.ts";
import { RED_BULL_RING_TRACK_MODEL } from "./red-bull-ring-model.ts";
import { SHANGHAI_TRACK_MODEL } from "./shanghai-model.ts";
import { SILVERSTONE_TRACK_MODEL } from "./silverstone-model.ts";
import { SPA_TRACK_MODEL } from "./spa-model.ts";
import { SEPANG_TRACK_MODEL } from "./sepang-model.ts";
import { SUZUKA_TRACK_MODEL } from "./suzuka-model.ts";
import { ZANDVOORT_TRACK_MODEL } from "./zandvoort-model.ts";
import {
  getThreeDimensionalTrackModelId,
  TRACK_MODEL_ALIASES,
} from "./track-models.ts";
import { getTrackClearanceHalfWidths } from "../lib/track-model-geometry.ts";

const generatedModels = [];

const digitalTwinModels = [
  QATAR_TRACK_MODEL,
  LAS_VEGAS_TRACK_MODEL,
  ALBERT_PARK_TRACK_MODEL,
  SHANGHAI_TRACK_MODEL,
  INTERLAGOS_TRACK_MODEL,
  SUZUKA_TRACK_MODEL,
  MEXICO_TRACK_MODEL,
  AUSTIN_TRACK_MODEL,
  SINGAPORE_TRACK_MODEL,
  MIAMI_TRACK_MODEL,
  SEPANG_TRACK_MODEL,
  BAKU_TRACK_MODEL,
  CATALUNYA_TRACK_MODEL,
  HUNGARORING_TRACK_MODEL,
  MONACO_TRACK_MODEL,
  MONTREAL_TRACK_MODEL,
  MONZA_TRACK_MODEL,
  MADRING_TRACK_MODEL,
  RED_BULL_RING_TRACK_MODEL,
  SILVERSTONE_TRACK_MODEL,
  SPA_TRACK_MODEL,
  ZANDVOORT_TRACK_MODEL,
];

for (const [model, turnCount] of generatedModels) {
  test(`${model.data.circuitName} is a valid closed 3D model`, () => {
    const { data, terrain } = model;
    const firstPoint = data.points[0];
    const lastPoint = data.points.at(-1);
    const pointElevationsM = data.points.map((point) => point[3] / 10);

    assert.equal(firstPoint[0], 0);
    assert.equal(lastPoint[0], 1);
    assert.deepEqual(lastPoint.slice(1), firstPoint.slice(1));
    assert.equal(data.points.length, 101);

    for (let index = 1; index < data.points.length; index += 1) {
      assert.ok(
        data.points[index][0] > data.points[index - 1][0],
        `point ${index} must follow point ${index - 1}`,
      );
      assert.ok(data.points[index].every(Number.isFinite));
    }

    assert.deepEqual(
      data.turns.map(({ number }) => number),
      Array.from({ length: turnCount }, (_, index) => index + 1),
    );
    assert.ok(data.turns.every(({ progress }) => progress > 0 && progress < 1));
    assert.ok(data.sectorBreaks[0] > 0);
    assert.ok(data.sectorBreaks[0] < data.sectorBreaks[1]);
    assert.ok(data.sectorBreaks[1] < 1);
    assert.ok(data.speedTrapProgress >= 0 && data.speedTrapProgress < 1);

    const measuredElevationChange = Math.round(
      Math.max(...pointElevationsM) - Math.min(...pointElevationsM),
    );
    assert.equal(data.elevationChangeM, measuredElevationChange);

    assert.equal(terrain.values.length, terrain.rows);
    assert.ok(terrain.values.every((row) => row.length === terrain.columns));
    assert.ok(terrain.values.flat().every(Number.isFinite));
    assert.equal(model.camera.tiltDeg, 10);
    assert.ok(model.camera.scale > 0);
    assert.ok(model.camera.verticalExaggeration > 0);
  });
}

test("every generated track resolves from its circuit name and aliases", () => {
  assert.ok(Object.keys(TRACK_MODEL_ALIASES).length >= digitalTwinModels.length + generatedModels.length);

  const allModels = [
    ...generatedModels.map(([model]) => model),
    ...digitalTwinModels,
  ];

  for (const model of allModels) {
    assert.equal(getThreeDimensionalTrackModelId(model.data.circuitName), model.id);

    for (const alias of model.aliases) {
      assert.equal(
        getThreeDimensionalTrackModelId(alias),
        model.id,
        `${alias} must resolve to ${model.id}`,
      );
    }
  }
});

test("generated geometry stays in small, separately imported modules", async () => {
  const lazyLoaderSource = await readFile(
    new URL("../components/racemate/track-model-3d-lazy.tsx", import.meta.url),
    "utf8",
  );
  const registrySource = await readFile(new URL("./track-models.ts", import.meta.url), "utf8");
  let totalSourceBytes = 0;

  assert.doesNotMatch(registrySource, /from ["']@\/data\/.*-model["']/);

  for (const [model, , fileName] of generatedModels) {
    const moduleName = fileName.replace(/\.ts$/, "");
    const sourceSize = (await stat(new URL(`./${fileName}`, import.meta.url))).size;

    assert.match(
      lazyLoaderSource,
      new RegExp(`import\\(["']@/data/${moduleName}["']\\)`),
      `${model.id} must use its own dynamic import`,
    );
    assert.ok(sourceSize <= 12_000, `${model.id} source is too large: ${sourceSize} bytes`);
    totalSourceBytes += sourceSize;
  }

  assert.ok(totalSourceBytes <= 100_000, `generated model sources total ${totalSourceBytes} bytes`);
});

test("legacy 3D tracks keep their shared presentation scale", () => {
  const legacyModels = generatedModels.map(([model]) => model);

  for (const model of legacyModels) {
    assert.equal(
      model.camera.verticalExaggeration,
      3.6,
      `${model.id} must use the shared vertical scale`,
    );
  }
});

test("Blender digital twins keep real-world vertical scale and explicit WebGL assets", () => {
  for (const model of digitalTwinModels) {
    assert.equal(model.camera.verticalExaggeration, 1);
    assert.ok(model.webgl);
    assert.equal(model.webgl.turnCount, model.data.turns.length);
    assert.match(new URL(model.webgl.assetPath, "https://raceside.test").pathname, new RegExp(`/${model.id}\\.glb$`));
    assert.match(new URL(model.webgl.previewPath, "https://raceside.test").pathname, new RegExp(`/${model.id}-preview\\.webp$`));
  }
});

test("low-relief generated tracks do not contain DEM micro-jumps", () => {
  for (const [model] of generatedModels) {
    if (model.data.elevationChangeM > 15) {
      continue;
    }

    const elevations = model.data.points.slice(0, -1).map((point) => point[3] / 10);
    const secondDifferences = elevations.map((elevation, index) => {
      const previous = elevations[(index - 1 + elevations.length) % elevations.length];
      const next = elevations[(index + 1) % elevations.length];
      return Math.abs(next - 2 * elevation + previous);
    });
    const averageSecondDifference =
      secondDifferences.reduce((sum, value) => sum + value, 0) / secondDifferences.length;

    assert.ok(
      averageSecondDifference <= 0.3,
      `${model.id} elevation roughness is ${averageSecondDifference.toFixed(2)} m`,
    );
    assert.ok(
      Math.max(...secondDifferences) <= 1.5,
      `${model.id} contains a ${Math.max(...secondDifferences).toFixed(2)} m micro-jump`,
    );
  }
});

test("Suzuka marks the bridge before turn fifteen as an overpass", () => {
  const overpass = SUZUKA_TRACK_MODEL.rendering.overpasses?.[0];
  const turnFifteenProgress = SUZUKA_TRACK_MODEL.data.turns.find(
    ({ number }) => number === 15,
  ).progress;

  assert.ok(overpass);
  assert.ok(overpass.from <= 0.84 && overpass.to >= 0.84);
  assert.equal(overpass.level, true);
  assert.ok(overpass.to <= turnFifteenProgress + 0.005);
});

test("adaptive widths leave a visible gap between non-adjacent track textures", () => {
  const allModels = [
    ...generatedModels.map(([model]) => model),
    RED_BULL_RING_TRACK_MODEL,
    ZANDVOORT_TRACK_MODEL,
  ];

  for (const model of allModels) {
    assertTrackTexturesHaveClearance(model);
  }
});

test("Monaco terrain excludes the extreme coastal edge walls", () => {
  assert.ok(MONACO_TERRAIN.elevationMaxM <= 85);
});

function assertTrackTexturesHaveClearance(model) {
  const points = model.data.points;
  const openPoints = points.slice(0, -1);
  const minX = Math.min(...openPoints.map((point) => point[1]));
  const maxX = Math.max(...openPoints.map((point) => point[1]));
  const minY = Math.min(...openPoints.map((point) => point[2]));
  const maxY = Math.max(...openPoints.map((point) => point[2]));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const halfSpan = Math.max(maxX - minX, maxY - minY) / 2;
  const normalized = openPoints.map(([progress, x, y]) => ({
    progress,
    x: (x - centerX) / halfSpan,
    y: (y - centerY) / halfSpan,
  }));
  const clearanceHalfWidths = getTrackClearanceHalfWidths(
    normalized,
    model.rendering.overpasses,
  );
  const requestedHalfWidth = 0.068 * (model.rendering.trackWidthScale ?? 1);

  for (let firstIndex = 0; firstIndex < normalized.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < normalized.length; secondIndex += 1) {
      const first = normalized[firstIndex];
      const second = normalized[secondIndex];
      const progressDistance = Math.min(
        Math.abs(first.progress - second.progress),
        1 - Math.abs(first.progress - second.progress),
      );

      if (progressDistance < 0.045) {
        continue;
      }

      if (
        model.rendering.overpasses?.some(
          (range) => progressInRange(first.progress, range) || progressInRange(second.progress, range),
        )
      ) {
        continue;
      }

      if (
        !Number.isFinite(clearanceHalfWidths[firstIndex]) ||
        !Number.isFinite(clearanceHalfWidths[secondIndex])
      ) {
        continue;
      }

      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      const renderedWidth =
        Math.min(requestedHalfWidth, clearanceHalfWidths[firstIndex]) +
        Math.min(requestedHalfWidth, clearanceHalfWidths[secondIndex]);

      assert.ok(
        renderedWidth < distance,
        `${model.id} texture ${renderedWidth.toFixed(4)} overlaps a ${distance.toFixed(4)} gap`,
      );
    }
  }
}

function progressInRange(progress, range) {
  return range.from <= range.to
    ? progress >= range.from && progress <= range.to
    : progress >= range.from || progress <= range.to;
}
