import { cleanSamples } from "./core.mjs";
import { buildSessionPace } from "./race-pace.mjs";

export const SESSION_PACE_VERSION = "session-pace-1";
export const SESSION_METRICS_VERSION = "session-metrics-1";
export const SESSION_METRICS_MAX_GAP_MS = 1500;
export const SESSION_METRICS_MIN_COVERAGE = 0.97;

export function bestSessionLaps(catalog) {
  const pace = buildSessionPace(catalog);
  return catalog.drivers.map(driver => {
    const best = pace.points.filter(p=>p.driver===driver.number && p.time>0 && !p.reasons.some(r=>["START","PIT_IN","PIT_OUT","DELETED","INCOMPLETE","RED","SC","VSC"].includes(r)))
      .filter(p=>{const lap=catalog.laps.find(l=>l.driverNumber===driver.number && l.number===p.lap);return lap && (lap.validityKnown || lap.officialBest) && (lap.officialBestTime==null || Math.round(p.time*1000)>=Math.round(lap.officialBestTime*1000));})
      .sort((a,b)=>a.time-b.time || a.lap-b.lap)[0];
    return { driver, lap: best ? catalog.laps.find(l=>l.driverNumber===driver.number && l.number===best.lap) ?? null : null };
  });
}

export function sessionLapMetrics(driver, lap, raw = [], circuitLength = null) {
  const result = { driver, lap, topSpeed:null, averageSpeed:null, fullThrottle:null, speedCoverage:0, throttleCoverage:0,
    samples:0, state:lap?"unavailable":"no-lap", averageMethod:circuitLength>0?"circuit-length":"telemetry" };
  if (!lap || !Number.isFinite(lap.time) || lap.time<=0) return result;
  if (circuitLength>0) result.averageSpeed = circuitLength / lap.time * 3.6;
  const start = Date.parse(lap.start), end = start + lap.time*1000;
  if (!Number.isFinite(start)) return result;
  const samples = cleanSamples(raw);
  const inside = samples.filter(p=>p.timestamp>=start && p.timestamp<=end);
  result.samples = inside.length;
  let speedTime=0, throttleTime=0, speedIntegral=0, fullTime=0;
  for(let i=0;i<samples.length-1;i++) {
    const a=samples[i], b=samples[i+1], gap=b.timestamp-a.timestamp;
    if(gap<=0 || gap>SESSION_METRICS_MAX_GAP_MS)continue;
    const from=Math.max(start,a.timestamp), to=Math.min(end,b.timestamp);
    if(to<=from)continue;
    const dt=to-from;
    const va=a.speed+(b.speed-a.speed)*(from-a.timestamp)/gap;
    const vb=a.speed+(b.speed-a.speed)*(to-a.timestamp)/gap;
    speedTime+=dt;
    speedIntegral+=(va+vb)/2*dt;
    // The ECU value is held until the next sample. Unknown throttle is
    // unobserved time, never zero; a long gap is not full-throttle evidence.
    if(a.throttle!=null){ throttleTime+=dt; if(a.throttle>=99)fullTime+=dt; }
  }
  result.speedCoverage = Math.min(1,speedTime/(lap.time*1000));
  result.throttleCoverage = Math.min(1,throttleTime/(lap.time*1000));
  if(result.speedCoverage>=SESSION_METRICS_MIN_COVERAGE && inside.length>=2) {
    result.topSpeed=Math.max(...inside.map(p=>p.speed));
    if(!circuitLength) result.averageSpeed=speedIntegral/speedTime;
  }
  if(result.throttleCoverage>=SESSION_METRICS_MIN_COVERAGE)result.fullThrottle=fullTime/throttleTime*100;
  result.state=result.topSpeed!=null && result.fullThrottle!=null?"ready":result.samples?"partial":"unavailable";
  return result;
}
