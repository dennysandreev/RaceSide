import type { createSupabaseAdminClient } from "@/lib/supabase/server";
import { adminJobCatalog, getAdminJobDefinition } from "@/lib/admin-job-catalog";
import { adminAiPromptCatalog } from "@/lib/admin-ai-prompts";
import { getAdminTelemetrySignal, isNewsPubliclyAvailable } from "@/lib/admin-policies";
import { adminSearchFilter, adminSearchPattern, adminSearchOperator, adminSearchValue, readAdminPage, readAllAdminRows } from "@/lib/admin-table-query";
import type { Database, Json } from "@/types/supabase";
import type {
  AdminAiPromptVersion,
  AdminAiPromptVersionSummary,
  AdminAiUsageSummaryRow,
  AdminAuditEntry,
  AdminOperationsSnapshot,
  AdminCostTimelineRow,
  AdminFinding,
  AdminFindingEvent,
  AdminJobRun,
  AdminSchedule,
  AdminSystemSignal,
  AdminSystemStatus,
  AdminTableQuery,
  AdminUserErrorReport,
} from "@/types/admin";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export { parseAdminTableQuery } from "@/lib/admin-table-query";

export async function loadAdminOverview(admin: AdminClient) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString();
  const [
    jobsResult,
    newsSourcesResult,
    socialSourcesResult,
    schedulesResult,
    duplicateResult,
    socialReviewResult,
    notificationFailedResult,
    notificationQueuedResult,
    aiResult,
    findingsResult,
    urgentFindingsResult,
    heartbeatsResult,
    monitoringResult,
  ] = await Promise.all([
    admin
      .from("job_runs")
      .select("id, job_name, status, started_at, finished_at, error_message, items_processed, queue_version, requested_by, available_at, claimed_at, worker_id, attempt_count, max_attempts, retry_of, request_key, metadata")
      .order("started_at", { ascending: false })
    .order("id", { ascending: false })
      .limit(120),
    admin.from("news_sources").select("id, name, last_fetched_at, last_success_at, last_error, fetch_interval_minutes, is_active"),
    admin.from("social_sources").select("id, name, last_fetched_at, last_success_at, last_error, fetch_interval_minutes, is_active"),
    admin.from("admin_job_schedules").select("id, schedule_key, job_name, schedule_kind, interval_minutes, daily_time_utc, args, max_attempts, is_enabled, next_run_at, last_enqueued_at, last_job_run_id, updated_at").order("next_run_at"),
    admin.from("news_articles").select("id", { count: "exact", head: true }).eq("publication_status", "duplicate"),
    admin.from("social_posts").select("id", { count: "exact", head: true }).eq("status", "review"),
    admin.from("notification_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
    admin.from("notification_queue").select("id", { count: "exact", head: true }).in("status", ["pending", "sending"]),
    admin.rpc("get_admin_ai_usage_summary", { p_since: thirtyDaysAgo }),
    admin
      .from("admin_findings")
      .select("id", { count: "exact", head: true })
      .in("status", ["open", "acknowledged", "action_pending", "fixing", "monitoring"]),
    admin
      .from("admin_findings")
      .select("id", { count: "exact", head: true })
      .in("status", ["open", "acknowledged", "action_pending", "fixing", "monitoring"])
      .in("severity", ["P0", "P1"]),
    admin.from("ops_service_heartbeats").select("service_name, status, checked_at").order("checked_at", { ascending: false }).limit(50),
    admin.rpc("get_admin_operations_snapshot", {}),
  ]);
  throwFirstError([
    jobsResult.error,
    newsSourcesResult.error,
    socialSourcesResult.error,
    schedulesResult.error,
    duplicateResult.error,
    socialReviewResult.error,
    notificationFailedResult.error,
    notificationQueuedResult.error,
    aiResult.error,
    findingsResult.error,
    urgentFindingsResult.error,
    heartbeatsResult.error,
    monitoringResult.error,
  ]);

  const jobs = (jobsResult.data ?? []).map(mapAdminJobRun);
  const monitoring = monitoringResult.data as AdminOperationsSnapshot;
  const scheduleRuns = new Map(monitoring.scheduleJobs.map(row => [row.scheduleKey, row]));
  const scheduleSignals = (schedulesResult.data ?? []).map((schedule) =>
    makeScheduleStatus(schedule, scheduleRuns.get(schedule.schedule_key)),
  );
  const sourceSignals = [
    ...(newsSourcesResult.data ?? []).map((source) => makeSourceStatus(source, "news")),
    ...(socialSourcesResult.data ?? []).map((source) => makeSourceStatus(source, "social")),
  ];
  const aiTotal = (aiResult.data ?? []).find((row) => row.dimension === "total");
  const aiCost = Number(aiTotal?.cost_usd ?? 0);
  const latestLiveHeartbeat = (heartbeatsResult.data ?? []).find((heartbeat) => heartbeat.service_name === "live") ?? null;
  const productSignals = [
    makeServiceStatus({
      checkedAt: latestLiveHeartbeat?.checked_at ?? null,
      description: "Поток данных и история LIVE-сессий.",
      detail: latestLiveHeartbeat ? `Последняя проверка ${formatRelativeTime(latestLiveHeartbeat.checked_at)}` : "Сервис ещё не передавал состояние",
      href: "/admin/systems#service-live",
      id: "live",
      label: "LIVE-центр",
      status: latestLiveHeartbeat?.status ?? "unknown",
    }),
    makeTelemetryStatus(monitoring.telemetry),
  ];

  const attentionSignals = [...productSignals, ...sourceSignals, ...scheduleSignals]
    .filter((signal) => signal.status !== "healthy" && signal.status !== "paused")
    .sort((left, right) => signalWeight(right.status) - signalWeight(left.status));

  return {
    signals: attentionSignals.slice(0, 8),
    attentionSignalsCount: attentionSignals.length,
    urgentSignalsCount: attentionSignals.filter(signal => signal.status === "failed" || signal.status === "stale").length,
    jobs: jobs.slice(0, 12),
    pausedSignals: [...sourceSignals, ...scheduleSignals].filter(signal => signal.status === "paused"),
    metrics: {
      duplicateNews: duplicateResult.count ?? 0,
      socialReview: socialReviewResult.count ?? 0,
      notificationFailed: notificationFailedResult.count ?? 0,
      notificationQueued: notificationQueuedResult.count ?? 0,
      failedJobs: monitoring.failedJobs24h,
      queuedJobs: monitoring.queuedJobs + monitoring.runningJobs,
      aiCost,
      aiRuns: Number(aiTotal?.request_count ?? 0),
      activeFindings: findingsResult.count ?? 0,
      urgentFindings: urgentFindingsResult.count ?? 0,
    },
  };
}

export async function loadAdminFindings(admin: AdminClient, query: AdminTableQuery) {
  let findingsRequest = admin
    .from("admin_findings")
    .select("id, fingerprint, category, severity, status, title, description, evidence, route, entity_type, entity_id, job_run_id, release_sha, owner_kind, owner_user_id, github_issue_url, github_pr_url, resolution, first_seen_at, last_seen_at, occurrence_count, last_alerted_at, alert_count, resolved_at, created_at, updated_at", { count: "exact" })
    .order("last_seen_at", { ascending: false })
    .order("id", { ascending: false });

  if (query.search) {
    findingsRequest = findingsRequest.or(
      adminSearchFilter(["title", "description"], query.search),
    );
  }
  if (
    query.status &&
    query.status !== "all" &&
    ["open", "acknowledged", "action_pending", "fixing", "monitoring", "resolved", "ignored"].includes(query.status)
  ) {
    findingsRequest = findingsRequest.eq("status", query.status as AdminFinding["status"]);
  }

  const activeStatuses: AdminFinding["status"][] = ["open", "acknowledged", "action_pending", "fixing", "monitoring"];
  const [findingsResult, activeCountResult, urgentCountResult, settingsResult, runsResult, heartbeatsResult] = await Promise.all([
    readAdminPage(findingsRequest, query),
    admin.from("admin_findings").select("id", { count: "exact", head: true }).in("status", activeStatuses),
    admin.from("admin_findings").select("id", { count: "exact", head: true }).in("status", activeStatuses).in("severity", ["P0", "P1"]),
    admin
      .from("admin_agent_settings")
      .select("is_enabled, mode, telegram_alerts_enabled, r2_actions_enabled, shadow_started_at, updated_at")
      .eq("singleton", true)
      .single(),
    admin
      .from("admin_agent_runs")
      .select("id, status, counters, started_at, finished_at, duration_ms, error_code")
      .eq("run_kind", "watcher")
      .order("started_at", { ascending: false })
    .order("id", { ascending: false })
      .limit(12),
    admin
      .from("ops_service_heartbeats")
      .select("service_name, status, summary, checked_at")
      .order("checked_at", { ascending: false })
      .limit(30),
  ]);
  throwFirstError([
    findingsResult.error,
    activeCountResult.error,
    urgentCountResult.error,
    settingsResult.error,
    runsResult.error,
    heartbeatsResult.error,
  ]);
  if (!settingsResult.data) throw new Error("Настройки наблюдения недоступны");

  const findingIds = (findingsResult.data ?? []).map((finding) => finding.id);
  const eventsResult = findingIds.length
    ? await admin
      .from("admin_finding_events")
      .select("id, finding_id, event_type, actor_kind, actor_user_id, payload, created_at")
      .in("finding_id", findingIds)
      .order("created_at", { ascending: false })
    .order("id", { ascending: false })
      .limit(500)
    : { data: [], error: null };
  throwFirstError([eventsResult.error]);

  const eventsByFinding = new Map<string, AdminFindingEvent[]>();
  for (const event of eventsResult.data ?? []) {
    const mapped: AdminFindingEvent = {
      id: event.id,
      findingId: event.finding_id,
      eventType: event.event_type,
      actorKind: event.actor_kind,
      actorUserId: event.actor_user_id,
      payload: event.payload,
      createdAt: event.created_at,
    };
    eventsByFinding.set(event.finding_id, [
      ...(eventsByFinding.get(event.finding_id) ?? []),
      mapped,
    ]);
  }

  const settings = settingsResult.data;
  return {
    items: (findingsResult.data ?? []).map((row) => ({
      finding: {
        id: row.id,
        fingerprint: row.fingerprint,
        category: row.category,
        severity: row.severity,
        status: row.status,
        title: row.title,
        description: row.description,
        evidence: row.evidence,
        route: row.route,
        entityType: row.entity_type,
        entityId: row.entity_id,
        jobRunId: row.job_run_id,
        releaseSha: row.release_sha,
        ownerKind: row.owner_kind,
        ownerUserId: row.owner_user_id,
        githubIssueUrl: row.github_issue_url,
        githubPrUrl: row.github_pr_url,
        resolution: row.resolution,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        occurrenceCount: row.occurrence_count,
        lastAlertedAt: row.last_alerted_at,
        alertCount: row.alert_count,
        resolvedAt: row.resolved_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      } satisfies AdminFinding,
      events: eventsByFinding.get(row.id) ?? [],
    })),
    total: findingsResult.count ?? 0,
    metrics: {
      active: activeCountResult.count ?? 0,
      urgent: urgentCountResult.count ?? 0,
    },
    query,
    settings: {
      isEnabled: settings.is_enabled,
      mode: settings.mode,
      telegramAlertsEnabled: settings.telegram_alerts_enabled,
      r2ActionsEnabled: settings.r2_actions_enabled,
      shadowStartedAt: settings.shadow_started_at,
      updatedAt: settings.updated_at,
    },
    runs: runsResult.data ?? [],
    heartbeats: heartbeatsResult.data ?? [],
  };
}

export async function loadAdminNews(admin: AdminClient, query: AdminTableQuery) {
  let request = admin
    .from("news_articles")
    .select("id, slug, status, ai_model, source_id, canonical_url, original_title, ai_title_ru, ai_summary_ru, ai_summary_long_ru, publication_status, dedup_status, duplicate_of, published_at, source_published_at, ingested_at, ai_processed_at, raw_payload, updated_at", { count: "exact" })
    .order("ingested_at", { ascending: false })
    .order("id", { ascending: false });

  if (query.search) {
    request = request.or(adminSearchFilter(["original_title", "ai_title_ru"], query.search));
  }
  if (query.status === "review") {
    request = request.eq("publication_status", "draft").eq("raw_payload->>aiFailureReason", "editorial_review_required");
  } else if (query.status === "removed") {
    request = request.eq("publication_status", "draft").not("published_at", "is", null);
  } else if (query.status && query.status !== "all") {
    request = request.eq("publication_status", query.status);
  }

  let digestsRequest = admin.from("digests").select("id, date_key, title, body_md, status, ai_model, generated_at", { count: "exact" }).order("generated_at", { ascending: false })
    .order("id", { ascending: false });
  if (query.params?.tab === "digests") {
    if (query.search) digestsRequest = digestsRequest.filter("title", adminSearchOperator(query.search), adminSearchValue(query.search));
    if (["draft", "published", "hidden"].includes(query.status ?? "")) digestsRequest = digestsRequest.eq("status", query.status!);
  }

  const [articlesResult, sourcesResult, digestsResult] = await Promise.all([
    readAdminPage(request, !query.params?.tab || query.params.tab === "materials" ? query : { ...query, page: 1 }),
    admin.from("news_sources").select("id, name, url, is_active, fetch_interval_minutes, last_fetched_at, last_success_at, last_error").order("name"),
    readAdminPage(digestsRequest, query.params?.tab === "digests" ? query : { ...query, page: 1 }),
  ]);
  throwFirstError([articlesResult.error, sourcesResult.error, digestsResult.error]);
  const sourceNames = new Map((sourcesResult.data ?? []).map((source) => [source.id, source.name]));
  const articleIds = (articlesResult.data ?? []).map((article) => article.id);
  const { data: reviews } = articleIds.length
    ? await admin.from("news_editorial_reviews").select("article_id,decision,issues,created_at").in("article_id", articleIds).order("created_at", { ascending: false })
    .order("id", { ascending: false }).limit(1000)
    : { data: [] };
  const latestReviews = new Map<string, { decision: string; issues: string[] }>();
  for (const review of reviews ?? []) {
    if (!latestReviews.has(review.article_id)) latestReviews.set(review.article_id, { decision: review.decision, issues: Array.isArray(review.issues) ? review.issues.filter((issue): issue is string => typeof issue === "string") : [] });
  }
  const { data: metadataRows } = articleIds.length
    ? await admin.from("news_articles").select("id,editorial_meta").in("id", articleIds)
    : { data: [] };
  const articleMetadata = new Map((metadataRows ?? []).map(row => [row.id, row.editorial_meta]));
  const relationsResult = articleIds.length
    ? await admin.from("news_article_tags").select("article_id, tag_id").in("article_id", articleIds)
    : { data: [], error: null };
  throwFirstError([relationsResult.error]);
  const tagIds = [...new Set((relationsResult.data ?? []).map((relation) => relation.tag_id))];
  const tagsResult = tagIds.length
    ? await admin.from("tags").select("id, type, name").in("id", tagIds)
    : { data: [], error: null };
  throwFirstError([tagsResult.error]);
  const managedTags = new Map(
    (tagsResult.data ?? [])
      .filter((tag) => tag.type === "admin_topic")
      .map((tag) => [tag.id, tag.name]),
  );
  const tagNamesByArticle = new Map<string, string[]>();
  for (const relation of relationsResult.data ?? []) {
    const name = managedTags.get(relation.tag_id);
    if (name) tagNamesByArticle.set(relation.article_id, [...(tagNamesByArticle.get(relation.article_id) ?? []), name]);
  }

  return {
    items: (articlesResult.data ?? []).map((article) => ({
      ...article,
      publicAvailable: isNewsPubliclyAvailable(article),
      aiFailureLabel: getNewsAiFailureLabel(article.raw_payload),
      editorialReview: (articleMetadata.get(article.id) as import("@/lib/news-editorial").NewsEditorialMeta | undefined)?.status === "manually_reviewed" ? undefined : latestReviews.get(article.id),
      editorialMeta: articleMetadata.get(article.id) as import("@/lib/news-editorial").NewsEditorialMeta | undefined,
      sourceName: article.source_id ? sourceNames.get(article.source_id) ?? "Источник уточняется" : "Источник уточняется",
      tagNames: tagNamesByArticle.get(article.id) ?? [],
    })),
    total: articlesResult.count ?? 0,
    sources: sourcesResult.data ?? [],
    digests: digestsResult.data ?? [],
    digestsTotal: digestsResult.count ?? 0,
    query,
  };
}

function getNewsAiFailureLabel(rawPayload: Json | null) {
  if (!rawPayload || Array.isArray(rawPayload) || typeof rawPayload !== "object") return null;

  const reason = typeof rawPayload.aiFailureReason === "string"
    ? rawPayload.aiFailureReason
    : null;

  if (reason === "ai_processing_failed") return null;

  const labels: Record<string, string> = {
    missing_api_key: "На сервере не настроен OpenRouter",
    openrouter_insufficient_credits: "Недостаточно средств в OpenRouter",
    openrouter_invalid_key: "OpenRouter отклонил API-ключ",
    openrouter_key_limit_exceeded: "Исчерпан лимит API-ключа OpenRouter",
    openrouter_permission_denied: "OpenRouter запретил запрос",
    openrouter_rate_limited: "OpenRouter временно ограничил запросы",
    editorial_review_required: "Проверь текст перед публикацией",
    editorial_service_unavailable: "Проверка новости временно недоступна",
    source_text_unavailable: "Не удалось получить текст оригинала. Попробуем позже",
    publication_busy: "Ждёт завершения обработки другой новости",
  };

  return reason ? labels[reason] ?? "AI не смог обработать материал" : null;
}

export async function loadAdminSocial(admin: AdminClient, query: AdminTableQuery) {
  let postsRequest = admin
    .from("social_posts")
    .select("id, platform, source_id, author, title, body, ai_title_ru, ai_summary_ru, original_url, image_url, published_at, status, content_kind, importance_score, processing_attempts, next_retry_at, last_processing_error, created_at, updated_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (query.search) {
    postsRequest = postsRequest.or(adminSearchFilter(["title", "body", "ai_title_ru"], query.search));
  }
  if (query.status && query.status !== "all") {
    postsRequest = postsRequest.eq("status", query.status);
  }

  const [postsResult, sourcesResult] = await Promise.all([
    readAdminPage(postsRequest, query),
    admin.from("social_sources").select("id, platform, name, url, adapter, feed_kind, is_active, publication_mode, fetch_interval_minutes, last_success_at, last_error, rate_limited_until").order("platform").order("name"),
  ]);
  throwFirstError([postsResult.error, sourcesResult.error]);
  const postIds = (postsResult.data ?? []).map((post) => post.id);
  const mediaResult = postIds.length
    ? await admin
      .from("social_post_media")
      .select("id, post_id, media_type, url, preview_url, alt_text, width, height, sort_order")
      .in("post_id", postIds)
      .order("sort_order")
    : { data: [], error: null };
  throwFirstError([mediaResult.error]);
  const mediaByPost = new Map<string, typeof mediaResult.data>();

  for (const media of mediaResult.data ?? []) {
    mediaByPost.set(media.post_id, [...(mediaByPost.get(media.post_id) ?? []), media]);
  }

  return {
    items: (postsResult.data ?? []).map((post) => ({
      ...post,
      media: mediaByPost.get(post.id) ?? [],
    })),
    sources: sourcesResult.data ?? [],
    total: postsResult.count ?? 0,
    query,
  };
}

export async function loadAdminReports(admin: AdminClient, query: AdminTableQuery) {
  let reportsRequest = admin
    .from("grand_prix_reports")
    .select("id, season, round, race_slug, race_name, circuit_name, race_date, status, is_hidden, source_updated_at, generated_at, summary_status, ai_summary, source_errors, last_error, refresh_stage, next_refresh_at, updated_at", { count: "exact" })
    .order("season", { ascending: false })
    .order("round", { ascending: false })
    .order("id", { ascending: false });

  if (query.search) {
    reportsRequest = reportsRequest.or(adminSearchFilter(["race_name", "circuit_name"], query.search));
  }
  if (query.status && query.status !== "all") {
    reportsRequest = reportsRequest.eq("status", query.status);
  }

  let digestsRequest = admin.from("digests").select("id, digest_type, date_key, title, body_md, ai_model, generated_at, status", { count: "exact" }).order("generated_at", { ascending: false })
    .order("id", { ascending: false });
  if (query.params?.tab === "digests") {
    if (query.search) digestsRequest = digestsRequest.filter("title", adminSearchOperator(query.search), adminSearchValue(query.search));
    if (["draft", "published", "hidden"].includes(query.status ?? "")) digestsRequest = digestsRequest.eq("status", query.status!);
  }

  const [reportsResult, digestsResult] = await Promise.all([
    readAdminPage(reportsRequest, !query.params?.tab || query.params.tab === "reports" ? query : { ...query, page: 1 }),
    readAdminPage(digestsRequest, query.params?.tab === "digests" ? query : { ...query, page: 1 }),
  ]);
  throwFirstError([reportsResult.error, digestsResult.error]);

  return {
    items: reportsResult.data ?? [],
    total: reportsResult.count ?? 0,
    digests: digestsResult.data ?? [],
    digestsTotal: digestsResult.count ?? 0,
    query,
  };
}

export async function loadAdminSport(admin: AdminClient, query: AdminTableQuery) {
  const currentSeason = new Date().getUTCFullYear();
  const requestedSeason = Number(query.params?.season);
  const selectedSeason = Number.isInteger(requestedSeason) && requestedSeason >= 1950 && requestedSeason <= currentSeason + 1 ? requestedSeason : currentSeason;
  const [
    seasonsResult,
    racesResult,
    sessionsResult,
    resultsResult,
    driverStandingsResult,
    constructorStandingsResult,
    teamsResult,
    driversResult,
    trackAssetsResult,
    replaysResult,
    currentDriversResult,
    currentTeamsResult,
    seasonCountsResult,
  ] = await Promise.all([
    admin.from("seasons").select("year, is_published, published_at").order("year", { ascending: false }),
    readAllAdminRows(admin.from("races").select("id, season_year, round, race_name, status, race_start_at, updated_at").gte("season_year", 2020).order("season_year", { ascending: false }).order("round", { ascending: false }).order("id", { ascending: false })),
    admin.from("sessions").select("id", { count: "exact", head: true }),
    admin.from("session_results").select("id", { count: "exact", head: true }),
    admin.from("driver_standings").select("id", { count: "exact", head: true }),
    admin.from("constructor_standings").select("id", { count: "exact", head: true }),
    readAllAdminRows(admin.from("team_season_profiles").select("id, season_year, display_name, code, logo_image_url, car_image_url, source_urls, assets_verified_at").gte("season_year", 2020).order("season_year", { ascending: false }).order("id", { ascending: false })),
    readAllAdminRows(admin.from("driver_season_profiles").select("id, season_year, code, permanent_number, avatar_image_url, avatar_review_status, source_urls, assets_verified_at").gte("season_year", 2020).order("season_year", { ascending: false }).order("id", { ascending: false })),
    readAllAdminRows(admin.from("race_track_assets").select("id, race_id, layout_slug, image_url, source_url, source_manifest, checksum_sha256, is_verified, verified_at").order("updated_at", { ascending: false }).order("id", { ascending: false })),
    readAdminPage(admin.from("race_replay_sessions").select("id, title, status, source_season, source_session_key, source_race_name, prepared_at, updated_at", { count: "exact" }).order("updated_at", { ascending: false }).eq("source_season", selectedSeason).order("id", { ascending: false }), query.params?.tab === "replay" ? query : { ...query, page: 1 }),
    admin.from("drivers").select("id, slug, code, permanent_number, full_name, country, country_code, current_team_id, ai_avatar_url, avatar_placeholder_style, is_active").eq("is_active", true).order("full_name"),
    admin.from("teams").select("id, name, short_name, code").eq("is_active", true).order("name"),
    admin.rpc("get_admin_sport_season_counts", { p_season: selectedSeason }),
  ]);
  throwFirstError([
    seasonsResult.error,
    racesResult.error,
    sessionsResult.error,
    resultsResult.error,
    driverStandingsResult.error,
    constructorStandingsResult.error,
    teamsResult.error,
    driversResult.error,
    trackAssetsResult.error,
    replaysResult.error,
    currentDriversResult.error,
    currentTeamsResult.error,
    seasonCountsResult.error,
  ]);

  const seasons = seasonsResult.data ?? [];
  const archiveYears = seasons.filter((season) => season.year >= 2020 && season.year <= 2025);
  const archiveRaceIds = new Set(
    (racesResult.data ?? [])
      .filter((race) => race.season_year >= 2020 && race.season_year <= 2025)
      .map((race) => race.id),
  );
  const archiveAssetsByRace = new Map(
    (trackAssetsResult.data ?? [])
      .filter((asset) => archiveRaceIds.has(asset.race_id))
      .map((asset) => [asset.race_id, asset]),
  );
  const archiveReady =
    archiveYears.length === 6 &&
    (teamsResult.data ?? [])
      .filter((profile) => profile.season_year <= 2025)
      .every((profile) => profile.assets_verified_at && profile.logo_image_url && profile.car_image_url) &&
    archiveRaceIds.size > 0 &&
    [...archiveRaceIds].every((raceId) => {
      const asset = archiveAssetsByRace.get(raceId);
      return Boolean(asset?.is_verified && asset.checksum_sha256);
    });

  return {
    currentSeason,
    selectedSeason,
    query,
    seasons,
    races: racesResult.data ?? [],
    sessions: sessionsResult.data ?? [],
    counts: seasonCountsResult.data as { sessions: number; results: number; driverStandings: number; constructorStandings: number },
    globalCounts: {
      sessions: sessionsResult.count ?? sessionsResult.data?.length ?? 0,
      results: resultsResult.count ?? 0,
      driverStandings: driverStandingsResult.count ?? 0,
      constructorStandings: constructorStandingsResult.count ?? 0,
    },
    archiveReady,
    archivePublished: archiveYears.length === 6 && archiveYears.every((season) => season.is_published),
    teamAssets: teamsResult.data ?? [],
    driverAssets: driversResult.data ?? [],
    trackAssets: trackAssetsResult.data ?? [],
    replays: replaysResult.data ?? [],
    replaysTotal: replaysResult.count ?? 0,
    currentDrivers: currentDriversResult.data ?? [],
    currentTeams: currentTeamsResult.data ?? [],
  };
}

export async function loadAdminCommunity(admin: AdminClient, query: AdminTableQuery) {
  const tab = ["polls", "leagues", "predictions"].includes(query.params?.tab ?? "") ? query.params!.tab : "polls";
  let polls = admin.from("polls").select("id, race_id, question, status, closes_at, poll_kind, generated_by_ai, created_at, updated_at", { count: "exact" }).order("created_at", { ascending: false }).order("id", { ascending: false });
  let leagues = admin.from("prediction_leagues").select("id, name, invite_code, is_public, created_at, updated_at", { count: "exact" }).order("updated_at", { ascending: false }).order("id", { ascending: false });
  let predictions = admin.from("predictions").select("id, submitted_at, locked_at, score, scored_at", { count: "exact" }).order("submitted_at", { ascending: false }).order("id", { ascending: false });
  if (tab === "polls") {
    if (query.search) polls = polls.filter("question", adminSearchOperator(query.search), adminSearchValue(query.search));
    if (["draft", "published", "closed"].includes(query.status ?? "")) polls = polls.eq("status", query.status!);
  }
  if (tab === "leagues") {
    if (query.search) leagues = leagues.filter("name", adminSearchOperator(query.search), adminSearchValue(query.search));
    if (["private", "public"].includes(query.status ?? "")) leagues = leagues.eq("is_public", query.status === "public");
  }
  if (tab === "predictions") {
    if (query.status === "pending") predictions = predictions.is("score", null);
    if (query.status === "scored") predictions = predictions.not("score", "is", null);
  }
  const [pollsResult, leaguesResult, predictionsResult, pendingResult, pollCountResult, leagueCountResult, predictionCountResult] = await Promise.all([
    readAdminPage(polls, tab === "polls" ? query : { ...query, page: 1 }),
    readAdminPage(leagues, tab === "leagues" ? query : { ...query, page: 1 }),
    readAdminPage(predictions, tab === "predictions" ? query : { ...query, page: 1 }),
    admin.from("predictions").select("id", { count: "exact", head: true }).is("score", null),
    admin.from("polls").select("id", { count: "exact", head: true }),
    admin.from("prediction_leagues").select("id", { count: "exact", head: true }),
    admin.from("predictions").select("id", { count: "exact", head: true }),
  ]);
  throwFirstError([pollsResult.error, leaguesResult.error, predictionsResult.error, pendingResult.error, pollCountResult.error, leagueCountResult.error, predictionCountResult.error]);
  const pollIds = (pollsResult.data ?? []).map(poll => poll.id);
  const [optionsResult, votesResult] = await Promise.all([
    pollIds.length ? admin.from("poll_options").select("id, poll_id, label, sort_order").in("poll_id", pollIds).order("sort_order") : { data: [], error: null },
    pollIds.length ? admin.rpc("get_admin_poll_vote_counts", { p_poll_ids: pollIds }) : { data: [], error: null },
  ]);
  throwFirstError([optionsResult.error, votesResult.error]);
  const votesByPoll = new Map((votesResult.data ?? []).map(row => [row.poll_id, Number(row.vote_count)]));
  const optionsByPoll = groupBy(optionsResult.data ?? [], option => option.poll_id);
  return {
    polls: (pollsResult.data ?? []).map(poll => ({ ...poll, options: optionsByPoll.get(poll.id) ?? [], votesCount: votesByPoll.get(poll.id) ?? 0 })),
    pollsCount: pollCountResult.count ?? 0, pollsTotal: pollsResult.count ?? 0,
    leagues: leaguesResult.data ?? [], leaguesCount: leagueCountResult.count ?? 0, leaguesTotal: leaguesResult.count ?? 0,
    predictions: predictionsResult.data ?? [], predictionsCount: predictionCountResult.count ?? 0, predictionsTotal: predictionsResult.count ?? 0,
    pendingPredictionsCount: pendingResult.count ?? 0, query,
  };
}

export async function loadAdminUsers(admin: AdminClient, query: AdminTableQuery) {
  let request = admin
    .from("profiles")
    .select("id, email, display_name, language, timezone, onboarding_completed, is_bot, created_at, updated_at", { count: "exact" })
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false });

  if (query.search) {
    request = request.or(adminSearchFilter(["email", "display_name"], query.search));
  }

  const profilesResult = await readAdminPage(request, query);
  throwFirstError([profilesResult.error]);
  const userIds = (profilesResult.data ?? []).map((profile) => profile.id);
  const empty = { data: [], error: null };
  const [engagementResult, telegramResult, subscriptionsResult, lavaResult] = await Promise.all([
    userIds.length ? admin.rpc("get_admin_user_engagement_counts", { p_user_ids: userIds }) : empty,
    userIds.length
      ? admin.from("telegram_accounts").select("user_id, username, is_active, connected_at, disconnected_at, last_delivery_at, last_error, updated_at").in("user_id", userIds)
      : empty,
    userIds.length
      ? admin.from("subscriptions").select("user_id, status, current_period_start, current_period_end").in("user_id", userIds)
      : empty,
    userIds.length ? admin.from("billing_orders").select("id, user_id, status, lava_auto_renew, lava_cancelled_at, created_at").eq("provider", "lava").is("lava_parent_contract_id", null).in("status", ["paid", "partially_refunded", "refunded"]).in("user_id", userIds).order("lava_auto_renew", { ascending: false }).order("created_at", { ascending: false })
    .order("id", { ascending: false }) : empty,
  ]);
  throwFirstError([engagementResult.error, telegramResult.error, subscriptionsResult.error, lavaResult.error]);
  const engagement = new Map((engagementResult.data ?? []).map(row => [row.user_id, row]));
  const telegram = new Map((telegramResult.data ?? []).map((row) => [row.user_id, row]));
  const subscriptions = new Map((subscriptionsResult.data ?? []).map((row) => [row.user_id, row]));
  const lavaContracts = new Map<string, NonNullable<typeof lavaResult.data>[number]>();
  for (const row of lavaResult.data ?? []) if (!lavaContracts.has(row.user_id)) lavaContracts.set(row.user_id, row);

  return {
    items: (profilesResult.data ?? []).map((profile) => ({
      ...profile,
      favoriteTeams: Number(engagement.get(profile.id)?.favorite_teams ?? 0),
      favoriteDrivers: Number(engagement.get(profile.id)?.favorite_drivers ?? 0),
      predictions: Number(engagement.get(profile.id)?.predictions ?? 0),
      leagues: Number(engagement.get(profile.id)?.leagues ?? 0),
      telegram: telegram.get(profile.id) ?? null,
      subscription: subscriptions.get(profile.id) ?? null,
      lavaContract: lavaContracts.get(profile.id) ?? null,
    })),
    total: profilesResult.count ?? 0,
    query,
  };
}

export async function loadAdminNotifications(admin: AdminClient, query: AdminTableQuery) {
  let queueRequest = admin
    .from("notification_queue")
    .select("id, user_id, event_type, entity_type, entity_id, available_at, status, attempts, last_error, created_at, sent_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (query.search) {
    queueRequest = queueRequest.filter("event_type", adminSearchOperator(query.search), adminSearchValue(query.search));
  }
  if (query.status && query.status !== "all") {
    queueRequest = queueRequest.eq("status", query.status);
  }

  const [queueResult, logsResult, accountsResult] = await Promise.all([
    readAdminPage(queueRequest, query),
    admin.from("notification_logs").select("id, queue_id, user_id, channel, event_type, status, error_message, created_at").order("created_at", { ascending: false })
    .order("id", { ascending: false }).limit(100),
    admin.from("telegram_accounts").select("user_id, username, is_active, connected_at, disconnected_at, last_delivery_at, last_error, updated_at").order("updated_at", { ascending: false }).limit(100),
  ]);
  throwFirstError([queueResult.error, logsResult.error, accountsResult.error]);

  return {
    queue: queueResult.data ?? [],
    total: queueResult.count ?? 0,
    logs: logsResult.data ?? [],
    accounts: accountsResult.data ?? [],
    query,
  };
}

export async function loadAdminJobs(admin: AdminClient, query: AdminTableQuery) {
  let request = admin
    .from("job_runs")
    .select("id, job_name, status, started_at, finished_at, items_processed, error_message, metadata, queue_version, requested_by, available_at, claimed_at, worker_id, attempt_count, max_attempts, retry_of, request_key", { count: "exact" })
    .order("started_at", { ascending: query.sort === "oldest" })
    .order("id", { ascending: query.sort === "oldest" });

  if (query.search) {
    request = request.filter("job_name", adminSearchOperator(query.search), adminSearchValue(query.search));
  }
  if (query.status && query.status !== "all") {
    request = request.eq("status", query.status);
  }
  if (query.from) request = request.gte("started_at", `${query.from}T00:00:00Z`);
  if (query.to) request = request.lt("started_at", new Date(Date.parse(query.to) + 86_400_000).toISOString());
  const result = await readAdminPage(request, query);
  throwFirstError([result.error]);

  const availability = await loadAdminJobAvailability(admin);
  return {
    catalog: adminJobCatalog.map(job => ({ ...job, availability: availability.get(job.name) })),
    items: (result.data ?? []).map(mapAdminJobRun),
    total: result.count ?? 0,
    query,
  };
}

async function loadAdminJobAvailability(admin: AdminClient) {
  const { data: workerHeartbeats, error: heartbeatError } = await admin.from("ops_service_heartbeats").select("summary, checked_at").eq("service_name", "admin-job-runner").order("checked_at", { ascending: false }).limit(1);
  throwFirstError([heartbeatError]);
  const heartbeat = workerHeartbeats?.[0];
  const summary = heartbeat?.summary && typeof heartbeat.summary === "object" && !Array.isArray(heartbeat.summary) ? heartbeat.summary : {};
  const adapters = summary.legacy_adapters && typeof summary.legacy_adapters === "object" && !Array.isArray(summary.legacy_adapters) ? summary.legacy_adapters : {};
  const fresh = heartbeat && Date.now() - Date.parse(heartbeat.checked_at) < 5 * 60_000;
  return new Map(["billing.reconcile_tribute", "billing.reconcile_yoomoney"].map(name => {
    const adapter = name === "billing.reconcile_tribute" ? "tribute" : "yoomoney";
    const available = fresh && typeof adapters[adapter] === "boolean" ? adapters[adapter] as boolean : null;
    return [name, { available, detail: available === null ? "Воркер ещё не подтвердил настройки этой интеграции." : available ? "Воркер подтвердил настройки для сверки прошлых оплат." : "В воркере не настроена сверка этого платёжного сервиса." }] as const;
  }));
}

export async function loadAdminSchedules(admin: AdminClient) {
  const [schedulesResult, monitoringResult, availability] = await Promise.all([
    admin
      .from("admin_job_schedules")
      .select("id, schedule_key, job_name, schedule_kind, interval_minutes, daily_time_utc, args, max_attempts, is_enabled, next_run_at, last_enqueued_at, last_job_run_id, updated_at")
      .order("next_run_at"),
    admin.rpc("get_admin_operations_snapshot", {}),
    loadAdminJobAvailability(admin),
  ]);
  throwFirstError([schedulesResult.error, monitoringResult.error]);
  const monitoring = monitoringResult.data as AdminOperationsSnapshot;
  const scheduleRuns = new Map(monitoring.scheduleJobs.map(row => [row.scheduleKey, row]));
  const schedules = (schedulesResult.data ?? []).map((row) =>
    ({ ...mapAdminSchedule(row, scheduleRuns.get(row.schedule_key)?.job ? mapAdminJobRun(scheduleRuns.get(row.schedule_key)!.job!) : null), availability: availability.get(row.job_name) }),
  );

  return {
    schedules,
    metrics: {
      enabled: schedules.filter((schedule) => schedule.isEnabled).length,
      paused: schedules.filter((schedule) => !schedule.isEnabled).length,
      failed: schedules.filter((schedule) => schedule.isEnabled && schedule.lastRun?.status === "failed").length,
      due: schedules.filter(
        (schedule) => schedule.isEnabled && Date.parse(schedule.nextRunAt) <= Date.now(),
      ).length,
    },
  };
}

export async function loadAdminSystems(admin: AdminClient) {
  const [newsSourcesResult, socialSourcesResult, schedulesResult, heartbeatsResult, monitoringResult] =
    await Promise.all([
      admin
        .from("news_sources")
        .select("id, name, last_fetched_at, last_success_at, last_error, fetch_interval_minutes, is_active"),
      admin
        .from("social_sources")
        .select("id, name, last_fetched_at, last_success_at, last_error, fetch_interval_minutes, is_active"),
      admin
        .from("admin_job_schedules")
        .select("id, schedule_key, job_name, schedule_kind, interval_minutes, daily_time_utc, args, max_attempts, is_enabled, next_run_at, last_enqueued_at, last_job_run_id, updated_at")
        .order("next_run_at"),
      admin.from("ops_service_heartbeats").select("service_name, status, checked_at").order("checked_at", { ascending: false }).limit(50),
      admin.rpc("get_admin_operations_snapshot", {}),
    ]);
  throwFirstError([
    newsSourcesResult.error,
    socialSourcesResult.error,
    schedulesResult.error,
    heartbeatsResult.error,
    monitoringResult.error,
  ]);
  const monitoring = monitoringResult.data as AdminOperationsSnapshot;
  const scheduleRuns = new Map(monitoring.scheduleJobs.map(row => [row.scheduleKey, row]));
  const latestLiveHeartbeat = (heartbeatsResult.data ?? []).find((heartbeat) => heartbeat.service_name === "live") ?? null;
  const items: AdminSystemStatus[] = [
    makeServiceStatus({
      checkedAt: latestLiveHeartbeat?.checked_at ?? null,
      description: "Поток данных, запись истории и подключения зрителей во время сессии.",
      detail: latestLiveHeartbeat ? `Последняя проверка ${formatRelativeTime(latestLiveHeartbeat.checked_at)}` : "Сервис ещё не передавал состояние",
      href: "/live",
      id: "live",
      label: "LIVE-центр",
      status: latestLiveHeartbeat?.status ?? "unknown",
    }),
    makeTelemetryStatus(monitoring.telemetry),
    ...(newsSourcesResult.data ?? []).map((source) => makeSourceStatus(source, "news")),
    ...(socialSourcesResult.data ?? []).map((source) => makeSourceStatus(source, "social")),
    ...(schedulesResult.data ?? []).map((schedule) =>
      makeScheduleStatus(schedule, scheduleRuns.get(schedule.schedule_key)),
    ),
  ].sort((left, right) => {
    const weight = signalWeight(right.status) - signalWeight(left.status);
    return weight || left.group.localeCompare(right.group, "ru") || left.label.localeCompare(right.label, "ru");
  });

  return {
    items,
    metrics: {
      healthy: items.filter((item) => item.status === "healthy").length,
      attention: items.filter((item) => item.status === "stale" || item.status === "warning" || item.status === "unknown").length,
      failed: items.filter((item) => item.status === "failed").length,
      paused: items.filter((item) => !item.isEnabled).length,
    },
  };
}

function makeServiceStatus(input: {
  checkedAt: string | null;
  description: string;
  detail: string;
  href: string;
  id: string;
  label: string;
  status: "degraded" | "healthy" | "unhealthy" | "unknown";
}): AdminSystemStatus {
  const stale = input.checkedAt ? Date.now() - Date.parse(input.checkedAt) > 5 * 60_000 : true;
  return {
    id: `service:${input.id}`,
    label: input.label,
    kind: "service",
    group: "Продуктовые сервисы",
    description: input.description,
    status: input.status === "unknown" ? "unknown" : input.status === "unhealthy" ? "failed" : input.status === "degraded" ? "warning" : stale ? "stale" : "healthy",
    detail: input.detail,
    checkedAt: input.checkedAt,
    lastSuccessAt: input.status === "healthy" ? input.checkedAt : null,
    nextCheckAt: input.checkedAt ? new Date(Date.parse(input.checkedAt) + 60_000).toISOString() : null,
    isEnabled: true,
    href: input.href,
  };
}

function makeTelemetryStatus(snapshot: AdminOperationsSnapshot["telemetry"]): AdminSystemStatus {
  const failed = snapshot.failed24h;
  return {
    id: "service:telemetry", label: "Телеметрия", kind: "service", group: "Продуктовые сервисы",
    description: "Ошибки за 24 часа и вся текущая очередь подготовки сравнений.",
    status: getAdminTelemetrySignal(snapshot),
    detail: failed ? `Ошибок за 24 часа: ${snapshot.failed24h}; запросов с ошибкой в очереди: ${snapshot.queuedErrors}`
      : snapshot.staleQueued ? `Ожидают более 30 минут: ${snapshot.staleQueued}`
      : snapshot.queuedErrors ? `Прежних запросов с ошибкой в очереди: ${snapshot.queuedErrors}. Нужна сверка истории; новых ошибок за 24 часа нет.`
      : snapshot.queued ? `В обработке и очереди: ${snapshot.queued}`
      : snapshot.ready24h ? `Готово за 24 часа: ${snapshot.ready24h}${snapshot.lastReadyAt ? `. Последний готовый запрос ${formatRelativeTime(snapshot.lastReadyAt)}` : ""}` : "Новых готовых запросов за 24 часа нет. Наличие кэша не подтверждает работу обработчика.",
    checkedAt: snapshot.lastRequestAt, lastSuccessAt: snapshot.lastReadyAt, nextCheckAt: null, isEnabled: true,
    href: "/admin/jobs?search=telemetry.prepare",
  };
}

export async function loadAdminAi(admin: AdminClient, query: AdminTableQuery) {
  const selectedPrompt = adminAiPromptCatalog.find(item => item.key === query.params?.promptKey) ?? adminAiPromptCatalog[0];
  query.params = { ...query.params, promptKey: selectedPrompt.key };
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString();
  const [
    summaryResult,
    usageResult,
    articlesResult,
    postsResult,
    budgetsResult,
    publishedPromptsResult,
    draftPromptsResult,
    promptHistoryResult,
    selectedHistoryResult,
    budgetUsageResult,
    xBudgetResult,
    xBudgetUsageResult,
    costTimelineResult,
  ] = await Promise.all([
    admin.rpc("get_admin_ai_usage_summary", { p_since: thirtyDaysAgo }),
    admin.from("ai_usage_logs").select("id, purpose, provider, model, input_tokens, output_tokens, estimated_cost_usd, related_article_id, related_digest_id, prompt_key, prompt_version_id, created_at").gte("created_at", thirtyDaysAgo).order("created_at", { ascending: false })
    .order("id", { ascending: false }).limit(100),
    admin.from("news_articles").select("id, slug, original_title, ai_title_ru, publication_status, image_status, ai_model, ai_processed_at, updated_at").or("ai_model.eq.fallback,publication_status.eq.failed,raw_payload->>aiFailureReason.eq.editorial_review_required,raw_payload->>aiFailureReason.eq.editorial_service_unavailable").order("updated_at", { ascending: false }).limit(100),
    admin.from("social_posts").select("id, platform, title, ai_title_ru, status, last_processing_error, processing_attempts, updated_at").not("last_processing_error", "is", null).order("updated_at", { ascending: false }).limit(100),
    admin.from("admin_ai_budgets").select("scope, daily_limit_usd, monthly_limit_usd, updated_at").eq("scope", "default"),
    admin.from("ai_prompt_versions").select("id, prompt_key, version, status, system_prompt, user_template, model, max_tokens, change_note, checksum, created_at, published_at").eq("status", "published"),
    admin.rpc("get_admin_ai_latest_drafts", {}),
    admin.rpc("get_admin_ai_prompt_history_overview", {}),
    admin.rpc("get_admin_ai_prompt_history", { p_prompt_key: selectedPrompt.key, p_page: query.page, p_page_size: query.pageSize }),
    admin.rpc("get_ai_budget_guard", { p_purpose: "admin" }),
    admin.from("admin_external_api_costs").select("provider, resource_type, unit_cost_usd, daily_limit_usd, monthly_limit_usd, updated_at").eq("provider", "x").maybeSingle(),
    admin.rpc("get_x_api_budget_guard"),
    admin.rpc("get_admin_cost_timeline", { p_since: thirtyDaysAgo }),
  ]);
  throwFirstError([
    summaryResult.error,
    usageResult.error,
    articlesResult.error,
    postsResult.error,
    budgetsResult.error,
    publishedPromptsResult.error,
    draftPromptsResult.error,
    promptHistoryResult.error,
    selectedHistoryResult.error,
    budgetUsageResult.error,
    xBudgetResult.error,
    xBudgetUsageResult.error,
    costTimelineResult.error,
  ]);
  const summaryRows = (summaryResult.data ?? []).map(normalizeAdminAiUsageSummary);
  const total = summaryRows.find((row) => row.dimension === "total");
  const publishedPrompts = new Map(
    (publishedPromptsResult.data ?? [])
      .map(mapAdminAiPromptVersion)
      .map((version) => [version.promptKey, version]),
  );
  const latestDrafts = new Map<string, AdminAiPromptVersion>();
  for (const row of draftPromptsResult.data ?? []) {
    const version = mapAdminAiPromptVersion(row);
    if (!latestDrafts.has(version.promptKey)) {
      latestDrafts.set(version.promptKey, version);
    }
  }
  const promptHistory = (promptHistoryResult.data ?? []).map(mapAdminAiPromptVersionSummary);
  const xBudgetUsage = (xBudgetUsageResult.data ?? [])[0];
  const historyPage = selectedHistoryResult.data as { total: number; page: number; items: Parameters<typeof mapAdminAiPromptVersionSummary>[0][] };
  if (query.params?.tab === "history") query.page = historyPage.page;

  return {
    selectedPrompt,
    history: historyPage.items.map(mapAdminAiPromptVersionSummary),
    historyTotal: historyPage.total,
    query,
    budgetUsage: budgetUsageResult.data?.find(item => item.scope === "default"),
    totalCost: total?.cost_usd ?? 0,
    totalRuns: total?.request_count ?? 0,
    totalInputTokens: total?.input_tokens ?? 0,
    totalOutputTokens: total?.output_tokens ?? 0,
    unpricedRuns: total?.unpriced_count ?? 0,
    byDay: summaryRows.filter((row) => row.dimension === "day").sort((left, right) => right.bucket.localeCompare(left.bucket)),
    byModel: summaryRows.filter((row) => row.dimension === "model").sort((left, right) => right.cost_usd - left.cost_usd),
    byPurpose: summaryRows.filter((row) => row.dimension === "purpose").sort((left, right) => right.cost_usd - left.cost_usd),
    recent: usageResult.data ?? [],
    prompts: adminAiPromptCatalog.map((definition) => ({
      definition,
      published: publishedPrompts.get(definition.key) ?? null,
      latestDraft: latestDrafts.get(definition.key) ?? null,
      history: promptHistory.filter((version) => version.promptKey === definition.key),
    })),
    problemArticles: articlesResult.data ?? [],
    problemPosts: postsResult.data ?? [],
    budget: budgetsResult.data?.find((budget) => budget.scope === "default") ?? {
      scope: "default" as const,
      daily_limit_usd: 5,
      monthly_limit_usd: 100,
      updated_at: null,
    },
    xApiBudget: xBudgetResult.data ?? {
      provider: "x" as const,
      resource_type: "post_read" as const,
      unit_cost_usd: 0.005,
      daily_limit_usd: 5,
      monthly_limit_usd: 50,
      updated_at: null,
    },
    xApiSpendToday: Number(xBudgetUsage?.daily_spend_usd ?? 0),
    xApiSpend30Days: Number(xBudgetUsage?.monthly_spend_usd ?? 0),
    xApiPostsToday: Number(xBudgetUsage?.daily_post_count ?? 0),
    xApiPosts30Days: Number(xBudgetUsage?.monthly_post_count ?? 0),
    costTimeline: (costTimelineResult.data ?? []).map((row) => ({
      day: row.day,
      ai_cost_usd: Number(row.ai_cost_usd ?? 0),
      x_api_cost_usd: Number(row.x_api_cost_usd ?? 0),
      x_post_count: Number(row.x_post_count ?? 0),
    } satisfies AdminCostTimelineRow)),
  };
}

export async function loadAdminUserErrorReports(
  admin: AdminClient,
  query: AdminTableQuery,
) {
  let reportsRequest = admin
    .from("user_error_reports")
    .select("id, report_kind, contact, article_id, article_slug, article_title, source_name, message, status, page_path, referrer_path, user_agent, release_sha, request_fingerprint, technical_context, telegram_status, telegram_error, admin_note, reporter_user_id, created_at, resolved_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (query.search) {
    reportsRequest = reportsRequest.or(adminSearchFilter(["message", "page_path"], query.search));
  }
  if (query.status && query.status !== "all") {
    reportsRequest = reportsRequest.eq("status", query.status as "new" | "in_progress" | "resolved" | "dismissed");
  }

  const [reportsResult, countsResult] = await Promise.all([
    readAdminPage(reportsRequest, query),
    admin.from("user_error_reports").select("status"),
  ]);
  throwFirstError([reportsResult.error, countsResult.error]);

  return {
    items: (reportsResult.data ?? []).map((report) => ({
        id: report.id,
        kind: report.report_kind,
        contact: report.contact,
        articleId: report.article_id ?? "",
        articleSlug: report.article_slug,
        articleTitle: report.article_title,
        sourceName: report.source_name,
        message: report.message,
        status: report.status,
        pagePath: report.page_path,
        referrerPath: report.referrer_path,
        userAgent: report.user_agent,
        releaseSha: report.release_sha,
        requestFingerprint: report.request_fingerprint,
        isAuthenticated: Boolean(report.reporter_user_id),
        technicalContext: report.technical_context,
        telegramDeliveryStatus: report.telegram_status,
        telegramDeliveryError: report.telegram_error,
        adminNote: report.admin_note,
        createdAt: report.created_at,
        resolvedAt: report.resolved_at,
      } satisfies AdminUserErrorReport)),
    total: reportsResult.count ?? 0,
    metrics: {
      new: (countsResult.data ?? []).filter((report) => report.status === "new").length,
      inProgress: (countsResult.data ?? []).filter((report) => report.status === "in_progress").length,
      resolved: (countsResult.data ?? []).filter((report) => report.status === "resolved").length,
    },
    query,
  };
}

function mapAdminAiPromptVersion(row: {
  id: string;
  prompt_key: string;
  version: number;
  status: string;
  system_prompt: string;
  user_template: string;
  model: string | null;
  max_tokens: number | null;
  change_note: string | null;
  checksum: string;
  created_at: string;
  published_at: string | null;
}): AdminAiPromptVersion {
  return {
    id: row.id,
    promptKey: row.prompt_key,
    version: row.version,
    status: normalizePromptStatus(row.status),
    systemPrompt: row.system_prompt,
    userTemplate: row.user_template,
    model: row.model,
    maxTokens: row.max_tokens,
    changeNote: row.change_note,
    checksum: row.checksum,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

function mapAdminAiPromptVersionSummary(row: {
  id: string;
  prompt_key: string;
  version: number;
  status: string;
  model: string | null;
  max_tokens: number | null;
  change_note: string | null;
  checksum: string;
  created_at: string;
  published_at: string | null;
}): AdminAiPromptVersionSummary {
  return {
    id: row.id,
    promptKey: row.prompt_key,
    version: row.version,
    status: normalizePromptStatus(row.status),
    model: row.model,
    maxTokens: row.max_tokens,
    changeNote: row.change_note,
    checksum: row.checksum,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

function normalizePromptStatus(status: string): AdminAiPromptVersion["status"] {
  return status === "published" || status === "archived" ? status : "draft";
}

function normalizeAdminAiUsageSummary(row: AdminAiUsageSummaryRow): AdminAiUsageSummaryRow {
  return {
    dimension: row.dimension,
    bucket: row.bucket,
    request_count: Number(row.request_count ?? 0),
    input_tokens: Number(row.input_tokens ?? 0),
    output_tokens: Number(row.output_tokens ?? 0),
    cost_usd: Number(row.cost_usd ?? 0),
    unpriced_count: Number(row.unpriced_count ?? 0),
  };
}

export async function loadAdminAudit(admin: AdminClient, query: AdminTableQuery) {
  let request = admin
    .from("admin_audit_log")
    .select("id, actor_user_id, action, entity_type, entity_id, outcome, before_data, after_data, metadata, created_at, finished_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (query.search) {
    request = request.or(adminSearchFilter(["action", "entity_type", "entity_id"], query.search));
  }
  if (query.status && query.status !== "all") {
    const outcome = ["started", "succeeded", "failed"].includes(query.status)
      ? query.status as AdminAuditEntry["outcome"]
      : null;
    if (outcome) request = request.eq("outcome", outcome);
  }
  const result = await readAdminPage(request, query);
  throwFirstError([result.error]);

  return {
    items: (result.data ?? []).map<AdminAuditEntry>((entry) => ({
      id: entry.id,
      actorUserId: entry.actor_user_id,
      action: entry.action,
      entityType: entry.entity_type,
      entityId: entry.entity_id,
      outcome: entry.outcome,
      beforeData: entry.before_data,
      afterData: entry.after_data,
      metadata: entry.metadata,
      createdAt: entry.created_at,
      finishedAt: entry.finished_at,
    })),
    total: result.count ?? 0,
    query,
  };
}

function mapAdminJobRun(job: {
  id: string;
  job_name: string;
  status: string;
  requested_by: string | null;
  available_at: string | null;
  claimed_at: string | null;
  started_at: string;
  finished_at: string | null;
  items_processed: number;
  attempt_count: number;
  max_attempts: number;
  retry_of: string | null;
  request_key: string | null;
  queue_version: number | null;
  worker_id: string | null;
  metadata: AdminJobRun["metadata"];
  error_message: string | null;
}): AdminJobRun {
  return {
    id: job.id,
    jobName: job.job_name,
    status: job.status,
    requestedBy: job.requested_by,
    availableAt: job.available_at,
    claimedAt: job.claimed_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    itemsProcessed: job.items_processed,
    attemptCount: job.attempt_count,
    maxAttempts: job.max_attempts,
    retryOf: job.retry_of,
    requestKey: job.request_key,
    queueVersion: job.queue_version,
    workerId: job.worker_id,
    metadata: job.metadata,
    errorMessage: job.error_message,
  };
}

function makeSourceStatus(
  source: {
    id: string;
    name: string;
    last_fetched_at: string | null;
    last_success_at: string | null;
    last_error: string | null;
    fetch_interval_minutes: number;
    is_active: boolean;
  },
  kind: "news" | "social",
): AdminSystemStatus {
  const ageMinutes = source.last_success_at
    ? (Date.now() - Date.parse(source.last_success_at)) / 60_000
    : Number.POSITIVE_INFINITY;
  const stale = source.is_active && ageMinutes > source.fetch_interval_minutes * 2;

  return {
    id: `source:${source.id}`,
    label: source.name,
    kind: "source",
    group: kind === "news" ? "RSS и новости" : "Социальные источники",
    description: kind === "news"
      ? "Загрузка материалов из RSS-ленты."
      : "Загрузка публикаций из подключённого источника.",
    status: !source.is_active ? "paused" : source.last_error ? "failed" : stale ? "stale" : source.last_success_at ? "healthy" : "unknown",
    detail: !source.is_active ? "Источник на паузе" : source.last_error
      ? source.last_error.slice(0, 180)
      : source.is_active
        ? source.last_success_at
          ? `Последний успех ${formatRelativeTime(source.last_success_at)}`
          : "Успешных загрузок пока нет"
        : "Источник на паузе",
    checkedAt: source.last_fetched_at ?? source.last_success_at,
    lastSuccessAt: source.last_success_at,
    nextCheckAt: source.is_active && (source.last_fetched_at ?? source.last_success_at)
      ? new Date(
        Date.parse(source.last_fetched_at ?? source.last_success_at!) +
          source.fetch_interval_minutes * 60_000,
      ).toISOString()
      : null,
    isEnabled: source.is_active,
    href: `/admin/${kind === "news" ? "news" : "social"}?tab=sources#source-${source.id}`,
  };
}

function makeScheduleStatus(
  schedule: {
    id: string;
    schedule_key: string;
    job_name: string;
    schedule_kind: "interval" | "daily" | "adaptive";
    interval_minutes: number | null;
    daily_time_utc: string | null;
    is_enabled: boolean;
    next_run_at: string;
  },
  run: AdminOperationsSnapshot["scheduleJobs"][number] | undefined,
): AdminSystemStatus {
  const latest = run?.job ? mapAdminJobRun(run.job) : null;
  const definition = getAdminJobDefinition(schedule.job_name);
  const checkedAt = latest?.finishedAt ?? latest?.startedAt ?? null;
  const expectedMinutes = schedule.schedule_kind === "interval"
    ? schedule.interval_minutes ?? 30
    : 1_440;
  const stale = schedule.is_enabled && (
    Date.now() > Date.parse(schedule.next_run_at) + Math.max(5, expectedMinutes) * 60_000
    || (checkedAt !== null && Date.now() - Date.parse(checkedAt) > expectedMinutes * 2 * 60_000)
  );
  const failed = latest?.status === "failed";

  return {
    id: `schedule:${schedule.schedule_key}`,
    label: definition?.title ?? "Фоновая проверка",
    kind: "schedule",
    group: getSystemGroup(schedule.job_name),
    description: definition?.description ?? "Плановая фоновая проверка RaceSide.",
    status: !schedule.is_enabled
      ? "paused"
      : failed
        ? "failed"
        : stale
          ? "stale"
          : latest
            ? "healthy"
            : "unknown",
    detail: !schedule.is_enabled
      ? schedule.job_name === "notifications.dispatch"
        ? "Отдельная отправка на паузе. Задача сбора уведомлений также запускает доставку в Telegram."
        : "Плановая проверка на паузе"
      : failed
        ? latest.errorMessage ?? "Последняя проверка завершилась с ошибкой"
        : latest
          ? `Последняя проверка ${formatRelativeTime(checkedAt ?? latest.startedAt)}`
          : "Проверка ещё не запускалась",
    checkedAt,
    lastSuccessAt: run?.lastSuccessAt ?? null,
    nextCheckAt: schedule.is_enabled ? schedule.next_run_at : null,
    isEnabled: schedule.is_enabled,
    href: `/admin/schedules#schedule-${schedule.schedule_key}`,
  };
}

function getSystemGroup(jobName: string) {
  if (["billing.reconcile_tribute", "billing.reconcile_yoomoney", "billing.retry_failed_events"].includes(jobName)) return "Поддержка прошлых оплат";
  if (jobName.startsWith("openf1.")) return "OpenF1";
  if (jobName.startsWith("jolpica.")) return "Jolpica";
  if (jobName.startsWith("weather.")) return "Погода";
  if (jobName.startsWith("social.")) return "Социальные источники";
  if (jobName.startsWith("rss.") || jobName.startsWith("news.")) return "RSS и новости";
  if (jobName.startsWith("ai.")) return "OpenRouter";
  if (jobName.startsWith("notifications.")) return "Telegram";
  return "Внутренние процессы";
}

function mapAdminSchedule(
  row: {
    id: string;
    schedule_key: string;
    job_name: string;
    schedule_kind: "interval" | "daily" | "adaptive";
    interval_minutes: number | null;
    daily_time_utc: string | null;
    args: AdminSchedule["args"];
    max_attempts: number;
    is_enabled: boolean;
    next_run_at: string;
    last_enqueued_at: string | null;
    last_job_run_id: string | null;
    updated_at: string;
  },
  lastRun: AdminJobRun | null,
): AdminSchedule {
  return {
    id: row.id,
    scheduleKey: row.schedule_key,
    jobName: row.job_name,
    scheduleKind: row.schedule_kind,
    intervalMinutes: row.interval_minutes,
    dailyTimeUtc: row.daily_time_utc,
    args: row.args,
    maxAttempts: row.max_attempts,
    isEnabled: row.is_enabled,
    nextRunAt: row.next_run_at,
    lastEnqueuedAt: row.last_enqueued_at,
    lastJobRunId: row.last_job_run_id,
    lastRun,
    updatedAt: row.updated_at,
  };
}

function formatRelativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));

  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} ч назад`;
  return `${Math.floor(minutes / 1_440)} дн назад`;
}

function signalWeight(status: AdminSystemSignal["status"]) {
  return { failed: 5, stale: 4, warning: 3, unknown: 2, healthy: 1, paused: 0 }[status];
}

function throwFirstError(errors: Array<{ message: string } | null | undefined>) {
  const error = errors.find(Boolean);
  if (error) throw new Error(error.message);
}

function groupBy<T>(items: T[], getKey: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

export function getAdminJobTitle(jobName: string) {
  return getAdminJobDefinition(jobName)?.title ?? jobName;
}

export async function loadAdminBilling(admin: AdminClient, query: AdminTableQuery) {
  const since = query.from ? `${query.from}T00:00:00Z` : null;
  const until = query.to ? new Date(Date.parse(`${query.to}T00:00:00Z`) + 86_400_000).toISOString() : null;
  const provider = ["lava", "tribute", "yoomoney"].includes(query.params?.provider ?? "") ? query.params!.provider as "lava" | "tribute" | "yoomoney" : null;
  const currency = ["RUB", "USD"].includes(query.params?.currency ?? "") ? query.params!.currency : null;
  const eventTab = query.params?.tab === "events";
  const orderStatus = ["pending", "paid", "failed", "refunded", "partially_refunded", "cancelled"].includes(query.status ?? "") && !eventTab ? query.status : null;
  let eventsRequest = admin.from("billing_notification_events").select("id, provider, provider_event_type, provider_reference, signature_valid, status, attempts, last_error, received_at", { count: "exact" }).order("received_at", { ascending: false })
    .order("id", { ascending: false }).order("id", { ascending: false });
  if (provider) eventsRequest = eventsRequest.eq("provider", provider);
  if (since) eventsRequest = eventsRequest.gte("received_at", since);
  if (until) eventsRequest = eventsRequest.lt("received_at", until);
  if (eventTab && query.search) eventsRequest = eventsRequest.or(adminSearchFilter(["provider_event_type", "provider_reference"], query.search));
  if (eventTab && ["received", "processed", "rejected", "failed"].includes(query.status ?? "")) eventsRequest = eventsRequest.eq("status", query.status as "received" | "processed" | "rejected" | "failed");
  const eventQuery = { ...query };
  const [pageResult, subscriptionsResult, rejectedResult, eventsResult, disputesResult] = await Promise.all([
    admin.rpc("get_admin_billing_page", { p_search_pattern: adminSearchPattern(eventTab ? "" : query.search), p_status: orderStatus, p_provider: provider, p_currency: currency, p_since: since, p_until: until, p_page: query.page, p_page_size: query.pageSize }),
    admin.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active").gt("current_period_end", new Date().toISOString()),
    admin.from("billing_notification_events").select("id", { count: "exact", head: true }).in("status", ["rejected", "failed"]).gte("received_at", new Date(Date.now() - 86_400_000).toISOString()),
    readAdminPage(eventsRequest, eventQuery),
    admin.from("billing_orders").select("id", { count: "exact", head: true }).eq("payment_dispute_status", "initiated"),
  ]);
  throwFirstError([pageResult.error, subscriptionsResult.error, rejectedResult.error, eventsResult.error, disputesResult.error]);
  type Order = Database["public"]["Tables"]["billing_orders"]["Row"];
  const page = pageResult.data as { orders: Order[]; total: number; page: number; failures: Array<{ reason: string; count: number }> };
  query.page = eventTab ? eventQuery.page : page.page;
  const orderIds = page.orders.map(order => order.id), userIds = [...new Set(page.orders.map(order => order.user_id))];
  const [profilesResult, transactionsResult, periodsResult] = await Promise.all([
    userIds.length ? admin.from("profiles").select("id, display_name, email").in("id", userIds) : { data: [], error: null },
    orderIds.length ? admin.from("payment_transactions").select("order_id, provider_transaction_id, gross_amount_minor, net_amount_minor, provider_fee_minor, currency, occurred_at").in("order_id", orderIds) : { data: [], error: null },
    orderIds.length ? admin.from("subscription_periods").select("order_id, starts_at, ends_at, status").in("order_id", orderIds) : { data: [], error: null },
  ]);
  throwFirstError([profilesResult.error, transactionsResult.error, periodsResult.error]);
  return { orders: page.orders, ordersTotal: page.total, failures: page.failures,
    profileById: new Map((profilesResult.data ?? []).map(profile => [profile.id, profile])),
    transactionByOrder: new Map((transactionsResult.data ?? []).map(transaction => [transaction.order_id, transaction])),
    periodByOrder: new Map((periodsResult.data ?? []).filter(period => period.order_id).map(period => [period.order_id, period])),
    subscriptionsCount: subscriptionsResult.count ?? 0, eventFailures24h: rejectedResult.count ?? 0,
    events: eventsResult.data ?? [], eventsTotal: eventsResult.count ?? 0, disputesCount: disputesResult.count ?? 0, query };
}
