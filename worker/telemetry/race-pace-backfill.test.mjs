import test from "node:test";
import assert from "node:assert/strict";
import {
  completedSeasonRaces,
  backfillRacePace,
} from "./race-pace-backfill.mjs";
import { TelemetryService, resultKey } from "./service.mjs";
import { recentTelemetryTasks } from "./prewarm.mjs";

const now = Date.parse("2026-10-03T12:00:00Z");
const race = (id, extra = {}) => ({
  session_key: id,
  meeting_key: id + 100,
  year: 2026,
  session_name: "Race",
  date_end: "2026-09-26T13:00:00Z",
  ...extra,
});

test("selects only completed main races of the season, excludes duplicates, cancellations and preparation delay", () => {
  const sessions = [
    race(1),
    race(1),
    race(2, { is_cancelled: true }),
    race(3, { session_name: "Sprint" }),
    race(4, { year: 2025 }),
    race(5, { date_end: "2026-10-04T13:00:00Z" }),
    race(6, { date_end: "invalid" }),
    race(7, { date_end: "2026-10-03T11:45:00Z" }),
    race(-1),
    race(8, { meeting_key: null }),
  ];
  assert.deepEqual(
    completedSeasonRaces(2026, sessions, now).map((s) => s.session_key),
    [1],
  );
  const tasks = recentTelemetryTasks(2026, sessions, now).filter(
    (t) => t.kind === "race-pace",
  );
  assert.deepEqual(tasks, [{ kind: "race-pace", session: 1 }]);
});

test("backfill stores the normal shared dataset and setup catalog, continues on errors and is idempotent", async () => {
  const cache = new Map(),
    writes = [],
    progress = [];
  let catalogCalls = 0;
  const store = {
    get: async (key) => cache.get(key),
    put: async (key, data, ttl) => {
      cache.set(key, data);
      writes.push({ key, ttl });
    },
  };
  const service = new TelemetryService({
    store,
    provider: {
      getCatalog: async (id) => {
        catalogCalls++;
        if (id === 2) throw new Error("PROVIDER_UNAVAILABLE");
        return {
          session: {
            id,
            name: "Race",
            type: "Race",
            end: "2026-09-26T13:00:00Z",
          },
          drivers: [{ number: 4 }],
          laps: [
            {
              number: 2,
              driverNumber: 4,
              time: 80,
              complete: true,
              validityKnown: true,
              status: ["GREEN"],
              compound: "MEDIUM",
              stint: 1,
              tyreAge: 1,
            },
          ],
          raceControl: [],
        };
      },
      getTelemetry: () => {
        throw new Error("Must not fetch car data");
      },
      getLocations: () => {
        throw new Error("Must not fetch locations");
      },
    },
  });
  const input = {
    season: 2026,
    sessions: [race(1), race(2), race(3)],
    service,
    onProgress: (entry) => progress.push(entry),
  };
  const first = await backfillRacePace(input);
  assert.equal(first.races.length, 2);
  assert.deepEqual(first.errors, [
    { session: 2, error: "PROVIDER_UNAVAILABLE" },
  ]);
  assert.equal(progress.length, 3);
  assert.ok(cache.has(resultKey({ kind: "catalog", session: 1 })));
  assert.equal(
    writes.find((w) => w.key === resultKey({ kind: "race-pace", session: 1 }))
      .ttl,
    null,
  );
  const oldSize = cache.size,
    oldCalls = catalogCalls;
  const second = await backfillRacePace({
    ...input,
    sessions: [race(1), race(3)],
  });
  assert.ok(second.races.every((r) => r.cached));
  assert.equal(cache.size, oldSize);
  assert.equal(catalogCalls, oldCalls);
});
