import assert from "node:assert/strict";
import test from "node:test";

import { circuitHistoryChartRows, circuitRaceCount, circuitSeasonRange } from "./circuit-stats-display.ts";

test("history charts preserve zero retirements and leave unknown or invalid observations empty", () => {
  const rows = [
    { season: 2025, round: 2, dnfCount: null, winnerStartPosition: 0 },
    { season: 2024, round: 3, dnfCount: 0, winnerStartPosition: 1 },
    { season: 2023, round: 4, dnfCount: -1, winnerStartPosition: 2.5 },
  ];
  const result = circuitHistoryChartRows(rows);
  assert.deepEqual(result.map((row) => [row.season, row.dnfCount, row.winnerStartPosition]), [
    [2023, null, null], [2024, 0, 1], [2025, null, null],
  ]);
  assert.deepEqual(rows.map((row) => row.season), [2025, 2024, 2023]);
});

test("two Grands Prix at one circuit in the same season keep distinct labels and round order", () => {
  const result = circuitHistoryChartRows([
    { season: 2020, round: 9, dnfCount: 2, winnerStartPosition: 2 },
    { season: 2021, round: 8, dnfCount: 1, winnerStartPosition: 3 },
    { season: 2020, round: 8, dnfCount: 0, winnerStartPosition: 1 },
  ]);
  assert.deepEqual(result.map((row) => row.label), ["2020 · 8", "2020 · 9", "2021"]);
  assert.deepEqual(circuitHistoryChartRows([]), []);
});

test("sample captions use Russian plurals and never invent a missing season boundary", () => {
  assert.deepEqual([0, 1, 2, 5, 11, 14, 21, 22, 25].map(circuitRaceCount), [
    "0 гонок", "1 гонка", "2 гонки", "5 гонок", "11 гонок", "14 гонок", "21 гонка", "22 гонки", "25 гонок",
  ]);
  assert.equal(circuitSeasonRange(null, 2025), null);
  assert.equal(circuitSeasonRange(2025, null), null);
  assert.equal(circuitSeasonRange(2025, 2025), "2025");
  assert.equal(circuitSeasonRange(2012, 2025), "2012–2025");
});
