import assert from "node:assert/strict";
import test from "node:test";
import miami from "./fixtures/miami-2026-timing.json" with { type: "json" };
import { LiveReplayAdapter } from "./replay.ts";
import { ReplayClock } from "./replay-clock.ts";
import { LiveStore } from "./store.ts";

const base = Date.parse("2026-07-19T13:00:00Z");
const point = (progress) => ({
  progress,
  svgX: 500 + 300 * Math.cos(progress * Math.PI * 2),
  svgY: 500 + 300 * Math.sin(progress * Math.PI * 2),
});
function position(offsetMs, progress) {
  return {
    ...point(progress),
    offsetMs,
    timestamp: new Date(base + offsetMs).toISOString(),
    driverNumber: 1,
    headingRad: 0,
    z: 0,
    normalizedZ: 0,
    lapNumber: 1,
  };
}
function replay(positions) {
  return {
    replaySessionId: "test",
    sourceSessionKey: 1,
    sourceSeason: 2026,
    raceName: "Test",
    circuitName: "Test",
    durationMs: 100_000,
    totalLaps: 1,
    track: {
      centerline: Array.from({ length: 100 }, (_, i) => point(i / 100)),
      startFinish: point(0),
      svg: { viewBox: { width: 1000, height: 1000 } },
    },
    drivers: [
      {
        driverNumber: 1,
        abbreviation: "VER",
        fullName: "Max Verstappen",
        teamName: "Red Bull",
        teamColor: "0000ff",
        position: 1,
        status: "RUNNING",
        compound: "MEDIUM",
        tyreAge: 0,
        gapToLeader: null,
        intervalToAhead: null,
      },
    ],
    lapTimings: [
      { driverNumber: 1, lapNumber: 1, startOffsetMs: 0, durationMs: 100_000 },
    ],
    positions,
    raceEvents: [],
    weather: null,
  };
}

test("replay maximum uses only observed samples and restores when seeking back", () => {
  const data = replay([
    { ...position(0, 0), speedKph: 100 },
    { ...position(10_000, 0.1), speedKph: 330 },
    { ...position(20_000, 0.2), speedKph: 80 },
    { ...position(30_000, 0.3), speedKph: 340 },
  ]);
  const adapter = new LiveReplayAdapter(data);
  assert.equal(adapter.frame(5_000, true).data.drivers[1].maxSpeed, 100);
  assert.equal(adapter.frame(20_000, true).data.drivers[1].maxSpeed, 330);
  assert.equal(adapter.frame(30_000, true).data.drivers[1].maxSpeed, 340);
  assert.equal(adapter.frame(5_000, true).data.drivers[1].maxSpeed, 100);
});

test("replay preserves estimated tyre age and restores confirmed age when seeking", () => {
  const data = replay([
    { ...position(0, 0), tyreAge: 18 },
    { ...position(10_000, 0.1), tyreAge: 0, tyreAgeEstimated: true },
    { ...position(20_000, 0.2), tyreAge: 3, tyreAgeEstimated: false },
  ]);
  const adapter = new LiveReplayAdapter(data);
  assert.equal(adapter.frame(15_000, true).data.drivers[1].tyreAgeEstimated, true);
  assert.equal(adapter.frame(25_000, true).data.drivers[1].tyreAgeEstimated, false);
  assert.equal(adapter.frame(5_000, true).data.drivers[1].tyreAge, 18);
  assert.equal(adapter.frame(5_000, true).data.drivers[1].tyreAgeEstimated, false);
});

test("Miami archive keeps the map on the current lap and restores classification when seeking", () => {
  // Compact, unmodified lap metadata and classification samples from archive
  // 11280. Track shape is irrelevant: the regression is in the race clock.
  const data = replay([]);
  data.durationMs = miami.durationMs;
  data.totalLaps = 57;
  data.lapTimings = [];
  data.drivers = miami.drivers.map(({ driverNumber }) => ({
    ...data.drivers[0], driverNumber, position: driverNumber === 16 ? 3 : 1,
  }));
  data.positions = miami.drivers.flatMap(({ driverNumber, laps }) => laps.map(([offsetMs, lapNumber, lastLapDuration]) => ({
    ...position(offsetMs, 0), driverNumber, lapNumber, lastLapDuration,
  }))).sort((a, b) => a.offsetMs - b.offsetMs);
  data.positionTimings = miami.drivers.flatMap(({ driverNumber, samples }) => samples.map(([offsetMs, position]) => ({
    driverNumber, offsetMs, position,
  }))).sort((a, b) => a.offsetMs - b.offsetMs);
  data.raceEvents = [{
    message: "SESSION STARTED", type: "sessionstatus", severity: "INFO",
    offsetMs: miami.startOffsetMs, timestamp: new Date(base + miami.startOffsetMs).toISOString(),
  }];
  const adapter = new LiveReplayAdapter(data);
  const openingLapEnd = miami.startOffsetMs + miami.drivers.find((d) => d.driverNumber === 16).laps[0][2] * 1000;

  assert.equal(adapter.playbackStartMs, miami.startOffsetMs);
  assert.equal(adapter.frame(miami.startOffsetMs, false).data.drivers[16].lap, 1);
  assert.ok(adapter.sampleLocation(16, openingLapEnd - 1).progress > 0.99);
  assert.ok(adapter.sampleLocation(16, openingLapEnd + 1).progress < 0.01);
  assert.equal(adapter.frame(600_000, false).data.drivers[16].lap, 4);
  assert.equal(adapter.frame(600_000, false).data.drivers[16].position, 1);

  const lateRace = adapter.frame(5_600_000, false).data;
  assert.equal(lateRace.drivers[16].position, 3);
  assert.equal(lateRace.drivers[16].lap, 55);
  assert.ok(lateRace.locations[12].progress > lateRace.locations[16].progress);
  assert.ok(lateRace.locations[16].progress > lateRace.locations[81].progress);
  assert.equal(adapter.frame(miami.durationMs, false).data.drivers[16].position, 6);

  const rewound = adapter.frame(600_000, false).data;
  assert.equal(rewound.drivers[16].position, 1);
  assert.equal(rewound.drivers[16].lap, 4);
  assert.equal(adapter.sampleLocation(16, 5_600_000).progress, lateRace.locations[16].progress);
});

test("replay follows the circuit between sparse samples rather than cutting across corners", () => {
  const adapter = new LiveReplayAdapter(
    replay([position(0, 0), position(25_000, 0.25), position(100_000, 0)]),
  );
  const location = adapter.frame(12_500, true).data.locations[1];
  assert.ok(Math.abs(Math.hypot(location.x - 500, location.y - 500) - 300) < 2);
});

test("a frozen position feed cannot make a car stop and then fly around the circuit", () => {
  const adapter = new LiveReplayAdapter(
    replay([
      position(0, 0),
      position(40_000, 0.1),
      position(48_000, 0.7),
      position(100_000, 0),
    ]),
  );
  const first = adapter.frame(40_000, true).data.locations[1];
  const second = adapter.frame(48_000, true).data.locations[1];
  const distance = (second.progress - first.progress + 1) % 1;
  assert.ok(distance < 0.1, `travelled ${distance} laps in eight seconds`);
  assert.ok(Math.abs(first.progress - 0.4) < 0.01);
});

test("rewinding restores earlier events and removes future radio and completed laps", () => {
  const data = replay([position(0, 0), position(100_000, 0)]);
  data.raceEvents = [
    {
      offsetMs: 50_000,
      timestamp: new Date(base + 50_000).toISOString(),
      type: "race_control",
      message: "YELLOW",
      severity: "INFO",
    },
  ];
  data.radio = [
    {
      id: "radio",
      driverNumber: 1,
      offsetMs: 50_000,
      timestamp: new Date(base + 50_000).toISOString(),
      status: "ready",
      ru: "Бокс",
      original: "Box",
      lap: 1,
    },
  ];
  const adapter = new LiveReplayAdapter(data);
  assert.equal(
    adapter.frame(100_000, false).data.drivers[1].lapHistory.length,
    1,
  );
  const earlier = adapter.frame(20_000, false).data;
  assert.equal(earlier.events.length, 0);
  assert.equal(earlier.radio.length, 0);
  assert.equal(earlier.drivers[1].lapHistory.length, 0);
});

test("stewards yellow references stay green and yellow cannot override the safety car", () => {
  const data = replay([position(0, 0), position(100_000, 0)]);
  data.raceEvents = [
    {
      offsetMs: 10_000,
      timestamp: new Date(base + 10_000).toISOString(),
      type: "race_control",
      message:
        "FIA STEWARDS: INCIDENT INVOLVING CAR 14 (ALO) WILL BE INVESTIGATED AFTER THE RACE - YELLOW FLAG INFRINGEMENT",
      severity: "INFO",
    },
  ];
  let adapter = new LiveReplayAdapter(data);
  assert.equal(adapter.frame(20_000, true).data.flag, "GREEN");

  data.raceEvents.push(
    {
      offsetMs: 30_000,
      timestamp: new Date(base + 30_000).toISOString(),
      type: "race_control",
      message: "SAFETY CAR DEPLOYED",
      severity: "INFO",
    },
    {
      offsetMs: 40_000,
      timestamp: new Date(base + 40_000).toISOString(),
      type: "race_control",
      message: "YELLOW IN TRACK SECTOR 7",
      severity: "INFO",
    },
  );
  adapter = new LiveReplayAdapter(data);
  const frame = adapter.frame(50_000, true).data;
  assert.equal(frame.flag, "SC");
  assert.deepEqual(frame.yellowSectors, [7]);

  data.raceEvents.push({
    offsetMs: 60_000,
    timestamp: new Date(base + 60_000).toISOString(),
    type: "race_control",
    message: "CLEAR IN TRACK SECTOR 7",
    severity: "INFO",
  });
  adapter = new LiveReplayAdapter(data);
  const clearedFrame = adapter.frame(70_000, true).data;
  assert.equal(clearedFrame.flag, "SC");
  assert.deepEqual(clearedFrame.yellowSectors, []);
});

test("a global TRACK CLEAR ends SC ending in the live replay", () => {
  const data = replay([position(0, 0), position(100_000, 0)]);
  data.raceEvents = [
    {
      offsetMs: 10_000,
      timestamp: new Date(base + 10_000).toISOString(),
      type: "race_control",
      message: "SAFETY CAR DEPLOYED",
      severity: "INFO",
    },
    {
      offsetMs: 20_000,
      timestamp: new Date(base + 20_000).toISOString(),
      type: "race_control",
      message: "SAFETY CAR IN THIS LAP",
      severity: "INFO",
    },
    {
      offsetMs: 30_000,
      timestamp: new Date(base + 30_000).toISOString(),
      type: "race_control",
      message: "TRACK CLEAR",
      severity: "INFO",
    },
  ];
  const adapter = new LiveReplayAdapter(data);

  assert.equal(adapter.frame(25_000, true).data.flag, "SC_ENDING");
  assert.equal(adapter.frame(35_000, true).data.flag, "GREEN");
});

test("the full virtual safety car message starts and ends VSC", () => {
  const data = replay([position(0, 0), position(100_000, 0)]);
  data.raceEvents = [
    {
      offsetMs: 10_000,
      timestamp: new Date(base + 10_000).toISOString(),
      type: "race_control",
      message: "VIRTUAL SAFETY CAR DEPLOYED",
      severity: "INFO",
    },
    {
      offsetMs: 40_000,
      timestamp: new Date(base + 40_000).toISOString(),
      type: "race_control",
      message: "VIRTUAL SAFETY CAR ENDING",
      severity: "INFO",
    },
  ];
  const adapter = new LiveReplayAdapter(data);

  assert.equal(adapter.frame(20_000, true).data.flag, "VSC");
  assert.equal(adapter.frame(50_000, true).data.flag, "GREEN");
});

test("red flag freezes cars through telemetry gaps and restart clears the status", () => {
  const data = replay([
    position(0, 0),
    position(100_000, 0.25),
    position(300_000, 0.75),
    position(400_000, 0),
  ]);
  data.durationMs = 400_000;
  data.lapTimings = [
    { driverNumber: 1, lapNumber: 1, startOffsetMs: 0, durationMs: 100_000 },
    {
      driverNumber: 1,
      lapNumber: 2,
      startOffsetMs: 100_000,
      durationMs: 200_000,
    },
    {
      driverNumber: 1,
      lapNumber: 3,
      startOffsetMs: 300_000,
      durationMs: 100_000,
    },
  ];
  data.raceEvents = [
    {
      offsetMs: 110_000,
      timestamp: new Date(base + 110_000).toISOString(),
      type: "race_control",
      message: "SAFETY CAR DEPLOYED",
      severity: "CRITICAL",
    },
    {
      offsetMs: 120_000,
      timestamp: new Date(base + 120_000).toISOString(),
      type: "race_control",
      message: "RED FLAG - RACE SUSPENDED",
      severity: "CRITICAL",
    },
    {
      offsetMs: 250_000,
      timestamp: new Date(base + 250_000).toISOString(),
      type: "race_control",
      message: "SESSION STARTED",
      severity: "INFO",
    },
  ];
  const adapter = new LiveReplayAdapter(data);
  const stopped = adapter.sampleLocation(1, 150_000);
  const stillStopped = adapter.sampleLocation(1, 220_000);
  const restarted = adapter.sampleLocation(1, 270_000);

  assert.equal(adapter.frame(150_000, true).data.flag, "RED");
  assert.equal(adapter.frame(270_000, true).data.flag, "GREEN");
  assert.ok(Math.hypot(stillStopped.x - stopped.x, stillStopped.y - stopped.y) < 0.001);
  assert.ok(Math.hypot(restarted.x - stopped.x, restarted.y - stopped.y) > 1);
});

test("clock advances smoothly between UI ticks, changes speed without jumping and stays paused", () => {
  let now = 0;
  const clock = new ReplayClock(100_000, 0, () => now);
  const adapter = new LiveReplayAdapter(
    replay([position(0, 0), position(100_000, 0)]),
  );
  const store = new LiveStore();
  store.setReplaySampler((n) => adapter.sampleLocation(n, clock.read()));
  clock.setPlaying(true);
  now = 50;
  assert.equal(clock.read(), 50);
  clock.setSpeed(10);
  assert.equal(clock.read(), 50);
  now = 100;
  assert.equal(clock.read(), 550);
  clock.setPlaying(false);
  const paused = store.sample(1);
  now = 200_000;
  assert.deepEqual(store.sample(1), paused);
  clock.seek(200);
  assert.equal(clock.read(), 200);
  clock.setPlaying(true);
  now += 20_000;
  assert.equal(clock.read(), 100_000);
});

test("long timed laps and pit transitions stay continuous", () => {
  const data = replay([
    position(0, 0),
    { ...position(250_000, 0.9), isPitLane: true },
    position(280_000, 0.1),
    position(400_000, 0),
  ]);
  data.durationMs = 400_000;
  data.lapTimings[0].durationMs = 400_000;
  data.track.pitLane = {
    points: [point(0.9), { svgX: 850, svgY: 500 }, point(0.1)],
  };
  const adapter = new LiveReplayAdapter(data);
  for (const boundary of [250_000, 280_000, 400_000]) {
    const before = adapter.sampleLocation(1, boundary - 1);
    const after = adapter.sampleLocation(1, boundary + 1);
    assert.ok(
      Math.hypot(after.x - before.x, after.y - before.y) < 1,
      `jump at ${boundary}`,
    );
  }
});

test("a malformed closing progress value cannot teleport the car at start/finish", () => {
  const data = replay([position(0, 0), position(100_000, 0)]);
  data.track.centerline = Array.from({ length: 20 }, (_, i) => ({
    ...point(i / 20),
    progress: i / 19,
  }));
  const adapter = new LiveReplayAdapter(data);
  const before = adapter.sampleLocation(1, 99_999);
  const after = adapter.sampleLocation(1, 100_000);
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 1);
});

test("legacy full pit-lane duration is not mistaken for a stationary tyre change", () => {
  const data = replay([
    position(0, 0),
    {
      ...position(40_000, 0.9),
      isPitLane: true,
      pitStopDuration: 23.5,
      pitLaneDuration: 23.5,
    },
    position(72_000, 0.1),
    position(100_000, 0),
  ]);
  data.track.pitLane = {
    points: [point(0.9), { svgX: 850, svgY: 500 }, point(0.1)],
  };
  const adapter = new LiveReplayAdapter(data);
  const before = adapter.sampleLocation(1, 40_000);
  const after = adapter.sampleLocation(1, 40_250);
  assert.ok(after.pitLaneProgress - before.pitLaneProgress < 0.01);
});
