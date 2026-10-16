import test from "node:test";
import assert from "node:assert/strict";
import { buildRacePace, raceTyreLaps } from "./race-pace.mjs";
import { TelemetryService, resultKey, validateTask } from "./service.mjs";
const start = Date.parse("2024-01-01T12:00:00Z");
const lap = (number, extra = {}) => ({
  id: `1:4:${number}`,
  driverNumber: 4,
  number,
  time: 80 + number / 10,
  start: new Date(start + (number - 1) * 90000).toISOString(),
  complete: true,
  validityKnown: true,
  status: ["GREEN"],
  stint: 1,
  compound: "MEDIUM",
  tyreAge: number + 3,
  pitIn: false,
  pitOut: false,
  deleted: false,
  ...extra,
});
const catalog = (laps, extra = {}) => ({
  session: { id: 1, type: "Race", name: "Race", end: "2024-01-01T14:00:00Z" },
  drivers: [{ number: 4, code: "NOR", position: 1 }],
  raceControl: [],
  laps,
  ...extra,
});
test("Malaysia's initial SC laps and standing start are not ordinary race pace", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = JSON.parse(await readFile(new URL(
    "../../docs/telemetry/fixtures/race-pace-malaysia-start-2026.json",
    import.meta.url,
  ), "utf8"));
  const data = buildRacePace(source);
  for (const driver of [3, 44]) {
    const points = data.points.filter((point) => point.driver === driver);
    assert.ok(points.find((point) => point.lap === 2).reasons.includes("SC"));
    assert.ok(points.find((point) => point.lap === 3).reasons.includes("START"));
    assert.ok(points.find((point) => point.lap === 4).clean);
  }
});
test("Malaysia tyre history cannot change without a pit visit or cross a missing tyre change", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = JSON.parse(await readFile(new URL(
    "../../docs/telemetry/fixtures/race-pace-malaysia-start-2026.json",
    import.meta.url,
  ), "utf8"));
  const data = buildRacePace(source);
  const point = (driver, lap) => data.points.find((p) => p.driver === driver && p.lap === lap);
  const original = JSON.stringify(source);
  const corrected = raceTyreLaps(source);
  assert.deepEqual(raceTyreLaps({ ...source, laps: corrected }), corrected);
  assert.equal(JSON.stringify(source), original);
  assert.equal(point(3, 4).compound, "INTERMEDIATE");
  assert.equal(point(3, 8).compound, "INTERMEDIATE");
  assert.equal(point(44, 4).compound, "SOFT");
  assert.equal(point(44, 30).compound, "SOFT");
  assert.equal(point(3, 12).compound, "SOFT");
  assert.equal(point(3, 35).compound, "UNKNOWN");
  assert.equal(point(44, 33).compound, "UNKNOWN");
  assert.equal(point(44, 45).compound, "SOFT");
  assert.equal(point(44, 4).tyreAge, null);
  assert.equal(point(3, 35).tyreAge, null);
  assert.deepEqual(data.points.filter((p) => p.driver === 12).map((p) => [p.lap, p.compound, p.tyreAge, p.stint]),
    source.laps.filter((p) => p.driverNumber === 12).map((p) => [p.number, p.compound, p.tyreAge, p.stint]));
});
test("tyre continuity does not assume missing pit data or override changes during RED", () => {
  const source = catalog([
    lap(1),
    lap(2, { stint: 2, compound: "SOFT" }),
    lap(3, { stint: 3, compound: "HARD" }),
  ], { pitDataKnown: false });
  assert.equal(buildRacePace(source).points[1].compound, "SOFT");
  const resumed = buildRacePace({ ...source, pitDataKnown: true, raceControl: [
    { date: lap(2).start, flag: "RED" },
    { date: lap(3).start, flag: "GREEN", scope: "Track" },
  ] });
  assert.equal(resumed.points.find((point) => point.lap === 3).compound, "HARD");
});
test("preserves used tyre ages, real lap times, missing metadata and retirement", () => {
  const data = buildRacePace(
    catalog([
      lap(1),
      lap(2),
      lap(3, { tyreAge: null, compound: null, stint: null }),
      lap(4, { time: null, complete: false }),
    ]),
  );
  assert.equal(data.totalLaps, 4);
  assert.equal(data.points[1].tyreAge, 5);
  assert.equal(data.points[1].time, 80.2);
  assert.equal(data.points[2].compound, "UNKNOWN");
  assert.equal(data.points[2].tyreAge, null);
  assert.equal(data.points[3].time, null);
  assert.deepEqual(data.warnings, ["MISSING_TYRES"]);
});
test("excludes start, pit in/out, deleted, flagged, incomplete and unknown laps", () => {
  const data = buildRacePace(
    catalog([
      lap(1),
      lap(2, { pitIn: true }),
      lap(3),
      lap(4, { deleted: true }),
      lap(5, { status: ["YELLOW"] }),
      lap(6, { validityKnown: false }),
      lap(7, { complete: false }),
      lap(8),
    ]),
  );
  assert.deepEqual(
    data.points.map((point) => point.clean),
    [false, false, false, false, false, false, false, true],
  );
  assert.deepEqual(data.points[2].reasons, ["PIT_OUT"]);
});
test("median requires three consecutive clean laps in the same stint", () => {
  const data = buildRacePace(
    catalog([
      lap(2, { time: 82 }),
      lap(3, { time: 95 }),
      lap(4, { time: 81 }),
      lap(5, { stint: 2 }),
      lap(7, { stint: 2 }),
      lap(8, { stint: 2 }),
      lap(9, { stint: 2, deleted: true }),
    ]),
  );
  assert.equal(data.points[1].trend, 82);
  assert.equal(data.points[1].time, 95); // Traffic/outliers remain visible.
  assert.deepEqual(
    data.points
      .filter((point) => point.trend != null)
      .map((point) => point.lap),
    [3],
  );
  assert.equal(data.stints.length, 3);
});
test("SC in this lap is still neutralised and local clear leaves other yellows active", () => {
  const control = [
    { date: new Date(start).toISOString(), message: "SAFETY CAR DEPLOYED" },
    {
      date: new Date(start + 90000).toISOString(),
      message: "SAFETY CAR IN THIS LAP",
    },
    {
      date: new Date(start + 180000).toISOString(),
      flag: "GREEN",
      scope: "Track",
    },
    {
      date: new Date(start + 270000).toISOString(),
      flag: "YELLOW",
      scope: "Sector",
      sector: 1,
    },
    {
      date: new Date(start + 270001).toISOString(),
      flag: "YELLOW",
      scope: "Sector",
      sector: 2,
    },
    {
      date: new Date(start + 360000).toISOString(),
      flag: "CLEAR",
      scope: "Sector",
      sector: 1,
    },
  ];
  const data = buildRacePace(
    catalog([lap(1), lap(2), lap(3), lap(4), lap(5)], { raceControl: control }),
  );
  assert.ok(data.points[1].reasons.includes("SC"));
  assert.ok(!data.points[2].reasons.includes("SC")); // GREEN at the exact lap start.
  assert.ok(data.points[4].reasons.includes("YELLOW"));
});
test("rejects qualifying and missing timings; allows sprint", () => {
  assert.throws(
    () => buildRacePace(catalog([lap(2)], { session: { type: "Qualifying" } })),
    /RACE_PACE_ONLY/,
  );
  assert.throws(
    () => buildRacePace(catalog([lap(2, { time: null })])),
    /RACE_PACE_UNAVAILABLE/,
  );
  assert.equal(
    buildRacePace(
      catalog([lap(2)], { session: { type: "Race", name: "Sprint" } }),
    ).points.length,
    1,
  );
});
test("worker uses the shared catalogue and compact cache without car data or location", async () => {
  const cache = new Map(),
    writes = [];
  let calls = 0;
  const service = new TelemetryService({
    store: {
      get: async (key) => cache.get(key),
      put: async (key, data, ttl) => {
        cache.set(key, data);
        writes.push({ key, ttl });
      },
    },
    provider: {
      getCatalog: async () => {
        calls++;
        return catalog([lap(2), lap(3), lap(4)]);
      },
      getTelemetry: async () => {
        throw new Error("Must not load car data");
      },
      getLocations: async () => {
        throw new Error("Must not load locations");
      },
    },
  });
  const task = validateTask({
    kind: "race-pace",
    session: 1,
    filters: "ignored",
  });
  assert.deepEqual(task, { kind: "race-pace", session: 1 });
  const first = await service.prepare(task),
    second = await service.prepare(task);
  assert.equal(first, second);
  assert.equal(calls, 1);
  assert.equal(writes.length, 2);
  assert.equal(writes.at(-1).ttl, null);
  assert.match(resultKey(task), /^race-pace-3:/);
  assert.throws(
    () => validateTask({ kind: "race-pace", session: -1 }),
    /INVALID_TASK/,
  );
});

test("recent race pace expires for source corrections before becoming permanent", async () => {
  const writes = [];
  const service = new TelemetryService({
    store: {
      get: async () => null,
      put: async (key, data, ttl) => writes.push({ key, ttl }),
    },
    provider: {
      getCatalog: async () =>
        catalog([lap(2), lap(3)], {
          session: {
            id: 1,
            type: "Race",
            name: "Race",
            end: new Date(Date.now() - 2 * 3600000).toISOString(),
          },
        }),
    },
  });
  await service.prepare({ kind: "race-pace", session: 1 });
  assert.equal(writes.at(-1).ttl, 15 * 60000);
});
test("real Monza 2025 dataset stays compact and preserves the retired driver", async () => {
  const { readFile } = await import("node:fs/promises");
  const data = JSON.parse(
    await readFile(
      new URL(
        "../../docs/telemetry/fixtures/race-pace-monza-2025.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(data.drivers.length, 20);
  assert.equal(data.totalLaps, 53);
  assert.equal(data.points.length, 976);
  assert.equal(data.points.filter((point) => point.clean).length, 843);
  assert.equal(
    data.points.filter((point) => point.driver === 14).at(-1).time,
    null,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(data)) < 150_000);
});

test("pace cannot be prepared before the post-session availability window", () => {
  assert.throws(
    () =>
      buildRacePace(
        catalog([lap(2)], {
          session: {
            type: "Race",
            end: new Date(Date.now() - 60000).toISOString(),
          },
        }),
      ),
    /SESSION_NOT_FINISHED/,
  );
});

test("SC withdrawal restores racing without GREEN, including lapped drivers", () => {
  const source = catalog(
    [
      lap(2),
      lap(3),
      lap(4),
      lap(5),
      lap(2, { driverNumber: 8, start: lap(4).start }),
      lap(3, { driverNumber: 8, start: lap(5).start }),
    ],
    {
      drivers: [{ number: 4 }, { number: 8 }],
      raceControl: [
        { date: lap(2).start, message: "SAFETY CAR DEPLOYED" },
        {
          date: new Date(Date.parse(lap(3).start) + 1000).toISOString(),
          message: "SAFETY CAR IN THIS LAP",
          lap_number: 3,
        },
      ],
    },
  );
  const original = JSON.stringify(source);
  const data = buildRacePace(source);
  assert.equal(JSON.stringify(source), original);
  assert.ok(
    data.points
      .find((p) => p.driver === 4 && p.lap === 3)
      .reasons.includes("SC"),
  );
  assert.ok(data.points.find((p) => p.driver === 4 && p.lap === 4).clean);
  assert.ok(
    !data.points
      .find((p) => p.driver === 8 && p.lap === 2)
      .reasons.includes("SC"),
  );
});

test("VSC ending keeps the transition lap but releases later laps without GREEN", () => {
  const data = buildRacePace(
    catalog([lap(2), lap(3), lap(4)], {
      raceControl: [
        { date: lap(2).start, message: "VIRTUAL SAFETY CAR DEPLOYED" },
        {
          date: new Date(Date.parse(lap(3).start) - 5000).toISOString(),
          message: "VSC ENDING",
        },
      ],
    }),
  );
  assert.ok(data.points[1].reasons.includes("VSC"));
  assert.ok(data.points[2].clean);
});

test("a new deployment or red flag cancels a scheduled withdrawal", () => {
  for (const event of [{ message: "VSC DEPLOYED" }, { flag: "RED" }]) {
    const data = buildRacePace(
      catalog([lap(2), lap(3), lap(4), lap(5)], {
        raceControl: [
          { date: lap(2).start, message: "VSC DEPLOYED" },
          {
            date: new Date(Date.parse(lap(3).start) - 5000).toISOString(),
            message: "VSC ENDING",
          },
          { date: lap(3).start, ...event },
          { date: lap(5).start, flag: "GREEN", scope: "Track" },
        ],
      }),
    );
    if (event.flag === "RED")
      assert.deepEqual(
        data.points.map((p) => p.lap),
        [2, 5],
      );
    else
      assert.ok(data.points.find((p) => p.lap === 4).reasons.includes("VSC"));
  }
});

test("RED is permanently removed even when flag provenance is unknown", () => {
  const data = buildRacePace(
    catalog([lap(2), lap(3, { validityKnown: false }), lap(4), lap(5)], {
      raceControl: [
        {
          date: new Date(Date.parse(lap(3).start) + 1000).toISOString(),
          flag: "RED",
        },
        { date: lap(5).start, flag: "GREEN", scope: "Track" },
      ],
    }),
  );
  assert.deepEqual(
    data.points.map((p) => p.lap),
    [2, 5],
  );
  assert.equal(data.stints.length, 2);
  assert.equal(data.totalLaps, 5);
});

test("real 2026 Australia, China and Japan recover normal pace after SC/VSC announcements", async () => {
  const { readFile } = await import("node:fs/promises");
  const sources = JSON.parse(
    await readFile(
      new URL(
        "../../docs/telemetry/fixtures/race-pace-control-2026.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const source of sources) {
    const data = buildRacePace(source);
    const driver = data.drivers[0].number;
    const late = data.points.filter(
      (p) =>
        p.driver === driver && p.lap > data.totalLaps - 10 && p.time != null,
    );
    assert.ok(late.length >= 8, source.session.circuit);
    assert.ok(
      late.every(
        (p) => !p.reasons.includes("SC") && !p.reasons.includes("VSC"),
      ),
      source.session.circuit,
    );
    assert.ok(
      data.points.some(
        (p) => p.reasons.includes("SC") || p.reasons.includes("VSC"),
      ),
    );
  }
});

test("textual RED, resumption and an extra formation lap cannot leak into race pace", () => {
  const data = buildRacePace(
    catalog([lap(2), lap(3), lap(4), lap(5), lap(6), lap(7)], {
      raceControl: [
        {
          date: lap(3).start,
          category: "Other",
          message: "RED FLAG - RACE SUSPENDED",
          flag: null,
        },
        { date: lap(4).start, message: "SAFETY CAR LIGHTS ON" },
        {
          date: new Date(Date.parse(lap(4).start) + 1000).toISOString(),
          message: "SESSION STARTED",
        },
        {
          date: new Date(Date.parse(lap(4).start) + 2000).toISOString(),
          message: "STANDING START",
          lap_number: 4,
        },
        {
          date: new Date(Date.parse(lap(5).start) + 1000).toISOString(),
          message: "EXTRA FORMATION LAP",
          lap_number: 5,
        },
        {
          date: new Date(Date.parse(lap(5).start) + 2000).toISOString(),
          message: "STANDING START",
          lap_number: 5,
        },
      ],
    }),
  );
  assert.deepEqual(
    data.points.map((p) => p.lap),
    [2, 5, 6, 7],
  );
  assert.ok(data.points.find((p) => p.lap === 5).reasons.includes("START"));
  assert.ok(data.points.find((p) => p.lap === 6).reasons.includes("START"));
  assert.ok(data.points.find((p) => p.lap === 7).clean);
});

test("extra formation lap can finish without a repeated standing-start announcement", () => {
  const data = buildRacePace(
    catalog([lap(2), lap(3), lap(4), lap(5), lap(6), lap(7)], {
      raceControl: [
        { date: lap(3).start, message: "SESSION ABORTED" },
        {
          date: new Date(Date.parse(lap(4).start) + 1000).toISOString(),
          message: "SESSION STARTED",
        },
        {
          date: new Date(Date.parse(lap(4).start) + 2000).toISOString(),
          message: "STANDING START",
          lap_number: 4,
        },
        {
          date: new Date(Date.parse(lap(5).start) + 1000).toISOString(),
          message: "EXTRA FORMATION LAP",
          lap_number: 5,
        },
      ],
    }),
  );
  assert.ok(data.points.find((p) => p.lap === 6).reasons.includes("START"));
  assert.ok(data.points.find((p) => p.lap === 7).clean);
});

test("green pit-exit light cannot end a neutralisation or race suspension", () => {
  for (const event of [{ message: "SAFETY CAR DEPLOYED" }, { flag: "RED" }]) {
    const data = buildRacePace(
      catalog([lap(2), lap(3), lap(4)], {
        raceControl: [
          { date: lap(2).start, ...event },
          {
            date: lap(3).start,
            flag: "GREEN",
            scope: "Track",
            message: "GREEN LIGHT - PIT EXIT OPEN",
          },
          {
            date: lap(4).start,
            flag: "GREEN",
            scope: "Track",
            message: "GREEN FLAG",
          },
        ],
      }),
    );
    if (event.flag === "RED")
      assert.deepEqual(
        data.points.map((p) => p.lap),
        [4],
      );
    else assert.ok(data.points.find((p) => p.lap === 3).reasons.includes("SC"));
  }
});

test("real Monza 2026 red pause is removed and racing resumes after the standing start", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = JSON.parse(
    await readFile(
      new URL(
        "../../docs/telemetry/fixtures/race-pace-red-monza-2026.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const data = buildRacePace(source);
  assert.ok(!data.points.some((p) => [3, 4].includes(p.lap)));
  assert.ok(data.points.find((p) => p.lap === 6).reasons.includes("START"));
  assert.ok(data.points.find((p) => p.lap === 7).clean);
  assert.ok(
    data.points
      .filter((p) => p.lap >= 7 && p.lap < 28)
      .every((p) => !p.reasons.includes("SC")),
  );
  assert.ok(data.points.every((p) => p.time < 2000));
});
