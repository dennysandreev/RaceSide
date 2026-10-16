import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ZANDVOORT_MODEL,
  ZANDVOORT_REPLAY_PATH,
  ZANDVOORT_TRACK_MODEL,
} from "./zandvoort-model.ts";
import { TRACK_MODEL_MAX_ZOOM } from "../lib/track-model-camera.ts";

test("3D viewer supports close inspection at 800% zoom", async () => {
  const viewerSource = await readFile(
    new URL("../components/racemate/track-model-viewer.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    TRACK_MODEL_MAX_ZOOM >= 8,
    `expected at least 800% zoom, got ${TRACK_MODEL_MAX_ZOOM * 100}%`,
  );
  assert.match(viewerSource, /pinchTrackModelCamera/);
  assert.match(viewerSource, /\be\.button === 2 \|\| e\.shiftKey/);
  assert.doesNotMatch(viewerSource, /interactionMode/);
});

test("Zandvoort loading preview keeps the fitted 3D framing", async () => {
  const webglSource = await readFile(
    new URL("../components/racemate/track-model-webgl.tsx", import.meta.url),
    "utf8",
  );

  assert.match(webglSource, /pointer-events-none object-contain/);
  assert.doesNotMatch(webglSource, /pointer-events-none object-cover/);
  assert.equal(ZANDVOORT_TRACK_MODEL.webgl.previewPath, "/f1/tracks/3d/zandvoort-preview.webp");
});

test("Zandvoort 3D replay supports both the 2025 and 2026 Dutch Grands Prix", async () => {
  const playerSource = await readFile(
    new URL("../features/race-replay/components/race-replay-player.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    playerSource,
    /\(replay\.sourceSeason === 2025 \|\| replay\.sourceSeason === 2026\)[\s\S]{0,300}return "zandvoort"/,
  );
});

test("bottom map information stays above projected 3D annotations", async () => {
  const [viewerSource, replaySource] = await Promise.all([
    readFile(
      new URL("../components/racemate/track-model-3d.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../features/race-replay/components/race-replay-player.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(
    viewerSource,
    /<div className=\{cn\(\s*"[^"]*\babsolute\b[^"]*\bbottom-\[[^"]*\bz-30\b[^"]*"/,
  );
  assert.match(
    replaySource,
    /absolute bottom-5 right-5 z-30/,
  );
  assert.match(
    replaySource,
    /absolute bottom-5 left-5 z-30/,
  );
  assert.match(
    replaySource,
    /xl:hidden[^>]*>[\s\S]*<span>Круг<\/span>/,
  );
});

test("Zandvoort model is a closed lap with all fourteen turns", () => {
  const first = ZANDVOORT_MODEL.points[0];
  const last = ZANDVOORT_MODEL.points.at(-1);

  assert.equal(first[0], 0);
  assert.equal(last[0], 1);
  assert.deepEqual(last.slice(1), first.slice(1));
  assert.deepEqual(
    ZANDVOORT_MODEL.turns.map(({ number }) => number),
    Array.from({ length: 14 }, (_, index) => index + 1),
  );
});

test("Zandvoort replay path aligns the start line and keeps a separate pit lane", () => {
  assert.ok(ZANDVOORT_REPLAY_PATH.startFinishProgress > 0.08);
  assert.ok(ZANDVOORT_REPLAY_PATH.startFinishProgress < 0.09);
  assert.ok(ZANDVOORT_REPLAY_PATH.pitLanePoints.length >= 90);
  assert.equal(ZANDVOORT_REPLAY_PATH.pitLanePoints[0][0], 0);
  assert.equal(ZANDVOORT_REPLAY_PATH.pitLanePoints.at(-1)[0], 1);
  assert.notDeepEqual(
    ZANDVOORT_REPLAY_PATH.pitLanePoints[0].slice(1, 3),
    ZANDVOORT_REPLAY_PATH.pitLanePoints.at(-1).slice(1, 3),
  );
});

test("Zandvoort sector breaks match the FIA positions before turns seven and eleven", () => {
  const turnProgress = new Map(
    ZANDVOORT_MODEL.turns.map(({ number, progress }) => [number, progress]),
  );
  const [sectorOneEnd, sectorTwoEnd] = ZANDVOORT_MODEL.sectorBreaks;

  assert.ok(turnProgress.get(6) < sectorOneEnd);
  assert.ok(sectorOneEnd < turnProgress.get(7));
  assert.ok(turnProgress.get(10) < sectorTwoEnd);
  assert.ok(sectorTwoEnd < turnProgress.get(11));
  assert.ok(ZANDVOORT_MODEL.speedTrapProgress < turnProgress.get(1));
});

test("Zandvoort banking slopes toward the inside of turns three and fourteen", () => {
  for (const turnNumber of [3, 14]) {
    const turn = ZANDVOORT_MODEL.turns.find(({ number }) => number === turnNumber);
    const banking = ZANDVOORT_TRACK_MODEL.rendering.banking.find(
      ({ from, to }) => turn.progress >= from && turn.progress <= to,
    );
    const pointIndex = ZANDVOORT_MODEL.points.findIndex(
      ([progress]) => progress >= turn.progress,
    );
    const previous = ZANDVOORT_MODEL.points[pointIndex - 1];
    const current = ZANDVOORT_MODEL.points[pointIndex];
    const next = ZANDVOORT_MODEL.points[pointIndex + 1];
    const incoming = [current[1] - previous[1], current[2] - previous[2]];
    const outgoing = [next[1] - current[1], next[2] - current[2]];
    const curvature = incoming[0] * outgoing[1] - incoming[1] * outgoing[0];

    assert.ok(banking, `missing banking data for turn ${turnNumber}`);
    assert.equal(
      Math.sign(banking.angleDeg),
      -Math.sign(curvature),
      `banking for turn ${turnNumber} must lower the inside edge`,
    );
  }
});
