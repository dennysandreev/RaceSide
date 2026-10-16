import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDriverMotion,
  inferLapTimingsFromPositions,
  isDriverRetiredOnTrack,
  mergeLapTimingsWithInferred,
  trackProgressAt,
} from "./motion.ts";

function position(offsetMs, progress, svgX = progress * 100, driverNumber = 81) {
  return {
    driverNumber,
    headingRad: 0,
    normalizedZ: 0,
    offsetMs,
    progress,
    svgX,
    svgY: 0,
    timestamp: new Date(offsetMs).toISOString(),
    z: 0,
  };
}

test("official lap timing keeps a driver moving through a frozen location feed", () => {
  const motion = buildDriverMotion(
    [
      position(0, 0),
      position(10_000, 0.1),
      position(20_000, 0.2),
      position(30_000, 0.3),
      position(70_000, 0.301, 34),
      position(80_000, 0.4),
      position(90_000, 0.5),
    ],
    {
      lapTimings: [
        {
          driverNumber: 81,
          durationMs: 100_000,
          lapNumber: 1,
          startOffsetMs: 0,
        },
      ],
    },
  );

  assert.equal(trackProgressAt(motion, 50_000)?.hold, false);
  assert.ok(Math.abs(trackProgressAt(motion, 50_000).unwrapped - 0.5) < 0.001);

  let previous = trackProgressAt(motion, 1_000).unwrapped;

  for (let elapsedMs = 2_000; elapsedMs <= 99_000; elapsedMs += 1_000) {
    const current = trackProgressAt(motion, elapsedMs).unwrapped;
    assert.ok(current - previous > 0.005, `driver nearly stopped at ${elapsedMs} ms`);
    previous = current;
  }
});

test("official consecutive lap starts preserve the real gap and lap count", () => {
  const lapTimings = [
    { driverNumber: 1, durationMs: 74_000, lapNumber: 1, startOffsetMs: 0 },
    { driverNumber: 1, durationMs: 75_000, lapNumber: 2, startOffsetMs: 74_000 },
  ];
  const motion = buildDriverMotion(
    [position(0, 0, 0, 1), position(149_000, 0.99, 99, 1)],
    { lapTimings },
  );

  assert.ok(Math.abs(trackProgressAt(motion, 37_000).unwrapped - 0.5) < 0.001);
  assert.ok(Math.abs(trackProgressAt(motion, 111_500).unwrapped - 1.5) < 0.001);
  assert.ok(Math.abs(trackProgressAt(motion, 149_000).unwrapped - 2) < 0.001);
});

test("an unfinished final lap follows telemetry to the retirement point", () => {
  const lapTimings = [
    { driverNumber: 44, durationMs: 100_000, lapNumber: 1, startOffsetMs: 0 },
    { driverNumber: 44, durationMs: null, lapNumber: 2, startOffsetMs: 100_000 },
  ];
  const motion = buildDriverMotion(
    [
      { ...position(0, 0, 0, 44), lapNumber: 1 },
      { ...position(100_000, 0, 0, 44), lapNumber: 2 },
      { ...position(120_000, 0.25, 25, 44), lapNumber: 2 },
      { ...position(140_000, 0.45, 45, 44), lapNumber: 2 },
      { ...position(160_000, 0.451, 49, 44), lapNumber: 2 },
    ],
    { lapTimings },
  );

  assert.ok(Math.abs(trackProgressAt(motion, 120_000).unwrapped - 1.25) < 0.001);
  assert.ok(Math.abs(trackProgressAt(motion, 160_000).unwrapped - 1.451) < 0.001);
});

test("an unfinished final lap aligns telemetry whose track origin differs from start-finish", () => {
  const lapTimings = [
    { driverNumber: 11, durationMs: 90_000, lapNumber: 4, startOffsetMs: 360_000 },
    { driverNumber: 11, durationMs: null, lapNumber: 5, startOffsetMs: 450_000 },
  ];
  const motion = buildDriverMotion(
    [
      { ...position(450_500, 0.96, 96, 11), lapNumber: 5 },
      { ...position(460_000, 0.99, 99, 11), lapNumber: 5 },
      { ...position(470_000, 0.02, 2, 11), lapNumber: 5 },
      { ...position(480_000, 0.08, 8, 11), lapNumber: 5 },
    ],
    { lapTimings },
  );

  assert.ok(Math.abs(trackProgressAt(motion, 450_000).unwrapped - 4) < 0.001);
  assert.ok(Math.abs(trackProgressAt(motion, 470_000).unwrapped - 4.061579) < 0.001);
  assert.ok(Math.abs(trackProgressAt(motion, 480_000).unwrapped - 4.121579) < 0.001);
});

test("an unfinished final lap keeps moving when its first location samples are frozen", () => {
  const motion = buildDriverMotion(
    [
      { ...position(106_000, 0.0168, 16.8, 23), lapNumber: 2 },
      { ...position(114_000, 0.0173, 17.3, 23), lapNumber: 2 },
    ],
    {
      lapTimings: [
        { driverNumber: 23, durationMs: 100_000, lapNumber: 1, startOffsetMs: 0 },
        { driverNumber: 23, durationMs: null, lapNumber: 2, startOffsetMs: 100_000 },
      ],
    },
  );

  const before = trackProgressAt(motion, 101_000).unwrapped;
  const after = trackProgressAt(motion, 102_000).unwrapped;

  assert.ok(after - before > 0.005, `driver froze after starting the final lap: ${after - before}`);
});

test("a delayed lap counter cannot make the car jump multiple laps in one sample", () => {
  const events = Array.from({ length: 30 }, (_, index) => ({
    ...position(index * 10_000, (index % 9) / 9, index * 10, 16),
    lapNumber: Math.floor(index / 9) + 1,
  }));

  events.push({
    ...position(300_000, 0.45, 310, 16),
    lapNumber: 6,
  });

  const motion = buildDriverMotion(events);
  const before = trackProgressAt(motion, 299_000).unwrapped;
  const after = trackProgressAt(motion, 300_000).unwrapped;

  assert.ok(after - before < 0.05, `implausible lap-counter jump: ${after - before}`);
  assert.ok(after >= before);
});

test("legacy lap metadata describes the current lap, not the previous completed lap", () => {
  const timings = inferLapTimingsFromPositions([
    { ...position(100_000, 0.02, 2, 1), lapNumber: 1, lastLapDuration: 85.123 },
    { ...position(108_000, 0.12, 12, 1), lapNumber: 1, lastLapDuration: 85.123 },
    { ...position(185_123, 0.01, 1, 1), lapNumber: 2, lastLapDuration: 84.456 },
  ]);

  assert.deepEqual(timings, [
    { driverNumber: 1, durationMs: 85_123, lapNumber: 1, startOffsetMs: 100_000 },
    { driverNumber: 1, durationMs: 84_456, lapNumber: 2, startOffsetMs: 185_123 },
  ]);
});

test("legacy timing recovery preserves missing lap numbers instead of shifting the rest of the race", () => {
  const timings = inferLapTimingsFromPositions([
    { ...position(100_000, 0.02, 2, 1), lapNumber: 1, lastLapDuration: 90 },
    { ...position(190_000, 0.02, 2, 1), lapNumber: 2, lastLapDuration: 90 },
    { ...position(280_000, 0.02, 2, 1), lapNumber: 4, lastLapDuration: 90 },
  ]);

  assert.deepEqual(timings.map(({ lapNumber }) => lapNumber), [1, 2, 4]);
  assert.deepEqual(timings.map(({ startOffsetMs }) => startOffsetMs), [100_000, 190_000, 280_000]);
});

test("an unknown first lap duration does not add pre-start grid time to later laps", () => {
  const timings = inferLapTimingsFromPositions([
    { ...position(106, 0, 0, 18), lapNumber: 1, lastLapDuration: null },
    { ...position(302_506, 0, 0, 18), lapNumber: 2, lastLapDuration: 78.760 },
    { ...position(383_786, 0, 0, 18), lapNumber: 3, lastLapDuration: 78.014 },
  ], 195_847);
  assert.deepEqual(timings.map((lap) => lap.startOffsetMs), [195_847, 302_506, 381_266]);
});

test("Miami legacy drivers share the race start despite asynchronous first samples", () => {
  const timings = inferLapTimingsFromPositions([
    { ...position(244_834, 0, 0, 16), lapNumber: 1, lastLapDuration: 96.529 },
    { ...position(343_674, 0, 0, 16), lapNumber: 2, lastLapDuration: 93.036 },
    { ...position(243_574, 0, 0, 12), lapNumber: 1, lastLapDuration: 97.685 },
    { ...position(343_674, 0, 0, 12), lapNumber: 2, lastLapDuration: 92.936 },
  ], 242_493);

  assert.equal(timings.find((lap) => lap.driverNumber === 16).startOffsetMs, 242_493);
  assert.equal(timings.find((lap) => lap.driverNumber === 12).startOffsetMs, 242_493);
  const motions = [16, 12].map((driverNumber) => buildDriverMotion([], {
    lapTimings: timings.filter((lap) => lap.driverNumber === driverNumber),
  }));
  assert.ok(trackProgressAt(motions[0], 339_500).unwrapped > 1);
  assert.ok(trackProgressAt(motions[1], 339_500).unwrapped < 1);
});

test("without a start signal, legacy drivers use the earliest first-lap sample together", () => {
  const timings = inferLapTimingsFromPositions([
    { ...position(105_000, 0, 0, 16), lapNumber: 1, lastLapDuration: 90 },
    { ...position(100_000, 0, 0, 12), lapNumber: 1, lastLapDuration: 92 },
  ]);
  assert.deepEqual(timings.map((lap) => lap.startOffsetMs), [100_000, 100_000]);
});

test("inferred laps continue an incomplete official timing feed", () => {
  const official = Array.from({ length: 2 }, (_, index) => ({
    driverNumber: 3,
    durationMs: 90_000,
    lapNumber: index + 1,
    startOffsetMs: index * 90_000,
  }));
  const inferred = Array.from({ length: 5 }, (_, index) => ({
    driverNumber: 3,
    durationMs: 91_000,
    lapNumber: index + 1,
    startOffsetMs: index * 91_000,
  }));

  const merged = mergeLapTimingsWithInferred(official, inferred);

  assert.deepEqual(merged.map((timing) => timing.lapNumber), [1, 2, 3, 4, 5]);
  assert.equal(merged[0].durationMs, 90_000);
  assert.equal(merged[2].durationMs, 91_000);
});

test("a recovered lap is aligned between its official neighbours", () => {
  const official = [
    { driverNumber: 27, durationMs: 77_891, lapNumber: 42, startOffsetMs: 5_310_339 },
    { driverNumber: 27, durationMs: 77_968, lapNumber: 44, startOffsetMs: 5_466_377 },
  ];
  const inferred = [
    { driverNumber: 27, durationMs: 77_891, lapNumber: 42, startOffsetMs: 5_215_308 },
    { driverNumber: 27, durationMs: 77_968, lapNumber: 43, startOffsetMs: 5_293_199 },
    { driverNumber: 27, durationMs: 77_789, lapNumber: 44, startOffsetMs: 5_371_167 },
  ];

  const merged = mergeLapTimingsWithInferred(official, inferred);

  assert.equal(merged[1].lapNumber, 43);
  assert.equal(merged[1].startOffsetMs, 5_388_230);

  const motion = buildDriverMotion(
    [position(5_310_339, 0, 0, 27), position(5_544_345, 0.99, 99, 27)],
    { lapTimings: merged },
  );
  let previous = trackProgressAt(motion, 5_311_000).unwrapped;

  for (let elapsedMs = 5_312_000; elapsedMs <= 5_465_000; elapsedMs += 1_000) {
    const current = trackProgressAt(motion, elapsedMs).unwrapped;
    assert.ok(current - previous > 0.005, `driver nearly stopped at ${elapsedMs} ms`);
    assert.ok(current - previous < 0.02, `driver jumped at ${elapsedMs} ms`);
    previous = current;
  }
});

test("a synthetic restart boundary cannot make the car run two laps at once", () => {
  const lapTimings = [
    { driverNumber: 41, durationMs: null, lapNumber: 4, startOffsetMs: 2_382_445 },
    { driverNumber: 41, durationMs: 87_335, lapNumber: 5, startOffsetMs: 2_437_719 },
    { driverNumber: 41, durationMs: 89_772, lapNumber: 6, startOffsetMs: 2_469_429 },
    { driverNumber: 41, durationMs: 78_444, lapNumber: 7, startOffsetMs: 2_559_272 },
    { driverNumber: 41, durationMs: 78_614, lapNumber: 8, startOffsetMs: 2_637_747 },
  ];
  const motion = buildDriverMotion(
    [position(2_382_445, 0, 0, 41), position(2_716_361, 0.99, 99, 41)],
    { lapTimings },
  );
  let previous = trackProgressAt(motion, 2_383_000).unwrapped;

  for (let elapsedMs = 2_384_000; elapsedMs <= 2_468_000; elapsedMs += 1_000) {
    const current = trackProgressAt(motion, elapsedMs).unwrapped;
    assert.ok(current - previous > 0.005, `driver nearly stopped at ${elapsedMs} ms`);
    assert.ok(current - previous < 0.02, `driver jumped at ${elapsedMs} ms`);
    previous = current;
  }
});

test("a stopped driver retires after fifteen seconds even when telemetry stops", () => {
  const events = [
    position(360_000, 0.4, 0, 77),
    position(368_000, 0.5, 25, 77),
    position(376_000, 0.6, 50, 77),
    position(384_000, 0.7, 75, 77),
  ];

  assert.equal(isDriverRetiredOnTrack(events, 398_999, false), false);
  assert.equal(isDriverRetiredOnTrack(events, 399_000, false), true);
});

test("a distant noisy sample cannot keep a stopped driver active", () => {
  const events = [
    position(360_000, 0.4, 0, 77),
    position(368_000, 0.5, 25, 77),
    position(376_000, 0.6, 50, 77),
    position(384_000, 0.7, 75, 77),
    position(624_000, 0.72, 96, 77),
  ];

  assert.equal(isDriverRetiredOnTrack(events, 399_000, false), true);
});

test("nearby future movement keeps an active driver on track", () => {
  const events = [
    position(360_000, 0.4, 0, 77),
    position(368_000, 0.5, 25, 77),
    position(376_000, 0.6, 50, 77),
    position(384_000, 0.7, 75, 77),
    position(408_000, 0.9, 100, 77),
  ];

  assert.equal(isDriverRetiredOnTrack(events, 399_000, false), false);
});
