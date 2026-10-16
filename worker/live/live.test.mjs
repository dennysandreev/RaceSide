import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiveState, mapLocation, eventKey } from "./state.mjs";
import {
  sessionMode,
  sessionCapabilities,
  chooseSession,
  chooseSessionWithControls,
  sessionStillOngoing,
  sessionHistoryEnd,
} from "./session-mode.mjs";
import { LiveWriter, historyRow } from "./persistence.mjs";
import { transcribeRadio, allowedRecording } from "./radio.mjs";
import { normalizeMessage, hydrationMessages } from "./normalize.mjs";
import { ReplaySimulationSource, replayRaceControlFlag, replayMessages } from "./sources.mjs";
import { buildReplayFromHistory } from "./replay-adapter.mjs";
const session = {
  session_key: 1,
  meeting_key: 1,
  session_type: "Race",
  session_name: "Race",
  date_start: "2026-09-11T12:00:00Z",
  date_end: "2026-09-11T14:00:00Z",
};
const row = (extra = {}) => ({
  session_key: 1,
  driver_number: 44,
  date: "2026-09-11T12:01:00Z",
  ...extra,
});
const state = () => {
  const s = new LiveState();
  s.setSession(session);
  return s;
};
test("session maximum survives slower, delayed and invalid samples and resets for a new session", () => {
  const s = state();
  s.apply("car_data", row({ speed: 280 }));
  s.apply("car_data", row({ speed: 0, date: "2026-09-11T12:02:00Z" }));
  assert.equal(s.state.drivers[44].maxSpeed, 280);
  s.apply("car_data", row({ speed: 331, date: "2026-09-11T12:01:30Z" }));
  assert.equal(s.state.drivers[44].maxSpeed, 331);
  assert.equal(s.state.telemetry[44].speed, 0);
  s.apply("car_data", row({ speed: null, date: "2026-09-11T12:03:00Z" }));
  s.apply("car_data", row({ speed: -1, date: "2026-09-11T12:04:00Z" }));
  s.apply("laps", row({ lap_number: 1, st_speed: 335, i1_speed: 301, i2_speed: null }));
  assert.equal(s.state.drivers[44].maxSpeed, 335);
  s.apply("car_data", row({ session_key: 2, speed: 400 }));
  assert.equal(s.snapshot().drivers[44].maxSpeed, 335);
  s.setSession({ ...session, session_key: 2 });
  s.apply("drivers", row({ session_key: 2 }));
  assert.equal(s.state.drivers[44].maxSpeed, null);
});
test("explicit retirement removes location and survives delayed laps and pit updates", () => {
  const s = state();
  s.apply("location", row({ svgX: 10, svgY: 20 }));
  s.apply(
    "race_control",
    row({
      driver_number: null,
      message: "CAR 44 (HAM) RETIRED",
      date: "2026-09-11T12:02:00Z",
    }),
  );
  assert.equal(s.state.drivers[44].status, "DNF");
  assert.equal(s.state.locations[44], undefined);
  s.apply("laps", row({ lap_number: 5, lap_duration: 90 }));
  s.apply("pit", row({ date: new Date().toISOString() }));
  s.apply(
    "location",
    row({ svgX: 12, svgY: 21, date: "2026-09-11T12:03:00Z" }),
  );
  assert.equal(s.state.drivers[44].status, "DNF");
  assert.equal(s.state.locations[44], undefined);
  assert.match(
    s.state.events.find((e) => e.type === "race_control").message,
    /Сход/,
  );
});
test("stopped, missing telemetry and disqualified laps do not imply retirement", () => {
  for (const message of [
    "CAR 44 (HAM) STOPPED ON TRACK",
    "CAR 44 (HAM) LAP TIME DELETED",
    "CAR 44 (HAM) NOT RETIRED",
  ]) {
    const s = state();
    s.apply("race_control", row({ message }));
    s.apply("car_data", row({ speed: 0 }));
    assert.equal(s.state.drivers[44].status, "RUNNING");
  }
});
test("best lap keeps the sectors from that lap separately from best individual sectors", () => {
  const s = state();
  s.apply(
    "laps",
    row({
      lap_number: 1,
      lap_duration: 90,
      duration_sector_1: 30,
      duration_sector_2: 29,
      duration_sector_3: 31,
    }),
  );
  s.apply(
    "laps",
    row({
      lap_number: 2,
      lap_duration: 89,
      duration_sector_1: 29,
      duration_sector_2: 31,
      duration_sector_3: 29,
    }),
  );
  s.apply(
    "laps",
    row({
      lap_number: 3,
      lap_duration: 92,
      duration_sector_1: 31,
      duration_sector_2: 30,
      duration_sector_3: 31,
    }),
  );
  assert.equal(s.state.drivers[44].bestLap, 89);
  assert.deepEqual(s.state.drivers[44].bestLapSectors, [29, 31, 29]);
  assert.deepEqual(s.state.drivers[44].bestSectors, [29, 29, 29]);
  assert.deepEqual(s.state.drivers[44].sectors, [31, 30, 31]);
});
test("third sector remains visible until the first sector of the next lap", () => {
  const s = state();
  s.apply(
    "laps",
    row({
      lap_number: 1,
      lap_duration: 90,
      duration_sector_1: 30,
      duration_sector_2: 29,
      duration_sector_3: 31,
    }),
  );
  s.apply(
    "laps",
    row({
      lap_number: 2,
      lap_duration: null,
      duration_sector_1: null,
      duration_sector_2: null,
      duration_sector_3: null,
      date: "2026-09-11T12:02:00Z",
    }),
  );
  assert.deepEqual(s.state.drivers[44].sectors, [null, null, 31]);
  s.apply(
    "laps",
    row({
      lap_number: 2,
      lap_duration: null,
      duration_sector_1: 29,
      duration_sector_2: null,
      duration_sector_3: null,
      date: "2026-09-11T12:02:30Z",
    }),
  );
  assert.deepEqual(s.state.drivers[44].sectors, [29, null, null]);
});
test("late flag messages cannot replace the chequered flag after the finish", () => {
  const s = state();
  s.apply(
    "race_control",
    row({ message: "SESSION FINISHED", flag: "CHEQUERED" }),
  );
  s.apply(
    "race_control",
    row({
      date: "2026-09-11T12:02:00Z",
      message: "YELLOW IN TRACK SECTOR 4",
      flag: "YELLOW",
      scope: "Sector",
      sector: 4,
    }),
  );
  assert.equal(s.state.status, "finished");
  assert.equal(s.state.flag, "CHEQUERED");
  assert.deepEqual(s.state.yellowSectors, []);
});
test("restoring a finished snapshot clears a stale caution flag", () => {
  const restored = new LiveState({
    status: "finished",
    flag: "YELLOW",
    yellowSectors: [4],
  });
  assert.equal(restored.state.flag, "CHEQUERED");
  assert.deepEqual(restored.state.yellowSectors, []);
});
test("official non-running results remove the marker without removing the driver", () => {
  for (const [field, status] of [
    ["dnf", "DNF"],
    ["dns", "DNS"],
    ["dsq", "DSQ"],
  ]) {
    const s = state();
    s.apply("location", row({ svgX: 10, svgY: 20 }));
    s.apply("session_result", row({ [field]: true }));
    s.apply("laps", row({ lap_number: 2, lap_duration: 91 }));
    assert.equal(s.state.drivers[44].status, status);
    assert.equal(s.state.locations[44], undefined);
  }
});
test("Replay rebuild preserves an existing identity and radio text using saved race mapping", async () => {
  const existingId = "5a1aab76-f8bd-404e-8952-b71182712009";
  const writes = [];
  const data = {
    sessions: null,
    races: { id: "race-1", circuit_id: "track-1", season_year: 2026 },
    race_replay_sessions: { id: existingId },
    live_events: [],
    live_location: [],
    live_car_data: [],
    live_radio_text: [
      {
        id: "radio-1",
        timestamp: "2026-09-11T12:01:00Z",
        driver_number: 44,
        original: "Box",
        ru: "В боксы",
        status: "ready",
      },
    ],
  };
  const db = {
    from: (table) => {
      const query = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        maybeSingle: async () => ({ data: data[table], error: null }),
        single: async () => ({ data: data[table], error: null }),
        range: async () => ({ data: data[table], error: null }),
        upsert(rows) {
          writes.push({ table, rows });
          return this;
        },
        update(rows) {
          writes.push({ table, rows });
          return this;
        },
        then(resolve) {
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  const s = state();
  s.state.track = {};
  s.state.session.race_id = "race-1";
  await buildReplayFromHistory(db, s.state);
  assert.equal(writes[0].rows.id, existingId);
  const final = writes.at(-1).rows;
  assert.equal(final.status, "ready");
  assert.equal(final.snapshot.radio[0].ru, "В боксы");
  assert.equal(final.snapshot.radio[0].offsetMs, 60000);
  assert.equal(final.snapshot.radio[0].recording_url, undefined);
});
test("all weekend modes share capabilities, including Sprint Shootout", () => {
  for (const [name, mode] of [
    ["Practice 1", "practice"],
    ["Practice 2", "practice"],
    ["Practice 3", "practice"],
    ["Qualifying", "qualifying"],
    ["Sprint Qualifying", "sprint_qualifying"],
    ["Sprint Shootout", "sprint_qualifying"],
    ["Sprint", "sprint"],
    ["Race", "race"],
  ])
    assert.equal(sessionMode({ session_name: name }), mode);
  assert.equal(
    sessionCapabilities({ session_name: "Sprint" }).showIntervals,
    true,
  );
  assert.equal(
    sessionCapabilities({ session_name: "Sprint Qualifying" }).showIntervals,
    false,
  );
  assert.equal(
    sessionCapabilities({ session_name: "Qualifying" }).showEliminationZone,
    false,
  );
});
test("finished FP3 becomes waiting for qualifying; active qualifying uses same hub", () => {
  const rows = [
    {
      ...session,
      session_key: 1,
      date_start: "2026-09-11T10:00:00Z",
      date_end: "2026-09-11T11:00:00Z",
    },
    {
      ...session,
      session_key: 2,
      date_start: "2026-09-11T14:00:00Z",
      date_end: "2026-09-11T15:00:00Z",
    },
  ];
  assert.equal(
    chooseSession(rows, Date.parse("2026-09-11T12:00:00Z")).session.session_key,
    2,
  );
  assert.equal(
    chooseSession(rows, Date.parse("2026-09-11T12:00:00Z")).active,
    false,
  );
  assert.equal(
    chooseSession(rows, Date.parse("2026-09-11T14:30:00Z")).active,
    true,
  );
});
test("a session resumed after its scheduled end remains active after restart", () => {
  const practice = {
    ...session,
    date_end: "2026-09-11T13:00:00Z",
  };
  assert.equal(
    sessionStillOngoing(
      practice,
      [
        { date: "2026-09-11T12:50:00Z", message: "RED FLAG" },
        {
          date: "2026-09-11T13:02:00Z",
          message: "SESSION WILL BE TEMPORARILY STOPPED",
        },
        { date: "2026-09-11T13:07:00Z", message: "SESSION RESUMED" },
      ],
      Date.parse("2026-09-11T13:10:00Z"),
    ),
    true,
  );
  assert.equal(
    sessionStillOngoing(
      practice,
      [
        { date: "2026-09-11T13:07:00Z", message: "SESSION RESUMED" },
        { date: "2026-09-11T13:09:00Z", message: "SESSION FINISHED" },
      ],
      Date.parse("2026-09-11T13:10:00Z"),
    ),
    false,
  );
});
test("Malaysia remains ongoing after three hours until its actual Race Control finish", () => {
  const malaysia = {
    ...session, session_key: 11731,
    date_start: "2026-10-04T07:00:00Z",
    date_end: "2026-10-04T09:00:00Z",
  };
  const controls = [
    { date: "2026-10-04T07:00:00Z", message: "SESSION STARTED" },
    { date: "2026-10-04T08:00:00Z", message: "SESSION SUSPENDED" },
    { date: "2026-10-04T08:30:00Z", message: "SESSION RESUMED" },
    { date: "2026-10-04T10:13:59Z", message: "OVERTAKE ENABLED" },
  ];
  assert.equal(sessionStillOngoing(malaysia, controls, Date.parse("2026-10-04T10:15:00Z")), true);
  controls.push({ date: "2026-10-04T10:20:15.170Z", message: "SESSION FINISHED" });
  assert.equal(sessionStillOngoing(malaysia, controls, Date.parse("2026-10-04T10:21:00Z")), false);
});
test("cold start and reconnect retain an extended race instead of the next Grand Prix", async () => {
  const malaysia = { ...session, session_key: 11731,
    date_start: "2026-10-04T07:00:00Z", date_end: "2026-10-04T09:00:00Z" };
  const singapore = { ...session, session_key: 11378,
    date_start: "2026-10-09T08:30:00Z", date_end: "2026-10-09T09:30:00Z" };
  const controls = [
    { date: "2026-10-04T07:00:00Z", message: "SESSION STARTED" },
    { date: "2026-10-04T10:20:15.170Z", message: "SESSION FINISHED" },
  ];
  for (const current of [{}, { currentSession: { ...malaysia }, currentStatus: "live" }]) {
    const choice = await chooseSessionWithControls([malaysia, singapore], {
      ...current, now: Date.parse("2026-10-04T10:15:00Z"),
      loadControls: async () => controls,
    });
    assert.equal(choice.session.session_key, 11731);
    assert.equal(choice.active, true);
  }
  const finished = await chooseSessionWithControls([malaysia, singapore], {
    currentSession: { ...malaysia }, currentStatus: "live",
    now: Date.parse("2026-10-04T10:21:00Z"), loadControls: async () => controls,
  });
  assert.equal(finished.session.session_key, 11378);
  assert.equal(finished.active, false);
});
test("a paused extended race survives missing Race Control during reconnect", async () => {
  const extended = { ...session, date_end: "2026-09-11T13:00:00Z" };
  const next = { ...session, session_key: 2,
    date_start: "2026-09-18T12:00:00Z", date_end: "2026-09-18T13:00:00Z" };
  for (const loadControls of [async () => [], async () => { throw new Error("OpenF1 timeout"); }]) {
    const choice = await chooseSessionWithControls([extended, next], {
      currentSession: { ...extended }, currentStatus: "paused", loadControls,
      now: Date.parse("2026-09-11T15:30:00Z"),
    });
    assert.equal(choice.session.session_key, 1);
    assert.equal(choice.active, true);
  }
});
test("a scheduled next session cannot replace an ongoing one before its actual start", async () => {
  const extended = { ...session, date_end: "2026-09-11T13:00:00Z" };
  const next = { ...session, session_key: 2,
    date_start: "2026-09-11T13:05:00Z", date_end: "2026-09-11T14:00:00Z" };
  let started = false;
  const loadControls = async (key) => key === 1
    ? [{ date: "2026-09-11T12:01:00Z", message: "SESSION STARTED" }]
    : started ? [{ date: "2026-09-11T13:07:00Z", message: "SESSION STARTED" }] : [];
  const options = { currentSession: extended, currentStatus: "live", loadControls,
    now: Date.parse("2026-09-11T13:10:00Z") };
  assert.equal((await chooseSessionWithControls([extended, next], options)).session.session_key, 1);
  started = true;
  assert.equal((await chooseSessionWithControls([extended, next], options)).session.session_key, 2);
});
test("recovery backfills an extended session through now or its actual finish", () => {
  const extended = { ...session, date_start: "2026-10-04T07:00:00Z", date_end: "2026-10-04T09:00:00Z" };
  const now = Date.parse("2026-10-04T10:15:00Z");
  assert.equal(sessionHistoryEnd(extended, [], true, now), now);
  const finished = [{ date: "2026-10-04T10:20:15.170Z", message: "SESSION FINISHED" }];
  assert.equal(sessionHistoryEnd(extended, finished, false, Date.parse("2026-10-04T10:42:00Z")),
    Date.parse("2026-10-04T10:22:15.170Z"));
  assert.equal(sessionHistoryEnd(extended, [], false, Date.parse("2026-10-04T10:42:00Z")),
    Date.parse("2026-10-04T09:02:00Z"));
});
test("future and foreign-session Race Control cannot finish a current race", () => {
  const controls = [
    { date: "2026-09-11T12:01:00Z", message: "SESSION STARTED" },
    { date: "2026-09-11T13:00:00Z", message: "SESSION FINISHED", session_key: 2 },
    { date: "2026-09-11T13:01:00Z", flag: "CHEQUERED", scope: "Driver" },
    { date: "2026-09-11T15:30:00Z", message: "SESSION FINISHED" },
  ];
  assert.equal(sessionStillOngoing(session, controls, Date.parse("2026-09-11T15:00:00Z")), true);
});
test("an aborted session is not restored as ongoing", () => {
  const practice = {
    ...session,
    date_end: "2026-09-11T13:00:00Z",
  };
  assert.equal(
    sessionStillOngoing(
      practice,
      [
        { date: "2026-09-11T13:01:00Z", message: "SESSION RESUMED" },
        { date: "2026-09-11T13:03:00Z", message: "SESSION ABORTED" },
      ],
      Date.parse("2026-09-11T13:05:00Z"),
    ),
    false,
  );
  assert.equal(
    sessionStillOngoing(
      practice,
      [
        { date: "2026-09-11T13:03:00Z", message: "SESSION ABORTED" },
        { date: "2026-09-11T13:07:00Z", message: "SESSION STARTED" },
      ],
      Date.parse("2026-09-11T13:10:00Z"),
    ),
    true,
  );
  assert.equal(
    sessionStillOngoing(
      practice,
      [
        { date: "2026-09-11T13:07:00Z", message: "SESSION STARTED" },
        { date: "2026-09-11T13:09:00Z", flag: "CHEQUERED" },
      ],
      Date.parse("2026-09-11T13:10:00Z"),
    ),
    false,
  );
});
test("late position does not rewind and reconnect does not duplicate events", () => {
  const s = state();
  s.apply("position", row({ position: 2 }));
  s.apply("position", row({ date: "2026-09-11T12:00:00Z", position: 9 }));
  assert.equal(s.state.drivers[44].position, 2);
  const event = row({ message: "YELLOW", flag: "YELLOW" });
  s.apply("race_control", event);
  s.apply("race_control", event);
  assert.equal(s.state.events.length, 1);
});
test("provider metadata does not change event identity or duplicate feeds", () => {
  const first = row({
    driver_number: null,
    message: "SESSION STARTED",
    _key: "mqtt-key",
    _id: "mqtt-id",
  });
  const second = { ...first, _key: "rest-key", _id: "rest-id" };
  assert.equal(
    eventKey("race_control", first),
    eventKey("race_control", second),
  );
  const s = state();
  s.apply("race_control", first);
  s.apply("race_control", second);
  assert.equal(s.state.events.length, 1);
});
test("the same radio timestamp is not duplicated after restoring an older id", () => {
  const s = state();
  s.state.radio = [
    {
      id: "legacy-id",
      driverNumber: 44,
      timestamp: "2026-09-11T12:01:00.123456+00:00",
      status: "failed",
    },
  ];
  s.apply(
    "team_radio",
    normalizeMessage(
      "team_radio",
      row({
        date: "2026-09-11T12:01:00.123000+00:00",
        recording_url: "https://example.test/radio.mp3",
      }),
      session,
    ),
  );
  assert.equal(s.state.radio.length, 1);
  assert.notEqual(s.state.radio[0].id, "legacy-id");
});
test("fresh driver roster removes stale drivers from a restored snapshot", () => {
  const s = state();
  for (const driverNumber of [6, 44]) {
    s.apply("drivers", row({ driver_number: driverNumber }));
    s.apply(
      "location",
      row({ driver_number: driverNumber, svgX: 10, svgY: 20 }),
    );
    s.apply("car_data", row({ driver_number: driverNumber, speed: 100 }));
    s.apply("pit", row({ driver_number: driverNumber, lap_number: 1 }));
  }
  s.state.radio = [
    { driverNumber: 6 },
    { driverNumber: 44 },
    { driverNumber: null },
  ];
  s.retainDrivers([44]);
  assert.deepEqual(Object.keys(s.state.drivers), ["44"]);
  assert.equal(s.state.locations[6], undefined);
  assert.equal(s.state.telemetry[6], undefined);
  assert.deepEqual(
    s.state.pits.map((pit) => pit.driverNumber),
    [44],
  );
  assert.deepEqual(
    s.state.radio.map((radio) => radio.driverNumber),
    [44, null],
  );
});
test("tyre age includes prior use and pit messages do not increment twice", () => {
  const s = state();
  s.apply(
    "stints",
    row({
      stint_number: 1,
      compound: "MEDIUM",
      lap_start: 3,
      tyre_age_at_start: 2,
    }),
  );
  s.apply("laps", row({ lap_number: 8, lap_duration: 90 }));
  assert.equal(s.state.drivers[44].tyreAge, 7);
  const pit = row({ lap_number: 8, lane_duration: 24, stop_duration: 2.4 });
  s.apply("pit", pit);
  s.apply("pit", pit);
  assert.equal(s.state.drivers[44].pitCount, 1);
});
test("a pit with delayed stint data replaces the old tyre age with an estimate", () => {
  const s = state();
  s.apply("stints", row({ stint_number: 4, compound: "SOFT", lap_start: 10, tyre_age_at_start: 0 }));
  s.apply("laps", row({ lap_number: 28 }));
  assert.equal(s.state.drivers[44].tyreAge, 18);
  s.apply("pit", row({ lap_number: 28, lane_duration: 27.9, stop_duration: null }));
  s.apply("laps", row({ lap_number: 29 }));
  assert.equal(s.state.drivers[44].tyreAge, 0);
  assert.equal(s.state.drivers[44].tyreAgeEstimated, true);
  s.apply("laps", row({ lap_number: 36 }));
  // OpenF1 can keep extending the previous stint after a same-compound stop.
  s.apply("stints", row({ stint_number: 4, compound: "SOFT", lap_start: 10, lap_end: 35, tyre_age_at_start: 0 }));
  assert.equal(s.state.drivers[44].tyreAge, 7);
  assert.equal(s.state.drivers[44].tyreAgeEstimated, true);
  const restored = new LiveState(s.snapshot());
  restored.apply("stints", row({ stint_number: 5, compound: "SOFT", lap_start: 29, tyre_age_at_start: 2 }));
  assert.equal(restored.state.drivers[44].tyreAge, 9);
  assert.equal(restored.state.drivers[44].tyreAgeEstimated, false);
  assert.equal(restored.state.events.filter((e) => e.type === "tyre_change").length, 1);
  restored.apply("stints", row({ stint_number: 4, compound: "SOFT", lap_start: 10, lap_end: 36, tyre_age_at_start: 0 }));
  assert.equal(restored.state.drivers[44].tyreAge, 9);
});
test("tyre estimates ignore older pits, drive-throughs and practice returns to the garage", () => {
  const s = state();
  s.apply("stints", row({ stint_number: 2, compound: "SOFT", lap_start: 10, tyre_age_at_start: 3 }));
  s.apply("laps", row({ lap_number: 15 }));
  s.apply("pit", row({ lap_number: 9, lane_duration: 28, stop_duration: 2.5 }));
  s.apply("pit", row({ lap_number: 14, lane_duration: 20, stop_duration: 0, date: "2026-09-11T12:02:00Z" }));
  assert.equal(s.state.drivers[44].tyreAge, 8);
  assert.equal(s.state.drivers[44].tyreAgeEstimated, false);
  s.setSession({ ...session, session_type: "Practice", session_name: "Practice 3" });
  s.apply("stints", row({ stint_number: 1, compound: "SOFT", lap_start: 1, tyre_age_at_start: 3 }));
  s.apply("laps", row({ lap_number: 8 }));
  s.apply("pit", row({ lap_number: 7, lane_duration: 30, stop_duration: 10 }));
  assert.equal(s.state.drivers[44].tyreAge, 10);
  assert.equal(s.state.drivers[44].tyreAgeEstimated, false);
});
test("replay simulation detects same-compound tyre replacements from the age reset", () => {
  const messages = replayMessages({
    sourceSessionKey: 1, drivers: [], raceEvents: [],
    positions: [
      { driverNumber: 44, offsetMs: 0, compound: "SOFT", lapNumber: 28, tyreAge: 18 },
      { driverNumber: 44, offsetMs: 1000, compound: "SOFT", lapNumber: 29, tyreAge: 0 },
      { driverNumber: 44, offsetMs: 2000, compound: "SOFT", lapNumber: 30, tyreAge: 1 },
    ],
  });
  const stints = messages.filter((m) => m.topic === "stints");
  assert.equal(stints.length, 2);
  assert.equal(stints[1].row.lap_start, 29);
  const s = state();
  for (const { topic, row: payload } of messages) s.apply(topic, payload);
  assert.equal(s.state.drivers[44].tyreAge, 1);
  assert.equal(s.state.drivers[44].tyreAgeEstimated, false);
});
test("qualifying phases follow source; Q1 finish is not session finish", () => {
  const s = state();
  s.state.session.session_type = "Qualifying";
  s.state.session.session_name = "Qualifying";
  s.apply(
    "race_control",
    row({ qualifying_phase: 1, message: "SESSION STARTED" }),
  );
  assert.equal(s.state.phase, "Q1");
  s.apply("laps", row({ lap_number: 1, lap_duration: 82 }));
  s.apply(
    "race_control",
    row({
      date: "2026-09-11T12:18:00Z",
      qualifying_phase: 1,
      message: "SESSION FINISHED",
    }),
  );
  assert.notEqual(s.state.status, "finished");
  s.apply(
    "race_control",
    row({
      date: "2026-09-11T12:25:00Z",
      qualifying_phase: 2,
      message: "SESSION STARTED",
    }),
  );
  assert.equal(s.state.phase, "Q2");
  assert.equal(s.state.drivers[44].bestLap, null);
  s.apply(
    "race_control",
    row({
      date: "2026-09-11T13:00:00Z",
      qualifying_phase: 3,
      message: "SESSION FINISHED",
    }),
  );
  assert.equal(s.state.status, "finished");
});
test("qualifying infers three segments and greys six drivers after Q1 and Q2", () => {
  const s = state();
  s.state.session.session_type = "Qualifying";
  s.state.session.session_name = "Qualifying";
  for (let driverNumber = 1; driverNumber <= 22; driverNumber++)
    s.apply(
      "drivers",
      row({ driver_number: driverNumber, name_acronym: `D${driverNumber}` }),
    );
  s.apply(
    "race_control",
    row({
      driver_number: null,
      date: "2026-09-11T12:00:00Z",
      message: "SESSION STARTED",
    }),
  );
  assert.equal(s.state.phase, "Q1");
  assert.equal(s.state.phaseEndsAt, "2026-09-11T12:18:00.000Z");
  s.apply(
    "race_control",
    row({
      driver_number: null,
      date: "2026-09-11T12:05:00Z",
      message: "SESSION WILL BE TEMPORARILY STOPPED",
    }),
  );
  s.apply(
    "race_control",
    row({
      driver_number: null,
      date: "2026-09-11T12:07:00Z",
      message: "SESSION STARTED",
    }),
  );
  assert.equal(s.state.phase, "Q1");
  for (let driverNumber = 1; driverNumber <= 22; driverNumber++) {
    s.state.drivers[driverNumber].bestLap = 80 + driverNumber;
    s.state.drivers[driverNumber].bestByPhase.Q1 = 80 + driverNumber;
  }
  s.apply(
    "race_control",
    row({
      driver_number: null,
      date: "2026-09-11T12:18:00Z",
      message: "SESSION FINISHED",
    }),
  );
  assert.equal(
    Object.values(s.state.drivers).filter(
      (driver) => driver.eliminatedIn === "Q1",
    ).length,
    6,
  );
  s.apply(
    "race_control",
    row({
      driver_number: null,
      date: "2026-09-11T12:25:00Z",
      message: "SESSION STARTED",
    }),
  );
  assert.equal(s.state.phase, "Q2");
  assert.equal(s.state.phaseEndsAt, "2026-09-11T12:40:00.000Z");
  assert.equal(s.state.timerOffsetMs, 0);
  for (let driverNumber = 1; driverNumber <= 16; driverNumber++) {
    s.state.drivers[driverNumber].bestLap = 85 + driverNumber;
    s.state.drivers[driverNumber].bestByPhase.Q2 = 85 + driverNumber;
  }
  s.apply(
    "race_control",
    row({
      driver_number: null,
      date: "2026-09-11T12:40:00Z",
      message: "SESSION FINISHED",
    }),
  );
  assert.equal(
    Object.values(s.state.drivers).filter((driver) => driver.eliminatedIn)
      .length,
    12,
  );
  s.apply(
    "race_control",
    row({
      driver_number: null,
      date: "2026-09-11T12:47:00Z",
      message: "SESSION STARTED",
    }),
  );
  assert.equal(s.state.phase, "Q3");
  assert.equal(s.state.phaseEndsAt, "2026-09-11T12:59:00.000Z");
});
test("temporary session stop freezes the clock and resume extends it", () => {
  const s = state();
  s.apply("drivers", row({ name_acronym: "HAM" }));
  s.state.drivers[44].lap = 1;
  s.state.drivers[44].status = "OUT LAP";
  s.apply("drivers", row({ driver_number: 41, name_acronym: "LIN" }));
  s.apply(
    "race_control",
    row({
      date: "2026-09-11T12:05:00Z",
      flag: "RED",
      message: "RED FLAG",
    }),
  );
  assert.equal(s.state.status, "live");
  assert.equal(s.state.flag, "RED");
  assert.equal(s.state.timerPausedAt, null);
  s.apply(
    "race_control",
    row({
      date: "2026-09-11T12:10:00Z",
      message: "SESSION WILL BE TEMPORARILY STOPPED",
    }),
  );
  assert.equal(s.state.status, "paused");
  assert.equal(s.state.flag, "RED");
  assert.equal(s.state.timerPausedAt, "2026-09-11T12:10:00Z");
  assert.equal(s.state.drivers[44].status, "NO DATA");
  assert.equal(s.state.drivers[41].status, "PIT");
  s.apply(
    "race_control",
    row({
      date: "2026-09-11T12:15:00Z",
      message: "SESSION RESUMED",
    }),
  );
  assert.equal(s.state.status, "live");
  assert.equal(s.state.flag, "GREEN");
  assert.equal(s.state.timerPausedAt, null);
  assert.equal(s.state.timerOffsetMs, 300000);
});
test("aborted practice pauses and a later SESSION STARTED resumes the same session", () => {
  const s = state();
  s.apply(
    "race_control",
    row({
      date: "2026-09-11T12:10:00Z",
      message: "SESSION ABORTED",
    }),
  );
  assert.equal(s.state.status, "paused");
  assert.equal(s.state.flag, "RED");
  assert.equal(s.state.timerPausedAt, "2026-09-11T12:10:00Z");
  assert.equal(s.state.timerOffsetMs, 0);
  assert.equal(s.state.events[0].message, "Сессия остановлена");
  s.apply(
    "race_control",
    row({
      date: "2026-09-11T12:20:00Z",
      message: "SESSION STARTED",
    }),
  );
  assert.equal(s.state.status, "live");
  assert.equal(s.state.flag, "GREEN");
  assert.equal(s.state.timerPausedAt, null);
  assert.equal(s.state.timerOffsetMs, 600000);
});
test("session switch clears timing, locations and dedupe; other sessions ignored", () => {
  const s = state();
  s.apply("position", row({ position: 2 }));
  s.setSession({ ...session, session_key: 2 });
  assert.deepEqual(s.state.drivers, {});
  assert.equal(s.apply("position", row({ position: 1 })), false);
});
test("driver lap history keeps sectors, updates a lap once, and ignores stale corrections", () => {
  const s = state();
  s.apply(
    "laps",
    row({
      lap_number: 1,
      lap_duration: 90,
      duration_sector_1: 30,
      duration_sector_2: 31,
      duration_sector_3: 29,
    }),
  );
  s.apply(
    "laps",
    row({ date: "2026-09-11T12:03:00Z", lap_number: 2, lap_duration: 89 }),
  );
  s.apply(
    "laps",
    row({ date: "2026-09-11T12:04:00Z", lap_number: 1, lap_duration: 90.1 }),
  );
  s.apply(
    "laps",
    row({ date: "2026-09-11T12:02:00Z", lap_number: 1, lap_duration: 95 }),
  );
  const history = s.state.drivers[44].lapHistory;
  assert.equal(history.length, 2);
  assert.deepEqual(
    history.map((lap) => lap.lap),
    [1, 2],
  );
  assert.equal(history[0].duration, 90.1);
  assert.equal(s.state.drivers[44].lap, 2);
});
test("map transform matches the existing Replay coordinate system", () => {
  const track = {
    worldBounds: { minX: -100, minY: -200 },
    transform: { offsetX: 20, offsetY: 30, scale: 2, invertY: true },
    svg: { viewBox: { height: 720 } },
    centerline: [],
  };
  assert.deepEqual(mapLocation(track, row({ x: 0, y: 0, z: 1 })), {
    x: 220,
    y: 290,
    z: 1,
    progress: 0,
    pitLaneProgress: null,
    timestamp: row().date,
  });
});
test("undated stints have stable dedupe and are preserved in history", () => {
  const r = {
    session_key: 1,
    driver_number: 44,
    stint_number: 1,
    compound: "SOFT",
    lap_start: 1,
  };
  const a = normalizeMessage("stints", r, session, 1000),
    b = normalizeMessage("stints", r, session, 2000);
  assert.equal(eventKey("stints", a), eventKey("stints", b));
  assert.equal(historyRow("stints", a).table, "live_events");
});
test("hydration respects source timeline and lap completion", () => {
  const messages = hydrationMessages(
    new Map([
      [
        "laps",
        [
          {
            session_key: 1,
            driver_number: 44,
            lap_number: 1,
            date_start: session.date_start,
            lap_duration: 90,
          },
        ],
      ],
      [
        "stints",
        [{ session_key: 1, driver_number: 44, lap_start: 1, compound: "SOFT" }],
      ],
    ]),
    session,
  );
  assert.equal(messages[0][0], "stints");
  assert.equal(
    Date.parse(messages[1][1].date) - Date.parse(session.date_start),
    90000,
  );
});
test("radio has no audio or source URL in persistence", () => {
  assert.equal(
    historyRow(
      "team_radio",
      row({ recording_url: "https://livetiming.formula1.com/a.mp3" }),
    ),
    null,
  );
  assert.equal(allowedRecording("https://example.com/a.mp3"), false);
  assert.equal(allowedRecording("http://127.0.0.1/a.mp3"), false);
});
test("audio buffer is zeroed when transcription fails", async () => {
  const audio = Buffer.from("private temporary audio");
  await assert.rejects(() =>
    transcribeRadio("https://livetiming.formula1.com/a.mp3", {
      fetchAudioImpl: async () => audio,
      fetchImpl: async () => ({ ok: false, status: 500 }),
    }),
  );
  assert.ok(audio.every((x) => x === 0));
});
test("radio uses the requested transcription model, translates and records both costs", async () => {
  const audio = Buffer.from("temporary audio");
  const calls = [],
    usage = [];
  const result = await transcribeRadio(
    "https://livetiming.formula1.com/a.mp3",
    {
      fetchAudioImpl: async () => audio,
      fetchImpl: async (url, options) => {
        calls.push({ url, body: JSON.parse(options.body) });
        return {
          ok: true,
          json: async () =>
            calls.length === 1
              ? { text: "Box this lap", usage: { cost: 0.01 } }
              : {
                  choices: [
                    { message: { content: "Заезжай в боксы на этом круге" } },
                  ],
                  usage: { cost: 0.002 },
                },
        };
      },
      onUsage: async (...args) => usage.push(args),
    },
  );
  assert.equal(calls[0].body.model, "openai/gpt-transcribe");
  assert.equal(calls[0].body.input_audio.format, "mp3");
  assert.equal(calls[1].body.messages[1].content, "Box this lap");
  assert.equal(calls[1].body.model, "openai/gpt-6-luna");
  assert.equal(calls[1].body.reasoning.effort, "none");
  assert.equal(result.cost, 0.012);
  assert.equal(usage.length, 2);
  assert.ok(audio.every((x) => x === 0));
});
test("radio checks the shared budget before each paid request and stops translation when denied", async () => {
  const audio = Buffer.from("temporary audio");
  const stages = [];
  let paidRequests = 0;
  await assert.rejects(() => transcribeRadio("https://livetiming.formula1.com/a.mp3", {
    fetchAudioImpl: async () => audio,
    beforePaidRequest: async purpose => {
      stages.push(purpose);
      if (purpose === "live_radio_translation") throw new Error("AI_BUDGET_EXCEEDED");
    },
    fetchImpl: async () => {
      paidRequests += 1;
      return { ok: true, json: async () => ({ text: "Box this lap", usage: { cost: 0.01 } }) };
    },
    onUsage: async () => stages.push("usage_saved"),
  }), /AI_BUDGET_EXCEEDED/);
  assert.equal(paidRequests, 1);
  assert.deepEqual(stages, ["live_radio_transcription", "usage_saved", "live_radio_translation"]);
  assert.ok(audio.every(value => value === 0));
});

test("radio makes no paid request when the budget guard fails", async () => {
  const audio = Buffer.from("temporary audio");
  await assert.rejects(() => transcribeRadio("https://livetiming.formula1.com/a.mp3", {
    fetchAudioImpl: async () => audio,
    beforePaidRequest: async () => { throw new Error("Budget unavailable"); },
    fetchImpl: async () => { assert.fail("Paid request must not run"); },
  }), /Budget unavailable/);
  assert.ok(audio.every(value => value === 0));
});

test("radio usage reaches the budget database before processing can continue", async () => {
  let written;
  const writer = new LiveWriter({ from: table => {
    assert.equal(table, "ai_usage_logs");
    return { insert: row => ({ abortSignal: async () => { written = row; return { error: null }; } }) };
  } }, "unused-fixture-directory");
  await writer.recordUsage({ usage: { cost: 0.03, input_tokens: 10 } }, "model", "live_radio_transcription");
  assert.equal(written.estimated_cost_usd, 0.03);
  assert.equal(written.purpose, "live_radio_transcription");
  assert.equal(writer.pending.length, 0, "the persisted cost is not written twice by the spool");
});

test("failed radio accounting preserves the charge for the spool and rejects continuation", async () => {
  const writer = new LiveWriter({ from: () => ({ insert: () => ({ abortSignal: async () => ({ error: new Error("accounting offline") }) }) }) }, "unused-fixture-directory");
  await assert.rejects(writer.recordUsage({ usage: { cost: 0.03 } }, "model", "live_radio_transcription"), /accounting offline/);
  assert.equal(writer.pending.length, 1);
  assert.equal(writer.pending[0].table, "ai_usage_logs");
  assert.equal(writer.pending[0].row.estimated_cost_usd, 0.03);
});
test("SC ending clears on a global TRACK CLEAR while deployed SC stays active", () => {
  const s = state();
  s.apply("race_control", row({ message: "SAFETY CAR DEPLOYED" }));
  s.apply(
    "race_control",
    row({ message: "SAFETY CAR IN THIS LAP", date: "2026-09-11T12:02:00Z" }),
  );
  assert.equal(s.state.flag, "SC_ENDING");
  s.apply(
    "race_control",
    row({
      message: "TRACK CLEAR",
      flag: "CLEAR",
      scope: "Track",
      date: "2026-09-11T12:02:30Z",
    }),
  );
  assert.equal(s.state.flag, "GREEN");
  s.apply(
    "race_control",
    row({
      message: "GREEN FLAG",
      flag: "GREEN",
      scope: "Track",
      date: "2026-09-11T12:03:00Z",
    }),
  );
  assert.equal(s.state.flag, "GREEN");
  s.apply(
    "race_control",
    row({ message: "SAFETY CAR DEPLOYED", date: "2026-09-11T12:04:00Z" }),
  );
  s.apply(
    "race_control",
    row({
      message: "TRACK CLEAR",
      scope: "Track",
      date: "2026-09-11T12:05:00Z",
    }),
  );
  assert.equal(s.state.flag, "SC");
  s.apply(
    "race_control",
    row({
      message: "VIRTUAL SAFETY CAR DEPLOYED",
      date: "2026-09-11T12:06:00Z",
    }),
  );
  assert.equal(s.state.flag, "VSC");
  s.apply(
    "race_control",
    row({
      message: "VIRTUAL SAFETY CAR ENDING",
      date: "2026-09-11T12:07:00Z",
    }),
  );
  assert.equal(s.state.flag, "GREEN");
});
test("stewards yellow references do not activate a flag and SC keeps priority", () => {
  const infringement =
    "FIA STEWARDS: INCIDENT INVOLVING CAR 14 (ALO) WILL BE INVESTIGATED AFTER THE RACE - YELLOW FLAG INFRINGEMENT";
  assert.equal(replayRaceControlFlag(infringement), null);
  assert.equal(replayRaceControlFlag("YELLOW IN TRACK SECTOR 7"), "YELLOW");

  const s = state();
  s.apply("race_control", row({ message: infringement, flag: "YELLOW" }));
  assert.notEqual(s.state.flag, "YELLOW");
  assert.equal(s.state.events[0].type, "stewards");

  s.apply(
    "race_control",
    row({ message: "SAFETY CAR DEPLOYED", date: "2026-09-11T12:02:00Z" }),
  );
  s.apply(
    "race_control",
    row({
      message: "YELLOW IN TRACK SECTOR 7",
      flag: "YELLOW",
      scope: "Sector",
      sector: 7,
      date: "2026-09-11T12:03:00Z",
    }),
  );
  assert.equal(s.state.flag, "SC");
  assert.deepEqual(s.state.yellowSectors, [7]);
  s.apply(
    "race_control",
    row({
      message: "CLEAR IN TRACK SECTOR 7",
      flag: "CLEAR",
      scope: "Sector",
      sector: 7,
      date: "2026-09-11T12:04:00Z",
    }),
  );
  assert.equal(s.state.flag, "SC");
  assert.deepEqual(s.state.yellowSectors, []);
});
test("red flag overrides the safety car and restart returns to green", () => {
  const s = state();
  s.apply("race_control", row({ message: "SAFETY CAR DEPLOYED" }));
  s.apply(
    "race_control",
    row({
      message: "RED FLAG - RACE SUSPENDED",
      flag: null,
      date: "2026-09-11T12:02:00Z",
    }),
  );
  assert.equal(s.state.flag, "RED");
  s.apply(
    "race_control",
    row({
      message: "TRACK CLEAR",
      date: "2026-09-11T12:03:00Z",
    }),
  );
  assert.equal(s.state.flag, "RED");
  s.apply(
    "race_control",
    row({
      message: "SESSION STARTED",
      date: "2026-09-11T12:30:00Z",
    }),
  );
  assert.equal(s.state.flag, "GREEN");
});
test("sector yellow clears only after every affected sector is clear", () => {
  const s = state();
  s.apply(
    "race_control",
    row({
      message: "DOUBLE YELLOW IN TRACK SECTOR 8",
      flag: "DOUBLE YELLOW",
      scope: "Sector",
      sector: 8,
    }),
  );
  s.apply(
    "race_control",
    row({
      message: "YELLOW IN TRACK SECTOR 7",
      flag: "YELLOW",
      scope: "Sector",
      sector: 7,
      date: "2026-09-11T12:01:00Z",
    }),
  );
  assert.equal(s.state.flag, "YELLOW");
  assert.deepEqual(s.state.yellowSectors, [7, 8]);
  assert.equal(s.state.trackSectorCount, 8);
  s.apply(
    "race_control",
    row({
      message: "CLEAR IN TRACK SECTOR 7",
      flag: "CLEAR",
      scope: "Sector",
      sector: 7,
      date: "2026-09-11T12:02:00Z",
    }),
  );
  assert.equal(s.state.flag, "YELLOW");
  assert.deepEqual(s.state.yellowSectors, [8]);
  s.apply(
    "race_control",
    row({
      message: "CLEAR IN TRACK SECTOR 8",
      flag: "CLEAR",
      scope: "Sector",
      sector: 8,
      date: "2026-09-11T12:03:00Z",
    }),
  );
  assert.equal(s.state.flag, "GREEN");
  assert.deepEqual(s.state.yellowSectors, []);
});
test("future qualifying announcement cannot prematurely reset current best laps", () => {
  const s = state();
  s.state.session.session_type = "Qualifying";
  s.state.session.session_name = "Qualifying";
  s.apply(
    "race_control",
    row({ qualifying_phase: 1, message: "SESSION STARTED" }),
  );
  s.apply("laps", row({ lap_number: 1, lap_duration: 82 }));
  s.apply(
    "race_control",
    row({ message: "Q2 WILL START AT 12:25", date: "2026-09-11T12:20:00Z" }),
  );
  assert.equal(s.state.phase, "Q1");
  assert.equal(s.state.drivers[44].bestLap, 82);
});
test("simulator accepts practice and sprint qualifying metadata", () => {
  for (const name of ["Practice 2", "Sprint Qualifying"]) {
    const source = new ReplaySimulationSource({
      replay: { sourceSessionKey: 3, durationMs: 60000 },
      onMessage: () => {},
      onConnection: () => {},
      session: {
        sessionType: name,
        sessionName: name,
        sessionStart: session.date_start,
        sessionEnd: session.date_end,
      },
    });
    assert.equal(source.session.session_name, name);
    assert.equal(source.session.date_start, session.date_start);
    assert.equal(sessionCapabilities(source.session).rankByLapTime, true);
  }
});
test("drain includes messages arriving during an in-flight database write", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raceside-live-drain-"));
  let release, entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const saved = [];
  let block = true;
  const db = {
    from: (table) => ({
      upsert: async (rows) => {
        if (block) {
          block = false;
          entered();
          await gate;
        }
        if (table === "live_location") saved.push(...rows);
        return { error: null };
      },
    }),
  };
  try {
    const writer = new LiveWriter(db, directory),
      s = state();
    writer.enqueue("location", row({ x: 1, y: 2 }));
    const flushing = writer.flush(s.state);
    await started;
    writer.enqueue(
      "location",
      row({ date: "2026-09-11T12:02:00Z", x: 3, y: 4 }),
    );
    const draining = writer.drain(s.state);
    release();
    await Promise.all([flushing, draining]);
    assert.equal(saved.length, 2);
    assert.equal(writer.pending.length, 0);
    assert.equal((await readdir(directory)).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("durable batches survive DB outage and retry idempotently", async () => {
  const directory = await mkdtemp(join(tmpdir(), "raceside-live-test-"));
  let fail = true;
  const writes = [];
  const db = {
    from: (table) => ({
      upsert: async (rows) => {
        if (fail) return { error: { code: "offline" } };
        writes.push({ table, rows });
        return { error: null };
      },
    }),
  };
  try {
    const w = new LiveWriter(db, directory);
    const s = state();
    w.enqueue("location", row({ x: 1, y: 2, z: 3 }));
    await assert.rejects(() => w.flush(s.state));
    assert.equal(
      (await readdir(directory)).filter((x) => x.endsWith(".json")).length,
      1,
    );
    fail = false;
    const restarted = new LiveWriter(db, directory);
    await restarted.flush(s.state);
    assert.equal((await readdir(directory)).length, 0);
    assert.ok(writes.some((x) => x.table === "live_location"));
    assert.equal(restarted.healthy, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("tyre set history preserves same-compound replacements, corrections and restarts", () => {
  const s = state();
  s.apply("stints", row({ stint_number: 1, lap_start: 1, lap_end: 18, compound: "SOFT", tyre_age_at_start: 3 }));
  s.apply("stints", row({ stint_number: 2, lap_start: 19, compound: "SOFT", tyre_age_at_start: 0, date: "2026-09-11T12:30:00Z" }));
  s.apply("stints", row({ stint_number: 1, lap_start: 1, lap_end: 19, compound: "SOFT", tyre_age_at_start: 3, date: "2026-09-11T12:31:00Z" }));
  assert.equal(s.state.stints.length, 2);
  assert.equal(s.state.stints.find((stint) => stint.stintNumber === 1).endLap, 19);
  assert.equal(s.state.drivers[44].stintNumber, 2);
  const restored = new LiveState(s.snapshot());
  assert.deepEqual(restored.state.stints, s.state.stints);
  restored.apply("stints", row({ stint_number: 1, lap_start: 1, lap_end: 18, date: "2026-09-11T12:00:00Z" }));
  restored.retainDrivers([1]);
  assert.equal(restored.state.stints.length, 0);
  s.setSession({ ...session, session_key: 2 });
  assert.equal(s.state.stints.length, 0);
});
