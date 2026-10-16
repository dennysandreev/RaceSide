import { sessionCapabilities } from "./session-mode.mjs";
import { createHash } from "node:crypto";

export const DATASETS = [
  "sessions",
  "drivers",
  "position",
  "intervals",
  "location",
  "car_data",
  "laps",
  "stints",
  "pit",
  "race_control",
  "weather",
  "overtakes",
  "team_radio",
  "session_result",
];
export const number = (value) =>
  value !== null && value !== "" && Number.isFinite(Number(value))
    ? Number(value)
    : null;
const isOut = (driver) =>
  ["DNF", "DNS", "RETIRED", "DSQ"].includes(driver.status);
const hasTrackActivity = (driver, state) =>
  driver.lap > 0 ||
  driver.pitCount > 0 ||
  driver.lastLap != null ||
  (driver.lapHistory?.length ?? 0) > 0 ||
  (state?.events ?? []).some(
    (event) => Number(event.driverNumber) === driver.driverNumber,
  );
function controlExit(row) {
  // Only explicit withdrawal/disqualification, never STOPPED or deleted laps.
  const match = (row.message ?? "")
    .trim()
    .match(
      /^(?:CAR\s+(\d+)(?:\s+\([A-Z]{2,4}\))?\s*[-:]?\s+)?(?:HAS\s+)?(RETIRED|DISQUALIFIED)(?:\s+FROM\s+(?:THE\s+)?(?:RACE|SESSION|SPRINT))?[.!]?$/i,
    );
  const driverNumber = number(match?.[1] ?? row.driver_number);
  return match && driverNumber !== null
    ? {
        driverNumber,
        status: match[2].toUpperCase() === "RETIRED" ? "DNF" : "DSQ",
      }
    : null;
}
function recalculateBest(driver, phase) {
  const valid = (driver.lapHistory ?? []).filter(
    (lap) =>
      !lap.deleted &&
      !lap.outLap &&
      lap.duration > 20 &&
      (!phase || lap.phase === phase),
  );
  const bestLap = valid.reduce(
    (best, lap) => (!best || lap.duration < best.duration ? lap : best),
    null,
  );
  driver.bestLap = bestLap?.duration ?? null;
  driver.bestLapSectors = bestLap?.sectors ?? [null, null, null];
  driver.bestSectors = [0, 1, 2].map((i) => {
    const values = valid.map((lap) => lap.sectors[i]).filter((v) => v > 0);
    return values.length ? Math.min(...values) : null;
  });
  if (phase) driver.bestByPhase[phase] = driver.bestLap;
}
function qualifyingPhaseNumber(state, row) {
  return (
    number(row.qualifying_phase ?? row.qualifying_part) ??
    number(state.phase?.replace(/\D/g, ""))
  );
}
function qualifyingPhaseDurationMs(mode, phase) {
  const minutes = mode === "sprint_qualifying" ? [12, 10, 8] : [18, 15, 12];
  return (minutes[phase - 1] ?? 0) * 60000;
}
function qualifyingPhaseName(state, phase) {
  return `${sessionCapabilities(state.session).mode === "sprint_qualifying" ? "SQ" : "Q"}${phase}`;
}
function lapQualifyingPhase(state, row, driver) {
  if (!sessionCapabilities(state.session).showQualifyingPhase) return null;
  const start = Date.parse(row.date_start);
  const phases = Object.entries(state.qualifyingPhases ?? {})
    .filter(([, phase]) => Date.parse(phase.startedAt) <= start)
    .sort((a, b) => Date.parse(b[1].startedAt) - Date.parse(a[1].startedAt));
  // A delayed lap belongs to the segment in which it started, even if its
  // final time arrives after the flag or after the next segment has started.
  return (
    phases[0]?.[0] ??
    driver.lapHistory?.find((lap) => lap.lap === number(row.lap_number))?.phase ??
    state.phase
  );
}
function markQualifyingEliminations(state, phase, time) {
  if (![1, 2].includes(phase)) return;
  const label = qualifyingPhaseName(state, phase);
  state.qualifyingPhases ??= {};
  state.qualifyingPhases[label] ??= {};
  state.qualifyingPhases[label].finishedAt ??= time;
}
function refreshQualifyingEliminations(state) {
  if (!sessionCapabilities(state.session).showQualifyingPhase) return;
  let eligible = Object.values(state.drivers);
  for (const driver of eligible) driver.eliminatedIn = null;
  for (const phase of [1, 2]) {
    const label = qualifyingPhaseName(state, phase);
    if (!state.qualifyingPhases?.[label]?.finishedAt) break;
    const finishedAt = Date.parse(state.qualifyingPhases[label].finishedAt);
    // The clock stops before the last flying laps finish. Do not label those
    // drivers as eliminated while their in-progress lap can still count.
    if (state.phase === label && eligible.some((driver) => {
      const lap = driver.qualifyingLap;
      return !isOut(driver) && driver.status !== "PIT" && lap?.phase === label &&
        !lap.outLap && !lap.completed && Date.parse(lap.startedAt) <= finishedAt;
    })) break;
    const phaseTime = (driver) => driver.bestByPhase?.[label] ?? Infinity;
    if (!eligible.some((driver) => Number.isFinite(phaseTime(driver)))) break;
    eligible.sort(
      (a, b) => phaseTime(a) - phaseTime(b) || (a.position ?? 99) - (b.position ?? 99),
    );
    const advancing =
      phase === 1
        ? Math.max(10, eligible.length - Math.ceil((eligible.length - 10) / 2))
        : Math.min(10, eligible.length);
    for (const driver of eligible.slice(advancing))
      driver.eliminatedIn = label;
    eligible = eligible.slice(0, advancing);
  }
  // The display follows the active segment for advancing drivers, and the
  // segment in which an eliminated driver set their last qualifying time.
  for (const driver of Object.values(state.drivers)) {
    const label = driver.eliminatedIn ?? state.phase;
    if (!label) continue;
    const best = driver.bestByPhase?.[label] ?? null;
    if (best !== driver.bestLap) {
      driver.bestLap = best;
      driver.bestLapSectors =
        driver.lapHistory?.find(
          (lap) => lap.phase === label && !lap.deleted && !lap.outLap && lap.duration === best,
        )?.sectors ?? [null, null, null];
    }
  }
}
export const eventKey = (topic, row) =>
  row._eventKey ??
  createHash("sha256")
    .update(
      JSON.stringify([
        topic,
        Object.keys(row)
          .filter((key) => !key.startsWith("_"))
          .sort()
          .map((key) => [key, row[key]]),
      ]),
    )
    .digest("hex");
export function emptyState() {
  return {
    session: null,
    championship: null,
    drivers: {},
    locations: {},
    telemetry: {},
    events: [],
    radio: [],
    pits: [],
    stints: [],
    weather: null,
    track: null,
    trackSectorCount: null,
    yellowSectors: [],
    status: "waiting",
    flag: null,
    currentLap: 0,
    totalLaps: null,
    phase: null,
    phaseEndsAt: null,
    phaseStartedAt: null,
    qualifyingPhases: {},
    timerPausedAt: null,
    timerOffsetMs: 0,
    replayReady: false,
    updatedAt: null,
  };
}
export function newDriver(n) {
  return {
    driverNumber: n,
    acronym: String(n),
    fullName: `Пилот ${n}`,
    team: "",
    teamColour: "#a1a1aa",
    position: null,
    gap: null,
    interval: null,
    compound: null,
    tyreAge: null,
    tyreAgeEstimated: false,
    stintNumber: null,
    lap: 0,
    lastLap: null,
    bestLap: null,
    maxSpeed: null,
    bestLapSectors: [null, null, null],
    sectors: [null, null, null],
    bestSectors: [null, null, null],
    pitCount: 0,
    pitEnteredAt: null,
    status: "RUNNING",
    lastUpdatedAt: null,
    pace: [],
    lapHistory: [],
    pitUntil: null,
    bestByPhase: {},
    eliminatedIn: null,
    qualifyingLap: null,
  };
}
// Project onto the segment itself: vertex snapping makes a moving car freeze
// between map vertices, then jump tens of metres when the nearest vertex changes.
export function projectLocation(points, x, y, closed = true) {
  let nearest = { distance: Infinity, progress: 0 };
  for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const dx = b.svgX - a.svgX,
      dy = b.svgY - a.svgY;
    const length = dx * dx + dy * dy;
    if (!length) continue;
    const t = Math.max(
      0,
      Math.min(1, ((x - a.svgX) * dx + (y - a.svgY) * dy) / length),
    );
    const distance = Math.hypot(x - a.svgX - dx * t, y - a.svgY - dy * t);
    if (distance < nearest.distance) {
      const start = a.progress ?? i / (points.length - 1);
      const end =
        i === points.length - 1
          ? 1
          : (b.progress ?? (i + 1) / (points.length - 1));
      nearest = { distance, progress: start + (end - start) * t };
    }
  }
  return nearest;
}
export function mapLocation(track, row, previous = null) {
  if (!track || number(row.x) === null || number(row.y) === null) return null;
  const { worldBounds: b, transform: t } = track;
  const x = t.offsetX + (row.x - b.minX) * t.scale;
  const projectedY = t.offsetY + (row.y - b.minY) * t.scale;
  const y = t.invertY ? track.svg.viewBox.height - projectedY : projectedY;
  const nearest = projectLocation(track.centerline ?? [], x, y);
  const pit = projectLocation(track.pitLane?.points ?? [], x, y, false);
  const metre = t.scale * (track.liveModelAlignment?.scale ?? 10);
  // Hysteresis prevents GPS noise switching between two parallel roads.
  const wasInPit = previous?.pitLaneProgress != null;
  const inPit =
    pit.distance < 40 * metre &&
    pit.distance + (wasInPit ? -3 : 3) * metre < nearest.distance;
  return {
    x,
    y,
    z: number(row.z) ?? 0,
    progress: nearest.progress % 1,
    pitLaneProgress: inPit ? pit.progress : null,
    timestamp: row.date,
  };
}
export function translateControl(row) {
  const m = row.message ?? "";
  if (row.flag === "YELLOW" || row.flag === "DOUBLE YELLOW")
    return `${row.flag === "DOUBLE YELLOW" ? "Двойной жёлтый" : "Жёлтый"} флаг${row.sector ? ` — сектор ${row.sector}` : ""}`;
  if (row.flag === "GREEN") return "Зелёный флаг";
  if (row.flag === "RED") return "Красный флаг — сессия остановлена";
  if (row.flag === "CHEQUERED") return "Клетчатый флаг";
  if (/(?:VIRTUAL SAFETY CAR|VSC) (?:ENDING|ENDED)/i.test(m))
    return "Виртуальный сейфти-кар завершается";
  if (/VIRTUAL SAFETY CAR DEPLOYED|VSC DEPLOYED/i.test(m))
    return "Виртуальный сейфти-кар";
  if (/SAFETY CAR (?:IN THIS LAP|ENDING)/i.test(m))
    return "Сейфти-кар уедет в боксы на этом круге";
  if (/SAFETY CAR DEPLOYED/i.test(m)) return "Сейфти-кар на трассе";
  if (/DRS ENABLED/i.test(m)) return "DRS разрешён";
  if (/DRS DISABLED/i.test(m)) return "DRS отключён";
  if (/TRACK CLEAR/i.test(m)) return "Трасса свободна";
  if (/SESSION STARTED/i.test(m)) return "Сессия началась";
  if (/SESSION FINISHED/i.test(m)) return "Сессия завершена";
  if (/SESSION ABORTED/i.test(m)) return "Сессия остановлена";
  if (/SESSION (?:WILL BE TEMPORARILY STOPPED|SUSPENDED)/i.test(m))
    return "Сессия приостановлена";
  if (/OVERTAKE ENABLED/i.test(m)) return "Режим обгона доступен";
  const clear = m.match(/CLEAR IN TRACK SECTOR (\d+)/i);
  if (clear) return `Сектор ${clear[1]} свободен`;
  return m;
}
export class LiveState {
  constructor(snapshot) {
    this.state = { ...emptyState(), ...(snapshot ?? {}) };
    if (this.state.status === "finished") {
      this.state.flag = "CHEQUERED";
      this.state.yellowSectors = [];
    }
    this.seen = new Map();
    this.clocks = new Map();
    this.locationMotion = new Map();
    for (const driver of Object.values(this.state.drivers))
      if (driver.stintStart != null) this.updateTyreAge(driver);
  }
  updateTyreAge(driver) {
    // A new pit can arrive while OpenF1 still extends the previous stint.
    // Until that stint is replaced, count laps since the stop as an estimate.
    // Garage visits in timed sessions and explicit drive-throughs are excluded.
    const pit = sessionCapabilities(this.state.session).showRaceGap
      ? this.state.pits
          .filter(
            (p) =>
              p.driverNumber === driver.driverNumber &&
              p.duration !== 0 &&
              p.lap != null &&
              p.lap < driver.lap &&
              driver.stintStart != null &&
              p.lap >= driver.stintStart,
          )
          .sort((a, b) => b.lap - a.lap)[0]
      : null;
    driver.tyreAgeEstimated = Boolean(pit);
    driver.tyreAge = pit
      ? Math.max(0, driver.lap - pit.lap - 1)
      : driver.stintStart == null
        ? null
        : Math.max(0, driver.lap - driver.stintStart + (driver.stintAge ?? 0));
  }
  setSession(session, track = null) {
    this.state = emptyState();
    this.seen.clear();
    this.clocks.clear();
    this.locationMotion.clear();
    this.state.session = { ...session };
    this.state.track = track;
    this.state.trackSectorCount = track?.marshalSectorCount ?? null;
    this.state.status =
      Date.parse(session.date_start) > Date.now() ? "waiting" : "live";
  }
  retainDrivers(driverNumbers) {
    const roster = new Set(
      driverNumbers.map(number).filter((value) => value !== null),
    );
    if (!roster.size) return;
    for (const key of Object.keys(this.state.drivers)) {
      const driverNumber = Number(key);
      if (roster.has(driverNumber)) continue;
      delete this.state.drivers[key];
      delete this.state.locations[key];
      delete this.state.telemetry[key];
      this.locationMotion.delete(driverNumber);
    }
    const belongsToRoster = (item) =>
      item.driverNumber === null ||
      item.driverNumber === undefined ||
      roster.has(Number(item.driverNumber));
    this.state.pits = this.state.pits.filter(belongsToRoster);
    this.state.stints = this.state.stints.filter(belongsToRoster);
    this.state.radio = this.state.radio.filter(belongsToRoster);
    this.state.events = this.state.events.filter(belongsToRoster);
  }
  resetQualifying() {
    if (!sessionCapabilities(this.state.session).showQualifyingPhase) return;
    // REST loads the complete control/lap history. Rebuild these derived
    // fields instead of feeding Q1 history into a saved Q2/Q3 classification.
    Object.assign(this.state, {
      phase: null,
      phaseStartedAt: null,
      phaseEndsAt: null,
      qualifyingPhases: {},
      timerPausedAt: null,
      timerOffsetMs: 0,
      status: "live",
      flag: null,
      yellowSectors: [],
    });
    for (const driver of Object.values(this.state.drivers))
      Object.assign(driver, {
        eliminatedIn: null,
        bestByPhase: {},
        bestLap: null,
        bestLapSectors: [null, null, null],
        bestSectors: [null, null, null],
        lapHistory: [],
        lapDecisions: [],
        qualifyingLap: null,
      });
    this.seen.clear();
    for (const key of this.clocks.keys())
      if (/^(?:laps|race_control|session_result):/.test(key))
        this.clocks.delete(key);
  }
  feed(type, row, message, extra = {}) {
    const event = {
      id: eventKey(type, row),
      type,
      timestamp: row.date ?? row.date_start,
      lap: number(row.lap_number),
      driverNumber: number(row.driver_number),
      message,
      original: row.message ?? null,
      ...extra,
    };
    this.state.events = [
      event,
      ...this.state.events.filter(
        (x) =>
          x.id !== event.id &&
          !(
            x.type === event.type &&
            x.timestamp === event.timestamp &&
            x.driverNumber === event.driverNumber &&
            x.message === event.message
          ),
      ),
    ]
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, 300);
    return event;
  }
  apply(topic, row) {
    const s = this.state;
    if (
      !row ||
      (s.session && Number(row.session_key) !== Number(s.session.session_key))
    )
      return false;
    const id = eventKey(topic, row);
    if (this.seen.has(id)) return false;
    this.seen.set(id, true);
    if (this.seen.size > 25000) this.seen.delete(this.seen.keys().next().value);
    const time = row.date ?? row.date_start ?? s.session?.date_start;
    if (!Number.isFinite(Date.parse(time))) return false;
    const n = number(row.driver_number);
    const d = n === null ? null : (s.drivers[n] ??= newDriver(n));
    // Delayed samples can contain an earlier session maximum even when their
    // current telemetry must not replace a newer sample.
    if (d && (topic === "car_data" || topic === "laps")) {
      for (const value of topic === "car_data"
        ? [row.speed]
        : [row.st_speed, row.i1_speed, row.i2_speed]) {
        const speed = number(value);
        if (speed !== null && speed >= 0)
          d.maxSpeed = Math.max(d.maxSpeed ?? 0, speed);
      }
    }
    const clockKey = `${topic}:${n}:${topic === "laps" ? row.lap_number : topic === "stints" ? row.stint_number : ""}`;
    const stale = Date.parse(time) < (this.clocks.get(clockKey) ?? 0);
    if (!stale) this.clocks.set(clockKey, Date.parse(time));
    if (
      stale &&
      ["position", "intervals", "location", "car_data", "weather"].includes(
        topic,
      )
    )
      return true;
    s.updatedAt = new Date().toISOString();
    if (d && !stale) d.lastUpdatedAt = time;
    switch (topic) {
      case "drivers":
        if (d)
          Object.assign(d, {
            acronym: row.name_acronym || String(n),
            fullName: row.full_name || d.fullName,
            team: row.team_name || "",
            teamColour: /^[\da-f]{6}$/i.test(row.team_colour)
              ? `#${row.team_colour}`
              : "#a1a1aa",
          });
        break;
      case "position":
        if (d) d.position = number(row.position);
        break;
      case "intervals":
        if (d) {
          d.gap = row.gap_to_leader;
          d.interval = row.interval;
        }
        break;
      case "location":
        if (d && !isOut(d)) {
          const p =
            row.svgX !== undefined
              ? {
                  x: row.svgX,
                  y: row.svgY,
                  progress: row.progress ?? 0,
                  timestamp: time,
                  z: row.z ?? 0,
                }
              : mapLocation(s.track, row, s.locations[n]);
          if (p) {
            const priorLocation = s.locations[n];
            const previous =
              this.locationMotion.get(n) ??
              (priorLocation
                ? {
                    x: priorLocation.x,
                    y: priorLocation.y,
                    since:
                      priorLocation.stationarySince ?? priorLocation.timestamp,
                    updatedAt: Date.parse(priorLocation.timestamp),
                  }
                : null);
            // Measure from a fixed anchor so slow movement accumulates while
            // small GPS jitter does not restart the three-minute timer.
            const moved =
              !previous || Math.hypot(p.x - previous.x, p.y - previous.y) > 2;
            const resumed =
              previous && Date.parse(time) - previous.updatedAt > 180000;
            const motion =
              moved || resumed
                ? { x: p.x, y: p.y, since: time, updatedAt: Date.parse(time) }
                : { ...previous, updatedAt: Date.parse(time) };
            this.locationMotion.set(n, motion);
            s.locations[n] = { ...p, stationarySince: motion.since };
            if (p.pitLaneProgress != null) {
              if (priorLocation?.pitLaneProgress == null) d.pitEnteredAt = time;
              d.status = "PIT";
            } else if (s.status === "paused") {
              d.status = hasTrackActivity(d, s) ? "NO DATA" : "PIT";
              if (d.status === "PIT") d.pitEnteredAt ??= time;
            } else if (priorLocation?.pitLaneProgress != null) {
              d.pitEnteredAt = null;
              d.status = "OUT LAP";
            } else if (
              d.status === "PIT" &&
              ((previous && moved) || (s.telemetry[n]?.speed ?? 0) > 5)
            ) {
              d.pitEnteredAt = null;
              d.status = "OUT LAP";
            } else if (Date.parse(time) - Date.parse(motion.since) >= 180000)
              d.status = "NO DATA";
            else if (d.status === "NO DATA") d.status = "RUNNING";
          }
        }
        break;
      case "car_data":
        if (d) {
          s.telemetry[n] = {
            timestamp: time,
            speed: number(row.speed),
            throttle: number(row.throttle),
            brake: number(row.brake),
            rpm: number(row.rpm),
            gear: number(row.n_gear),
            drs: number(row.drs),
          };
          const speed = s.telemetry[n].speed ?? 0;
          if (!hasTrackActivity(d, s) && speed <= 5 && d.status === "RUNNING") {
            d.status = "PIT";
            d.pitEnteredAt ??= time;
          } else if (
            speed > 5 &&
            d.status === "PIT" &&
            s.locations[n]?.pitLaneProgress == null
          ) {
            d.pitEnteredAt = null;
            d.status = "OUT LAP";
          }
        }
        break;
      case "laps":
        if (d) {
          const lap = number(row.lap_number) ?? 0,
            duration = number(row.lap_duration),
            lapSectors = [
              row.duration_sector_1,
              row.duration_sector_2,
              row.duration_sector_3,
            ].map(number);
          const lapPhase = lapQualifyingPhase(s, row, d);
          if (lapPhase && Number.isFinite(Date.parse(row.date_start)) &&
              (lap > (d.qualifyingLap?.lap ?? 0) || (lap === d.qualifyingLap?.lap && !stale)))
            d.qualifyingLap = {
              lap,
              phase: lapPhase,
              startedAt: row.date_start,
              outLap: Boolean(row.is_pit_out_lap),
              completed: Boolean(duration) || (d.qualifyingLap?.lap === lap && d.qualifyingLap.completed),
            };
          if (duration && lap > 0 && !stale)
            d.lapHistory = [
              ...(d.lapHistory ?? []).filter((p) => p.lap !== lap),
              {
                lap,
                duration,
                completedAt: time,
                phase: lapPhase,
                outLap: Boolean(row.is_pit_out_lap),
                deleted:
                  Boolean(row.deleted) ||
                  Boolean(
                    d.lapDecisions?.findLast(
                      (decision) =>
                        Math.abs(decision.duration - duration) < 0.0005 &&
                        Date.parse(time) <= decision.at,
                    )?.deleted,
                  ),
                compound: d.compound,
                sectors: lapSectors,
                pit:
                  Boolean(row.is_pit_out_lap) ||
                  s.pits.some(
                    (p) => p.driverNumber === n && Math.abs(p.lap - lap) <= 1,
                  ),
              },
            ]
              .sort((a, b) => a.lap - b.lap)
              .slice(-200);
          if (lap >= d.lap) {
            const previousLap = d.lap;
            const previousSectors = d.sectors;
            d.lap = lap;
            d.sectors = [...lapSectors];
            const waitingForFirstSector =
              lapSectors[0] === null &&
              lapSectors[2] === null &&
              (lap > previousLap || previousSectors[0] === null);
            if (waitingForFirstSector)
              d.sectors[2] = previousSectors[2] ?? null;
            d.sectors.forEach((v, i) => {
              if (v && (!d.bestSectors[i] || v < d.bestSectors[i]))
                d.bestSectors[i] = v;
            });
            if (duration) d.lastLap = duration;
            if (!isOut(d))
              d.status = row.is_pit_out_lap ? "OUT LAP" : "RUNNING";
            this.updateTyreAge(d);
          }
          if (
            duration &&
            !row.is_pit_out_lap &&
            !row.deleted &&
            !d.lapHistory?.find((p) => p.lap === lap)?.deleted &&
            duration > 20
          ) {
            if (lapPhase) {
              d.bestByPhase ??= {};
              d.bestByPhase[lapPhase] = Math.min(
                d.bestByPhase[lapPhase] ?? Infinity,
                duration,
              );
            }
            const personal =
              (!lapPhase || lapPhase === s.phase) &&
              (!d.bestLap || duration < d.bestLap);
            if (personal) {
              d.bestLap = duration;
              d.bestLapSectors = lapSectors;
            }
            d.pace = [
              ...d.pace.filter((x) => x.lap !== lap),
              {
                lap,
                duration,
                compound: d.compound,
                pit: s.pits.some(
                  (p) => p.driverNumber === n && Math.abs(p.lap - lap) <= 1,
                ),
              },
            ].slice(-8);
            if (
              personal &&
              !Object.values(s.drivers).some(
                (x) => x.bestLap && x.bestLap < duration,
              )
            )
              this.feed("fastest_lap", row, `${d.acronym} — лучший круг`, {
                duration,
              });
          }
          s.currentLap = Math.max(s.currentLap, lap);
        }
        break;
      case "stints":
        if (d && !stale && number(row.stint_number) !== null && number(row.lap_start) !== null) {
          const stint = {
            driverNumber: n,
            stintNumber: number(row.stint_number),
            compound: row.compound ?? null,
            startLap: number(row.lap_start),
            endLap: number(row.lap_end),
            ageAtStart: number(row.tyre_age_at_start),
          };
          s.stints = [...s.stints.filter((item) => item.driverNumber !== n || item.stintNumber !== stint.stintNumber), stint];
        }
        if (d && !stale && (number(row.stint_number) ?? 0) >= (d.stintNumber ?? 0)) {
          const before = d.compound;
          const newStint =
            d.stintNumber != null &&
            number(row.stint_number) > d.stintNumber;
          Object.assign(d, {
            compound: row.compound ?? null,
            stintNumber: number(row.stint_number),
            stintStart: number(row.lap_start),
            stintAge: number(row.tyre_age_at_start) ?? 0,
          });
          this.updateTyreAge(d);
          if (before && (newStint || before !== d.compound))
            this.feed(
              "tyre_change",
              row,
              `${d.acronym}: ${before} → ${d.compound}`,
            );
        }
        break;
      case "pit":
        if (d) {
          const pitId = `${row.session_key}:${n}:${row.date}`;
          const pit = {
            id: pitId,
            driverNumber: n,
            timestamp: time,
            lap: number(row.lap_number),
            duration: number(row.stop_duration),
            laneDuration: number(row.lane_duration ?? row.pit_duration),
            before: d.compound,
            after: null,
          };
          s.pits = [pit, ...s.pits.filter((p) => p.id !== pitId)].slice(0, 150);
          d.pitCount = s.pits.filter((p) => p.driverNumber === n).length;
          this.updateTyreAge(d);
          d.pitEnteredAt = time;
          d.pitUntil = Date.parse(time) + (pit.laneDuration ?? 30) * 1000;
          if (!isOut(d) && Date.parse(time) + 60000 > Date.now())
            d.status = "PIT";
          this.feed("pit", row, `${d.acronym} — пит-стоп`, {
            duration: pit.duration,
          });
        }
        break;
      case "weather":
        s.weather = {
          timestamp: time,
          air: number(row.air_temperature),
          track: number(row.track_temperature),
          rain: number(row.rainfall),
          wind: number(row.wind_speed),
          humidity: number(row.humidity),
        };
        break;
      case "overtakes":
        this.feed(
          "overtake",
          row,
          `${s.drivers[row.overtaking_driver_number]?.acronym ?? row.overtaking_driver_number} обгоняет ${s.drivers[row.overtaken_driver_number]?.acronym ?? row.overtaken_driver_number}`,
        );
        break;
      case "race_control":
        {
          const m = row.message ?? "";
          const lapDecision = m.match(
            /^CAR (\d+) \([A-Z]+\) TIME (\d+):(\d+\.\d+) (DELETED|REINSTATED)\b/i,
          );
          if (lapDecision) {
            const driverNumber = Number(lapDecision[1]);
            const driver = (s.drivers[driverNumber] ??=
              newDriver(driverNumber));
            const duration =
              Number(lapDecision[2]) * 60 + Number(lapDecision[3]);
            const at = Date.parse(time),
              deleted = lapDecision[4].toUpperCase() === "DELETED";
            const previous = driver.lapDecisions?.findLast(
              (decision) => Math.abs(decision.duration - duration) < 0.0005,
            );
            if (!previous || at >= previous.at) {
              driver.lapDecisions = [
                ...(driver.lapDecisions ?? []),
                { duration, at, deleted },
              ].slice(-200);
              const lap = driver.lapHistory
                ?.filter(
                  (p) =>
                    Math.abs(p.duration - duration) < 0.0005 &&
                    Date.parse(p.completedAt) <= at,
                )
                .at(-1);
              if (lap) {
                lap.deleted = deleted;
                recalculateBest(driver, lap.phase);
                if (s.phase && lap.phase !== s.phase)
                  recalculateBest(driver, s.phase);
              }
            }
          }
          const exit = controlExit(row);
          if (exit) {
            const driver = (s.drivers[exit.driverNumber] ??= newDriver(
              exit.driverNumber,
            ));
            driver.status = exit.status;
            delete s.locations[exit.driverNumber];
          }
          this.feed(
            /PENALTY|INVESTIGAT(?:ION|ED)|INFRINGEMENT|NOTED|FIA STEWARDS/i.test(
              m,
            )
              ? "stewards"
              : "race_control",
            exit
              ? { ...row, driver_number: exit.driverNumber }
              : lapDecision
                ? { ...row, driver_number: Number(lapDecision[1]) }
                : row,
            exit
              ? `${s.drivers[exit.driverNumber].acronym} — ${exit.status === "DNF" ? "Сход" : "Дисквалификация"}`
              : lapDecision
                ? `${s.drivers[Number(lapDecision[1])].acronym} — время ${lapDecision[2]}:${lapDecision[3]} ${lapDecision[4].toUpperCase() === "DELETED" ? "удалено" : "восстановлено"}`
                : translateControl(row),
          );
          if (!stale) {
            const sessionAlreadyFinished = s.status === "finished";
            const sector = number(row.sector);
            const activeYellowSectors = new Set(s.yellowSectors ?? []);
            const sectorYellow =
              row.scope === "Sector" &&
              /YELLOW/.test(row.flag ?? "") &&
              !/INFRINGEMENT|INVESTIGAT(?:ION|ED)|FIA STEWARDS/i.test(m);
            const sectorClear =
              row.scope === "Sector" &&
              (row.flag === "CLEAR" || /CLEAR IN TRACK SECTOR/i.test(m));
            if (sector !== null && sector > 0)
              s.trackSectorCount = Math.max(
                s.trackSectorCount ?? 0,
                s.track?.marshalSectorCount ?? 0,
                sector,
              );
            if (!sessionAlreadyFinished && sectorYellow && sector !== null)
              activeYellowSectors.add(sector);
            if (!sessionAlreadyFinished && sectorClear && sector !== null)
              activeYellowSectors.delete(sector);
            // Local sector yellows do not overwrite a global red flag or safety car.
            if (sessionAlreadyFinished) {
              s.flag = "CHEQUERED";
              activeYellowSectors.clear();
            } else if (
              row.flag === "RED" ||
              (/^RED FLAG\b/i.test(m.trim()) && !/INFRINGEMENT/i.test(m))
            )
              s.flag = "RED";
            else if (
              /^(?:SESSION STARTED|RACE START|STANDING START|ROLLING START|SESSION RESUMED|RACE RESUMED|RACE RESTARTED|GREEN FLAG|RED FLAG CLEARED)\b/i.test(
                m.trim(),
              ) &&
              row.scope !== "Sector"
            ) {
              s.flag = "GREEN";
              activeYellowSectors.clear();
            } else if (/VIRTUAL SAFETY CAR DEPLOYED|VSC DEPLOYED/i.test(m))
              s.flag = "VSC";
            else if (/SAFETY CAR DEPLOYED/i.test(m)) s.flag = "SC";
            else if (/(?:VIRTUAL SAFETY CAR|VSC) (?:ENDING|ENDED)/i.test(m)) {
              s.flag = "GREEN";
              activeYellowSectors.clear();
            } else if (/SAFETY CAR (?:IN THIS LAP|ENDING)/i.test(m))
              s.flag = "SC_ENDING";
            else if (row.flag === "GREEN" && row.scope !== "Sector") {
              s.flag = "GREEN";
              activeYellowSectors.clear();
            } else if (
              /TRACK CLEAR/i.test(m) &&
              row.scope !== "Sector" &&
              (s.flag === "YELLOW" || s.flag === "SC_ENDING")
            ) {
              s.flag = "GREEN";
              activeYellowSectors.clear();
            } else if (
              sectorClear &&
              activeYellowSectors.size === 0 &&
              s.flag === "YELLOW"
            )
              s.flag = "GREEN";
            else if (
              sectorYellow &&
              !["RED", "SC", "SC_ENDING", "VSC", "VSC_ENDING"].includes(s.flag)
            )
              s.flag = "YELLOW";
            s.yellowSectors = [...activeYellowSectors].sort((a, b) => a - b);
            const capabilities = sessionCapabilities(s.session);
            const phasePrefix =
              capabilities.mode === "sprint_qualifying" ? "SQ" : "Q";
            let phaseNumber = number(
              row.qualifying_phase ?? row.qualifying_part,
            );
            if (
              capabilities.showQualifyingPhase &&
              phaseNumber === null &&
              s.status !== "paused" &&
              /^SESSION STARTED\.?$/i.test(m.trim()) &&
              Date.parse(time) > Date.parse(s.phaseStartedAt ?? 0)
            ) {
              phaseNumber = Math.min(
                3,
                (number(s.phase?.replace(/\D/g, "")) ?? 0) + 1,
              );
            }
            if (
              row.flag === "CHEQUERED" &&
              (!capabilities.showQualifyingPhase || phaseNumber === 3)
            ) {
              s.flag = "CHEQUERED";
              s.status = "finished";
            }
            if (
              phaseNumber >= 1 && phaseNumber <= 3 &&
              capabilities.showQualifyingPhase &&
              phaseNumber >= (qualifyingPhaseNumber(s, {}) ?? 0)
            ) {
              const next = `${phasePrefix}${phaseNumber}`;
              if (next !== s.phase) {
                const previousPhase = qualifyingPhaseNumber(s, {});
                if (previousPhase)
                  markQualifyingEliminations(s, previousPhase, time);
                s.qualifyingPhases ??= {};
                s.qualifyingPhases[next] = { startedAt: time };
                for (const driver of Object.values(s.drivers)) {
                  if (driver.eliminatedIn) continue;
                  recalculateBest(driver, next);
                }
                s.phase = next;
                s.phaseStartedAt = time;
                s.timerPausedAt = null;
                s.timerOffsetMs = 0;
                const duration = qualifyingPhaseDurationMs(
                  capabilities.mode,
                  phaseNumber,
                );
                s.phaseEndsAt =
                  row.phase_end ??
                  (duration
                    ? new Date(Date.parse(time) + duration).toISOString()
                    : null);
              }
              if (row.phase_end) s.phaseEndsAt = row.phase_end;
            }
            const completedPhase = qualifyingPhaseNumber(s, row);
            if (
              capabilities.showQualifyingPhase &&
              /SESSION FINISHED/i.test(m) &&
              completedPhase &&
              completedPhase < 3
            )
              markQualifyingEliminations(s, completedPhase, time);
            if (
              /SESSION FINISHED/i.test(m) &&
              (!capabilities.showQualifyingPhase || completedPhase === 3)
            ) {
              s.status = "finished";
              s.flag = "CHEQUERED";
            }
            const pausesSession =
              /SESSION (?:WILL BE TEMPORARILY STOPPED|SUSPENDED|ABORTED)/i.test(
                m,
              );
            if (pausesSession && !sessionAlreadyFinished) {
              s.flag = "RED";
              // The stop command can arrive well after the red flag. Its own
              // timestamp is the authoritative point at which the clock stops.
              s.timerPausedAt = time;
              s.status = "paused";
              for (const driver of Object.values(s.drivers))
                if (
                  driver.status === "RUNNING" ||
                  driver.status === "OUT LAP"
                ) {
                  driver.status = hasTrackActivity(driver, s)
                    ? "NO DATA"
                    : "PIT";
                  if (driver.status === "PIT") driver.pitEnteredAt ??= time;
                }
            }
            const total = m.match(/(?:RACE|SPRINT).*?(\d+) LAPS/i);
            if (total) s.totalLaps = Number(total[1]);
            if (
              !sessionAlreadyFinished &&
              /SESSION STARTED|SESSION RESUMED|GREEN LIGHT/i.test(m)
            ) {
              if (s.status === "paused" && s.timerPausedAt) {
                s.timerOffsetMs =
                  (s.timerOffsetMs ?? 0) +
                  Math.max(0, Date.parse(time) - Date.parse(s.timerPausedAt));
                s.timerPausedAt = null;
              }
              s.status = "live";
              s.flag = "GREEN";
              s.yellowSectors = [];
            }
          }
        }
        break;
      case "session_result":
        if (d) {
          if (sessionCapabilities(s.session).showRaceGap) {
            if (s.status === "finished") d.position = number(row.position) ?? d.position;
          }
          if (sessionCapabilities(s.session).rankByLapTime) {
            const times = Array.isArray(row.duration)
              ? row.duration
              : [row.duration];
            const part = Number(s.phase?.replace(/\D/g, "")) || times.length;
            const value = number(times[part - 1]);
            if (sessionCapabilities(s.session).showQualifyingPhase) {
              d.bestByPhase ??= {};
              times.slice(0, 3).forEach((duration, i) => {
                const result = number(duration);
                if (result > 20)
                  d.bestByPhase[qualifyingPhaseName(s, i + 1)] = result;
              });
            }
            if (value) d.bestLap = value;
            d.lap = number(row.number_of_laps) ?? d.lap;
            d.position = number(row.position) ?? d.position;
          }
          if (
            sessionCapabilities(s.session).showLapCounter &&
            s.status === "finished"
          )
            s.totalLaps =
              Math.max(s.totalLaps ?? 0, number(row.number_of_laps) ?? 0) ||
              null;
          if (!stale) {
            if (row.dsq) d.status = "DSQ";
            else if (row.dns) d.status = "DNS";
            else if (row.dnf) d.status = "DNF";
            if (isOut(d)) delete s.locations[n];
          }
        }
        break;
      case "sessions":
        if (s.session) Object.assign(s.session, row);
        break;
      case "team_radio": {
        const radio = {
          id,
          driverNumber: n,
          timestamp: time,
          lap: d?.lap ?? null,
          original: null,
          ru: null,
          status: "received",
          playable: false,
        };
        s.radio = [
          radio,
          ...s.radio.filter(
            (r) =>
              r.id !== id &&
              !(
                r.driverNumber === radio.driverNumber &&
                Date.parse(r.timestamp) === Date.parse(radio.timestamp)
              ),
          ),
        ].slice(0, 200);
        break;
      }
    }
    if (["drivers", "laps", "race_control", "session_result"].includes(topic))
      refreshQualifyingEliminations(s);
    return true;
  }
  snapshot() {
    refreshQualifyingEliminations(this.state);
    return structuredClone(this.state);
  }
}
