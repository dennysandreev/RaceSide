import assert from "node:assert/strict";
import test from "node:test";
import { loadLiveChampionship } from "./championship.mjs";

function database({
  round = 2,
  missing = false,
  sprint = false,
  final = false,
  pointsReady = true,
} = {}) {
  const calls = [];
  const fixtures = {
    races: [{ id: "race", season_year: 2026, round }],
    driver_standings: [1, 2, 3, 4].slice(0, missing ? 2 : 4).map((id) => ({
      driver_id: String(id),
      team_id: id < 3 ? "a" : "b",
      points: 25,
      position: id,
      drivers: {
        code: `D${id}`,
        full_name: `Driver ${id}`,
        permanent_number: id,
      },
    })),
    constructor_standings: ["a", "b"].map((team_id) => ({
      team_id,
      points: 50,
      position: team_id === "a" ? 1 : 2,
    })),
    driver_season_profiles: [1, 2, 3, 4].map((id) => ({
      driver_id: String(id),
      primary_team_id: id < 3 ? "a" : "b",
      permanent_number: id,
      code: `D${id}`,
      drivers: { full_name: `Driver ${id}` },
    })),
    team_season_profiles: ["a", "b"].map((team_id) => ({
      team_id,
      display_name: team_id,
      color_hex: "#888888",
    })),
    sessions: [
      ...(final
        ? [
            {
              id: "current",
              session_type: "race",
              races: { round },
              status: "completed",
              openf1_session_key: 10,
            },
          ]
        : []),
      ...(round > 1
        ? [
            {
              id: "previous",
              session_type: "race",
              races: { round: 1 },
              status: "completed",
            },
          ]
        : []),
      ...(sprint
        ? [
            {
              id: "sprint",
              session_type: "sprint",
              start_at: "2026-09-10T12:00:00Z",
              status: "completed",
              races: { round },
              openf1_session_key: 9,
            },
          ]
        : []),
    ],
    session_results: [1, 2, 3, 4].flatMap((id) => [
      ...(final
        ? [
            {
              session_id: "current",
              driver_id: String(id),
              team_id: id < 3 ? "a" : "b",
              position: id,
              classified_position: id === 4 ? "R" : String(id),
              points: pointsReady ? (id === 1 ? 12.5 : 0) : null,
            },
          ]
        : []),
      {
        session_id: "previous",
        driver_id: String(id),
        team_id: id < 3 ? "a" : "b",
        position: id,
        classified_position: String(id),
        points: 25,
      },
      ...(sprint
        ? [
            {
              session_id: "sprint",
              driver_id: String(id),
              team_id: id < 3 ? "a" : "b",
              position: id,
              points: 9 - id,
            },
          ]
        : []),
    ]),
  };
  return {
    calls,
    from(table) {
      const query = {
        then(resolve) {
          return Promise.resolve({ data: fixtures[table], error: null }).then(
            resolve,
          );
        },
      };
      for (const method of ["select", "eq", "lte", "in", "order", "range"])
        query[method] = (...args) => {
          calls.push([table, method, ...args]);
          return query;
        };
      return query;
    },
  };
}
const session = {
  session_key: 10,
  race_id: "race",
  session_name: "Race",
  date_start: "2026-09-11T12:00:00Z",
};
test("reads exact standings before the round and uses cached race results for countback", async () => {
  const db = database();
  const base = await loadLiveChampionship(db, session);
  assert.equal(base.round, 2);
  assert.equal(base.drivers[0].finishes[0], 1);
  assert.equal(base.teams[0].finishes[1], 1);
  assert.equal(base.countbackComplete, true);
  assert.ok(
    db.calls.some(
      (call) =>
        call[0] === "driver_standings" &&
        call[1] === "eq" &&
        call[2] === "round" &&
        call[3] === 1,
    ),
  );
});
test("does not substitute partial standings with zeroes", async () => {
  assert.equal(
    await loadLiveChampionship(database({ missing: true }), session),
    null,
  );
});
test("uses the zero baseline for the first round without requesting round zero", async () => {
  const db = database({ round: 1 });
  const base = await loadLiveChampionship(db, session);
  assert.ok(
    base.drivers.every((row) => row.points === 0 && row.position === null),
  );
  assert.ok(!db.calls.some((call) => call[0] === "driver_standings"));
});
test("completed sprint is included in race but excluded from its own projection and earlier practice", async () => {
  assert.equal(
    (await loadLiveChampionship(database({ sprint: true }), session)).sprint
      .status,
    "ready",
  );
  assert.equal(
    (
      await loadLiveChampionship(database({ sprint: true }), {
        ...session,
        session_name: "Sprint",
      })
    ).sprint.status,
    "none",
  );
  assert.equal(
    (
      await loadLiveChampionship(database({ sprint: true }), {
        ...session,
        session_name: "Practice 1",
        date_start: "2026-09-09T12:00:00Z",
      })
    ).sprint.status,
    "none",
  );
  assert.deepEqual(
    (
      await loadLiveChampionship(database({ sprint: true }), {
        ...session,
        session_name: "Practice 1",
        date_start: "2026-09-09T12:00:00Z",
      })
    ).sprint.points,
    [],
  );
});
test("publishes complete saved results separately from the pre-round baseline", async () => {
  const result = await loadLiveChampionship(database({ final: true }), session);
  assert.equal(result.drivers[0].points, 25);
  assert.equal(result.drivers[0].finishes[0], 1);
  assert.equal(result.results.length, 4);
  assert.equal(result.results[0].points, 12.5);
  assert.equal(result.results[3].position, null);
});
test("does not present missing saved points as final zeroes", async () => {
  const result = await loadLiveChampionship(
    database({ final: true, pointsReady: false }),
    session,
  );
  assert.equal(result.results, null);
});
