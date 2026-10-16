import { createHash } from "node:crypto";
import { LiveState, mapLocation } from "./state.mjs";
const uuid = (text) => {
  const h = createHash("sha256").update(text).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const lapText = (value) =>
  value
    ? `${Math.floor(value / 60)}:${(value % 60).toFixed(3).padStart(6, "0")}`
    : null;
async function* pages(db, table, key) {
  let from = 0;
  while (true) {
    let query = db
      .from(table)
      .select("*")
      .eq("session_key", key)
      .order("timestamp");
    query = ["live_location", "live_car_data"].includes(table)
      ? query.order("driver_number")
      : query.order("id");
    const { data, error } = await query.range(from, from + 999);
    if (error) throw error;
    yield data;
    if (data.length < 1000) break;
    from += data.length;
  }
}
export async function buildReplayFromHistory(db, state) {
  if (!state.track) throw new Error("Track mapping required for Replay");
  const key = state.session.session_key,
    start = Date.parse(state.session.date_start);
  let { data: local, error: localError } = await db
    .from("sessions")
    .select("race_id,races(circuit_id,season_year)")
    .eq("openf1_session_key", key)
    .maybeSingle();
  if (!local && !localError && state.session.race_id) {
    const result = await db
      .from("races")
      .select("id,circuit_id,season_year")
      .eq("id", state.session.race_id)
      .single();
    localError = result.error;
    if (result.data) local = { race_id: result.data.id, races: result.data };
  }
  if (localError || !local) throw new Error("Race mapping required for Replay");
  const { data: existing, error: existingError } = await db
    .from("race_replay_sessions")
    .select("id")
    .eq("source_session_key", key)
    .maybeSingle();
  if (existingError) throw existingError;
  const replayId = existing?.id ?? uuid(`raceside-live:${key}`);
  const snapshot = {
    replaySessionId: replayId,
    sourceSessionKey: key,
    raceName: state.session.race_name,
    circuitName: state.session.circuit_short_name,
    sourceSeason: local.races.season_year,
    durationMs: Math.max(0, Date.parse(state.session.date_end) - start),
    totalLaps: state.totalLaps ?? state.currentLap,
    track: state.track,
    drivers: Object.values(state.drivers).map((d) => ({
      driverNumber: d.driverNumber,
      abbreviation: d.acronym,
      fullName: d.fullName,
      teamName: d.team,
      teamColor: d.teamColour,
      position: d.position,
      gapToLeader: d.gap == null ? null : String(d.gap),
      intervalToAhead: d.interval == null ? null : String(d.interval),
      lapNumber: d.lap,
      compound: d.compound,
      tyreAge: d.tyreAge,
      tyreAgeEstimated: d.tyreAgeEstimated,
      pitStops: d.pitCount,
      lastLapTime: lapText(d.lastLap),
      bestLapTime: lapText(d.bestLap),
      status: d.status,
    })),
    positions: [],
    raceEvents: [],
    radio: [],
    weather: state.weather
      ? {
          airTemperatureC: state.weather.air,
          trackTemperatureC: state.weather.track,
          rainfall: state.weather.rain,
          windSpeedKmh: (state.weather.wind ?? 0) * 3.6,
        }
      : null,
  };
  const { data: descriptor, error } = await db
    .from("race_replay_sessions")
    .upsert(
      {
        id: replayId,
        race_id: local.race_id,
        circuit_id: local.races.circuit_id,
        title: state.session.race_name,
        status: "preparing",
        source_season: local.races.season_year,
        source_session_key: key,
        source_meeting_key: state.session.meeting_key,
        source_started_at: state.session.date_start,
        source_session_name: state.session.session_name,
        snapshot,
      },
      { onConflict: "source_session_key" },
    )
    .select("id")
    .single();
  if (error) throw error;
  snapshot.replaySessionId = descriptor.id;
  const reduced = new LiveState();
  reduced.setSession(state.session, state.track);
  const events = [];
  for await (const rows of pages(db, "live_events", key)) events.push(...rows);
  events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  let index = 0;
  const timingRows = [];
  for (const event of events) {
    const offset = Math.max(0, Date.parse(event.timestamp) - start),
      r = event.payload;
    if (event.topic === "race_control")
      snapshot.raceEvents.push({
        offsetMs: offset,
        timestamp: event.timestamp,
        type: "race_control",
        message: r.message ?? "",
        severity: "INFO",
        driverNumber: r.driver_number,
        lapNumber: r.lap_number,
      });
    if (event.topic === "position")
      timingRows.push({
        event_type: "position_timing",
        driver_number: r.driver_number,
        event_time: event.timestamp,
        offset_ms: offset,
        payload: {
          driverNumber: r.driver_number,
          offsetMs: offset,
          position: r.position,
        },
      });
    if (event.topic === "intervals")
      timingRows.push({
        event_type: "interval_timing",
        driver_number: r.driver_number,
        event_time: event.timestamp,
        offset_ms: offset,
        payload: {
          driverNumber: r.driver_number,
          offsetMs: offset,
          gapToLeader: r.gap_to_leader == null ? null : String(r.gap_to_leader),
          intervalToAhead: r.interval == null ? null : String(r.interval),
        },
      });
  }
  const write = async (rows) => {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("race_replay_events").upsert(
        rows.slice(i, i + 500).map((r) => ({
          ...r,
          id: uuid(
            `${descriptor.id}:${r.event_type}:${r.driver_number}:${r.event_time}`,
          ),
          replay_session_id: descriptor.id,
        })),
      );
      if (error) throw error;
    }
  };
  await write(timingRows);
  async function* telemetryRows() {
    for await (const rows of pages(db, "live_car_data", key))
      for (const row of rows) yield row;
  }
  const telemetryIterator = telemetryRows();
  let nextTelemetry = await telemetryIterator.next();
  const telemetryByDriver = new Map();
  for await (const rows of pages(db, "live_location", key)) {
    const batch = [];
    for (const p of rows) {
      while (
        index < events.length &&
        Date.parse(events[index].timestamp) <= Date.parse(p.timestamp)
      ) {
        const e = events[index++];
        reduced.apply(e.topic, e.payload);
      }
      while (
        !nextTelemetry.done &&
        Date.parse(nextTelemetry.value.timestamp) <= Date.parse(p.timestamp)
      ) {
        telemetryByDriver.set(
          nextTelemetry.value.driver_number,
          nextTelemetry.value,
        );
        nextTelemetry = await telemetryIterator.next();
      }
      const car = telemetryByDriver.get(p.driver_number);
      const d = reduced.state.drivers[p.driver_number],
        mapped = mapLocation(state.track, { ...p, date: p.timestamp });
      if (!mapped) continue;
      const offsetMs = Math.max(0, Date.parse(p.timestamp) - start);
      snapshot.durationMs = Math.max(snapshot.durationMs, offsetMs);
      batch.push({
        event_type: "position",
        driver_number: p.driver_number,
        event_time: p.timestamp,
        offset_ms: offsetMs,
        payload: {
          offsetMs,
          timestamp: p.timestamp,
          driverNumber: p.driver_number,
          svgX: mapped.x,
          svgY: mapped.y,
          progress: mapped.progress,
          z: p.z ?? 0,
          normalizedZ: 0,
          headingRad: 0,
          speedKph: car?.speed,
          gear: car?.gear,
          drs: car?.drs,
          throttle: car?.throttle,
          brake: car?.brake,
          rpm: car?.rpm,
          position: d?.position,
          gapToLeader: d?.gap == null ? null : String(d.gap),
          intervalToAhead: d?.interval == null ? null : String(d.interval),
          lapNumber: d?.lap,
          compound: d?.compound,
          tyreAge: d?.tyreAge,
          tyreAgeEstimated: d?.tyreAgeEstimated,
          lastLapTime: lapText(d?.lastLap),
          lastLapDuration: d?.lastLap,
          sector1Time: d?.sectors[0]?.toFixed(3),
          sector2Time: d?.sectors[1]?.toFixed(3),
          sector3Time: d?.sectors[2]?.toFixed(3),
          isPitLane: d?.pitUntil > Date.parse(p.timestamp),
        },
      });
    }
    await write(batch);
  }
  for await (const rows of pages(db, "live_radio_text", key))
    snapshot.radio.push(
      ...rows.map((r) => ({
        id: r.id,
        driverNumber: r.driver_number,
        timestamp: r.timestamp,
        offsetMs: Math.max(0, Date.parse(r.timestamp) - start),
        lap: r.lap,
        original: r.original,
        ru: r.ru,
        status: r.status,
      })),
    );
  const { error: finishError } = await db
    .from("race_replay_sessions")
    .update({
      status: "ready",
      snapshot,
      duration_ms: snapshot.durationMs,
      total_laps: snapshot.totalLaps,
      prepared_at: new Date().toISOString(),
    })
    .eq("id", descriptor.id);
  if (finishError) throw finishError;
}
