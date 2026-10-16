import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  normalizeLap,
  buildComparison,
  interpolate,
  drsValue,
  cleanSamples,
  bestLap,
  raceAverageLaps,
  averageNormalizedLaps,
  detectEvents,
  parseConfig,
  resampleComparison,
} from "./core.mjs";
import { mapLaps, OpenF1Provider } from "./provider.mjs";
test("pit timestamps after the control line do not mark the out-lap as another entry", () => {
  const raw = [9, 10, 11].map((number) => ({
    session_key: 1,
    driver_number: 3,
    lap_number: number,
    date_start: new Date(Date.parse("2024-01-01T12:00:00Z") + (number - 9) * 90000).toISOString(),
    lap_duration: 90,
    is_pit_out_lap: number === 10,
  }));
  const laps = mapLaps(raw, { pits: [{
    driver_number: 3, lap_number: 9,
    date: "2024-01-01T12:01:45Z",
  }] });
  assert.deepEqual(laps.map((lap) => [lap.pitIn, lap.pitOut]), [
    [true, false], [false, true], [false, false],
  ]);
});
const start = Date.parse("2026-09-05T14:00:00Z");
const track = {
  id: "test",
  version: "1",
  name: "Test track",
  length: 6000,
  points: [],
  sectors: [2000, 4000],
  corners: [{ number: 1, start: 1500, apex: 1800, end: 2200 }],
  estimated: false,
  source: "Synthetic test fixture",
};
const session = {
  id: 1,
  meetingId: 1,
  season: 2026,
  circuitKey: 1,
  start: new Date(start).toISOString(),
  name: "Qualifying",
};
function fixture(duration = 60, driverNumber = 1) {
  const lap = {
    id: `1:${driverNumber}:1`,
    driverNumber,
    sessionId: 1,
    number: 1,
    start: new Date(start).toISOString(),
    time: duration,
    sectors: [duration / 3, duration / 3, duration / 3],
    complete: true,
    deleted: false,
    pitIn: false,
    pitOut: false,
    validityKnown: true,
    status: ["GREEN"],
  };
  const samples = Array.from(
    { length: Math.round(duration * 4) + 17 },
    (_, i) => ({
      date: new Date(start + (i - 8) * 250).toISOString(),
      speed: (6000 / duration) * 3.6,
      throttle: i > 65 && i < 90 ? 20 : 100,
      brake: i > 50 && i < 60 ? 100 : 0,
      n_gear: 8,
      rpm: 11000,
      drs: 12,
    }),
  );
  return {
    lap,
    driver: { number: driverNumber, code: `D${driverNumber}` },
    session,
    samples,
    track,
  };
}
const config = {
  mode: "best",
  traces: [
    { session: 1, driver: 1, lap: "best" },
    { session: 1, driver: 2, lap: "best" },
  ],
  reference: 0,
};
test("distance, elapsed time and finish delta are monotonic and consistent", () => {
  const a = normalizeLap(fixture()),
    b = normalizeLap(fixture(60.25, 2));
  assert.equal(a.points[0].distance, 0);
  assert.ok(Math.abs(a.points.at(-1).distance - 6000) < 1e-6);
  assert.equal(a.quality.comparable, true);
  assert.ok(
    a.points.every((p, i) => !i || p.distance >= a.points[i - 1].distance),
  );
  const c = buildComparison([a, b], track, config);
  assert.equal(c.delta[1].at(-1), 0.25);
  assert.equal(
    c.segments.reduce((s, v) => s + v.gain[1], 0).toFixed(5),
    "0.25000",
  );
});
test("identical laps have zero delta and reversing reference reverses sign", () => {
  const a = normalizeLap(fixture()),
    b = normalizeLap(fixture(60.25, 2));
  assert.ok(
    buildComparison([a, a], track, config).delta[1].every((v) => v === 0),
  );
  assert.equal(
    buildComparison([a, b], track, { ...config, reference: 1 }).delta[0].at(-1),
    -0.25,
  );
});
test("sector deltas use official lap timing rather than distance interpolation", () => {
  const first = fixture();
  first.lap.sectors = [18, 21, 21];
  const second = fixture(60.25, 2);
  second.lap.sectors = [18.2, 20.9, 21.15];
  const comparison = buildComparison(
    [normalizeLap(first), normalizeLap(second)],
    track,
    config,
  );
  assert.deepEqual(comparison.sectorDelta, [
    [0, 0.2],
    [0, -0.1],
    [0, 0.15],
  ]);
});

test("missing official sector timing cannot become an estimated sector win", () => {
  const a = normalizeLap(fixture()), b = normalizeLap(fixture(60.25, 2));
  a.lap.sectors[1] = null;
  const c = buildComparison([a, b], track, config);
  assert.deepEqual(c.sectorDelta[1], [null, null]);
  const reversed = buildComparison([a, b], track, { ...config, reference: 1 });
  assert.deepEqual(reversed.sectorDelta[1], [null, 0]);
});
test("missing channels stay null; unknown DRS is not off", () => {
  assert.equal(drsValue(2), null);
  assert.equal(drsValue(10), 1);
  assert.equal(drsValue(null), null);
  const input = fixture();
  input.samples.forEach((s) => {
    delete s.rpm;
    delete s.drs;
  });
  const lap = normalizeLap(input);
  assert.equal(lap.points[5].rpm, null);
  assert.equal(lap.metrics.drsUsage, null);
});
test("cleaning removes duplicates, malformed times and impossible speed", () => {
  const input = fixture();
  const good = input.samples[0];
  const clean = cleanSamples([
    good,
    good,
    { ...good, date: "bad" },
    { ...good, speed: 999 },
  ]);
  assert.equal(clean.length, 1);
});
test("discrete channels do not invent gears or brake levels", () => {
  const points = [
    { distance: 0, elapsed: 0, gear: 2, brake: 0, speed: 100 },
    { distance: 10, elapsed: 0.5, gear: 3, brake: 100, speed: 120 },
  ];
  assert.equal(interpolate(points, 5, "gear"), 2);
  assert.equal(interpolate(points, 5, "brake"), 0);
  assert.equal(interpolate(points, 5, "speed"), 110);
});
test("large gaps are never interpolated and prevent full comparison", () => {
  const f = fixture();
  f.samples = f.samples.filter(
    (s) =>
      Date.parse(s.date) < start + 20000 || Date.parse(s.date) > start + 26000,
  );
  const lap = normalizeLap(f);
  assert.equal(lap.quality.comparable, false);
  const a = lap.points.find((p) => p.elapsed > 26),
    b = lap.points[lap.points.indexOf(a) - 1];
  assert.equal(
    interpolate(lap.points, (a.distance + b.distance) / 2, "speed"),
    null,
  );
  assert.throws(
    () => buildComparison([lap, normalizeLap(fixture())], track, config),
    /INCOMPLETE/,
  );
});
test("missing boundaries cannot create an invented finish", () => {
  const f = fixture();
  f.samples = f.samples.filter((s) => Date.parse(s.date) > start + 500);
  assert.equal(normalizeLap(f).quality.comparable, false);
});
test("best lap keeps yellow-flag times unless deleted, but excludes neutralized laps", () => {
  const base = fixture().lap;
  assert.equal(
    bestLap([
      { ...base, time: 50, deleted: true },
      { ...base, time: 51, pitIn: true },
      { ...base, time: 52, pitOut: true },
      { ...base, time: 53, status: ["SC"] },
      { ...base, time: 54, status: ["VSC"] },
      { ...base, time: 55, status: ["RED"] },
      { ...base, time: 56, status: ["YELLOW"] },
      { ...base, time: 57, complete: false },
      base,
    ]).time,
    56,
  );
  assert.equal(bestLap([{ ...base, validityKnown: false }]), null);
});
test("an official qualifying best lap survives a local yellow flag", () => {
  const raw = [
    {
      session_key: 11373,
      driver_number: 63,
      lap_number: 23,
      date_start: "2026-09-25T12:58:23.884Z",
      lap_duration: 103.037,
      is_pit_out_lap: false,
    },
    {
      session_key: 11373,
      driver_number: 63,
      lap_number: 25,
      date_start: "2026-09-25T13:02:17.911Z",
      lap_duration: 102.526,
      is_pit_out_lap: false,
    },
  ];
  const control = [
    { date: "2026-09-25T12:00:00Z", flag: "GREEN" },
    {
      date: "2026-09-25T13:03:35Z",
      flag: "YELLOW",
      scope: "Sector",
      sector: 5,
    },
    { date: "2026-09-25T13:04:01Z", flag: "GREEN" },
  ];
  const laps = mapLaps(raw, {
    control,
    controlKnown: true,
    sessionType: "Qualifying",
    classification: [
      { driver_number: 63, duration: [103.615, 103.462, 102.526] },
    ],
  });
  assert.ok(laps[1].status.includes("YELLOW"));
  assert.equal(bestLap(laps)?.number, 25);
  assert.deepEqual(raceAverageLaps(laps).map((lap) => lap.number), [23]);
});
test("official timing wins over an unconfirmed faster raw qualifying lap", () => {
  const base = fixture().lap;
  assert.equal(
    bestLap([
      { ...base, number: 1, time: 102.525, officialBestTime: 102.526 },
      {
        ...base,
        number: 2,
        time: 102.526,
        officialBestTime: 102.526,
        officialBest: true,
        status: ["YELLOW"],
      },
    ])?.number,
    2,
  );
});
test("OpenF1 catalog attaches official qualifying times to its laps", async () => {
  const provider = new OpenF1Provider({
    fetchRows: async (topic) =>
      ({
        sessions: [{
          session_key: 11373,
          meeting_key: 1295,
          year: 2024,
          session_name: "Qualifying",
          session_type: "Qualifying",
          circuit_short_name: "Baku",
          date_start: "2024-09-25T12:00:00Z",
          date_end: "2024-09-25T13:00:00Z",
        }],
        drivers: [{
          driver_number: 63,
          name_acronym: "RUS",
          full_name: "George Russell",
        }],
        laps: [{
          session_key: 11373,
          driver_number: 63,
          lap_number: 25,
          date_start: "2024-09-25T13:02:17Z",
          lap_duration: 102.526,
          is_pit_out_lap: false,
        }],
        race_control: [{
          date: "2024-09-25T13:03:35Z",
          flag: "YELLOW",
          scope: "Sector",
        }],
        session_result: [{
          driver_number: 63,
          duration: [103.615, 103.462, 102.526],
        }],
      })[topic] ?? [],
  });
  const catalog = await provider.getCatalog(11373);
  assert.equal(catalog.laps[0].officialBest, true);
  assert.equal(bestLap(catalog.laps)?.time, 102.526);
});
test("race average excludes pit entry, pit exit and invalid race laps", () => {
  const base = fixture().lap,
    lap = (number, overrides = {}) => ({
      ...base,
      id: `1:1:${number}`,
      number,
      ...overrides,
    });
  assert.deepEqual(
    raceAverageLaps([
      lap(1),
      lap(2, { pitIn: true }),
      lap(3),
      lap(4),
      lap(5, { pitOut: true }),
      lap(6, { deleted: true }),
      lap(7, { status: ["YELLOW"] }),
    ]).map((item) => item.number),
    [4],
  );
});
test("race average builds one distance-normalized telemetry trace", () => {
  const traces = [60, 61, 62].map((duration, index) => {
    const input = fixture(duration);
    input.lap = {
      ...input.lap,
      id: `1:1:${index + 1}`,
      number: index + 1,
      time: duration,
    };
    input.samples.forEach((sample) => {
      sample.n_gear = index === 0 ? 7 : 8;
    });
    return normalizeLap(input);
  });
  const average = averageNormalizedLaps(traces, track);
  assert.equal(average.lap.kind, "race_average");
  assert.equal(average.lap.sampleCount, 3);
  assert.equal(average.lap.time, 61);
  assert.equal(average.points.at(-1).elapsed, 61);
  assert.equal(average.points[Math.floor(average.points.length / 2)].gear, 8);
  assert.equal(average.quality.comparable, true);
  assert.ok(average.quality.warnings.includes("RACE_AVERAGE"));
});
test("brake noise below sustained event threshold is ignored", () => {
  const points = Array.from({ length: 40 }, (_, i) => ({
    distance: i * 10,
    elapsed: i * 0.1,
    brake: i === 3 || (i >= 10 && i <= 20) ? 100 : 0,
  }));
  assert.deepEqual(detectEvents(points, "brake", 50), [
    { start: 100, end: 200 },
  ]);
});
test("invalid inputs and incompatible weekends fail before comparison", () => {
  assert.equal(
    parseConfig({
      ...config,
      traces: config.traces.map((trace) => ({
        ...trace,
        lap: "race_average",
      })),
    }).traces[0].lap,
    "race_average",
  );
  assert.throws(() =>
    parseConfig({
      ...config,
      traces: [{ session: -1, driver: 1, lap: "best" }],
    }),
  );
  assert.throws(() => parseConfig({ ...config, reference: 4 }));
  assert.throws(() => parseConfig({ ...config, range: [10, 5] }));
  const a = normalizeLap(fixture()),
    b = normalizeLap(fixture(60.25, 2));
  b.session = { ...session, meetingId: 2 };
  assert.throws(() => buildComparison([a, b], track, config), /INCOMPATIBLE/);
});
test("resampling has one common grid and never changes analytical metrics", () => {
  const c = buildComparison(
    [normalizeLap(fixture()), normalizeLap(fixture(60.25, 2))],
    track,
    config,
  );
  const small = resampleComparison(c, { points: 500 });
  assert.ok(small.distance.length <= 500);
  assert.equal(small.distance.length, small.traces[1].points.length);
  assert.deepEqual(small.traces[0].metrics, c.traces[0].metrics);
  assert.equal(small.delta[1].at(-1), 0.25);
});
test("race control handles deleted and reinstated laps without treating unknown flags as green", () => {
  const raw = [
    {
      session_key: 1,
      driver_number: 1,
      lap_number: 2,
      date_start: new Date(start).toISOString(),
      lap_duration: 60,
      is_pit_out_lap: false,
    },
  ];
  const control = [
    {
      date: new Date(start + 70000).toISOString(),
      driver_number: 1,
      lap_number: 2,
      message: "LAP TIME DELETED",
    },
    {
      date: new Date(start + 90000).toISOString(),
      driver_number: 1,
      lap_number: 2,
      message: "LAP TIME REINSTATED",
    },
  ];
  const [lap] = mapLaps(raw, { control, controlKnown: true });
  assert.equal(lap.deleted, false);
  assert.deepEqual(lap.status, ["UNKNOWN"]);
});
test("VSC ending closes the neutralized period for following telemetry laps", () => {
  const raw = [
    {
      session_key: 1,
      driver_number: 1,
      lap_number: 2,
      date_start: new Date(start + 60000).toISOString(),
      lap_duration: 60,
      is_pit_out_lap: false,
    },
  ];
  const control = [
    {
      date: new Date(start + 10000).toISOString(),
      message: "VIRTUAL SAFETY CAR DEPLOYED",
    },
    {
      date: new Date(start + 40000).toISOString(),
      message: "VIRTUAL SAFETY CAR ENDING",
    },
  ];

  const [lap] = mapLaps(raw, { control, controlKnown: true });
  assert.deepEqual(lap.status, ["GREEN"]);
});
test("normalization and rendering payload have bounded CPU cost on two laps", () => {
  const began = performance.now();
  for (let i = 0; i < 10; i++) {
    const c = buildComparison(
      [normalizeLap(fixture()), normalizeLap(fixture(60.25, 2))],
      track,
      config,
    );
    resampleComparison(c);
  }
  assert.ok(performance.now() - began < 3000);
});
test("OpenF1 bounds encode date>=value using the date> query key", async () => {
  const { OpenF1Provider } = await import("./provider.mjs");
  let observed;
  const p = new OpenF1Provider({
    fetchRows: async (topic, query) => {
      observed = { topic, query };
      return [];
    },
  });
  await p.getTelemetry(1, 4, "2025-01-01", "2025-01-02");
  assert.equal(observed.query["date>"], "2025-01-01");
  assert.equal(observed.query["date<"], "2025-01-02");
  assert.equal(observed.query["date>="], undefined);
});
