import assert from "node:assert/strict";
import test from "node:test";

import { formatSessionName, splitSessionStart } from "./session-display.ts";

test("session start keeps the existing local date and separates only the trailing time", () => {
  assert.deepEqual(splitSessionStart("пт, 9 окт., 11:30"), { date: "пт, 9 окт.", time: "11:30" });
  assert.deepEqual(splitSessionStart("  сб, 10 окт., 16:00  "), { date: "сб, 10 окт.", time: "16:00" });
  assert.deepEqual(splitSessionStart("11:30"), { date: "", time: "11:30" });
});

test("a missing start time does not turn the month or placeholder into a time", () => {
  assert.deepEqual(splitSessionStart("пт, 9 окт."), { date: "пт, 9 окт.", time: null });
  assert.deepEqual(splitSessionStart("Расписание уточняется"), { date: "Расписание уточняется", time: null });
  assert.deepEqual(splitSessionStart(""), { date: "", time: null });
});

test("practice names remain compact and sprint qualifying is preserved", () => {
  assert.equal(formatSessionName("Free Practice 1"), "Практика 1");
  assert.equal(formatSessionName("Спринт-квалификация"), "Спринт-квалификация");
});
