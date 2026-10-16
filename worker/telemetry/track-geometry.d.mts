import type { Comparison, Track, Meeting } from "./types";

export function verifiedTrack(name: string, season: number, id?: string): Track | undefined;
export function normalizeTelemetryMeeting(meeting: Meeting): Meeting;
export function orientEstimatedTrack(track: Track): Track;
export function orientComparison(comparison: Comparison): Comparison;
