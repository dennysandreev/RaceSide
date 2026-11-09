import type { Catalog, Driver, Lap, SessionLapMetric } from "./types";
export const SESSION_PACE_VERSION: string;
export const SESSION_METRICS_VERSION: string;
export const SESSION_METRICS_MAX_GAP_MS: number;
export const SESSION_METRICS_MIN_COVERAGE: number;
export function bestSessionLaps(catalog: Catalog): { driver: Driver; lap: Lap|null }[];
export function sessionLapMetrics(driver: Driver, lap: Lap|null, raw?: unknown[], circuitLength?: number|null): SessionLapMetric;
