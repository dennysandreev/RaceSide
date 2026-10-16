import assert from "node:assert/strict";
import test from "node:test";
import {
  compactLapLabel,
  displayedDelta,
  gearAnalysisRows,
  getTraceColors,
  lapAnalysisRows,
  lapDetail,
  lapLabel,
  sectorGapRows,
  teamColor,
} from "./format.ts";

test("displayed gap is negative while the reference driver leads", () => {
  assert.equal(displayedDelta(0.32), -0.32);
  assert.equal(displayedDelta(-0.14), 0.14);
  assert.equal(displayedDelta(0), 0);
  assert.equal(displayedDelta(null), null);
});

test("race averages show their source lap count instead of a synthetic lap number", () => {
  const average = { kind: "race_average", number: 0, sampleCount: 43 };
  assert.equal(lapLabel(average), "Средний темп · 43 круга");
  assert.equal(lapDetail(average), "Среднее по 43 гоночным кругам");
  assert.equal(compactLapLabel(average), "СРЕДНИЙ · 43 КР.");
});

test("team colors follow the supplied driver, including reordered comparisons", () => {
  const traces = [
    { driver: { color: "#FF8000", team: "McLaren" } },
    { driver: { color: "27F4D2", team: "Mercedes" } },
  ];
  assert.deepEqual(getTraceColors({ traces }), ["#ff8000", "#27f4d2"]);
  assert.deepEqual(getTraceColors({ traces: traces.toReversed() }), [
    "#27f4d2",
    "#ff8000",
  ]);
  assert.deepEqual(getTraceColors({ traces: [traces[0], traces[0]] }), [
    "#ff8000",
    "#9aa1ad",
  ]);
});

test("teammates use team color and neutral comparison color", () => {
  const traces = [
    { driver: { color: "#FF8000", team: "McLaren", id: "NOR" } },
    { driver: { color: "#FF8000", team: "McLaren", id: "PIA" } },
  ];
  assert.deepEqual(getTraceColors({ traces }), ["#ff8000", "#9aa1ad"]);
});

test("missing or unsafe provider colors use the neutral fallback", () => {
  for (const color of [
    undefined,
    null,
    "",
    "red",
    "#123",
    '#ffffff"/><script>',
    "url(https://example.com)",
  ]) {
    assert.equal(teamColor({ color }), "#b9c1cc");
  }
  assert.equal(teamColor(null), "#b9c1cc");
});

test("lap analysis explains braking and marks only rankable winners", () => {
  const trace = (topSpeed, brakingDistance, sector) => ({
    metrics: {
      topSpeed,
      averageSpeed: topSpeed - 100,
      fullThrottle: topSpeed - 200,
      brakingDistance,
      earliestBraking: 100,
      latestBraking: 5000,
    },
    lap: { sectors: [sector, sector + 1, sector + 2] },
  });
  const rows = lapAnalysisRows({
    traces: [trace(320, 600, 28), trace(315, 550, 27)],
  });
  assert.deepEqual(
    rows.find((row) => row.label === "Максимальная скорость").best,
    [true, false],
  );
  assert.deepEqual(rows.find((row) => row.label === "Сектор 1").best, [
    false,
    true,
  ]);
  const braking = rows.find((row) => row.label === "Путь под торможением");
  assert.match(braking.description, /Сумма участков/);
  assert.deepEqual(braking.best, [false, false]);
  assert.deepEqual(rows.find((row) => row.label === "Первое торможение").best, [
    false,
    false,
  ]);
});

test("sector gaps use official lap timing even when a saved telemetry estimate differs", () => {
  const comparison = {
    config: { reference: 0 },
    traces: [
      { lap: { sectors: [28.226, 32.797, 30.801] } },
      { lap: { sectors: [28.315, 32.999, 30.521] } },
    ],
    sectorDelta: [
      [0, 0.04],
      [0, 0.179],
      [0, -0.208],
    ],
  };
  assert.deepEqual(sectorGapRows(comparison), [
    { index: 0, delta: 0.089, winner: 0 },
    { index: 1, delta: 0.202, winner: 0 },
    { index: 2, delta: -0.28, winner: 1 },
  ]);
});

test("missing official sector timing cannot display a stored telemetry estimate as a sector win", () => {
  const comparison = {
    config: { reference: 0 },
    traces: [
      { lap: { sectors: [28, null, 30] } },
      { lap: { sectors: [29, 32, 31] } },
    ],
    sectorDelta: [
      [0, 1],
      [0, -0.25],
      [0, 1],
    ],
  };
  assert.deepEqual(sectorGapRows(comparison)[1], {
    index: 1,
    delta: null,
    winner: null,
  });
});

test("gear analysis omits neutral gear and marks the larger share", () => {
  const rows = gearAnalysisRows({
    traces: [
      { metrics: { gearUsage: { 0: 1, 1: 4, 2: 7 } } },
      { metrics: { gearUsage: { 0: 2, 1: 5, 2: 6 } } },
    ],
  });
  assert.deepEqual(
    rows.map((row) => row.gear),
    ["1", "2"],
  );
  assert.deepEqual(
    rows.map((row) => row.best),
    [
      [false, true],
      [true, false],
    ],
  );
});
