import { getCircuitAsset, getTeamAsset, getTeamProfileAsset } from "../data/f1-assets.ts";
import { formatGrandPrixNameRu } from "./race-display.ts";
import type { GrandPrixReportAnalytics, ReportChartPoint, ReportStanding } from "./grand-prix-report.ts";
import type {
  GrandPrixReport,
  RaceDetail,
  SessionResult,
  TeamProfileSummary,
  WeekendSession,
} from "../types/racemate.ts";

export type GrandPrixRecapPodiumEntry = {
  avatarPath: string | null;
  driver: string;
  gapToWinner: string | null;
  position: 1 | 2 | 3;
  points: number | null;
  raceTime: string | null;
  team: string;
  teamColor: string;
};

export type GrandPrixRecapHighlight = {
  driver: string;
  label: "Прорыв дня";
  value: string | null;
};

export type GrandPrixRecapSprintEntry = {
  driver: string;
  position: 1 | 2 | 3;
  team: string;
  teamColor: string;
};

export type GrandPrixRecapData = {
  bestTeam: {
    carImagePath: string | null;
    color: string;
    name: string;
    points: number;
    pointsComplete: boolean;
    pointsLabel: string;
  };
  circuitName: string;
  classification: Array<{
    driver: string;
    gap: string | null;
    points: number | null;
    position: number;
    teamColor: string;
  }>;
  championship: ReportStanding[];
  finishers: number | null;
  retirements: number | null;
  starters: number;
  totalLaps: number;
  positionGain: { driver: string; gained: number } | null;
  positionDrivers: Array<{
    code: string;
    color: string;
    driver: string;
    finished: boolean;
    points: ReportChartPoint[];
  }>;
  dateLabel: string;
  fastestLap: {
    driver: string;
    lap: number | null;
    time: string | null;
  } | null;
  fastestPitStop: {
    duration: number;
    team: string;
  } | null;
  hasSprint: boolean;
  heroHighlight: GrandPrixRecapHighlight | null;
  pole: {
    driver: string;
    time: string | null;
  } | null;
  podium: GrandPrixRecapPodiumEntry[];
  raceFlow: {
    redFlags: number;
    safetyCars: number;
    virtualSafetyCars: number;
    yellowFlags: number;
  };
  raceName: string;
  round: number;
  season: number;
  sprintPodium: GrandPrixRecapSprintEntry[] | null;
  strategies: Array<{
    drivers: number;
    sequence: string[];
  }>;
  track: {
    imagePath: string | null;
    svgPath: string | null;
    viewBox: string | null;
  };
  weather: {
    label: string;
    temperatureC: number | null;
  };
};

type GrandPrixRecapInput = {
  race: RaceDetail;
  report: GrandPrixReport;
  resultsBySession: Map<string, SessionResult[]>;
  sessions: WeekendSession[];
  teamProfiles?: TeamProfileSummary[];
  analytics?: GrandPrixReportAnalytics | null;
};

export function getGrandPrixRecapImageLayout(raceName: string) {
  return {
    canvasHeight: 1350,
    heroHeight: 116,
    titleFontSize: raceName.trim().length > 30 ? 36 : 44,
    titleHeight: 54,
    titleLineHeight: 1.05,
    titleMetaMarginTop: 8,
  };
}

export function getGrandPrixRecapStrategyLayout(stopCount: number) {
  const normalizedStopCount = Math.max(1, Math.floor(stopCount));
  const tyreSize = normalizedStopCount <= 3
    ? 44
    : normalizedStopCount === 4
      ? 38
      : normalizedStopCount === 5
        ? 32
        : 28;
  const arrowFontSize = normalizedStopCount <= 3 ? 28 : normalizedStopCount === 4 ? 22 : 16;
  const arrowMargin = normalizedStopCount <= 3 ? 6 : normalizedStopCount === 4 ? 4 : 2;
  const estimatedWidth = 24
    + (normalizedStopCount * tyreSize)
    + ((normalizedStopCount - 1) * ((arrowFontSize * 0.65) + (arrowMargin * 2)))
    + 62;

  return {
    arrowFontSize,
    arrowMargin,
    estimatedWidth,
    tyreSize,
  };
}

export function buildGrandPrixRecapData({
  race,
  report,
  resultsBySession,
  sessions,
  teamProfiles = [],
  analytics = null,
}: GrandPrixRecapInput): GrandPrixRecapData | null {
  const raceResults = getResultsForSessionType(sessions, resultsBySession, "race");

  if (raceResults.length < 3) {
    return null;
  }

  const qualifyingResults = getResultsForSessionType(sessions, resultsBySession, "qualifying");
  const sprintResults = getResultsForSessionType(sessions, resultsBySession, "sprint");
  const hasSprint = sprintResults.length > 0;
  const podium = raceResults
    .filter((result) => result.position !== null && result.position >= 1 && result.position <= 3)
    .sort((left, right) => Number(left.position) - Number(right.position))
    .slice(0, 3)
    .map((result): GrandPrixRecapPodiumEntry => {
      const position = result.position as 1 | 2 | 3;
      const team = getTeamAsset(result.team, race.season);

      return {
        avatarPath: result.driverSlug
          ? `/drivers/avatars/${race.season}/${result.driverSlug}.webp`
          : null,
        driver: result.driver,
        gapToWinner: position === 1 ? null : formatGapToWinner(result.time, result.status),
        position,
        points: validPoints(result.points),
        raceTime: position === 1 ? formatRaceDuration(result.time) : null,
        team: result.team,
        teamColor: result.teamColor ?? team?.color ?? "#E10600",
      };
    });

  if (podium.length < 3) {
    return null;
  }

  const teamPoints = sumWeekendTeamPoints(raceResults, sprintResults);
  const bestTeamEntry = [...teamPoints.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ru"))[0];

  if (!bestTeamEntry) {
    return null;
  }

  const [bestTeamName, bestTeamPoints] = bestTeamEntry;
  const pointsComplete = [...raceResults, ...sprintResults].every((row) => validPoints(row.points) !== null);
  const bestTeamVisual = getTeamAsset(bestTeamName, race.season);
  const bestTeamProfile = getTeamProfileAsset(bestTeamName, race.season);
  const seasonalBestTeamProfile = findTeamProfile(teamProfiles, bestTeamName);
  const poleResult = qualifyingResults.find((result) => result.position === 1) ?? null;
  const breakthrough = getBreakthroughDriver(raceResults);
  const fastestLapHighlight = asHighlight(report.highlights.fastestLap);
  const fastestLapDriver = getString(fastestLapHighlight?.driver);
  const fastestLapTime = getString(fastestLapHighlight?.time);
  const fastestLapResult = fastestLapDriver
    ? findDriverResult(raceResults, fastestLapDriver)
    : [...raceResults].filter((row) => lapSeconds(row.bestLap) !== null)
      .sort((a, b) => lapSeconds(a.bestLap)! - lapSeconds(b.bestLap)!)[0] ?? null;
  const fastestPitStop = buildFastestPitStop(report, raceResults);
  const strategies = buildStrategies(report.strategies, report.highlights.mostCommonStrategy);
  const averageAirTemperature = toNumber(report.weather.averageAirTemperature);
  const rainfall = report.weather.rainfall === true;
  const safetyCars = toNonNegativeInteger(report.raceStatistics.safetyCarCount);
  const virtualSafetyCars = toNonNegativeInteger(report.raceStatistics.virtualSafetyCarCount);
  const redFlags = toNonNegativeInteger(report.raceStatistics.redFlagCount);
  const yellowFlags = toNonNegativeInteger(report.raceStatistics.yellowFlagCount);
  const trackFallback = getCircuitAsset(race.circuit, race.season)?.src ?? null;
  const starters = raceResults.length;
  const finishers = raceResults.every((row) => row.status.trim())
    ? raceResults.filter((row) => isRecapFinisher(row.status)).length
    : null;
  const totalLaps = Math.min(1000, Math.max(
    0,
    toNumber(analytics?.totalLaps) ?? 0,
    toNumber(report.raceStatistics.laps) ?? 0,
    ...raceResults.map((row) => toNumber(row.laps) ?? 0),
  ));
  const teamDriverCounts = new Map<string, number>();
  const positionDrivers = [...raceResults]
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))
    .map((row) => {
      const trace = analytics?.drivers.find((item) => (
        (row.driverNumber != null && item.number === row.driverNumber)
        || normalizeName(item.driver) === normalizeName(row.driver)
      ));
      const teamIndex = teamDriverCounts.get(row.team) ?? 0;
      teamDriverCounts.set(row.team, teamIndex + 1);
      const color = row.teamColor ?? getTeamAsset(row.team, race.season)?.color ?? "#a8a8af";
      return {
        code: trace?.code && /^[A-Z]{3}$/i.test(trace.code)
          ? trace.code.toUpperCase()
          : (row.driverSlug ?? row.driver).split(/[-\s]+/).at(-1)!.slice(0, 3).toUpperCase(),
        color: teamIndex % 2 ? lighterTeamColor(color) : color,
        driver: row.driver,
        finished: isRecapFinisher(row.status),
        points: trace?.positions ?? [],
      };
    });

  return {
    bestTeam: {
      carImagePath: getShareTeamCarImagePath(
        seasonalBestTeamProfile?.carImageUrl ?? bestTeamProfile?.carImageUrl,
        race.season,
      ),
      color: bestTeamVisual?.color ?? "#E10600",
      name: bestTeamName,
      points: bestTeamPoints,
      pointsComplete,
      pointsLabel: hasSprint ? "Гонка + спринт" : "Гонка",
    },
    circuitName: race.circuit,
    classification: raceResults
      .filter((row) => row.position !== null && row.position > 0 && row.position <= 10)
      .sort((a, b) => a.position! - b.position!)
      .map((row) => ({
        driver: row.driver,
        position: row.position!,
        points: validPoints(row.points),
        teamColor: row.teamColor ?? getTeamAsset(row.team, race.season)?.color ?? "#a8a8af",
        gap: row.position === 1 ? null : formatGapToWinner(row.time, row.status),
      })),
    championship: analytics?.championship.drivers.slice(0, 3) ?? [],
    finishers,
    retirements: finishers === null ? null : starters - finishers,
    starters,
    totalLaps: Math.floor(totalLaps),
    positionGain: breakthrough ? { driver: breakthrough.driver, gained: breakthrough.delta } : null,
    positionDrivers,
    dateLabel: formatRaceDate(race.startsAtIso, race.timezone),
    fastestLap: fastestLapResult || fastestLapHighlight
      ? {
          driver: fastestLapDriver ?? fastestLapResult?.driver ?? "Пилот уточняется",
          lap: fastestLapResult?.bestLapNumber ?? null,
          time: fastestLapTime ?? fastestLapResult?.bestLap ?? null,
        }
      : null,
    fastestPitStop,
    hasSprint,
    heroHighlight: breakthrough
      ? {
          driver: breakthrough.driver,
          label: "Прорыв дня",
          value: `+${breakthrough.delta} ${formatPositionGain(breakthrough.delta)} · финиш P${breakthrough.position}`,
        }
      : null,
    pole: poleResult
      ? {
          driver: poleResult.driver,
          time: poleResult.time === "Без времени" ? null : poleResult.time,
        }
      : null,
    podium,
    raceFlow: { redFlags, safetyCars, virtualSafetyCars, yellowFlags },
    raceName: formatGrandPrixNameRu(race.race),
    round: race.round,
    season: race.season,
    sprintPodium: hasSprint ? buildSprintPodium(sprintResults, race.season) : null,
    strategies,
    track: {
      imagePath: getShareTrackImagePath(race.trackMapUrl ?? trackFallback),
      svgPath: race.layout?.svgPath ?? null,
      viewBox: race.layout?.viewBox ?? null,
    },
    weather: {
      label: rainfall ? "Дождь" : "Сухо",
      temperatureC: averageAirTemperature,
    },
  };
}

function getResultsForSessionType(
  sessions: WeekendSession[],
  resultsBySession: Map<string, SessionResult[]>,
  type: "qualifying" | "race" | "sprint",
) {
  const session = sessions.find((item) => item.type === type && item.id);
  return session?.id ? resultsBySession.get(session.id) ?? [] : [];
}

function sumWeekendTeamPoints(raceResults: SessionResult[], sprintResults: SessionResult[]) {
  const totals = new Map<string, number>();

  [...raceResults, ...sprintResults].forEach((result) => {
    const team = result.team.trim();

    if (!team) {
      return;
    }

    totals.set(team, (totals.get(team) ?? 0) + (validPoints(result.points) ?? 0));
  });

  return totals;
}

function getBreakthroughDriver(results: SessionResult[]) {
  return results
    .flatMap((result) => {
      if (!result.position || !result.grid || result.grid <= result.position || !isRecapFinisher(result.status)) {
        return [];
      }

      return [{ delta: result.grid - result.position, driver: result.driver, position: result.position }];
    })
    .sort((left, right) => right.delta - left.delta || left.driver.localeCompare(right.driver, "ru"))[0] ?? null;
}

function buildFastestPitStop(report: GrandPrixReport, raceResults: SessionResult[]) {
  const highlight = asHighlight(report.highlights.fastestPitStop);
  const duration = sanitizeStationaryPitDuration(highlight?.duration);

  const driver = getString(highlight?.driver);
  const team = getString(highlight?.team)
    ?? (driver ? findDriverResult(raceResults, driver)?.team ?? null : null);

  if (!team || duration === null) {
    return null;
  }

  return {
    duration,
    team,
  };
}

export function sanitizeStationaryPitDuration(value: unknown) {
  const duration = toNumber(value);

  // Значения pit/lane duration обычно занимают десятки секунд. В карточке
  // допускается только фактическое время неподвижной машины у механиков.
  return duration !== null && duration > 0 && duration < 10 ? duration : null;
}

function buildSprintPodium(results: SessionResult[], season: number) {
  return results
    .filter((result) => result.position !== null && result.position >= 1 && result.position <= 3)
    .sort((left, right) => Number(left.position) - Number(right.position))
    .slice(0, 3)
    .map((result): GrandPrixRecapSprintEntry => ({
      driver: result.driver,
      position: result.position as 1 | 2 | 3,
      team: result.team,
      teamColor: result.teamColor ?? getTeamAsset(result.team, season)?.color ?? "#E10600",
    }));
}

function buildStrategies(rows: unknown[], fallbackValue: unknown): GrandPrixRecapData["strategies"] {
  const counts = new Map<string, number>();

  rows.forEach((row) => {
    const strategy = asHighlight(row);
    const stints = Array.isArray(strategy?.stints) ? strategy.stints : [];
    const sequence = stints
      .map((stint) => getString(asHighlight(stint)?.compound)?.toUpperCase() ?? null)
      .filter((compound): compound is string => Boolean(compound) && compound !== "UNKNOWN");

    if (!sequence.length) {
      return;
    }

    const key = sequence.join("-");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  const ranked = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 2)
    .map(([sequence, drivers]) => ({ drivers, sequence: sequence.split("-") }));

  if (ranked.length) {
    return ranked;
  }

  const fallback = asHighlight(fallbackValue);
  const sequence = typeof fallback?.sequence === "string"
    ? fallback.sequence.split("-").map((item) => item.trim().toUpperCase()).filter(Boolean)
    : [];
  const drivers = toNonNegativeInteger(fallback?.drivers);

  return sequence.length && drivers > 0 ? [{ drivers, sequence }] : [];
}

function formatGapToWinner(time: string, status: string) {
  const value = time.trim();

  if (value && value !== "Без времени") {
    if (/^\+?\d+(?:[.,]\d+)?$/.test(value)) {
      return `${value.startsWith("+") ? value : `+${value}`} с`.replace(".", ",");
    }

    return value.replace(".", ",");
  }

  const normalizedStatus = status.trim();
  return normalizedStatus && !/classified|finished|финиш|классифиц/i.test(normalizedStatus)
    ? normalizedStatus
    : null;
}

function formatRaceDuration(value: string) {
  const duration = value.trim();

  if (!duration || duration === "Без времени" || duration.startsWith("+")) {
    return null;
  }

  const match = duration.match(/^(\d+):(\d{2}):(\d{2})(?:[.,](\d{3}))?$/);

  if (!match) {
    return duration.replace(/(\d)\.(\d{3})$/, "$1,$2");
  }

  const [, hours, minutes, seconds, milliseconds] = match;
  const secondsLabel = milliseconds ? `${seconds},${milliseconds}` : seconds;

  return `${hours} ч ${minutes} мин ${secondsLabel} с`;
}

function formatPositionGain(value: number) {
  const modulo100 = value % 100;
  const modulo10 = value % 10;

  if (modulo100 >= 11 && modulo100 <= 14) {
    return "позиций";
  }

  if (modulo10 === 1) {
    return "позиция";
  }

  return modulo10 >= 2 && modulo10 <= 4 ? "позиции" : "позиций";
}

function formatRaceDate(value?: string, timezone?: string | null) {
  if (!value) {
    return "Дата уточняется";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: timezone ?? "UTC",
  }).format(new Date(value));
}

function findDriverResult(results: SessionResult[], driver: string) {
  const normalized = normalizeName(driver);
  return results.find((result) => normalizeName(result.driver) === normalized) ?? null;
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .trim();
}

function asHighlight(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getShareTrackImagePath(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const localPath = value.split(/[?#]/, 1)[0];

  return /\.(?:jpe?g|png|webp)$/i.test(localPath) ? localPath : null;
}

function findTeamProfile(profiles: TeamProfileSummary[], teamName: string) {
  const normalizedTeamName = normalizeName(teamName);

  return profiles.find((profile) => (
    [profile.name, profile.shortName, profile.code].some((value) => {
      const normalizedValue = normalizeName(value);
      return normalizedValue === normalizedTeamName
        || normalizedValue.includes(normalizedTeamName)
        || normalizedTeamName.includes(normalizedValue);
    })
  )) ?? null;
}

function getShareTeamCarImagePath(value: string | null | undefined, season: number) {
  if (!value) {
    return null;
  }

  const seasonCarPrefix = `/f1/teams/cars/${season}/`;

  if (value.startsWith(seasonCarPrefix) && /\.webp$/i.test(value)) {
    return value;
  }

  return /\.(?:jpe?g|png|webp)$/i.test(value) ? value : null;
}

function toNumber(value: unknown) {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function validPoints(value: unknown) {
  const number = toNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function lapSeconds(value?: string | null) {
  const match = value?.match(/^(\d+):(\d{2})[.,](\d+)$/);
  return match ? Number(match[1]) * 60 + Number(`${match[2]}.${match[3]}`) : null;
}

function isRecapFinisher(status: string) {
  // Lapped pilots finish with fewer laps than the winner; that is not a DNF.
  return /^(?:finished|classified|lapped|финиш(?:ировал)?|классифицирован|\+\d+\s+laps?)$/i.test(status.trim());
}

function lighterTeamColor(color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(color.slice(offset, offset + 2), 16);
    return Math.round(value + (255 - value) * 0.3).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

function toNonNegativeInteger(value: unknown) {
  const number = toNumber(value);
  return number === null ? 0 : Math.max(0, Math.round(number));
}
