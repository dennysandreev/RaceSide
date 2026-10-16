import type { ReplayLapTiming, ReplayPositionEvent } from "@/types/racemate";

export const MAX_MOTION_GAP_MS = 180_000;

export type DriverMotion = {
  events: ReplayPositionEvent[];
  timed?: boolean;
  finalLapComplete?: boolean;
  times: number[];
  values: number[];
  slopes: number[];
};

export type MotionSample = {
  unwrapped: number;
  hold: boolean;
};

const RETIREMENT_LOOKAHEAD_MS = 45_000;
const RETIREMENT_STILLNESS_MS = 15_000;
const RETIREMENT_MOVEMENT_THRESHOLD = 18;

type BuildDriverMotionOptions = {
  lapTimings?: ReplayLapTiming[];
};

export function inferLapTimingsFromPositions(
  events: ReplayPositionEvent[],
  raceStartOffsetMs?: number,
): ReplayLapTiming[] {
  const firstEventByLap = new Map<string, ReplayPositionEvent>();

  for (const event of [...events].sort((a, b) => a.offsetMs - b.offsetMs)) {
    const lapNumber = event.lapNumber;

    if (typeof lapNumber !== "number" || !Number.isFinite(lapNumber) || lapNumber <= 0) {
      continue;
    }

    const key = `${event.driverNumber}:${lapNumber}`;

    if (!firstEventByLap.has(key)) {
      firstEventByLap.set(key, event);
    }
  }

  const byDriver = new Map<number, ReplayPositionEvent[]>();

  for (const event of firstEventByLap.values()) {
    const driverEvents = byDriver.get(event.driverNumber) ?? [];
    driverEvents.push(event);
    byDriver.set(event.driverNumber, driverEvents);
  }

  // The worker attaches the CURRENT lap (including its known archive duration)
  // from its start, not after its completion. Subtracting that duration runs
  // every marker a lap early and gives each driver a different clock origin.
  const firstLapOffsets = [...firstEventByLap.values()]
    .filter((event) => event.lapNumber === 1)
    .map((event) => event.offsetMs);
  const sharedStartMs = typeof raceStartOffsetMs === "number" && Number.isFinite(raceStartOffsetMs)
    ? Math.max(0, raceStartOffsetMs)
    : firstLapOffsets.length ? Math.max(0, Math.min(...firstLapOffsets)) : null;

  return [...byDriver.entries()].flatMap(([driverNumber, driverEvents]) => {
    const ordered = driverEvents.sort((a, b) => a.offsetMs - b.offsetMs);
    const firstLapNumber = ordered[0].lapNumber!;
    let cursorMs = firstLapNumber === 1 && sharedStartMs !== null
      ? sharedStartMs
      : Math.max(0, ordered[0].offsetMs);

    return ordered.map((event, index) => {
      const durationMs = replayLapDurationMs(event);
      const timing = {
        driverNumber,
        durationMs,
        lapNumber: event.lapNumber!,
        startOffsetMs: Math.round(cursorMs),
      };
      const nextEvent = ordered[index + 1];
      // A missing lap or duration breaks the cumulative clock. Resume at the
      // next observed lap start; never relabel lap 3 as lap 2 or count grid time
      // as part of an unknown first lap.
      cursorMs = nextEvent && (durationMs === null || nextEvent.lapNumber !== event.lapNumber! + 1)
        ? nextEvent.offsetMs
        : cursorMs + (durationMs ?? 0);

      return timing;
    });
  }).sort((a, b) =>
    a.driverNumber - b.driverNumber ||
    a.lapNumber - b.lapNumber ||
    a.startOffsetMs - b.startOffsetMs,
  );
}

export function mergeLapTimingsWithInferred(
  officialTimings: ReplayLapTiming[] | undefined,
  inferredTimings: ReplayLapTiming[],
) {
  const merged = new Map<string, ReplayLapTiming>();
  const officialKeys = new Set<string>();

  for (const timing of inferredTimings) {
    merged.set(`${timing.driverNumber}:${timing.lapNumber}`, timing);
  }

  // Official timings are more accurate where they exist. Incomplete official
  // feeds must not discard later laps recovered from position telemetry.
  for (const timing of officialTimings ?? []) {
    const key = `${timing.driverNumber}:${timing.lapNumber}`;
    officialKeys.add(key);
    merged.set(key, timing);
  }

  const ordered = [...merged.values()].sort((a, b) =>
    a.driverNumber - b.driverNumber ||
    a.lapNumber - b.lapNumber ||
    a.startOffsetMs - b.startOffsetMs,
  );

  // Inferred timings use a telemetry-relative origin that can differ from the
  // official clock. When a single official lap is absent, inserting the raw
  // inferred timestamp between its official neighbours can compress two laps
  // into one and make the car jump. Anchor recovered laps to the preceding
  // official/reconciled lap instead.
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const currentKey = `${current.driverNumber}:${current.lapNumber}`;

    if (
      current.driverNumber === previous.driverNumber &&
      current.lapNumber === previous.lapNumber + 1 &&
      !officialKeys.has(currentKey) &&
      previous.durationMs !== null &&
      Number.isFinite(previous.durationMs) &&
      previous.durationMs > 0
    ) {
      ordered[index] = {
        ...current,
        startOffsetMs: previous.startOffsetMs + previous.durationMs,
      };
    }
  }

  return ordered;
}

function replayLapDurationMs(event: ReplayPositionEvent) {
  return typeof event.lastLapDuration === "number" && Number.isFinite(event.lastLapDuration) && event.lastLapDuration > 0
    ? Math.round(event.lastLapDuration * 1_000)
    : null;
}

/*
 * Прогресс по кругу «разворачивается» в монотонную величину (круги + доля круга),
 * а между сэмплами телеметрии интерполируется монотонным кубическим сплайном
 * Фритча-Карлсона: скорость меняется плавно и машина никогда не едет назад.
 *
 * Источник телеметрии периодически замораживает координаты на десятки секунд,
 * за которые машина успевает проехать целый круг — поэтому замороженные точки
 * схлопываются, а на длинных дырах потерянные круги восстанавливаются по темпу
 * пилота (фазовая развертка с приором по скорости).
 */
export function buildDriverMotion(
  events: ReplayPositionEvent[],
  options: BuildDriverMotionOptions = {},
): DriverMotion {
  const sorted = [...events].sort((a, b) => a.offsetMs - b.offsetMs);
  const officialTimingMotion = buildOfficialTimingMotion(options.lapTimings, sorted);

  if (officialTimingMotion) {
    return {
      events: sorted,
      timed: true,
      finalLapComplete: officialTimingMotion.finalLapComplete,
      slopes: fritschCarlsonSlopes(officialTimingMotion.times, officialTimingMotion.values),
      times: officialTimingMotion.times,
      values: officialTimingMotion.values,
    };
  }

  const trackEvents = collapseFrozenRuns(
    sorted.filter((event) => !event.isPitLane && Number.isFinite(event.progress)),
  );
  const pitTimes = sorted.filter((event) => event.isPitLane).map((event) => event.offsetMs);
  const paceLapMs = estimateLapMs(trackEvents);
  const times: number[] = [];
  const values: number[] = [];
  let unwrapped = 0;
  let previous: ReplayPositionEvent | null = null;

  for (const event of trackEvents) {
    if (previous === null) {
      unwrapped = event.progress;
    } else {
      let delta = wrapDelta(previous.progress, event.progress);
      const gapMs = event.offsetMs - previous.offsetMs;
      const crossesPit = hasPitTimeBetween(pitTimes, previous.offsetMs, event.offsetMs);

      if (paceLapMs !== null && !crossesPit && gapMs > paceLapMs * 0.55 && gapMs <= MAX_MOTION_GAP_MS) {
        const expectedLaps = gapMs / paceLapMs;
        const anchorPrevious = anchorLapsOf(previous);
        const anchorCurrent = anchorLapsOf(event);
        // Круги из таймингов надежнее среднего темпа, когда есть у обеих точек.
        const estimate = anchorPrevious !== null && anchorCurrent !== null
          ? anchorCurrent - anchorPrevious - delta
          : expectedLaps - delta;
        const missedLaps = Math.max(0, Math.min(Math.round(estimate), Math.ceil(expectedLaps) + 1));
        delta += missedLaps;
      }

      unwrapped += Math.max(0, delta);

      const anchor = anchorLapsOf(event);

      // Накопленное отставание от таймингов гасим ресинком, но только вперед,
      // чтобы машина никогда не поехала назад (лаг обновления круга дает ±1).
      if (anchor !== null && anchor - unwrapped > 1.5) {
        const expectedAdvance = paceLapMs === null ? null : gapMs / paceLapMs;
        const anchorAdvance = anchor - unwrapped;
        const isPlausibleAdvance = expectedAdvance === null ||
          anchorAdvance <= Math.max(1.5, expectedAdvance + 0.75);

        if (isPlausibleAdvance) {
          unwrapped = anchor;
        }
      }
    }

    previous = event;
    times.push(event.offsetMs);
    values.push(unwrapped);
  }

  const cleaned = cleanStallArtifacts(times, values);

  return {
    events: sorted,
    slopes: fritschCarlsonSlopes(cleaned.times, cleaned.values),
    times: cleaned.times,
    values: cleaned.values,
  };
}

/*
 * Координаты OpenF1 иногда замирают на десятки секунд, хотя машина продолжает
 * круг. В подготовленном повторе точное время начала и длительность каждого
 * круга надежнее геопозиции: оно сохраняет реальные интервалы и порядок машин.
 */
function buildOfficialTimingMotion(
  lapTimings: ReplayLapTiming[] | undefined,
  events: ReplayPositionEvent[],
) {
  const timings = (lapTimings ?? [])
    .filter((timing) =>
      Number.isFinite(timing.lapNumber) &&
      timing.lapNumber > 0 &&
      Number.isFinite(timing.startOffsetMs),
    )
    .sort((a, b) => a.startOffsetMs - b.startOffsetMs || a.lapNumber - b.lapNumber);

  if (!timings.length) {
    return null;
  }

  const knots = new Map<number, number>();
  const splitTimingIndexes = findSplitLapTimingIndexes(timings);
  let previousAcceptedTiming: ReplayLapTiming | null = null;
  let rejectedSincePrevious = 0;
  let visualLapValue = timings[0].lapNumber - 1;
  let lastAcceptedTiming = timings[0];

  for (const [index, timing] of timings.entries()) {
    if (splitTimingIndexes.has(index)) {
      rejectedSincePrevious += 1;
      continue;
    }

    if (previousAcceptedTiming) {
      const officialLapDelta = Math.max(1, timing.lapNumber - previousAcceptedTiming.lapNumber);
      visualLapValue += Math.max(1, officialLapDelta - rejectedSincePrevious);
    } else {
      visualLapValue = timing.lapNumber - 1;
    }

    knots.set(
      timing.startOffsetMs,
      Math.max(knots.get(timing.startOffsetMs) ?? -Infinity, visualLapValue),
    );
    previousAcceptedTiming = timing;
    lastAcceptedTiming = timing;
    rejectedSincePrevious = 0;
  }

  const lastTiming = lastAcceptedTiming;
  const lastLapStartValue = visualLapValue;
  const finalLapDurationMs = lastTiming.durationMs;
  const finalLapComplete = finalLapDurationMs !== null &&
    Number.isFinite(finalLapDurationMs) &&
    finalLapDurationMs > 0;

  if (finalLapDurationMs !== null && finalLapComplete) {
    const endMs = lastTiming.startOffsetMs + finalLapDurationMs;
    knots.set(endMs, Math.max(knots.get(endMs) ?? -Infinity, lastLapStartValue + 1));
  } else {
    const previousCompletedLapDurationMs = [...timings]
      .reverse()
      .find((timing) =>
        timing.lapNumber < lastTiming.lapNumber &&
        timing.durationMs !== null &&
        Number.isFinite(timing.durationMs) &&
        timing.durationMs > 0,
      )?.durationMs ?? null;
    const finalLapEvents = collapseFrozenRuns(events.filter((event) =>
      !event.isPitLane &&
      event.lapNumber === lastTiming.lapNumber &&
      event.offsetMs >= lastTiming.startOffsetMs &&
      Number.isFinite(event.progress),
    ));
    const firstFinalLapEvent = finalLapEvents[0];
    const progressAtLapStart = firstFinalLapEvent
      ? normalizeProgress(
          firstFinalLapEvent.progress - estimateProgressSinceLapStart(
            finalLapEvents,
            firstFinalLapEvent,
            lastTiming.startOffsetMs,
            previousCompletedLapDurationMs,
          ),
        )
      : 0;

    for (const event of finalLapEvents) {
      knots.set(
        event.offsetMs,
        lastLapStartValue + normalizeProgress(event.progress - progressAtLapStart),
      );
    }
  }

  const ordered = [...knots.entries()].sort((a, b) => a[0] - b[0]);
  const times: number[] = [];
  const values: number[] = [];

  for (const [time, value] of ordered) {
    const previousValue = values[values.length - 1];

    if (previousValue !== undefined && value < previousValue) {
      continue;
    }

    times.push(time);
    values.push(value);
  }

  return times.length >= 2 ? { finalLapComplete, times, values } : null;
}

function findSplitLapTimingIndexes(timings: ReplayLapTiming[]) {
  const regularDurations = timings
    .map((timing) => timing.durationMs)
    .filter((duration): duration is number =>
      duration !== null &&
      Number.isFinite(duration) &&
      duration >= 45_000 &&
      duration <= 180_000,
    )
    .sort((a, b) => a - b);

  if (regularDurations.length < 3) {
    return new Set<number>();
  }

  const paceLapMs = regularDurations[Math.floor(regularDurations.length / 2)];
  const rejected = new Set<number>();

  for (let index = 1; index < timings.length - 1; index += 1) {
    const beforeMs = timings[index].startOffsetMs - timings[index - 1].startOffsetMs;
    const afterMs = timings[index + 1].startOffsetMs - timings[index].startOffsetMs;
    const combinedMs = beforeMs + afterMs;

    // After a red-flag restart OpenF1 can expose one synthetic lap boundary in
    // the middle of a physical lap. Two short intervals then replace one normal
    // interval. Keeping both makes the marker complete two visual laps at once.
    if (
      beforeMs > 0 &&
      afterMs > 0 &&
      beforeMs < paceLapMs * 0.78 &&
      afterMs < paceLapMs * 0.78 &&
      combinedMs >= paceLapMs * 0.75 &&
      combinedMs <= paceLapMs * 1.35
    ) {
      rejected.add(index);
      index += 1;
    }
  }

  return rejected;
}

function estimateProgressSinceLapStart(
  events: ReplayPositionEvent[],
  firstEvent: ReplayPositionEvent,
  lapStartOffsetMs: number,
  previousLapDurationMs: number | null,
) {
  const nextEvent = events.find((event) => event.offsetMs > firstEvent.offsetMs);
  const elapsedSinceLapStartMs = Math.max(0, firstEvent.offsetMs - lapStartOffsetMs);
  const paceProgress = previousLapDurationMs !== null && previousLapDurationMs > 0
    ? elapsedSinceLapStartMs / previousLapDurationMs
    : 0;

  if (!nextEvent) {
    return paceProgress;
  }

  const sampleSpanMs = nextEvent.offsetMs - firstEvent.offsetMs;
  const sampleProgress = wrapDelta(firstEvent.progress, nextEvent.progress);
  const observedProgress = sampleSpanMs > 0 && sampleProgress > 0
    ? sampleProgress / sampleSpanMs * elapsedSinceLapStartMs
    : 0;

  return observedProgress > 0 && observedProgress >= paceProgress * 0.2
    ? observedProgress
    : paceProgress;
}

function anchorLapsOf(event: ReplayPositionEvent) {
  return typeof event.lapNumber === "number" && Number.isFinite(event.lapNumber) && event.lapNumber > 0
    ? event.lapNumber - 1 + event.progress
    : null;
}

function wrapDelta(from: number, to: number) {
  let delta = to - from;

  if (delta < -0.5) {
    delta += 1;
  } else if (delta > 0.5) {
    delta -= 1;
  }

  return delta;
}

function normalizeProgress(progress: number) {
  return ((progress % 1) + 1) % 1;
}

/*
 * Замороженная телеметрия — подряд идущие сэмплы с одной и той же позицией.
 * Короткие заморозки (< 90 с) выбрасываем целиком: машина в это время ехала,
 * просто данных не было. Длинные оставляем — это настоящая остановка
 * (стартовая решетка, красный флаг, сход).
 */
function collapseFrozenRuns(events: ReplayPositionEvent[]) {
  const result: ReplayPositionEvent[] = [];
  let runStartMs: number | null = null;

  for (const event of events) {
    const last = result[result.length - 1];
    const isFrozen =
      last !== undefined &&
      Math.hypot(event.svgX - last.svgX, event.svgY - last.svgY) < 3 &&
      Math.abs(wrapDelta(last.progress, event.progress)) < 0.001;

    if (isFrozen) {
      if (runStartMs === null) {
        runStartMs = last.offsetMs;
      }

      if (event.offsetMs - runStartMs < 90_000) {
        continue;
      }

      result.push(event);
    } else {
      runStartMs = null;
      result.push(event);
    }
  }

  return result;
}

function estimateLapMs(events: ReplayPositionEvent[]) {
  const speeds: number[] = [];

  for (let index = 1; index < events.length; index += 1) {
    const gapMs = events[index].offsetMs - events[index - 1].offsetMs;

    if (gapMs < 3_000 || gapMs > 15_000) {
      continue;
    }

    const delta = wrapDelta(events[index - 1].progress, events[index].progress);

    if (delta < 0.01 || delta > 0.45) {
      continue;
    }

    speeds.push(delta / gapMs);
  }

  if (speeds.length < 20) {
    return null;
  }

  speeds.sort((a, b) => a - b);

  return 1 / speeds[Math.floor(speeds.length / 2)];
}

function hasPitTimeBetween(pitTimes: number[], fromMs: number, toMs: number) {
  let low = 0;
  let high = pitTimes.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);

    if (pitTimes[mid] < fromMs) {
      low = mid + 1;
    } else if (pitTimes[mid] > toMs) {
      high = mid - 1;
    } else {
      return true;
    }
  }

  return false;
}

/*
 * На части трасс снаппинг в снапшоте дает «замер-догон»: прогресс не растет
 * один-два сэмпла, а потом скачком наверстывает. Без чистки машина видимо
 * тормозит в ноль и снова разгоняется. Выбрасываем такие точки: настоящие
 * замедления (сейфти-кар, авария) — это длинные серии медленных сэмплов,
 * у них скорость на выходе тоже низкая, и фильтр их не трогает.
 */
function cleanStallArtifacts(times: number[], values: number[]) {
  let currentTimes = times;
  let currentValues = values;

  for (let pass = 0; pass < 3; pass += 1) {
    if (currentTimes.length < 5) {
      break;
    }

    const speeds: number[] = [];

    for (let index = 1; index < currentTimes.length; index += 1) {
      speeds.push(
        (currentValues[index] - currentValues[index - 1]) /
          Math.max(currentTimes[index] - currentTimes[index - 1], 1),
      );
    }

    const positiveSpeeds = speeds.filter((value) => value > 0).sort((a, b) => a - b);
    const median = positiveSpeeds[Math.floor(positiveSpeeds.length / 2)];

    if (!median) {
      break;
    }

    const keep = new Array<boolean>(currentTimes.length).fill(true);
    let removed = 0;

    for (let index = 1; index < currentTimes.length - 1; index += 1) {
      if (currentTimes[index + 1] - currentTimes[index - 1] > 45_000) {
        continue;
      }

      const speedIn = speeds[index - 1];
      const speedOut = speeds[index];
      const isStallThenCatchUp = speedIn < median * 0.35 && speedOut > median * 0.7;
      const isSpikeThenStall = speedIn > median * 1.6 && speedOut < median * 0.35;

      if (isStallThenCatchUp || isSpikeThenStall) {
        keep[index] = false;
        removed += 1;
        index += 1;
      }
    }

    if (!removed) {
      break;
    }

    currentTimes = currentTimes.filter((_, index) => keep[index]);
    currentValues = currentValues.filter((_, index) => keep[index]);
  }

  return { times: currentTimes, values: currentValues };
}

export function trackProgressAt(motion: DriverMotion, elapsedMs: number): MotionSample | null {
  const { times, values, slopes } = motion;

  if (!times.length) {
    return null;
  }

  if (elapsedMs <= times[0]) {
    return { hold: true, unwrapped: values[0] };
  }

  const lastIndex = times.length - 1;

  if (elapsedMs >= times[lastIndex]) {
    return { hold: true, unwrapped: values[lastIndex] };
  }

  let low = 0;
  let high = lastIndex;

  while (low < high - 1) {
    const mid = Math.floor((low + high) / 2);

    if (times[mid] <= elapsedMs) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const span = times[high] - times[low];

  if (span > MAX_MOTION_GAP_MS && !motion.timed) {
    return { hold: true, unwrapped: values[low] };
  }

  const t = (elapsedMs - times[low]) / Math.max(span, 1e-6);
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const value =
    h00 * values[low] +
    h10 * span * slopes[low] +
    h01 * values[high] +
    h11 * span * slopes[high];

  return { hold: false, unwrapped: Math.max(values[low], Math.min(values[high], value)) };
}

// Pit timestamps anchor the car to the actual entry/exit on the circuit. Lap
// timing alone describes the start line, not the detour through the pit lane.
export function anchorMotionToPits(
  motion: DriverMotion,
  pits: { startOffsetMs: number; endOffsetMs: number }[],
  entryProgress: number,
  exitProgress: number,
): DriverMotion {
  let knots = motion.times.map((time, index) => ({ time, value: motion.values[index] }));
  for (const pit of [...pits].sort((a, b) => a.startOffsetMs - b.startOffsetMs)) {
    const sample = trackProgressAt(motion, pit.startOffsetMs);
    if (!sample || pit.endOffsetMs <= pit.startOffsetMs) continue;
    const entry = Math.round(sample.unwrapped - entryProgress) + entryProgress;
    const exit = entry + normalizeProgress(exitProgress - entryProgress);
    // Discard neighbouring timing anchors that would require an impossible
    // catch-up lap. Pit and lap feeds can disagree by an entire lap.
    const minimumLapMs = 40_000;
    knots = knots.filter(({time, value}) =>
      (time < pit.startOffsetMs && value <= entry &&
        (entry - value) * minimumLapMs <= pit.startOffsetMs - time) ||
      (time > pit.endOffsetMs && value >= exit &&
        (value - exit) * minimumLapMs <= time - pit.endOffsetMs),
    );
    knots.push({time: pit.startOffsetMs, value: entry}, {time: pit.endOffsetMs, value: exit});
    knots.sort((a, b) => a.time - b.time);
  }
  const times = knots.map((knot) => knot.time);
  const values = knots.map((knot) => knot.value);
  return { ...motion, times, values, slopes: fritschCarlsonSlopes(times, values) };
}

export function isDriverRetiredOnTrack(
  events: ReplayPositionEvent[],
  elapsedMs: number,
  finalLapComplete: boolean | undefined,
) {
  if (finalLapComplete || elapsedMs < 6 * 60_000 || events.length < 4) {
    return false;
  }

  const currentIndex = findReplayEventIndexAt(events, elapsedMs);

  if (currentIndex < 0) {
    return false;
  }

  if (hasNearbyFutureMovement(events, currentIndex)) {
    return false;
  }

  const stoppedSince = findStoppedSinceOffset(events, currentIndex);

  return elapsedMs - stoppedSince >= RETIREMENT_STILLNESS_MS;
}

function findReplayEventIndexAt(events: ReplayPositionEvent[], elapsedMs: number) {
  let low = 0;
  let high = events.length - 1;
  let indexAt = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);

    if (events[middle].offsetMs <= elapsedMs) {
      indexAt = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return indexAt;
}

function hasNearbyFutureMovement(events: ReplayPositionEvent[], index: number) {
  const origin = events[index];

  for (let nextIndex = index + 1; nextIndex < events.length; nextIndex += 1) {
    const next = events[nextIndex];

    if (next.offsetMs - origin.offsetMs > RETIREMENT_LOOKAHEAD_MS) {
      break;
    }

    if (distanceBetweenReplayPoints(origin, next) > RETIREMENT_MOVEMENT_THRESHOLD) {
      return true;
    }
  }

  return false;
}

function findStoppedSinceOffset(events: ReplayPositionEvent[], index: number) {
  const current = events[index];
  let stoppedSince = current.offsetMs;

  for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
    if (distanceBetweenReplayPoints(current, events[previousIndex]) > RETIREMENT_MOVEMENT_THRESHOLD) {
      break;
    }

    stoppedSince = events[previousIndex].offsetMs;
  }

  return stoppedSince;
}

function distanceBetweenReplayPoints(a: ReplayPositionEvent, b: ReplayPositionEvent) {
  return Math.hypot(a.svgX - b.svgX, a.svgY - b.svgY);
}

/*
 * Фазы пит-стопа: замедление к боксу, стоянка на время pit stop, разгон на выезд.
 * Возвращает параметр 0..1 вдоль пит-лейна.
 */
export function pitLaneParamAt(
  window: { startMs: number; endMs: number; pitStopSeconds: number | null },
  elapsedMs: number,
): number {
  const total = Math.max(window.endMs - window.startMs, 1);
  const local = Math.min(Math.max(elapsedMs - window.startMs, 0), total);
  const stopMs = window.pitStopSeconds !== null ? window.pitStopSeconds * 1000 : 0;
  const boxParam = 0.52;

  if (stopMs <= 0 || stopMs >= total * 0.9) {
    return local / total;
  }

  const driveMs = (total - stopMs) / 2;

  if (local <= driveMs) {
    return easeOutCubic(local / driveMs) * boxParam;
  }

  if (local <= driveMs + stopMs) {
    return boxParam;
  }

  return boxParam + easeInCubic((local - driveMs - stopMs) / driveMs) * (1 - boxParam);
}

function fritschCarlsonSlopes(times: number[], values: number[]) {
  const count = times.length;
  const slopes = new Array<number>(count).fill(0);

  if (count < 2) {
    return slopes;
  }

  const deltas: number[] = [];

  for (let index = 0; index < count - 1; index += 1) {
    const span = Math.max(times[index + 1] - times[index], 1e-6);
    deltas.push((values[index + 1] - values[index]) / span);
  }

  slopes[0] = deltas[0];
  slopes[count - 1] = deltas[count - 2];

  for (let index = 1; index < count - 1; index += 1) {
    slopes[index] = deltas[index - 1] * deltas[index] <= 0 ? 0 : (deltas[index - 1] + deltas[index]) / 2;
  }

  for (let index = 0; index < count - 1; index += 1) {
    if (deltas[index] === 0) {
      slopes[index] = 0;
      slopes[index + 1] = 0;
      continue;
    }

    const alpha = slopes[index] / deltas[index];
    const beta = slopes[index + 1] / deltas[index];
    const norm = alpha * alpha + beta * beta;

    if (norm > 9) {
      const tau = 3 / Math.sqrt(norm);
      slopes[index] = tau * alpha * deltas[index];
      slopes[index + 1] = tau * beta * deltas[index];
    }
  }

  return slopes;
}

function easeOutCubic(t: number) {
  const clamped = Math.min(Math.max(t, 0), 1);

  return 1 - Math.pow(1 - clamped, 3);
}

function easeInCubic(t: number) {
  const clamped = Math.min(Math.max(t, 0), 1);

  return clamped * clamped * clamped;
}
