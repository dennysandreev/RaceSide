import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as selection from "./demo-selection.ts";

const source = readFileSync(new URL("./demo-access.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const now = Date.parse("2026-04-20T12:00:00Z");
const meetings = [1, 2, 3].map((id) => ({
  id, season: 2026, start: `2026-04-0${id}T12:00:00Z`,
}));
function demo(sessions) {
  const queued = [];
  const cache = { seasons: [2026], "meetings:2026": meetings, "sessions:1": sessions };
  const exports = {};
  const require = (name) => {
    if (name.endsWith("demo-selection")) return {
      ...selection,
      selectTelemetryDemoCandidates: (seasons) => selection.selectTelemetryDemoCandidates(seasons, now),
      selectTelemetryDemoSession: (sessions) => selection.selectTelemetryDemoSession(sessions, now),
    };
    if (name.endsWith("/server")) return {
      resultKey: () => "seasons",
      telemetryStore: () => ({
        get: async (key) => cache[key] ?? null,
        enqueue: async (task) => queued.push(task),
      }),
    };
    if (name.endsWith("server-ttl-cache")) return { withServerTtlCache: (_, ttl, load) => load() };
    return {};
  };
  vm.runInNewContext(code, { exports, require });
  return { load: exports.getTelemetryDemoScope, queued };
}
test("server demo scope exposes one completed main race from the N−2 meeting", async () => {
  const loader = demo([
    { id: 11, name: "Practice 1", end: "2026-04-01T12:00:00Z" },
    { id: 12, name: "Qualifying", end: "2026-04-01T14:00:00Z" },
    { id: 13, name: "Sprint", end: "2026-04-02T12:00:00Z" },
    { id: 14, name: "Race", end: "2026-04-03T14:00:00Z" },
  ]);
  const scope = await loader.load();
  assert.equal(scope.meeting.id, 1);
  assert.deepEqual(Array.from(scope.sessions, (session) => session.id), [14]);
  assert.deepEqual(loader.queued, []);
});
test("missing session cache prepares the catalog without exposing other session types", async () => {
  const loader = demo(null);
  assert.equal(await loader.load(), null);
  assert.equal(loader.queued.length, 1);
  assert.equal(loader.queued[0].kind, "sessions");
  assert.equal(loader.queued[0].meeting, 1);
});
test("an unavailable or unfinished race never falls back to qualifying or sprint", async () => {
  for (const sessions of [
    [{ id: 12, name: "Qualifying", end: "2026-04-01T14:00:00Z" }],
    [{ id: 13, name: "Sprint", end: "2026-04-02T12:00:00Z" }],
    [{ id: 14, name: "Race", end: "2026-04-20T14:00:00Z" }],
  ]) assert.equal(await demo(sessions).load(), null);
});
