import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LiveState } from "./state.mjs";
import { hydrationMessages } from "./normalize.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/singapore-sq1-2026.json", import.meta.url), "utf8"));
const eliminated = (live, phase) => Object.values(live.state.drivers)
  .filter((driver) => driver.eliminatedIn === phase)
  .map((driver) => driver.acronym).sort();
const sq1 = () => {
  const live = new LiveState();
  live.setSession(fixture.session);
  for (const { topic, row } of fixture.events) live.apply(topic, row);
  return live;
};
const control = (message, phase, date) => ({
  session_key: fixture.session.session_key, message, qualifying_phase: phase, date,
});

test("Singapore SQ1 includes laps completed after the chequered flag and corrects VER elimination", () => {
  const live = sq1();
  assert.equal(live.state.phase, "SQ1");
  assert.equal(live.state.drivers[3].bestLap, 93.477);
  assert.equal(live.state.drivers[3].eliminatedIn, null);
  assert.deepEqual(eliminated(live, "SQ1"), ["ALB", "BOT", "LIN", "PER", "SAI", "STR"]);
});

test("late SQ1 lap during SQ2 updates SQ1 without replacing the SQ2 best", () => {
  const live = sq1();
  live.apply("race_control", control("SESSION STARTED", 2, "2026-10-09T14:05:00Z"));
  live.apply("laps", {
    session_key: fixture.session.session_key, driver_number: 3, lap_number: 7,
    date_start: "2026-10-09T14:06:00Z", date: "2026-10-09T14:07:34Z", lap_duration: 94,
  });
  live.apply("laps", {
    session_key: fixture.session.session_key, driver_number: 3, lap_number: 5,
    date_start: "2026-10-09T12:51:24.157Z", date: "2026-10-09T12:52:57.634Z", lap_duration: 93,
  });
  assert.equal(live.state.drivers[3].bestByPhase.SQ1, 93);
  assert.equal(live.state.drivers[3].bestByPhase.SQ2, 94);
  assert.equal(live.state.drivers[3].bestLap, 94);
  assert.equal(live.state.drivers[3].lapHistory.find((lap) => lap.lap === 5).phase, "SQ1");
  assert.equal(live.state.drivers[3].eliminatedIn, null);
});

test("a deleted then reinstated SQ1 lap revises elimination during SQ2", () => {
  const live = sq1();
  live.apply("race_control", control("SESSION STARTED", 2, "2026-10-09T14:05:00Z"));
  live.apply("race_control", control("CAR 3 (VER) TIME 1:33.477 DELETED - TRACK LIMITS", null, "2026-10-09T14:06:00Z"));
  assert.equal(live.state.drivers[3].eliminatedIn, "SQ1");
  assert.equal(live.state.drivers[41].eliminatedIn, null);
  live.apply("race_control", control("CAR 3 (VER) TIME 1:33.477 REINSTATED", null, "2026-10-09T14:07:00Z"));
  assert.equal(live.state.drivers[3].eliminatedIn, null);
  assert.equal(live.state.drivers[41].eliminatedIn, "SQ1");
});

test("a late message about SQ1 never moves the active segment backwards", () => {
  const live = sq1();
  live.apply("race_control", control("SESSION STARTED", 2, "2026-10-09T14:05:00Z"));
  live.apply("race_control", control("CAR 3 (VER) NOTED - SQ1 INCIDENT", 1, "2026-10-09T14:06:00Z"));
  assert.equal(live.state.phase, "SQ2");
  assert.equal(live.state.phaseStartedAt, "2026-10-09T14:05:00Z");
});

test("REST hydration rebuilds qualifying instead of preserving an incorrect saved elimination", () => {
  const live = sq1();
  live.state.drivers[3].eliminatedIn = "SQ1";
  live.state.phase = "SQ2";
  live.resetQualifying();
  const streams = new Map();
  for (const { topic, row } of fixture.events) {
    if (!streams.has(topic)) streams.set(topic, []);
    streams.get(topic).push(row);
  }
  for (const [topic, row] of hydrationMessages(streams, fixture.session)) live.apply(topic, row);
  assert.equal(live.state.phase, "SQ1");
  assert.equal(live.state.drivers[3].eliminatedIn, null);
  assert.deepEqual(eliminated(live, "SQ1"), ["ALB", "BOT", "LIN", "PER", "SAI", "STR"]);
});

test("qualifying session results reconcile every segment without mixing times", () => {
  const live = sq1();
  live.apply("race_control", control("SESSION STARTED", 2, "2026-10-09T14:05:00Z"));
  live.apply("session_result", {
    session_key: fixture.session.session_key, driver_number: 3,
    date: "2026-10-09T14:06:00Z", duration: [93.1, 94.2, null], position: 1,
  });
  assert.equal(live.state.drivers[3].bestByPhase.SQ1, 93.1);
  assert.equal(live.state.drivers[3].bestByPhase.SQ2, 94.2);
  assert.equal(live.state.drivers[3].bestLap, 94.2);
  assert.equal(live.state.drivers[3].eliminatedIn, null);
});

test("SQ2 and SQ3 preserve SQ1 eliminations and compare only SQ2 times", () => {
  const live = sq1();
  live.apply("race_control", control("SESSION STARTED", 2, "2026-10-09T14:05:00Z"));
  const advancing = Object.values(live.state.drivers).filter((driver) => !driver.eliminatedIn);
  for (const driver of advancing) live.apply("laps", {
    session_key: fixture.session.session_key, driver_number: driver.driverNumber,
    lap_number: 20, date_start: "2026-10-09T14:06:00Z",
    date: "2026-10-09T14:08:00Z", lap_duration: 90 + driver.driverNumber / 100,
  });
  live.apply("race_control", control("SESSION FINISHED", 2, "2026-10-09T14:15:00Z"));
  const q2Out = advancing.sort((a, b) => a.driverNumber - b.driverNumber)
    .slice(10).map((driver) => driver.acronym).sort();
  assert.deepEqual(eliminated(live, "SQ2"), q2Out);
  live.apply("race_control", control("SESSION STARTED", 3, "2026-10-09T14:20:00Z"));
  assert.deepEqual(eliminated(live, "SQ1"), ["ALB", "BOT", "LIN", "PER", "SAI", "STR"]);
  assert.deepEqual(eliminated(live, "SQ2"), q2Out);
  assert.equal(live.state.drivers[3].bestLap, null);
  for (const driver of Object.values(live.state.drivers).filter((d) => d.eliminatedIn === "SQ2"))
    assert.equal(driver.bestLap, driver.bestByPhase.SQ2);
});

test("a segment finish with no timing data does not assign arbitrary eliminations", () => {
  const live = new LiveState();
  live.setSession(fixture.session);
  for (const { topic, row } of fixture.events.filter((event) => event.topic === "drivers")) live.apply(topic, row);
  live.apply("race_control", control("SESSION STARTED", 1, "2026-10-09T14:05:00Z"));
  live.apply("race_control", control("SESSION FINISHED", 1, "2026-10-09T14:17:00Z"));
  assert.deepEqual(eliminated(live, "SQ1"), []);
});

test("the chequered flag waits for a flying lap that was already in progress", () => {
  const live = new LiveState();
  live.setSession(fixture.session);
  let atFlag = false;
  for (const { topic, row } of fixture.events) {
    if (topic === "race_control" && row.message === "SESSION FINISHED") {
      live.apply("laps", {
        session_key: fixture.session.session_key, driver_number: 3, lap_number: 5,
        date_start: "2026-10-09T12:51:24.157Z", date: "2026-10-09T12:51:24.157Z",
        lap_duration: null, is_pit_out_lap: false,
      });
      live.apply(topic, row);
      assert.equal(live.state.drivers[3].eliminatedIn, null);
      assert.deepEqual(eliminated(live, "SQ1"), []);
      atFlag = true;
    } else live.apply(topic, row);
  }
  assert.equal(atFlag, true);
  assert.equal(live.state.drivers[3].eliminatedIn, null);
  assert.deepEqual(eliminated(live, "SQ1"), ["ALB", "BOT", "LIN", "PER", "SAI", "STR"]);
});
