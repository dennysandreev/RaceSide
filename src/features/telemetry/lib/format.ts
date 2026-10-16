import type { Channel, Comparison, Lap } from "./types";
// Only allow hex colors here: share graphics embed the value into SVG markup.
export function teamColor(driver?: { color?: string | null } | null) {
  const hex = driver?.color?.trim().replace(/^#/, "");
  return hex && /^[0-9a-f]{6}$/i.test(hex)
    ? `#${hex.toLowerCase()}`
    : "#b9c1cc";
}
export function getTraceColors(comparison: Comparison) {
  const colors = comparison.traces.map((trace) => teamColor(trace.driver));
  if (comparison.traces.length < 2) return colors;
  const [first, second] = comparison.traces;
  const sameDriver =
    Boolean(first.driver.id && second.driver.id) &&
    first.driver.id === second.driver.id;
  const sameTeam =
    Boolean(first.driver.team && second.driver.team) &&
    first.driver.team.toLocaleLowerCase() ===
      second.driver.team.toLocaleLowerCase();
  if (sameDriver || sameTeam || colors[0] === colors[1]) colors[1] = "#9aa1ad";
  return colors;
}
export const channelLabels: Record<Channel | "delta", string> = {
  delta: "Разница времени",
  speed: "Скорость",
  throttle: "Газ",
  brake: "Торможение",
  gear: "Передача",
  rpm: "Обороты",
};
export const units: Record<Channel | "delta", string> = {
  delta: "с",
  speed: "км/ч",
  throttle: "%",
  brake: "",
  gear: "",
  rpm: "об/мин",
};
export function lapTime(value: number | null) {
  if (value == null) return "—";
  return `${Math.floor(value / 60)}:${(value % 60).toFixed(3).padStart(6, "0")}`;
}
function lapWord(value: number) {
  const mod100 = value % 100,
    mod10 = value % 10;
  if (mod100 >= 11 && mod100 <= 14) return "кругов";
  if (mod10 === 1) return "круг";
  if (mod10 >= 2 && mod10 <= 4) return "круга";
  return "кругов";
}
export function lapLabel(lap: Lap) {
  return lap.kind === "race_average"
    ? `Средний темп · ${lap.sampleCount ?? 0} ${lapWord(lap.sampleCount ?? 0)}`
    : `Круг ${lap.number}`;
}
export function lapDetail(lap: Lap) {
  if (lap.kind !== "race_average")
    return `${lap.compound ?? "Шины неизвестны"}${lap.tyreAge != null ? ` · ${lap.tyreAge} круг.` : ""}`;
  const count = lap.sampleCount ?? 0,
    singular = count % 10 === 1 && count % 100 !== 11;
  return `Среднее по ${count} ${singular ? "гоночному кругу" : "гоночным кругам"}`;
}
export function compactLapLabel(lap: Lap) {
  return lap.kind === "race_average"
    ? `СРЕДНИЙ · ${lap.sampleCount ?? 0} КР.`
    : `L${lap.number}`;
}
export function number(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString("ru-RU", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
}
export function deltaTime(value: number | null | undefined) {
  return value == null ? "—" : `${value > 0 ? "+" : ""}${number(value, 3)}`;
}
// Comparison data stores opponent time minus reference time. On the graph a
// negative value means the reference driver is ahead by that many seconds.
export function displayedDelta(value: number | null | undefined) {
  return value == null ? null : value === 0 ? 0 : -value;
}
export function sessionName(name: string) {
  return (
    (
      {
        "Practice 1": "Практика 1",
        "Practice 2": "Практика 2",
        "Practice 3": "Практика 3",
        Qualifying: "Квалификация",
        Race: "Гонка",
        Sprint: "Спринт",
        "Sprint Qualifying": "Квалификация спринта",
        "Sprint Shootout": "Квалификация спринта",
      } as Record<string, string>
    )[name] ?? name
  );
}
export const qualityMessages: Record<string, string> = {
  UNKNOWN_TRACK_STATUS:
    "Состояние трассы для этого круга не подтверждено источником.",
  ESTIMATED_DISTANCE:
    "Дистанция восстановлена по скорости: положение событий приблизительное.",
  ESTIMATED_TRACK:
    "Границы поворотов ориентировочные. Разметка помогает сопоставить участки.",
  DISTANCE_SCALE: "Восстановленная длина заметно отличается от длины трассы.",
  TELEMETRY_GAPS:
    "В телеметрии есть пропуски. На графиках они оставлены разрывами.",
  BEST_AVAILABLE_LAP: "Выбран лучший круг с доступной телеметрией.",
  MISSING_BOUNDARY: "Не хватает отсчётов у старта или финиша.",
  RACE_AVERAGE:
    "Профиль рассчитан по чистым гоночным кругам без заездов в боксы и выездных кругов.",
};

export function sectorGapRows(comparison: Comparison) {
  const reference = comparison.config.reference ?? 0;
  const opponent = comparison.traces.findIndex(
    (_, index) => index !== reference,
  );
  const count = Math.max(
    comparison.sectorDelta.length,
    ...comparison.traces.map((trace) => trace.lap.sectors.length),
  );
  return Array.from({ length: count }, (_, index) => {
    const referenceTime = comparison.traces[reference]?.lap.sectors[index];
    const opponentTime = comparison.traces[opponent]?.lap.sectors[index];
    const officialTimingAvailable =
      referenceTime != null &&
      referenceTime > 0 &&
      Number.isFinite(referenceTime) &&
      opponentTime != null &&
      opponentTime > 0 &&
      Number.isFinite(opponentTime);
    const rawDelta = officialTimingAvailable
      ? opponentTime - referenceTime
      : null;
    const delta =
      rawDelta == null || !Number.isFinite(rawDelta)
        ? null
        : Math.round(rawDelta * 1_000_000) / 1_000_000;
    return {
      index,
      delta,
      winner: delta == null ? null : delta >= 0 ? reference : opponent,
    };
  });
}

export function lapAnalysisRows(comparison: Comparison) {
  type Trace = Comparison["traces"][number];
  type Rank = "higher" | "lower" | null;
  const metrics: [
    string,
    string | null,
    (trace: Trace) => number | null | undefined,
    number,
    string,
    Rank,
  ][] = [
    [
      "Максимальная скорость",
      null,
      (t) => t.metrics.topSpeed,
      0,
      "км/ч",
      "higher",
    ],
    [
      "Средняя скорость",
      null,
      (t) => t.metrics.averageSpeed,
      1,
      "км/ч",
      "higher",
    ],
    [
      "Полный газ",
      null,
      (t) => t.metrics.fullThrottle,
      1,
      "% времени",
      "higher",
    ],
    [
      "Путь под торможением",
      "Сумма участков, где тормоз нажат больше чем наполовину",
      (t) => t.metrics.brakingDistance,
      0,
      "м",
      null,
    ],
    ["Первое торможение", null, (t) => t.metrics.earliestBraking, 0, "м", null],
    [
      "Последнее торможение",
      null,
      (t) => t.metrics.latestBraking,
      0,
      "м",
      null,
    ],
    ...[0, 1, 2].map(
      (
        sector,
      ): [
        string,
        null,
        (trace: Trace) => number | null | undefined,
        number,
        string,
        Rank,
      ] => [
        `Сектор ${sector + 1}`,
        null,
        (t) => t.lap.sectors[sector],
        3,
        "с",
        "lower",
      ],
    ),
  ];
  return metrics.map(([label, description, read, digits, unit, rank]) => {
    const raw = comparison.traces.map(read);
    const available = raw.filter(
      (value): value is number => value != null && Number.isFinite(value),
    );
    const bestValue =
      !rank || !available.length
        ? null
        : rank === "higher"
          ? Math.max(...available)
          : Math.min(...available);
    return {
      label,
      description,
      values: raw.map((amount) =>
        amount == null || !Number.isFinite(amount)
          ? "—"
          : `${number(amount, digits)} ${unit}`,
      ),
      best: raw.map((amount) => bestValue != null && amount === bestValue),
    };
  });
}

export function gearAnalysisRows(comparison: Comparison) {
  return Object.keys(comparison.traces[0]?.metrics.gearUsage ?? {})
    .filter((gear) => gear !== "0")
    .sort((a, b) => Number(a) - Number(b))
    .map((gear) => {
      const raw = comparison.traces.map(
        (trace) => trace.metrics.gearUsage[gear],
      );
      const available = raw.filter(
        (value): value is number => value != null && Number.isFinite(value),
      );
      const largest = available.length ? Math.max(...available) : null;
      return {
        gear,
        values: raw.map((value) => `${number(value)}%`),
        best: raw.map((value) => largest != null && value === largest),
      };
    });
}
