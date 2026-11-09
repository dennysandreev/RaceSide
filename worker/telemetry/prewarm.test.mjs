import assert from "node:assert/strict";
import test from "node:test";
import { recentTelemetryTasks, localRacePaceTasks, enqueueMissingTelemetryTasks, refreshRecentTelemetry } from "./prewarm.mjs";
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

test("catch-up includes every ended session in the newest weekend and ignores cancellations", () => {
  const tasks = recentTelemetryTasks(2026, [
    session(1298, 11397, "2026-10-30T19:30:00Z"),
    session(1298, 11398, "2026-10-30T23:00:00Z"),
    session(1298, 11399, "2026-10-31T18:30:00Z"),
    { ...session(1298, 11400, "2026-10-31T19:00:00Z", "Qualifying"), is_cancelled: true },
  ], Date.parse("2026-10-31T20:00:00Z"));
  assert.deepEqual(tasks.filter((task) => task.kind === "catalog").map((task) => task.session), [11399, 11398, 11397]);
});

test("the periodic discovery queues Mexico practices without waiting for result polling or a page visit", async () => {
  const now = Date.parse("2026-10-31T10:00:00Z"), queued = [], calls = [];
  const rows = [
    { ...session(1298, 11397, "2026-10-30T19:30:00Z"), year: 2026 },
    { ...session(1298, 11398, "2026-10-30T23:00:00Z"), year: 2026 },
    { ...session(1298, 11399, "2026-10-31T18:30:00Z"), year: 2026 },
    { ...session(1297, 11396, "2026-10-25T22:00:00Z", "Race"), year: 2026 },
  ];
  const cached = new Set();
  const store = { get: async (key) => cached.has(key) ? [] : null,
    put: async (key) => cached.add(key),
    enqueue: async (task, key) => { queued.push(task); cached.add(key); } };
  const options = { store, now, season: 2026, fetchRows: async (...args) => {
    calls.push(args);
    return args[0] === "sessions" ? rows : [{ meeting_key: 1298, year: 2026, meeting_name: "Mexico City Grand Prix", date_start: "2026-10-30T18:30:00Z" }];
  } };
  const first = await refreshRecentTelemetry(options);
  assert.deepEqual(queued, [
    { kind: "seasons" },
    { kind: "catalog", session: 11398 }, { kind: "catalog", session: 11397 },
  ]);
  assert.equal(first.itemsProcessed, 3);
  assert.equal((await refreshRecentTelemetry(options)).itemsProcessed, 0);
  assert.deepEqual(calls, [["sessions", { year: 2026 }], ["meetings", { year: 2026 }],
    ["sessions", { year: 2026 }], ["meetings", { year: 2026 }]]);
});

test("a scheduler tick replaces a still-fresh session list when a new practice has become available", async () => {
  const now = Date.parse("2026-10-31T10:00:00Z"), rows = [
    { ...session(1298, 11397, "2026-10-30T19:30:00Z"), year: 2026 },
    { ...session(1298, 11398, "2026-10-30T23:00:00Z"), year: 2026 },
  ];
  const values = new Map([["sessions:1298", [{ id: 11397 }]]]), writes = [];
  const store = {
    get: async (key) => values.get(key) ?? { alreadyCached: true },
    put: async (key, value, ttl) => { values.set(key, value); writes.push({ key, ttl }); },
    enqueue: async () => { throw Error("unexpected queue write"); },
  };
  await refreshRecentTelemetry({ store, now, season: 2026, fetchRows: async (topic) =>
    topic === "sessions" ? rows : [{ meeting_key: 1298, date_start: "2026-10-30T18:30:00Z" }] });
  assert.deepEqual(values.get("sessions:1298").map((session) => session.id), [11397, 11398]);
  assert.ok(writes.every((write) => write.ttl === 5 * 60_000));
});

test("periodic discovery waits for source readiness and ignores cancelled, future and historical sessions", async () => {
  const now = Date.parse("2026-10-31T10:00:00Z");
  const store = { get: async () => { throw Error("unexpected cache read"); }, enqueue: async () => { throw Error("unexpected enqueue"); } };
  const result = await refreshRecentTelemetry({ store, season: 2026, now, fetchRows: async () => [
    { ...session(1298, 11397, "2026-10-31T09:29:00Z"), year: 2026 },
    { ...session(1298, 11398, "2026-10-31T08:00:00Z"), year: 2026, is_cancelled: true },
    { ...session(1298, 11399, "2026-10-31T18:30:00Z"), year: 2026 },
    { ...session(1297, 11396, "2026-10-25T22:00:00Z"), year: 2026 },
    { ...session(1298, 1, "2026-10-31T08:00:00Z"), year: 2025 },
    { ...session(1298, 2, "invalid"), year: 2026 },
  ] });
  assert.equal(result.itemsProcessed, 0);
  assert.equal(result.metadata.skipped, "no_recent_completed_sessions");
});

test("periodic discovery propagates source failure rather than reporting a successful empty refresh", async () => {
  await assert.rejects(() => refreshRecentTelemetry({ store: {}, season: 2026,
    fetchRows: async () => { throw Error("HTTP 429"); } }), /HTTP 429/);
  await assert.rejects(() => refreshRecentTelemetry({ store: {}, season: 2026,
    fetchRows: async () => ({ error: "unavailable" }) }), /PROVIDER_UNAVAILABLE/);
});
