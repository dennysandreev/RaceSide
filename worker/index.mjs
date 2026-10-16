import { NEWS_EDITORIAL_VERSION, NEWS_PIPELINE_VERSION, runNewsEditorialPipeline, buildDigestInput, renderVerifiedDigest, verificationPasses, isUsableRussianNewsPayload, canRetryNewsSystemHold } from "./news-editorial.mjs";
import { createNewsTokenBudget } from "./news-token-budget.mjs";
import { loadNewsContext, selectNewsContext } from "./news-context.mjs";
import { newsResponseFormat, newsRequestOptions } from "./news-response-format.mjs";
import { extractNewsSourceHtml, extractNewsSourceMarkdown, decodeNewsEntities, cleanNewsRssText, hasUsableNewsSourceText, truncateNewsSourceText } from "./news-source-text.mjs";
import { runTelemetryTask } from "./telemetry/service.mjs";
import { TelemetryStore } from "./telemetry/store.mjs";
import { recentTelemetryTasks, localRacePaceTasks, enqueueMissingTelemetryTasks } from "./telemetry/prewarm.mjs";
import { getVerifiedReplayPitLane, withVerifiedReplayPitLane } from "../src/lib/replay-pit-lane.mjs";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";

import { createClient } from "@supabase/supabase-js";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { getPeerId } from "telegram/Utils.js";

import {
  isFantasyRaceReadyForScoring,
  scoreFantasyPrediction,
} from "./fantasy-scoring.mjs";
import {
  claimNotification,
  buildNewsArticlePath,
  escapeTelegramHtml,
  getFantasyDeadlineReminders,
  getRemainingNewsNotificationBudget,
  getSessionNotificationSetting,
  hasSessionStartChanged,
  isRacePredictionComplete,
  isReminderDue,
  isNotificationFreshForConnection,
  telegramMedal,
} from "./notification-rules.mjs";
import { requireAiBudget } from "./ai-budget.mjs";
import { shouldPersistQuietJobResult } from "./job-run-policy.mjs";
import {
  OpenRouterBatchBlockedError,
  getOpenRouterBatchBlock,
  isOpenRouterBatchBlockedError,
} from "./openrouter-errors.mjs";
import {
  ADAPTIVE_JOB_NAMES,
  getAdaptiveReportCheckPlan,
  getAdaptiveReportRefreshPlan,
  getAdaptiveResultPlan,
  getAdaptiveStartingGridPlan,
  getLatestStartedRound,
  isAdaptiveJobName,
  isStoredResultComplete,
} from "./adaptive-job-schedule.mjs";
import {
  countOpenF1SafetyEvents,
  countReportSafetyEvents,
  filterRaceControlForSession,
  formatSafetyEventSummary,
  getRaceControlEventTitle,
  getHistoricalSafetyEventCounts,
  isImportantRaceControlMessage,
  loadHistoricalSafetyEventIndex,
} from "./circuit-safety-events.mjs";
import { buildOpenF1StartingGridByDriverNumber } from "./grand-prix-report-grid.mjs";
import {
  findFormula1FastestPitStop,
  loadFormula1FastestPitStops,
} from "./formula1-fastest-pit-stops.mjs";
import {
  getFormula1TyreArticleIdentity,
  matchFormula1TyreAllocationRace,
  parseFormula1TyreAllocationArticle,
  parseSitemapLocations,
} from "./formula1-tyre-allocations.mjs";
import {
  OPENF1_RESULT_SESSION_TYPES,
  getOpenF1ParticipantIdentity,
  hasFinalOpenF1SessionSignal,
  isOpenF1ClassificationReady,
  isOpenF1ResultProbeDue,
  isOpenF1TimedSessionType,
  normalizeLiveRaceClassification,
  normalizeOpenF1SessionKey,
  normalizeOpenF1SessionClassification,
} from "./openf1-session-results.mjs";
import { getNextReportRefreshAt } from "./grand-prix-report-refresh.mjs";
import {
  buildOpenF1StartingGridUrl,
  isOpenF1StartingGridReady,
  normalizeOpenF1StartingGrid,
} from "./openf1-starting-grid.mjs";
import {
  SOCIAL_TOPIC_DEFINITIONS,
  createSocialContentHash,
  getSocialAiEditorialFields,
  getSocialInitialBackfillDays,
  getSocialPostWriteDecision,
  getTelegramFloodWaitSeconds,
  getTelegramRoundVideoExternalIds,
  getSocialRetryDelayMs,
  isSocialFormulaScopeAllowed,
  isTelegramStorageSizeError,
  mapRedditApiResponse,
  mapTelegramMtprotoMessages,
  mapXApiResponse,
  parseSocialAiPayload,
} from "./social-pipeline.mjs";
import {
  createNewsSourceContentHash,
  getNewsDedupConfig,
  isNewsFeedItemPublishable,
  isNewsDedupIdentityMatch,
  makeNewsDedupClassifierInput,
  normalizeNewsSourceUrl,
  parseNewsDedupDecision,
  parseNewsEditorialMetadata,
  rankNewsDedupCandidates,
  runNewsDeduplicationPipeline,
} from "./news-deduplication.mjs";
import {
  getUnexpectedWorkerExitMessage,
  toWorkerArguments,
  validateQueuedJob,
} from "./admin-job-queue.mjs";
import { buildOpenRouterUsageLog } from "./ai-usage.mjs";
import { resolveWorkerAiPrompt, TEXT_AI_MODEL, textAiRequestOptions } from "./ai-prompt-registry.mjs";
import { upsertServiceHeartbeat } from "./ops-heartbeat.mjs";
import { runOpsWatcher } from "./ops-watcher.mjs";
import { runDailySupportReport } from "./support-report.mjs";
import { dispatchSiteFeedback } from "./site-feedback.mjs";
import {
  findMatchingYooMoneyOperation,
  makeYooMoneyReconciliationHash,
  readRequiredEnvironmentValue,
} from "./yoomoney-reconciliation.mjs";
import {
  findMatchingTributeTransaction,
  makeTributeReconciliationHash,
} from "./tribute-reconciliation.mjs";
import "./load-env.mjs";
import {
  captureWorkerException,
  flushWorkerTelemetry,
} from "./instrumentation.mjs";

const commands = new Map([
  ["rss.fetch_all", fetchAllRss],
  ["social.fetch_all", fetchAllSocial],
  ["social.fetch_reddit", fetchRedditSocial],
  ["social.fetch_telegram", fetchTelegramSocial],
  ["social.fetch_x", fetchXSocial],
  ["social.process_ai", processSocialWithAi],
  ["social.refresh_metrics", refreshSocialMetrics],
  ["social.retry_failed", retryFailedSocialPosts],
  ["reports.check_latest", checkLatestGrandPrixReport],
  ["reports.generate", generateGrandPrixReport],
  ["reports.generate_all_completed", generateAllCompletedGrandPrixReports],
  ["reports.generate_summary", generateGrandPrixReportSummary],
  ["reports.refresh_due", refreshDueGrandPrixReports],
  ["ai.process_news", processNewsWithAi],
  ["ai.reprocess_fallback_news", reprocessFallbackNewsWithAi],
  ["ai.rehighlight_news", rehighlightNewsWithAi],
  ["news.backfill_source_images", backfillNewsSourceImages],
  ["news.audit_recent", auditRecentNewsDeduplication],
  ["news.retry_dedup", retryNewsDeduplication],
  ["ai.retag_news", retagNewsWithAi],
  ["ai.generate_daily_digest", generateDailyDigest],
  ["polls.generate_next_race", generateNextRacePolls],
  ["circuit_stats.sync_all", syncAllCircuitStats],
  ["circuit_stats.sync", syncCircuitStats],
  ["jolpica.sync_calendar", syncCalendar],
  ["jolpica.sync_results", syncResults],
  ["jolpica.repair_race_results", repairRaceResults],
  ["jolpica.repair_qualifying_results", repairQualifyingResults],
  ["jolpica.sync_standings", syncStandings],
  ["formula1.sync_tyre_allocations", syncFormula1TyreAllocations],
  ["jolpica.backfill_season", backfillHistoricalSeason],
  ["jolpica.sync_season_assets", syncSeasonAssets],
  ["jolpica.validate_season", validateSeasonCommand],
  ["jolpica.prepare_history", prepareHistoricalSeasons],
  ["jolpica.publish_history", publishHistoricalSeasons],
  ["openf1.sync_sessions", syncOpenF1Sessions],
  ["telemetry.prepare", () => runTelemetryTask({ db: supabase, taskId: getCliOption("task-id"), jobId: getCliOption("attached-run-id"), fetchRows: async (topic, query) => { const url = new URL(`${process.env.OPENF1_BASE_URL ?? "https://api.openf1.org/v1"}/${topic}`); for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value)); try { return await fetchJson(url.toString()); } catch (error) { if (String(error?.message).includes("Fetch failed 404")) return []; throw error; } } })],
  ["openf1.check_current_sessions", checkCurrentOpenF1Sessions],
  ["openf1.sync_results", syncOpenF1Laps],
  ["openf1.sync_starting_grid", syncOpenF1StartingGrid],
  ["openf1.sync_laps", syncOpenF1Laps],
  ["weather.sync_weekend", syncWeekendWeather],
  ["predictions.score", scorePredictions],
  ["notifications.enqueue", runNotificationCycle],
  ["notifications.dispatch", dispatchNotifications],
  ["billing.process_emails", processBillingEmails],
  ["billing.expire_subscriptions", expireBillingSubscriptions],
  ["billing.expire_orders", expireBillingOrders],
  ["billing.reconcile_tribute", reconcileTributePayments],
  ["billing.reconcile_yoomoney", reconcileYooMoneyPayments],
  ["billing.retry_failed_events", retryFailedBillingEvents],
  ["billing.audit", auditBilling],
  ["race_replay.prepare_current", prepareCurrentRaceReplay],
  ["race_replay.prepare_completed", prepareCompletedRaceReplays],
  ["jobs.consume_queued", consumeQueuedAdminJobs],
  ["jobs.enqueue_schedules", enqueueDueAdminSchedules],
  ["ops.heartbeat", recordServiceHeartbeatCommand],
  ["ops.watch", runOpsWatcherCommand],
  ["support.send_daily_report", sendDailySupportReport],
  ["support.dispatch_feedback", () => dispatchSiteFeedback(supabase)],
]);

const command = process.argv[2];
const isMainModule = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule && !commands.has(command)) {
  console.log(`Usage: node worker/index.mjs ${Array.from(commands.keys()).join("|")}`);
  process.exit(command ? 1 : 0);
}

let supabase = null;
let jolpicaFetchQueue = Promise.resolve();
let jolpicaLastFetchAt = 0;
const openF1SessionsByYear = new Map();
let openF1FetchQueue = Promise.resolve();
let openF1LastFetchAt = 0;
let openF1AccessTokenCache = null;
let openF1AccessTokenExpiresAt = 0;
let openF1AccessTokenPromise = null;
let historicalSafetyEventIndexPromise = null;
let socialEntityContextCache = null;
let telegramClient = null;
let telegramClientPromise = null;
const pollKinds = ["sport", "strategy", "fan"];
const historicalSeasonRange = Object.freeze({ from: 2020, to: 2025 });
const JOLPICA_SEASON_RECONCILIATION_INTERVAL_MS = 20 * 60 * 60 * 1000;
// FIA appeal decisions can precede updates in the public result feeds.
const officialRaceClassificationCorrections = Object.freeze({
  "2026-6": {
    publishedAt: "2026-09-04T00:00:00.000Z",
    sourceUrl: "https://www.fia.com/events/fia-formula-one-world-championship/season-2026/monaco-grand-prix/race-qualification",
    order: [
      "antonelli",
      "hamilton",
      "hadjar",
      "piastri",
      "lawson",
      "arvid_lindblad",
      "gasly",
      "albon",
      "ocon",
      "alonso",
      "bortoleto",
      "russell",
      "hulkenberg",
      "colapinto",
      "perez",
      "sainz",
      "leclerc",
      "stroll",
      "norris",
      "bearman",
      "bottas",
      "max_verstappen",
    ],
    points: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    times: [
      "2:23:31.243",
      "+6.271",
      "+23.394",
      "+24.261",
      "+26.553",
      "+29.010",
      "+30.369",
      "+33.413",
      "+37.140",
      "+41.899",
      "+42.748",
      "+43.353",
      "+44.102",
      "+48.964",
      "+49.153",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ],
  },
});
const teamCodesByExternalId = Object.freeze({
  alfa: "ALF",
  alpine: "ALP",
  alphatauri: "ATR",
  aston_martin: "AMR",
  audi: "AUD",
  cadillac: "CAD",
  ferrari: "FER",
  haas: "HAS",
  mclaren: "MCL",
  mercedes: "MER",
  racing_bulls: "RBU",
  racing_point: "RPT",
  rb: "VCB",
  red_bull: "RBR",
  renault: "RNL",
  sauber: "SAU",
  williams: "WIL",
});
const teamLineagesByExternalId = Object.freeze({
  alfa: "audi",
  alpine: "alpine",
  alphatauri: "racing-bulls",
  aston_martin: "aston-martin",
  audi: "audi",
  cadillac: "cadillac",
  ferrari: "ferrari",
  haas: "haas",
  mclaren: "mclaren",
  mercedes: "mercedes",
  racing_bulls: "racing-bulls",
  racing_point: "aston-martin",
  rb: "racing-bulls",
  red_bull: "red-bull",
  renault: "alpine",
  sauber: "audi",
  williams: "williams",
});
const teamSeasonColorsByExternalId = Object.freeze({
  alfa: "#C92D4B",
  alpine: "#0093CC",
  alphatauri: "#2B4562",
  aston_martin: "#229971",
  audi: "#D71920",
  cadillac: "#B98B2F",
  ferrari: "#E8002D",
  haas: "#B6BABD",
  mclaren: "#FF8000",
  mercedes: "#27F4D2",
  racing_bulls: "#6692FF",
  racing_point: "#F596C8",
  rb: "#6692FF",
  red_bull: "#3671C6",
  renault: "#FFF500",
  sauber: "#52E252",
  williams: "#64C4FF",
});
export async function runWorkerCli() {
  if (!commands.has(command)) {
    console.log(`Usage: node worker/cli.mjs ${Array.from(commands.keys()).join("|")}`);
    process.exitCode = command ? 1 : 0;
    return;
  }

  supabase = createWorkerClient();

  try {
    if (command === "jobs.consume_queued") {
      await consumeQueuedAdminJobs();
    } else if (command === "jobs.enqueue_schedules") {
      await enqueueDueAdminSchedules();
    } else if (command === "ops.heartbeat") {
      await recordServiceHeartbeatCommand();
    } else if (command === "ops.watch") {
      await runOpsWatcherCommand();
    } else {
      await recordServiceHeartbeatSafely("worker", { phase: "started" });
      await runJob(command, commands.get(command));
      await recordServiceHeartbeatSafely("worker", { phase: "finished" });
    }
  } finally {
    await disconnectTelegramClient();
  }
}

if (isMainModule) {
  await runWorkerCli();
}

function createWorkerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing for worker");
  }

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing for worker writes");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function requestOpenRouterCompletion({
  apiKey,
  body,
  model,
  purpose,
  relatedArticleId = null,
  relatedDigestId = null,
  promptKey = null,
  promptVersionId = null,
  onUsage,
}) {
  model = TEXT_AI_MODEL;
  const parameters = { ...body };
  delete parameters.temperature;
  await ensureAiBudgetAvailable(purpose);
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "http-referer": process.env.OPENROUTER_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "",
      "x-title": process.env.OPENROUTER_APP_NAME ?? "RaceSide",
    },
    body: JSON.stringify({ ...textAiRequestOptions(), ...parameters, model }),
    signal: AbortSignal.timeout(getOpenRouterTimeoutMs()),
  });
  const payload = await readJsonResponse(response);
  onUsage?.(payload?.usage);

  await recordOpenRouterUsage(payload, {
    model,
    purpose,
    relatedArticleId,
    relatedDigestId,
    promptKey,
    promptVersionId,
  });

  const batchBlock = getOpenRouterBatchBlock(response.status, payload);

  if (batchBlock) {
    throw new OpenRouterBatchBlockedError(batchBlock);
  }

  return { payload, response };
}

function getOpenRouterTimeoutMs() {
  const configured = Number(process.env.OPENROUTER_TIMEOUT_MS ?? 60_000);

  if (!Number.isFinite(configured)) {
    return 60_000;
  }

  return Math.max(10_000, Math.min(configured, 120_000));
}

async function ensureAiBudgetAvailable(purpose) {
  await requireAiBudget(supabase, purpose);
}

async function recordOpenRouterUsage(payload, context) {
  const row = buildOpenRouterUsageLog(payload, context);
  try {
    const { error } = await supabase.from("ai_usage_logs").insert(row);
    if (!error) return;
    logWorkerWarning("openrouter.usage_log.failed", {
      purpose: context.purpose,
      reason: getSafeErrorMessage(error),
    });
  } catch (error) {
    logWorkerWarning("openrouter.usage_log.failed", {
      purpose: context.purpose,
      reason: getSafeErrorMessage(error),
    });
  }
}

async function runJob(jobName, runner) {
  const attachedRunId = getCliOption("attached-run-id");
  const quietEmpty = !attachedRunId && process.argv.includes("--quiet-empty");
  const attachedResult = attachedRunId
    ? await supabase
      .from("job_runs")
      .select("id, job_name, status, queue_version, metadata")
      .eq("id", attachedRunId)
      .maybeSingle()
    : null;
  const createdResult = attachedRunId || quietEmpty
    ? null
    : await supabase
      .from("job_runs")
      .insert({
        job_name: jobName,
        status: "running",
        items_processed: 0,
        metadata: { cli: true },
      })
      .select("id, job_name, status, queue_version, metadata")
      .single();
  const job = attachedResult?.data ?? createdResult?.data;
  const error = attachedResult?.error ?? createdResult?.error;

  if (error) {
    throw error;
  }
  if (
    !quietEmpty && (
      !job ||
      (attachedRunId && (
        job.id !== attachedRunId ||
        job.job_name !== jobName ||
        job.queue_version !== 1 ||
        job.status !== "running"
      ))
    )
  ) {
    throw new Error("Attached admin job is not available for execution");
  }

  try {
    const result = await runner(getPlainObject(job?.metadata));
    const adaptiveSchedule = getPlainObject(job?.metadata).source === "schedule"
      ? await refreshRelatedAdaptiveSchedules(jobName)
      : null;
    const jobResult = {
      jobName,
      itemsProcessed: result.itemsProcessed ?? 0,
      metadata: {
        ...(result.metadata ?? {}),
        ...(adaptiveSchedule ? { adaptiveSchedule } : {}),
      },
    };

    if (quietEmpty && !shouldPersistQuietJobResult(jobResult)) {
      process.stdout.write(`${JSON.stringify(jobResult)}\n`);
      return jobResult;
    }

    const successfulRun = {
      status: "success",
      finished_at: new Date().toISOString(),
      items_processed: jobResult.itemsProcessed,
      metadata: {
        ...getPlainObject(job?.metadata),
        cli: true,
        result: jobResult.metadata,
      },
    };
    const persistence = quietEmpty
      ? await supabase
        .from("job_runs")
        .insert({
          job_name: jobName,
          started_at: successfulRun.finished_at,
          ...successfulRun,
        })
      : await supabase
        .from("job_runs")
        .update({
          ...successfulRun,
          metadata: {
            ...getPlainObject(job.metadata),
            result: jobResult.metadata,
          },
        })
        .eq("id", job.id);

    if (persistence.error) {
      throw persistence.error;
    }

    process.stdout.write(`${JSON.stringify(jobResult)}\n`);
    return jobResult;
  } catch (jobError) {
    if (getPlainObject(job?.metadata).source === "schedule") {
      await refreshRelatedAdaptiveSchedules(jobName).catch((scheduleError) => {
        logWorkerWarning("adaptive_schedule.refresh_after_failure.failed", {
          jobName,
          reason: getSafeErrorMessage(scheduleError),
        });
      });
    }
    const failedRun = {
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: jobError instanceof Error ? jobError.message : String(jobError),
    };
    const persistence = quietEmpty
      ? await supabase
        .from("job_runs")
        .insert({
          job_name: jobName,
          started_at: failedRun.finished_at,
          items_processed: 0,
          metadata: { cli: true },
          ...failedRun,
        })
      : await supabase
        .from("job_runs")
        .update(failedRun)
        .eq("id", job.id);

    if (persistence.error) {
      throw persistence.error;
    }

    captureWorkerException(jobError, {
      jobName,
      runId: job?.id,
    });

    throw jobError;
  }
}

async function refreshRelatedAdaptiveSchedules(jobName) {
  const relatedNames = new Set();

  if (isAdaptiveJobName(jobName)) {
    relatedNames.add(jobName);
  }
  if (jobName === "jolpica.sync_calendar") {
    ADAPTIVE_JOB_NAMES.forEach((name) => relatedNames.add(name));
  }
  if (jobName === "openf1.sync_results" || jobName === "jolpica.sync_results") {
    relatedNames.add("reports.check_latest");
    relatedNames.add("reports.refresh_due");
    relatedNames.add("openf1.sync_starting_grid");
  }
  if (jobName === "openf1.sync_sessions") {
    relatedNames.add("openf1.sync_starting_grid");
  }
  if (jobName === "reports.check_latest") {
    relatedNames.add("reports.refresh_due");
  }

  const plans = {};

  for (const relatedName of relatedNames) {
    const plan = await buildAdaptiveSchedulePlan(relatedName);
    const { error } = await supabase
      .from("admin_job_schedules")
      .update({
        next_run_at: plan.nextRunAt,
        updated_at: new Date().toISOString(),
      })
      .eq("job_name", relatedName)
      .eq("schedule_kind", "adaptive")
      .eq("is_enabled", true);

    if (error) {
      throw error;
    }

    plans[relatedName] = plan;
  }

  return Object.keys(plans).length ? plans : null;
}

async function buildAdaptiveSchedulePlan(jobName) {
  if (jobName === "openf1.sync_results" || jobName === "jolpica.sync_results") {
    const provider = jobName.startsWith("openf1.") ? "openf1" : "jolpica";
    const sessions = await loadAdaptiveResultSessions(provider);

    return getAdaptiveResultPlan({
      hasLiveAccess: provider === "openf1" && hasOpenF1LiveCredentials(),
      provider,
      sessions,
    });
  }

  if (jobName === "openf1.sync_starting_grid") {
    return getAdaptiveStartingGridPlan({
      weekends: await loadAdaptiveStartingGridWeekends(),
    });
  }

  if (jobName === "reports.check_latest") {
    return getAdaptiveReportCheckPlan({
      races: await loadAdaptiveRaceReportStates(),
    });
  }

  if (jobName === "reports.refresh_due") {
    return getAdaptiveReportRefreshPlan({
      nextRefreshAt: await loadNextReportRefreshAt(),
    });
  }

  throw new Error(`Unknown adaptive schedule: ${jobName}`);
}

async function loadAdaptiveResultSessions(provider) {
  const season = getCurrentF1Season();
  const now = Date.now();
  const since = new Date(now - 25 * 60 * 60 * 1000).toISOString();
  const { data: sessions, error } = await supabase
    .from("sessions")
    .select("id, session_type, end_at, races!inner(season_year)")
    .eq("races.season_year", season)
    .not("end_at", "is", null)
    .gte("end_at", since)
    .order("end_at", { ascending: true, nullsFirst: false })
    .limit(100);

  if (error) {
    throw error;
  }

  const endedSessionIds = (sessions ?? [])
    .filter((session) => Date.parse(session.end_at) <= now)
    .map((session) => session.id);
  const resultRows = endedSessionIds.length
    ? await supabase
      .from("session_results")
      .select("session_id, grid, points, raw_payload")
      .in("session_id", endedSessionIds)
      .limit(endedSessionIds.length * 30)
    : { data: [], error: null };

  if (resultRows.error) {
    throw resultRows.error;
  }

  const sourceCounts = new Map();

  for (const row of resultRows.data ?? []) {
    const counts = sourceCounts.get(row.session_id) ?? { jolpica: 0, jolpicaGrid: 0, openf1: 0, openf1WithPoints: 0 };
    const payload = getPlainObject(row.raw_payload);

    if ("Driver" in payload) {
      counts.jolpica += 1;
      if (row.grid !== null && row.grid !== undefined) {
        counts.jolpicaGrid += 1;
      }
    }
    if (payload._racemate_source === "openf1_session_result") {
      counts.openf1 += 1;
      if (row.points !== null && Number.isFinite(Number(row.points))) {
        counts.openf1WithPoints += 1;
      }
    }
    sourceCounts.set(row.session_id, counts);
  }

  const minimumRows = Math.max(10, Number(process.env.OPENF1_MIN_RESULT_ROWS ?? 20));

  return (sessions ?? []).map((session) => {
    const counts = sourceCounts.get(session.id) ?? { jolpica: 0, jolpicaGrid: 0, openf1: 0, openf1WithPoints: 0 };
    const isComplete = isStoredResultComplete({
      counts,
      minimumRows,
      provider,
      sessionType: session.session_type,
    });

    return {
      endAt: session.end_at,
      isComplete,
      sessionType: session.session_type,
    };
  });
}

async function loadAdaptiveStartingGridWeekends() {
  const season = getCurrentF1Season();
  const { data, error } = await supabase
    .from("sessions")
    .select("race_id, session_type, start_at, end_at, openf1_session_key, races!inner(id, season_year, round, race_name, race_start_at)")
    .eq("races.season_year", season)
    .in("session_type", ["qualifying", "race"])
    .order("start_at", { ascending: true, nullsFirst: false })
    .limit(100);

  if (error) {
    throw error;
  }

  const weekends = new Map();

  for (const session of data ?? []) {
    const race = firstRelation(session.races);

    if (!race?.id) {
      continue;
    }

    const weekend = weekends.get(race.id) ?? {
      qualifyingEndAt: null,
      qualifyingSessionKey: null,
      raceId: race.id,
      raceName: race.race_name,
      raceStartAt: race.race_start_at,
      round: Number(race.round),
    };

    if (session.session_type === "qualifying") {
      weekend.qualifyingEndAt = session.end_at;
      weekend.qualifyingSessionKey = session.openf1_session_key;
    } else if (session.session_type === "race") {
      weekend.raceStartAt = session.start_at ?? race.race_start_at;
    }

    weekends.set(race.id, weekend);
  }

  return [...weekends.values()];
}

async function loadAdaptiveRaceReportStates() {
  const season = getCurrentF1Season();
  const since = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const [{ data: sessions, error: sessionError }, { data: reports, error: reportError }] =
    await Promise.all([
      supabase
        .from("sessions")
        .select("end_at, races!inner(season_year, round)")
        .eq("session_type", "race")
        .eq("races.season_year", season)
        .not("end_at", "is", null)
        .gte("end_at", since)
        .order("end_at", { ascending: true, nullsFirst: false })
        .limit(30),
      supabase
        .from("grand_prix_reports")
        .select("round, status, summary_status")
        .eq("season", season),
    ]);

  if (sessionError) {
    throw sessionError;
  }
  if (reportError) {
    throw reportError;
  }

  const reportsByRound = new Map((reports ?? []).map((report) => [Number(report.round), report]));

  return (sessions ?? []).map((session) => {
    const race = firstRelation(session.races);
    const report = reportsByRound.get(Number(race?.round));

    return {
      endAt: session.end_at,
      reportComplete: Boolean(
        report &&
        ["ready", "partial"].includes(report.status) &&
        ["generated", "edited"].includes(report.summary_status),
      ),
    };
  });
}

async function loadNextReportRefreshAt() {
  const { data, error } = await supabase
    .from("grand_prix_reports")
    .select("next_refresh_at")
    .not("next_refresh_at", "is", null)
    .order("next_refresh_at", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.next_refresh_at ?? null;
}

async function consumeQueuedAdminJobs() {
  const workerId = `${hostname()}:${process.pid}`;
  const limit = Math.max(1, Math.min(Number(getCliOption("limit") ?? 1), 10));
  let itemsProcessed = 0;

  for (let index = 0; index < limit; index += 1) {
    const { data, error } = await supabase.rpc("claim_next_admin_job", {
      p_worker_id: workerId,
    });

    if (error) {
      throw error;
    }

    const job = Array.isArray(data) ? data[0] : data;

    if (!job) {
      break;
    }

    const validated = validateQueuedJob(job);

    if (
      !validated.ok ||
      !commands.has(job.job_name) ||
      job.job_name === "jobs.consume_queued" ||
      job.job_name === "jobs.enqueue_schedules"
    ) {
      await supabase
        .from("job_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error_message: `Запуск отклонён: ${validated.reason ?? "job_not_allowed"}`,
        })
        .eq("id", job.id);
      continue;
    }

    const workerArguments = toWorkerArguments(validated.definition, validated.args);
    try {
      const exitCode = await spawnAttachedJob(job, workerArguments);

      if (exitCode !== 0) {
        const { error: updateError } = await supabase
          .from("job_runs")
          .update({
            status: "failed",
            finished_at: new Date().toISOString(),
            error_message: getUnexpectedWorkerExitMessage(exitCode),
          })
          .eq("id", job.id)
          .eq("status", "running");
        if (updateError) throw updateError;
        process.stderr.write(`Admin job ${job.id} exited with code ${exitCode}\n`);
      }
    } catch (spawnError) {
      await supabase
        .from("job_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error_message: getSafeErrorMessage(spawnError).slice(0, 2_000),
        })
        .eq("id", job.id);
      captureWorkerException(spawnError, {
        jobName: job.job_name,
        runId: job.id,
      });
      await flushWorkerTelemetry();
      process.stderr.write(`Admin job ${job.id} could not start\n`);
    }
    itemsProcessed += 1;
  }

  process.stdout.write(`${JSON.stringify({ jobName: "jobs.consume_queued", itemsProcessed })}\n`);
  return { itemsProcessed, metadata: { workerId } };
}

async function enqueueDueAdminSchedules() {
  const limit = Math.max(1, Math.min(Number(getCliOption("limit") ?? 20), 100));
  const { data, error } = await supabase.rpc("enqueue_due_admin_schedules", {
    p_limit: limit,
  });

  if (error) throw error;
  const itemsProcessed = Number(data ?? 0);
  process.stdout.write(
    `${JSON.stringify({ jobName: "jobs.enqueue_schedules", itemsProcessed })}\n`,
  );
  return { itemsProcessed };
}

async function recordServiceHeartbeatCommand() {
  const serviceName = getCliOption("service");
  const row = await upsertServiceHeartbeat(supabase, {
    serviceName,
    summary: { source: "service-loop" },
  });

  process.stdout.write(
    `${JSON.stringify({ checkedAt: row.checked_at, serviceName: row.service_name })}\n`,
  );
  return { itemsProcessed: 1 };
}

async function runOpsWatcherCommand() {
  const result = await runOpsWatcher(supabase);
  process.stdout.write(`${JSON.stringify({ jobName: "ops.watch", ...result })}\n`);
  return result;
}

async function sendDailySupportReport() {
  return runDailySupportReport(supabase);
}

async function recordServiceHeartbeatSafely(serviceName, summary) {
  try {
    await upsertServiceHeartbeat(supabase, { serviceName, summary });
  } catch (error) {
    logWorkerWarning("ops.heartbeat.failed", {
      serviceName,
      reason: getSafeErrorMessage(error),
    });
  }
}

function spawnAttachedJob(job, workerArguments) {
  return new Promise((resolvePromise, rejectPromise) => {
    let renewalInFlight = false;
    const renewLease = async () => {
      if (renewalInFlight) {
        return;
      }

      renewalInFlight = true;
      try {
        const { data, error } = await supabase.rpc("renew_admin_job_lease", {
          p_job_id: job.id,
          p_worker_id: job.worker_id,
        });

        if (error) {
          throw error;
        }

        if (data !== true) {
          throw new Error("Admin job lease is no longer active");
        }
      } catch (error) {
        logWorkerWarning("admin_job.lease_renewal_failed", {
          jobName: job.job_name,
          runId: job.id,
          reason: getSafeErrorMessage(error),
        });
      } finally {
        renewalInFlight = false;
      }
    };
    const leaseTimer = setInterval(() => {
      void renewLease();
    }, 60_000);
    leaseTimer.unref();
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./cli.mjs", import.meta.url)),
        job.job_name,
        ...workerArguments,
        "--attached-run-id",
        job.id,
      ],
      {
        env: process.env,
        shell: false,
        stdio: "inherit",
      },
    );

    const settle = (callback, value) => {
      clearInterval(leaseTimer);
      callback(value);
    };

    child.once("error", (error) => settle(rejectPromise, error));
    child.once("exit", (code, signal) => {
      if (signal) {
        settle(rejectPromise, new Error(`Admin job stopped by signal ${signal}`));
        return;
      }
      settle(resolvePromise, code ?? 1);
    });
  });
}

function getPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function fetchAllRss() {
  const { data: sources, error } = await supabase
    .from("news_sources")
    .select("id, name, source_type, url, language")
    .eq("is_active", true);

  if (error) {
    throw error;
  }

  let itemsProcessed = 0;

  for (const source of sources ?? []) {
    try {
      const response = await fetch(source.url, {
        headers: { "user-agent": "RaceSide/0.1 (+https://racemate.local)" },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const xml = await response.text();
      const items = filterRssItemsForSource(parseRss(xml), source).slice(
        0,
        Number(process.env.AI_MAX_ARTICLES_PER_RUN ?? 50),
      );

      for (const item of items) {
        const normalizedSourceUrl = normalizeNewsSourceUrl(item.link || item.guid);
        const canonicalUrl = normalizedSourceUrl || item.link || item.guid;

        if (!canonicalUrl || !item.title) {
          continue;
        }

        const sourceContentHash = createNewsSourceContentHash({
          title: item.title,
          description: item.description,
          content: item.content,
        });
        const technicalMatch = await findTechnicalNewsDuplicate({
          sourceId: source.id,
          rssGuid: item.guid,
          normalizedSourceUrl,
          sourceContentHash,
        });

        if (technicalMatch?.kind === "same_item") {
          if (item.imageUrl) {
            await supabase
              .from("news_articles")
              .update({ source_image_url: item.imageUrl })
              .eq("id", technicalMatch.article.id)
              .is("source_image_url", null);
          }

          continue;
        }

        const ingestedAt = new Date().toISOString();
        const isTechnicalDuplicate = technicalMatch?.kind === "same_content";
        const { data: insertedArticle, error: articleError } = await supabase
          .from("news_articles")
          .insert({
            source_id: source.id,
            canonical_url: canonicalUrl,
            original_url: item.link,
            normalized_source_url: normalizedSourceUrl,
            rss_guid: item.guid,
            source_content_hash: sourceContentHash,
            original_title: item.title,
            editorial_meta: { version: NEWS_EDITORIAL_VERSION, status: "pending" },
            original_description: item.description,
            original_language: source.language,
            source_published_at: item.pubDate,
            published_at: null,
            ingested_at: ingestedAt,
            source_image_url: item.imageUrl,
            status: isTechnicalDuplicate ? "processed" : "pending",
            publication_status: isTechnicalDuplicate ? "duplicate" : "processing",
            dedup_status: isTechnicalDuplicate ? "duplicate" : "pending",
            dedup_checked_at: isTechnicalDuplicate ? ingestedAt : null,
            duplicate_of: isTechnicalDuplicate ? technicalMatch.article.id : null,
            duplicate_confidence: isTechnicalDuplicate ? 1 : null,
            duplicate_relation: isTechnicalDuplicate ? "duplicate" : null,
            duplicate_reason: isTechnicalDuplicate
              ? "Совпадает нормализованный хеш содержимого RSS."
              : null,
            raw_payload: item,
          })
          .select("id")
          .single();

        if (articleError) {
          if (articleError.code !== "23505") {
            throw articleError;
          }

          continue;
        }

        itemsProcessed += 1;

        if (isTechnicalDuplicate && insertedArticle) {
          await insertNewsDedupDecision({
            articleId: insertedArticle.id,
            candidateCount: 1,
            dedupStatus: "duplicate",
            publicationStatus: "duplicate",
            duplicateOf: technicalMatch.article.id,
            confidence: 1,
            relation: "duplicate",
            reason: "Совпадает нормализованный хеш содержимого RSS.",
            processingTimeMs: 0,
          }, "technical");
        }
      }

      await supabase
        .from("news_sources")
        .update({
          last_fetched_at: new Date().toISOString(),
          last_success_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", source.id);
    } catch (sourceError) {
      await supabase
        .from("news_sources")
        .update({
          last_fetched_at: new Date().toISOString(),
          last_error: sourceError instanceof Error ? sourceError.message : String(sourceError),
        })
        .eq("id", source.id);
    }
  }

  return { itemsProcessed };
}

async function syncFormula1TyreAllocations() {
  const season = numberOrNull(getCliOption("season"))
    ?? Number(process.env.F1_SEASON ?? new Date().getUTCFullYear());
  const force = process.argv.includes("--force");
  const sitemapIndexUrl = "https://www.formula1.com/en/latest/article/sitemap.xml";
  const sitemapIndex = await fetchFormula1Page(sitemapIndexUrl);
  const sitemapUrls = parseSitemapLocations(sitemapIndex)
    .filter((url) => /\/articles\/sitemap-\d+\.xml$/i.test(url))
    .sort((left, right) => getFormula1SitemapNumber(left) - getFormula1SitemapNumber(right))
    // A season can straddle several 500-article sitemap shards. Three recent
    // shards cover the full active season without walking the historical archive.
    .slice(-3);

  if (!sitemapUrls.length) {
    throw new Error("Formula 1 article sitemap contains no article indexes.");
  }

  const sitemapPages = await Promise.all(sitemapUrls.map((url) => fetchFormula1Page(url)));
  const articleUrls = [...new Set(sitemapPages
    .flatMap((xml) => parseSitemapLocations(xml))
    .filter((url) => getFormula1TyreArticleIdentity(url)?.season === season))];
  const { data: races, error: racesError } = await supabase
    .from("races")
    .select("id, season_year, round, race_name, tyre_hard_compound, tyre_medium_compound, tyre_soft_compound, tyre_allocation_source_url")
    .eq("season_year", season);

  if (racesError) {
    throw racesError;
  }

  let itemsProcessed = 0;
  const skipped = [];

  for (const sourceUrl of articleUrls) {
    const identity = getFormula1TyreArticleIdentity(sourceUrl);
    const race = matchFormula1TyreAllocationRace(identity, races ?? []);

    if (!race) {
      skipped.push({ sourceUrl, reason: "race_not_matched" });
      continue;
    }

    const alreadyStored = race.tyre_allocation_source_url === sourceUrl
      && race.tyre_hard_compound
      && race.tyre_medium_compound
      && race.tyre_soft_compound;

    if (alreadyStored && !force) {
      continue;
    }

    try {
      const allocation = parseFormula1TyreAllocationArticle(
        await fetchFormula1Page(sourceUrl),
        sourceUrl,
      );

      if (!allocation) {
        skipped.push({ round: race.round, sourceUrl, reason: "allocation_not_confirmed" });
        continue;
      }

      const { error: updateError } = await supabase
        .from("races")
        .update({
          tyre_hard_compound: allocation.hard,
          tyre_medium_compound: allocation.medium,
          tyre_soft_compound: allocation.soft,
          tyre_allocation_source_url: allocation.sourceUrl,
          tyre_allocation_updated_at: new Date().toISOString(),
        })
        .eq("id", race.id);

      if (updateError) {
        throw updateError;
      }

      itemsProcessed += 1;
    } catch (error) {
      skipped.push({
        round: race.round,
        sourceUrl,
        reason: getSafeErrorMessage(error),
      });
    }
  }

  return {
    itemsProcessed,
    metadata: {
      articleCandidates: articleUrls.length,
      season,
      skipped,
      source: "formula1.com",
    },
  };
}

async function fetchFormula1Page(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml,text/xml",
      "User-Agent": "RaceSide/1.0 (+https://raceside.online)",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(Number(process.env.FORMULA1_RESULTS_TIMEOUT_MS ?? 20_000)),
  });

  if (!response.ok) {
    throw new Error(`Formula 1 tyre source failed: ${response.status}`);
  }

  return response.text();
}

function getFormula1SitemapNumber(url) {
  return Number(String(url).match(/sitemap-(\d+)\.xml$/i)?.[1] ?? -1);
}

async function findTechnicalNewsDuplicate({
  sourceId,
  rssGuid,
  normalizedSourceUrl,
  sourceContentHash,
}) {
  if (normalizedSourceUrl) {
    const { data, error } = await supabase
      .from("news_articles")
      .select("id")
      .eq("normalized_source_url", normalizedSourceUrl)
      .order("ingested_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data) {
      return { kind: "same_item", article: data };
    }
  }

  if (rssGuid) {
    const { data, error } = await supabase
      .from("news_articles")
      .select("id")
      .eq("source_id", sourceId)
      .eq("rss_guid", rssGuid)
      .order("ingested_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data) {
      return { kind: "same_item", article: data };
    }
  }

  if (sourceContentHash) {
    const { data, error } = await supabase
      .from("news_articles")
      .select("id")
      .eq("source_content_hash", sourceContentHash)
      .order("ingested_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (data) {
      return { kind: "same_content", article: data };
    }
  }

  return null;
}

async function fetchAllSocial() {
  await ensureSocialSources();
  return fetchSocialSources();
}

async function fetchRedditSocial() {
  await ensureSocialSources({ platform: "reddit" });
  return fetchSocialSources({ platform: "reddit", ignoreSchedule: true });
}

async function fetchXSocial() {
  await ensureSocialSources({ platform: "x" });
  return fetchSocialSources({ platform: "x", ignoreSchedule: true });
}

async function fetchTelegramSocial() {
  return fetchSocialSources({
    platform: "telegram",
    ignoreSchedule: true,
    sourceId: getCliOption("source"),
  });
}

async function ensureSocialSources({ platform } = {}) {
  const defaults = [];

  if ((!platform || platform === "x") && process.env.X_BEARER_TOKEN) {
    for (const account of getXAccountsFromEnv()) {
      const handle = getXHandle(account);

      if (!handle) {
        continue;
      }

      defaults.push({
        platform: "x",
        name: `@${handle}`,
        source_type: "api",
        url: `https://x.com/${handle}`,
        adapter: "x-api-user",
        feed_kind: "user",
        external_key: handle,
        fetch_interval_minutes: 15,
        trust_level: getOfficialXHandles().has(handle.toLowerCase()) ? "official" : "media",
        publication_mode: "auto",
        next_fetch_at: new Date().toISOString(),
      });
    }
  }

  if ((!platform || platform === "reddit") && process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET) {
    for (const subreddit of getRedditSubredditsFromEnv()) {
      defaults.push({
        platform: "reddit",
        name: `Reddit · r/${subreddit}`,
        source_type: "api",
        url: `https://www.reddit.com/r/${subreddit}`,
        adapter: "reddit-oauth",
        feed_kind: "new",
        external_key: subreddit,
        fetch_interval_minutes: 10,
        trust_level: "community",
        publication_mode: "review",
        next_fetch_at: new Date().toISOString(),
      });
    }
  }

  if (!defaults.length) {
    return;
  }

  const { error } = await supabase
    .from("social_sources")
    .upsert(defaults, { onConflict: "platform,url" });

  if (error) {
    throw error;
  }
}

async function fetchSocialSources({ platform, ignoreSchedule = false, sourceId } = {}) {
  let query = supabase
    .from("social_sources")
    .select("id, platform, name, url, adapter, feed_kind, external_key, cursor, last_seen_external_id, include_reposts, include_replies, fetch_interval_minutes, initial_backfill_days, next_fetch_at, rate_limited_until, metadata")
    .eq("is_active", true);

  if (platform) {
    query = query.eq("platform", platform);
  } else {
    query = query.in("platform", ["x", "reddit", "telegram"]);
  }

  if (sourceId) {
    query = query.eq("id", sourceId);
  }

  const { data: sources, error } = await query.order("platform").order("name");

  if (error) {
    throw error;
  }

  let itemsProcessed = 0;
  let postsFetched = 0;
  let postsUnchanged = 0;
  const failures = [];

  const dueSources = (sources ?? []).filter((source) => ignoreSchedule || isSocialSourceDue(source));
  const concurrency = platform === "telegram"
    ? getBoundedInteger(process.env.TELEGRAM_FETCH_CONCURRENCY, 2, 1, 4)
    : getBoundedInteger(process.env.WORKER_CONCURRENCY, 3, 1, 8);

  await mapWithConcurrency(dueSources, concurrency, async (source) => {
    if (!ignoreSchedule && !isSocialSourceDue(source)) {
      return;
    }

    try {
      const result = await fetchSocialSource(source);
      if (result.rejectedExternalIds?.length) {
        await rejectUnsupportedSocialPosts(result.rejectedExternalIds);
      }
      const filtered = result.posts.filter((post) =>
        (!post.isRepost || source.include_reposts) && (!post.isReply || source.include_replies),
      );
      postsFetched += filtered.length;

      for (const post of filtered) {
        const writeResult = await saveNormalizedSocialPost(post);

        if (writeResult === "unchanged") {
          postsUnchanged += 1;
        } else {
          itemsProcessed += 1;
        }
      }

      await supabase
        .from("social_sources")
        .update({
          last_fetched_at: new Date().toISOString(),
          last_success_at: new Date().toISOString(),
          last_error: null,
          last_seen_external_id: result.lastSeenExternalId ?? source.last_seen_external_id,
          cursor: result.cursor !== undefined ? result.cursor : source.cursor,
          next_fetch_at: getNextSocialFetchAt(source.fetch_interval_minutes),
          rate_limited_until: null,
          metadata: { ...(source.metadata ?? {}), ...(result.metadata ?? {}) },
        })
        .eq("id", source.id);
    } catch (sourceError) {
      const message = sanitizeSocialSourceError(sourceError);
      failures.push({ source: source.name, error: message });
      await supabase
        .from("social_sources")
        .update({
          last_fetched_at: new Date().toISOString(),
          last_error: message,
          next_fetch_at: getNextSocialFetchAt(Math.max(5, source.fetch_interval_minutes)),
          rate_limited_until: sourceError?.rateLimitedUntil ?? null,
        })
        .eq("id", source.id);
    }
  });

  return {
    itemsProcessed,
    metadata: {
      platform: platform ?? "all",
      sourcesAvailable: (sources ?? []).length,
      sourcesChecked: dueSources.length,
      postsFetched,
      postsChanged: itemsProcessed,
      postsUnchanged,
      failures,
    },
  };
}

async function fetchSocialSource(source) {
  if (source.adapter === "x-api-user") return fetchXApiSource(source);
  if (source.adapter === "reddit-oauth") return fetchRedditApiSource(source);
  if (source.adapter === "telegram-mtproto") return fetchTelegramMtprotoSource(source);
  if (source.adapter === "reddit-rss") {
    return fetchSocialRssSource(source);
  }
  throw new Error(`Unsupported social adapter: ${source.adapter}`);
}

async function fetchTelegramMtprotoSource(source) {
  const client = await getTelegramClient();
  const entity = await resolveTelegramEntity(client, source);
  const settledBefore = Date.now() - getBoundedInteger(process.env.TELEGRAM_ALBUM_SETTLE_SECONDS, 30, 5, 300) * 1_000;
  const maxMessages = getBoundedInteger(process.env.TELEGRAM_MAX_MESSAGES_PER_SOURCE, 2_000, 10, 10_000);
  const lastSeenMessageId = getPositiveInteger(source.last_seen_external_id);
  const messagesById = new Map();

  try {
    if (lastSeenMessageId) {
      const [newMessages, recentMessages] = await Promise.all([
        client.getMessages(entity, {
          limit: maxMessages,
          minId: lastSeenMessageId,
          reverse: true,
          waitTime: 1,
        }),
        client.getMessages(entity, {
          limit: getBoundedInteger(process.env.TELEGRAM_EDIT_LOOKBACK_MESSAGES, 20, 0, 100),
        }),
      ]);

      for (const message of [...newMessages, ...recentMessages]) {
        if (message?.id) messagesById.set(Number(message.id), message);
      }
    } else {
      const backfillDays = getSocialInitialBackfillDays(source);
      const oldestAllowed = Date.now() - backfillDays * 24 * 60 * 60_000;
      let loaded = 0;

      for await (const message of client.iterMessages(entity, { limit: maxMessages, waitTime: 1 })) {
        const publishedAt = getTelegramMessageTimestamp(message);

        if (publishedAt && publishedAt < oldestAllowed) break;
        if (message?.id) messagesById.set(Number(message.id), message);
        loaded += 1;
        if (loaded >= maxMessages) break;
      }
    }
  } catch (error) {
    throw createTelegramSourceError(error);
  }

  const settledMessages = [...messagesById.values()].filter((message) => {
    const publishedAt = getTelegramMessageTimestamp(message);
    return !publishedAt || publishedAt <= settledBefore;
  });
  const channel = {
    id: entity.id,
    title: entity.title ?? source.name,
    username: entity.username ?? null,
  };
  const rejectedExternalIds = getTelegramRoundVideoExternalIds(channel, settledMessages);
  const mappedPosts = mapTelegramMtprotoMessages(source, channel, settledMessages)
    .filter((post) => post.body || post.media.length)
    .filter((post) => (!post.isRepost || source.include_reposts) && (!post.isReply || source.include_replies));
  const messageLookup = new Map(settledMessages.map((message) => [Number(message.id), message]));
  const existingMediaByPost = await getExistingTelegramMedia(mappedPosts);
  const posts = [];

  for (const post of mappedPosts) {
    posts.push(await uploadTelegramMtprotoPostMedia(
      client,
      source,
      post,
      messageLookup,
      existingMediaByPost.get(post.externalId),
    ));
  }

  const settledMessageIds = settledMessages.map((message) => Number(message?.id)).filter(Number.isInteger);
  const processedMessageIds = posts.flatMap((post) => post.messageIds).filter(Number.isInteger);
  const newestMessageId = settledMessageIds.length
    ? Math.max(lastSeenMessageId ?? 0, ...settledMessageIds)
    : lastSeenMessageId;
  const recentMessageIds = [...new Set([...processedMessageIds, ...(source.metadata?.recentMessageIds ?? [])]
    .map(Number)
    .filter(Number.isInteger))]
    .sort((left, right) => right - left)
    .slice(0, getBoundedInteger(process.env.TELEGRAM_EDIT_LOOKBACK_MESSAGES, 20, 0, 100));

  return {
    posts,
    rejectedExternalIds,
    lastSeenExternalId: newestMessageId ? String(newestMessageId) : source.last_seen_external_id,
    metadata: {
      channelId: String(entity.id),
      channelTitle: entity.title ?? source.name,
      channelUsername: entity.username ?? null,
      recentMessageIds,
      resultCount: posts.length,
    },
  };
}

async function rejectUnsupportedSocialPosts(externalIds) {
  if (!externalIds?.length) {
    return;
  }

  const { error } = await supabase
    .from("social_posts")
    .update({
      status: "rejected",
      next_retry_at: null,
      last_processing_error: "unsupported_telegram_video_note",
    })
    .eq("platform", "telegram")
    .in("external_id", externalIds);

  if (error) {
    throw error;
  }
}

async function getTelegramClient() {
  if (telegramClient) return telegramClient;
  if (telegramClientPromise) return telegramClientPromise;

  telegramClientPromise = createTelegramClient();

  try {
    telegramClient = await telegramClientPromise;
    return telegramClient;
  } finally {
    telegramClientPromise = null;
  }
}

async function createTelegramClient() {

  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH?.trim();
  const session = process.env.TELEGRAM_SESSION?.trim();

  if (!Number.isInteger(apiId) || apiId <= 0) {
    throw new Error("TELEGRAM_API_ID is missing or invalid");
  }
  if (!apiHash) throw new Error("TELEGRAM_API_HASH is missing");
  if (!session) throw new Error("TELEGRAM_SESSION is missing; run pnpm telegram:authorize");

  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 3,
    floodSleepThreshold: 0,
  });
  client.setLogLevel("none");

  try {
    await client.connect();
    if (!await client.checkAuthorization()) {
      await client.disconnect();
      throw new Error("TELEGRAM_SESSION is not authorized; run pnpm telegram:authorize");
    }
  } catch (error) {
    throw createTelegramSourceError(error);
  }
  return client;
}

async function disconnectTelegramClient() {
  if (telegramClientPromise) {
    await telegramClientPromise.catch(() => undefined);
  }
  if (!telegramClient) return;
  const client = telegramClient;
  telegramClient = null;
  await client.disconnect().catch(() => undefined);
}

async function resolveTelegramEntity(client, source) {
  const key = String(source.external_key || source.url || "").trim();
  const username = key.match(/(?:https?:\/\/)?t\.me\/([^/?#]+)/i)?.[1] ?? key.replace(/^@/, "");

  try {
    if (/^[A-Za-z][A-Za-z0-9_]{3,}$/.test(username)) {
      return await client.getEntity(username);
    }

    if (/^-?\d+$/.test(key)) {
      const normalizedId = key.replace(/^-100(?=\d)/, "");
      const dialogs = await client.getDialogs({ limit: 500 });
      const dialog = dialogs.find((item) => {
        const entityId = String(item.entity?.id ?? "");
        const peerId = item.entity ? getPeerId(item.entity) : "";
        return entityId === normalizedId || peerId === key;
      });
      if (dialog?.entity) return dialog.entity;
    }
  } catch (error) {
    throw createTelegramSourceError(error);
  }

  throw new Error("Telegram channel is unavailable. Check the username or join it with the RaceSide account.");
}

async function getExistingTelegramMedia(posts) {
  const externalIds = posts.map((post) => post.externalId);
  if (!externalIds.length) return new Map();
  const { data, error } = await supabase
    .from("social_posts")
    .select("external_id, social_post_media(media_type, url, preview_url, width, height, sort_order, provider_media_id)")
    .eq("platform", "telegram")
    .in("external_id", externalIds);
  if (error) throw error;
  return new Map((data ?? []).map((post) => [
    post.external_id,
    new Map((post.social_post_media ?? []).map((media) => [media.provider_media_id, media])),
  ]));
}

async function uploadTelegramMtprotoPostMedia(client, source, post, messagesById, existingMedia = new Map()) {
  if (!post.media.length) return post;
  const storagePrefix = createHash("sha256").update(post.externalId).digest("hex").slice(0, 20);
  const maxBytes = getBoundedInteger(process.env.TELEGRAM_MEDIA_MAX_BYTES, 50 * 1024 * 1024, 1, 2_000_000_000);
  const media = [];

  for (const item of post.media) {
    const existing = existingMedia.get(item.providerMediaId);
    if (existing?.url) {
      media.push({
        ...item,
        url: existing.url,
        previewUrl: existing.preview_url ?? (item.mediaType === "image" ? existing.url : null),
      });
      continue;
    }

    const message = messagesById.get(item.telegramMessageId);
    if (!message) {
      continue;
    }
    if (item.size && item.size > maxBytes) {
      continue;
    }

    let downloaded;
    try {
      downloaded = await client.downloadMedia(message, {});
    } catch (error) {
      const sourceError = createTelegramSourceError(error);
      if (sourceError?.rateLimitedUntil) {
        throw sourceError;
      }
      continue;
    }
    if (!Buffer.isBuffer(downloaded) || !downloaded.length) {
      continue;
    }
    if (downloaded.length > maxBytes) {
      continue;
    }

    const contentType = normalizeTelegramMediaContentType(item.mimeType, item.mediaType);
    const extension = getTelegramMediaExtension(contentType, item.fileName);
    const providerId = String(item.providerMediaId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || String(item.telegramMessageId);
    const storagePath = `telegram-mtproto/${source.id}/${storagePrefix}/${providerId}.${extension}`;
    const { error } = await supabase.storage.from("social-media").upload(storagePath, downloaded, {
      contentType,
      upsert: true,
    });
    if (isTelegramStorageSizeError(error)) {
      continue;
    }
    if (error) {
      continue;
    }
    const { data } = supabase.storage.from("social-media").getPublicUrl(storagePath);
    media.push({
      ...item,
      url: data.publicUrl,
      previewUrl: item.mediaType === "image" ? data.publicUrl : null,
    });
  }

  return { ...post, media };
}

function createTelegramSourceError(error) {
  const seconds = getTelegramFloodWaitSeconds(error);
  if (!seconds) return error instanceof Error ? error : new Error(String(error));
  const floodError = new Error(`Telegram ограничил запросы. Повторите синхронизацию через ${seconds} сек.`);
  floodError.rateLimitedUntil = new Date(Date.now() + seconds * 1_000).toISOString();
  return floodError;
}

function getTelegramMessageTimestamp(message) {
  const value = message?.date;
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
}

function normalizeTelegramMediaContentType(value, mediaType) {
  const contentType = String(value ?? "").toLowerCase();
  if (mediaType === "image" && ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(contentType)) return contentType;
  if (mediaType === "video" && ["video/mp4", "video/webm"].includes(contentType)) return contentType;
  return mediaType === "video" ? "video/mp4" : "image/jpeg";
}

function getTelegramMediaExtension(contentType, fileName) {
  const fileExtension = String(fileName ?? "").match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  const allowed = new Set(["jpg", "jpeg", "png", "webp", "gif", "mp4", "webm"]);
  if (fileExtension && allowed.has(fileExtension)) return fileExtension === "jpeg" ? "jpg" : fileExtension;
  return ({
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/webm": "webm",
    "video/mp4": "mp4",
  })[contentType] ?? "bin";
}

function sanitizeSocialSourceError(error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [
    process.env.TELEGRAM_API_HASH,
    process.env.TELEGRAM_SESSION,
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.TELEGRAM_SUPPORT_BOT_TOKEN,
    process.env.OPENROUTER_API_KEY,
    process.env.X_BEARER_TOKEN,
    process.env.REDDIT_CLIENT_SECRET,
  ]) {
    if (secret) message = message.replaceAll(secret, "[redacted]");
  }
  return message.slice(0, 2_000);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await mapper(item);
    }
  });
  await Promise.all(workers);
}

function getBoundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function getPositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

async function fetchXApiSource(source) {
  const bearerToken = process.env.X_BEARER_TOKEN;
  if (!bearerToken) throw new Error("X_BEARER_TOKEN is missing");
  const budget = await ensureXApiBudgetAvailable();
  const handle = source.external_key || getXHandle(source.url);
  if (!handle) throw new Error(`Cannot parse X handle from ${source.url}`);
  let userId = source.metadata?.xUserId;

  if (!userId) {
    const userResponse = await fetch(`https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}`, {
      headers: { authorization: `Bearer ${bearerToken}`, "user-agent": getSocialUserAgent() },
    });
    await assertSocialApiResponse(userResponse, "X user lookup");
    const payload = await userResponse.json();
    userId = payload?.data?.id;
  }
  if (!userId) throw new Error(`X user ${handle} was not found`);

  const params = new URLSearchParams({
    max_results: String(Math.max(5, Math.min(100, Number(process.env.SOCIAL_MAX_POSTS_PER_SOURCE ?? 30)))),
    "tweet.fields": "created_at,lang,public_metrics,attachments,referenced_tweets",
    expansions: "attachments.media_keys",
    "media.fields": "media_key,type,url,preview_image_url,width,height",
  });
  if (source.last_seen_external_id) params.set("since_id", source.last_seen_external_id);
  const excludes = [];
  if (!source.include_reposts) excludes.push("retweets");
  if (!source.include_replies) excludes.push("replies");
  if (excludes.length) params.set("exclude", excludes.join(","));

  const response = await fetch(`https://api.x.com/2/users/${userId}/tweets?${params}`, {
    headers: { authorization: `Bearer ${bearerToken}`, "user-agent": getSocialUserAgent() },
  });
  await assertSocialApiResponse(response, "X timeline");
  const payload = await response.json();
  await recordXApiPostReads(source, payload, budget.unitCostUsd);
  const posts = mapXApiResponse(source, payload);
  return {
    posts,
    lastSeenExternalId: posts[0]?.externalId ?? source.last_seen_external_id,
    metadata: { xUserId: userId, resultCount: payload?.meta?.result_count ?? posts.length },
  };
}

async function ensureXApiBudgetAvailable() {
  try {
    const { data, error } = await supabase.rpc("get_x_api_budget_guard");
    if (error) {
      logWorkerWarning("x_api.budget_guard.unavailable", {
        reason: getSafeErrorMessage(error),
      });
      return { unitCostUsd: 0.005 };
    }
    const budget = data?.[0];
    if (budget?.allowed === false) {
      throw new Error("Лимит X API исчерпан. Новые загрузки поставлены на паузу.");
    }
    return { unitCostUsd: Number(budget?.unit_cost_usd ?? 0.005) };
  } catch (error) {
    if (error instanceof Error && error.message.includes("Лимит X API")) throw error;
    logWorkerWarning("x_api.budget_guard.unavailable", {
      reason: getSafeErrorMessage(error),
    });
    return { unitCostUsd: 0.005 };
  }
}

async function recordXApiPostReads(source, payload, unitCostUsd) {
  const resourceIds = [...new Set(
    (Array.isArray(payload?.data) ? payload.data : [])
      .map((post) => normalizeString(post?.id))
      .filter(Boolean),
  )];
  if (!resourceIds.length) return;
  const billingDate = new Date().toISOString().slice(0, 10);
  const safeUnitCost = Number.isFinite(unitCostUsd) && unitCostUsd > 0
    ? unitCostUsd
    : 0.005;

  try {
    const { error } = await supabase.from("external_api_usage_events").upsert(
      resourceIds.map((resourceId) => ({
        provider: "x",
        resource_type: "post_read",
        resource_id: resourceId,
        billing_date: billingDate,
        source_id: source.id,
        unit_cost_usd: safeUnitCost,
        estimated_cost_usd: safeUnitCost,
      })),
      {
        ignoreDuplicates: true,
        onConflict: "provider,resource_type,resource_id,billing_date",
      },
    );
    if (error) throw error;
  } catch (error) {
    logWorkerWarning("x_api.usage_log.failed", {
      reason: getSafeErrorMessage(error),
      sourceId: source.id,
    });
  }
}

let redditAccessToken = null;
let redditTokenExpiresAt = 0;

async function fetchRedditApiSource(source) {
  const accessToken = await getRedditAccessToken();
  const subreddit = source.external_key || source.url.match(/\/r\/([^/?#]+)/i)?.[1];
  if (!subreddit) throw new Error(`Cannot parse subreddit from ${source.url}`);
  const listing = source.feed_kind === "hot" ? "hot" : "new";
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(100, Number(process.env.SOCIAL_MAX_POSTS_PER_SOURCE ?? 30)))),
    raw_json: "1",
  });
  const response = await fetch(`https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/${listing}?${params}`, {
    headers: { authorization: `Bearer ${accessToken}`, "user-agent": getSocialUserAgent() },
  });
  await assertSocialApiResponse(response, "Reddit listing");
  const payload = await response.json();
  return {
    posts: mapRedditApiResponse(source, payload),
    cursor: null,
    metadata: { resultCount: payload?.data?.dist ?? 0 },
  };
}

async function getRedditAccessToken() {
  if (redditAccessToken && Date.now() < redditTokenExpiresAt) return redditAccessToken;
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Reddit OAuth credentials are missing");
  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": getSocialUserAgent(),
    },
    body: "grant_type=client_credentials",
  });
  await assertSocialApiResponse(response, "Reddit OAuth");
  const payload = await response.json();
  redditAccessToken = payload.access_token;
  redditTokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in ?? 3600) - 60) * 1_000;
  return redditAccessToken;
}

async function fetchSocialRssSource(source) {
  const feedUrl = getSocialFeedUrl(source);
  const response = await fetch(feedUrl, { headers: { accept: "application/rss+xml, application/atom+xml, text/xml;q=0.9, */*;q=0.8", "user-agent": getSocialUserAgent() } });
  const xml = await response.text();
  logSocialFeedDiagnostics({ contentType: response.headers.get("content-type"), feedUrl, source, status: `${response.status} ${response.statusText}`.trim(), xml });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const posts = parseFeedItems(xml)
    .slice(0, Number(process.env.SOCIAL_MAX_POSTS_PER_SOURCE ?? 30))
    .map((item, index) => mapSocialFeedItem(source, item, index))
    .filter(Boolean)
    .map((post) => ({
      platform: post.platform,
      sourceId: post.source_id,
      externalId: post.external_id,
      author: post.author,
      title: post.title,
      body: post.body,
      originalUrl: post.original_url,
      publishedAt: post.published_at,
      reactionCount: post.reaction_count,
      sourceMetrics: {},
      rawPayload: post.raw_payload,
      media: post.image_url ? [{ mediaType: "image", url: post.image_url, previewUrl: post.image_url, sortOrder: 0 }] : [],
      isRepost: false,
      isReply: false,
    }));
  return { posts, lastSeenExternalId: posts[0]?.externalId ?? null };
}

function isSocialSourceDue(source) {
  const now = Date.now();
  return (!source.next_fetch_at || new Date(source.next_fetch_at).getTime() <= now)
    && (!source.rate_limited_until || new Date(source.rate_limited_until).getTime() <= now);
}

function getNextSocialFetchAt(minutes) {
  return new Date(Date.now() + Math.max(5, Number(minutes) || 15) * 60_000).toISOString();
}

function getSocialUserAgent() {
  return process.env.REDDIT_USER_AGENT || "RaceSide/1.0 (+https://raceside.online)";
}

async function assertSocialApiResponse(response, label) {
  if (response.ok) return;
  const isXBillingError = response.status === 402 && label.startsWith("X ");
  const error = new Error(
    isXBillingError
      ? "X API: для чтения публикаций нужны активные credits в Developer Console"
      : `${label}: HTTP ${response.status}`,
  );
  if (isXBillingError) {
    error.rateLimitedUntil = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  }
  if (response.status === 429) {
    const reset = Number(response.headers.get("x-rate-limit-reset"));
    error.rateLimitedUntil = Number.isFinite(reset)
      ? new Date(reset * 1_000).toISOString()
      : new Date(Date.now() + 15 * 60_000).toISOString();
  }
  throw error;
}

function getOfficialXHandles() {
  return new Set((process.env.SOCIAL_X_OFFICIAL_HANDLES || "f1,fia,scuderiaferrari,mercedesamgf1,redbullracing,mclarenf1")
    .split(",").map((value) => value.trim().replace(/^@/, "").toLowerCase()).filter(Boolean));
}

function getRedditSubredditsFromEnv() {
  return (process.env.SOCIAL_REDDIT_SUBREDDITS || "formula1")
    .split(",").map((value) => value.trim().replace(/^r\//, "")).filter(Boolean);
}

function getSocialFeedUrl(source) {
  if (source.adapter === "reddit-rss") {
    return source.url;
  }

  throw new Error(`Unsupported social adapter: ${source.adapter}`);
}

function logSocialFeedDiagnostics({ contentType, feedUrl, source, status, xml }) {
  const items = getFeedItemBlocks(xml);

  console.log(
    JSON.stringify({
      event: "social.feed.fetch",
      source: source.name,
      platform: source.platform,
      url: sanitizeDiagnosticText(feedUrl),
      status,
      contentType,
      itemCount: items.length,
      items: items.map((item, index) => ({
        index,
        guid: sanitizeDiagnosticText(cleanXml(readTag(item, "guid") || readTag(item, "id"))),
        link: sanitizeDiagnosticText(cleanXml(readLinkHref(item) || readTag(item, "link"))),
        hasExtendedMediaUrl: extractFeedImage(item) !== null,
        imageUrl: sanitizeDiagnosticText(extractFeedImage(item)),
      })),
      rawRssPreview: sanitizeDiagnosticText(xml).slice(0, 1000),
    }),
  );
}

function getFeedItemBlocks(xml) {
  const rssItems = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);

  if (rssItems.length) {
    return rssItems;
  }

  return [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
}

function getXAccountsFromEnv() {
  const accounts = process.env.SOCIAL_X_ACCOUNTS?.trim() || "https://x.com/F1TelemetryData";

  return accounts
    .split(",")
    .map((account) => account.trim())
    .filter(Boolean);
}

function getXHandle(value) {
  const normalized = String(value ?? "").trim();

  if (!normalized) {
    return null;
  }

  const withoutAt = normalized.replace(/^@/, "");
  const match =
    withoutAt.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)/i)?.[1] ??
    withoutAt.match(/^([A-Za-z0-9_]{1,30})$/)?.[1];

  return match && !["i", "intent", "share", "home", "search"].includes(match.toLowerCase())
    ? match
    : null;
}

function mapSocialFeedItem(source, item, index) {
  const originalUrl = normalizeSocialUrl(item.link || item.guid || item.id);

  if (!originalUrl) {
    return null;
  }

  const externalId =
    source.platform === "x"
      ? getXPostId(originalUrl) ?? originalUrl
      : getRedditPostId(originalUrl, item.guid || item.id) ?? originalUrl;
  const title = normalizeString(item.title) ?? normalizeString(item.description) ?? "Пост без заголовка";
  const body = normalizeString(item.content) ?? normalizeString(item.description);
  const reactionCount = numberOrNull(item.reactionCount);
  const popularityScore =
    reactionCount ??
    (source.platform === "reddit" && source.feed_kind === "hot" ? 1000 - index : 0);

  return {
    platform: source.platform,
    source_id: source.id,
    external_id: externalId,
    author: normalizeSocialAuthor(item.author, source),
    title,
    body: body && body !== title ? body : null,
    original_url: originalUrl,
    image_url: item.imageUrl ?? null,
    published_at: item.pubDate ?? new Date().toISOString(),
    reaction_count: reactionCount,
    popularity_score: popularityScore,
    raw_payload: item,
    last_synced_at: new Date().toISOString(),
  };
}

function normalizeSocialUrl(value) {
  const raw = normalizeString(value);

  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw);

    url.hash = "";
    return url.toString();
  } catch {
    return raw.startsWith("http") ? raw : null;
  }
}

function getXPostId(url) {
  return String(url).match(/\/status\/(\d+)/i)?.[1] ?? null;
}

function getRedditPostId(url, fallback) {
  return (
    String(url).match(/\/comments\/([a-z0-9]+)/i)?.[1] ??
    String(fallback ?? "").match(/t3_([a-z0-9]+)/i)?.[1] ??
    null
  );
}

function normalizeSocialAuthor(author, source) {
  const value = normalizeString(author);

  if (value) {
    return value.replace(/^\/?u\//i, "u/");
  }

  if (source.platform === "x") {
    const handle = getXHandle(source.url);
    return handle ? `@${handle}` : "X";
  }

  return "r/formuladank";
}

async function saveNormalizedSocialPost(post) {
  if (!post?.externalId || !post?.originalUrl || !post?.platform) return "unchanged";
  const contentHash = createSocialContentHash(post);
  const popularityScore = calculateSocialPopularity(post);
  const payload = {
    platform: post.platform,
    source_id: post.sourceId,
    external_id: post.externalId,
    author: normalizeString(post.author),
    title: normalizeString(post.title),
    body: normalizeString(post.body),
    original_url: post.originalUrl,
    image_url: post.media?.find((item) => item.mediaType === "image")?.url ?? null,
    published_at: post.publishedAt ?? new Date().toISOString(),
    edited_at: post.editedAt ?? null,
    reaction_count: numberOrNull(post.reactionCount),
    comments_count: numberOrNull(post.commentsCount),
    repost_count: numberOrNull(post.repostCount),
    view_count: numberOrNull(post.viewCount),
    popularity_score: popularityScore,
    source_metrics: post.sourceMetrics ?? {},
    content_hash: contentHash,
    raw_payload: post.rawPayload ?? {},
    last_synced_at: new Date().toISOString(),
  };
  let { data: existing } = await supabase
    .from("social_posts")
    .select("id, content_hash, status")
    .eq("platform", post.platform)
    .eq("external_id", post.externalId)
    .maybeSingle();
  if (!existing) {
    const { data: byUrl } = await supabase.from("social_posts").select("id, content_hash, status").eq("original_url", post.originalUrl).maybeSingle();
    existing = byUrl;
  }
  const writeDecision = getSocialPostWriteDecision(existing, contentHash);
  let postId = existing?.id;

  if (existing) {
    if (writeDecision === "unchanged") {
      return writeDecision;
    }

    const { error } = await supabase.from("social_posts").update({
      ...payload,
      status: "pending",
      ai_title_ru: null,
      ai_summary_ru: null,
      ai_processed_at: null,
      next_retry_at: new Date().toISOString(),
      last_processing_error: null,
    }).eq("id", existing.id);
    if (error) throw error;
  } else {
    let duplicateOf = null;
    if (contentHash) {
      const { data: duplicate } = await supabase
        .from("social_posts")
        .select("id")
        .eq("content_hash", contentHash)
        .is("duplicate_of", null)
        .limit(1)
        .maybeSingle();
      duplicateOf = duplicate?.id ?? null;
    }
    const { data: inserted, error } = await supabase.from("social_posts").insert({
      ...payload,
      status: duplicateOf ? "rejected" : "pending",
      duplicate_of: duplicateOf,
      next_retry_at: duplicateOf ? null : new Date().toISOString(),
    }).select("id").single();
    if (error) throw error;
    postId = inserted.id;
  }

  if (postId && post.media?.length) {
    const mediaRows = post.media.filter((item) => item.url).map((item, index) => ({
      post_id: postId,
      media_type: item.mediaType,
      url: item.url,
      preview_url: item.previewUrl ?? null,
      width: numberOrNull(item.width),
      height: numberOrNull(item.height),
      sort_order: item.sortOrder ?? index,
      provider_media_id: item.providerMediaId ?? null,
    }));
    if (mediaRows.length) {
      const { error } = await supabase.from("social_post_media").upsert(mediaRows, { onConflict: "post_id,url" });
      if (error) throw error;
    }
  }
  return writeDecision;
}

function calculateSocialPopularity(post) {
  const reactions = numberOrNull(post.reactionCount) ?? 0;
  const comments = numberOrNull(post.commentsCount) ?? 0;
  const reposts = numberOrNull(post.repostCount) ?? 0;
  const views = numberOrNull(post.viewCount) ?? 0;
  return reactions + comments * 2 + reposts * 3 + Math.log10(views + 1) * 5;
}

async function processSocialWithAi() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing for social AI processing");
  const limit = Math.max(1, Math.min(100, Number(getCliOption("limit") || process.env.SOCIAL_AI_MAX_POSTS_PER_RUN || 30)));
  const postId = normalizeString(getCliOption("id"));
  const nowIso = new Date().toISOString();
  let postsQuery = supabase
    .from("social_posts")
    .select("id, platform, author, title, body, original_url, published_at, processing_attempts, social_sources(name, external_key, trust_level, publication_mode)")
    .eq("status", "pending")
    .is("duplicate_of", null)
    .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
    .lt("processing_attempts", 8)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (postId) {
    postsQuery = postsQuery.eq("id", postId);
  }
  const { data: posts, error } = await postsQuery;
  if (error) throw error;
  if (!posts?.length) return { itemsProcessed: 0, metadata: { queued: 0 } };

  const context = await getSocialEntityContext();
  let itemsProcessed = 0;
  let published = 0;
  let review = 0;
  let rejected = 0;
  const failures = [];

  for (const post of posts) {
    const attempts = Number(post.processing_attempts ?? 0) + 1;
    try {
      await supabase.from("social_posts").update({ status: "processing", processing_attempts: attempts }).eq("id", post.id);
      const ai = await requestSocialAi({ post, context, apiKey });
      const result = ai.result;
      const source = firstRelation(post.social_sources) ?? {};
      const status = decideSocialPublicationStatus(result, source, {
        requireFormulaScope: post.platform === "telegram",
      });
      const taggedResult = applySocialSourceCategoryRules(result, source);
      const editorialFields = getSocialAiEditorialFields(post.platform, result);
      const { error: updateError } = await supabase.from("social_posts").update({
        status,
        original_language: result.originalLanguage,
        ...editorialFields,
        content_kind: result.contentKind,
        importance_score: result.importance,
        relevance_score: result.relevance,
        ai_confidence: result.confidence,
        ai_model: ai.model,
        ai_processed_at: nowIso,
        next_retry_at: null,
        last_processing_error: null,
      }).eq("id", post.id);
      if (updateError) throw updateError;
      await replaceSocialPostTags(post.id, taggedResult, context);
      itemsProcessed += 1;
      if (status === "published") published += 1;
      else if (status === "review") review += 1;
      else rejected += 1;
    } catch (postError) {
      const message = postError instanceof Error ? postError.message : String(postError);
      failures.push({ postId: post.id, error: message });
      await supabase.from("social_posts").update({
        status: "pending",
        processing_attempts: attempts,
        next_retry_at: new Date(Date.now() + getSocialRetryDelayMs(attempts)).toISOString(),
        last_processing_error: message.slice(0, 2_000),
      }).eq("id", post.id);
    }
  }

  return { itemsProcessed, metadata: { queued: posts.length, published, review, rejected, failures } };
}

async function requestSocialAi({ post, context, apiKey }) {
  const isTelegram = post.platform === "telegram";
  const prompt = await resolveWorkerAiPrompt({
    client: supabase,
    promptKey: isTelegram ? "social.telegram_classification" : "social.editorial",
    variables: {
      categories: SOCIAL_TOPIC_DEFINITIONS
        .map((item) => `${item.slug} (${item.name})`)
        .join(", "),
      teams: context.teams.map((item) => item.name).join(", "),
      drivers: context.drivers.map((item) => item.name).join(", "),
      races: context.races.map((item) => item.name).join(", "),
      source: firstRelation(post.social_sources)?.name || post.platform,
      author: post.author || "не указан",
      title: post.title || "",
      body: post.body || post.title || "",
    },
  });
  const { payload, response } = await requestOpenRouterCompletion({
    apiKey,
    model: prompt.model,
    purpose: post.platform === "x"
      ? "social.x"
      : post.platform === "reddit"
        ? "social.reddit"
        : "social.telegram",
    promptKey: prompt.key,
    promptVersionId: prompt.promptVersionId,
    body: {
      messages: [
        { role: "system", content: prompt.systemPrompt },
        { role: "user", content: prompt.userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_completion_tokens: prompt.maxTokens,
    },
  });
  if (!response.ok) throw new Error(`OpenRouter social AI: HTTP ${response.status}`);
  const content = payload?.choices?.[0]?.message?.content;
  const result = parseSocialAiPayload(content, {
    requireEditorialText: !isTelegram,
    requireFormulaScope: isTelegram,
  });
  return { result, model: prompt.model };
}

function applySocialSourceCategoryRules(result, source) {
  const sourceKey = String(source.external_key || source.name || "")
    .replace(/^@/, "")
    .trim()
    .toLowerCase();

  if (sourceKey === "f1telemetrydata" || sourceKey.includes("@f1telemetrydata")) {
    return { ...result, categories: ["social-telemetry"] };
  }

  return result;
}

function decideSocialPublicationStatus(result, source, { requireFormulaScope = false } = {}) {
  if (requireFormulaScope && !isSocialFormulaScopeAllowed(result)) return "rejected";
  if (!result.shouldPublish || result.relevance < 0.6 || result.confidence < 0.6) return "rejected";
  if (source.publication_mode === "review") return "review";
  if (result.contentKind === "rumor" && source.trust_level !== "official") return "review";
  if (result.confidence < 0.78) return "review";
  return "published";
}

async function getSocialEntityContext() {
  if (socialEntityContextCache) return socialEntityContextCache;
  const [driverChoices, teamChoices, { data: latestRace }] = await Promise.all([
    getDriverTagChoices(),
    getTeamTagChoices(),
    supabase.from("races").select("season_year").order("season_year", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const { data: races } = latestRace?.season_year
    ? await supabase.from("races").select("id, season_year, round, race_name").eq("season_year", latestRace.season_year).order("round").limit(30)
    : { data: [] };
  socialEntityContextCache = {
    drivers: driverChoices.map((item) => ({
      id: item.id,
      name: item.fullName,
      aliases: [item.fullName, item.firstName, item.lastName, item.code, item.slug].filter(Boolean),
      slug: item.slug,
      type: "driver",
    })),
    teams: teamChoices.map((item) => ({
      id: item.id,
      name: item.name,
      aliases: [item.name, item.fullName, item.code, item.slug].filter(Boolean),
      slug: item.slug,
      type: "team",
    })),
    races: (races ?? []).map((item) => ({ id: item.id, name: item.race_name, aliases: [item.race_name], slug: `race-${item.season_year}-${String(item.round).padStart(2, "0")}`, type: "race" })),
  };
  return socialEntityContextCache;
}

async function replaceSocialPostTags(postId, result, context) {
  const candidates = [
    ...result.categories.map((slug) => ({ slug, name: SOCIAL_TOPIC_DEFINITIONS.find((item) => item.slug === slug)?.name || slug, type: "social_topic" })),
    ...matchSocialEntities(result.entities.drivers, context.drivers),
    ...matchSocialEntities(result.entities.teams, context.teams),
    ...matchSocialEntities(result.entities.races, context.races),
  ];
  await supabase.from("social_post_tags").delete().eq("post_id", postId);
  for (const [index, candidate] of candidates.entries()) {
    const { data: tag, error } = await supabase.from("tags").upsert({ type: candidate.type, slug: candidate.slug, name: candidate.name }, { onConflict: "slug" }).select("id").single();
    if (error || !tag?.id) continue;
    await supabase.from("social_post_tags").upsert({ post_id: postId, tag_id: tag.id, confidence: result.confidence, method: "ai", is_primary: index === 0 }, { onConflict: "post_id,tag_id" });
  }
}

function matchSocialEntities(values, candidates) {
  const matches = [];
  for (const value of values ?? []) {
    const normalized = normalizeSocialEntity(value);
    const match = candidates.find((candidate) => candidate.aliases.some((alias) => normalizeSocialEntity(alias) === normalized));
    if (match && !matches.some((item) => item.slug === match.slug)) matches.push(match);
  }
  return matches;
}

function normalizeSocialEntity(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^a-zа-яё0-9]/gi, "");
}

async function refreshSocialMetrics() {
  return fetchSocialSources({ ignoreSchedule: true });
}

async function retryFailedSocialPosts() {
  const limit = Number(getCliOption("limit") ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("INVALID_SOCIAL_RETRY_LIMIT");
  const { data, error } = await supabase.rpc("admin_retry_failed_social_posts", { p_limit: limit });
  if (error) throw error;
  return { itemsProcessed: data ?? 0, metadata: { retried: data ?? 0, limit } };
}

async function checkLatestGrandPrixReport() {
  const race = await findLatestCompletedRaceForReport();

  if (!race) {
    return { itemsProcessed: 0, metadata: { reason: "no_completed_race_with_results" } };
  }

  return generateGrandPrixReportForRace(race);
}

async function generateGrandPrixReport() {
  const season = numberOrNull(getCliOption("season"));
  const round = numberOrNull(getCliOption("round"));
  const race =
    season && round
      ? await getRaceForReport(season, round)
      : await findLatestCompletedRaceForReport();

  if (!race) {
    return { itemsProcessed: 0, metadata: { reason: "race_not_found_or_not_ready", season, round } };
  }

  return generateGrandPrixReportForRace(race, { force: true });
}

async function generateGrandPrixReportSummary() {
  const season = numberOrNull(getCliOption("season"));
  const round = numberOrNull(getCliOption("round"));
  const force = process.argv.includes("--force") || Boolean(season && round);
  let query = supabase
    .from("grand_prix_reports")
    .select("*")
    .in("status", ["ready", "partial", "summary_pending"]);

  if (season && round) {
    query = query.eq("season", season).eq("round", round);
  } else {
    query = query
      .in("summary_status", ["pending", "failed"])
      .order("race_date", { ascending: false, nullsFirst: false })
      .limit(1);
  }

  const { data, error } = await query.maybeSingle();

  if (error || !data) {
    return { itemsProcessed: 0, metadata: { reason: error?.message ?? "report_not_found" } };
  }

  const updated = await updateGrandPrixReportSummary(data, { force });

  return { itemsProcessed: updated ? 1 : 0, metadata: { raceSlug: data.race_slug } };
}

async function generateAllCompletedGrandPrixReports() {
  const season = numberOrNull(getCliOption("season")) ?? Number(process.env.F1_SEASON ?? new Date().getUTCFullYear());
  const force = process.argv.includes("--force");
  const races = await findCompletedRacesReadyForReports(season, { requireDelay: false });
  let itemsProcessed = 0;

  for (const race of races) {
    const result = await generateGrandPrixReportForRace(race, { force });
    itemsProcessed += result.itemsProcessed ?? 0;
  }

  return {
    itemsProcessed,
    metadata: {
      season,
      force,
      rounds: races.map((race) => race.round),
    },
  };
}

async function refreshDueGrandPrixReports() {
  const { data, error } = await supabase
    .from("grand_prix_reports")
    .select("season, round")
    .in("status", ["ready", "partial", "summary_pending"])
    .not("next_refresh_at", "is", null)
    .lte("next_refresh_at", new Date().toISOString())
    .order("next_refresh_at", { ascending: true })
    .limit(Number(process.env.REPORTS_REFRESH_LIMIT ?? 3));

  if (error) {
    throw error;
  }

  let itemsProcessed = 0;

  for (const report of data ?? []) {
    const race = await getRaceForReport(Number(report.season), Number(report.round));

    if (!race) {
      continue;
    }

    await generateGrandPrixReportForRace(race, { force: true });
    itemsProcessed += 1;
  }

  return { itemsProcessed };
}

async function generateGrandPrixReportForRace(race, { force = false } = {}) {
  const existing = await getExistingGrandPrixReport(race.season_year, race.round);

  if (!force && !shouldGenerateGrandPrixReport(existing)) {
    return {
      itemsProcessed: 0,
      metadata: { race: race.race_name, reason: "report_already_current", skipped: true },
    };
  }

  const raceSession = await getRaceSessionForReport(race.id);
  const resultRows = raceSession ? await getRaceResultRows(raceSession.id) : [];

  if (!raceSession || !hasFinalRaceResults(resultRows)) {
    return {
      itemsProcessed: 0,
      metadata: { race: race.race_name, ready: false, reason: "race_results_not_ready" },
    };
  }

  await upsertReportStatus(race, "collecting");
  await upsertReportStatus(race, "processing");

  const sourceErrors = {};
  const openF1 = await collectOpenF1ReportData(raceSession.openf1_session_key, sourceErrors);
  let officialFastestPitStop = null;

  try {
    const officialPitStops = await loadFormula1FastestPitStops(race.season_year);
    officialFastestPitStop = findFormula1FastestPitStop(officialPitStops, race.race_name);

    if (!officialFastestPitStop) {
      sourceErrors.formula1_fastest_pit_stop = `Formula 1 не опубликовала быстрый пит-стоп для ${race.race_name}.`;
    }
  } catch (error) {
    sourceErrors.formula1_fastest_pit_stop = getSafeErrorMessage(error);
  }

  const fastF1Result = collectFastF1ReportData(race.season_year, race.round);
  let fastF1 = fastF1Result.data;

  if (!hasLapMetrics(fastF1)) {
    const openF1LapMetrics = buildOpenF1LapMetrics(openF1.laps ?? []);

    if (hasLapMetrics(openF1LapMetrics)) {
      fastF1 = openF1LapMetrics;
    } else if (fastF1Result.error) {
      sourceErrors.fastf1 = fastF1Result.error;
    }
  }

  const newsSummary = await getRaceNewsSummaryForReport(race.id);
  const structured = buildGrandPrixReportStructuredData(
    race,
    raceSession,
    resultRows,
    openF1,
    fastF1,
    sourceErrors,
    newsSummary,
    officialFastestPitStop,
  );
  const structuredHash = hashJson({
    race_statistics: structured.race_statistics,
    results: structured.results,
    key_events: structured.key_events,
    pit_stops: structured.pit_stops,
    strategies: structured.strategies,
    teammate_comparisons: structured.teammate_comparisons,
    highlights: structured.highlights,
    news_summary: structured.news_summary,
    championship_impact: structured.championship_impact,
  });
  const hasStableSummary =
    Boolean(existing?.ai_summary) && ["generated", "edited"].includes(existing?.summary_status);
  const summaryStatus = hasStableSummary
    ? existing.summary_status
    : existing?.structured_hash && existing.structured_hash !== structuredHash
      ? "pending"
      : existing?.summary_status ?? "pending";
  const status = Object.keys(sourceErrors).length ? "partial" : "summary_pending";
  const nextRefresh = getNextReportRefreshAt(existing?.refresh_stage ?? -1, {
    incomplete: Object.keys(sourceErrors).length > 0,
  });

  const { data: report, error } = await supabase
    .from("grand_prix_reports")
    .upsert(
      {
        season: race.season_year,
        round: race.round,
        race_slug: makeRaceReportSlug(race.season_year, race.race_name),
        race_name: race.race_name,
        circuit_name: getRelationObject(race.circuits)?.name ?? null,
        country: getRelationObject(race.circuits)?.country ?? null,
        race_date: race.race_start_at,
        status,
        source_updated_at: new Date().toISOString(),
        generated_at: new Date().toISOString(),
        summary_status: summaryStatus,
        weather: structured.weather,
        race_statistics: structured.race_statistics,
        results: structured.results,
        key_events: structured.key_events,
        pit_stops: structured.pit_stops,
        strategies: structured.strategies,
        teammate_comparisons: structured.teammate_comparisons,
        highlights: structured.highlights,
        news_summary: structured.news_summary,
        championship_impact: structured.championship_impact,
        source_errors: sourceErrors,
        last_error: null,
        refresh_stage: nextRefresh.stage,
        next_refresh_at: nextRefresh.nextRefreshAt,
        structured_hash: structuredHash,
      },
      { onConflict: "season,round" },
    )
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  const summaryUpdated = await updateGrandPrixReportSummary(report);

  return {
    itemsProcessed: 1,
    metadata: {
      raceSlug: report.race_slug,
      status: report.status,
      summaryUpdated,
      sourceErrors,
    },
  };
}

function shouldGenerateGrandPrixReport(report) {
  if (!report) {
    return true;
  }

  return (
    ["pending", "collecting", "processing", "summary_pending", "failed"].includes(report.status) ||
    ["pending", "failed"].includes(report.summary_status)
  );
}

async function findLatestCompletedRaceForReport() {
  const races = await findCompletedRacesReadyForReports(undefined, { requireDelay: false, limit: 80 });

  return races[0] ?? null;
}

async function findCompletedRacesReadyForReports(season, { requireDelay = true, limit = 80 } = {}) {
  const { data, error } = await supabase
    .from("races")
    .select("id, season_year, round, race_name, race_start_at, status, circuits(name, country)")
    .order("race_start_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  const now = Date.now();
  const ready = [];

  for (const race of data ?? []) {
    if (season && Number(race.season_year) !== season) {
      continue;
    }

    const raceTime = race.race_start_at ? new Date(race.race_start_at).getTime() : 0;

    if (requireDelay && (!raceTime || now - raceTime < 27 * 60 * 60 * 1000)) {
      continue;
    }

    const session = await getRaceSessionForReport(race.id);
    const results = session ? await getRaceResultRows(session.id) : [];

    if (session && hasFinalRaceResults(results)) {
      ready.push(race);
    }
  }

  return ready.sort(
    (a, b) =>
      new Date(b.race_start_at ?? 0).getTime() -
      new Date(a.race_start_at ?? 0).getTime(),
  );
}

async function getRaceForReport(season, round) {
  const { data, error } = await supabase
    .from("races")
    .select("id, season_year, round, race_name, race_start_at, status, circuits(name, country)")
    .eq("season_year", season)
    .eq("round", round)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

async function getRaceSessionForReport(raceId) {
  const { data, error } = await supabase
    .from("sessions")
    .select("id, openf1_session_key, start_at")
    .eq("race_id", raceId)
    .eq("session_type", "race")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

async function getRaceResultRows(sessionId) {
  const { data, error } = await supabase
    .from("session_results")
    .select("position, grid, laps, points, status, time_text, raw_payload, drivers(full_name, permanent_number), teams(name)")
    .eq("session_id", sessionId)
    .order("position", { ascending: true, nullsFirst: false });

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function getRaceNewsSummaryForReport(raceId) {
  if (!raceId) {
    return { articles: [] };
  }

  const { data } = await supabase
    .from("news_articles")
    .select("ai_title_ru, original_title, ai_summary_ru, ai_summary_long_ru, published_at")
    .eq("status", "processed")
    .eq("publication_status", "published")
    .eq("related_race_id", raceId)
    .is("duplicate_of", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(Number(process.env.REPORT_NEWS_LIMIT ?? 8));

  return {
    articles: (data ?? []).map((article) => ({
      title: article.ai_title_ru ?? article.original_title,
      summary: article.ai_summary_ru ?? article.ai_summary_long_ru ?? null,
      publishedAt: article.published_at ?? null,
    })),
  };
}

function hasFinalRaceResults(results) {
  return (
    (results ?? []).length >= 10 &&
    results.some((result) => Number(result.position) === 1) &&
    results.some((result) => Number(result.points) > 0)
  );
}

async function collectOpenF1ReportData(sessionKey, sourceErrors) {
  if (!sessionKey) {
    sourceErrors.openf1 = "У гонки нет openf1_session_key.";
    return {};
  }

  const baseUrl = process.env.OPENF1_BASE_URL ?? "https://api.openf1.org/v1";
  const endpoints = {
    laps: "laps",
    pits: "pit",
    stints: "stints",
    positions: "position",
    raceControl: "race_control",
    weather: "weather",
  };
  const result = {};

  for (const [key, endpoint] of Object.entries(endpoints)) {
    try {
      result[key] = await fetchJson(`${baseUrl}/${endpoint}?session_key=${sessionKey}`);
    } catch (error) {
      sourceErrors[`openf1_${key}`] = error instanceof Error ? error.message : String(error);
      result[key] = [];
    }
  }

  return result;
}

function collectFastF1ReportData(season, round) {
  const python = process.env.FASTF1_PYTHON_BIN ?? "python3";
  const script = "worker/fastf1/report_metrics.py";

  if (!existsSync(script)) {
    return { data: {}, error: "FastF1 script is missing." };
  }

  const result = spawnSync(python, [script, String(season), String(round)], {
    encoding: "utf8",
    timeout: Number(process.env.FASTF1_TIMEOUT_MS ?? 60_000),
  });

  if (result.error || result.status !== 0) {
    return { data: {}, error: result.error?.message ?? result.stderr?.trim() ?? "FastF1 failed." };
  }

  return { data: safeJson(result.stdout) ?? {}, error: null };
}

function hasLapMetrics(value) {
  return Boolean(Object.keys(value?.driversByNumber ?? value?.drivers ?? {}).length);
}

function buildOpenF1LapMetrics(laps) {
  const byNumber = new Map();

  for (const lap of laps ?? []) {
    const driverNumber = numberOrNull(lap.driver_number);
    const lapDuration = numberOrNull(lap.lap_duration);

    if (!driverNumber || lapDuration === null) {
      continue;
    }

    const key = String(driverNumber);
    const driverLaps = byNumber.get(key) ?? [];
    driverLaps.push({
      lapDuration,
      isPitOutLap: Boolean(lap.is_pit_out_lap),
    });
    byNumber.set(key, driverLaps);
  }

  const driversByNumber = {};

  for (const [driverNumber, driverLaps] of byNumber.entries()) {
    const timedLaps = driverLaps.map((lap) => lap.lapDuration).filter(Number.isFinite);
    const cleanLaps = driverLaps
      .filter((lap) => !lap.isPitOutLap)
      .map((lap) => lap.lapDuration)
      .filter(Number.isFinite);
    const sample = cleanLaps.length ? cleanLaps : timedLaps;

    if (!sample.length) {
      continue;
    }

    driversByNumber[driverNumber] = {
      driverNumber: Number(driverNumber),
      bestLapSeconds: roundNumber(Math.min(...sample), 3),
      medianLapSeconds: medianNumber(sample),
      laps: driverLaps.length,
      quickLaps: cleanLaps.length,
    };
  }

  return {
    source: "openf1",
    drivers: driversByNumber,
    driversByNumber,
  };
}

function buildGrandPrixReportStructuredData(
  race,
  raceSession,
  resultRows,
  openF1,
  fastF1,
  sourceErrors,
  newsSummary,
  officialFastestPitStop,
) {
  const raceControl = filterRaceControlForSession(
    openF1.raceControl ?? [],
    raceSession.openf1_session_key,
  );
  const safetyEventCounts = countOpenF1SafetyEvents(raceControl);
  const tyreStintsByDriver = getTyreStintsByDriverNumber(openF1.stints ?? []);
  const results = mapReportResults(
    resultRows,
    openF1.laps ?? [],
    tyreStintsByDriver,
    openF1.positions ?? [],
  );
  const pitStops = mapReportPitStops(openF1.pits ?? [], results);
  const strategies = mapReportStrategies(openF1.stints ?? [], pitStops, results, fastF1);
  const keyEvents = buildReportKeyEvents(
    results,
    pitStops,
    raceControl,
    openF1.positions ?? [],
    officialFastestPitStop,
  );
  const teammateComparisons = buildTeammateComparisons(results, pitStops);
  const highlights = buildReportHighlights(
    results,
    pitStops,
    keyEvents,
    strategies,
    safetyEventCounts,
    officialFastestPitStop,
  );
  const weather = summarizeReportWeather(openF1.weather ?? []);
  const raceStatistics = buildRaceStatistics(results, safetyEventCounts, weather);

  return {
    weather,
    race_statistics: {
      ...raceStatistics,
      laps: Math.max(...results.map((result) => result.laps ?? 0), 0),
      finishers: results.filter((result) => isFinisherStatus(result.status)).length,
      retirements: results.filter((result) => !isFinisherStatus(result.status)).length,
      fastf1Available: Boolean(Object.keys(fastF1 ?? {}).length),
    },
    results,
    key_events: limitReportKeyEvents(keyEvents),
    pit_stops: pitStops,
    strategies,
    teammate_comparisons: teammateComparisons,
    highlights,
    news_summary: newsSummary,
    championship_impact: {
      note: "Таблица чемпионата обновляется отдельной синхронизацией standings.",
      topResult: results.slice(0, 3).map((result) => `${result.position}. ${result.driver}`),
    },
    source_errors: sourceErrors,
  };
}

function mapReportResults(rows, openF1Laps, tyreStintsByDriver, openF1Positions) {
  const bestLapByDriverNumber = getBestOpenF1LapByDriverNumber(openF1Laps);
  const startingGridByDriverNumber = buildOpenF1StartingGridByDriverNumber(openF1Positions);
  const results = (rows ?? []).map((row) => {
    const driver = getRelationObject(row.drivers);
    const team = getRelationObject(row.teams);
    const position = numberOrNull(row.position);
    const driverNumber = numberOrNull(row.raw_payload?.Driver?.permanentNumber)
      ?? numberOrNull(driver?.permanent_number);
    const grid = normalizeGridPosition(row.grid)
      ?? normalizeGridPosition(startingGridByDriverNumber.get(driverNumber));
    const bestLap = getJolpicaBestLap(row.raw_payload) ?? bestLapByDriverNumber.get(driverNumber) ?? null;

    return {
      position,
      driverNumber,
      driver: driver?.full_name ?? "Пилот уточняется",
      team: team?.name ?? "Команда уточняется",
      grid,
      positionDelta: grid && position ? grid - position : null,
      points: numberOrNull(row.points),
      status: row.status ?? "Финиш",
      laps: numberOrNull(row.laps),
      time: row.time_text ?? null,
      bestLap,
      tyres: tyreStintsByDriver.get(String(driverNumber ?? "")) ?? [],
    };
  });
  const fastestLap = getFastestLapResult(results);
  const bestGain = getExtremeByDelta(results, "max");
  const biggestDrop = getExtremeByDelta(results, "min");

  return results.map((result) => ({
    ...result,
    isWinner: result.position === 1,
    isPodium: result.position !== null && result.position <= 3,
    isFastestLap: fastestLap?.driver === result.driver,
    isBestGain: bestGain?.driver === result.driver && (bestGain.positionDelta ?? 0) > 0,
    isBiggestDrop: biggestDrop?.driver === result.driver && (biggestDrop.positionDelta ?? 0) < 0,
  }));
}

function getTyreStintsByDriverNumber(stints) {
  const byDriver = new Map();

  for (const stint of stints ?? []) {
    const driverNumber = String(stint.driver_number ?? "");

    if (!driverNumber) {
      continue;
    }

    const items = byDriver.get(driverNumber) ?? [];
    items.push({
      compound: normalizeTyreCompound(stint.compound),
      startLap: numberOrNull(stint.lap_start),
      endLap: numberOrNull(stint.lap_end),
    });
    byDriver.set(driverNumber, items);
  }

  for (const [driverNumber, items] of byDriver.entries()) {
    byDriver.set(
      driverNumber,
      items
        .filter((item) => item.compound)
        .sort((a, b) => Number(a.startLap ?? 999) - Number(b.startLap ?? 999)),
    );
  }

  return byDriver;
}

function normalizeTyreCompound(value) {
  const compound = normalizeString(value)?.toUpperCase() ?? "";

  if (["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"].includes(compound)) {
    return compound;
  }

  return compound || "UNKNOWN";
}

function mapReportPitStops(pits, results) {
  const resultByNumber = new Map();

  for (const result of results) {
    resultByNumber.set(String(result.driverNumber ?? ""), result);
  }

  return (pits ?? [])
    .map((pit) => {
      const driverNumber = String(pit.driver_number ?? "");
      const result = resultByNumber.get(driverNumber);

      return {
        lap: numberOrNull(pit.lap_number),
        driverNumber: numberOrNull(pit.driver_number),
        driver: result?.driver ?? `#${driverNumber}`,
        duration: getReplayPitStopDuration(pit),
        date: pit.date ?? null,
      };
    })
    .filter((pit) => pit.lap !== null);
}

function mapReportStrategies(stints, pitStops, results, fastF1) {
  const stintsByDriver = new Map();

  for (const stint of stints ?? []) {
    const key = String(stint.driver_number ?? "");
    const items = stintsByDriver.get(key) ?? [];
    items.push({
      compound: stint.compound ?? "UNKNOWN",
      startLap: numberOrNull(stint.lap_start),
      endLap: numberOrNull(stint.lap_end),
    });
    stintsByDriver.set(key, items);
  }

  const pitCountByDriver = countBy(pitStops, (pit) => pit.driver);

  return results.slice(0, 20).map((result) => {
    const driverNumber = String(result.driverNumber ?? "");
    const fastF1Metrics =
      fastF1?.driversByNumber?.[driverNumber] ??
      fastF1?.drivers?.[driverNumber] ??
      fastF1?.drivers?.[result.driver] ??
      null;

    return {
      driver: result.driver,
      team: result.team,
      pitStops: pitCountByDriver.get(result.driver) ?? 0,
      compounds: [...new Set([...(stintsByDriver.get(driverNumber) ?? []).map((stint) => stint.compound)])],
      stints: stintsByDriver.get(driverNumber) ?? [],
      fastF1: fastF1Metrics,
    };
  });
}

function buildReportKeyEvents(results, pitStops, raceControl, positions, officialFastestPitStop) {
  const events = [
    {
      lap: 1,
      type: "start",
      title: "Старт гонки",
      detail: results[0] ? `${results[0].driver} финишировал победителем.` : null,
    },
  ];

  for (const result of results.filter((item) => !isFinisherStatus(item.status)).slice(0, 6)) {
    events.push({
      lap: result.laps ?? null,
      type: "retirement",
      title: `${result.driver}: сход или проблема`,
      detail: result.status,
    });
  }

  if (officialFastestPitStop) {
    events.push({
      lap: null,
      type: "pit_stop",
      title: "Самый быстрый пит-стоп",
      detail: `${officialFastestPitStop.team}: ${officialFastestPitStop.duration} с`,
    });
  }

  for (const event of getLeaderPitStopEvents(results, pitStops)) {
    events.push(event);
  }

  for (const control of raceControl ?? []) {
    const text = String(control.message ?? control.flag ?? "").trim();
    const category = String(control.category ?? control.flag ?? "").toLowerCase();

    if (!isImportantRaceControlMessage(text, category)) {
      continue;
    }

    events.push({
      lap: numberOrNull(control.lap_number),
      type: category || "race_control",
      title: getRaceControlEventTitle(text, category),
      detail: text,
    });
  }

  for (const event of getLeadChangeEvents(positions, results)) {
    events.push(event);
  }

  return events
    .filter((event) => event.title)
    .sort((a, b) => (a.lap ?? 999) - (b.lap ?? 999));
}

function limitReportKeyEvents(events, limit = 60) {
  const seen = new Set();

  return (events ?? [])
    .filter((event) => {
      const key = [
        event.type ?? "event",
        event.lap ?? "unknown",
        normalizeString(event.title)?.toLowerCase() ?? "",
        normalizeString(event.detail)?.toLowerCase() ?? "",
      ].join("|");

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.lap ?? 999) - (b.lap ?? 999))
    .slice(0, limit);
}

function getLeaderPitStopEvents(results, pitStops) {
  const leadingDrivers = new Set(
    (results ?? [])
      .filter((result) => result.position && result.position <= 5)
      .map((result) => result.driver),
  );

  return (pitStops ?? [])
    .filter((pit) => leadingDrivers.has(pit.driver))
    .map((pit) => ({
      lap: pit.lap,
      type: "pit_stop",
      title: "Пит-стоп лидеров",
      detail: `${pit.driver}${pit.duration !== null ? `: ${pit.duration} с` : ""}`,
    }));
}

function buildTeammateComparisons(results, pitStops) {
  const byTeam = new Map();
  const pitCountByDriver = countBy(pitStops, (pit) => pit.driver);

  for (const result of results) {
    const items = byTeam.get(result.team) ?? [];
    items.push({
      driver: result.driver,
      grid: result.grid,
      position: result.position,
      points: result.points,
      bestLap: result.bestLap,
      pitStops: pitCountByDriver.get(result.driver) ?? 0,
      status: result.status,
    });
    byTeam.set(result.team, items);
  }

  return [...byTeam.entries()].map(([team, drivers]) => ({
    team,
    drivers: drivers.sort((a, b) => Number(a.position ?? 99) - Number(b.position ?? 99)),
  }));
}

function buildReportHighlights(
  results,
  pitStops,
  keyEvents,
  strategies,
  safetyEventCounts,
  officialFastestPitStop,
) {
  const podium = results.filter((result) => result.position !== null && result.position <= 3);
  const bestGain = getExtremeByDelta(results, "max");
  const biggestDrop = getExtremeByDelta(results, "min");
  const fastestLap = getFastestLapResult(results);
  const fastestOpenF1PitStop = [...pitStops]
    .filter((pit) => pit.duration !== null)
    .sort((a, b) => Number(a.duration) - Number(b.duration))[0];
  const mostCommonStrategy = getMostCommonStrategy(strategies);
  const safetyCarSummary = formatSafetyEventSummary(safetyEventCounts);
  const teamPoints = new Map();

  for (const result of results) {
    teamPoints.set(result.team, (teamPoints.get(result.team) ?? 0) + Number(result.points ?? 0));
  }

  const bestTeam = [...teamPoints.entries()].sort((a, b) => b[1] - a[1])[0];
  const potentialLoss = getPotentialPointsLoss(results);

  return {
    winner: podium[0]?.driver ?? null,
    podium: podium.map((result) => result.driver),
    fastestLap: fastestLap ? { driver: fastestLap.driver, time: fastestLap.bestLap ?? null } : null,
    fastestPitStop: officialFastestPitStop
      ? {
          duration: officialFastestPitStop.duration,
          source: "formula1.com",
          sourceUrl: officialFastestPitStop.sourceUrl,
          team: officialFastestPitStop.team,
        }
      : fastestOpenF1PitStop
        ? {
            driver: fastestOpenF1PitStop.driver,
            duration: fastestOpenF1PitStop.duration,
            lap: fastestOpenF1PitStop.lap,
            source: "openf1",
          }
        : null,
    safetyCarSummary,
    mostCommonStrategy,
    bestGain: bestGain ? { driver: bestGain.driver, delta: bestGain.positionDelta } : null,
    biggestDrop: biggestDrop ? { driver: biggestDrop.driver, delta: biggestDrop.positionDelta } : null,
    bestTeam: bestTeam ? { team: bestTeam[0], points: bestTeam[1] } : null,
    potentialPointsLoss: potentialLoss,
    surpriseResult: bestGain && (bestGain.positionDelta ?? 0) >= 5 ? bestGain.driver : null,
    retirements: results.filter((result) => !isFinisherStatus(result.status)).map((result) => result.driver),
  };
}

function getMostCommonStrategy(strategies) {
  const counts = new Map();

  for (const strategy of strategies ?? []) {
    const compounds = (strategy.stints ?? [])
      .map((stint) => normalizeTyreCompound(stint.compound))
      .filter((compound) => compound && compound !== "UNKNOWN");

    if (!compounds.length) {
      continue;
    }

    const key = compounds.join("-");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const mostCommon = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

  return mostCommon ? { sequence: mostCommon[0], drivers: mostCommon[1] } : null;
}

function summarizeReportWeather(weatherRows) {
  const rows = weatherRows ?? [];

  if (!rows.length) {
    return {};
  }

  const temperatures = rows.map((row) => Number(row.air_temperature)).filter(Number.isFinite);
  const rainfall = rows.some((row) => Number(row.rainfall) > 0);

  return {
    averageAirTemperature:
      temperatures.length ? Number((temperatures.reduce((sum, item) => sum + item, 0) / temperatures.length).toFixed(1)) : null,
    rainfall,
    samples: rows.length,
  };
}

function buildRaceStatistics(results, safetyEventCounts, weather) {
  return {
    yellowFlagCount: Number(safetyEventCounts.yellowFlagCount) || 0,
    safetyCar: Number(safetyEventCounts.safetyCarCount) > 0,
    virtualSafetyCar: Number(safetyEventCounts.vscCount) > 0,
    redFlag: Number(safetyEventCounts.redFlagCount) > 0,
    safetyCarCount: Number(safetyEventCounts.safetyCarCount) || 0,
    virtualSafetyCarCount: Number(safetyEventCounts.vscCount) || 0,
    redFlagCount: Number(safetyEventCounts.redFlagCount) || 0,
    weather,
  };
}

async function updateGrandPrixReportSummary(report, { force = false } = {}) {
  if (!force && report.ai_summary && ["generated", "edited"].includes(report.summary_status)) {
    await supabase
      .from("grand_prix_reports")
      .update({
        status: Object.keys(report.source_errors ?? {}).length ? "partial" : "ready",
        last_error: null,
      })
      .eq("id", report.id);
    return false;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    await supabase
      .from("grand_prix_reports")
      .update({ status: report.status === "summary_pending" ? "partial" : report.status, summary_status: "pending" })
      .eq("id", report.id);
    return false;
  }

  const facts = {
    race: {
      season: report.season,
      round: report.round,
      name: report.race_name,
      circuit: report.circuit_name,
      country: report.country,
    },
    top3: (report.results ?? []).slice(0, 3).map((result) => ({
      position: result.position,
      driver: result.driver,
      team: result.team,
      points: result.points,
      time: result.time,
    })),
    highlights: {
      winner: report.highlights?.winner,
      podium: report.highlights?.podium,
    },
    newsSummary: {
      articles: (report.news_summary?.articles ?? []).slice(0, 1).map((article) => ({
        title: article.title,
        summary: article.summary,
      })),
    },
  };

  try {
    const prompt = await resolveWorkerAiPrompt({
      client: supabase,
      promptKey: "reports.summary",
      variables: {
        facts_json: JSON.stringify(facts),
      },
    });
    const { payload, response } = await requestOpenRouterCompletion({
      apiKey,
      model: prompt.model,
      purpose: prompt.purpose,
      promptKey: prompt.key,
      promptVersionId: prompt.promptVersionId,
      body: {
        messages: [
          {
            role: "system",
            content: prompt.systemPrompt,
          },
          {
            role: "user",
            content: prompt.userPrompt,
          },
        ],
        max_completion_tokens: prompt.maxTokens,
      },
    });

    if (!response.ok) {
      throw new Error(`OpenRouter failed for report ${report.id}: ${response.status} ${JSON.stringify(payload).slice(0, 220)}`);
    }

    const summary = normalizeString(payload.choices?.[0]?.message?.content);

    if (!summary) {
      throw new Error("OpenRouter returned empty report summary.");
    }

    await supabase
      .from("grand_prix_reports")
      .update({
        ai_summary: summary,
        summary_status: "generated",
        status: Object.keys(report.source_errors ?? {}).length ? "partial" : "ready",
        last_error: null,
      })
      .eq("id", report.id);

    return true;
  } catch (error) {
    await supabase
      .from("grand_prix_reports")
      .update({
        summary_status: "failed",
        status: report.status === "summary_pending" ? "partial" : report.status,
        last_error: error instanceof Error ? error.message : String(error),
      })
      .eq("id", report.id);

    return false;
  }
}

async function upsertReportStatus(race, status) {
  await supabase.from("grand_prix_reports").upsert(
    {
      season: race.season_year,
      round: race.round,
      race_slug: makeRaceReportSlug(race.season_year, race.race_name),
      race_name: race.race_name,
      circuit_name: getRelationObject(race.circuits)?.name ?? null,
      country: getRelationObject(race.circuits)?.country ?? null,
      race_date: race.race_start_at,
      status,
      source_updated_at: new Date().toISOString(),
    },
    { onConflict: "season,round" },
  );
}

async function getExistingGrandPrixReport(season, round) {
  const { data } = await supabase
    .from("grand_prix_reports")
    .select("id, structured_hash, summary_status, ai_summary, refresh_stage")
    .eq("season", season)
    .eq("round", round)
    .maybeSingle();

  return data ?? null;
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function makeRaceReportSlug(season, raceName) {
  return `${season}-${slugify(String(raceName).replace(/\s+grand prix$/i, ""))}`;
}

function getCliOption(name) {
  const prefixed = `--${name}`;
  const index = process.argv.indexOf(prefixed);

  if (index >= 0) {
    return process.argv[index + 1] ?? null;
  }

  const inline = process.argv.find((arg) => arg.startsWith(`${prefixed}=`));

  return inline ? inline.slice(prefixed.length + 1) : null;
}

function getCurrentF1Season() {
  const configured = Number(process.env.F1_CURRENT_SEASON ?? 2026);

  if (!Number.isInteger(configured) || configured < 2020) {
    throw new Error("F1_CURRENT_SEASON must be an integer greater than or equal to 2020");
  }

  return configured;
}

function resolveSyncSeason(explicitSeason) {
  const value = explicitSeason ?? getCliOption("season") ?? process.env.F1_SEASON ?? getCurrentF1Season();
  const season = Number(value);

  if (!Number.isInteger(season) || season < 2020 || season > getCurrentF1Season()) {
    throw new Error(`F1 season must be between 2020 and ${getCurrentF1Season()}`);
  }

  return season;
}

function isHistoricalSeason(season) {
  return Number(season) < getCurrentF1Season();
}

export function requireHistoricalSeason(value) {
  const season = Number(value);

  if (
    !Number.isInteger(season) ||
    season < historicalSeasonRange.from ||
    season > historicalSeasonRange.to
  ) {
    throw new Error(
      `Pass an explicit --season between ${historicalSeasonRange.from} and ${historicalSeasonRange.to}`,
    );
  }

  return season;
}

function requireManagedSeason(value) {
  const season = Number(value);

  if (!Number.isInteger(season) || season < historicalSeasonRange.from || season > getCurrentF1Season()) {
    throw new Error(
      `Pass an explicit --season between ${historicalSeasonRange.from} and ${getCurrentF1Season()}`,
    );
  }

  return season;
}

export function resolveTeamLineageSlug(externalId) {
  const normalized = String(externalId ?? "").toLowerCase();
  const lineage = teamLineagesByExternalId[normalized];

  if (!lineage) {
    throw new Error(`No team lineage configured for constructor ${externalId}`);
  }

  return lineage;
}

export function getSeasonTeamColor(season, externalId, manifestColor = null, fallbackColor = null) {
  if (/^#[0-9a-f]{6}$/i.test(String(manifestColor ?? ""))) {
    return String(manifestColor).toUpperCase();
  }

  const normalized = String(externalId ?? "").toLowerCase();
  const historicalColor = teamSeasonColorsByExternalId[normalized];

  if (historicalColor) {
    return historicalColor;
  }

  if (Number(season) <= historicalSeasonRange.to) {
    throw new Error(`No historical season color configured for ${season}/${externalId}`);
  }

  if (/^#[0-9a-f]{6}$/i.test(String(fallbackColor ?? ""))) {
    return String(fallbackColor).toUpperCase();
  }

  throw new Error(`No season color configured for ${season}/${externalId}`);
}

function getRelationObject(value) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function normalizeGridPosition(value) {
  const grid = numberOrNull(value);

  return grid && grid > 0 ? grid : null;
}

function getJolpicaBestLap(rawPayload) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const fastestLap = payload.FastestLap ?? payload.fastestLap;

  return normalizeString(fastestLap?.Time?.time ?? fastestLap?.time ?? fastestLap?.lapTime);
}

function getBestOpenF1LapByDriverNumber(laps) {
  const best = new Map();

  for (const lap of laps ?? []) {
    const driverNumber = numberOrNull(lap.driver_number);
    const duration = numberOrNull(lap.lap_duration);

    if (!driverNumber || !duration) {
      continue;
    }

    const current = best.get(driverNumber);

    if (!current || duration < current.duration) {
      best.set(driverNumber, {
        duration,
        label: formatLapDuration(duration),
      });
    }
  }

  return new Map([...best.entries()].map(([driverNumber, lap]) => [driverNumber, lap.label]));
}

function getFastestLapResult(results) {
  return [...results]
    .map((result) => ({ result, lapMs: parseLapTimeToMs(result.bestLap) }))
    .filter((item) => item.lapMs !== null)
    .sort((a, b) => Number(a.lapMs) - Number(b.lapMs))[0]?.result ?? null;
}

function parseLapTimeToMs(value) {
  const text = normalizeString(value);

  if (!text) {
    return null;
  }

  const minuteMatch = text.match(/^(\d+):(\d{1,2})(?:\.(\d+))?$/);

  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    const seconds = Number(minuteMatch[2]);
    const millis = Number(String(minuteMatch[3] ?? "0").padEnd(3, "0").slice(0, 3));

    return (minutes * 60 + seconds) * 1000 + millis;
  }

  const seconds = Number(text.replace(",", "."));

  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

function getExtremeByDelta(results, direction) {
  const sorted = [...results]
    .filter((result) => result.positionDelta !== null)
    .sort((a, b) =>
      direction === "max"
        ? Number(b.positionDelta) - Number(a.positionDelta)
        : Number(a.positionDelta) - Number(b.positionDelta),
    );

  return sorted[0] ?? null;
}

function countBy(items, keyFn) {
  const counts = new Map();

  for (const item of items ?? []) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function getLeadChangeEvents(positions, results) {
  const resultByNumber = new Map(
    results
      .filter((result) => result.driverNumber)
      .map((result) => [String(result.driverNumber), result]),
  );
  let leader = null;
  const events = [];

  for (const position of [...(positions ?? [])].sort(
    (a, b) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime(),
  )) {
    if (Number(position.position) !== 1) {
      continue;
    }

    const driverNumber = String(position.driver_number ?? "");

    if (!driverNumber || driverNumber === leader) {
      continue;
    }

    const result = resultByNumber.get(driverNumber);

    if (leader !== null && result?.driver) {
      events.push({
        lap: numberOrNull(position.lap_number),
        type: "lead_change",
        title: "Смена лидера",
        detail: `${result.driver} вышел на первое место.`,
      });
    }

    leader = driverNumber;
  }

  return events;
}

function isFinisherStatus(status) {
  const text = normalizeString(status)?.toLowerCase();

  if (!text) {
    return true;
  }

  if (/retired|accident|collision|engine|gearbox|brake|hydraulic|electrical|not classified|excluded|withdrawn|dnf|сход|авар|двигател|коробк|тормоз/.test(text)) {
    return false;
  }

  return true;
}

function getPotentialPointsLoss(results) {
  const scoring = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
  const losses = new Map();

  for (const result of results) {
    const expected = result.grid && result.grid <= scoring.length ? scoring[result.grid - 1] : 0;
    const actual = Number(result.points ?? 0);
    const loss = Math.max(0, expected - actual);

    if (loss > 0) {
      losses.set(result.team, (losses.get(result.team) ?? 0) + loss);
    }
  }

  const biggest = [...losses.entries()].sort((a, b) => b[1] - a[1])[0];

  return biggest ? { team: biggest[0], points: biggest[1] } : null;
}

function slugify(value) {
  return normalizeString(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "race";
}

async function processNewsWithAi() {
  return processNewsArticleBatch({ mode: "pending" });
}

async function reprocessFallbackNewsWithAi() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is missing for fallback news reprocessing.");
  }

  return processNewsArticleBatch({ mode: "fallback" });
}

async function processNewsArticleBatch({ mode }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const limit = Math.max(1, Math.min(Number(getCliOption("limit") ?? process.env.AI_MAX_ARTICLES_PER_RUN ?? 20), 100));
  const articleId = normalizeString(getCliOption("id"));
  // A crashed worker can be retried after its publication lease has expired.
  const { error: recoveryError } = await supabase.from("news_articles").update({ status: "pending" }).eq("status", "processing").eq("publication_status", "processing").lt("updated_at", new Date(Date.now() - 15 * 60_000).toISOString());
  if (recoveryError) throw recoveryError;
  let query = supabase.from("news_articles")
    .select("id, source_id, canonical_url, original_url, original_title, original_description, source_image_url, raw_payload, source_published_at, ingested_at, published_at, publication_status, status, updated_at, news_sources(name)")
    .is("duplicate_of", null).order("ingested_at", { ascending: true }).limit(limit);
  if (articleId) query = query.eq("id", articleId);
  query = mode === "fallback" ? query.eq("status", "processed").eq("ai_model", "fallback") : query.eq("status", "pending");
  const { data: pendingArticles, error } = await query;
  if (error) throw error;
  const articles = pendingArticles ?? [];
  if (mode === "pending" && !articleId && (articles?.length ?? 0) < limit) {
    const { data: heldArticles, error: heldError } = await supabase.from("news_articles")
      .select("id, source_id, canonical_url, original_url, original_title, original_description, source_image_url, raw_payload, source_published_at, ingested_at, published_at, publication_status, status, updated_at, ai_processed_at, ai_title_ru, ai_summary_ru, ai_summary_long_ru, editorial_meta, published_manually, duplicate_of, news_sources(name)")
      .eq("publication_status", "draft").eq("published_manually", false).is("duplicate_of", null)
      .eq("editorial_meta->>algorithm_version", "2").order("ingested_at", { ascending: false }).limit(100);
    if (heldError) throw heldError;
    if (heldArticles?.length) {
      const { data: reviews, error: reviewsError } = await supabase.from("news_editorial_reviews")
        .select("article_id,decision,issues,attempts,created_at").in("article_id", heldArticles.map(article => article.id))
        .order("created_at", { ascending: false }).limit(1000);
      if (reviewsError) throw reviewsError;
      const latest = new Map();
      for (const review of reviews ?? []) if (!latest.has(review.article_id)) latest.set(review.article_id, review);
      articles.push(...heldArticles.filter(article => canRetryNewsSystemHold(article, latest.get(article.id))).slice(0, limit - articles.length));
    }
  }
  if (!articles?.length) return { itemsProcessed: 0 };
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing");
  // Fail before any paid request when the editorial migration is not installed.
  const { error: schemaError } = await supabase.from("news_editorial_reviews").select("id").limit(0);
  if (schemaError) throw schemaError;

  const season = Number(process.env.F1_SEASON ?? new Date().getUTCFullYear());
  const [context, drivers, teams] = await Promise.all([loadNewsContext(supabase, { season }), getDriverTagChoices(), getTeamTagChoices()]);
  const races = context.races;
  let itemsProcessed = 0;
  let held = 0;
  for (const article of articles) {
    const articleContext = await getArticleContext(article, context.drivers);
    if (!hasUsableNewsSourceText(articleContext.text)) {
      await keepNewsArticlePending(article, articleContext, "source_text_unavailable");
      held += 1;
      continue;
    }
    const source = {
      article_id: article.id,
      url: article.original_url ?? article.canonical_url,
      name: getRelationObject(article.news_sources)?.name ?? new URL(article.canonical_url).hostname,
      title: decodeNewsEntities(article.original_title),
      description: cleanNewsRssText(article.original_description),
      text: articleContext.text,
      authors: [normalizeString(article.raw_payload?.author)].filter(Boolean),
      published_at: article.source_published_at,
      retrieved_at: new Date().toISOString(),
      coverage: articleContext.coverage,
    };
    const tokenBudget = createNewsTokenBudget();
    const models = [];
    const request = (promptKey, userPayload) => requestOpenRouterNewsJson({
      apiKey, promptKey, userPayload, retries: 0, articleId: article.id, tokenBudget,
      logKey: `openrouter.${promptKey}`, purpose: promptKey,
      onPrompt: prompt => models.push({ key: prompt.key, model: prompt.model, version_id: prompt.promptVersionId }),
    });
    // Claim first: the existing lease RPC is reentrant for the same article id.
    // A compare-and-swap claim prevents two workers from processing that id.
    const { data: claimed, error: claimError } = await supabase.from("news_articles")
      .update({ status: "processing", publication_status: "processing" })
      .eq("id", article.id).eq("status", article.status).eq("updated_at", article.updated_at).select("id,updated_at");
    if (claimError) throw claimError;
    if (!claimed?.length) continue;
    let locked = false;
    try {
      locked = await acquireNewsDedupLock("news_publication", article.id);
      if (!locked) { await keepNewsArticlePending(article, articleContext, "publication_busy"); continue; }
      const selectedContext = selectNewsContext(context, source, teams);
      const candidateArticle = {
        ...article, title: source.title, summary: source.description,
        normalizedEntities: selectedContext.facts.filter(fact => fact.kind === "driver_team").map(fact => ({
          type: "driver", name: fact.subject, normalized_name: fact.subject.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        })),
      };
      const config = getNewsDedupConfig();
      const candidates = await loadNewsDedupCandidates(candidateArticle, { ...config, windowHours: 168, maxCandidates: 10, preflight: true });
      let result;
      try {
        result = await runNewsEditorialPipeline({
          source, context: selectedContext, request,
          candidates: compactNewsCandidates(candidates), confidenceThreshold: config.confidenceThreshold,
        });
      } catch (processingError) {
        await keepNewsArticlePending(article, articleContext, isOpenRouterBatchBlockedError(processingError) ? processingError.code : "editorial_service_unavailable");
        if (isOpenRouterBatchBlockedError(processingError)) throw processingError;
        logWorkerWarning("news.editorial.failed", { articleId: article.id, reason: getSafeErrorMessage(processingError) });
        continue;
      }
      if (result.decision === "DUPLICATE") {
        const { data: updatedDuplicates, error: duplicateError } = await supabase.from("news_articles").update({
          status: "processed", ai_model: TEXT_AI_MODEL, ai_processed_at: new Date().toISOString(),
          raw_payload: clearNewsAiFailure(article.raw_payload),
        }).eq("id", article.id).eq("status", "processing").eq("updated_at", claimed[0].updated_at).select("id");
        if (duplicateError) throw duplicateError;
        if (!updatedDuplicates?.length) { held += 1; continue; }
        await saveNewsDedupDecision({ articleId: article.id, ...result.duplicate,
          dedupStatus: "duplicate", publicationStatus: "duplicate", publishedAt: null,
          candidateCount: candidates.length, processingTimeMs: null,
        });
        itemsProcessed += 1;
        continue;
      }

      const { error: reviewError } = await supabase.from("news_editorial_reviews").insert({
        article_id: article.id, decision: result.decision, source_hash: result.source_hash,
        source_snapshot: source, context_snapshot: result.context, extraction: result.extraction ?? result.extraction_response,
        attempts: result.attempts, issues: result.issues, models,
      });
      if (reviewError) throw reviewError;
      const draft = result.draft;
      const metadata = result.extraction ? parseNewsEditorialMetadata(result.extraction) : null;
      const usable = draft && isUsableRussianNewsPayload({ title: draft.title_ru, summary: draft.summary_ru, details: draft.details_ru });
      const passed = result.decision === "PASS" && usable && metadata;
      const relatedRace = usable && Number(draft.race_confidence) >= 0.9
        ? races.find(race => race.round === numberOrNull(draft.race_round)) : null;
      const checkedAt = new Date().toISOString();
      const editorialMeta = {
        version: NEWS_EDITORIAL_VERSION,
        algorithm_version: NEWS_PIPELINE_VERSION,
        token_usage: tokenBudget.spent,
        request_count: tokenBudget.calls,
        status: passed ? "passed" : result.decision === "REJECT" ? "rejected" : "review",
        article_type: result.extraction?.article_type ?? "news",
        source_authors: result.extraction?.source_authors ?? source.authors,
        checked_at: checkedAt,
        context: passed ? (draft.context_claims ?? []).flatMap(claim => {
          const fact = result.context.facts.find(item => item.id === claim.id);
          return fact && ["championship_position", "championship_points", "championship_wins", "session_position"].includes(fact.kind) ? [fact] : [];
        }).slice(0, 6) : [],
      };
      const { data: updatedArticles, error: updateError } = await supabase.from("news_articles").update({
        ...(usable ? { ai_title_ru: draft.title_ru, ai_summary_ru: draft.summary_ru, ai_summary_long_ru: draft.details_ru, ai_highlights_ru: selectArticleHighlights(draft.highlight_phrases_ru, draft.summary_ru, draft.details_ru) } : {}),
        ...(metadata ? { main_fact: metadata.mainFact, event_type: metadata.eventType, event_stage: metadata.eventStage, event_date: metadata.eventDate, event_fingerprint: metadata.eventFingerprint, normalized_entities: metadata.normalizedEntities } : {}),
        source_image_url: article.source_image_url ?? articleContext.imageUrl ?? null,
        related_race_id: relatedRace?.id ?? null,
        ai_model: TEXT_AI_MODEL,
        ai_processed_at: checkedAt,
        editorial_meta: editorialMeta,
        published_manually: false,
        publication_status: passed ? "processing_dedup" : result.decision === "REJECT" ? "rejected" : "draft",
        dedup_status: passed ? "checking" : "pending",
        status: usable ? "processed" : "failed",
        raw_payload: passed ? clearNewsAiFailure(article.raw_payload) : { ...clearNewsAiFailure(article.raw_payload), aiFailureReason: "editorial_review_required" },
      }).eq("id", article.id).eq("status", "processing").eq("updated_at", claimed[0].updated_at).select("id");
      if (updateError) throw updateError;
      // An editor may save while the AI is running; retain that newer revision.
      if (!updatedArticles?.length) { held += 1; continue; }
      if (!passed) { held += 1; continue; }

      const primaryEntities = result.extraction.entities.filter(entity => entity.role === "primary");
      const tagArticle = { original_title: primaryEntities.map(entity => entity.name).join(" "), original_description: "" };
      const { error: tagError } = await supabase.from("news_article_tags").delete().eq("article_id", article.id).neq("method", "admin");
      if (tagError) throw tagError;
      if (relatedRace) await upsertRaceTagForArticle(article.id, { ...relatedRace, circuit_name: getRelationObject(relatedRace.circuits)?.name }, 0.95, "ai");
      for (const driver of matchDriversByText(tagArticle, drivers)) await upsertDriverTagForArticle(article.id, driver, 0.95, "rule");
      for (const team of matchTeamsByText(tagArticle, teams)) await upsertTeamTagForArticle(article.id, team, 0.95, "rule");
      await saveNewsArticleSource(article.id, article, source, result.extraction.source_authors);
      await saveNewsDedupDecision({ articleId: article.id, dedupStatus: "unique", publicationStatus: "published",
        publishedAt: article.published_at ?? new Date().toISOString(), duplicateOf: null, confidence: null, relation: "unrelated",
        reason: "Новое событие: проверено перед подготовкой статьи.", candidateCount: candidates.length, processingTimeMs: null,
      });
      itemsProcessed += 1;
    } finally {
      if (locked) await releaseNewsDedupLock("news_publication", article.id);
    }
  }
  return { itemsProcessed, metadata: { held, mode, pipelineVersion: NEWS_PIPELINE_VERSION } };
}

function compactNewsCandidates(candidates) {
  return candidates.map(candidate => ({
    id: candidate.id, original_title: String(candidate.original_title ?? "").slice(0, 180),
    title: String(candidate.ai_title_ru ?? "").slice(0, 180),
    main_fact: String(candidate.main_fact ?? candidate.ai_summary_ru ?? candidate.original_description ?? "").slice(0, 260),
    event_type: candidate.event_type, event_stage: candidate.event_stage, event_date: candidate.event_date,
  }));
}

async function saveNewsArticleSource(targetId, article, source, authors = []) {
  const { error } = await supabase.from("news_article_sources").upsert({
    article_id: targetId, source_article_id: article.id, source_url: source.url,
    source_name: source.name, source_authors: authors, source_published_at: source.published_at,
  }, { onConflict: "article_id,source_article_id" });
  if (error) throw error;
}

function clearNewsAiFailure(rawPayload) {
  if (!isPlainObject(rawPayload)) {
    return rawPayload ?? {};
  }

  const cleanPayload = { ...rawPayload };
  delete cleanPayload.aiFailureReason;
  delete cleanPayload.aiLastAttemptAt;

  return cleanPayload;
}

async function keepNewsArticlePending(article, articleContext, failureReason) {
  await supabase
    .from("news_articles")
    .update({
      source_image_url: article.source_image_url ?? articleContext.imageUrl ?? null,
      ai_model: null,
      status: "pending",
      raw_payload: {
        ...(isPlainObject(article.raw_payload) ? article.raw_payload : {}),
        aiFailureReason: failureReason,
        aiLastAttemptAt: new Date().toISOString(),
      },
    })
    .eq("id", article.id);
}

async function requestOpenRouterNewsJson({
  apiKey,
  promptKey,
  userPayload,
  retries,
  logKey,
  articleId,
  purpose,
  onPrompt,
  tokenBudget,
}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const prompt = await resolveWorkerAiPrompt({
        client: supabase,
        promptKey,
        variables: {
          payload_json: JSON.stringify(userPayload),
        },
      });
      onPrompt?.(prompt);
      const body = {
        messages: [
          { role: "system", content: prompt.systemPrompt },
          { role: "user", content: prompt.userPrompt },
        ],
        response_format: newsResponseFormat(promptKey),
        max_completion_tokens: prompt.maxTokens,
        ...newsRequestOptions(promptKey, prompt.model),
      };
      const onUsage = tokenBudget?.reserve(body);
      const { payload, response } = await requestOpenRouterCompletion({
        apiKey,
        model: prompt.model,
        purpose: prompt.purpose ?? purpose,
        relatedArticleId: articleId,
        promptKey: prompt.key,
        promptVersionId: prompt.promptVersionId,
        body, onUsage,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${getOpenRouterFailureReason(payload)}`);
      }

      const message = payload.choices?.[0]?.message;
      const parsed = parseOpenRouterMessageJson(message?.content);

      if (!isPlainObject(parsed)) {
        const contentType = Array.isArray(message?.content)
          ? "array"
          : typeof message?.content;
        const contentLength = typeof message?.content === "string" ? message.content.length : 0;
        const finishReason = payload.choices?.[0]?.finish_reason ?? "unknown";
        const error = new Error(
          `OpenRouter returned invalid JSON content (${contentType}, ${contentLength} chars, finish ${finishReason})`,
        );
        error.code = "news_invalid_response";
        throw error;
      }

      return parsed;
    } catch (error) {
      if (isOpenRouterBatchBlockedError(error) || error?.code === "news_token_budget_exceeded") throw error;
      lastError = error;
      logWorkerWarning(`${logKey}.retry`, {
        articleId,
        attempt: attempt + 1,
        reason: getSafeErrorMessage(error),
      });

      if (attempt < retries) {
        await sleep(250 * 2 ** attempt);
      }
    }
  }

  throw lastError ?? new Error("OpenRouter news request failed");
}

async function processNewsArticleDeduplication(article, options = {}) {
  const config = getNewsDedupConfig();

  return runNewsDeduplicationPipeline({
    article,
    config,
    // Publication is brief and infrequent. A shared lock also covers synonymous
    // fingerprints generated independently by different sources/workers.
    acquireLock: (_key, articleId) => acquireNewsDedupLock("news_publication", articleId),
    releaseLock: (_key, articleId) => releaseNewsDedupLock("news_publication", articleId),
    loadCandidates: loadNewsDedupCandidates,
    classify: classifyNewsDedupWithAi,
    saveDecision: (decision) => saveNewsDedupDecision(decision, options.decisionSource ?? "pipeline"),
    onError: async (error) => {
      logWorkerWarning("news.dedup.error", {
        articleId: article.id,
        metadataAvailable: options.metadataWasRepaired ?? true,
        reason: getSafeErrorMessage(error),
      });
    },
  });
}

async function classifyNewsDedupWithAi(article, candidates, config) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing for news deduplication");
  }

  const payload = await requestOpenRouterNewsJson({
    apiKey,
    promptKey: "news.dedup",
    userPayload: makeNewsDedupClassifierInput(article, candidates),
    retries: config.aiRetryCount,
    logKey: "openrouter.news_dedup",
    articleId: article.id,
    purpose: "news.dedup",
  });
  const decision = parseNewsDedupDecision(
    payload,
    new Set(candidates.map((candidate) => candidate.id)),
  );

  if (!decision) {
    logWorkerWarning("openrouter.news_dedup.invalid_schema", {
      articleId: article.id,
      confidence: payload?.confidence ?? null,
      duplicateOf: payload?.duplicate_of ?? null,
      isDuplicate: payload?.is_duplicate ?? null,
      isDuplicateType: typeof payload?.is_duplicate,
      keys: isPlainObject(payload) ? Object.keys(payload).sort() : [],
      reasonType: typeof payload?.reason,
      relation: payload?.relation ?? null,
    });
  }

  return decision;
}

async function acquireNewsDedupLock(lockKey, articleId) {
  const attempts = 10;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data, error } = await supabase.rpc("acquire_news_dedup_lock", {
      p_lock_key: lockKey,
      p_article_id: articleId,
      p_stale_after_seconds: 600,
    });

    if (error) {
      throw error;
    }

    if (data === true) {
      return true;
    }

    if (attempt < attempts - 1) {
      await sleep(Math.min(100 * 2 ** attempt, 2_000));
    }
  }

  return false;
}

async function releaseNewsDedupLock(lockKey, articleId) {
  const { error } = await supabase.rpc("release_news_dedup_lock", {
    p_lock_key: lockKey,
    p_article_id: articleId,
  });

  if (error) {
    logWorkerWarning("news.dedup.release_lock", {
      articleId,
      reason: getSafeErrorMessage(error),
    });
  }
}

async function loadNewsDedupCandidates(article, config) {
  const referenceTime = new Date();
  const windowStart = new Date(referenceTime.getTime() - config.windowHours * 3_600_000).toISOString();
  const fields = "id, ai_title_ru, original_title, ai_summary_ru, original_description, main_fact, event_type, event_stage, event_date, event_fingerprint, normalized_entities, ingested_at, published_at, publication_status, editorial_meta";
  const { data, error } = await supabase
    .from("news_articles")
    .select(fields)
    .eq("publication_status", "published")
    .is("duplicate_of", null)
    .gte("ingested_at", windowStart)
    .lt("ingested_at", referenceTime.toISOString())
    .order("ingested_at", { ascending: false })
    .limit(250);

  if (error) {
    throw error;
  }

  const candidates = new Map((data ?? []).map(candidate => [candidate.id, candidate]));
  // Older driver announcements must not reappear simply because a feed was late.
  // The existing GIN index supports this small archive lookup without AI calls.
  if (config.preflight) {
    const headline = `${article.original_title ?? ""} ${article.original_description ?? ""}`.toLowerCase();
    const actors = (article.normalizedEntities ?? []).filter(entity =>
      headline.includes(entity.name.split(/\s+/).at(-1).toLowerCase())).slice(0, 2);
    const archived = await Promise.all(actors.map(entity => supabase.from("news_articles").select(fields)
      .eq("publication_status", "published").is("duplicate_of", null)
      .contains("normalized_entities", JSON.stringify([{ normalized_name: entity.normalized_name }]))
      .lt("ingested_at", windowStart).order("ingested_at", { ascending: false }).limit(20)));
    for (const result of archived) {
      if (result.error) throw result.error;
      for (const candidate of result.data ?? []) candidates.set(candidate.id, candidate);
    }
  }
  return rankNewsDedupCandidates(article, [...candidates.values()], { ...config, referenceTime: referenceTime.toISOString() });
}

async function saveNewsDedupDecision(decision, decisionSource = "pipeline") {
  const checkedAt = new Date().toISOString();
  if (decision.duplicateOf) {
    const { data: sources, error: sourceError } = await supabase.from("news_article_sources")
      .select("source_article_id,source_url,source_name,source_authors,source_published_at").eq("article_id", decision.articleId);
    if (sourceError) throw sourceError;
    if (sources?.length) {
      const { error: mergeError } = await supabase.from("news_article_sources").upsert(
        sources.map(source => ({ ...source, article_id: decision.duplicateOf })), { onConflict: "article_id,source_article_id" },
      );
      if (mergeError) throw mergeError;
    }
  }
  const { error } = await supabase
    .from("news_articles")
    .update({
      dedup_checked_at: checkedAt,
      dedup_status: decision.dedupStatus,
      publication_status: decision.publicationStatus,
      published_at: decision.publishedAt,
      duplicate_of: decision.duplicateOf,
      duplicate_confidence: decision.confidence,
      duplicate_relation: decision.relation,
      duplicate_reason: decision.reason,
      dedup_candidate_count: decision.candidateCount,
      dedup_processing_time_ms: decision.processingTimeMs,
    })
    .eq("id", decision.articleId);

  if (error) {
    throw error;
  }

  await insertNewsDedupDecision(decision, decisionSource);
  console.log(JSON.stringify({
    event: "news.dedup.decision",
    articleId: decision.articleId,
    publicationStatus: decision.publicationStatus,
    dedupStatus: decision.dedupStatus,
    duplicateOf: decision.duplicateOf,
    confidence: decision.confidence,
    relation: decision.relation,
    candidateCount: decision.candidateCount,
    processingTimeMs: decision.processingTimeMs,
  }));
}

async function insertNewsDedupDecision(decision, decisionSource) {
  const { error } = await supabase.from("news_dedup_decisions").insert({
    article_id: decision.articleId,
    duplicate_of: decision.duplicateOf,
    candidate_count: decision.candidateCount ?? 0,
    is_duplicate: decision.publicationStatus === "duplicate",
    confidence: decision.confidence,
    relation: decision.relation,
    reason: decision.reason,
    dedup_status: decision.dedupStatus,
    publication_status: decision.publicationStatus,
    processing_time_ms: decision.processingTimeMs,
    error_message: decision.dedupStatus === "error" ? decision.reason : null,
    decision_source: decisionSource,
  });

  if (error) {
    throw error;
  }
}

async function retryNewsDeduplication() {
  const limit = Math.max(1, Math.min(Number(getCliOption("limit") ?? 50), 100));
  const articleId = normalizeString(getCliOption("id"));
  let articlesQuery = supabase
    .from("news_articles")
    .select("id, ai_title_ru, original_title, ai_summary_ru, original_description, main_fact, event_type, event_stage, event_date, event_fingerprint, normalized_entities, ingested_at, published_at, editorial_meta")
    .eq("status", "processed")
    .eq("publication_status", "processing_dedup")
    .order("ingested_at", { ascending: true })
    .limit(limit);
  if (articleId) {
    articlesQuery = articlesQuery.eq("id", articleId);
  }
  const { data: articles, error } = await articlesQuery;

  if (error) {
    throw error;
  }

  for (const article of articles ?? []) {
    await processNewsArticleDeduplication(mapStoredNewsArticleForDedup(article));
  }

  return { itemsProcessed: articles?.length ?? 0, metadata: { limit } };
}

function mapStoredNewsArticleForDedup(article) {
  return {
    articleType: article.editorial_meta?.article_type,
    id: article.id,
    title: article.ai_title_ru ?? article.original_title,
    summary: article.ai_summary_ru ?? article.original_description,
    mainFact: article.main_fact,
    eventType: article.event_type,
    eventStage: article.event_stage,
    eventDate: article.event_date,
    eventFingerprint: article.event_fingerprint,
    normalizedEntities: article.normalized_entities ?? [],
    ingestedAt: article.ingested_at,
    publishedAt: article.published_at,
  };
}

async function auditRecentNewsDeduplication() {
  const apply = process.argv.includes("--apply");
  const limit = Math.max(1, Math.min(Number(getCliOption("limit") ?? 50), 50));
  const apiKey = process.env.OPENROUTER_API_KEY;
  const config = getNewsDedupConfig();

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing for the recent news audit");
  }

  const { data, error } = await supabase
    .from("news_articles")
    .select("id, ai_title_ru, original_title, ai_summary_ru, original_description, ai_summary_long_ru, main_fact, event_type, event_stage, event_date, event_fingerprint, normalized_entities, source_published_at, ingested_at, published_at, publication_status, editorial_meta")
    .eq("status", "processed")
    .eq("publication_status", "published")
    .is("duplicate_of", null)
    .order("ingested_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  const articles = [...(data ?? [])].reverse();
  const prepared = [];

  for (const article of articles) {
    let metadata = parseNewsEditorialMetadata(article);

    if (!metadata) {
      const payload = await requestOpenRouterNewsJson({
        apiKey,
        promptKey: "news.audit_metadata",
        userPayload: {
          source_published_at: article.source_published_at,
          title_ru: article.ai_title_ru ?? article.original_title,
          summary_ru: article.ai_summary_ru ?? article.original_description,
          details_ru: article.ai_summary_long_ru,
        },
        retries: config.aiRetryCount,
        logKey: "openrouter.news_audit_metadata",
        articleId: article.id,
        purpose: "news.audit_metadata",
      });
      metadata = parseNewsEditorialMetadata(payload);
    }

    if (!metadata) {
      throw new Error(`Invalid editorial metadata for audited article ${article.id}`);
    }

    prepared.push({
      ...mapStoredNewsArticleForDedup(article),
      title: article.ai_title_ru ?? article.original_title,
      summary: article.ai_summary_ru ?? article.original_description,
      mainFact: metadata.mainFact,
      eventType: metadata.eventType,
      eventStage: metadata.eventStage,
      eventDate: metadata.eventDate,
      eventFingerprint: metadata.eventFingerprint,
      normalizedEntities: metadata.normalizedEntities,
      sourcePublishedAt: article.source_published_at,
      storedPublishedAt: article.published_at,
    });
  }

  const retained = [];
  const decisions = [];

  for (const article of prepared) {
    const candidates = rankNewsDedupCandidates(article, retained, config);
    let classification = null;

    if (candidates.length) {
      classification = await classifyNewsDedupWithAi(article, candidates, config);

      if (!classification) {
        throw new Error(`Invalid deduplication decision for audited article ${article.id}`);
      }
    }

    const proposedDuplicate = candidates.find(
      (candidate) => candidate.id === classification?.duplicateOf,
    );
    const identityMatches = proposedDuplicate
      ? isNewsDedupIdentityMatch(article, proposedDuplicate)
      : false;
    const rejectedByIdentityGuard = Boolean(
      classification?.isDuplicate &&
      classification.relation === "duplicate" &&
      proposedDuplicate &&
      !identityMatches,
    );
    const suppress = Boolean(
      classification?.isDuplicate &&
      classification.relation === "duplicate" &&
      classification.confidence >= config.confidenceThreshold &&
      proposedDuplicate &&
      identityMatches,
    );
    const decision = {
      articleId: article.id,
      title: article.title,
      candidateCount: candidates.length,
      dedupStatus: suppress ? "duplicate" : "unique",
      publicationStatus: suppress ? "duplicate" : "published",
      publishedAt: suppress ? null : article.storedPublishedAt,
      duplicateOf: suppress ? classification.duplicateOf : null,
      confidence: classification?.confidence ?? null,
      relation: rejectedByIdentityGuard ? "related" : classification?.relation ?? null,
      reason: rejectedByIdentityGuard
        ? `Опубликовано: тип или стадия события отличаются. Исходная оценка: ${classification.reason}`
        : classification?.reason ?? "В 24-часовом окне нет подходящих кандидатов.",
      processingTimeMs: null,
      metadata: {
        mainFact: article.mainFact,
        eventType: article.eventType,
        eventStage: article.eventStage,
        eventDate: article.eventDate,
        eventFingerprint: article.eventFingerprint,
        normalizedEntities: article.normalizedEntities,
      },
    };
    decisions.push(decision);

    if (!suppress) {
      retained.push({ ...article, publicationStatus: "published" });
    }
  }

  if (apply) {
    for (const decision of decisions) {
      const checkedAt = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("news_articles")
        .update({
          main_fact: decision.metadata.mainFact,
          event_type: decision.metadata.eventType,
          event_stage: decision.metadata.eventStage,
          event_date: decision.metadata.eventDate,
          event_fingerprint: decision.metadata.eventFingerprint,
          normalized_entities: decision.metadata.normalizedEntities,
          dedup_checked_at: checkedAt,
          dedup_status: decision.dedupStatus,
          publication_status: decision.publicationStatus,
          published_at: decision.publishedAt,
          duplicate_of: decision.duplicateOf,
          duplicate_confidence: decision.confidence,
          duplicate_relation: decision.relation,
          duplicate_reason: decision.reason,
          dedup_candidate_count: decision.candidateCount,
        })
        .eq("id", decision.articleId);

      if (updateError) {
        throw updateError;
      }

      await insertNewsDedupDecision(decision, "audit");
    }
  }

  const duplicateDecisions = decisions.filter((decision) => decision.publicationStatus === "duplicate");

  return {
    itemsProcessed: decisions.length,
    metadata: {
      applied: apply,
      checked: decisions.length,
      duplicates: duplicateDecisions.length,
      retained: decisions.length - duplicateDecisions.length,
      duplicateDecisions: duplicateDecisions.map((decision) => ({
        articleId: decision.articleId,
        title: decision.title,
        duplicateOf: decision.duplicateOf,
        confidence: decision.confidence,
        reason: decision.reason,
      })),
    },
  };
}

async function rehighlightNewsWithAi() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const limit = Math.max(1, Math.min(Number(getCliOption("limit") ?? 100), 200));

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing for news highlight refresh.");
  }

  const { data: articles, error } = await supabase
    .from("news_articles")
    .select("id, ai_summary_ru, ai_summary_long_ru, original_description")
    .eq("status", "processed")
    .eq("publication_status", "published")
    .is("duplicate_of", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  let itemsProcessed = 0;
  let skipped = 0;

  for (const article of articles ?? []) {
    const summary = normalizeString(article.ai_summary_ru) ?? normalizeString(article.original_description) ?? "";
    const details = normalizeString(article.ai_summary_long_ru) ?? "";

    if (!summary && !details) {
      skipped += 1;
      continue;
    }

    try {
      const prompt = await resolveWorkerAiPrompt({
        client: supabase,
        promptKey: "news.highlights",
        variables: {
          summary: summary || "Нет",
          details: details || "Нет",
        },
      });
      const { payload, response } = await requestOpenRouterCompletion({
        apiKey,
        model: prompt.model,
        purpose: prompt.purpose,
        relatedArticleId: article.id,
        promptKey: prompt.key,
        promptVersionId: prompt.promptVersionId,
        body: {
          messages: [
            { role: "system", content: prompt.systemPrompt },
            { role: "user", content: prompt.userPrompt },
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: prompt.maxTokens,
        },
      });

      if (!response.ok) {
        throw new Error(`OpenRouter returned HTTP ${response.status}: ${getOpenRouterFailureReason(payload)}`);
      }

      const parsed = safeJson(payload.choices?.[0]?.message?.content);
      const highlights = selectArticleHighlights(parsed?.highlight_phrases_ru, summary, details);
      const { error: updateError } = await supabase
        .from("news_articles")
        .update({ ai_highlights_ru: highlights })
        .eq("id", article.id);

      if (updateError) {
        throw updateError;
      }

      itemsProcessed += 1;
    } catch (highlightError) {
      skipped += 1;
      logWorkerWarning("openrouter.news_highlights.skip", {
        articleId: article.id,
        reason: getSafeErrorMessage(highlightError),
      });
    }
  }

  return { itemsProcessed, metadata: { limit, skipped } };
}

async function backfillNewsSourceImages() {
  const limit = Math.max(
    1,
    Math.min(Number(getCliOption("limit") ?? process.env.NEWS_SOURCE_IMAGE_BACKFILL_LIMIT ?? 80), 200),
  );
  const force = process.argv.includes("--force");

  let query = supabase
    .from("news_articles")
    .select("id, canonical_url, original_url, original_title, original_description, source_image_url, raw_payload")
    .eq("status", "processed")
    .eq("publication_status", "published")
    .is("duplicate_of", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (!force) {
    query = query.is("source_image_url", null);
  }

  const { data: articles, error } = await query;

  if (error) {
    throw error;
  }

  let itemsProcessed = 0;
  let itemsWithImage = 0;

  for (const article of articles ?? []) {
    const existingImage =
      normalizeString(article.source_image_url) ??
      normalizeString(article.raw_payload?.imageUrl) ??
      extractFeedImageFromPayload(article.raw_payload);
    let fetchedArticle = existingImage
      ? { imageUrl: existingImage }
      : await fetchReadableArticleMetadata(article.original_url ?? article.canonical_url);

    if (!fetchedArticle.imageUrl && shouldUseReaderFallback(article.original_url ?? article.canonical_url)) {
      fetchedArticle = await fetchReadableArticleMetadataViaReader(
        article.original_url ?? article.canonical_url,
        fetchedArticle,
      );
    }

    const imageUrl = normalizeString(fetchedArticle.imageUrl);

    if (!imageUrl) {
      itemsProcessed += 1;
      continue;
    }

    await supabase
      .from("news_articles")
      .update({ source_image_url: imageUrl })
      .eq("id", article.id);

    itemsProcessed += 1;
    itemsWithImage += 1;
  }

  return { itemsProcessed, metadata: { force, itemsWithImage, limit } };
}

async function retagNewsWithAi() {
  const { data: articles, error } = await supabase
    .from("news_articles")
    .select("id, original_title, original_description, editorial_meta")
    .eq("status", "processed")
    .eq("publication_status", "published")
    .is("duplicate_of", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(Number(process.env.AI_RETAG_ARTICLES_PER_RUN ?? 100));

  if (error) {
    throw error;
  }

  const [races, drivers, teams] = await Promise.all([
    getRaceChoices(),
    getDriverTagChoices(),
    getTeamTagChoices(),
  ]);
  let itemsProcessed = 0;

  for (const article of articles ?? []) {
    // Version 1 already tags primary participants from verified extraction.
    // The legacy backfill must not restore incidental mentions or inferred teams.
    if (article.editorial_meta?.version === NEWS_EDITORIAL_VERSION) continue;
    const race = matchRaceByText(article, races);
    const matchedDrivers = matchDriversByText(article, drivers);
    const matchedTeams = new Map();

    for (const team of matchTeamsByText(article, teams)) {
      matchedTeams.set(team.slug, { team, confidence: 0.66, method: "rule" });
    }

    matchedDrivers.forEach((driver) => {
      if (driver.team) {
        matchedTeams.set(driver.team.slug, {
          team: driver.team,
          confidence: 0.72,
          method: "driver-rule",
        });
      }
    });

    if (!race && !matchedDrivers.length && !matchedTeams.size) {
      continue;
    }

    if (race) {
      await supabase
        .from("news_articles")
        .update({ related_race_id: race.id })
        .eq("id", article.id);
      await upsertRaceTagForArticle(article.id, race, 0.62, "rule");
    }

    for (const driver of matchedDrivers) {
      await upsertDriverTagForArticle(article.id, driver, 0.7, "rule");
    }

    for (const { team, confidence, method } of matchedTeams.values()) {
      await upsertTeamTagForArticle(article.id, team, confidence, method);
    }

    itemsProcessed += 1;
  }

  return { itemsProcessed, metadata: { method: "rule" } };
}

async function generateNextRacePolls() {
  const closed = await closeCompletedAiPolls();
  const completedRace = await findLatestCompletedRaceForPolls();

  if (!completedRace) {
    return { itemsProcessed: closed, metadata: { closed, reason: "no_completed_race" } };
  }

  const nextRace = await findNextRaceForPolls(completedRace.race_start_at);

  if (!nextRace) {
    return { itemsProcessed: closed, metadata: { closed, reason: "season_complete" } };
  }

  const { data: existing, error: existingError } = await supabase
    .from("polls")
    .select("id, poll_kind")
    .eq("race_id", nextRace.id)
    .not("poll_kind", "is", null);

  if (existingError) {
    throw existingError;
  }

  const existingKinds = new Set((existing ?? []).map((poll) => poll.poll_kind));
  const missingKinds = pollKinds.filter((kind) => !existingKinds.has(kind));

  if (!missingKinds.length) {
    return {
      itemsProcessed: closed,
      metadata: { closed, race: nextRace.race_name, generated: 0, cached: true },
    };
  }

  const context = await getPollGenerationContext(nextRace);
  const generated = await requestAiRacePolls(context);
  const pollsToCreate = generated.filter((poll) => missingKinds.includes(poll.kind));

  if (pollsToCreate.length !== missingKinds.length) {
    throw new Error("AI did not return every missing poll category.");
  }

  let created = 0;

  for (const poll of pollsToCreate) {
    const { data: createdPoll, error: pollError } = await supabase
      .from("polls")
      .insert({
        race_id: nextRace.id,
        question: poll.question,
        status: "published",
        poll_kind: poll.kind,
        generated_by_ai: true,
        generated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (pollError) {
      if (String(pollError.code ?? "") === "23505") {
        continue;
      }

      throw pollError;
    }

    const { error: optionsError } = await supabase.from("poll_options").insert(
      poll.options.map((label, index) => ({
        poll_id: createdPoll.id,
        label,
        sort_order: index + 1,
      })),
    );

    if (optionsError) {
      throw optionsError;
    }

    created += 1;
  }

  return {
    itemsProcessed: closed + created,
    metadata: {
      closed,
      generated: created,
      race: `${nextRace.season_year}-${nextRace.round}`,
    },
  };
}

async function closeCompletedAiPolls() {
  const { data: polls, error } = await supabase
    .from("polls")
    .select("id, race_id, races!inner(status)")
    .eq("status", "published")
    .eq("generated_by_ai", true)
    .not("race_id", "is", null)
    .in("races.status", ["completed", "finished"]);

  if (error) {
    throw error;
  }

  const pollIds = (polls ?? []).map((poll) => poll.id).filter(Boolean);

  if (!pollIds.length) {
    return 0;
  }

  const { data: closed, error: closeError } = await supabase
    .from("polls")
    .update({ status: "closed", closes_at: new Date().toISOString() })
    .in("id", pollIds)
    .eq("status", "published")
    .eq("generated_by_ai", true)
    .select("id");

  if (closeError) {
    throw closeError;
  }

  return closed?.length ?? 0;
}

async function findLatestCompletedRaceForPolls() {
  const { data, error } = await supabase
    .from("races")
    .select("id, season_year, round, race_name, race_start_at, status, circuits(name, country, locality, external_id)")
    .eq("season_year", getCurrentF1Season())
    .in("status", ["completed", "finished"])
    .order("race_start_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

async function findNextRaceForPolls(afterRaceStartAt) {
  if (!afterRaceStartAt) {
    return null;
  }

  const { data, error } = await supabase
    .from("races")
    .select("id, season_year, round, race_name, race_start_at, status, circuits(name, country, locality, external_id)")
    .gt("race_start_at", afterRaceStartAt)
    .order("race_start_at", { ascending: true, nullsFirst: false })
    .limit(12);

  if (error) {
    throw error;
  }

  return (data ?? []).find((race) => race.status !== "completed" && race.status !== "finished") ?? null;
}

async function getPollGenerationContext(nextRace) {
  const circuit = getRelationObject(nextRace.circuits);
  const [driverStandings, constructorStandings, recentRaces, historicalRace, raceNews, sessions] = await Promise.all([
    getPollDriverStandings(nextRace.season_year),
    getPollConstructorStandings(nextRace.season_year),
    getRecentRaceContext(nextRace),
    getHistoricalCircuitRaceContext(nextRace, circuit?.external_id ?? circuit?.name ?? ""),
    getPollNewsContext(nextRace.id),
    supabase
      .from("sessions")
      .select("id, name, start_at")
      .eq("race_id", nextRace.id)
      .order("start_at", { ascending: true, nullsFirst: false }),
  ]);
  const sessionIds = (sessions.data ?? []).map((session) => session.id);
  const { data: weather } = sessionIds.length
    ? await supabase
        .from("session_weather")
        .select("session_id, temperature_c, precipitation_mm, weather_code")
        .in("session_id", sessionIds)
    : { data: [] };

  return {
    race: {
      name: nextRace.race_name,
      season: nextRace.season_year,
      round: nextRace.round,
      circuit: circuit?.name ?? "Трасса уточняется",
      country: circuit?.country ?? "Страна уточняется",
      locality: circuit?.locality ?? null,
      circuitNotes: getCircuitPollNotes(circuit?.external_id ?? circuit?.name ?? ""),
    },
    driverStandings,
    constructorStandings,
    recentRaces,
    historicalRace,
    news: raceNews,
    weather: (sessions.data ?? []).map((session) => {
      const forecast = (weather ?? []).find((item) => item.session_id === session.id);
      return {
        session: session.name,
        temperatureC: forecast?.temperature_c ?? null,
        precipitationMm: forecast?.precipitation_mm ?? null,
        weatherCode: forecast?.weather_code ?? null,
      };
    }),
  };
}

async function getHistoricalCircuitRaceContext(nextRace, circuitKey) {
  if (!circuitKey || !nextRace.season_year) {
    return null;
  }

  const { data: races, error } = await supabase
    .from("races")
    .select("id, season_year, race_name, circuits(name, external_id)")
    .eq("season_year", Number(nextRace.season_year) - 1)
    .order("round", { ascending: true })
    .limit(32);

  if (error) {
    throw error;
  }

  const normalizedKey = normalizePollText(circuitKey);
  const race = (races ?? []).find((item) => {
    const circuit = getRelationObject(item.circuits);
    const candidates = [circuit?.external_id, circuit?.name].filter(Boolean);

    return candidates.some((candidate) => normalizePollText(candidate) === normalizedKey);
  });

  if (!race) {
    return null;
  }

  const session = await getRaceSessionForReport(race.id);
  const results = session ? await getRaceResultRows(session.id) : [];
  const podium = results
    .filter((result) => Number(result.position) > 0 && Number(result.position) <= 3)
    .slice(0, 3)
    .map((result) => getRelationObject(result.drivers)?.full_name ?? "Пилот");

  return podium.length
    ? { season: race.season_year, race: race.race_name, podium }
    : null;
}

async function getPollDriverStandings(season) {
  const { data, error } = await supabase
    .from("driver_standings")
    .select("round, position, points, wins, drivers(full_name), teams(name)")
    .eq("season_year", season)
    .order("round", { ascending: false, nullsFirst: false })
    .limit(80);

  if (error) {
    throw error;
  }

  const latestRound = Math.max(...(data ?? []).map((row) => Number(row.round ?? 0)));

  return (data ?? [])
    .filter((row) => Number(row.round ?? 0) === latestRound)
    .sort((left, right) => Number(left.position ?? 999) - Number(right.position ?? 999))
    .slice(0, 10)
    .map((row) => ({
      position: row.position,
      driver: getRelationObject(row.drivers)?.full_name ?? "Пилот",
      team: getRelationObject(row.teams)?.name ?? "Команда",
      points: row.points,
      wins: row.wins,
    }));
}

async function getPollConstructorStandings(season) {
  const { data, error } = await supabase
    .from("constructor_standings")
    .select("round, position, points, wins, teams(name)")
    .eq("season_year", season)
    .order("round", { ascending: false, nullsFirst: false })
    .limit(40);

  if (error) {
    throw error;
  }

  const latestRound = Math.max(...(data ?? []).map((row) => Number(row.round ?? 0)));

  return (data ?? [])
    .filter((row) => Number(row.round ?? 0) === latestRound)
    .sort((left, right) => Number(left.position ?? 999) - Number(right.position ?? 999))
    .slice(0, 10)
    .map((row) => ({
      position: row.position,
      team: getRelationObject(row.teams)?.name ?? "Команда",
      points: row.points,
      wins: row.wins,
    }));
}

async function getRecentRaceContext(nextRace) {
  const { data: races, error } = await supabase
    .from("races")
    .select("id, race_name, race_start_at, circuits(name)")
    .lt("race_start_at", nextRace.race_start_at)
    .order("race_start_at", { ascending: false, nullsFirst: false })
    .limit(3);

  if (error) {
    throw error;
  }

  const entries = [];

  for (const race of races ?? []) {
    const session = await getRaceSessionForReport(race.id);
    const results = session ? await getRaceResultRows(session.id) : [];
    const topThree = results
      .filter((result) => Number(result.position) > 0 && Number(result.position) <= 3)
      .slice(0, 3)
      .map((result) => getRelationObject(result.drivers)?.full_name ?? "Пилот");

    if (topThree.length) {
      entries.push({
        race: race.race_name,
        circuit: getRelationObject(race.circuits)?.name ?? "Трасса",
        podium: topThree,
      });
    }
  }

  return entries;
}

async function getPollNewsContext(raceId) {
  const { data, error } = await supabase
    .from("news_articles")
    .select("ai_title_ru, original_title, ai_summary_ru")
    .eq("status", "processed")
    .eq("publication_status", "published")
    .is("duplicate_of", null)
    .or(`related_race_id.eq.${raceId},related_race_id.is.null`)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(10);

  if (error) {
    throw error;
  }

  return (data ?? []).map((article) => ({
    title: article.ai_title_ru ?? article.original_title,
    summary: article.ai_summary_ru ?? null,
  }));
}

async function requestAiRacePolls(context) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing for poll generation.");
  }

  const prompt = await resolveWorkerAiPrompt({
    client: supabase,
    promptKey: "polls.generate",
    variables: {
      context_json: JSON.stringify(context),
    },
  });
  const { payload, response } = await requestOpenRouterCompletion({
    apiKey,
    model: prompt.model,
    purpose: prompt.purpose,
    promptKey: prompt.key,
    promptVersionId: prompt.promptVersionId,
    body: {
      messages: [
        { role: "system", content: prompt.systemPrompt },
        { role: "user", content: prompt.userPrompt },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: prompt.maxTokens,
    },
  });

  if (!response.ok) {
    throw new Error(`OpenRouter poll generation failed: ${response.status} ${getOpenRouterFailureReason(payload)}`);
  }

  const parsed = safeJson(payload.choices?.[0]?.message?.content);
  const polls = validateGeneratedPolls(parsed?.polls);

  return polls;
}

function validateGeneratedPolls(value) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error("AI must return exactly three polls.");
  }

  const seenKinds = new Set();
  const seenQuestions = new Set();

  const polls = value.map((item) => {
    const kind = normalizeString(item?.kind);
    const question = normalizeString(item?.question);
    const options = Array.isArray(item?.options)
      ? item.options.map((option) => normalizeString(option)).filter(Boolean)
      : [];

    if (!pollKinds.includes(kind) || !question || question.length < 12 || question.length > 180) {
      throw new Error("AI returned an invalid poll question.");
    }

    if (options.length !== 3 || options.some((option) => option.length > 120)) {
      throw new Error("AI must return exactly three concise options.");
    }

    const normalizedOptions = new Set(options.map((option) => normalizePollText(option)));
    const normalizedQuestion = normalizePollText(question);

    if (normalizedOptions.size !== 3 || seenKinds.has(kind) || seenQuestions.has(normalizedQuestion)) {
      throw new Error("AI returned duplicate poll content.");
    }

    seenKinds.add(kind);
    seenQuestions.add(normalizedQuestion);

    return { kind, question, options };
  });

  if (seenKinds.size !== pollKinds.length) {
    throw new Error("AI must return sport, strategy and fan polls.");
  }

  return polls;
}

function normalizePollText(value) {
  return value.toLocaleLowerCase("ru-RU").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function getCircuitPollNotes(circuitName) {
  const key = normalizePollText(circuitName);
  const insights = [
    ["red bull ring|spielberg", "Короткий круг, несколько зон торможения и важность тяги на выходе из медленных поворотов."],
    ["barcelona|catalunya", "Длинные скоростные повороты обычно делают темп на длинной серии и деградацию шин особенно заметными."],
    ["monaco|monte carlo", "Узкая городская трасса, где позиция в квалификации особенно важна, а Safety Car может изменить стратегию."],
    ["silverstone", "Быстрые связки поворотов и переменчивая погода часто влияют на баланс и стратегию."],
    ["spa", "Длинный круг с переменчивой погодой; разница условий на разных секторах может быть значимой."],
    ["monza", "Низкая прижимная сила, тяжелые торможения и высокая ценность обгонов на прямых."],
    ["baku", "Городская трасса с длинной прямой, узкими секциями и повышенной вероятностью нейтрализаций."],
    ["singapore|marina bay", "Городская ночная трасса с высокой нагрузкой и частой ролью Safety Car в стратегии."],
    ["interlagos|sao paulo", "Короткий рельефный круг, где погода и рестарты часто меняют сценарий гонки."],
    ["las vegas", "Ночная уличная трасса с холодным покрытием и важным управлением температурой шин."],
    ["losail|lusail|qatar", "Быстрый поток поворотов и высокая нагрузка на шины делают темп на длинной серии важным фактором."],
  ];

  return insights.find(([pattern]) => new RegExp(pattern).test(key))?.[1] ?? "Подтвержденных особенностей трассы в локальном контексте нет.";
}

async function generateDailyDigest() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data: cached } = await supabase
    .from("digests")
    .select("id")
    .eq("digest_type", "daily_news")
    .eq("date_key", dateKey)
    .eq("status", "published")
    .maybeSingle();

  if (cached) {
    return { itemsProcessed: 0, metadata: { cached: true, dateKey } };
  }

  const { data: articles, error } = await supabase
    .from("news_articles")
    .select("id, slug, canonical_url, ai_title_ru, original_title, ai_summary_ru, ai_summary_long_ru, main_fact, event_fingerprint, editorial_meta, news_sources(name)")
    .eq("status", "processed")
    .eq("publication_status", "published")
    .is("duplicate_of", null)
    .gte("published_at", windowStart)
    .lt("published_at", now.toISOString())
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (error) {
    throw error;
  }

  const title = "Короткая сводка дня";
  let body = makeDigestFallback(articles ?? []);
  let usedModel = null;

  if (apiKey && articles?.length) {
    try {
      const prompt = await resolveWorkerAiPrompt({
        client: supabase,
        promptKey: "news.daily_digest",
        variables: {
          articles_text: JSON.stringify(buildDigestInput(articles)),
        },
      });
      const { payload, response } = await requestOpenRouterCompletion({
        apiKey,
        model: prompt.model,
        purpose: prompt.purpose,
        promptKey: prompt.key,
        promptVersionId: prompt.promptVersionId,
        body: {
          messages: [
            {
              role: "system",
              content: prompt.systemPrompt,
            },
            {
              role: "user",
              content: prompt.userPrompt,
            },
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: prompt.maxTokens,
        },
      });
      if (!response.ok) {
        logWorkerWarning("openrouter.daily_digest.fallback", {
          status: response.status,
          reason: getOpenRouterFailureReason(payload),
        });
      } else {
        const parsed = parseOpenRouterMessageJson(payload.choices?.[0]?.message?.content);
        const rendered = renderVerifiedDigest(parsed, articles);
        if (rendered) {
          const review = await requestOpenRouterNewsJson({
            apiKey, promptKey: "news.verify", retries: 0, logKey: "news.digest_verification", purpose: "news.verify",
            userPayload: {
              source: { text: JSON.stringify(buildDigestInput(articles)), name: "RaceSide: published articles" },
              extraction: { facts: [], caveats: [] }, context: { current_date: now.toISOString(), facts: [] },
              draft: { title_ru: title, summary_ru: "", paragraphs: rendered.split(/\n\s*\n/) }, hard_issues: [], allow_edits: false,
            },
          });
          if (verificationPasses(review)) { body = rendered; usedModel = prompt.model; }
        }
      }
    } catch (aiError) {
      logWorkerWarning("openrouter.daily_digest.fallback", {
        reason: getSafeErrorMessage(aiError),
      });
    }
  }

  const { error: digestError } = await supabase
    .from("digests")
    .insert({
      digest_type: "daily_news",
      date_key: dateKey,
      title,
      body_md: body,
      ai_model: usedModel,
      status: "published",
      generated_at: new Date().toISOString(),
    });

  if (digestError) {
    throw digestError;
  }

  return {
    itemsProcessed: articles?.length ?? 0,
    metadata: { dateKey, model: usedModel, windowStart },
  };
}

async function syncAllCircuitStats() {
  const season = numberOrNull(getCliOption("season")) ?? Number(process.env.F1_SEASON ?? new Date().getUTCFullYear());
  const { data: races, error } = await supabase
    .from("races")
    .select("id, season_year, round, race_name, race_start_at, circuit_id")
    .eq("season_year", season)
    .not("circuit_id", "is", null)
    .order("round", { ascending: true });

  if (error) {
    throw error;
  }

  let itemsProcessed = 0;

  for (const race of races ?? []) {
    itemsProcessed += await syncCircuitStatsForRace(race);
  }

  return { itemsProcessed, metadata: { season, races: races?.length ?? 0 } };
}

async function syncCircuitStats() {
  const season = numberOrNull(getCliOption("season")) ?? Number(process.env.F1_SEASON ?? new Date().getUTCFullYear());
  const round = numberOrNull(getCliOption("round"));
  const force = process.argv.includes("--force");

  let query = supabase
    .from("races")
    .select("id, season_year, round, race_name, race_start_at, circuit_id")
    .eq("season_year", season)
    .eq("status", "completed")
    .not("circuit_id", "is", null)
    .order("round", { ascending: false });

  query = round ? query.eq("round", round).limit(1) : query.limit(1);

  const { data: race, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  if (!race) {
    return { itemsProcessed: 0, metadata: { season, round, skipped: "completed race not found" } };
  }

  if (!round && !force) {
    const { data: existingHistory } = await supabase
      .from("circuit_grand_prix_history")
      .select("id")
      .eq("circuit_id", race.circuit_id)
      .eq("season", race.season_year)
      .eq("round", race.round)
      .limit(1);

    if (existingHistory?.length) {
      return {
        itemsProcessed: 0,
        metadata: {
          season: race.season_year,
          round: race.round,
          skipped: "race already indexed",
        },
      };
    }
  }

  const itemsProcessed = await syncCircuitStatsForRace(race);

  return { itemsProcessed, metadata: { season: race.season_year, round: race.round } };
}

async function syncCircuitStatsForRace(targetRace) {
  if (!targetRace?.circuit_id) {
    return 0;
  }

  const { data: circuit } = await supabase
    .from("circuits")
    .select("id, external_id, name, country, locality, slug, track_description, race_laps, tyre_wear_rating")
    .eq("id", targetRace.circuit_id)
    .maybeSingle();

  if (!circuit) {
    return 0;
  }

  await ensureCircuitSlug(circuit);

  const { data: raceRows, error } = await supabase
    .from("races")
    .select("id, season_year, round, race_name, race_start_at, circuit_id")
    .eq("circuit_id", circuit.id)
    .eq("status", "completed")
    .lte("season_year", targetRace.season_year)
    .order("season_year", { ascending: true })
    .order("round", { ascending: true });

  if (error) {
    throw error;
  }

  const contexts = [];
  const seenContextKeys = new Set();
  const historyEntityCache = createCircuitHistoryEntityCache();
  let historicalSafetyEvents = null;
  let historicalSafetyEventsError = null;

  try {
    historicalSafetyEvents = await getHistoricalSafetyEventIndexCached();
  } catch (error) {
    historicalSafetyEventsError = getSafeErrorMessage(error);
  }

  for (const race of raceRows ?? []) {
    const context = await buildCircuitRaceContext(
      race,
      historicalSafetyEvents,
      historicalSafetyEventsError,
    );

    if (context) {
      seenContextKeys.add(`${context.season}-${context.round}`);
      contexts.push(context);
      await upsertCircuitHistory(circuit.id, context);
    }
  }

  if (circuit.external_id) {
    const historicalContexts = await fetchJolpicaCircuitHistoryContexts(
      circuit,
      targetRace.season_year,
      historyEntityCache,
      historicalSafetyEvents,
      historicalSafetyEventsError,
    );

    for (const context of historicalContexts) {
      const key = `${context.season}-${context.round}`;

      if (seenContextKeys.has(key)) {
        continue;
      }

      seenContextKeys.add(key);
      contexts.push(context);
      await upsertCircuitHistory(circuit.id, context);
    }
  }

  if (!contexts.length) {
    return 0;
  }

  const activeDriverIds = await getActiveDriverIds();
  const activeTeamIds = await getActiveTeamIds();
  const aggregate = buildCircuitAggregate(circuit, contexts);
  const driverStats = buildCircuitDriverStats(circuit.id, contexts, activeDriverIds);
  const teamStats = buildCircuitTeamStats(circuit.id, contexts, activeTeamIds);

  await supabase.from("circuit_stats").upsert(
    {
      circuit_id: circuit.id,
      calculated_from_season: aggregate.calculatedFromSeason,
      calculated_to_season: aggregate.calculatedToSeason,
      races_count: aggregate.racesCount,
      pole_win_rate: aggregate.poleWinRate,
      front_row_win_rate: aggregate.frontRowWinRate,
      winner_avg_start_position: aggregate.winnerAvgStartPosition,
      avg_position_delta: aggregate.avgPositionDelta,
      avg_abs_position_delta: aggregate.avgAbsPositionDelta,
      best_position_gain_json: aggregate.bestGain,
      worst_position_loss_json: aggregate.worstLoss,
      avg_dnf_count: aggregate.avgDnfCount,
      avg_pit_stops: aggregate.avgPitStops,
      avg_first_pit_lap: aggregate.avgFirstPitLap,
      most_common_strategy: aggregate.mostCommonStrategy,
      strategy_distribution: aggregate.strategyDistribution,
      safety_car_frequency: aggregate.safetyCarFrequency,
      vsc_frequency: aggregate.vscFrequency,
      red_flag_frequency: aggregate.redFlagFrequency,
      chaos_score: aggregate.chaosScore,
      overtaking_level: aggregate.overtakingLevel,
      qualifying_importance_level: aggregate.qualifyingImportanceLevel,
      strategy_variability_level: aggregate.strategyVariabilityLevel,
      records_json: aggregate.records,
      ai_preview: buildCircuitAiPreview(circuit, aggregate),
      ai_preview_status: "fallback",
      ai_preview_generated_at: new Date().toISOString(),
      source_errors: aggregate.sourceErrors,
      calculated_at: new Date().toISOString(),
    },
    { onConflict: "circuit_id,calculated_from_season,calculated_to_season" },
  );

  const circuitUpdate = {
    tyre_wear_rating: aggregate.tyreWearRating,
    ...(aggregate.lapRecord
      ? {
          lap_record_time: aggregate.lapRecord.time,
          lap_record_driver: aggregate.lapRecord.driver,
          lap_record_year: aggregate.lapRecord.season,
        }
      : {}),
  };
  const { error: circuitUpdateError } = await supabase
    .from("circuits")
    .update(circuitUpdate)
    .eq("id", circuit.id);

  if (circuitUpdateError) {
    throw circuitUpdateError;
  }

  if (driverStats.length) {
    await supabase.from("circuit_driver_stats").upsert(driverStats, {
      onConflict: "circuit_id,driver_id,season_scope",
    });
  }

  if (teamStats.length) {
    await supabase.from("circuit_team_stats").upsert(teamStats, {
      onConflict: "circuit_id,team_id,season_scope",
    });
  }

  return contexts.length;
}

function getHistoricalSafetyEventIndexCached() {
  if (!historicalSafetyEventIndexPromise) {
    historicalSafetyEventIndexPromise = loadHistoricalSafetyEventIndex();
  }

  return historicalSafetyEventIndexPromise;
}

async function ensureCircuitSlug(circuit) {
  if (circuit.slug) {
    return circuit.slug;
  }

  const slug = slugify(circuit.name ?? circuit.id);
  await supabase.from("circuits").update({ slug }).eq("id", circuit.id).is("slug", null);

  return slug;
}

async function buildCircuitRaceContext(race, historicalSafetyEvents, historicalSafetyEventsError) {
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, session_type, openf1_session_key")
    .eq("race_id", race.id)
    .in("session_type", ["race", "qualifying"]);
  const raceSession = sessions?.find((session) => session.session_type === "race");
  const qualifyingSession = sessions?.find((session) => session.session_type === "qualifying");

  if (!raceSession?.id) {
    return null;
  }

  const [raceResultsResponse, qualifyingResultsResponse] = await Promise.all([
    supabase
      .from("session_results")
      .select("driver_id, team_id, position, grid, laps, points, status, time_text, raw_payload, drivers(full_name), teams(name)")
      .eq("session_id", raceSession.id)
      .order("position", { ascending: true, nullsFirst: false }),
    qualifyingSession?.id
      ? supabase
          .from("session_results")
          .select("driver_id, team_id, position, time_text, raw_payload, drivers(full_name), teams(name)")
          .eq("session_id", qualifyingSession.id)
          .order("position", { ascending: true, nullsFirst: false })
      : { data: [] },
  ]);
  const raceResults = (raceResultsResponse.data ?? [])
    .filter((result) => result.driver_id && result.position && !isLapOnlyPredictionResult(result))
    .map(mapCircuitResultRow);
  const qualifyingResults = (qualifyingResultsResponse.data ?? [])
    .filter((result) => result.driver_id && result.position)
    .map(mapCircuitResultRow);

  if (!raceResults.length) {
    return null;
  }

  const winner = raceResults.find((result) => result.position === 1) ?? raceResults[0];
  const pole = qualifyingResults.find((result) => result.position === 1) ?? null;
  const podium = raceResults
    .filter((result) => result.position && result.position <= 3)
    .map((result) => ({
      driverId: result.driverId,
      driver: result.driver,
      teamId: result.teamId,
      team: result.team,
      position: result.position,
    }));
  const sourceErrors = {};
  const historicalSafety = getHistoricalSafetyEventCounts(
    historicalSafetyEvents,
    race.season_year,
    race.race_name,
  );

  if (historicalSafetyEventsError && Number(race.season_year) >= 2000) {
    sourceErrors.race_data = historicalSafetyEventsError;
  }

  const openF1 = await collectCircuitOpenF1Data(raceSession.openf1_session_key, sourceErrors);
  const reportRaceControl = await collectCircuitReportRaceControlData(race, sourceErrors);
  const strategy = buildCircuitStrategy(openF1.pits ?? []);
  const dnfCount = raceResults.filter((result) => result.status && !isFinisherStatus(result.status)).length;

  return {
    season: race.season_year,
    round: race.round,
    raceId: race.id,
    raceName: race.race_name,
    raceDate: race.race_start_at,
    winner,
    pole,
    podium,
    dnfCount,
    safetyCarCount: openF1.safetyCarCount ?? historicalSafety?.safetyCarCount ?? reportRaceControl?.safetyCarCount ?? null,
    vscCount: openF1.vscCount ?? historicalSafety?.vscCount ?? reportRaceControl?.vscCount ?? null,
    redFlagCount: openF1.redFlagCount ?? historicalSafety?.redFlagCount ?? reportRaceControl?.redFlagCount ?? null,
    strategy,
    raceResults,
    qualifyingResults,
    sourceErrors,
  };
}

function createCircuitHistoryEntityCache() {
  return {
    drivers: new Map(),
    teams: new Map(),
  };
}

async function fetchJolpicaCircuitHistoryContexts(
  circuit,
  maxSeason,
  entityCache = createCircuitHistoryEntityCache(),
  historicalSafetyEvents = null,
  historicalSafetyEventsError = null,
) {
  const baseUrl = process.env.JOLPICA_BASE_URL ?? "https://api.jolpi.ca/ergast/f1";
  const encodedCircuit = encodeURIComponent(circuit.external_id);
  const sourceErrors = {};

  if (historicalSafetyEventsError && Number(maxSeason) >= 2000) {
    sourceErrors.race_data = historicalSafetyEventsError;
  }
  let raceRows = [];
  let qualifyingRows = [];

  try {
    raceRows = await fetchJolpicaPaginatedRaces(`${baseUrl}/circuits/${encodedCircuit}/results.json`, "Results");
  } catch (error) {
    sourceErrors.jolpica_results = getSafeErrorMessage(error);
  }

  try {
    qualifyingRows = await fetchJolpicaPaginatedRaces(
      `${baseUrl}/circuits/${encodedCircuit}/qualifying.json`,
      "QualifyingResults",
    );
  } catch (error) {
    sourceErrors.jolpica_qualifying = getSafeErrorMessage(error);
  }

  const qualifyingByRace = new Map(
    qualifyingRows.map((race) => [`${race.season}-${race.round}`, race]),
  );
  const contexts = [];

  for (const race of raceRows) {
    const season = numberOrNull(race.season);
    const round = numberOrNull(race.round);

    if (!season || !round || season > maxSeason || !race.Results?.length) {
      continue;
    }

    const context = await buildJolpicaCircuitContext({
      race,
      qualifying: qualifyingByRace.get(`${race.season}-${race.round}`),
      sourceErrors,
      entityCache,
      historicalSafetyEvents,
    });

    if (context) {
      contexts.push(context);
    }
  }

  return contexts;
}

async function fetchJolpicaPaginatedRaces(url, resultKey) {
  const maxLimit = Math.max(1, Math.min(Number(process.env.JOLPICA_PAGE_LIMIT ?? 100), 100));
  const maxPages = Math.max(1, Number(process.env.JOLPICA_MAX_PAGES ?? 80));
  const racesByKey = new Map();
  let offset = 0;
  let total = null;
  let pages = 0;

  while (pages < maxPages && (total === null || offset < total)) {
    const separator = url.includes("?") ? "&" : "?";
    const payload = await fetchJolpicaJsonObject(`${url}${separator}limit=${maxLimit}&offset=${offset}`);
    const mrData = payload.MRData ?? {};
    const pageLimit = Math.max(1, numberOrNull(mrData.limit) ?? maxLimit);
    const pageTotal = numberOrNull(mrData.total);
    const pageRaces = mrData.RaceTable?.Races ?? [];

    for (const race of pageRaces) {
      mergeJolpicaRacePage(racesByKey, race, resultKey);
    }

    pages += 1;
    total = pageTotal ?? offset + pageLimit;
    offset += pageLimit;

    if (!pageRaces.length) {
      break;
    }
  }

  if (total !== null && offset < total) {
    throw new Error(`Jolpica pagination stopped at ${offset} of ${total}: ${url}`);
  }

  return [...racesByKey.values()].sort((left, right) => {
    const seasonDelta = Number(left.season ?? 0) - Number(right.season ?? 0);

    if (seasonDelta !== 0) {
      return seasonDelta;
    }

    return Number(left.round ?? 0) - Number(right.round ?? 0);
  });
}

function mergeJolpicaRacePage(racesByKey, race, resultKey) {
  const key = `${race.season}-${race.round}`;
  const current = racesByKey.get(key);

  if (!resultKey) {
    if (!current) {
      racesByKey.set(key, race);
    }

    return;
  }

  const results = Array.isArray(race[resultKey]) ? race[resultKey] : [];

  if (!current) {
    racesByKey.set(key, {
      ...race,
      [resultKey]: dedupeJolpicaResults(results, resultKey),
    });

    return;
  }

  current[resultKey] = dedupeJolpicaResults([...(current[resultKey] ?? []), ...results], resultKey);
}

function dedupeJolpicaResults(results, resultKey) {
  const seen = new Set();

  return (results ?? []).filter((result) => {
    const driverId = result.Driver?.driverId ?? result.Driver?.permanentNumber ?? result.Driver?.code ?? "";
    const constructorId = result.Constructor?.constructorId ?? "";
    const position = result.position ?? result.positionText ?? "";
    const key = `${resultKey}:${driverId}:${constructorId}:${position}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function buildJolpicaCircuitContext({
  qualifying,
  race,
  sourceErrors,
  entityCache,
  historicalSafetyEvents,
}) {
  const season = numberOrNull(race.season);
  const round = numberOrNull(race.round);

  if (!season || !round) {
    return null;
  }

  const raceResults = [];

  for (const result of race.Results ?? []) {
    const team = await upsertHistoricalTeamFromJolpica(result.Constructor, entityCache);
    const driver = await upsertHistoricalDriverFromJolpica(result.Driver, entityCache);

    if (!driver?.id) {
      continue;
    }

    raceResults.push({
      driverId: driver.id,
      teamId: team?.id ?? null,
      driver: getJolpicaDriverName(result.Driver),
      team: result.Constructor?.name ?? "Команда уточняется",
      position: numberOrNull(result.position),
      grid: normalizeGridPosition(result.grid),
      laps: numberOrNull(result.laps),
      points: numberOrNull(result.points),
      status: result.status ?? null,
      time: result.Time?.time ?? null,
      raw_payload: result,
    });
  }

  const qualifyingResults = [];

  for (const result of qualifying?.QualifyingResults ?? []) {
    const team = await upsertHistoricalTeamFromJolpica(result.Constructor, entityCache);
    const driver = await upsertHistoricalDriverFromJolpica(result.Driver, entityCache);

    if (!driver?.id) {
      continue;
    }

    qualifyingResults.push({
      driverId: driver.id,
      teamId: team?.id ?? null,
      driver: getJolpicaDriverName(result.Driver),
      team: result.Constructor?.name ?? "Команда уточняется",
      position: numberOrNull(result.position),
      grid: null,
      laps: null,
      points: null,
      status: getQualifyingStatus(result),
      time: getBestQualifyingTime(result),
      raw_payload: result,
    });
  }

  if (!raceResults.length) {
    return null;
  }

  const winner = raceResults.find((result) => result.position === 1) ?? raceResults[0];
  const pole = qualifyingResults.find((result) => result.position === 1) ?? null;
  const podium = raceResults
    .filter((result) => result.position && result.position <= 3)
    .map((result) => ({
      driverId: result.driverId,
      driver: result.driver,
      teamId: result.teamId,
      team: result.team,
      position: result.position,
    }));
  const historicalSafety = getHistoricalSafetyEventCounts(
    historicalSafetyEvents,
    season,
    race.raceName,
  );

  return {
    season,
    round,
    raceId: null,
    raceName: race.raceName ?? `${race.Circuit?.Location?.country ?? "Grand Prix"}`,
    raceDate: race.date ? `${race.date}T${race.time ?? "00:00:00Z"}` : null,
    winner,
    pole,
    podium,
    dnfCount: raceResults.filter((result) => result.status && !isFinisherStatus(result.status)).length,
    safetyCarCount: historicalSafety?.safetyCarCount ?? null,
    vscCount: historicalSafety?.vscCount ?? null,
    redFlagCount: historicalSafety?.redFlagCount ?? null,
    strategy: {
      avgPitStops: null,
      avgFirstPitLap: null,
      distribution: {},
      mostCommonStrategy: null,
    },
    raceResults,
    qualifyingResults,
    sourceErrors,
  };
}

async function upsertHistoricalTeamFromJolpica(constructor, entityCache) {
  if (!constructor?.constructorId) {
    return null;
  }

  const cache = entityCache?.teams;
  const knownColor = getKnownTeamColor(constructor.name ?? constructor.constructorId);

  if (cache?.has(constructor.constructorId)) {
    return cache.get(constructor.constructorId);
  }

  const { data: existing, error: selectError } = await supabase
    .from("teams")
    .select("id, color_hex")
    .eq("external_id", constructor.constructorId)
    .maybeSingle();

  if (selectError) {
    throw selectError;
  }

  if (existing?.id) {
    if (knownColor && !existing.color_hex) {
      await supabase
        .from("teams")
        .update({ color_hex: knownColor })
        .eq("id", existing.id)
        .is("color_hex", null);
    }

    cache?.set(constructor.constructorId, existing);
    return existing;
  }

  const { data, error } = await supabase
    .from("teams")
    .insert({
      external_id: constructor.constructorId,
      code: makeHistoricalEntityCode(constructor.constructorId, "TEAM"),
      name: constructor.name ?? constructor.constructorId,
      short_name: constructor.name ?? constructor.constructorId,
      country: constructor.nationality ?? null,
      color_hex: knownColor,
      is_active: false,
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  cache?.set(constructor.constructorId, data ?? null);
  return data ?? null;
}

async function upsertHistoricalDriverFromJolpica(driver, entityCache) {
  if (!driver?.driverId) {
    return null;
  }

  const cache = entityCache?.drivers;

  if (cache?.has(driver.driverId)) {
    return cache.get(driver.driverId);
  }

  const data = await upsertDriverFromJolpica(driver, null, { historical: true });

  cache?.set(driver.driverId, data ?? null);
  return data ?? null;
}

function makeHistoricalEntityCode(externalId, fallback) {
  const normalized = String(externalId ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();

  return normalized ? `H_${normalized}` : fallback;
}

function getJolpicaDriverName(driver) {
  return `${driver?.givenName ?? driver?.given_name ?? ""} ${driver?.familyName ?? driver?.family_name ?? ""}`.trim() || "Пилот уточняется";
}

async function collectCircuitOpenF1Data(sessionKey, sourceErrors) {
  if (!sessionKey) {
    sourceErrors.openf1 = "У гонки нет openf1_session_key.";
    return {
      safetyCarCount: null,
      vscCount: null,
      redFlagCount: null,
      pits: [],
    };
  }

  const baseUrl = process.env.OPENF1_BASE_URL ?? "https://api.openf1.org/v1";
  const result = {
    safetyCarCount: null,
    vscCount: null,
    redFlagCount: null,
    pits: [],
  };

  try {
    const raceControl = await fetchJson(`${baseUrl}/race_control?session_key=${sessionKey}`);
    const counts = countOpenF1SafetyEvents(raceControl);
    result.safetyCarCount = counts.safetyCarCount;
    result.vscCount = counts.vscCount;
    result.redFlagCount = counts.redFlagCount;
  } catch (error) {
    sourceErrors.openf1_race_control = getSafeErrorMessage(error);
  }

  try {
    result.pits = await fetchJson(`${baseUrl}/pit?session_key=${sessionKey}`);
  } catch (error) {
    sourceErrors.openf1_pit = getSafeErrorMessage(error);
  }

  return result;
}

async function collectCircuitReportRaceControlData(race, sourceErrors) {
  if (!race?.season_year || !race?.round) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("grand_prix_reports")
      .select("key_events")
      .eq("season", race.season_year)
      .eq("round", race.round)
      .maybeSingle();

    if (error) {
      sourceErrors.report_race_control = error.message;
      return null;
    }

    const keyEvents = Array.isArray(data?.key_events) ? data.key_events : [];
    if (!keyEvents.length) {
      return null;
    }

    return countReportSafetyEvents(keyEvents);
  } catch (error) {
    sourceErrors.report_race_control = getSafeErrorMessage(error);
    return null;
  }
}

function buildCircuitStrategy(pits) {
  const pitCountByDriver = countBy(pits, (pit) => String(pit.driver_number ?? ""));
  pitCountByDriver.delete("");
  const pitCounts = [...pitCountByDriver.values()].map(Number).filter(Number.isFinite);
  const firstPitLapsByDriver = new Map();

  for (const pit of pits ?? []) {
    const driverNumber = String(pit.driver_number ?? "");
    const lap = numberOrNull(pit.lap_number);

    if (!driverNumber || lap === null) {
      continue;
    }

    const current = firstPitLapsByDriver.get(driverNumber);

    if (current === undefined || lap < current) {
      firstPitLapsByDriver.set(driverNumber, lap);
    }
  }

  const distribution = {};

  for (const count of pitCounts) {
    const key = `${count} stop${count === 1 ? "" : "s"}`;
    distribution[key] = (distribution[key] ?? 0) + 1;
  }

  return {
    avgPitStops: averageNumber(pitCounts),
    avgFirstPitLap: averageNumber([...firstPitLapsByDriver.values()]),
    distribution,
    mostCommonStrategy: Object.entries(distribution).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null,
  };
}

async function upsertCircuitHistory(circuitId, context) {
  await supabase.from("circuit_grand_prix_history").upsert(
    {
      circuit_id: circuitId,
      season: context.season,
      round: context.round,
      race_id: context.raceId,
      race_name: context.raceName,
      race_date: context.raceDate,
      winner_driver_id: context.winner?.driverId ?? null,
      winner_team_id: context.winner?.teamId ?? null,
      pole_driver_id: context.pole?.driverId ?? null,
      pole_team_id: context.pole?.teamId ?? null,
      winner_start_position: context.winner?.grid ?? null,
      winner_from_pole: context.pole?.driverId ? context.pole.driverId === context.winner?.driverId : null,
      podium_json: context.podium,
      dnf_count: context.dnfCount,
      safety_car_count: context.safetyCarCount,
      vsc_count: context.vscCount,
      red_flag_count: context.redFlagCount,
      strategy_json: context.strategy,
      raw_payload: {
        raceSessionResults: context.raceResults.length,
        safetyEventUnit: "events",
      },
      source_errors: context.sourceErrors,
    },
    { onConflict: "circuit_id,season,round" },
  );
}

function buildCircuitAggregate(circuit, contexts) {
  const characterContexts = contexts.filter((context) => Number(context.season) >= 2000);
  const startPositions = contexts.map((context) => context.winner?.grid).filter((value) => value !== null && value !== undefined);
  const poleKnown = contexts.filter((context) => context.pole?.driverId && context.winner?.driverId);
  const frontRowWins = contexts.filter((context) => context.winner?.grid && context.winner.grid <= 2).length;
  const deltas = contexts.flatMap((context) =>
    context.raceResults
      .map((result) => getCircuitPositionRecord(context, result))
      .filter((record) => record.start && record.finish && record.delta !== null),
  );
  const bestGain = [...deltas].sort((left, right) => Number(right.delta) - Number(left.delta))[0] ?? null;
  const worstLoss = [...deltas].sort((left, right) => Number(left.delta) - Number(right.delta))[0] ?? null;
  const dnfCounts = contexts.map((context) => context.dnfCount).filter((value) => value !== null && value !== undefined);
  const safetyCarCounts = contexts.map((context) => context.safetyCarCount).filter((value) => value !== null);
  const vscCounts = contexts.map((context) => context.vscCount).filter((value) => value !== null);
  const redFlagCounts = contexts.map((context) => context.redFlagCount).filter((value) => value !== null);
  const avgDnfCount = averageNumber(dnfCounts);
  const tyreWearRating = getCircuitTyreWearRating(circuit, contexts);
  const fallbackStrategy = getFallbackCircuitStrategy(circuit, tyreWearRating);
  const avgPitStops =
    averageNumber(contexts.map((context) => context.strategy.avgPitStops).filter((value) => value !== null)) ??
    fallbackStrategy.avgPitStops;
  const avgFirstPitLap =
    averageNumber(contexts.map((context) => context.strategy.avgFirstPitLap).filter((value) => value !== null)) ??
    fallbackStrategy.avgFirstPitLap;
  const actualStrategyDistribution = mergeStrategyDistributions(contexts.map((context) => context.strategy.distribution));
  const strategyDistribution = Object.keys(actualStrategyDistribution).length
    ? actualStrategyDistribution
    : fallbackStrategy.distribution;
  const mostCommonStrategy =
    Object.entries(strategyDistribution).sort((left, right) => right[1] - left[1])[0]?.[0] ??
    fallbackStrategy.mostCommonStrategy;
  const safetyCarFrequency = averageNumber(safetyCarCounts);
  const vscFrequency = averageNumber(vscCounts);
  const redFlagFrequency = averageNumber(redFlagCounts);
  const lapRecord = getCircuitQualifyingLapRecord(circuit, contexts);
  const chaosScore =
    safetyCarFrequency === null && vscFrequency === null && redFlagFrequency === null && avgDnfCount === null
      ? null
      : roundNumber((safetyCarFrequency ?? 0) * 2 + (vscFrequency ?? 0) + (redFlagFrequency ?? 0) * 3 + (avgDnfCount ?? 0) * 0.5, 2);
  const sourceErrors = Object.assign({}, ...contexts.map((context) => context.sourceErrors));

  return {
    calculatedFromSeason: Math.min(...contexts.map((context) => context.season)),
    calculatedToSeason: Math.max(...contexts.map((context) => context.season)),
    racesCount: contexts.length,
    poleWinRate: poleKnown.length ? roundNumber((poleKnown.filter((context) => context.pole?.driverId === context.winner?.driverId).length / poleKnown.length) * 100, 2) : null,
    frontRowWinRate: startPositions.length ? roundNumber((frontRowWins / startPositions.length) * 100, 2) : null,
    winnerAvgStartPosition: averageNumber(startPositions),
    avgPositionDelta: averageNumber(deltas.map((record) => record.delta)),
    avgAbsPositionDelta: averageNumber(deltas.map((record) => Math.abs(Number(record.delta)))),
    bestGain,
    worstLoss,
    avgDnfCount,
    avgPitStops,
    avgFirstPitLap,
    mostCommonStrategy,
    strategyDistribution,
    safetyCarFrequency,
    vscFrequency,
    redFlagFrequency,
    chaosScore,
    overtakingLevel: getOvertakingLevel(averageNumber(deltas.map((record) => Math.abs(Number(record.delta))))),
    qualifyingImportanceLevel: getQualifyingImportanceLevel(startPositions),
    strategyVariabilityLevel: getStrategyVariabilityLevel(strategyDistribution),
    records: {
      ...buildCircuitRecords(contexts, bestGain, worstLoss),
      characterSince2000: buildCircuitCharacterStats(circuit, characterContexts),
    },
    lapRecord,
    tyreWearRating,
    sourceErrors,
  };
}

function buildCircuitCharacterStats(circuit, contexts) {
  if (!contexts.length) {
    return {
      sinceSeason: 2000,
      racesCount: 0,
      ratings: [],
      facts: {
        poleWinRate: null,
        winnerAvgStartPosition: null,
        avgDnfCount: null,
      },
    };
  }

  const startPositions = contexts.map((context) => context.winner?.grid).filter((value) => value !== null && value !== undefined);
  const poleKnown = contexts.filter((context) => context.pole?.driverId && context.winner?.driverId);
  const deltas = contexts.flatMap((context) =>
    context.raceResults
      .map((result) => getCircuitPositionRecord(context, result))
      .filter((record) => record.start && record.finish && record.delta !== null),
  );
  const avgAbsPositionDelta = averageNumber(deltas.map((record) => Math.abs(Number(record.delta))));
  const dnfCounts = contexts.map((context) => context.dnfCount).filter((value) => value !== null && value !== undefined);
  const safetyCarCounts = contexts.map((context) => context.safetyCarCount).filter((value) => value !== null);
  const vscCounts = contexts.map((context) => context.vscCount).filter((value) => value !== null);
  const redFlagCounts = contexts.map((context) => context.redFlagCount).filter((value) => value !== null);
  const actualStrategyDistribution = mergeStrategyDistributions(contexts.map((context) => context.strategy.distribution));
  const tyreWearRating = getCircuitTyreWearRating(circuit, contexts);
  const poleWinRate = poleKnown.length
    ? roundNumber((poleKnown.filter((context) => context.pole?.driverId === context.winner?.driverId).length / poleKnown.length) * 100, 2)
    : null;
  const frontRowWinRate = startPositions.length
    ? roundNumber((contexts.filter((context) => context.winner?.grid && context.winner.grid <= 2).length / startPositions.length) * 100, 2)
    : null;
  const avgDnfCount = averageNumber(dnfCounts);
  const safetyCarFrequency = averageNumber(safetyCarCounts);
  const vscFrequency = averageNumber(vscCounts);
  const redFlagFrequency = averageNumber(redFlagCounts);
  const chaosScore =
    safetyCarFrequency === null && vscFrequency === null && redFlagFrequency === null && avgDnfCount === null
      ? null
      : roundNumber((safetyCarFrequency ?? 0) * 2 + (vscFrequency ?? 0) + (redFlagFrequency ?? 0) * 3 + (avgDnfCount ?? 0) * 0.5, 2);

  return {
    sinceSeason: 2000,
    racesCount: contexts.length,
    ratings: [
      {
        label: "Обгоны",
        value: getOvertakingRating(avgAbsPositionDelta),
        helper: "Среднее движение позиций в гонках с 2000 года.",
      },
      {
        label: "Квалификация",
        value: getQualifyingRating(frontRowWinRate),
        helper: "Как часто победитель стартовал из первого ряда с 2000 года.",
      },
      {
        label: "Износ шин",
        value: tyreWearRating,
        helper: "Оценка нагрузки на шины по стратегиям и справочнику RaceSide.",
      },
      {
        label: "Safety Car",
        value: getSafetyCarRating(safetyCarFrequency, vscFrequency, redFlagFrequency),
        helper: "Частота нейтрализаций и красных флагов с 2000 года.",
      },
      {
        label: "Стратегия",
        value: getStrategyRating(actualStrategyDistribution),
        helper: "Насколько разнообразны рабочие сценарии пит-стопов.",
      },
      {
        label: "Хаос",
        value: getChaosRating(chaosScore),
        helper: "Сводный индекс сходов, SC, VSC и красных флагов.",
      },
    ],
    facts: {
      poleWinRate,
      winnerAvgStartPosition: averageNumber(startPositions),
      avgDnfCount,
    },
  };
}

function getOvertakingRating(avgAbsDelta) {
  if (avgAbsDelta === null) {
    return null;
  }

  if (avgAbsDelta >= 6) {
    return 5;
  }

  if (avgAbsDelta >= 4.5) {
    return 4;
  }

  if (avgAbsDelta >= 3) {
    return 3;
  }

  if (avgAbsDelta >= 1.5) {
    return 2;
  }

  return 1;
}

function getQualifyingRating(frontRowWinRate) {
  if (frontRowWinRate === null) {
    return null;
  }

  if (frontRowWinRate >= 80) {
    return 5;
  }

  if (frontRowWinRate >= 65) {
    return 4;
  }

  if (frontRowWinRate >= 45) {
    return 3;
  }

  if (frontRowWinRate >= 25) {
    return 2;
  }

  return 1;
}

function getSafetyCarRating(safetyCarFrequency, vscFrequency, redFlagFrequency) {
  const score = (safetyCarFrequency ?? 0) + (vscFrequency ?? 0) * 0.6 + (redFlagFrequency ?? 0) * 1.2;

  if (safetyCarFrequency === null && vscFrequency === null && redFlagFrequency === null) {
    return null;
  }

  if (score >= 2) {
    return 5;
  }

  if (score >= 1.35) {
    return 4;
  }

  if (score >= 0.75) {
    return 3;
  }

  if (score >= 0.25) {
    return 2;
  }

  return 1;
}

function getStrategyRating(distribution) {
  const strategies = Object.keys(distribution ?? {}).length;

  if (strategies >= 5) {
    return 5;
  }

  if (strategies >= 4) {
    return 4;
  }

  if (strategies >= 3) {
    return 3;
  }

  if (strategies >= 2) {
    return 2;
  }

  return strategies === 1 ? 1 : null;
}

function getChaosRating(score) {
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

function getCircuitTyreWearRating(circuit, contexts) {
  const ratingByCircuit = {
    albert_park: 3,
    shanghai: 4,
    suzuka: 5,
    miami: 3,
    villeneuve: 2,
    monaco: 2,
    catalunya: 4,
    red_bull_ring: 3,
    silverstone: 5,
    spa: 4,
    hungaroring: 4,
    zandvoort: 3,
    monza: 2,
    madring: 3,
    baku: 2,
    marina_bay: 4,
    americas: 3,
    rodriguez: 3,
    interlagos: 3,
    vegas: 2,
    losail: 5,
    yas_marina: 3,
  };
  const pitStops = averageNumber(contexts.map((context) => context.strategy.avgPitStops).filter((value) => value !== null));
  const byPitStops =
    pitStops === null
      ? null
      : pitStops >= 2.4
        ? 5
        : pitStops >= 2
          ? 4
          : pitStops >= 1.6
            ? 3
            : pitStops >= 1.25
              ? 2
              : 1;
  const rating = byPitStops ?? ratingByCircuit[circuit?.external_id] ?? numberOrNull(circuit?.tyre_wear_rating) ?? 3;

  return Math.max(1, Math.min(5, Math.round(rating)));
}

function getFallbackCircuitStrategy(circuit, tyreWearRating) {
  const raceLaps = numberOrNull(circuit?.race_laps);
  const firstPitRatioByWear = {
    1: 0.46,
    2: 0.4,
    3: 0.34,
    4: 0.28,
    5: 0.22,
  };
  const avgPitStopsByWear = {
    1: 1.1,
    2: 1.35,
    3: 1.7,
    4: 2.05,
    5: 2.35,
  };
  const strategyByWear = {
    1: "1 stop",
    2: "1 stop",
    3: "1-2 stops",
    4: "2 stops",
    5: "2-3 stops",
  };
  const firstPitLap = raceLaps
    ? Math.max(1, Math.round(raceLaps * (firstPitRatioByWear[tyreWearRating] ?? 0.34)))
    : null;
  const mostCommonStrategy = strategyByWear[tyreWearRating] ?? "1-2 stops";

  return {
    avgPitStops: avgPitStopsByWear[tyreWearRating] ?? 1.7,
    avgFirstPitLap: firstPitLap,
    distribution: { [mostCommonStrategy]: 1 },
    mostCommonStrategy,
  };
}

function getCircuitQualifyingLapRecord(circuit, contexts) {
  const currentLayoutStartSeason = getCircuitCurrentLayoutStartSeason(circuit);
  const currentLayoutContexts = currentLayoutStartSeason
    ? contexts.filter((context) => context.season >= currentLayoutStartSeason)
    : contexts;
  const sourceContexts = currentLayoutContexts.length ? currentLayoutContexts : contexts;

  return sourceContexts
    .flatMap((context) =>
      (context.qualifyingResults ?? [])
        .map((result) => getCircuitQualifyingLapRecordFromResult(context, result))
        .filter(Boolean),
    )
    .sort((left, right) => left.ms - right.ms)[0] ?? null;
}

function getCircuitCurrentLayoutStartSeason(circuit) {
  const currentLayoutStartByCircuit = {
    albert_park: 2022,
    catalunya: 2023,
    red_bull_ring: 1997,
    silverstone: 2010,
    spa: 2007,
    zandvoort: 2021,
    monza: 2000,
    marina_bay: 2023,
    rodriguez: 2015,
    interlagos: 1990,
    yas_marina: 2021,
  };

  return currentLayoutStartByCircuit[circuit?.external_id] ?? circuit?.first_grand_prix_year ?? null;
}

function getCircuitQualifyingLapRecordFromResult(context, result) {
  const time = getBestQualifyingTime(result.raw_payload);
  const ms = parseLapTimeMs(time);

  if (ms === null) {
    return null;
  }

  return {
    time,
    ms,
    driver: result.driver,
    team: result.team,
    season: context.season,
    round: context.round,
    raceName: context.raceName,
  };
}

function parseLapTimeMs(value) {
  const match = String(value ?? "").trim().match(/^(?:(\d+):)?(\d+)\.(\d{1,3})$/);

  if (!match) {
    return null;
  }

  const minutes = Number(match[1] ?? 0);
  const seconds = Number(match[2]);
  const milliseconds = Number(match[3].padEnd(3, "0"));

  if (![minutes, seconds, milliseconds].every(Number.isFinite)) {
    return null;
  }

  return minutes * 60_000 + seconds * 1000 + milliseconds;
}

function getCircuitPositionRecord(context, result) {
  const start = result.grid;
  const finish = result.position;

  return {
    season: context.season,
    round: context.round,
    raceName: context.raceName,
    driver: result.driver,
    team: result.team,
    start,
    finish,
    delta: start && finish ? start - finish : null,
  };
}

function buildCircuitRecords(contexts, bestGain, worstLoss) {
  const winCounts = countBy(contexts, (context) => context.winner?.driver || "unknown");
  winCounts.delete("unknown");
  const teamWinCounts = countBy(contexts, (context) => context.winner?.team || "unknown");
  teamWinCounts.delete("unknown");

  return {
    bestNonPoleWin: contexts
      .filter((context) => context.winner?.grid && context.winner.grid > 1)
      .sort((left, right) => Number(right.winner.grid) - Number(left.winner.grid))
      .map((context) => getCircuitPositionRecord(context, context.winner))[0] ?? null,
    biggestGain: bestGain,
    biggestLoss: worstLoss,
    maxDnfCount: Math.max(...contexts.map((context) => context.dnfCount ?? 0)),
    mostSuccessfulDriver: [...winCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null,
    mostSuccessfulTeam: [...teamWinCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null,
  };
}

function buildCircuitDriverStats(circuitId, contexts, activeDriverIds) {
  const byDriver = new Map();

  for (const context of contexts) {
    for (const result of context.raceResults) {
      if (!result.driverId || !activeDriverIds.has(result.driverId)) {
        continue;
      }

      const entry = byDriver.get(result.driverId) ?? {
        circuit_id: circuitId,
        driver_id: result.driverId,
        season_scope: "current_active",
        starts: 0,
        wins: 0,
        podiums: 0,
        points_finishes: 0,
        dnfs: 0,
        startPositions: [],
        finishPositions: [],
        deltas: [],
        best_finish: null,
        best_start: null,
      };
      entry.starts += 1;
      entry.wins += result.position === 1 ? 1 : 0;
      entry.podiums += result.position && result.position <= 3 ? 1 : 0;
      entry.points_finishes += Number(result.points ?? 0) > 0 ? 1 : 0;
      entry.dnfs += result.status && !isFinisherStatus(result.status) ? 1 : 0;

      if (result.grid) {
        entry.startPositions.push(result.grid);
        entry.best_start = entry.best_start === null ? result.grid : Math.min(entry.best_start, result.grid);
      }

      if (result.position) {
        entry.finishPositions.push(result.position);
        entry.best_finish = entry.best_finish === null ? result.position : Math.min(entry.best_finish, result.position);
      }

      if (result.grid && result.position) {
        entry.deltas.push(result.grid - result.position);
      }

      byDriver.set(result.driverId, entry);
    }
  }

  return [...byDriver.values()].map((entry) => ({
    circuit_id: entry.circuit_id,
    driver_id: entry.driver_id,
    season_scope: entry.season_scope,
    starts: entry.starts,
    wins: entry.wins,
    podiums: entry.podiums,
    points_finishes: entry.points_finishes,
    dnfs: entry.dnfs,
    avg_start_position: averageNumber(entry.startPositions),
    avg_finish_position: averageNumber(entry.finishPositions),
    best_finish: entry.best_finish,
    best_start: entry.best_start,
    avg_position_delta: averageNumber(entry.deltas),
    total_position_delta: entry.deltas.reduce((sum, delta) => sum + delta, 0),
  }));
}

function buildCircuitTeamStats(circuitId, contexts, activeTeamIds) {
  const byTeamRace = new Map();

  for (const context of contexts) {
    const teamsInRace = new Map();

    for (const result of context.raceResults) {
      if (!result.teamId || !activeTeamIds.has(result.teamId)) {
        continue;
      }

      const entry = teamsInRace.get(result.teamId) ?? {
        teamId: result.teamId,
        starts: 0,
        wins: 0,
        podiums: 0,
        pointsFinishes: 0,
        points: 0,
        finishes: [],
      };
      entry.starts += 1;
      entry.wins += result.position === 1 ? 1 : 0;
      entry.podiums += result.position && result.position <= 3 ? 1 : 0;
      entry.pointsFinishes += Number(result.points ?? 0) > 0 ? 1 : 0;
      entry.points += Number(result.points ?? 0);

      if (result.position) {
        entry.finishes.push(result.position);
      }

      teamsInRace.set(result.teamId, entry);
    }

    for (const entry of teamsInRace.values()) {
      const total = byTeamRace.get(entry.teamId) ?? {
        circuit_id: circuitId,
        team_id: entry.teamId,
        season_scope: "current_active",
        starts: 0,
        wins: 0,
        podiums: 0,
        points_finishes: 0,
        racePoints: [],
        finishes: [],
        double_points_finishes: 0,
      };
      total.starts += entry.starts;
      total.wins += entry.wins;
      total.podiums += entry.podiums;
      total.points_finishes += entry.pointsFinishes;
      total.racePoints.push(entry.points);
      total.finishes.push(...entry.finishes);
      total.double_points_finishes += entry.pointsFinishes >= 2 ? 1 : 0;
      byTeamRace.set(entry.teamId, total);
    }
  }

  return [...byTeamRace.values()].map((entry) => ({
    circuit_id: entry.circuit_id,
    team_id: entry.team_id,
    season_scope: entry.season_scope,
    starts: entry.starts,
    wins: entry.wins,
    podiums: entry.podiums,
    points_finishes: entry.points_finishes,
    avg_points: averageNumber(entry.racePoints),
    best_finish: entry.finishes.length ? Math.min(...entry.finishes) : null,
    worst_finish: entry.finishes.length ? Math.max(...entry.finishes) : null,
    double_points_finishes: entry.double_points_finishes,
  }));
}

function mapCircuitResultRow(row) {
  const driver = getRelationObject(row.drivers);
  const team = getRelationObject(row.teams);

  return {
    driverId: row.driver_id ?? null,
    teamId: row.team_id ?? null,
    driver: driver?.full_name ?? "Пилот уточняется",
    team: team?.name ?? "Команда уточняется",
    position: numberOrNull(row.position),
    grid: normalizeGridPosition(row.grid),
    laps: numberOrNull(row.laps),
    points: numberOrNull(row.points),
    status: row.status ?? null,
    time: row.time_text ?? null,
    raw_payload: row.raw_payload ?? {},
  };
}

async function getActiveDriverIds() {
  const { data } = await supabase.from("drivers").select("id").eq("is_active", true);

  return new Set((data ?? []).map((driver) => driver.id));
}

async function getActiveTeamIds() {
  const { data } = await supabase.from("teams").select("id").eq("is_active", true);

  return new Set((data ?? []).map((team) => team.id));
}

function mergeStrategyDistributions(distributions) {
  const merged = {};

  for (const distribution of distributions) {
    for (const [key, value] of Object.entries(distribution ?? {})) {
      merged[key] = (merged[key] ?? 0) + Number(value ?? 0);
    }
  }

  return merged;
}

function getOvertakingLevel(avgAbsDelta) {
  if (avgAbsDelta === null) {
    return null;
  }

  if (avgAbsDelta >= 5) {
    return "Высокая";
  }

  if (avgAbsDelta >= 2.5) {
    return "Средняя";
  }

  return "Низкая";
}

function getQualifyingImportanceLevel(startPositions) {
  if (!startPositions.length) {
    return null;
  }

  const frontRowRate = startPositions.filter((start) => start <= 2).length / startPositions.length;

  if (frontRowRate > 0.7) {
    return "Квалификация критически важна";
  }

  if (frontRowRate >= 0.4) {
    return "Квалификация важна, но стратегия тоже решает";
  }

  return "На трассе возможны прорывы";
}

function getStrategyVariabilityLevel(distribution) {
  const strategies = Object.keys(distribution ?? {}).length;

  if (strategies >= 3) {
    return "Высокая";
  }

  if (strategies === 2) {
    return "Средняя";
  }

  if (strategies === 1) {
    return "Низкая";
  }

  return null;
}

function buildCircuitAiPreview(circuit, aggregate) {
  const parts = [];

  if (aggregate.qualifyingImportanceLevel) {
    parts.push(aggregate.qualifyingImportanceLevel.replace(/^./, (letter) => letter.toUpperCase()) + ".");
  }

  if (aggregate.overtakingLevel) {
    parts.push(`Обгонность здесь ${aggregate.overtakingLevel.toLowerCase()}, поэтому стартовая позиция и чистая стратегия заметно влияют на итог.`);
  }

  if (aggregate.mostCommonStrategy) {
    parts.push(`По последним данным чаще встречается стратегия ${aggregate.mostCommonStrategy}.`);
  }

  if (aggregate.chaosScore !== null) {
    const chaos = aggregate.chaosScore >= 8 ? "высокий" : aggregate.chaosScore >= 4 ? "средний" : "низкий";
    parts.push(`Индекс хаоса сейчас ${chaos}: RaceSide учитывает сходы, Safety Car, VSC и красные флаги.`);
  }

  if (!parts.length) {
    return `RaceSide уже собирает досье трассы ${circuit.name}. Подробное превью появится после синхронизации исторических результатов.`;
  }

  return parts.slice(0, 4).join(" ");
}

function averageNumber(values) {
  const numbers = values.map(Number).filter(Number.isFinite);

  if (!numbers.length) {
    return null;
  }

  return roundNumber(numbers.reduce((sum, value) => sum + value, 0) / numbers.length, 2);
}

async function syncCalendar(options = {}) {
  const baseUrl = process.env.JOLPICA_BASE_URL ?? "https://api.jolpi.ca/ergast/f1";
  const season = resolveSyncSeason(options.season);
  const historical = options.historical ?? isHistoricalSeason(season);
  const races = await fetchJolpicaPaginatedRaces(`${baseUrl}/${season}.json`, null);

  const { error: seasonError } = await supabase.from("seasons").upsert({ year: season });

  if (seasonError) {
    throw seasonError;
  }

  let itemsProcessed = 0;
  let venueChanges = 0;

  for (const race of races) {
    const circuit = race.Circuit;
    const raceName = getCanonicalCalendarRaceName(season, race);
    const { data: circuitRow, error: circuitError } = await supabase
      .from("circuits")
      .upsert(
        {
          external_id: circuit.circuitId,
          name: circuit.circuitName,
          country: circuit.Location?.country,
          locality: circuit.Location?.locality,
          latitude: Number(circuit.Location?.lat ?? null),
          longitude: Number(circuit.Location?.long ?? null),
        },
        { onConflict: "external_id" },
      )
      .select("id")
      .single();

    if (circuitError) {
      throw circuitError;
    }

    const { data: previousRace, error: previousRaceError } = await supabase
      .from("races")
      .select("circuit_id")
      .eq("season_year", season)
      .eq("round", Number(race.round))
      .maybeSingle();

    if (previousRaceError) {
      throw previousRaceError;
    }

    const venueChanged = hasRaceVenueChanged(previousRace?.circuit_id, circuitRow?.id);

    const raceStartAt = race.date ? `${race.date}T${race.time ?? "00:00:00Z"}` : null;
    const { data: raceRow, error: raceError } = await supabase.from("races").upsert(
      {
        season_year: season,
        round: Number(race.round),
        race_name: raceName,
        circuit_id: circuitRow?.id,
        official_url: race.url,
        race_start_at: raceStartAt,
      },
      { onConflict: "season_year,round" },
    )
      .select("id")
      .single();

    if (raceError) {
      throw raceError;
    }

    if (raceRow?.id) {
      if (venueChanged && isFutureRaceStart(raceStartAt)) {
        const { error: sessionsError } = await supabase
          .from("sessions")
          .delete()
          .eq("race_id", raceRow.id);

        if (sessionsError) {
          throw sessionsError;
        }

        venueChanges += 1;
      }

      const trackAsset = {
        race_id: raceRow.id,
        circuit_id: circuitRow?.id ?? null,
        layout_slug: slugify(raceName ?? circuit.circuitId),
      };

      if (venueChanged) {
        Object.assign(trackAsset, {
          image_url: null,
          source_url: null,
          source_manifest: {},
          checksum_sha256: null,
          is_verified: false,
          verified_at: null,
        });
      }

      const { error: assetError } = await supabase.from("race_track_assets").upsert(
        trackAsset,
        { onConflict: "race_id" },
      );

      if (assetError) {
        throw assetError;
      }
    }

    await upsertScheduleSessions(raceRow?.id, race, { suppressNotifications: historical });
    itemsProcessed += 1;
  }

  return { itemsProcessed, metadata: { season, historical, venueChanges } };
}

function getCanonicalCalendarRaceName(season, race) {
  const round = Number(race?.round);
  const circuitId = String(race?.Circuit?.circuitId ?? "").toLowerCase();

  if (season === 2026 && round === 16 && circuitId === "sepang") {
    return "Malaysian Grand Prix";
  }

  return race?.raceName;
}

export function hasRaceVenueChanged(previousCircuitId, nextCircuitId) {
  return Boolean(
    previousCircuitId &&
    nextCircuitId &&
    String(previousCircuitId) !== String(nextCircuitId),
  );
}

function isFutureRaceStart(value) {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

async function isJolpicaSeasonReconciliationDue(season) {
  if (process.argv.includes("--reconcile-season")) {
    return true;
  }

  const since = new Date(Date.now() - JOLPICA_SEASON_RECONCILIATION_INTERVAL_MS).toISOString();
  const { data, error } = await supabase
    .from("job_runs")
    .select("finished_at, metadata")
    .eq("job_name", "jolpica.sync_results")
    .eq("status", "success")
    .gte("finished_at", since)
    .order("finished_at", { ascending: false })
    .limit(100);

  if (error) {
    logWorkerWarning("jolpica.season_reconciliation_state.failed", {
      reason: getSafeErrorMessage(error),
      season,
    });
    return true;
  }

  return !(data ?? []).some((run) => {
    const result = getPlainObject(getPlainObject(run.metadata).result);

    return result.seasonReconciliation === true && Number(result.season) === Number(season);
  });
}

export function applyOfficialRaceClassificationCorrection(season, race) {
  const round = Number(race?.round);
  const correction = officialRaceClassificationCorrections[`${Number(season)}-${round}`];
  const results = Array.isArray(race?.Results) ? race.Results : [];

  if (!correction || !results.length) {
    return race;
  }

  const resultsByDriver = new Map();

  for (const result of results) {
    const driverId = normalizeString(result?.Driver?.driverId)?.toLowerCase();
    const familyName = normalizeString(result?.Driver?.familyName)?.toLowerCase();

    if (driverId) {
      resultsByDriver.set(driverId, result);
    }
    if (familyName) {
      resultsByDriver.set(familyName, result);
    }
  }

  const correctedResults = correction.order.map((driverKey, index) => {
    const result = resultsByDriver.get(driverKey);

    if (!result) {
      return null;
    }

    const position = index + 1;
    const correctedTime = correction.times[index];

    return {
      ...result,
      position: String(position),
      positionText: String(position),
      points: String(correction.points[index] ?? 0),
      ...(correctedTime ? { Time: { ...(result.Time ?? {}), time: correctedTime } } : {}),
      _raceside_official_correction: {
        published_at: correction.publishedAt,
        source_url: correction.sourceUrl,
      },
    };
  });

  if (correctedResults.some((result) => !result) || correctedResults.length !== results.length) {
    return race;
  }

  return { ...race, Results: correctedResults };
}

export function getClassificationSnapshotPlan(existingRows, incomingRows) {
  const incomingDriverIds = new Set(incomingRows.map((row) => row.driver_id).filter(Boolean));
  const staleRowIds = existingRows
    .filter((row) => !incomingDriverIds.has(row.driver_id))
    .map((row) => row.id)
    .filter(Boolean);
  const existingFingerprint = createClassificationSnapshotFingerprint(existingRows);
  const incomingFingerprint = createClassificationSnapshotFingerprint(incomingRows);
  const authoritativeExistingCount = existingRows.filter((row) => "Driver" in getPlainObject(row.raw_payload)).length;

  return {
    changed: existingFingerprint !== incomingFingerprint,
    correctedExistingSnapshot: authoritativeExistingCount >= 10 && existingFingerprint !== incomingFingerprint,
    staleRowIds,
  };
}

function createClassificationSnapshotFingerprint(rows) {
  const normalized = (rows ?? [])
    .map((row) => ({
      classifiedPosition: row.classified_position ?? null,
      driverId: row.driver_id ?? null,
      fastestLap: getPlainObject(row.raw_payload).FastestLap ?? null,
      grid: numberOrNull(row.grid),
      laps: numberOrNull(row.laps),
      points: numberOrNull(row.points),
      position: numberOrNull(row.position),
      status: row.status ?? null,
      teamId: row.team_id ?? null,
      timeText: row.time_text ?? null,
    }))
    .sort((left, right) => String(left.driverId).localeCompare(String(right.driverId)));

  return hashJson(normalized);
}

async function replaceJolpicaClassificationSnapshot({ historical, results, sessionId, sessionType }) {
  if (!Array.isArray(results) || results.length < 10) {
    return { changed: false, correctedExistingSnapshot: false, itemsProcessed: 0 };
  }

  const incomingRows = [];

  for (const result of results) {
    const team = await upsertTeamFromJolpica(result.Constructor, { historical });
    const driver = await upsertDriverFromJolpica(result.Driver, team?.id, { historical });

    if (!driver?.id) {
      continue;
    }

    const shared = {
      session_id: sessionId,
      driver_id: driver.id,
      team_id: getSeasonResultTeamId(team, driver, historical),
      position: numberOrNull(result.position),
      raw_payload: result,
    };

    incomingRows.push(sessionType === "qualifying"
      ? {
        ...shared,
        classified_position: result.position ?? null,
        time_text: getBestQualifyingTime(result),
        status: getQualifyingStatus(result),
      }
      : {
        ...shared,
        classified_position: result.positionText ?? null,
        grid: numberOrNull(result.grid),
        laps: numberOrNull(result.laps),
        points: numberOrNull(result.points),
        status: result.status ?? null,
        time_text: result.Time?.time ?? null,
      });
  }

  const uniqueDriverIds = new Set(incomingRows.map((row) => row.driver_id));

  if (incomingRows.length < 10 || uniqueDriverIds.size !== incomingRows.length) {
    throw new Error(`Invalid ${sessionType} classification snapshot for session ${sessionId}`);
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("session_results")
    .select("id, driver_id, team_id, position, classified_position, grid, laps, points, status, time_text, raw_payload")
    .eq("session_id", sessionId);

  if (existingError) {
    throw existingError;
  }

  const plan = getClassificationSnapshotPlan(existingRows ?? [], incomingRows);
  const { error: upsertError } = await supabase
    .from("session_results")
    .upsert(incomingRows, { onConflict: "session_id,driver_id" });

  if (upsertError) {
    throw upsertError;
  }

  if (plan.staleRowIds.length) {
    const { error: deleteError } = await supabase
      .from("session_results")
      .delete()
      .in("id", plan.staleRowIds);

    if (deleteError) {
      throw deleteError;
    }
  }

  return {
    ...plan,
    itemsProcessed: incomingRows.length,
  };
}

async function markGrandPrixReportForClassificationRefresh(season, round) {
  const { error } = await supabase
    .from("grand_prix_reports")
    .update({
      last_error: null,
      next_refresh_at: new Date().toISOString(),
      refresh_stage: -1,
      summary_status: "pending",
    })
    .eq("season", season)
    .eq("round", round);

  if (error) {
    throw error;
  }
}

async function syncResults(options = {}) {
  const baseUrl = process.env.JOLPICA_BASE_URL ?? "https://api.jolpi.ca/ergast/f1";
  const season = resolveSyncSeason(options.season);
  const historical = options.historical ?? isHistoricalSeason(season);
  const seasonReconciliation = historical || options.reconcileSeason === true || await isJolpicaSeasonReconciliationDue(season);
  const targetRound = seasonReconciliation ? null : await getLatestStartedJolpicaRound(season);
  let [raceRows, qualifyingRows, sprintRows] = targetRound
    ? await Promise.all([
      fetchJolpicaRoundResults(baseUrl, season, targetRound, "results", "Results"),
      fetchJolpicaRoundResults(baseUrl, season, targetRound, "qualifying", "QualifyingResults"),
      fetchJolpicaRoundResults(baseUrl, season, targetRound, "sprint", "SprintResults"),
    ])
    : seasonReconciliation
      ? await Promise.all([
        fetchJolpicaPaginatedRaces(`${baseUrl}/${season}/results.json`, "Results"),
        fetchJolpicaPaginatedRaces(`${baseUrl}/${season}/qualifying.json`, "QualifyingResults"),
        fetchJolpicaPaginatedRaces(`${baseUrl}/${season}/sprint.json`, "SprintResults"),
      ])
      : [[], [], []];

  if (seasonReconciliation) {
    raceRows = await addPerRoundJolpicaRowsForCompletedRaces({
      baseUrl,
      endpoint: "results",
      resultKey: "Results",
      rows: raceRows,
      season,
    });
    qualifyingRows = await addPerRoundJolpicaRowsForCompletedRaces({
      baseUrl,
      endpoint: "qualifying",
      resultKey: "QualifyingResults",
      rows: qualifyingRows,
      rounds: await getCompletedSessionRounds(season, "qualifying"),
      season,
    });
    sprintRows = await addPerRoundJolpicaRowsForCompletedRaces({
      baseUrl,
      endpoint: "sprint",
      resultKey: "SprintResults",
      rows: sprintRows,
      rounds: await getCompletedSessionRounds(season, "sprint"),
      season,
    });
  }
  raceRows = raceRows.map((race) => applyOfficialRaceClassificationCorrection(season, race));
  const latestCompletedRaceRow = historical
    ? null
    : [...raceRows]
      .filter((race) => Array.isArray(race.Results) && race.Results.length >= 10)
      .sort((left, right) => Number(right.round ?? 0) - Number(left.round ?? 0))[0] ?? null;
  const latestCompletedRaceId = latestCompletedRaceRow
    ? await findRaceId(season, Number(latestCompletedRaceRow.round))
    : null;
  const { data: latestCompletedRaceState } = latestCompletedRaceId
    ? await supabase
      .from("races")
      .select("status")
      .eq("id", latestCompletedRaceId)
      .maybeSingle()
    : { data: null };
  const shouldPrepareNextRacePolls = Boolean(
    latestCompletedRaceId &&
    !["completed", "finished"].includes(String(latestCompletedRaceState?.status ?? "")),
  );
  let itemsProcessed = 0;
  const correctedRaceRounds = new Set();
  const changedSessionRounds = new Set();
  const fantasyRaceIdsToScore = new Set();
  const reportRefreshRounds = new Set();

  for (const race of raceRows) {
    const raceId = await findRaceId(season, Number(race.round));
    const sessionId = raceId
      ? await findOrCreateSession(raceId, "race", "Гонка", race.date, race.time)
      : null;

    if (!raceId || !sessionId) {
      continue;
    }

    await supabase
      .from("races")
      .update({ status: "completed" })
      .eq("id", raceId);
    const outcome = await replaceJolpicaClassificationSnapshot({
      historical,
      results: race.Results ?? [],
      sessionId,
      sessionType: "race",
    });
    itemsProcessed += outcome.itemsProcessed;

    if (outcome.changed) {
      changedSessionRounds.add(Number(race.round));
      fantasyRaceIdsToScore.add(raceId);
      reportRefreshRounds.add(Number(race.round));
    }
    if (outcome.correctedExistingSnapshot) {
      correctedRaceRounds.add(Number(race.round));
    }
  }

  for (const race of qualifyingRows) {
    const raceId = await findRaceId(season, Number(race.round));
    const sessionId = raceId
      ? await findOrCreateSession(raceId, "qualifying", "Квалификация", race.date, race.time)
      : null;

    if (!sessionId) {
      continue;
    }

    const outcome = await replaceJolpicaClassificationSnapshot({
      historical,
      results: race.QualifyingResults ?? [],
      sessionId,
      sessionType: "qualifying",
    });
    itemsProcessed += outcome.itemsProcessed;

    if (outcome.changed) {
      changedSessionRounds.add(Number(race.round));
    }
  }

  for (const race of sprintRows) {
    const raceId = await findRaceId(season, Number(race.round));
    const sessionId = raceId
      ? await findOrCreateSession(raceId, "sprint", "Спринт", race.date, race.time)
      : null;

    if (!sessionId) {
      continue;
    }

    const outcome = await replaceJolpicaClassificationSnapshot({
      historical,
      results: race.SprintResults ?? [],
      sessionId,
      sessionType: "sprint",
    });
    itemsProcessed += outcome.itemsProcessed;

    if (outcome.changed) {
      changedSessionRounds.add(Number(race.round));
    }
  }

  for (const round of reportRefreshRounds) {
    await markGrandPrixReportForClassificationRefresh(season, round);
  }

  const predictionRescore = fantasyRaceIdsToScore.size
    ? await scorePredictions({ raceIds: [...fantasyRaceIdsToScore] })
    : null;

  let pollRefresh = null;

  if (shouldPrepareNextRacePolls) {
    try {
      pollRefresh = await generateNextRacePolls();
    } catch (error) {
      pollRefresh = { error: getSafeErrorMessage(error) };
      logWorkerWarning("polls.generate_after_results.failed", {
        round: Number(latestCompletedRaceRow?.round ?? 0),
        season,
        reason: pollRefresh.error,
      });
    }
  }

  return {
    itemsProcessed,
    metadata: {
      season,
      historical,
      seasonReconciliation,
      targetRound,
      races: raceRows.length,
      qualifying: qualifyingRows.length,
      sprints: sprintRows.length,
      changedSessionRounds: [...changedSessionRounds].sort((left, right) => left - right),
      correctedRaceRounds: [...correctedRaceRounds].sort((left, right) => left - right),
      reportRefreshRounds: [...reportRefreshRounds].sort((left, right) => left - right),
      rescoredPredictions: predictionRescore?.itemsProcessed ?? 0,
      pollRefresh,
    },
  };
}

async function getLatestStartedJolpicaRound(season) {
  const { data, error } = await supabase
    .from("sessions")
    .select("start_at, races!inner(season_year, round)")
    .in("session_type", ["qualifying", "sprint", "race"])
    .eq("races.season_year", season)
    .not("start_at", "is", null)
    .lte("start_at", new Date().toISOString())
    .order("start_at", { ascending: false, nullsFirst: false })
    .limit(20);

  if (error) {
    throw error;
  }

  return getLatestStartedRound((data ?? []).map((session) => ({
    round: Number(firstRelation(session.races)?.round),
    startAt: session.start_at,
  })));
}

async function fetchJolpicaRoundResults(baseUrl, season, round, endpoint, resultKey) {
  const payload = await fetchJolpicaJsonObject(
    `${baseUrl}/${season}/${round}/${endpoint}.json?limit=1000`,
  );
  const race = payload.MRData?.RaceTable?.Races?.[0];

  return race && Array.isArray(race[resultKey]) && race[resultKey].length
    ? [race]
    : [];
}

async function repairRaceResults() {
  const baseUrl = process.env.JOLPICA_BASE_URL ?? "https://api.jolpi.ca/ergast/f1";
  const season = numberOrNull(getCliOption("season")) ?? Number(process.env.F1_SEASON ?? new Date().getUTCFullYear());
  const [raceResponse, sprintResponse] = await Promise.all([
    fetch(`${baseUrl}/${season}/results.json?limit=1000`),
    fetch(`${baseUrl}/${season}/sprint.json?limit=1000`),
  ]);
  const racePayload = await raceResponse.json();
  const sprintPayload = await sprintResponse.json();
  let raceRows = racePayload.MRData?.RaceTable?.Races ?? [];
  let sprintRows = sprintPayload.MRData?.RaceTable?.Races ?? [];

  raceRows = await addPerRoundJolpicaRowsForCompletedRaces({
    baseUrl,
    endpoint: "results",
    resultKey: "Results",
    rows: raceRows,
    season,
  });
  sprintRows = await addPerRoundJolpicaRowsForCompletedRaces({
    baseUrl,
    endpoint: "sprint",
    resultKey: "SprintResults",
    rows: sprintRows,
    season,
  });
  let itemsProcessed = 0;

  for (const race of raceRows) {
    itemsProcessed += await repairJolpicaClassificationSession({
      race,
      season,
      sessionType: "race",
      sessionName: "Гонка",
      results: race.Results ?? [],
    });
  }

  for (const race of sprintRows) {
    itemsProcessed += await repairJolpicaClassificationSession({
      race,
      season,
      sessionType: "sprint",
      sessionName: "Спринт",
      results: race.SprintResults ?? [],
    });
  }

  return { itemsProcessed, metadata: { season, raceRows: raceRows.length, sprintRows: sprintRows.length } };
}

async function repairQualifyingResults() {
  const baseUrl = process.env.JOLPICA_BASE_URL ?? "https://api.jolpi.ca/ergast/f1";
  const season = numberOrNull(getCliOption("season")) ?? Number(process.env.F1_SEASON ?? new Date().getUTCFullYear());
  const response = await fetch(`${baseUrl}/${season}/qualifying.json?limit=1000`);
  const payload = await response.json();
  let qualifyingRows = payload.MRData?.RaceTable?.Races ?? [];

  qualifyingRows = await addPerRoundJolpicaRowsForCompletedRaces({
    baseUrl,
    endpoint: "qualifying",
    resultKey: "QualifyingResults",
    rows: qualifyingRows,
    rounds: await getCompletedSessionRounds(season, "qualifying"),
    season,
  });

  let itemsProcessed = 0;

  for (const race of qualifyingRows) {
    itemsProcessed += await repairJolpicaQualifyingSession({
      race,
      season,
      results: race.QualifyingResults ?? [],
    });
  }

  return { itemsProcessed, metadata: { season, qualifyingRows: qualifyingRows.length } };
}

async function addPerRoundJolpicaRowsForCompletedRaces({ baseUrl, endpoint, resultKey, rows, rounds, season }) {
  const byRound = new Map(
    (rows ?? [])
      .map((race) => [Number(race.round), race])
      .filter(([round]) => Number.isFinite(round) && round > 0),
  );
  const targetRounds = rounds ?? await getCompletedRaceRounds(season);

  for (const round of targetRounds) {
    if (byRound.has(round)) {
      continue;
    }

    try {
      const payload = await fetchJolpicaJsonObject(`${baseUrl}/${season}/${round}/${endpoint}.json?limit=1000`);
      const race = payload.MRData?.RaceTable?.Races?.[0];
      const results = race?.[resultKey] ?? [];

      if (race && results.length) {
        byRound.set(round, race);
      }
    } catch (error) {
      console.warn(`Jolpica per-round ${endpoint} fetch failed for ${season}/${round}: ${error.message}`);
    }
  }

  return [...byRound.values()].sort((a, b) => Number(a.round) - Number(b.round));
}

export function shouldRetryJolpicaResponse(status, payload, attempt) {
  const invalidPayload = !payload || typeof payload !== "object" || Array.isArray(payload);
  const attemptLimit = status === 429 ? 7 : 4;

  return attempt < attemptLimit && (status === 429 || status >= 500 || invalidPayload);
}

export function shouldRetryJolpicaNetworkError(attempt) {
  return attempt < 5;
}

export function getJolpicaThrottleDelayMs(lastFetchAt, now, configuredIntervalMs = 300) {
  const parsedIntervalMs = Number(configuredIntervalMs);
  const minIntervalMs = Number.isFinite(parsedIntervalMs)
    ? Math.max(300, parsedIntervalMs)
    : 300;

  return Math.max(0, Number(lastFetchAt) + minIntervalMs - Number(now));
}

async function throttleJolpicaFetch() {
  const run = jolpicaFetchQueue.then(async () => {
    const waitMs = getJolpicaThrottleDelayMs(
      jolpicaLastFetchAt,
      Date.now(),
      process.env.JOLPICA_MIN_INTERVAL_MS,
    );

    if (waitMs > 0) {
      await sleep(waitMs);
    }

    jolpicaLastFetchAt = Date.now();
  });
  jolpicaFetchQueue = run.catch(() => {});

  await run;
}

async function fetchJolpicaJsonObject(url, attempt = 1) {
  let response;

  try {
    await throttleJolpicaFetch();
    response = await fetch(url, {
      headers: { "user-agent": "RaceSide/0.1 (+https://racemate.local)" },
      signal: AbortSignal.timeout(Number(process.env.JOLPICA_FETCH_TIMEOUT_MS ?? 15000)),
    });
  } catch (error) {
    if (!shouldRetryJolpicaNetworkError(attempt)) {
      throw error;
    }

    await sleep(Math.min(30_000, 2_500 * (2 ** (attempt - 1))));
    return fetchJolpicaJsonObject(url, attempt + 1);
  }

  const payload = await readJsonResponse(response);

  if (shouldRetryJolpicaResponse(response.status, payload, attempt)) {
    const retryDelayMs = response.status === 429
      ? Math.min(60_000, 5_000 * (2 ** (attempt - 1)))
      : 2_500 * attempt;
    await sleep(retryDelayMs);
    return fetchJolpicaJsonObject(url, attempt + 1);
  }

  if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Jolpica fetch failed ${response.status}: ${url}`);
  }

  return payload;
}

async function getCompletedRaceRounds(season) {
  const [raceResult, standingRounds] = await Promise.all([
    supabase
      .from("races")
      .select("round, race_start_at, status")
      .eq("season_year", season)
      .order("round", { ascending: true }),
    getCompletedStandingRounds(season),
  ]);
  const { data, error } = raceResult;

  if (error) {
    throw error;
  }

  const standingRoundSet = new Set(standingRounds);
  const rounds = new Set();

  (data ?? [])
    .filter((race) => {
      const round = Number(race.round);

      return (
        race.status === "completed" ||
        hasRaceResultProbeWindowElapsed(race.race_start_at) ||
        (standingRoundSet.has(round) && hasRaceCompletionWindowElapsed(race.race_start_at))
      );
    })
    .map((race) => Number(race.round))
    .filter((round) => Number.isFinite(round) && round > 0)
    .forEach((round) => rounds.add(round));

  return [...rounds].sort((a, b) => a - b);
}

async function getCompletedStandingRounds(season) {
  const { data, error } = await supabase
    .from("driver_standings")
    .select("round")
    .eq("season_year", season)
    .not("round", "is", null)
    .limit(1000);

  if (error) {
    throw error;
  }

  const rowCounts = new Map();

  for (const row of data ?? []) {
    const round = numberOrNull(row.round);

    if (!round) {
      continue;
    }

    rowCounts.set(round, (rowCounts.get(round) ?? 0) + 1);
  }

  return [...rowCounts.entries()]
    .filter(([, count]) => count >= 10)
    .map(([round]) => round)
    .sort((a, b) => a - b);
}

async function getCompletedSessionRounds(season, sessionType) {
  const { data, error } = await supabase
    .from("sessions")
    .select("session_type, start_at, races!inner(season_year, round)")
    .eq("session_type", sessionType)
    .eq("races.season_year", season)
    .order("start_at", { ascending: true, nullsFirst: false });

  if (error) {
    throw error;
  }

  const now = Date.now();
  const durationMs = getResultReadyDurationMs(sessionType);
  const rounds = new Set();

  for (const session of data ?? []) {
    const startAt = session.start_at ? new Date(session.start_at).getTime() : 0;
    const race = Array.isArray(session.races) ? session.races[0] : session.races;
    const round = Number(race?.round);

    if (!Number.isFinite(round) || round <= 0 || !startAt) {
      continue;
    }

    if (startAt + durationMs <= now) {
      rounds.add(round);
    }
  }

  return [...rounds].sort((a, b) => a - b);
}

function getResultReadyDurationMs(sessionType) {
  if (sessionType === "race") {
    return 3 * 60 * 60 * 1000;
  }

  if (sessionType === "sprint") {
    return 75 * 60 * 1000;
  }

  return 90 * 60 * 1000;
}

function hasSessionCompletionWindowElapsed(startAt, sessionType) {
  const timestamp = startAt ? new Date(startAt).getTime() : 0;

  return Number.isFinite(timestamp) && timestamp > 0 && timestamp + getResultReadyDurationMs(sessionType) <= Date.now();
}

function hasRaceCompletionWindowElapsed(raceStartAt) {
  return hasSessionCompletionWindowElapsed(raceStartAt, "race");
}

function hasRaceResultProbeWindowElapsed(raceStartAt) {
  const timestamp = raceStartAt ? new Date(raceStartAt).getTime() : 0;

  return Number.isFinite(timestamp) && timestamp > 0 && timestamp + 75 * 60 * 1000 <= Date.now();
}

async function repairJolpicaClassificationSession({ race, season, sessionType, sessionName, results }) {
  const historical = isHistoricalSeason(season);
  const raceId = await findRaceId(season, Number(race.round));
  const sessionId = raceId
    ? await findOrCreateSession(raceId, sessionType, sessionName, race.date, race.time)
    : null;

  if (!raceId || !sessionId || !results.length) {
    return 0;
  }

  if (sessionType === "race") {
    await supabase.from("races").update({ status: "completed" }).eq("id", raceId);
  }
  const correctedResults = sessionType === "race"
    ? applyOfficialRaceClassificationCorrection(season, { ...race, Results: results }).Results
    : results;
  const outcome = await replaceJolpicaClassificationSnapshot({
    historical,
    results: correctedResults,
    sessionId,
    sessionType,
  });

  if (sessionType === "race" && outcome.changed) {
    await markGrandPrixReportForClassificationRefresh(season, Number(race.round));
  }

  return outcome.itemsProcessed;
}

async function repairJolpicaQualifyingSession({ race, season, results }) {
  const historical = isHistoricalSeason(season);
  const raceId = await findRaceId(season, Number(race.round));
  const sessionId = raceId
    ? await findOrCreateSession(raceId, "qualifying", "Квалификация", race.date, race.time)
    : null;

  if (!sessionId || !results.length) {
    return 0;
  }
  const outcome = await replaceJolpicaClassificationSnapshot({
    historical,
    results,
    sessionId,
    sessionType: "qualifying",
  });

  return outcome.itemsProcessed;
}

async function getSeasonRounds(season) {
  const { data, error } = await supabase
    .from("races")
    .select("round")
    .eq("season_year", season)
    .order("round", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? [])
    .map((race) => numberOrNull(race.round))
    .filter((round) => round && round > 0);
}

async function fetchJolpicaSeasonStandings({ baseUrl, endpoint, entityKey, rounds, season }) {
  const listsByRound = new Map();

  for (const round of rounds) {
    const roundPath = round ? `/${round}` : "";
    const lists = await fetchJolpicaPaginatedStandingsLists(
      `${baseUrl}/${season}${roundPath}/${endpoint}.json`,
      entityKey,
    );

    for (const list of lists) {
      const listRound = numberOrNull(list.round);

      if (listRound) {
        listsByRound.set(listRound, list);
      }
    }
  }

  return [...listsByRound.values()].sort((left, right) => Number(left.round) - Number(right.round));
}

async function fetchJolpicaPaginatedStandingsLists(url, entityKey) {
  const maxLimit = Math.max(1, Math.min(Number(process.env.JOLPICA_PAGE_LIMIT ?? 100), 100));
  const maxPages = Math.max(1, Number(process.env.JOLPICA_MAX_PAGES ?? 80));
  const listsByRound = new Map();
  let offset = 0;
  let total = null;
  let pages = 0;

  while (pages < maxPages && (total === null || offset < total)) {
    const separator = url.includes("?") ? "&" : "?";
    const payload = await fetchJolpicaJsonObject(`${url}${separator}limit=${maxLimit}&offset=${offset}`);
    const mrData = payload.MRData ?? {};
    const pageLimit = Math.max(1, numberOrNull(mrData.limit) ?? maxLimit);
    const pageTotal = numberOrNull(mrData.total);
    const pageLists = mrData.StandingsTable?.StandingsLists ?? [];

    for (const list of pageLists) {
      const key = `${list.season}-${list.round}`;
      const current = listsByRound.get(key);
      const entities = Array.isArray(list[entityKey]) ? list[entityKey] : [];

      if (!current) {
        listsByRound.set(key, {
          ...list,
          [entityKey]: dedupeJolpicaStandingEntities(entities, entityKey),
        });
      } else {
        current[entityKey] = dedupeJolpicaStandingEntities(
          [...(current[entityKey] ?? []), ...entities],
          entityKey,
        );
      }
    }

    pages += 1;
    total = pageTotal ?? offset + pageLimit;
    offset += pageLimit;

    if (!pageLists.length) {
      break;
    }
  }

  if (total !== null && offset < total) {
    throw new Error(`Jolpica standings pagination stopped at ${offset} of ${total}: ${url}`);
  }

  return [...listsByRound.values()];
}

function dedupeJolpicaStandingEntities(entities, entityKey) {
  const seen = new Set();

  return (entities ?? []).filter((entity) => {
    const id = entityKey === "DriverStandings"
      ? entity.Driver?.driverId
      : entity.Constructor?.constructorId;

    if (!id || seen.has(id)) {
      return false;
    }

    seen.add(id);
    return true;
  });
}

async function syncStandings(options = {}) {
  const baseUrl = process.env.JOLPICA_BASE_URL ?? "https://api.jolpi.ca/ergast/f1";
  const season = resolveSyncSeason(options.season);
  const historical = options.historical ?? isHistoricalSeason(season);
  const everyRound = options.everyRound ?? false;
  const rounds = everyRound ? await getSeasonRounds(season) : [null];
  const [driverLists, constructorLists] = await Promise.all([
    fetchJolpicaSeasonStandings({
      baseUrl,
      endpoint: "driverstandings",
      entityKey: "DriverStandings",
      rounds,
      season,
    }),
    fetchJolpicaSeasonStandings({
      baseUrl,
      endpoint: "constructorstandings",
      entityKey: "ConstructorStandings",
      rounds,
      season,
    }),
  ]);
  const completedStandingRounds = new Set();
  let itemsProcessed = 0;

  const { error: seasonError } = await supabase.from("seasons").upsert({ year: season });

  if (seasonError) {
    throw seasonError;
  }

  for (const list of driverLists) {
    const round = numberOrNull(list.round);
    const driverStandings = list.DriverStandings ?? [];

    if (round && driverStandings.length >= 10) {
      completedStandingRounds.add(round);
    }

    for (const standing of driverStandings) {
      const constructor = standing.Constructors?.[0];
      const team = await upsertTeamFromJolpica(constructor, { historical });
      const driver = await upsertDriverFromJolpica(standing.Driver, team?.id, { historical });

      if (!driver?.id) {
        continue;
      }

      const { error: driverStandingError } = await supabase.from("driver_standings").upsert(
        {
          season_year: season,
          round,
          driver_id: driver.id,
          team_id: getSeasonResultTeamId(team, driver, historical),
          position: numberOrNull(standing.position),
          points: numberOrNull(standing.points) ?? 0,
          wins: numberOrNull(standing.wins) ?? 0,
          raw_payload: standing,
        },
        { onConflict: "season_year,round,driver_id" },
      );

      if (driverStandingError) {
        throw driverStandingError;
      }

      itemsProcessed += 1;
    }
  }

  for (const list of constructorLists) {
    const round = numberOrNull(list.round);
    const constructorStandings = list.ConstructorStandings ?? [];

    if (round && constructorStandings.length >= 5) {
      completedStandingRounds.add(round);
    }

    for (const standing of constructorStandings) {
      const team = await upsertTeamFromJolpica(standing.Constructor, { historical });

      if (!team?.id) {
        continue;
      }

      const { error: constructorStandingError } = await supabase.from("constructor_standings").upsert(
        {
          season_year: season,
          round,
          team_id: team.id,
          position: numberOrNull(standing.position),
          points: numberOrNull(standing.points) ?? 0,
          wins: numberOrNull(standing.wins) ?? 0,
          raw_payload: standing,
        },
        { onConflict: "season_year,round,team_id" },
      );

      if (constructorStandingError) {
        throw constructorStandingError;
      }

      itemsProcessed += 1;
    }
  }

  const completedRaces = await markRacesCompletedFromStandings(season, completedStandingRounds);

  return {
    itemsProcessed,
    metadata: {
      season,
      historical,
      everyRound,
      standingsRounds: [...completedStandingRounds].sort((a, b) => a - b),
      completedRaceRounds: completedRaces.map((race) => race.round).sort((a, b) => a - b),
      completedRacesMarked: completedRaces.length,
    },
  };
}

async function backfillHistoricalSeason() {
  return backfillHistoricalSeasonByYear(getCliOption("season"));
}

async function backfillHistoricalSeasonByYear(value, { validateAfter = true } = {}) {
  const season = requireHistoricalSeason(value);
  const calendar = await syncCalendar({ season, historical: true });
  const results = await syncResults({ season, historical: true });
  const standings = await syncStandings({ season, historical: true, everyRound: true });
  const profiles = await rebuildSeasonProfiles(season);
  const validation = validateAfter ? await validateSeasonReadiness(season) : null;

  return {
    itemsProcessed:
      calendar.itemsProcessed +
      results.itemsProcessed +
      standings.itemsProcessed +
      profiles.itemsProcessed,
    metadata: {
      season,
      calendar: calendar.metadata,
      results: results.metadata,
      standings: standings.metadata,
      profiles: profiles.metadata,
      validation,
    },
  };
}

async function syncSeasonAssets() {
  const season = requireManagedSeason(getCliOption("season"));

  return syncSeasonAssetsForSeason(season);
}

async function syncSeasonAssetsForSeason(
  season,
  { strict = false, validateAfter = true } = {},
) {
  const manifestPaths = {
    circuits: `public/f1/circuits/${season}/manifest.json`,
    teams: `public/f1/teams/manifests/${season}.json`,
    drivers: `public/drivers/avatars/${season}/manifest.json`,
  };
  const circuitManifest = readLocalAssetManifest(manifestPaths.circuits, season);
  const teamManifest = readLocalAssetManifest(manifestPaths.teams, season);
  const driverManifest = readLocalAssetManifest(manifestPaths.drivers, season);
  const integrityIssues = [];
  const [circuitAssets, teamAssets, driverAssets] = await Promise.all([
    prepareCircuitAssetRows({ integrityIssues, manifest: circuitManifest, manifestPath: manifestPaths.circuits, season }),
    prepareTeamAssetRows({ integrityIssues, manifest: teamManifest, manifestPath: manifestPaths.teams, season }),
    prepareDriverAssetRows({ integrityIssues, manifest: driverManifest, manifestPath: manifestPaths.drivers, season }),
  ]);

  if (integrityIssues.length) {
    throw new Error(`Season ${season} asset integrity check failed: ${integrityIssues.join("; ")}`);
  }

  if (strict) {
    await assertStrictSeasonAssetCompleteness({
      circuitAssets,
      circuitManifest,
      driverAssets,
      driverManifest,
      season,
      teamAssets,
      teamManifest,
    });
  }

  const writes = [];

  if (circuitAssets.rows.length) {
    writes.push(
      supabase
        .from("race_track_assets")
        .upsert(circuitAssets.rows, { onConflict: "race_id" }),
    );
  }

  if (teamAssets.rows.length) {
    writes.push(
      supabase
        .from("team_season_profiles")
        .upsert(teamAssets.rows, { onConflict: "season_year,team_id" }),
    );
  }

  if (driverAssets.rows.length) {
    writes.push(
      supabase
        .from("driver_season_profiles")
        .upsert(driverAssets.rows, { onConflict: "season_year,driver_id" }),
    );
  }

  const writeResults = await Promise.all(writes);

  for (const result of writeResults) {
    if (result.error) {
      throw result.error;
    }
  }

  const validation = validateAfter ? await validateSeasonReadiness(season) : null;

  return {
    itemsProcessed: circuitAssets.rows.length + teamAssets.rows.length + driverAssets.rows.length,
    metadata: {
      season,
      circuits: circuitAssets.metadata,
      teams: teamAssets.metadata,
      drivers: driverAssets.metadata,
      validation,
    },
  };
}

function readLocalAssetManifest(relativePath, expectedSeason) {
  const absolutePath = resolve(process.cwd(), relativePath);
  const workspaceRoot = `${resolve(process.cwd())}/`;

  if (!absolutePath.startsWith(workspaceRoot) || !existsSync(absolutePath)) {
    throw new Error(`Asset manifest is missing: ${relativePath}`);
  }

  let manifest;

  try {
    manifest = JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot parse ${relativePath}: ${getSafeErrorMessage(error)}`);
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`Asset manifest must be a JSON object: ${relativePath}`);
  }

  if (Number(manifest.season) !== Number(expectedSeason)) {
    throw new Error(`Asset manifest season mismatch in ${relativePath}`);
  }

  return manifest;
}

async function prepareCircuitAssetRows({ integrityIssues, manifest, manifestPath, season }) {
  const { data: races, error } = await supabase
    .from("races")
    .select("id, round, circuit_id")
    .eq("season_year", season)
    .order("round", { ascending: true });

  if (error) {
    throw error;
  }

  const sourcesByRound = new Map(
    (Array.isArray(manifest.sources) ? manifest.sources : [])
      .map((source) => [Number(source.round), source])
      .filter(([round]) => Number.isInteger(round) && round > 0),
  );
  const rows = [];
  const missingRounds = [];

  for (const race of races ?? []) {
    const source = sourcesByRound.get(Number(race.round));

    if (!source) {
      missingRounds.push(Number(race.round));
      continue;
    }

    const label = `circuit ${season}/${race.round}`;
    const fileValid = verifyLocalAssetFile({
      asset: source,
      expectedPrefix: `/f1/circuits/${season}/`,
      integrityIssues,
      label,
      requireFile: true,
    });

    if (!source.pageUrl || !source.sourceUrl) {
      integrityIssues.push(`${label} has no official page/source URL`);
    }

    if (!fileValid) {
      continue;
    }

    const sourceManifest = {
      downloadedAt: manifest.downloadedAt ?? null,
      manifestPath,
      rightsReview: manifest.rightsReview ?? null,
      rightsReviewRequired: manifest.rightsReviewRequired === true,
      ...source,
    };
    const approved = hasApprovedCircuitAssetManifest(sourceManifest);

    rows.push({
      race_id: race.id,
      circuit_id: race.circuit_id,
      layout_slug: source.layoutSlug ?? slugify(source.raceName ?? `round-${race.round}`),
      image_url: source.file,
      source_url: source.pageUrl,
      source_manifest: sourceManifest,
      checksum_sha256: String(source.sha256).toLowerCase(),
      is_verified: approved,
      verified_at: approved
        ? (source.manualReview?.reviewedAt ?? new Date().toISOString())
        : null,
    });
  }

  return {
    rows,
    metadata: {
      manifest: manifestPath,
      manifestComplete: manifest.complete ?? missingRounds.length === 0,
      manifestRounds: [...sourcesByRound.keys()].sort((left, right) => left - right),
      missingRounds,
      verified: rows.filter((row) => row.is_verified).length,
    },
  };
}

async function prepareTeamAssetRows({ integrityIssues, manifest, manifestPath, season }) {
  const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
  const constructorIds = [...new Set(sources.map((source) => source.constructorId).filter(Boolean))];
  const [teamsResult, lineagesResult] = await Promise.all([
    constructorIds.length
      ? supabase
        .from("teams")
        .select("id, external_id, code, name, short_name, country, color_hex")
        .in("external_id", constructorIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("team_lineages").select("id, slug"),
  ]);

  if (teamsResult.error) {
    throw teamsResult.error;
  }

  if (lineagesResult.error) {
    throw lineagesResult.error;
  }

  const teamsByExternalId = new Map((teamsResult.data ?? []).map((team) => [team.external_id, team]));
  const lineagesBySlug = new Map((lineagesResult.data ?? []).map((lineage) => [lineage.slug, lineage]));
  const rightsReviewStatus = getRightsReviewStatus(manifest);
  const rightsApproved = !manifest.rightsReviewRequired || ["approved", "cleared"].includes(rightsReviewStatus);
  const rows = [];
  const pending = [];

  for (const source of sources) {
    const constructorId = source.constructorId;
    const label = `team ${season}/${constructorId ?? "unknown"}`;
    const team = teamsByExternalId.get(constructorId);

    if (!team?.id) {
      integrityIssues.push(`${label} does not match a Jolpica constructor identity`);
      continue;
    }

    let lineageSlug;

    try {
      lineageSlug = resolveTeamLineageSlug(constructorId);
    } catch (error) {
      integrityIssues.push(getSafeErrorMessage(error));
      continue;
    }

    const lineage = lineagesBySlug.get(lineageSlug);

    if (!lineage?.id) {
      integrityIssues.push(`${label} has no seeded lineage ${lineageSlug}`);
      continue;
    }

    const carValid = verifyLocalAssetFile({
      asset: source.car,
      expectedPrefix: `/f1/teams/cars/${season}/`,
      integrityIssues,
      label: `${label} car`,
      requireFile: true,
    });
    const logoValid = verifyLocalAssetFile({
      asset: source.logo,
      expectedPrefix: `/f1/teams/logos/${season}/`,
      integrityIssues,
      label: `${label} logo`,
      requireFile: true,
    });

    if (!carValid || !logoValid) {
      continue;
    }

    const carReview = getManualReviewStatus(source.car);
    const logoReview = getManualReviewStatus(source.logo);
    const approved = carReview === "approved" && logoReview === "approved" && rightsApproved;

    if (!approved) {
      pending.push(constructorId);
    }

    rows.push({
      season_year: season,
      team_id: team.id,
      lineage_id: lineage.id,
      display_name: source.name ?? team.name,
      short_name: team.short_name,
      code: team.code,
      country: team.country,
      color_hex: getSeasonTeamColor(season, constructorId, source.colorHex, team.color_hex),
      logo_image_url: source.logo.file,
      car_image_url: source.car.file,
      source_urls: [
        {
          kind: "team-season-assets",
          manifestPath,
          sourcePolicy: manifest.sourcePolicy ?? null,
          rightsReviewRequired: Boolean(manifest.rightsReviewRequired),
          rightsReviewStatus,
          colorHex: source.colorHex ?? null,
          car: source.car,
          logo: source.logo,
        },
      ],
      assets_verified_at: approved ? new Date().toISOString() : null,
    });
  }

  return {
    rows,
    metadata: {
      complete: Boolean(manifest.complete),
      constructorIds,
      manifest: manifestPath,
      missing: Array.isArray(manifest.missing) ? manifest.missing : [],
      pending,
      rightsReviewRequired: Boolean(manifest.rightsReviewRequired),
      rightsReviewStatus,
      verified: rows.length - pending.length,
    },
  };
}

async function prepareDriverAssetRows({ integrityIssues, manifest, manifestPath, season }) {
  const entries = Array.isArray(manifest.drivers) ? manifest.drivers : [];
  const driverExternalIds = [...new Set(entries.map((entry) => entry.externalId).filter(Boolean))];
  const teamExternalIds = [
    ...new Set(entries.map((entry) => entry.team?.externalId).filter(Boolean)),
  ];
  const [driversResult, teamsResult] = await Promise.all([
    driverExternalIds.length
      ? supabase
        .from("drivers")
        .select("id, external_id, code, permanent_number")
        .in("external_id", driverExternalIds)
      : Promise.resolve({ data: [], error: null }),
    teamExternalIds.length
      ? supabase
        .from("teams")
        .select("id, external_id")
        .in("external_id", teamExternalIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (driversResult.error) {
    throw driversResult.error;
  }

  if (teamsResult.error) {
    throw teamsResult.error;
  }

  const driversByExternalId = new Map((driversResult.data ?? []).map((driver) => [driver.external_id, driver]));
  const teamsByExternalId = new Map((teamsResult.data ?? []).map((team) => [team.external_id, team]));
  const driverIds = (driversResult.data ?? []).map((driver) => driver.id);
  const { data: existingProfiles, error: profileError } = driverIds.length
    ? await supabase
      .from("driver_season_profiles")
      .select("driver_id, primary_team_id, permanent_number, starts")
      .eq("season_year", season)
      .in("driver_id", driverIds)
    : { data: [], error: null };

  if (profileError) {
    throw profileError;
  }

  const profilesByDriverId = new Map((existingProfiles ?? []).map((profile) => [profile.driver_id, profile]));
  const rows = [];
  const pending = [];

  for (const entry of entries) {
    const label = `driver ${season}/${entry.externalId ?? "unknown"}`;
    const driver = driversByExternalId.get(entry.externalId);
    const team = teamsByExternalId.get(entry.team?.externalId);

    if (!driver?.id) {
      integrityIssues.push(`${label} does not match a Jolpica driver identity`);
      continue;
    }

    if (!team?.id) {
      integrityIssues.push(`${label} does not match constructor ${entry.team?.externalId ?? "missing"}`);
      continue;
    }

    const reviewStatus = getManualReviewStatus(entry.manualReview);
    const hasAssetMetadata = Boolean(entry.file || entry.sha256);
    const fileValid = hasAssetMetadata
      ? verifyLocalAssetFile({
        asset: entry,
        expectedPrefix: `/drivers/avatars/${season}/`,
        integrityIssues,
        label,
        requireFile: reviewStatus === "approved",
      })
      : false;

    if (reviewStatus === "approved" && !fileValid) {
      integrityIssues.push(`${label} cannot be approved without a verified local file`);
      continue;
    }

    const helmetReferenceValid = isHelmetVisualReference(entry.helmetReferenceUrl);

    if (isHistoricalSeason(season) && reviewStatus === "approved" && !helmetReferenceValid) {
      integrityIssues.push(`${label} cannot be approved without an exact seasonal helmet reference`);
      continue;
    }

    const existing = profilesByDriverId.get(driver.id);

    if (existing?.primary_team_id && existing.primary_team_id !== team.id) {
      integrityIssues.push(`${label} team does not match the starts-derived primary team`);
      continue;
    }

    const approved = reviewStatus === "approved" && fileValid;

    if (!approved) {
      pending.push(entry.externalId);
    }

    rows.push({
      season_year: season,
      driver_id: driver.id,
      primary_team_id: existing?.primary_team_id ?? team.id,
      code: driver.code,
      permanent_number:
        numberOrNull(entry.permanentNumber) ??
        existing?.permanent_number ??
        driver.permanent_number,
      starts: existing?.starts ?? numberOrNull(entry.starts) ?? 0,
      avatar_image_url: fileValid ? entry.file : null,
      avatar_prompt: entry.prompt ?? null,
      avatar_reference_url: helmetReferenceValid ? entry.helmetReferenceUrl : null,
      avatar_review_status: reviewStatus,
      source_urls: [
        {
          kind: "driver-season-avatar",
          season,
          manifestPath,
          promptVersion: entry.promptVersion ?? manifest.promptVersion ?? null,
          helmetReferencePolicy: manifest.helmetReferencePolicy ?? null,
          identityReferenceUrl: entry.identityReferenceUrl ?? null,
          helmetReferenceUrl: helmetReferenceValid ? entry.helmetReferenceUrl : null,
          sha256: entry.sha256 ?? null,
          source: entry.source ?? null,
          team: entry.team ?? null,
          manualReview: entry.manualReview ?? null,
        },
      ],
      assets_verified_at: approved
        ? (entry.manualReview?.reviewedAt ?? new Date().toISOString())
        : null,
    });
  }

  return {
    rows,
    metadata: {
      complete: Boolean(manifest.complete),
      externalIds: driverExternalIds,
      manifest: manifestPath,
      pending,
      promptVersion: manifest.promptVersion ?? null,
      verified: rows.length - pending.length,
    },
  };
}

export function verifyLocalAssetFile({ asset, expectedPrefix, integrityIssues, label, requireFile }) {
  const file = asset?.file;
  const checksum = asset?.sha256;

  if (!file || !checksum) {
    if (requireFile) {
      integrityIssues.push(`${label} has no file or sha256`);
    }

    return false;
  }

  if (!String(file).startsWith(expectedPrefix) || !/^[0-9a-f]{64}$/i.test(String(checksum))) {
    integrityIssues.push(`${label} has an invalid local URL or sha256`);
    return false;
  }

  const publicRoot = resolve(process.cwd(), "public");
  const absolutePath = resolve(publicRoot, String(file).replace(/^\/+/, ""));
  const expectedRoot = resolve(publicRoot, String(expectedPrefix).replace(/^\/+/, ""));

  if (
    !absolutePath.startsWith(`${publicRoot}/`) ||
    !absolutePath.startsWith(`${expectedRoot}/`) ||
    !existsSync(absolutePath)
  ) {
    integrityIssues.push(`${label} local file is missing: ${file}`);
    return false;
  }

  const actualChecksum = createHash("sha256").update(readFileSync(absolutePath)).digest("hex");

  if (actualChecksum !== String(checksum).toLowerCase()) {
    integrityIssues.push(`${label} sha256 does not match ${file}`);
    return false;
  }

  return true;
}

function getManualReviewStatus(value) {
  const status = String(value?.status ?? value?.manualReviewStatus ?? value ?? "missing").toLowerCase();

  return ["pending", "approved", "rejected"].includes(status) ? status : "missing";
}

function getRightsReviewStatus(manifest) {
  const status = String(
    manifest.rightsReview?.status ??
    manifest.rightsReviewStatus ??
    (manifest.rightsReviewRequired ? "pending" : "not-required"),
  ).toLowerCase();

  return status;
}

async function assertStrictSeasonAssetCompleteness({
  circuitAssets,
  circuitManifest,
  driverAssets,
  driverManifest,
  season,
  teamAssets,
  teamManifest,
}) {
  const participantIds = await getSeasonRaceParticipantExternalIds(season);
  const driverAvatarsRequired = requiresDriverAvatarAssets(season);
  const issues = [];

  if (circuitManifest.complete !== true) {
    issues.push("circuit manifest is not explicitly complete");
  }

  if (teamManifest.complete !== true || teamAssets.metadata.missing.length) {
    issues.push("team manifest is incomplete");
  }

  if (driverAvatarsRequired && driverManifest.complete !== true) {
    issues.push("driver manifest is not explicitly complete");
  }

  appendExactSetIssue(
    issues,
    "circuit rounds",
    participantIds.rounds,
    circuitAssets.metadata.manifestRounds,
  );
  appendExactSetIssue(
    issues,
    "constructors",
    participantIds.constructorIds,
    teamAssets.metadata.constructorIds,
  );
  appendExactSetIssue(
    issues,
    "drivers",
    participantIds.driverIds,
    driverAssets.metadata.externalIds,
  );

  if ((circuitManifest.sources ?? []).length !== circuitAssets.metadata.manifestRounds.length) {
    issues.push("circuit manifest contains duplicate or invalid rounds");
  }

  if ((teamManifest.sources ?? []).length !== teamAssets.metadata.constructorIds.length) {
    issues.push("team manifest contains duplicate or invalid constructor identities");
  }

  if ((driverManifest.drivers ?? []).length !== driverAssets.metadata.externalIds.length) {
    issues.push("driver manifest contains duplicate or invalid driver identities");
  }

  if (
    circuitAssets.rows.length !== participantIds.rounds.size ||
    circuitAssets.rows.some((row) => !hasApprovedCircuitAssetManifest(row.source_manifest))
  ) {
    issues.push("circuit assets are not all manually approved");
  }

  if (
    teamAssets.metadata.pending.length ||
    teamAssets.rows.length !== participantIds.constructorIds.size ||
    teamAssets.rows.some((row) => !hasApprovedTeamAssetManifest(row.source_urls))
  ) {
    issues.push("team assets or usage rights are not all approved");
  }

  if (
    driverAvatarsRequired &&
    (
      driverAssets.metadata.pending.length ||
      driverAssets.rows.length !== participantIds.driverIds.size ||
      driverAssets.rows.some((row) => !hasApprovedDriverAssetManifest(row.source_urls))
    )
  ) {
    issues.push("driver avatars are not all manually approved");
  }

  if (issues.length) {
    throw new Error(`Season ${season} strict asset gate failed: ${issues.join("; ")}`);
  }
}

async function getSeasonRaceParticipantExternalIds(season) {
  const sportingData = await getSeasonSportingData(season);
  const raceIdsBySessionId = new Map(
    sportingData.sessions
      .filter((session) => session.session_type === "race")
      .map((session) => [session.id, session.race_id]),
  );
  const raceResults = sportingData.results.filter((result) => raceIdsBySessionId.has(result.session_id));
  const driverIds = [...new Set(raceResults.map((result) => result.driver_id).filter(Boolean))];
  const teamIds = [...new Set(raceResults.map((result) => result.team_id).filter(Boolean))];
  const [driversResult, teamsResult] = await Promise.all([
    driverIds.length
      ? supabase.from("drivers").select("id, external_id").in("id", driverIds)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length
      ? supabase.from("teams").select("id, external_id").in("id", teamIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (driversResult.error) {
    throw driversResult.error;
  }

  if (teamsResult.error) {
    throw teamsResult.error;
  }

  if ((driversResult.data ?? []).length !== driverIds.length) {
    throw new Error(`Season ${season} has race results with an unknown driver identity`);
  }

  if ((teamsResult.data ?? []).length !== teamIds.length) {
    throw new Error(`Season ${season} has race results with an unknown constructor identity`);
  }

  return {
    constructorIds: new Set((teamsResult.data ?? []).map((team) => team.external_id).filter(Boolean)),
    driverIds: new Set((driversResult.data ?? []).map((driver) => driver.external_id).filter(Boolean)),
    rounds: new Set(sportingData.races.map((race) => Number(race.round))),
  };
}

function appendExactSetIssue(issues, label, expectedValues, actualValues) {
  const expected = new Set(expectedValues ?? []);
  const actual = new Set(actualValues ?? []);
  const missing = [...expected].filter((value) => !actual.has(value));
  const extra = [...actual].filter((value) => !expected.has(value));

  if (missing.length || extra.length) {
    issues.push(
      `${label} differ (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`,
    );
  }
}

async function validateSeasonCommand() {
  const season = requireHistoricalSeason(getCliOption("season"));
  const validation = await validateSeasonReadiness(season);

  return {
    itemsProcessed: validation.counts.races,
    metadata: validation,
  };
}

export function getHistoricalSeasonYears(value) {
  if (value !== undefined && value !== null && String(value).trim() !== "") {
    return [requireHistoricalSeason(value)];
  }

  const years = [];

  for (let season = historicalSeasonRange.from; season <= historicalSeasonRange.to; season += 1) {
    years.push(season);
  }

  return years;
}

async function prepareHistoricalSeasons() {
  const preparedSeasons = [];
  let itemsProcessed = 0;

  for (const season of getHistoricalSeasonYears(getCliOption("season"))) {
    const backfill = await backfillHistoricalSeasonByYear(season, { validateAfter: false });
    const assets = await syncSeasonAssetsForSeason(season, {
      strict: false,
      validateAfter: false,
    });
    const validation = await validateSeasonReadiness(season);

    itemsProcessed += backfill.itemsProcessed + assets.itemsProcessed;
    preparedSeasons.push({
      season,
      backfill: backfill.metadata,
      assets: assets.metadata,
      validation,
    });
  }

  return {
    itemsProcessed,
    metadata: {
      mode: "preview",
      publicationChanged: false,
      ready: preparedSeasons.every((entry) => entry.validation.ready),
      seasons: preparedSeasons,
    },
  };
}

async function publishHistoricalSeasons() {
  const years = getHistoricalSeasonYears();

  const validations = [];

  for (const season of years) {
    await syncSeasonAssetsForSeason(season, { strict: true, validateAfter: false });
    validations.push(await validateSeasonReadiness(season));
  }

  const blocked = validations.filter((validation) => !validation.ready);

  if (blocked.length) {
    const summary = blocked
      .map((validation) => `${validation.season}: ${validation.issues.join(", ")}`)
      .join("; ");
    throw new Error(`Historical seasons are not ready for publication: ${summary}`);
  }

  const publishedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("seasons")
    .update({ is_published: true, published_at: publishedAt })
    .in("year", years)
    .select("year");

  if (error) {
    throw error;
  }

  if ((data ?? []).length !== years.length) {
    throw new Error(`Expected to publish ${years.length} seasons, published ${(data ?? []).length}`);
  }

  return {
    itemsProcessed: data.length,
    metadata: {
      publishedAt,
      seasons: data.map((season) => season.year).sort((left, right) => left - right),
      validations,
    },
  };
}

async function rebuildSeasonProfiles(season) {
  const sportingData = await getSeasonSportingData(season);
  const raceRoundById = new Map(sportingData.races.map((race) => [race.id, Number(race.round)]));
  const sessionById = new Map(sportingData.sessions.map((session) => [session.id, session]));
  const raceEntries = sportingData.results
    .filter((result) => sessionById.get(result.session_id)?.session_type === "race")
    .map((result) => {
      const session = sessionById.get(result.session_id);

      return {
        driverId: result.driver_id,
        teamId: result.team_id,
        round: raceRoundById.get(session?.race_id) ?? 0,
        started: !isJolpicaNonStartStatus(result.status),
      };
    })
    .filter((entry) => entry.driverId && entry.teamId);
  const assignments = selectPrimaryTeamsByStarts(raceEntries);
  const permanentNumberByDriverId = new Map();

  for (const result of sportingData.results) {
    const number = getSeasonDriverNumberFromResult(result.raw_payload);

    if (result.driver_id && number !== null && !permanentNumberByDriverId.has(result.driver_id)) {
      permanentNumberByDriverId.set(result.driver_id, number);
    }
  }
  const driverIds = [...new Set(assignments.map((assignment) => assignment.driverId))];
  const teamIds = [...new Set(raceEntries.map((entry) => entry.teamId))];

  if (!driverIds.length || !teamIds.length) {
    throw new Error(`No race participants found for season ${season}`);
  }

  const [driverResult, teamResult, lineageResult] = await Promise.all([
    supabase
      .from("drivers")
      .select("id, external_id, code, permanent_number")
      .in("id", driverIds),
    supabase
      .from("teams")
      .select("id, external_id, code, name, short_name, country, color_hex")
      .in("id", teamIds),
    supabase
      .from("team_lineages")
      .select("id, slug"),
  ]);

  for (const result of [driverResult, teamResult, lineageResult]) {
    if (result.error) {
      throw result.error;
    }
  }

  const driversById = new Map((driverResult.data ?? []).map((driver) => [driver.id, driver]));
  const lineagesBySlug = new Map((lineageResult.data ?? []).map((lineage) => [lineage.slug, lineage]));
  const teamProfiles = (teamResult.data ?? []).map((team) => {
    const lineageSlug = resolveTeamLineageSlug(team.external_id);
    const lineage = lineagesBySlug.get(lineageSlug);

    if (!lineage?.id) {
      throw new Error(`Missing team lineage ${lineageSlug} for constructor ${team.external_id}`);
    }

    return {
      season_year: season,
      team_id: team.id,
      lineage_id: lineage.id,
      display_name: team.name,
      short_name: team.short_name,
      code: team.code,
      country: team.country,
      color_hex: getSeasonTeamColor(season, team.external_id, null, team.color_hex),
    };
  });
  const driverProfiles = assignments.map((assignment) => {
    const driver = driversById.get(assignment.driverId);

    if (!driver) {
      throw new Error(`Missing driver identity ${assignment.driverId} for season ${season}`);
    }

    return {
      season_year: season,
      driver_id: assignment.driverId,
      primary_team_id: assignment.primaryTeamId,
      code: driver.code,
      permanent_number:
        getKnownSeasonDriverNumber(season, driver.external_id) ??
        permanentNumberByDriverId.get(assignment.driverId) ??
        driver.permanent_number,
      starts: assignment.starts,
    };
  });
  const [teamProfileResult, driverProfileResult] = await Promise.all([
    supabase
      .from("team_season_profiles")
      .upsert(teamProfiles, { onConflict: "season_year,team_id" }),
    supabase
      .from("driver_season_profiles")
      .upsert(driverProfiles, { onConflict: "season_year,driver_id" }),
  ]);

  if (teamProfileResult.error) {
    throw teamProfileResult.error;
  }

  if (driverProfileResult.error) {
    throw driverProfileResult.error;
  }

  return {
    itemsProcessed: teamProfiles.length + driverProfiles.length,
    metadata: {
      season,
      drivers: driverProfiles.length,
      teams: teamProfiles.length,
    },
  };
}

export function selectPrimaryTeamsByStarts(entries) {
  const drivers = new Map();

  for (const entry of entries ?? []) {
    const driverId = entry?.driverId;
    const teamId = entry?.teamId;
    const round = Number(entry?.round ?? 0);

    if (!driverId || !teamId) {
      continue;
    }

    const driver = drivers.get(driverId) ?? { starts: 0, teams: new Map() };
    const team = driver.teams.get(teamId) ?? { starts: 0, latestRound: 0 };

    if (entry.started !== false) {
      driver.starts += 1;
      team.starts += 1;
      team.latestRound = Math.max(team.latestRound, Number.isFinite(round) ? round : 0);
    }

    driver.teams.set(teamId, team);
    drivers.set(driverId, driver);
  }

  return [...drivers.entries()]
    .map(([driverId, driver]) => {
      const [primaryTeam] = [...driver.teams.entries()].sort((left, right) =>
        right[1].starts - left[1].starts ||
        right[1].latestRound - left[1].latestRound ||
        String(left[0]).localeCompare(String(right[0])),
      );

      return {
        driverId,
        primaryTeamId: primaryTeam?.[0] ?? null,
        starts: driver.starts,
      };
    })
    .sort((left, right) => String(left.driverId).localeCompare(String(right.driverId)));
}

async function getSeasonSportingData(season) {
  const { data: races, error: racesError } = await supabase
    .from("races")
    .select("id, round")
    .eq("season_year", season)
    .order("round", { ascending: true });

  if (racesError) {
    throw racesError;
  }

  const raceIds = (races ?? []).map((race) => race.id);

  if (!raceIds.length) {
    return { races: [], sessions: [], results: [] };
  }

  const { data: sessions, error: sessionsError } = await supabase
    .from("sessions")
    .select("id, race_id, session_type")
    .in("race_id", raceIds);

  if (sessionsError) {
    throw sessionsError;
  }

  const sessionIds = (sessions ?? []).map((session) => session.id);
  const results = sessionIds.length
    ? await fetchSessionResultRows(sessionIds)
    : [];

  return { races: races ?? [], sessions: sessions ?? [], results };
}

async function fetchSessionResultRows(sessionIds) {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("session_results")
      .select("session_id, driver_id, team_id, status, raw_payload")
      .in("session_id", sessionIds)
      .range(from, from + pageSize - 1);

    if (error) {
      throw error;
    }

    rows.push(...(data ?? []));

    if ((data ?? []).length < pageSize) {
      break;
    }
  }

  return rows;
}

async function fetchSeasonStandingRows(table, season, columns) {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq("season_year", season)
      .range(from, from + pageSize - 1);

    if (error) {
      throw error;
    }

    rows.push(...(data ?? []));

    if ((data ?? []).length < pageSize) {
      break;
    }
  }

  return rows;
}

async function fetchJolpicaSeasonExpectations(season) {
  const baseUrl = process.env.JOLPICA_BASE_URL ?? "https://api.jolpi.ca/ergast/f1";
  const calendar = await fetchJolpicaPaginatedRaces(`${baseUrl}/${season}.json`, null);
  const rounds = calendar
    .map((race) => numberOrNull(race.round))
    .filter((round) => round && round > 0);

  if (!rounds.length || new Set(rounds).size !== calendar.length) {
    throw new Error(`Jolpica returned an invalid calendar for season ${season}`);
  }

  const [raceRows, qualifyingRows, sprintRows, driverLists, constructorLists] = await Promise.all([
    fetchJolpicaPaginatedRaces(`${baseUrl}/${season}/results.json`, "Results"),
    fetchJolpicaPaginatedRaces(`${baseUrl}/${season}/qualifying.json`, "QualifyingResults"),
    fetchJolpicaPaginatedRaces(`${baseUrl}/${season}/sprint.json`, "SprintResults"),
    fetchJolpicaSeasonStandings({
      baseUrl,
      endpoint: "driverstandings",
      entityKey: "DriverStandings",
      rounds,
      season,
    }),
    fetchJolpicaSeasonStandings({
      baseUrl,
      endpoint: "constructorstandings",
      entityKey: "ConstructorStandings",
      rounds,
      season,
    }),
  ]);

  const calendarRounds = new Set(rounds);
  const constructorStandingCounts = countJolpicaRowsByRound(
    constructorLists,
    "ConstructorStandings",
  );
  const driverStandingCounts = countJolpicaRowsByRound(driverLists, "DriverStandings");
  const qualifyingResultCounts = countJolpicaRowsByRound(qualifyingRows, "QualifyingResults");
  const raceResultCounts = countJolpicaRowsByRound(raceRows, "Results");
  const sprintResultCounts = countJolpicaRowsByRound(sprintRows, "SprintResults");

  for (const [label, counts] of [
    ["race results", raceResultCounts],
    ["qualifying results", qualifyingResultCounts],
    ["driver standings", driverStandingCounts],
    ["constructor standings", constructorStandingCounts],
  ]) {
    if (
      !hasExactSet(calendarRounds, new Set(counts.keys())) ||
      [...counts.values()].some((count) => count <= 0)
    ) {
      throw new Error(`Jolpica returned incomplete ${label} for season ${season}`);
    }
  }

  if (
    [...sprintResultCounts.keys()].some((round) => !calendarRounds.has(round)) ||
    [...sprintResultCounts.values()].some((count) => count <= 0)
  ) {
    throw new Error(`Jolpica returned incomplete sprint results for season ${season}`);
  }

  return {
    calendarRounds,
    constructorStandingCounts,
    driverStandingCounts,
    qualifyingResultCounts,
    raceResultCounts,
    sprintResultCounts,
  };
}

function countJolpicaRowsByRound(rows, resultKey) {
  const counts = new Map();

  for (const row of rows ?? []) {
    const round = numberOrNull(row.round);

    if (round) {
      counts.set(round, Array.isArray(row[resultKey]) ? row[resultKey].length : 0);
    }
  }

  return counts;
}

function getLocalSeasonResultCounts(sportingData) {
  const roundByRaceId = new Map(
    sportingData.races.map((race) => [race.id, Number(race.round)]),
  );
  const sessionById = new Map(sportingData.sessions.map((session) => [session.id, session]));
  const sessionRounds = new Map();
  const resultCounts = new Map();

  for (const session of sportingData.sessions) {
    const round = roundByRaceId.get(session.race_id);
    const type = session.session_type;

    if (!round || !["race", "qualifying", "sprint"].includes(type)) {
      continue;
    }

    sessionRounds.set(type, sessionRounds.get(type) ?? new Map());
    const rounds = sessionRounds.get(type);
    rounds.set(round, (rounds.get(round) ?? 0) + 1);
  }

  for (const result of sportingData.results) {
    const session = sessionById.get(result.session_id);
    const round = roundByRaceId.get(session?.race_id);
    const type = session?.session_type;

    if (!round || !["race", "qualifying", "sprint"].includes(type)) {
      continue;
    }

    resultCounts.set(type, resultCounts.get(type) ?? new Map());
    const rounds = resultCounts.get(type);
    rounds.set(round, (rounds.get(round) ?? 0) + 1);
  }

  return { resultCounts, sessionRounds };
}

export function hasExactRoundCounts(expected, actual) {
  const expectedCounts = expected ?? new Map();
  const actualCounts = actual ?? new Map();

  return (
    expectedCounts.size === actualCounts.size &&
    [...expectedCounts].every(([round, count]) => actualCounts.get(round) === count)
  );
}

function hasOneSessionForEveryExpectedRound(expectedCounts, sessionRounds) {
  const expected = new Map([...expectedCounts].map(([round]) => [round, 1]));

  return hasExactRoundCounts(expected, sessionRounds);
}

function hasExactSet(expectedValues, actualValues) {
  const expected = expectedValues ?? new Set();
  const actual = actualValues ?? new Set();

  return expected.size === actual.size && [...expected].every((value) => actual.has(value));
}

export function hasRoutableDriverProfiles(expectedDriverIds, drivers) {
  const expected = expectedDriverIds ?? new Set();
  const relevantDrivers = (drivers ?? []).filter((driver) => expected.has(driver.id));
  const actualIds = new Set(relevantDrivers.map((driver) => driver.id));
  const slugs = relevantDrivers.map((driver) => normalizeString(driver.slug)?.toLowerCase());

  return (
    hasExactSet(expected, actualIds) &&
    slugs.every(Boolean) &&
    new Set(slugs).size === slugs.length
  );
}

function sumMapValues(values) {
  return [...(values ?? new Map()).values()].reduce((total, value) => total + value, 0);
}

async function validateSeasonReadiness(season) {
  const [sportingData, jolpica] = await Promise.all([
    getSeasonSportingData(season),
    fetchJolpicaSeasonExpectations(season),
  ]);
  const trackAssetsQuery = sportingData.races.length
    ? supabase
      .from("race_track_assets")
      .select("race_id, image_url, source_url, source_manifest, checksum_sha256, is_verified, verified_at")
      .in("race_id", sportingData.races.map((race) => race.id))
    : Promise.resolve({ data: [], error: null });
  const [driverStandings, constructorStandings, teamProfilesResult, driverProfilesResult, trackAssetsResult] =
    await Promise.all([
      fetchSeasonStandingRows("driver_standings", season, "round, driver_id"),
      fetchSeasonStandingRows("constructor_standings", season, "round, team_id"),
      supabase
        .from("team_season_profiles")
        .select("team_id, logo_image_url, car_image_url, source_urls, assets_verified_at")
        .eq("season_year", season),
      supabase
        .from("driver_season_profiles")
        .select("driver_id, avatar_image_url, avatar_prompt, avatar_reference_url, avatar_review_status, source_urls, assets_verified_at")
        .eq("season_year", season),
      trackAssetsQuery,
    ]);

  for (const result of [teamProfilesResult, driverProfilesResult, trackAssetsResult]) {
    if (result.error) {
      throw result.error;
    }
  }

  const localRoundCounts = countRowsByRound(sportingData.races);
  const localRounds = new Set(localRoundCounts.keys());
  const localResults = getLocalSeasonResultCounts(sportingData);
  const driverStandingCounts = countRowsByRound(driverStandings);
  const constructorStandingCounts = countRowsByRound(constructorStandings);
  const raceSessionIds = new Set(
    sportingData.sessions
      .filter((session) => session.session_type === "race")
      .map((session) => session.id),
  );
  const raceResults = sportingData.results.filter((result) =>
    raceSessionIds.has(result.session_id),
  );
  const expectedDriverIds = new Set(raceResults.map((result) => result.driver_id).filter(Boolean));
  const expectedTeamIds = new Set(raceResults.map((result) => result.team_id).filter(Boolean));
  const driverRecordsResult = expectedDriverIds.size
    ? await supabase
      .from("drivers")
      .select("id, slug")
      .in("id", [...expectedDriverIds])
    : { data: [], error: null };

  if (driverRecordsResult.error) {
    throw driverRecordsResult.error;
  }

  const driverRecords = driverRecordsResult.data ?? [];
  const teamProfiles = teamProfilesResult.data ?? [];
  const driverProfiles = driverProfilesResult.data ?? [];
  const trackAssets = trackAssetsResult.data ?? [];
  const teamProfileIds = new Set(teamProfiles.map((profile) => profile.team_id));
  const driverProfileIds = new Set(driverProfiles.map((profile) => profile.driver_id));
  const verifiedTrackRaceIds = new Set(
    trackAssets
      .filter((asset) =>
        asset.image_url &&
        asset.source_url &&
        hasApprovedCircuitAssetManifest(asset.source_manifest) &&
        /^[0-9a-f]{64}$/i.test(String(asset.checksum_sha256 ?? "")) &&
        asset.is_verified &&
        asset.verified_at,
      )
      .map((asset) => asset.race_id),
  );
  const issues = [];

  if (
    !sportingData.races.length ||
    !hasExactSet(jolpica.calendarRounds, localRounds) ||
    [...localRoundCounts.values()].some((count) => count !== 1)
  ) {
    issues.push("calendar_incomplete");
  }

  if (
    !hasExactRoundCounts(jolpica.raceResultCounts, localResults.resultCounts.get("race")) ||
    !hasOneSessionForEveryExpectedRound(
      jolpica.raceResultCounts,
      localResults.sessionRounds.get("race"),
    )
  ) {
    issues.push("race_results_incomplete");
  }

  if (
    !hasExactRoundCounts(
      jolpica.qualifyingResultCounts,
      localResults.resultCounts.get("qualifying"),
    ) ||
    !hasOneSessionForEveryExpectedRound(
      jolpica.qualifyingResultCounts,
      localResults.sessionRounds.get("qualifying"),
    )
  ) {
    issues.push("qualifying_results_incomplete");
  }

  if (
    !hasExactRoundCounts(jolpica.sprintResultCounts, localResults.resultCounts.get("sprint")) ||
    !hasOneSessionForEveryExpectedRound(
      jolpica.sprintResultCounts,
      localResults.sessionRounds.get("sprint"),
    )
  ) {
    issues.push("sprint_results_incomplete");
  }

  if (
    !hasExactRoundCounts(jolpica.driverStandingCounts, driverStandingCounts) ||
    driverStandings.some((standing) => !jolpica.calendarRounds.has(numberOrNull(standing.round)))
  ) {
    issues.push("driver_standings_incomplete");
  }

  if (
    !hasExactRoundCounts(jolpica.constructorStandingCounts, constructorStandingCounts) ||
    constructorStandings.some((standing) => !jolpica.calendarRounds.has(numberOrNull(standing.round)))
  ) {
    issues.push("constructor_standings_incomplete");
  }

  if (!hasExactSet(expectedTeamIds, teamProfileIds)) {
    issues.push("team_profiles_incomplete");
  }

  if (!hasExactSet(expectedDriverIds, driverProfileIds)) {
    issues.push("driver_profiles_incomplete");
  }

  if (!hasRoutableDriverProfiles(expectedDriverIds, driverRecords)) {
    issues.push("driver_profiles_unroutable");
  }

  if (
    teamProfiles.some((profile) =>
      !profile.logo_image_url ||
      !profile.car_image_url ||
      !profile.assets_verified_at ||
      !hasApprovedTeamAssetManifest(profile.source_urls),
    )
  ) {
    issues.push("team_assets_unverified");
  }

  if (
    requiresDriverAvatarAssets(season) &&
    driverProfiles.some((profile) =>
      !profile.avatar_image_url ||
      !profile.avatar_prompt ||
      !profile.avatar_reference_url ||
      profile.avatar_review_status !== "approved" ||
      !profile.assets_verified_at ||
      !hasApprovedDriverAssetManifest(profile.source_urls),
    )
  ) {
    issues.push("driver_avatars_unverified");
  }

  if (sportingData.races.some((race) => !verifiedTrackRaceIds.has(race.id))) {
    issues.push("track_assets_unverified");
  }

  return {
    season,
    ready: issues.length === 0,
    issues,
    counts: {
      expectedRaces: jolpica.calendarRounds.size,
      races: sportingData.races.length,
      raceSessions: sumMapValues(localResults.sessionRounds.get("race")),
      qualifyingSessions: sumMapValues(localResults.sessionRounds.get("qualifying")),
      sprintSessions: sumMapValues(localResults.sessionRounds.get("sprint")),
      raceResultDrivers: expectedDriverIds.size,
      raceResultTeams: expectedTeamIds.size,
      driverStandingRounds: driverStandingCounts.size,
      constructorStandingRounds: constructorStandingCounts.size,
      driverProfiles: driverProfiles.length,
      teamProfiles: teamProfiles.length,
      verifiedTrackAssets: verifiedTrackRaceIds.size,
    },
  };
}

export function hasApprovedTeamAssetManifest(sourceUrls) {
  const source = Array.isArray(sourceUrls)
    ? sourceUrls.find((item) => item?.kind === "team-season-assets")
    : null;

  if (!source) {
    return false;
  }

  const carReview = getManualReviewStatus(source.car);
  const logoReview = getManualReviewStatus(source.logo);
  const rightsApproved = !source.rightsReviewRequired ||
    ["approved", "cleared"].includes(String(source.rightsReviewStatus ?? "").toLowerCase());

  return (
    carReview === "approved" &&
    logoReview === "approved" &&
    rightsApproved &&
    /^[0-9a-f]{64}$/i.test(String(source.car?.sha256 ?? "")) &&
    /^[0-9a-f]{64}$/i.test(String(source.logo?.sha256 ?? ""))
  );
}

export function hasApprovedCircuitAssetManifest(sourceManifest) {
  const rightsApproved =
    sourceManifest?.rightsReviewRequired === true &&
    ["approved", "cleared"].includes(
      String(sourceManifest?.rightsReview?.status ?? "").toLowerCase(),
    );
  const officialSource = hasApprovedCircuitSource(sourceManifest);
  const archiveValid =
    !String(sourceManifest?.sourceSelection ?? "").startsWith("wayback-") ||
    (
      /^\d{14}$/.test(String(sourceManifest?.archiveTimestamp ?? "")) &&
      isFormulaOneWaybackUrl(
        sourceManifest?.archiveUrl,
        String(sourceManifest?.archiveTimestamp ?? ""),
      )
    );

  return (
    sourceManifest?.manualReview?.status === "approved" &&
    /^[0-9a-f]{64}$/i.test(String(sourceManifest?.sha256 ?? "")) &&
    /^[0-9a-f]{64}$/i.test(String(sourceManifest?.sourceImageSha256 ?? "")) &&
    Number(sourceManifest?.width) === 1252 &&
    Number(sourceManifest?.height) === 704 &&
    rightsApproved &&
    officialSource &&
    archiveValid
  );
}

function hasApprovedCircuitSource(sourceManifest) {
  if (sourceManifest?.authority === "Formula1.com") {
    return (
      isOfficialFormulaOneUrl(sourceManifest?.pageUrl, {
        allowedHosts: ["formula1.com", "www.formula1.com"],
      }) &&
      isOfficialFormulaOneUrl(sourceManifest?.sourceUrl, {
        allowedHosts: ["formula1.com", "www.formula1.com", "media.formula1.com"],
      })
    );
  }

  if (sourceManifest?.authority === "Mercedes-AMG PETRONAS F1 Team") {
    return (
      sourceManifest?.sourceSelection === "official-team-event-media" &&
      sourceManifest?.transform?.whiteToTransparent === true &&
      Array.isArray(sourceManifest?.transform?.crop) &&
      sourceManifest.transform.crop.length === 4 &&
      isOfficialFormulaOneUrl(sourceManifest?.pageUrl, {
        allowedHosts: ["media.mercedesamgf1.com"],
      }) &&
      isOfficialFormulaOneUrl(sourceManifest?.sourceUrl, {
        allowedHosts: ["media.mercedesamgf1.com"],
      })
    );
  }

  return false;
}

function isOfficialFormulaOneUrl(value, { allowedHosts }) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowedHosts.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isFormulaOneWaybackUrl(value, archiveTimestamp) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "web.archive.org" &&
      new RegExp(
        `^/web/${archiveTimestamp}(?:id_)?/https?://(?:www\\.)?formula1\\.com/`,
        "i",
      ).test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function requiresDriverAvatarAssets(season) {
  return !isHistoricalSeason(season);
}

export function hasApprovedDriverAssetManifest(sourceUrls) {
  const source = Array.isArray(sourceUrls)
    ? sourceUrls.find((item) => item?.kind === "driver-season-avatar")
    : null;

  const season = Number(source?.season);
  const requiresHelmetReference = Number.isInteger(season) && isHistoricalSeason(season);

  return (
    Number.isInteger(season) &&
    source?.manualReview?.status === "approved" &&
    /^[0-9a-f]{64}$/i.test(String(source.sha256 ?? "")) &&
    (!requiresHelmetReference || isHelmetVisualReference(source.helmetReferenceUrl))
  );
}

function isHelmetVisualReference(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();

    return (
      ["http:", "https:"].includes(url.protocol) &&
      !hostname.includes("wikipedia.org") &&
      !hostname.includes("jolpi.ca")
    );
  } catch {
    return false;
  }
}

function countRowsByRound(rows) {
  const counts = new Map();

  for (const row of rows ?? []) {
    const round = numberOrNull(row.round);

    if (round) {
      counts.set(round, (counts.get(round) ?? 0) + 1);
    }
  }

  return counts;
}

function isJolpicaNonStartStatus(status) {
  const normalized = String(status ?? "").toLowerCase();

  return ["did not start", "did not qualify", "did not prequalify", "withdrawn"].some((value) =>
    normalized.includes(value),
  );
}

async function markRacesCompletedFromStandings(season, rounds) {
  const roundList = [...rounds]
    .map((round) => Number(round))
    .filter((round) => Number.isFinite(round) && round > 0);

  if (!roundList.length) {
    return [];
  }

  const { data: races, error } = await supabase
    .from("races")
    .select("id, round, race_start_at")
    .eq("season_year", season)
    .in("round", roundList);

  if (error) {
    throw error;
  }

  const completedRaces = (races ?? []).filter((race) => hasRaceCompletionWindowElapsed(race.race_start_at));
  const raceIds = completedRaces.map((race) => race.id).filter(Boolean);

  if (raceIds.length) {
    const { error: racesError } = await supabase
      .from("races")
      .update({ status: "completed" })
      .in("id", raceIds);

    if (racesError) {
      throw racesError;
    }

    const { error: sessionsError } = await supabase
      .from("sessions")
      .update({ status: "completed" })
      .in("race_id", raceIds);

    if (sessionsError) {
      throw sessionsError;
    }
  }

  return completedRaces.map((race) => ({ id: race.id, round: Number(race.round) })).filter((race) => race.id);
}

async function syncOpenF1Sessions() {
  const baseUrl = process.env.OPENF1_BASE_URL ?? "https://api.openf1.org/v1";
  const season = Number(process.env.F1_SEASON ?? new Date().getUTCFullYear());
  let openF1Sessions = [];

  try {
    openF1Sessions = await fetchJson(`${baseUrl}/sessions?year=${season}`);
  } catch (error) {
    if (isOpenF1AuthRestriction(error)) {
      return {
        itemsProcessed: 0,
        metadata: {
          season,
          skipped: "openf1_free_tier_live_window",
          reason: getSafeErrorMessage(error),
        },
      };
    }

    throw error;
  }

  const telemetryWarm = await enqueueMissingTelemetryTasks(
    new TelemetryStore(supabase),
    recentTelemetryTasks(season, openF1Sessions),
  ).then(
    (queued) => ({ queued }),
    (error) => ({ error: getSafeErrorMessage(error) }),
  );

  const [localSessions, circuits] = await Promise.all([
    getLocalSessionsForOpenF1(season),
    getCircuitsForLayouts(),
  ]);

  let matchedSessions = 0;
  let layouts = 0;

  for (const session of localSessions) {
    const match = findOpenF1SessionMatch(session, openF1Sessions);

    if (!match?.session_key) {
      continue;
    }

    await supabase
      .from("sessions")
      .update({
        openf1_session_key: Number(match.session_key),
        start_at: match.date_start ? new Date(match.date_start).toISOString() : session.start_at,
        end_at: match.date_end ? new Date(match.date_end).toISOString() : session.end_at,
      })
      .eq("id", session.id);
    matchedSessions += 1;
  }

  for (const circuit of circuits) {
    const existingLayout = await getExistingCircuitLayout(circuit.id);

    if (existingLayout?.raw_payload?.lap_start) {
      continue;
    }

    const sourceSessions = await findLayoutSourceSessions(baseUrl, circuit, season, openF1Sessions);
    let layout = null;
    let sourceSession = null;

    for (const candidate of sourceSessions) {
      layout = await buildCircuitLayoutFromOpenF1(baseUrl, candidate.session_key);

      if (layout) {
        sourceSession = candidate;
        break;
      }
    }

    if (!layout || !sourceSession?.session_key) {
      continue;
    }

    await supabase.from("circuit_layouts").upsert(
      {
        circuit_id: circuit.id,
        provider: "openf1",
        svg_path: layout.svgPath,
        view_box: layout.viewBox,
        source_session_key: Number(sourceSession.session_key),
        raw_payload: layout.metadata,
      },
      { onConflict: "circuit_id,provider" },
    );
    layouts += 1;
  }

  return { itemsProcessed: matchedSessions + layouts, metadata: { season, matchedSessions, layouts, telemetryWarm } };
}

async function checkCurrentOpenF1Sessions(metadata = {}) {
  return syncOpenF1Laps({
    forceProbe: true,
    forceOpenF1Refresh: true,
    manualCurrentRaceCheck: true,
    targetSessionKey: metadata.sessionKey ?? getCliOption("session-key"),
  });
}

async function syncOpenF1StartingGrid() {
  const baseUrl = process.env.OPENF1_BASE_URL ?? "https://api.openf1.org/v1";
  const season = getCurrentF1Season();
  const now = Date.now();
  const minimumRows = Math.max(10, Number(process.env.OPENF1_MIN_RESULT_ROWS ?? 20));
  const weekends = await loadAdaptiveStartingGridWeekends();
  const weekend = weekends.find((candidate) => {
    const qualifyingEndMs = Date.parse(candidate.qualifyingEndAt ?? "");
    const raceStartMs = Date.parse(candidate.raceStartAt ?? "");

    return Number.isFinite(qualifyingEndMs)
      && Number.isFinite(raceStartMs)
      && now >= qualifyingEndMs + 10 * 60_000
      && now < raceStartMs;
  });

  if (!weekend) {
    return {
      itemsProcessed: 0,
      metadata: { season, skipped: "outside_qualifying_to_race_window" },
    };
  }

  const startingGridUrl = buildOpenF1StartingGridUrl(baseUrl, weekend.qualifyingSessionKey);

  if (!startingGridUrl) {
    return {
      itemsProcessed: 0,
      metadata: {
        season,
        round: weekend.round,
        race: weekend.raceName,
        skipped: "qualifying_session_not_linked_to_openf1",
      },
    };
  }

  let payload;

  try {
    payload = await fetchJson(startingGridUrl);
  } catch (error) {
    if (isOpenF1AuthRestriction(error) || isOpenF1StartingGridPending(error)) {
      return {
        itemsProcessed: 0,
        metadata: {
          season,
          round: weekend.round,
          race: weekend.raceName,
          skipped: "openf1_starting_grid_not_available",
          reason: getSafeErrorMessage(error),
        },
      };
    }

    throw error;
  }

  const normalized = normalizeOpenF1StartingGrid(payload);

  if (!isOpenF1StartingGridReady(normalized, { minimumRows })) {
    return {
      itemsProcessed: 0,
      metadata: {
        season,
        round: weekend.round,
        race: weekend.raceName,
        rowsReceived: normalized.length,
        skipped: "starting_grid_incomplete",
      },
    };
  }

  let drivers = await getDriverMapByNumber(season);

  if (normalized.some((entry) => !drivers.has(entry.driverNumber))) {
    drivers = await extendDriverMapWithOpenF1SessionParticipants({
      baseUrl,
      drivers,
      sessionKey: weekend.qualifyingSessionKey,
    });
  }

  const syncedAt = new Date().toISOString();
  const unmappedDriverNumbers = [];
  const rows = normalized.flatMap((entry) => {
    const driver = drivers.get(entry.driverNumber);

    if (!driver?.id) {
      unmappedDriverNumbers.push(entry.driverNumber);
      return [];
    }

    return [{
      driver_id: driver.id,
      lap_time_text: entry.lapDuration === null ? null : formatLapDuration(entry.lapDuration),
      position: entry.position,
      race_id: weekend.raceId,
      raw_payload: entry.rawPayload,
      source: "openf1",
      source_session_key: Number(weekend.qualifyingSessionKey),
      team_id: driver.current_team_id ?? null,
      updated_at: syncedAt,
    }];
  });
  const requiredMappedRows = Math.max(minimumRows, Math.ceil(normalized.length * 0.9));

  if (rows.length < requiredMappedRows) {
    return {
      itemsProcessed: 0,
      metadata: {
        season,
        round: weekend.round,
        race: weekend.raceName,
        rowsMapped: rows.length,
        rowsReceived: normalized.length,
        skipped: "starting_grid_driver_mapping_incomplete",
        unmappedDriverNumbers,
      },
    };
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("race_starting_grid")
    .select("driver_id")
    .eq("race_id", weekend.raceId);

  if (existingError) {
    throw existingError;
  }

  const { error: upsertError } = await supabase
    .from("race_starting_grid")
    .upsert(rows, { onConflict: "race_id,driver_id" });

  if (upsertError) {
    throw upsertError;
  }

  const savedDriverIds = new Set(rows.map((row) => row.driver_id));
  const staleDriverIds = (existingRows ?? [])
    .map((row) => row.driver_id)
    .filter((driverId) => !savedDriverIds.has(driverId));

  if (staleDriverIds.length) {
    const { error: cleanupError } = await supabase
      .from("race_starting_grid")
      .delete()
      .eq("race_id", weekend.raceId)
      .in("driver_id", staleDriverIds);

    if (cleanupError) {
      throw cleanupError;
    }
  }

  return {
    itemsProcessed: rows.length,
    metadata: {
      season,
      round: weekend.round,
      race: weekend.raceName,
      rowsSaved: rows.length,
      sourceSessionKey: weekend.qualifyingSessionKey,
      staleRowsRemoved: staleDriverIds.length,
      updatedAt: syncedAt,
    },
  };
}

async function syncOpenF1Laps({
  forceOpenF1Refresh = false,
  forceProbe = false,
  manualCurrentRaceCheck = false,
  targetSessionKey = null,
} = {}) {
  const baseUrl = process.env.OPENF1_BASE_URL ?? "https://api.openf1.org/v1";
  const season = Number(process.env.F1_SEASON ?? new Date().getUTCFullYear());
  const now = Date.now();
  const minimumRows = Math.max(10, Number(process.env.OPENF1_MIN_RESULT_ROWS ?? 20));
  const hasLiveAccess = hasOpenF1LiveCredentials();
  const requestedSessionKey = normalizeOpenF1SessionKey(targetSessionKey);
  const targetsLiveSession = requestedSessionKey !== null;
  const latestSessionQuery = supabase
    .from("sessions")
    .select("id, session_type, openf1_session_key, start_at, end_at, races!inner(id, season_year, round, race_name)")
    .not("openf1_session_key", "is", null)
    .not("end_at", "is", null)
    .in("session_type", OPENF1_RESULT_SESSION_TYPES)
    .eq("races.season_year", season);
  const { data: latestEndedSession, error: latestSessionError } =
    targetsLiveSession
      ? await latestSessionQuery
          .eq("openf1_session_key", requestedSessionKey)
          .maybeSingle()
      : await latestSessionQuery
          .lte("end_at", new Date(now).toISOString())
          .order("end_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();

  if (latestSessionError) {
    throw latestSessionError;
  }

  const latestRace = firstRelation(latestEndedSession?.races);
  let currentRaceSessions = [];

  if (targetsLiveSession && latestEndedSession) {
    currentRaceSessions = [latestEndedSession];
  } else if (latestRace?.id) {
    const { data, error } = await supabase
      .from("sessions")
      .select("id, session_type, openf1_session_key, start_at, end_at, races!inner(id, season_year, round, race_name)")
      .eq("race_id", latestRace.id)
      .not("openf1_session_key", "is", null)
      .not("end_at", "is", null)
      .in("session_type", OPENF1_RESULT_SESSION_TYPES)
      .lte("end_at", new Date(now).toISOString())
      .order("end_at", { ascending: false, nullsFirst: false })
      .limit(Number(process.env.OPENF1_MAX_RESULT_SESSIONS ?? 12));

    if (error) {
      throw error;
    }

    currentRaceSessions = data ?? [];
  }

  if (!currentRaceSessions.length) {
    return {
      itemsProcessed: 0,
      metadata: {
        season,
        sessionsChecked: 0,
        sessionsSaved: 0,
        skipped: "no_ended_sessions_for_latest_race",
      },
    };
  }

  const storedStates = await getStoredSessionResultStates(
    currentRaceSessions.map((session) => session.id),
    minimumRows,
  );
  const telemetryWarm = await enqueueMissingTelemetryTasks(
    new TelemetryStore(supabase), localRacePaceTasks(currentRaceSessions, now),
  ).then((queued) => ({ queued }), (error) => ({ error: getSafeErrorMessage(error) }));
  let drivers = null;
  let itemsProcessed = 0;
  let sessionsChecked = 0;
  let sessionsSaved = 0;
  let restrictedSessions = 0;
  let waitingForAccess = 0;
  let waitingForSessionEnd = 0;
  let alreadyComplete = 0;
  let fallbackSessions = 0;
  let emptySessions = 0;
  const completedSessions = [];
  const savedSessions = [];
  const fantasyRaceIdsToScore = new Set();
  const failures = [];

  for (const session of currentRaceSessions) {
    const race = Array.isArray(session.races) ? session.races[0] : session.races;

    const sessionType = String(session.session_type);
    const storedState = storedStates.get(session.id) ?? createStoredSessionResultState([], minimumRows);

    if (now < Date.parse(session.end_at)) {
      try {
        const controls = await fetchJson(
          `${baseUrl}/race_control?session_key=${session.openf1_session_key}`,
        );
        if (!hasFinalOpenF1SessionSignal(controls)) {
          waitingForSessionEnd += 1;
          continue;
        }
      } catch (error) {
        failures.push({
          sessionKey: session.openf1_session_key,
          source: "openf1_race_control",
          reason: getSafeErrorMessage(error),
        });
        continue;
      }
    }

    const requiresRacePoints = ["race", "sprint"].includes(sessionType.toLowerCase());
    const hasCompleteStoredOpenF1Classification =
      storedState.hasOpenF1Classification &&
      (!requiresRacePoints || storedState.hasOpenF1ScoringData);

    if (
      storedState.hasOfficialClassification ||
      (hasCompleteStoredOpenF1Classification && !forceOpenF1Refresh)
    ) {
      alreadyComplete += 1;
      completedSessions.push({
        race: race?.race_name ?? null,
        round: race?.round ?? null,
        sessionType,
        rows: storedState.rows.length,
      });
      continue;
    }

    if (!forceProbe && !isOpenF1ResultProbeDue({
      endAt: session.end_at,
      hasLiveAccess,
      historicalDelayMinutes: Number(process.env.OPENF1_HISTORICAL_DELAY_MINUTES ?? 31),
      liveDelayMinutes: Number(process.env.OPENF1_LIVE_RESULT_DELAY_MINUTES ?? 2),
      nowMs: now,
    })) {
      waitingForAccess += 1;
      continue;
    }

    sessionsChecked += 1;
    drivers ??= await getDriverMapByNumber(season);
    let normalizedResults = [];
    let source = "openf1_session_result";

    try {
      const classification = await fetchJson(`${baseUrl}/session_result?session_key=${session.openf1_session_key}`);
      normalizedResults = normalizeOpenF1SessionClassification(classification, sessionType);
    } catch (error) {
      if (isOpenF1AuthRestriction(error)) {
        restrictedSessions += 1;
        continue;
      } else {
        failures.push({
          sessionKey: session.openf1_session_key,
          source,
          reason: getSafeErrorMessage(error),
        });
      }
    }

    if (!isOpenF1ClassificationReady(normalizedResults, { minimumRows }) && isOpenF1TimedSessionType(sessionType)) {
      try {
        const laps = await fetchJson(`${baseUrl}/laps?session_key=${session.openf1_session_key}`);
        normalizedResults = normalizeOpenF1LapFallback(laps);
        source = "openf1_laps_fallback";
      } catch (error) {
        if (isOpenF1AuthRestriction(error)) {
          restrictedSessions += 1;
          continue;
        }

        failures.push({
          sessionKey: session.openf1_session_key,
          source: "openf1_laps_fallback",
          reason: getSafeErrorMessage(error),
        });
      }
    }

    if (
      !isOpenF1ClassificationReady(normalizedResults, { minimumRows }) &&
      ["race", "sprint"].includes(sessionType.toLowerCase())
    ) {
      const { data: liveSession, error: liveSessionError } = await supabase
        .from("live_sessions")
        .select("snapshot")
        .eq("session_key", session.openf1_session_key)
        .maybeSingle();
      if (liveSessionError) {
        failures.push({
          sessionKey: session.openf1_session_key,
          source: "live_final_snapshot",
          reason: getSafeErrorMessage(liveSessionError),
        });
      } else {
        const provisional = normalizeLiveRaceClassification(
          liveSession?.snapshot,
        );
        if (isOpenF1ClassificationReady(provisional, { minimumRows })) {
          normalizedResults = provisional;
          source = "live_final_snapshot";
        }
      }
    }

    if (!isOpenF1ClassificationReady(normalizedResults, { minimumRows })) {
      emptySessions += 1;
      continue;
    }

    if (normalizedResults.some((result) => !drivers.has(result.driverNumber))) {
      drivers = await extendDriverMapWithOpenF1SessionParticipants({
        baseUrl,
        drivers,
        sessionKey: session.openf1_session_key,
      });
    }
    const saved = await saveOpenF1SessionClassification({
      drivers,
      existingRows: storedState.rows,
      minimumRows,
      normalizedResults,
      session,
      source,
    });

    if (!saved.ok) {
      failures.push({
        sessionKey: session.openf1_session_key,
        source,
        reason: saved.reason,
        unmappedDriverNumbers: saved.unmappedDriverNumbers,
      });
      continue;
    }

    itemsProcessed += saved.itemsProcessed;
    sessionsSaved += 1;
    fallbackSessions += source === "openf1_laps_fallback" ? 1 : 0;
    savedSessions.push({
      race: race?.race_name ?? null,
      round: race?.round ?? null,
      sessionType,
      rows: saved.itemsProcessed,
      source,
    });

    if (sessionType.toLowerCase() === "race" && race?.id) {
      fantasyRaceIdsToScore.add(race.id);
    }
  }

  const predictionRescore = fantasyRaceIdsToScore.size
    ? await scorePredictions({ raceIds: [...fantasyRaceIdsToScore] })
    : null;

  return {
    itemsProcessed,
    metadata: {
      season,
      race: latestRace?.race_name ?? null,
      round: latestRace?.round ?? null,
      hasLiveAccess,
      scope: "latest_ended_race",
      telemetryWarm,
      manualCurrentRaceCheck,
      targetSessionKey: targetsLiveSession ? requestedSessionKey : null,
      sessionsChecked,
      sessionsSaved,
      restrictedSessions,
      waitingForAccess,
      waitingForSessionEnd,
      alreadyComplete,
      fallbackSessions,
      emptySessions,
      completedSessions,
      savedSessions,
      rescoredPredictions: predictionRescore?.itemsProcessed ?? 0,
      failures,
    },
  };
}

async function getStoredSessionResultStates(sessionIds, minimumRows) {
  if (!sessionIds.length) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("session_results")
    .select("id, session_id, driver_id, points, status, raw_payload")
    .in("session_id", sessionIds)
    .limit(sessionIds.length * 30);

  if (error) {
    throw error;
  }

  const rowsBySession = new Map(sessionIds.map((sessionId) => [sessionId, []]));

  for (const row of data ?? []) {
    const rows = rowsBySession.get(row.session_id) ?? [];
    rows.push(row);
    rowsBySession.set(row.session_id, rows);
  }

  return new Map(
    sessionIds.map((sessionId) => [
      sessionId,
      createStoredSessionResultState(rowsBySession.get(sessionId) ?? [], minimumRows),
    ]),
  );
}

function createStoredSessionResultState(rows, minimumRows) {
  const officialRows = rows.filter((row) => {
    const payload = row.raw_payload;
    return Boolean(payload && typeof payload === "object" && !Array.isArray(payload) && "Driver" in payload);
  });
  const openF1Rows = rows.filter((row) => row.raw_payload?._racemate_source === "openf1_session_result");
  const openF1RowsWithPoints = openF1Rows.filter(
    (row) => row.points !== null && Number.isFinite(Number(row.points)),
  );

  return {
    rows,
    hasOfficialClassification: officialRows.length >= minimumRows,
    hasOpenF1Classification: openF1Rows.length >= minimumRows,
    hasOpenF1ScoringData: openF1RowsWithPoints.length >= minimumRows,
  };
}

function normalizeOpenF1LapFallback(laps) {
  return getBestLapsByDriver(laps).map((lap, index) => ({
    driverNumber: Number(lap.driver_number),
    position: index + 1,
    classifiedPosition: String(index + 1),
    laps: numberOrNull(lap.lap_number),
    points: null,
    status: "Лучшее время",
    timeText: formatLapDuration(lap.lap_duration),
    rawPayload: lap,
  }));
}

async function saveOpenF1SessionClassification({
  drivers,
  existingRows,
  minimumRows,
  normalizedResults,
  session,
  source,
}) {
  const syncedAt = new Date().toISOString();
  const unmappedDriverNumbers = [];
  const resultRows = normalizedResults.flatMap((result) => {
    const driver = drivers.get(result.driverNumber);

    if (!driver?.id) {
      unmappedDriverNumbers.push(result.driverNumber);
      return [];
    }

    return [{
      session_id: session.id,
      driver_id: driver.id,
      team_id: driver.current_team_id ?? null,
      position: result.position,
      classified_position: result.classifiedPosition,
      laps: result.laps,
      points: result.points,
      status: result.status,
      time_text: result.timeText,
      raw_payload: {
        ...result.rawPayload,
        _racemate_source: source,
        _racemate_synced_at: syncedAt,
      },
    }];
  });
  const mappingRatio = Math.min(1, Math.max(0.75, Number(process.env.OPENF1_MIN_DRIVER_MAPPING_RATIO ?? 0.9)));
  const requiredMappedRows = Math.max(minimumRows, Math.ceil(normalizedResults.length * mappingRatio));

  if (resultRows.length < requiredMappedRows) {
    return {
      ok: false,
      reason: `Only ${resultRows.length}/${normalizedResults.length} OpenF1 drivers mapped to season profiles`,
      unmappedDriverNumbers,
    };
  }

  const { error: upsertError } = await supabase
    .from("session_results")
    .upsert(resultRows, { onConflict: "session_id,driver_id" });

  if (upsertError) {
    return { ok: false, reason: getSafeErrorMessage(upsertError), unmappedDriverNumbers };
  }

  const savedDriverIds = new Set(resultRows.map((row) => row.driver_id));
  const staleResultIds = existingRows
    .filter((row) => !row.driver_id || !savedDriverIds.has(row.driver_id))
    .map((row) => row.id);

  if (staleResultIds.length) {
    const { error: cleanupError } = await supabase
      .from("session_results")
      .delete()
      .in("id", staleResultIds);

    if (cleanupError) {
      return { ok: false, reason: getSafeErrorMessage(cleanupError), unmappedDriverNumbers };
    }
  }

  const { error: statusError } = await supabase
    .from("sessions")
    .update({ status: "completed" })
    .eq("id", session.id);

  if (statusError) {
    return { ok: false, reason: getSafeErrorMessage(statusError), unmappedDriverNumbers };
  }

  return { ok: true, itemsProcessed: resultRows.length, unmappedDriverNumbers };
}

async function syncWeekendWeather() {
  const race = await getCurrentRaceForWorker("id, season_year, round, race_name, circuit_id, circuits(id, latitude, longitude)");

  const circuit = Array.isArray(race?.circuits) ? race?.circuits[0] : race?.circuits;

  if (!circuit?.latitude || !circuit?.longitude) {
    return {
      itemsProcessed: 0,
      metadata: {
        race: race?.race_name ?? null,
        round: race?.round ?? null,
        skippedReason: "no_circuit_coordinates",
      },
    };
  }

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, race_id, start_at")
    .eq("race_id", race.id)
    .not("start_at", "is", null)
    .order("start_at", { ascending: true });

  if (!sessions?.length) {
    return {
      itemsProcessed: 0,
      metadata: {
        race: race.race_name,
        round: race.round,
        skippedReason: "no_sessions",
      },
    };
  }

  const baseUrl = process.env.OPEN_METEO_BASE_URL ?? "https://api.open-meteo.com/v1";
  const sessionDates = (sessions ?? []).map((session) => new Date(session.start_at));
  const startDate = formatIsoDate(new Date(Math.min(...sessionDates.map((date) => date.getTime()), Date.now())));
  const endDate = formatIsoDate(new Date(Math.max(...sessionDates.map((date) => date.getTime()), Date.now())));
  const response = await fetch(
    `${baseUrl}/forecast?latitude=${circuit.latitude}&longitude=${circuit.longitude}&current=temperature_2m,wind_speed_10m,precipitation&hourly=temperature_2m,wind_speed_10m,precipitation,weather_code&timezone=UTC&start_date=${startDate}&end_date=${endDate}`,
  );
  const weather = await response.json();
  let itemsProcessed = 0;
  let sessionForecasts = 0;

  await supabase.from("circuit_weather").upsert(
    {
      race_id: race.id,
      circuit_id: circuit.id ?? null,
      temperature_c: weather.current?.temperature_2m ?? null,
      wind_speed_kmh: weather.current?.wind_speed_10m ?? null,
      precipitation_mm: weather.current?.precipitation ?? null,
      weather_code: weather.current?.weather_code ?? null,
      observed_at: weather.current?.time
        ? new Date(weather.current.time).toISOString()
        : new Date().toISOString(),
      provider: "open-meteo",
      raw_payload: weather,
    },
    { onConflict: "race_id,provider" },
  );
  itemsProcessed += 1;

  for (const session of sessions ?? []) {
    const forecast = pickHourlyForecast(weather.hourly, session.start_at);

    if (!forecast) {
      continue;
    }

    await supabase.from("session_weather").upsert(
      {
        session_id: session.id,
        race_id: race.id,
        circuit_id: circuit.id ?? race.circuit_id ?? null,
        temperature_c: forecast.temperature_c,
        wind_speed_kmh: forecast.wind_speed_kmh,
        precipitation_mm: forecast.precipitation_mm,
        weather_code: forecast.weather_code,
        forecast_at: forecast.forecast_at,
        provider: "open-meteo",
        raw_payload: forecast,
      },
      { onConflict: "session_id,provider" },
    );
    itemsProcessed += 1;
    sessionForecasts += 1;
  }

  return {
    itemsProcessed: sessionForecasts ? itemsProcessed : 0,
    metadata: {
      race: race.race_name,
      round: race.round,
      weather: weather.current ?? null,
      sessions: sessions?.length ?? 0,
      sessionForecasts,
      ...(sessionForecasts ? {} : { skippedReason: "session_forecast_unavailable" }),
    },
  };
}

async function getCurrentRaceForWorker(select) {
  const nowIso = new Date().toISOString();
  const weekendWindowIso = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const baseSelect = select ?? "id, season_year, round, race_name, race_start_at";

  const { data: upcoming } = await supabase
    .from("races")
    .select(baseSelect)
    .gte("race_start_at", nowIso)
    .order("race_start_at", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (upcoming) {
    return upcoming;
  }

  const { data: recent } = await supabase
    .from("races")
    .select(baseSelect)
    .gte("race_start_at", weekendWindowIso)
    .order("race_start_at", { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (recent) {
    return recent;
  }

  const { data: latest } = await supabase
    .from("races")
    .select(baseSelect)
    .lte("race_start_at", nowIso)
    .order("race_start_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  return latest ?? null;
}

async function prepareCurrentRaceReplay() {
  const requestedSeason = numberOrNull(getCliOption("season"));
  const requestedRound = numberOrNull(getCliOption("round"));
  const currentRace = requestedSeason && requestedRound
    ? await getRaceForReplay(requestedSeason, requestedRound)
    : await getCurrentRaceForWorker(
        "id, season_year, round, race_name, circuit_id, circuits(id, external_id, name, country, locality)",
      );

  if (!currentRace) {
    return {
      itemsProcessed: 0,
      metadata: { skippedReason: "current_race_missing" },
    };
  }

  const sourceSeason = numberOrNull(getCliOption("source-season")) ?? Number(currentRace.season_year) - 1;

  return prepareRaceReplayForRace(currentRace, { sourceSeason });
}

async function prepareCompletedRaceReplays() {
  const season = numberOrNull(getCliOption("season")) ?? Number(process.env.F1_SEASON ?? new Date().getUTCFullYear());
  const round = numberOrNull(getCliOption("round"));
  const limit = numberOrNull(getCliOption("limit")) ?? 40;
  const force = process.argv.includes("--force");
  const races = round
    ? [await getRaceForReplay(season, round)].filter(Boolean)
    : await findCompletedRacesForReplay(season, limit);
  let itemsProcessed = 0;
  const prepared = [];
  const skipped = [];
  const failed = [];

  for (const race of races) {
    const sourceSeason = Number(race.season_year);
    const existing = await getExistingReadyReplayForRace(race.id, sourceSeason);

    if (existing && !force) {
      skipped.push({ round: race.round, reason: "already_ready", sourceSessionKey: existing.source_session_key });
      continue;
    }

    try {
      const result = await prepareRaceReplayForRace(race, { sourceSeason: Number(race.season_year) });
      if (result.metadata?.skippedReason && result.metadata.skippedReason !== "race_not_finished") {
        throw new Error(result.metadata.skippedReason);
      }
      itemsProcessed += result.itemsProcessed ?? 0;
      prepared.push({
        round: race.round,
        race: race.race_name,
        sourceSeason: result.metadata?.sourceSeason,
        sourceSessionKey: result.metadata?.sourceSessionKey,
        skippedReason: result.metadata?.skippedReason,
      });
    } catch (error) {
      failed.push({
        message: getSafeErrorMessage(error),
        race: race.race_name,
        round: race.round,
      });
    }
  }

  if (failed.length) {
    throw new Error(`Race Replay: ${failed.map((item) => `${item.race}: ${item.message}`).join("; ")}`);
  }

  return {
    itemsProcessed,
    metadata: {
      failed,
      force,
      prepared,
      season,
      skipped,
    },
  };
}

async function getRaceForReplay(season, round) {
  const { data, error } = await supabase
    .from("races")
    .select("id, season_year, round, race_name, circuit_id, race_start_at, status, circuits(id, external_id, name, country, locality)")
    .eq("season_year", season)
    .eq("round", round)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

async function findCompletedRacesForReplay(season, limit) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("races")
    .select("id, season_year, round, race_name, circuit_id, race_start_at, status, circuits(id, external_id, name, country, locality)")
    .eq("season_year", season)
    .lte("race_start_at", nowIso)
    .order("round", { ascending: true })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []).filter((race) => race.status === "completed" || isPastDate(race.race_start_at));
}

async function getExistingReadyReplayForRace(raceId, sourceSeason = null) {
  let query = supabase
    .from("race_replay_sessions")
    .select("id, source_session_key")
    .eq("race_id", raceId)
    .eq("status", "ready")
    .eq("source_session_name", "Race")
    .limit(1);

  if (sourceSeason) {
    query = query.eq("source_season", sourceSeason);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

async function prepareRaceReplayForRace(currentRace, options = {}) {
  const baseUrl = process.env.OPENF1_BASE_URL ?? "https://api.openf1.org/v1";
  const circuit = Array.isArray(currentRace?.circuits) ? currentRace?.circuits[0] : currentRace?.circuits;

  if (!currentRace?.id || !circuit?.id) {
    return {
      itemsProcessed: 0,
      metadata: { skippedReason: "current_race_or_circuit_missing" },
    };
  }

  const sourceSeason = Number(options.sourceSeason ?? Number(currentRace.season_year) - 1);
  const sessions = await getOpenF1SessionsForYear(baseUrl, sourceSeason, Number(currentRace.season_year), []);
  const sourceSession = findReplaySourceRaceSession(circuit, sessions);

  if (!sourceSession?.session_key) {
    return {
      itemsProcessed: 0,
      metadata: {
        race: currentRace.race_name,
        round: currentRace.round,
        sourceSeason,
        skippedReason: "source_race_session_not_found",
      },
    };
  }

  const sourceSessionKey = Number(sourceSession.session_key);
  // Never freeze an in-progress feed into a supposedly completed archive.
  const sourceEndMs = Date.parse(sourceSession.date_end);
  if (!Number.isFinite(sourceEndMs) || Date.now() < sourceEndMs + 120_000) {
    return { itemsProcessed: 0, metadata: { skippedReason: "race_not_finished", sourceSessionKey } };
  }
  const sourceErrors = [];
  const [
    driversPayload,
    lapsPayload,
    positionsPayload,
    intervalsPayload,
    pitsPayload,
    stintsPayload,
    raceControlPayload,
    weatherPayload,
  ] = await Promise.all([
    fetchOpenF1Optional(`${baseUrl}/drivers?session_key=${sourceSessionKey}`, sourceErrors, "drivers"),
    fetchOpenF1Optional(`${baseUrl}/laps?session_key=${sourceSessionKey}`, sourceErrors, "laps"),
    fetchOpenF1Optional(`${baseUrl}/position?session_key=${sourceSessionKey}`, sourceErrors, "position"),
    fetchOpenF1Optional(`${baseUrl}/intervals?session_key=${sourceSessionKey}`, sourceErrors, "intervals"),
    fetchOpenF1Optional(`${baseUrl}/pit?session_key=${sourceSessionKey}`, sourceErrors, "pit"),
    fetchOpenF1Optional(`${baseUrl}/stints?session_key=${sourceSessionKey}`, sourceErrors, "stints"),
    fetchOpenF1Optional(`${baseUrl}/race_control?session_key=${sourceSessionKey}`, sourceErrors, "race_control"),
    fetchOpenF1Optional(`${baseUrl}/weather?session_key=${sourceSessionKey}`, sourceErrors, "weather"),
  ]);
  const driverNumbers = getReplayDriverNumbers(driversPayload, positionsPayload, lapsPayload);
  const locationByDriver = await fetchReplayLocationsByDriver(baseUrl, sourceSessionKey, driverNumbers, sourceErrors);

  let trackDefinition = buildReplayTrackDefinition({
    circuit,
    lapsPayload,
    locationByDriver,
    sourceSeason,
    sourceSession,
    sourceSessionKey,
  });

  if (!trackDefinition) {
    await upsertFailedReplaySession(currentRace, circuit, sourceSession, sourceSeason, sourceErrors, "track_definition_failed");
    return {
      itemsProcessed: 0,
      metadata: {
        race: currentRace.race_name,
        round: currentRace.round,
        sourceSeason,
        sourceSessionKey,
        sourceErrors,
        skippedReason: "track_definition_failed",
      },
    };
  }

  trackDefinition = withVerifiedReplayPitLane(trackDefinition);
  trackDefinition.pitLane = buildReplayPitLaneDefinition({
    locationByDriver,
    pitsPayload,
    trackDefinition,
  });

  const { data: trackMap, error: trackError } = await supabase
    .from("track_maps")
    .upsert(
      {
        circuit_id: circuit.id,
        circuit_key: trackDefinition.circuitKey,
        circuit_name: trackDefinition.circuitName,
        definition: trackDefinition,
        meeting_key: trackDefinition.meetingKey,
        season_source: sourceSeason,
        session_key: sourceSessionKey,
      },
      { onConflict: "circuit_key,season_source" },
    )
    .select("id")
    .single();

  if (trackError) {
    throw trackError;
  }

  const replayPayload = buildReplaySnapshot({
    circuit,
    currentRace,
    driversPayload,
    intervalsPayload,
    lapsPayload,
    locationByDriver,
    pitsPayload,
    positionsPayload,
    raceControlPayload,
    sourceSeason,
    sourceSession,
    sourceSessionKey,
    stintsPayload,
    trackDefinition,
    weatherPayload,
  });

  if (!replayPayload.positions.length || !replayPayload.lapTimings.length) {
    throw new Error(`Incomplete Race Replay data for session ${sourceSessionKey}; retry when telemetry and laps are available`);
  }

  const replayRow = {
    circuit_id: circuit.id,
    duration_ms: replayPayload.durationMs,
    prepared_at: new Date().toISOString(),
    race_id: currentRace.id,
    snapshot: compactReplaySnapshot(replayPayload),
    source_errors: sourceErrors,
    source_meeting_key: numberOrNull(sourceSession.meeting_key),
    source_race_name: sourceSession.meeting_name ?? sourceSession.session_name ?? currentRace.race_name,
    source_season: sourceSeason,
    source_session_key: sourceSessionKey,
    source_session_name: sourceSession.session_name ?? sourceSession.session_type ?? "Race",
    source_started_at: sourceSession.date_start ? new Date(sourceSession.date_start).toISOString() : null,
    status: replayPayload.positions.length ? "preparing" : "failed",
    title: `${currentRace.race_name}: повтор гонки ${sourceSeason}`,
    total_laps: replayPayload.totalLaps,
    track_map_id: trackMap.id,
  };
  const replaySession = await upsertReplaySessionWithRetry(replayRow, 3);
  const eventIndexing = await replaceReplayEvents(replaySession.id, replayPayload);

  if (eventIndexing.status !== "indexed") {
    await supabase
      .from("race_replay_sessions")
      .update({ status: "failed" })
      .eq("id", replaySession.id);
    throw new Error(`Replay event indexing failed: ${eventIndexing.message ?? "unknown error"}`);
  }

  const { error: readyError } = await supabase
    .from("race_replay_sessions")
    .update({ status: "ready" })
    .eq("id", replaySession.id);

  if (readyError) {
    throw readyError;
  }

  return {
    itemsProcessed: replayPayload.positions.length + replayPayload.raceEvents.length,
    metadata: {
      drivers: replayPayload.drivers.length,
      eventIndexing,
      positions: replayPayload.positions.length,
      race: currentRace.race_name,
      round: currentRace.round,
      sourceErrors,
      sourceSeason,
      sourceSessionKey,
      snapshotWrite: "compact_event_index",
    },
  };
}

function compactReplaySnapshot(replayPayload) {
  return {
    ...replayPayload,
    intervalTimings: replayPayload.intervalTimings ?? [],
    lapTimings: [],
    positionTimings: [],
    positions: [],
  };
}

function findReplaySourceRaceSession(circuit, sessions) {
  return (sessions ?? [])
    .map((session) => ({
      score: scoreReplayRaceSession(circuit, session),
      session,
    }))
    .filter((item) => item.score >= 65)
    .sort((a, b) => b.score - a.score)[0]?.session ?? null;
}

function scoreReplayRaceSession(circuit, session) {
  const sessionNameType = normalizeSessionType(session.session_name ?? session.session_type);
  const sessionType = normalizeSessionType(session.session_type ?? session.session_name);
  const isMainRace = sessionNameType === "race";
  const isSprint = sessionNameType === "sprint" || String(session.session_name ?? "").toLowerCase().includes("sprint");

  return (
    scoreCircuitMatch(circuit, session)
    + (isMainRace ? 90 : sessionType === "race" ? 30 : 0)
    - (isSprint ? 120 : 0)
  );
}

async function fetchOpenF1Optional(url, sourceErrors, label) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;

      if (attempt < 3) {
        await sleep(1_000 * attempt);
      }
    }
  }

  sourceErrors.push({ label, message: getSafeErrorMessage(lastError) });
  return [];
}

function getReplayDriverNumbers(driversPayload, positionsPayload, lapsPayload) {
  const values = new Set();

  for (const item of [...(driversPayload ?? []), ...(positionsPayload ?? []), ...(lapsPayload ?? [])]) {
    const driverNumber = Number(item.driver_number);

    if (Number.isFinite(driverNumber)) {
      values.add(driverNumber);
    }
  }

  return [...values].sort((a, b) => a - b).slice(0, 24);
}

async function fetchReplayLocationsByDriver(baseUrl, sourceSessionKey, driverNumbers, sourceErrors) {
  const locationByDriver = new Map();
  const concurrency = Math.max(1, Number(process.env.RACE_REPLAY_LOCATION_CONCURRENCY ?? 6));

  for (let index = 0; index < driverNumbers.length; index += concurrency) {
    const chunk = driverNumbers.slice(index, index + concurrency);
    const results = await Promise.all(
      chunk.map(async (driverNumber) => {
        const locations = await fetchReplayLocations(
          `${baseUrl}/location?session_key=${sourceSessionKey}&driver_number=${driverNumber}`,
          sourceErrors,
          `location_${driverNumber}`,
        );

        return {
          driverNumber,
          locations: filterReplayLocationsByDriver(locations, driverNumber),
        };
      }),
    );

    for (const result of results) {
      if (result.locations.length) {
        locationByDriver.set(result.driverNumber, result.locations);
      }
    }
  }

  return locationByDriver;
}

async function fetchReplayLocations(url, sourceErrors, label) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetchJson(url, 1, 45_000);
    } catch (error) {
      lastError = error;

      if (attempt < 3) {
        await sleep(1_000 * attempt);
      }
    }
  }

  sourceErrors.push({ label, message: getSafeErrorMessage(lastError) });
  return [];
}

function filterReplayLocationsByDriver(locations, driverNumber) {
  const filtered = (locations ?? []).filter((item) => Number(item.driver_number) === Number(driverNumber));

  return filtered.length ? filtered : locations ?? [];
}

export function buildReplayTrackDefinition({ circuit, lapsPayload, locationByDriver, sourceSeason, sourceSession, sourceSessionKey }) {
  const raceStartMs = getReplayStartMs(sourceSession, locationByDriver);
  const timedLapsPayload = addReplayInferredLapTimes(lapsPayload, raceStartMs, locationByDriver);
  const raceEndMs = getReplayEndMs(sourceSession, timedLapsPayload, raceStartMs);
  const candidateLapsByDriver = getReplayCandidateLapsByDriver(timedLapsPayload);
  const sourceDrivers = [
    ...candidateLapsByDriver.keys(),
    ...locationByDriver.keys(),
  ];
  const candidates = [];

  for (const driverNumber of sourceDrivers) {
    const locations = locationByDriver.get(driverNumber);

    if (!locations?.length) {
      continue;
    }

    const rawPoints = normalizeOpenF1LocationPoints(locations)
      .filter((point) => point.dateMs >= raceStartMs && point.dateMs <= raceEndMs);
    let sourceLap = null;
    let lapPoints = [];

    for (const lap of candidateLapsByDriver.get(driverNumber) ?? []) {
      const lapStart = Number.isFinite(Number(lap?.dateMs))
        ? Number(lap.dateMs)
        : lap?.date_start
          ? new Date(lap.date_start).getTime()
          : null;
      const lapDurationMs = Number.isFinite(Number(lap?.lap_duration))
        ? Number(lap.lap_duration) * 1000
        : null;
      const lapEnd = lapStart && lapDurationMs ? lapStart + lapDurationMs : null;
      const candidatePoints =
        lapStart && lapEnd
          ? rawPoints.filter((point) => point.dateMs >= lapStart && point.dateMs <= lapEnd)
          : [];

      if (candidatePoints.length >= 18) {
        sourceLap = lap;
        lapPoints = candidatePoints;
        break;
      }
    }

    const points = filterTrackPointOutliers(lapPoints.length >= 18 ? lapPoints : rawPoints);

    if (points.length < 18) {
      continue;
    }

    candidates.push({
      driverNumber,
      lapNumber: sourceLap ? numberOrNull(sourceLap.lap_number) : null,
      points,
      score: scoreReplayTrackSource(points),
    });
  }

  const bestCandidate = candidates.sort((a, b) => b.score - a.score)[0];

  return bestCandidate
    ? buildTrackDefinitionFromPoints({
        circuit,
        driverNumber: bestCandidate.driverNumber,
        lapNumber: bestCandidate.lapNumber,
        meetingKey: numberOrNull(sourceSession.meeting_key),
        points: bestCandidate.points,
        sourceSeason,
        sourceSessionKey,
      })
    : null;
}

function normalizeOpenF1LocationPoints(locations) {
  return (locations ?? [])
    .map((item) => ({
      date: item.date,
      dateMs: item.date ? new Date(item.date).getTime() : 0,
      x: Number(item.x),
      y: Number(item.y),
      z: Number(item.z ?? 0),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.dateMs))
    .filter((point) => !(point.x === 0 && point.y === 0 && point.z === 0))
    .sort((a, b) => a.dateMs - b.dateMs);
}

function addReplayInferredLapTimes(lapsPayload, raceStartMs, locationByDriver) {
  const grouped = groupReplayEventsByDriver(lapsPayload);
  const result = [];

  for (const [driverNumber, laps] of grouped.entries()) {
    const locations = normalizeOpenF1LocationPoints(locationByDriver?.get(driverNumber) ?? []);
    const firstTelemetryMs = locations.find((point) => point.dateMs >= raceStartMs)?.dateMs ?? raceStartMs;
    let cursorMs = Math.max(raceStartMs, firstTelemetryMs);

    for (const lap of [...laps].sort((a, b) => Number(a.lap_number ?? 0) - Number(b.lap_number ?? 0))) {
      const explicitStartMs = Number.isFinite(Number(lap.dateMs)) && Number(lap.dateMs) > 0
        ? Number(lap.dateMs)
        : lap.date_start
          ? new Date(lap.date_start).getTime()
          : NaN;
      const startMs = Number.isFinite(explicitStartMs) && explicitStartMs > 0 ? explicitStartMs : cursorMs;
      const lapDurationMs = Number.isFinite(Number(lap.lap_duration)) && Number(lap.lap_duration) > 0
        ? Number(lap.lap_duration) * 1000
        : 90_000;

      result.push({
        ...lap,
        dateMs: startMs,
        inferredDateStart: !Number.isFinite(explicitStartMs) || explicitStartMs <= 0,
      });
      cursorMs = startMs + lapDurationMs;
    }
  }

  return result;
}

function getReplayCandidateLapsByDriver(lapsPayload) {
  const grouped = new Map();

  for (const lap of lapsPayload ?? []) {
    const driverNumber = Number(lap.driver_number);
    const lapDuration = Number(lap.lap_duration);

    if (!Number.isFinite(driverNumber) || !Number.isFinite(lapDuration) || lapDuration <= 0) {
      continue;
    }

    const list = grouped.get(driverNumber) ?? [];
    list.push(lap);
    grouped.set(driverNumber, list);
  }

  for (const [driverNumber, laps] of grouped.entries()) {
    grouped.set(
      driverNumber,
      laps.sort((a, b) =>
        Number(a.lap_duration) - Number(b.lap_duration) ||
        Number(a.lap_number ?? 999) - Number(b.lap_number ?? 999),
      ),
    );
  }

  return grouped;
}

function scoreReplayTrackSource(points) {
  const simplified = simplifyReplayTrackPoints(points, 260);

  if (simplified.length < 18) {
    return -Infinity;
  }

  const bounds = getReplayWorldBounds(simplified);
  const diagonal = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) || 1;
  const pathLength = simplified.slice(1).reduce((sum, point, index) => sum + distanceBetween(point, simplified[index]), 0);
  const ratio = pathLength / diagonal;
  const steps = simplified.slice(1).map((point, index) => distanceBetween(point, simplified[index]));
  const maxStep = Math.max(...steps, 0);
  const sortedSteps = [...steps].sort((a, b) => a - b);
  const medianStep = sortedSteps[Math.floor(sortedSteps.length / 2)] || 1;
  const noisyStepCount = steps.filter((step) => step > medianStep * 4).length;
  const intersectionCount = countReplayTrackIntersections(simplified);

  return (
    simplified.length
    - Math.abs(ratio - 4.8) * 90
    - noisyStepCount * 18
    - intersectionCount * 35
    - Math.max(0, maxStep - medianStep * 6) * 0.8
  );
}

function simplifyReplayTrackPoints(points, maxPoints) {
  const spatiallyFiltered = [];
  const minDistance = 10;

  for (const point of points ?? []) {
    const previous = spatiallyFiltered.at(-1);

    if (!previous || distanceBetween(previous, point) >= minDistance) {
      spatiallyFiltered.push(point);
    }
  }

  const source = spatiallyFiltered.length >= 80 ? spatiallyFiltered : points;
  const step = Math.max(1, Math.ceil(source.length / maxPoints));
  const sampled = source.filter((_, index) => index % step === 0);

  return smoothReplayTrackPoints(sampled.length >= 3 ? sampled : source);
}

export function smoothReplayTrackPoints(points) {
  if ((points?.length ?? 0) < 3) {
    return points ?? [];
  }

  let smoothed = points;

  // A circuit is a closed loop. Treating the first and last samples as hard
  // endpoints creates an artificial corner exactly at the start/finish seam.
  for (let pass = 0; pass < 2; pass += 1) {
    smoothed = smoothed.map((point, index) => {
      const previous = smoothed[(index - 1 + smoothed.length) % smoothed.length];
      const next = smoothed[(index + 1) % smoothed.length];

      return {
        ...point,
        x: (previous.x + point.x * 2 + next.x) / 4,
        y: (previous.y + point.y * 2 + next.y) / 4,
        z: (previous.z + point.z * 2 + next.z) / 4,
      };
    });
  }

  return smoothed;
}

function countReplayTrackIntersections(points) {
  let count = 0;
  const maxChecks = 5000;
  let checks = 0;

  for (let left = 0; left < points.length - 3; left += 1) {
    for (let right = left + 3; right < points.length - 1; right += 1) {
      if (left === 0 && right >= points.length - 3) {
        continue;
      }

      checks += 1;

      if (checks > maxChecks) {
        return count;
      }

      if (segmentsIntersect(points[left], points[left + 1], points[right], points[right + 1])) {
        count += 1;
      }
    }
  }

  return count;
}

function segmentsIntersect(a, b, c, d) {
  const ccw = (p1, p2, p3) => (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);

  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

function buildTrackDefinitionFromPoints({ circuit, driverNumber, lapNumber, meetingKey, points, sourceSeason, sourceSessionKey }) {
  const centerSource = simplifyReplayTrackPoints(points, 260);
  const bounds = getReplayWorldBounds(centerSource);
  const viewBox = { width: 1000, height: 720 };
  const padding = 58;
  const sourceWidth = Math.max(1, bounds.maxX - bounds.minX);
  const sourceHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((viewBox.width - padding * 2) / sourceWidth, (viewBox.height - padding * 2) / sourceHeight);
  const offsetX = (viewBox.width - sourceWidth * scale) / 2;
  const offsetY = (viewBox.height - sourceHeight * scale) / 2;
  const { distances, totalDistance } = getReplayClosedTrackDistances(centerSource);
  const centerline = centerSource.map((point, index) => {
    const svg = replayWorldToSvg(point, bounds, { scale, offsetX, offsetY });
    return {
      distanceM: distances[index],
      elevationM: point.z,
      progress: distances[index] / totalDistance,
      svgX: svg.x,
      svgY: svg.y,
      worldX: point.x,
      worldY: point.y,
      worldZ: point.z,
    };
  });
  const path = centerline
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.svgX.toFixed(1)} ${point.svgY.toFixed(1)}`)
    .join(" ");
  const elevation = centerline.map((point, index) => ({
    gradient: calculateReplayGradient(centerline, index),
    normalizedZ: normalizeReplayElevation(point.worldZ, bounds),
    progress: point.progress,
    z: point.worldZ,
  }));

  return {
    centerline,
    circuitKey: String(circuit.external_id ?? circuit.id ?? circuit.name).toLowerCase(),
    circuitName: circuit.name,
    countryName: circuit.country ?? null,
    debug: {
      filteredPointCount: centerline.length,
      generatedAt: new Date().toISOString(),
      sourceLapNumber: lapNumber,
      rawPointCount: points.length,
      sourceDriverNumbers: [driverNumber],
    },
    elevation,
    id: `${circuit.id}-${sourceSeason}-${sourceSessionKey}`,
    meetingKey,
    seasonSource: sourceSeason,
    sessionKey: sourceSessionKey,
    startFinish: {
      progress: 0,
      svgX: centerline[0]?.svgX ?? 0,
      svgY: centerline[0]?.svgY ?? 0,
    },
    svg: {
      technicalPathD: `${path} Z`,
      viewBox,
      visualPathD: `${path} Z`,
    },
    transform: {
      invertY: true,
      offsetX,
      offsetY,
      scale,
    },
    worldBounds: bounds,
  };
}

export function getReplayClosedTrackDistances(points) {
  const distances = [0];

  for (let index = 1; index < points.length; index += 1) {
    distances.push(distances[index - 1] + distanceBetween(points[index - 1], points[index]));
  }

  const closingDistance = points.length >= 2 ? distanceBetween(points.at(-1), points[0]) : 0;

  return {
    closingDistance,
    distances,
    totalDistance: (distances.at(-1) ?? 0) + closingDistance || 1,
  };
}

function getReplayWorldBounds(points) {
  return {
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
    maxZ: Math.max(...points.map((point) => point.z)),
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    minZ: Math.min(...points.map((point) => point.z)),
  };
}

function replayWorldToSvg(point, bounds, transform) {
  return {
    x: transform.offsetX + (point.x - bounds.minX) * transform.scale,
    y: 720 - (transform.offsetY + (point.y - bounds.minY) * transform.scale),
  };
}

function normalizeReplayElevation(z, bounds) {
  if (bounds.maxZ === bounds.minZ) {
    return 0.5;
  }

  return (z - bounds.minZ) / (bounds.maxZ - bounds.minZ);
}

function calculateReplayGradient(points, index) {
  const previous = points[Math.max(0, index - 3)];
  const next = points[Math.min(points.length - 1, index + 3)];
  const distance = Math.max(1, Math.abs((next.distanceM ?? 0) - (previous.distanceM ?? 0)));

  return (next.worldZ - previous.worldZ) / distance;
}

function buildReplaySnapshot({
  circuit,
  currentRace,
  driversPayload,
  intervalsPayload,
  lapsPayload,
  locationByDriver,
  pitsPayload,
  positionsPayload,
  raceControlPayload,
  sourceSeason,
  sourceSession,
  sourceSessionKey,
  stintsPayload,
  trackDefinition,
  weatherPayload,
}) {
  const raceStartMs = getReplayStartMs(sourceSession, locationByDriver);
  const driverMap = buildReplayDriverMap(driversPayload);
  const timedLapsPayload = addReplayInferredLapTimes(lapsPayload, raceStartMs, locationByDriver);
  const raceEndMs = getReplayEndMs(sourceSession, timedLapsPayload, raceStartMs);
  const positionsByDriver = groupReplayEventsByDriver(positionsPayload);
  const intervalsByDriver = groupReplayEventsByDriver(intervalsPayload);
  const lapsByDriver = groupReplayEventsByDriver(timedLapsPayload);
  const stintsByDriver = groupReplayEventsByDriver(stintsPayload);
  const pitCounts = buildReplayPitCounts(pitsPayload);
  const pitWindowsByDriver = buildReplayPitWindows(pitsPayload, raceStartMs, {
    locationByDriver,
    trackDefinition,
  });
  const replayPositions = [];
  const positionTimings = buildReplayPositionTimings(positionsPayload, raceStartMs);

  for (const [driverNumber, locations] of locationByDriver.entries()) {
    const points = normalizeOpenF1LocationPoints(locations)
      .filter((point) => point.dateMs >= raceStartMs && point.dateMs <= raceEndMs);
    const sampleMs = Number(process.env.RACE_REPLAY_SAMPLE_MS ?? 8000);
    let lastEmitted = -Infinity;
    let previousEmittedPoint = null;
    let previousSnapped = null;

    if (!hasReplayLocationMovement(points)) {
      continue;
    }

    for (const point of points) {
      if (point.dateMs < raceStartMs) {
        continue;
      }

      const pitWindow = findReplayPitWindow(pitWindowsByDriver.get(driverNumber), point.dateMs);
      const activeSampleMs = pitWindow ? Math.min(sampleMs, 1500) : sampleMs;

      if (point.dateMs - lastEmitted < activeSampleMs) {
        continue;
      }

      const offsetMs = point.dateMs - raceStartMs;
      const svg = replayWorldToSvg(point, trackDefinition.worldBounds, trackDefinition.transform);
      const maxProgressDelta = getReplayMaxProgressDelta(point.dateMs - lastEmitted);
      const snapped = snapReplayPointToTrack(svg, trackDefinition.centerline, {
        maxProgressDelta,
        previousProgress: previousSnapped?.progress ?? null,
      });
      const pitLaneSample = pitWindow
        ? sampleReplayPitLanePoint(trackDefinition.pitLane?.points, pitWindow, point.dateMs)
        : null;

      if (!pitLaneSample && shouldSkipFrozenReplayPoint(previousEmittedPoint, snapped, point.dateMs)) {
        continue;
      }

      const position = findLatestTimedEvent(positionsByDriver.get(driverNumber), point.dateMs);
      const interval = findLatestTimedEvent(intervalsByDriver.get(driverNumber), point.dateMs);
      const lap = findLatestTimedEvent(lapsByDriver.get(driverNumber), point.dateMs);
      const stint = findReplayStint(stintsByDriver.get(driverNumber), lap?.lap_number);
      const lapTiming = getReplayLapTiming(lap);

      const positionEvent = {
        compound: stint?.compound ?? null,
        driverNumber,
        gapToLeader: formatReplayGap(interval?.gap_to_leader),
        headingRad: pitLaneSample?.headingRad ?? snapped.headingRad,
        intervalToAhead: formatReplayGap(interval?.interval),
        isPitLane: Boolean(pitWindow && pitLaneSample),
        lapNumber: numberOrNull(lap?.lap_number),
        lastLapDuration: lapTiming.lastLapDuration,
        lastLapTime: lapTiming.lastLapTime,
        normalizedZ: snapped.normalizedZ,
        offsetMs,
        pitLaneDuration: pitLaneSample ? pitWindow?.laneDuration ?? null : null,
        pitStopDuration: pitLaneSample ? pitWindow?.stopDuration ?? null : null,
        position: numberOrNull(position?.position),
        progress: snapped.progress,
        sector1Time: lapTiming.sector1Time,
        sector2Time: lapTiming.sector2Time,
        sector3Time: lapTiming.sector3Time,
        svgX: pitLaneSample?.svgX ?? snapped.svgX,
        svgY: pitLaneSample?.svgY ?? snapped.svgY,
        timestamp: point.date ? new Date(point.date).toISOString() : new Date(raceStartMs + offsetMs).toISOString(),
        tyreAge: getReplayTyreAge(stint, lap?.lap_number),
        z: snapped.z,
      };
      replayPositions.push(positionEvent);
      lastEmitted = point.dateMs;
      previousEmittedPoint = {
        dateMs: point.dateMs,
        svgX: positionEvent.svgX,
        svgY: positionEvent.svgY,
      };
      previousSnapped = snapped;
    }
  }

  replayPositions.sort((a, b) => a.offsetMs - b.offsetMs || a.driverNumber - b.driverNumber);
  const driversWithReplayPositions = new Set(replayPositions.map((event) => event.driverNumber));
  const intervalTimings = buildReplayIntervalTimings(intervalsPayload, raceStartMs);
  const lapTimings = buildReplayLapTimings(timedLapsPayload, raceStartMs);
  const durationMs = getReplayDurationMs(replayPositions, lapTimings);
  const driverNumbers = [
    ...new Set([
      ...driverMap.keys(),
      ...positionsByDriver.keys(),
      ...lapsByDriver.keys(),
      ...replayPositions.map((event) => event.driverNumber),
    ]),
  ].sort((a, b) => a - b);
  const totalLaps = getReplayTotalLaps(timedLapsPayload);
  const drivers = driverNumbers.map((driverNumber) => {
    const driver = driverMap.get(driverNumber);
    const latestPosition = [...(positionsByDriver.get(driverNumber) ?? [])].reverse()[0];
    const firstPosition = positionsByDriver.get(driverNumber)?.[0];
    const bestLap = getReplayBestLap(lapsByDriver.get(driverNumber));
    const firstStint = stintsByDriver.get(driverNumber)?.[0];
    const latestLap = [...(lapsByDriver.get(driverNumber) ?? [])].reverse()[0];
    const latestLapTiming = getReplayLapTiming(latestLap);
    const completedRaceDistance =
      totalLaps !== null && Number(latestLap?.lap_number) >= totalLaps;
    const status = driversWithReplayPositions.has(driverNumber) || completedRaceDistance
      ? "RUNNING"
      : latestLap
        ? "OUT"
        : "NO_DATA";

    return {
      abbreviation: driver?.abbreviation ?? String(driverNumber),
      bestLapTime: formatLapDuration(bestLap?.lap_duration),
      compound: firstStint?.compound ?? null,
      driverNumber,
      fullName: driver?.fullName ?? `Пилот ${driverNumber}`,
      gapToLeader: null,
      intervalToAhead: null,
      lapNumber: null,
      lastLapDuration: latestLapTiming.lastLapDuration,
      lastLapTime: latestLapTiming.lastLapTime,
      pitStops: pitCounts.get(driverNumber) ?? 0,
      sector1Time: latestLapTiming.sector1Time,
      sector2Time: latestLapTiming.sector2Time,
      sector3Time: latestLapTiming.sector3Time,
      position: numberOrNull(firstPosition?.position ?? latestPosition?.position),
      status,
      teamColor: driver?.teamColor ?? "#E10600",
      teamName: driver?.teamName ?? "Команда",
      tyreAge: null,
    };
  }).sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  const raceEvents = buildReplayRaceEvents(raceControlPayload, raceStartMs);

  return {
    circuitName: circuit.name,
    drivers,
    durationMs,
    intervalTimings,
    lapTimings,
    positionTimings,
    positions: replayPositions,
    raceEvents,
    raceName: currentRace.race_name,
    replaySessionId: "",
    sourceSeason,
    sourceSessionKey,
    totalLaps,
    track: trackDefinition,
    weather: buildReplayWeather(weatherPayload),
  };
}

export function getReplayDurationMs(positions, lapTimings) {
  return Math.max(
    1,
    positions.reduce((end, event) => Math.max(end, event.offsetMs), 0),
    lapTimings.reduce((end, timing) => Math.max(end, timing[2] + timing[3]), 0),
  );
}

function buildReplayIntervalTimings(intervalsPayload, raceStartMs) {
  const lastOffsetByDriver = new Map();

  return (intervalsPayload ?? [])
    .map((item) => {
      const driverNumber = Number(item?.driver_number);
      const timestampMs = item?.date ? new Date(item.date).getTime() : NaN;
      const offsetMs = Math.round(timestampMs - raceStartMs);

      if (
        !Number.isFinite(driverNumber) ||
        !Number.isFinite(timestampMs) ||
        timestampMs < raceStartMs ||
        offsetMs - (lastOffsetByDriver.get(driverNumber) ?? -Infinity) < 8_000
      ) {
        return null;
      }

      lastOffsetByDriver.set(driverNumber, offsetMs);

      return {
        driverNumber,
        gapToLeader: formatReplayGap(item?.gap_to_leader),
        intervalToAhead: formatReplayGap(item?.interval),
        offsetMs,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.offsetMs - b.offsetMs || a.driverNumber - b.driverNumber);
}

function buildReplayPositionTimings(positionsPayload, raceStartMs) {
  return (positionsPayload ?? [])
    .map((item) => {
      const driverNumber = Number(item?.driver_number);
      const position = Number(item?.position);
      const timestampMs = item?.date ? new Date(item.date).getTime() : NaN;

      return Number.isFinite(driverNumber) &&
        Number.isFinite(position) &&
        Number.isFinite(timestampMs) &&
        timestampMs >= raceStartMs
        ? {
            driverNumber,
            offsetMs: Math.round(timestampMs - raceStartMs),
            position,
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.offsetMs - b.offsetMs || a.driverNumber - b.driverNumber);
}

function buildReplayLapTimings(timedLapsPayload, raceStartMs) {
  return (timedLapsPayload ?? [])
    .map((lap) => {
      const driverNumber = Number(lap?.driver_number);
      const lapNumber = Number(lap?.lap_number);
      const startMs = Number(lap?.dateMs);
      const durationSeconds = Number(lap?.lap_duration);

      if (
        !Number.isFinite(driverNumber) ||
        !Number.isFinite(lapNumber) ||
        lapNumber <= 0 ||
        !Number.isFinite(startMs)
      ) {
        return null;
      }

      return [
        driverNumber,
        lapNumber,
        Math.round(startMs - raceStartMs),
        Number.isFinite(durationSeconds) && durationSeconds > 0
          ? Math.round(durationSeconds * 1000)
          : 0,
      ];
    })
    .filter(Boolean)
    .sort((a, b) =>
      a[0] - b[0] ||
      a[1] - b[1] ||
      a[2] - b[2],
    );
}

function getReplayLapTiming(lap) {
  const lastLapDuration = numberOrNull(lap?.lap_duration);

  return {
    lastLapDuration,
    lastLapTime: formatNullableReplayLapDuration(lastLapDuration),
    sector1Time: formatNullableReplayLapDuration(lap?.duration_sector_1),
    sector2Time: formatNullableReplayLapDuration(lap?.duration_sector_2),
    sector3Time: formatNullableReplayLapDuration(lap?.duration_sector_3),
  };
}

function formatNullableReplayLapDuration(value) {
  return numberOrNull(value) === null ? null : formatLapDuration(value);
}

function shouldSkipFrozenReplayPoint(previousPoint, snappedPoint, dateMs) {
  if (!previousPoint || !snappedPoint) {
    return false;
  }

  const deltaMs = dateMs - previousPoint.dateMs;

  if (deltaMs < 1000) {
    return false;
  }

  const distance = Math.hypot(snappedPoint.svgX - previousPoint.svgX, snappedPoint.svgY - previousPoint.svgY);

  return distance < 0.75;
}

function hasReplayLocationMovement(points) {
  if (!points?.length || points.length < 8) {
    return false;
  }

  const sample = points.filter((_, index) => index % Math.max(1, Math.floor(points.length / 160)) === 0);
  const minX = Math.min(...sample.map((point) => point.x));
  const maxX = Math.max(...sample.map((point) => point.x));
  const minY = Math.min(...sample.map((point) => point.y));
  const maxY = Math.max(...sample.map((point) => point.y));

  return Math.hypot(maxX - minX, maxY - minY) >= 120;
}

function getReplayStartMs(sourceSession, locationByDriver) {
  const sourceStart = sourceSession.date_start ? new Date(sourceSession.date_start).getTime() : null;

  if (Number.isFinite(sourceStart)) {
    return sourceStart;
  }

  const firstLocationTimes = [...locationByDriver.values()]
    .flat()
    .map((item) => item.date ? new Date(item.date).getTime() : NaN)
    .filter(Number.isFinite);

  if (firstLocationTimes.length) {
    return firstLocationTimes.reduce((min, value) => Math.min(min, value), Infinity);
  }

  return Date.now();
}

function getReplayEndMs(sourceSession, timedLapsPayload, raceStartMs) {
  const lapEnds = (timedLapsPayload ?? [])
    .map((lap) => {
      const startMs = Number(lap?.dateMs);
      const durationMs = Number(lap?.lap_duration) * 1000;

      return Number.isFinite(startMs) && Number.isFinite(durationMs) && durationMs > 0
        ? startMs + durationMs
        : null;
    })
    .filter(Number.isFinite);
  const sourceEnd = sourceSession.date_end ? new Date(sourceSession.date_end).getTime() : null;
  const latestLapEnd = lapEnds.length ? Math.max(...lapEnds) : null;

  if (latestLapEnd && latestLapEnd > raceStartMs) {
    return latestLapEnd + 180_000;
  }

  if (Number.isFinite(sourceEnd) && sourceEnd > raceStartMs) {
    return sourceEnd + 1_800_000;
  }

  return raceStartMs + 4 * 60 * 60 * 1000;
}

function buildReplayDriverMap(driversPayload) {
  const map = new Map();

  for (const driver of driversPayload ?? []) {
    const driverNumber = Number(driver.driver_number);

    if (!Number.isFinite(driverNumber)) {
      continue;
    }

    map.set(driverNumber, {
      abbreviation: driver.name_acronym ?? driver.broadcast_name ?? String(driverNumber),
      fullName: driver.full_name ?? driver.broadcast_name ?? `Пилот ${driverNumber}`,
      teamColor: normalizeHexColor(driver.team_colour),
      teamName: driver.team_name ?? "Команда",
    });
  }

  return map;
}

function normalizeHexColor(value) {
  const text = String(value ?? "").trim();

  if (/^#[0-9a-f]{6}$/i.test(text)) {
    return text;
  }

  if (/^[0-9a-f]{6}$/i.test(text)) {
    return `#${text}`;
  }

  return "#E10600";
}

function groupReplayEventsByDriver(events) {
  const grouped = new Map();

  for (const event of events ?? []) {
    const driverNumber = Number(event.driver_number);

    if (!Number.isFinite(driverNumber)) {
      continue;
    }

    const dateMs = event.date ? new Date(event.date).getTime() : event.date_start ? new Date(event.date_start).getTime() : 0;
    const item = { ...event, dateMs };
    const list = grouped.get(driverNumber) ?? [];
    list.push(item);
    grouped.set(driverNumber, list);
  }

  for (const list of grouped.values()) {
    list.sort((a, b) => a.dateMs - b.dateMs);
  }

  return grouped;
}

function findLatestTimedEvent(events, dateMs) {
  if (!events?.length) {
    return null;
  }

  let result = null;

  for (const event of events) {
    if (event.dateMs > dateMs) {
      break;
    }

    result = event;
  }

  return result;
}

function findReplayStint(stints, lapNumber) {
  if (!stints?.length || !Number.isFinite(Number(lapNumber))) {
    return stints?.[0] ?? null;
  }

  return stints.find((stint) => Number(stint.lap_start) <= Number(lapNumber) && Number(stint.lap_end) >= Number(lapNumber))
    ?? stints.find((stint) => Number(stint.lap_start) <= Number(lapNumber))
    ?? stints[0]
    ?? null;
}

function getReplayTyreAge(stint, lapNumber) {
  if (!stint || !Number.isFinite(Number(lapNumber)) || !Number.isFinite(Number(stint.lap_start))) {
    return null;
  }

  return Math.max(0, Number(lapNumber) - Number(stint.lap_start) + 1);
}

function buildReplayPitCounts(pitsPayload) {
  const counts = new Map();

  for (const pit of pitsPayload ?? []) {
    const driverNumber = Number(pit.driver_number);

    if (Number.isFinite(driverNumber)) {
      counts.set(driverNumber, (counts.get(driverNumber) ?? 0) + 1);
    }
  }

  return counts;
}

function buildReplayPitWindows(pitsPayload, raceStartMs, { locationByDriver, trackDefinition } = {}) {
  const byDriver = new Map();

  for (const pit of pitsPayload ?? []) {
    const driverNumber = Number(pit.driver_number);
    const dateMs = pit.date ? new Date(pit.date).getTime() : NaN;
    const laneDuration = getReplayPitLaneDuration(pit);
    const laneDurationMs = laneDuration * 1000;

    if (!Number.isFinite(driverNumber) || !Number.isFinite(dateMs) || dateMs < raceStartMs) {
      continue;
    }

    const list = byDriver.get(driverNumber) ?? [];
    list.push({
      endMs: dateMs + 1500,
      laneDuration,
      offsetEndMs: dateMs - raceStartMs,
      offsetStartMs: dateMs - laneDurationMs - raceStartMs,
      startMs: dateMs - laneDurationMs - 1500,
      stopDuration: getReplayPitStopDuration(pit),
    });
    byDriver.set(driverNumber, list);
  }

  if (trackDefinition?.pitLane?.points?.length && locationByDriver?.size) {
    for (const [driverNumber, locations] of locationByDriver.entries()) {
      if (byDriver.get(driverNumber)?.length) {
        continue;
      }

      const telemetryWindows = buildReplayPitWindowsFromTelemetry(locations, raceStartMs, trackDefinition);

      if (telemetryWindows.length) {
        byDriver.set(driverNumber, telemetryWindows);
      }
    }
  }

  for (const list of byDriver.values()) {
    list.sort((a, b) => a.startMs - b.startMs);
  }

  return byDriver;
}

function buildReplayPitWindowsFromTelemetry(locations, raceStartMs, trackDefinition) {
  const rawPoints = normalizeOpenF1LocationPoints(locations).filter((point) => point.dateMs >= raceStartMs);
  const windows = [];
  let current = [];

  const flushCurrent = () => {
    if (current.length < 3) {
      current = [];
      return;
    }

    const first = current[0];
    const last = current.at(-1);
    const durationMs = last.dateMs - first.dateMs;

    if (durationMs >= 8_000 && durationMs <= 90_000) {
      windows.push({
        endMs: last.dateMs + 1500,
        laneDuration: Math.max(8, durationMs / 1000),
        offsetEndMs: last.dateMs - raceStartMs,
        offsetStartMs: first.dateMs - raceStartMs,
        startMs: first.dateMs - 1500,
        stopDuration: null,
      });
    }

    current = [];
  };

  for (const point of rawPoints) {
    const svg = replayWorldToSvg(point, trackDefinition.worldBounds, trackDefinition.transform);
    const nearestTrack = findNearestReplayCenterlinePoint(svg, trackDefinition.centerline);
    const nearestPit = findNearestReplayPitLanePoint(svg, trackDefinition.pitLane.points);
    const trackDistance = Math.hypot(svg.x - nearestTrack.svgX, svg.y - nearestTrack.svgY);
    const pitDistance = nearestPit ? Math.hypot(svg.x - nearestPit.svgX, svg.y - nearestPit.svgY) : Infinity;
    const isPitTelemetry = pitDistance <= 34 && trackDistance >= 10 && pitDistance < trackDistance;

    if (isPitTelemetry) {
      current.push(point);
      continue;
    }

    flushCurrent();
  }

  flushCurrent();

  return windows;
}

function findReplayPitWindow(windows, dateMs) {
  if (!windows?.length) {
    return null;
  }

  return windows.find((window) => dateMs >= window.startMs && dateMs <= window.endMs) ?? null;
}

function sampleReplayPitLanePoint(points, pitWindow, dateMs) {
  if (!points?.length || !pitWindow) {
    return null;
  }

  const durationMs = Math.max(1, pitWindow.endMs - pitWindow.startMs);
  const progress = Math.min(1, Math.max(0, (dateMs - pitWindow.startMs) / durationMs));

  return interpolateReplayPolyline(points, progress);
}

function interpolateReplayPolyline(points, progress) {
  if (!points?.length) {
    return null;
  }

  if (points.length === 1) {
    return { ...points[0], headingRad: 0 };
  }

  const segmentLengths = [];
  let totalLength = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const segmentLength = Math.hypot(current.svgX - previous.svgX, current.svgY - previous.svgY);
    segmentLengths.push(segmentLength);
    totalLength += segmentLength;
  }

  const targetDistance = Math.min(totalLength, Math.max(0, progress) * totalLength);
  let traversed = 0;

  for (let index = 1; index < points.length; index += 1) {
    const segmentLength = segmentLengths[index - 1] ?? 0;

    if (traversed + segmentLength < targetDistance) {
      traversed += segmentLength;
      continue;
    }

    const previous = points[index - 1];
    const current = points[index];
    const ratio = segmentLength > 0 ? (targetDistance - traversed) / segmentLength : 0;

    return {
      svgX: previous.svgX + (current.svgX - previous.svgX) * ratio,
      svgY: previous.svgY + (current.svgY - previous.svgY) * ratio,
      worldX: interpolateNullableNumber(previous.worldX, current.worldX, ratio),
      worldY: interpolateNullableNumber(previous.worldY, current.worldY, ratio),
      worldZ: interpolateNullableNumber(previous.worldZ, current.worldZ, ratio),
      headingRad: Math.atan2(current.svgY - previous.svgY, current.svgX - previous.svgX),
    };
  }

  const last = points.at(-1);
  const previous = points.at(-2) ?? last;

  return {
    ...last,
    headingRad: Math.atan2(last.svgY - previous.svgY, last.svgX - previous.svgX),
  };
}

function interpolateNullableNumber(previous, current, ratio) {
  return Number.isFinite(Number(previous)) && Number.isFinite(Number(current))
    ? Number(previous) + (Number(current) - Number(previous)) * ratio
    : null;
}

export function buildReplayPitLaneDefinition({ locationByDriver, pitsPayload, trackDefinition }) {
  const verified = getVerifiedReplayPitLane(trackDefinition);
  if (verified) return verified;
  const officialLayout = getReplayPitLaneGeometryOverride(trackDefinition?.circuitName);

  if (officialLayout) {
    return buildReplayPitLaneFromOfficialLayout(trackDefinition, officialLayout);
  }

  const candidates = [];

  for (const pit of pitsPayload ?? []) {
    const driverNumber = Number(pit.driver_number);
    const dateMs = pit.date ? new Date(pit.date).getTime() : NaN;
    const laneDurationMs = getReplayPitLaneDuration(pit) * 1000;

    if (!Number.isFinite(driverNumber) || !Number.isFinite(dateMs)) {
      continue;
    }

    const rawPoints = normalizeOpenF1LocationPoints(locationByDriver.get(driverNumber) ?? []);
    const narrowPoints = rawPoints.filter((point) => point.dateMs >= dateMs - laneDurationMs && point.dateMs <= dateMs);
    const narrowFiltered = filterReplayPathDuplicates(narrowPoints, 18);

    if (narrowFiltered.length >= 12) {
      candidates.push(buildReplayPitLaneFromWorldPoints(narrowFiltered, trackDefinition, { source: "pit_payload" }));
    }

    const points = rawPoints.filter((point) => point.dateMs >= dateMs - Math.max(laneDurationMs, 60_000) && point.dateMs <= dateMs + 35_000);
    const segments = extractReplayPitLaneSegments(points, trackDefinition);

    for (const segment of segments) {
      candidates.push(buildReplayPitLaneFromWorldPoints(segment, trackDefinition, { source: "pit_payload" }));
    }
  }

  const telemetryCandidate = buildReplayPitLaneFromOffTrackTelemetry(locationByDriver, trackDefinition);

  if (telemetryCandidate) {
    candidates.push(telemetryCandidate);
  }

  const validated = candidates
    .filter(Boolean)
    .filter((candidate) => isValidReplayPitLane(candidate, trackDefinition))
    .sort((a, b) => scoreReplayPitLaneSvgCandidate(b, trackDefinition) - scoreReplayPitLaneSvgCandidate(a, trackDefinition))[0];

  return validated ?? buildReplayPitLaneFromPitAnchors({ locationByDriver, pitsPayload, trackDefinition });
}

export function getReplayPitLaneGeometryOverride(circuitName) {
  const key = String(circuitName ?? "").toLowerCase();

  if (key.includes("spa-francorchamps") || key.includes("belgian")) {
    return {
      endProgress: 0.052,
      entryLabel: "after_turn_19",
      exitLabel: "after_turn_1",
      offset: 19,
      referenceUrl: "https://www.fia.com/system/files/decision-document/2026_belgian_grand_prix_-_competition_notes_-_circuit_map_pit_lane_drawing_emergency_exits_map_and_red_zone.pdf",
      sideSign: 1,
      startProgress: 0.952,
    };
  }

  if (key.includes("hungaroring") || key.includes("hungarian")) {
    return {
      endProgress: 0.045,
      entryLabel: "after_turn_14",
      exitLabel: "turn_1_exit",
      offset: 25,
      referenceUrl: "https://www.fia.com/system/files/decision-document/2026_hungarian_grand_prix_-_competition_notes_-_circuit_map_pit_lane_drawing_emergency_exits_map_and_red_zone.pdf",
      sideSign: 1,
      startProgress: 0.948,
    };
  }

  return null;
}

function buildReplayPitLaneFromOfficialLayout(trackDefinition, layout) {
  if (!trackDefinition?.centerline?.length) {
    return null;
  }

  const count = 96;
  const endProgress = layout.endProgress <= layout.startProgress
    ? layout.endProgress + 1
    : layout.endProgress;
  const source = Array.from({ length: count }, (_, index) => {
    const ratio = count <= 1 ? 0 : index / (count - 1);
    return interpolateReplayCenterlineByProgress(
      trackDefinition.centerline,
      layout.startProgress + (endProgress - layout.startProgress) * ratio,
    );
  });
  const svgPoints = source.map((point, index) => {
    const previous = source[Math.max(0, index - 1)];
    const next = source[Math.min(source.length - 1, index + 1)];
    const tangentX = next.svgX - previous.svgX;
    const tangentY = next.svgY - previous.svgY;
    const length = Math.hypot(tangentX, tangentY) || 1;
    const ratio = count <= 1 ? 0 : index / (count - 1);
    const entryFade = smoothReplayPitOffset(Math.min(1, ratio / 0.16));
    const exitFade = smoothReplayPitOffset(Math.min(1, (1 - ratio) / 0.16));
    const pointOffset = layout.offset * Math.min(entryFade, exitFade);

    return {
      svgX: point.svgX + (-tangentY / length) * layout.sideSign * pointOffset,
      svgY: point.svgY + (tangentX / length) * layout.sideSign * pointOffset,
      worldX: point.worldX,
      worldY: point.worldY,
      worldZ: point.worldZ,
    };
  });

  return buildReplayPitLaneFromSvgPoints(svgPoints, {
    entry: layout.entryLabel,
    exit: layout.exitLabel,
    referenceUrl: layout.referenceUrl,
    source: "official_circuit_layout",
  });
}

function getReplayPitLaneDuration(pit) {
  const laneDuration = numberOrNull(pit?.lane_duration);

  if (laneDuration !== null && laneDuration >= 12 && laneDuration <= 65) {
    return laneDuration;
  }

  return 28;
}

export function getReplayPitStopDuration(pit) {
  const stopDuration = numberOrNull(pit?.stop_duration);
  const laneDuration = numberOrNull(pit?.lane_duration ?? pit?.pit_duration);

  // pit_duration в OpenF1 дублирует время пит-лейна, это не время стоянки у бокса.
  if (
    stopDuration === null
    || stopDuration <= 0
    || stopDuration >= 10
    || (laneDuration !== null && stopDuration >= laneDuration - 0.5)
  ) {
    return null;
  }

  return stopDuration;
}

function buildReplayPitLaneFromPitAnchors({ locationByDriver, pitsPayload, trackDefinition }) {
  if (!pitsPayload?.length || !trackDefinition?.centerline?.length) {
    return null;
  }

  const anchors = [];

  for (const pit of pitsPayload ?? []) {
    const driverNumber = Number(pit.driver_number);
    const dateMs = pit.date ? new Date(pit.date).getTime() : NaN;

    if (!Number.isFinite(driverNumber) || !Number.isFinite(dateMs)) {
      continue;
    }

    const points = normalizeOpenF1LocationPoints(locationByDriver.get(driverNumber) ?? []);
    const anchor = findReplayPitAnchorPoint(points, dateMs, trackDefinition);

    if (anchor) {
      anchors.push(anchor);
    }
  }

  if (anchors.length < 2) {
    return null;
  }

  const cluster = findReplayPitAnchorCluster(anchors);

  if (!cluster?.anchors.length) {
    return null;
  }

  const centerProgress = getCircularMean(cluster.anchors.map((anchor) => anchor.progress));
  const sideSign = getMedianNumber(cluster.anchors.map((anchor) => anchor.sideSign).filter((value) => value !== 0)) >= 0 ? 1 : -1;
  const averageDistance = cluster.anchors.reduce((sum, anchor) => sum + anchor.distance, 0) / cluster.anchors.length;
  const offset = Math.min(46, Math.max(24, averageDistance + 18));

  return buildReplayPitLaneFromCenterlineOffset(trackDefinition, {
    centerProgress,
    metadata: {
      anchors: cluster.anchors.length,
      source: "pit_event_anchor",
    },
    offset,
    sideSign,
  });
}

function findReplayPitAnchorPoint(points, dateMs, trackDefinition) {
  const nearby = points
    .filter((point) => Math.abs(point.dateMs - dateMs) <= 45_000)
    .map((point) => {
      const svg = replayWorldToSvg(point, trackDefinition.worldBounds, trackDefinition.transform);
      const nearest = findNearestReplayCenterlinePoint(svg, trackDefinition.centerline);
      const distance = Math.hypot(svg.x - nearest.svgX, svg.y - nearest.svgY);

      return {
        distance,
        progress: nearest.progress,
        sideSign: getReplaySignedSide(svg, nearest, trackDefinition.centerline),
        timeDistance: Math.abs(point.dateMs - dateMs),
      };
    })
    .filter((anchor) => Number.isFinite(anchor.progress) && anchor.distance <= 360);

  if (!nearby.length) {
    return null;
  }

  return nearby.sort((a, b) =>
    Math.abs(a.distance - 36) - Math.abs(b.distance - 36) ||
    a.timeDistance - b.timeDistance,
  )[0];
}

function getReplaySignedSide(svgPoint, nearestPoint, centerline) {
  const index = centerline.indexOf(nearestPoint);
  const previous = centerline[Math.max(0, index - 1)] ?? nearestPoint;
  const next = centerline[Math.min(centerline.length - 1, index + 1)] ?? nearestPoint;
  const tangentX = next.svgX - previous.svgX;
  const tangentY = next.svgY - previous.svgY;
  const toPointX = svgPoint.x - nearestPoint.svgX;
  const toPointY = svgPoint.y - nearestPoint.svgY;
  const cross = tangentX * toPointY - tangentY * toPointX;

  return cross >= 0 ? 1 : -1;
}

function findReplayPitAnchorCluster(anchors) {
  return anchors
    .map((anchor) => {
      const clustered = anchors.filter((item) => circularReplayDistance(item.progress, anchor.progress) <= 0.08);
      const averageDistance = clustered.reduce((sum, item) => sum + circularReplayDistance(item.progress, anchor.progress), 0)
        / Math.max(1, clustered.length);

      return { anchors: clustered, score: clustered.length * 100 - averageDistance * 1000 };
    })
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

function buildReplayPitLaneFromCenterlineOffset(trackDefinition, { centerProgress, metadata, offset, sideSign }) {
  const count = 86;
  const halfSpan = 0.045;
  const source = [];

  for (let index = 0; index < count; index += 1) {
    const ratio = count <= 1 ? 0 : index / (count - 1);
    const progress = centerProgress - halfSpan + halfSpan * 2 * ratio;
    source.push(interpolateReplayCenterlineByProgress(trackDefinition.centerline, progress));
  }

  const svgPoints = source.map((point, index) => {
    const previous = source[Math.max(0, index - 1)];
    const next = source[Math.min(source.length - 1, index + 1)];
    const tangentX = next.svgX - previous.svgX;
    const tangentY = next.svgY - previous.svgY;
    const length = Math.hypot(tangentX, tangentY) || 1;
    const normal = { x: (-tangentY / length) * sideSign, y: (tangentX / length) * sideSign };
    const fade = Math.min(
      smoothReplayPitOffset(Math.min(1, index / 12)),
      smoothReplayPitOffset(Math.min(1, (source.length - 1 - index) / 12)),
    );
    const pointOffset = offset * fade;

    return {
      svgX: point.svgX + normal.x * pointOffset,
      svgY: point.svgY + normal.y * pointOffset,
      worldX: point.worldX,
      worldY: point.worldY,
      worldZ: point.worldZ,
    };
  });

  return buildReplayPitLaneFromSvgPoints(svgPoints, metadata);
}

function interpolateReplayCenterlineByProgress(centerline, progress) {
  const normalizedProgress = ((progress % 1) + 1) % 1;
  let nextIndex = centerline.findIndex((point) => point.progress >= normalizedProgress);

  if (nextIndex < 0) {
    nextIndex = 0;
  }

  const previousIndex = nextIndex === 0 ? centerline.length - 1 : nextIndex - 1;
  const previous = centerline[previousIndex];
  const next = centerline[nextIndex];
  const previousProgress = previousIndex > nextIndex ? previous.progress - 1 : previous.progress;
  const nextProgress = nextIndex < previousIndex ? next.progress + 1 : next.progress;
  const targetProgress = normalizedProgress < previousProgress ? normalizedProgress + 1 : normalizedProgress;
  const span = Math.max(0.0001, nextProgress - previousProgress);
  const ratio = Math.min(1, Math.max(0, (targetProgress - previousProgress) / span));

  return {
    svgX: previous.svgX + (next.svgX - previous.svgX) * ratio,
    svgY: previous.svgY + (next.svgY - previous.svgY) * ratio,
    worldX: previous.worldX + (next.worldX - previous.worldX) * ratio,
    worldY: previous.worldY + (next.worldY - previous.worldY) * ratio,
    worldZ: previous.worldZ + (next.worldZ - previous.worldZ) * ratio,
  };
}

function circularReplayDistance(left, right) {
  const diff = Math.abs(left - right);
  return Math.min(diff, 1 - diff);
}

function getCircularMean(values) {
  if (!values.length) {
    return 0;
  }

  const x = values.reduce((sum, value) => sum + Math.cos(value * Math.PI * 2), 0);
  const y = values.reduce((sum, value) => sum + Math.sin(value * Math.PI * 2), 0);
  const angle = Math.atan2(y, x) / (Math.PI * 2);

  return ((angle % 1) + 1) % 1;
}

function getMedianNumber(values) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function smoothReplayPitOffset(value) {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function buildReplayPitLaneFromWorldPoints(source, trackDefinition, metadata = {}) {
  if (!source?.length) {
    return null;
  }

  const svgPoints = simplifyTrackPoints(source, 120).map((point) => {
    const svg = replayWorldToSvg(point, trackDefinition.worldBounds, trackDefinition.transform);

    return {
      svgX: svg.x,
      svgY: svg.y,
      worldX: point.x,
      worldY: point.y,
      worldZ: point.z,
    };
  });

  if (svgPoints.length < 2) {
    return null;
  }

  return buildReplayPitLaneFromSvgPoints(svgPoints, metadata);
}

function buildReplayPitLaneFromSvgPoints(svgPoints, metadata = {}) {
  if (!svgPoints?.length || svgPoints.length < 2) {
    return null;
  }

  const visualPathD = svgPoints
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.svgX.toFixed(1)} ${point.svgY.toFixed(1)}`)
    .join(" ");
  const labelPoint = svgPoints[Math.floor(svgPoints.length * 0.42)] ?? svgPoints[0];

  return {
    labelX: labelPoint.svgX,
    labelY: labelPoint.svgY,
    metadata,
    points: svgPoints,
    source: metadata.source ?? null,
    visualPathD,
  };
}

function extractReplayPitLaneSegments(points, trackDefinition) {
  const segments = [];
  let current = [];

  const flushCurrent = () => {
    const filtered = filterReplayPathDuplicates(current, 18);

    if (filtered.length >= 8) {
      segments.push(filtered);
    }

    current = [];
  };

  for (const point of points ?? []) {
    const svg = replayWorldToSvg(point, trackDefinition.worldBounds, trackDefinition.transform);
    const nearest = findNearestReplayCenterlinePoint(svg, trackDefinition.centerline);
    const distance = Math.hypot(svg.x - nearest.svgX, svg.y - nearest.svgY);
    const isOffTrackLane = distance >= 10 && distance <= 115;

    if (isOffTrackLane) {
      current.push(point);
      continue;
    }

    flushCurrent();
  }

  flushCurrent();

  return segments;
}

function buildReplayPitLaneFromOffTrackTelemetry(locationByDriver, trackDefinition) {
  const candidates = [];

  for (const locations of locationByDriver.values()) {
    const points = normalizeOpenF1LocationPoints(locations);
    candidates.push(...extractReplayPitLaneSegments(points, trackDefinition));
  }

  const source = candidates
    .filter((candidate) => candidate.length >= 8)
    .sort((a, b) => scoreReplayPitLaneCandidate(b, trackDefinition) - scoreReplayPitLaneCandidate(a, trackDefinition))[0] ?? null;

  return source ? buildReplayPitLaneFromWorldPoints(source, trackDefinition, { source: "off_track_telemetry" }) : null;
}

function isValidReplayPitLane(candidate, trackDefinition) {
  const points = candidate?.points ?? [];

  if (points.length < 40) {
    return false;
  }

  const pathLength = getReplaySvgPathLength(points);
  const maxStep = Math.max(
    ...points.slice(1).map((point, index) => Math.hypot(point.svgX - points[index].svgX, point.svgY - points[index].svgY)),
    0,
  );
  const distances = points.map((point) => {
    const nearest = findNearestReplayCenterlinePoint({ x: point.svgX, y: point.svgY }, trackDefinition.centerline);
    return Math.hypot(point.svgX - nearest.svgX, point.svgY - nearest.svgY);
  });
  const averageDistance = distances.reduce((sum, value) => sum + value, 0) / Math.max(1, distances.length);
  const startDistance = distances[0] ?? Infinity;
  const endDistance = distances.at(-1) ?? Infinity;

  return (
    pathLength >= 120 &&
    maxStep <= 140 &&
    averageDistance >= 8 &&
    averageDistance <= 105 &&
    startDistance <= 70 &&
    endDistance <= 70
  );
}

function scoreReplayPitLaneSvgCandidate(candidate, trackDefinition) {
  const points = candidate?.points ?? [];

  if (!points.length) {
    return 0;
  }

  const pathLength = getReplaySvgPathLength(points);
  const distances = points.map((point) => {
    const nearest = findNearestReplayCenterlinePoint({ x: point.svgX, y: point.svgY }, trackDefinition.centerline);
    return Math.hypot(point.svgX - nearest.svgX, point.svgY - nearest.svgY);
  });
  const averageDistance = distances.reduce((sum, value) => sum + value, 0) / Math.max(1, distances.length);

  return points.length * 5 + Math.min(pathLength, 360) - Math.abs(averageDistance - 34) * 4;
}

function getReplaySvgPathLength(points) {
  return (points ?? []).slice(1).reduce((sum, point, index) => {
    const previous = points[index];
    return sum + Math.hypot(point.svgX - previous.svgX, point.svgY - previous.svgY);
  }, 0);
}

function scoreReplayPitLaneCandidate(points, trackDefinition) {
  if (!points?.length) {
    return 0;
  }

  const svgPoints = points.map((point) => replayWorldToSvg(point, trackDefinition.worldBounds, trackDefinition.transform));
  const distances = svgPoints.map((point) => {
    const nearest = findNearestReplayCenterlinePoint(point, trackDefinition.centerline);
    return Math.hypot(point.x - nearest.svgX, point.y - nearest.svgY);
  });
  const avgDistance = distances.reduce((sum, value) => sum + value, 0) / Math.max(1, distances.length);
  const pathLength = svgPoints.slice(1).reduce((sum, point, index) => {
    const previous = svgPoints[index];
    return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
  }, 0);

  return points.length * 8 + Math.min(pathLength, 280) - Math.abs(avgDistance - 34) * 3;
}

function findNearestReplayCenterlinePoint(svgPoint, centerline) {
  let nearest = centerline[0];
  let nearestDistance = Infinity;

  for (const point of centerline) {
    const distance = Math.hypot(svgPoint.x - point.svgX, svgPoint.y - point.svgY);

    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function findNearestReplayPitLanePoint(svgPoint, pitLanePoints) {
  let nearest = null;
  let nearestDistance = Infinity;

  for (const point of pitLanePoints ?? []) {
    const distance = Math.hypot(svgPoint.x - point.svgX, svgPoint.y - point.svgY);

    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function filterReplayPathDuplicates(points, minDistance) {
  const result = [];

  for (const point of points) {
    const previous = result.at(-1);

    if (!previous || distanceBetween(previous, point) >= minDistance) {
      result.push(point);
    }
  }

  return result;
}

function getReplayBestLap(laps) {
  return (laps ?? [])
    .filter((lap) => Number.isFinite(Number(lap.lap_duration)))
    .sort((a, b) => Number(a.lap_duration) - Number(b.lap_duration))[0] ?? null;
}

function getReplayTotalLaps(lapsPayload) {
  const laps = (lapsPayload ?? [])
    .map((lap) => Number(lap.lap_number))
    .filter(Number.isFinite);

  return laps.length ? Math.max(...laps) : null;
}

function getReplayMaxProgressDelta(deltaMs) {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return 0.12;
  }

  return Math.min(0.2, Math.max(0.025, deltaMs / 80_000));
}

function snapReplayPointToTrack(svgPoint, centerline, { maxProgressDelta = 0.28, previousProgress = null } = {}) {
  let nearest = projectReplayPointToSegment(svgPoint, centerline.at(-1), centerline[0], true);
  let nearestScore = Infinity;

  for (let index = 0; index < centerline.length; index += 1) {
    const previous = centerline[index];
    const next = centerline[(index + 1) % centerline.length];
    const projected = projectReplayPointToSegment(svgPoint, previous, next, index === centerline.length - 1);
    const distance = projected.distance;
    const progressDelta =
      previousProgress === null ? 0 : getForwardReplayProgressDelta(previousProgress, projected.progress);
    const continuityPenalty =
      previousProgress === null || progressDelta <= maxProgressDelta
        ? 0
        : (progressDelta - maxProgressDelta) * 6500;
    const score = distance + continuityPenalty;

    if (score < nearestScore) {
      nearest = projected;
      nearestScore = score;
    }
  }

  return {
    headingRad: nearest.headingRad,
    normalizedZ: normalizeReplayElevation(nearest.worldZ, {
      maxZ: Math.max(...centerline.map((point) => point.worldZ)),
      minZ: Math.min(...centerline.map((point) => point.worldZ)),
    }),
    progress: nearest.progress,
    svgX: nearest.svgX,
    svgY: nearest.svgY,
    z: nearest.worldZ,
  };
}

function projectReplayPointToSegment(svgPoint, previous, next, wraps = false) {
  const segmentX = next.svgX - previous.svgX;
  const segmentY = next.svgY - previous.svgY;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY || 1;
  const ratio = Math.min(
    1,
    Math.max(0, ((svgPoint.x - previous.svgX) * segmentX + (svgPoint.y - previous.svgY) * segmentY) / segmentLengthSquared),
  );
  const svgX = previous.svgX + segmentX * ratio;
  const svgY = previous.svgY + segmentY * ratio;
  const progressSpan = wraps ? 1 - previous.progress + next.progress : next.progress - previous.progress;
  const rawProgress = previous.progress + progressSpan * ratio;

  return {
    distance: Math.hypot(svgPoint.x - svgX, svgPoint.y - svgY),
    headingRad: Math.atan2(segmentY, segmentX),
    progress: ((rawProgress % 1) + 1) % 1,
    svgX,
    svgY,
    worldZ: previous.worldZ + (next.worldZ - previous.worldZ) * ratio,
  };
}

function getForwardReplayProgressDelta(previous, next) {
  let delta = next - previous;

  if (delta < 0) {
    delta += 1;
  }

  return delta;
}

function formatReplayGap(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  const number = Number(value);
  return Number.isFinite(number) ? `+${number.toFixed(3)}` : null;
}

function buildReplayRaceEvents(raceControlPayload, raceStartMs) {
  return (raceControlPayload ?? [])
    .map((event) => {
      const dateMs = event.date ? new Date(event.date).getTime() : raceStartMs;
      const message = String(event.message ?? event.flag ?? event.category ?? "").trim();

      if (!message || dateMs < raceStartMs) {
        return null;
      }

      return {
        driverNumber: numberOrNull(event.driver_number),
        lapNumber: numberOrNull(event.lap_number),
        message,
        offsetMs: Math.max(0, dateMs - raceStartMs),
        severity: getReplayEventSeverity(event),
        timestamp: new Date(dateMs).toISOString(),
        type: String(event.category ?? event.flag ?? "race_control").toLowerCase(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.offsetMs - b.offsetMs)
    .slice(0, 120);
}

function getReplayEventSeverity(event) {
  const text = [event.category, event.flag, event.message].filter(Boolean).join(" ").toLowerCase();

  if (text.includes("red") || text.includes("safety car")) {
    return "CRITICAL";
  }

  if (text.includes("yellow") || text.includes("penalty") || text.includes("investigation")) {
    return "IMPORTANT";
  }

  return "INFO";
}

function buildReplayWeather(weatherPayload) {
  const latest = [...(weatherPayload ?? [])].sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime())[0];

  if (!latest) {
    return null;
  }

  return {
    airTemperatureC: numberOrNull(latest.air_temperature),
    rainfall: numberOrNull(latest.rainfall),
    trackTemperatureC: numberOrNull(latest.track_temperature),
    windSpeedKmh: numberOrNull(latest.wind_speed),
  };
}

async function upsertReplaySessionWithRetry(row, attempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { data, error } = await supabase
      .from("race_replay_sessions")
      .upsert(row, { onConflict: "source_session_key" })
      .select("id")
      .single();

    if (!error) {
      return data;
    }

    lastError = error;

    // 57014 = statement timeout: у больших снапшотов запись на грани лимита, повтор часто проходит.
    if (error.code !== "57014" || attempt === attempts) {
      break;
    }

    logWorkerWarning("race_replay.snapshot_upsert_retry", {
      attempt,
      sourceSessionKey: row.source_session_key,
    });
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }

  throw lastError;
}

async function upsertFailedReplaySession(currentRace, circuit, sourceSession, sourceSeason, sourceErrors, reason) {
  const existingReady = await getExistingReadyReplayForRace(currentRace.id, sourceSeason);

  if (existingReady) {
    return;
  }

  await supabase.from("race_replay_sessions").upsert(
    {
      circuit_id: circuit.id,
      race_id: currentRace.id,
      snapshot: {},
      source_errors: [...sourceErrors, { label: "prepare", message: reason }],
      source_meeting_key: numberOrNull(sourceSession.meeting_key),
      source_race_name: sourceSession.meeting_name ?? currentRace.race_name,
      source_season: sourceSeason,
      source_session_key: Number(sourceSession.session_key),
      source_session_name: sourceSession.session_name ?? sourceSession.session_type ?? "Race",
      status: "failed",
      title: `${currentRace.race_name}: повтор гонки ${sourceSeason}`,
    },
    { onConflict: "source_session_key" },
  );
}

async function insertReplayEvents(replaySessionId, replayPayload) {
  const rows = [
    ...replayPayload.positions.map((event) => ({
      driver_number: event.driverNumber,
      event_time: event.timestamp,
      event_type: "position",
      offset_ms: Math.round(event.offsetMs),
      payload: event,
      replay_session_id: replaySessionId,
    })),
    ...replayPayload.raceEvents.map((event) => ({
      driver_number: event.driverNumber ?? null,
      event_time: event.timestamp,
      event_type: event.type,
      offset_ms: Math.round(event.offsetMs),
      payload: event,
      replay_session_id: replaySessionId,
    })),
    ...buildReplayLapTimingEventRows(replaySessionId, replayPayload),
    ...buildReplayPositionTimingEventRows(replaySessionId, replayPayload),
    ...buildReplayIntervalTimingEventRows(replaySessionId, replayPayload),
  ];

  for (let index = 0; index < rows.length; index += 200) {
    const chunk = rows.slice(index, index + 200);
    const { error } = await supabase.from("race_replay_events").insert(chunk);

    if (error) {
      throw error;
    }
  }
}

function buildReplayPositionTimingEventRows(replaySessionId, replayPayload) {
  const raceStartMs = getReplayPayloadStartMs(replayPayload);

  return (replayPayload.positionTimings ?? []).map((timing) => ({
    driver_number: timing.driverNumber,
    event_time: new Date(raceStartMs + timing.offsetMs).toISOString(),
    event_type: "position_timing",
    offset_ms: timing.offsetMs,
    payload: timing,
    replay_session_id: replaySessionId,
  }));
}

function buildReplayIntervalTimingEventRows(replaySessionId, replayPayload) {
  const raceStartMs = getReplayPayloadStartMs(replayPayload);

  return (replayPayload.intervalTimings ?? []).map((timing) => ({
    driver_number: timing.driverNumber,
    event_time: new Date(raceStartMs + timing.offsetMs).toISOString(),
    event_type: "interval_timing",
    offset_ms: timing.offsetMs,
    payload: timing,
    replay_session_id: replaySessionId,
  }));
}

function getReplayPayloadStartMs(replayPayload) {
  const firstPosition = replayPayload.positions[0];

  return firstPosition
    ? new Date(firstPosition.timestamp).getTime() - firstPosition.offsetMs
    : Date.now();
}

function buildReplayLapTimingEventRows(replaySessionId, replayPayload) {
  const raceStartMs = getReplayPayloadStartMs(replayPayload);

  return (replayPayload.lapTimings ?? []).map((timing) => ({
    driver_number: timing[0],
    event_time: new Date(raceStartMs + timing[2]).toISOString(),
    event_type: "lap_timing",
    offset_ms: timing[2],
    payload: timing,
    replay_session_id: replaySessionId,
  }));
}

async function replaceReplayEvents(replaySessionId, replayPayload) {
  try {
    await deleteReplayEvents(replaySessionId);
    await insertReplayEvents(replaySessionId, replayPayload);
    return { status: "indexed" };
  } catch (error) {
    const message = getSafeErrorMessage(error);
    logWorkerWarning("race_replay.events_index_failed", {
      message,
      replaySessionId,
    });
    return { message, status: "skipped" };
  }
}

async function deleteReplayEvents(replaySessionId) {
  while (true) {
    const { data, error: selectError } = await supabase
      .from("race_replay_events")
      .select("id")
      .eq("replay_session_id", replaySessionId)
      .limit(500);

    if (selectError) {
      throw selectError;
    }

    const ids = (data ?? []).map((row) => row.id);

    if (!ids.length) {
      return;
    }

    const { error: deleteError } = await supabase
      .from("race_replay_events")
      .delete()
      .in("id", ids);

    if (deleteError) {
      throw deleteError;
    }
  }
}

async function fetchJson(
  url,
  attempt = 1,
  timeoutMs = Number(process.env.OPENF1_FETCH_TIMEOUT_MS ?? 12000),
) {
  await throttleOpenF1Fetch(url);
  const headers = await getFetchHeaders(url);

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await readJsonResponse(response);

  if (response.status === 429 && attempt < 4) {
    await sleep(2500 * attempt);
    return fetchJson(url, attempt + 1, timeoutMs);
  }

  if (response.status === 401 && headers.authorization && canRefreshOpenF1AccessToken() && attempt < 2) {
    clearOpenF1AccessTokenCache();
    return fetchJson(url, attempt + 1, timeoutMs);
  }

  if (!response.ok) {
    const detail = getSafeErrorMessage(payload?.detail ?? payload?.message ?? payload?.error ?? "");

    if (isOpenF1Url(url) && response.status === 401) {
      if (headers.authorization) {
        throw new Error(
          detail
            ? `OpenF1 authentication failed (${response.status}): ${detail}`
            : `OpenF1 authentication failed (${response.status})`,
        );
      }

      throw new Error(
        detail
          ? `OpenF1 free tier temporarily restricted (${response.status}): ${detail}`
          : `OpenF1 free tier temporarily restricted (${response.status})`,
      );
    }

    throw new Error(detail ? `Fetch failed ${response.status}: ${url} — ${detail}` : `Fetch failed ${response.status}: ${url}`);
  }

  return Array.isArray(payload) ? payload : [];
}

async function throttleOpenF1Fetch(url) {
  if (!isOpenF1Url(url)) {
    return;
  }

  const minIntervalMs = Math.max(0, Number(process.env.OPENF1_MIN_INTERVAL_MS ?? 2100));
  const run = openF1FetchQueue.then(async () => {
    const waitMs = Math.max(0, openF1LastFetchAt + minIntervalMs - Date.now());

    if (waitMs > 0) {
      await sleep(waitMs);
    }

    openF1LastFetchAt = Date.now();
  });
  openF1FetchQueue = run.catch(() => {});

  await run;
}

async function getFetchHeaders(url) {
  const headers = {
    accept: "application/json",
    "user-agent": "RaceSide/0.1 (+https://raceside.online)",
  };

  if (!isOpenF1Url(url)) {
    return headers;
  }

  const accessToken = await getOpenF1AccessToken();

  if (accessToken) {
    headers.authorization = `Bearer ${accessToken}`;
  }

  return headers;
}

function hasOpenF1LiveCredentials() {
  return Boolean(
    normalizeString(process.env.OPENF1_ACCESS_TOKEN)
    || (normalizeString(process.env.OPENF1_USERNAME) && normalizeString(process.env.OPENF1_PASSWORD)),
  );
}

function canRefreshOpenF1AccessToken() {
  return Boolean(normalizeString(process.env.OPENF1_USERNAME) && normalizeString(process.env.OPENF1_PASSWORD));
}

async function getOpenF1AccessToken() {
  const staticToken = normalizeString(process.env.OPENF1_ACCESS_TOKEN);

  if (staticToken) {
    return staticToken;
  }

  if (!canRefreshOpenF1AccessToken()) {
    return null;
  }

  if (openF1AccessTokenCache && openF1AccessTokenExpiresAt > Date.now() + 60_000) {
    return openF1AccessTokenCache;
  }

  if (!openF1AccessTokenPromise) {
    openF1AccessTokenPromise = requestOpenF1AccessToken().finally(() => {
      openF1AccessTokenPromise = null;
    });
  }

  return openF1AccessTokenPromise;
}

async function requestOpenF1AccessToken() {
  const baseUrl = process.env.OPENF1_BASE_URL ?? "https://api.openf1.org/v1";
  const tokenUrl = new URL("/token", baseUrl).toString();
  const body = new URLSearchParams({
    username: process.env.OPENF1_USERNAME,
    password: process.env.OPENF1_PASSWORD,
  });
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "RaceSide/0.1 (+https://raceside.online)",
    },
    body,
    signal: AbortSignal.timeout(Number(process.env.OPENF1_FETCH_TIMEOUT_MS ?? 12000)),
  });
  const payload = await readJsonResponse(response);

  if (!response.ok || !normalizeString(payload?.access_token)) {
    throw new Error(
      `OpenF1 token request failed (${response.status}): ${getSafeErrorMessage(payload?.detail ?? payload?.error ?? "empty access token")}`,
    );
  }

  openF1AccessTokenCache = payload.access_token;
  openF1AccessTokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in) || 3_600) * 1_000;
  return openF1AccessTokenCache;
}

function clearOpenF1AccessTokenCache() {
  openF1AccessTokenCache = null;
  openF1AccessTokenExpiresAt = 0;
}

function isOpenF1Url(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "api.openf1.org" || parsed.hostname.endsWith(".openf1.org");
  } catch {
    return false;
  }
}

function isOpenF1AuthRestriction(error) {
  const message = getSafeErrorMessage(error).toLowerCase();
  return message.includes("openf1 free tier temporarily restricted")
    || message.includes("live f1 session in progress")
    || message.includes("authenticated users");
}

function isOpenF1StartingGridPending(error) {
  const message = getSafeErrorMessage(error).toLowerCase();
  return message.includes("fetch failed 404") || message.includes("fetch failed 422");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getLocalSessionsForOpenF1(season) {
  const { data, error } = await supabase
    .from("sessions")
    .select("id, race_id, session_type, name, start_at, end_at, races(season_year, round, race_name, circuits(id, external_id, name, country, locality))")
    .order("start_at", { ascending: true, nullsFirst: false });

  if (error) {
    throw error;
  }

  return (data ?? []).filter((session) => {
    const race = Array.isArray(session.races) ? session.races[0] : session.races;
    return race?.season_year === season;
  });
}

async function getCircuitsForLayouts() {
  const { data, error } = await supabase
    .from("circuits")
    .select("id, external_id, name, country, locality")
    .order("name");

  if (error) {
    throw error;
  }

  return data ?? [];
}

export function findOpenF1SessionMatch(localSession, openF1Sessions) {
  const race = Array.isArray(localSession.races) ? localSession.races[0] : localSession.races;
  const circuit = Array.isArray(race?.circuits) ? race?.circuits[0] : race?.circuits;
  const localType = normalizeSessionType(localSession.session_type);
  const localStart = localSession.start_at ? new Date(localSession.start_at).getTime() : null;

  return (openF1Sessions ?? [])
    .map((session) => ({
      session,
      sessionType: normalizeSessionType(session.session_name ?? session.session_type),
      score:
        scoreCircuitMatch(circuit, session) +
        (normalizeSessionType(session.session_name ?? session.session_type) === localType ? 40 : 0) +
        scoreDateMatch(localStart, session.date_start),
    }))
    .filter((item) => item.sessionType === localType)
    .filter((item) => item.score >= 55)
    .sort((a, b) => b.score - a.score)[0]?.session ?? null;
}

async function getExistingCircuitLayout(circuitId) {
  const { data } = await supabase
    .from("circuit_layouts")
    .select("id, raw_payload")
    .eq("circuit_id", circuitId)
    .eq("provider", "openf1")
    .maybeSingle();

  return data ?? null;
}

async function findLayoutSourceSessions(baseUrl, circuit, season, currentYearSessions) {
  const years = [season, season - 1, season - 2, season - 3];
  const candidates = [];

  for (const year of years) {
    const sessions = await getOpenF1SessionsForYear(baseUrl, year, season, currentYearSessions);
    candidates.push(
      ...(sessions ?? [])
      .map((session) => ({ session, score: scoreCircuitMatch(circuit, session) }))
      .filter((item) => item.score >= 30)
      .sort((a, b) => {
        const typeScore = scoreLayoutSessionType(b.session) - scoreLayoutSessionType(a.session);
        return typeScore || b.score - a.score;
      })
      .map((item) => item.session),
    );
  }

  return candidates.filter((session) => session?.session_key);
}

async function getOpenF1SessionsForYear(baseUrl, year, currentSeason, currentYearSessions) {
  if (year === currentSeason && currentYearSessions?.length) {
    return currentYearSessions;
  }

  if (openF1SessionsByYear.has(year)) {
    return openF1SessionsByYear.get(year);
  }

  const sessions = await fetchJson(`${baseUrl}/sessions?year=${year}`);
  openF1SessionsByYear.set(year, sessions);

  return sessions;
}

async function buildCircuitLayoutFromOpenF1(baseUrl, sessionKey) {
  let lapsPayload = [];

  try {
    lapsPayload = await fetchJson(`${baseUrl}/laps?session_key=${sessionKey}`);
  } catch {
    return null;
  }

  const laps = getBestLapsByDriver(lapsPayload);
  const sourceLap = laps[0];

  if (!sourceLap?.driver_number) {
    return null;
  }

  let locations = [];

  try {
    locations = await fetchJson(
      `${baseUrl}/location?session_key=${sessionKey}&driver_number=${sourceLap.driver_number}`,
    );
  } catch {
    return null;
  }
  const lapStart = sourceLap.date_start ? new Date(sourceLap.date_start).getTime() : null;
  const lapDurationMs = Number.isFinite(Number(sourceLap.lap_duration))
    ? Number(sourceLap.lap_duration) * 1000
    : null;
  const lapEnd = lapStart && lapDurationMs ? lapStart + lapDurationMs : null;
  const allPoints = locations
    .sort((a, b) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime())
    .map((item) => ({
      x: Number(item.x),
      y: Number(item.z ?? item.y),
      date: item.date ? new Date(item.date).getTime() : null,
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const lapPoints =
    lapStart && lapEnd
      ? allPoints.filter(
          (point) =>
            point.date !== null &&
            point.date >= lapStart &&
            point.date <= lapEnd,
        )
      : [];
  const points = filterTrackPointOutliers(lapPoints.length >= 80 ? lapPoints : allPoints);

  if (points.length < 80) {
    return null;
  }

  const simplified = simplifyTrackPoints(points, 220);
  const normalized = normalizeTrackPoints(simplified, 480, 320, 28);
  const svgPath = normalized
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");

  return {
    svgPath: `${svgPath} Z`,
    viewBox: "0 0 480 320",
    metadata: {
      session_key: Number(sessionKey),
      driver_number: Number(sourceLap.driver_number),
      lap_number: numberOrNull(sourceLap.lap_number),
      lap_duration: numberOrNull(sourceLap.lap_duration),
      lap_start: sourceLap.date_start ?? null,
      lap_end: lapEnd ? new Date(lapEnd).toISOString() : null,
      points: points.length,
      source_points: allPoints.length,
    },
  };
}

async function getDriverMapByNumber(season) {
  const [{ data: seasonProfiles, error: seasonProfilesError }, { data: drivers, error: driversError }] = await Promise.all([
    supabase
      .from("driver_season_profiles")
      .select("driver_id, permanent_number, primary_team_id")
      .eq("season_year", season),
    supabase
      .from("drivers")
      .select("id, permanent_number, current_team_id"),
  ]);

  if (seasonProfilesError) {
    throw seasonProfilesError;
  }

  if (driversError) {
    throw driversError;
  }

  const driverByNumber = new Map();

  for (const profile of seasonProfiles ?? []) {
    if (profile.permanent_number === null || !profile.driver_id) {
      continue;
    }

    driverByNumber.set(Number(profile.permanent_number), {
      id: profile.driver_id,
      current_team_id: profile.primary_team_id ?? null,
    });
  }

  for (const driver of drivers ?? []) {
    if (driver.permanent_number === null || driverByNumber.has(Number(driver.permanent_number))) {
      continue;
    }

    driverByNumber.set(Number(driver.permanent_number), driver);
  }

  return driverByNumber;
}

async function extendDriverMapWithOpenF1SessionParticipants({ baseUrl, drivers, sessionKey }) {
  const participantsPayload = await fetchJson(`${baseUrl}/drivers?session_key=${sessionKey}`);
  const participants = (participantsPayload ?? [])
    .map(getOpenF1ParticipantIdentity)
    .filter(Boolean);

  if (!participants.length) {
    return drivers;
  }

  const missingParticipants = participants.filter(
    (participant) => !drivers.has(participant.driverNumber),
  );

  if (!missingParticipants.length) {
    return drivers;
  }

  const [
    { data: teams, error: teamsError },
    { data: driversByExternalId, error: externalIdError },
    { data: driversByFullName, error: fullNameError },
  ] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name, short_name, code, external_id")
      .eq("is_active", true),
    supabase
      .from("drivers")
      .select("id, code, full_name, external_id, current_team_id")
      .in("external_id", missingParticipants.map((participant) => participant.externalId)),
    supabase
      .from("drivers")
      .select("id, code, full_name, external_id, current_team_id")
      .in("full_name", missingParticipants.map((participant) => participant.fullName)),
  ]);

  if (teamsError) {
    throw teamsError;
  }
  if (externalIdError) {
    throw externalIdError;
  }
  if (fullNameError) {
    throw fullNameError;
  }

  const knownByIdentity = new Map(
    [...(driversByExternalId ?? []), ...(driversByFullName ?? [])].flatMap((driver) => [
      [normalizeFantasyTeamKey(driver.external_id), driver],
      [normalizeFantasyTeamKey(driver.full_name), driver],
    ]),
  );
  const extended = new Map(drivers);

  for (const participant of missingParticipants) {
    const teamId = resolveExactTeamId(participant.teamName, teams ?? []);
    let driver =
      knownByIdentity.get(normalizeFantasyTeamKey(participant.externalId)) ??
      knownByIdentity.get(normalizeFantasyTeamKey(participant.fullName)) ??
      null;

    if (!driver) {
      const { data, error } = await supabase
        .from("drivers")
        .upsert({
          external_id: participant.externalId,
          code: participant.code,
          permanent_number: participant.driverNumber,
          first_name: participant.firstName,
          last_name: participant.lastName,
          full_name: participant.fullName,
          current_team_id: teamId,
          slug: participant.slug,
          ai_avatar_url: participant.headshotUrl,
          is_active: false,
        }, { onConflict: "external_id" })
        .select("id, code, full_name, external_id, current_team_id")
        .single();

      if (error) {
        throw error;
      }

      driver = data;
      if (driver) {
        knownByIdentity.set(normalizeFantasyTeamKey(participant.externalId), driver);
        knownByIdentity.set(normalizeFantasyTeamKey(participant.fullName), driver);
      }
    }

    if (driver?.id) {
      extended.set(participant.driverNumber, {
        id: driver.id,
        current_team_id: teamId ?? driver.current_team_id ?? null,
      });
    }
  }

  return extended;
}

function resolveExactTeamId(teamName, teams) {
  const normalized = normalizeFantasyTeamKey(teamName);

  if (!normalized) {
    return null;
  }

  const exact = teams.find((team) =>
    [team.name, team.short_name, team.code, team.external_id]
      .filter(Boolean)
      .some((candidate) => normalizeFantasyTeamKey(candidate) === normalized),
  );

  return exact?.id ?? resolveTeamId(teamName, teams);
}

function getBestLapsByDriver(laps) {
  const byDriver = new Map();

  for (const lap of laps ?? []) {
    const driverNumber = Number(lap.driver_number);
    const lapDuration = Number(lap.lap_duration);

    if (!Number.isFinite(driverNumber) || !Number.isFinite(lapDuration) || lapDuration <= 0) {
      continue;
    }

    const previous = byDriver.get(driverNumber);

    if (!previous || Number(previous.lap_duration) > lapDuration) {
      byDriver.set(driverNumber, lap);
    }
  }

  return [...byDriver.values()].sort((a, b) => Number(a.lap_duration) - Number(b.lap_duration));
}

function scoreCircuitMatch(circuit, session) {
  const haystack = [
    session.circuit_short_name,
    session.location,
    session.country_name,
    session.country_code,
    session.meeting_name,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/[_-]/g, " ")
    .toLowerCase();
  const needles = [
    circuit?.external_id,
    circuit?.name,
    circuit?.locality,
    String(circuit?.name ?? "").replace(/^circuit\s+(de|of)\s+/i, ""),
    ...String(circuit?.name ?? "")
      .split(/[\s-]+/)
      .filter((part) => part.length > 4 && !isGenericCircuitMatchWord(part)),
  ]
    .filter(Boolean)
    .map((value) => String(value).replace(/[_-]/g, " ").toLowerCase());

  if (needles.some((needle) => needle.length > 3 && haystack.includes(needle))) {
    return 35;
  }

  return circuit?.country && haystack.includes(String(circuit.country).toLowerCase()) ? 10 : 0;
}

function isGenericCircuitMatchWord(value) {
  return new Set([
    "autodrome",
    "circuit",
    "grand",
    "internacional",
    "international",
    "prix",
    "ring",
    "street",
  ]).has(String(value ?? "").toLowerCase());
}

function scoreDateMatch(localStart, openF1Start) {
  if (!localStart || !openF1Start) {
    return 0;
  }

  const diffHours = Math.abs(localStart - new Date(openF1Start).getTime()) / 3_600_000;

  if (diffHours <= 2) {
    return 40;
  }

  if (diffHours <= 12) {
    return 25;
  }

  if (diffHours <= 36) {
    return 10;
  }

  return 0;
}

function scoreLayoutSessionType(session) {
  const type = normalizeSessionType(session.session_name ?? session.session_type);

  if (type === "qualifying" || type === "race") {
    return 3;
  }

  if (type === "fp1" || type === "fp2" || type === "fp3") {
    return 2;
  }

  return 1;
}

function normalizeSessionType(value) {
  const normalized = String(value ?? "").toLowerCase();

  if (normalized.includes("practice 1") || normalized === "fp1") return "fp1";
  if (normalized.includes("practice 2") || normalized === "fp2") return "fp2";
  if (normalized.includes("practice 3") || normalized === "fp3") return "fp3";
  if (normalized.includes("sprint") && normalized.includes("qual")) return "sprint_qualifying";
  if (normalized.includes("sprint")) return "sprint";
  if (normalized.includes("qual")) return "qualifying";
  if (normalized.includes("race")) return "race";

  return normalized;
}

function simplifyTrackPoints(points, maxPoints) {
  const step = Math.max(1, Math.ceil(points.length / maxPoints));
  return points.filter((_, index) => index % step === 0);
}

function filterTrackPointOutliers(points) {
  if (points.length < 3) {
    return points;
  }

  const distances = [];

  for (let index = 1; index < points.length; index += 1) {
    distances.push(distanceBetween(points[index - 1], points[index]));
  }

  const sorted = [...distances].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  const maxDistance = Math.max(median * 8, 250);

  return points.filter((point, index) => {
    if (index === 0) {
      return true;
    }

    return distanceBetween(points[index - 1], point) <= maxDistance;
  });
}

function distanceBetween(a, b) {
  return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
}

function normalizeTrackPoints(points, width, height, padding) {
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const sourceWidth = Math.max(1, maxX - minX);
  const sourceHeight = Math.max(1, maxY - minY);
  const scale = Math.min((width - padding * 2) / sourceWidth, (height - padding * 2) / sourceHeight);
  const offsetX = (width - sourceWidth * scale) / 2;
  const offsetY = (height - sourceHeight * scale) / 2;

  return points.map((point) => ({
    x: offsetX + (point.x - minX) * scale,
    y: height - (offsetY + (point.y - minY) * scale),
  }));
}

async function scorePredictions({ raceIds = [] } = {}) {
  const requestedRaceIds = new Set(raceIds.filter(Boolean));
  const candidateRaces = await getFantasyScoringCandidateRaces();
  const races = requestedRaceIds.size
    ? candidateRaces.filter((race) => requestedRaceIds.has(race.id))
    : candidateRaces;

  let itemsProcessed = 0;
  let racesReady = 0;

  for (const race of races) {
    const actual = await getRaceActuals(race.id);

    if (!isFantasyRaceReadyForScoring(actual)) {
      continue;
    }
    racesReady += 1;

    const { data: predictions } = await supabase
      .from("predictions")
      .select("id, top10_driver_ids, winner_driver_id, pole_driver_id, fastest_lap_driver_id, dnf_driver_id, dnf_pick_kind, top_scoring_team_id, fastest_pit_stop_team_id, score_breakdown")
      .eq("race_id", race.id);

    for (const prediction of predictions ?? []) {
      if (hasManualFantasyScoreOverride(prediction.score_breakdown)) {
        continue;
      }

      const breakdown = scoreFantasyPrediction(prediction, actual);

      await supabase
        .from("predictions")
        .update({
          score: breakdown.total,
          score_breakdown: breakdown,
          scored_at: new Date().toISOString(),
        })
        .eq("id", prediction.id);
      itemsProcessed += 1;
    }
  }

  return {
    itemsProcessed,
    metadata: {
      races: races.length,
      racesReady,
      racesSkipped: races.length - racesReady,
    },
  };
}

function hasManualFantasyScoreOverride(scoreBreakdown) {
  if (!scoreBreakdown || typeof scoreBreakdown !== "object" || Array.isArray(scoreBreakdown)) {
    return false;
  }

  return scoreBreakdown.manualOverride === true || scoreBreakdown.manual_override === true;
}

async function getFantasyScoringCandidateRaces() {
  const { data: recentRaces, error } = await supabase
    .from("races")
    .select("id, season_year, round, race_start_at, status")
    .lte("race_start_at", new Date().toISOString())
    .order("season_year", { ascending: false })
    .order("round", { ascending: false })
    .limit(12);

  if (error) {
    throw error;
  }

  const { data: predictionRaces, error: predictionError } = await supabase
    .from("predictions")
    .select("races(id, season_year, round, race_start_at, status)")
    .order("submitted_at", { ascending: false })
    .limit(200);

  if (predictionError) {
    throw predictionError;
  }

  const byId = new Map();

  for (const race of recentRaces ?? []) {
    if (race?.id) {
      byId.set(race.id, race);
    }
  }

  for (const row of predictionRaces ?? []) {
    const race = Array.isArray(row.races) ? row.races[0] : row.races;

    if (!race?.id) {
      continue;
    }

    byId.set(race.id, race);
  }

  return [...byId.values()].sort((left, right) =>
    Number(right.season_year ?? 0) - Number(left.season_year ?? 0) ||
    Number(right.round ?? 0) - Number(left.round ?? 0),
  );
}

async function getRaceActuals(raceId) {
  const { data: race } = await supabase
    .from("races")
    .select("season_year, round")
    .eq("id", raceId)
    .maybeSingle();

  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, session_type, end_at, status")
    .eq("race_id", raceId)
    .in("session_type", ["race", "sprint", "qualifying"]);

  const raceSession = sessions?.find((session) => session.session_type === "race");
  const raceSessionId = raceSession?.id;
  const qualifyingSessionId = sessions?.find((session) => session.session_type === "qualifying")?.id;
  const pointsSessionIds =
    sessions
      ?.filter((session) => session.session_type === "race" || session.session_type === "sprint")
      .map((session) => session.id) ?? [];

  const [raceResults, qualifyingResults, pointsResults, teamsResult, reportResult] = await Promise.all([
    raceSessionId
      ? supabase
          .from("session_results")
          .select("driver_id, team_id, position, status, laps, points, raw_payload")
          .eq("session_id", raceSessionId)
          .order("position", { ascending: true, nullsFirst: false })
      : { data: [] },
    qualifyingSessionId
      ? supabase
          .from("session_results")
          .select("driver_id, position")
          .eq("session_id", qualifyingSessionId)
          .order("position", { ascending: true, nullsFirst: false })
      : { data: [] },
    pointsSessionIds.length
      ? supabase
          .from("session_results")
          .select("team_id, points")
          .in("session_id", pointsSessionIds)
      : { data: [] },
    supabase.from("teams").select("id, name, code, external_id").eq("is_active", true),
    race
      ? supabase
          .from("grand_prix_reports")
          .select("pit_stops, results, highlights")
          .eq("season", race.season_year)
          .eq("round", race.round)
          .in("status", ["ready", "partial"])
          .order("generated_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null },
  ]);

  const raceClassification = (raceResults.data ?? []).filter(
    (result) => result.driver_id && result.position && result.position > 0 && !isLapOnlyPredictionResult(result),
  );
  const pole = qualifyingResults.data?.find((result) => result.position === 1);
  const fastestLap = raceClassification.find(
    (result) => String(result.raw_payload?.FastestLap?.rank ?? "") === "1",
  );
  const firstDnfDriverIds = getFirstDnfDriverIds(raceClassification);
  const topScoringTeamId = getTopScoringTeamId(pointsResults.data ?? []);
  const fastestPitStopTeamId = getFastestPitStopTeamId(
    reportResult.data,
    teamsResult.data ?? [],
  );

  const top10DriverIds = raceClassification
      .filter((result) => Number(result.position) >= 1 && Number(result.position) <= 10)
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map((result) => result.driver_id)
      .filter(Boolean);
  const hasRacePoints =
    raceClassification.length >= 10 &&
    raceClassification.every(
      (result) => result.points !== null && Number.isFinite(Number(result.points)),
    ) &&
    raceClassification.some((result) => Number(result.points) > 0);
  const readiness = {
    hasRacePoints,
    raceEndAt: raceSession?.end_at ?? null,
    raceStatus: raceSession?.status ?? null,
    top10DriverIds,
  };

  return {
    ...readiness,
    raceCompleted: isFantasyRaceReadyForScoring(readiness),
    winnerDriverId: raceClassification.find((result) => result.position === 1)?.driver_id ?? null,
    poleDriverId: pole?.driver_id ?? null,
    fastestLapDriverId: fastestLap?.driver_id ?? null,
    firstDnfDriverIds,
    topScoringTeamId,
    fastestPitStopTeamId,
  };
}

function getTopScoringTeamId(results) {
  const totals = new Map();

  for (const result of results ?? []) {
    if (!result.team_id) {
      continue;
    }

    const points = Number(result.points ?? 0);

    if (!Number.isFinite(points) || points <= 0) {
      continue;
    }

    totals.set(result.team_id, (totals.get(result.team_id) ?? 0) + points);
  }

  return [...totals.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function getFastestPitStopTeamId(report, teams) {
  if (!report || typeof report !== "object") {
    return null;
  }

  const officialTeam = report.highlights?.fastestPitStop?.team;

  if (officialTeam) {
    return resolveTeamId(officialTeam, teams);
  }

  const pitStops = Array.isArray(report.pit_stops) ? report.pit_stops : [];
  const fastestPit = pitStops
    .filter((pit) => Number.isFinite(Number(pit?.duration)))
    .sort((left, right) => Number(left.duration) - Number(right.duration))[0];

  if (!fastestPit) {
    return null;
  }

  const results = Array.isArray(report.results) ? report.results : [];
  const result = results.find((item) =>
    sameNormalizedName(item?.driver, fastestPit.driver),
  );

  return resolveTeamId(result?.team, teams);
}

function resolveTeamId(teamNameOrCode, teams) {
  if (!teamNameOrCode) {
    return null;
  }

  const normalized = normalizeFantasyTeamKey(teamNameOrCode);
  const match = teams.find((team) => {
    const candidates = [team.name, team.code, team.external_id].filter(Boolean);

    return candidates.some((candidate) => {
      const normalizedCandidate = normalizeFantasyTeamKey(candidate);

      return (
        normalized === normalizedCandidate ||
        normalized.includes(normalizedCandidate) ||
        normalizedCandidate.includes(normalized)
      );
    });
  });

  return match?.id ?? null;
}

function sameNormalizedName(left, right) {
  const normalizedLeft = normalizeFantasyTeamKey(left);
  const normalizedRight = normalizeFantasyTeamKey(right);

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

function normalizeFantasyTeamKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getFirstDnfDriverIds(results) {
  const retirements = results
    .filter((result) => result.driver_id && result.status && !isFinisherStatus(result.status))
    .map((result) => ({
      driverId: result.driver_id,
      lap: Number(result.laps ?? result.raw_payload?.laps),
    }))
    .filter((result) => Number.isFinite(result.lap) && result.lap > 0);

  if (!retirements.length) {
    return [];
  }

  const firstLap = Math.min(...retirements.map((result) => result.lap));

  return retirements.filter((result) => result.lap === firstLap).map((result) => result.driverId);
}

function isLapOnlyPredictionResult(result) {
  const status = normalizeString(result.status)?.toLowerCase();

  if (status === "лучший круг" || status === "лучшее время") {
    return true;
  }

  const payload = result.raw_payload;

  return Boolean(
    payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      "lap_duration" in payload &&
      "session_key" in payload &&
      "lap_number" in payload &&
      !("Driver" in payload),
  );
}

async function findRaceId(season, round) {
  const { data } = await supabase
    .from("races")
    .select("id")
    .eq("season_year", season)
    .eq("round", round)
    .maybeSingle();

  return data?.id ?? null;
}

async function findOrCreateSession(raceId, sessionType, name, date, time) {
  const startAt = date ? `${date}T${time ?? "00:00:00Z"}` : null;
  const { data: existing } = await supabase
    .from("sessions")
    .select("id, start_at")
    .eq("race_id", raceId)
    .eq("session_type", sessionType)
    .maybeSingle();

  if (existing?.id) {
    const { data } = await supabase
      .from("sessions")
      .update({
        name,
        start_at: existing.start_at ?? startAt,
        status: "completed",
      })
      .eq("id", existing.id)
      .select("id")
      .single();

    return data?.id ?? null;
  }

  const { data } = await supabase
    .from("sessions")
    .insert({
      race_id: raceId,
      session_type: sessionType,
      name,
      start_at: startAt,
      status: "completed",
    })
    .select("id")
    .single();

  return data?.id ?? null;
}

async function upsertScheduleSessions(raceId, race, options = {}) {
  if (!raceId) {
    return;
  }

  const schedule = [
    ["fp1", "Свободная практика 1", race.FirstPractice],
    ["fp2", "Свободная практика 2", race.SecondPractice],
    ["fp3", "Свободная практика 3", race.ThirdPractice],
    ["sprint_qualifying", "Спринт-квалификация", race.SprintQualifying ?? race.SprintShootout],
    ["sprint", "Спринт", race.Sprint],
    ["qualifying", "Квалификация", race.Qualifying],
    ["race", "Гонка", { date: race.date, time: race.time }],
  ];

  for (const [sessionType, name, value] of schedule) {
    if (!value?.date) {
      continue;
    }

    const startAt = `${value.date}T${value.time ?? "00:00:00Z"}`;
    const status = hasSessionCompletionWindowElapsed(startAt, sessionType) ? "completed" : "scheduled";

    const { data: previous } = await supabase
      .from("sessions")
      .select("id, start_at")
      .eq("race_id", raceId)
      .eq("session_type", sessionType)
      .maybeSingle();

    const { data: saved } = await supabase.from("sessions").upsert(
      {
        race_id: raceId,
        session_type: sessionType,
        name,
        start_at: startAt,
        status,
      },
      { onConflict: "race_id,session_type" },
    ).select("id").single();

    if (
      !options.suppressNotifications &&
      previous?.start_at &&
      hasSessionStartChanged(previous.start_at, startAt) &&
      new Date(startAt).getTime() > Date.now() &&
      saved?.id
    ) {
      await enqueueScheduleChangeNotifications({
        sessionId: saved.id,
        sessionName: name,
        sessionType,
        previousStartAt: previous.start_at,
        startAt,
      });
    }
  }
}

async function enqueueNotifications() {
  const now = new Date();
  const since = new Date(now.getTime() - 48 * 60 * 60 * 1_000).toISOString();
  const until = new Date(now.getTime() + 25 * 60 * 60 * 1_000).toISOString();
  const newsBudgetSince = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString();
  const allNewsDailyLimit = 30;
  const { data: previousRun } = await supabase
    .from("job_runs")
    .select("finished_at")
    .eq("job_name", "notifications.enqueue")
    .eq("status", "success")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const defaultNewsSince = now.getTime() - 15 * 60 * 1_000;
  const previousNewsSince = previousRun?.finished_at ? new Date(previousRun.finished_at).getTime() : defaultNewsSince;
  const newsSince = new Date(Math.max(now.getTime() - 48 * 60 * 60 * 1_000, previousNewsSince)).toISOString();
  const {
    accounts,
    preferences,
    profiles,
    favoriteNewsTerms,
  } = await getTelegramRecipients();

  if (!accounts.length) {
    return { itemsProcessed: 0, metadata: { recipients: 0 } };
  }

  const [
    { data: sessions },
    { data: news },
    { data: upcomingRace },
    recentNewsCounts,
  ] = await Promise.all([
    supabase
      .from("sessions")
      .select("id, race_id, session_type, name, start_at, status, updated_at, races(race_name)")
      .gte("start_at", since)
      .lte("start_at", until)
      .order("start_at", { ascending: true }),
    supabase
      .from("news_articles")
      .select("id, slug, ai_title_ru, original_title, ai_summary_ru, ai_processed_at, image_url, source_image_url, news_sources(name), news_article_tags(tags(type,slug,name))")
      .eq("status", "processed")
      .eq("publication_status", "published")
      .gte("ai_processed_at", newsSince)
      .order("ai_processed_at", { ascending: false })
      .limit(60),
    supabase
      .from("races")
      .select("id, race_name, race_start_at, status, sessions(id,session_type,start_at)")
      .not("status", "in", "(completed,finished)")
      .gte("race_start_at", now.toISOString())
      .order("race_start_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    getRecentNewsNotificationCounts(
      accounts.map((account) => account.user_id),
      newsBudgetSince,
    ),
  ]);
  const { data: upcomingPredictions } = upcomingRace?.id
    ? await supabase
        .from("predictions")
        .select("id,user_id,pole_driver_id,fastest_lap_driver_id,dnf_driver_id,dnf_pick_kind,top_scoring_team_id,fastest_pit_stop_team_id,top10_driver_ids")
        .eq("race_id", upcomingRace.id)
        .is("league_id", null)
    : { data: [] };

  let itemsProcessed = 0;
  let newsEnqueued = 0;
  let newsSuppressed = 0;
  const completedSessions = (sessions ?? []).filter((session) =>
    session.status === "completed" && isResultSession(session.session_type),
  );
  const resultMap = await getSessionTopThree(completedSessions.map((session) => session.id));

  for (const account of accounts) {
    const preference = preferences.get(account.user_id);
    const profile = profiles.get(account.user_id);
    const connectedAt = account.connected_at;

    if (!preference?.telegram_enabled) {
      continue;
    }

    for (const session of sessions ?? []) {
      const race = firstRelation(session.races);
      const startsAt = session.start_at ? new Date(session.start_at) : null;
      const sessionPreference = getSessionNotificationSetting(preference, session.session_type);

      if (!sessionPreference?.enabled) {
        continue;
      }

      if (session.status === "scheduled" && startsAt) {
        const millisecondsUntil = startsAt.getTime() - now.getTime();
        const reminders = [
          { key: "24h", enabled: sessionPreference.reminder_24h, leadMs: 24 * 60 * 60 * 1_000, label: "24 часа" },
          { key: "1h", enabled: sessionPreference.reminder_1h, leadMs: 60 * 60 * 1_000, label: "1 час" },
          { key: "15m", enabled: sessionPreference.reminder_15m, leadMs: 15 * 60 * 1_000, label: "15 минут" },
        ];

        for (const reminder of reminders) {
          if (!reminder.enabled || !isReminderDue(millisecondsUntil, reminder.leadMs)) {
            continue;
          }

          itemsProcessed += await insertNotification({
            userId: account.user_id,
            eventType: "SESSION_STARTING",
            entityType: "session",
            entityId: session.id,
            dedupeKey: `session:${session.id}:${account.user_id}:${reminder.key}`,
            payload: {
              text: `🏁 <b>${escapeTelegramHtml(session.name)} уже близко</b>\n\n📍 ${escapeTelegramHtml(race?.race_name ?? "Гоночный уикенд")}\n⏱ Старт через <b>${reminder.label}</b>\n🗓 ${escapeTelegramHtml(formatTelegramDate(session.start_at, profile?.timezone))}`,
              parseMode: "HTML",
              buttonText: "Открыть уикенд",
              buttonUrl: "/weekend",
            },
          });
        }
      }

      if (session.status === "cancelled") {
        if (!isNotificationFreshForConnection(session.updated_at, connectedAt)) {
          continue;
        }

        itemsProcessed += await insertNotification({
          userId: account.user_id,
          eventType: "SESSION_CANCELLED",
          entityType: "session",
          entityId: session.id,
          dedupeKey: `cancelled:${session.id}:${account.user_id}`,
          payload: {
            text: `⚠️ <b>${escapeTelegramHtml(session.name)} отменена</b>\n\nАктуальное расписание уже доступно в RaceSide.`,
            parseMode: "HTML",
            buttonText: "Открыть календарь",
            buttonUrl: "/calendar",
          },
        });
      }

      if (session.status === "completed") {
        const resultReadyAt = startsAt
          ? new Date(startsAt.getTime() + getResultReadyDurationMs(session.session_type)).toISOString()
          : session.updated_at;

        if (!isNotificationFreshForConnection(resultReadyAt, connectedAt)) {
          continue;
        }

        const topThree = resultMap.get(session.id) ?? [];

        if (!topThree.length) {
          continue;
        }

        const hidden = sessionPreference.spoiler_free;
        const eventType = hidden
          ? `${session.session_type.toUpperCase()}_FINISHED_HIDDEN`
          : `${session.session_type.toUpperCase()}_FINISHED`;
        const text = hidden
          ? `🏁 <b>${escapeTelegramHtml(session.name)} завершена</b>\n\n📍 ${escapeTelegramHtml(race?.race_name ?? "Гоночный уикенд")}\n🛡 Результаты уже готовы — без спойлеров в сообщении.`
          : `🏁 <b>${escapeTelegramHtml(session.name)} завершена</b>\n\n📍 ${escapeTelegramHtml(race?.race_name ?? "Гоночный уикенд")}\n\n${topThree.map((row) => `${telegramMedal(row.position)} <b>${escapeTelegramHtml(row.driver)}</b>`).join("\n")}`;

        itemsProcessed += await insertNotification({
          userId: account.user_id,
          eventType,
          entityType: "session",
          entityId: session.id,
          dedupeKey: `result:${session.id}:${account.user_id}`,
          payload: {
            text,
            parseMode: "HTML",
            buttonText: hidden ? "Открыть результаты" : "Полные результаты",
            buttonUrl: `/weekend?session=${encodeURIComponent(session.id)}`,
          },
        });
      }
    }

    if (upcomingRace && preference.fantasy_deadlines) {
      const raceSessions = upcomingRace.sessions ?? [];
      const qualifying = raceSessions.find((session) => session.session_type === "qualifying");
      const raceSession = raceSessions.find((session) => session.session_type === "race");
      const prediction = (upcomingPredictions ?? []).find((row) => row.user_id === account.user_id);

      const incompleteQualification = !prediction?.pole_driver_id;
      const incompleteRace = !prediction || !isRacePredictionComplete(prediction);
      const deadlines = [
        { scope: "qualification", startsAt: qualifying?.start_at, incomplete: incompleteQualification },
        { scope: "race", startsAt: raceSession?.start_at ?? upcomingRace.race_start_at, incomplete: incompleteRace },
      ];

      for (const deadline of deadlines) {
        if (!deadline.startsAt || !deadline.incomplete) {
          continue;
        }

        const millisecondsUntil = new Date(deadline.startsAt).getTime() - now.getTime();
        const scopeLabel = deadline.scope === "qualification" ? "квалификацию" : "гонку";

        for (const reminder of getFantasyDeadlineReminders(preference)) {
          if (!reminder.enabled || !isReminderDue(millisecondsUntil, reminder.leadMs)) {
            continue;
          }

          itemsProcessed += await insertNotification({
            userId: account.user_id,
            eventType: "FANTASY_DEADLINE",
            entityType: "race",
            entityId: upcomingRace.id,
            dedupeKey: `fantasy-deadline:${upcomingRace.id}:${account.user_id}:${deadline.scope}:${reminder.key}`,
            payload: {
              text: `${reminder.urgency} <b>Прогноз ещё не заполнен</b>\n\n🏎 ${escapeTelegramHtml(upcomingRace.race_name)}\n⏱ До дедлайна на ${scopeLabel} — <b>${reminder.label}</b>.\n\nУспейте сохранить выбор до закрытия.`,
              parseMode: "HTML",
              buttonText: "Закончить прогноз",
              buttonUrl: "/fantasy",
            },
          });
        }
      }
    }

    if (hasAnyNewsPreference(preference)) {
      let allNewsBudget = preference.important_news
        ? getRemainingNewsNotificationBudget(
          recentNewsCounts.get(account.user_id) ?? 0,
          allNewsDailyLimit,
        )
        : Number.POSITIVE_INFINITY;

      for (const article of news ?? []) {
        if (!isNotificationFreshForConnection(article.ai_processed_at, connectedAt)) {
          continue;
        }

        if (!matchesNewsPreference(article, preference, favoriteNewsTerms.get(account.user_id))) {
          continue;
        }

        if (preference.important_news && allNewsBudget <= 0) {
          newsSuppressed += 1;
          continue;
        }

        const inserted = await insertNotification({
          userId: account.user_id,
          eventType: "IMPORTANT_NEWS",
          entityType: "news",
          entityId: article.id,
          dedupeKey: `news:${article.id}:${account.user_id}`,
          payload: {
            text: formatNewsTelegramText(article),
            parseMode: "HTML",
            photoUrl: article.image_url ?? article.source_image_url ?? null,
            buttonText: "Читать подробнее",
            buttonUrl: buildNewsArticlePath(article),
          },
        });
        itemsProcessed += inserted;
        newsEnqueued += inserted;

        if (inserted && preference.important_news) {
          allNewsBudget -= 1;
        }
      }
    }
  }

  return {
    itemsProcessed,
    metadata: {
      recipients: accounts.length,
      newsEnqueued,
      newsSuppressed,
      allNewsDailyLimit,
    },
  };
}

async function runNotificationCycle() {
  const enqueueResult = await enqueueNotifications();
  const dispatchResult = await dispatchNotifications();

  return {
    itemsProcessed: enqueueResult.itemsProcessed + dispatchResult.itemsProcessed,
    metadata: {
      ...enqueueResult.metadata,
      enqueued: enqueueResult.itemsProcessed,
      dispatched: dispatchResult.itemsProcessed,
      dispatchSelected: dispatchResult.metadata?.selected ?? 0,
    },
  };
}

async function getRecentNewsNotificationCounts(userIds, since) {
  if (!userIds.length) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("notification_queue")
    .select("user_id")
    .eq("event_type", "IMPORTANT_NEWS")
    .in("status", ["pending", "sending", "sent"])
    .in("user_id", userIds)
    .gte("created_at", since)
    .limit(Math.max(100, userIds.length * 60));

  if (error) {
    throw error;
  }

  const counts = new Map(userIds.map((userId) => [userId, 0]));

  for (const row of data ?? []) {
    counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
  }

  return counts;
}

async function dispatchNotifications() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing for notification delivery");
  }

  const limit = Math.max(1, Number(process.env.NOTIFICATION_DISPATCH_LIMIT ?? 100));
  const { data: queued, error } = await supabase
    .from("notification_queue")
    .select("id, user_id, event_type, payload, attempts, created_at")
    .eq("status", "pending")
    .lte("available_at", new Date().toISOString())
    .order("available_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw error;
  }

  const billingEnforced = ["1", "true"].includes(String(process.env.BILLING_ENTITLEMENTS_ENFORCED ?? "").toLowerCase());
  const activeSubscribers = new Set();
  if (billingEnforced && queued?.length) {
    const userIds = [...new Set(queued.map((notification) => notification.user_id))];
    const { data: subscriptions, error: subscriptionError } = await supabase
      .from("subscriptions")
      .select("user_id")
      .eq("status", "active")
      .gt("current_period_end", new Date().toISOString())
      .in("user_id", userIds);
    if (subscriptionError) throw subscriptionError;
    for (const subscription of subscriptions ?? []) activeSubscribers.add(subscription.user_id);
  }

  let itemsProcessed = 0;

  for (const notification of queued ?? []) {
    if (billingEnforced && !activeSubscribers.has(notification.user_id)) {
      await supabase.from("notification_queue").update({ status: "cancelled", last_error: "RaceSide Plus is not active" }).eq("id", notification.id);
      continue;
    }
    const [{ data: account }, { data: preference }] = await Promise.all([
      supabase.from("telegram_accounts").select("chat_id, is_active, connected_at").eq("user_id", notification.user_id).maybeSingle(),
      supabase.from("notification_preferences").select("telegram_enabled").eq("user_id", notification.user_id).maybeSingle(),
    ]);

    if (!account?.is_active || !preference?.telegram_enabled) {
      await supabase.from("notification_queue").update({ status: "cancelled" }).eq("id", notification.id);
      continue;
    }

    if (!isNotificationFreshForConnection(notification.created_at, account.connected_at)) {
      await supabase
        .from("notification_queue")
        .update({ status: "cancelled", last_error: "Notification predates Telegram connection" })
        .eq("id", notification.id);
      continue;
    }

    const nextAttempt = Number(notification.attempts ?? 0) + 1;
    if (!await claimNotification(supabase, notification)) continue;

    try {
      const result = await sendQueuedTelegramMessage(botToken, account.chat_id, notification.payload ?? {});
      const sentAt = new Date().toISOString();
      await Promise.all([
        supabase.from("notification_queue").update({ status: "sent", sent_at: sentAt, last_error: null }).eq("id", notification.id),
        supabase.from("notification_logs").insert({
          queue_id: notification.id,
          user_id: notification.user_id,
          event_type: notification.event_type,
          status: "sent",
          provider_message_id: String(result.result?.message_id ?? ""),
        }),
        supabase.from("telegram_accounts").update({ last_delivery_at: sentAt, last_error: null }).eq("user_id", notification.user_id),
      ]);
      itemsProcessed += 1;
    } catch (deliveryError) {
      const message = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
      const blocked = /403|blocked|deactivated|chat not found/i.test(message);
      await Promise.all([
        supabase.from("notification_queue").update({
          status: blocked || nextAttempt >= 3 ? "failed" : "pending",
          available_at: new Date(Date.now() + nextAttempt * 5 * 60 * 1_000).toISOString(),
          last_error: message.slice(0, 500),
        }).eq("id", notification.id),
        supabase.from("notification_logs").insert({
          queue_id: notification.id,
          user_id: notification.user_id,
          event_type: notification.event_type,
          status: "failed",
          error_message: message.slice(0, 500),
        }),
        supabase.from("telegram_accounts").update({ is_active: blocked ? false : true, last_error: message.slice(0, 500) }).eq("user_id", notification.user_id),
      ]);

      if (!blocked && nextAttempt >= 3) {
        captureWorkerException(
          new Error(`Telegram notification delivery failed after ${nextAttempt} attempts: ${getSafeErrorMessage(deliveryError)}`),
          { jobName: "notifications.dispatch" },
        );
        await flushWorkerTelemetry();
      }
    }
  }

  return { itemsProcessed, metadata: { selected: queued?.length ?? 0 } };
}

async function processBillingEmails() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.BILLING_EMAIL_FROM?.trim() || process.env.AUTH_EMAIL_FROM?.trim();
  if (!apiKey || !from) return { itemsProcessed: 0, metadata: { skipped: "email_not_configured" } };
  const { data: deliveries, error } = await supabase
    .from("billing_email_deliveries")
    .select("id, order_id, attempts")
    .in("status", ["queued", "failed"])
    .lt("attempts", 5)
    .lte("available_at", new Date().toISOString())
    .order("available_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  let itemsProcessed = 0;
  for (const delivery of deliveries ?? []) {
    const { data: order } = await supabase.from("billing_orders").select("order_number, user_id, amount_minor, duration_months, provider, payment_method, paid_at").eq("id", delivery.order_id).maybeSingle();
    const [{ data: profile }, { data: period }] = order ? await Promise.all([
      supabase.from("profiles").select("email").eq("id", order.user_id).maybeSingle(),
      supabase.from("subscription_periods").select("ends_at").eq("order_id", delivery.order_id).maybeSingle(),
    ]) : [{ data: null }, { data: null }];
    if (!order || !profile?.email) {
      await supabase.from("billing_email_deliveries").update({ status: "skipped", last_error: "Recipient email is unavailable", updated_at: new Date().toISOString() }).eq("id", delivery.id);
      continue;
    }
    const attempts = Number(delivery.attempts ?? 0) + 1;
    await supabase.from("billing_email_deliveries").update({ status: "sending", attempts, recipient_email: profile.email, updated_at: new Date().toISOString() }).eq("id", delivery.id);
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `raceside-billing-${delivery.id}` },
        body: JSON.stringify({
          from,
          to: [profile.email],
          subject: "RaceSide Plus активирован",
          html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171717"><p style="color:#e10600;font-weight:700">RACESIDE PLUS</p><h1>Подписка активна</h1><p>Оплата по заказу <strong>${escapeBillingEmail(order.order_number)}</strong> подтверждена.</p><p>Срок: <strong>${order.duration_months === 12 ? "12 месяцев" : "1 месяц"}</strong>${period?.ends_at ? `, до ${formatBillingEmailDate(period.ends_at)}` : ""}.</p><p>Сумма: <strong>${(Number(order.amount_minor) / 100).toLocaleString("ru-RU")} ₽</strong><br>Способ: <strong>${order.provider === "tribute" ? "Tribute" : order.payment_method === "yoomoney_wallet" ? "Кошелёк ЮMoney" : "Карта через ЮMoney"}</strong>${order.paid_at ? `<br>Оплачено: <strong>${formatBillingEmailDate(order.paid_at)}</strong>` : ""}</p><p>Автоматического продления нет — следующий период вы оплачиваете сами.</p><p><a href="${process.env.NEXT_PUBLIC_SITE_URL ?? "https://raceside.ru"}/account/subscription">Открыть подписку</a></p></div>`,
        }),
        signal: AbortSignal.timeout(12_000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Resend ${response.status}`);
      await supabase.from("billing_email_deliveries").update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: String(result.id ?? ""), last_error: null, updated_at: new Date().toISOString() }).eq("id", delivery.id);
      itemsProcessed += 1;
    } catch (deliveryError) {
      await supabase.from("billing_email_deliveries").update({ status: attempts >= 5 ? "failed" : "queued", available_at: new Date(Date.now() + attempts * 5 * 60_000).toISOString(), last_error: String(deliveryError instanceof Error ? deliveryError.message : deliveryError).slice(0, 500), updated_at: new Date().toISOString() }).eq("id", delivery.id);
    }
  }
  return { itemsProcessed, metadata: { selected: deliveries?.length ?? 0 } };
}

function escapeBillingEmail(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function formatBillingEmailDate(value) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(value));
}

async function expireBillingSubscriptions() {
  const { data, error } = await supabase
    .from("subscriptions")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("status", "active")
    .lte("current_period_end", new Date().toISOString())
    .select("id");
  if (error) throw error;
  return { itemsProcessed: data?.length ?? 0, metadata: { expired: data?.length ?? 0 } };
}

async function expireBillingOrders() {
  const now = new Date().toISOString();
  const [{ data: orders, error: orderError }, { error: rateLimitError }] = await Promise.all([
    supabase
      .from("billing_orders")
      .update({ failed_at: now, failure_reason: "CHECKOUT_EXPIRED", status: "failed", updated_at: now })
      .eq("status", "pending")
      .lte("expires_at", now)
      .select("id"),
    supabase
      .from("billing_rate_limits")
      .delete()
      .lt("updated_at", new Date(Date.now() - 48 * 60 * 60 * 1_000).toISOString()),
  ]);
  if (orderError) throw orderError;
  if (rateLimitError) throw rateLimitError;
  return { itemsProcessed: orders?.length ?? 0, metadata: { expiredOrders: orders?.length ?? 0 } };
}

async function reconcileTributePayments() {
  const apiKey = readRequiredEnvironmentValue(process.env, "TRIBUTE_API_KEY");
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1_000).toISOString();
  const selection = "id,provider_order_id,payment_method,amount_minor,currency,created_at";
  const [pendingResult, expiredResult] = await Promise.all([
    supabase
      .from("billing_orders")
      .select(selection)
      .eq("provider", "tribute")
      .eq("status", "pending")
      .gte("created_at", cutoff)
      .not("provider_order_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(50),
    supabase
      .from("billing_orders")
      .select(selection)
      .eq("provider", "tribute")
      .eq("status", "failed")
      .eq("failure_reason", "CHECKOUT_EXPIRED")
      .gte("created_at", cutoff)
      .not("provider_order_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(50),
  ]);
  const selectionError = pendingResult.error ?? expiredResult.error;
  if (selectionError) throw selectionError;

  const orders = [...(pendingResult.data ?? []), ...(expiredResult.data ?? [])];
  let matched = 0;
  let checked = 0;
  for (const order of orders) {
    checked += 1;
    const status = await fetchTributeApi(
      `/shop/orders/${encodeURIComponent(order.provider_order_id)}/status`,
      apiKey,
    );
    if (status?.status !== "paid") {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
      continue;
    }
    const transactions = await fetchTributeApi(
      `/shop/orders/${encodeURIComponent(order.provider_order_id)}/transactions`,
      apiKey,
    );
    const transaction = findMatchingTributeTransaction(order, transactions);
    if (!transaction) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
      continue;
    }
    const payloadHash = makeTributeReconciliationHash({
      ...transaction,
      orderId: order.provider_order_id,
    });
    const eventId = `tribute_api_reconciliation:${order.provider_order_id}:${transaction.transactionId}`;
    const { error } = await supabase.rpc("billing_apply_payment", {
      p_currency: "RUB",
      p_gross_amount_minor: transaction.grossAmountMinor,
      p_net_amount_minor: transaction.netAmountMinor,
      p_occurred_at: transaction.occurredAt,
      p_order_id: order.id,
      p_payload_hash: payloadHash,
      p_payment_method: order.payment_method,
      p_provider: "tribute",
      p_provider_event_id: eventId,
      p_provider_event_type: "shop_api_reconciliation",
      p_provider_reference: order.provider_order_id,
      p_provider_transaction_id: transaction.transactionId,
      p_safe_payload: {
        grossAmountMinor: transaction.grossAmountMinor,
        netAmountMinor: transaction.netAmountMinor,
        occurredAt: transaction.occurredAt,
        source: "tribute_shop_api",
        transactionId: transaction.transactionId,
      },
    });
    if (error) throw error;
    matched += 1;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }

  return {
    itemsProcessed: matched,
    metadata: { candidates: orders.length, checked, matched },
  };
}

async function fetchTributeApi(path, apiKey) {
  const response = await fetch(`https://tribute.tg/api/v1${path}`, {
    headers: {
      Accept: "application/json",
      "Api-Key": apiKey,
      "User-Agent": "RaceSide-Billing/1.0",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`TRIBUTE_RECONCILE_HTTP_${response.status}`);
  return response.json();
}

async function reconcileYooMoneyPayments() {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1_000).toISOString();
  const selection = "id,provider_label,payment_method,amount_minor,currency,created_at";
  const [pendingResult, expiredResult] = await Promise.all([
    supabase
      .from("billing_orders")
      .select(selection)
      .eq("provider", "yoomoney")
      .eq("status", "pending")
      .gte("created_at", cutoff)
      .not("provider_label", "is", null)
      .order("created_at", { ascending: true })
      .limit(50),
    supabase
      .from("billing_orders")
      .select(selection)
      .eq("provider", "yoomoney")
      .eq("status", "failed")
      .eq("failure_reason", "CHECKOUT_EXPIRED")
      .gte("created_at", cutoff)
      .not("provider_label", "is", null)
      .order("created_at", { ascending: true })
      .limit(50),
  ]);
  const selectionError = pendingResult.error ?? expiredResult.error;
  if (selectionError) throw selectionError;

  const orders = [...(pendingResult.data ?? []), ...(expiredResult.data ?? [])];
  if (orders.length === 0) {
    return { itemsProcessed: 0, metadata: { candidates: 0, checked: 0, matched: 0 } };
  }

  const operationsByOrderId = await loadYooMoneyReconciliationMatches(orders);
  let matched = 0;
  let checked = 0;
  for (const order of orders) {
    checked += 1;
    const operation = findMatchingYooMoneyOperation(
      order,
      operationsByOrderId.get(order.id) ?? [],
    );
    if (!operation) continue;
    const payloadHash = makeYooMoneyReconciliationHash({
      amountMinor: operation.netAmountMinor,
      label: order.provider_label,
      occurredAt: operation.occurredAt,
      operationId: operation.operationId,
    });
    const { error } = await supabase.rpc("billing_apply_payment", {
      p_currency: order.currency,
      p_gross_amount_minor: Number(order.amount_minor),
      p_net_amount_minor: operation.netAmountMinor,
      p_occurred_at: operation.occurredAt,
      p_order_id: order.id,
      p_payload_hash: payloadHash,
      p_payment_method: order.payment_method,
      p_provider: "yoomoney",
      p_provider_event_id: operation.operationId,
      p_provider_event_type: "wallet_api_reconciliation",
      p_provider_reference: order.provider_label,
      p_provider_transaction_id: operation.operationId,
      p_safe_payload: {
        amountMinor: operation.netAmountMinor,
        occurredAt: operation.occurredAt,
        source: "wallet_api",
      },
    });
    if (error) throw error;
    matched += 1;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }

  return {
    itemsProcessed: matched,
    metadata: {
      candidates: orders.length,
      checked,
      matched,
    },
  };
}

async function loadYooMoneyReconciliationMatches(orders) {
  const functionUrl = `${readRequiredEnvironmentValue(process.env, "NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "")}/functions/v1/yoomoney-reconcile`;
  const serviceRoleKey = readRequiredEnvironmentValue(process.env, "SUPABASE_SERVICE_ROLE_KEY");
  const reconcileSecret = readRequiredEnvironmentValue(process.env, "YOOMONEY_RECONCILE_SECRET");
  const response = await fetch(functionUrl, {
    body: JSON.stringify({ orders }),
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      "User-Agent": "RaceSide-Billing/1.0",
      "x-raceside-reconcile-secret": reconcileSecret,
    },
    method: "POST",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`YOOMONEY_RECONCILE_HTTP_${response.status}`);
  const payload = await response.json();
  if (payload?.error) {
    throw new Error(`YOOMONEY_RECONCILE_${String(payload.error).slice(0, 80)}`);
  }
  const matches = Array.isArray(payload?.matches) ? payload.matches : [];
  const result = new Map();
  for (const match of matches) {
    if (!match || typeof match.orderId !== "string" || !match.operation) continue;
    const current = result.get(match.orderId) ?? [];
    current.push(match.operation);
    result.set(match.orderId, current);
  }
  return result;
}

async function auditBilling() {
  const now = new Date().toISOString();
  const [ordersResult, transactionsResult, periodsResult, pendingResult] = await Promise.all([
    supabase.from("billing_orders").select("id, amount_minor, currency").eq("status", "paid").limit(5000),
    supabase.from("payment_transactions").select("order_id, gross_amount_minor, currency").limit(5000),
    supabase.from("subscription_periods").select("order_id, subscription_id, starts_at, ends_at, status").order("subscription_id").order("starts_at").limit(10000),
    supabase.from("billing_orders").select("id", { count: "exact", head: true }).eq("status", "pending").lte("expires_at", now),
  ]);
  const error = ordersResult.error ?? transactionsResult.error ?? periodsResult.error ?? pendingResult.error;
  if (error) throw error;

  const transactions = new Map((transactionsResult.data ?? []).map((row) => [row.order_id, row]));
  const paymentPeriods = new Set((periodsResult.data ?? []).map((row) => row.order_id).filter(Boolean));
  const paidWithoutPeriod = (ordersResult.data ?? []).filter((order) => !paymentPeriods.has(order.id)).length;
  const amountMismatches = (ordersResult.data ?? []).filter((order) => {
    const transaction = transactions.get(order.id);
    return !transaction || Number(transaction.gross_amount_minor) !== Number(order.amount_minor) || transaction.currency !== order.currency;
  }).length;

  let overlaps = 0;
  const lastEndBySubscription = new Map();
  for (const period of periodsResult.data ?? []) {
    if (period.status !== "active") continue;
    const previousEnd = lastEndBySubscription.get(period.subscription_id);
    if (previousEnd && Date.parse(period.starts_at) < Date.parse(previousEnd)) overlaps += 1;
    if (!previousEnd || Date.parse(period.ends_at) > Date.parse(previousEnd)) {
      lastEndBySubscription.set(period.subscription_id, period.ends_at);
    }
  }

  const anomalies = paidWithoutPeriod + amountMismatches + overlaps + (pendingResult.count ?? 0);
  if (anomalies > 0) {
    captureWorkerException(new Error(`Billing audit found ${anomalies} anomalies`), { jobName: "billing.audit" });
    await flushWorkerTelemetry();
  }
  return {
    itemsProcessed: (ordersResult.data?.length ?? 0) + (periodsResult.data?.length ?? 0),
    metadata: {
      amountMismatches,
      expiredPending: pendingResult.count ?? 0,
      periodOverlaps: overlaps,
      paidWithoutPeriod,
    },
  };
}

async function retryFailedBillingEvents() {
  const { data: events, error } = await supabase
    .from("billing_notification_events")
    .select("id, provider, provider_event_id, provider_event_type, provider_reference, payload_hash, safe_payload, attempts")
    .eq("signature_valid", true)
    .eq("status", "failed")
    .lt("attempts", 10)
    .order("received_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  let itemsProcessed = 0;
  for (const event of events ?? []) {
    const payload = event.safe_payload ?? {};
    if (!event.provider_reference || !Number.isSafeInteger(payload.grossAmountMinor) || !Number.isSafeInteger(payload.netAmountMinor) || typeof payload.occurredAt !== "string" || typeof payload.paymentMethod !== "string" || typeof payload.transactionId !== "string") {
      continue;
    }
    const referenceColumn = event.provider === "tribute" ? "provider_order_id" : "provider_label";
    const { data: order } = await supabase.from("billing_orders").select("id").eq(referenceColumn, event.provider_reference).maybeSingle();
    if (!order) continue;
    const { error: applyError } = await supabase.rpc("billing_apply_payment", {
      p_currency: payload.currency,
      p_gross_amount_minor: payload.grossAmountMinor,
      p_net_amount_minor: payload.netAmountMinor,
      p_occurred_at: payload.occurredAt,
      p_order_id: order.id,
      p_payload_hash: event.payload_hash,
      p_payment_method: payload.paymentMethod,
      p_provider: event.provider,
      p_provider_event_id: event.provider_event_id,
      p_provider_event_type: event.provider_event_type,
      p_provider_reference: event.provider_reference,
      p_provider_transaction_id: payload.transactionId,
      p_safe_payload: payload,
    });
    if (applyError) {
      await supabase.from("billing_notification_events").update({
        attempts: Number(event.attempts ?? 0) + 1,
        last_error: String(applyError.message ?? "retry_failed").slice(0, 500),
      }).eq("id", event.id);
      continue;
    }
    itemsProcessed += 1;
  }
  return { itemsProcessed, metadata: { selected: events?.length ?? 0 } };
}

async function enqueueScheduleChangeNotifications({ sessionId, sessionName, sessionType, previousStartAt, startAt }) {
  const { accounts, preferences, profiles } = await getTelegramRecipients();
  let itemsProcessed = 0;

  for (const account of accounts) {
    const preference = preferences.get(account.user_id);
    const sessionPreference = getSessionNotificationSetting(preference, sessionType);

    if (!preference?.telegram_enabled || !sessionPreference?.enabled) {
      continue;
    }

    itemsProcessed += await insertNotification({
      userId: account.user_id,
      eventType: "SESSION_TIME_CHANGED",
      entityType: "session",
      entityId: sessionId,
      dedupeKey: `schedule:${sessionId}:${account.user_id}:${startAt}`,
      payload: {
        text: `🗓 <b>Время сессии изменилось</b>\n\n${escapeTelegramHtml(sessionName)}\n\nБыло: <s>${escapeTelegramHtml(formatTelegramDate(previousStartAt, profiles.get(account.user_id)?.timezone))}</s>\nСтало: <b>${escapeTelegramHtml(formatTelegramDate(startAt, profiles.get(account.user_id)?.timezone))}</b>`,
        parseMode: "HTML",
        buttonText: "Открыть календарь",
        buttonUrl: "/calendar",
      },
    });
  }

  return itemsProcessed;
}

async function getTelegramRecipients() {
  const { data: accountRows, error: accountError } = await supabase
    .from("telegram_accounts")
    .select("user_id, chat_id, connected_at")
    .eq("is_active", true);
  if (accountError) throw accountError;

  let accounts = accountRows ?? [];
  const billingEnforced = ["1", "true"].includes(String(process.env.BILLING_ENTITLEMENTS_ENFORCED ?? "").toLowerCase());
  if (billingEnforced && accounts.length) {
    const candidateIds = [...new Set(accounts.map((account) => account.user_id))];
    const { data: subscriptions, error: subscriptionError } = await supabase
      .from("subscriptions")
      .select("user_id")
      .eq("status", "active")
      .gt("current_period_end", new Date().toISOString())
      .in("user_id", candidateIds);
    if (subscriptionError) throw subscriptionError;
    const activeSubscribers = new Set((subscriptions ?? []).map((subscription) => subscription.user_id));
    accounts = accounts.filter((account) => activeSubscribers.has(account.user_id));
  }

  const userIds = accounts.map((account) => account.user_id);

  if (!userIds.length) {
    return { accounts: [], preferences: new Map(), profiles: new Map(), favoriteNewsTerms: new Map() };
  }

  const [
    { data: preferenceRows },
    { data: profileRows },
    { data: favoriteTeamRows },
    { data: favoriteDriverRows },
  ] = await Promise.all([
    supabase.from("notification_preferences").select("*").in("user_id", userIds),
    supabase.from("profiles").select("id, timezone").in("id", userIds),
    supabase.from("user_favorite_teams").select("user_id, teams(name,short_name,code)").in("user_id", userIds),
    supabase.from("user_favorite_drivers").select("user_id, drivers(full_name,slug,code)").in("user_id", userIds),
  ]);
  const favoriteNewsTerms = new Map();

  for (const row of favoriteTeamRows ?? []) {
    const team = firstRelation(row.teams);
    const terms = favoriteNewsTerms.get(row.user_id) ?? { drivers: [], teams: [] };
    terms.teams.push(...[team?.name, team?.short_name, team?.code].filter(Boolean).map(normalizeNewsTerm));
    favoriteNewsTerms.set(row.user_id, terms);
  }

  for (const row of favoriteDriverRows ?? []) {
    const driver = firstRelation(row.drivers);
    const terms = favoriteNewsTerms.get(row.user_id) ?? { drivers: [], teams: [] };
    terms.drivers.push(...[driver?.full_name, driver?.slug, driver?.code].filter(Boolean).map(normalizeNewsTerm));
    favoriteNewsTerms.set(row.user_id, terms);
  }

  return {
    accounts: accounts ?? [],
    preferences: new Map((preferenceRows ?? []).map((row) => [row.user_id, row])),
    profiles: new Map((profileRows ?? []).map((row) => [row.id, row])),
    favoriteNewsTerms,
  };
}

async function getSessionTopThree(sessionIds) {
  if (!sessionIds.length) {
    return new Map();
  }

  const { data } = await supabase
    .from("session_results")
    .select("session_id, position, drivers(full_name)")
    .in("session_id", sessionIds)
    .in("position", [1, 2, 3])
    .order("position", { ascending: true });
  const map = new Map();

  for (const row of data ?? []) {
    const driver = firstRelation(row.drivers);
    const values = map.get(row.session_id) ?? [];
    values.push({ position: row.position, driver: driver?.full_name ?? "Пилот" });
    map.set(row.session_id, values);
  }

  return map;
}

async function insertNotification({ userId, eventType, entityType, entityId, dedupeKey, payload }) {
  const { data, error } = await supabase
    .from("notification_queue")
    .upsert({
      user_id: userId,
      event_type: eventType,
      entity_type: entityType,
      entity_id: entityId,
      dedupe_key: dedupeKey,
      payload,
    }, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("id");

  if (error) {
    throw error;
  }

  return data?.length ? 1 : 0;
}

async function sendQueuedTelegramMessage(botToken, chatId, payload) {
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://raceside.online").replace(/\/$/, "");
  const buttons = [];

  if (payload.callbackText && payload.callbackData) {
    buttons.push([{ text: payload.callbackText, callback_data: payload.callbackData }]);
  }

  if (payload.buttonText && payload.buttonUrl) {
    const buttonUrl = /^https?:\/\//i.test(payload.buttonUrl)
      ? payload.buttonUrl
      : `${baseUrl}${String(payload.buttonUrl).startsWith("/") ? payload.buttonUrl : `/${payload.buttonUrl}`}`;
    buttons.push([{ text: payload.buttonText, url: buttonUrl }]);
  }

  const text = String(payload.text ?? "Новое уведомление RaceSide");
  const replyMarkup = buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {};
  const parseMode = payload.parseMode ? { parse_mode: payload.parseMode } : {};
  const send = async (method, body) => {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      throw new Error(`Telegram ${response.status}: ${result.description ?? "delivery failed"}`);
    }

    return result;
  };

  if (payload.photoUrl) {
    const photoUrl = /^https?:\/\//i.test(payload.photoUrl)
      ? payload.photoUrl
      : `${baseUrl}${String(payload.photoUrl).startsWith("/") ? payload.photoUrl : `/${payload.photoUrl}`}`;

    try {
      return await send("sendPhoto", {
        chat_id: chatId,
        photo: photoUrl,
        caption: text,
        ...parseMode,
        ...replyMarkup,
      });
    } catch (error) {
      if (/403|blocked|deactivated|chat not found/i.test(error instanceof Error ? error.message : String(error))) {
        throw error;
      }
    }
  }

  return send("sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...parseMode,
      ...replyMarkup,
  });
}

function isPracticeSession(sessionType) {
  return ["fp1", "fp2", "fp3", "practice", "practice_1", "practice_2", "practice_3"].includes(sessionType);
}

function isResultSession(sessionType) {
  return isPracticeSession(sessionType) || ["qualifying", "sprint_qualifying", "sprint", "race"].includes(sessionType);
}

function formatTelegramDate(value, timezone = "Europe/Moscow") {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: timezone || "Europe/Moscow",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return new Date(value).toISOString();
  }
}

function firstRelation(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function hasAnyNewsPreference(preference) {
  return Boolean(
    preference.important_news ||
    preference.favorite_driver_news ||
    preference.favorite_team_news
  );
}

function matchesNewsPreference(article, preference, favoriteTerms = { drivers: [], teams: [] }) {
  if (preference.important_news) {
    return true;
  }

  const tags = (article.news_article_tags ?? [])
    .map((row) => firstRelation(row.tags))
    .filter(Boolean);
  const haystack = tags.flatMap((tag) => [tag.type, tag.slug, tag.name]).filter(Boolean).map(normalizeNewsTerm);
  const includesAny = (needles) => needles.some((needle) => haystack.some((value) => value.includes(needle) || needle.includes(value)));

  return Boolean(
    (preference.favorite_driver_news && includesAny(favoriteTerms.drivers ?? [])) ||
    (preference.favorite_team_news && includesAny(favoriteTerms.teams ?? []))
  );
}

function formatNewsTelegramText(article) {
  const source = firstRelation(article.news_sources);
  const title = escapeTelegramHtml(article.ai_title_ru ?? article.original_title ?? "Новая история из мира Формулы-1");
  const summary = escapeTelegramHtml(String(article.ai_summary_ru ?? "Свежий материал уже доступен в RaceSide.").slice(0, 620));
  const sourceLine = source?.name ? `\n\n📰 ${escapeTelegramHtml(source.name)}` : "";

  return `🏎 <b>${title}</b>\n\n${summary}${sourceLine}`;
}

function normalizeNewsTerm(value) {
  return String(value ?? "").trim().toLocaleLowerCase("ru-RU").replace(/[^a-zа-яё0-9]+/g, "-");
}

async function getRaceChoices() {
  const { data } = await supabase
    .from("races")
    .select("id, season_year, round, race_name, circuits(name, country, locality)")
    .order("season_year", { ascending: false })
    .order("round", { ascending: true })
    .limit(30);

  return (data ?? []).map((race) => {
    const circuit = Array.isArray(race.circuits) ? race.circuits[0] : race.circuits;

    return {
      id: race.id,
      season_year: race.season_year,
      round: race.round,
      race_name: race.race_name,
      circuit_name: circuit?.name ?? "",
      country: circuit?.country ?? "",
      locality: circuit?.locality ?? "",
    };
  });
}

async function getDriverTagChoices() {
  const latest = await getLatestDriverStandingScope();

  if (latest) {
    const { data } = await supabase
      .from("driver_standings")
      .select("drivers(id, code, first_name, last_name, full_name), teams(id, name, short_name, code)")
      .eq("season_year", latest.season_year)
      .eq("round", latest.round)
      .order("position", { ascending: true });

    const currentDrivers = (data ?? [])
      .map((row) => {
        const driver = getRelationObject(row.drivers);
        const team = getRelationObject(row.teams);

        if (!driver?.id) {
          return null;
        }

        return mapDriverTagChoice(driver, team);
      })
      .filter(Boolean);

    if (currentDrivers.length) {
      return currentDrivers;
    }
  }

  const { data } = await supabase
    .from("drivers")
    .select("id, code, first_name, last_name, full_name, teams:current_team_id(id, name, short_name, code)")
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  return (data ?? []).map((driver) => {
    const team = Array.isArray(driver.teams) ? driver.teams[0] : driver.teams;

    return mapDriverTagChoice(driver, team);
  });
}

async function getTeamTagChoices() {
  const latest = await getLatestDriverStandingScope();

  if (latest) {
    const { data } = await supabase
      .from("driver_standings")
      .select("teams(id, name, short_name, code)")
      .eq("season_year", latest.season_year)
      .eq("round", latest.round)
      .order("position", { ascending: true });
    const teams = new Map();

    (data ?? []).forEach((row) => {
      const team = getRelationObject(row.teams);

      if (team?.id && !teams.has(team.id)) {
        teams.set(team.id, mapTeamTagChoice(team));
      }
    });

    if (teams.size) {
      return [...teams.values()];
    }
  }

  const { data } = await supabase
    .from("teams")
    .select("id, name, short_name, code")
    .eq("is_active", true)
    .order("name", { ascending: true });

  return (data ?? []).map(mapTeamTagChoice);
}

async function getLatestDriverStandingScope() {
  const { data } = await supabase
    .from("driver_standings")
    .select("season_year, round")
    .not("round", "is", null)
    .order("season_year", { ascending: false })
    .order("round", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  return data?.season_year && data?.round ? data : null;
}

function mapDriverTagChoice(driver, team) {
  return {
    id: driver.id,
    code: driver.code ?? "",
    firstName: driver.first_name ?? "",
    lastName: driver.last_name ?? "",
    fullName: driver.full_name ?? "",
    slug: `driver-${slugify(driver.full_name ?? driver.code ?? driver.id)}`,
    team: team
      ? {
          id: team.id,
          code: team.code ?? "",
          name: team.short_name ?? team.name ?? "",
          slug: makeTeamTagSlug(team.code ?? team.short_name ?? team.name ?? team.id),
        }
      : null,
  };
}

function mapTeamTagChoice(team) {
  return {
    id: team.id,
    code: team.code ?? "",
    name: team.short_name ?? team.name ?? "",
    fullName: team.name ?? "",
    slug: makeTeamTagSlug(team.code ?? team.short_name ?? team.name ?? team.id),
  };
}

async function upsertRaceTagForArticle(articleId, race, confidence, method) {
  const slug = `race-${race.season_year}-${String(race.round).padStart(2, "0")}`;
  const { data: tag } = await supabase
    .from("tags")
    .upsert(
      {
        type: "race",
        slug,
        name: race.race_name,
      },
      { onConflict: "slug" },
    )
    .select("id")
    .single();

  if (!tag?.id) {
    return;
  }

  await supabase.from("news_article_tags").upsert(
    {
      article_id: articleId,
      tag_id: tag.id,
      confidence,
      method,
    },
    { onConflict: "article_id,tag_id" },
  );
}

async function upsertDriverTagForArticle(articleId, driver, confidence, method) {
  if (!driver?.fullName) {
    return;
  }

  const { data: tag } = await supabase
    .from("tags")
    .upsert(
      {
        type: "driver",
        slug: driver.slug,
        name: driver.fullName,
      },
      { onConflict: "slug" },
    )
    .select("id")
    .single();

  if (!tag?.id) {
    return;
  }

  await supabase.from("news_article_tags").upsert(
    {
      article_id: articleId,
      tag_id: tag.id,
      confidence,
      method,
    },
    { onConflict: "article_id,tag_id" },
  );
}

async function upsertTeamTagForArticle(articleId, team, confidence, method) {
  if (!team?.name) {
    return;
  }

  const { data: tag } = await supabase
    .from("tags")
    .upsert(
      {
        type: "team",
        slug: team.slug,
        name: team.name,
      },
      { onConflict: "slug" },
    )
    .select("id")
    .single();

  if (!tag?.id) {
    return;
  }

  await supabase.from("news_article_tags").upsert(
    {
      article_id: articleId,
      tag_id: tag.id,
      confidence,
      method,
    },
    { onConflict: "article_id,tag_id" },
  );
}

function makeTeamTagSlug(value) {
  return `team-${slugify(value)}`;
}

function matchRaceByText(article, races) {
  const text = `${article.original_title ?? ""} ${article.original_description ?? ""}`.toLowerCase();

  return (
    races.find((race) => {
      const candidates = [
        race.race_name,
        race.race_name.replace(/ grand prix/i, ""),
        race.circuit_name,
        race.country,
        race.locality,
      ]
        .filter(Boolean)
        .map((value) => value.toLowerCase());

      return candidates.some((value) => value.length > 3 && text.includes(value));
    }) ?? null
  );
}

function matchDriversByText(article, drivers) {
  const text = ` ${article.original_title ?? ""} ${article.original_description ?? ""} `.toLowerCase();

  return drivers.filter((driver) => {
    const aliases = [
      driver.fullName,
      `${driver.firstName} ${driver.lastName}`.trim(),
      driver.code?.length === 3 ? driver.code : "",
      driver.lastName?.length > 4 ? driver.lastName : "",
    ]
      .filter(Boolean)
      .map((alias) => alias.toLowerCase());

    return aliases.some((alias) => new RegExp(`(^|[^a-zа-яё0-9])${escapeRegExp(alias)}([^a-zа-яё0-9]|$)`, "i").test(text));
  });
}

function matchTeamsByText(article, teams) {
  const text = ` ${article.original_title ?? ""} ${article.original_description ?? ""} `.toLowerCase();

  return teams.filter((team) => {
    const aliases = [team.name, team.fullName, team.code?.length >= 2 ? team.code : ""]
      .filter(Boolean)
      .map((alias) => alias.toLowerCase());

    return aliases.some((alias) => new RegExp(`(^|[^a-zа-яё0-9])${escapeRegExp(alias)}([^a-zа-яё0-9]|$)`, "i").test(text));
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function upsertTeamFromJolpica(constructor, options = {}) {
  if (!constructor?.constructorId) {
    return null;
  }

  const historical = options.historical ?? false;
  const knownColor = getKnownTeamColor(constructor.name ?? constructor.constructorId);
  const { data: existing, error: selectError } = await supabase
    .from("teams")
    .select("id, color_hex, is_active")
    .eq("external_id", constructor.constructorId)
    .maybeSingle();

  if (selectError) {
    throw selectError;
  }

  if (existing?.id) {
    const update = {
      name: constructor.name ?? constructor.constructorId,
      short_name: constructor.name ?? constructor.constructorId,
      country: constructor.nationality ?? null,
    };

    if (!historical) {
      update.is_active = true;
    }

    if (knownColor && !existing.color_hex) {
      update.color_hex = knownColor;
    }

    const { data, error } = await supabase
      .from("teams")
      .update(update)
      .eq("id", existing.id)
      .select("id, color_hex, is_active")
      .single();

    if (error) {
      throw error;
    }

    return data ?? existing;
  }

  const { data, error } = await supabase
    .from("teams")
    .insert({
      external_id: constructor.constructorId,
      code: makeTeamCode(constructor.constructorId),
      name: constructor.name ?? constructor.constructorId,
      short_name: constructor.name ?? constructor.constructorId,
      country: constructor.nationality ?? null,
      color_hex: knownColor,
      is_active: !historical,
    })
    .select("id, color_hex, is_active")
    .single();

  if (error) {
    throw error;
  }

  return data ?? null;
}

function getKnownTeamColor(teamNameOrCode) {
  const normalized = normalizeTeamKey(teamNameOrCode);
  const teams = [
    { color: "#0093CC", keys: ["alpine", "bwt alpine", "alp"] },
    { color: "#229971", keys: ["aston martin", "aston martin aramco", "amr", "ast"] },
    { color: "#D71920", keys: ["audi", "sauber", "kick sauber", "stake", "aud"] },
    { color: "#B98B2F", keys: ["cadillac", "cad"] },
    { color: "#E8002D", keys: ["ferrari", "scuderia ferrari", "fer"] },
    { color: "#B6BABD", keys: ["haas", "haas f1 team", "moneygram haas", "tgr haas", "has"] },
    { color: "#FF8000", keys: ["mclaren", "mclaren mercedes", "mcl"] },
    { color: "#27F4D2", keys: ["mercedes", "mercedes-amg", "mercedes amg", "mer"] },
    { color: "#6692FF", keys: ["racing bulls", "visa cash app rb", "vcarb", "rb"] },
    { color: "#3671C6", keys: ["red bull", "red bull racing", "oracle red bull racing", "rbr"] },
    { color: "#64C4FF", keys: ["williams", "williams racing", "atlansian williams", "wil"] },
  ];
  const match = teams.find((team) => team.keys.some((key) => normalized.includes(normalizeTeamKey(key))));

  return match?.color ?? null;
}

function normalizeTeamKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function upsertDriverFromJolpica(driver, teamId, options = {}) {
  if (!driver?.driverId) {
    return null;
  }

  const historical = options.historical ?? false;
  const firstName = driver.givenName ?? driver.given_name ?? "Пилот";
  const lastName = driver.familyName ?? driver.family_name ?? driver.driverId;
  const fullName = `${firstName} ${lastName}`.trim();
  const { data: existing, error: selectError } = await supabase
    .from("drivers")
    .select("id, slug, current_team_id, is_active")
    .eq("external_id", driver.driverId)
    .maybeSingle();

  if (selectError) {
    throw selectError;
  }

  const profile = {
    code: driver.code ?? driver.driverId.slice(0, 3).toUpperCase(),
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    country: driver.nationality ?? null,
  };

  if (!historical || !existing?.id) {
    profile.permanent_number = numberOrNull(driver.permanentNumber);
  }
  const slug = resolveDriverProfileSlug(existing?.slug, fullName);

  if (existing?.id) {
    if (!normalizeString(existing.slug)) {
      profile.slug = slug;
    }

    if (!historical) {
      profile.current_team_id = teamId ?? null;
      profile.is_active = true;
    }

    const { data, error } = await supabase
      .from("drivers")
      .update(profile)
      .eq("id", existing.id)
      .select("id, current_team_id")
      .single();

    if (error) {
      throw error;
    }

    return data ?? existing;
  }

  const { data, error } = await supabase
    .from("drivers")
    .insert({
      ...profile,
      external_id: driver.driverId,
      slug,
      current_team_id: historical ? null : (teamId ?? null),
      is_active: !historical,
    })
    .select("id, current_team_id")
    .single();

  if (error) {
    throw error;
  }

  return data ?? null;
}

export function resolveDriverProfileSlug(existingSlug, fullName) {
  return normalizeString(existingSlug) ?? slugify(fullName);
}

export function makeTeamCode(externalId) {
  const normalized = String(externalId ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");

  if (teamCodesByExternalId[normalized]) {
    return teamCodesByExternalId[normalized];
  }

  const stableKey = normalized.replace(/_/g, "").toUpperCase();

  return stableKey ? `F1_${stableKey}` : "F1_TEAM";
}

function getSeasonResultTeamId(team, driver, historical) {
  return team?.id ?? (historical ? null : driver?.current_team_id ?? null);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getSeasonDriverNumberFromResult(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }

  const driver = rawPayload.Driver && typeof rawPayload.Driver === "object" && !Array.isArray(rawPayload.Driver)
    ? rawPayload.Driver
    : null;

  return numberOrNull(
    driver?.permanentNumber ??
    driver?.permanent_number ??
    rawPayload.driver_number ??
    rawPayload.driverNumber,
  );
}

function getKnownSeasonDriverNumber(season, externalId) {
  if (externalId === "norris" && season >= 2020 && season <= 2025) {
    return 4;
  }

  if (externalId === "max_verstappen") {
    if (season >= 2020 && season <= 2021) {
      return 33;
    }

    if (season >= 2022 && season <= 2025) {
      return 1;
    }
  }

  return null;
}

function roundNumber(value, digits = 0) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function medianNumber(values) {
  const numbers = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);

  if (!numbers.length) {
    return null;
  }

  const middle = Math.floor(numbers.length / 2);
  const value = numbers.length % 2 === 1
    ? numbers[middle]
    : (numbers[middle - 1] + numbers[middle]) / 2;

  return roundNumber(value, 3);
}

function getBestQualifyingTime(result) {
  const times = [result.Q1, result.Q2, result.Q3].filter(Boolean);

  return times.sort(compareLapTimeText)[0] ?? null;
}

function getQualifyingStatus(result) {
  if (result.Q3) return "Q3";
  if (result.Q2) return "Q2";
  if (result.Q1) return "Q1";

  return "Квалификация";
}

function compareLapTimeText(a, b) {
  return parseLapTimeText(a) - parseLapTimeText(b);
}

function parseLapTimeText(value) {
  const parts = String(value).split(":");

  if (parts.length === 2) {
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  return Number(value);
}

function formatLapDuration(value) {
  const duration = Number(value);

  if (!Number.isFinite(duration)) {
    return null;
  }

  const minutes = Math.floor(duration / 60);
  const seconds = duration - minutes * 60;

  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function pickHourlyForecast(hourly, startAt) {
  if (!hourly?.time?.length || !startAt) {
    return null;
  }

  const target = new Date(startAt).getTime();
  let bestIndex = 0;
  let bestDiff = Number.POSITIVE_INFINITY;

  hourly.time.forEach((time, index) => {
    const diff = Math.abs(new Date(time).getTime() - target);

    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
    }
  });

  return {
    forecast_at: new Date(hourly.time[bestIndex]).toISOString(),
    temperature_c: hourly.temperature_2m?.[bestIndex] ?? null,
    wind_speed_kmh: hourly.wind_speed_10m?.[bestIndex] ?? null,
    precipitation_mm: hourly.precipitation?.[bestIndex] ?? null,
    weather_code: hourly.weather_code?.[bestIndex] ?? null,
  };
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function isPastDate(value) {
  if (!value) {
    return false;
  }

  const date = new Date(value);

  return Number.isFinite(date.getTime()) && date.getTime() < Date.now() - 6 * 60 * 60 * 1000;
}

function parseRss(xml) {
  return parseFeedItems(xml);
}

function filterRssItemsForSource(items, source) {
  const publishableItems = items.filter(isNewsFeedItemPublishable);

  if (source.source_type !== "rss-formula-1") {
    return publishableItems;
  }

  return publishableItems.filter((item) =>
    (item.categories ?? []).some((category) => normalizeString(category)?.toLowerCase() === "formula 1"),
  );
}

function parseFeedItems(xml) {
  const rssItems = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => {
    const item = match[0];

    return {
      title: cleanXml(readTag(item, "title")),
      link: cleanXml(readTag(item, "link")),
      guid: cleanXml(readTag(item, "guid")),
      description: cleanXml(readTag(item, "description")),
      content: cleanXml(readTag(item, "content:encoded") || readTag(item, "content")),
      author: cleanXml(readTag(item, "author") || readTag(item, "dc:creator")),
      categories: readTags(item, "category").map(cleanXml).filter(Boolean),
      imageUrl: extractFeedImage(item),
      pubDate: normalizeDate(cleanXml(readTag(item, "pubDate"))),
      reactionCount: parseReactionCount(item),
    };
  });
  const atomItems = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => {
    const item = match[0];

    return {
      title: cleanXml(readTag(item, "title")),
      link: cleanXml(readLinkHref(item)) || cleanXml(readTag(item, "link")),
      guid: cleanXml(readTag(item, "id")),
      id: cleanXml(readTag(item, "id")),
      description: cleanXml(readTag(item, "summary")),
      content: cleanXml(readTag(item, "content")),
      author: cleanXml(readTag(readTag(item, "author"), "name") || readTag(item, "author")),
      categories: readTags(item, "category").map(cleanXml).filter(Boolean),
      imageUrl: extractFeedImage(item),
      pubDate: normalizeDate(cleanXml(readTag(item, "published") || readTag(item, "updated"))),
      reactionCount: parseReactionCount(item),
    };
  });

  return rssItems.length ? rssItems : atomItems;
}

function readTag(xml, tag) {
  return xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "";
}

function readTags(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map(
    (match) => match[1],
  );
}

function readLinkHref(xml) {
  const alternate =
    xml.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i)?.[1] ??
    xml.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["'][^>]*\/?>/i)?.[1];

  return alternate ?? xml.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i)?.[1] ?? "";
}

function extractFeedImage(xml) {
  const decoded = decodeXml(xml);
  const media =
    xml.match(/<media:thumbnail\b[^>]*url=["']([^"']+)["'][^>]*\/?>/i)?.[1] ??
    xml.match(/<media:content\b[^>]*url=["']([^"']+)["'][^>]*\/?>/i)?.[1] ??
    xml.match(/<image\b[^>]*url=["']([^"']+)["'][^>]*\/?>/i)?.[1] ??
    xml.match(/<enclosure\b[^>]*url=["']([^"']+)["'][^>]*(?:type=["']image\/[^"']+["'])[^>]*\/?>/i)?.[1] ??
    extractImageFromHtml(decoded) ??
    extractFeedImageUrl(decoded);

  return media ? normalizeFeedImageUrl(decodeXml(media.trim())) : null;
}

function extractFeedImageUrl(value) {
  const imageUrls = [
    ...String(value ?? "").matchAll(/https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|gif|webp|avif)(?:\?[^\s"'<>]+)?/gi),
    ...String(value ?? "").matchAll(/https?:\/\/pbs\.twimg\.com\/(?:media|ext_tw_video_thumb)\/[^\s"'<>]+/gi),
    ...String(value ?? "").matchAll(/https?:\/\/video\.twimg\.com\/[^\s"'<>]+/gi),
  ].map((match) => match[0]);

  return imageUrls.find(isLikelyFeedImageUrl) ?? null;
}

function isLikelyFeedImageUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const href = url.href.toLowerCase();

    if (
      href.includes("favicon") ||
      href.includes("/cdn-cgi/") ||
      href.includes("challenge-platform") ||
      href.includes("/themes/") ||
      href.includes("/buttons/")
    ) {
      return false;
    }

    return (
      (host === "pbs.twimg.com" &&
        (url.pathname.startsWith("/media/") || url.pathname.startsWith("/ext_tw_video_thumb/"))) ||
      (host === "video.twimg.com" && /\.(jpe?g|png|webp|avif)$/i.test(url.pathname)) ||
      /\.(jpe?g|png|gif|webp|avif)$/i.test(url.pathname) ||
      /(?:wp-content\/uploads|cdn|images?|media)/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function extractFeedImageFromPayload(payload) {
  if (!payload) {
    return null;
  }

  return (
    normalizeString(payload.imageUrl) ??
    extractImageFromHtml(payload.content) ??
    extractImageFromHtml(payload.description) ??
    extractFeedImageUrl(`${payload.content ?? ""} ${payload.description ?? ""}`)
  );
}

function extractImageFromHtml(html, baseUrl) {
  const htmlText = String(html ?? "");
  const candidates = [
    ...[...htmlText.matchAll(/<img\b[^>]*>/gi)].flatMap((match) => {
      const tag = match[0];

      return [
        ...extractImageCandidatesFromSrcset(readAttribute(tag, "srcset")),
        readAttribute(tag, "src"),
        readAttribute(tag, "data-src"),
        readAttribute(tag, "data-lazy-src"),
        readAttribute(tag, "data-original"),
        readAttribute(tag, "data-orig-file"),
      ];
    }),
    ...[...htmlText.matchAll(/<source\b[^>]*>/gi)].flatMap((match) =>
      extractImageCandidatesFromSrcset(readAttribute(match[0], "srcset")),
    ),
    ...extractImageCandidatesFromSrcset(htmlText),
  ]
    .filter(Boolean)
    .map((candidate) => resolveUrl(decodeXml(candidate), baseUrl));

  return candidates.find((candidate) => isLikelyFeedImageUrl(candidate)) ?? null;
}

function readAttribute(tag, attribute) {
  return (
    tag.match(new RegExp(`\\b${attribute}=["']([^"']+)["']`, "i"))?.[1] ??
    tag.match(new RegExp(`\\b${attribute}=([^\\s>]+)`, "i"))?.[1] ??
    null
  );
}

function extractImageCandidatesFromSrcset(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(",")
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function normalizeFeedImageUrl(value) {
  try {
    const url = new URL(value);

    if (
      url.hostname === "pbs.twimg.com" &&
      (url.pathname.startsWith("/media/") || url.pathname.startsWith("/ext_tw_video_thumb/"))
    ) {
      const format = url.searchParams.get("format") ?? url.pathname.match(/\.(jpe?g|png|gif|webp)$/i)?.[1];

      if (format) {
        url.pathname = url.pathname.replace(/\.(jpe?g|png|gif|webp)$/i, "");
        url.searchParams.set("format", format === "jpeg" ? "jpg" : format);
        url.searchParams.set("name", "orig");
      }
    }

    return url.toString();
  } catch {
    return value;
  }
}

function sanitizeDiagnosticText(value) {
  return String(value ?? "")
    .replace(/(auth_token=)[^;&\s"']+/gi, "$1[redacted]")
    .replace(/(ct0=)[^;&\s"']+/gi, "$1[redacted]")
    .replace(/(authorization:\s*bearer\s+)[^;&\s"']+/gi, "$1[redacted]")
    .replace(/(TWITTER_AUTH_TOKEN=)[^;&\s"']+/gi, "$1[redacted]");
}

function parseReactionCount(xml) {
  const value =
    xml.match(/<score[^>]*>([\s\S]*?)<\/score>/i)?.[1] ??
    xml.match(/<ups[^>]*>([\s\S]*?)<\/ups>/i)?.[1] ??
    xml.match(/<reactions[^>]*>([\s\S]*?)<\/reactions>/i)?.[1];

  return numberOrNull(cleanXml(value));
}

function cleanXml(value) {
  return decodeXml(value).replace(/<[^>]+>/g, "").trim();
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeJson(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(String(value).replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim());
  } catch {
    return null;
  }
}

function parseOpenRouterMessageJson(content) {
  if (isPlainObject(content)) {
    return content;
  }

  const text = Array.isArray(content)
    ? content
        .map((part) => typeof part === "string" ? part : part?.text ?? part?.content ?? "")
        .join("")
    : String(content ?? "");
  const direct = safeJson(text);

  if (direct) {
    return direct;
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  return firstBrace >= 0 && lastBrace > firstBrace
    ? safeJson(text.slice(firstBrace, lastBrace + 1))
    : null;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function readJsonResponse(response) {
  const text = await response.text();
  return safeJson(text) ?? { message: text.slice(0, 500) };
}

function getOpenRouterFailureReason(payload) {
  return getSafeErrorMessage(payload?.error?.message ?? payload?.message ?? payload?.error ?? "request failed");
}

function getSafeErrorMessage(error) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null
      ? JSON.stringify(error)
      : String(error ?? "unknown error");
  return message.replace(/https?:\/\/\S+/g, "[url]").slice(0, 240);
}

function logWorkerWarning(event, metadata) {
  console.warn(JSON.stringify({ event, ...metadata }));
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const items = value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);

  return items.length ? items : null;
}

async function getArticleContext(article, drivers = []) {
  const snippets = [
    normalizeString(article.raw_payload?.content),
    normalizeString(article.original_description),
  ].filter(Boolean);
  const sourceUrl = article.original_url ?? article.canonical_url;
  let fetchedArticle = await fetchReadableArticleMetadata(sourceUrl, drivers);

  if (((fetchedArticle.text?.length ?? 0) < 400 || !fetchedArticle.imageUrl) && shouldUseReaderFallback(sourceUrl)) {
    if ((fetchedArticle.text?.length ?? 0) < 400) fetchedArticle.text = null;
    fetchedArticle = await fetchReadableArticleMetadataViaReader(sourceUrl, fetchedArticle);
  }

  // Full-page extraction supersedes RSS: appending the feed body duplicates
  // the same article and can truncate its ending before editorial verification.
  const sourceText = fetchedArticle.text || dedupeTextBlocks(snippets.map(cleanNewsRssText)).join("\n\n");
  const maxLength = Number(process.env.AI_ARTICLE_TEXT_MAX_CHARS ?? 12000);
  return {
    text: truncateNewsSourceText(sourceText, maxLength),
    imageUrl: article.source_image_url ?? article.raw_payload?.imageUrl ?? fetchedArticle.imageUrl ?? null,
    coverage: fetchedArticle.text ? sourceText.length > maxLength ? "article_truncated" : "article" : "rss_only",
  };
}

async function fetchReadableArticleMetadata(url, drivers = []) {
  if (!url) {
    return { text: null, imageUrl: null };
  }

  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "user-agent": "RaceSide/1.0 (+https://raceside.online)",
      },
      signal: AbortSignal.timeout(Number(process.env.AI_ARTICLE_FETCH_TIMEOUT_MS ?? 8000)),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return { text: null, imageUrl: null };
    }

    const html = await response.text();
    return {
      text: extractNewsSourceHtml(html, decodeXml, url, drivers),
      imageUrl: extractMetadataImageFromHtml(html, url),
    };
  } catch (fetchError) {
    logWorkerWarning("news.article_text.unavailable", {
      url: sanitizeDiagnosticText(url),
      reason: getSafeErrorMessage(fetchError),
    });
    return { text: null, imageUrl: null };
  }
}

async function fetchReadableArticleMetadataViaReader(url, fallback = { text: null, imageUrl: null }) {
  if (!url) {
    return fallback;
  }

  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        accept: "text/plain, text/markdown;q=0.9, */*;q=0.8",
        "user-agent": "RaceSide/1.0 (+https://raceside.online)",
      },
      signal: AbortSignal.timeout(Number(process.env.AI_ARTICLE_READER_TIMEOUT_MS ?? 15000)),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const markdown = await response.text();

    return {
      text: fallback.text ?? extractReadableTextFromMarkdown(markdown),
      imageUrl: fallback.imageUrl ?? extractImageFromMarkdown(markdown, url),
    };
  } catch (readerError) {
    logWorkerWarning("news.article_reader.unavailable", {
      url: sanitizeDiagnosticText(url),
      reason: getSafeErrorMessage(readerError),
    });

    return fallback;
  }
}

function shouldUseReaderFallback(url) {
  try {
    return new URL(url).hostname.toLowerCase().includes("racefans.net");
  } catch {
    return false;
  }
}

function extractReadableTextFromMarkdown(markdown) {
  return extractNewsSourceMarkdown(markdown);
}

function extractMetadataImageFromHtml(html, baseUrl) {
  const htmlText = String(html ?? "");
  const metaCandidates = [...htmlText.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) =>
      /(?:property|name)=["'](?:og:image|og:image:secure_url|twitter:image|twitter:image:src|thumbnailUrl)["']/i.test(tag),
    )
    .map((tag) => readAttribute(tag, "content"))
    .filter(Boolean);
  const linkCandidates = [...htmlText.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => /\brel=["'][^"']*(?:image_src|preload)[^"']*["']/i.test(tag))
    .map((tag) => readAttribute(tag, "href"))
    .filter(Boolean);
  const jsonLdCandidates = extractJsonLdImages(htmlText);
  const htmlCandidates = [extractImageFromHtml(htmlText, baseUrl)].filter(Boolean);
  const candidates = [
    ...metaCandidates,
    ...linkCandidates,
    ...jsonLdCandidates,
    ...htmlCandidates,
  ]
    .map((candidate) => resolveUrl(decodeXml(candidate), baseUrl))
    .filter(Boolean);
  const imageUrl = candidates.find((candidate) => isLikelyFeedImageUrl(candidate));

  return imageUrl ? normalizeFeedImageUrl(imageUrl) : null;
}

function extractImageFromMarkdown(markdown, baseUrl) {
  const title = normalizeString(String(markdown ?? "").match(/^Title:\s*(.+)$/im)?.[1]);
  const images = [...String(markdown ?? "").matchAll(/!\[[^\]]*]\(([^)]+)\)/g)]
    .map((match) => resolveUrl(decodeXml(match[1]), baseUrl))
    .filter(isLikelyFeedImageUrl);
  const articleImages = images.filter((imageUrl) => {
    const lower = imageUrl.toLowerCase();

    return (
      !lower.includes("/themes/") &&
      !lower.includes("/buttons/") &&
      !lower.includes("amazon") &&
      !lower.includes("donate") &&
      !lower.includes("goadfree")
    );
  });

  if (!articleImages.length) {
    return null;
  }

  const titleWords = new Set(
    String(title ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4),
  );

  return normalizeFeedImageUrl(
    articleImages.find((imageUrl) =>
      [...titleWords].some((word) => imageUrl.toLowerCase().includes(word)),
    ) ??
      articleImages.find((imageUrl) => /\/wp-content\/uploads\//i.test(imageUrl)) ??
      articleImages[0],
  );
}

function extractJsonLdImages(html) {
  return [...String(html ?? "").matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap((match) => {
      const parsed = safeJson(decodeXml(match[1]));

      return collectJsonImages(parsed);
    })
    .filter(Boolean);
}

function collectJsonImages(value) {
  if (!value) {
    return [];
  }

  if (typeof value === "string") {
    return isLikelyFeedImageUrl(value) ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectJsonImages);
  }

  if (typeof value === "object") {
    const direct = [
      value.url,
      value.contentUrl,
      value.thumbnailUrl,
      value.image,
      value.logo,
    ].flatMap(collectJsonImages);

    return [...direct, ...Object.values(value).flatMap(collectJsonImages)];
  }

  return [];
}

function resolveUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function dedupeTextBlocks(blocks) {
  const seen = new Set();
  const result = [];

  for (const block of blocks) {
    const normalized = block.replace(/\s+/g, " ").trim();
    const key = normalized.toLowerCase().slice(0, 240);

    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function selectArticleHighlights(value, summary, details) {
  const articleText = `${summary ?? ""}\n${details ?? ""}`.toLocaleLowerCase("ru-RU");
  const seen = new Set();

  return (normalizeStringArray(value) ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length >= 4 && item.length <= 140)
    .filter((item) => articleText.includes(item.toLocaleLowerCase("ru-RU")))
    .filter((item) => {
      const key = item.toLocaleLowerCase("ru-RU");

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

function makeDigestFallback(articles) {
  if (!articles.length) {
    return "Пока нет новостей для сводки. Она появится после первых публикаций дня.";
  }

  const selected = buildDigestInput(articles).slice(0, 6).map(event => event.articles[0]);
  return renderVerifiedDigest({ items: selected.map(article => ({ headline: article.title, summary: article.summary || article.title, article_ids: [article.id] })) }, articles) ?? "Сегодня пока нет новых материалов.";
}
