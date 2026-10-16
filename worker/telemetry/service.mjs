import {
  VERSION,
  parseConfig,
  bestLap,
  bestLapCandidates,
  raceAverageLaps,
  normalizeLap,
  averageNormalizedLaps,
  buildComparison,
  cleanSamples,
} from "./core.mjs";
import { hash, TelemetryStore } from "./store.mjs";
import { OpenF1Provider } from "./provider.mjs";
import { orientEstimatedTrack, verifiedTrack } from "./track-geometry.mjs";
import { buildRacePace, raceControlLaps, raceTyreLaps, isRaceSession, RACE_PACE_VERSION } from "./race-pace.mjs";
import { ANALYSIS_VERSION, buildTelemetryAnalysis, repeatableLap } from "./analysis.mjs";
import { REPORT_TIMING_VERSION, buildReportTiming, reportTimingTtl } from "./report-timing.mjs";
export const resultKey = (task) =>
  `${task.kind === "report-timing" ? REPORT_TIMING_VERSION : task.kind === "race-pace" ? RACE_PACE_VERSION : VERSION}:${hash(
    ["catalog", "compare"].includes(task.kind)
      ? { ...task, raceAnalysisVersion: RACE_PACE_VERSION,
          ...(task.kind === "compare" ? { trackAnalysisVersion: ANALYSIS_VERSION } : {}) }
      : task,
  )}`;
const catalogTtl = (catalog) =>
  Date.now() - Date.parse(catalog.session.end) < 24 * 3600000
    ? 15 * 60000
    : 24 * 3600000;
export function validateTask(task) {
  if (
    !task ||
    !["seasons", "meetings", "sessions", "catalog", "compare", "race-pace", "report-timing"].includes(
      task.kind,
    )
  )
    throw new Error("INVALID_TASK");
  if (task.kind === "compare")
    return { kind: "compare", config: parseConfig(task.config) };
  if (task.kind === "seasons") return { kind: "seasons" };
  const field =
      task.kind === "meetings"
        ? "season"
        : task.kind === "sessions"
          ? "meeting"
          : "session",
    value = task[field];
  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    value > 1000000 ||
    (field === "season" &&
      (value < 2023 || value > new Date().getUTCFullYear()))
  )
    throw new Error("INVALID_TASK");
  return { kind: task.kind, [field]: value };
}
export class TelemetryService {
  constructor({ store, provider }) {
    this.store = store;
    this.provider = provider;
  }
  async cached(key, fn, ttl = null) {
    const old = await this.store.get(key);
    if (old) return old;
    const data = await fn();
    await this.store.put(key, data, typeof ttl === "function" ? ttl(data) : ttl);
    return data;
  }
  async catalog(id) {
    const catalog = await this.cached(
      `catalog:${VERSION}:${id}`,
      () => this.provider.getCatalog(id),
      catalogTtl,
    );
    if (!isRaceSession(catalog.session)) return catalog;
    return { ...catalog, laps: raceTyreLaps({ ...catalog, laps: raceControlLaps(catalog) }) };
  }
  async raw(lap) {
    return this.cached(
      `raw:${VERSION}:${lap.id}:${hash([lap.start, lap.time]).slice(0, 16)}`,
      async () => {
        const start = new Date(Date.parse(lap.start) - 2000).toISOString(),
          end = new Date(
            Date.parse(lap.start) + lap.time * 1000 + 2000,
          ).toISOString();
        const samples = await this.provider.getTelemetry(
          lap.sessionId,
          lap.driverNumber,
          start,
          end,
        );
        let locations = [];
        try {
          locations = await this.provider.getLocations(
            lap.sessionId,
            lap.driverNumber,
            start,
            end,
          );
        } catch {
          /* Speed-based comparison remains available without GPS. */
        }
        return {
          samples,
          locations,
          provider: "OpenF1",
          providerDatasetId: lap.id,
          sourceLicense: this.provider.source.license,
          checksum: hash(samples),
        };
      },
    );
  }
  async raceRaw(catalog, driverNumber, laps) {
    const fingerprint = laps.map((lap) => [lap.id, lap.start, lap.time]);
    return this.cached(
      `race-raw:${VERSION}:${catalog.session.id}:${driverNumber}:${hash(fingerprint).slice(0, 16)}`,
      async () => {
        const starts = laps
            .map((lap) => Date.parse(lap.start))
            .filter(Number.isFinite),
          ends = laps
            .map((lap) => Date.parse(lap.start) + lap.time * 1000)
            .filter(Number.isFinite);
        if (!starts.length || !ends.length)
          throw new Error("RACE_AVERAGE_UNAVAILABLE");
        const start = new Date(Math.min(...starts) - 2000).toISOString(),
          end = new Date(Math.max(...ends) + 2000).toISOString(),
          samples = await this.provider.getTelemetry(
            catalog.session.id,
            driverNumber,
            start,
            end,
          );
        return {
          samples,
          locations: [],
          provider: "OpenF1",
          providerDatasetId: `${catalog.session.id}:${driverNumber}:race`,
          sourceLicense: this.provider.source.license,
          checksum: hash(samples),
        };
      },
    );
  }
  async track(catalog, lap) {
    const existing = verifiedTrack(
      catalog.session.circuit,
      catalog.session.season,
    );
    if (existing) return existing;
    const fallback = await this.cached(
      `track:${VERSION}:${catalog.session.meetingId}`,
      async () => {
        const reference = bestLap(catalog.laps) ?? lap,
          raw = await this.raw(reference),
          samples = cleanSamples(raw.samples).filter(
            (s) =>
              s.timestamp >= Date.parse(reference.start) &&
              s.timestamp <=
                Date.parse(reference.start) + reference.time * 1000,
          );
        if (samples.length < 10) throw new Error("NO_TELEMETRY");
        let length = 0;
        const distances = samples.map((p, i) => {
          if (i)
            length +=
              (((p.speed + samples[i - 1].speed) / 7.2) *
                (p.timestamp - samples[i - 1].timestamp)) /
              1000;
          return length;
        });
        const locations = raw.locations.filter(
          (p) =>
            Date.parse(p.date) >= samples[0].timestamp &&
            Date.parse(p.date) <= samples.at(-1).timestamp &&
            p.x != null &&
            p.y != null,
        );
        const points = locations.map((p) => {
          const time = Date.parse(p.date);
          let i = 0;
          while (i + 1 < samples.length && samples[i + 1].timestamp < time) i++;
          const n = Math.min(i + 1, samples.length - 1),
            dt = samples[n].timestamp - samples[i].timestamp;
          return {
            distance:
              distances[i] +
              (dt
                ? ((distances[n] - distances[i]) *
                    (time - samples[i].timestamp)) /
                  dt
                : 0),
            x: p.x,
            y: p.y,
          };
        });
        const sectorTimes = reference.sectors;
        let elapsed = 0;
        const sectors = sectorTimes
          .slice(0, 2)
          .map((t) => {
            elapsed += t ?? 0;
            const i = samples.findIndex(
              (p) =>
                (p.timestamp - Date.parse(reference.start)) / 1000 >= elapsed,
            );
            return distances[Math.max(0, i)];
          })
          .filter((d) => d > 0);
        return {
          id: `meeting-${catalog.session.meetingId}`,
          version: `${VERSION}:${reference.id}`,
          name: catalog.session.circuit,
          length,
          points,
          sectors,
          corners: [],
          source: `OpenF1 reference lap ${reference.id}`,
          estimated: true,
        };
      },
    );
    return orientEstimatedTrack(fallback);
  }
  async normalize(catalog, lap, track) {
    return this.cached(
      `normalized:${VERSION}:${lap.id}:${hash([lap, track.version]).slice(0, 16)}`,
      async () => {
        const raw = await this.raw(lap),
          driver = catalog.drivers.find((d) => d.number === lap.driverNumber);
        if (!driver) throw new Error("DRIVER_NOT_FOUND");
        return normalizeLap({
          lap,
          driver,
          session: catalog.session,
          ...raw,
          track,
          datasetId: raw.checksum,
        });
      },
    );
  }
  async raceAverage(catalog, driverNumber, track) {
    if (
      String(catalog.session.type).toLowerCase() !== "race" &&
      String(catalog.session.name).toLowerCase() !== "race"
    )
      throw new Error("RACE_AVERAGE_ONLY");
    const candidates = raceAverageLaps(
      raceControlLaps(catalog).filter((lap) => lap.driverNumber === driverNumber),
    );
    if (candidates.length < 2) throw new Error("RACE_AVERAGE_UNAVAILABLE");
    const averageKey = `race-average:${VERSION}:${catalog.session.id}:${driverNumber}:${hash(
      [candidates.map((lap) => [lap.id, lap.start, lap.time]), track.version],
    ).slice(0, 16)}`;
    return this.cached(averageKey, async () => {
      const raw = await this.raceRaw(catalog, driverNumber, candidates),
        driver = catalog.drivers.find(
          (candidate) => candidate.number === driverNumber,
        ),
        traces = [];
      if (!driver) throw new Error("DRIVER_NOT_FOUND");
      for (const lap of candidates) {
        try {
          const start = Date.parse(lap.start) - 2000,
            end = Date.parse(lap.start) + lap.time * 1000 + 2000,
            samples = raw.samples.filter((sample) => {
              const date = Date.parse(sample.date);
              return date >= start && date <= end;
            }),
            trace = normalizeLap({
              lap,
              driver,
              session: catalog.session,
              samples,
              locations: [],
              track,
              datasetId: hash(samples),
            });
          if (trace.quality.comparable) traces.push(trace);
        } catch (error) {
          if (!["NO_TELEMETRY", "INCOMPLETE_TELEMETRY"].includes(error.message))
            throw error;
        }
      }
      if (traces.length < 2) throw new Error("RACE_AVERAGE_UNAVAILABLE");
      return averageNormalizedLaps(traces, track);
    });
  }
  async resolve(catalog, selection, track) {
    const laps = catalog.laps.filter(
      (l) => l.driverNumber === selection.driver,
    );
    if (selection.lap === "race_average")
      return this.raceAverage(catalog, selection.driver, track);
    const chosen =
      selection.lap === "best"
        ? bestLap(laps)
        : laps.find((l) => l.number === selection.lap);
    if (!chosen) throw new Error("NO_VALID_LAP");
    if (selection.lap !== "best") return this.normalize(catalog, chosen, track);
    const candidates = bestLapCandidates(laps).slice(0, 4);
    for (const lap of candidates) {
      try {
        const result = await this.normalize(catalog, lap, track);
        if (result.quality.comparable) {
          if (lap.id !== chosen.id)
            result.quality.warnings.push("BEST_AVAILABLE_LAP");
          return result;
        }
      } catch (e) {
        if (!["NO_TELEMETRY", "INCOMPLETE_TELEMETRY"].includes(e.message))
          throw e;
      }
    }
    throw new Error("NO_COMPARABLE_LAP");
  }
  async analysisCandidates(catalogs, traces, track) {
    if (traces.length !== 2 || traces[0].session.id !== traces[1].session.id ||
      traces[0].driver.number === traces[1].driver.number || !traces.every(repeatableLap)) return [];
    const candidates = [];
    for (let i = 0; i < traces.length; i++) {
      const selected = traces[i];
      const laps = catalogs[i].laps.filter((lap) => lap.driverNumber === selected.driver.number && lap.id !== selected.lap.id &&
        repeatableLap({ ...selected, lap }))
        .sort((a, b) => Math.abs(Date.parse(a.start) - Date.parse(selected.lap.start)) - Math.abs(Date.parse(b.start) - Date.parse(selected.lap.start)))
        .slice(0, 4);
      for (const lap of laps) {
        try { candidates.push(await this.normalize(catalogs[i], lap, track)); }
        catch { /* Optional repetition data must not invalidate the selected laps. */ }
      }
    }
    return candidates;
  }
  async compare(input) {
    const config = parseConfig(input);
    let selections = [...config.traces];
    const initial = await this.catalog(selections[0].session);
    if (config.mode === "teammate") {
      const driver = initial.drivers.find(
        (d) => d.number === selections[0].driver,
      );
      if (!driver) throw new Error("DRIVER_NOT_FOUND");
      const teammates = initial.drivers.filter(
        (d) =>
          d.team === driver.team &&
          d.number !== driver.number &&
          bestLap(initial.laps.filter((l) => l.driverNumber === d.number)),
      );
      if (teammates.length !== 1) throw new Error("TEAMMATE_UNAVAILABLE");
      selections = [
        { ...selections[0], lap: "best" },
        {
          session: initial.session.id,
          driver: teammates[0].number,
          lap: "best",
        },
      ];
    }
    let evolution;
    if (config.mode === "evolution") {
      const sessions = await this.cached(
        `sessions:${initial.session.meetingId}`,
        () => this.provider.getSessions(initial.session.meetingId),
        3600000,
      );
      const samples = [];
      for (const session of config.window === "session"
        ? [initial.session]
        : sessions) {
        const catalog = await this.catalog(session.id);
        const driverLaps = catalog.laps.filter(
          (l) => l.driverNumber === selections[0].driver,
        );
        if (config.window === "session") {
          const split =
            Date.parse(session.start) +
            (Date.parse(session.end) - Date.parse(session.start)) / 2;
          for (const subset of [
            driverLaps.filter((l) => Date.parse(l.start) < split),
            driverLaps.filter((l) => Date.parse(l.start) >= split),
          ]) {
            const lap = bestLap(subset);
            if (lap) samples.push({ catalog, lap });
          }
        } else {
          const lap = bestLap(driverLaps);
          if (lap) samples.push({ catalog, lap });
        }
      }
      if (samples.length < 2) throw new Error("EVOLUTION_UNAVAILABLE");
      samples.sort((a, b) => Date.parse(a.lap.start) - Date.parse(b.lap.start));
      selections = [samples[0], samples.at(-1)].map((e) => ({
        session: e.catalog.session.id,
        driver: e.lap.driverNumber,
        lap: e.lap.number,
      }));
      evolution = samples;
    }
    const catalogs = await Promise.all(
      selections.map((s) => this.catalog(s.session)),
    );
    if (
      catalogs.some(
        (c) =>
          c.session.meetingId !== initial.session.meetingId ||
          c.session.circuitKey !== initial.session.circuitKey,
      )
    )
      throw new Error("INCOMPATIBLE_LAPS");
    if (
      config.mode === "session" &&
      selections.some((s) => s.driver !== selections[0].driver)
    )
      throw new Error("INCOMPATIBLE_LAPS");
    const referenceLap =
      bestLap(initial.laps) ?? initial.laps.find((l) => l.complete);
    if (!referenceLap) throw new Error("NO_VALID_LAP");
    const track = await this.track(initial, referenceLap);
    const traces = [];
    for (let i = 0; i < selections.length; i++)
      traces.push(await this.resolve(catalogs[i], selections[i], track));
    const result = buildComparison(traces, track, {
      ...config,
      traces: selections,
      reference: config.reference < selections.length ? config.reference : 0,
    });
    if (track.estimated) result.warnings.push("ESTIMATED_TRACK");
    if (evolution) {
      result.evolution = [];
      for (const { catalog, lap } of evolution) {
        try {
          const t = await this.normalize(catalog, lap, track);
          result.evolution.push({
            session: t.session,
            lap: t.lap,
            driver: t.driver,
            metrics: t.metrics,
          });
        } catch {
          /* Missing intermediate telemetry does not invalidate the endpoint comparison. */
        }
      }
    }
    result.analysis = buildTelemetryAnalysis(result, await this.analysisCandidates(catalogs, traces, track));
    return result;
  }
  async prepare(input) {
    const task = validateTask(input),
      key = resultKey(task);
    return this.cached(
      key,
      async () => {
        if (task.kind === "seasons") {
          const years = [];
          for (let y = new Date().getUTCFullYear(); y >= 2023; y--) {
            const meetings = await this.cached(
              `meetings:${y}`,
              () => this.provider.getMeetings(y),
              86400000,
            );
            if (meetings.length) years.push(y);
          }
          return years;
        }
        if (task.kind === "meetings")
          return this.cached(
            `meetings:${task.season}`,
            () => this.provider.getMeetings(task.season),
            86400000,
          );
        if (task.kind === "sessions")
          return this.cached(
            `sessions:${task.meeting}`,
            () => this.provider.getSessions(task.meeting),
            3600000,
          );
        if (task.kind === "catalog") return this.catalog(task.session);
        if (task.kind === "race-pace")
          return buildRacePace(await this.catalog(task.session));
        if (task.kind === "report-timing") {
          const catalog = await this.catalog(task.session);
          if (String(catalog.session.name).toLowerCase() !== "race") throw new Error("REPORT_TIMING_ONLY");
          const [positions, intervals] = await Promise.all([
            this.provider.fetchRows("position", { session_key: task.session }),
            this.provider.fetchRows("intervals", { session_key: task.session }),
          ]);
          return buildReportTiming(catalog, positions, intervals);
        }
        return this.compare(task.config);
      },
      task.kind === "compare"
        ? null
        : task.kind === "report-timing"
          ? reportTimingTtl
        : task.kind === "race-pace"
          ? (data) => Date.now() - Date.parse(data.session.end) < 24 * 3600000
            ? 15 * 60000 : null
          : task.kind === "catalog" ? catalogTtl : 3600000,
    );
  }
}
export async function runTelemetryTask({ db, taskId, jobId, fetchRows }) {
  const store = new TelemetryStore(db),
    task = await store.task(taskId);
  if (!task) throw new Error("TASK_NOT_FOUND");
  if (jobId && task.job_id !== jobId) return { itemsProcessed: 0, metadata: { skipped: "superseded_attempt" } };
  const attemptJobId = jobId ?? task.job_id;
  try {
    const service = new TelemetryService({
      store,
      provider: new OpenF1Provider({ fetchRows }),
    });
    await service.prepare(task.task);
    await store.finish(taskId, resultKey(validateTask(task.task)), attemptJobId);
    return { itemsProcessed: 1 };
  } catch (e) {
    await store.fail(
      taskId,
      /^[A-Z_]+$/.test(e.message) ? e.message : "PROVIDER_UNAVAILABLE",
      attemptJobId,
    );
    throw e;
  }
}
