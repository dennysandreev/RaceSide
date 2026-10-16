import { interpolate, detectEvents, alignLapToSectorTiming } from "./core.mjs";

export const ANALYSIS_VERSION = "track-analysis-6";
// Thresholds describe public telemetry resolution, never battery state or ERS power.
export const ANALYSIS_RULES = Object.freeze({
  slowSpeed: 150,
  fastSpeed: 230,
  maxGap: 0.6,
  neutralSeconds: 0.05,
  maxSectorError: 0.35,
  fullThrottle: 98,
  pressedThrottle: 5,
  speedDrop: 8,
  minSignalSpeed: 200,
  // A conservative detection gate, not a physical lower limit for harvesting.
  minSuperclippingStartSpeed: 300,
  minSignalDuration: 1,
  minSignalDistance: 60,
  maxSignalGap: 0.5,
  maxSignalMergeSeconds: 1.5,
  maxSignalMergeDistance: 150,
  maxSignalSpeedRecovery: 2,
});
const categories = ["slow", "medium", "fast", "straight"];
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = (v) => v == null ? null : Math.round(v * 1e6) / 1e6;
const clamp = (v, from, to) => Math.max(from, Math.min(to, v));
const average = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

function sectionTime(trace, from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || !trace.points?.length) return null;
  const a = interpolate(trace.points, from, "elapsed", ANALYSIS_RULES.maxGap);
  const b = interpolate(trace.points, to, "elapsed", ANALYSIS_RULES.maxGap);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // Valid endpoints alone do not establish coverage inside the interval.
  for (let i = 1; i < trace.points.length; i++) {
    const previous = trace.points[i - 1], current = trace.points[i];
    if (current.distance > from && previous.distance < to &&
      (!Number.isFinite(current.elapsed) || !Number.isFinite(previous.elapsed) || current.distance <= previous.distance ||
       current.elapsed - previous.elapsed > ANALYSIS_RULES.maxGap ||
       current.elapsed <= previous.elapsed)) return null;
  }
  return b > a ? round(b - a) : null;
}
function localGain(traces, reference, other, from, to, available = true) {
  if (!available) return null;
  const a = sectionTime(traces[reference], from, to);
  const b = sectionTime(traces[other], from, to);
  return a == null || b == null ? null : round(b - a);
}
function timingQuality(traces, track, reference, other) {
  const a = traces[reference], b = traces[other];
  const errors = [];
  let officialA = 0, officialB = 0;
  for (let i = 0; i < track.sectors.length; i++) {
    if (![a.lap.sectors?.[i], b.lap.sectors?.[i]].every((v) => Number.isFinite(v) && v > 0)) break;
    officialA += a.lap.sectors[i]; officialB += b.lap.sectors[i];
    const ta = interpolate(a.points, track.sectors[i], "elapsed", ANALYSIS_RULES.maxGap);
    const tb = interpolate(b.points, track.sectors[i], "elapsed", ANALYSIS_RULES.maxGap);
    if (ta != null && tb != null) errors.push(Math.abs((tb - ta) - (officialB - officialA)));
  }
  const sectorError = errors.length ? Math.max(...errors) : null;
  const averageLap = traces.some((trace) => trace.lap.kind === "race_average");
  const timingAvailable = traces.every((trace) => trace.quality.comparable) &&
    (sectorError == null || sectorError <= ANALYSIS_RULES.maxSectorError);
  return {
    timingAvailable,
    sectorError: round(sectorError),
    neutralSeconds: round(Math.max(ANALYSIS_RULES.neutralSeconds, sectorError ?? 0)),
    warnings: ["ESTIMATED_SECTIONS", ...(!averageLap && sectorError == null ? ["UNVERIFIED_SECTORS"] : []),
      ...(!timingAvailable ? ["LOCAL_TIMING_MISMATCH"] : [])],
  };
}

// Use ONE shared corridor for all traces. Canonical midpoint boundaries often
// tile a whole lap; braking/acceleration phases trim them, leaving explicit straights.
export function analysisSections(traces, track) {
  const corners = [...track.corners].filter((corner) =>
    [corner.start, corner.apex, corner.end].every(Number.isFinite) &&
    corner.start >= 0 && corner.start < corner.apex && corner.apex < corner.end && corner.end <= track.length,
  ).sort((a, b) => a.apex - b.apex);
  if (!corners.length) return [];
  const sections = [];
  let boundary = 0;
  for (let index = 0; index < corners.length; index++) {
    const corner = corners[index];
    const lower = Math.max(boundary, corner.start, index ? (corners[index - 1].apex + corner.apex) / 2 : 0);
    const upper = Math.min(corner.end, index + 1 < corners.length ? (corner.apex + corners[index + 1].apex) / 2 : track.length);
    const speeds = traces.map((trace) => {
      const values = trace.points.filter((p) => p.distance >= Math.max(lower, corner.apex - 100) &&
        p.distance <= Math.min(upper, corner.apex + 100) && p.speed != null).map((p) => p.speed);
      return values.length ? Math.min(...values) : null;
    });
    const speed = median(speeds);
    const brakes = traces.map((trace) => detectEvents(trace.points.filter((p) =>
      p.distance >= Math.max(lower, corner.apex - 350) && p.distance <= corner.apex), "brake", 50)
      .at(-1)?.start ?? null);
    const full = traces.map((trace) => detectEvents(trace.points.filter((p) =>
      p.distance >= corner.apex && p.distance <= Math.min(upper, corner.apex + 250)), "throttle", ANALYSIS_RULES.fullThrottle)
      .find((event) => event.start > corner.apex + 10)?.start ?? null);
    const from = clamp(median(brakes) ?? corner.apex - 60, lower, corner.apex - 5);
    const to = clamp(median(full) ?? corner.apex + 60, corner.apex + 5, upper);
    if (from < boundary || to <= from) continue;
    if (from > boundary) sections.push({ id: `straight-${sections.length}`, category: "straight", corner: null, from: boundary, apex: null, to: from, speed: null });
    sections.push({ id: `corner-${corner.number}`, category: speed == null ? "medium" : speed < ANALYSIS_RULES.slowSpeed ? "slow" : speed < ANALYSIS_RULES.fastSpeed ? "medium" : "fast",
      corner: corner.number, from, apex: corner.apex, to, speed: round(speed), minimumSpeeds: speeds.map(round) });
    boundary = to;
  }
  if (boundary < track.length) sections.push({ id: `straight-${sections.length}`, category: "straight", corner: null, from: boundary, apex: null, to: track.length, speed: null });
  return sections;
}

export function repeatableLap(trace) {
  const lap = trace.lap;
  // Lap-wide flags, validity, weather and tyre age describe the context; only
  // the measured interval can establish whether its telemetry is usable.
  return lap.kind !== "race_average" && lap.time > 0 && Number.isFinite(Date.parse(lap.start));
}
export function intervalTiming(a, b, track, from, to) {
  const left = sectionTime(a, from, to), right = sectionTime(b, from, to);
  if (left == null || right == null) return { gain: null, verified: false, neutralSeconds: ANALYSIS_RULES.neutralSeconds };
  const bounds = [0, ...track.sectors, track.length], errors = [];
  let intersected = 0;
  for (let i = 0; i < bounds.length - 1; i++) {
    if (bounds[i + 1] <= from || bounds[i] >= to) continue;
    intersected++;
    if (![a.lap.sectors?.[i], b.lap.sectors?.[i]].every((v) => Number.isFinite(v) && v > 0)) continue;
    const times = [a, b].map((trace) => {
      const start = interpolate(trace.points, bounds[i], "elapsed", ANALYSIS_RULES.maxGap);
      const end = interpolate(trace.points, bounds[i + 1], "elapsed", ANALYSIS_RULES.maxGap);
      return Number.isFinite(start) && Number.isFinite(end) ? end - start : null;
    });
    if (times.every(Number.isFinite)) errors.push(Math.abs((times[1] - times[0]) - (b.lap.sectors[i] - a.lap.sectors[i])));
  }
  const error = errors.length ? Math.max(...errors) : null;
  return {
    gain: error != null && error > ANALYSIS_RULES.maxSectorError ? null : round(right - left),
    verified: intersected > 0 && errors.length === intersected,
    neutralSeconds: round(Math.max(ANALYSIS_RULES.neutralSeconds, error ?? 0)),
  };
}
export function matchRepeatability(traces, candidates = [], interval) {
  const [a, b] = traces;
  if (a.lap.kind === "race_average" || b.lap.kind === "race_average") return { pairs: [], reason: "average" };
  if (a.session.id !== b.session.id || a.driver.number === b.driver.number) return { pairs: [], reason: "sessions" };
  const pool = [...new Map([...candidates, ...traces].filter((t) => t.session.id === a.session.id && repeatableLap(t) && t.points?.length > 1)
    .map((t) => [t.lap.id, t])).values()];
  const left = pool.filter((t) => t.driver.number === a.driver.number);
  const right = pool.filter((t) => t.driver.number === b.driver.number);
  const pairs = [], used = new Set();
  const options = left.flatMap((x) => right.map((y) => ({ x, y,
    chosen: x.lap.id === a.lap.id && y.lap.id === b.lap.id,
    gap: Math.abs(Date.parse(x.lap.start) - Date.parse(a.lap.start)) + Math.abs(Date.parse(y.lap.start) - Date.parse(b.lap.start)) +
      Math.abs(Date.parse(x.lap.start) - Date.parse(y.lap.start)),
    compoundDifference: x.lap.compound != null && y.lap.compound != null && x.lap.compound !== y.lap.compound,
  }))).filter(({ x, y }) => !interval || intervalTiming(x, y, interval.track, interval.from, interval.to).gain != null)
    .sort((x, y) => Number(y.chosen) - Number(x.chosen) || x.gap - y.gap || Number(x.compoundDifference) - Number(y.compoundDifference) ||
      x.x.lap.number - y.x.lap.number || x.y.lap.number - y.y.lap.number);
  for (const { x, y } of options) {
    if (pairs.length >= 4) break;
    if (used.has(x.lap.id) || used.has(y.lap.id)) continue;
    pairs.push([x, y]); used.add(x.lap.id); used.add(y.lap.id);
  }
  return { pairs, reason: pairs.length >= 2 ? null : "laps" };
}

function repeatSummary(rows, field) {
  const valid = rows.filter((row) => row[`${field}Verified`] && row[`${field}Gain`] != null);
  const wins = [0, 0]; let neutral = 0;
  for (const row of valid) {
    const gain = row[`${field}Gain`], threshold = row[`${field}NeutralSeconds`];
    if (Math.abs(gain) < threshold) neutral++;
    else wins[gain > 0 ? 0 : 1]++;
  }
  return { pairs: valid.length, wins, neutral, medianGain: round(median(valid.map((row) => row[`${field}Gain`]))) };
}

function signal(kind, trace, points, brakingAt = null) {
  const first = points[0], last = points.at(-1);
  return { id: `${trace}:${kind}:${Math.round(first.distance)}`, kind, trace, from: round(first.distance), to: round(last.distance),
    duration: round(last.elapsed - first.elapsed), startSpeed: first.speed, endSpeed: last.speed,
    gear: points.every((p) => p.gear === first.gear) ? first.gear : null,
    throttle: round(average(points.map((p) => p.throttle))), brakingAt };
}

function signalRuns(points, qualifies) {
  const runs = []; let run = [];
  for (const p of points) {
    const previous = run.at(-1), eligible = qualifies(p);
    if (!eligible || previous && (p.elapsed - previous.elapsed > ANALYSIS_RULES.maxSignalGap ||
      p.elapsed <= previous.elapsed || p.gear !== previous.gear || p.drs !== previous.drs)) {
      if (run.length) runs.push(run); run = [];
    }
    if (eligible) run.push(p);
  }
  if (run.length) runs.push(run);
  return runs;
}
function sustainedSpeedDrop(first, last) {
  return first.speed - last.speed >= ANALYSIS_RULES.speedDrop &&
    last.elapsed - first.elapsed >= ANALYSIS_RULES.minSignalDuration &&
    last.distance - first.distance >= ANALYSIS_RULES.minSignalDistance;
}

function mergeSpeedDrops(events, trace, index, sections) {
  const merged = [];
  for (const event of events.sort((a, b) => a.from - b.from)) {
    const previous = merged.at(-1);
    // Signal distances are rounded to six decimals; recover the original samples.
    const bridge = previous ? trace.points.filter((p) =>
      p.distance >= previous.to - 1e-6 && p.distance <= event.from + 1e-6) : [];
    const first = bridge[0], last = bridge.at(-1);
    const gap = first && last ? last.elapsed - first.elapsed : Infinity;
    let minimum = Infinity;
    const continuous = bridge.length >= 2 && bridge.every((p, i) => {
      minimum = Math.min(minimum, p.speed);
      return [p.distance, p.elapsed, p.speed, p.throttle, p.gear].every(Number.isFinite) && p.speed >= ANALYSIS_RULES.minSignalSpeed &&
        p.throttle >= ANALYSIS_RULES.fullThrottle && p.brake === 0 && p.gear >= 1 &&
        p.gear === first.gear && p.drs === first.drs &&
        p.speed - minimum <= ANALYSIS_RULES.maxSignalSpeedRecovery &&
        (!i || p.elapsed > bridge[i - 1].elapsed && p.elapsed - bridge[i - 1].elapsed <= ANALYSIS_RULES.maxSignalMergeSeconds);
    });
    const eligible = previous && event.from >= previous.to &&
      event.from - previous.to <= ANALYSIS_RULES.maxSignalMergeDistance &&
      gap > 0 && gap <= ANALYSIS_RULES.maxSignalMergeSeconds && continuous &&
      !sections.some((s) => s.to > previous.to && s.from < event.from && !["straight", "fast"].includes(s.category));
    if (eligible) {
      merged[merged.length - 1] = signal("speed-drop", index, trace.points.filter((p) =>
        p.distance >= previous.from - 1e-6 && p.distance <= event.to + 1e-6));
    } else merged.push(event);
  }
  // Apply the entry threshold after joining; a continuing decline may fall below it.
  return merged.filter((event) => event.startSpeed >= ANALYSIS_RULES.minSuperclippingStartSpeed);
}

export function detectTelemetrySignals(trace, index, sections) {
  // Synthetic averaged pedal states cannot establish real events on a lap.
  if (trace.lap.kind === "race_average") return [];
  const points = trace.points, events = [];
  const valid = (p) => [p.distance, p.elapsed, p.speed, p.throttle, p.gear].every(Number.isFinite) &&
    p.speed >= ANALYSIS_RULES.minSignalSpeed && p.brake === 0 && p.gear >= 1;
  for (const section of sections.filter((s) => s.category === "straight")) {
    const sectionPoints = points.filter((p) => p.distance >= section.from && p.distance <= section.to);
    for (const samples of signalRuns(sectionPoints, (p) => valid(p) && p.throttle >= ANALYSIS_RULES.fullThrottle)) {
      let peak = 0, trough = 0, drop = null;
      const drops = [];
      for (let i = 1; i < samples.length; i++) {
        if (samples[i].speed > samples[trough].speed + ANALYSIS_RULES.maxSignalSpeedRecovery) {
          if (drop) drops.push(signal("speed-drop", index, samples.slice(drop[0], drop[1] + 1)));
          peak = trough = i; drop = null;
        }
        if (samples[i].speed >= samples[peak].speed) peak = trough = i;
        if (samples[i].speed < samples[trough].speed) trough = i;
        if (sustainedSpeedDrop(samples[peak], samples[i])) drop = [peak, i];
      }
      if (drop) drops.push(signal("speed-drop", index, samples.slice(drop[0], drop[1] + 1)));
      events.push(...drops);
    }
    // Preserve weak-acceleration eligibility over the original pressed-pedal run.
    // Cutting that run at a lift would expose unrelated new plateau events.
    for (const samples of signalRuns(sectionPoints, (p) => valid(p) && p.throttle > ANALYSIS_RULES.pressedThrottle)) {
      if (samples.at(-1).elapsed - samples[0].elapsed < 4 || samples.some((p) => p.throttle < ANALYSIS_RULES.fullThrottle)) continue;
      let peak = 0;
      const hasDrop = samples.some((p, i) => {
        if (p.speed >= samples[peak].speed) peak = i;
        return sustainedSpeedDrop(samples[peak], p);
      });
      if (hasDrop) continue;
      const firstWindow = samples.filter((p) => p.elapsed <= samples[0].elapsed + 1);
      const lastWindow = samples.filter((p) => p.elapsed >= samples.at(-1).elapsed - 1);
      const slope = (window) => window.length < 2 ? null : (window.at(-1).speed - window[0].speed) / (window.at(-1).elapsed - window[0].elapsed);
      const early = slope(firstWindow), late = slope(lastWindow);
      if (early != null && late != null && early >= 3 && late >= -1 && late <= 1 && early - late >= 3)
        events.push(signal("weak-acceleration", index, samples));
    }
  }
  let coast = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i], previous = coast.at(-1);
    const continuous = !previous || p.elapsed > previous.elapsed && p.elapsed - previous.elapsed <= 0.5;
    if (p.speed >= 80 && p.throttle != null && p.throttle <= 5 && p.brake === 0 && continuous) { coast.push(p); continue; }
    if (coast.length >= 3 && continuous && p.brake === 100 && p.distance - coast.at(-1).distance <= 50 &&
      coast.at(-1).distance - coast[0].distance >= 30 && coast.at(-1).elapsed - coast[0].elapsed >= 0.5)
      events.push(signal("coasting", index, coast, p.distance));
    coast = [];
    if (p.speed >= 80 && p.throttle != null && p.throttle <= 5 && p.brake === 0) coast.push(p);
  }
  return [...mergeSpeedDrops(events.filter((event) => event.kind === "speed-drop"), trace, index, sections),
    ...events.filter((event) => event.kind !== "speed-drop")].sort((a, b) => a.from - b.from).slice(0, 24);
}

export function buildTelemetryAnalysis(comparison, candidates = []) {
  const { traces, track } = comparison;
  // Repeat laps need the same control lines as the selected comparison. Never
  // mix corrected distances with raw integrated distances in local gains.
  if (traces.every((trace) => trace.quality.method === "speed-integral/sector-timing"))
    candidates = candidates.map((trace) => alignLapToSectorTiming(trace, track)).filter(Boolean);
  const reference = comparison.config.reference, other = traces.findIndex((_, i) => i !== reference);
  if (!traces[reference] || !traces[other]) return null;
  const pair = [traces[reference], traces[other]];
  const quality = timingQuality(traces, track, reference, other);
  const corridors = track.corners.length ? analysisSections(traces, track) : [];
  const sections = corridors.map((section) => ({ ...section, times: traces.map((trace) => sectionTime(trace, section.from, section.to)),
    gain: localGain(traces, reference, other, section.from, section.to, quality.timingAvailable) }));
  const matched = matchRepeatability(pair, candidates);
  const exits = sections.filter((s) => s.corner != null).map((section) => {
    const following = sections[sections.indexOf(section) + 1];
    const to = following?.category === "straight" ? following.to : section.to;
    const exitTiming = intervalTiming(...pair, track, section.apex, section.to);
    const straightTiming = intervalTiming(...pair, track, section.to, to);
    const exitGain = exitTiming.gain, straightGain = straightTiming.gain;
    const exitPairs = matchRepeatability(pair, candidates, { track, from: section.apex, to: section.to }).pairs;
    const straightPairs = matchRepeatability(pair, candidates, { track, from: section.to, to }).pairs;
    const key = (p) => p.map((t) => t.lap.id).join("/");
    const repeats = [...new Map([...exitPairs, ...straightPairs].map((p) => [key(p), p])).values()].map((p) => {
      const absent = { gain: null, verified: false, neutralSeconds: ANALYSIS_RULES.neutralSeconds };
      const exit = exitPairs.some((x) => key(x) === key(p)) ? intervalTiming(...p, track, section.apex, section.to) : absent;
      const straight = straightPairs.some((x) => key(x) === key(p)) ? intervalTiming(...p, track, section.to, to) : absent;
      return { laps: [p[0].lap.number, p[1].lap.number], compounds: p.map((t) => t.lap.compound), tyreAges: p.map((t) => t.lap.tyreAge),
        neutralSeconds: Math.max(exit.neutralSeconds, straight.neutralSeconds),
        exitGain: exit.gain, exitVerified: exit.verified, exitNeutralSeconds: exit.neutralSeconds,
        straightGain: straight.gain, straightVerified: straight.verified, straightNeutralSeconds: straight.neutralSeconds };
    });
    return { corner: section.corner, from: section.from, exit: section.to, to,
      speeds: traces.map((trace) => round(interpolate(trace.points, section.to, "speed", ANALYSIS_RULES.maxGap))),
      fullThrottle: traces.map((trace) => detectEvents(trace.points.filter((p) => p.distance >= section.apex && p.distance <= to), "throttle", ANALYSIS_RULES.fullThrottle)[0]?.start ?? null),
      exitGain, straightGain, totalGain: exitGain == null || straightGain == null ? null : round(exitGain + straightGain),
      exitVerified: exitTiming.verified, straightVerified: straightTiming.verified,
      exitNeutralSeconds: exitTiming.neutralSeconds, straightNeutralSeconds: straightTiming.neutralSeconds,
      repeats, repeatSummary: { exit: repeatSummary(repeats, "exit"), straight: repeatSummary(repeats, "straight") },
    };
  });
  return { version: ANALYSIS_VERSION, trackVersion: track.version, reference, other, quality, sections,
    profile: categories.map((category) => {
      const rows = sections.filter((s) => s.category === category);
      // A gap removes the SAME interval for both drivers, never treating it as zero.
      const available = rows.filter((s) => s.gain != null);
      return { category, count: rows.length, available: available.length,
        gain: available.length ? round(available.reduce((sum, s) => sum + s.gain, 0)) : null,
        speedValues: traces.map((trace, i) => {
          if (category !== "straight") return round(median(rows.map((row) => row.minimumSpeeds?.[i])));
          const values = trace.points.filter((p) => Number.isFinite(p.speed) && rows.some((row) => p.distance >= row.from && p.distance <= row.to)).map((p) => p.speed);
          return values.length ? Math.max(...values) : null;
        }) };
    }), exits, signals: traces.flatMap((trace, i) => detectTelemetrySignals(trace, i, corridors)),
    repeatability: { pairs: matched.pairs.length, reason: matched.reason } };
}
