export type NewsItem = {
  id: string;
  slug: string;
  href?: string;
  source: string;
  title: string;
  summary: string;
  details?: string;
  highlights?: string[];
  imageUrl?: string;
  sourceImageUrl?: string;
  tags: { name: string; slug: string; type?: string }[];
  raceTag?: string;
  raceTagSlug?: string;
  raceFilter?: string;
  publishedAt?: string;
  modifiedAt?: string;
  editorial?: import("../lib/news-editorial").NewsEditorialMeta;
  sources?: { source_url: string; source_name: string; source_authors: string[]; source_published_at?: string | null }[];
  time: string;
};

export type NewsListResult = {
  items: NewsItem[];
  page: number;
  totalPages: number;
  totalCount: number;
};

export type NextSession = {
  race: string;
  circuit: string;
  session: string;
  startsAt: string;
  startsAtIso?: string;
  status: string;
};

export type StandingRow = {
  position: number;
  driver: string;
  driverSlug?: string;
  driverNumber?: number;
  team: string;
  teamCode?: string;
  teamLogo?: string;
  teamColor?: string;
  points: number;
};

export type ConstructorStandingRow = {
  position: number;
  team: string;
  teamCode?: string;
  teamLogo?: string;
  teamColor?: string;
  teamSlug?: string;
  carImageUrl?: string | null;
  points: number;
  wins: number;
  pointsByRound?: Record<number, number>;
};

export type StandingsMeta = {
  season: number;
  round: number | null;
  label: string;
};

export type DriverChampionshipRow = {
  position: number;
  driver: string;
  driverSlug?: string;
  driverNumber?: number;
  avatarUrl?: string | null;
  team: string;
  teamCode?: string;
  teamLogo?: string;
  teamColor?: string;
  teamSlug?: string;
  total: number;
  pointsByRound: Record<number, number>;
  positionByRound: Record<number, number>;
  podiumByRound: Record<number, "winner" | "second" | "third">;
};

export type ChampionshipRound = {
  round: number;
  flag: string;
  countryCode?: string;
  raceName: string;
};

export type DriverChampionshipMatrix = {
  rounds: ChampionshipRound[];
  rows: DriverChampionshipRow[];
};

export type DriverProfileTeam = {
  id?: string;
  name: string;
  code?: string;
  logo?: string;
  color?: string;
  slug?: string;
};

export type DriverSeasonStats = {
  points: number | null;
  championshipPosition: number | null;
  wins: number | null;
  podiums: number | null;
  poles: number | null;
  fastestLaps: number | null;
  dnfs: number | null;
  pointsFinishes: number | null;
  averageStart: number | null;
  averageFinish: number | null;
  bestResult: number | null;
  worstResult: number | null;
  q3Appearances: number | null;
};

export type DriverRaceResultRow = {
  round: number;
  raceName: string;
  raceDate: string | null;
  circuit: string;
  country: string;
  countryCode?: string;
  qualifyingPosition: number | null;
  startPosition: number | null;
  finishPosition: number | null;
  positionDelta: number | null;
  points: number | null;
  status: string;
  isWin: boolean;
  isPodium: boolean;
  isDnf: boolean;
  scoredPoints: boolean;
};

export type DriverChartPoint = {
  round: number;
  raceName: string;
  value: number | null;
};

export type DriverCumulativePointsSeries = {
  driverId: string;
  driver: string;
  driverSlug?: string;
  teamColor?: string;
  points: DriverChartPoint[];
};

export type DriverFormStats = {
  labels: string[];
  points: number;
  podiums: number;
  dnfs: number;
  bestResult: number | null;
  averageQualifyingPosition: number | null;
  averageFinishPosition: number | null;
};

export type DriverTeammateComparison = {
  teammateNames: string[];
  qualifying: { driver: number; teammate: number };
  races: { driver: number; teammate: number };
  points: { driver: number; teammate: number };
  podiums: { driver: number; teammate: number };
  wins: { driver: number; teammate: number };
  averageStart: { driver: number | null; teammate: number | null };
  averageFinish: { driver: number | null; teammate: number | null };
  dnfs: { driver: number; teammate: number };
};

export type DriverPositionDeltaStats = {
  totalDelta: number | null;
  averageDelta: number | null;
  bestGain: { value: number; raceName: string } | null;
  biggestDrop: { value: number; raceName: string } | null;
};

export type DriverProfileNewsItem = {
  title: string;
  summary: string;
  href: string;
  source: string;
  time: string;
  imageUrl?: string;
};

export type DriverProfileSocialPost = {
  platform: "x" | "reddit" | "telegram";
  author: string;
  source: string;
  title: string;
  href: string;
  publishedAt: string;
};

export type DriverProfile = {
  id: string;
  slug: string;
  firstName: string;
  lastName: string;
  fullName: string;
  code?: string;
  number: number | null;
  country: string | null;
  countryCode?: string | null;
  aiAvatarUrl?: string | null;
  avatarPlaceholderStyle?: string | null;
  team: DriverProfileTeam;
  season: number;
  availableSeasons: number[];
  stats: DriverSeasonStats;
  results: DriverRaceResultRow[];
  charts: {
    racePoints: DriverChartPoint[];
    cumulativePoints: DriverChartPoint[];
    championshipPosition: DriverChartPoint[];
    topTenCumulativePoints: DriverCumulativePointsSeries[];
  };
  form: DriverFormStats;
  teammateComparison: DriverTeammateComparison;
  positionDelta: DriverPositionDeltaStats;
  news: DriverProfileNewsItem[];
  socialPosts: DriverProfileSocialPost[];
  isFavorite: boolean;
  favoriteLimitReached: boolean;
};

export type DriverDirectoryDriver = {
  id: string;
  slug: string;
  fullName: string;
  code?: string;
  number: number | null;
  avatarUrl?: string | null;
  starts: number;
  championshipPosition: number | null;
  points: number;
  wins: number;
  isPrimary: boolean;
};

export type DriverDirectoryTeam = {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  code: string;
  color: string;
  logo?: string;
  championshipPosition: number | null;
  drivers: DriverDirectoryDriver[];
};

export type DriverStageResult = {
  round: number;
  raceName: string;
  participated: boolean;
  qualifyingPosition: number | null;
  sprintPosition: number | null;
  sprintPoints: number;
  startPosition: number | null;
  finishPosition: number | null;
  fastestLapTime: string | null;
  points: number;
  status: string | null;
  isDnf: boolean;
};

export type DriverRoundSnapshot = {
  round: number;
  championshipPosition: number | null;
  points: number;
  wins: number;
  podiums: number;
  poles: number;
  fastestLaps: number;
  q3Appearances: number;
  pointsFinishes: number;
  dnfs: number;
  averageStart: number | null;
  averageFinish: number | null;
  positionsGained: number;
  starts: number;
  stage: DriverStageResult | null;
};

export type DriverComparisonDriver = {
  id: string;
  slug: string;
  fullName: string;
  code?: string;
  number: number | null;
  avatarUrl?: string | null;
  team: DriverProfileTeam;
  snapshots: DriverRoundSnapshot[];
};

export type DriverComparisonDataset = {
  season: number;
  latestCompletedRound: number;
  rounds: Array<ChampionshipRound & { completed: boolean }>;
  options: Array<DriverDirectoryDriver & { team: DriverProfileTeam }>;
  drivers: DriverComparisonDriver[];
};

export type ConstructorChampionshipMatrix = {
  rounds: ChampionshipRound[];
  rows: ConstructorStandingRow[];
};

export type TeamProfileSummary = {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  code: string;
  country: string | null;
  countryCode?: string | null;
  color: string;
  logo?: string;
  carImageUrl: string;
  season: number;
  championshipPosition: number | null;
  points: number;
  wins: number;
};

export type TeamProfileDriver = {
  id: string;
  fullName: string;
  slug?: string;
  code?: string;
  number: number | null;
  avatarUrl?: string | null;
  championshipPosition: number | null;
  points: number;
  wins: number;
  podiums: number;
  bestResult: number | null;
};

export type TeamRaceResultRow = {
  round: number;
  raceName: string;
  raceDate: string | null;
  country: string;
  countryCode?: string;
  points: number | null;
  bestFinish: number | null;
  qualifyingBest: number | null;
  qualifyingResults: Array<{
    driverId?: string;
    driver: string;
    driverSlug?: string;
    position: number | null;
  }>;
  finishResults: Array<{
    driverId?: string;
    driver: string;
    driverSlug?: string;
    position: number | null;
    isDnf: boolean;
  }>;
  positionDelta: number | null;
  isWin: boolean;
  isPodium: boolean;
  hadDnf: boolean;
};

export type TeamProfileStats = {
  points: number;
  championshipPosition: number | null;
  wins: number;
  podiums: number;
  poles: number;
  fastestLaps: number;
  dnfs: number;
  pointsFinishes: number;
  bestResult: number | null;
  averageFinish: number | null;
};

export type TeamCumulativePointsSeries = {
  teamCode: string;
  team: string;
  teamSlug?: string;
  teamColor?: string;
  points: DriverChartPoint[];
};

export type TeamProfile = TeamProfileSummary & {
  availableSeasons: number[];
  drivers: TeamProfileDriver[];
  stats: TeamProfileStats;
  results: TeamRaceResultRow[];
  pointsByRound: Array<{
    round: number;
    raceName: string;
    countryCode?: string;
    points: number;
    cumulativePoints: number;
  }>;
  cumulativePointsSeries: TeamCumulativePointsSeries[];
  form: {
    labels: string[];
    points: number;
    podiums: number;
    bestResult: number | null;
  };
  news: NewsItem[];
  socialPosts: DriverProfileSocialPost[];
};

export type TeamVisual = {
  name: string;
  code?: string;
  logo?: string;
  color?: string;
};

export type PredictionPick = {
  label: string;
  value: string;
};

export type AdminSignal = {
  label: string;
  value: string;
  status: string;
};

export type CalendarEvent = {
  season: number;
  round: number;
  race: string;
  circuit: string;
  country: string;
  countryFlag: string;
  countryCode?: string;
  date: string;
  status: string;
  hasSprint?: boolean;
  winner?: string;
  href: string;
  trackMapUrl?: string | null;
};

export type SeasonGlobePhase = "completed" | "next" | "upcoming";

export type SeasonGlobePodiumEntry = {
  position: 1 | 2 | 3;
  driverId: string | null;
  driverName: string;
  driverSlug: string | null;
  driverNumber: number | null;
  avatarUrl: string | null;
  teamName: string;
  teamCode: string | null;
  teamColor: string | null;
};

export type SeasonGlobeEvent = {
  id: string;
  season: number;
  round: number;
  raceName: string;
  circuitName: string;
  country: string;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  weekendStartAtIso: string | null;
  raceStartAtIso: string | null;
  raceEndAtIso: string | null;
  weekendDateLabel: string;
  raceDateLabel: string;
  phase: SeasonGlobePhase;
  isLive: boolean;
  href: string;
  podium: SeasonGlobePodiumEntry[];
};

export type SeasonGlobeData = {
  season: number;
  nextRound: number | null;
  events: SeasonGlobeEvent[];
};

export type RaceDetail = {
  id: string;
  season: number;
  round: number;
  race: string;
  circuit: string;
  circuitId?: string | null;
  country: string;
  countryFlag: string;
  countryCode?: string;
  locality: string;
  startsAt: string;
  startsAtIso?: string;
  status: string;
  timezone?: string | null;
  layout?: TrackLayout | null;
  trackMapUrl?: string | null;
  tyreAllocation?: RaceTyreAllocation | null;
};

export type RaceTyreAllocation = {
  hard: string;
  medium: string;
  soft: string;
  sourceUrl?: string | null;
  updatedAt?: string | null;
};

export type CircuitStatsView = {
  circuit: {
    id: string;
    slug?: string | null;
    name: string;
    country: string;
    locality: string;
    lapLengthKm: number | null;
    raceLaps: number | null;
    raceDistanceKm: number | null;
    turnsCount: number | null;
    direction: string | null;
    firstGrandPrixYear: number | null;
    lapRecordTime: string | null;
    lapRecordDriver: string | null;
    lapRecordYear: number | null;
    drsZonesCount: number | null;
    trackType: string | null;
    description: string | null;
  };
  ratings: CircuitRating[];
  character: {
    sinceSeason: number;
    racesCount: number;
    ratings: CircuitRating[];
    facts: {
      poleWinRate: number | null;
      winnerAvgStartPosition: number | null;
      avgDnfCount: number | null;
    };
  };
  summary: {
    racesCount: number;
    calculatedFromSeason: number | null;
    calculatedToSeason: number | null;
    updatedAt: string | null;
  };
  qualifying: {
    poleWinRate: number | null;
    frontRowWinRate: number | null;
    winnerAvgStartPosition: number | null;
    level: string | null;
    bestNonPoleWin?: CircuitPositionRecord | null;
  };
  overtaking: {
    avgPositionDelta: number | null;
    avgAbsPositionDelta: number | null;
    level: string | null;
    bestGain?: CircuitPositionRecord | null;
    worstLoss?: CircuitPositionRecord | null;
  };
  chaos: {
    safetyCarFrequency: number | null;
    vscFrequency: number | null;
    redFlagFrequency: number | null;
    avgDnfCount: number | null;
    chaosScore: number | null;
    level: string | null;
  };
  strategy: {
    avgPitStops: number | null;
    avgFirstPitLap: number | null;
    mostCommonStrategy: string | null;
    strategyVariabilityLevel: string | null;
    distribution: Record<string, number>;
  };
  records: {
    biggestWinGap?: string | null;
    maxDnfCount?: number | null;
    mostSuccessfulDriver?: string | null;
    mostSuccessfulTeam?: string | null;
  };
  aiPreview: string | null;
  history: CircuitGrandPrixHistoryRow[];
  topDrivers: CircuitDriverStat[];
  topTeams: CircuitTeamStat[];
  sourceErrors: string[];
};

export type CircuitRating = {
  label: string;
  value: number | null;
  helper: string;
};

export type CircuitPositionRecord = {
  season?: number | null;
  round?: number | null;
  raceName?: string | null;
  driver?: string | null;
  team?: string | null;
  start?: number | null;
  finish?: number | null;
  delta?: number | null;
};

export type CircuitGrandPrixHistoryRow = {
  season: number;
  round: number;
  raceName: string;
  raceDate: string;
  href: string;
  winner: string;
  winnerTeam: string;
  pole: string;
  poleTeam: string;
  winnerStartPosition: number | null;
  winnerFromPole: boolean | null;
  podium: string[];
  dnfCount: number | null;
  safetyCarCount: number | null;
  vscCount: number | null;
  redFlagCount: number | null;
};

export type CircuitDriverStat = {
  driver: string;
  driverSlug?: string | null;
  team: string;
  teamColor?: string | null;
  starts: number;
  wins: number;
  podiums: number;
  pointsFinishes: number;
  dnfs: number;
  avgStartPosition: number | null;
  avgFinishPosition: number | null;
  bestFinish: number | null;
};

export type CircuitTeamStat = {
  team: string;
  teamColor?: string | null;
  starts: number;
  wins: number;
  podiums: number;
  pointsFinishes: number;
  avgPoints: number | null;
  bestFinish: number | null;
  doublePointsFinishes: number;
};

export type MarketOdds = {
  marketTitle: string;
  marketUrl: string;
  source: string;
  updatedAt: string;
  outcomes: {
    name: string;
    probability: number;
    label: string;
  }[];
};

export type RaceWinnerOdds = MarketOdds;

export type SeasonChampionOdds = MarketOdds;

export type ConstructorChampionOdds = MarketOdds;

export type WeekendSession = {
  id?: string;
  type?: string;
  name: string;
  startsAt: string;
  startsAtIso?: string;
  status: string;
  href?: string;
  weather?: SessionWeather;
};

export type SessionWeather = {
  temperature: string;
  temperatureC: number | null;
  wind: string;
  precipitation: string;
  precipitationMm: number | null;
  observedAt: string;
  status: string;
};

export type TrackLayout = {
  svgPath: string;
  viewBox: string;
  provider: string;
  sourceSessionKey: number | null;
};

export type TrackPoint = {
  progress: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  svgX: number;
  svgY: number;
  elevationM: number;
  distanceM?: number;
};

export type ElevationPoint = {
  progress: number;
  z: number;
  normalizedZ: number;
  gradient?: number;
};

export type PitLanePoint = {
  svgX: number;
  svgY: number;
  worldX: number;
  worldY: number;
  worldZ: number;
};

export type TrackMapDefinition = {
  id: string;
  circuitKey: string;
  circuitName: string;
  marshalSectorCount?: number | null;
  countryName?: string | null;
  seasonSource: number;
  meetingKey: number | null;
  sessionKey: number;
  svg: {
    viewBox: {
      width: number;
      height: number;
    };
    visualPathD: string;
    technicalPathD: string;
  };
  worldBounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  };
  transform: {
    scale: number;
    offsetX: number;
    offsetY: number;
    invertY: boolean;
  };
  centerline: TrackPoint[];
  elevation: ElevationPoint[];
  pitLane?: {
    visualPathD: string;
    points: PitLanePoint[];
    labelX?: number | null;
    labelY?: number | null;
    source?: string | null;
    metadata?: {
      entry?: string;
      exit?: string;
      referenceUrl?: string;
      source?: string;
    } | null;
  } | null;
  startFinish: {
    progress: number;
    svgX: number;
    svgY: number;
  };
  debug?: {
    rawPointCount: number;
    filteredPointCount: number;
    generatedAt: string;
    sourceDriverNumbers: number[];
  };
};

export type ReplayDriverState = {
  driverNumber: number;
  abbreviation: string;
  fullName: string;
  teamName: string;
  teamColor: string;
  position: number | null;
  gapToLeader: string | null;
  intervalToAhead: string | null;
  lapNumber: number | null;
  compound: string | null;
  tyreAge: number | null;
  tyreAgeEstimated?: boolean;
  pitStops: number;
  lastLapTime: string | null;
  lastLapDuration?: number | null;
  sector1Time?: string | null;
  sector2Time?: string | null;
  sector3Time?: string | null;
  bestLapTime: string | null;
  status: string;
};

export type ReplayPositionEvent = {
  offsetMs: number;
  timestamp: string;
  driverNumber: number;
  svgX: number;
  svgY: number;
  progress: number;
  z: number;
  normalizedZ: number;
  headingRad: number;
  position?: number | null;
  gapToLeader?: string | null;
  intervalToAhead?: string | null;
  lapNumber?: number | null;
  compound?: string | null;
  tyreAge?: number | null;
  tyreAgeEstimated?: boolean;
  speedKph?: number | null;
  gear?: number | null;
  drs?: number | null;
  isPitLane?: boolean;
  pitLaneDuration?: number | null;
  pitStopDuration?: number | null;
  lastLapTime?: string | null;
  lastLapDuration?: number | null;
  sector1Time?: string | null;
  sector2Time?: string | null;
  sector3Time?: string | null;
};

export type ReplayRaceEvent = {
  offsetMs: number;
  timestamp: string;
  type: string;
  lapNumber?: number | null;
  message: string;
  severity: "INFO" | "IMPORTANT" | "CRITICAL";
  driverNumber?: number | null;
};

export type ReplayLapTiming = {
  driverNumber: number;
  lapNumber: number;
  startOffsetMs: number;
  durationMs: number | null;
};

export type ReplayRadioText = {
  id: string;
  driverNumber: number;
  timestamp: string;
  offsetMs: number;
  lap: number | null;
  original: string | null;
  ru: string | null;
  status: string;
};

export type RaceReplaySnapshot = {
  radio?: ReplayRadioText[];
  replaySessionId: string;
  sourceSessionKey: number;
  raceName: string;
  circuitName: string;
  sourceSeason: number;
  durationMs: number;
  totalLaps: number | null;
  track: TrackMapDefinition;
  drivers: ReplayDriverState[];
  lapTimings?: ReplayLapTiming[];
  intervalTimings?: ReplayIntervalTiming[];
  positionTimings?: ReplayPositionTiming[];
  positions: ReplayPositionEvent[];
  raceEvents: ReplayRaceEvent[];
  weather: {
    airTemperatureC?: number | null;
    trackTemperatureC?: number | null;
    rainfall?: number | null;
    windSpeedKmh?: number | null;
  } | null;
};

export type ReplayPositionTiming = {
  driverNumber: number;
  offsetMs: number;
  position: number;
};

export type ReplayIntervalTiming = {
  driverNumber: number;
  gapToLeader: string | null;
  intervalToAhead: string | null;
  offsetMs: number;
};

export type RaceReplaySummary = {
  id: string;
  href: string;
  title: string;
  sourceSeason: number;
  sourceSessionKey: number;
  status: string;
};

export type SessionResult = {
  position: number | null;
  driver: string;
  driverSlug?: string;
  driverNumber?: number;
  team: string;
  teamCode?: string;
  teamLogo?: string;
  teamColor?: string;
  time: string;
  status: string;
  grid: number | null;
  laps: number | null;
  points: number | null;
  bestLap?: string | null;
  bestLapNumber?: number | null;
};

export type GrandPrixReportStatus =
  | "pending"
  | "collecting"
  | "processing"
  | "summary_pending"
  | "ready"
  | "partial"
  | "failed";

export type GrandPrixReportResult = {
  position: number | null;
  driverNumber?: number | null;
  driver: string;
  team: string;
  grid: number | null;
  positionDelta: number | null;
  points: number | null;
  status: string;
  time?: string | null;
  laps?: number | null;
  bestLap?: string | null;
  tyres?: TyreStint[];
  isWinner?: boolean;
  isPodium?: boolean;
  isFastestLap?: boolean;
  isBestGain?: boolean;
  isBiggestDrop?: boolean;
};

export type TyreStint = {
  compound: string;
  startLap?: number | null;
  endLap?: number | null;
};

export type GrandPrixReportEvent = {
  lap: number | null;
  type: string;
  title: string;
  detail?: string | null;
};

export type GrandPrixReport = {
  id: string;
  season: number;
  round: number;
  raceSlug: string;
  raceName: string;
  circuitName: string;
  country: string;
  raceDate: string;
  status: GrandPrixReportStatus;
  summaryStatus: string;
  aiSummary?: string | null;
  weather: Record<string, unknown>;
  raceStatistics: Record<string, unknown>;
  results: GrandPrixReportResult[];
  keyEvents: GrandPrixReportEvent[];
  pitStops: unknown[];
  strategies: unknown[];
  teammateComparisons: unknown[];
  highlights: Record<string, unknown>;
  championshipImpact: Record<string, unknown>;
  newsSummary: Record<string, unknown>;
  sourceErrors: Record<string, unknown>;
  generatedAt: string;
};

export type DailyDigest = {
  id?: string;
  title: string;
  body: string;
  generatedAt: string;
  status: string;
};

export type WeekendWeather = {
  temperature: string;
  temperatureC: number | null;
  wind: string;
  precipitation: string;
  precipitationMm: number | null;
  observedAt: string;
  status: string;
};

export type LeagueSummary = {
  avatarUrl?: string | null;
  id?: string;
  isMember?: boolean;
  isOwner?: boolean;
  isPublic?: boolean;
  lastRoundAverageScore?: number | null;
  lastRoundName?: string | null;
  name: string;
  members: number;
  leader: string;
  score: number;
  inviteCode?: string;
};

export type NewsTagFilter = {
  name: string;
  slug: string;
};

export type FavoriteNewsFilters = {
  drivers: NewsTagFilter[];
  teams: NewsTagFilter[];
};

export type LeaguePredictionPick = {
  label: string;
  value: string;
};

export type FantasyScoreBreakdown = {
  total: number;
  top10Points: number;
  top10Bonus: number;
  specialPoints: number;
  top10?: Array<{
    predictedPosition: number;
    driverId: string;
    actualPosition: number | null;
    points: number;
  }>;
  bonuses?: {
    perfectTop10?: number;
    allTop10?: number;
    podiumAnyOrder?: number;
  };
  specials?: {
    pole?: number;
    fastestLap?: number;
    firstDnf?: number;
    topScoringTeam?: number;
    fastestPitStopTeam?: number;
  };
};

export type PredictionResultPick = {
  label: string;
  points: number;
  value: string;
};

export type PreviousPredictionTop10Pick = {
  actualPosition: number | null;
  driverId: string;
  driverName: string;
  points: number;
  predictedPosition: number;
};

export type PreviousPredictionResult = {
  raceName: string;
  round: number;
  season?: number;
  score: number;
  scoredAt: string | null;
  scoreBreakdown?: FantasyScoreBreakdown | null;
  specials: PredictionResultPick[];
  top10: PreviousPredictionTop10Pick[];
};

export type LeagueMemberPrediction = {
  userId: string;
  name: string;
  role: string;
  joinedAt: string;
  currentScore: number | null;
  totalScore: number;
  scoredCount: number;
  averageScore: number;
  bestScore: number | null;
  picks: LeaguePredictionPick[];
  scoreBreakdown?: FantasyScoreBreakdown | null;
};

export type LeagueHistoryEntry = {
  raceName: string;
  round: number;
  season?: number;
  predictions: {
    userId: string;
    name: string;
    score: number | null;
    scoreBreakdown?: FantasyScoreBreakdown | null;
    picks: LeaguePredictionPick[];
    specials: PredictionResultPick[];
    top10: PreviousPredictionTop10Pick[];
  }[];
};

export type LeagueDetail = {
  avatarUrl?: string | null;
  id: string;
  isMember?: boolean;
  isOwner?: boolean;
  isPublic?: boolean;
  name: string;
  inviteCode?: string;
  members: LeagueMemberPrediction[];
  history: LeagueHistoryEntry[];
};

export type AdminJob = {
  name: string;
  status: string;
  processed: number;
  finishedAt: string;
};

export type AdminDuplicateNews = {
  id: string;
  title: string;
  mainFact?: string;
  source: string;
  checkedAt: string;
  confidence?: number;
  reason?: string;
  originalUrl: string;
  duplicateOf?: {
    id: string;
    title: string;
  };
};

export type AdminSource = {
  id: string;
  name: string;
  url: string;
  isActive: boolean;
  lastStatus: string;
};

export type SocialPlatform = "all" | "x" | "reddit" | "telegram";

export type SocialSort = "new" | "popular";

export type SocialMode = "main" | "fresh" | "mine";

export type SocialContentKind =
  | "official"
  | "report"
  | "opinion"
  | "rumor"
  | "discussion";

export type SocialPostTag = {
  name: string;
  slug: string;
  type: string;
  isPrimary: boolean;
};

export type SocialPostMedia = {
  id: string;
  type: "image" | "video" | "gif" | "link";
  url: string;
  previewUrl?: string;
  altText?: string;
  width?: number;
  height?: number;
};

export type SocialPost = {
  id: string;
  platform: "x" | "reddit" | "telegram";
  author: string;
  source: string;
  sourceTrust: "official" | "media" | "community";
  title: string;
  summary: string;
  originalUrl: string;
  imageUrl?: string;
  media: SocialPostMedia[];
  tags: SocialPostTag[];
  publishedAt: string;
  publishedAtIso: string;
  reactionCount?: number;
  commentCount?: number;
  repostCount?: number;
  viewCount?: number;
  popularityScore: number;
  importanceScore: number;
  contentKind: SocialContentKind;
};

export type SocialFeedResult = {
  items: SocialPost[];
  nextCursor: string | null;
};

export type SocialFilterOption = {
  label: string;
  value: string;
};

export type SocialFilterOptions = {
  topics: SocialFilterOption[];
  teams: SocialFilterOption[];
  drivers: SocialFilterOption[];
  races: SocialFilterOption[];
};

export type SocialTrendingTopic = {
  label: string;
  slug: string;
  posts: number;
};

export type AdminSocialSource = AdminSource & {
  platform: "x" | "reddit" | "telegram";
  adapter: string;
  feedKind?: string;
  trustLevel: "official" | "media" | "community";
  publicationMode: "auto" | "review";
  initialBackfillDays: number;
  nextFetchAt?: string;
  rateLimitedUntil?: string;
  lastSuccessAt?: string;
  lastError?: string;
};

export type AdminSocialPost = {
  id: string;
  author: string;
  platform: "x" | "reddit" | "telegram";
  title: string;
  status: "pending" | "processing" | "review" | "published" | "rejected";
  error?: string;
  publishedAt?: string;
};

export type AdminGrandPrixReport = {
  id: string;
  season: number;
  round: number;
  raceName: string;
  raceSlug: string;
  status: string;
  summaryStatus: string;
  isHidden: boolean;
  generatedAt: string;
  nextRefreshAt: string;
  lastError?: string;
  aiSummary?: string;
};

export type AdminDriver = {
  id: string;
  slug: string;
  fullName: string;
  code?: string;
  number: number | null;
  country?: string;
  countryCode?: string;
  aiAvatarUrl?: string;
  teamId?: string;
  team: string;
  teamCode?: string;
  teamLogo?: string;
  teamColor?: string;
};

export type AdminTeamOption = {
  id: string;
  name: string;
};

export type AiUsageSummary = {
  totalRuns: number;
  estimatedCostUsd: number;
  lastModel: string;
};

export type PollSummary = {
  id?: string;
  question: string;
  options: { id: string; label: string; votes?: number }[] | string[];
  votes: number;
  userVote?: string;
  kind?: "sport" | "strategy" | "fan";
  status?: "published" | "closed";
  closesAt?: string | null;
  race?: {
    id: string;
    season: number;
    round: number;
    name: string;
    circuit: string;
    country: string;
  };
};

export type DriverOption = {
  avatarUrl?: string | null;
  code?: string | null;
  id: string;
  name: string;
  number?: number | null;
  slug?: string | null;
  team: string;
  teamCode?: string | null;
  teamColor?: string | null;
};

export type TeamOption = {
  id: string;
  name: string;
  code?: string | null;
};

export type RaceOption = {
  country?: string | null;
  fantasyVisual?: {
    alt: string;
    author: string;
    cardUrl: string;
    credit: string;
    heroUrl: string;
    height: number;
    license: string;
    reviewStatus: string;
    sourcePageUrl: string;
    thumbUrl: string;
    visibleSegment: string;
    width: number;
  } | null;
  id: string;
  name: string;
  round: number;
  season: number;
  startsAt: string;
  qualifyingStartsAtIso?: string | null;
  raceStartsAtIso?: string | null;
  poleLocked: boolean;
  raceLocked: boolean;
};

export type PredictionState = {
  race: RaceOption | null;
  drivers: DriverOption[];
  teams: TeamOption[];
  seasonSummary: {
    predictionCount: number;
    scoredPredictionCount: number;
    totalScore: number | null;
  };
  startingGrid: {
    results: SessionResult[];
    session: WeekendSession;
    updatedAt: string;
  } | null;
  previousResult: PreviousPredictionResult | null;
  current: {
    top10DriverIds: string[];
    poleDriverId: string | null;
    winnerDriverId: string | null;
    fastestLapDriverId: string | null;
    dnfDriverId: string | null;
    dnfPickKind: "driver" | "none";
    topScoringTeamId: string | null;
    fastestPitStopTeamId: string | null;
    score: number | null;
    scoreBreakdown?: FantasyScoreBreakdown | null;
    isPublic?: boolean;
    shareImageVersion?: number;
    shareSlug?: string | null;
  } | null;
};

export type PredictionShareScope = "qualification" | "race";

export type PredictionShareDriverPick = {
  avatarUrl?: string | null;
  code?: string | null;
  id: string;
  name: string;
  number?: number | null;
  position?: number;
  slug?: string | null;
  team?: {
    code?: string | null;
    color?: string | null;
    name: string;
  } | null;
};

export type PredictionShareTeamPick = {
  code?: string | null;
  color?: string | null;
  id: string;
  name: string;
};

export type PublicPredictionShare = {
  authorUserId: string;
  id: string;
  displayName: string;
  leagueName: string | null;
  ogImageUrl: string;
  publicUrl: string;
  shareUrl: string;
  race: {
    id: string;
    name: string;
    round: number | null;
    season: number;
    startsAt: string | null;
  };
  scope: PredictionShareScope;
  shareImageUrl: string;
  shareImageVersion: number;
  shareSlug: string;
  heroDriver: PredictionShareDriverPick | null;
  heroTeam: PredictionShareTeamPick | null;
  heroColor: string;
  picks: {
    dnfKind: "driver" | "none";
    dnf: PredictionShareDriverPick | null;
    fastestLap: PredictionShareDriverPick | null;
    fastestPitStopTeam: PredictionShareTeamPick | null;
    pole: PredictionShareDriverPick | null;
    topScoringTeam: PredictionShareTeamPick | null;
    top10: PredictionShareDriverPick[];
  };
};

export type PredictionQualificationOutcome =
  | "correct"
  | "incorrect"
  | "not_submitted"
  | "pending";

export type PublicPredictionSharePageContext = {
  author: {
    globalRank: number | null;
    scoredPredictionCount: number;
    totalScore: number;
  };
  qualificationOutcome: PredictionQualificationOutcome;
  raceResult: {
    finished: boolean;
    points: number | null;
  };
};

export type GlobalFantasyLeaderboardRow = {
  rank: number;
  displayName: string;
  totalScore: number;
  predictionCount: number;
  scoredPredictionCount: number;
  averageScore: number;
  bestScore: number | null;
  bestBreakdown?: FantasyScoreBreakdown | null;
};

export type GlobalFantasyLeaderboard = {
  rows: GlobalFantasyLeaderboardRow[];
  updatedAt: string;
};

export type HomeOverview = {
  news: NewsItem[];
  standings: StandingRow[];
  adminSignals: AdminSignal[];
};
