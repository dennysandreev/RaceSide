import type {
  GrandPrixReport,
  ReplayIntervalTiming,
  ReplayLapTiming,
  ReplayPositionTiming,
  TyreStint,
} from "../types/racemate.ts";
import type { RacePace } from "../../worker/telemetry/types.ts";

export type ReportChartPoint = {
  lap: number;
  value: number | null;
  stint?: number | null;
};
export type ReportDriverTrace = {
  number: number;
  driver: string;
  team: string;
  code: string;
  positions: ReportChartPoint[];
  gaps: ReportChartPoint[];
  pace: ReportChartPoint[];
  tyres: TyreStint[];
};
export type ReportStanding = {
  id: string;
  name: string;
  team: string;
  position: number;
  points: number;
};
export type ReportStandingChange = ReportStanding & {
  previousPosition: number | null;
  previousPoints: number;
  gained: number;
};
export type GrandPrixReportAnalytics = {
  totalLaps: number;
  timingPending?: boolean;
  drivers: ReportDriverTrace[];
  championship: {
    drivers: ReportStandingChange[];
    teams: ReportStandingChange[];
  };
};
export type ReportTimings = {
  lapTimings?: ReplayLapTiming[];
  positionTimings?: ReplayPositionTiming[];
  intervalTimings?: ReplayIntervalTiming[];
  lapSamples?: {
    driverNumber: number;
    lapNumber: number;
    offsetMs: number;
    position: number | null;
    gapToLeader: string | null;
  }[];
};
export type ReportPitStop = {
  driver: string;
  team: string;
  lap: number;
  duration: number | null;
  laneDuration: number | null;
};

export function reportNumber(value: unknown): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && !value.trim())
  )
    return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function reportText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function reportLapTime(value: unknown): string {
  const seconds = reportNumber(value);
  if (seconds === null || seconds < 0) return "—";
  const milliseconds = Math.round(seconds * 1000);
  const minutes = Math.floor(milliseconds / 60_000);
  const remainder = Math.floor((milliseconds % 60_000) / 1000);
  return `${minutes}:${String(remainder).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
}

export function reportObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function reportLapTimings(value: unknown): ReplayLapTiming[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = Array.isArray(item)
      ? {
          driverNumber: item[0],
          lapNumber: item[1],
          startOffsetMs: item[2],
          durationMs: item[3],
        }
      : reportObject(item);
    const driverNumber = reportNumber(row.driverNumber),
      lapNumber = reportNumber(row.lapNumber),
      startOffsetMs = reportNumber(row.startOffsetMs);
    if (driverNumber === null || lapNumber === null || startOffsetMs === null)
      return [];
    return [
      {
        driverNumber,
        lapNumber,
        startOffsetMs,
        durationMs: reportNumber(row.durationMs),
      },
    ];
  });
}

export function reportParagraphs(value?: string | null): string[] {
  return (
    value
      ?.split(/\n{2,}/)
      .map((text) =>
        text
          .replace(/\*\*(.*?)\*\*/g, "$1")
          .replace(/\*(.*?)\*/g, "$1")
          .trim(),
      )
      .filter(Boolean) ?? []
  );
}

export function reportNews(value: Record<string, unknown>): string[] {
  for (const candidate of [
    value.summary,
    value.items,
    value.news,
    value.points,
  ]) {
    if (Array.isArray(candidate))
      return candidate
        .flatMap((item) => {
          const record = reportObject(item);
          const text =
            reportText(item) ??
            reportText(record.summary) ??
            reportText(record.title) ??
            reportText(record.text);
          return reportParagraphs(text);
        })
        .slice(0, 3);
  }
  return reportParagraphs(
    reportText(value.summary) ??
      reportText(value.text) ??
      reportText(value.body),
  );
}

export function getReportPitStops(report: GrandPrixReport): ReportPitStop[] {
  return report.pitStops
    .flatMap((item) => {
      const row = reportObject(item);
      const driver = reportText(row.driver);
      const lap = reportNumber(row.lap);
      if (!driver || !Number.isInteger(lap) || (lap ?? 0) < 1) return [];
      const duration = reportNumber(row.duration);
      const laneDuration = reportNumber(row.laneDuration);
      return [
        {
          driver,
          team:
            report.results.find((result) => result.driver === driver)?.team ??
            "",
          lap: lap!,
          duration: duration !== null && duration > 0 ? duration : null,
          laneDuration:
            laneDuration !== null && laneDuration > 0 ? laneDuration : null,
        },
      ];
    })
    .sort((a, b) => a.lap - b.lap);
}

export function compareReportStandings(
  before: ReportStanding[],
  after: ReportStanding[],
  minimumEntries: number,
  firstRound = false,
): ReportStandingChange[] {
  const complete = (rows: ReportStanding[]) =>
    rows.length >= minimumEntries &&
    new Set(rows.map((row) => row.id)).size === rows.length &&
    rows.every(
      (row) =>
        Number.isInteger(row.position) &&
        row.position > 0 &&
        Number.isFinite(row.points) &&
        row.points >= 0,
    );
  if (!complete(after) || (!firstRound && !complete(before))) return [];
  const previous = new Map(before.map((row) => [row.id, row]));
  return after
    .map((row) => ({
      ...row,
      previousPosition: previous.get(row.id)?.position ?? null,
      previousPoints: previous.get(row.id)?.points ?? 0,
      gained: row.points - (previous.get(row.id)?.points ?? 0),
    }))
    .sort((a, b) => a.position - b.position);
}

// Sample positions/intervals at this driver's completed lap boundary. Never
// carry a stale interval across a missing update or a red-flag interruption.
function sampleAt<T extends { offsetMs: number }>(
  rows: T[],
  at: number,
  maxAge: number,
): T | null {
  let low = 0,
    high = rows.length - 1,
    found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (rows[middle].offsetMs <= at) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found >= 0 && at - rows[found].offsetMs <= maxAge ? rows[found] : null;
}

function gapSeconds(value: unknown): number | null {
  if (typeof value === "number")
    return value >= 0 && Number.isFinite(value) ? value : null;
  // "+1 LAP" and unknown gaps must not become seconds or zero.
  if (typeof value !== "string" || !/^\+?\d+(?:[.,]\d+)?$/.test(value.trim()))
    return null;
  return reportNumber(value.trim().replace(",", "."));
}

export function buildReportAnalytics(
  report: GrandPrixReport,
  timings: ReportTimings = {},
  pace: RacePace | null = null,
): GrandPrixReportAnalytics {
  const positiveInteger = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  const laps = (timings.lapTimings ?? []).filter(
    (row) =>
      positiveInteger(row?.driverNumber) &&
      positiveInteger(row.lapNumber) &&
      Number.isFinite(row.startOffsetMs) &&
      row.durationMs !== null &&
      Number.isFinite(row.durationMs) &&
      row.durationMs > 0,
  );
  const maxLaps = Math.max(
    0,
    reportNumber(report.raceStatistics.laps) ?? 0,
    ...report.results.map((result) => reportNumber(result.laps) ?? 0),
    ...laps.map((lap) => lap.lapNumber),
    reportNumber(pace?.totalLaps) ?? 0,
  );
  const totalLaps = Math.min(1000, Math.max(1, Math.floor(maxLaps)));
  const drivers = report.results.flatMap((result) => {
    const number =
      result.driverNumber ??
      pace?.drivers.find(
        (driver) =>
          reportText(driver?.name)?.toLowerCase() ===
          result.driver.toLowerCase(),
      )?.number;
    if (!positiveInteger(number)) return [];
    const driverLaps = [
      ...new Map(
        laps
          .filter((lap) => lap.driverNumber === number)
          .map((lap) => [lap.lapNumber, lap]),
      ).values(),
    ].sort((a, b) => a.lapNumber - b.lapNumber);
    const positions = (timings.positionTimings ?? [])
      .filter(
        (row) =>
          row?.driverNumber === number &&
          Number.isFinite(row.offsetMs) &&
          positiveInteger(row.position) &&
          row.position <= report.results.length,
      )
      .sort((a, b) => a.offsetMs - b.offsetMs);
    const gaps = (timings.intervalTimings ?? [])
      .filter(
        (row) => row?.driverNumber === number && Number.isFinite(row.offsetMs),
      )
      .sort((a, b) => a.offsetMs - b.offsetMs);
    const positionPoints: ReportChartPoint[] = [],
      gapPoints: ReportChartPoint[] = [];
    for (const lap of driverLaps) {
      const end = lap.startOffsetMs + lap.durationMs!;
      const position = sampleAt(positions, end, Infinity);
      const gap = sampleAt(gaps, end, 15_000);
      positionPoints.push({
        lap: lap.lapNumber,
        value: position?.position ?? null,
      });
      gapPoints.push({
        lap: lap.lapNumber,
        value: gapSeconds(gap?.gapToLeader),
      });
    }
    if (!driverLaps.length) {
      // Older replays store timing beside map samples. Use the final actual
      // observation in each lap; never interpolate a missing lap.
      const samples = new Map<
        number,
        NonNullable<ReportTimings["lapSamples"]>[number]
      >();
      for (const sample of timings.lapSamples ?? []) {
        if (
          sample?.driverNumber !== number ||
          !positiveInteger(sample.lapNumber) ||
          !Number.isFinite(sample.offsetMs)
        )
          continue;
        const previous = samples.get(sample.lapNumber);
        if (!previous || previous.offsetMs < sample.offsetMs)
          samples.set(sample.lapNumber, sample);
      }
      for (const [lap, sample] of [...samples].sort(([a], [b]) => a - b)) {
        positionPoints.push({
          lap,
          value:
            positiveInteger(sample.position) &&
            sample.position <= report.results.length
              ? sample.position
              : null,
        });
        const interval = sampleAt(gaps, sample.offsetMs, 15_000);
        gapPoints.push({
          lap,
          value: gapSeconds(
            gaps.length ? interval?.gapToLeader : sample.gapToLeader,
          ),
        });
      }
    }
    const cleanPace = new Map(
      (pace?.points ?? [])
        .filter((point) => point?.driver === number)
        .map((point) => [point.lap, point]),
    );
    // Keep every chronological slot: nulls stop lines at pits, flags and gaps.
    const pacePoints: ReportChartPoint[] = Array.from(
      { length: totalLaps },
      (_, index) => {
        const point = cleanPace.get(index + 1);
        return {
          lap: index + 1,
          value:
            point?.clean && (reportNumber(point.time) ?? 0) > 0
              ? (reportNumber(point.trend) ?? point.time)
              : null,
          stint: point?.stint ?? null,
        };
      },
    );
    const cachedTyres = (pace?.stints ?? [])
      .filter((stint) => stint?.driver === number)
      .map((stint) => ({
        compound: stint.compound,
        startLap: stint.from,
        endLap: stint.to,
      }));
    return [
      {
        number,
        driver: result.driver,
        team: result.team,
        code:
          pace?.drivers.find((driver) => driver?.number === number)?.code ??
          String(number),
        positions: positionPoints,
        gaps: gapPoints,
        pace: pacePoints,
        tyres: cachedTyres?.length ? cachedTyres : (result.tyres ?? []),
      },
    ];
  });
  return { totalLaps, drivers, championship: { drivers: [], teams: [] } };
}

export function reportChartRows(
  drivers: ReportDriverTrace[],
  metric: "positions" | "gaps" | "pace",
  totalLaps: number,
): Array<Record<string, number | null>> {
  const points = drivers.map(
    (driver) => new Map(driver[metric].map((point) => [point.lap, point])),
  );
  return Array.from({ length: totalLaps }, (_, index) => {
    const row: Record<string, number | null> = { lap: index + 1 };
    drivers.forEach((driver, driverIndex) => {
      const point = points[driverIndex].get(index + 1);
      const previous = points[driverIndex].get(index);
      // A new tyre set is a new pace segment, even if both laps look clean.
      row[`driver${driver.number}`] =
        metric === "pace" &&
        previous?.value != null &&
        point?.stint !== previous.stint
          ? null
          : (point?.value ?? null);
    });
    return row;
  });
}
