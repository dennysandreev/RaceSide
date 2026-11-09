import type {
  DriverDirectoryDriver,
  DriverRoundSnapshot,
  DriverStageResult,
} from "@/types/racemate";

export type DriverComparisonRaceInput = {
  round: number;
  raceName: string;
  participated: boolean;
  qualifyingPosition: number | null;
  sprintPosition: number | null;
  sprintPoints: number;
  startPosition: number | null;
  finishPosition: number | null;
  fastestLapTime: string | null;
  racePoints: number;
  status: string | null;
  isDnf: boolean;
  hasFastestLap: boolean;
};

export type DriverComparisonStandingInput = {
  round: number;
  position: number | null;
  points: number;
  wins: number;
};

export type ComparisonMetricKey = Exclude<
  keyof DriverRoundSnapshot,
  "round" | "stage" | "starts"
>;

export const driverComparisonMetrics: Array<{
  key: ComparisonMetricKey;
  label: string;
  format?: "decimal" | "position";
}> = [
  { key: "championshipPosition", label: "Место в чемпионате", format: "position" },
  { key: "points", label: "Очки", format: "decimal" },
  { key: "wins", label: "Победы" },
  { key: "podiums", label: "Подиумы" },
  { key: "poles", label: "Поулы" },
  { key: "fastestLaps", label: "Быстрые круги" },
  { key: "q3Appearances", label: "Выходы в Q3" },
  { key: "pointsFinishes", label: "Финиши в очках" },
  { key: "dnfs", label: "Сходы" },
  { key: "averageStart", label: "Средний старт", format: "decimal" },
  { key: "averageFinish", label: "Средний финиш", format: "decimal" },
  { key: "positionsGained", label: "Отыгранные позиции" },
];

export const comparisonMetricDirections: Record<
  ComparisonMetricKey,
  "higher" | "lower"
> = {
  championshipPosition: "lower",
  points: "higher",
  wins: "higher",
  podiums: "higher",
  poles: "higher",
  fastestLaps: "higher",
  q3Appearances: "higher",
  pointsFinishes: "higher",
  dnfs: "lower",
  averageStart: "lower",
  averageFinish: "lower",
  positionsGained: "higher",
};

const DRIVER_COMPARISON_SHARE_VERSION = "s2";

export function createDriverComparisonShareCode(
  season: number,
  round: number,
  leftKey?: string | null,
  rightKey?: string | null,
) {
  const normalizedLeft = normalizeDriverShareKey(leftKey);
  const normalizedRight = normalizeDriverShareKey(rightKey);

  if (
    !Number.isInteger(season)
    || season < 2000
    || season > 2099
    || !Number.isInteger(round)
    || round < 1
    || round > 99
    || !normalizedLeft
    || !normalizedRight
    || normalizedLeft === normalizedRight
  ) {
    return null;
  }

  return `${DRIVER_COMPARISON_SHARE_VERSION}-${String(season).slice(-2)}-${round}-${normalizedLeft}-${normalizedRight}`;
}

export function parseDriverComparisonShareCode(value?: string | null) {
  const match = /^(?:s2-)?(\d{2})-(\d{1,2})-([A-Z0-9]{1,4})-([A-Z0-9]{1,4})$/i.exec(
    value?.trim() ?? "",
  );

  if (!match) {
    return null;
  }

  const season = 2000 + Number(match[1]);
  const round = Number(match[2]);
  const leftKey = match[3].toUpperCase();
  const rightKey = match[4].toUpperCase();

  if (round < 1 || leftKey === rightKey) {
    return null;
  }

  return { leftKey, rightKey, round, season };
}

export function normalizeDriverComparisonSlug(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[a-z0-9-]+$/.test(normalized) ? normalized : undefined;
}

function normalizeDriverShareKey(value?: string | null) {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z0-9]{1,4}$/.test(normalized) ? normalized : null;
}

export function resolveDriverComparisonRound(
  value: string | undefined,
  latestCompletedRound: number,
) {
  if (latestCompletedRound <= 0) {
    return 0;
  }

  if (!value || !/^\d+$/.test(value)) {
    return latestCompletedRound;
  }

  return Math.max(1, Math.min(latestCompletedRound, Number(value)));
}

export function resolveDriverComparisonSelection(
  left: string | undefined,
  right: string | undefined,
  availableSlugs: string[],
) {
  const available = new Set(availableSlugs);
  const resolvedLeft = left && available.has(left) ? left : undefined;
  const resolvedRight = right && right !== resolvedLeft && available.has(right)
    ? right
    : undefined;

  return { left: resolvedLeft, right: resolvedRight };
}

export function rankDirectoryDrivers(drivers: DriverDirectoryDriver[]) {
  return [...drivers]
    .sort((left, right) =>
      right.starts - left.starts ||
      (left.championshipPosition ?? Number.MAX_SAFE_INTEGER) -
        (right.championshipPosition ?? Number.MAX_SAFE_INTEGER) ||
      left.fullName.localeCompare(right.fullName, "ru"),
    )
    .map((driver, index) => ({ ...driver, isPrimary: index < 2 }));
}

export function buildDriverRoundSnapshots(
  races: DriverComparisonRaceInput[],
  standings: DriverComparisonStandingInput[],
  latestCompletedRound: number,
): DriverRoundSnapshot[] {
  const standingByRound = new Map(
    standings
      .filter((standing) => standing.round > 0)
      .map((standing) => [standing.round, standing]),
  );
  const sortedRaces = [...races]
    .filter((race) => race.round > 0 && race.round <= latestCompletedRound)
    .sort((left, right) => left.round - right.round);
  const snapshots: DriverRoundSnapshot[] = [];
  const startPositions: number[] = [];
  const finishPositions: number[] = [];
  let points = 0;
  let wins = 0;
  let podiums = 0;
  let poles = 0;
  let fastestLaps = 0;
  let q3Appearances = 0;
  let pointsFinishes = 0;
  let dnfs = 0;
  let positionsGained = 0;
  let starts = 0;
  let lastStanding: DriverComparisonStandingInput | null = null;

  sortedRaces.forEach((race) => {
    const roundPoints = race.sprintPoints + race.racePoints;
    const hasRaceStart = race.startPosition !== null || race.finishPosition !== null || race.isDnf;

    if (race.participated) {
      points += roundPoints;
      poles += race.qualifyingPosition === 1 ? 1 : 0;
      q3Appearances += race.qualifyingPosition !== null && race.qualifyingPosition <= 10 ? 1 : 0;
      fastestLaps += race.hasFastestLap ? 1 : 0;
    }

    if (hasRaceStart) {
      starts += 1;
      dnfs += race.isDnf ? 1 : 0;
      pointsFinishes += race.racePoints > 0 ? 1 : 0;
      wins += race.finishPosition === 1 ? 1 : 0;
      podiums += race.finishPosition !== null && race.finishPosition <= 3 ? 1 : 0;

      if (race.startPosition !== null) {
        startPositions.push(race.startPosition);
      }

      if (race.finishPosition !== null) {
        finishPositions.push(race.finishPosition);

        if (race.startPosition !== null) {
          positionsGained += race.startPosition - race.finishPosition;
        }
      }
    }

    const standing = standingByRound.get(race.round);

    if (standing) {
      // Official corrections may reduce totals; newer results extend this baseline.
      points = standing.points;
      wins = standing.wins;
      lastStanding = standing;
    }

    snapshots.push({
      round: race.round,
      championshipPosition: lastStanding?.position ?? null,
      points,
      wins,
      podiums,
      poles,
      fastestLaps,
      q3Appearances,
      pointsFinishes,
      dnfs,
      averageStart: average(startPositions),
      averageFinish: average(finishPositions),
      positionsGained,
      starts,
      stage: toStageResult(race, roundPoints),
    });
  });

  return snapshots;
}

export function compareDriverSnapshots(
  left: DriverRoundSnapshot | null,
  right: DriverRoundSnapshot | null,
) {
  const result: Partial<Record<ComparisonMetricKey, "left" | "right" | "tie">> = {};
  let leftScore = 0;
  let rightScore = 0;

  if (!left || !right) {
    return { leftScore, rightScore, result };
  }

  for (const key of Object.keys(comparisonMetricDirections) as ComparisonMetricKey[]) {
    const leftValue = left[key];
    const rightValue = right[key];

    if (leftValue === null || rightValue === null || leftValue === rightValue) {
      result[key] = "tie";
      continue;
    }

    const direction = comparisonMetricDirections[key];
    const leftWins = direction === "higher"
      ? leftValue > rightValue
      : leftValue < rightValue;

    result[key] = leftWins ? "left" : "right";
    leftScore += leftWins ? 1 : 0;
    rightScore += leftWins ? 0 : 1;
  }

  return { leftScore, rightScore, result };
}

function toStageResult(
  race: DriverComparisonRaceInput,
  points: number,
): DriverStageResult {
  return {
    round: race.round,
    raceName: race.raceName,
    participated: race.participated,
    qualifyingPosition: race.qualifyingPosition,
    sprintPosition: race.sprintPosition,
    sprintPoints: race.sprintPoints,
    startPosition: race.startPosition,
    finishPosition: race.finishPosition,
    fastestLapTime: race.fastestLapTime,
    points,
    status: race.status,
    isDnf: race.isDnf,
  };
}

function average(values: number[]) {
  if (!values.length) {
    return null;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}
