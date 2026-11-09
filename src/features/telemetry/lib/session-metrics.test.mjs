import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { teamSessionLaps, sessionMetricRows, sessionMetricsCsv, metricMapLayout } from "./session-metrics.ts";
import { paceShareUrl } from "./race-pace.ts";

const row=(number,team,time,extra={})=>({driver:{number,team,code:`D${number}`},lap:{number,time},topSpeed:350,averageSpeed:195,fullThrottle:40,speedCoverage:1,throttleCoverage:1,averageMethod:"circuit-length",...extra});
test("Mexico race with missing team metadata still opens both team charts and CSV",()=>{
  const {data}=JSON.parse(readFileSync(new URL("../../../../docs/telemetry/fixtures/session-metrics-mexico-race-2026.json",import.meta.url)));
  const original=structuredClone(data);
  const unknown=data.laps.find(r=>r.driver.number===50);
  assert.equal(unknown.driver.team,null);
  assert.equal(sessionMetricRows(data,"speed").length,22);
  assert.ok(sessionMetricRows(data,"speed").includes(unknown));
  const knownTeams=new Set(data.laps.flatMap(r=>r.driver.team?[r.driver.team.trim().toLowerCase()]:[]));
  for(const metric of ["throttle","map"]){
    const rows=sessionMetricRows(data,metric);
    assert.equal(rows.length,knownTeams.size);
    assert.ok(rows.every(r=>r.driver.team?.trim()));
    assert.ok(!rows.includes(unknown));
    assert.doesNotThrow(()=>sessionMetricsCsv(data,metric));
    assert.ok(metricMapLayout(rows).every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
  }
  assert.deepEqual(data,original);
});
test("absent team names never create a guessed shared team",()=>{
  const data={laps:[row(1,null,70),row(2,undefined,71),row(3,"  ",72),row(4," Team ",80),row(5,"team",81)]};
  assert.deepEqual(teamSessionLaps(data).map(r=>r.driver.number),[4]);
  assert.equal(sessionMetricRows(data,"speed").length,5);
  assert.deepEqual(teamSessionLaps({laps:data.laps.slice(0,3)}),[]);
});
test("a shared metric link preserves the session and selected chart",()=>{
  const url=new URL(paceShareUrl("https://raceside.online",{id:1,season:2026,meetingId:2},{axis:"lap",compound:"ALL",drivers:[],hidePits:true,hideSafetyCar:true,trend:true,field:false,section:"metrics",metric:"map"}));
  assert.equal(url.searchParams.get("view"),"metrics");
  assert.equal(url.searchParams.get("metric"),"map");
  assert.equal(url.searchParams.get("mode"),"session-telemetry");
});
test("team metrics all come from one fastest lap, even when the other driver has a higher maximum",()=>{
  const fast=row(1,"Team",80,{topSpeed:340,fullThrottle:null}),slow=row(2,"Team",81,{topSpeed:360,fullThrottle:70});
  assert.deepEqual(teamSessionLaps({laps:[slow,fast]}),[fast]);
  assert.deepEqual(sessionMetricRows({laps:[fast,slow]},"speed"),[slow,fast]);
  assert.equal(sessionMetricRows({laps:[fast,slow]},"throttle")[0].fullThrottle,null);
});
test("CSV preserves missing values, full precision and chosen-lap context; formulas are escaped",()=>{
  const csv=sessionMetricsCsv({laps:[row(1,'=FORMULA',80,{topSpeed:null,fullThrottle:40.123456})]},"speed");
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=FORMULA"'));
  assert.ok(csv.includes('"40.123456"'));
  assert.ok(!csv.includes('"null"'));
});
test("coincident map points keep distinct labels inside the drawing",()=>{
  const points=metricMapLayout(Array.from({length:11},(_,i)=>row(i+1,"Team "+i,80)));
  assert.equal(new Set(points.map(p=>`${p.labelX}:${p.labelY}`)).size,11);
  for(const p of points){assert.ok(p.labelX>=62&&p.labelX<=966);assert.ok(p.labelY>=32&&p.labelY<=362);}
});
