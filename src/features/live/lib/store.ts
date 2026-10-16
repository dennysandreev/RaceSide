import type {
  LiveMessage,
  LiveSessionState,
  LocationSample,
  TelemetrySample,
  LiveHealth,
  LivePresentation,
  LiveView,
} from "./types";
import { applyTimelinePatch } from "../../../../worker/live/timeline.mjs";
export const initialState: LiveSessionState = {
  session: null,
  championship: null,
  drivers: {},
  locations: {},
  telemetry: {},
  events: [],
  radio: [],
  pits: [],
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
  timerPausedAt: null,
  timerOffsetMs: 0,
  replayReady: false,
  updatedAt: null,
};
const MIN_PLAYBACK_DELAY_MS = 900;
const MAX_PLAYBACK_DELAY_MS = 8000;
const LOCATION_JITTER_BUFFER_MS = 900;
export class LiveStore {
  state = initialState;
  health: LiveHealth | null = null;
  connection = "connecting";
  clockOffset = 0;
  presentation: LivePresentation | null = null;
  seeking = false;
  seekReady = false;
  seekRevision = 0;
  private presentationReceivedAt = 0;
  private seekHandler: ((view: LiveView) => void) | null = null;
  private clockInitialized = false;
  private playbackDelayMs = MIN_PLAYBACK_DELAY_MS;
  private playbackDelayInitialized = false;
  private listeners = new Map<string, Set<() => void>>();
  locations = new Map<number, LocationSample[]>();
  telemetry = new Map<number, TelemetrySample[]>();
  private replaySampler: ((driverNumber: number) => (LocationSample & { stale: boolean }) | null) | null = null;
  setReplaySampler(sampler: typeof this.replaySampler) {
    this.replaySampler = sampler;
  }
  subscribe = (key: string, fn: () => void) => {
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(fn);
    return () => {
      this.listeners.get(key)?.delete(fn);
    };
  };
  notify(key: string) {
    this.listeners.get(key)?.forEach((fn) => fn());
  }
  setConnection(value: string) {
    if (this.connection !== value) {
      this.connection = value;
      this.notify("connection");
    }
  }
  setSeekHandler(handler: ((view: LiveView) => void) | null) {
    this.seekHandler = handler;
  }
  seek(view: LiveView) {
    this.seekHandler?.(view);
  }
  setSeeking(value: boolean) {
    this.seeking = value;
    this.notify("seeking");
  }
  setSeekReady(value: boolean) {
    this.seekReady = value;
    this.notify("seeking");
  }
  getPresentationNow = () => this.presentation
    ? this.presentation.cursorTime + (this.presentation.paused ? 0 : Math.min(1000, Math.max(0, Date.now() - this.presentationReceivedAt)))
    : Date.now() + this.clockOffset;
  resetSamples() {
    const telemetryDrivers = [...this.telemetry.keys()];
    this.locations.clear();
    this.telemetry.clear();
    telemetryDrivers.forEach((driverNumber) =>
      this.notify(`telemetry:${driverNumber}`),
    );
  }
  accept(message: LiveMessage) {
    const offset = message.serverTime - Date.now();
    if (!this.clockInitialized) {
      this.clockOffset = offset;
      this.clockInitialized = true;
    } else {
      // Network jitter must not move the playback clock backwards on arrival.
      this.clockOffset +=
        Math.max(-10, Math.min(10, offset - this.clockOffset)) * 0.1;
    }
    if (message.health) this.health = message.health;
    if (message.presentation) {
      this.presentation = message.presentation;
      this.presentationReceivedAt = Date.now();
    }
    const data = message.patch ? applyTimelinePatch(this.state, message.patch) : message.data;
    const changed = new Set<keyof LiveSessionState>();
    const telemetryChanged = new Set<number>();
    if (data) {
      const reset = message.reset || (data.session?.session_key &&
        data.session.session_key !== this.state.session?.session_key);
      if (reset) {
        for (const driver of this.telemetry.keys()) telemetryChanged.add(driver);
        this.locations.clear();
        this.telemetry.clear();
        this.playbackDelayInitialized = false;
        this.playbackDelayMs = MIN_PLAYBACK_DELAY_MS;
      }
      const next = { ...(reset ? initialState : this.state), ...data };
      for (const key of Object.keys(data) as (keyof LiveSessionState)[]) {
        if (data[key] !== this.state[key] && JSON.stringify(data[key]) !== JSON.stringify(this.state[key])) changed.add(key);
      }
      // Publish the complete state before notifying any panel. A seek must
      // never render old flags alongside new timing or future telemetry.
      this.state = next;
      if (message.type === "snapshot") {
        const locations = Object.entries(data.locations ?? {});
        this.observeLocationDelay(
          message.presentation?.cursorTime ?? message.serverTime,
          locations.map(([, point]) => point),
        );
        for (const [n, p] of locations) this.addLocation(Number(n), p);
        for (const [n, p] of Object.entries(data.telemetry ?? {}))
          { this.addTelemetry(Number(n), p, false); telemetryChanged.add(Number(n)); }
      }
    }
    const locationSamples = (message.samples ?? []).filter(
      (
        sample,
      ): sample is Extract<
        NonNullable<LiveMessage["samples"]>[number],
        { type: "location" }
      > => sample.type === "location",
    );
    const newestLocations = new Map<number, LocationSample>();
    for (const point of locationSamples) {
      const prior = newestLocations.get(point.driverNumber);
      if (!prior || Date.parse(point.timestamp) > Date.parse(prior.timestamp))
        newestLocations.set(point.driverNumber, point);
    }
    this.observeLocationDelay(message.presentation?.cursorTime ?? message.serverTime, [...newestLocations.values()]);
    for (const sample of message.samples ?? [])
      if (sample.type === "location")
        this.addLocation(sample.driverNumber, sample);
      else { this.addTelemetry(sample.driverNumber, sample, false); telemetryChanged.add(sample.driverNumber); }
    for (const key of changed) this.notify(key);
    for (const driver of telemetryChanged) this.notify(`telemetry:${driver}`);
    if (message.health) this.notify("health");
    if (message.reset) {
      this.seekRevision++;
      this.setSeeking(false);
      this.notify("seekRevision");
    }
    if (message.presentation) this.notify("presentation");
  }
  private observeLocationDelay(
    serverTime: number,
    samples: Pick<LocationSample, "timestamp">[],
  ) {
    const ages = samples
      .map((sample) => serverTime - Date.parse(sample.timestamp))
      .filter((age) => Number.isFinite(age) && age >= 0 && age <= 30000)
      .sort((a, b) => a - b);
    if (!ages.length) return;
    const observed = ages[Math.floor((ages.length - 1) * 0.75)];
    const target = Math.max(
      MIN_PLAYBACK_DELAY_MS,
      Math.min(MAX_PLAYBACK_DELAY_MS, observed + LOCATION_JITTER_BUFFER_MS),
    );
    if (!this.playbackDelayInitialized) {
      this.playbackDelayMs = target;
      this.playbackDelayInitialized = true;
      return;
    }
    // Grow quickly when the provider slows down; shrink slowly to avoid
    // moving the playback clock forward in visible jumps.
    const smoothing = target > this.playbackDelayMs ? 0.35 : 0.02;
    this.playbackDelayMs += (target - this.playbackDelayMs) * smoothing;
  }
  getPlaybackDelay() {
    return this.playbackDelayMs;
  }
  addLocation(n: number, p: LocationSample) {
    const old = this.locations.get(n) ?? [];
    this.locations.set(
      n,
      [...old.filter((x) => x.timestamp !== p.timestamp), p]
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
        .slice(-24),
    );
  }
  addTelemetry(n: number, p: TelemetrySample, notify = true) {
    const old = this.telemetry.get(n) ?? [];
    const cutoff = Date.parse(p.timestamp) - 60000;
    this.telemetry.set(
      n,
      [
        ...old.filter(
          (x) =>
            x.timestamp !== p.timestamp && Date.parse(x.timestamp) >= cutoff,
        ),
        p,
      ]
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
        .slice(-300),
    );
    if (notify) this.notify(`telemetry:${n}`);
  }
  sample(
    n: number,
    now = this.getPresentationNow() - this.playbackDelayMs,
  ) {
    if (this.replaySampler) return this.replaySampler(n);
    if (
      ["DNF", "DNS", "RETIRED", "DSQ"].includes(this.state.drivers[n]?.status)
    )
      return null;
    const driver = this.state.drivers[n];
    if (
      driver?.status === "PIT" &&
      driver.pitEnteredAt &&
      now - Date.parse(driver.pitEnteredAt) >= 15000
    )
      return null;
    const points = this.locations.get(n);
    if (!points?.length) return null;
    const last = points[points.length - 1];
    if (
      now - Date.parse(last.timestamp) > 180000 ||
      now - Date.parse(last.stationarySince ?? last.timestamp) > 180000
    )
      return null;
    let a = points[0],
      b = last;
    for (let i = 1; i < points.length; i++)
      if (Date.parse(points[i].timestamp) >= now) {
        a = points[i - 1];
        b = points[i];
        break;
      }
    const span = Date.parse(b.timestamp) - Date.parse(a.timestamp);
    const ratio =
      span > 0
        ? Math.max(0, Math.min(1, (now - Date.parse(a.timestamp)) / span))
        : 1;
    let diff = b.progress - a.progress;
    if (diff < -0.5) diff += 1;
    if (diff > 0.5) diff -= 1;
    return {
      ...last,
      pitLaneProgress:
        a.pitLaneProgress != null && b.pitLaneProgress != null
          ? a.pitLaneProgress + (b.pitLaneProgress - a.pitLaneProgress) * ratio
          : ratio < 0.5
            ? a.pitLaneProgress
            : b.pitLaneProgress,
      x: a.x + (b.x - a.x) * ratio,
      y: a.y + (b.y - a.y) * ratio,
      progress: (a.progress + diff * ratio + 1) % 1,
      stale: now - Date.parse(last.timestamp) > 5000,
    };
  }
}
