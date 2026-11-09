import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import { buildDriverRoundSnapshots } from "../lib/driver-comparison.ts";
import { getRoundResultPoints } from "../lib/f1-points.ts";

const source = ts.createSourceFile("racemate-repository.ts",
  readFileSync(new URL("./racemate-repository.ts", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true);
const names = new Set([
  "getDriverComparisonDataUncached", "isCompletedSportStatus", "buildDriverProfileContext",
  "buildDriverRaceInput", "findSessionByType", "getDriverSessionResult", "normalizeGridPosition",
  "getDriverResultPoints", "isDnfDriverResult", "hasFastestLap",
  "getFastestLapTime", "getFastestLapTimeFromPayload", "getFastestLapRecord", "averageNumber",
  "buildDriverFormStats", "buildPositionDeltaStats", "buildTeammateComparison",
  "findTeammateResult", "getLatestDriverStanding",
]);
const functions = source.statements
  .filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
  .map((node) => node.getText(source));
const { outputText } = ts.transpileModule(functions.join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});

function fixture() {
  const races = [1, 2, 3].map((round) => ({
    id: `race-${round}`, season_year: 2026, round, race_name: `Grand Prix ${round}`,
    race_start_at: `2026-03-${10 + round}T12:00:00Z`, status: "completed",
    circuits: { name: "Circuit", country: "Australia" },
  }));
  const sessions = races.flatMap((race) => ["qualifying", "sprint", "race"].map((type) => ({
    id: `${race.id}-${type}`, race_id: race.id, session_type: type,
    name: type, start_at: race.race_start_at, status: "completed",
  })));
  const results = [];
  for (const [index, race] of races.entries()) {
    for (const driver of ["driver", "teammate"]) {
      const position = driver === "driver" ? [2, 20, 1][index] : [5, 6, 7][index];
      results.push({
        session_id: `${race.id}-qualifying`, driver_id: driver, team_id: "team",
        position: [1, 3, 4][index], grid: null, points: 0, status: null,
        time_text: null, drivers: { full_name: driver }, teams: null,
      }, {
        session_id: `${race.id}-race`, driver_id: driver, team_id: "team",
        position, grid: [1, 3, 4][index], points: getRoundResultPoints(null, "race", position),
        status: position === 20 ? "Retired" : "Finished", time_text: null,
        raw_payload: { FastestLap: { rank: index === 0 ? "1" : "2" } },
        drivers: { full_name: driver }, teams: null,
      });
    }
  }
  results.push({
    session_id: "race-2-sprint", driver_id: "driver", team_id: "team",
    position: 2, grid: 2, points: 7, status: "Finished", time_text: null,
    drivers: { full_name: "driver" }, teams: null,
  });
  return { races, sessions, results, standings: [] };
}

function loadRepository(data) {
  const tables = { races: data.races, sessions: data.sessions, session_results: data.results,
    driver_standings: data.standings.map((row) => ({ driver_id: "driver", ...row })) };
  const bindings = {
    buildDriverRoundSnapshots, getRoundResultPoints,
    createSupabaseServerClient: async () => ({
      from(table) {
        let rows = tables[table];
        return {
          select() { return this; }, eq() { return this; }, order() { return this; },
          in(key, values) { rows = rows.filter((row) => values.includes(row[key])); return this; },
          then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject); },
        };
      },
    }),
    getDriverDirectory: async () => [{ id: "team", slug: "team", name: "Team", drivers: [
      { id: "driver", slug: "driver", fullName: "Driver" },
      { id: "teammate", slug: "teammate", fullName: "Teammate" },
    ] }],
    getLatestCompleteStandingRound: async () => ({ round: data.standings.at(-1)?.round ?? 0 }),
    getRelationObject: (value) => Array.isArray(value) ? value[0] : value,
    formatGrandPrixNameRu: (value) => value,
    formatDateTime: (value) => value,
    getCountryFlag: () => "", getCountryCode: () => "AU", isLapOnlyResult: () => false,
  };
  return new Function(...Object.keys(bindings), `${outputText}\nreturn { buildDriverProfileContext, getDriverComparisonDataUncached };`)(
    ...Object.values(bindings));
}

async function calculate(data, driverId = "driver") {
  const repo = loadRepository(data);
  const profile = repo.buildDriverProfileContext(driverId, data.races, data.sessions, data.results, data.standings, []);
  const comparison = await repo.getDriverComparisonDataUncached(2026, [driverId, "teammate"]);
  return { profile, snapshot: comparison.drivers.find((driver) => driver.id === driverId)?.snapshots.at(-1) };
}

function assertSameStats(profile, snapshot) {
  for (const key of ["points", "championshipPosition", "wins", "podiums", "poles", "fastestLaps",
    "q3Appearances", "pointsFinishes", "dnfs", "averageStart", "averageFinish"]) {
    assert.equal(profile.stats[key], snapshot[key], key);
  }
  assert.equal(profile.positionDelta.totalDelta ?? 0, snapshot.positionsGained, "positionsGained");
  for (const key of ["averageStart", "averageFinish", "dnfs"]) {
    assert.equal(profile.teammateComparison[key].driver, profile.stats[key], `teammateComparison.${key}`);
  }
}

test("profile and comparison share every metric, including classified retirements", async () => {
  const { profile, snapshot } = await calculate(fixture());
  assertSameStats(profile, snapshot);
  assert.equal(snapshot.averageFinish, 7.7);
  assert.equal(snapshot.positionsGained, -15);
  assert.equal(snapshot.dnfs, 1);
  assert.equal(snapshot.points, 50);
  assert.equal(snapshot.pointsFinishes, 2);
});

test("a qualifying or sprint entry without race results is not a retirement or a points finish", async () => {
  const data = fixture();
  data.results = data.results.filter((row) => row.session_id !== "race-2-race" || row.driver_id !== "driver");
  const { profile, snapshot } = await calculate(data);
  assertSameStats(profile, snapshot);
  assert.equal(snapshot.dnfs, 0);
  assert.equal(snapshot.starts, 2);
  assert.equal(snapshot.pointsFinishes, 2);
  assert.equal(profile.results[1].isDnf, false);
});

test("a substitute is not assigned retirements for weekends they did not enter", async () => {
  const data = fixture();
  data.results = data.results.filter((row) => row.driver_id !== "driver" || row.session_id.startsWith("race-3-"));
  const { profile, snapshot } = await calculate(data);
  assertSameStats(profile, snapshot);
  assert.equal(snapshot.dnfs, 0);
  assert.equal(snapshot.starts, 1);
  assert.equal(profile.results[0].points, null);
  assert.equal(profile.results[1].isDnf, false);
});

test("official corrections can reduce totals and later results extend the latest standing", async () => {
  const data = fixture();
  data.standings = [{ round: 1, position: 3, points: 10, wins: 0 }];
  const { profile, snapshot } = await calculate(data);
  assertSameStats(profile, snapshot);
  assert.equal(snapshot.points, 42);
  assert.equal(snapshot.wins, 1);
  assert.equal(snapshot.championshipPosition, 3);
});

test("official point and win corrections replace, rather than maximize, calculated totals", async () => {
  const data = fixture();
  data.standings = [{ round: 3, position: 4, points: 40, wins: 0 }];
  const { profile, snapshot } = await calculate(data);
  assertSameStats(profile, snapshot);
  assert.equal(snapshot.points, 40);
  assert.equal(snapshot.wins, 0);
});

test("the same rules apply at every selected round, without reading subsequent results", async () => {
  for (const round of [1, 2, 3]) {
    const data = fixture();
    data.races = data.races.filter((race) => race.round <= round);
    data.sessions = data.sessions.filter((session) => data.races.some((race) => race.id === session.race_id));
    const { profile, snapshot } = await calculate(data);
    assertSameStats(profile, snapshot);
    assert.equal(snapshot.round, round);
  }
});

test("unknown and pit-lane grid positions never become zero or negative averages", async () => {
  const data = fixture();
  const raceResults = data.results.filter((row) => row.driver_id === "driver" && /-race$/.test(row.session_id));
  raceResults[0].grid = 0;
  raceResults[1].grid = -1;
  raceResults[2].grid = null;
  const { profile, snapshot } = await calculate(data);
  assertSameStats(profile, snapshot);
  assert.equal(snapshot.averageStart, null);
  assert.equal(snapshot.positionsGained, 0);
});

test("a retirement without a classified position has no invented finish or gain", async () => {
  const data = fixture();
  data.results.find((row) => row.driver_id === "driver" && row.session_id === "race-2-race").position = null;
  const { profile, snapshot } = await calculate(data);
  assertSameStats(profile, snapshot);
  assert.equal(snapshot.dnfs, 1);
  assert.equal(snapshot.averageFinish, 1.5);
  assert.equal(snapshot.positionsGained, 2);
});

test("empty results keep averages unknown and do not invent retirements", async () => {
  const data = fixture();
  data.results = [];
  const { profile, snapshot } = await calculate(data);
  assertSameStats(profile, snapshot);
  assert.equal(snapshot.averageStart, null);
  assert.equal(snapshot.averageFinish, null);
  assert.equal(snapshot.points, 0);
  assert.equal(snapshot.dnfs, 0);
});
