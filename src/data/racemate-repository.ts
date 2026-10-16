import {
  createSupabaseAdminClient,
  createSupabasePublicClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { getSessionUser } from "@/lib/auth";
import { getPredictionLocksForRace } from "@/lib/prediction-locks";
import { withServerTtlCache } from "@/lib/server-ttl-cache";
import { withVerifiedReplayPitLane } from "@/lib/replay-pit-lane.mjs";
import { getSiteUrl, getSupabaseEnv } from "@/lib/env";
import { getRoundResultPoints } from "@/lib/f1-points";
import { getSocialMediaDeliveryUrl } from "@/lib/social-media-storage";
import { getOrCreatePredictionShareUrl } from "@/lib/share-links";
import { CURRENT_F1_SEASON } from "@/lib/season-navigation";
import { getDriverSeasonNumberOverride } from "@/lib/driver-season-number";
import { normalizeDailyDigestBody } from "@/lib/daily-digest-content";
import { getFantasyLeagueAvatarUrl } from "@/lib/fantasy-league-avatar";
import { formatGrandPrixNameRu, formatGrandPrixTagNameRu } from "@/lib/race-display";
import { formatRaceStatus } from "@/lib/race-status";
import { batchSupabaseIds } from "@/lib/supabase-query-batches";
import {
  classifySeasonGlobeEvents,
  formatSeasonGlobeDateLabel,
  formatSeasonGlobeWeekendLabel,
} from "@/lib/season-globe-data";
import {
  getPolymarketRaceMatchTerms,
  isPolymarketEventForRace,
} from "@/lib/polymarket-race-match";
import {
  buildDriverRoundSnapshots,
  rankDirectoryDrivers,
  type DriverComparisonRaceInput,
  type DriverComparisonStandingInput,
} from "@/lib/driver-comparison";
import {
  adminJobs,
  adminSignals,
  calendarEvents,
  nextSession,
  predictionPicks,
  standings,
  weekendSessions,
} from "@/data/racemate-overview";
import {
  getCircuitAsset,
  getVersionedCircuitMapUrl,
  getSeasonDriverAvatarPath,
  getTeamAsset,
  getTeamMatchNames,
  getTeamProfileAsset,
} from "@/data/f1-assets";
import { getFantasyTrackVisual } from "@/data/fantasy-track-assets";
import type {
  AdminJob,
  AdminDuplicateNews,
  AdminSocialPost,
  AdminDriver,
  AdminGrandPrixReport,
  AdminSignal,
  AdminSocialSource,
  AdminSource,
  AdminTeamOption,
  AiUsageSummary,
  CalendarEvent,
  ConstructorChampionOdds,
  ConstructorChampionshipMatrix,
  ConstructorStandingRow,
  CircuitStatsView,
  DailyDigest,
  DriverChampionshipMatrix,
  DriverComparisonDataset,
  DriverComparisonDriver,
  DriverChartPoint,
  DriverCumulativePointsSeries,
  DriverDirectoryDriver,
  DriverDirectoryTeam,
  DriverFormStats,
  DriverPositionDeltaStats,
  DriverProfile,
  DriverProfileNewsItem,
  DriverProfileSocialPost,
  DriverRaceResultRow,
  DriverSeasonStats,
  DriverTeammateComparison,
  FantasyScoreBreakdown,
  GrandPrixReport,
  GlobalFantasyLeaderboard,
  GlobalFantasyLeaderboardRow,
  FavoriteNewsFilters,
  LeagueDetail,
  LeagueHistoryEntry,
  LeagueMemberPrediction,
  LeagueSummary,
  NextSession,
  NewsItem,
  NewsListResult,
  NewsTagFilter,
  PollSummary,
  PredictionResultPick,
  PredictionQualificationOutcome,
  PredictionState,
  PredictionShareScope,
  PreviousPredictionTop10Pick,
  PublicPredictionShare,
  PublicPredictionSharePageContext,
  RaceDetail,
  RaceReplaySnapshot,
  RaceReplaySummary,
  RaceWinnerOdds,
  SeasonGlobeData,
  SeasonGlobePodiumEntry,
  SeasonChampionOdds,
  SessionResult,
  SessionWeather,
  SocialFeedResult,
  SocialFilterOptions,
  SocialMode,
  SocialPlatform,
  SocialPost,
  SocialTrendingTopic,
  StandingsMeta,
  StandingRow,
  TeamProfile,
  TeamProfileDriver,
  TeamProfileSummary,
  TeamRaceResultRow,
  TrackLayout,
  WeekendWeather,
  WeekendSession,
} from "@/types/racemate";

type SourceRelation = { name: string } | { name: string }[] | null;
type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;
type SocialPostDbRow = {
  id: string;
  platform: "x" | "reddit" | "telegram";
  author: string | null;
  title: string | null;
  body: string | null;
  ai_title_ru: string | null;
  ai_summary_ru: string | null;
  content_kind: SocialPost["contentKind"] | null;
  original_url: string;
  image_url: string | null;
  published_at: string | null;
  reaction_count: number | null;
  popularity_score: number | string | null;
  importance_score: number | null;
  comments_count: number | null;
  repost_count: number | null;
  view_count: number | null;
  social_sources: { name: string; trust_level: string } | { name: string; trust_level: string }[] | null;
  social_post_tags: {
    confidence: number;
    is_primary: boolean;
    tags: { name: string; slug: string; type: string } | { name: string; slug: string; type: string }[] | null;
  }[] | null;
  social_post_media: {
    id: string;
    media_type: string;
    url: string;
    preview_url: string | null;
    alt_text: string | null;
    width: number | null;
    height: number | null;
    sort_order: number;
  }[] | null;
};

type SocialSourceDbRow = {
  id: string;
  platform: "x" | "reddit" | "telegram";
  name: string;
  url: string;
  adapter: string;
  feed_kind: string | null;
  is_active: boolean;
  last_success_at: string | null;
  last_error: string | null;
  trust_level: "official" | "media" | "community";
  publication_mode: "auto" | "review";
  initial_backfill_days: number;
  metadata: { initialBackfillDays?: number } | null;
  next_fetch_at: string | null;
  rate_limited_until: string | null;
};

type GrandPrixReportDbRow = {
  id: string;
  season: number;
  round: number;
  race_slug: string;
  race_name: string;
  circuit_name: string | null;
  country: string | null;
  race_date: string | null;
  status: GrandPrixReport["status"];
  summary_status: string;
  ai_summary: string | null;
  weather: unknown;
  race_statistics: unknown;
  results: unknown;
  key_events: unknown;
  pit_stops: unknown;
  strategies: unknown;
  teammate_comparisons: unknown;
  highlights: unknown;
  championship_impact: unknown;
  news_summary: unknown;
  source_errors: unknown;
  generated_at: string | null;
};

type AdminGrandPrixReportDbRow = GrandPrixReportDbRow & {
  is_hidden: boolean;
  last_error: string | null;
  next_refresh_at: string | null;
};

type TagRelation =
  | {
      tags:
        | { name: string; slug: string | null; type?: string | null }
        | { name: string; slug: string | null; type?: string | null }[]
        | null;
    }
  | {
      tags:
        | { name: string; slug: string | null; type?: string | null }
        | { name: string; slug: string | null; type?: string | null }[]
        | null;
    }[];

type NewsFilterTagRow = {
  tags:
    | { name: string; slug: string | null; type?: string | null }
    | { name: string; slug: string | null; type?: string | null }[]
    | null;
};

type NewsTagAllowlist = {
  drivers: Set<string>;
  teams: Set<string>;
};

type ArticleRow = {
  editorial_meta?: NewsItem["editorial"];
  id: string;
  slug?: string | null;
  canonical_url: string;
  original_title: string;
  original_description: string | null;
  published_at: string | null;
  ai_title_ru: string | null;
  ai_summary_ru: string | null;
  ai_summary_long_ru: string | null;
  ai_highlights_ru?: string[] | null;
  image_url?: string | null;
  source_image_url?: string | null;
  raw_image_url?: string | null;
  raw_payload?: { content?: string | null; description?: string | null; imageUrl?: string | null } | null;
  related_race_id: string | null;
  news_sources: SourceRelation;
  news_article_tags: TagRelation | null;
  races: { race_name: string; season_year: number; round: number } | null;
};

type RaceRow = {
  id: string;
  season_year: number;
  round: number;
  race_name: string;
  race_start_at: string | null;
  status: string;
  tyre_hard_compound?: string | null;
  tyre_medium_compound?: string | null;
  tyre_soft_compound?: string | null;
  tyre_allocation_source_url?: string | null;
  tyre_allocation_updated_at?: string | null;
  circuits:
    | { id?: string | null; name: string; country?: string | null; locality?: string | null; external_id?: string | null; timezone?: string | null; latitude?: number | string | null; longitude?: number | string | null }
    | { id?: string | null; name: string; country?: string | null; locality?: string | null; external_id?: string | null; timezone?: string | null; latitude?: number | string | null; longitude?: number | string | null }[]
    | null;
  sessions?:
    | { id?: string; session_type: string | null; name: string | null; start_at?: string | null; end_at?: string | null; status?: string | null }
    | { id?: string; session_type: string | null; name: string | null; start_at?: string | null; end_at?: string | null; status?: string | null }[]
    | null;
};

type TeamRelationObject = {
  name: string;
  code?: string | null;
  color_hex?: string | null;
};

type StandingDbRow = {
  driver_id?: string;
  team_id?: string | null;
  round?: number | null;
  position: number | null;
  points: number | string;
  wins?: number | null;
  drivers:
    | { full_name: string; slug?: string | null; permanent_number?: number | null }
    | { full_name: string; slug?: string | null; permanent_number?: number | null }[]
    | null;
  teams: TeamRelationObject | TeamRelationObject[] | null;
};

type ConstructorStandingDbRow = {
  team_id?: string | null;
  round?: number | null;
  position: number | null;
  points: number | string;
  wins: number | null;
  teams: TeamRelationObject | TeamRelationObject[] | null;
};

type TeamProfileRelationObject = TeamRelationObject & {
  id?: string | null;
  short_name?: string | null;
  country?: string | null;
};

type TeamProfileStandingDbRow = {
  team_id: string | null;
  position: number | null;
  points: number | string;
  wins: number | null;
  teams: TeamProfileRelationObject | TeamProfileRelationObject[] | null;
};

type TeamProfileDriverStandingDbRow = {
  position: number | null;
  points: number | string;
  wins: number | null;
  drivers:
    | {
        id: string;
        full_name: string;
        slug: string | null;
        code: string | null;
        permanent_number: number | null;
        ai_avatar_url: string | null;
      }
    | {
        id: string;
        full_name: string;
        slug: string | null;
        code: string | null;
        permanent_number: number | null;
        ai_avatar_url: string | null;
      }[]
    | null;
};

type TeamLineageRelation = {
  id?: string | null;
  slug: string;
  display_name: string;
};

type TeamSeasonProfileDbRow = {
  season_year: number;
  team_id: string;
  lineage_id: string;
  display_name: string;
  short_name: string | null;
  code: string | null;
  country: string | null;
  color_hex: string | null;
  logo_image_url: string | null;
  car_image_url: string | null;
  team_lineages: TeamLineageRelation | TeamLineageRelation[] | null;
};

type DriverSeasonProfileDbRow = {
  season_year: number;
  driver_id: string;
  primary_team_id: string | null;
  code: string | null;
  permanent_number: number | null;
  avatar_image_url: string | null;
  drivers?: { slug: string | null } | { slug: string | null }[] | null;
};

type RaceTrackAssetDbRow = {
  race_id: string;
  image_url: string | null;
  is_verified: boolean;
};

type SessionDbRow = {
  id: string;
  session_type: string;
  name: string;
  start_at: string | null;
  status: string;
};

type SessionResultDbRow = {
  driver_id?: string | null;
  team_id?: string | null;
  position: number | null;
  time_text: string | null;
  status: string | null;
  grid: number | null;
  laps: number | null;
  points: number | string | null;
  raw_payload?: unknown;
  sessions:
    | { session_type: string }
    | { session_type: string }[]
    | null;
  drivers:
    | { full_name: string; slug?: string | null; permanent_number?: number | null }
    | { full_name: string; slug?: string | null; permanent_number?: number | null }[]
    | null;
  teams: TeamRelationObject | TeamRelationObject[] | null;
};

type DriverProfileDbRow = {
  id: string;
  slug: string | null;
  code: string | null;
  permanent_number: number | null;
  first_name: string;
  last_name: string;
  full_name: string;
  country: string | null;
  country_code: string | null;
  ai_avatar_url: string | null;
  avatar_placeholder_style: string | null;
  is_active?: boolean;
  current_team_id: string | null;
  teams: (TeamRelationObject & { id?: string | null }) | (TeamRelationObject & { id?: string | null })[] | null;
};

type DriverDirectoryProfileDbRow = {
  driver_id: string;
  primary_team_id: string | null;
  code: string | null;
  permanent_number: number | null;
  starts: number | null;
  avatar_image_url: string | null;
  drivers:
    | {
        id: string;
        slug: string | null;
        full_name: string;
        ai_avatar_url: string | null;
      }
    | {
        id: string;
        slug: string | null;
        full_name: string;
        ai_avatar_url: string | null;
      }[]
    | null;
};

type DriverDirectoryStandingDbRow = {
  driver_id: string;
  position: number | null;
  points: number | string;
  wins: number | null;
};

type DriverComparisonRaceDbRow = DriverRaceDbRow & {
  status: string | null;
};

type DriverComparisonSessionDbRow = DriverSessionDbRow & {
  status: string | null;
};

type DriverRaceDbRow = {
  id: string;
  season_year: number;
  round: number;
  race_name: string;
  race_start_at: string | null;
  circuits:
    | { name: string | null; country: string | null; locality?: string | null }
    | { name: string | null; country: string | null; locality?: string | null }[]
    | null;
};

type DriverSessionDbRow = {
  id: string;
  race_id: string;
  session_type: string;
  name: string;
  start_at: string | null;
  status?: string | null;
};

type DriverSessionResultDbRow = {
  session_id: string;
  driver_id: string | null;
  team_id: string | null;
  position: number | null;
  classified_position?: string | null;
  grid: number | null;
  points: number | string | null;
  status: string | null;
  time_text: string | null;
  raw_payload?: unknown;
  drivers: { full_name: string; slug?: string | null } | { full_name: string; slug?: string | null }[] | null;
  teams: TeamRelationObject | TeamRelationObject[] | null;
};

type DriverStandingHistoryDbRow = {
  round: number | null;
  position: number | null;
  points: number | string;
  wins: number | null;
  team_id: string | null;
  teams: TeamRelationObject | TeamRelationObject[] | null;
};

type DriverCumulativeStandingDbRow = {
  driver_id: string | null;
  round: number | null;
  position: number | null;
  points: number | string | null;
  drivers: { full_name: string; slug?: string | null } | { full_name: string; slug?: string | null }[] | null;
  teams: TeamRelationObject | TeamRelationObject[] | null;
};

type RaceRoundDbRow = {
  id: string;
  round: number;
};

type SessionRoundDbRow = {
  id: string;
  race_id: string;
  session_type: string;
};

type SessionResultPointsDbRow = {
  session_id: string;
  driver_id: string | null;
  position: number | null;
  team_id: string | null;
  points: number | string | null;
  status?: string | null;
  raw_payload?: unknown;
};

type RaceWinnerDbRow = {
  drivers: { full_name: string } | { full_name: string }[] | null;
  sessions:
    | { race_id: string; session_type: string }
    | { race_id: string; session_type: string }[]
    | null;
};

type SeasonGlobePodiumDbRow = {
  driver_id: string | null;
  team_id: string | null;
  position: number | null;
  status: string | null;
  raw_payload?: unknown;
  drivers:
    | { full_name: string; slug?: string | null; permanent_number?: number | null }
    | { full_name: string; slug?: string | null; permanent_number?: number | null }[]
    | null;
  teams: TeamRelationObject | TeamRelationObject[] | null;
  sessions:
    | { race_id: string; session_type: string }
    | { race_id: string; session_type: string }[]
    | null;
};

type DigestDbRow = {
  id: string;
  title: string;
  body_md: string;
  generated_at: string;
  status: string;
};

type WeatherDbRow = {
  temperature_c: number | string | null;
  wind_speed_kmh: number | string | null;
  precipitation_mm: number | string | null;
  observed_at: string | null;
};

type SessionWeatherDbRow = WeatherDbRow & {
  session_id: string;
  forecast_at: string | null;
};

type CircuitLayoutDbRow = {
  svg_path: string;
  view_box: string;
  provider: string;
  source_session_key: number | null;
};

type CircuitStatsCircuitDbRow = {
  id: string;
  slug?: string | null;
  name: string;
  country?: string | null;
  locality?: string | null;
  lap_length_km?: number | string | null;
  race_laps?: number | null;
  race_distance_km?: number | string | null;
  turns_count?: number | null;
  direction?: string | null;
  first_grand_prix_year?: number | null;
  lap_record_time?: string | null;
  lap_record_driver?: string | null;
  lap_record_year?: number | null;
  drs_zones_count?: number | null;
  track_type?: string | null;
  track_description?: string | null;
  overtaking_rating?: number | null;
  qualifying_importance_rating?: number | null;
  tyre_wear_rating?: number | null;
  safety_car_rating?: number | null;
  strategy_variability_rating?: number | null;
  rain_risk_rating?: number | null;
};

type CircuitStatsDbRow = {
  calculated_from_season: number | null;
  calculated_to_season: number | null;
  races_count: number;
  pole_win_rate: number | string | null;
  front_row_win_rate: number | string | null;
  winner_avg_start_position: number | string | null;
  avg_position_delta: number | string | null;
  avg_abs_position_delta: number | string | null;
  best_position_gain_json: unknown;
  worst_position_loss_json: unknown;
  avg_dnf_count: number | string | null;
  avg_pit_stops: number | string | null;
  avg_first_pit_lap: number | string | null;
  most_common_strategy: string | null;
  strategy_distribution: unknown;
  safety_car_frequency: number | string | null;
  vsc_frequency: number | string | null;
  red_flag_frequency: number | string | null;
  chaos_score: number | string | null;
  overtaking_level: string | null;
  qualifying_importance_level: string | null;
  strategy_variability_level: string | null;
  records_json: unknown;
  ai_preview: string | null;
  source_errors: unknown;
  calculated_at: string | null;
};

type CircuitHistoryDbRow = {
  season: number;
  round: number;
  race_name: string;
  race_date: string | null;
  winner_driver_id: string | null;
  winner_team_id: string | null;
  pole_driver_id: string | null;
  pole_team_id: string | null;
  winner_start_position: number | null;
  winner_from_pole: boolean | null;
  podium_json: unknown;
  dnf_count: number | null;
  safety_car_count: number | null;
  vsc_count: number | null;
  red_flag_count: number | null;
  source_errors?: unknown;
};

type CircuitDriverStatDbRow = {
  driver_id: string;
  starts: number;
  wins: number;
  podiums: number;
  points_finishes: number;
  dnfs: number;
  avg_start_position: number | string | null;
  avg_finish_position: number | string | null;
  best_finish: number | null;
};

type CircuitTeamStatDbRow = {
  team_id: string;
  starts: number;
  wins: number;
  podiums: number;
  points_finishes: number;
  avg_points: number | string | null;
  best_finish: number | null;
  double_points_finishes: number;
};

type StandingRoundRow = {
  season_year: number;
  round: number | null;
};

type RaceRoundVisualDbRow = {
  round: number;
  race_name: string;
  circuits:
    | { country?: string | null }
    | { country?: string | null }[]
    | null;
};

type JobDbRow = {
  job_name: string;
  status: string;
  items_processed: number;
  finished_at: string | null;
  started_at: string;
};

type SourceDbRow = {
  id: string;
  name: string;
  url: string;
  is_active: boolean;
  last_success_at: string | null;
  last_error: string | null;
};

type DriverOptionRow = {
  code: string | null;
  id: string;
  full_name: string;
  permanent_number?: number | null;
  slug: string | null;
  teams: { code: string | null; name: string } | { code: string | null; name: string }[] | null;
};

type FantasyStandingOptionRow = {
  position: number | null;
  drivers:
    | { code: string | null; id: string; full_name: string; permanent_number?: number | null; slug: string | null; teams: { code: string | null; name: string } | { code: string | null; name: string }[] | null }
    | { code: string | null; id: string; full_name: string; permanent_number?: number | null; slug: string | null; teams: { code: string | null; name: string } | { code: string | null; name: string }[] | null }[]
    | null;
  teams: { id: string; name: string; code: string | null } | { id: string; name: string; code: string | null }[] | null;
};

type TeamOptionRow = {
  id: string;
  name: string;
  code: string | null;
};

type DriverNameRow = {
  full_name: string;
  last_name: string;
};

type TeamNameRow = {
  name: string;
  short_name: string | null;
  code: string | null;
};

type PolymarketOutcomeKind = "race-winner" | "driver-champion" | "constructor-champion";

type PredictionDbRow = {
  pole_driver_id: string | null;
  winner_driver_id: string | null;
  fastest_lap_driver_id: string | null;
  dnf_driver_id: string | null;
  dnf_pick_kind?: string | null;
  top_scoring_team_id?: string | null;
  fastest_pit_stop_team_id?: string | null;
  top10_driver_ids?: string[] | null;
  score: number | null;
  score_breakdown?: unknown;
  is_public?: boolean | null;
  share_image_version?: number | null;
  share_slug?: string | null;
};

type PreviousPredictionDbRow = LeaguePredictionRow & {
  score_breakdown?: unknown;
};

type GlobalPredictionRow = {
  race_id: string;
  score: number | null;
  score_breakdown?: unknown;
  user_id: string;
};

type GlobalProfileRow = {
  display_name: string | null;
  id: string;
};

type LeagueDbRow = {
  avatar_path: string | null;
  avatar_updated_at: string | null;
  id: string;
  is_public?: boolean;
  owner_user_id: string;
  name: string;
  invite_code: string;
  profiles:
    | { display_name: string | null; email: string | null }
    | { display_name: string | null; email: string | null }[]
    | null;
};

type LeagueMemberRow = {
  league_id: string;
  user_id: string;
  role: string;
  joined_at: string;
};

type LeagueProfileRow = {
  id: string;
  display_name: string | null;
  email: string | null;
};

type LeaguePredictionRow = {
  user_id: string;
  race_id: string;
  pole_driver_id: string | null;
  winner_driver_id: string | null;
  fastest_lap_driver_id: string | null;
  dnf_driver_id: string | null;
  dnf_pick_kind?: string | null;
  top_scoring_team_id?: string | null;
  fastest_pit_stop_team_id?: string | null;
  top10_driver_ids?: string[] | null;
  score: number | null;
  score_breakdown?: unknown;
  scored_at: string | null;
  submitted_at: string;
  races:
    | { round: number; race_name: string; race_start_at: string | null; season_year?: number }
    | { round: number; race_name: string; race_start_at: string | null; season_year?: number }[]
    | null;
};

type NewsFavoriteDriverRow = {
  drivers:
    | {
        code: string | null;
        full_name: string | null;
        slug: string | null;
        teams:
          | { name: string | null; short_name: string | null; code: string | null }
          | { name: string | null; short_name: string | null; code: string | null }[]
          | null;
      }
    | {
        code: string | null;
        full_name: string | null;
        slug: string | null;
        teams:
          | { name: string | null; short_name: string | null; code: string | null }
          | { name: string | null; short_name: string | null; code: string | null }[]
          | null;
      }[]
    | null;
};

type NewsFavoriteTeamRow = {
  teams:
    | { name: string | null; short_name: string | null; code: string | null }
    | { name: string | null; short_name: string | null; code: string | null }[]
    | null;
};

type PollDbRow = {
  id: string;
  race_id: string | null;
  question: string;
  status: string;
  closes_at: string | null;
  poll_kind: string | null;
  races:
    | {
        id: string;
        season_year: number;
        round: number;
        race_name: string;
        circuits:
          | { name: string | null; country: string | null }
          | { name: string | null; country: string | null }[]
          | null;
      }
    | {
        id: string;
        season_year: number;
        round: number;
        race_name: string;
        circuits:
          | { name: string | null; country: string | null }
          | { name: string | null; country: string | null }[]
          | null;
      }[]
    | null;
  poll_options:
    | { id: string; label: string }[]
    | null;
};

type PolymarketMarket = {
  id?: string | number;
  question?: string;
  title?: string;
  slug?: string;
  groupItemTitle?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  outcomes?: string[] | string;
  outcomePrices?: string[] | string;
  volumeNum?: number;
  volume?: number | string;
  volume24hr?: number | string;
  liquidityNum?: number;
  updatedAt?: string;
  events?: { title?: string; slug?: string }[];
};

type PolymarketEvent = {
  id?: string | number;
  title?: string;
  slug?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  startDate?: string;
  endDate?: string;
  updatedAt?: string;
  volume?: number | string;
  volume24hr?: number | string;
  liquidity?: number | string;
  markets?: PolymarketMarket[];
};

type PolymarketEventsResponse = {
  events?: PolymarketEvent[];
};

const POLYMARKET_F1_TAG_ID = "435";
const POLYMARKET_EVENT_LIMIT = "20";
const POLYMARKET_CACHE_TTL_MS = 2 * 60 * 1000;

let polymarketEventsCache: { events: PolymarketEvent[]; expiresAt: number } | null = null;
let polymarketEventsInFlight: Promise<PolymarketEvent[]> | null = null;

const NEWS_ARTICLE_SELECT =
  "id, slug, canonical_url, original_title, original_description, published_at, ai_title_ru, ai_summary_ru, ai_summary_long_ru, ai_highlights_ru, image_url, source_image_url, raw_payload, related_race_id, news_sources(name), news_article_tags(tags(name, slug, type)), races:related_race_id(race_name, season_year, round)";
const NEWS_CARD_SELECT =
  "id, slug, canonical_url, original_title, original_description, published_at, ai_title_ru, ai_summary_ru, source_image_url, raw_image_url:raw_payload->>imageUrl, related_race_id, news_sources(name), news_article_tags(tags(name, slug, type)), races:related_race_id(race_name, season_year, round)";
const LEGACY_NEWS_CARD_SELECT =
  "id, canonical_url, original_title, original_description, published_at, ai_title_ru, ai_summary_ru, related_race_id, news_sources(name), news_article_tags(tags(name, slug, type)), races:related_race_id(race_name, season_year, round)";
const LEGACY_NEWS_ARTICLE_SELECT =
  "id, canonical_url, original_title, original_description, published_at, ai_title_ru, ai_summary_ru, ai_summary_long_ru, related_race_id, news_sources(name), news_article_tags(tags(name, slug, type)), races:related_race_id(race_name, season_year, round)";
const NEWS_ARTICLE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GRAND_PRIX_REPORT_SELECT =
  "id, season, round, race_slug, race_name, circuit_name, country, race_date, status, summary_status, ai_summary, weather, race_statistics, results, key_events, pit_stops, strategies, teammate_comparisons, highlights, championship_impact, news_summary, source_errors, generated_at";

type NewsItemsOptions = {
  /** Only paginated lists need a database-wide exact count. */
  includeTotal?: boolean;
  page?: number;
  pageSize?: number;
  search?: string;
  tagSlug?: string;
  tagSlugs?: string[];
  race?: string;
};

export async function getSitemapNewsEntries(): Promise<
  Array<{ publishedAt: string | null; modifiedAt?: string | null; slug: string }>
> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const entries: Array<{ publishedAt: string | null; modifiedAt?: string | null; slug: string }> = [];
  const pageSize = 1_000;

  for (let from = 0; from < 48_000; from += pageSize) {
    let { data, error } = await supabase
      .from("news_articles")
      .select("id, slug, published_at, content_modified_at")
      .eq("status", "processed")
      .eq("publication_status", "published")
      .or("ai_model.is.null,ai_model.neq.fallback")
      .is("duplicate_of", null)
      .order("published_at", { ascending: false, nullsFirst: false })
      .range(from, from + pageSize - 1);

    if (error && /content_modified_at/.test(error.message)) {
      const fallback = await supabase.from("news_articles").select("id, slug, published_at")
        .eq("status", "processed").eq("publication_status", "published")
        .or("ai_model.is.null,ai_model.neq.fallback").is("duplicate_of", null)
        .order("published_at", { ascending: false, nullsFirst: false }).range(from, from + pageSize - 1);
      data = fallback.data as typeof data;
      error = fallback.error;
    }

    if (error && isMissingNewsArticleColumnsError(error)) {
      const fallback = await supabase
        .from("news_articles")
        .select("id, published_at")
        .eq("status", "processed")
        .eq("publication_status", "published")
        .or("ai_model.is.null,ai_model.neq.fallback")
        .is("duplicate_of", null)
        .order("published_at", { ascending: false, nullsFirst: false })
        .range(from, from + pageSize - 1);

      data = fallback.data as typeof data;
      error = fallback.error;
    }

    if (error || !data?.length) {
      break;
    }

    entries.push(
      ...data.map((row) => ({
        publishedAt: row.published_at,
        modifiedAt: row.content_modified_at && Date.parse(row.content_modified_at) > Date.parse(row.published_at ?? "") ? row.content_modified_at : row.published_at,
        slug: row.slug ?? row.id,
      })),
    );

    if (data.length < pageSize) {
      break;
    }
  }

  return entries;
}

export async function getNewsItems(
  input: number | NewsItemsOptions = {},
): Promise<NewsListResult> {
  const supabase = await createSupabaseServerClient();
  const options = typeof input === "number" ? { pageSize: input } : input;
  const pageSize = Math.max(1, Math.min(options.pageSize ?? 20, 50));
  const page = Math.max(1, options.page ?? 1);
  const search = normalizeNewsSearch(options.search);

  if (!supabase) {
    return emptyNewsList(page);
  }

  const activeNewsTagAllowlist = await getCurrentNewsTagAllowlist();
  let filterTagIds: string[] | null = null;
  const explicitTagListRequested = Array.isArray(options.tagSlugs);

  const requestedTagSlugs = [
    ...(options.tagSlug ? [options.tagSlug] : []),
    ...(options.tagSlugs ?? []),
  ].filter(Boolean);

  if (explicitTagListRequested && !requestedTagSlugs.length) {
    return emptyNewsList(page);
  }

  if (requestedTagSlugs.length) {
    const uniqueTagSlugs = [...new Set(requestedTagSlugs)].filter((slug) => {
      if (slug.startsWith("driver-")) {
        return activeNewsTagAllowlist.drivers.has(slug);
      }

      if (slug.startsWith("team-")) {
        return activeNewsTagAllowlist.teams.has(slug);
      }

      return true;
    });

    if (!uniqueTagSlugs.length) {
      return emptyNewsList(page);
    }

    const { data: tags } = await supabase
      .from("tags")
      .select("id")
      .in("slug", uniqueTagSlugs);

    filterTagIds = [...new Set((tags ?? []).map((row) => row.id).filter(Boolean))];

    if (!filterTagIds.length) {
      return emptyNewsList(page);
    }
  }

  let raceId: string | null = null;

  if (options.race) {
    const parsedRace = parseRaceFilter(options.race);

    if (!parsedRace) {
      return emptyNewsList(page);
    }

    const { data: race } = await supabase
      .from("races")
      .select("id")
      .eq("season_year", parsedRace.season)
      .eq("round", parsedRace.round)
      .maybeSingle();

    if (!race?.id) {
      return emptyNewsList(page);
    }

    raceId = race.id;
  }

  const buildQuery = (select: string) => {
    const querySelect = filterTagIds
      ? `${select}, filter_tags:news_article_tags!inner(tag_id)`
      : select;
    let baseQuery = supabase
      .from("news_articles")
      .select(querySelect, options.includeTotal === false ? undefined : { count: "exact" })
      .eq("status", "processed")
      .eq("publication_status", "published")
      .or("ai_model.is.null,ai_model.neq.fallback")
      .is("duplicate_of", null)
      .order("published_at", { ascending: false, nullsFirst: false });

    if (filterTagIds) {
      baseQuery = baseQuery.in("filter_tags.tag_id", filterTagIds);
    }

    if (raceId) {
      baseQuery = baseQuery.eq("related_race_id", raceId);
    }

    if (search) {
      const pattern = `%${search.split(/\s+/).join("%")}%`;
      baseQuery = baseQuery.or([
        `ai_title_ru.ilike.${pattern}`,
        `original_title.ilike.${pattern}`,
        `ai_summary_ru.ilike.${pattern}`,
        `ai_summary_long_ru.ilike.${pattern}`,
        `original_description.ilike.${pattern}`,
      ].join(","));
    }

    return baseQuery;
  };

  const from = (page - 1) * pageSize;
  let { data, error, count } = await buildQuery(NEWS_CARD_SELECT).range(
    from,
    from + pageSize - 1,
  );

  if (error && isMissingNewsArticleColumnsError(error)) {
    const fallback = await buildQuery(LEGACY_NEWS_CARD_SELECT).range(
      from,
      from + pageSize - 1,
    );

    data = fallback.data;
    error = fallback.error;
    count = fallback.count;
  }

  if (error) {
    return emptyNewsList(page);
  }

  const rows = (data ?? []) as unknown as ArticleRow[];
  const [editorialResult] = await Promise.all([
    rows.length ? supabase.from("news_articles").select("id,editorial_meta").in("id", rows.map(row => row.id)) : Promise.resolve({ data: [] }),
    fillLegacyNewsCardImages(supabase, rows),
  ]);
  const metadata = new Map((editorialResult.data ?? []).map(row => [row.id, row.editorial_meta]));
  for (const row of rows) row.editorial_meta = metadata.get(row.id) as NewsItem["editorial"];
  const totalCount = count ?? rows.length;

  return {
    items: rows.map((row) => mapArticleRow(row, activeNewsTagAllowlist)),
    page,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    totalCount,
  };
}

async function fillLegacyNewsCardImages(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  rows: ArticleRow[],
) {
  const missing = rows.filter((row) => !getNewsImageUrl(row));
  if (!missing.length) return;

  const { data } = await supabase
    .from("news_articles")
    .select("id, raw_payload")
    .in("id", missing.map((row) => row.id));
  const payloads = new Map((data ?? []).map((row) => [row.id, row.raw_payload]));

  for (const row of missing) {
    row.raw_payload = payloads.get(row.id) as ArticleRow["raw_payload"];
  }
}

function normalizeNewsSearch(value?: string) {
  const normalized = value
    ?.normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);

  return normalized || null;
}

export async function getNewsDriverTags(): Promise<{ name: string; slug: string }[]> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("news_article_tags")
    .select("tags!inner(name, slug, type), news_articles!inner(status, publication_status, duplicate_of)")
    .eq("tags.type", "driver")
    .eq("news_articles.status", "processed")
    .eq("news_articles.publication_status", "published")
    .is("news_articles.duplicate_of", null)
    .limit(300);

  if (error || !data?.length) {
    return [];
  }

  const tagAllowlist = await getCurrentNewsTagAllowlist();

  return uniqueNewsTagFilters(
    ((data ?? []) as unknown as NewsFilterTagRow[])
      .flatMap((row) => getRelationList(row.tags))
      .filter(isNewsFilterTag)
      .filter((tag) => tagAllowlist.drivers.has(tag.slug))
      .map((tag) => ({ name: tag.name, slug: tag.slug })),
  ).sort((left, right) => left.name.localeCompare(right.name, "ru"));
}

export async function getNewsTeamTags(): Promise<{ name: string; slug: string }[]> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("news_article_tags")
    .select("tags!inner(name, slug, type), news_articles!inner(status, publication_status, duplicate_of)")
    .eq("tags.type", "team")
    .eq("news_articles.status", "processed")
    .eq("news_articles.publication_status", "published")
    .is("news_articles.duplicate_of", null)
    .limit(300);

  if (error || !data?.length) {
    return [];
  }

  const tagAllowlist = await getCurrentNewsTagAllowlist();

  return uniqueNewsTagFilters(
    ((data ?? []) as unknown as NewsFilterTagRow[])
      .flatMap((row) => getRelationList(row.tags))
      .filter(isNewsFilterTag)
      .filter((tag) => tagAllowlist.teams.has(tag.slug))
      .map((tag) => ({ name: tag.name, slug: tag.slug })),
  ).sort((left, right) => left.name.localeCompare(right.name, "ru"));
}

export async function getFavoriteNewsFilters(
  userId?: string | null,
): Promise<FavoriteNewsFilters> {
  return getFavoriteFilters(userId, { includeDriverTeams: true });
}

export async function getFavoriteSocialFilters(
  userId?: string | null,
): Promise<FavoriteNewsFilters> {
  return getFavoriteFilters(userId, { includeDriverTeams: false });
}

async function getFavoriteFilters(
  userId: string | null | undefined,
  { includeDriverTeams }: { includeDriverTeams: boolean },
): Promise<FavoriteNewsFilters> {
  if (!userId) {
    return { drivers: [], teams: [] };
  }

  const supabase = createSupabaseAdminClient() ?? await createSupabaseServerClient();

  if (!supabase) {
    return { drivers: [], teams: [] };
  }

  const [driversResult, teamsResult] = await Promise.all([
    supabase
      .from("user_favorite_drivers")
      .select("drivers(full_name, slug, code, teams:current_team_id(name, short_name, code))")
      .eq("user_id", userId),
    supabase
      .from("user_favorite_teams")
      .select("teams(name, short_name, code)")
      .eq("user_id", userId),
  ]);

  const teamMap = new Map<string, NewsTagFilter>();
  const drivers: NewsTagFilter[] = [];

  ((driversResult.data ?? []) as unknown as NewsFavoriteDriverRow[])
    .map((row) => getRelationObject(row.drivers))
    .forEach((driver) => {
      if (!driver) {
        return;
      }

      const fullName = driver?.full_name?.trim();

      if (!fullName) {
        return;
      }

      const team = getRelationObject(driver.teams);
      const teamName = team?.name?.trim();
      const teamCode = team?.code ?? undefined;

      if (includeDriverTeams && team && teamName) {
        getTeamNewsTagSlugs(team).forEach((teamSlug) => {
          teamMap.set(teamSlug, { name: getTeamAsset(teamCode)?.name ?? teamName, slug: teamSlug });
        });
      }

      getDriverNewsTagSlugs(driver).forEach((slug) => {
        drivers.push({
          name: fullName,
          slug,
        });
      });
    });

  ((teamsResult.data ?? []) as unknown as NewsFavoriteTeamRow[]).forEach((row) => {
    const team = getRelationObject(row.teams);

    if (!team) {
      return;
    }

    const teamName = team?.name?.trim();

    if (!teamName) {
      return;
    }

    getTeamNewsTagSlugs(team).forEach((teamSlug) => {
      teamMap.set(teamSlug, { name: getTeamAsset(team.code)?.name ?? teamName, slug: teamSlug });
    });
  });

  return {
    drivers: uniqueNewsTagFiltersBySlug(drivers),
    teams: uniqueNewsTagFiltersBySlug([...teamMap.values()]),
  };
}

export function getSocialPosts(input: Parameters<typeof getSocialPostsUncached>[0]): Promise<SocialFeedResult> {
  if (input.mode === "mine") return getSocialPostsUncached(input);

  const { cursor, pageSize = 12, platform = "all", mode = "main", topic, team, driver, race } = input;
  return withServerTtlCache(
    `public:social:${JSON.stringify([cursor ?? null, pageSize, platform, mode, topic ?? null, team ?? null, driver ?? null, race ?? null])}`,
    30_000,
    () => getSocialPostsUncached(input),
    { staleWhileRevalidateMs: 2 * 60_000 },
  );
}

async function getSocialPostsUncached({
  cursor,
  pageSize = 12,
  platform = "all",
  mode = "main",
  topic,
  team,
  driver,
  race,
}: {
  cursor?: string | null;
  pageSize?: number;
  platform?: SocialPlatform;
  mode?: SocialMode;
  topic?: string | null;
  team?: string | null;
  driver?: string | null;
  race?: string | null;
}): Promise<SocialFeedResult> {
  const supabase = createSupabaseAdminClient() ?? await createSupabaseServerClient();

  if (!supabase) {
    return { items: [], nextCursor: null };
  }

  if (!(["all", "x", "reddit", "telegram"] as const).includes(platform)) {
    return { items: [], nextCursor: null };
  }

  const limit = Math.min(Math.max(pageSize, 1), 30);
  const cursorValue = decodeSocialCursor(cursor);
  const selectedSlugs = [topic, team, driver, race].filter(isSafeSocialSlug);

  if (mode === "mine") {
    const user = await getSessionUser();

    if (!user) {
      return { items: [], nextCursor: null };
    }

    const favorites = await getFavoriteSocialFilters(user.id);
    const favoriteSlugs = [...favorites.drivers, ...favorites.teams].map((item) => item.slug);

    if (!favoriteSlugs.length) {
      return { items: [], nextCursor: null };
    }

    const favoritePostIds = await getSocialPostIdsForAnyTag(supabase, favoriteSlugs);
    if (!favoritePostIds.length) {
      return { items: [], nextCursor: null };
    }
    selectedSlugs.push(`__ids:${favoritePostIds.join(",")}`);
  }

  const requiredPostIdSets: string[][] = [];
  for (const slug of selectedSlugs.filter((value) => !value.startsWith("__ids:"))) {
    requiredPostIdSets.push(await getSocialPostIdsForAnyTag(supabase, [slug]));
  }
  const favoriteIds = selectedSlugs.find((value) => value.startsWith("__ids:"))?.slice(6).split(",").filter(Boolean);
  if (favoriteIds) {
    requiredPostIdSets.push(favoriteIds);
  }
  const filteredPostIds = intersectSocialPostIds(requiredPostIdSets);

  if (requiredPostIdSets.length && !filteredPostIds.length) {
    return { items: [], nextCursor: null };
  }

  let query = supabase
    .from("social_posts")
    .select(
      "id, platform, author, title, body, ai_title_ru, ai_summary_ru, content_kind, original_url, image_url, published_at, reaction_count, popularity_score, importance_score, comments_count, repost_count, view_count, social_sources(name, trust_level), social_post_tags(confidence, is_primary, tags(name, slug, type)), social_post_media(id, media_type, url, preview_url, alt_text, width, height, sort_order)",
    )
    .eq("status", "published")
    .is("duplicate_of", null);

  if (platform !== "all") {
    query = query.eq("platform", platform);
  }

  if (filteredPostIds.length) {
    query = query.in("id", filteredPostIds);
  }

  if (cursorValue) {
    query = query.or(
      `published_at.lt.${cursorValue.publishedAt},and(published_at.eq.${cursorValue.publishedAt},id.lt.${cursorValue.id})`,
    );
  }

  const { data, error } = await query
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (error || !data) {
    return { items: [], nextCursor: null };
  }

  const rows = data as unknown as SocialPostDbRow[];
  const pageRows = rows.slice(0, limit);
  const items = pageRows.map(mapSocialPostRow);

  const lastRow = pageRows.at(-1);

  return {
    items,
    nextCursor:
      rows.length > limit && lastRow?.published_at
        ? encodeSocialCursor(lastRow.published_at, lastRow.id)
        : null,
  };
}

export function normalizeSocialPlatform(value?: string | null): SocialPlatform {
  return value === "x" || value === "reddit" || value === "telegram" ? value : "all";
}

export function normalizeSocialMode(value?: string | null): SocialMode {
  return value === "fresh" || value === "mine" ? value : "main";
}

export function getSocialFilterOptions(): Promise<SocialFilterOptions> {
  return withServerTtlCache("public:social:filters", 60_000, loadSocialFilterOptions, {
    staleWhileRevalidateMs: 5 * 60_000,
  });
}

async function loadSocialFilterOptions(): Promise<SocialFilterOptions> {
  const [drivers, teams] = await Promise.all([getNewsDriverTags(), getNewsTeamTags()]);
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return { topics: [], teams: teams.map(mapSocialFilterOption), drivers: drivers.map(mapSocialFilterOption), races: [] };
  }

  const { data } = await supabase
    .from("social_post_tags")
    .select("tags!inner(name, slug, type), social_posts!inner(status, duplicate_of)")
    .eq("social_posts.status", "published")
    .is("social_posts.duplicate_of", null)
    .limit(500);
  const tags = ((data ?? []) as unknown as { tags: { name: string; slug: string; type: string } | { name: string; slug: string; type: string }[] }[])
    .flatMap((row) => getRelationList(row.tags));
  const optionsFor = (type: string) => uniqueNewsTagFiltersBySlug(
    tags.filter((tag) => tag.type === type).map((tag) => ({
      name: type === "race" ? formatGrandPrixTagNameRu(tag.name) : tag.name,
      slug: tag.slug,
    })),
  ).map(mapSocialFilterOption);

  return {
    topics: optionsFor("social_topic"),
    teams: teams.map(mapSocialFilterOption),
    drivers: drivers.map(mapSocialFilterOption),
    races: optionsFor("race"),
  };
}

export async function getSocialTrendingTopics(): Promise<SocialTrendingTopic[]> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return [];
  }
  const since = new Date(Date.now() - 48 * 60 * 60 * 1_000).toISOString();
  const { data } = await supabase
    .from("social_post_tags")
    .select("tags!inner(name, slug, type), social_posts!inner(status, duplicate_of, published_at)")
    .eq("tags.type", "social_topic")
    .eq("social_posts.status", "published")
    .is("social_posts.duplicate_of", null)
    .gte("social_posts.published_at", since)
    .limit(500);
  const counts = new Map<string, SocialTrendingTopic>();
  for (const row of (data ?? []) as unknown as { tags: { name: string; slug: string; type: string } | { name: string; slug: string; type: string }[] }[]) {
    for (const tag of getRelationList(row.tags)) {
      const current = counts.get(tag.slug);
      counts.set(tag.slug, { label: tag.name, slug: tag.slug, posts: (current?.posts ?? 0) + 1 });
    }
  }
  return [...counts.values()].sort((left, right) => right.posts - left.posts).slice(0, 6);
}

export async function getLatestGrandPrixReport(): Promise<GrandPrixReport | null> {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return null;
  }

  const reportSelect = "id, season_year, round, race_name, race_start_at, status, circuits(name, country)";
  const latestStanding = await getLatestCompleteStandingRound(
    "driver_standings",
    20,
    CURRENT_F1_SEASON,
  );
  let race: RaceRow | null = null;

  if (latestStanding?.round) {
    const { data: standingRaceData } = await admin
      .from("races")
      .select(reportSelect)
      .eq("season_year", latestStanding.season_year)
      .eq("round", latestStanding.round)
      .limit(1)
      .maybeSingle();

    const standingRace = (standingRaceData as unknown as RaceRow | null) ?? null;

    if (standingRace && isRaceCompletedByStandings(standingRace, latestStanding)) {
      race = standingRace;
    }
  }

  if (!race) {
    const { data: completedRaceData, error: completedRaceError } = await admin
      .from("races")
      .select(reportSelect)
      .eq("season_year", CURRENT_F1_SEASON)
      .eq("status", "completed")
      .order("race_start_at", { ascending: false, nullsFirst: false })
      .limit(8);

    if (!completedRaceError) {
      race =
        ((completedRaceData as unknown as RaceRow[] | null) ?? []).find((row) =>
          hasRaceCompletionWindowElapsed(row.race_start_at),
        ) ?? null;
    }
  }

  if (!race) {
    return null;
  }

  const { data, error } = await admin
    .from("grand_prix_reports")
    .select(GRAND_PRIX_REPORT_SELECT)
    .eq("season", race.season_year)
    .eq("round", race.round)
    .eq("is_hidden", false)
    .limit(1)
    .maybeSingle();

  if (!error && data) {
    return mapGrandPrixReportRow(data as unknown as GrandPrixReportDbRow);
  }

  return mapGrandPrixReportPlaceholder(race);
}

export async function getRaceGrandPrixReport(
  season: number,
  round: number,
): Promise<GrandPrixReport | null> {
  if (season !== CURRENT_F1_SEASON) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("grand_prix_reports")
    .select(GRAND_PRIX_REPORT_SELECT)
    .eq("season", season)
    .eq("round", round)
    .eq("is_hidden", false)
    .in("status", ["ready", "partial"])
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return mapGrandPrixReportRow(data as unknown as GrandPrixReportDbRow);
}

export async function getGrandPrixReportBySlug(
  slug?: string | null,
): Promise<GrandPrixReport | null> {
  const supabase = await createSupabaseServerClient();

  if (!supabase || !slug) {
    return null;
  }

  const { data, error } = await supabase
    .from("grand_prix_reports")
    .select(GRAND_PRIX_REPORT_SELECT)
    .eq("season", CURRENT_F1_SEASON)
    .eq("race_slug", slug)
    .eq("is_hidden", false)
    .in("status", ["ready", "partial"])
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return mapGrandPrixReportRow(data as unknown as GrandPrixReportDbRow);
}

async function getNextSessionUncached(): Promise<NextSession> {
  const race = await getCurrentRace();
  const sessions = await getWeekendSessions();
  const first =
    sessions.find((session) => session.status === "Live") ??
    sessions.find((session) => session.status === "Ожидается") ??
    sessions.find((session) => session.status !== "Завершена") ??
    sessions.at(-1) ??
    sessions[0];

  if (!first) {
    return nextSession;
  }

  return {
    ...nextSession,
    race: formatGrandPrixNameRu(race?.race_name ?? nextSession.race),
    circuit: getRelationName(race?.circuits ?? null, nextSession.circuit),
    session: first.name,
    startsAt: first.startsAt,
    startsAtIso: first.startsAtIso,
    status: getWeekendRuntimeStatus(sessions),
  };
}

export const getNextSession = cache(() =>
  withServerTtlCache(
    "public:next-session",
    3_000,
    getNextSessionUncached,
    { staleWhileRevalidateMs: 0 },
  ),
);

export async function getPublishedSeasons(): Promise<number[]> {
  return getPublishedSeasonsCached();
}

const getPublishedSeasonsCached = cache(async (): Promise<number[]> => {
  const user = await getSessionUser();
  const load = async () => {
    const supabase = user ? await createSupabaseServerClient() : createSupabasePublicClient();

    if (!supabase) {
      return [2026];
    }

    const { data, error } = await supabase
      .from("seasons")
      .select("year")
      .order("year", { ascending: false });

    if (error) {
      // Keep the pre-history deployment usable while the publication migration is
      // being rolled out. Historical years are never exposed through this fallback.
      return [2026];
    }

    // Publication and preview access are deliberately enforced by RLS. Public
    // sessions receive only published years, while an authenticated admin can
    // inspect hidden backfilled seasons through the same cookie-aware client.
    // Keeping this query free of an is_published filter is what makes that
    // preview possible without exposing the service-role key to the app.

    return (data ?? [])
      .map((row) => Number(row.year))
      .filter((year) => Number.isInteger(year));
  };

  return user ? load() : withServerTtlCache("public:published-seasons", 60_000, load);
});

async function resolvePublishedSeason(season: number): Promise<number | null> {
  const publishedSeasons = await getPublishedSeasons();

  return publishedSeasons.includes(season) ? season : null;
}

export async function getCalendarEvents(season: number): Promise<CalendarEvent[]> {
  const selectedSeason = await resolvePublishedSeason(season);

  if (selectedSeason === null) {
    return [];
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return selectedSeason === 2026 ? calendarEvents : [];
  }

  const { data, error } = await supabase
    .from("races")
    .select("id, season_year, round, race_name, race_start_at, status, circuits(id, name, country, locality, external_id), sessions(session_type, name)")
    .eq("season_year", selectedSeason)
    .order("round", { ascending: true });

  if (error || !data?.length) {
    return selectedSeason === 2026 ? calendarEvents : [];
  }

  const races = data as unknown as RaceRow[];
  const [currentRace, winners, latestStanding, trackAssets] = await Promise.all([
    getCurrentRace("id, season_year, round, race_name, race_start_at, status"),
    getRaceWinners(races.map((race) => race.id)),
    getLatestCompleteStandingRound("driver_standings", 20, selectedSeason),
    getRaceTrackAssetsByRaceIds(races.map((race) => race.id)),
  ]);

  return races.map((race) =>
    mapCalendarRace(
      race,
      race.id === currentRace?.id,
      winners.get(race.id),
      isRaceCompletedByStandings(race, latestStanding),
      trackAssets.get(race.id)?.image_url ?? (selectedSeason === 2026 ? undefined : null),
    ),
  );
}

export async function getSeasonGlobeData(season: number): Promise<SeasonGlobeData> {
  const selectedSeason = await resolvePublishedSeason(season);

  if (selectedSeason === null) {
    return { season, nextRound: null, events: [] };
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return buildFallbackSeasonGlobeData(selectedSeason);
  }

  const { data, error } = await supabase
    .from("races")
    .select(
      "id, season_year, round, race_name, race_start_at, status, circuits(id, name, country, locality, latitude, longitude, timezone), sessions(id, session_type, name, start_at, end_at, status)",
    )
    .eq("season_year", selectedSeason)
    .order("round", { ascending: true });

  if (error || !data?.length) {
    return buildFallbackSeasonGlobeData(selectedSeason);
  }

  const races = data as unknown as RaceRow[];
  const raceIds = races.map((race) => race.id);
  const [podiumsByRace, latestStanding] = await Promise.all([
    getSeasonGlobePodiums(supabase, selectedSeason, raceIds),
    getLatestCompleteStandingRound("driver_standings", 20, selectedSeason),
  ]);
  const classified = classifySeasonGlobeEvents(
    races.map((race) => {
      const circuit = getRelationObject(race.circuits);
      const sessions = getRelationList(race.sessions);
      const sessionStarts = sessions
        .map((session) => session.start_at ?? null)
        .filter((value): value is string => Boolean(value))
        .sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
      const weekendStartAtIso = sessionStarts[0] ?? race.race_start_at;
      const raceSession = sessions.find((session) => session.session_type === "race");
      const podium = podiumsByRace.get(race.id) ?? [];
      const completed =
        isCompletedSportStatus(race.status) ||
        podium.length > 0 ||
        isRaceCompletedByStandings(race, latestStanding);

      return {
        id: race.id,
        season: race.season_year,
        round: race.round,
        raceName: formatGrandPrixNameRu(race.race_name),
        circuitName: circuit?.name ?? "Трасса уточняется",
        country: circuit?.country ?? "Страна уточняется",
        countryCode: getCountryCode(circuit?.country ?? "") ?? null,
        latitude: parseSeasonGlobeCoordinate(circuit?.latitude, -90, 90),
        longitude: parseSeasonGlobeCoordinate(circuit?.longitude, -180, 180),
        weekendStartAtIso,
        raceStartAtIso: race.race_start_at,
        raceEndAtIso: raceSession?.end_at ?? null,
        weekendDateLabel: formatSeasonGlobeWeekendLabel(
          weekendStartAtIso,
          race.race_start_at,
        ),
        raceDateLabel: formatSeasonGlobeDateLabel(race.race_start_at),
        isLive: sessions.some((session) => isLiveSportStatus(session.status)),
        href: `/calendar/${race.season_year}/${race.round}`,
        podium,
        completed,
      };
    }),
  );

  return {
    season: selectedSeason,
    nextRound: classified.nextRound,
    events: classified.events.map(toPublicSeasonGlobeEvent),
  };
}

async function getSeasonGlobePodiums(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  season: number,
  raceIds: string[],
) {
  const podiumsByRace = new Map<string, SeasonGlobePodiumEntry[]>();

  if (!raceIds.length) {
    return podiumsByRace;
  }

  const { data, error } = await supabase
    .from("session_results")
    .select(
      "driver_id, team_id, position, status, raw_payload, drivers(full_name, slug, permanent_number), teams(name, code, color_hex), sessions!inner(race_id, session_type)",
    )
    .eq("sessions.session_type", "race")
    .in("sessions.race_id", raceIds)
    .in("position", [1, 2, 3])
    .order("position", { ascending: true, nullsFirst: false });

  if (error || !data?.length) {
    return podiumsByRace;
  }

  const rows = (data as unknown as SeasonGlobePodiumDbRow[]).filter(
    (row) => !isLapOnlyResult(row) && row.position !== null,
  );
  const driverIds = [
    ...new Set(rows.map((row) => row.driver_id).filter((id): id is string => Boolean(id))),
  ];
  const seasonProfiles = await getDriverSeasonProfilesByIds(supabase, season, driverIds);
  const seenDriversByRace = new Map<string, Set<string>>();
  const seenPositionsByRace = new Map<string, Set<number>>();

  rows.forEach((row) => {
    const session = getRelationObject(row.sessions);
    const position = row.position;

    if (!session?.race_id || position === null || position < 1 || position > 3) {
      return;
    }

    const driver = getRelationObject(row.drivers);
    const driverName = driver?.full_name ?? "Пилот уточняется";
    const driverKey = row.driver_id ?? `${position}:${driverName}`;
    const seenDrivers = seenDriversByRace.get(session.race_id) ?? new Set<string>();
    const seenPositions = seenPositionsByRace.get(session.race_id) ?? new Set<number>();

    if (seenDrivers.has(driverKey) || seenPositions.has(position)) {
      return;
    }

    seenDrivers.add(driverKey);
    seenPositions.add(position);
    seenDriversByRace.set(session.race_id, seenDrivers);
    seenPositionsByRace.set(session.race_id, seenPositions);

    const profile = row.driver_id ? seasonProfiles.get(row.driver_id) : undefined;
    const profileDriver = getRelationObject(profile?.drivers ?? null);
    const team = getTeamVisualFields(row.teams, "Команда уточняется", season);
    const podium = podiumsByRace.get(session.race_id) ?? [];

    podium.push({
      position: position as 1 | 2 | 3,
      driverId: row.driver_id,
      driverName,
      driverSlug: profileDriver?.slug ?? driver?.slug ?? null,
      driverNumber: profile?.permanent_number ?? driver?.permanent_number ?? null,
      avatarUrl: profile?.avatar_image_url ?? null,
      teamName: team.team,
      teamCode: team.teamCode ?? null,
      teamColor: team.teamColor ?? null,
    });
    podium.sort((left, right) => left.position - right.position);
    podiumsByRace.set(session.race_id, podium);
  });

  return podiumsByRace;
}

function buildFallbackSeasonGlobeData(season: number): SeasonGlobeData {
  const fallbackEvents = season === CURRENT_F1_SEASON ? calendarEvents : [];
  const classified = classifySeasonGlobeEvents(
    fallbackEvents.map((event) => ({
      id: `${event.season}:${event.round}`,
      season: event.season,
      round: event.round,
      raceName: event.race,
      circuitName: event.circuit,
      country: event.country,
      countryCode: getCountryCode(event.country) ?? null,
      latitude: null,
      longitude: null,
      weekendStartAtIso: null,
      raceStartAtIso: null,
      raceEndAtIso: null,
      weekendDateLabel: event.date,
      raceDateLabel: event.date,
      isLive: event.status === "Текущий этап",
      href: event.href,
      podium: [],
      completed: event.status === "Завершен",
    })),
  );

  return {
    season,
    nextRound: classified.nextRound,
    events: classified.events.map(toPublicSeasonGlobeEvent),
  };
}

function parseSeasonGlobeCoordinate(
  value: number | string | null | undefined,
  minimum: number,
  maximum: number,
) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const coordinate = Number(value);

  return Number.isFinite(coordinate) && coordinate >= minimum && coordinate <= maximum
    ? coordinate
    : null;
}

function isLiveSportStatus(value?: string | null) {
  return /live|in[_ -]?progress|active|started|идет|идёт/i.test(value ?? "");
}

function toPublicSeasonGlobeEvent<T extends { completed: boolean }>(source: T) {
  const { completed, ...event } = source;

  void completed;
  return event;
}

export const getWeekendSessions = cache(async (raceId?: string): Promise<WeekendSession[]> => {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return raceId ? [] : weekendSessions;
  }

  const race = raceId ? null : await getCurrentRace();
  const selectedRaceId = raceId ?? race?.id;

  if (!selectedRaceId) {
    return raceId ? [] : weekendSessions;
  }

  const { data, error } = await supabase
    .from("sessions")
    .select("id, session_type, name, start_at, status")
    .eq("race_id", selectedRaceId)
    .order("start_at", { ascending: true, nullsFirst: false })
    .limit(10);

  if (error || !data?.length) {
    return raceId ? [] : weekendSessions;
  }

  const sessions = (data as SessionDbRow[]).map((session) => ({
    id: session.id,
    type: session.session_type,
    name: session.name,
    startsAt: formatDateTime(session.start_at),
    startsAtIso: session.start_at ?? undefined,
    status: getRuntimeSessionStatus({
      rawStatus: session.status,
      sessionName: session.name,
      sessionType: session.session_type,
      startsAt: session.start_at,
    }),
  }));
  const weatherBySession = await getSessionWeatherByIds(
    sessions.map((session) => session.id).filter(Boolean) as string[],
  );

  return sessions.map((session) => ({
    ...session,
    weather: session.id ? weatherBySession.get(session.id) : undefined,
  }));
});

export async function getWeekendWeather(): Promise<WeekendWeather> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return emptyWeather();
  }

  const race = await getCurrentRace();

  if (!race) {
    return emptyWeather();
  }

  const { data, error } = await supabase
    .from("circuit_weather")
    .select("temperature_c, wind_speed_kmh, precipitation_mm, observed_at")
    .eq("race_id", race.id)
    .order("observed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return emptyWeather();
  }

  const weather = data as WeatherDbRow;

  return mapWeatherRow(weather, "Open-Meteo");
}

export async function getDriverStandings(season: number): Promise<StandingRow[]> {
  const selectedSeason = await resolvePublishedSeason(season);

  if (selectedSeason === null) {
    return [];
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return selectedSeason === 2026 ? standings : [];
  }

  const latest = await getLatestCompleteStandingRound("driver_standings", 20, selectedSeason);

  if (!latest) {
    return selectedSeason === 2026 ? standings : [];
  }

  let standingsQuery = supabase
    .from("driver_standings")
    .select("driver_id, team_id, position, points, drivers(full_name, slug, permanent_number), teams(name, code, color_hex)")
    .eq("season_year", latest.season_year)
    .order("position", { ascending: true, nullsFirst: false })
    .limit(40);

  standingsQuery =
    latest.round === null ? standingsQuery.is("round", null) : standingsQuery.eq("round", latest.round);

  const { data, error } = await standingsQuery;

  if (error || !data?.length) {
    return selectedSeason === 2026 ? standings : [];
  }

  const standingRows = data as unknown as StandingDbRow[];
  const [driverSeasonProfiles, teamProfiles] = await Promise.all([
    getDriverSeasonProfilesByIds(
      supabase,
      selectedSeason,
      standingRows.flatMap((row) => row.driver_id ? [row.driver_id] : []),
    ),
    getTeamProfiles(selectedSeason),
  ]);
  const teamProfileById = new Map(teamProfiles.map((profile) => [profile.id, profile]));
  const allowCurrentFallback = selectedSeason === CURRENT_F1_SEASON;

  return standingRows.map((row, index) => {
    const currentTeam = getTeamVisualFields(row.teams, "Команда уточняется", selectedSeason);
    const seasonalDriver = row.driver_id ? driverSeasonProfiles.get(row.driver_id) : undefined;
    const seasonalTeamId = seasonalDriver?.primary_team_id ?? row.team_id;
    const seasonalTeam = seasonalTeamId ? teamProfileById.get(seasonalTeamId) : undefined;

    return {
      position: row.position ?? index + 1,
      driver: getRelationName(row.drivers, "Пилот уточняется"),
      driverSlug: getRelationObject(row.drivers)?.slug ?? undefined,
      driverNumber: seasonalDriver
        ? seasonalDriver.permanent_number ?? undefined
        : allowCurrentFallback
          ? getRelationObject(row.drivers)?.permanent_number ?? undefined
          : undefined,
      team: seasonalTeam?.name ?? currentTeam.team,
      teamCode: seasonalTeam?.code ?? (allowCurrentFallback ? currentTeam.teamCode : undefined),
      teamLogo: seasonalTeam?.logo ?? (allowCurrentFallback ? currentTeam.teamLogo : undefined),
      teamColor: seasonalTeam?.color ?? (allowCurrentFallback ? currentTeam.teamColor : undefined),
      points: Number(row.points),
    };
  });
}

export async function getDriverChampionshipMatrix(
  season: number,
): Promise<DriverChampionshipMatrix> {
  const selectedSeason = await resolvePublishedSeason(season);

  if (selectedSeason === null) {
    return { rounds: [], rows: [] };
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    if (selectedSeason !== 2026) {
      return { rounds: [], rows: [] };
    }

    return {
      rounds: [],
      rows: standings.map((row) => ({
        ...getTeamVisualFields({ name: row.team }, row.team),
        position: row.position,
        driver: row.driver,
        total: row.points,
        pointsByRound: {},
        positionByRound: {},
        podiumByRound: {},
      })),
    };
  }

  const latest = await getLatestCompleteStandingRound("driver_standings", 20, selectedSeason);

  if (!latest?.round) {
    const rows = await getDriverStandings(selectedSeason);

    return {
      rounds: [],
      rows: rows.map((row) => ({
        position: row.position,
        driver: row.driver,
        driverSlug: row.driverSlug,
        driverNumber: row.driverNumber,
        team: row.team,
        teamCode: row.teamCode,
        teamLogo: row.teamLogo,
        teamColor: row.teamColor,
        total: row.points,
        pointsByRound: {},
        positionByRound: {},
        podiumByRound: {},
      })),
    };
  }

  const standingsLatestRound = latest.round;

  const standingsQuery = supabase
    .from("driver_standings")
    .select("driver_id, team_id, round, position, points, drivers(full_name, slug, permanent_number), teams(name, code, color_hex)")
    .eq("season_year", latest.season_year)
    .lte("round", standingsLatestRound)
    .order("round", { ascending: true })
    .order("position", { ascending: true, nullsFirst: false });
  const [roundPointTotals, { data, error }] = await Promise.all([
    getChampionshipRoundPointTotals(latest.season_year),
    standingsQuery,
  ]);

  if (error || !data?.length) {
    return { rounds: [], rows: [] };
  }

  const rowsByDriver = new Map<
    string,
    {
      driverId: string;
      teamId?: string;
      driver: string;
      driverSlug?: string;
      driverNumber?: number;
      team: string;
      teamCode?: string;
      teamLogo?: string;
      teamColor?: string;
      latestPosition: number;
      total: number;
      cumulative: Map<number, number>;
    }
  >();

  (data as unknown as StandingDbRow[]).forEach((row) => {
    if (!row.driver_id || !row.round) {
      return;
    }

    const teamVisual = getTeamVisualFields(row.teams, "Команда уточняется", selectedSeason);
    const existing = rowsByDriver.get(row.driver_id) ?? {
      driverId: row.driver_id,
      teamId: row.team_id ?? undefined,
      driver: getRelationName(row.drivers, "Пилот уточняется"),
      driverSlug: getRelationObject(row.drivers)?.slug ?? undefined,
      driverNumber: getRelationObject(row.drivers)?.permanent_number ?? undefined,
      team: teamVisual.team,
      teamCode: teamVisual.teamCode,
      teamLogo: teamVisual.teamLogo,
      teamColor: teamVisual.teamColor,
      latestPosition: row.position ?? 999,
      total: Number(row.points),
      cumulative: new Map<number, number>(),
    };

    existing.cumulative.set(row.round, Number(row.points));

    if (row.round === standingsLatestRound) {
      existing.latestPosition = row.position ?? existing.latestPosition;
      existing.total = Number(row.points);
      existing.teamId = row.team_id ?? existing.teamId;
      existing.team = teamVisual.team;
      existing.teamCode = teamVisual.teamCode;
      existing.teamLogo = teamVisual.teamLogo;
      existing.teamColor = teamVisual.teamColor;
    }

    rowsByDriver.set(row.driver_id, existing);
  });

  const displayedRounds = [
    ...roundPointTotals.scoredRounds,
    ...getCumulativeScoredRounds(
      [...rowsByDriver.values()].map((row) => row.cumulative),
      standingsLatestRound,
    ),
  ];
  const [rounds, teamProfiles, driverSeasonProfiles] = await Promise.all([
    getRaceRoundVisualsForRounds(latest.season_year, displayedRounds),
    getTeamProfiles(selectedSeason),
    getDriverSeasonProfilesByIds(
      supabase,
      selectedSeason,
      [...rowsByDriver.keys()],
    ),
  ]);
  const roundNumbers = rounds.map((round) => round.round);
  const teamProfileById = new Map(teamProfiles.map((profile) => [profile.id, profile]));
  const rows = [...rowsByDriver.values()]
    .filter((row) => row.cumulative.has(standingsLatestRound))
    .map((row) => {
      const seasonalDriver = driverSeasonProfiles.get(row.driverId);
      const seasonalTeamId = seasonalDriver?.primary_team_id ?? row.teamId;
      const seasonalTeam = seasonalTeamId
        ? teamProfileById.get(seasonalTeamId)
        : undefined;
      const pointsByRound: Record<number, number> = {};
      const positionByRound: Record<number, number> = {};
      const podiumByRound: Record<number, "winner" | "second" | "third"> = {};
      const resultPoints = roundPointTotals.driverPoints.get(row.driverId);
      const racePositions = roundPointTotals.driverRacePositions.get(row.driverId);
      let displayedTotal = 0;

      roundNumbers.forEach((round) => {
        const points = resultPoints?.has(round)
          ? (resultPoints.get(round) ?? 0)
          : getCumulativeRoundPointsAfterDisplayedTotal(
              row.cumulative,
              round,
              displayedTotal,
            );

        pointsByRound[round] = points;
        const racePosition = racePositions?.get(round);
        const podiumFinish = getPodiumFinish(racePosition);

        if (racePosition) {
          positionByRound[round] = racePosition;
        }

        if (podiumFinish) {
          podiumByRound[round] = podiumFinish;
        }
        displayedTotal += points;
      });
      const totalFromResults = sumRoundPoints(pointsByRound);

      return {
        position: row.latestPosition,
        driver: row.driver,
        driverSlug: row.driverSlug,
        driverNumber: seasonalDriver
          ? seasonalDriver.permanent_number ?? undefined
          : selectedSeason === CURRENT_F1_SEASON
            ? row.driverNumber
            : undefined,
        avatarUrl: seasonalDriver?.avatar_image_url ?? undefined,
        team: seasonalTeam?.name ?? row.team,
        teamCode: seasonalTeam?.code ?? (selectedSeason === CURRENT_F1_SEASON ? row.teamCode : undefined),
        teamLogo: seasonalTeam?.logo ?? (selectedSeason === CURRENT_F1_SEASON ? row.teamLogo : undefined),
        teamColor: seasonalTeam?.color ?? (selectedSeason === CURRENT_F1_SEASON ? row.teamColor : undefined),
        teamSlug: seasonalTeam?.slug,
        total: Math.max(row.total, totalFromResults),
        pointsByRound,
        positionByRound,
        podiumByRound,
      };
    })
    .sort((a, b) => b.total - a.total || a.position - b.position)
    .map((row, index) => ({ ...row, position: index + 1 }));

  return { rounds, rows };
}

export async function getDriverDirectory(
  season: number,
): Promise<DriverDirectoryTeam[]> {
  const selectedSeason = await resolvePublishedSeason(season);

  if (selectedSeason === null) {
    return [];
  }

  const isCurrentSeason = selectedSeason === CURRENT_F1_SEASON;

  return withServerTtlCache(
    `public:driver-directory:${selectedSeason}`,
    isCurrentSeason ? 60_000 : 5 * 60_000,
    () => getDriverDirectoryUncached(selectedSeason),
    { staleWhileRevalidateMs: isCurrentSeason ? 5 * 60_000 : 30 * 60_000 },
  );
}

async function getDriverDirectoryUncached(
  season: number,
): Promise<DriverDirectoryTeam[]> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const latest = await getLatestCompleteStandingRound("driver_standings", 20, season);
  const [profilesResult, teamProfiles, standingsResult] = await Promise.all([
    supabase
      .from("driver_season_profiles")
      .select(
        "driver_id, primary_team_id, code, permanent_number, starts, avatar_image_url, drivers(id, slug, full_name, ai_avatar_url)",
      )
      .eq("season_year", season),
    getTeamProfiles(season),
    latest
      ? (() => {
          let query = supabase
            .from("driver_standings")
            .select("driver_id, position, points, wins")
            .eq("season_year", season);

          query = latest.round === null
            ? query.is("round", null)
            : query.eq("round", latest.round);

          return query;
        })()
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profilesResult.error || standingsResult.error) {
    throw new Error("Не удалось загрузить пилотов сезона");
  }

  const standingByDriver = new Map(
    ((standingsResult.data ?? []) as unknown as DriverDirectoryStandingDbRow[])
      .map((standing) => [standing.driver_id, standing]),
  );
  const driversByTeam = new Map<string, DriverDirectoryDriver[]>();

  ((profilesResult.data ?? []) as unknown as DriverDirectoryProfileDbRow[]).forEach((profile) => {
    const driver = getRelationObject(profile.drivers);

    if (!driver?.slug || !profile.primary_team_id) {
      return;
    }

    const standing = standingByDriver.get(profile.driver_id);
    const list = driversByTeam.get(profile.primary_team_id) ?? [];

    list.push({
      id: profile.driver_id,
      slug: driver.slug,
      fullName: driver.full_name,
      code: profile.code ?? undefined,
      number:
        getDriverSeasonNumberOverride(driver.slug, season) ?? profile.permanent_number,
      avatarUrl: profile.avatar_image_url ?? (season === CURRENT_F1_SEASON ? driver.ai_avatar_url : null),
      starts: profile.starts ?? 0,
      championshipPosition: standing?.position ?? null,
      points: Number(standing?.points ?? 0),
      wins: standing?.wins ?? 0,
      isPrimary: false,
    });
    driversByTeam.set(profile.primary_team_id, list);
  });

  return teamProfiles.flatMap((team) => {
    const drivers = rankDirectoryDrivers(driversByTeam.get(team.id) ?? []);

    if (!drivers.length) {
      return [];
    }

    return [{
      id: team.id,
      slug: team.slug,
      name: team.name,
      shortName: team.shortName,
      code: team.code,
      color: team.color,
      logo: team.logo,
      championshipPosition: team.championshipPosition,
      drivers,
    } satisfies DriverDirectoryTeam];
  });
}

export async function getDriverComparisonData(
  season: number,
  driverSlugs: string[],
): Promise<DriverComparisonDataset> {
  const selectedSeason = await resolvePublishedSeason(season);

  if (selectedSeason === null) {
    return {
      season,
      latestCompletedRound: 0,
      rounds: [],
      options: [],
      drivers: [],
    };
  }

  const normalizedSlugs = [...new Set(
    driverSlugs.map((slug) => slug.trim().toLowerCase()).filter(Boolean),
  )].slice(0, 2);
  const isCurrentSeason = selectedSeason === CURRENT_F1_SEASON;

  return withServerTtlCache(
    `public:driver-comparison:${selectedSeason}:${normalizedSlugs.join(":") || "empty"}`,
    isCurrentSeason ? 60_000 : 5 * 60_000,
    () => getDriverComparisonDataUncached(selectedSeason, normalizedSlugs),
    { staleWhileRevalidateMs: isCurrentSeason ? 5 * 60_000 : 30 * 60_000 },
  );
}

async function getDriverComparisonDataUncached(
  season: number,
  driverSlugs: string[],
): Promise<DriverComparisonDataset> {
  const supabase = await createSupabaseServerClient();
  const directory = await getDriverDirectory(season);
  const options = directory.flatMap((team) =>
    team.drivers.map((driver) => ({
      ...driver,
      team: {
        id: team.id,
        slug: team.slug,
        name: team.name,
        code: team.code,
        logo: team.logo,
        color: team.color,
      },
    })),
  );

  if (!supabase) {
    return {
      season,
      latestCompletedRound: 0,
      rounds: [],
      options,
      drivers: [],
    };
  }

  const selectedOptions = driverSlugs.flatMap((slug) => {
    const option = options.find((item) => item.slug === slug);
    return option ? [option] : [];
  });
  const selectedDriverIds = selectedOptions.map((driver) => driver.id);
  const [raceResult, latestStanding] = await Promise.all([
    supabase
      .from("races")
      .select("id, season_year, round, race_name, race_start_at, status, circuits(name, country, locality)")
      .eq("season_year", season)
      .order("round", { ascending: true }),
    getLatestCompleteStandingRound("driver_standings", 20, season),
  ]);

  if (raceResult.error) {
    throw new Error("Не удалось загрузить этапы сезона");
  }

  const races = (raceResult.data ?? []) as unknown as DriverComparisonRaceDbRow[];
  const raceIds = races.map((race) => race.id);
  const sessionResult = raceIds.length
    ? await supabase
        .from("sessions")
        .select("id, race_id, session_type, name, start_at, status")
        .in("race_id", raceIds)
        .order("start_at", { ascending: true, nullsFirst: false })
    : { data: [], error: null };

  if (sessionResult.error) {
    throw new Error("Не удалось загрузить сессии сезона");
  }

  const sessions = (sessionResult.data ?? []) as DriverComparisonSessionDbRow[];
  const sessionIds = sessions.map((session) => session.id);
  const [resultRowsResult, standingRowsResult] = await Promise.all([
    sessionIds.length && selectedDriverIds.length
      ? supabase
          .from("session_results")
          .select("session_id, driver_id, team_id, position, classified_position, grid, points, status, time_text, raw_payload, drivers(full_name, slug), teams(name, code, color_hex)")
          .in("session_id", sessionIds)
          .in("driver_id", selectedDriverIds)
      : Promise.resolve({ data: [], error: null }),
    selectedDriverIds.length
      ? supabase
          .from("driver_standings")
          .select("driver_id, round, position, points, wins")
          .eq("season_year", season)
          .in("driver_id", selectedDriverIds)
          .order("round", { ascending: true, nullsFirst: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (resultRowsResult.error || standingRowsResult.error) {
    throw new Error("Не удалось подготовить сравнение пилотов");
  }

  const results = ((resultRowsResult.data ?? []) as unknown as DriverSessionResultDbRow[])
    .filter((result) => !isLapOnlyResult(result));
  const standings = (standingRowsResult.data ?? []) as unknown as Array<
    DriverDirectoryStandingDbRow & { round: number | null }
  >;
  const sessionsByRace = new Map<string, DriverComparisonSessionDbRow[]>();

  sessions.forEach((session) => {
    const list = sessionsByRace.get(session.race_id) ?? [];
    list.push(session);
    sessionsByRace.set(session.race_id, list);
  });

  const completedRounds = races
    .filter((race) => {
      const raceSession = findSessionByType(sessionsByRace.get(race.id) ?? [], "race");
      return isCompletedSportStatus(race.status) || isCompletedSportStatus(raceSession?.status);
    })
    .map((race) => race.round);
  const latestCompletedRound = Math.max(
    0,
    latestStanding?.round ?? 0,
    ...completedRounds,
  );
  const rounds = races.map((race) => {
    const circuit = getRelationObject(race.circuits);
    const country = circuit?.country ?? "";

    return {
      round: race.round,
      flag: getCountryFlag(country),
      countryCode: getCountryCode(country),
      raceName: formatGrandPrixNameRu(race.race_name),
      completed: race.round <= latestCompletedRound,
    };
  });
  const drivers: DriverComparisonDriver[] = selectedOptions.map((driver) => {
    const resultsBySession = new Map<string, DriverSessionResultDbRow>();

    results
      .filter((result) => result.driver_id === driver.id)
      .forEach((result) => resultsBySession.set(result.session_id, result));

    const raceInputs: DriverComparisonRaceInput[] = races.map((race) => {
      const raceSessions = sessionsByRace.get(race.id) ?? [];
      const qualifyingSession = findSessionByType(raceSessions, "qualifying");
      const sprintSession = findSessionByType(raceSessions, "sprint");
      const raceSession = findSessionByType(raceSessions, "race");
      const qualifyingResult = qualifyingSession
        ? resultsBySession.get(qualifyingSession.id) ?? null
        : null;
      const sprintResult = sprintSession
        ? resultsBySession.get(sprintSession.id) ?? null
        : null;
      const raceResult = raceSession
        ? resultsBySession.get(raceSession.id) ?? null
        : null;
      const raceCompleted =
        isCompletedSportStatus(race.status) ||
        isCompletedSportStatus(raceSession?.status) ||
        Boolean(raceResult);
      const missingCompletedResult = raceCompleted && !raceResult && Boolean(qualifyingResult);

      return {
        round: race.round,
        raceName: formatGrandPrixNameRu(race.race_name),
        participated: Boolean(qualifyingResult || sprintResult || raceResult),
        qualifyingPosition: qualifyingResult?.position ?? null,
        sprintPosition: sprintResult?.position ?? null,
        sprintPoints: sprintResult ? getDriverResultPoints(sprintResult, "sprint") : 0,
        startPosition: normalizeGridPosition(raceResult?.grid),
        finishPosition: raceResult?.position ?? null,
        fastestLapTime: getFastestLapTime(raceResult),
        racePoints: raceResult ? getDriverResultPoints(raceResult, "race") : 0,
        status: missingCompletedResult ? "Сход" : raceResult?.status ?? null,
        isDnf: missingCompletedResult || isDnfDriverResult(raceResult),
        hasFastestLap: hasFastestLap(raceResult),
      };
    });
    const standingInputs: DriverComparisonStandingInput[] = standings
      .filter((standing) => standing.driver_id === driver.id && standing.round)
      .map((standing) => ({
        round: standing.round as number,
        position: standing.position,
        points: Number(standing.points ?? 0),
        wins: standing.wins ?? 0,
      }));

    return {
      id: driver.id,
      slug: driver.slug,
      fullName: driver.fullName,
      code: driver.code,
      number: driver.number,
      avatarUrl: driver.avatarUrl,
      team: driver.team,
      snapshots: buildDriverRoundSnapshots(
        raceInputs,
        standingInputs,
        latestCompletedRound,
      ),
    };
  });

  return {
    season,
    latestCompletedRound,
    rounds,
    options,
    drivers,
  };
}

function isCompletedSportStatus(value?: string | null) {
  return /completed|finished|заверш/i.test(value ?? "");
}

async function getDriverSeasonProfilesByIds(
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  season: number,
  driverIds: string[],
) {
  if (!driverIds.length) {
    return new Map<string, DriverSeasonProfileDbRow>();
  }

  const { data, error } = await supabase
    .from("driver_season_profiles")
    .select(
      "season_year, driver_id, primary_team_id, code, permanent_number, avatar_image_url, drivers(slug)",
    )
    .eq("season_year", season)
    .in("driver_id", driverIds);

  if (error) {
    return new Map<string, DriverSeasonProfileDbRow>();
  }

  return new Map(
    ((data ?? []) as unknown as DriverSeasonProfileDbRow[]).map((profile) => {
      const slug = getRelationObject(profile.drivers ?? null)?.slug;

      return [
        profile.driver_id,
        {
          ...profile,
          permanent_number:
            getDriverSeasonNumberOverride(slug, season) ?? profile.permanent_number,
        },
      ];
    }),
  );
}

export async function getDriverProfileBySlug(
  slug: string,
  season: number,
  userId?: string | null,
): Promise<DriverProfile | null> {
  const selectedSeason = await resolvePublishedSeason(season);

  if (selectedSeason === null) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const normalizedSlug = slug.trim().toLowerCase();
  const { data: driverData, error: driverError } = await supabase
    .from("drivers")
    .select(
      "id, slug, code, permanent_number, first_name, last_name, full_name, country, country_code, ai_avatar_url, avatar_placeholder_style, current_team_id, is_active, teams:current_team_id(id, name, code, color_hex)",
    )
    .eq("slug", normalizedSlug)
    .maybeSingle();

  if (driverError || !driverData) {
    return null;
  }

  const driver = driverData as unknown as DriverProfileDbRow;
  const [seasonProfileResult, availableSeasonResult, teamProfiles, latest] = await Promise.all([
    supabase
      .from("driver_season_profiles")
      .select("season_year, driver_id, primary_team_id, code, permanent_number, avatar_image_url")
      .eq("driver_id", driver.id)
      .eq("season_year", selectedSeason)
      .maybeSingle(),
    supabase
      .from("driver_season_profiles")
      .select("season_year")
      .eq("driver_id", driver.id),
    getTeamProfiles(selectedSeason),
    getLatestCompleteStandingRound("driver_standings", 20, selectedSeason),
  ]);
  const seasonProfile = seasonProfileResult.data as unknown as DriverSeasonProfileDbRow | null;

  if (
    (seasonProfileResult.error && selectedSeason !== 2026) ||
    (!seasonProfile && selectedSeason !== 2026)
  ) {
    return null;
  }

  if (!seasonProfile && !driver.is_active) {
    return null;
  }

  const primaryTeamId = seasonProfile?.primary_team_id ?? driver.current_team_id;
  const seasonalTeam = primaryTeamId
    ? teamProfiles.find((team) => team.id === primaryTeamId)
    : undefined;
  const legacyTeamVisual = getTeamVisualFields(driver.teams, "Команда уточняется");
  const legacyTeamObject = getRelationObject(driver.teams);
  const publishedSeasons = await getPublishedSeasons();
  const publishedSeasonSet = new Set(publishedSeasons);
  const availableSeasons = ((availableSeasonResult.data ?? []) as { season_year: number }[])
    .map((profile) => Number(profile.season_year))
    .filter((year) => publishedSeasonSet.has(year))
    .sort((left, right) => right - left);

  const [
    races,
    standingsHistory,
    topTenCumulativePoints,
    favoriteState,
    news,
    socialPosts,
  ] = await Promise.all([
    getDriverProfileRaces(selectedSeason),
    getDriverStandingHistory(driver.id, selectedSeason),
    getDriverTopTenCumulativePoints(selectedSeason, latest?.round ?? null, driver.id),
    selectedSeason === CURRENT_F1_SEASON
      ? getDriverFavoriteState(driver.id, userId)
      : Promise.resolve({ isFavorite: false, favoriteLimitReached: false }),
    selectedSeason === 2026 ? getDriverProfileNews(normalizedSlug) : Promise.resolve([]),
    selectedSeason === 2026 ? getDriverSocialPosts(driver) : Promise.resolve([]),
  ]);

  const raceIds = races.map((race) => race.id);
  const sessions = raceIds.length ? await getDriverProfileSessions(raceIds) : [];
  const sessionIds = sessions.map((session) => session.id);
  const results = sessionIds.length ? await getDriverProfileSessionResults(sessionIds) : [];
  const context = buildDriverProfileContext(
    driver.id,
    races,
    sessions,
    results,
    standingsHistory,
    topTenCumulativePoints,
  );
  const latestStanding = getLatestDriverStanding(standingsHistory);

  return {
    id: driver.id,
    slug: driver.slug ?? normalizedSlug,
    firstName: driver.first_name,
    lastName: driver.last_name,
    fullName: driver.full_name,
    code: seasonProfile ? seasonProfile.code ?? undefined : driver.code ?? undefined,
    number:
      getDriverSeasonNumberOverride(driver.slug ?? normalizedSlug, selectedSeason) ??
      (seasonProfile ? seasonProfile.permanent_number : driver.permanent_number),
    country: driver.country,
    countryCode: driver.country_code ?? getCountryCode(driver.country ?? ""),
    aiAvatarUrl: seasonProfile?.avatar_image_url ?? (selectedSeason === 2026 ? driver.ai_avatar_url : null),
    avatarPlaceholderStyle: driver.avatar_placeholder_style,
    team: {
      id: seasonalTeam?.id ?? primaryTeamId ?? (selectedSeason === 2026 ? legacyTeamObject?.id : undefined) ?? undefined,
      slug: seasonalTeam?.slug,
      name: seasonalTeam?.name ?? (selectedSeason === 2026 ? legacyTeamVisual.team : "Команда уточняется"),
      code: seasonalTeam?.code ?? (selectedSeason === 2026 ? legacyTeamVisual.teamCode : undefined),
      logo: seasonalTeam?.logo ?? (selectedSeason === 2026 ? legacyTeamVisual.teamLogo : undefined),
      color: seasonalTeam?.color ?? (selectedSeason === 2026 ? legacyTeamVisual.teamColor : undefined),
    },
    season: selectedSeason,
    availableSeasons,
    stats: {
      ...context.stats,
      championshipPosition: latestStanding?.position ?? context.stats.championshipPosition,
      points: latestStanding ? Number(latestStanding.points) : context.stats.points,
      wins: latestStanding?.wins ?? context.stats.wins,
    },
    results: context.results,
    charts: context.charts,
    form: context.form,
    teammateComparison: context.teammateComparison,
    positionDelta: context.positionDelta,
    news,
    socialPosts,
    isFavorite: favoriteState.isFavorite,
    favoriteLimitReached: favoriteState.favoriteLimitReached,
  };
}

export async function getDriverSlugMap(): Promise<Record<string, string>> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return {};
  }

  const { data, error } = await supabase
    .from("drivers")
    .select("full_name, slug")
    .eq("is_active", true)
    .not("slug", "is", null);

  if (error || !data?.length) {
    return {};
  }

  return Object.fromEntries(
    (data as { full_name: string | null; slug: string | null }[])
      .filter((driver) => driver.full_name && driver.slug)
      .map((driver) => [normalizeDriverLookupName(driver.full_name as string), driver.slug as string]),
  );
}

async function getDriverProfileRaces(season: number) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("races")
    .select("id, season_year, round, race_name, race_start_at, circuits(name, country, locality)")
    .eq("season_year", season)
    .order("round", { ascending: true });

  if (error || !data?.length) {
    return [];
  }

  return data as unknown as DriverRaceDbRow[];
}

async function getDriverProfileSessions(raceIds: string[]) {
  const supabase = await createSupabaseServerClient();

  if (!supabase || !raceIds.length) {
    return [];
  }

  const { data, error } = await supabase
    .from("sessions")
    .select("id, race_id, session_type, name, start_at")
    .in("race_id", raceIds)
    .in("session_type", ["qualifying", "sprint", "race"])
    .order("start_at", { ascending: true, nullsFirst: false });

  if (error || !data?.length) {
    return [];
  }

  return data as DriverSessionDbRow[];
}

async function getDriverProfileSessionResults(sessionIds: string[]) {
  const supabase = await createSupabaseServerClient();

  if (!supabase || !sessionIds.length) {
    return [];
  }

  const batches = await Promise.all(
    batchSupabaseIds(sessionIds).map((batch) =>
      supabase
        .from("session_results")
        .select("session_id, driver_id, team_id, position, classified_position, grid, points, status, time_text, raw_payload, drivers(full_name, slug), teams(name, code, color_hex)")
        .in("session_id", batch),
    ),
  );

  if (batches.some((batch) => batch.error)) {
    return [];
  }

  return batches
    .flatMap((batch) => (batch.data ?? []) as unknown as DriverSessionResultDbRow[])
    .filter((result) => !isLapOnlyResult(result));
}

async function getDriverStandingHistory(driverId: string, season: number) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("driver_standings")
    .select("round, position, points, wins, team_id, teams(name, code, color_hex)")
    .eq("driver_id", driverId)
    .eq("season_year", season)
    .order("round", { ascending: true, nullsFirst: false });

  if (error || !data?.length) {
    return [];
  }

  return data as unknown as DriverStandingHistoryDbRow[];
}

async function getDriverTopTenCumulativePoints(
  season: number,
  latestRound: number | null,
  selectedDriverId: string,
): Promise<DriverCumulativePointsSeries[]> {
  const supabase = await createSupabaseServerClient();

  if (!supabase || !latestRound) {
    return [];
  }

  const { data, error } = await supabase
    .from("driver_standings")
    .select("driver_id, round, position, points, drivers(full_name, slug), teams(name, code, color_hex)")
    .eq("season_year", season)
    .lte("round", latestRound)
    .order("round", { ascending: true, nullsFirst: false })
    .order("position", { ascending: true, nullsFirst: false });

  if (error || !data?.length) {
    return [];
  }

  const rows = data as unknown as DriverCumulativeStandingDbRow[];
  const roundPointTotals = await getChampionshipRoundPointTotals(season);
  const latestRows = rows
    .filter((row) => row.round === latestRound && row.driver_id && row.position !== null)
    .sort((left, right) => (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER));
  const driverIds = new Set(latestRows.slice(0, 10).map((row) => row.driver_id as string));
  driverIds.add(selectedDriverId);

  const rounds = Array.from({ length: latestRound }, (_, index) => index + 1);
  const hasRaceResults = roundPointTotals.scoredRounds.some((round) => round <= latestRound);
  const rowsByDriver = new Map<string, DriverCumulativeStandingDbRow[]>();

  rows.forEach((row) => {
    if (!row.driver_id || !driverIds.has(row.driver_id)) {
      return;
    }

    const list = rowsByDriver.get(row.driver_id) ?? [];
    list.push(row);
    rowsByDriver.set(row.driver_id, list);
  });

  const [seasonalDrivers, seasonalTeams] = await Promise.all([
    getDriverSeasonProfilesByIds(supabase, season, [...driverIds]),
    getTeamProfiles(season),
  ]);
  const seasonalTeamById = new Map(seasonalTeams.map((team) => [team.id, team]));

  return [...driverIds].flatMap((driverId) => {
    const driverRows = rowsByDriver.get(driverId) ?? [];
    const latestRow = [...driverRows].reverse().find((row) => getRelationObject(row.drivers));
    const driver = latestRow ? getRelationName(latestRow.drivers, "Пилот") : "Пилот";

    if (!latestRow) {
      return [];
    }

    const standingPointsByRound = new Map(
      driverRows
        .filter((row) => row.round !== null)
        .map((row) => [row.round as number, Number(row.points ?? 0)]),
    );
    const resultPointsByRound = roundPointTotals.driverPoints.get(driverId);
    let cumulativePoints = 0;
    let previousStandingPoints = 0;
    const points: DriverChartPoint[] = [{ round: 0, raceName: "Старт", value: 0 }];

    rounds.forEach((round) => {
      if (hasRaceResults) {
        cumulativePoints += resultPointsByRound?.get(round) ?? 0;
        points.push({ round, raceName: `Раунд ${round}`, value: cumulativePoints });
        return;
      }

      previousStandingPoints = standingPointsByRound.get(round) ?? previousStandingPoints;
      points.push({ round, raceName: `Раунд ${round}`, value: previousStandingPoints });
    });
    const seasonalDriver = seasonalDrivers.get(driverId);
    const seasonalTeam = seasonalDriver?.primary_team_id
      ? seasonalTeamById.get(seasonalDriver.primary_team_id)
      : undefined;

    return [{
      driverId,
      driver,
      driverSlug: getRelationObject(latestRow.drivers)?.slug ?? undefined,
      teamColor: seasonalTeam?.color ?? (season === 2026
        ? getTeamVisualFields(latestRow.teams, "", season).teamColor
        : undefined),
      points,
    }];
  });
}

async function getDriverFavoriteState(driverId: string, userId?: string | null) {
  if (!userId) {
    return { isFavorite: false, favoriteLimitReached: false };
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return { isFavorite: false, favoriteLimitReached: false };
  }

  const { data, error } = await supabase
    .from("user_favorite_drivers")
    .select("driver_id")
    .eq("user_id", userId);

  if (error) {
    return { isFavorite: false, favoriteLimitReached: false };
  }

  const favoriteIds = (data ?? []).map((row) => row.driver_id);

  return {
    isFavorite: favoriteIds.includes(driverId),
    favoriteLimitReached: favoriteIds.length >= 2 && !favoriteIds.includes(driverId),
  };
}

export async function getDriverProfileNews(slug: string): Promise<DriverProfileNewsItem[]> {
  const result = await getNewsItems({ includeTotal: false, pageSize: 10, tagSlug: `driver-${slug}` });

  return result.items.map((item) => ({
    title: item.title,
    summary: item.summary,
    href: `/news/${item.slug}`,
    source: item.source,
    time: item.time,
    imageUrl: item.imageUrl ?? item.sourceImageUrl,
  }));
}

export async function getDriverSocialPosts(driver: Pick<DriverProfileDbRow, "slug" | "full_name" | "last_name" | "code">): Promise<DriverProfileSocialPost[]> {
  return getProfileSocialPosts({
    searchTerms: [driver.full_name, driver.last_name, driver.code],
    tagSlugs: getDriverNewsTagSlugs(driver),
  });
}

async function getTeamSocialPosts(team: TeamProfileSummary): Promise<DriverProfileSocialPost[]> {
  return getProfileSocialPosts({
    searchTerms: [team.name, team.shortName, team.code],
    tagSlugs: getTeamNewsTagSlugs({
      code: team.code,
      name: team.name,
      short_name: team.shortName,
    }),
  });
}

async function getProfileSocialPosts({
  searchTerms: rawSearchTerms,
  tagSlugs,
}: {
  searchTerms: Array<string | null | undefined>;
  tagSlugs: string[];
}): Promise<DriverProfileSocialPost[]> {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return [];
  }

  const searchTerms = rawSearchTerms
    .filter(Boolean)
    .map((term) => String(term).replaceAll(",", " ").trim())
    .filter((term) => term.length >= 2)
    .slice(0, 3);

  if (!searchTerms.length) {
    return [];
  }

  const orFilter = searchTerms
    .flatMap((term) => [`ai_title_ru.ilike.%${term}%`, `ai_summary_ru.ilike.%${term}%`])
    .join(",");
  const taggedPostIds = await getSocialPostIdsForAnyTag(
    supabase,
    tagSlugs,
  );
  let query = supabase
    .from("social_posts")
    .select("platform, author, title, body, ai_title_ru, ai_summary_ru, original_url, published_at, social_sources(name)")
    .eq("status", "published")
    .is("duplicate_of", null)
    .order("published_at", { ascending: false, nullsFirst: false });

  query = taggedPostIds.length
    ? query.in("id", taggedPostIds)
    : query.or(orFilter);

  const { data, error } = await query.limit(10);

  if (error || !data?.length) {
    return [];
  }

  return (data as unknown as {
    platform: "x" | "reddit" | "telegram";
    author: string | null;
    title: string | null;
    body: string | null;
    ai_title_ru: string | null;
    ai_summary_ru: string | null;
    original_url: string;
    published_at: string | null;
    social_sources: { name: string } | { name: string }[] | null;
  }[]).map((post) => {
    const author = post.author?.trim() || (post.platform === "reddit" ? "Reddit" : post.platform === "telegram" ? "Telegram" : "X");
    const source = getRelationObject(post.social_sources)?.name?.trim() || author;

    return {
      platform: post.platform,
      author,
      source: normalizeSocialSourceName(source, post.platform),
      title: post.ai_summary_ru?.trim()
        || post.ai_title_ru?.trim()
        || post.body?.trim()
        || post.title?.trim()
        || "Открыть публикацию в источнике.",
      href: post.original_url,
      publishedAt: formatRelativeTime(post.published_at),
    };
  });
}

export async function getConstructorStandings(
  season: number,
): Promise<ConstructorStandingRow[]> {
  const selectedSeason = await resolvePublishedSeason(season);

  if (selectedSeason === null) {
    return [];
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const latest = await getLatestCompleteStandingRound(
    "constructor_standings",
    10,
    selectedSeason,
  );

  if (!latest) {
    return [];
  }

  let standingsQuery = supabase
    .from("constructor_standings")
    .select("team_id, position, points, wins, teams(name, code, color_hex)")
    .eq("season_year", latest.season_year)
    .order("position", { ascending: true, nullsFirst: false })
    .limit(20);

  standingsQuery =
    latest.round === null ? standingsQuery.is("round", null) : standingsQuery.eq("round", latest.round);

  const { data, error } = await standingsQuery;

  if (error || !data?.length) {
    return [];
  }

  const standingRows = data as unknown as ConstructorStandingDbRow[];
  const teamProfiles = await getTeamProfiles(selectedSeason);
  const teamProfileById = new Map(teamProfiles.map((profile) => [profile.id, profile]));
  const allowCurrentFallback = selectedSeason === CURRENT_F1_SEASON;

  return standingRows.map((row, index) => {
    const currentTeam = getTeamVisualFields(row.teams, "Команда уточняется", selectedSeason);
    const seasonalTeam = row.team_id ? teamProfileById.get(row.team_id) : undefined;

    return {
      position: row.position ?? index + 1,
      team: seasonalTeam?.name ?? currentTeam.team,
      teamCode: seasonalTeam?.code ?? (allowCurrentFallback ? currentTeam.teamCode : undefined),
      teamLogo: seasonalTeam?.logo ?? (allowCurrentFallback ? currentTeam.teamLogo : undefined),
      teamColor: seasonalTeam?.color ?? (allowCurrentFallback ? currentTeam.teamColor : undefined),
      teamSlug: seasonalTeam?.slug,
      carImageUrl: seasonalTeam?.carImageUrl,
      points: Number(row.points),
      wins: row.wins ?? 0,
    };
  });
}

export async function getConstructorChampionshipMatrix(
  season: number,
): Promise<ConstructorChampionshipMatrix> {
  const selectedSeason = await resolvePublishedSeason(season);

  if (selectedSeason === null) {
    return { rounds: [], rows: [] };
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return { rounds: [], rows: [] };
  }

  const latest = await getLatestCompleteStandingRound(
    "constructor_standings",
    10,
    selectedSeason,
  );

  if (!latest?.round) {
    const rows = await getConstructorStandings(selectedSeason);

    return { rounds: [], rows };
  }

  const standingsLatestRound = latest.round;

  const standingsQuery = supabase
    .from("constructor_standings")
    .select("team_id, round, position, points, wins, teams(name, code, color_hex)")
    .eq("season_year", latest.season_year)
    .lte("round", standingsLatestRound)
    .order("round", { ascending: true })
    .order("position", { ascending: true, nullsFirst: false });
  const [roundPointTotals, { data, error }] = await Promise.all([
    getChampionshipRoundPointTotals(latest.season_year),
    standingsQuery,
  ]);

  if (error || !data?.length) {
    return { rounds: [], rows: [] };
  }

  const rowsByTeam = new Map<
    string,
    {
      teamId: string;
      team: string;
      teamCode?: string;
      teamLogo?: string;
      teamColor?: string;
      latestPosition: number;
      total: number;
      wins: number;
      cumulative: Map<number, number>;
    }
  >();

  (data as unknown as ConstructorStandingDbRow[]).forEach((row) => {
    if (!row.team_id || !row.round) {
      return;
    }

    const teamVisual = getTeamVisualFields(row.teams, "Команда уточняется", selectedSeason);
    const existing = rowsByTeam.get(row.team_id) ?? {
      teamId: row.team_id,
      team: teamVisual.team,
      teamCode: teamVisual.teamCode,
      teamLogo: teamVisual.teamLogo,
      teamColor: teamVisual.teamColor,
      latestPosition: row.position ?? 999,
      total: Number(row.points),
      wins: row.wins ?? 0,
      cumulative: new Map<number, number>(),
    };

    existing.cumulative.set(row.round, Number(row.points));

    if (row.round === standingsLatestRound) {
      existing.latestPosition = row.position ?? existing.latestPosition;
      existing.total = Number(row.points);
      existing.wins = row.wins ?? existing.wins;
      existing.team = teamVisual.team;
      existing.teamCode = teamVisual.teamCode;
      existing.teamLogo = teamVisual.teamLogo;
      existing.teamColor = teamVisual.teamColor;
    }

    rowsByTeam.set(row.team_id, existing);
  });

  const displayedRounds = [
    ...roundPointTotals.scoredRounds,
    ...getCumulativeScoredRounds(
      [...rowsByTeam.values()].map((row) => row.cumulative),
      standingsLatestRound,
    ),
  ];
  const [rounds, teamProfiles] = await Promise.all([
    getRaceRoundVisualsForRounds(latest.season_year, displayedRounds),
    getTeamProfiles(selectedSeason),
  ]);
  const roundNumbers = rounds.map((round) => round.round);
  const teamProfileById = new Map(teamProfiles.map((profile) => [profile.id, profile]));
  const rows = [...rowsByTeam.values()]
    .filter((row) => row.cumulative.has(standingsLatestRound))
    .map((row) => {
      const seasonalTeam = teamProfileById.get(row.teamId);
      const pointsByRound: Record<number, number> = {};
      const resultPoints = roundPointTotals.constructorPoints.get(row.teamId);
      let displayedTotal = 0;

      roundNumbers.forEach((round) => {
        const points = resultPoints?.has(round)
          ? (resultPoints.get(round) ?? 0)
          : getCumulativeRoundPointsAfterDisplayedTotal(
              row.cumulative,
              round,
              displayedTotal,
            );

        pointsByRound[round] = points;
        displayedTotal += points;
      });
      const totalFromResults = sumRoundPoints(pointsByRound);

      return {
        position: row.latestPosition,
        team: seasonalTeam?.name ?? row.team,
        teamCode: seasonalTeam?.code ?? (selectedSeason === CURRENT_F1_SEASON ? row.teamCode : undefined),
        teamLogo: seasonalTeam?.logo ?? (selectedSeason === CURRENT_F1_SEASON ? row.teamLogo : undefined),
        teamColor: seasonalTeam?.color ?? (selectedSeason === CURRENT_F1_SEASON ? row.teamColor : undefined),
        teamSlug: seasonalTeam?.slug,
        carImageUrl: seasonalTeam?.carImageUrl,
        points: Math.max(row.total, totalFromResults),
        wins: row.wins,
        pointsByRound,
      };
    })
    .sort((a, b) => b.points - a.points || a.position - b.position)
    .map((row, index) => ({ ...row, position: index + 1 }));

  return { rounds, rows };
}

async function getTeamProfilesUncached(
  season: number,
): Promise<TeamProfileSummary[]> {
  const selectedSeason = await resolvePublishedSeason(season);

  if (selectedSeason === null) {
    return [];
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const latest = await getLatestCompleteStandingRound(
    "constructor_standings",
    10,
    selectedSeason,
  );

  if (!latest) {
    return [];
  }

  const [profileResult, standingResult] = await Promise.all([
    supabase
      .from("team_season_profiles")
      .select(
        "season_year, team_id, lineage_id, display_name, short_name, code, country, color_hex, logo_image_url, car_image_url, team_lineages(id, slug, display_name)",
      )
      .eq("season_year", selectedSeason),
    (() => {
      let query = supabase
        .from("constructor_standings")
        .select("team_id, position, points, wins, teams(id, name, short_name, code, country, color_hex)")
        .eq("season_year", selectedSeason)
        .order("position", { ascending: true, nullsFirst: false });

      query = latest.round === null
        ? query.is("round", null)
        : query.eq("round", latest.round);

      return query;
    })(),
  ]);

  const seasonalProfiles = (profileResult.data ?? []) as unknown as TeamSeasonProfileDbRow[];
  const standingRows = (standingResult.data ?? []) as unknown as TeamProfileStandingDbRow[];

  if (!profileResult.error && seasonalProfiles.length) {
    const standingByTeam = new Map(
      standingRows
        .filter((row) => row.team_id)
        .map((row) => [row.team_id as string, row]),
    );

    return seasonalProfiles
      .flatMap((profile) => {
        const lineage = getRelationObject(profile.team_lineages);

        if (!lineage?.slug) {
          return [];
        }

        const standing = standingByTeam.get(profile.team_id);

        return [{
          id: profile.team_id,
          slug: lineage.slug,
          name: profile.display_name,
          shortName: profile.short_name ?? profile.display_name,
          code: profile.code ?? profile.display_name.slice(0, 3).toUpperCase(),
          country: localizeTeamCountry(profile.country),
          countryCode: getCountryCode(profile.country ?? ""),
          color: profile.color_hex ?? "#E10600",
          logo: profile.logo_image_url ?? undefined,
          carImageUrl: profile.car_image_url ?? "",
          season: selectedSeason,
          championshipPosition: standing?.position ?? null,
          points: Number(standing?.points ?? 0),
          wins: standing?.wins ?? 0,
        } satisfies TeamProfileSummary];
      })
      .sort((left, right) =>
        (left.championshipPosition ?? Number.MAX_SAFE_INTEGER) -
        (right.championshipPosition ?? Number.MAX_SAFE_INTEGER)
      );
  }

  if (selectedSeason !== 2026) {
    return [];
  }

  let query = supabase
    .from("constructor_standings")
    .select("team_id, position, points, wins, teams(id, name, short_name, code, country, color_hex)")
    .eq("season_year", selectedSeason)
    .order("position", { ascending: true, nullsFirst: false });

  query = latest.round === null ? query.is("round", null) : query.eq("round", latest.round);

  const { data, error } = await query;

  if (error || !data?.length) {
    return [];
  }

  return (data as unknown as TeamProfileStandingDbRow[]).flatMap((row) => {
    const team = getRelationObject(row.teams);
    const profileAsset = getTeamProfileAsset(team?.code, selectedSeason) ?? getTeamProfileAsset(team?.name, selectedSeason);

    if (!row.team_id || !team || !profileAsset) {
      return [];
    }

    const visual = getTeamAsset(team.code, selectedSeason) ?? getTeamAsset(team.name, selectedSeason);

    return [{
      id: row.team_id,
      slug: profileAsset.slug,
      name: team.name,
      shortName: team.short_name ?? visual?.name ?? team.name,
      code: team.code ?? visual?.code ?? profileAsset.slug.toUpperCase(),
      country: localizeTeamCountry(team.country),
      countryCode: getCountryCode(team.country ?? ""),
      color: visual?.color ?? team.color_hex ?? "#E10600",
      logo: visual?.logo,
      carImageUrl: profileAsset.carImageUrl,
      season: selectedSeason,
      championshipPosition: row.position,
      points: Number(row.points ?? 0),
      wins: row.wins ?? 0,
    } satisfies TeamProfileSummary];
  });
}

export const getTeamProfiles = cache(async (season: number) => {
  if (await resolvePublishedSeason(season) === null) return [];
  // Never put an authenticated preview into the shared public cache.
  if (await getSessionUser()) return getTeamProfilesUncached(season);

  return withServerTtlCache(
    `public:teams:${season}`,
    season === CURRENT_F1_SEASON ? 60_000 : 5 * 60_000,
    () => getTeamProfilesUncached(season),
    { staleWhileRevalidateMs: 5 * 60_000 },
  );
});

export async function getTeamProfileBySlug(
  slug: string,
  season: number,
): Promise<TeamProfile | null> {
  const selectedSeason = await resolvePublishedSeason(season);

  if (selectedSeason === null) {
    return null;
  }

  const normalizedSlug = slug.trim().toLowerCase();
  const teams = await getTeamProfiles(selectedSeason);
  const team = teams.find((item) => item.slug === normalizedSlug);

  if (!team) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const latest = await getLatestCompleteStandingRound(
    "driver_standings",
    20,
    selectedSeason,
  );
  const latestRound = latest?.round ?? null;
  const profileSeason = team.season;

  const { data: lineageData, error: lineageError } = await supabase
    .from("team_lineages")
    .select("id")
    .eq("slug", normalizedSlug)
    .maybeSingle();

  let availableSeasons: number[];

  if (lineageError || !lineageData?.id) {
    if (selectedSeason !== 2026) {
      return null;
    }

    availableSeasons = [2026];
  } else {
    const { data: availableSeasonData, error: availableSeasonError } = await supabase
      .from("team_season_profiles")
      .select("season_year")
      .eq("lineage_id", lineageData.id);

    if (availableSeasonError) {
      return null;
    }

    const publishedSeasonSet = new Set(await getPublishedSeasons());
    availableSeasons = ((availableSeasonData ?? []) as { season_year: number }[])
      .map((profile) => Number(profile.season_year))
      .filter((year) => publishedSeasonSet.has(year))
      .sort((left, right) => right - left);
  }

  const [raceResult, standingHistoryResult, driverStandingResult, newsResult, socialPosts, constructorMatrix] = await Promise.all([
    supabase
      .from("races")
      .select("id, season_year, round, race_name, race_start_at, circuits(name, country, locality)")
      .eq("season_year", profileSeason)
      .order("round", { ascending: true }),
    supabase
      .from("constructor_standings")
      .select("team_id, round, position, points, wins, teams(name, code, color_hex)")
      .eq("season_year", profileSeason)
      .eq("team_id", team.id)
      .order("round", { ascending: true, nullsFirst: false }),
    latestRound
      ? supabase
          .from("driver_standings")
          .select("position, points, wins, drivers(id, full_name, slug, code, permanent_number, ai_avatar_url)")
          .eq("season_year", profileSeason)
          .eq("round", latestRound)
          .order("position", { ascending: true, nullsFirst: false })
      : Promise.resolve({ data: [], error: null }),
    selectedSeason === 2026
      ? getNewsItems({ includeTotal: false, pageSize: 6, tagSlug: `team-${team.code.toLowerCase()}` })
      : Promise.resolve(emptyNewsList(1)),
    selectedSeason === 2026 ? getTeamSocialPosts(team) : Promise.resolve([]),
    getConstructorChampionshipMatrix(selectedSeason),
  ]);

  const races = (raceResult.data ?? []) as unknown as DriverRaceDbRow[];
  const raceIds = races.map((race) => race.id);
  const { data: sessionData, error: sessionError } = raceIds.length
    ? await supabase
        .from("sessions")
        .select("id, race_id, session_type, name, start_at")
        .in("race_id", raceIds)
        .order("start_at", { ascending: true, nullsFirst: false })
    : { data: [], error: null };
  const sessions = (sessionData ?? []) as unknown as DriverSessionDbRow[];
  const sessionIds = sessions.map((session) => session.id);
  const { data: resultData, error: resultError } = sessionIds.length
    ? await supabase
        .from("session_results")
        .select("session_id, driver_id, team_id, position, classified_position, grid, points, status, time_text, raw_payload, drivers(full_name, slug)")
        .in("session_id", sessionIds)
        .eq("team_id", team.id)
    : { data: [], error: null };

  if (raceResult.error || standingHistoryResult.error || driverStandingResult.error || sessionError || resultError) {
    return null;
  }

  const results = (resultData ?? []) as unknown as DriverSessionResultDbRow[];
  const sessionsByRace = new Map<string, DriverSessionDbRow[]>();
  const resultsBySession = new Map<string, DriverSessionResultDbRow[]>();

  sessions.forEach((session) => {
    const list = sessionsByRace.get(session.race_id) ?? [];
    list.push(session);
    sessionsByRace.set(session.race_id, list);
  });
  results.forEach((result) => {
    const list = resultsBySession.get(result.session_id) ?? [];
    list.push(result);
    resultsBySession.set(result.session_id, list);
  });
  const raceSessionIds = sessions.filter((session) => session.session_type === "race").map((session) => session.id);
  const qualifyingSessionIds = sessions.filter((session) => session.session_type === "qualifying").map((session) => session.id);
  const raceResults = results.filter((result) => raceSessionIds.includes(result.session_id));
  const qualifyingResults = results.filter((result) => qualifyingSessionIds.includes(result.session_id));

  const raceRows = races.flatMap<TeamRaceResultRow>((race) => {
    const raceSessions = sessionsByRace.get(race.id) ?? [];
    const raceSession = findSessionByType(raceSessions, "race");
    const sprintSession = findSessionByType(raceSessions, "sprint");
    const qualifyingSession = findSessionByType(raceSessions, "qualifying");
    const raceResults = raceSession ? resultsBySession.get(raceSession.id) ?? [] : [];
    const sprintResults = sprintSession ? resultsBySession.get(sprintSession.id) ?? [] : [];
    const qualifyingResults = qualifyingSession ? resultsBySession.get(qualifyingSession.id) ?? [] : [];

    if (!raceResults.length && !sprintResults.length) {
      return [];
    }

    const positions = raceResults
      .map((result) => result.position)
      .filter((position): position is number => Boolean(position && position > 0));
    const qualifyingPositions = qualifyingResults
      .map((result) => result.position)
      .filter((position): position is number => Boolean(position && position > 0));
    const teamQualifyingResults = qualifyingResults
      .slice()
      .sort((left, right) => (left.position ?? 999) - (right.position ?? 999))
      .slice(0, 2)
      .map((result) => {
        const driver = getRelationObject(result.drivers);

        return {
          driverId: result.driver_id ?? undefined,
          driver: driver?.full_name ?? "Пилот",
          driverSlug: driver?.slug ?? undefined,
          position: result.position,
        };
      });
    const teamFinishResults = raceResults
      .slice()
      .sort((left, right) => (left.position ?? 999) - (right.position ?? 999))
      .slice(0, 2)
      .map((result) => {
        const driver = getRelationObject(result.drivers);

        return {
          driverId: result.driver_id ?? undefined,
          driver: driver?.full_name ?? "Пилот",
          driverSlug: driver?.slug ?? undefined,
          position: result.position,
          isDnf: isDnfDriverResult(result),
        };
      });
    const allPointResults = [...raceResults, ...sprintResults];
    const points = allPointResults.reduce((sum, result) => sum + Number(result.points ?? 0), 0);
    const circuit = getRelationObject(race.circuits);
    const positionDeltas = raceResults.flatMap((result) =>
      result.grid && result.grid > 0 && result.position && result.position > 0
        ? [result.grid - result.position]
        : [],
    );

    return [{
      round: race.round,
      raceName: formatGrandPrixNameRu(race.race_name),
      raceDate: formatDateTime(race.race_start_at),
      country: circuit?.country ?? "",
      countryCode: getCountryCode(circuit?.country ?? ""),
      points: Number(points.toFixed(2)),
      bestFinish: positions.length ? Math.min(...positions) : null,
      qualifyingBest: qualifyingPositions.length ? Math.min(...qualifyingPositions) : null,
      qualifyingResults: teamQualifyingResults,
      finishResults: teamFinishResults,
      positionDelta: positionDeltas.length
        ? positionDeltas.reduce((sum, value) => sum + value, 0)
        : null,
      isWin: positions.includes(1),
      isPodium: positions.some((position) => position <= 3),
      hadDnf: raceResults.some((result) => isDnfDriverResult(result)),
    }];
  });

  const actualDriverIds = new Set(
    [...raceResults, ...qualifyingResults]
      .map((result) => result.driver_id)
      .filter((driverId): driverId is string => Boolean(driverId)),
  );
  const driverRows = ((driverStandingResult.data ?? []) as unknown as TeamProfileDriverStandingDbRow[])
    .filter((row) => {
      const driver = getRelationObject(row.drivers);
      return Boolean(driver?.id && actualDriverIds.has(driver.id));
    });
  const driverSeasonProfiles = await getDriverSeasonProfilesByIds(
    supabase,
    selectedSeason,
    driverRows.flatMap((row) => {
      const driver = getRelationObject(row.drivers);
      return driver?.id ? [driver.id] : [];
    }),
  );
  const drivers: TeamProfileDriver[] = driverRows.flatMap((row) => {
    const driver = getRelationObject(row.drivers);

    if (!driver) {
      return [];
    }

    const driverRaceResults = raceResults.filter((result) => result.driver_id === driver.id);
    const driverPointResults = results.filter((result) => result.driver_id === driver.id);
    const seasonalDriver = driverSeasonProfiles.get(driver.id);
    const teamPoints = driverPointResults.reduce(
      (total, result) => total + Number(result.points ?? 0),
      0,
    );
    const classifiedPositions = driverRaceResults
      .filter((result) => !isDnfDriverResult(result))
      .map((result) => result.position)
      .filter((position): position is number => Boolean(position && position > 0));

    return [{
      id: driver.id,
      fullName: driver.full_name,
      slug: driver.slug ?? undefined,
      code: seasonalDriver
        ? seasonalDriver.code ?? undefined
        : selectedSeason === CURRENT_F1_SEASON
          ? driver.code ?? undefined
          : undefined,
      number: seasonalDriver
        ? seasonalDriver.permanent_number
        : selectedSeason === CURRENT_F1_SEASON
          ? driver.permanent_number
          : null,
      avatarUrl: seasonalDriver?.avatar_image_url ?? (selectedSeason === 2026 ? driver.ai_avatar_url : null),
      championshipPosition: row.position,
      points: Number(teamPoints.toFixed(2)),
      wins: Math.max(row.wins ?? 0, driverRaceResults.filter((result) => result.position === 1).length),
      podiums: driverRaceResults.filter((result) => Boolean(result.position && result.position <= 3)).length,
      bestResult: classifiedPositions.length ? Math.min(...classifiedPositions) : null,
    }];
  });

  const standingsHistory = (standingHistoryResult.data ?? []) as unknown as ConstructorStandingDbRow[];
  const standingByRound = new Map(
    standingsHistory
      .filter((row) => row.round)
      .map((row) => [row.round as number, Number(row.points ?? 0)]),
  );
  let cumulativePoints = 0;
  const pointsByRound = raceRows.map((row) => {
    cumulativePoints += row.points ?? 0;
    const storedCumulative = standingByRound.get(row.round);

    return {
      round: row.round,
      raceName: row.raceName,
      countryCode: row.countryCode,
      points: row.points ?? 0,
      cumulativePoints: storedCumulative ?? Number(cumulativePoints.toFixed(2)),
    };
  });
  const cumulativePointsSeries = constructorMatrix.rows.map((row) => {
    let total = 0;

    return {
      teamCode: row.teamCode ?? slugify(row.team),
      team: row.team,
      teamSlug: row.teamSlug,
      teamColor: row.teamColor,
      points: [
        { round: 0, raceName: "Старт", value: 0 },
        ...constructorMatrix.rounds.map((round) => {
          total += row.pointsByRound?.[round.round] ?? 0;

          return {
            round: round.round,
            raceName: round.raceName,
            value: Number(total.toFixed(2)),
          };
        }),
      ],
    };
  });
  const classifiedPositions = raceResults
    .filter((result) => !isDnfDriverResult(result))
    .map((result) => result.position)
    .filter((position): position is number => Boolean(position && position > 0));
  const normalizedRaceRows = raceRows.map((row) => {
    if (!row.finishResults.length) {
      return row;
    }

    const hasMissingDriver = drivers.some(
      (driver) =>
        row.qualifyingResults.some((result) => result.driverId === driver.id) &&
        !row.finishResults.some((result) => result.driverId === driver.id),
    );

    return hasMissingDriver ? { ...row, hadDnf: true } : row;
  });
  const missingResultDnfs = normalizedRaceRows.reduce((count, row) => {
    if (!row.finishResults.length) {
      return count;
    }

    return count + drivers.filter(
      (driver) =>
        row.qualifyingResults.some((result) => result.driverId === driver.id) &&
        !row.finishResults.some((result) => result.driverId === driver.id),
    ).length;
  }, 0);
  const lastFive = normalizedRaceRows.slice(-5);

  return {
    ...team,
    availableSeasons,
    drivers,
    stats: {
      points: team.points,
      championshipPosition: team.championshipPosition,
      wins: Math.max(team.wins, raceResults.filter((result) => result.position === 1).length),
      podiums: raceResults.filter((result) => Boolean(result.position && result.position <= 3)).length,
      poles: qualifyingResults.filter((result) => result.position === 1).length,
      fastestLaps: raceResults.filter((result) => hasFastestLap(result)).length,
      dnfs: raceResults.filter((result) => isDnfDriverResult(result)).length + missingResultDnfs,
      pointsFinishes: raceResults.filter((result) => Number(result.points ?? 0) > 0).length,
      bestResult: classifiedPositions.length ? Math.min(...classifiedPositions) : null,
      averageFinish: averageNumber(classifiedPositions),
    },
    results: normalizedRaceRows,
    pointsByRound,
    cumulativePointsSeries: cumulativePointsSeries.length
      ? cumulativePointsSeries
      : [{
          teamCode: team.code,
          team: team.shortName,
          teamSlug: team.slug,
          teamColor: team.color,
          points: [
            { round: 0, raceName: "Старт", value: 0 },
            ...pointsByRound.map((point) => ({
              round: point.round,
              raceName: point.raceName,
              value: point.cumulativePoints,
            })),
          ],
        }],
    form: {
      labels: lastFive.map((row) => formatTeamFormResults(row, drivers)),
      points: Number(lastFive.reduce((sum, row) => sum + (row.points ?? 0), 0).toFixed(2)),
      podiums: lastFive.filter((row) => row.isPodium).length,
      bestResult: lastFive.map((row) => row.bestFinish).filter((value): value is number => value !== null).sort((a, b) => a - b)[0] ?? null,
    },
    news: newsResult.items,
    socialPosts,
  };
}

function formatTeamFormResults(row: TeamRaceResultRow, drivers: TeamProfileDriver[]) {
  const resultDriverIds = [...row.qualifyingResults, ...row.finishResults]
    .map((result) => result.driverId)
    .filter((driverId): driverId is string => Boolean(driverId));
  const driverOrder = drivers
    .map((driver) => driver.id)
    .filter((driverId) => resultDriverIds.includes(driverId));
  const orderedDriverIds = [...new Set([...driverOrder, ...resultDriverIds])].slice(0, 2);
  const labels = orderedDriverIds.map((driverId) => {
    const finish = row.finishResults.find((result) => result.driverId === driverId);

    if (finish) {
      return finish.isDnf || !finish.position ? "DNF" : `P${finish.position}`;
    }

    const qualified = row.qualifyingResults.some((result) => result.driverId === driverId);

    return row.finishResults.length > 0 && qualified ? "DNF" : "—";
  });

  while (labels.length < 2) {
    labels.push("—");
  }

  return labels.join(" / ");
}

export async function getStandingsMeta(
  type: "driver_standings" | "constructor_standings",
  season: number,
): Promise<StandingsMeta | null> {
  const selectedSeason = await resolvePublishedSeason(season);

  if (selectedSeason === null) {
    return null;
  }

  const latest = await getLatestCompleteStandingRound(
    type,
    type === "driver_standings" ? 20 : 10,
    selectedSeason,
  );

  if (!latest) {
    return null;
  }

  return {
    season: latest.season_year,
    round: latest.round,
    label: latest.round === null ? `Сезон ${latest.season_year}` : `Сезон ${latest.season_year}, раунд ${latest.round}`,
  };
}

export async function getRaceRoundVisuals(season: number, latestRound: number) {
  const supabase = await createSupabaseServerClient();

  if (!supabase || latestRound <= 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("races")
    .select("round, race_name, circuits(country)")
    .eq("season_year", season)
    .lte("round", latestRound)
    .order("round", { ascending: true });

  if (error || !data?.length) {
    return Array.from({ length: latestRound }, (_, index) => ({
      round: index + 1,
      flag: "🏁",
      countryCode: undefined,
      raceName: `Раунд ${index + 1}`,
    }));
  }

  return (data as unknown as RaceRoundVisualDbRow[]).map((race) => {
    const circuit = getRelationObject(race.circuits);
    const country = circuit?.country ?? "";

    return {
      round: race.round,
      flag: getCountryFlag(country),
      countryCode: getCountryCode(country),
      raceName: formatGrandPrixNameRu(race.race_name),
    };
  });
}

async function getRaceRoundVisualsForRounds(season: number, rounds: number[]) {
  const uniqueRounds = [...new Set(rounds)]
    .filter((round) => Number.isFinite(round) && round > 0)
    .sort((a, b) => a - b);
  const supabase = await createSupabaseServerClient();

  if (!supabase || !uniqueRounds.length) {
    return [];
  }

  const { data, error } = await supabase
    .from("races")
    .select("round, race_name, circuits(country)")
    .eq("season_year", season)
    .in("round", uniqueRounds)
    .order("round", { ascending: true });

  if (error || !data?.length) {
    return uniqueRounds.map((round) => ({
      round,
      flag: "🏁",
      raceName: `Раунд ${round}`,
    }));
  }

  const raceByRound = new Map(
    (data as unknown as RaceRoundVisualDbRow[]).map((race) => [race.round, race]),
  );

  return uniqueRounds.map((round) => {
    const race = raceByRound.get(round);

    if (!race) {
      return {
        round,
        flag: "🏁",
        countryCode: undefined,
        raceName: `Раунд ${round}`,
      };
    }

    const circuit = getRelationObject(race.circuits);
    const country = circuit?.country ?? "";

    return {
      round: race.round,
      flag: getCountryFlag(country),
      countryCode: getCountryCode(country),
      raceName: formatGrandPrixNameRu(race.race_name),
    };
  });
}

export async function getPredictionPicks() {
  return predictionPicks;
}

export async function getPredictionState(
  userId?: string | null,
): Promise<PredictionState> {
  const publicState = await withServerTtlCache(
    "public:prediction-state",
    10_000,
    getPublicPredictionState,
    { staleWhileRevalidateMs: 5 * 60_000 },
  );
  const { currentRace, race } = publicState;

  let current: PredictionState["current"] = null;
  let previousResult: PredictionState["previousResult"] = null;
  let seasonSummary = emptyPredictionSeasonSummary();

  if (race && userId) {
    const supabase = await createSupabaseServerClient();

    if (!supabase) {
      return {
        ...publicState,
        current,
        previousResult,
        seasonSummary,
      };
    }

    const [{ data }, previous, summary] = await Promise.all([
      supabase
        .from("predictions")
        .select(
          "pole_driver_id, winner_driver_id, fastest_lap_driver_id, dnf_driver_id, dnf_pick_kind, top_scoring_team_id, fastest_pit_stop_team_id, top10_driver_ids, score, score_breakdown, is_public, share_slug, share_image_version",
        )
        .eq("user_id", userId)
        .eq("race_id", race.id)
        .is("league_id", null)
        .maybeSingle(),
      getPreviousPredictionResult(userId, currentRace),
      getPredictionSeasonSummary(userId, currentRace?.season_year ?? null),
    ]);
    previousResult = previous;
    seasonSummary = summary;

    if (data) {
      const prediction = data as PredictionDbRow;
      current = {
        top10DriverIds: normalizeDriverIdList(prediction.top10_driver_ids),
        poleDriverId: prediction.pole_driver_id,
        winnerDriverId: prediction.winner_driver_id,
        fastestLapDriverId: prediction.fastest_lap_driver_id,
        dnfDriverId: prediction.dnf_driver_id,
        dnfPickKind: prediction.dnf_pick_kind === "none" ? "none" : "driver",
        topScoringTeamId: prediction.top_scoring_team_id ?? null,
        fastestPitStopTeamId: prediction.fastest_pit_stop_team_id ?? null,
        score: prediction.score,
        scoreBreakdown: mapFantasyScoreBreakdown(prediction.score_breakdown),
        isPublic: prediction.is_public ?? true,
        shareImageVersion: prediction.share_image_version ?? 1,
        shareSlug: prediction.share_slug ?? null,
      };
    }
  }

  return {
    drivers: publicState.drivers,
    startingGrid: publicState.startingGrid,
    race,
    teams: publicState.teams,
    previousResult,
    seasonSummary,
    current,
  };
}

async function getPublicPredictionState() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return {
      currentRace: null,
      drivers: [] as PredictionState["drivers"],
      startingGrid: null,
      race: null,
      teams: [] as PredictionState["teams"],
    };
  }

  const [currentRace, fantasyOptions] = await Promise.all([
    getCurrentRace("id, season_year, round, race_name, race_start_at, circuits(id, name, country, external_id)"),
    getCurrentSeasonPredictionOptions(supabase),
  ]);
  const [locks, startingGrid] = currentRace
    ? await Promise.all([
        getPredictionLocksForRace(currentRace.id),
        getStartingGridForRace(currentRace.id, currentRace.season_year),
      ])
    : [null, null];
  const circuit = getRelationObject(currentRace?.circuits);
  const raceName = currentRace ? formatGrandPrixNameRu(currentRace.race_name) : null;
  const race = currentRace && raceName
    ? {
        country: circuit?.country ?? null,
        fantasyVisual: getFantasyTrackVisual(
          currentRace.season_year,
          currentRace.round,
          raceName,
        ),
        id: currentRace.id,
        name: raceName,
        round: currentRace.round,
        season: currentRace.season_year,
        startsAt: formatDateTime(currentRace.race_start_at),
        qualifyingStartsAtIso: locks?.qualifyingStartsAtIso ?? null,
        raceStartsAtIso: locks?.raceStartsAtIso ?? currentRace.race_start_at,
        poleLocked: locks?.poleLocked ?? false,
        raceLocked: locks?.raceLocked ?? false,
      }
    : null;

  return {
    currentRace,
    drivers: fantasyOptions.drivers,
    startingGrid,
    race,
    teams: fantasyOptions.teams,
  };
}

function emptyPredictionSeasonSummary(): PredictionState["seasonSummary"] {
  return {
    predictionCount: 0,
    scoredPredictionCount: 0,
    totalScore: null,
  };
}

async function getPredictionSeasonSummary(
  userId: string,
  seasonYear: number | null,
): Promise<PredictionState["seasonSummary"]> {
  const supabase = await createSupabaseServerClient();

  if (!supabase || !userId || !seasonYear) {
    return emptyPredictionSeasonSummary();
  }

  const { data, error } = await supabase
    .from("predictions")
    .select("score, races!inner(season_year)")
    .eq("user_id", userId)
    .is("league_id", null)
    .eq("races.season_year", seasonYear);

  if (error) {
    return emptyPredictionSeasonSummary();
  }

  if (!data?.length) {
    return {
      predictionCount: 0,
      scoredPredictionCount: 0,
      totalScore: 0,
    };
  }

  const scores = (data as unknown as { score: number | string | null }[])
    .map((prediction) => toNumberOrNull(prediction.score));
  const scoredScores = scores.filter((score): score is number => score !== null);

  return {
    predictionCount: data.length,
    scoredPredictionCount: scoredScores.length,
    totalScore: scoredScores.length
      ? scoredScores.reduce((sum, score) => sum + score, 0)
      : 0,
  };
}

export async function getCurrentSeasonPredictionOptions(
  supabase?: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
): Promise<Pick<PredictionState, "drivers" | "teams">> {
  const client = supabase ?? await createSupabaseServerClient();

  if (!client) {
    return { drivers: [], teams: [] };
  }

  const latest = await getLatestCompleteStandingRound(
    "driver_standings",
    20,
    CURRENT_F1_SEASON,
  );

  if (latest) {
    let standingsQuery = client
      .from("driver_standings")
      .select("position, drivers(id, full_name, slug, code, permanent_number, teams:current_team_id(name, code)), teams(id, name, code)")
      .eq("season_year", latest.season_year)
      .order("position", { ascending: true, nullsFirst: false });

    standingsQuery = latest.round === null
      ? standingsQuery.is("round", null)
      : standingsQuery.eq("round", latest.round);

    const { data, error } = await standingsQuery;
    const rows = (data ?? []) as unknown as FantasyStandingOptionRow[];

    if (!error && rows.length) {
      const teamById = new Map<string, PredictionState["teams"][number]>();
      const drivers = rows
        .map((row) => {
          const driver = getRelationObject(row.drivers);
          const team = getRelationObject(row.teams);

          if (!driver?.id || !driver.full_name) {
            return null;
          }

          if (team?.id && team.name) {
            teamById.set(team.id, {
              id: team.id,
              name: team.name,
              code: team.code,
            });
          }

          const teamName = team?.name ?? getRelationName(driver.teams, "Команда уточняется");
          const teamCode = team?.code ?? getRelationObject(driver.teams)?.code ?? null;
          const teamAsset = getTeamAsset(teamCode) ?? getTeamAsset(teamName);

          return {
            avatarUrl: getFantasyPredictionDriverAvatarUrl(driver.slug),
            code: driver.code,
            id: driver.id,
            name: driver.full_name,
            number: driver.permanent_number ?? null,
            slug: driver.slug,
            team: teamName,
            teamCode,
            teamColor: teamAsset?.color ?? null,
          };
        })
        .filter((driver): driver is NonNullable<typeof driver> => driver !== null);

      if (drivers.length) {
        return {
          drivers,
          teams: [...teamById.values()].sort((left, right) => left.name.localeCompare(right.name, "ru")),
        };
      }
    }
  }

  const [driversResult, teamsResult] = await Promise.all([
    client
      .from("drivers")
      .select("id, full_name, slug, code, permanent_number, teams:current_team_id(name, code)")
      .eq("is_active", true)
      .order("full_name"),
    client
      .from("teams")
      .select("id, name, code")
      .eq("is_active", true)
      .order("name"),
  ]);

  return {
    drivers: ((driversResult.data ?? []) as unknown as DriverOptionRow[]).map((driver) => {
      const teamName = getRelationName(driver.teams, "Команда уточняется");
      const teamCode = getRelationObject(driver.teams)?.code ?? null;
      const teamAsset = getTeamAsset(teamCode) ?? getTeamAsset(teamName);

      return {
        avatarUrl: getFantasyPredictionDriverAvatarUrl(driver.slug),
        code: driver.code,
        id: driver.id,
        name: driver.full_name,
        number: driver.permanent_number ?? null,
        slug: driver.slug,
        team: teamName,
        teamCode,
        teamColor: teamAsset?.color ?? null,
      };
    }),
    teams: ((teamsResult.data ?? []) as TeamOptionRow[]).map((team) => ({
      id: team.id,
      name: team.name,
      code: team.code,
    })),
  };
}

async function getStartingGridForRace(
  raceId: string,
  season: number,
): Promise<PredictionState["startingGrid"]> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const [{ data: session }, { data: gridRows, error: gridError }] = await Promise.all([
    supabase
    .from("sessions")
    .select("id, session_type, name, start_at, status")
    .eq("race_id", raceId)
    .eq("session_type", "race")
    .order("start_at", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle(),
    supabase
      .from("race_starting_grid")
      .select("driver_id, team_id, position, lap_time_text, updated_at, drivers(full_name, slug, permanent_number), teams(name, code, color_hex)")
      .eq("race_id", raceId)
      .order("position", { ascending: true, nullsFirst: false }),
  ]);

  if (!session?.id || gridError || !gridRows?.length) {
    return null;
  }

  const rows = gridRows as unknown as Array<{
    driver_id: string;
    team_id: string | null;
    position: number;
    lap_time_text: string | null;
    updated_at: string;
    drivers: SessionResultDbRow["drivers"];
    teams: SessionResultDbRow["teams"];
  }>;
  const [weatherBySession, seasonProfiles] = await Promise.all([
    getSessionWeatherByIds([session.id]),
    getDriverSeasonProfilesByIds(supabase, season, rows.map((row) => row.driver_id)),
  ]);
  const latestUpdate = rows.reduce(
    (latest, row) => Math.max(latest, getTimeMs(row.updated_at) ?? 0),
    0,
  );
  const results = rows.map((row) => {
    const driver = getRelationObject(row.drivers);
    const seasonProfile = seasonProfiles.get(row.driver_id);

    return {
      ...getTeamVisualFields(row.teams, "Команда уточняется", season),
      position: row.position,
      driver: getRelationName(row.drivers, "Пилот уточняется"),
      driverSlug: driver?.slug ?? undefined,
      driverNumber: seasonProfile?.permanent_number ?? driver?.permanent_number ?? undefined,
      time: row.lap_time_text ?? "—",
      status: "Стартовая позиция",
      grid: row.position,
      laps: null,
      points: null,
    } satisfies SessionResult;
  });

  return {
    results,
    updatedAt: latestUpdate ? formatDateTime(new Date(latestUpdate).toISOString()) : "Время уточняется",
    session: {
      id: session.id,
      type: session.session_type,
      name: session.name,
      startsAt: formatDateTime(session.start_at),
      startsAtIso: session.start_at ?? undefined,
      status: getRuntimeSessionStatus({
        rawStatus: session.status,
        sessionName: session.name,
        sessionType: session.session_type,
        startsAt: session.start_at,
      }),
      weather: weatherBySession.get(session.id),
    },
  };
}

async function getPreviousPredictionResult(
  userId: string,
  currentRace: Pick<RaceRow, "id" | "race_start_at" | "season_year"> | null,
): Promise<PredictionState["previousResult"]> {
  const supabase = await createSupabaseServerClient();

  if (!supabase || !userId) {
    return null;
  }

  const { data } = await supabase
    .from("predictions")
    .select(
      "user_id, race_id, pole_driver_id, winner_driver_id, fastest_lap_driver_id, dnf_driver_id, dnf_pick_kind, top_scoring_team_id, fastest_pit_stop_team_id, top10_driver_ids, score, score_breakdown, scored_at, submitted_at, races(round, race_name, race_start_at, season_year)",
    )
    .eq("user_id", userId)
    .is("league_id", null)
    .not("score", "is", null)
    .order("scored_at", { ascending: false, nullsFirst: false })
    .limit(100);

  const currentRaceStart = getTimeMs(currentRace?.race_start_at ?? null);
  const rows = ((data ?? []) as unknown as PreviousPredictionDbRow[])
    .filter((prediction) => {
      if (!currentRace?.id) {
        return true;
      }

      if (prediction.race_id === currentRace.id) {
        return false;
      }

      const race = getRelationObject(prediction.races);
      const raceStart = getTimeMs(race?.race_start_at ?? null);

      return currentRaceStart === null || raceStart === null || raceStart < currentRaceStart;
    })
    .sort((left, right) => {
      const leftRaceStart = getTimeMs(getRelationObject(left.races)?.race_start_at ?? null) ?? 0;
      const rightRaceStart = getTimeMs(getRelationObject(right.races)?.race_start_at ?? null) ?? 0;

      if (leftRaceStart !== rightRaceStart) {
        return rightRaceStart - leftRaceStart;
      }

      return (getTimeMs(right.scored_at) ?? 0) - (getTimeMs(left.scored_at) ?? 0);
    });
  const prediction = rows[0];

  if (!prediction || prediction.score === null || prediction.score === undefined) {
    return null;
  }

  const [driverNames, teamNames] = await Promise.all([
    getPredictionDriverNames([prediction]),
    getPredictionTeamNames([prediction]),
  ]);
  const breakdown = mapFantasyScoreBreakdown(prediction.score_breakdown);
  const top10BreakdownByDriver = new Map(
    (breakdown?.top10 ?? []).map((row) => [row.driverId, row]),
  );
  const top10 = normalizeDriverIdList(prediction.top10_driver_ids).map((driverId, index) => {
    const row = top10BreakdownByDriver.get(driverId);

    return {
      actualPosition: row?.actualPosition ?? null,
      driverId,
      driverName: getDriverPickName(driverId, driverNames),
      points: row?.points ?? 0,
      predictedPosition: row?.predictedPosition || index + 1,
    };
  });
  const race = getRelationObject(prediction.races);

  return {
    raceName: race ? formatGrandPrixNameRu(race.race_name) : "Прошлый этап",
    round: race?.round ?? 0,
    season: race?.season_year ?? currentRace?.season_year ?? CURRENT_F1_SEASON,
    score: Number(prediction.score ?? 0),
    scoredAt: prediction.scored_at,
    scoreBreakdown: breakdown,
    specials: [
      {
        label: "Стартовая решётка",
        points: breakdown?.specials?.pole ?? 0,
        value: getDriverPickName(prediction.pole_driver_id, driverNames),
      },
      {
        label: "Лучший круг",
        points: breakdown?.specials?.fastestLap ?? 0,
        value: getDriverPickName(prediction.fastest_lap_driver_id, driverNames),
      },
      {
        label: "Первый сход",
        points: breakdown?.specials?.firstDnf ?? 0,
        value: getDnfPickName(prediction, driverNames),
      },
      {
        label: "Команда этапа",
        points: breakdown?.specials?.topScoringTeam ?? 0,
        value: getTeamPickName(prediction.top_scoring_team_id, teamNames),
      },
      {
        label: "Быстрый пит-стоп",
        points: breakdown?.specials?.fastestPitStopTeam ?? 0,
        value: getTeamPickName(prediction.fastest_pit_stop_team_id, teamNames),
      },
    ],
    top10,
  };
}

type PredictionShareRow = {
  id: string;
  race_id: string;
  share_slug: string | null;
  is_public: boolean | null;
  share_image_version: number | null;
  submitted_at: string;
  pole_driver_id: string | null;
  fastest_lap_driver_id: string | null;
  dnf_driver_id: string | null;
  dnf_pick_kind: string | null;
  top_scoring_team_id: string | null;
  fastest_pit_stop_team_id: string | null;
  top10_driver_ids: string[] | null;
  user_id: string;
  profiles: { display_name: string | null } | { display_name: string | null }[] | null;
  prediction_leagues: { name: string | null } | { name: string | null }[] | null;
  races:
    | { race_name: string; race_start_at: string | null; round: number | null; season_year: number }
    | { race_name: string; race_start_at: string | null; round: number | null; season_year: number }[]
    | null;
};

type PredictionShareDriverRow = {
  ai_avatar_url: string | null;
  code: string | null;
  current_team_id: string | null;
  full_name: string;
  id: string;
  permanent_number: number | null;
  slug: string | null;
  teams:
    | { code: string | null; color_hex: string | null; name: string }
    | { code: string | null; color_hex: string | null; name: string }[]
    | null;
};

type PredictionShareTeamRow = {
  code: string | null;
  color_hex: string | null;
  id: string;
  name: string;
};

export function normalizePredictionShareScope(scope?: string | null): PredictionShareScope {
  return scope === "qualification" ? "qualification" : "race";
}

const PREDICTION_SHARE_IMAGE_LAYOUT_VERSION = 5;

export function buildPredictionShareUrls(
  shareSlug: string,
  scope: PredictionShareScope = "race",
  version = 1,
) {
  const baseUrl = getSiteUrl().replace(/\/+$/, "");
  const publicQuery = scope === "qualification"
    ? `?scope=qualification&v=${version}&preview=${PREDICTION_SHARE_IMAGE_LAYOUT_VERSION}`
    : `?v=${version}&preview=${PREDICTION_SHARE_IMAGE_LAYOUT_VERSION}`;
  const imageQuery = `?scope=${scope}&v=${version}&layout=${PREDICTION_SHARE_IMAGE_LAYOUT_VERSION}`;

  return {
    ogImageUrl: `${baseUrl}/api/og/prediction/${shareSlug}${imageQuery}`,
    publicUrl: `${baseUrl}/prediction/${shareSlug}${publicQuery}`,
    shareImageUrl: `${baseUrl}/api/share-image/prediction/${shareSlug}${imageQuery}`,
  };
}

export async function getPublicPredictionShareBySlug(
  shareSlug: string,
  scope: PredictionShareScope = "race",
): Promise<PublicPredictionShare | null> {
  const admin = createSupabaseAdminClient();

  if (!admin || !shareSlug) {
    return null;
  }

  const { data, error } = await admin
    .from("predictions")
    .select(
      "id, user_id, race_id, share_slug, is_public, share_image_version, submitted_at, pole_driver_id, fastest_lap_driver_id, dnf_driver_id, dnf_pick_kind, top_scoring_team_id, fastest_pit_stop_team_id, top10_driver_ids, profiles:user_id(display_name), prediction_leagues:league_id(name), races(race_name, race_start_at, round, season_year)",
    )
    .eq("share_slug", shareSlug)
    .eq("is_public", true)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const prediction = data as unknown as PredictionShareRow;
  const slug = prediction.share_slug;
  const race = getRelationObject(prediction.races);

  if (!slug || !prediction.is_public || !race) {
    return null;
  }

  const driverIds = [
    ...(prediction.top10_driver_ids ?? []),
    prediction.pole_driver_id,
    prediction.fastest_lap_driver_id,
    prediction.dnf_pick_kind === "none" ? null : prediction.dnf_driver_id,
  ].filter((id): id is string => Boolean(id));
  const teamIds = [
    prediction.top_scoring_team_id,
    prediction.fastest_pit_stop_team_id,
  ].filter((id): id is string => Boolean(id));

  const [driversResult, teamsResult] = await Promise.all([
    driverIds.length
      ? admin
        .from("drivers")
        .select("id, full_name, slug, code, permanent_number, ai_avatar_url, current_team_id, teams:current_team_id(name, code, color_hex)")
        .in("id", [...new Set(driverIds)])
      : Promise.resolve({ data: [] }),
    teamIds.length
      ? admin
        .from("teams")
        .select("id, name, code, color_hex")
        .in("id", [...new Set(teamIds)])
      : Promise.resolve({ data: [] }),
  ]);
  const driverMap = new Map(
    ((driversResult.data ?? []) as unknown as PredictionShareDriverRow[]).map((driver) => [
      driver.id,
      mapPredictionShareDriver(driver),
    ]),
  );
  const teamMap = new Map(
    ((teamsResult.data ?? []) as unknown as PredictionShareTeamRow[]).map((team) => [
      team.id,
      mapPredictionShareTeam(team),
    ]),
  );
  const version = prediction.share_image_version ?? 1;
  const urls = buildPredictionShareUrls(slug, scope, version);
  const shareUrl = await getOrCreatePredictionShareUrl(
    prediction.id,
    scope,
    version,
    urls.publicUrl,
  );
  const profile = getRelationObject(prediction.profiles);
  const league = getRelationObject(prediction.prediction_leagues);
  const top10 = (prediction.top10_driver_ids ?? [])
    .map((driverId, index) => {
      const driver = getDriverPick(driverMap, driverId);

      return driver ? { ...driver, position: index + 1 } : null;
    })
    .filter((driver): driver is NonNullable<typeof driver> => Boolean(driver));
  const pole = getDriverPick(driverMap, prediction.pole_driver_id);
  const fastestLap = getDriverPick(driverMap, prediction.fastest_lap_driver_id);
  const dnf = prediction.dnf_pick_kind === "none" ? null : getDriverPick(driverMap, prediction.dnf_driver_id);
  const topScoringTeam = getTeamPick(teamMap, prediction.top_scoring_team_id);
  const fastestPitStopTeam = getTeamPick(teamMap, prediction.fastest_pit_stop_team_id);
  const heroDriver = scope === "qualification" ? pole : top10[0] ?? null;
  const heroTeam = heroDriver?.team
    ? {
        code: heroDriver.team.code,
        color: heroDriver.team.color,
        id: heroDriver.id,
        name: heroDriver.team.name,
      }
    : topScoringTeam ?? fastestPitStopTeam;
  const heroColor = heroDriver?.team?.color ?? heroTeam?.color ?? "#e10600";

  return {
    authorUserId: prediction.user_id,
    id: prediction.id,
    displayName: profile?.display_name?.trim() || "Участник RaceSide",
    heroColor,
    heroDriver,
    heroTeam,
    leagueName: league?.name?.trim() || null,
    picks: {
      dnf,
      dnfKind: prediction.dnf_pick_kind === "none" ? "none" : "driver",
      fastestLap,
      fastestPitStopTeam,
      pole,
      top10,
      topScoringTeam,
    },
    race: {
      id: prediction.race_id,
      name: formatGrandPrixNameRu(race.race_name),
      round: race.round,
      season: race.season_year,
      startsAt: race.race_start_at,
    },
    scope,
    shareImageVersion: version,
    shareSlug: slug,
    shareUrl,
    ...urls,
  };
}

function mapPredictionShareDriver(driver: PredictionShareDriverRow) {
  const team = getRelationObject(driver.teams);
  const teamAsset = getTeamAsset(team?.name ?? team?.code ?? undefined);
  const localAvatarUrl = getLocalPredictionDriverAvatarUrl(driver.slug ?? slugify(driver.full_name));

  return {
    avatarUrl: driver.ai_avatar_url ?? localAvatarUrl,
    code: driver.code,
    id: driver.id,
    name: driver.full_name,
    number: driver.permanent_number,
    slug: driver.slug,
    team: team
      ? {
          code: team.code ?? teamAsset?.code,
          color: team.color_hex ?? teamAsset?.color,
          name: team.name,
        }
      : null,
  };
}

const localPredictionDriverAvatarSlugs = new Set([
  "alexander-albon",
  "andrea-kimi-antonelli",
  "arvid-lindblad",
  "carlos-sainz",
  "charles-leclerc",
  "esteban-ocon",
  "fernando-alonso",
  "franco-colapinto",
  "gabriel-bortoleto",
  "george-russell",
  "isack-hadjar",
  "lando-norris",
  "lance-stroll",
  "lewis-hamilton",
  "liam-lawson",
  "max-verstappen",
  "nico-hulkenberg",
  "oliver-bearman",
  "oscar-piastri",
  "pierre-gasly",
  "sergio-perez",
  "valtteri-bottas",
]);

function getFantasyPredictionDriverAvatarUrl(slug: string | null | undefined) {
  const normalized = slug ? slugify(slug) : "";

  return normalized && localPredictionDriverAvatarSlugs.has(normalized)
    ? getSeasonDriverAvatarPath(CURRENT_F1_SEASON, normalized)
    : null;
}

function getLocalPredictionDriverAvatarUrl(slug: string | null | undefined) {
  const normalized = slug ? slugify(slug) : "";

  if (!normalized || !localPredictionDriverAvatarSlugs.has(normalized)) {
    return null;
  }

  return `${getSiteUrl().replace(/\/+$/, "")}/drivers/avatars/${normalized}.png`;
}

function mapPredictionShareTeam(team: PredictionShareTeamRow) {
  const asset = getTeamAsset(team.name) ?? getTeamAsset(team.code);

  return {
    code: team.code ?? asset?.code,
    color: team.color_hex ?? asset?.color,
    id: team.id,
    name: team.name,
  };
}

function getDriverPick(
  drivers: Map<string, ReturnType<typeof mapPredictionShareDriver>>,
  driverId?: string | null,
) {
  return driverId ? drivers.get(driverId) ?? null : null;
}

function getTeamPick(
  teams: Map<string, ReturnType<typeof mapPredictionShareTeam>>,
  teamId?: string | null,
) {
  return teamId ? teams.get(teamId) ?? null : null;
}

type RankedGlobalFantasyLeaderboardRow = GlobalFantasyLeaderboardRow & {
  userId: string;
};

type RankedGlobalFantasyLeaderboard = {
  rows: RankedGlobalFantasyLeaderboardRow[];
  updatedAt: string;
};

async function loadRankedGlobalFantasyLeaderboard(): Promise<RankedGlobalFantasyLeaderboard> {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return { rows: [], updatedAt: new Date().toISOString() };
  }

  const { data: predictionData } = await supabase
    .from("predictions")
    .select("user_id, race_id, score, score_breakdown")
    .is("league_id", null);
  const predictions = (predictionData ?? []) as unknown as GlobalPredictionRow[];
  const userIds = [...new Set(predictions.map((prediction) => prediction.user_id))];

  if (!userIds.length) {
    return { rows: [], updatedAt: new Date().toISOString() };
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);
  const names = new Map(
    ((profileData ?? []) as unknown as GlobalProfileRow[]).map((profile) => [
      profile.id,
      profile.display_name?.trim() || "Участник",
    ]),
  );
  const totals = new Map<
    string,
    {
      bestBreakdown: GlobalFantasyLeaderboardRow["bestBreakdown"];
      bestScore: number | null;
      predictionCount: number;
      scoredPredictionCount: number;
      totalScore: number;
    }
  >();

  predictions.forEach((prediction) => {
    const current = totals.get(prediction.user_id) ?? {
      bestScore: null,
      bestBreakdown: null,
      predictionCount: 0,
      scoredPredictionCount: 0,
      totalScore: 0,
    };
    const score = typeof prediction.score === "number" ? prediction.score : null;

    current.predictionCount += 1;
    if (score !== null) {
      current.totalScore += score;
      current.scoredPredictionCount += 1;
      current.bestScore = current.bestScore === null ? score : Math.max(current.bestScore, score);
      if (current.bestScore === score) {
        current.bestBreakdown = mapFantasyScoreBreakdown(prediction.score_breakdown);
      }
    }
    totals.set(prediction.user_id, current);
  });

  const rows = [...totals.entries()]
    .map(([userId, value]) => ({
      averageScore: value.scoredPredictionCount
        ? Math.round((value.totalScore / value.scoredPredictionCount) * 10) / 10
        : 0,
      bestScore: value.bestScore,
      bestBreakdown: value.bestBreakdown,
      displayName: names.get(userId) ?? "Участник",
      predictionCount: value.predictionCount,
      scoredPredictionCount: value.scoredPredictionCount,
      totalScore: value.totalScore,
      userId,
    }))
    .sort(
      (left, right) =>
        right.totalScore - left.totalScore ||
        right.averageScore - left.averageScore ||
        right.predictionCount - left.predictionCount ||
        left.displayName.localeCompare(right.displayName, "ru"),
    )
    .map((row, index): RankedGlobalFantasyLeaderboardRow => ({ ...row, rank: index + 1 }));

  return { rows, updatedAt: new Date().toISOString() };
}

const getRankedGlobalFantasyLeaderboard = cache(() =>
  withServerTtlCache(
    "fantasy:global-leaderboard",
    30_000,
    loadRankedGlobalFantasyLeaderboard,
    { staleWhileRevalidateMs: 5 * 60_000 },
  ),
);
const getCachedPublicShareLeaderboard = unstable_cache(
  loadRankedGlobalFantasyLeaderboard,
  ["public-prediction-share-leaderboard-v1"],
  { revalidate: 60 },
);

export async function getGlobalFantasyLeaderboard(): Promise<GlobalFantasyLeaderboard> {
  const leaderboard = await getRankedGlobalFantasyLeaderboard();

  return {
    rows: leaderboard.rows.map((row) => ({
      averageScore: row.averageScore,
      bestBreakdown: row.bestBreakdown,
      bestScore: row.bestScore,
      displayName: row.displayName,
      predictionCount: row.predictionCount,
      rank: row.rank,
      scoredPredictionCount: row.scoredPredictionCount,
      totalScore: row.totalScore,
    })),
    updatedAt: leaderboard.updatedAt,
  };
}

export async function getFantasyLeaderboardPreview(userId?: string | null) {
  const leaderboard = await getRankedGlobalFantasyLeaderboard();
  const mapRow = (row: RankedGlobalFantasyLeaderboardRow) => ({
    averageScore: row.averageScore,
    bestBreakdown: row.bestBreakdown,
    bestScore: row.bestScore,
    displayName: row.displayName,
    predictionCount: row.predictionCount,
    rank: row.rank,
    scoredPredictionCount: row.scoredPredictionCount,
    totalScore: row.totalScore,
  });

  return {
    currentUser: userId
      ? leaderboard.rows.find((row) => row.userId === userId) ?? null
      : null,
    topRows: leaderboard.rows.slice(0, 3).map(mapRow),
    updatedAt: leaderboard.updatedAt,
  };
}

export async function getPublicPredictionSharePageContext(
  share: Pick<PublicPredictionShare, "authorUserId" | "id" | "picks" | "race">,
): Promise<PublicPredictionSharePageContext> {
  const [leaderboard, actualPoleDriverId, raceResult] = await Promise.all([
    getCachedPublicShareLeaderboard(),
    share.picks.pole
      ? getQualificationPoleDriverId(share.race.id)
      : Promise.resolve(null),
    getPredictionRaceResult(share.id, share.race.id),
  ]);
  const author = leaderboard.rows.find((row) => row.userId === share.authorUserId);
  const qualificationOutcome: PredictionQualificationOutcome = !share.picks.pole
    ? "not_submitted"
    : actualPoleDriverId === null
      ? "pending"
      : actualPoleDriverId === share.picks.pole.id
        ? "correct"
        : "incorrect";

  return {
    author: {
      globalRank: author?.rank ?? null,
      scoredPredictionCount: author?.scoredPredictionCount ?? 0,
      totalScore: author?.totalScore ?? 0,
    },
    qualificationOutcome,
    raceResult,
  };
}

async function getPredictionRaceResult(
  predictionId: string,
  raceId: string,
): Promise<PublicPredictionSharePageContext["raceResult"]> {
  const supabase = createSupabaseAdminClient();

  if (!supabase || !predictionId || !raceId) {
    return { finished: false, points: null };
  }

  const [{ data: prediction }, { data: session }] = await Promise.all([
    supabase
      .from("predictions")
      .select("score, score_breakdown, scored_at, top10_driver_ids")
      .eq("id", predictionId)
      .maybeSingle(),
    supabase
      .from("sessions")
      .select("id, session_type, name, start_at, end_at, status, updated_at")
      .eq("race_id", raceId)
      .eq("session_type", "race")
      .limit(1)
      .maybeSingle(),
  ]);

  if (!session?.id) {
    return { finished: false, points: null };
  }

  const finished = session.status === "completed" || session.status === "finished";

  if (!finished) {
    return { finished: false, points: null };
  }

  const score = toNumberOrNull(prediction?.score ?? null);
  const breakdown = mapFantasyScoreBreakdown(prediction?.score_breakdown);
  const racePoints = getRacePointsFromScoreBreakdown(prediction?.score_breakdown);
  const scoredAt = getTimeMs(prediction?.scored_at ?? null);
  const resultReadyAt = getTimeMs(session.updated_at)
    ?? getTimeMs(session.end_at)
    ?? (getTimeMs(session.start_at) !== null
      ? getTimeMs(session.start_at)! + getSessionDurationMs(session.session_type, session.name)
      : null);
  const scoreIncludesRace = Boolean(
    breakdown?.top10?.some((row) => row.actualPosition !== null),
  ) || Boolean(scoredAt && resultReadyAt && scoredAt >= resultReadyAt);

  if (score === null || racePoints === null || !scoreIncludesRace) {
    return { finished: true, points: null };
  }

  return {
    finished: true,
    points: Math.max(0, Number(racePoints.toFixed(2))),
  };
}

function getRacePointsFromScoreBreakdown(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const source = value as Record<string, unknown>;
  const manualOverride = source.manualOverride === true || source.manual_override === true;
  const manualRacePoints = toNumberOrNull(source.racePoints ?? source.race_points ?? null);

  if (manualOverride) {
    return manualRacePoints;
  }

  if (!("top10Points" in source) || !("top10Bonus" in source)) {
    return null;
  }

  if (!source.specials || typeof source.specials !== "object" || Array.isArray(source.specials)) {
    return null;
  }

  const specials = source.specials as Record<string, unknown>;
  const raceSpecialKeys = [
    "fastestLap",
    "fastestPitStopTeam",
    "firstDnf",
    "topScoringTeam",
  ];

  if (!raceSpecialKeys.every((key) => key in specials)) {
    return null;
  }

  return numberOrZero(source.top10Points)
    + numberOrZero(source.top10Bonus)
    + raceSpecialKeys.reduce((sum, key) => sum + numberOrZero(specials[key]), 0);
}

async function getQualificationPoleDriverId(raceId: string): Promise<string | null> {
  const supabase = createSupabaseAdminClient();

  if (!supabase || !raceId) {
    return null;
  }

  const { data: session } = await supabase
    .from("sessions")
    .select("id, status")
    .eq("race_id", raceId)
    .eq("session_type", "qualifying")
    .limit(1)
    .maybeSingle();

  if (!session?.id) {
    return null;
  }

  if (session.status !== "completed" && session.status !== "finished") {
    return null;
  }

  const { data: results } = await supabase
    .from("session_results")
    .select("driver_id, position, classified_position, status, raw_payload")
    .eq("session_id", session.id)
    .order("position", { ascending: true, nullsFirst: false })
    .limit(24);
  const pole = results?.filter((result) => !isLapOnlyResult(result)).find((result) => {
    const position = result.position ?? Number.parseInt(result.classified_position ?? "", 10);

    return position === 1;
  });

  return pole?.driver_id ?? null;
}

export async function getAdminSignals(): Promise<AdminSignal[]> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return adminSignals;
  }

  const [sources, pendingArticles, latestJob] = await Promise.all([
    supabase.from("news_sources").select("id", { count: "exact", head: true }),
    supabase
      .from("news_articles")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("job_runs")
      .select("job_name, status, finished_at, started_at")
      .order("started_at", { ascending: false })
      .limit(1),
  ]);

  if (sources.error || pendingArticles.error || latestJob.error) {
    return adminSignals;
  }

  const latest = latestJob.data?.[0] as
    | Pick<JobDbRow, "job_name" | "status" | "finished_at" | "started_at">
    | undefined;

  return [
    {
      label: "RSS источники",
      value: String(sources.count ?? 0),
      status: "Подключены в БД",
    },
    {
      label: "AI очередь",
      value: String(pendingArticles.count ?? 0),
      status: "Ожидают обработки",
    },
    {
      label: "Последняя задача",
      value: latest ? formatRelativeTime(latest.finished_at ?? latest.started_at) : "Нет",
      status: latest?.job_name ?? "Запусков пока не было",
    },
  ];
}

export async function getAdminDuplicateNews(): Promise<AdminDuplicateNews[]> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("news_articles")
    .select("id, ai_title_ru, original_title, main_fact, original_url, canonical_url, duplicate_of, duplicate_confidence, duplicate_reason, dedup_checked_at, ingested_at, news_sources(name)")
    .eq("publication_status", "duplicate")
    .order("dedup_checked_at", { ascending: false, nullsFirst: false })
    .limit(20);

  if (error || !data?.length) {
    return [];
  }

  const duplicateRows = data as unknown as Array<{
    id: string;
    ai_title_ru: string | null;
    original_title: string;
    main_fact: string | null;
    original_url: string | null;
    canonical_url: string;
    duplicate_of: string | null;
    duplicate_confidence: number | null;
    duplicate_reason: string | null;
    dedup_checked_at: string | null;
    ingested_at: string;
    news_sources: SourceRelation;
  }>;
  const duplicateIds = [...new Set(duplicateRows.map((article) => article.duplicate_of).filter(Boolean))] as string[];
  const { data: originals } = duplicateIds.length
    ? await supabase
        .from("news_articles")
        .select("id, ai_title_ru, original_title")
        .in("id", duplicateIds)
    : { data: [] };
  const originalsById = new Map(
    (originals ?? []).map((article) => [
      article.id,
      article.ai_title_ru ?? article.original_title,
    ]),
  );

  return duplicateRows.map((article) => ({
    id: article.id,
    title: article.ai_title_ru ?? article.original_title,
    mainFact: article.main_fact ?? undefined,
    source: getRelationName(article.news_sources, "Источник"),
    checkedAt: formatRelativeTime(article.dedup_checked_at ?? article.ingested_at),
    confidence: article.duplicate_confidence === null
      ? undefined
      : Number(article.duplicate_confidence),
    reason: article.duplicate_reason ?? undefined,
    originalUrl: article.original_url ?? article.canonical_url,
    duplicateOf: article.duplicate_of && originalsById.has(article.duplicate_of)
      ? {
          id: article.duplicate_of,
          title: originalsById.get(article.duplicate_of)!,
        }
      : undefined,
  }));
}

export async function getAdminJobs(): Promise<AdminJob[]> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return adminJobs;
  }

  const { data, error } = await supabase
    .from("job_runs")
    .select("job_name, status, items_processed, finished_at, started_at")
    .order("started_at", { ascending: false })
    .limit(8);

  if (error || !data?.length) {
    return adminJobs;
  }

  return (data as JobDbRow[]).map((job) => ({
    name: job.job_name,
    status: mapJobStatus(job.status),
    processed: job.items_processed,
    finishedAt: formatRelativeTime(job.finished_at ?? job.started_at),
  }));
}

export async function getAdminSources(): Promise<AdminSource[]> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("news_sources")
    .select("id, name, url, is_active, last_success_at, last_error")
    .order("name");

  if (error || !data) {
    return [];
  }

  return (data as SourceDbRow[]).map((source) => ({
    id: source.id,
    name: source.name,
    url: source.url,
    isActive: source.is_active,
    lastStatus: source.last_error
      ? "Есть ошибка"
      : source.last_success_at
        ? formatRelativeTime(source.last_success_at)
        : "Еще не запускался",
  }));
}

export async function getAdminSocialSources(supabase: SupabaseAdminClient): Promise<AdminSocialSource[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("social_sources")
    .select("id, platform, name, url, adapter, feed_kind, is_active, last_success_at, last_error, trust_level, publication_mode, initial_backfill_days, metadata, next_fetch_at, rate_limited_until")
    .order("platform", { ascending: true })
    .order("name", { ascending: true });

  if (error || !data) {
    return [];
  }

  return (data as unknown as SocialSourceDbRow[]).map((source) => ({
    id: source.id,
    platform: source.platform,
    name: source.name,
    url: source.url,
    adapter: source.adapter,
    feedKind: source.feed_kind ?? undefined,
    isActive: source.is_active,
    trustLevel: source.trust_level,
    publicationMode: source.publication_mode,
    initialBackfillDays: Math.max(1, Math.min(365, Number(source.initial_backfill_days ?? source.metadata?.initialBackfillDays) || 30)),
    nextFetchAt: source.next_fetch_at ?? undefined,
    rateLimitedUntil: source.rate_limited_until ?? undefined,
    lastSuccessAt: source.last_success_at ?? undefined,
    lastError: source.last_error ?? undefined,
    lastStatus: source.last_error
      ? "Есть ошибка"
      : source.last_success_at
        ? formatRelativeTime(source.last_success_at)
        : "Еще не запускался",
  }));
}

export async function getAdminSocialPosts(supabase: SupabaseAdminClient): Promise<AdminSocialPost[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("social_posts")
    .select("id, platform, author, title, ai_title_ru, status, last_processing_error, published_at")
    .order("updated_at", { ascending: false })
    .limit(60);
  if (error || !data) return [];
  return data.map((post) => ({
    id: post.id,
    author: post.author?.trim() || "Источник",
    platform: post.platform as AdminSocialPost["platform"],
    title: post.ai_title_ru?.trim() || post.title?.trim() || "Публикация",
    status: post.status as AdminSocialPost["status"],
    error: post.last_processing_error ?? undefined,
    publishedAt: post.published_at ? formatRelativeTime(post.published_at) : undefined,
  }));
}

export async function getAdminGrandPrixReports(): Promise<AdminGrandPrixReport[]> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("grand_prix_reports")
    .select(`${GRAND_PRIX_REPORT_SELECT}, is_hidden, last_error, next_refresh_at`)
    .order("season", { ascending: false })
    .order("round", { ascending: false })
    .limit(12);

  if (error || !data) {
    return [];
  }

  return (data as unknown as AdminGrandPrixReportDbRow[]).map((report) => ({
    id: report.id,
    season: report.season,
    round: report.round,
    raceName: formatGrandPrixNameRu(report.race_name),
    raceSlug: report.race_slug,
    status: mapReportStatus(report.status),
    summaryStatus: mapReportSummaryStatus(report.summary_status),
    isHidden: report.is_hidden,
    generatedAt: formatRelativeTime(report.generated_at),
    nextRefreshAt: report.next_refresh_at ? formatRelativeTime(report.next_refresh_at) : "Обновлений нет",
    lastError: report.last_error ?? undefined,
    aiSummary: report.ai_summary ?? undefined,
  }));
}

export async function getAdminDrivers(): Promise<AdminDriver[]> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("drivers")
    .select("id, slug, code, permanent_number, full_name, country, country_code, ai_avatar_url, current_team_id, teams:current_team_id(id, name, code, color_hex)")
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error || !data?.length) {
    return [];
  }

  return (data as unknown as DriverProfileDbRow[]).map((driver) => {
    const team = getRelationObject(driver.teams);
    const teamVisual = getTeamVisualFields(driver.teams, "Команда уточняется");

    return {
      id: driver.id,
      slug: driver.slug ?? "",
      fullName: driver.full_name,
      code: driver.code ?? undefined,
      number: driver.permanent_number,
      country: driver.country ?? undefined,
      countryCode: driver.country_code ?? undefined,
      aiAvatarUrl: driver.ai_avatar_url ?? undefined,
      teamId: team?.id ?? driver.current_team_id ?? undefined,
      team: teamVisual.team,
      teamCode: teamVisual.teamCode,
      teamLogo: teamVisual.teamLogo,
      teamColor: teamVisual.teamColor,
    };
  });
}

export async function getAdminTeamOptions(): Promise<AdminTeamOption[]> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("teams")
    .select("id, name")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error || !data?.length) {
    return [];
  }

  return data.map((team) => ({
    id: team.id,
    name: team.name,
  }));
}

export async function getAiUsageSummary(): Promise<AiUsageSummary> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return { totalRuns: 0, estimatedCostUsd: 0, lastModel: "Нет данных" };
  }

  const { data, count, error } = await supabase
    .from("ai_usage_logs")
    .select("model, estimated_cost_usd", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(50);

  if (error || !data) {
    return { totalRuns: 0, estimatedCostUsd: 0, lastModel: "Нет данных" };
  }

  return {
    totalRuns: count ?? data.length,
    estimatedCostUsd: data.reduce(
      (sum, row) => sum + Number(row.estimated_cost_usd ?? 0),
      0,
    ),
    lastModel: data[0]?.model ?? "Нет данных",
  };
}

export async function getLeagues(
  userId?: string | null,
  { onlyMine = false }: { onlyMine?: boolean } = {},
): Promise<LeagueSummary[]> {
  if (onlyMine && !userId) {
    return [];
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const admin = createSupabaseAdminClient();
  const db = admin ?? supabase;
  const [publicResult, ownedResult, membershipsResult] = await Promise.all([
    onlyMine
      ? Promise.resolve({ data: null, error: null })
      : db
          .from("prediction_leagues")
          .select("id, owner_user_id, name, invite_code, is_public, avatar_path, avatar_updated_at, profiles:owner_user_id(display_name, email)")
          .eq("is_public", true)
          .order("created_at", { ascending: false })
          .limit(50),
    userId
      ? db
          .from("prediction_leagues")
          .select("id, owner_user_id, name, invite_code, is_public, avatar_path, avatar_updated_at, profiles:owner_user_id(display_name, email)")
          .eq("owner_user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: null, error: null }),
    userId
      ? db
          .from("prediction_league_members")
          .select("league_id")
          .eq("user_id", userId)
      : Promise.resolve({ data: null, error: null }),
  ]);

  const memberLeagueIds = new Set(
    ((membershipsResult.data ?? []) as Array<{ league_id: string }>).map((member) => member.league_id),
  );
  let memberLeagues: LeagueDbRow[] = [];

  if (memberLeagueIds.size) {
    const { data: memberLeagueData } = await db
      .from("prediction_leagues")
      .select("id, owner_user_id, name, invite_code, is_public, avatar_path, avatar_updated_at, profiles:owner_user_id(display_name, email)")
      .in("id", [...memberLeagueIds])
      .order("created_at", { ascending: false });

    memberLeagues = (memberLeagueData ?? []) as unknown as LeagueDbRow[];
  }

  const merged = new Map<string, LeagueDbRow>();
  [
    ...((publicResult.data ?? []) as unknown as LeagueDbRow[]),
    ...((ownedResult.data ?? []) as unknown as LeagueDbRow[]),
    ...memberLeagues,
  ].forEach((league) => {
    merged.set(league.id, league);
  });

  if (!merged.size) {
    return [];
  }

  const summaries = [...merged.values()]
    .map((league) => {
      const isMember = userId
        ? league.owner_user_id === userId || memberLeagueIds.has(league.id)
        : false;

      return {
        avatarUrl: getFantasyLeagueAvatarUrl({
          avatarPath: league.avatar_path,
          avatarUpdatedAt: league.avatar_updated_at,
          leagueId: league.id,
        }),
        id: league.id,
        isMember,
        isOwner: userId ? league.owner_user_id === userId : false,
        isPublic: Boolean(league.is_public),
        name: league.name,
        members: 1,
        leader: getProfileName(league.profiles),
        score: 0,
        inviteCode: isMember ? league.invite_code : undefined,
      };
    });

  const hydrated = await hydrateLeagueScores(summaries);

  return hydrated.sort((a, b) => {
    const aMine = a.isMember || a.isOwner ? 1 : 0;
    const bMine = b.isMember || b.isOwner ? 1 : 0;

    return bMine - aMine || a.name.localeCompare(b.name);
  });
}

export async function getLeagueDetail(
  leagueId?: string | null,
  userId?: string | null,
): Promise<LeagueDetail | null> {
  if (!leagueId || !userId) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const admin = createSupabaseAdminClient();
  const db = admin ?? supabase;
  const { data: league } = await db
    .from("prediction_leagues")
    .select("id, owner_user_id, name, invite_code, is_public, avatar_path, avatar_updated_at")
    .eq("id", leagueId)
    .maybeSingle();

  if (!league) {
    return null;
  }

  const { data: membership } = await supabase
    .from("prediction_league_members")
    .select("league_id")
    .eq("league_id", leagueId)
    .eq("user_id", userId)
    .maybeSingle();
  const isOwner = league.owner_user_id === userId;
  const isPublic = Boolean(league.is_public);
  const isMember = Boolean(membership) || isOwner;

  if (isOwner && !membership) {
    await ensureLeagueOwnerMembership(leagueId, userId);
  }

  if (!isMember && !isPublic) {
    return {
      avatarUrl: getFantasyLeagueAvatarUrl({
        avatarPath: league.avatar_path,
        avatarUpdatedAt: league.avatar_updated_at,
        leagueId: league.id,
      }),
      id: league.id,
      isMember: false,
      isOwner: false,
      isPublic: false,
      name: league.name,
      members: [],
      history: [],
    };
  }

  const { data: membersData } = await db
    .from("prediction_league_members")
    .select("league_id, user_id, role, joined_at")
    .eq("league_id", leagueId)
    .order("joined_at", { ascending: true });

  const members = (membersData ?? []) as LeagueMemberRow[];
  const memberIds = members.map((member) => member.user_id);

  if (!memberIds.length) {
    return {
      avatarUrl: getFantasyLeagueAvatarUrl({
        avatarPath: league.avatar_path,
        avatarUpdatedAt: league.avatar_updated_at,
        leagueId: league.id,
      }),
      id: league.id,
      isMember,
      isOwner,
      isPublic,
      name: league.name,
      inviteCode: isMember ? league.invite_code : undefined,
      members: [],
      history: [],
    };
  }

  const [profilesResult, predictionsResult, currentRace] = await Promise.all([
    db
      .from("profiles")
      .select("id, display_name, email")
      .in("id", memberIds),
    db
      .from("predictions")
      .select(
        "user_id, race_id, pole_driver_id, winner_driver_id, fastest_lap_driver_id, dnf_driver_id, dnf_pick_kind, top_scoring_team_id, fastest_pit_stop_team_id, top10_driver_ids, score, score_breakdown, scored_at, submitted_at, races(round, race_name, race_start_at, season_year)",
      )
      .in("user_id", memberIds)
      .is("league_id", null)
      .order("submitted_at", { ascending: false }),
    getCurrentRace("id, round, race_name, race_start_at"),
  ]);

  const profiles = new Map(
    ((profilesResult.data ?? []) as LeagueProfileRow[]).map((profile) => [
      profile.id,
      getProfileName(profile),
    ]),
  );
  const predictions = (predictionsResult.data ?? []) as unknown as LeaguePredictionRow[];
  const [driverNames, teamNames] = await Promise.all([
    getPredictionDriverNames(predictions),
    getPredictionTeamNames(predictions),
  ]);
  const currentRaceId = currentRace?.id ?? null;

  const byUser = new Map<string, LeaguePredictionRow[]>();
  predictions.forEach((prediction) => {
    byUser.set(prediction.user_id, [...(byUser.get(prediction.user_id) ?? []), prediction]);
  });

  const detailMembers = members
    .map<LeagueMemberPrediction>((member) => {
      const userPredictions = byUser.get(member.user_id) ?? [];
      const currentPrediction = currentRaceId
        ? userPredictions.find((prediction) => prediction.race_id === currentRaceId)
        : userPredictions[0];
      const scoredPredictions = userPredictions.filter(
        (prediction) => prediction.score !== null && prediction.score !== undefined,
      );
      const totalScore = scoredPredictions.reduce(
        (sum, prediction) => sum + Number(prediction.score ?? 0),
        0,
      );
      const bestScore = scoredPredictions.length
        ? Math.max(...scoredPredictions.map((prediction) => Number(prediction.score ?? 0)))
        : null;

      return {
        userId: member.user_id,
        name: profiles.get(member.user_id) ?? "Участник",
        role: member.role,
        joinedAt: formatDateTime(member.joined_at),
        currentScore: currentPrediction?.score ?? null,
        totalScore,
        scoredCount: scoredPredictions.length,
        averageScore: scoredPredictions.length
          ? Math.round((totalScore / scoredPredictions.length) * 10) / 10
          : 0,
        bestScore,
        picks: mapPredictionPicks(currentPrediction, driverNames, teamNames),
        scoreBreakdown: mapFantasyScoreBreakdown(currentPrediction?.score_breakdown),
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore || b.scoredCount - a.scoredCount || a.name.localeCompare(b.name));

  return {
    avatarUrl: getFantasyLeagueAvatarUrl({
      avatarPath: league.avatar_path,
      avatarUpdatedAt: league.avatar_updated_at,
      leagueId: league.id,
    }),
    id: league.id,
    isMember,
    isOwner,
    isPublic,
    name: league.name,
    inviteCode: isMember ? league.invite_code : undefined,
    members: detailMembers,
    history: buildLeagueHistory(predictions, profiles, driverNames, teamNames),
  };
}

async function ensureLeagueOwnerMembership(leagueId: string, userId: string) {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return;
  }

  await admin.from("prediction_league_members").upsert(
    {
      league_id: leagueId,
      role: "owner",
      user_id: userId,
    },
    { onConflict: "league_id,user_id" },
  );
}

async function hydrateLeagueScores(summaries: LeagueSummary[]) {
  const admin = createSupabaseAdminClient();

  if (!admin || !summaries.length) {
    return summaries;
  }

  const leagueIds = summaries.map((league) => league.id).filter(Boolean) as string[];
  const scoreData = await withServerTtlCache(
    `fantasy:league-scores:${[...leagueIds].sort().join(",")}`,
    30_000,
    async () => {
      const { data: membersData } = await admin
        .from("prediction_league_members")
        .select("league_id, user_id, role, joined_at")
        .in("league_id", leagueIds);
      const userIds = [...new Set((membersData ?? []).map((member) => member.user_id))];

      if (!userIds.length) {
        return { membersData, profilesData: [], predictionsData: [] };
      }

      const [profilesResult, predictionsResult] = await Promise.all([
        admin
          .from("profiles")
          .select("id, display_name, email")
          .in("id", userIds),
        admin
          .from("predictions")
          .select("user_id, race_id, score, races(round, race_name, race_start_at)")
          .in("user_id", userIds)
          .is("league_id", null)
          .not("score", "is", null),
      ]);

      return {
        membersData,
        profilesData: profilesResult.data ?? [],
        predictionsData: predictionsResult.data ?? [],
      };
    },
    { staleWhileRevalidateMs: 5 * 60_000 },
  );
  const { membersData, profilesData, predictionsData } = scoreData;

  const membersByLeague = new Map<string, LeagueMemberRow[]>();
  ((membersData ?? []) as LeagueMemberRow[]).forEach((member) => {
    membersByLeague.set(member.league_id, [
      ...(membersByLeague.get(member.league_id) ?? []),
      member,
    ]);
  });

  const userIds = [...new Set((membersData ?? []).map((member) => member.user_id))];

  if (!userIds.length) {
    return summaries;
  }

  const profiles = new Map(
    (profilesData as LeagueProfileRow[]).map((profile) => [
      profile.id,
      getProfileName(profile),
    ]),
  );
  const scoreByUser = new Map<string, number>();
  const scoredPredictions = predictionsData as unknown as LeaguePredictionRow[];
  scoredPredictions.forEach((prediction) => {
    scoreByUser.set(
      prediction.user_id,
      (scoreByUser.get(prediction.user_id) ?? 0) + Number(prediction.score ?? 0),
    );
  });

  return summaries.map((summary) => {
    const members = membersByLeague.get(summary.id ?? "") ?? [];
    const memberIds = new Set(members.map((member) => member.user_id));
    const leaguePredictions = scoredPredictions
      .filter((prediction) => memberIds.has(prediction.user_id))
      .sort((left, right) => {
        const leftStart = getTimeMs(getRelationObject(left.races)?.race_start_at ?? null) ?? 0;
        const rightStart = getTimeMs(getRelationObject(right.races)?.race_start_at ?? null) ?? 0;

        return rightStart - leftStart;
      });
    const latestRaceId = leaguePredictions[0]?.race_id ?? null;
    const latestRacePredictions = latestRaceId
      ? leaguePredictions.filter((prediction) => prediction.race_id === latestRaceId)
      : [];
    const lastRoundAverageScore = latestRacePredictions.length
      ? Math.round(
        (latestRacePredictions.reduce(
          (sum, prediction) => sum + Number(prediction.score ?? 0),
          0,
        ) / latestRacePredictions.length) * 10,
      ) / 10
      : null;
    const leader = members
      .map((member) => ({
        name: profiles.get(member.user_id) ?? "Участник",
        score: scoreByUser.get(member.user_id) ?? 0,
      }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))[0];

    return {
      ...summary,
      members: members.length || summary.members,
      leader: leader?.name ?? summary.leader,
      lastRoundAverageScore,
      lastRoundName: getRelationObject(leaguePredictions[0]?.races ?? null)?.race_name ?? null,
      score: leader?.score ?? summary.score,
    };
  });
}

async function getPredictionDriverNames(predictions: LeaguePredictionRow[]) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return new Map<string, string>();
  }

  const driverIds = [
    ...new Set(
      predictions
        .flatMap((prediction) => [
          ...(prediction.top10_driver_ids ?? []),
          prediction.winner_driver_id,
          prediction.pole_driver_id,
          prediction.fastest_lap_driver_id,
          prediction.dnf_driver_id,
        ])
        .filter(Boolean),
    ),
  ] as string[];

  if (!driverIds.length) {
    return new Map<string, string>();
  }

  const { data } = await supabase
    .from("drivers")
    .select("id, full_name")
    .in("id", driverIds);

  return new Map((data ?? []).map((driver) => [driver.id, driver.full_name]));
}

async function getPredictionTeamNames(predictions: LeaguePredictionRow[]) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return new Map<string, string>();
  }

  const teamIds = [
    ...new Set(
      predictions
        .flatMap((prediction) => [
          prediction.top_scoring_team_id,
          prediction.fastest_pit_stop_team_id,
        ])
        .filter(Boolean),
    ),
  ] as string[];

  if (!teamIds.length) {
    return new Map<string, string>();
  }

  const { data } = await supabase.from("teams").select("id, name").in("id", teamIds);

  return new Map((data ?? []).map((team) => [team.id, team.name]));
}

function mapPredictionPicks(
  prediction: LeaguePredictionRow | undefined,
  driverNames: Map<string, string>,
  teamNames: Map<string, string>,
) {
  if (!prediction) {
    return [
      { label: "Топ-10", value: "Не выбран" },
      { label: "Поул", value: "Не выбран" },
      { label: "Лучший круг", value: "Не выбран" },
      { label: "Первый сход", value: "Не выбран" },
      { label: "Лучшая команда", value: "Не выбран" },
      { label: "Пит-стоп", value: "Не выбран" },
    ];
  }

  const top10 = normalizeDriverIdList(prediction.top10_driver_ids);

  return [
    {
      label: "Топ-10",
      value: top10.length
        ? top10
            .map((driverId, index) => `${index + 1}. ${getDriverPickName(driverId, driverNames)}`)
            .join(" · ")
        : "Старый формат прогноза",
    },
    { label: "Поул", value: getDriverPickName(prediction.pole_driver_id, driverNames) },
    { label: "Лучший круг", value: getDriverPickName(prediction.fastest_lap_driver_id, driverNames) },
    { label: "Первый сход", value: getDnfPickName(prediction, driverNames) },
    { label: "Лучшая команда", value: getTeamPickName(prediction.top_scoring_team_id, teamNames) },
    { label: "Пит-стоп", value: getTeamPickName(prediction.fastest_pit_stop_team_id, teamNames) },
  ];
}

function getDriverPickName(driverId: string | null, driverNames: Map<string, string>) {
  return driverId ? driverNames.get(driverId) ?? "Пилот выбран" : "Не выбран";
}

function getTeamPickName(teamId: string | null | undefined, teamNames: Map<string, string>) {
  return teamId ? teamNames.get(teamId) ?? "Команда выбрана" : "Не выбран";
}

function getDnfPickName(
  prediction: Pick<LeaguePredictionRow, "dnf_driver_id" | "dnf_pick_kind">,
  driverNames: Map<string, string>,
) {
  if (prediction.dnf_pick_kind === "none") {
    return "Без DNF";
  }

  return getDriverPickName(prediction.dnf_driver_id, driverNames);
}

function mapPredictionTop10Result(
  prediction: LeaguePredictionRow,
  breakdown: FantasyScoreBreakdown | null,
  driverNames: Map<string, string>,
): PreviousPredictionTop10Pick[] {
  const top10 = normalizeDriverIdList(prediction.top10_driver_ids);

  if (!top10.length) {
    return [];
  }

  const breakdownByDriver = new Map(
    (breakdown?.top10 ?? []).map((item) => [item.driverId, item]),
  );

  return top10.map((driverId, index) => {
    const result = breakdownByDriver.get(driverId);

    return {
      actualPosition: result?.actualPosition ?? null,
      driverId,
      driverName: getDriverPickName(driverId, driverNames),
      points: result?.points ?? 0,
      predictedPosition: result?.predictedPosition || index + 1,
    };
  });
}

function mapPredictionSpecialResults(
  prediction: LeaguePredictionRow,
  breakdown: FantasyScoreBreakdown | null,
  driverNames: Map<string, string>,
  teamNames: Map<string, string>,
): PredictionResultPick[] {
  const specials = breakdown?.specials ?? {};

  return [
    {
      label: "Поул",
      points: specials.pole ?? 0,
      value: getDriverPickName(prediction.pole_driver_id, driverNames),
    },
    {
      label: "Лучший круг",
      points: specials.fastestLap ?? 0,
      value: getDriverPickName(prediction.fastest_lap_driver_id, driverNames),
    },
    {
      label: "Первый сход",
      points: specials.firstDnf ?? 0,
      value: getDnfPickName(prediction, driverNames),
    },
    {
      label: "Лучшая команда",
      points: specials.topScoringTeam ?? 0,
      value: getTeamPickName(prediction.top_scoring_team_id, teamNames),
    },
    {
      label: "Пит-стоп",
      points: specials.fastestPitStopTeam ?? 0,
      value: getTeamPickName(prediction.fastest_pit_stop_team_id, teamNames),
    },
  ];
}

function normalizeDriverIdList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function mapFantasyScoreBreakdown(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const source = value as Record<string, unknown>;
  const total = numberOrZero(source.total);
  const top10Points = numberOrZero(source.top10Points);
  const top10Bonus = numberOrZero(source.top10Bonus);
  const specialPoints = numberOrZero(source.specialPoints);

  return {
    total,
    top10Points,
    top10Bonus,
    specialPoints,
    top10: Array.isArray(source.top10)
      ? source.top10
          .filter((item): item is Record<string, unknown> =>
            Boolean(item && typeof item === "object" && !Array.isArray(item)),
          )
          .map((item) => ({
            predictedPosition: numberOrZero(item.predictedPosition),
            driverId: typeof item.driverId === "string" ? item.driverId : "",
            actualPosition:
              typeof item.actualPosition === "number" ? item.actualPosition : null,
            points: numberOrZero(item.points),
          }))
      : undefined,
    bonuses:
      source.bonuses && typeof source.bonuses === "object" && !Array.isArray(source.bonuses)
        ? (source.bonuses as Record<string, number>)
        : undefined,
    specials:
      source.specials && typeof source.specials === "object" && !Array.isArray(source.specials)
        ? (source.specials as Record<string, number>)
        : undefined,
  };
}

function numberOrZero(value: unknown) {
  const number = Number(value ?? 0);

  return Number.isFinite(number) ? number : 0;
}

function buildLeagueHistory(
  predictions: LeaguePredictionRow[],
  profiles: Map<string, string>,
  driverNames: Map<string, string>,
  teamNames: Map<string, string>,
): LeagueHistoryEntry[] {
  const byRace = new Map<string, LeaguePredictionRow[]>();

  predictions
    .filter((prediction) => prediction.score !== null && prediction.score !== undefined)
    .forEach((prediction) => {
      byRace.set(prediction.race_id, [...(byRace.get(prediction.race_id) ?? []), prediction]);
    });

  return [...byRace.values()]
    .map((racePredictions) => {
      const race = getRelationObject(racePredictions[0]?.races);

      return {
        raceName: race ? formatGrandPrixNameRu(race.race_name) : "Гран-при",
        round: race?.round ?? 0,
        season: race?.season_year ?? CURRENT_F1_SEASON,
        predictions: racePredictions
          .map((prediction) => {
            const scoreBreakdown = mapFantasyScoreBreakdown(prediction.score_breakdown);

            return {
              userId: prediction.user_id,
              name: profiles.get(prediction.user_id) ?? "Участник",
              score: prediction.score,
              scoreBreakdown,
              picks: mapPredictionPicks(prediction, driverNames, teamNames),
              specials: mapPredictionSpecialResults(prediction, scoreBreakdown, driverNames, teamNames),
              top10: mapPredictionTop10Result(prediction, scoreBreakdown, driverNames),
            };
          })
          .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0)),
      };
    })
    .sort((a, b) => b.round - a.round);
}

export async function getPolls({
  userId,
  view = "active",
}: {
  userId?: string | null;
  view?: "active" | "archive";
} = {}): Promise<PollSummary[]> {
  const polls = await withServerTtlCache(
    `public:polls:${view}`,
    60_000,
    () => getPublicPolls(view),
    { staleWhileRevalidateMs: 5 * 60_000 },
  );

  if (!userId || !polls.length) {
    return polls;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return polls;
  }

  const pollIds = polls.flatMap((poll) => (poll.id ? [poll.id] : []));

  if (!pollIds.length) {
    return polls;
  }

  const { data: votes, error } = await supabase
    .from("poll_votes")
    .select("poll_id, option_id")
    .eq("user_id", userId)
    .in("poll_id", pollIds);

  if (error || !votes?.length) {
    return polls;
  }

  const voteByPoll = new Map(votes.map((vote) => [vote.poll_id, vote.option_id]));

  return polls.map((poll) => ({
    ...poll,
    userVote: poll.id ? voteByPoll.get(poll.id) : undefined,
  }));
}

async function getPublicPolls(view: "active" | "archive"): Promise<PollSummary[]> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const query = supabase
    .from("polls")
    .select(
      "id, race_id, question, status, closes_at, poll_kind, races(id, season_year, round, race_name, circuits(name, country)), poll_options(id, label, sort_order)",
    )
    .order("created_at", { ascending: false })
    .limit(10);

  const { data, error } = await (view === "archive"
    ? query.eq("status", "closed")
    : query.eq("status", "published"));

  if (error || !data?.length) {
    return [];
  }

  const admin = createSupabaseAdminClient();
  const optionIds = (data as unknown as PollDbRow[]).flatMap((poll) =>
    (poll.poll_options ?? []).map((option) => option.id),
  );
  const voteCounts = new Map<string, number>();

  if (admin && optionIds.length) {
    const { data: votes } = await admin
      .from("poll_votes")
      .select("option_id")
      .in("option_id", optionIds);

    votes?.forEach((vote) => {
      voteCounts.set(vote.option_id, (voteCounts.get(vote.option_id) ?? 0) + 1);
    });
  }

  return (data as unknown as PollDbRow[]).map((poll) => {
    const options = poll.poll_options ?? [];
    const race = getRelationObject(poll.races);
    const circuit = getRelationObject(race?.circuits ?? null);

    return {
      id: poll.id,
      question: poll.question,
      kind: isPollKind(poll.poll_kind) ? poll.poll_kind : undefined,
      status: poll.status === "closed" ? "closed" : "published",
      closesAt: poll.closes_at,
      race: race
        ? {
            id: race.id,
            season: Number(race.season_year),
            round: Number(race.round),
            name: formatGrandPrixNameRu(race.race_name),
            circuit: circuit?.name ?? "Трасса уточняется",
            country: circuit?.country ?? "Страна уточняется",
          }
        : undefined,
      votes: options.reduce((sum, option) => sum + (voteCounts.get(option.id) ?? 0), 0),
      options: options.map((option) => ({
        id: option.id,
        label: option.label,
        votes: voteCounts.get(option.id) ?? 0,
      })),
    };
  });
}

function isPollKind(value: string | null): value is "sport" | "strategy" | "fan" {
  return value === "sport" || value === "strategy" || value === "fan";
}

export async function getRaceDetail(
  season: number,
  round: number,
): Promise<RaceDetail | null> {
  if ((await resolvePublishedSeason(season)) !== season) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("races")
    .select("id, season_year, round, race_name, race_start_at, status, circuits(id, name, country, locality, external_id, timezone)")
    .eq("season_year", season)
    .eq("round", round)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const currentRace = season === CURRENT_F1_SEASON
    ? await getCurrentRace("id, season_year, round, race_name, race_start_at, status")
    : null;

  return buildRaceDetail(data as unknown as RaceRow, data.id === currentRace?.id);
}

async function buildRaceDetail(race: RaceRow, isCurrent = false): Promise<RaceDetail> {
  const circuit = getRelationObject(race.circuits);
  const [layout, latestStanding, trackAssets, tyreAllocation] = await Promise.all([
    race.season_year === 2026 && circuit?.id ? getCircuitLayout(circuit.id) : null,
    getLatestCompleteStandingRound("driver_standings", 20, race.season_year),
    getRaceTrackAssetsByRaceIds([race.id]),
    getRaceTyreAllocation(race),
  ]);

  return {
    id: race.id,
    season: race.season_year,
    round: race.round,
    race: formatGrandPrixNameRu(race.race_name),
    circuit: circuit?.name ?? "Трасса уточняется",
    circuitId: circuit?.id ?? null,
    country: circuit?.country ?? "Страна уточняется",
    countryFlag: getCountryFlag(circuit?.country ?? ""),
    countryCode: getCountryCode(circuit?.country ?? ""),
    locality: circuit?.locality ?? "Город уточняется",
    startsAt: formatDateTime(race.race_start_at),
    startsAtIso: race.race_start_at ?? undefined,
    status: formatRaceStatus(
      race.status,
      isCurrent,
      isRaceCompletedByStandings(race, latestStanding),
    ),
    timezone: circuit?.timezone || getCircuitTimezone(circuit?.country ?? "", circuit?.name ?? ""),
    layout,
    trackMapUrl:
      trackAssets.get(race.id)?.image_url ??
      getCircuitAsset(circuit?.name, race.season_year)?.src ??
      (race.season_year === 2026 ? undefined : null),
    tyreAllocation,
  };
}

const verifiedRaceTyreAllocationFallbacks = new Map([
  [
    "2026-14",
    {
      hard: "C2",
      medium: "C3",
      soft: "C4",
      sourceUrl: "https://www.formula1.com/en/latest/article/what-tyres-will-the-teams-and-drivers-have-for-the-2026-spanish-grand-prix.2vlcVOBnZUFRCooVcqWG7n",
      updatedAt: "2026-09-09T11:20:00.000Z",
    },
  ],
]);

async function getRaceTyreAllocation(race: RaceRow) {
  const supabase = await createSupabaseServerClient();

  if (supabase) {
    const { data, error } = await supabase
      .from("races")
      .select("tyre_hard_compound, tyre_medium_compound, tyre_soft_compound, tyre_allocation_source_url, tyre_allocation_updated_at")
      .eq("id", race.id)
      .maybeSingle();

    if (
      !error
      && data?.tyre_hard_compound
      && data.tyre_medium_compound
      && data.tyre_soft_compound
    ) {
      return {
        hard: data.tyre_hard_compound,
        medium: data.tyre_medium_compound,
        soft: data.tyre_soft_compound,
        sourceUrl: data.tyre_allocation_source_url,
        updatedAt: data.tyre_allocation_updated_at,
      };
    }
  }

  return verifiedRaceTyreAllocationFallbacks.get(`${race.season_year}-${race.round}`) ?? null;
}

export async function getCircuitStatsForRace(
  season: number,
  round: number,
): Promise<CircuitStatsView | null> {
  if ((await resolvePublishedSeason(season)) !== season) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data: raceData, error: raceError } = await supabase
    .from("races")
    .select(`
      id,
      season_year,
      round,
      race_name,
      circuits(
        id,
        slug,
        name,
        country,
        locality,
        lap_length_km,
        race_laps,
        race_distance_km,
        turns_count,
        direction,
        first_grand_prix_year,
        lap_record_time,
        lap_record_driver,
        lap_record_year,
        drs_zones_count,
        track_type,
        track_description,
        overtaking_rating,
        qualifying_importance_rating,
        tyre_wear_rating,
        safety_car_rating,
        strategy_variability_rating,
        rain_risk_rating
      )
    `)
    .eq("season_year", season)
    .eq("round", round)
    .maybeSingle();

  if (raceError || !raceData) {
    return null;
  }

  const circuit = getRelationObject(
    (raceData as unknown as { circuits: CircuitStatsCircuitDbRow | CircuitStatsCircuitDbRow[] | null }).circuits,
  );

  if (!circuit?.id) {
    return null;
  }

  // These tables and circuit fields are current-season snapshots rather than
  // season-versioned data, so exposing them on an archive page would mix eras.
  const includeCurrentData = season === CURRENT_F1_SEASON;
  const currentParticipantStats = includeCurrentData
    ? Promise.all([
        supabase
          .from("circuit_driver_stats")
          .select("*")
          .eq("circuit_id", circuit.id)
          .eq("season_scope", "current_active")
          .order("wins", { ascending: false })
          .order("podiums", { ascending: false })
          .order("avg_finish_position", { ascending: true, nullsFirst: false })
          .limit(5),
        supabase
          .from("circuit_team_stats")
          .select("*")
          .eq("circuit_id", circuit.id)
          .eq("season_scope", "current_active")
          .order("wins", { ascending: false })
          .order("podiums", { ascending: false })
          .order("avg_points", { ascending: false, nullsFirst: false })
          .limit(5),
      ])
    : Promise.resolve([{ data: [] }, { data: [] }] as const);

  const [statsResult, historyResult, [driverStatsResult, teamStatsResult]] = await Promise.all([
    supabase
      .from("circuit_stats")
      .select("*")
      .eq("circuit_id", circuit.id)
      .lte("calculated_to_season", season)
      .order("calculated_to_season", { ascending: false, nullsFirst: false })
      .order("calculated_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("circuit_grand_prix_history")
      .select("*")
      .eq("circuit_id", circuit.id)
      .lte("season", season)
      .order("season", { ascending: false })
      .order("round", { ascending: false })
      .limit(10),
    currentParticipantStats,
  ]);

  const stats = statsResult.data as unknown as CircuitStatsDbRow | null;
  const historyRows = (historyResult.data ?? []) as unknown as CircuitHistoryDbRow[];
  const driverStatRows = (driverStatsResult.data ?? []) as unknown as CircuitDriverStatDbRow[];
  const teamStatRows = (teamStatsResult.data ?? []) as unknown as CircuitTeamStatDbRow[];
  const driverIds = [
    ...historyRows.flatMap((row) => [
      row.winner_driver_id,
      row.pole_driver_id,
      ...extractPodiumDriverIds(row.podium_json),
    ]),
    ...driverStatRows.map((row) => row.driver_id),
  ].filter((value): value is string => Boolean(value));
  const teamIds = [
    ...historyRows.flatMap((row) => [row.winner_team_id, row.pole_team_id]),
    ...teamStatRows.map((row) => row.team_id),
  ].filter((value): value is string => Boolean(value));
  const [drivers, teams] = await Promise.all([
    getDriversByIds([...new Set(driverIds)]),
    getTeamsByIds([...new Set(teamIds)]),
  ]);
  const records = getJsonRecord(stats?.records_json);
  const characterFallbackRatings: CircuitStatsView["ratings"] = [
    { label: "Обгоны", value: includeCurrentData ? circuit.overtaking_rating ?? null : null, helper: "Насколько реально отыгрывать позиции в гонке." },
    { label: "Квалификация", value: includeCurrentData ? circuit.qualifying_importance_rating ?? null : null, helper: "Как часто стартовая позиция решает итог гонки." },
    { label: "Износ шин", value: includeCurrentData ? circuit.tyre_wear_rating ?? null : null, helper: "Насколько трасса нагружает резину." },
    { label: "Safety Car", value: includeCurrentData ? circuit.safety_car_rating ?? null : null, helper: "Вероятность нейтрализаций и остановок." },
    { label: "Стратегия", value: includeCurrentData ? circuit.strategy_variability_rating ?? null : null, helper: "Сколько рабочих сценариев есть у мостиков." },
    { label: "Хаос", value: getChaosRating(toNumberOrNull(stats?.chaos_score)), helper: "Как часто гонка уходит от спокойного сценария." },
  ];
  const character = mapCircuitCharacterStats(records.characterSince2000, characterFallbackRatings);

  return {
    circuit: {
      id: circuit.id,
      slug: circuit.slug ?? null,
      name: circuit.name,
      country: circuit.country ?? "Страна уточняется",
      locality: circuit.locality ?? "Город уточняется",
      lapLengthKm: includeCurrentData ? toNumberOrNull(circuit.lap_length_km) : null,
      raceLaps: includeCurrentData ? circuit.race_laps ?? null : null,
      raceDistanceKm: includeCurrentData ? toNumberOrNull(circuit.race_distance_km) : null,
      turnsCount: includeCurrentData ? circuit.turns_count ?? null : null,
      direction: includeCurrentData ? circuit.direction ?? null : null,
      firstGrandPrixYear: circuit.first_grand_prix_year ?? null,
      lapRecordTime: includeCurrentData ? circuit.lap_record_time ?? null : null,
      lapRecordDriver: includeCurrentData ? circuit.lap_record_driver ?? null : null,
      lapRecordYear: includeCurrentData ? circuit.lap_record_year ?? null : null,
      drsZonesCount: includeCurrentData ? circuit.drs_zones_count ?? null : null,
      trackType: includeCurrentData ? circuit.track_type ?? null : null,
      description: includeCurrentData ? circuit.track_description ?? null : null,
    },
    ratings: [
      ...characterFallbackRatings.slice(0, -1),
      { label: "Дождь", value: includeCurrentData ? circuit.rain_risk_rating ?? null : null, helper: "Исторический и погодный риск мокрой гонки." },
    ],
    character,
    summary: {
      racesCount: stats?.races_count ?? historyRows.length,
      calculatedFromSeason: stats?.calculated_from_season ?? null,
      calculatedToSeason: stats?.calculated_to_season ?? null,
      updatedAt: stats?.calculated_at ? formatRelativeTime(stats.calculated_at) : null,
    },
    qualifying: {
      poleWinRate: toNumberOrNull(stats?.pole_win_rate),
      frontRowWinRate: toNumberOrNull(stats?.front_row_win_rate),
      winnerAvgStartPosition: toNumberOrNull(stats?.winner_avg_start_position),
      level: stats?.qualifying_importance_level ?? null,
      bestNonPoleWin: getPositionRecord(records.bestNonPoleWin),
    },
    overtaking: {
      avgPositionDelta: toNumberOrNull(stats?.avg_position_delta),
      avgAbsPositionDelta: toNumberOrNull(stats?.avg_abs_position_delta),
      level: stats?.overtaking_level ?? null,
      bestGain: getPositionRecord(stats?.best_position_gain_json),
      worstLoss: getPositionRecord(stats?.worst_position_loss_json),
    },
    chaos: {
      safetyCarFrequency: toNumberOrNull(stats?.safety_car_frequency),
      vscFrequency: toNumberOrNull(stats?.vsc_frequency),
      redFlagFrequency: toNumberOrNull(stats?.red_flag_frequency),
      avgDnfCount: toNumberOrNull(stats?.avg_dnf_count),
      chaosScore: toNumberOrNull(stats?.chaos_score),
      level: getChaosLevel(toNumberOrNull(stats?.chaos_score)),
    },
    strategy: {
      avgPitStops: toNumberOrNull(stats?.avg_pit_stops),
      avgFirstPitLap: toNumberOrNull(stats?.avg_first_pit_lap),
      mostCommonStrategy: stats?.most_common_strategy ?? null,
      strategyVariabilityLevel: stats?.strategy_variability_level ?? null,
      distribution: getNumberRecord(stats?.strategy_distribution),
    },
    records: {
      biggestWinGap: stringOrNull(records.biggestWinGap),
      maxDnfCount: toNumberOrNull(records.maxDnfCount),
      mostSuccessfulDriver: stringOrNull(records.mostSuccessfulDriver),
      mostSuccessfulTeam: stringOrNull(records.mostSuccessfulTeam),
    },
    aiPreview: includeCurrentData ? stats?.ai_preview ?? null : null,
    history: historyRows.map((row) => ({
      season: row.season,
      round: row.round,
      raceName: formatGrandPrixNameRu(row.race_name),
      raceDate: row.race_date ? formatDateTime(row.race_date) : "Дата уточняется",
      href: `/calendar/${row.season}/${row.round}`,
      winner: getDriverName(drivers, row.winner_driver_id),
      winnerTeam: getTeamName(teams, row.winner_team_id),
      pole: getDriverName(drivers, row.pole_driver_id),
      poleTeam: getTeamName(teams, row.pole_team_id),
      winnerStartPosition: row.winner_start_position ?? null,
      winnerFromPole: row.winner_from_pole ?? null,
      podium: extractPodiumNames(row.podium_json, drivers),
      dnfCount: row.dnf_count ?? null,
      safetyCarCount: row.safety_car_count ?? null,
      vscCount: row.vsc_count ?? null,
      redFlagCount: row.red_flag_count ?? null,
    })),
    topDrivers: driverStatRows.map((row) => {
      const driver = drivers.get(row.driver_id);
      const team = driver?.currentTeamId ? teams.get(driver.currentTeamId) : null;

      return {
        driver: driver?.fullName ?? "Пилот уточняется",
        driverSlug: driver?.slug ?? null,
        team: team?.name ?? "Команда уточняется",
        teamColor: team?.color ?? null,
        starts: row.starts,
        wins: row.wins,
        podiums: row.podiums,
        pointsFinishes: row.points_finishes,
        dnfs: row.dnfs,
        avgStartPosition: toNumberOrNull(row.avg_start_position),
        avgFinishPosition: toNumberOrNull(row.avg_finish_position),
        bestFinish: row.best_finish ?? null,
      };
    }),
    topTeams: teamStatRows.map((row) => {
      const team = teams.get(row.team_id);

      return {
        team: team?.name ?? "Команда уточняется",
        teamColor: team?.color ?? null,
        starts: row.starts,
        wins: row.wins,
        podiums: row.podiums,
        pointsFinishes: row.points_finishes,
        avgPoints: toNumberOrNull(row.avg_points),
        bestFinish: row.best_finish ?? null,
        doublePointsFinishes: row.double_points_finishes,
      };
    }),
    sourceErrors: collectCircuitSourceErrors(stats?.source_errors, historyRows),
  };
}

export async function getCurrentRaceDetail(): Promise<RaceDetail | null> {
  const race = await getCurrentRace();

  if (!race) {
    return null;
  }

  return buildRaceDetail(race, true);
}

export async function getCurrentRaceReplaySummary(): Promise<RaceReplaySummary | null> {
  const race = await getCurrentRace();

  if (!race || race.season_year !== CURRENT_F1_SEASON) {
    return null;
  }

  return getRaceReplaySummaryByRaceId(race.id, CURRENT_F1_SEASON);
}

export async function getRaceReplaySummaryByRaceId(
  raceId: string,
  targetSeason: number,
): Promise<RaceReplaySummary | null> {
  const supabase = createSupabaseAdminClient() ?? await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("race_replay_sessions")
    .select("id, title, status, source_season, source_session_key, races!inner(season_year)")
    .eq("race_id", raceId)
    .eq("races.season_year", targetSeason)
    .eq("status", "ready")
    .order("prepared_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    href: `/race-replay/${data.source_session_key}`,
    id: data.id,
    sourceSeason: data.source_season,
    sourceSessionKey: data.source_session_key,
    status: data.status,
    title: data.title,
  };
}

type RaceReplayCacheEntry = {
  expiresAt: number;
  value: Promise<RaceReplaySnapshot | null>;
};

const RACE_REPLAY_CACHE_TTL_MS = 24 * 60 * 60_000;
const MAX_RACE_REPLAY_CACHE_ENTRIES = 3;
const replaySnapshotCacheGlobal = globalThis as typeof globalThis & {
  __raceMateReplaySnapshotCache?: Map<string, RaceReplayCacheEntry>;
};
const replaySnapshotCache =
  replaySnapshotCacheGlobal.__raceMateReplaySnapshotCache ??
  new Map<string, RaceReplayCacheEntry>();

replaySnapshotCacheGlobal.__raceMateReplaySnapshotCache = replaySnapshotCache;

export async function getRaceReplayBySessionKey(
  sessionKey: number,
  targetSeason: number,
): Promise<RaceReplaySnapshot | null> {
  const descriptor = await withServerTtlCache(
    `race-replay:descriptor:${targetSeason}:${sessionKey}`,
    60_000,
    async () => {
      const supabase = createSupabaseAdminClient() ?? await createSupabaseServerClient();

      if (!supabase) {
        return null;
      }

      const { data, error } = await supabase
        .from("race_replay_sessions")
        .select("id, source_session_key, updated_at, races!inner(season_year)")
        .eq("source_session_key", sessionKey)
        .eq("races.season_year", targetSeason)
        .eq("status", "ready")
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return {
        id: data.id,
        sourceSessionKey: data.source_session_key,
        updatedAt: data.updated_at,
      };
    },
  );

  if (!descriptor) {
    return null;
  }

  const cacheKey = `pit-layout-v1:${descriptor.id}:${descriptor.updatedAt}`;
  const now = Date.now();
  const cached = replaySnapshotCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    replaySnapshotCache.delete(cacheKey);
    replaySnapshotCache.set(cacheKey, cached);
    return cached.value;
  }

  if (cached) {
    replaySnapshotCache.delete(cacheKey);
  }

  const value = loadRaceReplaySnapshot(
    descriptor.id,
    descriptor.sourceSessionKey,
    targetSeason,
  );
  const entry: RaceReplayCacheEntry = {
    expiresAt: now + RACE_REPLAY_CACHE_TTL_MS,
    value,
  };

  replaySnapshotCache.set(cacheKey, entry);
  pruneRaceReplaySnapshotCache();
  void value.then(
    (snapshot) => {
      if (!snapshot && replaySnapshotCache.get(cacheKey) === entry) {
        replaySnapshotCache.delete(cacheKey);
      }
    },
    () => {
      if (replaySnapshotCache.get(cacheKey) === entry) {
        replaySnapshotCache.delete(cacheKey);
      }
    },
  );

  return value;
}

async function loadRaceReplaySnapshot(
  replaySessionId: string,
  sourceSessionKey: number,
  targetSeason: number,
): Promise<RaceReplaySnapshot | null> {
  const supabase = createSupabaseAdminClient() ?? await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const [{ data, error }, replayEventRows] = await Promise.all([
    supabase
      .from("race_replay_sessions")
      .select("id, source_session_key, snapshot, races!inner(season_year)")
      .eq("id", replaySessionId)
      .eq("source_session_key", sourceSessionKey)
      .eq("races.season_year", targetSeason)
      .eq("status", "ready")
      .maybeSingle(),
    loadReplayDataEventRows(supabase, replaySessionId),
  ]);

  if (error || !data) {
    return null;
  }

  const snapshot = normalizeRaceReplaySnapshot(data.snapshot, data.id, data.source_session_key);

  if (snapshot) {
    snapshot.track = withVerifiedReplayPitLane(snapshot.track);
    const positionRows = replayEventRows.filter((row) => row.event_type === "position");
    const positionTimingRows = replayEventRows.filter((row) => row.event_type === "position_timing");
    const intervalTimingRows = replayEventRows.filter((row) => row.event_type === "interval_timing");
    const lapTimingRows = replayEventRows.filter((row) => row.event_type === "lap_timing");

    snapshot.positions = mergeReplayPositions(
      snapshot.positions,
      normalizeReplayPositions(positionRows.map((row) => row.payload)),
    );
    snapshot.lapTimings = mergeReplayLapTimings(
      snapshot.lapTimings,
      normalizeReplayLapTimings(lapTimingRows.map((row) => row.payload)),
    );
    snapshot.positionTimings = mergeReplayPositionTimings(
      snapshot.positionTimings,
      normalizeReplayPositionTimings(positionTimingRows.map((row) => row.payload)),
    );
    snapshot.intervalTimings = mergeReplayIntervalTimings(
      snapshot.intervalTimings,
      normalizeReplayIntervalTimings(intervalTimingRows.map((row) => row.payload)),
    );
  }

  return snapshot;
}

function mergeReplayLapTimings(
  snapshotTimings: RaceReplaySnapshot["lapTimings"],
  eventTimings: RaceReplaySnapshot["lapTimings"],
) {
  const merged = new Map<string, NonNullable<RaceReplaySnapshot["lapTimings"]>[number]>();

  for (const timing of [...(snapshotTimings ?? []), ...(eventTimings ?? [])]) {
    merged.set(`${timing.driverNumber}:${timing.lapNumber}`, timing);
  }

  return [...merged.values()].sort((a, b) =>
    a.driverNumber - b.driverNumber ||
    a.lapNumber - b.lapNumber ||
    a.startOffsetMs - b.startOffsetMs,
  );
}

async function loadReplayDataEventRows(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  replaySessionId: string,
) {
  const rows: Array<{ event_type: string; payload: unknown }> = [];
  const pageSize = 1_000;

  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase
      .from("race_replay_events")
      .select("event_type, payload")
      .eq("replay_session_id", replaySessionId)
      .in("event_type", ["position", "lap_timing", "position_timing", "interval_timing"])
      .order("offset_ms", { ascending: true })
      .range(start, start + pageSize - 1);

    if (error || !data?.length) {
      break;
    }

    rows.push(...data);

    if (data.length < pageSize) {
      break;
    }
  }

  return rows;
}

function pruneRaceReplaySnapshotCache() {
  while (replaySnapshotCache.size > MAX_RACE_REPLAY_CACHE_ENTRIES) {
    const oldestKey = replaySnapshotCache.keys().next().value;

    if (typeof oldestKey !== "string") {
      break;
    }

    replaySnapshotCache.delete(oldestKey);
  }
}

function normalizeRaceReplaySnapshot(value: unknown, replaySessionId: string, sourceSessionKey: number): RaceReplaySnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const snapshot = value as Partial<RaceReplaySnapshot>;

  if (!snapshot.track || !Array.isArray(snapshot.positions) || !Array.isArray(snapshot.drivers)) {
    return null;
  }

  return {
    circuitName: String(snapshot.circuitName ?? "Трасса"),
    drivers: snapshot.drivers,
    durationMs: Number(snapshot.durationMs ?? 0),
    lapTimings: normalizeReplayLapTimings(snapshot.lapTimings),
    intervalTimings: normalizeReplayIntervalTimings(snapshot.intervalTimings),
    positionTimings: Array.isArray(snapshot.positionTimings) ? snapshot.positionTimings : undefined,
    positions: snapshot.positions,
    raceEvents: Array.isArray(snapshot.raceEvents) ? snapshot.raceEvents : [],
    radio: Array.isArray(snapshot.radio) ? snapshot.radio : [],
    raceName: formatGrandPrixNameRu(String(snapshot.raceName ?? "Повтор гонки")),
    replaySessionId,
    sourceSeason: Number(snapshot.sourceSeason ?? new Date().getUTCFullYear() - 1),
    sourceSessionKey,
    totalLaps: Number.isFinite(Number(snapshot.totalLaps)) ? Number(snapshot.totalLaps) : null,
    track: snapshot.track,
    weather: snapshot.weather ?? null,
  };
}

function normalizeReplayPositions(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is RaceReplaySnapshot["positions"][number] =>
        Boolean(entry) && typeof entry === "object" &&
        Number.isFinite(Number((entry as { driverNumber?: unknown }).driverNumber)) &&
        Number.isFinite(Number((entry as { offsetMs?: unknown }).offsetMs)) &&
        Number.isFinite(Number((entry as { progress?: unknown }).progress)),
      )
    : [];
}

function mergeReplayPositions(
  snapshotPositions: RaceReplaySnapshot["positions"],
  eventPositions: RaceReplaySnapshot["positions"],
) {
  const eventDrivers = new Set(eventPositions.map((position) => position.driverNumber));
  const merged = [
    ...snapshotPositions.filter((position) => !eventDrivers.has(position.driverNumber)),
    ...eventPositions,
  ];

  return merged.sort((a, b) => a.offsetMs - b.offsetMs || a.driverNumber - b.driverNumber);
}

function normalizeReplayPositionTimings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is NonNullable<RaceReplaySnapshot["positionTimings"]>[number] =>
        Boolean(entry) && typeof entry === "object" &&
        Number.isFinite(Number((entry as { driverNumber?: unknown }).driverNumber)) &&
        Number.isFinite(Number((entry as { offsetMs?: unknown }).offsetMs)) &&
        Number.isFinite(Number((entry as { position?: unknown }).position)),
      )
    : [];
}

function mergeReplayPositionTimings(
  snapshotTimings: RaceReplaySnapshot["positionTimings"],
  eventTimings: RaceReplaySnapshot["positionTimings"],
) {
  const eventDrivers = new Set((eventTimings ?? []).map((timing) => timing.driverNumber));

  return [
    ...(snapshotTimings ?? []).filter((timing) => !eventDrivers.has(timing.driverNumber)),
    ...(eventTimings ?? []),
  ].sort((a, b) => a.offsetMs - b.offsetMs || a.driverNumber - b.driverNumber);
}

function normalizeReplayIntervalTimings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is NonNullable<RaceReplaySnapshot["intervalTimings"]>[number] =>
        Boolean(entry) && typeof entry === "object" &&
        Number.isFinite(Number((entry as { driverNumber?: unknown }).driverNumber)) &&
        Number.isFinite(Number((entry as { offsetMs?: unknown }).offsetMs)),
      )
    : [];
}

function mergeReplayIntervalTimings(
  snapshotTimings: RaceReplaySnapshot["intervalTimings"],
  eventTimings: RaceReplaySnapshot["intervalTimings"],
) {
  const eventDrivers = new Set((eventTimings ?? []).map((timing) => timing.driverNumber));

  return [
    ...(snapshotTimings ?? []).filter((timing) => !eventDrivers.has(timing.driverNumber)),
    ...(eventTimings ?? []),
  ].sort((a, b) => a.offsetMs - b.offsetMs || a.driverNumber - b.driverNumber);
}

function normalizeReplayLapTimings(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const timings = value.flatMap((entry) => {
    if (Array.isArray(entry)) {
      const [driverNumber, lapNumber, startOffsetMs, durationMs] = entry.map(Number);

      return Number.isFinite(driverNumber) &&
        Number.isFinite(lapNumber) &&
        lapNumber > 0 &&
        Number.isFinite(startOffsetMs)
        ? [{
            driverNumber,
            durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null,
            lapNumber,
            startOffsetMs,
          }]
        : [];
    }

    if (!entry || typeof entry !== "object") {
      return [];
    }

    const timing = entry as Record<string, unknown>;
    const driverNumber = Number(timing.driverNumber);
    const lapNumber = Number(timing.lapNumber);
    const startOffsetMs = Number(timing.startOffsetMs);
    const durationMs = Number(timing.durationMs);

    return Number.isFinite(driverNumber) &&
      Number.isFinite(lapNumber) &&
      lapNumber > 0 &&
      Number.isFinite(startOffsetMs)
      ? [{
          driverNumber,
          durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null,
          lapNumber,
          startOffsetMs,
        }]
      : [];
  });

  return timings.length ? timings : undefined;
}

export async function getRaceWinnerOdds(race: RaceDetail | null): Promise<RaceWinnerOdds | null> {
  if (!race) {
    return null;
  }

  const driverNames = await getActiveDriverNames();
  const events = await fetchPolymarketRaceEvents();
  const scoredEvents = events
    .filter((event) => isPolymarketEventForRace(event, race))
    .map((event) => ({
      event,
      outcomes: parsePolymarketEventOutcomes(event, driverNames, "race-winner"),
      score: scorePolymarketEvent(event, race),
    }))
    .filter((entry) => entry.score >= 9 && entry.outcomes.length >= 2)
    .sort(
      (a, b) =>
        b.score - a.score ||
        getEventVolume(b.event) - getEventVolume(a.event) ||
        b.outcomes[0].probability - a.outcomes[0].probability,
    );
  const selected = scoredEvents[0];

  if (!selected) {
    return null;
  }

  return {
    marketTitle: selected.event.title ?? `${race.race}: победитель`,
    marketUrl: getPolymarketEventUrl(selected.event),
    source: "Polymarket",
    updatedAt: formatRelativeTime(getPolymarketUpdatedAt(selected.event)),
    outcomes: selected.outcomes.slice(0, 6),
  };
}

export async function getSeasonChampionOdds(): Promise<SeasonChampionOdds | null> {
  const driverNames = await getActiveDriverNames();
  const events = await fetchPolymarketRaceEvents();
  const selected = events
    .filter((event) => event.active && !event.closed && !event.archived)
    .map((event) => ({
      event,
      outcomes: parsePolymarketEventOutcomes(event, driverNames, "driver-champion"),
      score: scoreSeasonChampionEvent(event),
    }))
    .filter((entry) => entry.score >= 8 && entry.outcomes.length >= 2)
    .sort(
      (a, b) =>
        b.score - a.score ||
        getEventVolume(b.event) - getEventVolume(a.event) ||
        b.outcomes[0].probability - a.outcomes[0].probability,
    )[0];

  if (!selected) {
    return null;
  }

  return {
    marketTitle: selected.event.title ?? "F1 Drivers' Champion",
    marketUrl: getPolymarketEventUrl(selected.event),
    source: "Polymarket",
    updatedAt: formatRelativeTime(getPolymarketUpdatedAt(selected.event)),
    outcomes: selected.outcomes.slice(0, 6),
  };
}

export async function getConstructorChampionOdds(): Promise<ConstructorChampionOdds | null> {
  const teamNames = await getActiveTeamNames();
  const events = await fetchPolymarketRaceEvents();
  const selected = events
    .filter((event) => event.active && !event.closed && !event.archived)
    .map((event) => ({
      event,
      outcomes: parsePolymarketEventOutcomes(event, teamNames, "constructor-champion"),
      score: scoreConstructorChampionEvent(event),
    }))
    .filter((entry) => entry.score >= 8 && entry.outcomes.length >= 2)
    .sort(
      (a, b) =>
        b.score - a.score ||
        getEventVolume(b.event) - getEventVolume(a.event) ||
        b.outcomes[0].probability - a.outcomes[0].probability,
    )[0];

  if (!selected) {
    return null;
  }

  return {
    marketTitle: selected.event.title ?? "F1 Constructors' Champion",
    marketUrl: getPolymarketEventUrl(selected.event),
    source: "Polymarket",
    updatedAt: formatRelativeTime(getPolymarketUpdatedAt(selected.event)),
    outcomes: selected.outcomes.slice(0, 6),
  };
}

export async function getRaceSessions(
  season: number,
  round: number,
): Promise<WeekendSession[]> {
  const race = await getRaceDetail(season, round);

  if (!race) {
    return [];
  }

  const sessions = await getWeekendSessions(race.id);

  return sessions.map((session) => ({
    ...session,
    href: `/calendar/${season}/${round}?session=${session.id}`,
  }));
}

export async function getSessionResults(
  sessionId: string | null | undefined,
  season: number,
): Promise<SessionResult[]> {
  if (!sessionId) {
    return [];
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("session_results")
    .select("driver_id, position, time_text, status, grid, laps, points, raw_payload, sessions(session_type), drivers(full_name, slug, permanent_number), teams(name, code, color_hex)")
    .eq("session_id", sessionId)
    .order("position", { ascending: true, nullsFirst: false });

  if (error || !data?.length) {
    return [];
  }

  const rows = data as unknown as SessionResultDbRow[];
  const seasonProfiles = await getDriverSeasonProfilesByIds(
    supabase,
    season,
    getSessionResultDriverIds(rows),
  );

  return mapSessionResultRows(rows, season, seasonProfiles);
}

export async function getSessionResultsBySessionIds(
  sessionIds: Array<string | null | undefined>,
  season: number,
): Promise<Map<string, SessionResult[]>> {
  const ids = [...new Set(sessionIds.filter((sessionId): sessionId is string => Boolean(sessionId)))];

  if (!ids.length) {
    return new Map();
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("session_results")
    .select("session_id, driver_id, position, time_text, status, grid, laps, points, raw_payload, sessions(session_type), drivers(full_name, slug, permanent_number), teams(name, code, color_hex)")
    .in("session_id", ids)
    .order("position", { ascending: true, nullsFirst: false });

  if (error || !data?.length) {
    return new Map();
  }

  const resultRows = data as unknown as Array<SessionResultDbRow & { session_id: string }>;
  const seasonProfiles = await getDriverSeasonProfilesByIds(
    supabase,
    season,
    getSessionResultDriverIds(resultRows),
  );
  const rowsBySession = new Map<string, SessionResultDbRow[]>();

  resultRows.forEach((row) => {
    const rows = rowsBySession.get(row.session_id) ?? [];
    rows.push(row);
    rowsBySession.set(row.session_id, rows);
  });

  return new Map(
    [...rowsBySession].map(([sessionId, rows]) => [
      sessionId,
      mapSessionResultRows(rows, season, seasonProfiles),
    ]),
  );
}

function getSessionResultDriverIds(rows: SessionResultDbRow[]) {
  return [...new Set(rows.flatMap((row) => (row.driver_id ? [row.driver_id] : [])))];
}

function mapSessionResultRows(
  rows: SessionResultDbRow[],
  season: number,
  seasonProfiles = new Map<string, DriverSeasonProfileDbRow>(),
): SessionResult[] {
  return deduplicateSessionResultRows(
    rows
    .filter((row) => {
      const session = getRelationObject(row.sessions);

      if (session?.session_type !== "race" && session?.session_type !== "sprint") {
        return true;
      }

      return !isLapOnlyResult(row);
    }),
    season,
    seasonProfiles,
  )
    .map((row) => {
      const driver = getRelationObject(row.drivers);
      const seasonProfile = row.driver_id ? seasonProfiles.get(row.driver_id) : null;

      return {
        ...getTeamVisualFields(row.teams, "Команда уточняется", season),
        position: row.position,
        driver: getRelationName(row.drivers, "Пилот уточняется"),
        driverSlug: driver?.slug ?? undefined,
        driverNumber:
          seasonProfile?.permanent_number ??
          getDriverSeasonNumberOverride(driver?.slug, season) ??
          getSessionResultDriverNumber(row.raw_payload) ??
          driver?.permanent_number ??
          undefined,
        time: row.time_text ?? "Без времени",
        status: row.status ?? "Классифицирован",
        grid: row.grid,
        laps: row.laps,
        points: row.points === null ? null : Number(row.points),
        bestLap: getFastestLapTimeFromPayload(row.raw_payload),
        bestLapNumber: getFastestLapNumberFromPayload(row.raw_payload),
      };
    });
}

function deduplicateSessionResultRows(
  rows: SessionResultDbRow[],
  season: number,
  seasonProfiles: Map<string, DriverSeasonProfileDbRow>,
) {
  const selectedRows = new Map<string, { priority: number; row: SessionResultDbRow }>();

  rows.forEach((row, index) => {
    const driver = getRelationObject(row.drivers);
    const seasonProfile = row.driver_id ? seasonProfiles.get(row.driver_id) : null;
    const number =
      seasonProfile?.permanent_number ??
      getDriverSeasonNumberOverride(driver?.slug, season) ??
      getSessionResultDriverNumber(row.raw_payload) ??
      driver?.permanent_number ??
      null;
    const key = number
      ? `number:${number}`
      : row.driver_id
        ? `driver:${row.driver_id}`
        : `row:${index}`;
    const priority =
      (seasonProfile ? 4 : 0) +
      (driver?.full_name ? 2 : 0) +
      (getRelationObject(row.teams)?.name ? 1 : 0);
    const current = selectedRows.get(key);

    if (!current || priority > current.priority) {
      selectedRows.set(key, { priority, row });
    }
  });

  return [...selectedRows.values()]
    .map((entry) => entry.row)
    .sort((left, right) => (left.position ?? 999) - (right.position ?? 999));
}

function getSessionResultDriverNumber(rawPayload: unknown) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return undefined;
  }

  const payload = rawPayload as Record<string, unknown>;
  const driver = payload.Driver && typeof payload.Driver === "object" && !Array.isArray(payload.Driver)
    ? payload.Driver as Record<string, unknown>
    : null;
  const candidates = [
    driver?.permanentNumber,
    driver?.permanent_number,
    payload.driver_number,
    payload.driverNumber,
  ];

  for (const candidate of candidates) {
    const number = Number(candidate);

    if (Number.isInteger(number) && number > 0) {
      return number;
    }
  }

  return undefined;
}

export async function getRaceNews(raceId: string, limit = 5): Promise<NewsItem[]> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  let { data, error } = await supabase
    .from("news_articles")
    .select(NEWS_ARTICLE_SELECT)
    .eq("status", "processed")
    .eq("publication_status", "published")
    .or("ai_model.is.null,ai_model.neq.fallback")
    .eq("related_race_id", raceId)
    .is("duplicate_of", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error && isMissingNewsArticleColumnsError(error)) {
    const fallback = await supabase
      .from("news_articles")
      .select(LEGACY_NEWS_ARTICLE_SELECT)
      .eq("status", "processed")
      .eq("publication_status", "published")
      .or("ai_model.is.null,ai_model.neq.fallback")
      .eq("related_race_id", raceId)
      .is("duplicate_of", null)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(limit);

    data = fallback.data;
    error = fallback.error;
  }

  if (error || !data?.length) {
    return [];
  }

  const tagAllowlist = await getCurrentNewsTagAllowlist();

  return (data as unknown as ArticleRow[]).map((row) => mapArticleRow(row, tagAllowlist));
}

export async function getLatestDailyDigest(): Promise<DailyDigest | null> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("digests")
    .select("id, title, body_md, generated_at, status")
    .eq("digest_type", "daily_news")
    .eq("status", "published")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const digest = data as DigestDbRow;

  return {
    id: digest.id,
    title: digest.title,
    body: normalizeDailyDigestBody(digest.body_md),
    generatedAt: formatRelativeTime(digest.generated_at),
    status: digest.status,
  };
}

export async function getNewsArticle(slugOrId: string) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const normalizedLookup = slugOrId.trim().toLowerCase();
  const lookupColumn = NEWS_ARTICLE_ID_PATTERN.test(normalizedLookup) ? "id" : "slug";
  const buildQuery = (select: string, column: "id" | "slug") =>
    supabase
      .from("news_articles")
      .select(select)
      .eq(column, normalizedLookup)
      .eq("status", "processed")
      .eq("publication_status", "published")
      .or("ai_model.is.null,ai_model.neq.fallback")
      .is("duplicate_of", null)
      .maybeSingle();

  let { data, error } = await buildQuery(NEWS_ARTICLE_SELECT, lookupColumn);

  if (error && isMissingNewsArticleColumnsError(error)) {
    if (lookupColumn === "slug") {
      return null;
    }

    const fallback = await buildQuery(LEGACY_NEWS_ARTICLE_SELECT, "id");
    data = fallback.data;
    error = fallback.error;
  }

  if (error || !data) {
    return null;
  }

  const tagAllowlist = await getCurrentNewsTagAllowlist();

  const article = mapArticleRow(data as unknown as ArticleRow, tagAllowlist);
  // Optional enrichment keeps the article readable during a rolling schema deployment.
  const [{ data: editorial }, { data: sources }] = await Promise.all([
    supabase.from("news_articles").select("editorial_meta, content_modified_at").eq("id", article.id).maybeSingle(),
    supabase.from("news_article_sources").select("source_url,source_name,source_authors,source_published_at").eq("article_id", article.id).order("added_at"),
  ]);
  if (editorial) {
    article.editorial = editorial.editorial_meta as NewsItem["editorial"];
    article.modifiedAt = editorial.content_modified_at && Date.parse(editorial.content_modified_at) > Date.parse(article.publishedAt ?? "")
      ? editorial.content_modified_at : article.publishedAt;
    article.sources = sources as NewsItem["sources"];
  }
  return article;
}

export async function getArticleReactionCounts(articleId: string) {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return { "🔥": 0, "🏁": 0, "👀": 0, "🤔": 0 };
  }

  const { data } = await admin
    .from("article_reactions")
    .select("reaction")
    .eq("article_id", articleId);

  return (data ?? []).reduce<Record<string, number>>(
    (counts, row) => {
      counts[row.reaction] = (counts[row.reaction] ?? 0) + 1;
      return counts;
    },
    { "🔥": 0, "🏁": 0, "👀": 0, "🤔": 0 },
  );
}

function mapArticleRow(row: ArticleRow, tagAllowlist?: NewsTagAllowlist): NewsItem {
  const title = row.ai_title_ru ?? row.original_title;
  const summary =
    row.ai_summary_ru ??
    row.original_description ??
    "Короткое саммари появится после обработки новости.";
  const details = normalizeArticleDetails(row.ai_summary_long_ru, summary);
  const race = row.races;
  const raceTag = race
    ? `${formatGrandPrixNameRu(race.race_name)}, ${race.season_year}`
    : undefined;
  const tags = getArticleTags(row.news_article_tags, tagAllowlist);
  const raceTagSlug = tags.find((tag) => tag.type === "race")?.slug;
  const raceFilter = race ? `${race.season_year}-${race.round}` : undefined;
  const imageUrl = getNewsImageUrl(row);

  return {
    id: row.id,
    slug: row.slug ?? row.id,
    href: row.canonical_url,
    source: getRelationName(row.news_sources, "Источник"),
    editorial: row.editorial_meta,
    title,
    summary,
    details,
    highlights: row.ai_highlights_ru ?? [],
    imageUrl,
    sourceImageUrl: imageUrl,
    tags,
    raceTag,
    raceTagSlug,
    raceFilter,
    publishedAt: row.published_at ?? undefined,
    time: formatRelativeTime(row.published_at),
  };
}

function mapSocialPostRow(row: SocialPostDbRow): SocialPost {
  const source = getRelationObject(row.social_sources);
  const supabaseUrl = getSupabaseEnv()?.url;
  const media = [...(row.social_post_media ?? [])]
    .sort((left, right) => left.sort_order - right.sort_order)
    .filter((item) => item.media_type === "image" || item.media_type === "video" || item.media_type === "gif" || item.media_type === "link")
    .map((item) => {
      const url = getSocialMediaDeliveryUrl({
        mediaId: item.id,
        storedUrl: item.url,
        supabaseUrl,
      });
      const previewUrl = item.preview_url
        ? getSocialMediaDeliveryUrl({
            mediaId: item.id,
            storedUrl: item.preview_url,
            supabaseUrl,
          })
        : undefined;

      return {
        id: item.id,
        type: item.media_type as SocialPost["media"][number]["type"],
        url,
        previewUrl,
        altText: item.alt_text ?? undefined,
        width: item.width ?? undefined,
        height: item.height ?? undefined,
      };
    });
  const tags = (row.social_post_tags ?? []).flatMap((relation) =>
    getRelationList(relation.tags).map((tag) => ({
      name: tag.type === "race" ? formatGrandPrixTagNameRu(tag.name) : tag.name,
      slug: tag.slug,
      type: tag.type,
      isPrimary: relation.is_primary,
    })),
  );
  const originalTelegramText = row.body?.trim() || row.title?.trim() || "";
  const originalTelegramTitle = row.title?.trim() || "";
  const hasDistinctTelegramTitle = Boolean(
    originalTelegramTitle && originalTelegramText && originalTelegramTitle !== originalTelegramText,
  );

  return {
    id: row.id,
    platform: row.platform,
    author: row.author?.trim() || (row.platform === "reddit" ? "Reddit" : row.platform === "telegram" ? "Telegram" : "X"),
    source: normalizeSocialSourceName(source?.name ?? row.author?.trim() ?? "Источник", row.platform),
    sourceTrust: source?.trust_level === "official" || source?.trust_level === "media" ? source.trust_level : "community",
    title: row.platform === "telegram"
      ? (hasDistinctTelegramTitle ? originalTelegramTitle : "")
      : row.ai_title_ru?.trim() || row.title?.trim() || "Материал из соцсетей",
    summary: row.platform === "telegram"
      ? originalTelegramText
      : row.ai_summary_ru?.trim() || "Сводка готовится.",
    originalUrl: row.original_url,
    imageUrl: media.find((item) => item.type === "image")?.url ?? row.image_url?.trim() ?? undefined,
    media,
    tags,
    publishedAt: row.published_at ? formatRelativeTime(row.published_at) : "Дата уточняется",
    publishedAtIso: row.published_at ?? new Date(0).toISOString(),
    reactionCount: row.reaction_count ?? undefined,
    commentCount: row.comments_count ?? undefined,
    repostCount: row.repost_count ?? undefined,
    viewCount: row.view_count ?? undefined,
    popularityScore: Number(row.popularity_score ?? 0),
    importanceScore: Number(row.importance_score ?? 0),
    contentKind: row.content_kind ?? "report",
  };
}

function normalizeSocialSourceName(value: string, platform: SocialPost["platform"]) {
  const normalized = value.trim();

  if (platform === "x") {
    return normalized.replace(/^X\s*[·•:|-]\s*/i, "").trim() || "X";
  }

  if (platform === "telegram") {
    return normalized.replace(/^(?:Telegram|Телеграм|TG)\s*[·•:|-]\s*/i, "").trim() || "Telegram";
  }

  return normalized;
}

function mapGrandPrixReportRow(row: GrandPrixReportDbRow): GrandPrixReport {
  return {
    id: row.id,
    season: row.season,
    round: row.round,
    raceSlug: row.race_slug,
    raceName: formatGrandPrixNameRu(row.race_name),
    circuitName: row.circuit_name ?? "Трасса уточняется",
    country: row.country ?? "Страна уточняется",
    raceDate: formatDateTime(row.race_date),
    status: row.status,
    summaryStatus: row.summary_status,
    aiSummary: row.ai_summary,
    weather: asObject(row.weather),
    raceStatistics: asObject(row.race_statistics),
    results: asArray(row.results) as GrandPrixReport["results"],
    keyEvents: asArray(row.key_events) as GrandPrixReport["keyEvents"],
    pitStops: asArray(row.pit_stops),
    strategies: asArray(row.strategies),
    teammateComparisons: asArray(row.teammate_comparisons),
    highlights: asObject(row.highlights),
    championshipImpact: asObject(row.championship_impact),
    newsSummary: asObject(row.news_summary),
    sourceErrors: asObject(row.source_errors),
    generatedAt: formatRelativeTime(row.generated_at),
  };
}

function mapGrandPrixReportPlaceholder(race: RaceRow): GrandPrixReport {
  const circuit = getRelationObject(race.circuits);

  return {
    id: `pending-${race.season_year}-${race.round}`,
    season: race.season_year,
    round: race.round,
    raceSlug: makeGrandPrixReportSlug(race.season_year, race.race_name),
    raceName: formatGrandPrixNameRu(race.race_name),
    circuitName: circuit?.name ?? "Трасса уточняется",
    country: circuit?.country ?? "Страна уточняется",
    raceDate: formatDateTime(race.race_start_at),
    status: "pending",
    summaryStatus: "pending",
    aiSummary: null,
    weather: {},
    raceStatistics: {},
    results: [],
    keyEvents: [],
    pitStops: [],
    strategies: [],
    teammateComparisons: [],
    highlights: {},
    championshipImpact: {},
    newsSummary: {},
    sourceErrors: {},
    generatedAt: "Формируется",
  };
}

function makeGrandPrixReportSlug(season: number, raceName: string) {
  return `${season}-${slugify(raceName.replace(/\s+grand prix$/i, ""))}`;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function encodeSocialCursor(publishedAt: string, id: string) {
  return Buffer.from(JSON.stringify({ publishedAt, id }), "utf8").toString("base64url");
}

function decodeSocialCursor(cursor?: string | null) {
  if (!cursor) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      publishedAt?: unknown;
      id?: unknown;
    };
    return typeof parsed.publishedAt === "string" && typeof parsed.id === "string"
      ? { publishedAt: parsed.publishedAt, id: parsed.id }
      : null;
  } catch {
    return null;
  }
}

function isSafeSocialSlug(value: string | null | undefined): value is string {
  return Boolean(value && /^[a-z0-9-]{2,100}$/i.test(value));
}

async function getSocialPostIdsForAnyTag(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdminClient>> | NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  slugs: string[],
) {
  const { data } = await supabase
    .from("social_post_tags")
    .select("post_id, tags!inner(slug)")
    .in("tags.slug", slugs)
    .limit(2_000);
  return [...new Set((data ?? []).map((row) => row.post_id))];
}

function intersectSocialPostIds(sets: string[][]) {
  if (!sets.length) {
    return [];
  }
  return sets.slice(1).reduce(
    (current, values) => current.filter((id) => new Set(values).has(id)),
    [...sets[0]],
  );
}

function mapSocialFilterOption(item: { name: string; slug: string }) {
  return { label: item.name, value: item.slug };
}

async function getCircuitLayout(circuitId: string): Promise<TrackLayout | null> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("circuit_layouts")
    .select("svg_path, view_box, provider, source_session_key")
    .eq("circuit_id", circuitId)
    .eq("provider", "openf1")
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const layout = data as CircuitLayoutDbRow;

  return {
    svgPath: layout.svg_path,
    viewBox: layout.view_box,
    provider: layout.provider,
    sourceSessionKey: layout.source_session_key,
  };
}

async function getSessionWeatherByIds(sessionIds: string[]) {
  const weatherBySession = new Map<string, SessionWeather>();

  if (!sessionIds.length) {
    return weatherBySession;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return weatherBySession;
  }

  const { data, error } = await supabase
    .from("session_weather")
    .select("session_id, temperature_c, wind_speed_kmh, precipitation_mm, observed_at:forecast_at, forecast_at")
    .in("session_id", sessionIds);

  if (error || !data) {
    return weatherBySession;
  }

  (data as unknown as SessionWeatherDbRow[]).forEach((weather) => {
    weatherBySession.set(weather.session_id, mapWeatherRow(weather, "Open-Meteo"));
  });

  return weatherBySession;
}

const getChampionshipRoundPointTotals = cache(async (season: number) => {
  const empty = {
    constructorPoints: new Map<string, Map<number, number>>(),
    driverPoints: new Map<string, Map<number, number>>(),
    driverRacePositions: new Map<string, Map<number, number>>(),
    scoredRounds: [] as number[],
  };
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return empty;
  }

  const { data: raceData, error: raceError } = await supabase
    .from("races")
    .select("id, round")
    .eq("season_year", season)
    .order("round", { ascending: true });

  if (raceError || !raceData?.length) {
    return empty;
  }

  const races = raceData as RaceRoundDbRow[];
  const roundByRaceId = new Map(races.map((race) => [race.id, race.round]));
  const { data: sessionData, error: sessionError } = await supabase
    .from("sessions")
    .select("id, race_id, session_type")
    .in("race_id", races.map((race) => race.id))
    .in("session_type", ["race", "sprint"])
    .order("start_at", { ascending: true, nullsFirst: false });

  if (sessionError || !sessionData?.length) {
    return empty;
  }

  const sessions = sessionData as SessionRoundDbRow[];
  const sessionMetaById = new Map(
    sessions.map((session) => [
      session.id,
      {
        round: roundByRaceId.get(session.race_id),
        type: session.session_type,
      },
    ]),
  );
  const resultBatches = await Promise.all(
    batchSupabaseIds(sessions.map((session) => session.id)).map((batch) =>
      supabase
        .from("session_results")
        .select("session_id, driver_id, position, team_id, points, status, raw_payload")
        .in("session_id", batch),
    ),
  );
  const resultData = resultBatches.flatMap((batch) => batch.data ?? []);

  if (resultBatches.some((batch) => batch.error) || !resultData.length) {
    return empty;
  }

  const driverPoints = new Map<string, Map<number, number>>();
  const constructorPoints = new Map<string, Map<number, number>>();
  const driverRacePositions = new Map<string, Map<number, number>>();
  const scoredRounds = new Set<number>();

  (resultData as unknown as SessionResultPointsDbRow[]).forEach((result) => {
    const session = sessionMetaById.get(result.session_id);

    if (!session?.round) {
      return;
    }

    if (session.type !== "race" && session.type !== "sprint") {
      return;
    }

    if (isLapOnlyResult(result)) {
      return;
    }

    if (session.type === "race" && result.driver_id && result.position && result.position > 0) {
      const positionsByRound = driverRacePositions.get(result.driver_id) ?? new Map<number, number>();
      const currentPosition = positionsByRound.get(session.round);

      if (!currentPosition || result.position < currentPosition) {
        positionsByRound.set(session.round, result.position);
      }

      driverRacePositions.set(result.driver_id, positionsByRound);
    }

    const points = getRoundResultPoints(result.points, session.type, result.position);

    if (points === null || points <= 0) {
      return;
    }

    scoredRounds.add(session.round);

    if (result.driver_id) {
      addRoundPoints(driverPoints, result.driver_id, session.round, points);
    }

    if (result.team_id) {
      addRoundPoints(constructorPoints, result.team_id, session.round, points);
    }
  });

  return {
    constructorPoints,
    driverPoints,
    driverRacePositions,
    scoredRounds: [...scoredRounds].sort((a, b) => a - b),
  };
});

function buildDriverProfileContext(
  driverId: string,
  races: DriverRaceDbRow[],
  sessions: DriverSessionDbRow[],
  results: DriverSessionResultDbRow[],
  standingsHistory: DriverStandingHistoryDbRow[],
  topTenCumulativePoints: DriverCumulativePointsSeries[],
) {
  const sessionsByRace = new Map<string, DriverSessionDbRow[]>();
  const resultsBySession = new Map<string, DriverSessionResultDbRow[]>();

  sessions.forEach((session) => {
    const list = sessionsByRace.get(session.race_id) ?? [];
    list.push(session);
    sessionsByRace.set(session.race_id, list);
  });

  results.forEach((result) => {
    const list = resultsBySession.get(result.session_id) ?? [];
    list.push(result);
    resultsBySession.set(result.session_id, list);
  });

  const resultRows: DriverRaceResultRow[] = [];
  const racePoints: DriverChartPoint[] = [];
  const cumulativePoints: DriverChartPoint[] = [];
  const positionTrend: DriverChartPoint[] = [];
  const standingByRound = new Map(
    standingsHistory
      .filter((row) => row.round)
      .map((row) => [row.round as number, row]),
  );
  let cumulative = 0;

  races.forEach((race) => {
    const raceSessions = sessionsByRace.get(race.id) ?? [];
    const raceSession = findSessionByType(raceSessions, "race");
    const sprintSession = findSessionByType(raceSessions, "sprint");
    const qualifyingSession = findSessionByType(raceSessions, "qualifying");
    const raceSessionResults = raceSession ? resultsBySession.get(raceSession.id) ?? [] : [];
    const raceResult = getDriverSessionResult(resultsBySession, raceSession?.id, driverId);
    const sprintResult = getDriverSessionResult(resultsBySession, sprintSession?.id, driverId);
    const qualifyingResult = getDriverSessionResult(resultsBySession, qualifyingSession?.id, driverId);
    const racePointsValue = raceResult ? getDriverResultPoints(raceResult, "race") : 0;
    const sprintPointsValue = sprintResult ? getDriverResultPoints(sprintResult, "sprint") : 0;
    const isMissingCompletedResult = raceSessionResults.length > 0 && !raceResult;
    const totalRoundPoints = raceResult || sprintResult || isMissingCompletedResult
      ? racePointsValue + sprintPointsValue
      : null;
    const circuit = getRelationObject(race.circuits);
    const finishPosition = raceResult?.position ?? null;
    const startPosition = normalizeGridPosition(raceResult?.grid);
    const positionDelta =
      startPosition && finishPosition ? startPosition - finishPosition : null;
    const isDnf = isMissingCompletedResult || isDnfDriverResult(raceResult);

    if (totalRoundPoints !== null) {
      cumulative += totalRoundPoints;
    }

    resultRows.push({
      round: race.round,
      raceName: formatGrandPrixNameRu(race.race_name),
      raceDate: formatDateTime(race.race_start_at),
      circuit: circuit?.name ?? "Трасса уточняется",
      country: circuit?.country ?? "",
      countryCode: getCountryCode(circuit?.country ?? ""),
      qualifyingPosition: qualifyingResult?.position ?? null,
      startPosition,
      finishPosition,
      positionDelta,
      points: totalRoundPoints,
      status: isDnf ? "Сход" : raceResult?.status ?? "—",
      isWin: finishPosition === 1,
      isPodium: Boolean(finishPosition && finishPosition <= 3),
      isDnf,
      scoredPoints: Boolean(totalRoundPoints && totalRoundPoints > 0),
    });

    racePoints.push({
      round: race.round,
      raceName: formatGrandPrixNameRu(race.race_name),
      value: totalRoundPoints,
    });
    cumulativePoints.push({
      round: race.round,
      raceName: formatGrandPrixNameRu(race.race_name),
      value: totalRoundPoints === null ? null : Number(cumulative.toFixed(2)),
    });
    positionTrend.push({
      round: race.round,
      raceName: formatGrandPrixNameRu(race.race_name),
      value: standingByRound.get(race.round)?.position ?? null,
    });
  });

  const completedRows = resultRows.filter((row) => row.finishPosition || row.isDnf);
  const positions = completedRows
    .map((row) => row.finishPosition)
    .filter((value): value is number => typeof value === "number");
  const starts = completedRows
    .map((row) => row.startPosition)
    .filter((value): value is number => typeof value === "number");
  const deltas = completedRows
    .filter((row) => row.positionDelta !== null)
    .map((row) => ({ value: row.positionDelta as number, raceName: row.raceName }));
  const stats: DriverSeasonStats = {
    points: Number(cumulative.toFixed(2)),
    championshipPosition: getLatestDriverStanding(standingsHistory)?.position ?? null,
    wins: completedRows.filter((row) => row.isWin).length,
    podiums: completedRows.filter((row) => row.isPodium).length,
    poles: resultRows.filter((row) => row.qualifyingPosition === 1).length,
    fastestLaps: countFastestLaps(driverId, races, sessionsByRace, resultsBySession),
    dnfs: completedRows.filter((row) => row.isDnf).length,
    pointsFinishes: completedRows.filter((row) => row.scoredPoints).length,
    averageStart: averageNumber(starts),
    averageFinish: averageNumber(positions),
    bestResult: positions.length ? Math.min(...positions) : null,
    worstResult: positions.length ? Math.max(...positions) : null,
    q3Appearances: resultRows.filter((row) => row.qualifyingPosition && row.qualifyingPosition <= 10).length,
  };

  return {
    stats,
    results: resultRows,
    charts: {
      racePoints,
      cumulativePoints,
      championshipPosition: positionTrend,
      topTenCumulativePoints,
    },
    form: buildDriverFormStats(resultRows),
    teammateComparison: buildTeammateComparison(driverId, races, sessionsByRace, resultsBySession),
    positionDelta: buildPositionDeltaStats(deltas),
  };
}

function findSessionByType(sessions: DriverSessionDbRow[], sessionType: string) {
  return sessions.find((session) => session.session_type === sessionType);
}

function getDriverSessionResult(
  resultsBySession: Map<string, DriverSessionResultDbRow[]>,
  sessionId: string | undefined,
  driverId: string,
) {
  if (!sessionId) {
    return null;
  }

  return resultsBySession.get(sessionId)?.find((result) => result.driver_id === driverId) ?? null;
}

function normalizeGridPosition(grid?: number | null) {
  return grid && grid > 0 ? grid : null;
}

function getDriverResultPoints(result: DriverSessionResultDbRow, sessionType: "race" | "sprint") {
  return getRoundResultPoints(result.points, sessionType, result.position) ?? 0;
}

function isDnfDriverResult(result?: DriverSessionResultDbRow | null) {
  if (!result) {
    return false;
  }

  const text = `${result.status ?? ""} ${result.classified_position ?? ""}`.toLowerCase();
  const hasDashStatus = [result.status, result.classified_position, result.time_text]
    .some((value) => value?.trim() === "-" || value?.trim() === "—");

  return (
    /retired|dnf|accident|collision|engine|gearbox|hydraulic|withdraw|not classified|disqualified|\br\b/.test(text) ||
    (!result.position && hasDashStatus)
  );
}

function countFastestLaps(
  driverId: string,
  races: DriverRaceDbRow[],
  sessionsByRace: Map<string, DriverSessionDbRow[]>,
  resultsBySession: Map<string, DriverSessionResultDbRow[]>,
) {
  return races.reduce((count, race) => {
    const raceSession = findSessionByType(sessionsByRace.get(race.id) ?? [], "race");
    const result = getDriverSessionResult(resultsBySession, raceSession?.id, driverId);

    return count + (hasFastestLap(result) ? 1 : 0);
  }, 0);
}

function hasFastestLap(result?: DriverSessionResultDbRow | null) {
  const fastestLap = getFastestLapRecord(result?.raw_payload);

  if (!fastestLap) {
    return false;
  }

  return String(fastestLap.rank ?? "") === "1";
}

function getFastestLapTime(result?: DriverSessionResultDbRow | null) {
  return getFastestLapTimeFromPayload(result?.raw_payload);
}

function getFastestLapTimeFromPayload(rawPayload: unknown) {
  const fastestLap = getFastestLapRecord(rawPayload);

  if (!fastestLap) {
    return null;
  }

  const time = fastestLap.Time ?? fastestLap.time ?? fastestLap.lapTime;

  if (typeof time === "string") {
    return time.trim() || null;
  }

  if (!time || typeof time !== "object" || Array.isArray(time)) {
    return null;
  }

  const timeValue = (time as Record<string, unknown>).time;
  return typeof timeValue === "string" && timeValue.trim() ? timeValue.trim() : null;
}

function getFastestLapNumberFromPayload(rawPayload: unknown) {
  const fastestLap = getFastestLapRecord(rawPayload);

  if (!fastestLap) {
    return null;
  }

  const lap = Number(fastestLap.lap ?? fastestLap.Lap ?? fastestLap.lap_number);
  return Number.isInteger(lap) && lap > 0 ? lap : null;
}

function getFastestLapRecord(rawPayload: unknown) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }

  const payload = rawPayload as Record<string, unknown>;
  const fastestLap = payload.FastestLap ?? payload.fastestLap;

  if (!fastestLap || typeof fastestLap !== "object" || Array.isArray(fastestLap)) {
    return null;
  }

  return fastestLap as Record<string, unknown>;
}

function averageNumber(values: number[]) {
  if (!values.length) {
    return null;
  }

  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function buildDriverFormStats(results: DriverRaceResultRow[]): DriverFormStats {
  const lastFive = results
    .filter((row) => row.finishPosition || row.isDnf)
    .slice(-5);
  const positions = lastFive
    .map((row) => row.finishPosition)
    .filter((value): value is number => typeof value === "number");
  const qualifyingPositions = lastFive
    .map((row) => row.qualifyingPosition)
    .filter((value): value is number => typeof value === "number");

  return {
    labels: lastFive.map((row) => (row.isDnf ? "DNF" : row.finishPosition ? `P${row.finishPosition}` : "—")),
    points: Number(lastFive.reduce((sum, row) => sum + (row.points ?? 0), 0).toFixed(2)),
    podiums: lastFive.filter((row) => row.isPodium).length,
    dnfs: lastFive.filter((row) => row.isDnf).length,
    bestResult: positions.length ? Math.min(...positions) : null,
    averageQualifyingPosition: averageNumber(qualifyingPositions),
    averageFinishPosition: averageNumber(positions),
  };
}

function buildPositionDeltaStats(
  deltas: { value: number; raceName: string }[],
): DriverPositionDeltaStats {
  if (!deltas.length) {
    return {
      totalDelta: null,
      averageDelta: null,
      bestGain: null,
      biggestDrop: null,
    };
  }

  const total = deltas.reduce((sum, delta) => sum + delta.value, 0);
  const bestGain = deltas.reduce((best, delta) => (delta.value > best.value ? delta : best), deltas[0]);
  const biggestDrop = deltas.reduce((worst, delta) => (delta.value < worst.value ? delta : worst), deltas[0]);

  return {
    totalDelta: total,
    averageDelta: Number((total / deltas.length).toFixed(1)),
    bestGain: bestGain.value > 0 ? bestGain : null,
    biggestDrop: biggestDrop.value < 0 ? biggestDrop : null,
  };
}

function buildTeammateComparison(
  driverId: string,
  races: DriverRaceDbRow[],
  sessionsByRace: Map<string, DriverSessionDbRow[]>,
  resultsBySession: Map<string, DriverSessionResultDbRow[]>,
): DriverTeammateComparison {
  const teammateNames = new Set<string>();
  const comparison: DriverTeammateComparison = {
    teammateNames: [],
    qualifying: { driver: 0, teammate: 0 },
    races: { driver: 0, teammate: 0 },
    points: { driver: 0, teammate: 0 },
    podiums: { driver: 0, teammate: 0 },
    wins: { driver: 0, teammate: 0 },
    averageStart: { driver: null, teammate: null },
    averageFinish: { driver: null, teammate: null },
    dnfs: { driver: 0, teammate: 0 },
  };
  const driverStarts: number[] = [];
  const teammateStarts: number[] = [];
  const driverFinishes: number[] = [];
  const teammateFinishes: number[] = [];

  races.forEach((race) => {
    const raceSessions = sessionsByRace.get(race.id) ?? [];
    const qualifyingSession = findSessionByType(raceSessions, "qualifying");
    const raceSession = findSessionByType(raceSessions, "race");
    const sprintSession = findSessionByType(raceSessions, "sprint");
    const raceSessionResults = raceSession ? resultsBySession.get(raceSession.id) ?? [] : [];
    const driverRace = getDriverSessionResult(resultsBySession, raceSession?.id, driverId);
    const driverQualifying = getDriverSessionResult(resultsBySession, qualifyingSession?.id, driverId);
    const driverTeamId = driverRace?.team_id ?? driverQualifying?.team_id;
    const teammateRace = findTeammateResult(resultsBySession, raceSession?.id, driverTeamId, driverId);
    const teammateQualifying = findTeammateResult(resultsBySession, qualifyingSession?.id, driverTeamId, driverId);
    const teammateSprint = findTeammateResult(resultsBySession, sprintSession?.id, driverTeamId, driverId);
    const driverMissingResult = raceSessionResults.length > 0 && !driverRace && Boolean(driverQualifying);
    const teammateMissingResult = raceSessionResults.length > 0 && !teammateRace && Boolean(teammateQualifying);

    if (driverQualifying?.position && teammateQualifying?.position) {
      if (driverQualifying.position < teammateQualifying.position) {
        comparison.qualifying.driver += 1;
      } else if (teammateQualifying.position < driverQualifying.position) {
        comparison.qualifying.teammate += 1;
      }
    }

    if (driverRace?.position && teammateRace?.position) {
      if (driverRace.position < teammateRace.position) {
        comparison.races.driver += 1;
      } else if (teammateRace.position < driverRace.position) {
        comparison.races.teammate += 1;
      }
    } else if (driverRace?.position && teammateMissingResult) {
      comparison.races.driver += 1;
    } else if (teammateRace?.position && driverMissingResult) {
      comparison.races.teammate += 1;
    }

    if (driverRace) {
      comparison.points.driver += getDriverResultPoints(driverRace, "race");
      comparison.podiums.driver += driverRace.position && driverRace.position <= 3 ? 1 : 0;
      comparison.wins.driver += driverRace.position === 1 ? 1 : 0;
      comparison.dnfs.driver += isDnfDriverResult(driverRace) ? 1 : 0;
      if (driverRace.grid) driverStarts.push(driverRace.grid);
      if (driverRace.position) driverFinishes.push(driverRace.position);
    } else if (driverMissingResult) {
      comparison.dnfs.driver += 1;
    }

    if (teammateRace) {
      const teammate = getRelationObject(teammateRace.drivers);
      if (teammate?.full_name) teammateNames.add(teammate.full_name);
      comparison.points.teammate += getDriverResultPoints(teammateRace, "race");
      comparison.podiums.teammate += teammateRace.position && teammateRace.position <= 3 ? 1 : 0;
      comparison.wins.teammate += teammateRace.position === 1 ? 1 : 0;
      comparison.dnfs.teammate += isDnfDriverResult(teammateRace) ? 1 : 0;
      if (teammateRace.grid) teammateStarts.push(teammateRace.grid);
      if (teammateRace.position) teammateFinishes.push(teammateRace.position);
    } else if (teammateMissingResult) {
      comparison.dnfs.teammate += 1;
    }

    const teammateIdentity = getRelationObject(teammateRace?.drivers ?? teammateQualifying?.drivers ?? null);
    if (teammateIdentity?.full_name) teammateNames.add(teammateIdentity.full_name);

    const driverSprint = getDriverSessionResult(resultsBySession, sprintSession?.id, driverId);
    if (driverSprint) {
      comparison.points.driver += getDriverResultPoints(driverSprint, "sprint");
    }

    if (teammateSprint) {
      comparison.points.teammate += getDriverResultPoints(teammateSprint, "sprint");
    }
  });

  comparison.teammateNames = [...teammateNames];
  comparison.points.driver = Number(comparison.points.driver.toFixed(2));
  comparison.points.teammate = Number(comparison.points.teammate.toFixed(2));
  comparison.averageStart.driver = averageNumber(driverStarts);
  comparison.averageStart.teammate = averageNumber(teammateStarts);
  comparison.averageFinish.driver = averageNumber(driverFinishes);
  comparison.averageFinish.teammate = averageNumber(teammateFinishes);

  return comparison;
}

function findTeammateResult(
  resultsBySession: Map<string, DriverSessionResultDbRow[]>,
  sessionId: string | undefined,
  teamId: string | null | undefined,
  driverId: string,
) {
  if (!sessionId || !teamId) {
    return null;
  }

  return (
    resultsBySession
      .get(sessionId)
      ?.filter((result) => result.team_id === teamId && result.driver_id !== driverId)
      .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))[0] ?? null
  );
}

function getLatestDriverStanding(standingsHistory: DriverStandingHistoryDbRow[]) {
  return [...standingsHistory]
    .filter((row) => row.round !== null)
    .sort((a, b) => (b.round ?? 0) - (a.round ?? 0))[0] ?? null;
}

function normalizeDriverLookupName(name: string) {
  return name.trim().toLowerCase();
}

function getPodiumFinish(position?: number) {
  if (position === 1) {
    return "winner" as const;
  }

  if (position === 2) {
    return "second" as const;
  }

  if (position === 3) {
    return "third" as const;
  }

  return undefined;
}

function addRoundPoints(
  totals: Map<string, Map<number, number>>,
  key: string,
  round: number,
  points: number,
) {
  const byRound = totals.get(key) ?? new Map<number, number>();

  byRound.set(round, (byRound.get(round) ?? 0) + points);
  totals.set(key, byRound);
}

function sumRoundPoints(pointsByRound: Record<number, number>) {
  return Object.values(pointsByRound).reduce((sum, points) => sum + points, 0);
}

function getCumulativeScoredRounds(
  cumulativeRows: Map<number, number>[],
  latestRound: number,
) {
  const scoredRounds = new Set<number>();

  for (let round = 1; round <= latestRound; round += 1) {
    const hasRoundPoints = cumulativeRows.some(
      (cumulative) => getCumulativeRoundPoints(cumulative, round) > 0,
    );

    if (hasRoundPoints) {
      scoredRounds.add(round);
    }
  }

  return [...scoredRounds].sort((a, b) => a - b);
}

function getCumulativeRoundPoints(cumulative: Map<number, number>, round: number) {
  const total = cumulative.get(round);

  if (total === undefined) {
    return 0;
  }

  const previousRound = [...cumulative.keys()]
    .filter((candidate) => candidate < round)
    .sort((a, b) => b - a)[0];
  const previousTotal = previousRound ? cumulative.get(previousRound) ?? 0 : 0;
  const points = total - previousTotal;

  return points > 0 ? Number(points.toFixed(2)) : 0;
}

function getCumulativeRoundPointsAfterDisplayedTotal(
  cumulative: Map<number, number>,
  round: number,
  displayedTotal: number,
) {
  const total = cumulative.get(round);

  if (total === undefined) {
    return 0;
  }

  const points = total - displayedTotal;

  return points > 0 ? Number(points.toFixed(2)) : 0;
}

function isLapOnlyResult(row: { status?: string | null; raw_payload?: unknown }) {
  const status = row.status?.trim().toLowerCase() ?? "";

  if (status === "лучший круг" || status === "лучшее время") {
    return true;
  }

  if (!row.raw_payload || typeof row.raw_payload !== "object" || Array.isArray(row.raw_payload)) {
    return false;
  }

  const payload = row.raw_payload as Record<string, unknown>;

  return (
    "lap_duration" in payload &&
    "session_key" in payload &&
    "lap_number" in payload &&
    !("Driver" in payload)
  );
}

async function getLatestCompleteStandingRoundUncached(
  table: "driver_standings" | "constructor_standings",
  minimumRows: number,
  season: number,
): Promise<StandingRoundRow | null> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  let query = supabase
    .from(table)
    .select("season_year, round")
    .order("season_year", { ascending: false })
    .order("round", { ascending: false, nullsFirst: false })
    .limit(500);

  query = query.eq("season_year", season);

  const { data, error } = await query;

  if (error || !data?.length) {
    return null;
  }

  const rounds = new Map<string, StandingRoundRow & { count: number }>();

  (data as StandingRoundRow[]).forEach((row) => {
    const key = `${row.season_year}:${row.round ?? "season"}`;
    const existing = rounds.get(key);

    if (existing) {
      existing.count += 1;
      return;
    }

    rounds.set(key, { ...row, count: 1 });
  });

  const ordered = [...rounds.values()].sort((a, b) => {
    if (a.season_year !== b.season_year) {
      return b.season_year - a.season_year;
    }

    return (b.round ?? -1) - (a.round ?? -1);
  });

  return ordered.find((round) => round.count >= minimumRows) ?? null;
}

export const getLatestCompleteStandingRound = cache(
  getLatestCompleteStandingRoundUncached,
);

function isRaceCompletedByStandings(
  race: Pick<RaceRow, "season_year" | "round" | "race_start_at">,
  latest: StandingRoundRow | null,
) {
  if (!latest?.round) {
    return false;
  }

  if (race.season_year < latest.season_year) {
    return true;
  }

  return (
    race.season_year === latest.season_year &&
    race.round <= latest.round &&
    hasRaceCompletionWindowElapsed(race.race_start_at)
  );
}

function ensureRaceCompletionSelectFields(select: string) {
  const requiredFields = ["season_year", "round", "race_start_at", "status"];
  const missingFields = requiredFields.filter((field) => !hasSelectField(select, field));

  return missingFields.length ? `${select}, ${missingFields.join(", ")}` : select;
}

function hasSelectField(select: string, field: string) {
  return new RegExp(`(^|[,\\s])${field}([,\\s]|$)`).test(select);
}

function emptyNewsList(page = 1): NewsListResult {
  return {
    items: [],
    page,
    totalPages: 1,
    totalCount: 0,
  };
}

async function getActiveDriverNames() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return new Set<string>();
  }

  const { data } = await supabase
    .from("drivers")
    .select("full_name, last_name")
    .eq("is_active", true);

  const names = new Set<string>();

  (data as DriverNameRow[] | null)?.forEach((driver) => {
    names.add(normalizeText(driver.full_name));
    names.add(normalizeText(driver.last_name));
  });

  return names;
}

async function getActiveTeamNames() {
  const names = new Set(getTeamMatchNames().map(normalizeText));
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return names;
  }

  const { data } = await supabase
    .from("teams")
    .select("name, short_name, code")
    .eq("is_active", true);

  (data as TeamNameRow[] | null)?.forEach((team) => {
    names.add(normalizeText(team.name));

    if (team.short_name) {
      names.add(normalizeText(team.short_name));
    }

    if (team.code) {
      names.add(normalizeText(team.code));
    }

    const asset = getTeamAsset(team.code ?? team.name);

    if (asset?.name) {
      names.add(normalizeText(asset.name));
    }

    if (asset?.code) {
      names.add(normalizeText(asset.code));
    }
  });

  return names;
}

async function fetchPolymarketRaceEvents() {
  const now = Date.now();

  if (polymarketEventsCache && polymarketEventsCache.expiresAt > now) {
    return polymarketEventsCache.events;
  }

  if (!polymarketEventsInFlight) {
    polymarketEventsInFlight = fetchPolymarketEvents({
      tag_id: POLYMARKET_F1_TAG_ID,
      related_tags: "true",
      active: "true",
      closed: "false",
      limit: POLYMARKET_EVENT_LIMIT,
      order: "volume24hr",
      ascending: "false",
    })
      .then((events) => {
        if (events.length) {
          polymarketEventsCache = {
            events,
            expiresAt: Date.now() + POLYMARKET_CACHE_TTL_MS,
          };
        }

        return events;
      })
      .finally(() => {
        polymarketEventsInFlight = null;
      });
  }

  return polymarketEventsInFlight;
}

async function fetchPolymarketEvents(params: Record<string, string>) {
  try {
    const searchParams = new URLSearchParams(params);
    const response = await fetch(`https://gamma-api.polymarket.com/events/keyset?${searchParams}`, {
      headers: { accept: "application/json" },
      next: { revalidate: 120 },
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    return Array.isArray((data as PolymarketEventsResponse | null)?.events)
      ? (data as PolymarketEventsResponse).events!
      : [];
  } catch {
    return [];
  }
}

function scorePolymarketEvent(event: PolymarketEvent, race: RaceDetail) {
  if (!event.active || event.closed || event.archived) {
    return 0;
  }

  const title = `${event.title ?? ""} ${event.slug ?? ""} ${(event.markets ?? [])
    .slice(0, 8)
    .map((market) => `${market.question ?? ""} ${market.groupItemTitle ?? ""}`)
    .join(" ")}`;
  const normalizedTitle = normalizeText(title);
  let score = 0;

  if (
    normalizedTitle.includes("formula 1") ||
    normalizedTitle.includes("formula one") ||
    normalizedTitle.includes("f1")
  ) {
    score += 4;
  }

  if (normalizedTitle.includes("grand prix")) {
    score += 2;
  }

  if (normalizedTitle.includes("driver winner") || normalizedTitle.includes("driver win")) {
    score += 5;
  } else if (normalizedTitle.includes("winner") || normalizedTitle.includes(" win ")) {
    score += 3;
  }

  if (
    /constructor|constructors|pole|champion|championship|action of the year|retire|score/.test(
      normalizedTitle,
    )
  ) {
    score -= 8;
  }

  getPolymarketRaceMatchTerms(race).forEach((candidate) => {
    if (normalizedTitle.includes(candidate)) {
      score += candidate.length > 8 ? 3 : 2;
    }
  });

  const markets = event.markets ?? [];
  const driverWinnerMarkets = markets.filter((market) =>
    isDriverWinnerMarket(market),
  ).length;

  if (driverWinnerMarkets >= 4) {
    score += 5;
  } else if (driverWinnerMarkets >= 2) {
    score += 3;
  } else {
    score -= 5;
  }

  return score;
}

function scoreSeasonChampionEvent(event: PolymarketEvent) {
  if (!event.active || event.closed || event.archived) {
    return 0;
  }

  const normalizedTitle = normalizeText(`${event.title ?? ""} ${event.slug ?? ""}`);
  let score = 0;

  if (normalizedTitle.includes("f1") || normalizedTitle.includes("formula 1")) {
    score += 3;
  }

  if (normalizedTitle.includes("drivers champion") || normalizedTitle.includes("driver champion")) {
    score += 6;
  }

  if (normalizedTitle.includes("2026")) {
    score += 2;
  }

  if (/constructor|constructors|grand prix|pole|action of the year|retire/.test(normalizedTitle)) {
    score -= 8;
  }

  const championMarkets = (event.markets ?? []).filter((market) =>
    isDriverChampionMarket(market),
  ).length;

  if (championMarkets >= 4) {
    score += 5;
  } else if (championMarkets >= 2) {
    score += 3;
  }

  return score;
}

function scoreConstructorChampionEvent(event: PolymarketEvent) {
  if (!event.active || event.closed || event.archived) {
    return 0;
  }

  const normalizedTitle = normalizeText(`${event.title ?? ""} ${event.slug ?? ""}`);
  let score = 0;

  if (normalizedTitle.includes("f1") || normalizedTitle.includes("formula 1")) {
    score += 3;
  }

  if (
    normalizedTitle.includes("constructors champion") ||
    normalizedTitle.includes("constructor champion") ||
    normalizedTitle.includes("constructors championship") ||
    normalizedTitle.includes("constructor championship")
  ) {
    score += 7;
  }

  if (normalizedTitle.includes("2026")) {
    score += 2;
  }

  if (/driver|drivers|grand prix|pole|action of the year|retire|race winner/.test(normalizedTitle)) {
    score -= 8;
  }

  const championMarkets = (event.markets ?? []).filter((market) =>
    isConstructorChampionMarket(market),
  ).length;

  if (championMarkets >= 4) {
    score += 5;
  } else if (championMarkets >= 2) {
    score += 3;
  }

  return score;
}

function parsePolymarketEventOutcomes(
  event: PolymarketEvent,
  matchNames: Set<string>,
  kind: PolymarketOutcomeKind,
): RaceWinnerOdds["outcomes"] {
  const outcomesByName = new Map<string, RaceWinnerOdds["outcomes"][number]>();

  (event.markets ?? []).forEach((market) => {
    if (!market.active || market.closed || market.archived) {
      return;
    }

    const yesNoOutcome = parsePolymarketYesNoOutcome(market, matchNames, kind);

    if (yesNoOutcome) {
      const key = normalizeText(yesNoOutcome.name);
      const existing = outcomesByName.get(key);

      if (!existing || yesNoOutcome.probability > existing.probability) {
        outcomesByName.set(key, yesNoOutcome);
      }

      return;
    }

    parsePolymarketOutcomes(market, matchNames).forEach((outcome) => {
      const key = normalizeText(outcome.name);
      const existing = outcomesByName.get(key);

      if (!existing || outcome.probability > existing.probability) {
        outcomesByName.set(key, outcome);
      }
    });
  });

  return [...outcomesByName.values()].sort((a, b) => b.probability - a.probability);
}

function parsePolymarketYesNoOutcome(
  market: PolymarketMarket,
  matchNames: Set<string>,
  kind: PolymarketOutcomeKind,
): RaceWinnerOdds["outcomes"][number] | null {
  const isValidMarket = isPolymarketOutcomeMarket(market, kind);

  if (!isValidMarket) {
    return null;
  }

  const outcomes = parseStringArray(market.outcomes).map(normalizeText);
  const prices = parseStringArray(market.outcomePrices)
    .map((price) => Number(price))
    .map((price) => (Number.isFinite(price) ? price : 0));
  const yesIndex = outcomes.findIndex((outcome) => outcome === "yes");

  if (yesIndex === -1) {
    return null;
  }

  const name = getPolymarketEntityName(market);

  if (!name || !isLikelyNamedOutcome(name, matchNames)) {
    return null;
  }

  const probability = Math.max(0, Math.min(1, prices[yesIndex] ?? 0));

  if (probability <= 0) {
    return null;
  }

  return {
    name,
    probability,
    label: `${Math.round(probability * 100)}%`,
  };
}

function isPolymarketOutcomeMarket(
  market: PolymarketMarket,
  kind: PolymarketOutcomeKind,
) {
  if (kind === "race-winner") {
    return isDriverWinnerMarket(market);
  }

  if (kind === "driver-champion") {
    return isDriverChampionMarket(market);
  }

  return isConstructorChampionMarket(market);
}

function isDriverChampionMarket(market: PolymarketMarket) {
  const normalized = normalizeText(`${market.question ?? ""} ${market.slug ?? ""}`);
  const outcomes = parseStringArray(market.outcomes).map(normalizeText);
  const hasYesNo =
    outcomes.length === 2 && outcomes.includes("yes") && outcomes.includes("no");

  return (
    hasYesNo &&
    (normalized.includes("f1 drivers champion") ||
      normalized.includes("f1 driver champion") ||
      normalized.includes("drivers champion")) &&
    !/constructor|constructors|grand prix|pole|retire/.test(normalized)
  );
}

function isDriverWinnerMarket(market: PolymarketMarket) {
  const normalized = normalizeText(`${market.question ?? ""} ${market.slug ?? ""}`);
  const outcomes = parseStringArray(market.outcomes).map(normalizeText);
  const hasYesNo =
    outcomes.length === 2 && outcomes.includes("yes") && outcomes.includes("no");

  return (
    hasYesNo &&
    (normalized.includes("driver winner") ||
      normalized.includes("grand prix winner") ||
      (normalized.includes("win") && normalized.includes("grand prix"))) &&
    !/constructor|constructors|pole|champion|championship|score/.test(normalized)
  );
}

function isConstructorChampionMarket(market: PolymarketMarket) {
  const normalized = normalizeText(`${market.question ?? ""} ${market.slug ?? ""}`);
  const outcomes = parseStringArray(market.outcomes).map(normalizeText);
  const hasYesNo =
    outcomes.length === 2 && outcomes.includes("yes") && outcomes.includes("no");

  return (
    hasYesNo &&
    (normalized.includes("f1 constructors champion") ||
      normalized.includes("f1 constructor champion") ||
      normalized.includes("constructors champion") ||
      normalized.includes("constructor champion") ||
      normalized.includes("constructors championship") ||
      normalized.includes("constructor championship")) &&
    !/driver|drivers|grand prix|pole|retire|race winner/.test(normalized)
  );
}

function getPolymarketEntityName(market: PolymarketMarket) {
  const groupTitle = market.groupItemTitle?.trim();

  if (groupTitle) {
    return groupTitle;
  }

  const question = market.question ?? "";
  const match = question.match(/^will\s+(.+?)\s+(?:win|get|be)\b/i);

  return match?.[1]?.trim() ?? "";
}

function getEventVolume(event: PolymarketEvent) {
  return Number(event.volume24hr ?? event.volume ?? event.liquidity ?? 0) || 0;
}

function getPolymarketUpdatedAt(event: PolymarketEvent) {
  const dates = [
    event.updatedAt,
    ...(event.markets ?? []).map((market) => market.updatedAt),
    event.startDate,
  ]
    .filter(Boolean)
    .map((value) => new Date(value as string))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  return dates[0]?.toISOString() ?? null;
}

function getPolymarketEventUrl(event: PolymarketEvent) {
  return `https://polymarket.com/event/${event.slug ?? event.id ?? ""}`;
}

function parsePolymarketOutcomes(
  market: PolymarketMarket,
  matchNames: Set<string>,
): RaceWinnerOdds["outcomes"] {
  const outcomes = parseStringArray(market.outcomes);
  const prices = parseStringArray(market.outcomePrices)
    .map((price) => Number(price))
    .map((price) => (Number.isFinite(price) ? price : 0));

  return outcomes
    .map((outcome, index) => ({
      name: outcome,
      probability: Math.max(0, Math.min(1, prices[index] ?? 0)),
      label: `${Math.round(Math.max(0, Math.min(1, prices[index] ?? 0)) * 100)}%`,
    }))
    .filter((outcome) => outcome.probability > 0 && isLikelyNamedOutcome(outcome.name, matchNames))
    .sort((a, b) => b.probability - a.probability);
}

function parseStringArray(value: string[] | string | undefined) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map(String);
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function isLikelyNamedOutcome(value: string, matchNames: Set<string>) {
  const normalized = normalizeText(value);

  if (!normalized || ["yes", "no", "other"].includes(normalized)) {
    return false;
  }

  if (matchNames.size === 0) {
    return normalized.split(" ").length >= 2;
  }

  return [...matchNames].some((name) => name && normalized.includes(name));
}

function parseRaceFilter(value: string) {
  const match = value.match(/^(\d{4})-(\d{1,2})$/);

  if (!match) {
    return null;
  }

  return {
    season: Number(match[1]),
    round: Number(match[2]),
  };
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const getCurrentRace = cache(async (select?: string): Promise<RaceRow | null> => {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const fields = ensureRaceCompletionSelectFields(
    select ??
      "id, season_year, round, race_name, race_start_at, status, circuits(id, name, country, locality, external_id, timezone)",
  );
  const currentRaceWindowIso = new Date(
    Date.now() - getSessionDurationMs("race", "Гонка"),
  ).toISOString();

  const { data: upcoming } = await supabase
    .from("races")
    .select(fields)
    .eq("season_year", CURRENT_F1_SEASON)
    .gte("race_start_at", currentRaceWindowIso)
    .order("race_start_at", { ascending: true, nullsFirst: false })
    .limit(4);

  if (upcoming?.length) {
    const candidates = upcoming as unknown as RaceRow[];
    const latestStanding = await getLatestCompleteStandingRound(
      "driver_standings",
      20,
      CURRENT_F1_SEASON,
    );
    const startedCandidateIds = candidates
      .filter((race) => {
        const raceStart = getTimeMs(race.race_start_at);

        return raceStart !== null && raceStart <= Date.now();
      })
      .map((race) => race.id);
    const finishedRaceIds = startedCandidateIds.length
      ? new Set((await getRaceWinners(startedCandidateIds)).keys())
      : new Set<string>();
    const activeOrNextRace =
      candidates.find((race) => {
        const raceStart = getTimeMs(race.race_start_at);
        const isStarted = raceStart !== null && raceStart <= Date.now();
        const isCompleted =
          race.status === "completed" ||
          race.status === "finished" ||
          isRaceCompletedByStandings(race, latestStanding) ||
          (isStarted && finishedRaceIds.has(race.id));

        return !isCompleted;
      }) ?? candidates[0];

    return activeOrNextRace;
  }

  const { data: latest } = await supabase
    .from("races")
    .select(fields)
    .eq("season_year", CURRENT_F1_SEASON)
    .order("race_start_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  return (latest as unknown as RaceRow | null) ?? null;
});

async function getRaceWinners(raceIds: string[]) {
  const winners = new Map<string, string>();

  if (!raceIds.length) {
    return winners;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return winners;
  }

  const { data } = await supabase
    .from("session_results")
    .select("drivers(full_name), sessions!inner(race_id, session_type)")
    .eq("position", 1)
    .eq("sessions.session_type", "race")
    .in("sessions.race_id", raceIds);

  (data as unknown as RaceWinnerDbRow[] | null)?.forEach((row) => {
    const session = getRelationObject(row.sessions);

    if (session?.race_id && !winners.has(session.race_id)) {
      winners.set(session.race_id, getRelationName(row.drivers, "Победитель уточняется"));
    }
  });

  return winners;
}

async function getRaceTrackAssetsByRaceIds(raceIds: string[]) {
  const assets = new Map<string, RaceTrackAssetDbRow>();

  if (!raceIds.length) {
    return assets;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return assets;
  }

  const { data, error } = await supabase
    .from("race_track_assets")
    .select("race_id, image_url, is_verified")
    .in("race_id", raceIds)
    .eq("is_verified", true);

  if (error) {
    return assets;
  }

  ((data ?? []) as unknown as RaceTrackAssetDbRow[]).forEach((asset) => {
    if (asset.image_url) {
      assets.set(asset.race_id, {
        ...asset,
        image_url: getVersionedCircuitMapUrl(asset.image_url),
      });
    }
  });

  return assets;
}

function mapCalendarRace(
  race: RaceRow,
  isCurrent: boolean,
  winner?: string,
  isCompletedByStandings = false,
  trackMapUrl?: string | null,
): CalendarEvent {
  const circuit = getRelationObject(race.circuits);
  const country = circuit?.country ?? "Страна уточняется";
  const sessions = Array.isArray(race.sessions)
    ? race.sessions
    : race.sessions
      ? [race.sessions]
      : [];
  const hasSprint = sessions.some((session) => {
    const type = session.session_type?.trim().toLowerCase() ?? "";
    const name = session.name?.trim().toLowerCase() ?? "";

    return type === "sprint" || name === "спринт" || name === "sprint";
  });

  return {
    season: race.season_year,
    round: race.round,
    race: formatGrandPrixNameRu(race.race_name),
    circuit: circuit?.name ?? "Трасса уточняется",
    country,
    countryFlag: getCountryFlag(country),
    countryCode: getCountryCode(country),
    date: formatDateRange(race.race_start_at),
    status: formatRaceStatus(race.status, isCurrent, isCompletedByStandings),
    hasSprint,
    winner,
    trackMapUrl,
    href: `/calendar/${race.season_year}/${race.round}`,
  };
}

function getCountryFlag(country: string) {
  const value = country.trim();

  if (!value) {
    return "🏁";
  }

  if (/[\u{1F1E6}-\u{1F1FF}]{2}/u.test(value)) {
    return value;
  }

  const normalized = normalizeCountryName(value);
  const flags: Record<string, string> = {
    ae: "🇦🇪",
    au: "🇦🇺",
    australia: "🇦🇺",
    at: "🇦🇹",
    austria: "🇦🇹",
    az: "🇦🇿",
    azerbaijan: "🇦🇿",
    bh: "🇧🇭",
    bahrain: "🇧🇭",
    be: "🇧🇪",
    belgium: "🇧🇪",
    br: "🇧🇷",
    brazil: "🇧🇷",
    ca: "🇨🇦",
    canada: "🇨🇦",
    cn: "🇨🇳",
    china: "🇨🇳",
    ch: "🇨🇭",
    switzerland: "🇨🇭",
    swiss: "🇨🇭",
    dk: "🇩🇰",
    denmark: "🇩🇰",
    danish: "🇩🇰",
    fi: "🇫🇮",
    finland: "🇫🇮",
    finnish: "🇫🇮",
    gb: "🇬🇧",
    uk: "🇬🇧",
    "u k": "🇬🇧",
    england: "🇬🇧",
    greatbritain: "🇬🇧",
    "great britain": "🇬🇧",
    "united kingdom": "🇬🇧",
    "united kingdom of great britain and northern ireland": "🇬🇧",
    hu: "🇭🇺",
    hungary: "🇭🇺",
    it: "🇮🇹",
    italy: "🇮🇹",
    jp: "🇯🇵",
    japan: "🇯🇵",
    mc: "🇲🇨",
    mx: "🇲🇽",
    mexico: "🇲🇽",
    my: "🇲🇾",
    malaysia: "🇲🇾",
    monaco: "🇲🇨",
    nl: "🇳🇱",
    netherlands: "🇳🇱",
    pl: "🇵🇱",
    poland: "🇵🇱",
    polish: "🇵🇱",
    pt: "🇵🇹",
    portugal: "🇵🇹",
    portuguese: "🇵🇹",
    qa: "🇶🇦",
    qatar: "🇶🇦",
    ru: "🇷🇺",
    russia: "🇷🇺",
    russian: "🇷🇺",
    sa: "🇸🇦",
    "saudi arabia": "🇸🇦",
    sg: "🇸🇬",
    singapore: "🇸🇬",
    tr: "🇹🇷",
    turkey: "🇹🇷",
    turkiye: "🇹🇷",
    "türkiye": "🇹🇷",
    turkish: "🇹🇷",
    es: "🇪🇸",
    spain: "🇪🇸",
    uae: "🇦🇪",
    "u a e": "🇦🇪",
    "united arab emirates": "🇦🇪",
    us: "🇺🇸",
    "u s": "🇺🇸",
    "u s a": "🇺🇸",
    usa: "🇺🇸",
    "united states": "🇺🇸",
    "united states america": "🇺🇸",
    "united states of america": "🇺🇸",
  };

  if (flags[normalized]) {
    return flags[normalized];
  }

  return getIsoCountryFlag(value) ?? "🏁";
}

function getCountryCode(country: string) {
  const value = country.trim();

  if (!value) {
    return undefined;
  }

  const normalized = normalizeCountryName(value);
  const codes: Record<string, string> = {
    ae: "ae",
    ar: "ar",
    arg: "ar",
    argentina: "ar",
    argentine: "ar",
    argentinian: "ar",
    au: "au",
    australia: "au",
    australian: "au",
    at: "at",
    austria: "at",
    austrian: "at",
    az: "az",
    azerbaijan: "az",
    bh: "bh",
    bahrain: "bh",
    be: "be",
    belgium: "be",
    br: "br",
    brazil: "br",
    brazilian: "br",
    ca: "ca",
    canada: "ca",
    canadian: "ca",
    cn: "cn",
    china: "cn",
    chinese: "cn",
    ch: "ch",
    che: "ch",
    switzerland: "ch",
    swiss: "ch",
    dk: "dk",
    dnk: "dk",
    denmark: "dk",
    danish: "dk",
    fi: "fi",
    fin: "fi",
    finland: "fi",
    finnish: "fi",
    de: "de",
    deu: "de",
    germany: "de",
    german: "de",
    gb: "gb",
    gbr: "gb",
    uk: "gb",
    "u k": "gb",
    england: "gb",
    greatbritain: "gb",
    "great britain": "gb",
    "united kingdom": "gb",
    "united kingdom of great britain and northern ireland": "gb",
    british: "gb",
    hu: "hu",
    hungary: "hu",
    it: "it",
    italy: "it",
    italian: "it",
    jp: "jp",
    japan: "jp",
    japanese: "jp",
    mc: "mc",
    monaco: "mc",
    monegasque: "mc",
    mx: "mx",
    mexico: "mx",
    my: "my",
    mys: "my",
    malaysia: "my",
    malaysian: "my",
    nl: "nl",
    netherlands: "nl",
    dutch: "nl",
    pl: "pl",
    pol: "pl",
    poland: "pl",
    polish: "pl",
    pt: "pt",
    prt: "pt",
    portugal: "pt",
    portuguese: "pt",
    qa: "qa",
    qatar: "qa",
    ru: "ru",
    rus: "ru",
    russia: "ru",
    russian: "ru",
    sa: "sa",
    "saudi arabia": "sa",
    sg: "sg",
    singapore: "sg",
    tr: "tr",
    tur: "tr",
    turkey: "tr",
    turkiye: "tr",
    "türkiye": "tr",
    turkish: "tr",
    es: "es",
    spain: "es",
    spanish: "es",
    fr: "fr",
    fra: "fr",
    france: "fr",
    french: "fr",
    nz: "nz",
    nzl: "nz",
    "new zealand": "nz",
    "new zealander": "nz",
    "new zealanders": "nz",
    th: "th",
    tha: "th",
    thailand: "th",
    thai: "th",
    uae: "ae",
    "u a e": "ae",
    "united arab emirates": "ae",
    us: "us",
    "u s": "us",
    "u s a": "us",
    usa: "us",
    american: "us",
    "united states": "us",
    "united states america": "us",
    "united states of america": "us",
  };

  if (codes[normalized]) {
    return codes[normalized];
  }

  return /^[a-z]{2}$/i.test(value) ? value.toLowerCase() : undefined;
}

function getCircuitTimezone(country: string, circuitName = "") {
  const normalizedCountry = normalizeCountryName(country);
  const normalizedCircuit = normalizeCountryName(circuitName);
  const circuitTimezones: Record<string, string> = {
    "baku city circuit": "Asia/Baku",
    "circuit gilles villeneuve": "America/Toronto",
    "circuit of the americas": "America/Chicago",
    interlagos: "America/Sao_Paulo",
    "marina bay street circuit": "Asia/Singapore",
    "yas marina circuit": "Asia/Dubai",
  };
  const countryTimezones: Record<string, string> = {
    australia: "Australia/Melbourne",
    austria: "Europe/Vienna",
    azerbaijan: "Asia/Baku",
    bahrain: "Asia/Bahrain",
    belgium: "Europe/Brussels",
    brazil: "America/Sao_Paulo",
    canada: "America/Toronto",
    china: "Asia/Shanghai",
    hungary: "Europe/Budapest",
    italy: "Europe/Rome",
    japan: "Asia/Tokyo",
    mexico: "America/Mexico_City",
    malaysia: "Asia/Kuala_Lumpur",
    monaco: "Europe/Monaco",
    netherlands: "Europe/Amsterdam",
    qatar: "Asia/Qatar",
    "saudi arabia": "Asia/Riyadh",
    singapore: "Asia/Singapore",
    spain: "Europe/Madrid",
    "united arab emirates": "Asia/Dubai",
    "united kingdom": "Europe/London",
    "united states": "America/Chicago",
    usa: "America/Chicago",
  };

  return circuitTimezones[normalizedCircuit] ?? countryTimezones[normalizedCountry] ?? null;
}

function getIsoCountryFlag(value: string) {
  const code = value.trim().toUpperCase();

  if (!/^[A-Z]{2}$/.test(code)) {
    return null;
  }

  return Array.from(code)
    .map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65))
    .join("");
}

function normalizeCountryName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getProfileName(
  profile:
    | { display_name: string | null; email: string | null }
    | { display_name: string | null; email: string | null }[]
    | null,
) {
  const value = Array.isArray(profile) ? profile[0] : profile;

  return value?.display_name ?? value?.email?.split("@")[0] ?? "Участник";
}

const getCurrentNewsTagAllowlist = cache(async (): Promise<NewsTagAllowlist> => {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return { drivers: new Set<string>(), teams: new Set<string>() };
  }

  const latestStanding = await supabase
    .from("driver_standings")
    .select("season_year, round")
    .not("round", "is", null)
    .order("season_year", { ascending: false })
    .order("round", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const standingsQuery = latestStanding.data
    ? supabase
        .from("driver_standings")
        .select("drivers(full_name, slug, code), teams(name, short_name, code)")
        .eq("season_year", latestStanding.data.season_year)
        .eq("round", latestStanding.data.round)
    : null;

  const [standingsResult, activeDriversResult, activeTeamsResult] = await Promise.all([
    standingsQuery,
    supabase
      .from("drivers")
      .select("full_name, slug, code")
      .eq("is_active", true),
    supabase
      .from("teams")
      .select("name, short_name, code")
      .eq("is_active", true),
  ]);

  const drivers = new Set<string>();
  const teams = new Set<string>();
  const standingRows = (standingsResult?.data ?? []) as unknown as Array<{
    drivers:
      | { code?: string | null; full_name?: string | null; slug?: string | null }
      | { code?: string | null; full_name?: string | null; slug?: string | null }[]
      | null;
    teams:
      | { code?: string | null; name?: string | null; short_name?: string | null }
      | { code?: string | null; name?: string | null; short_name?: string | null }[]
      | null;
  }>;

  standingRows.forEach((row) => {
    const driver = getRelationObject(row.drivers);
    const team = getRelationObject(row.teams);

    addDriverTagSlugs(drivers, driver);
    addTeamTagSlugs(teams, team);
  });

  if (drivers.size && teams.size) {
    return { drivers, teams };
  }

  (activeDriversResult.data ?? []).forEach((driver) => {
    addDriverTagSlugs(drivers, driver);
  });

  (activeTeamsResult.data ?? []).forEach((team) => {
    addTeamTagSlugs(teams, team);
  });

  return { drivers, teams };
});

function addDriverTagSlugs(
  drivers: Set<string>,
  driver: { code?: string | null; full_name?: string | null; slug?: string | null } | null,
) {
  if (!driver) {
    return;
  }

  const values = [driver.slug, driver.full_name, driver.code].filter(Boolean);

  values.forEach((value) => {
    const slug = slugify(String(value).replace(/^driver-/i, ""));

    if (slug) {
      drivers.add(`driver-${slug}`);
    }
  });
}

function addTeamTagSlugs(
  teams: Set<string>,
  team: { code?: string | null; name?: string | null; short_name?: string | null } | null,
) {
  if (!team) {
    return;
  }

  const values = [team.code, team.short_name, team.name].filter(Boolean);

  values.forEach((value) => {
    const slug = slugify(String(value));

    if (slug) {
      teams.add(`team-${slug}`);
    }
  });
}

function getArticleTags(tags: TagRelation | null, allowlist?: NewsTagAllowlist) {
  if (!tags) {
    return [{ name: "F1", slug: "f1" }];
  }

  const list = Array.isArray(tags) ? tags : [tags];
  const seen = new Set<string>();
  const result: { name: string; slug: string; type?: string }[] = [];

  list.forEach((item) => {
    const rawTags = Array.isArray(item.tags) ? item.tags : item.tags ? [item.tags] : [];

    rawTags.forEach((tag) => {
      const rawName = tag.name.trim();

      if (!rawName) {
        return;
      }

      const type = tag.type ?? undefined;
      const name = type === "race" ? formatGrandPrixTagNameRu(rawName) : rawName;
      const slug = tag.slug ?? slugify(rawName);
      const canonical = normalizeTagKey(rawName);

      if (type === "driver" && allowlist && !allowlist.drivers.has(slug)) {
        return;
      }

      if (type === "team" && allowlist && !allowlist.teams.has(slug)) {
        return;
      }

      if (seen.has(slug) || seen.has(canonical)) {
        return;
      }

      seen.add(slug);
      seen.add(canonical);
      result.push({ name, slug, type });
    });
  });

  return result.length ? result : [{ name: "F1", slug: "f1" }];
}

function normalizeTagKey(value: string) {
  return slugify(value.replace(/,\s*\d{4}/, ""));
}

function isUsableNewsImageUrl(value: string | null | undefined): value is string {
  const url = value?.trim();

  if (!url) {
    return false;
  }

  const lower = url.toLowerCase();

  return (
    /^https?:\/\//i.test(url) &&
    !lower.includes("favicon") &&
    !lower.includes("/cdn-cgi/") &&
    !lower.includes("challenge-platform") &&
    !lower.includes("/themes/") &&
    !lower.includes("/buttons/")
  );
}

function getNewsImageUrl(row: Pick<ArticleRow, "raw_payload" | "raw_image_url" | "source_image_url">) {
  return (
    [row.source_image_url, row.raw_image_url, row.raw_payload?.imageUrl, extractNewsImageFromText(row.raw_payload?.content), extractNewsImageFromText(row.raw_payload?.description)]
      .find(isUsableNewsImageUrl) ?? undefined
  );
}

function extractNewsImageFromText(value: string | null | undefined) {
  const text = value ?? "";
  const srcCandidate =
    text.match(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i)?.[1] ??
    text.match(/<meta\b[^>]*\b(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/i)?.[1] ??
    text.match(/https?:\/\/[^\s"'<>]+\.(?:jpe?g|png|webp|avif)(?:\?[^\s"'<>]+)?/i)?.[0] ??
    null;

  if (srcCandidate) {
    return decodeHtmlEntities(srcCandidate);
  }

  const srcset = text.match(/\bsrcset=["']([^"']+)["']/i)?.[1];

  return srcset?.split(",").map((entry) => decodeHtmlEntities(entry.trim().split(/\s+/)[0])).find(Boolean);
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function makeTeamTagSlug(value: string) {
  return `team-${slugify(value)}`;
}

function makeDriverTagSlug(value: string) {
  const normalized = slugify(value.replace(/^driver-/i, ""));

  return normalized ? `driver-${normalized}` : null;
}

function getDriverNewsTagSlugs(driver: {
  code?: string | null;
  full_name?: string | null;
  slug?: string | null;
}) {
  return [
    driver.slug,
    driver.full_name,
    driver.code,
  ].reduce<string[]>((result, value) => {
    const slug = value ? makeDriverTagSlug(String(value)) : null;

    if (slug && !result.includes(slug)) {
      result.push(slug);
    }

    return result;
  }, []);
}

function getTeamNewsTagSlugs(team: {
  code?: string | null;
  name?: string | null;
  short_name?: string | null;
}) {
  return [
    team.code,
    team.short_name,
    team.name,
  ].reduce<string[]>((result, value) => {
    const slug = value ? makeTeamTagSlug(String(value)) : null;

    if (slug && !result.includes(slug)) {
      result.push(slug);
    }

    return result;
  }, []);
}

function uniqueNewsTagFilters(filters: { name: string; slug: string }[]) {
  const seen = new Set<string>();
  const result: { name: string; slug: string }[] = [];

  filters.forEach((filter) => {
    const canonicalName = normalizeTagKey(filter.name);

    if (!filter.name || !filter.slug || seen.has(filter.slug) || seen.has(canonicalName)) {
      return;
    }

    seen.add(filter.slug);
    seen.add(canonicalName);
    result.push(filter);
  });

  return result;
}

function uniqueNewsTagFiltersBySlug(filters: { name: string; slug: string }[]) {
  const seen = new Set<string>();
  const result: { name: string; slug: string }[] = [];

  filters.forEach((filter) => {
    if (!filter.name || !filter.slug || seen.has(filter.slug)) {
      return;
    }

    seen.add(filter.slug);
    result.push(filter);
  });

  return result;
}

function isNewsFilterTag(
  tag: { name: string; slug: string | null; type?: string | null },
): tag is { name: string; slug: string; type?: string | null } {
  return Boolean(tag.name && tag.slug);
}

function normalizeArticleDetails(details: string | null, summary: string) {
  const normalizedDetails = details?.trim();

  if (!normalizedDetails) {
    return undefined;
  }

  const normalizedSummary = summary.trim();

  if (
    normalizedDetails === normalizedSummary ||
    normalizedDetails.toLowerCase() === normalizedSummary.toLowerCase()
  ) {
    return undefined;
  }

  return normalizedDetails;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getRelationName(
  relation: { name?: string; full_name?: string } | { name?: string; full_name?: string }[] | null,
  fallback: string,
) {
  const value = Array.isArray(relation) ? relation[0] : relation;

  return value?.name ?? value?.full_name ?? fallback;
}

function getTeamVisualFields(
  relation: TeamRelationObject | TeamRelationObject[] | null,
  fallback: string,
  season = 2026,
) {
  const team = getRelationObject(relation);
  const teamName = team?.name ?? fallback;
  const asset = getTeamAsset(teamName, season) ?? getTeamAsset(team?.code, season);

  return {
    team: teamName,
    teamCode: team?.code ?? asset?.code,
    teamLogo: asset?.logo,
    teamColor: asset?.color ?? team?.color_hex ?? undefined,
  };
}

function getRelationObject<T>(relation: T | T[] | null): T | null {
  return (Array.isArray(relation) ? relation[0] : relation) ?? null;
}

function localizeTeamCountry(country?: string | null) {
  if (!country) {
    return null;
  }

  const localized = new Map([
    ["american", "США"],
    ["austrian", "Австрия"],
    ["british", "Великобритания"],
    ["french", "Франция"],
    ["german", "Германия"],
    ["italian", "Италия"],
  ]);

  return localized.get(country.trim().toLowerCase()) ?? country;
}

function getRelationList<T>(relation: T | T[] | null | undefined): T[] {
  if (!relation) {
    return [];
  }

  return Array.isArray(relation) ? relation : [relation];
}

async function getDriversByIds(ids: string[]) {
  if (!ids.length) {
    return new Map<string, { fullName: string; slug?: string | null; currentTeamId?: string | null }>();
  }

  // Historical drivers can be inactive and therefore hidden by the public
  // current-grid RLS policy. Circuit history exposes only safe display fields,
  // so resolve those relations through the server-only client.
  const supabase = createSupabaseAdminClient() ?? await createSupabaseServerClient();

  if (!supabase) {
    return new Map<string, { fullName: string; slug?: string | null; currentTeamId?: string | null }>();
  }

  const { data } = await supabase
    .from("drivers")
    .select("id, full_name, slug, current_team_id")
    .in("id", ids);

  return new Map(
    (data ?? []).map((driver) => [
      driver.id,
      {
        fullName: driver.full_name,
        slug: driver.slug,
        currentTeamId: driver.current_team_id,
      },
    ]),
  );
}

async function getTeamsByIds(ids: string[]) {
  if (!ids.length) {
    return new Map<string, { name: string; color?: string | null }>();
  }

  const supabase = createSupabaseAdminClient() ?? await createSupabaseServerClient();

  if (!supabase) {
    return new Map<string, { name: string; color?: string | null }>();
  }

  const { data } = await supabase
    .from("teams")
    .select("id, name, short_name, code, color_hex")
    .in("id", ids);

  return new Map(
    (data ?? []).map((team) => {
      const asset = getTeamAsset(team.code) ?? getTeamAsset(team.short_name) ?? getTeamAsset(team.name);

      return [
        team.id,
        {
          name: team.short_name ?? team.name,
          color: asset?.color ?? team.color_hex,
        },
      ];
    }),
  );
}

function getDriverName(
  drivers: Map<string, { fullName: string }>,
  driverId?: string | null,
) {
  return driverId ? drivers.get(driverId)?.fullName ?? "Пилот уточняется" : "—";
}

function getTeamName(
  teams: Map<string, { name: string }>,
  teamId?: string | null,
) {
  return teamId ? teams.get(teamId)?.name ?? "Команда уточняется" : "—";
}

function extractPodiumDriverIds(value: unknown) {
  return getJsonArray(value)
    .map((item) => getJsonRecord(item).driverId ?? getJsonRecord(item).driver_id)
    .filter((id): id is string => typeof id === "string" && Boolean(id));
}

function extractPodiumNames(
  value: unknown,
  drivers: Map<string, { fullName: string }>,
) {
  return getJsonArray(value)
    .map((item) => {
      const record = getJsonRecord(item);
      const driverId = stringOrNull(record.driverId) ?? stringOrNull(record.driver_id);

      return stringOrNull(record.driver) ?? getDriverName(drivers, driverId);
    })
    .filter((name) => name && name !== "—")
    .slice(0, 3);
}

function collectCircuitSourceErrors(statsErrors: unknown, historyRows: CircuitHistoryDbRow[]) {
  const errors = new Set<string>();

  for (const value of [statsErrors, ...historyRows.map((row) => row.source_errors)]) {
    const record = getJsonRecord(value);

    Object.values(record).forEach((error) => {
      const message = stringOrNull(error);

      if (message) {
        errors.add(message);
      }
    });
  }

  return [...errors];
}

function mapCircuitCharacterStats(value: unknown, fallbackRatings: CircuitStatsView["ratings"]): CircuitStatsView["character"] {
  const record = getJsonRecord(value);
  const ratingsSource = Array.isArray(record.ratings) ? record.ratings : [];
  const ratings = ratingsSource
    .map((entry) => {
      const rating = getJsonRecord(entry);
      const label = stringOrNull(rating.label);

      if (!label) {
        return null;
      }

      return {
        label,
        value: toNumberOrNull(rating.value),
        helper: stringOrNull(rating.helper) ?? "Шкала от 1 до 5 по историческим данным.",
      };
    })
    .filter((entry): entry is CircuitStatsView["ratings"][number] => Boolean(entry));
  const facts = getJsonRecord(record.facts);

  return {
    sinceSeason: toNumberOrNull(record.sinceSeason) ?? 2000,
    racesCount: toNumberOrNull(record.racesCount) ?? 0,
    ratings: ratings.length ? ratings : fallbackRatings,
    facts: {
      poleWinRate: toNumberOrNull(facts.poleWinRate),
      winnerAvgStartPosition: toNumberOrNull(facts.winnerAvgStartPosition),
      avgDnfCount: toNumberOrNull(facts.avgDnfCount),
    },
  };
}

function getPositionRecord(value: unknown) {
  const record = getJsonRecord(value);

  if (!Object.keys(record).length) {
    return null;
  }

  const raceName = stringOrNull(record.raceName) ?? stringOrNull(record.race_name);

  return {
    season: toNumberOrNull(record.season),
    round: toNumberOrNull(record.round),
    raceName: raceName ? formatGrandPrixNameRu(raceName) : null,
    driver: stringOrNull(record.driver),
    team: stringOrNull(record.team),
    start: toNumberOrNull(record.start),
    finish: toNumberOrNull(record.finish),
    delta: toNumberOrNull(record.delta),
  };
}

function getJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getJsonArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function getNumberRecord(value: unknown) {
  const record = getJsonRecord(value);

  return Object.fromEntries(
    Object.entries(record)
      .map(([key, entry]) => [key, toNumberOrNull(entry)] as const)
      .filter((entry): entry is [string, number] => entry[1] !== null),
  );
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function getChaosLevel(score: number | null) {
  if (score === null) {
    return null;
  }

  if (score >= 8) {
    return "Высокий";
  }

  if (score >= 4) {
    return "Средний";
  }

  return "Низкий";
}

function getChaosRating(score: number | null) {
  if (score === null) {
    return null;
  }

  if (score >= 9) {
    return 5;
  }

  if (score >= 6) {
    return 4;
  }

  if (score >= 3.5) {
    return 3;
  }

  if (score >= 1.5) {
    return 2;
  }

  return 1;
}

function mapWeatherRow(weather: WeatherDbRow & { forecast_at?: string | null }, status: string): SessionWeather {
  const temperatureC =
    weather.temperature_c === null || weather.temperature_c === undefined
      ? null
      : Math.round(Number(weather.temperature_c));
  const precipitationMm =
    weather.precipitation_mm === null || weather.precipitation_mm === undefined
      ? null
      : Number(weather.precipitation_mm);

  return {
    temperature: temperatureC === null ? "Нет данных" : `${temperatureC}\u00A0°C`,
    temperatureC,
    wind:
      weather.wind_speed_kmh === null || weather.wind_speed_kmh === undefined
        ? "Нет данных"
        : `${Math.round(Number(weather.wind_speed_kmh))} км/ч`,
    precipitation: precipitationMm === null ? "Нет данных" : `${precipitationMm.toFixed(1)} мм`,
    precipitationMm,
    observedAt: formatRelativeTime(weather.observed_at ?? weather.forecast_at ?? null),
    status,
  };
}

function mapSessionStatus(status: string) {
  if (status === "completed") {
    return "Завершена";
  }

  if (status === "scheduled") {
    return "Ожидается";
  }

  return status;
}

function getRuntimeSessionStatus({
  hasResults = false,
  rawStatus,
  sessionName,
  sessionType,
  startsAt,
}: {
  hasResults?: boolean;
  rawStatus: string;
  sessionName: string;
  sessionType?: string | null;
  startsAt: string | null;
}) {
  if (hasResults || rawStatus === "completed") {
    return "Завершена";
  }

  const startMs = getTimeMs(startsAt);

  if (!startMs) {
    return mapSessionStatus(rawStatus);
  }

  const now = Date.now();
  const endMs = startMs + getSessionDurationMs(sessionType, sessionName);

  if (now >= startMs && now < endMs) {
    return "Live";
  }

  if (now >= endMs) {
    return "Завершена";
  }

  return "Ожидается";
}

function getWeekendRuntimeStatus(sessions: WeekendSession[]) {
  const starts = sessions
    .map((session) => getTimeMs(session.startsAtIso ?? null))
    .filter((value): value is number => Boolean(value))
    .sort((a, b) => a - b);

  if (!starts.length) {
    return nextSession.status;
  }

  const raceSession = [...sessions]
    .reverse()
    .find((session) => session.type === "race" || session.name.toLowerCase().includes("гонка"));
  const firstStart = starts[0];
  const raceEnd =
    getTimeMs(raceSession?.startsAtIso ?? null) !== null
      ? (getTimeMs(raceSession?.startsAtIso ?? null) ?? 0) +
        getSessionDurationMs(raceSession?.type, raceSession?.name ?? "")
      : starts.at(-1)! + 3 * 60 * 60 * 1000;
  const now = Date.now();

  if (now >= firstStart && now < raceEnd) {
    return "Live";
  }

  if (now >= raceEnd) {
    return "Завершен";
  }

  return formatCountdownTo(firstStart);
}

function getSessionDurationMs(sessionType?: string | null, sessionName = "") {
  const normalizedType = (sessionType ?? "").toLowerCase();
  const normalizedName = sessionName.toLowerCase();

  if (normalizedType === "race" || normalizedName.includes("гонка")) {
    return 3 * 60 * 60 * 1000;
  }

  if (normalizedType === "sprint" || normalizedName.includes("спринт")) {
    return 75 * 60 * 1000;
  }

  return 90 * 60 * 1000;
}

function hasRaceCompletionWindowElapsed(startsAt: string | null) {
  const start = getTimeMs(startsAt);

  return start !== null && start + getSessionDurationMs("race", "Гонка") <= Date.now();
}

function getTimeMs(value: string | null) {
  if (!value) {
    return null;
  }

  const time = new Date(value).getTime();

  return Number.isFinite(time) ? time : null;
}

function formatCountdownTo(startMs: number) {
  const diffMs = Math.max(0, startMs - Date.now());
  const totalMinutes = Math.ceil(diffMs / (60 * 1000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes - days * 24 * 60) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `До старта ${days} дн. ${hours} ч`;
  }

  if (hours > 0) {
    return `До старта ${hours} ч ${minutes} мин`;
  }

  return `До старта ${Math.max(1, minutes)} мин`;
}

function formatDateRange(value: string | null) {
  if (!value) {
    return "Дата уточняется";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Время уточняется";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}

function formatRelativeTime(value: string | null) {
  if (!value) {
    return "Недавно";
  }

  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60_000));

  if (diffMinutes < 60) {
    return `${diffMinutes} мин назад`;
  }

  const diffHours = Math.round(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours} ч назад`;
  }

  const diffDays = Math.round(diffHours / 24);

  return `${diffDays} дн назад`;
}

function isMissingNewsArticleColumnsError(error: unknown) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");

  return /news_articles\.(?:slug|image_url|source_image_url|image_prompt|ai_highlights_ru)|Could not find.*(?:slug|image_url|source_image_url|image_prompt|ai_highlights_ru)/i.test(
    message,
  );
}

function emptyWeather(): WeekendWeather {
  return {
    temperature: "Нет данных",
    temperatureC: null,
    wind: "Нет данных",
    precipitation: "Нет данных",
    precipitationMm: null,
    observedAt: "Синхронизация не запускалась",
    status: "Ожидает worker",
  };
}

function mapJobStatus(status: string) {
  if (status === "succeeded" || status === "success") {
    return "Успешно";
  }

  if (status === "failed" || status === "error") {
    return "Ошибка";
  }

  if (status === "running") {
    return "В работе";
  }

  return status;
}

function mapReportStatus(status: string) {
  const labels: Record<string, string> = {
    pending: "Ждет данные",
    collecting: "Собираем данные",
    processing: "Считаем отчет",
    summary_pending: "Ждет AI-саммари",
    ready: "Готов",
    partial: "Частично готов",
    failed: "Ошибка",
  };

  return labels[status] ?? status;
}

function mapReportSummaryStatus(status: string) {
  const labels: Record<string, string> = {
    pending: "Ждет AI",
    generated: "AI готов",
    edited: "Отредактировано",
    failed: "AI не сработал",
  };

  return labels[status] ?? status;
}
