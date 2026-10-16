import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { paceDistribution, paceDistributionDomain, paceDistributionCsv, paceShareUrl, isPaceLap } from "./race-pace.ts";

const driver = (number, code = "NOR") => ({ number, code, color: "#ff8700", name: code });
const point = (lap, time, extra = {}) => ({ driver: 4, lap, time, tyreAge: null, stint: 1,
  compound: "HARD", clean: true, reasons: [], trend: 1, ...extra });
const data = (times) => ({ totalLaps: times.length + 1, drivers: [driver(4)], points: times.map((time, i) => point(i+2,time)) });
const filters = { hidePits: true, hideSafetyCar: true };
const close = (a, b) => assert.ok(Math.abs(a-b) < 1e-10, `${a} != ${b}`);

test("box plot has interpolated quartiles, measured whiskers and retained outliers", () => {
  const source = data([80,81,82,83,84,85,86,110]);
  const before = structuredClone(source);
  const [row] = paceDistribution(source, "ALL", filters);
  assert.equal(row.count, 8);
  assert.equal(row.mean, 86.375);
  assert.equal(row.median, 83.5);
  assert.equal(row.q1, 81.75); assert.equal(row.q3, 85.25);
  assert.equal(row.low, 80); assert.equal(row.high, 86);
  assert.deepEqual(row.outliers, [{ lap: 9, time: 110 }]);
  close(row.deviation, Math.sqrt(83.234375));
  assert.deepEqual(source, before);
  assert.ok(row.points.every((p) => p.tyreAge === null));
  assert.deepEqual(paceDistributionDomain([row]), [79,111]);
});

test("one/two laps and equal times stay finite, without inventing spread or observations", () => {
  const [single] = paceDistribution(data([80]), "ALL", filters);
  assert.deepEqual([single.mean,single.median,single.q1,single.q3,single.low,single.high], [80,80,80,80,80,80]);
  assert.equal(single.deviation, 0); assert.equal(single.count, 1);
  const [pair] = paceDistribution(data([80,90]), "ALL", filters);
  assert.equal(pair.mean,85); assert.equal(pair.median,85); assert.equal(pair.deviation,5);
  assert.equal(pair.q1,82.5); assert.equal(pair.q3,87.5);
  const [same] = paceDistribution(data([80,80,80,80,80,100]), "ALL", filters);
  assert.equal(same.low,80); assert.equal(same.high,80);
  assert.deepEqual(same.outliers, [{ lap:7,time:100 }]);
});

test("statistics use raw laps, range, tyres and safety filters; pit/red/invalid laps always stay out", () => {
  const source = { totalLaps: 30, drivers: [driver(4)], points: [point(2,80),point(3,82),point(4,100,{ reasons:["SC"], clean:false }),
    ...["START","PIT_IN","PIT_OUT","RED","DELETED","INCOMPLETE"].map((reason,i)=>point(i+5,200,{reasons:[reason]})),
    point(11,90,{compound:"SOFT"}),point(12,NaN),point(13,Infinity),point(14,-1),point(15,0),point(16,null)] };
  assert.deepEqual(paceDistribution(source,"ALL",filters)[0].points.map(p=>p.lap),[2,3,11]);
  assert.deepEqual(paceDistribution(source,"HARD",{...filters,hideSafetyCar:false})[0].points.map(p=>p.lap),[2,3,4]);
  const [row] = paceDistribution(source,"ALL",{...filters,lapRange:[3,11]});
  assert.equal(row.mean,86); assert.equal(row.median,86);
  assert.deepEqual(paceDistribution(source,[],filters),[]);
  assert.deepEqual(paceDistribution(source,"ALL",filters,[]),[]);
});

test("ranking is by median with deterministic ties, not finishing position or mean", () => {
  const source = { totalLaps: 6, drivers: [driver(4,"NOR"),driver(16,"LEC"),driver(44,"HAM")],
    points:[point(2,80),point(3,80),point(4,120), ...[16,44].flatMap(driver=>[point(2,81,{driver}),point(3,81,{driver})])] };
  assert.deepEqual(paceDistribution(source,"ALL",filters).map(r=>r.driver.code),["NOR","HAM","LEC"]);
  assert.deepEqual(paceDistribution(source,"ALL",filters,[16]).map(r=>r.driver.code),["LEC"]);
});

test("distribution links preserve scope/range, and CSV exports the exact summary with safe text", () => {
  const rows = paceDistribution(data([80,82]),"ALL",filters);
  rows[0].driver.code = '=SUM(1,2)';
  const csv = paceDistributionCsv(rows);
  assert.equal(csv.split("\r\n").length,2);
  assert.ok(csv.includes('"\'=SUM(1,2)"') && csv.includes('"2","81","81","1"'));
  const url = new URL(paceShareUrl("https://raceside.test",{id:1,season:2026,meetingId:2}, {
    axis:"age",compound:"ALL",drivers:[],hidePits:true,hideSafetyCar:true,trend:true,field:false,
    section:"distribution",distributionScope:"field",lapRange:[4,8],
  }));
  assert.equal(url.searchParams.get("view"),"distribution");
  assert.equal(url.searchParams.get("scope"),"field");
  assert.equal(url.searchParams.get("from"),"4");
});

test("Singapore, Malaysia and Monza preserve every eligible measured lap under multiple filters", () => {
  const races = [...JSON.parse(readFileSync(new URL("../../../../docs/telemetry/fixtures/race-pace-distribution-2026.json", import.meta.url))),
    JSON.parse(readFileSync(new URL("../../../../docs/telemetry/fixtures/race-pace-monza-2025.json", import.meta.url)))];
  for (const race of races) for (const hideSafetyCar of [true,false]) for (const compounds of ["ALL",["HARD"]]) for (const lapRange of [[1,race.totalLaps],[10,30]]) {
    const rows = paceDistribution(race,compounds,{hidePits:true,hideSafetyCar,lapRange});
    const expected = race.points.filter(p=>isPaceLap(p) && p.lap>=lapRange[0] && p.lap<=lapRange[1]
      && (!hideSafetyCar || !p.reasons.some(r=>r==="SC"||r==="VSC")) && (compounds==="ALL"||compounds.includes(p.compound)));
    assert.equal(rows.reduce((n,r)=>n+r.count,0),expected.length);
    for (const row of rows) {
      const laps = expected.filter(p=>p.driver===row.driver.number);
      const sorted = laps.map(p=>p.time).sort((a,b)=>a-b), middle = Math.floor(sorted.length/2);
      close(row.median, sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2);
      assert.ok(row.low<=row.q1 && row.high>=row.q3 || row.count===1);
      assert.ok(Number.isFinite(row.deviation));
    }
  }
});
