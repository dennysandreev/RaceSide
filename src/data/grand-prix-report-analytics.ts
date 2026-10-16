import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { withServerTtlCache } from "@/lib/server-ttl-cache";
import {
  buildReportAnalytics,
  compareReportStandings,
  reportLapTimings,
  type GrandPrixReportAnalytics,
  type ReportStanding,
  type ReportTimings,
} from "@/lib/grand-prix-report";
import { resultKey } from "@/features/telemetry/lib/server";
import type { RacePace } from "@/features/telemetry/lib/types";
import { CURRENT_F1_SEASON } from "@/lib/season-navigation";
import type { GrandPrixReport } from "@/types/racemate";

type ReplayTimingRow = ReportTimings & {
  id: string;
  source_session_key: number;
};
type ReportTimingCache = {
  session?: { id: number; season: number; name: string };
  complete?: boolean;
  lapSamples?: ReportTimings["lapSamples"];
};
type StandingRow = {
  driver_id?: string;
  team_id?: string;
  position: number;
  points: number;
  drivers?: { full_name: string } | { full_name: string }[] | null;
  teams?: { name: string } | { name: string }[] | null;
};
const relation = <T>(value?: T | T[] | null): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

// Only stored timing and classification are read. Opening a report never
// queues a telemetry job or requests an external F1 API.
export async function getGrandPrixReportAnalytics(
  report: GrandPrixReport,
): Promise<GrandPrixReportAnalytics> {
  const empty = buildReportAnalytics(report);
  if (report.season !== CURRENT_F1_SEASON) return empty;
  const db = createSupabaseAdminClient();
  if (!db) return empty;
  return withServerTtlCache(
    `grand-prix-report:analytics-v3:${report.id}:${report.season}:${report.round}`,
    5 * 60_000,
    async () => {
      const replayRequest = db
        .from("race_replay_sessions")
        .select(
          "id, source_session_key, lapTimings:snapshot->lapTimings, positionTimings:snapshot->positionTimings, intervalTimings:snapshot->intervalTimings, races!inner(season_year, round)",
        )
        .eq("races.season_year", report.season)
        .eq("races.round", report.round)
        .eq("status", "ready")
        .eq("source_session_name", "Race")
        .order("prepared_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      const sessionRequest = db
        .from("sessions")
        .select("openf1_session_key,races!inner(season_year,round)")
        .eq("races.season_year", report.season)
        .eq("races.round", report.round)
        .eq("session_type", "race")
        .order("end_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const standingRows = async (
        table: "driver_standings" | "constructor_standings",
        round: number,
      ): Promise<ReportStanding[]> => {
        if (round < 1) return [];
        const driver = table === "driver_standings";
        const { data, error } = await db
          .from(table)
          .select(
            driver
              ? "driver_id,position,points,drivers(full_name),teams(name)"
              : "team_id,position,points,teams(name)",
          )
          .eq("season_year", report.season)
          .eq("round", round)
          .order("position")
          .limit(40);
        if (error || !data) return [];
        return (data as unknown as StandingRow[]).flatMap((row) => {
          const id = driver ? row.driver_id : row.team_id;
          const name = driver
            ? relation(row.drivers)?.full_name
            : relation(row.teams)?.name;
          return id && name
            ? [
                {
                  id,
                  name,
                  team: relation(row.teams)?.name ?? "",
                  position: row.position,
                  points: row.points,
                },
              ]
            : [];
        });
      };
      const [
        replayResult,
        sessionResult,
        beforeDrivers,
        afterDrivers,
        beforeTeams,
        afterTeams,
      ] = await Promise.all([
        replayRequest,
        sessionRequest,
        standingRows("driver_standings", report.round - 1),
        standingRows("driver_standings", report.round),
        standingRows("constructor_standings", report.round - 1),
        standingRows("constructor_standings", report.round),
      ]);
      const savedReplay = !replayResult.error
        ? (replayResult.data as unknown as ReplayTimingRow | null)
        : null;
      const sessionKey = !sessionResult.error
        ? sessionResult.data?.openf1_session_key
        : null;
      const sourceKey =
        typeof sessionKey === "number" &&
        Number.isSafeInteger(sessionKey) &&
        sessionKey > 0
          ? sessionKey
          : savedReplay?.source_session_key;
      const replay =
        savedReplay?.source_session_key === sourceKey ? savedReplay : null;
      // Chart preparation is independent of the map-heavy Replay archive.
      // Completed race data stays useful after the worker's refresh TTL.
      const stored = async (kind: "race-pace" | "report-timing") => {
        if (!sourceKey) return null;
        const { data, error } = await db
          .from("telemetry_cache")
          .select("payload")
          .eq("key", resultKey({ kind, session: sourceKey }))
          .maybeSingle();
        return error ? null : (data?.payload ?? null);
      };
      const [timingPayload, pacePayload] = await Promise.all([
        stored("report-timing"),
        stored("race-pace"),
      ]);
      const savedTiming = timingPayload as ReportTimingCache | null;
      const compact =
        savedTiming?.session?.id === sourceKey &&
        savedTiming?.session?.season === report.season &&
        savedTiming?.session?.name === "Race" &&
        Array.isArray(savedTiming.lapSamples) &&
        savedTiming.lapSamples.length > 0 &&
        (savedTiming.complete === true || !replay)
          ? savedTiming
          : null;
      const timings: ReportTimings = compact
        ? { lapSamples: compact.lapSamples }
        : {
            lapTimings: Array.isArray(replay?.lapTimings) ? replay.lapTimings : [],
            positionTimings: Array.isArray(replay?.positionTimings)
              ? replay.positionTimings
              : [],
            intervalTimings: Array.isArray(replay?.intervalTimings)
              ? replay.intervalTimings
              : [],
          };
      const missing = [
        !timings.lapTimings?.length && "lap_timing",
        !timings.positionTimings?.length && "position_timing",
        !timings.intervalTimings?.length && "interval_timing",
      ].filter((kind): kind is string => Boolean(kind));
      if (!compact && replay && missing.length) {
        const rows: { event_type: string; payload: unknown }[] = [];
        const readPage = (start: number, count = false) =>
          db
            .from("race_replay_events")
            .select("event_type,payload", count ? { count: "exact" } : {})
            .eq("replay_session_id", replay.id)
            .in("event_type", missing)
            .order("offset_ms")
            .order("id")
            .range(start, start + 999);
        const first = await readPage(0, true);
        if (!first.error && first.data?.length) rows.push(...first.data);
        const count = first.count ?? Infinity;
        // Bound concurrency while avoiding a network round trip for every
        // thousand timing events. Stable ordering keeps equal-time rows intact.
        for (
          let start = 1000;
          !first.error && first.data?.length === 1000 && start < count;
          start += 4000
        ) {
          const pages = await Promise.all(
            Array.from(
              { length: Math.min(4, Math.ceil((count - start) / 1000)) },
              (_, index) => readPage(start + index * 1000),
            ),
          );
          if (pages.some((page) => page.error)) break;
          rows.push(...pages.flatMap((page) => page.data ?? []));
          if (pages.some((page) => !page.data || page.data.length < 1000)) break;
        }
        for (const [kind, field] of [
          ["lap_timing", "lapTimings"],
          ["position_timing", "positionTimings"],
          ["interval_timing", "intervalTimings"],
        ] as const) {
          if (missing.includes(kind))
            Object.assign(timings, {
              [field]: rows
                .filter((row) => row.event_type === kind)
                .map((row) => {
                  if (kind === "lap_timing" && Array.isArray(row.payload)) {
                    const [driverNumber, lapNumber, startOffsetMs, durationMs] =
                      row.payload;
                    return {
                      driverNumber,
                      lapNumber,
                      startOffsetMs,
                      durationMs,
                    };
                  }
                  return row.payload;
                }),
            });
        }
      }
      timings.lapTimings = reportLapTimings(timings.lapTimings);
      if (!compact && replay && !timings.lapTimings?.length) {
        const { count, error } = await db
          .from("race_replay_events")
          .select("id", { count: "exact", head: true })
          .eq("replay_session_id", replay.id)
          .eq("event_type", "position")
          .gt("payload->lapNumber", 0);
        if (!error && count) {
          type SampleRow = {
            driver_number: number;
            offset_ms: number;
            lapNumber: number;
            position: number | null;
            gapToLeader: string | null;
          };
          const samples: SampleRow[] = [];
          // Only five timing fields are transferred; map geometry is never loaded.
          for (let start = 0; start < count; start += 4000) {
            const pages = await Promise.all(
              Array.from(
                { length: Math.min(4, Math.ceil((count - start) / 1000)) },
                (_, index) => {
                  const offset = start + index * 1000;
                  return db
                    .from("race_replay_events")
                    .select(
                      "driver_number,offset_ms,lapNumber:payload->lapNumber,position:payload->position,gapToLeader:payload->gapToLeader",
                    )
                    .eq("replay_session_id", replay.id)
                    .eq("event_type", "position")
                    .gt("payload->lapNumber", 0)
                    .order("offset_ms")
                    .order("id")
                    .range(offset, offset + 999);
                },
              ),
            );
            if (pages.some((page) => page.error)) {
              samples.length = 0;
              break;
            }
            samples.push(
              ...(pages.flatMap(
                (page) => page.data ?? [],
              ) as unknown as SampleRow[]),
            );
          }
          timings.lapSamples = samples.map((sample) => ({
            driverNumber: sample.driver_number,
            lapNumber: sample.lapNumber,
            offsetMs: sample.offset_ms,
            position: sample.position,
            gapToLeader: sample.gapToLeader,
          }));
        }
      }
      const savedPace = pacePayload as RacePace | null;
      const pace =
        savedPace?.session?.id === sourceKey &&
        savedPace?.session?.season === report.season &&
        savedPace?.session?.name === "Race" &&
        Array.isArray(savedPace.points) &&
        Array.isArray(savedPace.drivers) &&
        Array.isArray(savedPace.stints)
          ? savedPace
          : null;
      const analytics = buildReportAnalytics(report, timings, pace);
      analytics.timingPending =
        !pace?.points.length ||
        (compact !== null && compact.complete !== true) ||
        !analytics.drivers.some((driver) =>
          driver.positions.some((point) => point.value !== null),
        ) ||
        !analytics.drivers.some((driver) =>
          driver.gaps.some((point) => point.value !== null),
        );
      analytics.championship = {
        drivers: compareReportStandings(
          beforeDrivers,
          afterDrivers,
          Math.max(1, report.results.length),
          report.round === 1,
        ),
        teams: compareReportStandings(
          beforeTeams,
          afterTeams,
          Math.max(1, new Set(report.results.map((row) => row.team)).size),
          report.round === 1,
        ),
      };
      return analytics;
    },
    {
      staleWhileRevalidateMs: 30 * 60_000,
      shouldCache: (value) => !(value as GrandPrixReportAnalytics).timingPending,
    },
  );
}
