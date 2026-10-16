export const VERSION = "telemetry-3";
export const CHANNELS = ["speed", "throttle", "brake", "gear", "rpm", "drs"];
export const SOURCE = {
  provider: "OpenF1",
  url: "https://openf1.org/",
  license: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
};
const DISCRETE = new Set(["brake", "gear", "drs"]);
export const numeric = (v) =>
  v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const median = (a) =>
  a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round = (v) => (v == null ? null : Math.round(v * 1e6) / 1e6);
export function parseConfig(input) {
  if (
    !input ||
    !["lap", "best", "session", "teammate", "evolution"].includes(input.mode) ||
    !Array.isArray(input.traces) ||
    input.traces.length < 1 ||
    input.traces.length > 4
  )
    throw new Error("INVALID_COMPARISON");
  const traces = input.traces.map((t) => {
    if (
      !Number.isInteger(t.session) ||
      t.session <= 0 ||
      t.session > 1000000 ||
      !Number.isInteger(t.driver) ||
      t.driver < 1 ||
      t.driver > 999 ||
      !(
        t.lap === "best" ||
        t.lap === "race_average" ||
        (Number.isInteger(t.lap) && t.lap > 0 && t.lap <= 500)
      )
    )
      throw new Error("INVALID_COMPARISON");
    return { session: t.session, driver: t.driver, lap: t.lap };
  });
  const reference = input.reference ?? 0;
  if (
    !Number.isInteger(reference) ||
    reference < 0 ||
    reference >= traces.length
  )
    throw new Error("INVALID_REFERENCE");
  const config = { mode: input.mode, traces, reference };
  if (input.channel && ![...CHANNELS, "delta"].includes(input.channel))
    throw new Error("INVALID_CHANNEL");
  if (input.channel) config.channel = input.channel;
  if (input.corner != null) {
    if (
      !Number.isInteger(input.corner) ||
      input.corner < 1 ||
      input.corner > 50
    )
      throw new Error("INVALID_CORNER");
    config.corner = input.corner;
  }
  if (input.range != null) {
    if (
      !Array.isArray(input.range) ||
      input.range.length !== 2 ||
      !input.range.every(Number.isFinite) ||
      input.range[0] < 0 ||
      input.range[1] <= input.range[0] ||
      input.range[1] > 30000
    )
      throw new Error("INVALID_RANGE");
    config.range = input.range;
  }
  if (input.window && !["weekend", "session"].includes(input.window))
    throw new Error("INVALID_WINDOW");
  if (input.window) config.window = input.window;
  return config;
}
const hasNeutralization = (lap) =>
  lap.status.some((status) => ["RED", "SC", "VSC"].includes(status));
const isCompleteRacingLap = (lap) =>
  lap.complete && lap.time > 0 && !lap.pitIn && !lap.pitOut;
export function bestLapCandidates(laps) {
  return laps
    .filter(
      (lap) =>
        isCompleteRacingLap(lap) &&
        (lap.officialBest ||
          (lap.validityKnown && !lap.deleted && !hasNeutralization(lap))) &&
        (lap.officialBestTime == null ||
          Math.round(lap.time * 1000) >=
            Math.round(lap.officialBestTime * 1000)),
    )
    .sort(
      (a, b) =>
        Number(Boolean(b.officialBest)) - Number(Boolean(a.officialBest)) ||
        a.time - b.time ||
        a.number - b.number,
    );
}
export function bestLap(laps) {
  return bestLapCandidates(laps)[0] ?? null;
}
export function raceAverageLaps(laps) {
  const pitExitNumbers = new Set(
    laps.filter((lap) => lap.pitIn).map((lap) => lap.number + 1),
  );
  return laps
    .filter(
      (lap) =>
        isCompleteRacingLap(lap) &&
        lap.number > 1 &&
        !lap.deleted &&
        lap.validityKnown &&
        !lap.status.some((status) =>
          ["RED", "SC", "VSC", "YELLOW", "START", "UNKNOWN"].includes(status),
        ) &&
        !pitExitNumbers.has(lap.number),
    )
    .sort((a, b) => a.number - b.number);
}
export function drsValue(value) {
  const n = numeric(value);
  return [10, 12, 14].includes(n) ? 1 : [0, 1, 8].includes(n) ? 0 : null;
}
export function cleanSamples(rows) {
  const byTime = new Map();
  for (const r of rows) {
    const timestamp = Date.parse(r.date);
    const speed = numeric(r.speed);
    if (
      !Number.isFinite(timestamp) ||
      speed == null ||
      speed < 0 ||
      speed > 400
    )
      continue;
    const valid = (v, a, b) => {
      const n = numeric(v);
      return n != null && n >= a && n <= b ? n : null;
    };
    byTime.set(timestamp, {
      timestamp,
      speed,
      throttle: valid(r.throttle, 0, 100),
      brake: [0, 100].includes(numeric(r.brake)) ? numeric(r.brake) : null,
      gear: valid(r.n_gear, 0, 8),
      rpm: valid(r.rpm, 0, 20000),
      drs: drsValue(r.drs),
      x: null,
      y: null,
    });
  }
  return [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp);
}
export function interpolate(points, distance, field, maxGapSeconds = 1.5) {
  if (
    !points.length ||
    distance < points[0].distance ||
    distance > points.at(-1).distance
  )
    return null;
  let lo = 0,
    hi = points.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid].distance < distance) lo = mid + 1;
    else hi = mid;
  }
  const b = points[lo],
    a = points[Math.max(0, lo - 1)];
  if (b.distance === distance) return b[field] ?? null;
  if (
    a[field] == null ||
    b[field] == null ||
    b.elapsed - a.elapsed > maxGapSeconds ||
    b.distance <= a.distance
  )
    return null;
  if (DISCRETE.has(field)) return a[field];
  return (
    a[field] +
    ((b[field] - a[field]) * (distance - a.distance)) /
      (b.distance - a.distance)
  );
}
function atTime(points, time, field, maxGap = 1500) {
  let lo = 0,
    hi = points.length - 1;
  if (
    !points.length ||
    time < points[0].timestamp ||
    time > points[hi].timestamp
  )
    return null;
  while (lo < hi) {
    const m = Math.floor((lo + hi) / 2);
    if (points[m].timestamp < time) lo = m + 1;
    else hi = m;
  }
  const b = points[lo],
    a = points[Math.max(0, lo - 1)];
  if (b.timestamp === time) return b[field];
  if (
    b.timestamp - a.timestamp > maxGap ||
    a[field] == null ||
    b[field] == null
  )
    return null;
  if (DISCRETE.has(field)) return a[field];
  return (
    a[field] +
    ((b[field] - a[field]) * (time - a.timestamp)) / (b.timestamp - a.timestamp)
  );
}
export function normalizeLap({
  lap,
  driver,
  session,
  samples,
  locations = [],
  track,
  datasetId = "",
}) {
  if (!lap.start || !lap.time || !track?.length)
    throw new Error("NO_TELEMETRY");
  const start = Date.parse(lap.start),
    end = start + lap.time * 1000;
  const clean = cleanSamples(samples);
  const inside = clean.filter(
    (p) => p.timestamp >= start && p.timestamp <= end,
  );
  const warnings = [];
  const boundary = (timestamp) => {
    const p = { timestamp, x: null, y: null };
    for (const ch of CHANNELS) p[ch] = atTime(clean, timestamp, ch);
    return p.speed == null ? null : p;
  };
  const first = boundary(start),
    last = boundary(end);
  if (first && inside[0]?.timestamp !== start) inside.unshift(first);
  if (last && inside.at(-1)?.timestamp !== end) inside.push(last);
  if (inside.length < 10) throw new Error("NO_TELEMETRY");
  const intervals = inside
    .slice(1)
    .map((p, i) => (p.timestamp - inside[i].timestamp) / 1000);
  const maxGap = Math.max(...intervals),
    sampleInterval = median(intervals);
  let integrated = 0;
  const raw = inside.map((p, i) => {
    if (i)
      integrated +=
        ((p.speed + inside[i - 1].speed) / 2 / 3.6) * intervals[i - 1];
    return {
      ...p,
      distance: integrated,
      elapsed: (p.timestamp - start) / 1000,
    };
  });
  const ratio = track.length / integrated;
  // Integrated speed is an estimate of racing-line length. Report scale, never alter elapsed time.
  if (Math.abs(1 - ratio) > 0.03) warnings.push("DISTANCE_SCALE");
  if (!first || !last) warnings.push("MISSING_BOUNDARY");
  if (maxGap > 1.5) warnings.push("TELEMETRY_GAPS");
  warnings.push("ESTIMATED_DISTANCE");
  if (lap.status.includes("UNKNOWN")) warnings.push("UNKNOWN_TRACK_STATUS");
  const locationPoints = locations
    .map((p) => ({
      timestamp: Date.parse(p.date),
      x: numeric(p.x),
      y: numeric(p.y),
    }))
    .filter((p) => Number.isFinite(p.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  const points = raw.map((p, i) => ({
    ...p,
    distance: i === raw.length - 1 ? track.length : p.distance * ratio,
    x: atTime(locationPoints, p.timestamp, "x"),
    y: atTime(locationPoints, p.timestamp, "y"),
  }));
  const covered =
    intervals.filter((t) => t <= 1.5).reduce((s, t) => s + t, 0) / lap.time;
  const comparable =
    !!first &&
    !!last &&
    covered >= 0.98 &&
    Math.abs(1 - ratio) <= 0.06 &&
    !lap.pitIn &&
    !lap.pitOut;
  const quality = {
    coverage: clamp(covered, 0, 1),
    maxGapSeconds: maxGap,
    sampleIntervalSeconds: sampleInterval,
    timingError: first && last ? round(points.at(-1).elapsed - lap.time) : null,
    warnings,
    comparable,
    method: "speed-integral/lap-length",
  };
  return {
    lap,
    driver,
    session,
    points,
    quality,
    metrics: calculateMetrics(points, lap.time),
    corners: track.corners.map((c) => cornerMetrics(points, c)),
    datasetId,
  };
}
function averageAtDistance(traces, distance, field, maxGapSeconds = 1.5) {
  const values = traces
    .map((trace) => interpolate(trace.points, distance, field, maxGapSeconds))
    .filter((value) => value != null && Number.isFinite(value));
  return mean(values);
}
function modeAtDistance(traces, distance, field) {
  const values = traces
    .map((trace) => interpolate(trace.points, distance, field))
    .filter((value) => value != null && Number.isFinite(value));
  if (!values.length) return null;
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort(
    (a, b) =>
      b[1] - a[1] ||
      Math.abs(a[0] - mean(values)) - Math.abs(b[0] - mean(values)),
  )[0][0];
}
export function averageNormalizedLaps(traces, track) {
  if (traces.length < 2) throw new Error("RACE_AVERAGE_UNAVAILABLE");
  const first = traces[0];
  if (
    traces.some(
      (trace) =>
        trace.driver.number !== first.driver.number ||
        trace.session.id !== first.session.id ||
        !trace.quality.comparable,
    )
  )
    throw new Error("RACE_AVERAGE_UNAVAILABLE");
  const distance = Array.from(
    { length: Math.ceil(track.length / 5) + 1 },
    (_, index) => Math.min(track.length, index * 5),
  );
  const starts = traces
    .map((trace) => Date.parse(trace.lap.start))
    .filter(Number.isFinite);
  const start = Math.min(...starts);
  const points = distance.map((position) => {
    const elapsed = averageAtDistance(traces, position, "elapsed", Infinity);
    return {
      distance: position,
      elapsed,
      timestamp: start + elapsed * 1000,
      speed: averageAtDistance(traces, position, "speed"),
      throttle: averageAtDistance(traces, position, "throttle"),
      brake: averageAtDistance(traces, position, "brake"),
      gear: modeAtDistance(traces, position, "gear"),
      rpm: averageAtDistance(traces, position, "rpm"),
      drs: null,
      x: averageAtDistance(traces, position, "x"),
      y: averageAtDistance(traces, position, "y"),
    };
  });
  const lapTime = mean(
    traces.map((trace) => trace.lap.time).filter((value) => value != null),
  );
  const sectorCount = Math.max(
    ...traces.map((trace) => trace.lap.sectors.length),
  );
  const lap = {
    ...first.lap,
    id: `${first.session.id}:${first.driver.number}:race-average`,
    number: 0,
    time: lapTime,
    start: new Date(start).toISOString(),
    sectors: Array.from({ length: sectorCount }, (_, index) =>
      mean(
        traces
          .map((trace) => trace.lap.sectors[index])
          .filter((value) => value != null),
      ),
    ),
    compound: null,
    tyreAge: null,
    stint: null,
    pitIn: false,
    pitOut: false,
    deleted: false,
    complete: true,
    status: ["GREEN"],
    validityKnown: true,
    weather: null,
    kind: "race_average",
    sampleCount: traces.length,
  };
  const quality = {
    coverage: mean(traces.map((trace) => trace.quality.coverage)),
    maxGapSeconds: Math.max(
      ...traces.map((trace) => trace.quality.maxGapSeconds),
    ),
    sampleIntervalSeconds: mean(
      traces.map((trace) => trace.quality.sampleIntervalSeconds),
    ),
    timingError: round(points.at(-1).elapsed - lapTime),
    warnings: [
      ...new Set([
        ...traces.flatMap((trace) => trace.quality.warnings),
        "RACE_AVERAGE",
      ]),
    ],
    comparable: true,
    method: "distance-normalized-race-average",
  };
  return {
    lap,
    driver: first.driver,
    session: first.session,
    points,
    quality,
    metrics: calculateMetrics(points, lapTime),
    corners: track.corners.map((corner) => cornerMetrics(points, corner)),
    datasetId: `race-average:${traces.map((trace) => trace.datasetId).join(":")}`,
  };
}
function weightedShare(points, predicate, channel) {
  let total = 0,
    yes = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dt = b.elapsed - a.elapsed;
    if (dt <= 0 || dt > 1.5 || a[channel] == null || b[channel] == null)
      continue;
    total += dt;
    if (predicate(a[channel])) yes += dt;
  }
  return total ? (100 * yes) / total : null;
}
export function detectEvents(
  points,
  channel,
  threshold,
  minSeconds = 0.25,
  minDistance = 8,
) {
  const result = [];
  let begin = null;
  for (let i = 0; i <= points.length; i++) {
    const p = points[i],
      prev = points[i - 1];
    const active =
      p &&
      p[channel] != null &&
      p[channel] >= threshold &&
      (!prev || p.elapsed - prev.elapsed <= 1.5);
    if (active && !begin) begin = p;
    if (!active && begin) {
      const stop = prev ?? begin;
      if (
        stop.elapsed - begin.elapsed >= minSeconds &&
        stop.distance - begin.distance >= minDistance
      )
        result.push({ start: begin.distance, end: stop.distance });
      begin = null;
    }
  }
  return result;
}
export function calculateMetrics(points, lapTime) {
  const speeds = points.map((p) => p.speed).filter((v) => v != null);
  const braking = detectEvents(points, "brake", 50);
  const full = detectEvents(points, "throttle", 98);
  const gearUsage = {};
  for (let gear = 0; gear <= 8; gear++) {
    const v = weightedShare(points, (n) => n === gear, "gear");
    if (v != null) gearUsage[String(gear)] = round(v);
  }
  return {
    topSpeed: speeds.length ? Math.max(...speeds) : null,
    averageSpeed:
      lapTime > 0
        ? ((points.at(-1).distance - points[0].distance) / lapTime) * 3.6
        : null,
    fullThrottle: round(weightedShare(points, (v) => v >= 98, "throttle")),
    brakingDistance: points.some((p) => p.brake != null)
      ? braking.reduce((s, e) => s + e.end - e.start, 0)
      : null,
    gearUsage,
    drsUsage: round(weightedShare(points, (v) => v === 1, "drs")),
    brakingPoints: braking.map((e) => e.start),
    throttlePickups: full.map((e) => e.start),
    earliestBraking: braking[0]?.start ?? null,
    latestBraking: braking.at(-1)?.start ?? null,
  };
}
export function cornerMetrics(points, corner) {
  const section = points.filter(
    (p) => p.distance >= corner.start && p.distance <= corner.end,
  );
  const speeds = section.map((p) => p.speed).filter((v) => v != null);
  const brake = detectEvents(section, "brake", 50)[0]?.start ?? null;
  const after = section.filter((p) => p.distance >= corner.apex);
  const a = interpolate(points, corner.start, "elapsed"),
    b = interpolate(points, corner.end, "elapsed");
  return {
    number: corner.number,
    entry: interpolate(points, corner.start, "speed"),
    minimum: speeds.length ? Math.min(...speeds) : null,
    maximum: speeds.length ? Math.max(...speeds) : null,
    exit: interpolate(points, corner.end, "speed"),
    braking: brake,
    pickup: detectEvents(after, "throttle", 20)[0]?.start ?? null,
    fullThrottle: detectEvents(after, "throttle", 98)[0]?.start ?? null,
    time: a != null && b != null ? b - a : null,
  };
}
const sectorTimingRules = Object.freeze({
  maxGap: 0.6,
  maxTimeShift: 0.35,
  maxDistanceScale: 0.06,
  sumTolerance: 0.005,
  interpolationTolerance: 0.01,
});
const sectorTimingMethod = "speed-integral/sector-timing";

function sectorTimingAnchors(trace, length) {
  const { lap, points } = trace;
  if (lap.kind === "race_average" || !trace.quality.comparable ||
    lap.sectors?.length !== 3 || !Number.isFinite(lap.time) ||
    lap.sectors.some((time) => !Number.isFinite(time) || time <= 0) ||
    Math.abs(lap.sectors.reduce((sum, time) => sum + time, 0) - lap.time) > sectorTimingRules.sumTolerance ||
    points.length < 2 || points[0].distance !== 0 || points[0].elapsed !== 0 ||
    Math.abs(points.at(-1).distance - length) > 0.001 ||
    Math.abs(points.at(-1).elapsed - lap.time) > sectorTimingRules.sumTolerance) return null;
  const anchors = [{ distance: 0, elapsed: 0 }];
  let elapsed = 0;
  for (const time of lap.sectors.slice(0, 2)) {
    elapsed += time;
    const index = points.findIndex((point) => point.elapsed >= elapsed);
    if (index <= 0) return null;
    const a = points[index - 1], b = points[index];
    if (b.elapsed <= a.elapsed || b.elapsed - a.elapsed > sectorTimingRules.maxGap || b.distance <= a.distance) return null;
    anchors.push({ elapsed, distance: a.distance + (b.distance - a.distance) * (elapsed - a.elapsed) / (b.elapsed - a.elapsed) });
  }
  anchors.push({ distance: length, elapsed: lap.time });
  return anchors.every((a, i) => Number.isFinite(a.distance) && (!i || a.distance > anchors[i - 1].distance)) ? anchors : null;
}

function projectSectorTiming(trace, track, anchors) {
  const targets = [0, ...track.sectors, track.length];
  if (targets.length !== 4 || targets.some((d, i) => !Number.isFinite(d) || i && d <= targets[i - 1])) return null;
  const shifts = track.sectors.map((distance, i) => {
    const elapsed = interpolate(trace.points, distance, "elapsed", sectorTimingRules.maxGap);
    return elapsed == null ? null : elapsed - anchors[i + 1].elapsed;
  });
  const scales = targets.slice(1).map((distance, i) => (distance - targets[i]) / (anchors[i + 1].distance - anchors[i].distance));
  if (shifts.some((shift) => shift == null || !Number.isFinite(shift) || Math.abs(shift) > sectorTimingRules.maxTimeShift) ||
    scales.some((scale) => !Number.isFinite(scale) || Math.abs(1 - scale) > sectorTimingRules.maxDistanceScale)) return null;
  // Rebuilding a saved comparison must not repeatedly shift its samples.
  if (trace.quality.method === sectorTimingMethod && shifts.every((shift) => Math.abs(shift) <= sectorTimingRules.interpolationTolerance)) return trace;
  const points = trace.points.map((point) => {
    const i = point.elapsed <= anchors[1].elapsed ? 0 : point.elapsed <= anchors[2].elapsed ? 1 : 2;
    const distance = point.elapsed === trace.lap.time ? track.length : targets[i] + (point.distance - anchors[i].distance) * scales[i];
    return { ...point, distance };
  });
  // Do not insert control-line samples: that would conceal an original data gap.
  return { ...trace, points, quality: { ...trace.quality, method: sectorTimingMethod },
    metrics: calculateMetrics(points, trace.lap.time), corners: track.corners.map((corner) => cornerMetrics(points, corner)) };
}

export function alignLapToSectorTiming(trace, track) {
  const anchors = sectorTimingAnchors(trace, track.length);
  return anchors ? projectSectorTiming(trace, track, anchors) : null;
}

function alignComparisonTiming(traces, track) {
  const anchors = traces.map((trace) => sectorTimingAnchors(trace, track.length));
  if (anchors.some((value) => value == null)) return { traces, track };
  const alreadyAligned = traces.every((trace) => trace.quality.method === sectorTimingMethod);
  const sectors = alreadyAligned ? track.sectors : [1, 2].map((i) => {
    // A shared median avoids favouring the reference lap or forcing samples to
    // potentially inaccurate sector positions in the static circuit geometry.
    const distances = anchors.map((values) => values[i].distance).sort((a, b) => a - b);
    const middle = Math.floor(distances.length / 2);
    return distances.length % 2 ? distances[middle] : (distances[middle - 1] + distances[middle]) / 2;
  });
  const alignedTrack = { ...track, sectors };
  const aligned = traces.map((trace, i) => projectSectorTiming(trace, alignedTrack, anchors[i]));
  return aligned.some((trace) => trace == null) ? { traces, track } : { traces: aligned, track: alignedTrack };
}

export function rebuildComparisonTiming(comparison) {
  return { ...comparison, ...buildComparison(comparison.traces, comparison.track, comparison.config), analysis: undefined };
}

export function buildComparison(traces, track, config) {
  if (traces.length < 2 || traces.length > 4)
    throw new Error("INVALID_COMPARISON");
  const first = traces[0];
  if (
    traces.some(
      (t) =>
        t.session.meetingId !== first.session.meetingId ||
        t.session.season !== first.session.season ||
        t.session.circuitKey !== first.session.circuitKey,
    )
  )
    throw new Error("INCOMPATIBLE_LAPS");
  if (
    config.mode === "session" &&
    traces.some((t) => t.driver.number !== first.driver.number)
  )
    throw new Error("INCOMPATIBLE_LAPS");
  if (traces.some((t) => !t.quality.comparable))
    throw new Error("INCOMPLETE_TELEMETRY");
  ({ traces, track } = alignComparisonTiming(traces, track));
  const distance = Array.from(
    { length: Math.ceil(track.length / 5) + 1 },
    (_, i) => Math.min(track.length, i * 5),
  );
  const reference = traces[config.reference ?? 0];
  const delta = traces.map((t) =>
    distance.map((d) => {
      const a = interpolate(t.points, d, "elapsed"),
        b = interpolate(reference.points, d, "elapsed");
      return a == null || b == null ? null : round(a - b);
    }),
  );
  const local = (from, to) =>
    traces.map((t) => {
      const a = interpolate(t.points, from, "elapsed"),
        b = interpolate(t.points, to, "elapsed"),
        ra = interpolate(reference.points, from, "elapsed"),
        rb = interpolate(reference.points, to, "elapsed");
      return [a, b, ra, rb].some((v) => v == null) ? null : b - a - (rb - ra);
    });
  const segments = [];
  for (let from = 0; from < track.length; from += 100)
    segments.push({
      from,
      to: Math.min(from + 100, track.length),
      gain: local(from, Math.min(from + 100, track.length)),
    });
  const boundaries = [0, ...track.sectors, track.length];
  const sectorDelta = boundaries.slice(1).map((_, i) => {
    const officialTimes = traces.map((trace) => trace.lap.sectors[i]);
    const referenceTime = officialTimes[config.reference ?? 0];
    return officialTimes.map((value) =>
      Number.isFinite(referenceTime) && referenceTime > 0 && Number.isFinite(value) && value > 0
        ? round(value - referenceTime) : null);
  });
  const cornerDelta = track.corners.map((c) => local(c.start, c.end));
  const straightDelta = traces.map((_, i) => {
    const total = delta[i].at(-1);
    return total == null || cornerDelta.some((c) => c[i] == null)
      ? null
      : round(total - cornerDelta.reduce((s, c) => s + c[i], 0));
  });
  const resolved = {
    ...config,
    traces: traces.map((t) => ({
      session: t.session.id,
      driver: t.driver.number,
      lap: t.lap.kind === "race_average" ? "race_average" : t.lap.number,
    })),
  };
  const comparison = {
    version: VERSION,
    config: resolved,
    traces,
    track,
    distance,
    delta,
    segments,
    sectorDelta,
    cornerDelta,
    straightDelta,
    insights: [],
    warnings: [...new Set(traces.flatMap((t) => t.quality.warnings))],
    source: SOURCE,
  };
  comparison.insights = buildInsights(comparison);
  return comparison;
}
export function buildInsights(c) {
  const ref = c.config.reference,
    other = c.traces.findIndex((_, i) => i !== ref),
    a = c.traces[ref],
    b = c.traces[other],
    result = [];
  const most = [...c.segments]
    .filter((s) => s.gain[other] != null)
    .sort((x, y) => Math.abs(y.gain[other]) - Math.abs(x.gain[other]))[0];
  if (most && Math.abs(most.gain[other]) >= 0.1)
    result.push({
      id: "segment",
      text: `${most.gain[other] > 0 ? a.driver.code : b.driver.code} выигрывает больше всего на участке ${Math.round(most.from)}–${Math.round(most.to)} м`,
      value: Math.abs(most.gain[other]),
      unit: "s",
      from: most.from,
      to: most.to,
    });
  const speed = a.metrics.topSpeed - b.metrics.topSpeed;
  if (
    a.metrics.topSpeed != null &&
    b.metrics.topSpeed != null &&
    Math.abs(speed) >= 3
  )
    result.push({
      id: "top-speed",
      text: `${speed > 0 ? a.driver.code : b.driver.code}: выше максимальная скорость`,
      value: Math.abs(speed),
      unit: "km/h",
    });
  for (let i = 0; i < c.track.corners.length; i++) {
    const x = a.corners[i]?.fullThrottle,
      y = b.corners[i]?.fullThrottle;
    // At 3.7 Hz, a single sample at racing speed spans many metres. Do not publish sub-sample differences.
    const threshold = Math.max(
      25,
      (Math.max(a.metrics.topSpeed ?? 0, b.metrics.topSpeed ?? 0) / 3.6) *
        Math.max(
          a.quality.sampleIntervalSeconds,
          b.quality.sampleIntervalSeconds,
        ) *
        2,
    );
    if (x != null && y != null && Math.abs(x - y) >= threshold) {
      const corner = c.track.corners[i];
      result.push({
        id: `throttle-${corner.number}`,
        text: `${x < y ? a.driver.code : b.driver.code} раньше выходит на полный газ после поворота ${corner.number}`,
        value: Math.abs(x - y),
        unit: "m",
        from: corner.start,
        to: corner.end,
      });
      break;
    }
  }
  return result.slice(0, 3);
}
export function resampleComparison(
  comparison,
  { from = 0, to = comparison.track.length, points = 1000 } = {},
) {
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from < 0 ||
    to <= from ||
    to > comparison.track.length ||
    !Number.isInteger(points) ||
    points < 100 ||
    points > 1500
  )
    throw new Error("INVALID_RANGE");
  // Common indices preserve extrema across every trace/channel, without recalculating metrics.
  const full = comparison.distance,
    indices = new Set();
  const available = full
    .map((d, i) => (d >= from && d <= to ? i : -1))
    .filter((i) => i >= 0);
  if (available.length <= points) available.forEach((i) => indices.add(i));
  else {
    const fields = ["speed", "throttle", "brake"];
    const stride = Math.ceil(
      available.length /
        Math.floor(points / (2 * fields.length * comparison.traces.length + 2)),
    );
    for (let s = 0; s < available.length; s += stride) {
      const chunk = available.slice(s, s + stride);
      indices.add(chunk[0]);
      indices.add(chunk.at(-1));
      for (const t of comparison.traces)
        for (const field of fields) {
          let min = Infinity,
            max = -Infinity,
            mi = chunk[0],
            ma = chunk[0];
          for (const i of chunk) {
            const v = interpolate(t.points, full[i], field);
            if (v != null && v < min) {
              min = v;
              mi = i;
            }
            if (v != null && v > max) {
              max = v;
              ma = i;
            }
          }
          indices.add(mi);
          indices.add(ma);
        }
    }
  }
  const selected = [...indices].sort((a, b) => a - b),
    distance = selected.map((i) => full[i]);
  return {
    ...comparison,
    distance,
    delta: comparison.delta.map((a) => selected.map((i) => a[i])),
    traces: comparison.traces.map((t) => ({
      ...t,
      points: distance.map((d) => ({
        distance: d,
        elapsed: interpolate(t.points, d, "elapsed"),
        timestamp: interpolate(t.points, d, "timestamp"),
        x: interpolate(t.points, d, "x"),
        y: interpolate(t.points, d, "y"),
        ...Object.fromEntries(
          CHANNELS.map((ch) => [ch, round(interpolate(t.points, d, ch))]),
        ),
      })),
    })),
  };
}
export function evolve(entries) {
  const sorted = [...entries].sort(
    (a, b) => Date.parse(a.session.start) - Date.parse(b.session.start),
  );
  const times = sorted.map((e) => e.lap.time).filter((v) => v != null);
  return {
    entries: sorted,
    change: times.length > 1 ? times.at(-1) - times[0] : null,
    average: mean(times),
  };
}
