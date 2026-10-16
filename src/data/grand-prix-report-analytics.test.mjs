import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as helpers from "../lib/grand-prix-report.ts";

const report = {
  id: "report", season: 2026, round: 17, raceStatistics: { laps: 2 },
  results: [{ driverNumber: 1, driver: "Driver One", team: "Team", position: 1, laps: 2, tyres: [] }],
};
const replay = (id, name) => ({
  id, source_session_key: id === "race" ? 100 : 200,
  source_session_name: name, status: "ready",
  "races.season_year": 2026, "races.round": 17,
  lapTimings: [], positionTimings: [], intervalTimings: [],
});

const pace = {
  session: { id: 100, season: 2026, name: "Race" }, totalLaps: 2,
  drivers: [{ number: 1, name: "Driver One" }], stints: [],
  points: [{ driver: 1, lap: 1, time: 100, trend: 100, clean: true }],
};
const timing = {
  session: pace.session, complete: true,
  lapSamples: [{ driverNumber: 1, lapNumber: 1, offsetMs: 100_000, position: 1, gapToLeader: "0" }],
};

function setup(replays, events = [], sessionKey = null) {
  const calls = [];
  const saved = new Map();
  let now = 0, concurrent = 0, maxConcurrent = 0, refreshGate = null;
  class Query {
    filters = []; selection = ""; options = {}; first = 0; last = Infinity;
    constructor(table) { this.table = table; }
    select(selection, options = {}) { this.selection = selection; this.options = options; return this; }
    eq(key, value) { this.filters.push([key, value]); return this; }
    in(key, values) { this.filters.push([key, values]); return this; }
    gt() { return this; }
    order() { return this; }
    limit() { return this; }
    range(first, last) { this.first = first; this.last = last; return this; }
    maybeSingle() { return this; }
    async result() {
      calls.push({ table: this.table, selection: this.selection, filters: this.filters });
      if (this.table === "race_replay_sessions") {
        if (refreshGate) await refreshGate;
        return { data: replays.find((row) => this.filters.every(([key, value]) => row[key] === value)) ?? null, error: null };
      }
      if (this.table === "sessions") return { data: sessionKey ? { openf1_session_key: sessionKey } : null, error: null };
      if (this.table === "telemetry_cache") {
        const key = this.filters.find(([field]) => field === "key")?.[1];
        return { data: saved.has(key) ? { payload: saved.get(key) } : null, error: null };
      }
      if (this.table === "race_replay_events") {
        if (this.options.head) return { data: null, count: 2_001, error: null };
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setImmediate(resolve));
        concurrent--;
        const rows = events.filter((row) => this.filters.every(([key, value]) =>
          Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
        return { data: rows.slice(this.first, this.last + 1), count: this.options.count ? rows.length : null, error: null };
      }
      return { data: [], error: null };
    }
    then(resolve, reject) { return this.result().then(resolve, reject); }
  }
  const db = { from: (table) => new Query(table) };
  const context = vm.createContext({ exports: {}, require: () => ({}), Date: { now: () => now } });
  const transpile = (file) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInContext(transpile("../lib/server-ttl-cache.ts"), context);
  const cache = context.exports;
  context.exports = {};
  context.require = (name) => ({
    "server-only": {},
    "@/lib/supabase/server": { createSupabaseAdminClient: () => db },
    "@/lib/server-ttl-cache": cache,
    "@/lib/grand-prix-report": helpers,
    "@/features/telemetry/lib/server": { resultKey: (task) => `${task.kind}:${task.session}` },
    "@/lib/season-navigation": { CURRENT_F1_SEASON: 2026 },
  })[name];
  vm.runInContext(transpile("./grand-prix-report-analytics.ts"), context);
  return {
    get: context.exports.getGrandPrixReportAnalytics,
    calls,
    saved,
    maxConcurrent: () => maxConcurrent,
    advance: (ms) => { now += ms; },
    holdRefresh: () => {
      let release;
      refreshGate = new Promise((resolve) => { release = resolve; });
      return () => { release(); refreshGate = null; };
    },
  };
}

test("a ready qualifying replay never supplies a race report or loads its map samples", async () => {
  const { get, calls } = setup([replay("qualifying", "Qualifying")]);
  const analytics = await get(report);
  assert.equal(calls.filter((call) => call.table === "race_replay_events").length, 0);
  assert.equal(calls.filter((call) => call.table === "telemetry_cache").length, 0);
  assert.equal(analytics.drivers[0].positions.length, 0);
});

test("the race is used even when qualifying was prepared more recently", async () => {
  const race = replay("race", "Race");
  race.lapTimings = [{ driverNumber: 1, lapNumber: 1, startOffsetMs: 0, durationMs: 100_000 }];
  race.positionTimings = [{ driverNumber: 1, offsetMs: 0, position: 1 }];
  race.intervalTimings = [{ driverNumber: 1, offsetMs: 100_000, gapToLeader: "0" }];
  const { get, calls } = setup([replay("qualifying", "Qualifying"), race]);
  const analytics = await get(report);
  assert.deepEqual(analytics.drivers[0].positions, [{ lap: 1, value: 1 }]);
  assert.deepEqual(analytics.drivers[0].gaps, [{ lap: 1, value: 0 }]);
  assert.equal(calls.filter((call) => call.table === "race_replay_events").length, 0);
});

test("compact timing pages load concurrently, retain all pages and do not read map geometry", async () => {
  const rows = [
    { event_type: "lap_timing", payload: [1, 1, 0, 100_000] },
    { event_type: "position_timing", payload: { driverNumber: 1, offsetMs: 0, position: 1 } },
    ...Array.from({ length: 10_248 }, (_, index) => ({ event_type: "interval_timing", payload: { driverNumber: 1, offsetMs: index * 100, gapToLeader: "0" } })),
  ].map((row) => ({ ...row, replay_session_id: "race" }));
  const { get, calls, maxConcurrent } = setup([replay("race", "Race")], rows);
  const analytics = await get(report);
  assert.deepEqual(analytics.drivers[0].positions, [{ lap: 1, value: 1 }]);
  assert.deepEqual(analytics.drivers[0].gaps, [{ lap: 1, value: 0 }]);
  assert.ok(maxConcurrent() > 1, "timing pages should not form a sequential waterfall");
  assert.ok(maxConcurrent() <= 4, "concurrency remains bounded");
  assert.ok(calls.filter((call) => call.table === "race_replay_events").every((call) => call.selection === "event_type,payload"));
});

test("expired analytics remain available while one background refresh runs", async () => {
  const { get, calls, advance, holdRefresh, saved } = setup([], [], 100);
  saved.set("race-pace:100", pace);
  saved.set("report-timing:100", timing);
  const first = await get(report);
  advance(5 * 60_000 + 1);
  const release = holdRefresh();
  try {
    const next = get(report);
    const result = await Promise.race([next, new Promise((resolve) => setImmediate(() => resolve("blocked")))]);
    assert.equal(result, first);
    assert.equal(await get(report), first);
    assert.equal(calls.filter((call) => call.table === "race_replay_sessions").length, 2);
  } finally {
    release();
  }
});

test("stored race timing and pace are available while Replay is still preparing", async () => {
  const race = { ...replay("race", "Race"), status: "preparing" };
  const { get, calls, saved } = setup([replay("qualifying", "Qualifying"), race], [], 100);
  saved.set("race-pace:100", pace);
  saved.set("report-timing:100", timing);
  const analytics = await get(report);
  assert.deepEqual(analytics.drivers[0].positions, [{ lap: 1, value: 1 }]);
  assert.deepEqual(analytics.drivers[0].gaps, [{ lap: 1, value: 0 }]);
  assert.equal(analytics.drivers[0].pace[0].value, 100);
  assert.equal(analytics.timingPending, false);
  assert.equal(calls.filter((call) => call.table === "race_replay_events").length, 0);
});

test("empty and partial timing do not freeze when the late dataset arrives", async () => {
  const { get, saved } = setup([], [], 100);
  assert.equal((await get(report)).timingPending, true);
  saved.set("race-pace:100", pace);
  saved.set("report-timing:100", { ...timing, complete: false,
    lapSamples: [{ ...timing.lapSamples[0], gapToLeader: null }] });
  const partial = await get(report);
  assert.equal(partial.timingPending, true);
  assert.equal(partial.drivers[0].pace[0].value, 100);
  saved.set("report-timing:100", timing);
  const complete = await get(report);
  assert.equal(complete.timingPending, false);
  assert.deepEqual(complete.drivers[0].gaps, [{ lap: 1, value: 0 }]);
});

test("saved timing is never mixed with another session, season or sprint", async () => {
  const { get, saved } = setup([], [], 100);
  for (const session of [
    { ...pace.session, id: 200 }, { ...pace.session, season: 2025 },
    { ...pace.session, name: "Sprint" },
  ]) {
    saved.set("race-pace:100", { ...pace, session });
    saved.set("report-timing:100", { ...timing, session });
    const analytics = await get(report);
    assert.equal(analytics.timingPending, true);
    assert.equal(analytics.drivers[0].positions.length, 0);
    assert.ok(analytics.drivers[0].pace.every((point) => point.value === null));
  }
});

test("partial compact timing does not hide a complete ready Race fallback", async () => {
  const race = replay("race", "Race");
  race.lapTimings = [{ driverNumber: 1, lapNumber: 1, startOffsetMs: 0, durationMs: 100_000 }];
  race.positionTimings = [{ driverNumber: 1, offsetMs: 0, position: 1 }];
  race.intervalTimings = [{ driverNumber: 1, offsetMs: 100_000, gapToLeader: "0" }];
  const { get, saved } = setup([race], [], 100);
  saved.set("race-pace:100", pace);
  saved.set("report-timing:100", { ...timing, complete: false,
    lapSamples: [{ ...timing.lapSamples[0], gapToLeader: null }] });
  const analytics = await get(report);
  assert.equal(analytics.timingPending, false);
  assert.deepEqual(analytics.drivers[0].gaps, [{ lap: 1, value: 0 }]);
});
