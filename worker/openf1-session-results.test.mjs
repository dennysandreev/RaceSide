import assert from "node:assert/strict";
import test from "node:test";

import {
  getOpenF1ResultStatus,
  getOpenF1ResultTimeText,
  getOpenF1ParticipantIdentity,
  hasFinalOpenF1SessionSignal,
  isOpenF1ClassificationReady,
  isOpenF1ResultProbeDue,
  normalizeLiveRaceClassification,
  normalizeOpenF1SessionKey,
  normalizeOpenF1SessionClassification,
} from "./openf1-session-results.mjs";

test("accepts only a real positive OpenF1 session key", () => {
  assert.equal(normalizeOpenF1SessionKey("11369"), 11369);
  assert.equal(normalizeOpenF1SessionKey(null), null);
  assert.equal(normalizeOpenF1SessionKey(undefined), null);
  assert.equal(normalizeOpenF1SessionKey(0), null);
});

test("normalizes a complete practice classification", () => {
  const payload = Array.from({ length: 20 }, (_, index) => ({
    driver_number: index + 1,
    duration: 90.123 + index / 10,
    gap_to_leader: index / 10,
    number_of_laps: 24 - (index % 3),
    position: index + 1,
  }));
  const results = normalizeOpenF1SessionClassification(payload, "fp2");

  assert.equal(results.length, 20);
  assert.equal(results[0].timeText, "1:30.123");
  assert.equal(results[0].status, "Лучшее время");
  assert.equal(isOpenF1ClassificationReady(results), true);
});

test("builds a provisional race classification from the final live snapshot", () => {
  const drivers = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => {
      const position = index + 1;
      return [
        position,
        {
          driverNumber: position,
          position,
          lap: position < 15 ? 57 : 56,
          gap: position === 1 ? 0 : position < 15 ? position / 10 : "+1 LAP",
          interval: position === 1 ? 0 : 0.5,
          status: position === 20 ? "DNF" : "PIT",
        },
      ];
    }),
  );
  drivers.ghost = {
    driverNumber: 99,
    position: null,
    lap: 0,
    status: "NO DATA",
  };
  const results = normalizeLiveRaceClassification({ drivers });
  assert.equal(isOpenF1ClassificationReady(results, { minimumRows: 20 }), true);
  assert.equal(results[0].timeText, null);
  assert.equal(results[1].timeText, "+0.200");
  assert.equal(results[14].timeText, "+1 LAP");
  assert.equal(results[19].classifiedPosition, "DNF");
  assert.equal(results[19].rawPayload.provisional, true);
});

test("builds a stable identity for a reserve driver from the session roster", () => {
  assert.deepEqual(
    getOpenF1ParticipantIdentity({
      driver_number: 72,
      first_name: "Frederik",
      last_name: "VESTI",
      full_name: "Frederik VESTI",
      name_acronym: "VES",
      team_name: "Mercedes",
      headshot_url: null,
    }),
    {
      driverNumber: 72,
      firstName: "Frederik",
      lastName: "Vesti",
      fullName: "Frederik Vesti",
      code: "VES",
      externalId: "openf1-driver:frederik-vesti",
      slug: "frederik-vesti",
      teamName: "Mercedes",
      headshotUrl: null,
    },
  );
});

test("uses the final qualifying segment reached by each driver", () => {
  const row = {
    driver_number: 4,
    duration: [82.111, 81.222, 80.333],
    gap_to_leader: [0.4, 0.2, 0.1],
    number_of_laps: 18,
    position: 2,
  };

  assert.equal(getOpenF1ResultTimeText(row, "qualifying"), "1:20.333");
  assert.equal(getOpenF1ResultStatus(row, "qualifying"), "Q3");
  assert.equal(
    getOpenF1ResultStatus(
      { ...row, duration: [82.111, null, null] },
      "qualifying",
    ),
    "Q1",
  );
});

test("formats race winner time and gaps without inventing points", () => {
  assert.equal(
    getOpenF1ResultTimeText(
      { position: 1, duration: 5_421.456, gap_to_leader: 0 },
      "race",
    ),
    "1:30:21.456",
  );
  assert.equal(
    getOpenF1ResultTimeText(
      { position: 2, duration: 5_425, gap_to_leader: 3.544 },
      "race",
    ),
    "+3.544",
  );
  assert.equal(
    getOpenF1ResultTimeText({ position: 15, gap_to_leader: "+1 LAP" }, "race"),
    "+1 LAP",
  );
});

test("keeps official OpenF1 championship points in a race classification", () => {
  const results = normalizeOpenF1SessionClassification(
    [
      {
        driver_number: 12,
        position: 1,
        number_of_laps: 57,
        points: 25,
      },
      {
        driver_number: 4,
        position: 2,
        number_of_laps: 57,
        points: 18,
      },
      {
        driver_number: 27,
        position: 11,
        number_of_laps: 56,
        points: 0,
      },
    ],
    "race",
  );

  assert.deepEqual(
    results.map(({ driverNumber, points }) => ({ driverNumber, points })),
    [
      { driverNumber: 12, points: 25 },
      { driverNumber: 4, points: 18 },
      { driverNumber: 27, points: 0 },
    ],
  );
});

test("keeps unclassified race retirements in a complete classification", () => {
  const classified = Array.from({ length: 19 }, (_, index) => ({
    driver_number: index + 1,
    position: index + 1,
    number_of_laps: 53 - Math.floor(index / 10),
    dnf: false,
    dns: false,
    dsq: false,
  }));
  const retirements = [
    { driver_number: 20, position: null, number_of_laps: 26, dnf: true },
    { driver_number: 21, position: null, number_of_laps: 0, dns: true },
    { driver_number: 22, position: null, number_of_laps: 23, dsq: true },
  ];

  const results = normalizeOpenF1SessionClassification(
    [...classified, ...retirements],
    "race",
  );

  assert.equal(results.length, 22);
  assert.equal(isOpenF1ClassificationReady(results, { minimumRows: 20 }), true);
  assert.deepEqual(
    results
      .slice(-3)
      .map(({ driverNumber, position, classifiedPosition, status }) => ({
        driverNumber,
        position,
        classifiedPosition,
        status,
      })),
    [
      {
        driverNumber: 20,
        position: 20,
        classifiedPosition: "DNF",
        status: "DNF",
      },
      {
        driverNumber: 21,
        position: 21,
        classifiedPosition: "DNS",
        status: "DNS",
      },
      {
        driverNumber: 22,
        position: 22,
        classifiedPosition: "DSQ",
        status: "DSQ",
      },
    ],
  );
});

test("does not infer missing positions for timed sessions", () => {
  const results = normalizeOpenF1SessionClassification(
    [
      { driver_number: 1, position: 1, duration: 80 },
      { driver_number: 2, position: null, duration: 81 },
    ],
    "qualifying",
  );

  assert.deepEqual(
    results.map((result) => result.driverNumber),
    [1],
  );
});

test("rejects a partial payload and duplicate driver numbers", () => {
  const partial = normalizeOpenF1SessionClassification(
    [
      { driver_number: 1, position: 1, duration: 80 },
      { driver_number: 1, position: 2, duration: 81 },
      { driver_number: 4, position: 3, duration: 82 },
    ],
    "fp1",
  );

  assert.equal(partial.length, 2);
  assert.equal(isOpenF1ClassificationReady(partial), false);
  assert.equal(
    isOpenF1ClassificationReady([
      ...Array.from({ length: 10 }, (_, index) => ({
        driverNumber: index + 1,
        position: index || 1,
      })),
    ]),
    false,
  );
});

test("waits for the free historical window but allows authenticated sync earlier", () => {
  const endAt = "2026-07-18T12:00:00.000Z";
  const plusFiveMinutes = new Date("2026-07-18T12:05:00.000Z").getTime();
  const plusThirtyTwoMinutes = new Date("2026-07-18T12:32:00.000Z").getTime();

  assert.equal(
    isOpenF1ResultProbeDue({ endAt, nowMs: plusFiveMinutes }),
    false,
  );
  assert.equal(
    isOpenF1ResultProbeDue({ endAt, nowMs: plusThirtyTwoMinutes }),
    true,
  );
  assert.equal(
    isOpenF1ResultProbeDue({
      endAt,
      hasLiveAccess: true,
      nowMs: plusFiveMinutes,
    }),
    true,
  );
});

test("does not treat an aborted and resumed practice as final results", () => {
  const aborted = { date: "2026-09-24T12:18:57Z", message: "SESSION ABORTED" };
  const restarted = { date: "2026-09-24T12:29:00Z", message: "SESSION STARTED" };
  const finished = { date: "2026-09-24T13:04:00Z", message: "SESSION FINISHED" };

  assert.equal(hasFinalOpenF1SessionSignal([aborted]), false);
  assert.equal(hasFinalOpenF1SessionSignal([aborted, restarted]), false);
  assert.equal(hasFinalOpenF1SessionSignal([aborted, restarted, finished]), true);
  assert.equal(
    hasFinalOpenF1SessionSignal([
      { date: "2026-09-24T13:04:00Z", flag: "CHEQUERED" },
    ]),
    true,
  );
});
