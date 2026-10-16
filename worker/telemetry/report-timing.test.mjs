import assert from "node:assert/strict";
import test from "node:test";
import { TelemetryService, resultKey } from "./service.mjs";
import { reportTimingTtl } from "./report-timing.mjs";

const start = "2026-10-11T12:00:00Z";
const catalog = {
  session: { id: 11388, season: 2026, name: "Race", type: "Race", start, end: "2026-10-11T14:00:00Z" },
  drivers: [{ number: 3 }],
  laps: [1, 2].map((number) => ({ driverNumber: 3, number, start: `2026-10-11T12:0${number - 1}:00Z`, time: 60 })),
};

function setup({ positions = [], intervals = [], data = catalog } = {}) {
  const cache = new Map(), calls = [], writes = [];
  const service = new TelemetryService({
    store: {
      get: async (key) => cache.get(key) ?? null,
      put: async (key, payload, ttl) => { cache.set(key, payload); writes.push({ key, payload, ttl }); },
    },
    provider: {
      getCatalog: async () => data,
      fetchRows: async (endpoint, params) => {
        calls.push([endpoint, params]);
        if (endpoint === "position") return positions;
        if (endpoint === "intervals") return intervals;
        throw new Error("High-frequency data must not be fetched");
      },
    },
  });
  return { service, cache, calls, writes };
}

test("report timing uses actual lap boundaries and never needs Replay geometry", async () => {
  const { service, calls, writes } = setup({
    positions: [
      { driver_number: 3, date: start, position: 2 },
      { driver_number: 3, date: "2026-10-11T12:01:30", position: 1 },
    ],
    intervals: [
      { driver_number: 3, date: "2026-10-11T12:00:55Z", gap_to_leader: 2.5 },
      { driver_number: 3, date: "2026-10-11T12:01:55Z", gap_to_leader: "1 LAP" },
    ],
  });
  const task = { kind: "report-timing", session: 11388 };
  const data = await service.prepare(task);
  assert.deepEqual(data.lapSamples.map((row) => [row.lapNumber, row.position, row.gapToLeader]), [[1, 2, "2.5"], [2, 1, "1 LAP"]]);
  assert.equal(data.complete, true);
  assert.deepEqual(calls.map(([endpoint]) => endpoint).sort(), ["intervals", "position"]);
  const write = writes.find((entry) => entry.key === resultKey(task));
  assert.ok(write.ttl === null || write.ttl >= 15 * 60_000);
  assert.equal(await service.prepare(task), data);
  assert.equal(calls.length, 2);
});

test("late timing remains retryable; missing gaps and positions are never fabricated", async () => {
  const { service, writes } = setup({ positions: [{ driver_number: 3, date: start, position: 1 }] });
  const data = await service.prepare({ kind: "report-timing", session: 11388 });
  assert.equal(data.complete, false);
  assert.equal(data.lapSamples[0].position, 1);
  assert.equal(data.lapSamples[0].gapToLeader, null);
  assert.equal(writes.at(-1).ttl, 60_000);
});

test("stale intervals and laps without a measured duration stay unknown", async () => {
  const { service } = setup({
    data: { ...catalog, laps: [...catalog.laps, { driverNumber: 3, number: 3, start: "2026-10-11T12:02:00Z", time: null }] },
    positions: [{ driver_number: 3, date: start, position: 1 }],
    intervals: [{ driver_number: 3, date: start, gap_to_leader: 0 }],
  });
  const data = await service.prepare({ kind: "report-timing", session: 11388 });
  assert.equal(data.lapSamples.length, 2);
  assert.equal(data.lapSamples[0].gapToLeader, null);
  assert.equal(data.complete, false);
});

test("qualifying and sprint cannot become report timing", async () => {
  for (const name of ["Qualifying", "Sprint"]) {
    const { service, calls } = setup({ data: { ...catalog, session: { ...catalog.session, name } } });
    await assert.rejects(service.prepare({ kind: "report-timing", session: 11388 }), /REPORT_TIMING_ONLY/);
    assert.equal(calls.length, 0);
  }
});

test("a feed for only part of the field stays retryable", async () => {
  const { service, writes } = setup({
    data: { ...catalog, laps: [...catalog.laps, { ...catalog.laps[0], driverNumber: 16 }] },
    positions: [{ driver_number: 3, date: start, position: 1 }],
    intervals: [{ driver_number: 3, date: "2026-10-11T12:00:55Z", gap_to_leader: 0 }],
  });
  const data = await service.prepare({ kind: "report-timing", session: 11388 });
  assert.equal(data.complete, false);
  assert.equal(data.lapSamples.find((lap) => lap.driverNumber === 16).position, null);
  assert.equal(writes.at(-1).ttl, 60_000);
});

test("late publication and corrections are rechecked before retaining final timing", () => {
  const data = { session: catalog.session, complete: true };
  const end = Date.parse(catalog.session.end);
  assert.equal(reportTimingTtl(data, end + 3600_000), 15 * 60_000);
  assert.equal(reportTimingTtl(data, end + 2 * 24 * 3600_000), 24 * 3600_000);
  assert.equal(reportTimingTtl(data, end + 15 * 24 * 3600_000), null);
  assert.equal(reportTimingTtl({ ...data, session: { end: "invalid" } }, end), 60_000);
});

test("a failed refresh preserves previously stored timing", async () => {
  const { service, cache, writes } = setup({
    positions: [{ driver_number: 3, date: start, position: 1 }],
    intervals: [{ driver_number: 3, date: "2026-10-11T12:00:55Z", gap_to_leader: 0 }],
  });
  const task = { kind: "report-timing", session: 11388 }, key = resultKey(task);
  const data = await service.prepare(task), writeCount = writes.length;
  service.store.get = async (cacheKey) => cacheKey === key ? null : cache.get(cacheKey);
  service.provider.fetchRows = async () => { throw new Error("PROVIDER_UNAVAILABLE"); };
  await assert.rejects(service.prepare(task), /PROVIDER_UNAVAILABLE/);
  assert.equal(cache.get(key), data);
  assert.equal(writes.length, writeCount);
});
