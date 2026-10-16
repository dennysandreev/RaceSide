import { numeric, SOURCE } from "./core.mjs";
import { normalizeTelemetryMeeting } from "./track-geometry.mjs";
export const slugify = (v) =>
  String(v)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
export function mapSession(r) {
  return {
    id: r.session_key,
    meetingId: r.meeting_key,
    season: r.year,
    name: r.session_name,
    type: r.session_type,
    circuit: r.circuit_short_name,
    circuitKey: r.circuit_key,
    country: r.country_name,
    start: r.date_start,
    end: r.date_end,
    slug: `${slugify(r.session_name)}-${r.session_key}`,
  };
}
export class OpenF1Provider {
  constructor({ fetchRows }) {
    this.fetchRows = fetchRows;
    this.source = SOURCE;
  }
  async getMeetings(season) {
    return (await this.fetchRows("meetings", { year: season }))
      .filter((r) => Date.parse(r.date_start) <= Date.now())
      .map((r) => normalizeTelemetryMeeting({
        id: r.meeting_key,
        season: r.year,
        name: r.meeting_name,
        circuit: r.circuit_short_name,
        country: r.country_name,
        start: r.date_start,
        slug: `${slugify(r.circuit_short_name)}-${r.meeting_key}`,
      }));
  }
  async getSessions(meeting) {
    return (await this.fetchRows("sessions", { meeting_key: meeting }))
      .filter(
        (r) =>
          !r.is_cancelled && Date.parse(r.date_end) + 31 * 60000 < Date.now(),
      )
      .map(mapSession);
  }
  async getSession(session) {
    const rows = await this.fetchRows("sessions", { session_key: session });
    if (!rows[0]) throw new Error("SESSION_NOT_FOUND");
    if (Date.parse(rows[0].date_end) + 31 * 60000 > Date.now())
      throw new Error("SESSION_NOT_FINISHED");
    return mapSession(rows[0]);
  }
  async getDrivers(session) {
    return (await this.fetchRows("drivers", { session_key: session })).map(
      (r) => ({
        id: `${session}:${r.driver_number}`,
        number: r.driver_number,
        code: r.name_acronym,
        name: r.full_name,
        team: r.team_name,
        color: /^[0-9a-f]{6}$/i.test(r.team_colour)
          ? `#${r.team_colour}`
          : "#b9c1cc",
        portrait: null,
        position: null,
      }),
    );
  }
  async getLaps(session) {
    return this.fetchRows("laps", { session_key: session });
  }
  async getWeather(session) {
    return this.fetchRows("weather", { session_key: session });
  }
  async getTelemetry(session, driver, start, end) {
    return this.fetchRows("car_data", {
      session_key: session,
      driver_number: driver,
      "date>": start,
      "date<": end,
    });
  }
  async getLocations(session, driver, start, end) {
    return this.fetchRows("location", {
      session_key: session,
      driver_number: driver,
      "date>": start,
      "date<": end,
    });
  }
  async getCatalog(sessionId) {
    const session = await this.getSession(sessionId);
    const drivers = await this.getDrivers(sessionId),
      raw = await this.getLaps(sessionId);
    const optional = async (name) => {
      try {
        return {
          rows: await this.fetchRows(name, { session_key: sessionId }),
          ok: true,
        };
      } catch {
        return { rows: [], ok: false };
      }
    };
    const [stints, pits, control, weather, classification] = await Promise.all(
      ["stints", "pit", "race_control", "weather", "session_result"].map(
        optional,
      ),
    );
    for (const driver of drivers)
      driver.position = numeric(
        classification.rows.find((r) => r.driver_number === driver.number)
          ?.position,
      );
    const laps = mapLaps(raw, {
      stints: stints.rows,
      pits: pits.rows,
      control: control.rows,
      weather: weather.rows,
      classification: classification.rows,
      sessionType: session.type,
      controlKnown: control.ok,
    });
    return { session, drivers, laps, raceControl: control.rows, pitDataKnown: pits.ok, track: null };
  }
}
export function mapLaps(
  rows,
  {
    stints = [],
    pits = [],
    control = [],
    weather = [],
    classification = [],
    sessionType = null,
    controlKnown = false,
  } = {},
) {
  const officialBestTimes = new Map();
  if (String(sessionType).toLowerCase() !== "race") {
    for (const result of classification) {
      const durations = (Array.isArray(result.duration)
        ? result.duration
        : [result.duration]
      )
        .map(numeric)
        .filter((value) => value != null && value > 0);
      if (durations.length)
        officialBestTimes.set(result.driver_number, Math.min(...durations));
    }
  }
  const ordered = [...control].sort(
    (a, b) => Date.parse(a.date) - Date.parse(b.date),
  );
  const lapFlags = (start, end) => {
    const flags = new Set();
    let active = "UNKNOWN";
    for (const row of ordered) {
      const t = Date.parse(row.date);
      if (t > end) break;
      const msg = String(row.message ?? "").toUpperCase();
      let flag = null;
      if (
        row.flag === "GREEN" ||
        msg.includes("CLEAR") ||
        /(?:VIRTUAL SAFETY CAR|VSC) (?:ENDING|ENDED)/.test(msg) ||
        msg.includes("SAFETY CAR IN THIS LAP")
      )
        flag = "GREEN";
      else if (row.flag === "RED") flag = "RED";
      else if (msg.includes("VIRTUAL SAFETY CAR DEPLOYED")) flag = "VSC";
      else if (msg.includes("SAFETY CAR DEPLOYED")) flag = "SC";
      else if (["YELLOW", "DOUBLE YELLOW"].includes(row.flag)) flag = "YELLOW";
      if (flag) {
        if (t >= start) {
          flags.add(flag);
          if (active !== "UNKNOWN") flags.add(active);
        }
        active = flag;
      }
    }
    if (active !== "UNKNOWN") flags.add(active);
    if (!flags.size) flags.add("UNKNOWN");
    return [...flags];
  };
  return rows.map((r) => {
    const time = numeric(r.lap_duration),
      start = Date.parse(r.date_start),
      end = start + (time ?? 0) * 1000,
      officialBestTime = officialBestTimes.get(r.driver_number) ?? null;
    const stint = stints.find(
      (s) =>
        s.driver_number === r.driver_number &&
        r.lap_number >= s.lap_start &&
        r.lap_number <= s.lap_end,
    );
    const pit = pits.some(
      (p) =>
        p.driver_number === r.driver_number &&
        (Number.isInteger(p.lap_number) && p.lap_number > 0
          ? p.lap_number === r.lap_number
          : Date.parse(p.date) >= start && Date.parse(p.date) < end),
    );
    let deleted = false;
    for (const c of ordered) {
      const msg = String(c.message ?? "").toUpperCase();
      const lapMatch = msg.match(/LAP\s+(\d+)\b/);
      const carMatch = msg.match(/CAR\s+(\d+)\b/);
      if (
        (c.driver_number === r.driver_number ||
          Number(carMatch?.[1]) === r.driver_number) &&
        (c.lap_number === r.lap_number ||
          Number(lapMatch?.[1]) === r.lap_number)
      ) {
        if (msg.includes("DELETED")) deleted = true;
        if (msg.includes("REINSTATED")) deleted = false;
      }
    }
    const w = weather
      .filter((w) => Date.parse(w.date) <= start)
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
    return {
      id: `${r.session_key}:${r.driver_number}:${r.lap_number}`,
      sessionId: r.session_key,
      driverNumber: r.driver_number,
      number: r.lap_number,
      time,
      start: Number.isFinite(start) ? r.date_start : null,
      sectors: [
        r.duration_sector_1,
        r.duration_sector_2,
        r.duration_sector_3,
      ].map(numeric),
      compound: stint?.compound ?? null,
      tyreAge: stint
        ? numeric(stint.tyre_age_at_start) == null
          ? null
          : stint.tyre_age_at_start + r.lap_number - stint.lap_start
        : null,
      stint: stint?.stint_number ?? null,
      pitIn: pit,
      pitOut: r.is_pit_out_lap === true,
      deleted,
      officialBestTime,
      officialBest:
        time != null &&
        officialBestTime != null &&
        Math.round(time * 1000) === Math.round(officialBestTime * 1000),
      complete: time > 0 && Number.isFinite(start),
      status: Number.isFinite(start) ? lapFlags(start, end) : ["UNKNOWN"],
      validityKnown: controlKnown,
      weather:
        w && start - Date.parse(w.date) < 10 * 60000
          ? {
              date: w.date,
              air: numeric(w.air_temperature),
              track: numeric(w.track_temperature),
              humidity: numeric(w.humidity),
              rain: numeric(w.rainfall),
              wind: numeric(w.wind_speed),
            }
          : null,
    };
  });
}
