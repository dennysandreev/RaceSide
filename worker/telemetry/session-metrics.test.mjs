import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bestSessionLaps, sessionLapMetrics } from "./session-metrics.mjs";
import { buildSessionPace, buildRacePace } from "./race-pace.mjs";
import { TelemetryService, resultKey, validateTask } from "./service.mjs";

const start=Date.parse("2025-01-01T12:00:00Z");
const driver={number:4,code:"NOR",team:"McLaren"};
const lap=(number,extra={})=>({id:`1:4:${number}`,sessionId:1,driverNumber:4,number,start:new Date(start+(number-1)*10000).toISOString(),time:10,complete:true,validityKnown:true,status:["GREEN"],pitIn:false,pitOut:false,deleted:false,...extra});
const catalog=(laps,extra={})=>({session:{id:1,type:"Practice",name:"Practice 2",circuit:"Mexico City",season:2026,end:"2025-01-01T13:00:00Z"},drivers:[driver],laps,raceControl:[],...extra});
const sample=(seconds,speed=200,throttle=100)=>({date:new Date(start+seconds*1000).toISOString(),speed,throttle});

test("real Mexico practices and Monza qualifying agree with independently clipped measurements",()=>{
  const fixture=JSON.parse(readFileSync(new URL("../../docs/telemetry/fixtures/session-metrics-2026.json",import.meta.url)));
  assert.equal(new Set(fixture.cases.map(c=>c.session.id)).size,3);
  for(const c of fixture.cases){
    const metric=sessionLapMetrics(c.driver,c.lap,c.samples,c.circuitLength);
    assert.equal(metric.topSpeed,c.expected.topSpeed);
    assert.equal(metric.fullThrottle,c.expected.fullThrottle);
    assert.equal(metric.averageSpeed,c.expected.averageSpeed);
    const from=Date.parse(c.lap.start),to=from+c.lap.time*1000;
    const directMax=Math.max(...c.samples.filter(s=>Date.parse(s.date)>=from&&Date.parse(s.date)<=to&&s.speed>=0&&s.speed<=400).map(s=>s.speed));
    assert.equal(metric.topSpeed,directMax);
    let full=0,known=0;
    for(let i=1;i<c.samples.length;i++){
      const a=c.samples[i-1],b=c.samples[i],gap=Date.parse(b.date)-Date.parse(a.date);
      const duration=Math.max(0,Math.min(to,Date.parse(b.date))-Math.max(from,Date.parse(a.date)));
      if(gap>1500||a.throttle==null||a.throttle<0||a.throttle>100)continue;
      known+=duration;if(a.throttle>=99)full+=duration;
    }
    if(metric.fullThrottle!=null)assert.ok(Math.abs(metric.fullThrottle-full/known*100)<1e-9);
    assert.ok(metric.speedCoverage>=.97);
  }
});

test("full throttle is time weighted, clipped to the lap and independent of sample frequency",()=>{
  const raw=[sample(-.2,390,0),sample(0,200,100),sample(.1,201,0),sample(1.1,205,100)];
  for(let t=2.1;t<10;t++)raw.push(sample(t,210,100));
  raw.push(sample(10,220,0),sample(10.2,399,100));
  const m=sessionLapMetrics(driver,lap(1),raw,5000);
  assert.equal(m.topSpeed,220);
  assert.equal(m.fullThrottle,90);
  assert.equal(m.averageSpeed,1800);
  assert.equal(m.speedCoverage,1);
  assert.equal(m.state,"ready");
  assert.notEqual(m.fullThrottle,raw.filter(r=>r.throttle>=99).length/raw.length*100);
});
test("unknown throttle and long gaps cannot become zero or full throttle",()=>{
  const raw=Array.from({length:11},(_,i)=>sample(i,200,i===4?null:100));
  const unknown=sessionLapMetrics(driver,lap(1),raw);
  assert.equal(unknown.throttleCoverage,.9);
  assert.equal(unknown.topSpeed,200);
  assert.equal(unknown.fullThrottle,null);
  const gap=sessionLapMetrics(driver,lap(1),raw.filter((_,i)=>i<3||i>6));
  assert.equal(gap.topSpeed,null);
  assert.equal(gap.fullThrottle,null);
  assert.equal(gap.averageSpeed,null);
  assert.equal(sessionLapMetrics(driver,null,raw).state,"no-lap");
});
test("a constant-speed lap agrees with a direct time integral; 99% is full throttle",()=>{
  const m=sessionLapMetrics(driver,lap(1),Array.from({length:21},(_,i)=>sample(i*.5,250,i%2?99:100)));
  assert.equal(m.averageSpeed,250);
  assert.equal(m.fullThrottle,100);
  assert.equal(m.averageMethod,"telemetry");
  assert.equal(sessionLapMetrics(driver,lap(1),[sample(0,250),sample(10,250)]).topSpeed,null);
});
test("practice and qualifying keep a first flying lap and the flying lap after a pit out",()=>{
  const c=catalog([lap(1,{pitIn:true,pitOut:true,time:90}),lap(2,{time:8,officialBest:true,officialBestTime:8}),lap(3,{time:9})]);
  assert.equal(bestSessionLaps(c)[0].lap.number,2);
  assert.ok(!buildSessionPace(c).points.find(p=>p.lap===2).reasons.includes("PIT_OUT"));
  assert.ok(!buildSessionPace(catalog([lap(1)])).points[0].reasons.includes("START"));
  assert.throws(()=>buildRacePace(c),/RACE_PACE_ONLY/);
  const race=catalog([lap(1)],{session:{...c.session,name:"Race",type:"Race"}});
  assert.ok(buildRacePace(race).points[0].reasons.includes("START"));
});
test("resuming practice after a red flag does not become a safety-car restart",()=>{
  const c=catalog([lap(1),lap(2),lap(3)],{raceControl:[
    {date:new Date(start+11000).toISOString(),flag:"RED",scope:"Track",message:"RED FLAG"},
    {date:new Date(start+19000).toISOString(),category:"SessionStatus",message:"SESSION STARTED"},
  ]});
  const pace=buildSessionPace(c);
  assert.equal(pace.points.some(p=>p.lap===2),false);
  assert.equal(pace.points.find(p=>p.lap===3).reasons.includes("SC"),false);
});
test("best-lap selection rejects deleted, neutralised, unconfirmed and impossibly fast laps",()=>{
  const c=catalog([lap(1,{time:2,deleted:true}),lap(2,{time:3,status:["VSC"]}),lap(3,{time:4,officialBestTime:8}),lap(4,{time:5,validityKnown:false}),lap(5,{time:8,officialBest:true}),lap(6,{time:9})]);
  assert.equal(bestSessionLaps(c)[0].lap.number,5);
  const c2=catalog([lap(1,{validityKnown:false})]);
  assert.equal(bestSessionLaps(c2)[0].lap,null);
});
test("session tasks use separate versioned caches and validate their scope",()=>{
  const tasks=["race-pace","session-pace","session-metrics"].map(kind=>({kind,session:1}));
  assert.equal(new Set(tasks.map(resultKey)).size,3);
  tasks.forEach(t=>assert.deepEqual(validateTask(t),t));
  for(const session of [0,-1,1.2,"1",1000001])assert.throws(()=>validateTask({kind:"session-metrics",session}),/INVALID_TASK/);
});
test("a source outage is retryable and never cached as an empty successful session",async()=>{
  const c=catalog([lap(1)]),puts=[];
  const service=new TelemetryService({store:{get:async()=>null,put:async(k)=>puts.push(k)},provider:{getCatalog:async()=>c,getTelemetry:async()=>{throw new Error("timeout");}}});
  await assert.rejects(service.prepare({kind:"session-metrics",session:1}),/PROVIDER_UNAVAILABLE/);
  assert.ok(!puts.includes(resultKey({kind:"session-metrics",session:1})));
});
test("metrics reuse car samples without GPS, bound concurrency and retry partial failures",async()=>{
  const drivers=Array.from({length:5},(_,i)=>({...driver,number:i+1}));
  const c=catalog(drivers.map(d=>lap(1,{driverNumber:d.number,id:`1:${d.number}:1`})),{drivers});
  const cache=new Map(), puts=[]; let running=0,peak=0,calls=0;
  const service=new TelemetryService({store:{get:async k=>cache.get(k),put:async(k,v,ttl)=>{cache.set(k,v);puts.push({k,ttl});}},provider:{getCatalog:async()=>c,getTelemetry:async(s,d)=>{
    calls++;running++;peak=Math.max(peak,running);await new Promise(r=>setTimeout(r,2));running--;
    if(d===3)throw new Error("PROVIDER_UNAVAILABLE");
    return Array.from({length:11},(_,i)=>sample(i));
  },getLocations:()=>{throw new Error("GPS must not be requested");}}});
  const data=await service.prepare({kind:"session-metrics",session:1});
  assert.equal(peak,2);assert.equal(calls,5);assert.equal(data.laps.length,5);
  assert.equal(data.laps.find(r=>r.driver.number===3).topSpeed,null);
  assert.equal(puts.find(p=>p.k===resultKey({kind:"session-metrics",session:1})).ttl,300000);
  assert.ok(!puts.some(p=>p.k.startsWith("raw:")));
  assert.equal(await service.prepare({kind:"session-metrics",session:1}),data);
  const l=c.laps[0], {hash}=await import("./store.mjs");
  cache.set(`raw:telemetry-3:${l.id}:${hash([l.start,l.time]).slice(0,16)}`,{samples:[sample(0)]});
  assert.deepEqual(await service.carSamples(l),[sample(0)]);
});
