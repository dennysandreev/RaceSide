import { getReplayTimedPositionsAt } from "../../race-replay/lib/timing-order.ts";
import {
  buildDriverMotion,
  anchorMotionToPits,
  inferLapTimingsFromPositions,
  isDriverRetiredOnTrack,
  MAX_MOTION_GAP_MS,
  mergeLapTimingsWithInferred,
  pitLaneParamAt,
  trackProgressAt,
  type DriverMotion,
} from "../../race-replay/lib/motion.ts";
import {
  buildPitGeometry,
  buildTrackGeometry,
} from "../../race-replay/lib/track-geometry.ts";
import type {
  RaceReplaySnapshot,
  ReplayPositionEvent,
  ReplayRadioText,
} from "@/types/racemate";

import type {
  DriverLiveState,
  FeedEvent,
  LiveMessage,
  LiveSessionState,
  LocationSample,
  RadioMessage,
  TelemetrySample,
} from "./types";

type ReplayPit = LiveSessionState["pits"][number] & {
  endOffsetMs: number;
  startOffsetMs: number;
};

type ReplayFramePosition = ReplayPositionEvent & {
  pitLaneProgress: number | null;
  retired?: boolean;
};

export class LiveReplayAdapter {
  readonly playbackStartMs: number;
  readonly durationMs: number;

  private readonly baseTimestampMs: number;
  private readonly positionsByDriver = new Map<number, ReplayPositionEvent[]>();
  private readonly speedRecords = new Map<
    number,
    { offsetMs: number; speed: number }[]
  >();
  private readonly motions = new Map<number, DriverMotion>();
  private readonly geometry: ReturnType<typeof buildTrackGeometry>;
  private readonly pitGeometry: ReturnType<typeof buildPitGeometry>;
  private readonly pitTrackProgress:
    { entry: number; exit: number } | undefined;
  private readonly pits: ReplayPit[];
  private readonly replay: RaceReplaySnapshot;
  private readonly redFlagWindows: Array<{ endMs: number; startMs: number }>;
  private readonly trackSectorCount: number | null;

  constructor(replay: RaceReplaySnapshot) {
    this.replay = {
      ...replay,
      lapTimings: mergeLapTimingsWithInferred(
        replay.lapTimings,
        inferLapTimingsFromPositions(
          replay.positions,
          getPlaybackStartMs(replay),
        ),
      ),
    };
    this.durationMs = Math.max(1, replay.durationMs);
    this.playbackStartMs = getPlaybackStartMs(replay);
    this.baseTimestampMs = getBaseTimestampMs(replay);
    this.geometry = buildTrackGeometry(
      replay.track.centerline,
      replay.track.startFinish.progress,
    );
    const pitPoints = replay.track.pitLane?.points ?? [];
    const entry = this.nearestTrackPoint(pitPoints[0]);
    const exit = this.nearestTrackPoint(pitPoints.at(-1));
    this.pitTrackProgress =
      entry && exit
        ? { entry: entry.progress, exit: exit.progress }
        : undefined;
    this.pitGeometry = buildPitGeometry(
      entry && exit
        ? [
            { svgX: entry.x, svgY: entry.y },
            ...pitPoints,
            { svgX: exit.x, svgY: exit.y },
          ]
        : pitPoints,
    );

    for (const position of replay.positions) {
      const items = this.positionsByDriver.get(position.driverNumber) ?? [];
      items.push(position);
      this.positionsByDriver.set(position.driverNumber, items);
    }

    for (const [driverNumber, items] of this.positionsByDriver) {
      items.sort((left, right) => left.offsetMs - right.offsetMs);
      const records: { offsetMs: number; speed: number }[] = [];
      for (const item of items) {
        if (
          item.speedKph != null &&
          Number.isFinite(item.speedKph) &&
          item.speedKph >= 0 &&
          item.speedKph > (records.at(-1)?.speed ?? -1)
        )
          records.push({ offsetMs: item.offsetMs, speed: item.speedKph });
      }
      this.speedRecords.set(driverNumber, records);
      this.motions.set(
        driverNumber,
        buildDriverMotion(items, {
          lapTimings: this.replay.lapTimings?.filter(
            (lap) => lap.driverNumber === driverNumber,
          ),
        }),
      );
    }

    this.pits = buildPits(this.positionsByDriver, this.baseTimestampMs);
    this.redFlagWindows = buildRedFlagWindows(
      replay.raceEvents,
      this.durationMs,
    );
    if (entry && exit) {
      for (const [driverNumber, motion] of this.motions) {
        this.motions.set(
          driverNumber,
          anchorMotionToPits(
            motion,
            this.pits.filter((pit) => pit.driverNumber === driverNumber),
            entry.progress,
            exit.progress,
          ),
        );
      }
    }
    this.trackSectorCount = getTrackSectorCount(replay);
  }

  private nearestTrackPoint(point: { svgX: number; svgY: number } | undefined) {
    if (!point || !this.geometry) return null;
    return this.geometry.samples.reduce((nearest, sample) =>
      Math.hypot(sample.x - point.svgX, sample.y - point.svgY) <
      Math.hypot(nearest.x - point.svgX, nearest.y - point.svgY)
        ? sample
        : nearest,
    );
  }

  // Both renderers sample this trajectory on every animation frame. Replay
  // never goes through the delayed network interpolation used by real LIVE.
  sampleLocation(driverNumber: number, elapsedMs: number) {
    const position = this.positionAt(
      driverNumber,
      clamp(elapsedMs, 0, this.durationMs),
    );
    if (!position || position.retired) return null;
    return {
      ...toLocation(
        position,
        new Date(this.baseTimestampMs + elapsedMs).toISOString(),
      ),
      pitTrackProgress: this.pitTrackProgress,
      stale: false,
    };
  }

  private positionAt(
    driverNumber: number,
    elapsedMs: number,
  ): ReplayFramePosition | null {
    const motion = this.motions.get(driverNumber);
    if (!motion) return null;
    const position = positionAt(motion.events, elapsedMs);
    if (!position) return null;
    const redFlagActive = this.redFlagWindows.some(
      (window) => elapsedMs >= window.startMs && elapsedMs < window.endMs,
    );
    const sample = redFlagActive ? null : trackProgressAt(motion, elapsedMs);
    const progress = sample
      ? ((sample.unwrapped % 1) + 1) % 1
      : position.progress;
    const pit = this.pits.find(
      (item) =>
        item.driverNumber === driverNumber &&
        elapsedMs >= item.startOffsetMs &&
        elapsedMs < item.endOffsetMs,
    );
    const pitLaneProgress =
      pit && this.pitGeometry
        ? pitLaneParamAt(
            {
              startMs: pit.startOffsetMs,
              endMs: pit.endOffsetMs,
              pitStopSeconds: pit.duration,
            },
            elapsedMs,
          )
        : null;
    const point =
      pitLaneProgress !== null
        ? this.pitGeometry!.pointAt(pitLaneProgress)
        : this.geometry?.pointAt(progress);
    return {
      ...position,
      progress,
      pitLaneProgress,
      isPitLane: Boolean(pit),
      svgX: point?.x ?? position.svgX,
      svgY: point?.y ?? position.svgY,
      headingRad: point?.headingRad ?? position.headingRad,
      retired:
        !pit &&
        isDriverRetiredOnTrack(
          motion.events,
          elapsedMs,
          motion.finalLapComplete,
        ),
    };
  }

  frame(elapsedMs: number, isPlaying: boolean): LiveMessage {
    const boundedElapsed = clamp(elapsedMs, 0, this.durationMs);
    const virtualNow = this.baseTimestampMs + boundedElapsed;
    const timestamp = new Date(virtualNow).toISOString();
    const timedPositions = getReplayTimedPositionsAt(
      this.replay.positionTimings,
      boundedElapsed,
    );
    const positions = new Map<number, ReplayFramePosition>();

    for (const driverNumber of this.positionsByDriver.keys()) {
      const position = this.positionAt(driverNumber, boundedElapsed);
      if (position) positions.set(driverNumber, position);
    }

    const intervalByDriver = intervalsAt(
      this.replay.intervalTimings,
      boundedElapsed,
    );
    const drivers = Object.fromEntries(
      this.replay.drivers.map((driver) => {
        const position = positions.get(driver.driverNumber);
        const timedPosition = timedPositions.get(driver.driverNumber);
        const interval = intervalByDriver.get(driver.driverNumber);
        const lapHistory = getLapHistory(
          this.replay,
          driver.driverNumber,
          boundedElapsed,
          position?.compound ?? driver.compound,
        );
        const bestLap = minimum(
          lapHistory
            .filter((lap) => !lap.deleted && !lap.pit)
            .map((lap) => lap.duration),
        );
        const currentSectors = [
          parseTiming(position?.sector1Time ?? driver.sector1Time),
          parseTiming(position?.sector2Time ?? driver.sector2Time),
          parseTiming(position?.sector3Time ?? driver.sector3Time),
        ];
        const finalSample = this.positionsByDriver
          .get(driver.driverNumber)
          ?.at(-1);
        const retired =
          position?.retired ||
          (isRetiredStatus(driver.status) &&
            finalSample !== undefined &&
            boundedElapsed >= finalSample.offsetMs);
        const state: DriverLiveState = {
          acronym: driver.abbreviation,
          bestLap: bestLap ?? parseTiming(driver.bestLapTime),
          maxSpeed:
            this.speedRecords
              .get(driver.driverNumber)
              ?.findLast((record) => record.offsetMs <= boundedElapsed)
              ?.speed ?? null,
          bestLapSectors: currentSectors,
          bestSectors: currentSectors,
          compound: position?.compound ?? driver.compound,
          driverNumber: driver.driverNumber,
          eliminatedIn: null,
          fullName: driver.fullName,
          gap:
            interval?.gapToLeader ??
            position?.gapToLeader ??
            driver.gapToLeader,
          interval:
            interval?.intervalToAhead ??
            position?.intervalToAhead ??
            driver.intervalToAhead,
          lap:
            lapAt(this.replay, driver.driverNumber, boundedElapsed) ??
            position?.lapNumber ??
            0,
          lapHistory,
          lastLap:
            position?.lastLapDuration ??
            parseTiming(position?.lastLapTime ?? driver.lastLapTime),
          lastUpdatedAt: timestamp,
          pace: lapHistory.map((lap) => ({
            compound: lap.compound ?? "UNKNOWN",
            duration: lap.duration,
            lap: lap.lap,
            pit: lap.pit,
          })),
          pitCount: this.pits.filter(
            (pit) =>
              pit.driverNumber === driver.driverNumber &&
              pit.startOffsetMs <= boundedElapsed,
          ).length,
          pitEnteredAt: position?.isPitLane ? timestamp : null,
          position:
            timedPosition?.position ?? position?.position ?? driver.position,
          sectors: currentSectors,
          status: retired ? "RETIRED" : position?.isPitLane ? "PIT" : "RUNNING",
          team: driver.teamName,
          teamColour: driver.teamColor,
          tyreAge: position?.tyreAge ?? driver.tyreAge,
          tyreAgeEstimated: position?.tyreAge != null
            ? Boolean(position.tyreAgeEstimated)
            : Boolean(driver.tyreAgeEstimated),
        };

        return [driver.driverNumber, state];
      }),
    );
    const locations = Object.fromEntries(
      [...positions].map(([driverNumber, position]) => [
        driverNumber,
        toLocation(position, timestamp),
      ]),
    );
    const telemetry = Object.fromEntries(
      [...positions].map(([driverNumber, position]) => [
        driverNumber,
        toTelemetry(position, timestamp),
      ]),
    );
    const signal = getRaceSignal(
      this.replay.raceEvents,
      boundedElapsed,
      boundedElapsed >= this.durationMs,
    );
    const currentLap = Math.max(
      0,
      ...Object.values(drivers).map((driver) => driver.lap),
    );
    const data: Partial<LiveSessionState> = {
      currentLap,
      drivers,
      events: visibleEvents(this.replay, boundedElapsed),
      flag: signal.flag,
      locations,
      phase: null,
      phaseEndsAt: null,
      phaseStartedAt: null,
      pits: this.pits
        .filter((pit) => pit.startOffsetMs <= boundedElapsed)
        .map(toLivePit),
      radio: visibleRadio(this.replay.radio ?? [], boundedElapsed),
      replayReady: true,
      session: {
        circuit_short_name: this.replay.circuitName,
        date_end: new Date(
          this.baseTimestampMs + this.durationMs,
        ).toISOString(),
        date_start: new Date(this.baseTimestampMs).toISOString(),
        meeting_key: this.replay.sourceSessionKey,
        race_name: this.replay.raceName,
        session_key: this.replay.sourceSessionKey,
        session_name: "Race",
        session_type: "Race",
      },
      status:
        boundedElapsed >= this.durationMs
          ? "finished"
          : isPlaying
            ? "live"
            : "paused",
      telemetry,
      timerOffsetMs: 0,
      timerPausedAt: isPlaying ? null : timestamp,
      totalLaps: this.replay.totalLaps,
      track: this.replay.track,
      trackSectorCount: this.trackSectorCount,
      updatedAt: timestamp,
      weather: this.replay.weather
        ? {
            air: this.replay.weather.airTemperatureC ?? null,
            humidity: null,
            rain: Number(this.replay.weather.rainfall ?? 0) > 0 ? 1 : 0,
            timestamp,
            track: this.replay.weather.trackTemperatureC ?? null,
            wind:
              this.replay.weather.windSpeedKmh == null
                ? null
                : this.replay.weather.windSpeedKmh / 3.6,
          }
        : null,
      yellowSectors: signal.yellowSectors,
    };
    const samples: NonNullable<LiveMessage["samples"]> = [];

    for (const [driverNumber, position] of positions) {
      samples.push({
        ...toLocation(position, timestamp),
        driverNumber,
        type: "location",
      });
      samples.push({
        ...toTelemetry(position, timestamp),
        driverNumber,
        type: "telemetry",
      });
    }

    return {
      data,
      samples,
      serverTime: virtualNow,
      type: "snapshot",
    };
  }
}

function positionAt(
  positions: ReplayPositionEvent[],
  elapsedMs: number,
): ReplayFramePosition | null {
  if (!positions.length) return null;
  let low = 0;
  let high = positions.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (positions[middle].offsetMs <= elapsedMs) low = middle + 1;
    else high = middle - 1;
  }

  const current = positions[Math.max(0, high)];
  const next = positions[Math.min(positions.length - 1, high + 1)];
  const span = next.offsetMs - current.offsetMs;
  const ratio =
    span > 0 && span <= MAX_MOTION_GAP_MS
      ? clamp((elapsedMs - current.offsetMs) / span, 0, 1)
      : 0;
  let progressDelta = next.progress - current.progress;
  if (progressDelta < -0.5) progressDelta += 1;
  if (progressDelta > 0.5) progressDelta -= 1;

  return {
    ...current,
    drs: nearest(current.drs, next.drs, ratio),
    gear: nearest(current.gear, next.gear, ratio),
    headingRad: interpolateAngle(current.headingRad, next.headingRad, ratio),
    pitLaneProgress: null,
    progress: (current.progress + progressDelta * ratio + 1) % 1,
    speedKph: interpolateOptional(current.speedKph, next.speedKph, ratio),
    svgX: interpolate(current.svgX, next.svgX, ratio),
    svgY: interpolate(current.svgY, next.svgY, ratio),
    z: interpolate(current.z, next.z, ratio),
  };
}

function toLocation(
  position: ReplayFramePosition,
  timestamp: string,
): LocationSample {
  return {
    pitLaneProgress: position.pitLaneProgress,
    progress: position.progress,
    timestamp,
    x: position.svgX,
    y: position.svgY,
    z: position.z,
  };
}

function toTelemetry(
  position: ReplayFramePosition,
  timestamp: string,
): TelemetrySample {
  return {
    brake: null,
    drs: position.drs ?? null,
    gear: position.gear ?? null,
    rpm: null,
    speed: position.speedKph ?? null,
    throttle: null,
    timestamp,
  };
}

function getPlaybackStartMs(replay: RaceReplaySnapshot) {
  const firstLapStarts = (replay.lapTimings ?? [])
    .filter((timing) => timing.lapNumber === 1 && timing.startOffsetMs >= 0)
    .map((timing) => timing.startOffsetMs);
  if (firstLapStarts.length) return Math.min(...firstLapStarts);

  const raceStarts = replay.raceEvents
    .filter(
      (event) =>
        event.message.trim().toUpperCase() === "SESSION STARTED" &&
        event.offsetMs >= 0,
    )
    .map((event) => event.offsetMs);
  if (raceStarts.length) return Math.min(...raceStarts);

  const starts = replay.positions
    .filter((position) => position.lapNumber === 1)
    .map((position) => Math.max(0, position.offsetMs));
  return starts.length ? Math.min(...starts) : 0;
}

function getBaseTimestampMs(replay: RaceReplaySnapshot) {
  const candidates = [
    ...replay.positions.map(
      (position) => Date.parse(position.timestamp) - position.offsetMs,
    ),
    ...replay.raceEvents.map(
      (event) => Date.parse(event.timestamp) - event.offsetMs,
    ),
  ].filter(Number.isFinite);
  return candidates.length
    ? Math.min(...candidates)
    : Date.UTC(replay.sourceSeason, 0, 1);
}

function intervalsAt(
  timings: RaceReplaySnapshot["intervalTimings"],
  elapsedMs: number,
) {
  const result = new Map<
    number,
    { gapToLeader: string | null; intervalToAhead: string | null }
  >();
  for (const timing of timings ?? []) {
    if (timing.offsetMs <= elapsedMs) {
      result.set(timing.driverNumber, {
        gapToLeader: timing.gapToLeader,
        intervalToAhead: timing.intervalToAhead,
      });
    }
  }
  return result;
}

function lapAt(
  replay: RaceReplaySnapshot,
  driverNumber: number,
  elapsedMs: number,
) {
  let lap: number | null = null;
  for (const timing of replay.lapTimings ?? []) {
    if (
      timing.driverNumber === driverNumber &&
      timing.startOffsetMs <= elapsedMs
    ) {
      lap = Math.max(lap ?? 0, timing.lapNumber);
    }
  }
  return lap;
}

function toLivePit(pit: ReplayPit): LiveSessionState["pits"][number] {
  return {
    after: pit.after,
    before: pit.before,
    driverNumber: pit.driverNumber,
    duration: pit.duration,
    id: pit.id,
    laneDuration: pit.laneDuration,
    lap: pit.lap,
    timestamp: pit.timestamp,
  };
}

function getLapHistory(
  replay: RaceReplaySnapshot,
  driverNumber: number,
  elapsedMs: number,
  compound: string | null,
): NonNullable<DriverLiveState["lapHistory"]> {
  return (replay.lapTimings ?? [])
    .filter(
      (timing) =>
        timing.driverNumber === driverNumber &&
        timing.durationMs !== null &&
        timing.startOffsetMs + timing.durationMs <= elapsedMs,
    )
    .map((timing) => ({
      compound,
      duration: timing.durationMs! / 1_000,
      lap: timing.lapNumber,
      pit: false,
      sectors: [null, null, null],
    }));
}

function buildPits(
  positionsByDriver: Map<number, ReplayPositionEvent[]>,
  baseTimestampMs: number,
) {
  const pits: ReplayPit[] = [];
  for (const [driverNumber, positions] of positionsByDriver) {
    let start: ReplayPositionEvent | null = null;
    for (const position of positions) {
      if (position.isPitLane && !start) start = position;
      if (!position.isPitLane && start) {
        pits.push({
          after: position.compound ?? null,
          before: start.compound ?? null,
          driverNumber,
          // Legacy OpenF1 snapshots put the full lane duration in both
          // fields. Treating it as stationary time makes cars rush through
          // the lane in the few seconds left around that artificial stop.
          duration:
            start.pitStopDuration != null &&
            (start.pitLaneDuration == null ||
              start.pitStopDuration < start.pitLaneDuration - 1)
              ? start.pitStopDuration
              : null,
          endOffsetMs: position.offsetMs,
          id: `replay-pit-${driverNumber}-${start.offsetMs}`,
          laneDuration:
            start.pitLaneDuration ??
            (position.offsetMs - start.offsetMs) / 1_000,
          lap: start.lapNumber ?? 0,
          startOffsetMs: start.offsetMs,
          timestamp: new Date(baseTimestampMs + start.offsetMs).toISOString(),
        });
        start = null;
      }
    }
  }
  return pits.sort((left, right) => right.startOffsetMs - left.startOffsetMs);
}

function visibleEvents(
  replay: RaceReplaySnapshot,
  elapsedMs: number,
): FeedEvent[] {
  return replay.raceEvents
    .filter((event) => event.offsetMs <= elapsedMs)
    .slice()
    .reverse()
    .map((event) => ({
      driverNumber: event.driverNumber ?? null,
      id: `replay-event-${event.offsetMs}-${event.message}`,
      lap: event.lapNumber ?? null,
      message: event.message,
      original: null,
      timestamp: event.timestamp,
      type: event.type,
    }));
}

function visibleRadio(
  items: ReplayRadioText[],
  elapsedMs: number,
): RadioMessage[] {
  return items
    .filter((item) => item.offsetMs <= elapsedMs)
    .slice()
    .reverse()
    .map((item) => ({
      driverNumber: item.driverNumber,
      id: item.id,
      lap: item.lap,
      original: item.original,
      playable: false,
      ru: item.ru,
      status: item.status === "ready" ? "ready" : "failed",
      timestamp: item.timestamp,
    }));
}

function getRaceSignal(
  events: RaceReplaySnapshot["raceEvents"],
  elapsedMs: number,
  finished: boolean,
) {
  if (finished) return { flag: "CHEQUERED", yellowSectors: [] as number[] };
  let flag: string | null = "GREEN";
  const yellowSectors = new Set<number>();
  for (const event of events) {
    if (event.offsetMs > elapsedMs) continue;
    const text = event.message.toUpperCase();
    if (isStewardsYellowReference(text)) continue;
    const sector = Number(text.match(/TRACK SECTOR\s+(\d+)/)?.[1]);
    if (isRaceRestartSignal(text)) {
      flag = "GREEN";
      yellowSectors.clear();
    } else if (text.includes("TRACK CLEAR")) {
      if (flag === "YELLOW" || flag === "SC_ENDING") flag = "GREEN";
      yellowSectors.clear();
    } else if (text.includes("CLEAR") && Number.isFinite(sector)) {
      yellowSectors.delete(sector);
      if (!yellowSectors.size && flag === "YELLOW") flag = "GREEN";
    } else if (text.includes("RED FLAG")) {
      flag = "RED";
      yellowSectors.clear();
    } else if (isVirtualSafetyCarEndSignal(text)) {
      flag = "GREEN";
      yellowSectors.clear();
    } else if (isVirtualSafetyCarDeploySignal(text)) flag = "VSC";
    else if (/\bSAFETY CAR (?:IN THIS LAP|ENDING)\b/.test(text))
      flag = "SC_ENDING";
    else if (/\bSAFETY CAR DEPLOYED\b/.test(text)) flag = "SC";
    else if (isActiveYellowSignal(text)) {
      if (!["RED", "SC", "SC_ENDING", "VSC", "VSC_ENDING"].includes(flag ?? ""))
        flag = "YELLOW";
      if (Number.isFinite(sector)) yellowSectors.add(sector);
    } else if (text.includes("CHEQUERED") || text.includes("CHECKERED")) {
      flag = "CHEQUERED";
    }
  }
  return { flag, yellowSectors: [...yellowSectors].sort((a, b) => a - b) };
}

function isStewardsYellowReference(text: string) {
  return /INFRINGEMENT|INVESTIGAT(?:ION|ED)|FIA STEWARDS|PENALTY|NOTED/.test(
    text,
  );
}

function isVirtualSafetyCarDeploySignal(text: string) {
  return /\b(?:VIRTUAL SAFETY CAR|VSC) DEPLOYED\b/.test(text);
}

function isRaceRestartSignal(text: string) {
  return /^(?:SESSION STARTED|RACE START|STANDING START|ROLLING START|SESSION RESUMED|RACE RESUMED|RACE RESTARTED|GREEN FLAG|RED FLAG CLEARED)\b/.test(
    text.trim(),
  );
}

function buildRedFlagWindows(
  events: RaceReplaySnapshot["raceEvents"],
  durationMs: number,
) {
  const windows: Array<{ endMs: number; startMs: number }> = [];
  let startMs: number | null = null;

  for (const event of [...events].sort((a, b) => a.offsetMs - b.offsetMs)) {
    const text = event.message.toUpperCase().trim();

    if (/^RED FLAG\b/.test(text) && !text.includes("INFRINGEMENT")) {
      startMs ??= event.offsetMs;
      continue;
    }

    if (startMs !== null && isRaceRestartSignal(text)) {
      windows.push({ endMs: event.offsetMs, startMs });
      startMs = null;
    }
  }

  if (startMs !== null) windows.push({ endMs: durationMs, startMs });
  return windows;
}

function isVirtualSafetyCarEndSignal(text: string) {
  return /\b(?:VIRTUAL SAFETY CAR|VSC) (?:ENDING|ENDED)\b/.test(text);
}

function isActiveYellowSignal(text: string) {
  return /^(?:DOUBLE\s+)?YELLOW(?:\s+FLAG)?(?:\s+IN\s+TRACK\s+SECTOR\s+\d+)?(?:\s|$)/.test(
    text.trim(),
  );
}

function getTrackSectorCount(replay: RaceReplaySnapshot) {
  const sectors = replay.raceEvents
    .map((event) => Number(event.message.match(/track sector\s+(\d+)/i)?.[1]))
    .filter(Number.isFinite);
  return sectors.length ? Math.max(...sectors) : null;
}

function parseTiming(value: string | null | undefined) {
  if (!value) return null;
  const match = value.replace(",", ".").match(/(?:(\d+):)?(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const seconds = Number(match[2]) + Number(match[1] ?? 0) * 60;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function isRetiredStatus(status: string) {
  return ["DNF", "DNS", "DSQ", "OUT", "RETIRED"].includes(status.toUpperCase());
}

function minimum(values: Array<number | null>) {
  const finite = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  return finite.length ? Math.min(...finite) : null;
}

function nearest(
  start: number | null | undefined,
  end: number | null | undefined,
  ratio: number,
) {
  return ratio < 0.5 ? (start ?? null) : (end ?? start ?? null);
}

function interpolateOptional(
  start: number | null | undefined,
  end: number | null | undefined,
  ratio: number,
) {
  return start == null || end == null
    ? (start ?? end ?? null)
    : interpolate(start, end, ratio);
}

function interpolate(start: number, end: number, ratio: number) {
  return start + (end - start) * ratio;
}

function interpolateAngle(start: number, end: number, ratio: number) {
  let delta = end - start;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return start + delta * ratio;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
