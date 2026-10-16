import test from "node:test";
import assert from "node:assert/strict";
import { TelemetryService, resultKey } from "./service.mjs";
import { VERSION } from "./core.mjs";
import { hash, TelemetryStore } from "./store.mjs";

const start = Date.parse("2026-09-13T12:00:00Z");
const track = {
  id: "test",
  version: "1",
  name: "Test track",
  length: 6000,
  points: [],
  sectors: [2000, 4000],
  corners: [],
  estimated: false,
  source: "Test",
};
function raceLap(number, duration = 60, overrides = {}) {
  const lapStart = start + (number - 1) * 70000;
  return {
    id: `1:1:${number}`,
    sessionId: 1,
    driverNumber: 1,
    number,
    time: duration,
    start: new Date(lapStart).toISOString(),
    sectors: [duration / 3, duration / 3, duration / 3],
    compound: "MEDIUM",
    tyreAge: number,
    stint: 1,
    pitIn: false,
    pitOut: false,
    deleted: false,
    complete: true,
    status: ["GREEN"],
    validityKnown: true,
    weather: null,
    ...overrides,
  };
}
function samplesFor(lap) {
  const lapStart = Date.parse(lap.start);
  return Array.from({ length: Math.round(lap.time * 4) + 17 }, (_, index) => ({
    date: new Date(lapStart + (index - 8) * 250).toISOString(),
    speed: (track.length / lap.time) * 3.6,
    throttle: 100,
    brake: 0,
    n_gear: 8,
    rpm: 11000,
    drs: 8,
  }));
}
function memoryStore() {
  const values = new Map();
  return {
    get: async (key) => values.get(key) ?? null,
    put: async (key, value) => values.set(key, value),
  };
}

test("verified Baku map wins over a cached OpenF1 fallback", async () => {
  const store = memoryStore();
  await store.put(`track:${VERSION}:123`, { id: "meeting-123", points: [] });
  const service = new TelemetryService({ store, provider: {} });
  const result = await service.track(
    { session: { meetingId: 123, season: 2026, circuit: "Baku" } },
    null,
  );
  assert.equal(result.id, "baku");
  assert.equal(result.length, 6003);
  assert.equal(result.corners.length, 20);
});

test("unmodelled OpenF1 circuits flip world Y into the SVG plane", async () => {
  const lap = raceLap(1);
  const service = new TelemetryService({
    store: memoryStore(),
    provider: {
      source: { license: "test" },
      getTelemetry: async () => samplesFor(lap),
      getLocations: async () => [{
        date: new Date(Date.parse(lap.start) + 1000).toISOString(),
        x: 50,
        y: 123,
      }],
    },
  });
  const result = await service.track(
    {
      session: { meetingId: 999, season: 2026, circuit: "Future Circuit" },
      laps: [lap],
    },
    lap,
  );
  assert.equal(result.estimated, true);
  assert.equal(result.points[0].y, -123);
});

test("service loads one race range and returns one average trace", async () => {
  const laps = [raceLap(1, 60), raceLap(2, 61), raceLap(3, 62)],
    samples = laps.flatMap(samplesFor);
  let telemetryCalls = 0;
  const service = new TelemetryService({
    store: memoryStore(),
    provider: {
      source: { license: "test" },
      getTelemetry: async () => {
        telemetryCalls += 1;
        return samples;
      },
    },
  });
  const catalog = {
    session: {
      id: 1,
      meetingId: 1,
      season: 2026,
      name: "Race",
      type: "Race",
      circuit: "Test",
      circuitKey: 1,
      start: new Date(start).toISOString(),
      end: new Date(start + 300000).toISOString(),
    },
    drivers: [{ id: "1:1", number: 1, code: "ONE", name: "Driver One" }],
    laps,
  };
  const average = await service.raceAverage(catalog, 1, track);
  assert.equal(telemetryCalls, 1);
  assert.equal(average.lap.kind, "race_average");
  assert.equal(average.lap.sampleCount, 2);
  assert.equal(average.lap.time, 61.5);
  const cached = await service.raceAverage(catalog, 1, track);
  assert.equal(cached.lap.time, 61.5);
  assert.equal(telemetryCalls, 1);
});

test("service rejects a race average outside a race session", async () => {
  const service = new TelemetryService({
    store: memoryStore(),
    provider: { source: { license: "test" } },
  });
  await assert.rejects(
    () =>
      service.raceAverage(
        { session: { id: 1, name: "Qualifying", type: "Qualifying" } },
        1,
        track,
      ),
    /RACE_AVERAGE_ONLY/,
  );
});
test("race average uses the same SC-start timeline as the race pace graph", async () => {
  const laps = [raceLap(1), raceLap(2), raceLap(3), raceLap(4, 61), raceLap(5, 62)];
  const service = new TelemetryService({ store: memoryStore(), provider: {
    source: { license: "test" }, getTelemetry: async () => laps.flatMap(samplesFor),
  } });
  const average = await service.raceAverage({
    session: { id: 1, type: "Race" }, drivers: [{ number: 1, code: "ONE" }], laps,
    raceControl: [
      { date: laps[0].start, message: "FORMATION LAP(S) BEHIND SAFETY CAR" },
      { date: laps[1].start, message: "STANDING START", lap_number: 2 },
    ],
  }, 1, track);
  assert.equal(average.lap.sampleCount, 2);
  assert.equal(average.lap.time, 61.5);
});
test("race-average comparisons do not reuse the previous quality algorithm's cache", () => {
  const config = { mode: "lap", reference: 0, traces: [{ session: 1, driver: 3, lap: "race_average" }] };
  const key = resultKey({ kind: "compare", config });
  assert.notEqual(key, `${VERSION}:${hash({ kind: "compare", config })}`);
  // Other tasks keep their original cache prefix.
  assert.ok(key.startsWith(`${VERSION}:`));
});
test("a ready task from the old algorithm cannot return the old pace data after a version change", async () => {
  const task = { kind: "race-pace", session: 11731 }, requests = new Map([
    [hash(task), "old-ready-task"],
  ]);
  const store = new TelemetryStore({ rpc: async (_name, { p_key, p_task }) => {
    assert.deepEqual(p_task, task);
    if (!requests.has(p_key)) requests.set(p_key, "new-task");
    return { data: requests.get(p_key), error: null };
  } });
  assert.equal(await store.enqueue(task, resultKey(task)), "new-task");
  assert.equal(await store.enqueue(task, resultKey(task)), "new-task");
  assert.equal(requests.size, 2);
});

test("best-lap resolution tries the official lap before fallback laps", async () => {
  const laps = [
    raceLap(23, 103.037, { officialBestTime: 102.526 }),
    raceLap(25, 102.526, {
      officialBestTime: 102.526,
      officialBest: true,
      status: ["YELLOW", "GREEN"],
    }),
  ];
  const service = new TelemetryService({ store: memoryStore(), provider: {} });
  const tried = [];
  service.normalize = async (_catalog, lap) => {
    tried.push(lap.number);
    return { lap, quality: { comparable: true, warnings: [] } };
  };
  const result = await service.resolve(
    { laps },
    { driver: 1, lap: "best" },
    track,
  );
  assert.equal(result.lap.number, 25);
  assert.deepEqual(tried, [25]);
});

test("recent catalog caches expire quickly so official timing corrections appear", async () => {
  const writes = [];
  const service = new TelemetryService({
    store: {
      get: async () => null,
      put: async (key, _value, ttl) => writes.push({ key, ttl }),
    },
    provider: {
      getCatalog: async () => ({
        session: { end: new Date(Date.now() - 3600000).toISOString() },
      }),
    },
  });
  await service.catalog(11373);
  assert.deepEqual(writes, [
    { key: `catalog:${VERSION}:11373`, ttl: 15 * 60000 },
  ]);
});
