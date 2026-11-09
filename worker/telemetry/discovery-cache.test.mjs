import assert from "node:assert/strict";
import test from "node:test";
import { TelemetryService, resultKey } from "./service.mjs";

function expiringStore(now) {
  const rows = new Map();
  const writes = [];
  return {
    rows, writes,
    get: async (key) => {
      const row = rows.get(key);
      return row && (!row.expires || row.expires > now()) ? row.value : null;
    },
    put: async (key, value, ttl) => {
      rows.set(key, { value, expires: ttl ? now() + ttl : null });
      writes.push({ key, ttl });
    },
  };
}

test("meeting discovery and its consumers share one canonical cache entry", async () => {
  const year = new Date().getUTCFullYear();
  const store = expiringStore(Date.now);
  let calls = 0;
  const service = new TelemetryService({ store, provider: {
    getMeetings: async () => { calls++; return [{ id: 1298 }]; },
  } });
  await service.prepare({ kind: "meetings", season: year });
  assert.equal(resultKey({ kind: "meetings", season: year }), `meetings:${year}`);
  assert.deepEqual(await store.get(`meetings:${year}`), [{ id: 1298 }]);
  assert.deepEqual(store.writes, [{ key: `meetings:${year}`, ttl: 5 * 60_000 }]);
  assert.equal(calls, 1);
});

test("a newly started meeting appears after five minutes without an outer cache extending stale data", async () => {
  let now = Date.now(), calls = 0;
  const store = expiringStore(() => now);
  const service = new TelemetryService({ store, provider: {
    getMeetings: async () => (++calls === 1 ? [{ id: 1297 }] : [{ id: 1297 }, { id: 1298 }]),
  } });
  const task = { kind: "meetings", season: new Date().getUTCFullYear() };
  await service.prepare(task);
  now += 4 * 60_000;
  assert.equal((await service.prepare(task)).length, 1);
  now += 60_001;
  assert.equal((await service.prepare(task)).length, 2);
  assert.equal(calls, 2);
});

test("the next completed practice appears after the sessions cache expires", async () => {
  let now = Date.now(), calls = 0;
  const store = expiringStore(() => now);
  const service = new TelemetryService({ store, provider: {
    getSessions: async () => (++calls === 1 ? [{ id: 11397 }] : [{ id: 11397 }, { id: 11398 }]),
  } });
  const task = { kind: "sessions", meeting: 1298 };
  await service.prepare(task);
  assert.equal(resultKey(task), "sessions:1298");
  now += 5 * 60_000 + 1;
  assert.equal((await service.prepare(task)).length, 2);
  assert.equal(calls, 2);
  assert.ok(store.writes.every((write) => write.ttl === 5 * 60_000));
});

test("seasons reuse the same short-lived current-year meetings cache", async () => {
  const year = new Date().getUTCFullYear();
  const store = expiringStore(Date.now);
  const fetched = [];
  const service = new TelemetryService({ store, provider: {
    getMeetings: async (season) => { fetched.push(season); return [{ id: season }]; },
  } });
  await service.prepare({ kind: "seasons" });
  await service.prepare({ kind: "meetings", season: year });
  assert.equal(fetched.filter((season) => season === year).length, 1);
  assert.equal(store.writes.find((write) => write.key === `meetings:${year}`).ttl, 5 * 60_000);
  assert.equal(store.writes.find((write) => write.key === `meetings:${year - 1}`).ttl, 24 * 60 * 60_000);
});
