import { getRoundResultPoints } from "../../../lib/f1-points.ts";
import type {
  ChampionshipEntry,
  LiveChampionship,
  LiveSessionState,
} from "./types.ts";

export type ProjectedEntry<T> = T & {
  projectedPosition: number;
  movement: number | null;
  earned: number;
  total: number;
  projectedFinishes: (number | null)[];
};
function rank<T extends ChampionshipEntry>(
  rows: (T & { earned: number; projectedFinishes: (number | null)[] })[],
  countback: boolean,
): ProjectedEntry<T>[] {
  return rows
    .map((row) => ({ ...row, total: row.points + row.earned }))
    .sort((a, b) => {
      if (a.total !== b.total) return b.total - a.total;
      if (countback)
        for (
          let place = 0;
          place <
          Math.max(a.projectedFinishes.length, b.projectedFinishes.length);
          place++
        ) {
          const difference =
            (b.projectedFinishes[place] ?? 0) -
            (a.projectedFinishes[place] ?? 0);
          if (difference) return difference;
        }
      // Exact ties are unresolved by race results; preserve the official order.
      return (
        (a.position ?? Infinity) - (b.position ?? Infinity) ||
        a.id.localeCompare(b.id)
      );
    })
    .map((row, index) => ({
      ...row,
      projectedPosition: index + 1,
      movement: row.position === null ? null : row.position - index - 1,
    }));
}

export function projectChampionship(
  base: LiveChampionship,
  state: Pick<LiveSessionState, "drivers" | "status" | "currentLap">,
  mode: string,
) {
  const racing = mode === "race" || mode === "sprint";
  const finalized =
    racing && state.status === "finished" && Boolean(base.results?.length);
  const finalByDriver = new Map(
    (finalized ? (base.results ?? []) : []).map((row) => [row.driverId, row]),
  );
  const started =
    racing &&
    ["live", "paused", "finished"].includes(state.status) &&
    (state.currentLap > 0 || finalized);
  const liveDrivers = Object.values(state.drivers);
  const positions = new Map<number, number>();
  for (const driver of liveDrivers)
    if (driver.position !== null)
      positions.set(driver.position, (positions.get(driver.position) ?? 0) + 1);
  const teams = new Map(
    base.teams.map((team) => [
      team.id,
      {
        ...team,
        earned: 0,
        projectedFinishes: [...team.finishes],
        contributors: [] as { acronym: string; earned: number }[],
      },
    ]),
  );
  let missingDrivers = false;
  const drivers = base.drivers.map((entry) => {
    // Champion's racing number may change to/from 1. The season's acronym is
    // the stable primary match; a number is only safe when no acronym exists.
    const candidates = liveDrivers.filter((driver) =>
      entry.acronym
        ? driver.acronym === entry.acronym
        : driver.driverNumber === entry.driverNumber,
    );
    const driver = candidates.length === 1 ? candidates[0] : undefined;
    const result = finalByDriver.get(entry.id);
    const racePosition = result ? result.position : (driver?.position ?? null);
    const out =
      driver && ["DNF", "DNS", "DSQ", "RETIRED"].includes(driver.status);
    const official =
      result && Number.isFinite(result.points) && result.points >= 0
        ? result.points
        : null;
    const validPosition =
      racePosition !== null &&
      Number.isInteger(racePosition) &&
      racePosition > 0 &&
      (official !== null || positions.get(racePosition) === 1);
    const sessionEarned = !started
      ? 0
      : (official ??
        (validPosition && !out
          ? (getRoundResultPoints(null, mode, racePosition) ?? 0)
          : 0));
    const sprint =
      mode === "sprint"
        ? 0
        : base.sprint.points
            .filter((row) => row.driverId === entry.id)
            .reduce((sum, row) => sum + row.points, 0);
    const earned = sessionEarned + sprint;
    const projectedFinishes = [...entry.finishes];
    if (
      started &&
      mode === "race" &&
      validPosition &&
      (!out || official !== null)
    ) {
      projectedFinishes[racePosition - 1] =
        (projectedFinishes[racePosition - 1] ?? 0) + 1;
      const teamId = result?.teamId ?? entry.teamId;
      const team = teamId ? teams.get(teamId) : null;
      if (team)
        team.projectedFinishes[racePosition - 1] =
          (team.projectedFinishes[racePosition - 1] ?? 0) + 1;
    }
    if (driver && started && !validPosition && official === null && !out)
      missingDrivers = true;
    const teamId = result?.teamId ?? entry.teamId;
    if (teamId) {
      const team = teams.get(teamId);
      if (team) {
        // Sprint points belong to the constructor used in that session, even
        // if a driver changes teams before the race.
        team.earned += sessionEarned;
        if (driver || earned > 0)
          team.contributors.push({ acronym: entry.acronym, earned });
      }
    }
    return {
      ...entry,
      earned,
      projectedFinishes,
      racePosition: driver || result ? racePosition : null,
      liveNumber: driver?.driverNumber ?? null,
      sessionEarned,
      sprint,
      colour:
        driver?.teamColour ??
        (entry.teamId ? teams.get(entry.teamId)?.colour : null) ??
        "#a1a1aa",
    };
  });
  if (mode !== "sprint")
    for (const row of base.sprint.points) {
      const team = row.teamId ? teams.get(row.teamId) : null;
      if (team) team.earned += row.points;
    }
  // Never silently omit a live entrant that the cache couldn't identify.
  if (
    liveDrivers.some(
      (driver) =>
        !drivers.some((entry) => entry.liveNumber === driver.driverNumber),
    )
  )
    missingDrivers = true;
  return {
    drivers: rank(drivers, base.countbackComplete),
    teams: rank([...teams.values()], base.countbackComplete),
    racing,
    finalized,
    started,
    missingDrivers,
    sprintPending: mode !== "sprint" && base.sprint.status === "pending",
  };
}
