import type { RacePace, RacePacePoint, RacePaceReason } from "./types";

export type PaceAxis = "lap" | "age";
export type PaceSection = "trend" | "distribution";
export type PaceDistributionScope = "field" | "selected";
export type PaceLapRange = [number, number];
export type PaceFilters = { hidePits: boolean; hideSafetyCar: boolean; lapRange?: PaceLapRange };

export function parsePaceLapRange(from?: string | null, to?: string | null): PaceLapRange | undefined {
  if (!from || !to) return undefined;
  const values = [Number(from), Number(to)];
  return values.every((value) => Number.isSafeInteger(value) && value > 0 && value <= 1_000_000)
    ? [Math.min(...values), Math.max(...values)] : undefined;
}

export function paceLapRange(totalLaps: number, range?: PaceLapRange): PaceLapRange {
  const last = Number.isSafeInteger(totalLaps) && totalLaps > 0 ? totalLaps : 1;
  if (!range || !range.every((value) => Number.isSafeInteger(value))) return [1, last];
  const values = range.map((value) => Math.max(1, Math.min(last, value)));
  return [Math.min(...values), Math.max(...values)];
}
const alwaysExcluded: RacePaceReason[] = [
  "RED",
  "START",
  "DELETED",
  "INCOMPLETE",
  "PIT_IN",
  "PIT_OUT",
];
export const paceCompounds = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"] as const;
export const compoundColors: Record<string, string> = {
  SOFT: "#ed1c24", MEDIUM: "#ffd21c", HARD: "#f4f4f4",
  INTERMEDIATE: "#37b34a", WET: "#2d80e8", UNKNOWN: "#98a4b3",
};
export function paceValue(point: RacePacePoint, smooth: boolean) {
  return smooth ? point.trend ?? point.time : point.time;
}
export function selectedCompounds(value?: string | string[]): string[] {
  if (Array.isArray(value)) return [...new Set(value.filter((item) => Object.hasOwn(compoundColors, item)))];
  return value && value !== "ALL" ? selectedCompounds(value.split(",")) : [...paceCompounds, "UNKNOWN"];
}
export function togglePaceCompound(compounds: string[], compound: typeof paceCompounds[number]) {
  // Unknown tyres belong to the all-tyres preset, not an individual compound.
  const known = compounds.filter((value) => value !== "UNKNOWN");
  return known.includes(compound) ? known.filter((value) => value !== compound) : [...known, compound];
}
export const isPaceLap = (point: RacePacePoint) =>
  point.time != null &&
  Number.isFinite(point.time) &&
  point.time > 0 &&
  !point.reasons.some((reason) => alwaysExcluded.includes(reason));
export const compoundLabels: Record<string, string> = {
  ALL: "Все шины",
  SOFT: "Soft",
  MEDIUM: "Medium",
  HARD: "Hard",
  INTERMEDIATE: "Intermediate",
  WET: "Wet",
  UNKNOWN: "Без данных",
};
export const paceReasonLabels: Record<RacePaceReason, string> = {
  START: "Стартовый круг",
  PIT_IN: "Заезд в боксы",
  PIT_OUT: "Выезд из боксов",
  DELETED: "Круг удалён",
  INCOMPLETE: "Круг не завершён",
  UNKNOWN_CONTROL: "Нет данных о флагах",
  RED: "Красный флаг",
  SC: "Машина безопасности",
  VSC: "Виртуальная машина безопасности",
  YELLOW: "Жёлтый флаг",
};
export type PaceSeries = {
  key: string;
  driver: number;
  stint: number | null;
  points: (RacePacePoint & { x: number })[];
};
export function paceShareCompounds(compounds: string[]) {
  const selected = selectedCompounds(compounds);
  return selectedCompounds("ALL").every((compound) => selected.includes(compound)) ? ["ALL"] : selected;
}
export function paceSeries(
  data: RacePace,
  axis: PaceAxis,
  compound: string | string[],
  filters: PaceFilters,
): PaceSeries[] {
  const series: PaceSeries[] = [];
  const compounds = selectedCompounds(compound);
  const range = filters.lapRange && paceLapRange(data.totalLaps, filters.lapRange);
  for (const driver of data.drivers) {
    let segment: PaceSeries | undefined;
    for (const point of data.points.filter((p) => p.driver === driver.number)) {
      const x = axis === "age" ? point.tyreAge : point.lap;
      if (
        !isPaceLap(point) ||
        (range && (point.lap < range[0] || point.lap > range[1])) ||
        x == null ||
        (filters.hideSafetyCar &&
          point.reasons.some(
            (reason) => reason === "SC" || reason === "VSC",
          )) ||
        !compounds.includes(point.compound)
      ) {
        segment = undefined;
        continue;
      }
      const previous = segment?.points.at(-1);
      if (
        !segment ||
        previous?.lap !== point.lap - 1 ||
        segment.stint !== point.stint ||
        previous.compound !== point.compound ||
        (axis === "age" && x <= previous.x)
      ) {
        segment = {
          key: `${driver.number}-${point.lap}`,
          driver: driver.number,
          stint: point.stint,
          points: [],
        };
        series.push(segment);
      }
      segment.points.push({ ...point, x, trend: null });
    }
  }
  // Recompute from the filtered, contiguous series. Never average a pit lap or
  // mix neutralised pace with racing pace, even when those laps are shown.
  for (const segment of series) {
    for (let index = 1; index < segment.points.length - 1; index++) {
      const trio = segment.points.slice(index - 1, index + 2);
      if (trio.every((point) => point.clean))
        segment.points[index].trend = trio
          .map((point) => point.time!)
          .sort((a, b) => a - b)[1];
    }
  }
  return series;
}

export type PaceDistribution = {
  driver: RacePace["drivers"][number];
  points: RacePacePoint[];
  count: number;
  mean: number;
  median: number;
  deviation: number;
  q1: number;
  q3: number;
  low: number;
  high: number;
  outliers: { lap: number; time: number }[];
};

// Linear percentiles (Hyndman–Fan type 7), including single-lap selections.
function paceQuantile(sorted: number[], probability: number) {
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index), fraction = index - lower;
  return sorted[lower] + fraction * (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]);
}

export function paceDistribution(
  data: RacePace,
  compounds: string | string[],
  filters: PaceFilters,
  drivers?: number[],
): PaceDistribution[] {
  // Statistics use measured times on chronological laps, including unknown tyre
  // ages. Smoothing and the chart's chosen x axis never change this population.
  const points = paceSeries(data, "lap", compounds, filters).flatMap((series) => series.points);
  return data.drivers.filter((driver) => !drivers || drivers.includes(driver.number))
    .flatMap((driver) => {
      const laps = points.filter((point) => point.driver === driver.number);
      if (!laps.length) return [];
      const times = laps.map((point) => point.time!).sort((a, b) => a - b);
      const mean = times.reduce((sum, time) => sum + time, 0) / times.length;
      const q1 = paceQuantile(times, 0.25), q3 = paceQuantile(times, 0.75);
      const iqr = q3 - q1, lowFence = q1 - 1.5 * iqr, highFence = q3 + 1.5 * iqr;
      const inliers = times.filter((time) => time >= lowFence && time <= highFence);
      return [{
        driver, points: laps, count: times.length, mean, q1, q3,
        median: paceQuantile(times, 0.5),
        // Descriptive spread of every included lap, not an estimate of a population.
        deviation: Math.sqrt(times.reduce((sum, time) => sum + (time - mean) ** 2, 0) / times.length),
        low: inliers[0], high: inliers.at(-1)!,
        // Outliers remain part of the mean, median, deviation and CSV.
        outliers: laps.filter((point) => point.time! < lowFence || point.time! > highFence)
          .map((point) => ({ lap: point.lap, time: point.time! })),
      }];
    }).sort((a, b) => a.median - b.median || a.driver.code.localeCompare(b.driver.code) || a.driver.number - b.driver.number);
}

export function paceDistributionDomain(rows: PaceDistribution[]): [number, number] {
  const times = rows.flatMap((row) => [row.low, row.high, ...row.outliers.map((point) => point.time)]);
  return times.length ? [Math.floor(Math.min(...times) - 0.5), Math.ceil(Math.max(...times) + 0.5)] : [0, 1];
}

export function paceDistributionCsv(rows: PaceDistribution[]) {
  const header = "Пилот,Круги,Среднее (с),Медиана (с),Разброс (с),25% (с),75% (с),Нижний ус (с),Верхний ус (с),Необычные круги";
  return "\uFEFF" + [header, ...rows.map((row) => [row.driver.code, row.count, row.mean, row.median,
    row.deviation, row.q1, row.q3, row.low, row.high, row.outliers.length].map(paceCsvCell).join(","))].join("\r\n");
}

export function paceShareUrl(
  origin: string,
  session: RacePace["session"],
  view: {
    axis: PaceAxis;
    compound: string;
    drivers: number[];
    hidePits: boolean;
    hideSafetyCar: boolean;
    trend: boolean;
    field: boolean;
    lapRange?: PaceLapRange;
    section?: PaceSection;
    distributionScope?: PaceDistributionScope;
  },
) {
  const url = new URL("/telemetry", origin);
  const params = {
    mode: "race-pace",
    season: session.season,
    meeting: session.meetingId,
    session: session.id,
    axis: view.axis,
    compound: view.compound,
    drivers: view.drivers.join(","),
    pits: Number(view.hidePits),
    safety: Number(view.hideSafetyCar),
    trend: Number(view.trend),
    field: Number(view.field),
  };
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, String(value));
  if (view.section === "distribution") {
    url.searchParams.set("view", "distribution");
    url.searchParams.set("scope", view.distributionScope ?? "field");
  }
  if (view.lapRange) {
    url.searchParams.set("from", String(view.lapRange[0]));
    url.searchParams.set("to", String(view.lapRange[1]));
  }
  return url.toString();
}

function paceCsvCell(value: unknown) {
    const text = String(value ?? "");
    const safe =
      typeof value === "string" && /^[=+@\-\t\r]/.test(text)
        ? `'${text}`
        : text;
    return `"${safe.replaceAll('"', '""')}"`;
}
export function paceCsv(
  points: RacePacePoint[],
  drivers: RacePace["drivers"],
): string {
  const rows = points
    .filter(isPaceLap)
    .map((point) =>
      [
        drivers.find((driver) => driver.number === point.driver)?.code ??
          point.driver,
        point.lap,
        point.time,
        point.compound,
        point.tyreAge,
        point.stint,
        point.clean ? "да" : "нет",
        point.reasons.map((reason) => paceReasonLabels[reason]).join("; "),
        point.trend,
      ]
        .map(paceCsvCell)
        .join(","),
    );
  return (
    "\uFEFFПилот,Круг,Время (с),Шины,Возраст шин,Комплект,Чистый круг,Причины,Медиана (с)\r\n" +
    rows.join("\r\n")
  );
}
