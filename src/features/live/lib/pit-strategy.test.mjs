import assert from "node:assert/strict";
import test from "node:test";
import { tyreSegments, pitTyres, pitSeconds } from "./pit-strategy.ts";
const driver = { driverNumber: 44, lap: 39, compound: "SOFT", tyreAge: 6 };
const stint = (number, startLap, endLap, ageAtStart = 0, compound = "SOFT") => ({ driverNumber: 44, stintNumber: number, startLap, endLap, ageAtStart, compound });
const pit = (lap, extra = {}) => ({ id: `pit-${lap}`, driverNumber: 44, lap, before: "SOFT", after: null, duration: 2.41, laneDuration: 25.8, timestamp: "2026-10-04T08:32:18Z", ...extra });
test("same-compound sets remain separate and share no laps", () => {
  const segments = tyreSegments(driver, [stint(3, 33, null), stint(1, 1, 18), stint(2, 19, 32)], [pit(32), pit(18)], true);
  assert.deepEqual(segments.map(({ start, end }) => [start, end]), [[1, 18], [19, 32], [33, 38]]);
  const info = pitTyres(pit(32), segments);
  assert.equal(info.ageBefore, 14);
  assert.equal(info.before, "SOFT");
  assert.equal(info.after, "SOFT");
  assert.equal(info.confirmedChange, true);
});
test("used sets include age before the session in removed tyre mileage", () => {
  const segments = tyreSegments(driver, [stint(1, 1, 18, 3), stint(2, 19, null, 2, "HARD")], [pit(18)], true);
  const info = pitTyres(pit(18), segments);
  assert.equal(info.ageBefore, 21);
  assert.equal(info.lapsBefore, 18);
  assert.equal(info.after, "HARD");
});
test("late stint updates cannot extend a set beyond a new pit or invent its compound", () => {
  const segments = tyreSegments(driver, [stint(1, 1, 50)], [pit(32)], true);
  assert.equal(segments[0].end, 32);
  assert.equal(segments[1].start, 33);
  assert.equal(segments[1].compound, null);
  assert.equal(segments[1].estimated, true);
  assert.equal(pitTyres(pit(32), segments).confirmedChange, false);
});
test("confirmed replacement supersedes an inferred boundary", () => {
  const segments = tyreSegments(driver, [stint(1, 1, 50), stint(2, 33, null, 2, "HARD")], [pit(32)], true);
  assert.equal(segments.length, 2);
  assert.equal(segments[1].estimated, false);
  assert.equal(segments[1].ageAtStart, 2);
});
test("drive-through and practice garage visits do not create inferred tyre sets", () => {
  assert.equal(tyreSegments(driver, [stint(1, 1, 50)], [pit(32, { duration: 0 })], true).length, 1);
  assert.equal(tyreSegments(driver, [stint(1, 1, 50)], [pit(32)], false).length, 1);
});
test("retired drivers do not gain laps as the rest of the field continues", () => {
  const segments = tyreSegments({ ...driver, lap: 12 }, [stint(1, 1, 50)], [], true);
  assert.equal(segments[0].end, 11);
});
test("a set just fitted is available in pit details before its first completed lap", () => {
  const segments = tyreSegments({ ...driver, lap: 19 }, [stint(1, 1, 18), stint(2, 19, null, 0, "HARD")], [pit(18)], true);
  assert.equal(pitTyres(pit(18), segments).after, "HARD");
  assert.equal(pitTyres(pit(18), segments).confirmedChange, true);
});
test("legacy snapshots support known pit compounds without pretending age is known", () => {
  const segments = tyreSegments(driver, [], [pit(18, { after: "HARD" }), pit(32, { before: "HARD", after: "SOFT" })], true);
  assert.deepEqual(segments.map((set) => set.compound), ["SOFT", "HARD", "SOFT"]);
  assert.equal(pitTyres(pit(32), segments).ageBefore, null);
  assert.deepEqual(tyreSegments({ ...driver, lap: 0 }, [], [], true), []);
});
test("unknown, zero and valid durations are unambiguous", () => {
  assert.equal(pitSeconds(null), "—");
  assert.equal(pitSeconds(NaN), "—");
  assert.equal(pitSeconds(0), "0,00 с");
  assert.equal(pitSeconds(2.41), "2,41 с");
  assert.equal(pitSeconds(25.8, 1), "25,8 с");
});
