import type { Catalog, Lap, RacePace, Session } from "./types";
export const RACE_PACE_VERSION: string;
export function isRaceSession(session?: Session | null): boolean;
export function buildRacePace(catalog: Catalog): RacePace;
export function raceControlLaps(catalog: Catalog): Lap[];
export function raceTyreLaps(catalog: Catalog): Lap[];
