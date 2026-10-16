import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGrandPrixRecapData,
  getGrandPrixRecapImageLayout,
  getGrandPrixRecapStrategyLayout,
  sanitizeStationaryPitDuration,
} from "./grand-prix-recap.ts";

const race = {
  id: "race-austria",
  season: 2026,
  round: 8,
  race: "Austrian Grand Prix",
  circuit: "Red Bull Ring",
  country: "Austria",
  countryFlag: "🇦🇹",
  locality: "Spielberg",
  startsAt: "вс, 28 июн., 16:00",
  startsAtIso: "2026-06-28T13:00:00.000Z",
  status: "Завершен",
  timezone: "Europe/Vienna",
  layout: { provider: "openf1", sourceSessionKey: 1, svgPath: "M0 0L10 10", viewBox: "0 0 10 10" },
  trackMapUrl: "/f1/circuits/2026/08-austria.webp",
};

const report = {
  id: "report-austria",
  season: 2026,
  round: 8,
  raceSlug: "2026-austria",
  raceName: "Austrian Grand Prix",
  circuitName: "Red Bull Ring",
  country: "Austria",
  raceDate: "28 июня",
  status: "ready",
  summaryStatus: "generated",
  weather: { averageAirTemperature: 24.2, rainfall: false },
  raceStatistics: { yellowFlagCount: 2, safetyCarCount: 1, virtualSafetyCarCount: 0, redFlagCount: 0 },
  results: [],
  keyEvents: [],
  pitStops: [],
  strategies: [
    strategy("George Russell", ["MEDIUM", "HARD", "HARD"]),
    strategy("Andrea Kimi Antonelli", ["MEDIUM", "HARD", "HARD"]),
    strategy("Carlos Sainz", ["SOFT", "MEDIUM", "HARD"]),
  ],
  teammateComparisons: [],
  highlights: {
    fastestLap: { driver: "Carlos Sainz", time: "1:06.502" },
    fastestPitStop: { team: "Racing Bulls", duration: 2.03 },
    mostCommonStrategy: { sequence: "MEDIUM-HARD", drivers: 8 },
  },
  championshipImpact: {},
  newsSummary: {},
  sourceErrors: {},
  generatedAt: "Недавно",
};

const raceResults = [
  result(1, "George Russell", "george-russell", "Mercedes", 1, 25, "1:28:00.000"),
  result(2, "Andrea Kimi Antonelli", "andrea-kimi-antonelli", "Mercedes", 3, 18, "+4.812"),
  result(3, "Carlos Sainz", "carlos-sainz", "Williams", 10, 15, "+8.431", { bestLap: "1:06.502", bestLapNumber: 68 }),
];
const qualifyingResults = [result(1, "George Russell", "george-russell", "Mercedes", 1, 0, "1:02.976")];
const sprintResults = [
  result(1, "Andrea Kimi Antonelli", "andrea-kimi-antonelli", "Mercedes", 1, 8, "30:00.000"),
  result(2, "George Russell", "george-russell", "Mercedes", 2, 7, "+1.200"),
  result(3, "Carlos Sainz", "carlos-sainz", "Williams", 3, 6, "+2.400"),
];

test("keeps breakthrough in the highlight and adds the sprint top three", () => {
  const data = buildGrandPrixRecapData({
    race,
    report,
    sessions: sessions(true),
    resultsBySession: new Map([
      ["race", raceResults],
      ["qualifying", qualifyingResults],
      ["sprint", sprintResults],
    ]),
  });

  assert.ok(data);
  assert.equal(data.heroHighlight?.label, "Прорыв дня");
  assert.equal(data.heroHighlight?.driver, "Carlos Sainz");
  assert.deepEqual(data.sprintPodium?.map((entry) => entry.driver), [
    "Andrea Kimi Antonelli",
    "George Russell",
    "Carlos Sainz",
  ]);
  assert.equal(data.bestTeam.name, "Mercedes");
  assert.equal(data.bestTeam.points, 58);
  assert.equal(data.bestTeam.pointsLabel, "Гонка + спринт");
});

test("returns the two most used tyre strategies", () => {
  const data = buildGrandPrixRecapData({
    race,
    report,
    sessions: sessions(false),
    resultsBySession: new Map([
      ["race", raceResults],
      ["qualifying", qualifyingResults],
    ]),
  });

  assert.ok(data);
  assert.deepEqual(data.strategies, [
    { drivers: 2, sequence: ["MEDIUM", "HARD", "HARD"] },
    { drivers: 1, sequence: ["SOFT", "MEDIUM", "HARD"] },
  ]);
});

test("uses the current-season team profile car in the generated card", () => {
  const data = buildGrandPrixRecapData({
    race,
    report,
    sessions: sessions(false),
    resultsBySession: new Map([
      ["race", raceResults],
      ["qualifying", qualifyingResults],
    ]),
    teamProfiles: [{
      id: "mercedes-2026",
      slug: "mercedes",
      name: "Mercedes-AMG Petronas",
      shortName: "Mercedes",
      code: "MER",
      country: "Germany",
      color: "#27F4D2",
      carImageUrl: "/f1/teams/cars/2026/mercedes.webp",
      season: 2026,
      championshipPosition: 1,
      points: 0,
      wins: 0,
    }],
  });

  assert.ok(data);
  assert.equal(data.bestTeam.carImagePath, "/f1/teams/cars/2026/mercedes.webp");
  assert.equal(data.podium[0].avatarPath, "/drivers/avatars/2026/george-russell.webp");
  assert.equal(data.track.imagePath, "/f1/circuits/2026/08-austria.webp");
});

test("keeps a versioned track asset as a local share-image path", () => {
  const data = buildGrandPrixRecapData({
    race: {
      ...race,
      trackMapUrl: "/f1/circuits/2026/13-italy.webp?v=590e479f06f4",
    },
    report,
    sessions: sessions(false),
    resultsBySession: new Map([
      ["race", raceResults],
      ["qualifying", qualifyingResults],
    ]),
  });

  assert.ok(data);
  assert.equal(data.track.imagePath, "/f1/circuits/2026/13-italy.webp");
});

test("uses breakthrough of the day when the weekend has no sprint", () => {
  const data = buildGrandPrixRecapData({
    race,
    report,
    sessions: sessions(false),
    resultsBySession: new Map([
      ["race", raceResults],
      ["qualifying", qualifyingResults],
    ]),
  });

  assert.ok(data);
  assert.equal(data.heroHighlight?.label, "Прорыв дня");
  assert.equal(data.heroHighlight?.driver, "Carlos Sainz");
  assert.equal(data.heroHighlight?.value, "+7 позиций · финиш P3");
});

test("keeps the winner gap empty and formats gaps for second and third", () => {
  const data = buildGrandPrixRecapData({
    race,
    report,
    sessions: sessions(true),
    resultsBySession: new Map([
      ["race", raceResults],
      ["qualifying", qualifyingResults],
      ["sprint", sprintResults],
    ]),
  });

  assert.ok(data);
  assert.equal(data.podium[0].gapToWinner, null);
  assert.equal(data.podium[0].raceTime, "1 ч 28 мин 00,000 с");
  assert.equal(data.podium[1].gapToWinner, "+4,812 с");
  assert.equal(data.podium[2].gapToWinner, "+8,431 с");
});

test("rejects pit-lane durations as stationary pit stops", () => {
  assert.equal(sanitizeStationaryPitDuration(2.08), 2.08);
  assert.equal(sanitizeStationaryPitDuration(22.159), null);
  assert.equal(sanitizeStationaryPitDuration(null), null);
});

test("shows only the official team in the fastest pit-stop block", () => {
  const data = buildGrandPrixRecapData({
    race,
    report,
    sessions: sessions(false),
    resultsBySession: new Map([
      ["race", raceResults],
      ["qualifying", qualifyingResults],
    ]),
  });

  assert.ok(data);
  assert.deepEqual(data.fastestPitStop, {
    duration: 2.03,
    team: "Racing Bulls",
  });
});

test("passes race-only flag event counts to the generated card", () => {
  const data = buildGrandPrixRecapData({
    race,
    report,
    sessions: sessions(false),
    resultsBySession: new Map([
      ["race", raceResults],
      ["qualifying", qualifyingResults],
    ]),
  });

  assert.ok(data);
  assert.deepEqual(data.raceFlow, {
    yellowFlags: 2,
    safetyCars: 1,
    virtualSafetyCars: 0,
    redFlags: 0,
  });
});

test("keeps the approved 4:5 card and a smaller single-line race title", () => {
  const regular = getGrandPrixRecapImageLayout("Гран-при Австрии");
  const silverstone = getGrandPrixRecapImageLayout("Гран-при Великобритании");
  const zandvoort = getGrandPrixRecapImageLayout("Гран-при Нидерландов");

  assert.equal(regular.titleFontSize, 44);
  assert.equal(silverstone.titleFontSize, 44);
  assert.equal(zandvoort.titleFontSize, 44);
  assert.equal(regular.canvasHeight, 1350);
  assert.equal(silverstone.canvasHeight, regular.canvasHeight);
  assert.equal(zandvoort.canvasHeight, silverstone.canvasHeight);
  assert.equal(silverstone.heroHeight, regular.heroHeight);
  assert.equal(silverstone.titleMetaMarginTop, regular.titleMetaMarginTop);
});

test("shares the whole field and the exact after-round championship, without fabricating absent timing", () => {
  const field = Array.from({ length: 22 }, (_, index) => result(
    index + 1, `Driver ${index + 1}`, `driver-${index + 1}`, index % 2 ? "Williams" : "Mercedes",
    index + 1, index < 10 ? 10 - index : 0, index ? `+${index}.000` : "1:28:00.000",
    { driverNumber: index + 1, status: index >= 19 ? "Retired" : index === 18 ? "+1 Lap" : "Finished" },
  ));
  const championship = [1, 2, 3].map((position) => ({ id: String(position), name: `Leader ${position}`, position, points: 400 - position * 10, team: "Mercedes" }));
  const analytics = {
    totalLaps: 71,
    drivers: [{ number: 1, driver: "Different display name", code: "VER", positions: [{ lap: 1, value: 2 }, { lap: 2, value: null }, { lap: 3, value: 1 }] }],
    championship: { drivers: championship, teams: [] },
  };
  const data = buildGrandPrixRecapData({ race, report, sessions: sessions(false), resultsBySession: new Map([["race", field]]), analytics });
  assert.equal(data.positionDrivers.length, 22);
  assert.equal(data.positionDrivers[0].code, "VER");
  assert.deepEqual(data.positionDrivers[0].points, analytics.drivers[0].positions);
  assert.deepEqual(data.positionDrivers[1].points, []);
  assert.equal(data.classification.length, 10);
  assert.deepEqual(data.championship, championship);
  assert.equal(data.totalLaps, 71);
  assert.equal(data.finishers, 19);
  assert.equal(data.retirements, 3);
  assert.equal(data.starters, 22);
  assert.equal(data.podium[0].points, field[0].points);
});

test("keeps missing points unknown and excludes a retired driver from position gains", () => {
  const data = buildGrandPrixRecapData({
    race, report, sessions: sessions(false), resultsBySession: new Map([["race", [
      ...raceResults.map((row, index) => ({ ...row, points: index === 1 ? null : row.points })),
      result(4, "Retired Driver", "retired-driver", "Williams", 22, 0, "Без времени", { status: "Engine" }),
    ]]]),
  });
  assert.equal(data.bestTeam.pointsComplete, false);
  assert.equal(data.podium[1].points, null);
  assert.deepEqual(data.positionGain, { driver: "Carlos Sainz", gained: 7 });
  assert.deepEqual(data.championship, []);
  assert.ok(data.positionDrivers.every((driver) => driver.points.length === 0));
});

test("Singapore finishers include all eight lapped pilots, independently of completed lap count", () => {
  const field = Array.from({ length: 22 }, (_, index) => result(
    index + 1, `Driver ${index + 1}`, `driver-${index + 1}`, "Mercedes",
    index + 1, index < 10 ? 10 - index : 0, index ? `+${index}.000` : "1:42:00.785",
    {
      driverNumber: index + 1,
      status: index < 10 ? "Finished" : index === 17 || index >= 19 ? "Retired" : "Lapped",
      laps: [62, 62, 62, 62, 62, 62, 62, 62, 62, 62, 61, 61, 61, 61, 61, 61, 60, 59, 59, 36, 29, 7][index],
    },
  ));
  const data = buildGrandPrixRecapData({ race, report, sessions: sessions(false), resultsBySession: new Map([["race", field]]) });
  assert.equal(data.finishers, 18);
  assert.equal(data.retirements, 4);
  assert.equal(data.starters, 22);
  assert.equal(data.positionDrivers[17].finished, false, "Albon retired after 59 laps");
  assert.equal(data.positionDrivers[18].finished, true, "Bottas finished after the same 59 laps");
  assert.equal(data.positionDrivers.filter((driver) => !driver.finished).length, 4);
});

test("only finishing statuses count, including lapped finishes and excluding late retirements", () => {
  for (const [status, finished] of [
    ["Finished", true], ["Classified", true], ["Lapped", true], ["  lApPeD  ", true],
    ["+1 Lap", true], ["+2 Laps", true], ["Финиш", true], ["Классифицирован", true],
    ["Retired", false], ["DNF", false], ["DNS", false], ["DSQ", false],
    ["Engine", false], ["Not classified", false], ["Disqualified", false],
  ]) {
    const data = buildGrandPrixRecapData({
      race, report, sessions: sessions(false),
      resultsBySession: new Map([["race", [...raceResults,
        result(4, "Fourth Driver", "fourth-driver", "Williams", 22, 0, "Без времени", { status, laps: finished ? 69 : 71 }),
      ]]]),
    });
    assert.equal(data.finishers, finished ? 4 : 3, status);
    assert.equal(data.retirements, finished ? 0 : 1, status);
    assert.equal(data.positionDrivers[3].finished, finished, status);
    assert.equal(data.positionGain.driver, finished ? "Fourth Driver" : "Carlos Sainz", status);
  }
});

test("chooses the quickest valid lap when the report highlight is absent", () => {
  const data = buildGrandPrixRecapData({
    race, report: { ...report, highlights: {} }, sessions: sessions(false),
    resultsBySession: new Map([["race", raceResults.map((row, index) => ({ ...row, bestLap: index === 0 ? "1:08.100" : index === 1 ? "1:06.400" : "Без времени" }))]]),
  });
  assert.equal(data.fastestLap.driver, "Andrea Kimi Antonelli");
  assert.equal(data.fastestLap.time, "1:06.400");
});

test("fits two four-stop strategies into the fixed card grid", () => {
  const layout = getGrandPrixRecapStrategyLayout(4);

  assert.ok(layout.estimatedWidth <= 375);
  assert.ok(layout.tyreSize >= 36);
});

function sessions(hasSprint) {
  return [
    { id: "qualifying", type: "qualifying", name: "Квалификация", startsAt: "", status: "Завершена" },
    ...(hasSprint ? [{ id: "sprint", type: "sprint", name: "Спринт", startsAt: "", status: "Завершена" }] : []),
    { id: "race", type: "race", name: "Гонка", startsAt: "", status: "Завершена" },
  ];
}

function result(position, driver, driverSlug, team, grid, points, time, extra = {}) {
  return {
    position,
    driver,
    driverSlug,
    team,
    teamColor: team === "Mercedes" ? "#27F4D2" : "#64C4FF",
    time,
    status: "Finished",
    grid,
    laps: 71,
    points,
    ...extra,
  };
}

function strategy(driver, compounds) {
  return {
    driver,
    stints: compounds.map((compound, index) => ({
      compound,
      startLap: index * 20 + 1,
      endLap: (index + 1) * 20,
    })),
  };
}
