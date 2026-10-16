import type {
  CompareConfig,
  Comparison,
  Lap,
  Point,
  Track,
  Driver,
  Session,
  NormalizedLap,
  Metric,
  Insight,
  Corner,
  CornerMetric,
} from "./types";
export const VERSION: string;
export const CHANNELS: readonly [
  "speed",
  "throttle",
  "brake",
  "gear",
  "rpm",
  "drs",
];
export const SOURCE: { provider: string; url: string; license: string };
export function numeric(v: unknown): number | null;
export function parseConfig(input: unknown): CompareConfig;
export function bestLap(laps: Lap[]): Lap | null;
export function bestLapCandidates(laps: Lap[]): Lap[];
export function raceAverageLaps(laps: Lap[]): Lap[];
export function drsValue(value: unknown): number | null;
export function cleanSamples(rows: Record<string, unknown>[]): Point[];
export function interpolate(
  points: Point[],
  distance: number,
  field: keyof Point,
  maxGapSeconds?: number,
): number | null;
export function normalizeLap(input: {
  lap: Lap;
  driver: Driver;
  session: Session;
  samples: Record<string, unknown>[];
  locations?: Record<string, unknown>[];
  track: Track;
  datasetId?: string;
}): NormalizedLap;
export function averageNormalizedLaps(
  traces: NormalizedLap[],
  track: Track,
): NormalizedLap;
export function detectEvents(
  points: Point[],
  channel: string,
  threshold: number,
  minSeconds?: number,
  minDistance?: number,
): { start: number; end: number }[];
export function calculateMetrics(points: Point[], lapTime: number): Metric;
export function cornerMetrics(points: Point[], corner: Corner): CornerMetric;
export function alignLapToSectorTiming(trace: NormalizedLap, track: Track): NormalizedLap | null;
export function rebuildComparisonTiming(comparison: Comparison): Comparison;
export function buildComparison(
  traces: NormalizedLap[],
  track: Track,
  config: CompareConfig,
): Comparison;
export function buildInsights(comparison: Comparison): Insight[];
export function resampleComparison(
  comparison: Comparison,
  options?: { from?: number; to?: number; points?: number },
): Comparison;
