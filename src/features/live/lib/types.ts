import type { TrackMapDefinition } from "@/types/racemate";
import type { TimelinePatch } from "../../../../worker/live/timeline.mjs";
export type LiveSession = {
  session_key: number;
  meeting_key: number;
  session_name: string;
  session_type: string;
  race_name?: string;
  circuit_short_name: string;
  date_start: string;
  date_end: string;
};
export type DriverLiveState = {
  driverNumber: number;
  acronym: string;
  fullName: string;
  team: string;
  teamColour: string;
  position: number | null;
  gap: string | number | null;
  interval: string | number | null;
  compound: string | null;
  tyreAge: number | null;
  tyreAgeEstimated?: boolean;
  lap: number;
  lastLap: number | null;
  bestLap: number | null;
  maxSpeed?: number | null;
  bestLapSectors?: (number | null)[];
  sectors: (number | null)[];
  bestSectors: (number | null)[];
  pitCount: number;
  pitEnteredAt?: string | null;
  status: string;
  eliminatedIn?: string | null;
  lastUpdatedAt: string | null;
  pace: { lap: number; duration: number; compound: string; pit: boolean }[];
  lapHistory?: {
    deleted?: boolean;
    lap: number;
    duration: number;
    compound: string | null;
    pit: boolean;
    sectors: (number | null)[];
  }[];
};
export type LocationSample = {
  pitTrackProgress?: { entry: number; exit: number };
  pitLaneProgress?: number | null;
  timestamp: string;
  stationarySince?: string;
  x: number;
  y: number;
  z: number;
  progress: number;
};
export type TelemetrySample = {
  timestamp: string;
  speed: number | null;
  throttle: number | null;
  brake: number | null;
  rpm: number | null;
  gear: number | null;
  drs: number | null;
};
export type FeedEvent = {
  id: string;
  type: string;
  timestamp: string;
  driverNumber: number | null;
  lap: number | null;
  message: string;
  original: string | null;
  duration?: number;
};
export type RadioMessage = {
  test?: boolean;
  id: string;
  driverNumber: number;
  timestamp: string;
  lap: number | null;
  original: string | null;
  ru: string | null;
  status: "received" | "transcribing" | "ready" | "failed";
  playable: boolean;
};
export type WeatherState = {
  timestamp: string;
  air: number | null;
  track: number | null;
  rain: number | null;
  wind: number | null;
  humidity: number | null;
};
export type LiveStint = {
  driverNumber: number;
  stintNumber: number;
  compound: string | null;
  startLap: number;
  endLap: number | null;
  ageAtStart: number | null;
};
export type LiveSessionState = {
  session: LiveSession | null;
  championship: LiveChampionship | null;
  drivers: Record<number, DriverLiveState>;
  locations: Record<number, LocationSample>;
  telemetry: Record<number, TelemetrySample>;
  events: FeedEvent[];
  radio: RadioMessage[];
  pits: {
    id: string;
    driverNumber: number;
    timestamp: string;
    lap: number;
    duration: number | null;
    laneDuration: number | null;
    before: string | null;
    after: string | null;
  }[];
  stints?: LiveStint[];
  weather: WeatherState | null;
  track: TrackMapDefinition | null;
  trackSectorCount: number | null;
  yellowSectors: number[];
  status: string;
  flag: string | null;
  currentLap: number;
  totalLaps: number | null;
  phase: string | null;
  phaseEndsAt: string | null;
  phaseStartedAt: string | null;
  timerPausedAt: string | null;
  timerOffsetMs: number;
  replayReady: boolean;
  updatedAt: string | null;
};
export type ChampionshipEntry = {
  id: string;
  points: number;
  position: number | null;
  finishes: (number | null)[];
};
export type ChampionshipDriver = ChampionshipEntry & {
  driverNumber: number | null;
  acronym: string;
  fullName: string;
  teamId: string | null;
};
export type ChampionshipTeam = ChampionshipEntry & { name: string; colour: string };
export type LiveChampionship = {
  sessionKey: number;
  season: number;
  round: number;
  drivers: ChampionshipDriver[];
  teams: ChampionshipTeam[];
  countbackComplete: boolean;
  results?: {
    driverId: string;
    teamId: string | null;
    position: number | null;
    points: number;
  }[] | null;
  sprint: {
    status: "none" | "pending" | "ready";
    points: { driverId: string; teamId: string | null; points: number }[];
  };
};
export type LiveHealth = {
  status: string;
  sourceConnected: boolean;
  lastMessageAt: string | null;
  databaseWriterActive: boolean;
};
export type LiveMessage = {
  type: "snapshot" | "state" | "samples" | "patch";
  patch?: TimelinePatch[];
  reset?: boolean;
  presentation?: LivePresentation;
  data?: Partial<LiveSessionState>;
  health?: LiveHealth;
  serverTime: number;
  samples?: (
    | ({ type: "location"; driverNumber: number } & LocationSample)
    | ({ type: "telemetry"; driverNumber: number } & TelemetrySample)
  )[];
};
export type LiveView = { mode: "live" | "rewind"; delayMs?: number; pausedAt?: number };
export type LivePresentation = {
  mode: "live" | "rewind";
  cursorTime: number;
  earliestTime: number;
  latestTime: number;
  delayMs: number;
  paused: boolean;
  expired: boolean;
  requestId: number;
};
