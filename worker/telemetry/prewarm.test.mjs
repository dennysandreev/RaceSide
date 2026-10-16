import assert from "node:assert/strict";
import test from "node:test";
import { recentTelemetryTasks, localRacePaceTasks, enqueueMissingTelemetryTasks } from "./prewarm.mjs";
import { resultKey } from "./service.mjs";

const session = (meeting, id, date, type = "Practice") => ({
  meeting_key: meeting,
  session_key: id,
  date_end: date,
  session_type: type,
});

test("result polling queues ended main races after the source delay, including already-classified races", async () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  const race = (id, extra = {}) => ({ openf1_session_key: id, session_type: "race", end_at: "2026-10-04T10:00:00Z", ...extra });
  const tasks = localRacePaceTasks([race(1), race(1), race("2"), race(3, { session_type: "sprint" }),
    race(4, { end_at: "2026-10-04T11:45:00Z" }), race(5, { end_at: "2026-10-04T13:00:00Z" }),
    race(6, { status: "cancelled" }), race(7, { end_at: "invalid" }), race(null), race(-1)], now);
  assert.deepEqual(tasks, [{ kind: "race-pace", session: 1 }, { kind: "race-pace", session: 2 }]);
  const enqueued = [], cached = new Set([resultKey(tasks[0])]);
  const store = { get: async (key) => cached.has(key) ? { ready: true } : null, enqueue: async (task) => enqueued.push(task) };
  await enqueueMissingTelemetryTasks(store, tasks);
  // If a first preparation fails, the next scheduled poll asks the normal queue
  // to retry; after a result exists, subsequent polls stop requesting work.
  await enqueueMissingTelemetryTasks(store, tasks);
  cached.add(resultKey(tasks[1]));
  cached.add(resultKey({ kind: "report-timing", session: 1 }));
  cached.add(resultKey({ kind: "report-timing", session: 2 }));
  await enqueueMissingTelemetryTasks(store, tasks);
  const missing = [{ kind: "report-timing", session: 1 }, tasks[1], { kind: "report-timing", session: 2 }];
  assert.deepEqual(enqueued, [...missing, ...missing]);
});

test("report timing is retried independently when its short-lived partial cache expires", async () => {
  const pace = { kind: "race-pace", session: 1 };
  const timing = { kind: "report-timing", session: 1 };
  const cached = new Set([resultKey(pace)]), enqueued = [];
  const store = { get: async (key) => cached.has(key) ? {} : null, enqueue: async (task) => enqueued.push(task) };
  await enqueueMissingTelemetryTasks(store, [pace, timing]);
  cached.add(resultKey(timing));
  await enqueueMissingTelemetryTasks(store, [pace]);
  cached.delete(resultKey(timing));
  await enqueueMissingTelemetryTasks(store, [pace]);
  assert.deepEqual(enqueued, [timing, timing]);
});

test("warms recent sessions, their qualifying session and previous meetings", () => {
  const tasks = recentTelemetryTasks(2026, [
    session(10, 101, "2026-09-19T10:00:00Z", "Qualifying"),
    session(10, 102, "2026-09-20T10:00:00Z"),
    session(10, 103, "2026-09-20T12:00:00Z", "Race"),
    session(9, 91, "2026-09-13T12:00:00Z", "Qualifying"),
    session(8, 81, "2026-09-06T12:00:00Z", "Qualifying"),
    session(7, 71, "2026-08-30T12:00:00Z"),
    session(11, 111, "2026-09-29T12:00:00Z"),
  ], Date.parse("2026-09-21T12:00:00Z"));

  assert.deepEqual(tasks, [
    { kind: "seasons" },
    { kind: "meetings", season: 2026 },
    { kind: "sessions", meeting: 10 },
    { kind: "catalog", session: 103 },
    { kind: "catalog", session: 102 },
    { kind: "catalog", session: 101 },
    { kind: "sessions", meeting: 9 },
    { kind: "catalog", session: 91 },
    { kind: "sessions", meeting: 8 },
    { kind: "catalog", session: 81 },
  ]);
});

test("does not enqueue catalog tasks already in cache", async () => {
  const enqueued = [];
  const cached = new Set([resultKey({ kind: "meetings", season: 2026 })]);
  const store = {
    get: async (key) => (cached.has(key) ? { ready: true } : null),
    enqueue: async (task) => enqueued.push(task),
  };
  const count = await enqueueMissingTelemetryTasks(store, [
    { kind: "seasons" },
    { kind: "meetings", season: 2026 },
  ]);
  assert.equal(count, 1);
  assert.deepEqual(enqueued, [{ kind: "seasons" }]);
});
