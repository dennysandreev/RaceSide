import assert from "node:assert/strict";
import test from "node:test";
import { projectChampionship } from "./championship.ts";
import { LiveStore } from "./store.ts";

const entry = (id, points, position, teamId = "a") => ({
  id,
  points,
  position,
  teamId,
  driverNumber: Number(id),
  acronym: `D${id}`,
  fullName: id,
  finishes: [],
});
const base = (overrides = {}) => ({
  sessionKey: 1,
  season: 2026,
  round: 2,
  drivers: [entry("1", 30, 1), entry("2", 29, 2), entry("3", 20, 3, "b")],
  teams: [
    {
      id: "a",
      name: "A",
      colour: "#ff8800",
      points: 59,
      position: 1,
      finishes: [],
    },
    {
      id: "b",
      name: "B",
      colour: "#0088ff",
      points: 20,
      position: 2,
      finishes: [],
    },
  ],
  countbackComplete: true,
  sprint: { status: "none", points: [] },
  ...overrides,
});
const live = (positions = [2, 1, 3], overrides = {}) => ({
  currentLap: 10,
  status: "live",
  drivers: Object.fromEntries(
    positions.map((position, i) => [
      i + 1,
      {
        driverNumber: i + 1,
        acronym: `D${i + 1}`,
        position,
        status: "RUNNING",
      },
    ]),
  ),
  ...overrides,
});

test("updates championship places and sums both team drivers without mutating the baseline", () => {
  const baseline = base(),
    copy = structuredClone(baseline);
  const result = projectChampionship(baseline, live(), "race");
  assert.deepEqual(
    result.drivers.map((row) => [
      row.id,
      row.earned,
      row.total,
      row.projectedPosition,
      row.movement,
    ]),
    [
      ["2", 25, 54, 1, 1],
      ["1", 18, 48, 2, -1],
      ["3", 15, 35, 3, 0],
    ],
  );
  assert.equal(result.teams[0].earned, 43);
  assert.equal(result.teams[0].total, 102);
  assert.equal(
    projectChampionship(baseline, live([1, 2, 3]), "race").drivers[0].id,
    "1",
  );
  assert.deepEqual(baseline, copy);
});
test("uses sprint scoring and includes completed sprint points exactly once in the race", () => {
  const baseline = base({
    sprint: {
      status: "ready",
      points: [{ driverId: "1", teamId: "a", points: 8 }],
    },
  });
  const race = projectChampionship(baseline, live(), "race");
  assert.equal(race.drivers.find((row) => row.id === "1").earned, 26);
  assert.equal(race.teams[0].earned, 51);
  const sprint = projectChampionship(baseline, live(), "sprint");
  assert.equal(sprint.drivers.find((row) => row.id === "1").earned, 7);
  assert.equal(sprint.teams[0].earned, 15);
});
test("practice, qualifying and waiting do not award points for their positions", () => {
  for (const mode of ["practice", "qualifying", "sprint_qualifying"])
    assert.ok(
      projectChampionship(base(), live(), mode).drivers.every(
        (row) => row.earned === 0,
      ),
    );
  assert.ok(
    projectChampionship(
      base(),
      live(undefined, { status: "waiting" }),
      "race",
    ).drivers.every((row) => row.earned === 0),
  );
});
test("retirements, missing positions and conflicting updates do not earn fictional points", () => {
  const state = live([1, 1, null]);
  let result = projectChampionship(base(), state, "race");
  assert.ok(result.drivers.every((row) => row.earned === 0));
  assert.equal(result.missingDrivers, true);
  for (const status of ["DNF", "DNS", "DSQ", "RETIRED"]) {
    const retired = live();
    retired.drivers[2].status = status;
    result = projectChampionship(base(), retired, "race");
    assert.equal(result.drivers.find((row) => row.id === "2").earned, 0);
  }
});
test("equal points use race countback including the projected finish, but not a sprint win", () => {
  const baseline = base({
    drivers: [entry("1", 25, 1), { ...entry("2", 18, 2), finishes: [2] }],
  });
  assert.equal(
    projectChampionship(baseline, live([2, 1]), "race").drivers[0].id,
    "2",
  );
  const tied = base({ drivers: [entry("1", 7, 1), entry("2", 6, 2)] });
  assert.equal(
    projectChampionship(tied, live([2, 1]), "sprint").drivers[0].id,
    "1",
  );
});
test("official finish points override the projection, including a classified DNF and reduced scoring", () => {
  const state = live(undefined, { status: "finished" });
  state.drivers[2].status = "DNF";
  const baseline = base({
    results: [
      { driverId: "1", teamId: "a", position: 2, points: 18 },
      { driverId: "2", teamId: "a", position: 1, points: 6 },
      { driverId: "3", teamId: "b", position: 3, points: 15 },
    ],
  });
  assert.equal(
    projectChampionship(baseline, state, "race").drivers.find(
      (row) => row.id === "2",
    ).earned,
    6,
  );
  assert.equal(
    projectChampionship(baseline, state, "race").teams[0].earned,
    24,
  );
  assert.equal(projectChampionship(baseline, state, "race").finalized, true);
});
test("saved final results work without telemetry and are not used before the finish", () => {
  const baseline = base({
    results: [
      { driverId: "1", teamId: "a", position: 1, points: 12.5 },
      { driverId: "2", teamId: "a", position: 2, points: 0 },
      { driverId: "3", teamId: "b", position: null, points: 0 },
    ],
  });
  const final = projectChampionship(
    baseline,
    live(undefined, { status: "finished", currentLap: 0, drivers: {} }),
    "race",
  );
  assert.equal(final.started, true);
  assert.equal(final.drivers[0].earned, 12.5);
  assert.equal(final.drivers[0].projectedFinishes[0], 1);
  const ongoing = projectChampionship(baseline, live(), "race");
  assert.equal(ongoing.finalized, false);
  assert.equal(ongoing.drivers.find((row) => row.id === "1").earned, 18);
});
test("matches a champion by acronym even when the racing number changes", () => {
  const state = live();
  state.drivers[1].driverNumber = 81;
  assert.equal(
    projectChampionship(base(), state, "race").drivers.find(
      (row) => row.id === "1",
    ).liveNumber,
    81,
  );
});
test("a driver's team switch keeps sprint points with the sprint constructor", () => {
  const baseline = base({
    sprint: {
      status: "ready",
      points: [{ driverId: "1", teamId: "b", points: 8 }],
    },
  });
  const result = projectChampionship(baseline, live(), "race");
  assert.equal(result.teams.find((row) => row.id === "a").earned, 43);
  assert.equal(result.teams.find((row) => row.id === "b").earned, 23);
});
test("first round has zero baseline and no invented rank change", () => {
  const baseline = base({
    round: 1,
    drivers: [entry("1", 0, null), entry("2", 0, null)],
  });
  const result = projectChampionship(baseline, live([2, 1]), "race");
  assert.equal(result.drivers[0].id, "2");
  assert.ok(result.drivers.every((row) => row.movement === null));
});
test("session changes clear the previous championship snapshot", () => {
  const store = new LiveStore();
  store.accept({
    type: "snapshot",
    serverTime: Date.now(),
    data: { session: { session_key: 1 }, championship: base() },
  });
  store.accept({
    type: "snapshot",
    serverTime: Date.now(),
    data: { session: { session_key: 2 } },
  });
  assert.equal(store.state.championship, null);
});
