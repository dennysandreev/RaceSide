export type Channel = "speed" | "throttle" | "brake" | "gear" | "rpm" | "drs";
export type Mode = "lap" | "best" | "session" | "teammate" | "evolution";
export type LapSelection = number | "best" | "race_average";
export type Selection = {
  session: number;
  driver: number;
  lap: LapSelection;
};
export type CompareConfig = {
  mode: Mode;
  traces: Selection[];
  reference: number;
  window?: "weekend" | "session";
  channel?: Channel | "delta";
  corner?: number;
  range?: [number, number];
};
export type Session = {
  id: number;
  meetingId: number;
  season: number;
  name: string;
  type: string;
  circuit: string;
  circuitKey: number;
  country: string;
  start: string;
  end: string;
  slug: string;
};
export type Meeting = {
  id: number;
  season: number;
  name: string;
  circuit: string;
  country: string;
  start: string;
  slug: string;
};
export type Driver = {
  id: string;
  number: number;
  code: string;
  name: string;
  team: string;
  color: string;
  portrait: string | null;
  position: number | null;
};
export type Weather = {
  air: number | null;
  track: number | null;
  humidity: number | null;
  rain: number | null;
  wind: number | null;
  date: string;
};
export type Lap = {
  id: string;
  sessionId: number;
  driverNumber: number;
  number: number;
  time: number | null;
  start: string | null;
  sectors: (number | null)[];
  compound: string | null;
  tyreAge: number | null;
  stint: number | null;
  pitIn: boolean;
  pitOut: boolean;
  deleted: boolean;
  officialBestTime?: number | null;
  officialBest?: boolean;
  complete: boolean;
  status: string[];
  validityKnown: boolean;
  weather: Weather | null;
  kind?: "race_average";
  sampleCount?: number;
};
export type Point = {
  distance: number;
  elapsed: number;
  timestamp: number;
  x: number | null;
  y: number | null;
} & Record<Channel, number | null>;
export type Corner = {
  number: number;
  name?: string;
  start: number;
  apex: number;
  end: number;
};
export type Track = {
  id: string;
  version: string;
  name: string;
  length: number;
  points: { distance: number; x: number; y: number }[];
  sectors: number[];
  corners: Corner[];
  source: string;
  estimated: boolean;
};
export type Quality = {
  coverage: number;
  maxGapSeconds: number;
  sampleIntervalSeconds: number;
  timingError: number | null;
  warnings: string[];
  comparable: boolean;
  method: string;
};
export type Metric = {
  topSpeed: number | null;
  averageSpeed: number | null;
  fullThrottle: number | null;
  brakingDistance: number | null;
  gearUsage: Record<string, number>;
  drsUsage: number | null;
  brakingPoints: number[];
  throttlePickups: number[];
  earliestBraking: number | null;
  latestBraking: number | null;
};
export type CornerMetric = {
  number: number;
  entry: number | null;
  minimum: number | null;
  maximum: number | null;
  exit: number | null;
  braking: number | null;
  pickup: number | null;
  fullThrottle: number | null;
  time: number | null;
};
export type NormalizedLap = {
  lap: Lap;
  driver: Driver;
  session: Session;
  points: Point[];
  quality: Quality;
  metrics: Metric;
  corners: CornerMetric[];
  datasetId: string;
};
export type Insight = {
  id: string;
  text: string;
  value: number;
  unit: "s" | "m" | "km/h";
  from?: number;
  to?: number;
};
export type Comparison = {
  version: string;
  config: CompareConfig;
  traces: NormalizedLap[];
  track: Track;
  distance: number[];
  delta: (number | null)[][];
  segments: { from: number; to: number; gain: (number | null)[] }[];
  sectorDelta: (number | null)[][];
  cornerDelta: (number | null)[][];
  straightDelta: (number | null)[];
  insights: Insight[];
  warnings: string[];
  source: { provider: string; url: string; license: string };
  evolution?: { session: Session; lap: Lap; driver: Driver; metrics: Metric }[];
  analysis?: TelemetryAnalysis;
};
export type TrackCategory = "slow" | "medium" | "fast" | "straight";
export type AnalysisSection = {
  id: string;
  category: TrackCategory;
  corner: number | null;
  from: number;
  apex: number | null;
  to: number;
  speed: number | null;
  minimumSpeeds?: (number | null)[];
  times: (number | null)[];
  gain: number | null;
};
export type SignalKind = "speed-drop" | "coasting" | "weak-acceleration";
export type TelemetrySignal = {
  id: string;
  kind: SignalKind;
  trace: number;
  from: number;
  to: number;
  duration: number;
  startSpeed: number;
  endSpeed: number;
  gear: number | null;
  throttle: number;
  brakingAt: number | null;
};
export type RepeatSummary = { pairs: number; wins: [number, number]; neutral: number; medianGain: number | null };
export type ExitAnalysis = {
  corner: number;
  from: number;
  exit: number;
  to: number;
  speeds: (number | null)[];
  fullThrottle: (number | null)[];
  exitGain: number | null;
  straightGain: number | null;
  totalGain: number | null;
  exitVerified: boolean;
  straightVerified: boolean;
  exitNeutralSeconds: number;
  straightNeutralSeconds: number;
  repeatSummary: { exit: RepeatSummary; straight: RepeatSummary };
  repeats: {
    laps: [number, number];
    exitGain: number | null;
    straightGain: number | null;
    neutralSeconds: number;
    compounds: [string | null, string | null];
    tyreAges: [number | null, number | null];
    exitVerified: boolean;
    straightVerified: boolean;
    exitNeutralSeconds: number;
    straightNeutralSeconds: number;
  }[];
};
export type TelemetryAnalysis = {
  version: string;
  trackVersion: string;
  reference: number;
  other: number;
  quality: {
    timingAvailable: boolean;
    sectorError: number | null;
    neutralSeconds: number;
    warnings: string[];
  };
  sections: AnalysisSection[];
  profile: { category: TrackCategory; count: number; available: number; gain: number | null; speedValues: (number | null)[] }[];
  exits: ExitAnalysis[];
  signals: TelemetrySignal[];
  repeatability: { pairs: number; reason: "context" | "laps" | "average" | "sessions" | null };
};
export type Catalog = {
  session: Session;
  drivers: Driver[];
  laps: Lap[];
  raceControl: Record<string, unknown>[];
  pitDataKnown?: boolean;
  track: Track | null;
};
export type RacePaceReason =
  | "START"
  | "PIT_IN"
  | "PIT_OUT"
  | "DELETED"
  | "INCOMPLETE"
  | "UNKNOWN_CONTROL"
  | "RED"
  | "SC"
  | "VSC"
  | "YELLOW";
export type RacePacePoint = {
  driver: number;
  lap: number;
  time: number | null;
  compound: string;
  tyreAge: number | null;
  stint: number | null;
  clean: boolean;
  reasons: RacePaceReason[];
  trend: number | null;
};
export type RacePace = {
  version: string;
  session: Session;
  drivers: Driver[];
  points: RacePacePoint[];
  stints: {
    driver: number;
    number: number | null;
    compound: string;
    from: number;
    to: number;
    ageAtStart: number | null;
  }[];
  totalLaps: number;
  warnings: ("MISSING_TYRES" | "MISSING_CONTROL")[];
};
export type SavedComparison = {
  id: string;
  comparison: Comparison;
  createdAt: string;
};
