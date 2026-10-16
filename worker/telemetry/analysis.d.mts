import type { Comparison, NormalizedLap, Track, AnalysisSection, TelemetrySignal, TelemetryAnalysis } from "./types";
export const ANALYSIS_VERSION: string;
export const ANALYSIS_RULES: Readonly<{
  slowSpeed: number; fastSpeed: number; maxGap: number; neutralSeconds: number; maxSectorError: number;
  fullThrottle: number; pressedThrottle: number; speedDrop: number; minSignalSpeed: number;
  minSuperclippingStartSpeed: number; minSignalDuration: number; minSignalDistance: number;
  maxSignalGap: number; maxSignalMergeSeconds: number; maxSignalMergeDistance: number; maxSignalSpeedRecovery: number;
}>;
export function analysisSections(traces: NormalizedLap[], track: Track): Omit<AnalysisSection, "times" | "gain">[];
export function repeatableLap(trace: NormalizedLap): boolean;
export function intervalTiming(a: NormalizedLap, b: NormalizedLap, track: Track, from: number, to: number): { gain: number | null; verified: boolean; neutralSeconds: number };
export function matchRepeatability(traces: NormalizedLap[], candidates?: NormalizedLap[], interval?: { track: Track; from: number; to: number }): { pairs: [NormalizedLap, NormalizedLap][]; reason: TelemetryAnalysis["repeatability"]["reason"] };
export function detectTelemetrySignals(trace: NormalizedLap, index: number, sections: Omit<AnalysisSection, "times" | "gain">[]): TelemetrySignal[];
export function buildTelemetryAnalysis(comparison: Comparison, candidates?: NormalizedLap[]): TelemetryAnalysis | null;
