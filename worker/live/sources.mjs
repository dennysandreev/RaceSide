import mqtt from "mqtt";
import { DATASETS } from "./state.mjs";

export class LiveDataSource {
  async start() {
    throw new Error("Implement start");
  }
  async stop() {}
}
export class OpenF1LiveSource extends LiveDataSource {
  constructor({ onMessage, onConnection }) {
    super();
    this.onMessage = onMessage;
    this.onConnection = onConnection;
    this.stopped = false;
  }
  async token() {
    if (this.accessToken && this.expiresAt > Date.now() + 60000)
      return this.accessToken;
    if (this.tokenFlight) return this.tokenFlight;
    this.tokenFlight = (async () => {
      const response = await fetch("https://api.openf1.org/token", {
        method: "POST",
        body: new URLSearchParams({
          username: process.env.OPENF1_USERNAME ?? "",
          password: process.env.OPENF1_PASSWORD ?? "",
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok)
        throw new Error(`OpenF1 authentication HTTP ${response.status}`);
      const result = await response.json();
      if (!result.access_token) throw new Error("OpenF1 token missing");
      this.accessToken = result.access_token;
      this.expiresAt = Date.now() + (result.expires_in ?? 3600) * 1000;
      return this.accessToken;
    })().finally(() => {
      this.tokenFlight = null;
    });
    return this.tokenFlight;
  }
  async rest(topic, query = {}, retry = 0) {
    const token = await this.token();
    const url = new URL(`https://api.openf1.org/v1/${topic}`);
    for (const [key, value] of Object.entries(query))
      url.searchParams.set(key, String(value));
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(45000),
    });
    if (res.status === 401 && retry === 0) {
      this.expiresAt = 0;
      return this.rest(topic, query, 1);
    }
    if (res.status === 429 && retry < 3) {
      await new Promise((r) =>
        setTimeout(
          r,
          Math.min(
            15000,
            (Number(res.headers.get("retry-after")) || 2 ** retry) * 1000,
          ),
        ),
      );
      return this.rest(topic, query, retry + 1);
    }
    if (!res.ok) throw new Error(`OpenF1 ${topic} HTTP ${res.status}`);
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  }
  async start() {
    this.stopped = false;
    await this.connect();
    this.refreshTimer = setInterval(() => {
      if (this.expiresAt < Date.now() + 120000)
        void this.connect().catch(() => this.onConnection(false));
    }, 60000);
  }
  async connect() {
    if (this.connecting || this.stopped) return;
    this.connecting = true;
    try {
      const token = await this.token();
      clearTimeout(this.retryTimer);
      if (this.client) {
        this.client.removeAllListeners("close");
        await this.client.endAsync(true);
      }
      if (this.stopped) return;
      this.client = mqtt.connect("wss://mqtt.openf1.org:8084/mqtt", {
        username: process.env.OPENF1_USERNAME,
        password: token,
        reconnectPeriod: 0,
        connectTimeout: 15000,
        keepalive: 30,
        clean: true,
      });
      this.client.on("connect", () => {
        this.retry = 0;
        this.client.subscribe(
          DATASETS.map((x) => `v1/${x}`),
          { qos: 1 },
          (error) => this.onConnection(!error),
        );
      });
      this.client.on("message", (topic, payload) => {
        try {
          const rows = JSON.parse(payload.toString());
          for (const row of Array.isArray(rows) ? rows : [rows])
            this.onMessage(topic.replace("v1/", ""), row);
        } catch {
          console.error("[live] invalid source message");
        }
      });
      this.client.on("error", () => this.onConnection(false));
      this.client.on("close", () => {
        this.onConnection(false);
        if (!this.stopped) {
          clearTimeout(this.retryTimer);
          this.retryTimer = setTimeout(
            () => void this.connect().catch(() => this.onConnection(false)),
            Math.min(
              30000,
              1000 * 2 ** Math.min((this.retry = (this.retry ?? 0) + 1), 5),
            ),
          );
        }
      });
    } finally {
      this.connecting = false;
    }
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.refreshTimer);
    clearTimeout(this.retryTimer);
    await this.client?.endAsync(true);
  }
}

export function replayMessages(replay) {
  const base = Date.now();
  const sourceKey = replay.sourceSessionKey;
  const messages = [];
  const add = (offset, topic, row) =>
    messages.push({
      offset: Math.max(0, offset),
      topic,
      row: {
        ...row,
        session_key: sourceKey,
        date: new Date(base + Math.max(0, offset)).toISOString(),
      },
    });
  for (const d of replay.drivers)
    add(0, "drivers", {
      driver_number: d.driverNumber,
      name_acronym: d.abbreviation,
      full_name: d.fullName,
      team_name: d.teamName,
      team_colour: d.teamColor.replace("#", ""),
    });
  const lapSeen = new Set(),
    stintSeen = new Map(),
    pitSeen = new Map();
  for (const p of replay.positions) {
    const n = p.driverNumber;
    add(p.offsetMs, "location", {
      driver_number: n,
      x: p.svgX,
      y: p.svgY,
      z: p.z,
      svgX: p.svgX,
      svgY: p.svgY,
      progress: p.progress,
    });
    if (p.speedKph != null || p.gear != null)
      add(p.offsetMs, "car_data", {
        driver_number: n,
        speed: p.speedKph,
        n_gear: p.gear,
        drs: p.drs,
        throttle: p.throttle,
        brake: p.brake,
        rpm: p.rpm,
      });
    if (p.position != null)
      add(p.offsetMs, "position", { driver_number: n, position: p.position });
    if (p.gapToLeader != null)
      add(p.offsetMs, "intervals", {
        driver_number: n,
        gap_to_leader: p.gapToLeader,
        interval: p.intervalToAhead,
      });
    const previousStint = stintSeen.get(n);
    if (
      p.compound &&
      (previousStint?.compound !== p.compound ||
        (!p.tyreAgeEstimated &&
          p.tyreAge != null &&
          previousStint?.age != null &&
          p.tyreAge < previousStint.age))
    ) {
      const stint = (previousStint?.number ?? 0) + 1;
      stintSeen.set(n, { compound: p.compound, number: stint, age: p.tyreAge });
      add(p.offsetMs, "stints", {
        driver_number: n,
        compound: p.compound,
        lap_start: p.lapNumber ?? 1,
        stint_number: stint,
        tyre_age_at_start: p.tyreAge ?? 0,
      });
    }
    if (!p.tyreAgeEstimated && p.tyreAge != null && stintSeen.has(n))
      stintSeen.get(n).age = p.tyreAge;
    if (p.isPitLane && !pitSeen.get(n))
      add(p.offsetMs, "pit", {
        driver_number: n,
        lap_number: p.lapNumber,
        lane_duration: p.pitLaneDuration,
        stop_duration: p.pitStopDuration,
      });
    pitSeen.set(n, p.isPitLane);
    if (p.lapNumber && !lapSeen.has(`${n}:${p.lapNumber}`)) {
      lapSeen.add(`${n}:${p.lapNumber}`);
      const seconds = (x) => {
        if (!x) return null;
        const v = String(x).split(":").map(Number);
        return v.length === 2 ? v[0] * 60 + v[1] : v[0];
      };
      add(p.offsetMs, "laps", {
        driver_number: n,
        lap_number: p.lapNumber,
        lap_duration: p.lastLapDuration ?? seconds(p.lastLapTime),
        duration_sector_1: seconds(p.sector1Time),
        duration_sector_2: seconds(p.sector2Time),
        duration_sector_3: seconds(p.sector3Time),
        is_pit_out_lap: Boolean(p.isPitLane),
      });
    }
  }
  for (const p of replay.positionTimings ?? [])
    add(p.offsetMs, "position", {
      driver_number: p.driverNumber,
      position: p.position,
    });
  for (const p of replay.intervalTimings ?? [])
    add(p.offsetMs, "intervals", {
      driver_number: p.driverNumber,
      gap_to_leader: p.gapToLeader,
      interval: p.intervalToAhead,
    });
  for (const e of replay.raceEvents) {
    const trackSector = Number(
      String(e.message).match(/TRACK SECTOR\s+(\d+)/i)?.[1],
    );
    add(e.offsetMs, "race_control", {
      message: e.message,
      lap_number: e.lapNumber,
      driver_number: e.driverNumber,
      flag: replayRaceControlFlag(e.message),
      scope: Number.isInteger(trackSector) ? "Sector" : null,
      sector: Number.isInteger(trackSector) ? trackSector : null,
    });
  }
  if (replay.weather)
    add(0, "weather", {
      air_temperature: replay.weather.airTemperatureC,
      track_temperature: replay.weather.trackTemperatureC,
      rainfall: replay.weather.rainfall,
      wind_speed: (replay.weather.windSpeedKmh ?? 0) / 3.6,
    });
  return messages.sort((a, b) => a.offset - b.offset);
}

export function replayRaceControlFlag(message) {
  const text = String(message ?? "").trim();

  if (
    /INFRINGEMENT|INVESTIGAT(?:ION|ED)|FIA STEWARDS|PENALTY|NOTED/i.test(text)
  )
    return null;
  if (/CLEAR IN TRACK SECTOR/i.test(text)) return "CLEAR";
  if (/CHEQUERED|CHECKERED|Клетчат/i.test(text)) return "CHEQUERED";
  if (/RED FLAG/i.test(text)) return "RED";
  if (/GREEN FLAG/i.test(text)) return "GREEN";
  if (
    /^(?:DOUBLE\s+)?YELLOW(?:\s+FLAG)?(?:\s+IN\s+TRACK\s+SECTOR\s+\d+)?(?:\s|$)/i.test(
      text,
    )
  )
    return "YELLOW";

  return null;
}
export class ReplaySimulationSource extends LiveDataSource {
  constructor({
    replay,
    onMessage,
    onConnection,
    speed = 1,
    offset = 0,
    session = {},
  }) {
    super();
    Object.assign(this, { replay, onMessage, onConnection, speed, offset });
    this.session = {
      session_key: replay.sourceSessionKey,
      session_type: session.sessionType ?? "Race",
      session_name: session.sessionName ?? session.sessionType ?? "Race",
      date_start:
        session.sessionStart ??
        new Date(Date.now() - offset / speed).toISOString(),
      date_end:
        session.sessionEnd ??
        new Date(
          Date.now() + (replay.durationMs - offset) / speed,
        ).toISOString(),
    };
  }
  async start() {
    const { createReplayMotion } = await import("./replay-motion.mjs");
    const positionsAt = createReplayMotion(this.replay);
    this.messages = replayMessages(this.replay).filter(
      (message) =>
        message.topic !== "location" || message.offset <= this.offset,
    );
    this.index = 0;
    this.started = performance.now();
    // Rebase historical times to the simulation clock, preserving relative ordering.
    this.base = Date.now() - this.offset / this.speed;
    this.onConnection(true);
    this.onMessage("sessions", this.session);
    const tick = () => {
      const elapsed =
        this.offset + (performance.now() - this.started) * this.speed;
      while (
        this.index < this.messages.length &&
        this.messages[this.index].offset <= elapsed
      ) {
        const m = this.messages[this.index++];
        this.onMessage(m.topic, {
          ...m.row,
          date: new Date(this.base + m.offset / this.speed).toISOString(),
        });
      }
      // Replay coordinates are deliberately sparse (~8 seconds apart). Sample
      // the existing replay motion at live cadence instead of replaying gaps.
      for (const row of positionsAt(
        Math.min(elapsed, this.replay.durationMs),
      )) {
        const { retired, recordedOffsetMs, ...position } = row;
        this.onMessage("location", {
          ...position,
          session_key: this.replay.sourceSessionKey,
          // A frozen historical trajectory is not an official DNF. Preserve
          // its last confirmed timestamp so normal map expiry can hide it.
          date: new Date(
            this.base + (retired ? recordedOffsetMs : elapsed) / this.speed,
          ).toISOString(),
        });
      }
      if (elapsed >= this.replay.durationMs) {
        clearInterval(this.timer);
        this.onMessage("race_control", {
          session_key: this.replay.sourceSessionKey,
          date: new Date().toISOString(),
          flag: "CHEQUERED",
          message: "CHEQUERED FLAG",
        });
      }
    };
    this.timer = setInterval(tick, 100);
    tick();
  }
  async stop() {
    clearInterval(this.timer);
    this.onConnection(false);
  }
}
