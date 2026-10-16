import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReportAnalytics,
  compareReportStandings,
  getReportPitStops,
  reportChartRows,
  reportLapTimings,
  reportNumber,
  reportLapTime,
} from "./grand-prix-report.ts";

const report = (extra = {}) => ({
  results: [
    {
      driverNumber: 3,
      driver: "Max Verstappen",
      team: "Red Bull",
      position: 1,
      laps: 3,
      tyres: [],
    },
  ],
  raceStatistics: { laps: 3 },
  pitStops: [],
  ...extra,
});
test("lap times use minutes, seconds and milliseconds, including rounding at a minute boundary", () => {
  assert.equal(reportLapTime(98.22), "1:38.220");
  assert.equal(reportLapTime(135), "2:15.000");
  assert.equal(reportLapTime(59.9999), "1:00.000");
  assert.equal(reportLapTime(0), "0:00.000");
  for (const value of [null, undefined, NaN, Infinity, -1, "unknown"])
    assert.equal(reportLapTime(value), "—");
});
test("missing and malformed numbers never become zero", () => {
  for (const value of [
    null,
    undefined,
    "",
    "  ",
    true,
    [],
    {},
    Infinity,
    "unknown",
  ])
    assert.equal(reportNumber(value), null);
  assert.equal(reportNumber(0), 0);
  assert.equal(reportNumber("2.33"), 2.33);
});
test("malformed cached rows do not hide valid report data or corrupt the lap scale", () => {
  const analytics = buildReportAnalytics(
    report({ results: [{ ...report().results[0], laps: NaN }] }),
    {
      lapTimings: [null],
      positionTimings: [null],
      intervalTimings: [null],
      lapSamples: [null],
    },
    {
      totalLaps: NaN,
      drivers: [null],
      points: [null],
      stints: [null],
    },
  );
  assert.equal(analytics.totalLaps, 3);
  assert.equal(analytics.drivers.length, 1);
  assert.deepEqual(
    analytics.drivers[0].pace.map((point) => point.value),
    [null, null, null],
  );
});
test("positions persist until a recorded change; stale gaps and lapped gaps stay unknown", () => {
  const analytics = buildReportAnalytics(
    report({
      results: [
        ...report().results,
        { driverNumber: 7, driver: "Other", team: "Other", laps: 3, tyres: [] },
      ],
    }),
    {
      lapTimings: [1, 2, 3].map((lapNumber) => ({
        driverNumber: 3,
        lapNumber,
        startOffsetMs: (lapNumber - 1) * 90_000,
        durationMs: 90_000,
      })),
      positionTimings: [{ driverNumber: 3, offsetMs: 0, position: 2 }],
      intervalTimings: [
        { driverNumber: 3, offsetMs: 85_000, gapToLeader: "+1.234" },
        { driverNumber: 3, offsetMs: 265_000, gapToLeader: "+1 LAP" },
      ],
    },
  );
  assert.deepEqual(
    analytics.drivers[0].positions.map((point) => point.value),
    [2, 2, 2],
  );
  assert.deepEqual(
    analytics.drivers[0].gaps.map((point) => point.value),
    [1.234, null, null],
  );
});
test("compact and object Replay lap timing preserve missing durations", () => {
  assert.deepEqual(
    reportLapTimings([
      [3, 1, 0, 90_000],
      [3, 2, 90_000, null],
      {
        driverNumber: 3,
        lapNumber: 3,
        startOffsetMs: 180_000,
        durationMs: 90_000,
      },
      null,
    ]),
    [
      { driverNumber: 3, lapNumber: 1, startOffsetMs: 0, durationMs: 90_000 },
      {
        driverNumber: 3,
        lapNumber: 2,
        startOffsetMs: 90_000,
        durationMs: null,
      },
      {
        driverNumber: 3,
        lapNumber: 3,
        startOffsetMs: 180_000,
        durationMs: 90_000,
      },
    ],
  );
});
test("unclean laps, missing laps and tyre changes break the pace line", () => {
  const pace = {
    totalLaps: 6,
    drivers: [{ number: 3, name: "Max Verstappen", code: "VER" }],
    stints: [],
    points: [
      { driver: 3, lap: 1, clean: true, time: 90, trend: 91, stint: 1 },
      { driver: 3, lap: 2, clean: false, time: 120, trend: 95, stint: 1 },
      { driver: 3, lap: 3, clean: true, time: 89, trend: 90, stint: 1 },
      { driver: 3, lap: 4, clean: true, time: 88, trend: 89, stint: 2 },
      { driver: 3, lap: 6, clean: true, time: 87, trend: 88, stint: 2 },
    ],
  };
  const analytics = buildReportAnalytics(report(), {}, pace);
  assert.deepEqual(
    reportChartRows(analytics.drivers, "pace", 6).map((row) => row.driver3),
    [91, null, 90, null, null, 88],
  );
  assert.deepEqual(analytics.drivers[0].positions, []);
});
test("older Replay samples use the last recorded position in each lap without filling missing laps", () => {
  const analytics = buildReportAnalytics(report(), {
    lapSamples: [
      {
        driverNumber: 3,
        lapNumber: 1,
        offsetMs: 80_000,
        position: 1,
        gapToLeader: "+0.000",
      },
      {
        driverNumber: 3,
        lapNumber: 3,
        offsetMs: 260_000,
        position: 1,
        gapToLeader: "+1 LAP",
      },
      {
        driverNumber: 3,
        lapNumber: 1,
        offsetMs: 50_000,
        position: 1,
        gapToLeader: "+2.1",
      },
    ],
  });
  assert.deepEqual(
    reportChartRows(analytics.drivers, "positions", 3).map(
      (row) => row.driver3,
    ),
    [1, null, 1],
  );
  assert.deepEqual(
    reportChartRows(analytics.drivers, "gaps", 3).map((row) => row.driver3),
    [0, null, null],
  );
});
test("pit stops distinguish missing stop duration from measured pit lane time", () => {
  const pits = getReportPitStops(
    report({
      pitStops: [
        {
          driver: "Max Verstappen",
          lap: 2,
          duration: null,
          laneDuration: 24.3,
        },
        { driver: "Max Verstappen", lap: 1, duration: 2.33 },
        { driver: "Max Verstappen", lap: null, duration: 0 },
      ],
    }),
  );
  assert.deepEqual(
    pits.map((pit) => [pit.lap, pit.duration, pit.laneDuration]),
    [
      [1, 2.33, null],
      [2, null, 24.3],
    ],
  );
});
test("championship gains use the same stage snapshots, including sprint points", () => {
  const before = [
    { id: "a", name: "A", team: "T", position: 2, points: 100 },
    { id: "b", name: "B", team: "T", position: 1, points: 110 },
  ];
  const after = [
    { ...before[0], position: 1, points: 133 },
    { ...before[1], position: 2, points: 128 },
  ];
  const rows = compareReportStandings(before, after, 2);
  assert.deepEqual(
    rows.map((row) => [row.id, row.previousPosition, row.gained]),
    [
      ["a", 2, 33],
      ["b", 1, 18],
    ],
  );
  assert.deepEqual(compareReportStandings(before.slice(0, 1), after, 2), []);
  assert.deepEqual(compareReportStandings(before, [after[0], after[0]], 2), []);
  assert.equal(compareReportStandings([], after, 2, true)[0].gained, 133);
});
