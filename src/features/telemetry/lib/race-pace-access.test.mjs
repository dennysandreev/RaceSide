import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { configUsesDemoSessions } from "./demo-selection.ts";
import { parseConfig } from "../../../../worker/telemetry/core.mjs";
import { validateTask } from "../../../../worker/telemetry/service.mjs";
const source = readFileSync(
  new URL("../../../app/api/telemetry/[...path]/route.ts", import.meta.url),
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
function api({ user = { id: "user" }, full = true, task = null } = {}) {
  const calls = [];
  const store = {
    task: async () => task,
    get: async () => {
      calls.push("cache");
      return { points: [] };
    },
  };
  const exports = {};
  const require = (name) => {
    if (name.endsWith("/core.mjs")) return { parseConfig };
    if (name.includes("rate-limit"))
      return { consumeIpRateLimit: async () => ({ ok: true }) };
    if (name.endsWith("/auth")) return { getSessionUser: async () => user };
    if (name.endsWith("billing/access"))
      return {
        getSubscriptionAccess: async () => ({
          entitlements: { telemetry_full: full },
        }),
      };
    if (name.endsWith("billing/config"))
      return { billingFlags: { entitlementsEnforced: true } };
    if (name.endsWith("/flags"))
      return { telemetryFlags: { telemetryHub: true } };
    if (name.endsWith("demo-access"))
      return {
        configUsesDemoSessions,
        getTelemetryDemoScope: async () => ({
          sessions: [{ id: 1 }],
          meeting: { id: 1, season: 2025 },
        }),
      };
    if (name.endsWith("/server"))
      return {
        telemetryStore: () => store,
        presentRacePace: (data) => data,
        queryTelemetry: async (input) => {
          calls.push("query");
          const task = validateTask(input);
          return { status: 200, data: { session: task.session, points: [] } };
        },
        userError: () => ({
          code: "INVALID_REQUEST",
          error: "Некорректный запрос",
        }),
      };
    return {};
  };
  vm.runInNewContext(code, { exports, require, Response, URL, Set });
  return {
    calls,
    post: (route, body) => exports.POST(new Request(`http://localhost/api/telemetry/${route}`, { method: "POST", body: JSON.stringify(body) }), {
      params: Promise.resolve({ path: route.split("/") }),
    }),
    get: (route) =>
      exports.GET(new Request(`http://localhost/api/telemetry/${route}`), {
        params: Promise.resolve({ path: route.split("?")[0].split("/") }),
      }),
  };
}
test("guest cannot request race pace", async () => {
  const handler = api({ user: null });
  const response = await handler.get("race-pace?session=1");
  assert.equal(response.status, 401);
  assert.deepEqual(handler.calls, []);
});
test("free account can request all-driver pace in its demo session only", async () => {
  const handler = api({ full: false });
  const response = await handler.get("race-pace?session=1");
  assert.equal(response.status, 200);
  assert.deepEqual(handler.calls, ["query"]);
  handler.calls.length = 0;
  assert.equal((await handler.get("race-pace?session=2")).status, 403);
  assert.deepEqual(handler.calls, []);
});
test("knowing another session task id cannot bypass demo", async () => {
  const handler = api({
    full: false,
    task: {
      task: { kind: "race-pace", session: 2 },
      status: "ready",
      result_key: "pace",
    },
  });
  const response = await handler.get(
    "tasks/00000000-0000-0000-0000-000000000001",
  );
  assert.equal(response.status, 403);
  assert.deepEqual(handler.calls, []);
});
test("Plus receives data with no browser caching; invalid sessions are rejected", async () => {
  const handler = api();
  const response = await handler.get("race-pace?session=1");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).data.session, 1);
  assert.equal((await handler.get("race-pace?session=oops")).status, 422);
});

test("ready pace tasks in the demo session remain accessible", async () => {
  const handler = api({ full: false, task: { task: { kind: "race-pace", session: 1 }, status: "ready", result_key: "pace" } });
  const response = await handler.get("tasks/00000000-0000-0000-0000-000000000001");
  assert.equal(response.status, 200);
  assert.deepEqual(handler.calls, ["cache"]);
});
test("demo API allows arbitrary laps in one session and blocks mixed or weekend requests before fetching", async () => {
  const handler = api({ full: false });
  const config = { mode: "lap", traces: [{ session: 1, driver: 1, lap: 3 }, { session: 1, driver: 44, lap: 20 }], reference: 0 };
  assert.equal((await handler.post("compare", config)).status, 200);
  handler.calls.length = 0;
  for (const blocked of [
    { ...config, traces: [config.traces[0], { ...config.traces[1], session: 2 }] },
    { ...config, mode: "evolution", window: "weekend" },
  ]) {
    assert.equal((await handler.post("compare", blocked)).status, 403);
    assert.equal((await handler.post("permalink", { config: blocked })).status, 403);
  }
  for (const route of ["catalog?session=2", "setup-catalog?session=2", "laps?session=2", "drivers?session=2", "lap/2:1:3"]) {
    assert.equal((await handler.get(route)).status, 403);
  }
  assert.deepEqual(handler.calls, []);
});
