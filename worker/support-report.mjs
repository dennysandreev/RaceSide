import {
  escapeSupportTelegramHtml,
  sendSupportTelegramMessage,
} from "./support-telegram.mjs";

const activeFindingStatuses = ["open", "acknowledged", "action_pending", "fixing", "monitoring"];

export async function runDailySupportReport(client, options = {}) {
  const now = options.now ?? new Date();
  const window = getPreviousMoscowDayWindow(now);
  const snapshot = await loadDailySupportSnapshot(client, window, options);
  const text = buildDailySupportReport(snapshot, { now, window });
  const siteUrl = (options.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://raceside.online")
    .replace(/\/$/, "");
  const delivery = await sendSupportTelegramMessage({
    text,
    replyMarkup: {
      inline_keyboard: [[{ text: "Открыть состояние сайта", url: `${siteUrl}/admin/systems` }]],
    },
  }, { ...options, client });

  if (!delivery.ok) {
    throw new Error(`Support report delivery failed: ${delivery.reason}`);
  }

  return {
    itemsProcessed: 1,
    metadata: {
      currentStatus: snapshot.currentStatus,
      reportDate: window.dateKey,
    },
  };
}

export function getPreviousMoscowDayWindow(now = new Date()) {
  const moscowOffsetMs = 3 * 60 * 60 * 1_000;
  const localNow = new Date(now.getTime() + moscowOffsetMs);
  const todayStartUtcMs = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate(),
  ) - moscowOffsetMs;
  const start = new Date(todayStartUtcMs - 24 * 60 * 60 * 1_000);
  const end = new Date(todayStartUtcMs);
  const reportDay = new Date(start.getTime() + moscowOffsetMs);

  return {
    dateKey: reportDay.toISOString().slice(0, 10),
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

export function buildDailySupportReport(snapshot, { now, window }) {
  const healthy = snapshot.currentStatus === "healthy";
  const lines = [
    `${healthy ? "✅" : "⚠️"} <b>RaceSide: техническая сводка</b>`,
    `<b>За ${formatRussianDate(window.dateKey)}</b>`,
    "",
    `<b>Сейчас:</b> ${healthy ? "все основные проверки проходят" : "есть компоненты, которые требуют внимания"}`,
  ];

  if (snapshot.currentProblems.length) {
    lines.push(...snapshot.currentProblems.slice(0, 10).map((problem) => `• ${escapeSupportTelegramHtml(problem)}`));
  }

  lines.push(
    "",
    "<b>Фоновые задачи</b>",
    `• Успешно: ${snapshot.jobs.succeeded}`,
    `• С ошибкой: ${snapshot.jobs.failed}`,
    `• Сейчас в очереди: ${snapshot.jobs.queued}, выполняется: ${snapshot.jobs.running}`,
    "",
    "<b>Контент и доставка</b>",
    `• Опубликовано новостей: ${snapshot.content.newsPublished}`,
    `• Опубликовано постов: ${snapshot.content.socialPublished}`,
    `• Дневных сводок: ${snapshot.content.digestsPublished}`,
    `• Telegram отправлено: ${snapshot.notifications.sent}, ошибок: ${snapshot.notifications.failed}`,
    "",
    "<b>Расходы</b>",
    `• AI API: $${snapshot.costs.ai.toFixed(4)} (${snapshot.costs.aiRequests} обращений, ${formatInteger(snapshot.costs.aiTokens)} токенов)`,
    `• X API: $${snapshot.costs.x.toFixed(4)} (${snapshot.costs.xPosts} постов)`,
    "",
    "<b>Обращения и контроль</b>",
    `• Новых сообщений об ошибках: ${snapshot.reports.newCount}`,
    `• Закрыто сообщений: ${snapshot.reports.resolvedCount}`,
    `• Активных находок: ${snapshot.findings.active}, срочных: ${snapshot.findings.urgent}`,
    "",
    `Проверено ${formatMoscowDateTime(now)}.`,
  );

  return lines.join("\n").slice(0, 4_096);
}

async function loadDailySupportSnapshot(client, window, options) {
  const [
    jobs,
    queuedJobs,
    runningJobs,
    news,
    social,
    digests,
    notifications,
    aiUsage,
    xUsage,
    reports,
    resolvedReports,
    findings,
    heartbeats,
    newsSources,
    socialSources,
    publicHealth,
  ] = await Promise.all([
    client.from("job_runs").select("status").gte("started_at", window.start).lt("started_at", window.end),
    client.from("job_runs").select("id", { count: "exact", head: true }).eq("status", "queued"),
    client.from("job_runs").select("id", { count: "exact", head: true }).eq("status", "running"),
    client.from("news_articles").select("id", { count: "exact", head: true }).eq("publication_status", "published").gte("published_at", window.start).lt("published_at", window.end),
    client.from("social_posts").select("id", { count: "exact", head: true }).eq("status", "published").gte("published_at", window.start).lt("published_at", window.end),
    client.from("digests").select("id", { count: "exact", head: true }).eq("digest_type", "daily_news").eq("status", "published").gte("generated_at", window.start).lt("generated_at", window.end),
    client.from("notification_queue").select("status").gte("created_at", window.start).lt("created_at", window.end),
    client.from("ai_usage_logs").select("input_tokens, output_tokens, estimated_cost_usd").gte("created_at", window.start).lt("created_at", window.end),
    client.from("external_api_usage_events").select("estimated_cost_usd").eq("provider", "x").eq("billing_date", window.dateKey),
    client.from("user_error_reports").select("id", { count: "exact", head: true }).eq("report_kind", "news_error").gte("created_at", window.start).lt("created_at", window.end),
    client.from("user_error_reports").select("id", { count: "exact", head: true }).eq("report_kind", "news_error").gte("resolved_at", window.start).lt("resolved_at", window.end),
    client.from("admin_findings").select("severity, status").in("status", activeFindingStatuses),
    client.from("ops_service_heartbeats").select("service_name, status, checked_at").order("checked_at", { ascending: false }).limit(50),
    client.from("news_sources").select("name, is_active, fetch_interval_minutes, last_success_at, last_error").eq("is_active", true),
    client.from("social_sources").select("name, is_active, fetch_interval_minutes, last_success_at, last_error").eq("is_active", true),
    checkPublicHealth(options.healthUrl),
  ]);

  for (const result of [jobs, queuedJobs, runningJobs, news, social, digests, notifications, aiUsage, xUsage, reports, resolvedReports, findings, heartbeats, newsSources, socialSources]) {
    if (result.error) throw result.error;
  }

  const currentProblems = getCurrentProblems({
    heartbeats: heartbeats.data ?? [],
    newsSources: newsSources.data ?? [],
    now: options.now ?? new Date(),
    publicHealth,
    socialSources: socialSources.data ?? [],
  });
  const aiRows = aiUsage.data ?? [];
  const xRows = xUsage.data ?? [];
  const findingRows = findings.data ?? [];

  return {
    currentStatus: currentProblems.length ? "attention" : "healthy",
    currentProblems,
    jobs: {
      succeeded: (jobs.data ?? []).filter((row) => row.status === "success").length,
      failed: (jobs.data ?? []).filter((row) => row.status === "failed").length,
      queued: queuedJobs.count ?? 0,
      running: runningJobs.count ?? 0,
    },
    content: {
      newsPublished: news.count ?? 0,
      socialPublished: social.count ?? 0,
      digestsPublished: digests.count ?? 0,
    },
    notifications: {
      sent: (notifications.data ?? []).filter((row) => row.status === "sent").length,
      failed: (notifications.data ?? []).filter((row) => row.status === "failed").length,
    },
    costs: {
      ai: aiRows.reduce((sum, row) => sum + Number(row.estimated_cost_usd ?? 0), 0),
      aiRequests: aiRows.length,
      aiTokens: aiRows.reduce((sum, row) => sum + Number(row.input_tokens ?? 0) + Number(row.output_tokens ?? 0), 0),
      x: xRows.reduce((sum, row) => sum + Number(row.estimated_cost_usd ?? 0), 0),
      xPosts: xRows.length,
    },
    reports: {
      newCount: reports.count ?? 0,
      resolvedCount: resolvedReports.count ?? 0,
    },
    findings: {
      active: findingRows.length,
      urgent: findingRows.filter((row) => row.severity === "P0" || row.severity === "P1").length,
    },
  };
}

function getCurrentProblems({ heartbeats, newsSources, now, publicHealth, socialSources }) {
  const problems = [];
  if (!publicHealth.ok) problems.push("Публичный сайт не отвечает на проверку состояния");
  const latestByService = new Map();
  for (const heartbeat of heartbeats) {
    if (!latestByService.has(heartbeat.service_name)) latestByService.set(heartbeat.service_name, heartbeat);
  }
  for (const serviceName of ["web", "live", "admin-job-runner", "cron"]) {
    const heartbeat = latestByService.get(serviceName);
    const age = heartbeat ? (now.getTime() - Date.parse(heartbeat.checked_at)) / 60_000 : Number.POSITIVE_INFINITY;
    if (!heartbeat || age > 5 || heartbeat.status === "unhealthy") {
      problems.push(`${serviceLabel(serviceName)} не подтверждает работу`);
    }
  }
  for (const source of [...newsSources, ...socialSources]) {
    const age = source.last_success_at
      ? (now.getTime() - Date.parse(source.last_success_at)) / 60_000
      : Number.POSITIVE_INFINITY;
    const threshold = Math.max(30, Number(source.fetch_interval_minutes ?? 30) * 2.5);
    if (source.last_error || age > threshold) {
      problems.push(`Источник «${safeLabel(source.name)}» требует проверки`);
    }
  }
  return problems;
}

async function checkPublicHealth(configuredUrl) {
  const baseUrl = configuredUrl ?? process.env.OPS_HEALTH_URL ?? "http://web:3000/api/health";
  try {
    const response = await fetch(baseUrl, {
      headers: { "user-agent": "RaceSide-Support-Report/1.0" },
      signal: AbortSignal.timeout(8_000),
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: null };
  }
}

function formatRussianDate(dateKey) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "Europe/Moscow" })
    .format(new Date(`${dateKey}T12:00:00+03:00`));
}

function formatMoscowDateTime(value) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(value);
}

function formatInteger(value) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

function safeLabel(value) {
  return String(value ?? "Источник").replace(/[<>]/g, "").slice(0, 80);
}

function serviceLabel(value) {
  return ({
    web: "Сайт",
    live: "LIVE-центр",
    "admin-job-runner": "Исполнитель задач",
    cron: "Планировщик",
  })[value] ?? "Сервис";
}
