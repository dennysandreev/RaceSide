import type { CircuitGrandPrixHistoryRow } from "../types/racemate.ts";

export function circuitRaceCount(count: number) {
  const lastTwo = count % 100;
  const last = count % 10;
  const noun = lastTwo >= 11 && lastTwo <= 14
    ? "гонок"
    : last === 1 ? "гонка" : last >= 2 && last <= 4 ? "гонки" : "гонок";
  return `${count} ${noun}`;
}

export function circuitSeasonRange(from: number | null, to: number | null) {
  if (from === null || to === null) return null;
  return from === to ? String(from) : `${from}–${to}`;
}

export function circuitHistoryChartRows(rows: CircuitGrandPrixHistoryRow[]) {
  const seasons = new Map<number, number>();
  for (const row of rows) seasons.set(row.season, (seasons.get(row.season) ?? 0) + 1);

  return [...rows]
    .sort((a, b) => a.season - b.season || a.round - b.round)
    .map((row) => ({
      ...row,
      label: (seasons.get(row.season) ?? 0) > 1 ? `${row.season} · ${row.round}` : String(row.season),
      winnerStartPosition: validCount(row.winnerStartPosition, 1),
      dnfCount: validCount(row.dnfCount, 0),
    }));
}

function validCount(value: number | null, minimum: number) {
  return value !== null && Number.isInteger(value) && value >= minimum ? value : null;
}
