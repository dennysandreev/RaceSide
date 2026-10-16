import test from "node:test";
import assert from "node:assert/strict";
import { paceSeries, paceCsv, paceShareUrl, paceValue, paceShareCompounds, selectedCompounds, togglePaceCompound, parsePaceLapRange, paceLapRange } from "./race-pace.ts";
const point = (lap, extra = {}) => ({
  driver: 4,
  lap,
  tyreAge: lap + 4,
  time: 80,
  stint: 1,
  compound: "MEDIUM",
  clean: true,
  reasons: [],
  trend: null,
  ...extra,
});
const data = {
  totalLaps: 9,
  drivers: [{ number: 4, code: "NOR" }],
  points: [
    point(2),
    point(3),
    point(4, { clean: false, reasons: ["PIT_IN"] }),
    point(5, { stint: 2, tyreAge: 0, compound: "HARD" }),
    point(6, { stint: 2, tyreAge: 1, compound: "HARD" }),
    point(8, { stint: 2, tyreAge: 3, compound: "HARD" }),
    point(9, { tyreAge: null, stint: 2, compound: "HARD" }),
  ],
};
test("race range is inclusive and uses chronological laps on both axes", () => {
  for (const axis of ["lap", "age"]) {
    const selected = paceSeries(data, axis, "ALL", { hidePits: true, hideSafetyCar: true, lapRange: [3, 6] }).flatMap(s => s.points);
    assert.deepEqual(selected.map(p => p.lap), [3,5,6]);
    assert.deepEqual(selected.map(p => p.x), axis === "age" ? [7,0,1] : [3,5,6]);
    const csv = paceCsv(selected, data.drivers);
    assert.equal(csv.split("\r\n").length - 1, 3);
    assert.ok(!csv.includes('"NOR","2"') && !csv.includes('"NOR","8"'));
  }
});
test("range parsing rejects invalid links and clamps saved ranges to actual race length", () => {
  assert.deepEqual(parsePaceLapRange("30", "10"), [10,30]);
  for (const values of [[null, "5"], ["2", null], ["NaN", "4"], ["2.5", "4"], ["0", "8"], ["1", "1000001"]])
    assert.equal(parsePaceLapRange(...values), undefined);
  assert.deepEqual(paceLapRange(9, [5,30]), [5,9]);
  assert.deepEqual(paceLapRange(9, [30,40]), [9,9]);
  assert.deepEqual(paceLapRange(9, [8,2]), [2,8]);
  assert.deepEqual(paceLapRange(9, [NaN,8]), [1,9]);
  assert.deepEqual(paceLapRange(9), [1,9]);
  assert.deepEqual(paceLapRange(0), [1,1]);
});
test("range edges keep actual times rather than smoothing with laps outside the selection", () => {
  const source = { totalLaps: 5, drivers: data.drivers,
    points: [point(2, {time: 80}), point(3, {time: 100}), point(4, {time: 82}), point(5, {time: 83})] };
  const segment = paceSeries(source, "lap", "ALL", { hidePits: true, hideSafetyCar: true, lapRange: [3,5] })[0];
  assert.deepEqual(segment.points.map(p => p.trend), [null,83,null]);
  assert.equal(paceValue(segment.points[0], true), 100);
  assert.deepEqual(paceSeries(source, "lap", "ALL", { hidePits: true, hideSafetyCar: true, lapRange: [3,3] })[0].points.map(p => p.lap), [3]);
});
test("all tyres includes every known compound and unknowns; individual selection remains explicit", () => {
  const all = selectedCompounds("ALL");
  assert.deepEqual(all, ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET", "UNKNOWN"]);
  const withoutHard = togglePaceCompound(all, "HARD");
  assert.deepEqual(withoutHard, ["SOFT", "MEDIUM", "INTERMEDIATE", "WET"]);
  assert.deepEqual(togglePaceCompound([], "WET"), ["WET"]);
  assert.deepEqual(togglePaceCompound(["WET"], "WET"), []);
  assert.equal(selectedCompounds("ALL").length, 6);
});
test("PNG shows only selected tyres, with one symbol for the complete all-tyres preset", () => {
  assert.deepEqual(paceShareCompounds(selectedCompounds("ALL")), ["ALL"]);
  assert.deepEqual(paceShareCompounds(["HARD", "WET"]), ["HARD", "WET"]);
  assert.deepEqual(paceShareCompounds(["HARD", "INVALID", "HARD"]), ["HARD"]);
  assert.deepEqual(paceShareCompounds([]), []);
  // All five known compounds must not imply that unknown tyres are included.
  assert.deepEqual(paceShareCompounds(["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"]),
    ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"]);
});
test("chart keeps stints and gaps separate, preserves used tyre age, omits unknown age", () => {
  const series = paceSeries(data, "age", "ALL", {
    hidePits: true,
    hideSafetyCar: true,
  });
  assert.deepEqual(
    series.map((item) => item.points.map((p) => p.x)),
    [[6, 7], [0, 1], [3]],
  );
  assert.deepEqual(
    paceSeries(data, "lap", "MEDIUM", {
      hidePits: false,
      hideSafetyCar: false,
    }).map((item) => item.points.map((p) => p.lap)),
    [[2, 3]],
  );
  assert.equal(
    paceSeries(data, "lap", "ALL", { hidePits: true, hideSafetyCar: true })
      .at(-1)
      .points.at(-1).lap,
    9,
  );
});
test("CSV exports raw seconds, reasons and unknown values with quoted fields", () => {
  const csv = paceCsv([data.points[2], data.points[6]], data.drivers);
  assert.ok(csv.startsWith("\uFEFFПилот"));
  assert.ok(
    !csv.includes('"NOR","4"'),
  );
  assert.ok(csv.includes('"NOR","9","80","HARD","","2"'));
});

test("CSV escapes external codes that spreadsheets could interpret as formulas", () => {
  assert.ok(
    paceCsv([data.points[0]], [{ number: 4, code: "=1+1" }]).includes(
      `"'=1+1"`,
    ),
  );
});

test("pit laps are always excluded; safety is optional and RED never returns", () => {
  const source = {
    drivers: data.drivers,
    points: [
      point(2),
      point(3, { clean: false, reasons: ["PIT_OUT"] }),
      point(4, { clean: false, reasons: ["SC"] }),
      point(5, { clean: false, reasons: ["VSC"] }),
      point(6, { reasons: ["RED"] }),
      point(7, { reasons: ["DELETED"] }),
      point(8, { reasons: ["INCOMPLETE"] }),
      point(9),
    ],
  };
  const laps = (filters) =>
    paceSeries(source, "lap", "ALL", filters).flatMap((s) =>
      s.points.map((p) => p.lap),
    );
  assert.deepEqual(laps({ hidePits: true, hideSafetyCar: true }), [2, 9]);
  assert.deepEqual(laps({ hidePits: false, hideSafetyCar: true }), [2, 9]);
  assert.deepEqual(
    laps({ hidePits: true, hideSafetyCar: false }),
    [2, 4, 5, 9],
  );
  assert.deepEqual(
    laps({ hidePits: false, hideSafetyCar: false }),
    [2, 4, 5, 9],
  );
  assert.ok(!paceCsv(source.points, source.drivers).includes('"6","80"'));
});

test("smoothing is recomputed, preserves raw outliers and never crosses filtered gaps", () => {
  const source = {
    drivers: data.drivers,
    points: [
      point(2, { time: 81, trend: 999 }),
      point(3, { time: 100 }),
      point(4, { time: 82 }),
      point(5, { time: 170, clean: false, reasons: ["SC"] }),
      point(6),
      point(7),
      point(8),
    ],
  };
  const series = paceSeries(source, "lap", "ALL", {
    hidePits: true,
    hideSafetyCar: true,
  });
  assert.equal(series[0].points[1].time, 100);
  assert.equal(series[0].points[1].trend, 82);
  assert.equal(series[0].points[0].trend, null);
  assert.equal(series[1].points[0].trend, null);
  const all = paceSeries(source, "lap", "ALL", {
    hidePits: false,
    hideSafetyCar: false,
  })[0];
  assert.ok(
    all.points
      .filter((p) => [4, 5, 6].includes(p.lap))
      .every((p) => p.trend === null),
  );
});

test("share link contains independent filters, session and exact driver selection", () => {
  const url = new URL(
    paceShareUrl(
      "https://raceside.app",
      { id: 11245, season: 2026, meetingId: 1280 },
      {
        axis: "age",
        compound: "HARD",
        drivers: [4, 63],
        hidePits: true,
        hideSafetyCar: false,
        trend: false,
        field: false,
        lapRange: [10,30],
      },
    ),
  );
  assert.equal(url.pathname, "/telemetry");
  assert.equal(url.searchParams.get("session"), "11245");
  assert.equal(url.searchParams.get("drivers"), "4,63");
  assert.equal(url.searchParams.get("pits"), "1");
  assert.equal(url.searchParams.get("safety"), "0");
  assert.equal(url.searchParams.get("axis"), "age");
  assert.deepEqual(parsePaceLapRange(url.searchParams.get("from"), url.searchParams.get("to")), [10,30]);
  assert.ok(!url.searchParams.has("clean") && !url.searchParams.has("scale"));
});

 test("tyre toggles allow multiple compounds and an empty selection", () => {
  const filters = { hidePits: true, hideSafetyCar: true };
  assert.deepEqual(paceSeries(data, "lap", ["SOFT", "HARD"], filters).flatMap(s=>s.points).map(p=>p.lap), [5,6,8,9]);
  assert.deepEqual(paceSeries(data, "lap", [], filters), []);
 });
 test("smoothed values replace raw values, with actual endpoints where no median exists", () => {
   assert.equal(paceValue(point(3,{time:100,trend:82}),true),82);
   assert.equal(paceValue(point(3,{time:100,trend:82}),false),100);
   assert.equal(paceValue(point(3,{time:100}),true),100);
 });
