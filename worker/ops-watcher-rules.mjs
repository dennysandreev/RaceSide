const severityOrder = new Map([
  ["P0", 0],
  ["P1", 1],
  ["P2", 2],
  ["P3", 3],
]);

export const OPS_WATCHER_RULESET_VERSION = "2026-10-04.1";

export function evaluateOpsSnapshot(snapshot, now = new Date()) {
  const findings = [];
  const nowMs = now.getTime();
  const latestHeartbeat = new Map();

  for (const heartbeat of snapshot.heartbeats ?? []) {
    const current = latestHeartbeat.get(heartbeat.service_name);
    if (!current || Date.parse(heartbeat.checked_at) > Date.parse(current.checked_at)) {
      latestHeartbeat.set(heartbeat.service_name, heartbeat);
    }
  }

  for (const serviceName of ["web", "live", "admin-job-runner", "cron"]) {
    const heartbeat = latestHeartbeat.get(serviceName);
    const ageMinutes = heartbeat
      ? Math.max(0, (nowMs - Date.parse(heartbeat.checked_at)) / 60_000)
      : Number.POSITIVE_INFINITY;
    if (!heartbeat || ageMinutes > 5 || heartbeat.status === "unhealthy") {
      findings.push(makeFinding({
        ruleKey: "service-heartbeat-stale",
        subject: serviceName,
        category: "availability",
        severity: serviceName === "web" || serviceName === "live" ? "P0" : "P1",
        title: `${serviceLabel(serviceName)} не подтверждает работу`,
        description: heartbeat
          ? `Последняя служебная отметка была ${Math.round(ageMinutes)} мин назад.`
          : "Служебная отметка ещё не зарегистрирована.",
        evidence: { ageMinutes: finiteOrNull(ageMinutes), status: heartbeat?.status ?? "missing" },
        route: "/admin/systems",
      }));
    }
  }

  const failedTelemetry = (snapshot.telemetryTasks ?? []).filter((task) => task.status === "failed");
  const failedTelemetryCount = snapshot.telemetrySummary ? Number(snapshot.telemetrySummary.failed24h ?? 0) : failedTelemetry.length;
  if (failedTelemetryCount > 0) {
    findings.push(makeFinding({
      ruleKey: "telemetry-task-failed",
      subject: "telemetry",
      category: "data",
      severity: failedTelemetryCount >= 3 ? "P1" : "P2",
      title: "Подготовка телеметрии завершается ошибкой",
      description: `Не удалось подготовить запросов: ${failedTelemetryCount}.`,
      evidence: { failedCount: failedTelemetryCount },
      route: "/admin/systems#service-telemetry",
    }));
  }

  if (!failedTelemetryCount && Number(snapshot.telemetrySummary?.queuedErrors ?? 0) > 0) {
    findings.push(makeFinding({
      ruleKey: "telemetry-history-inconsistent",
      subject: "telemetry",
      category: "data",
      severity: "P3",
      title: "Прежние запросы телеметрии требуют сверки",
      description: "Ошибки остались в старых записях очереди. Новых ошибок за последние 24 часа нет.",
      evidence: { queuedErrors: Number(snapshot.telemetrySummary.queuedErrors) },
      route: "/admin/systems#service-telemetry",
    }));
  }

  if (!snapshot.publicHealth?.ok) {
    findings.push(makeFinding({
      ruleKey: "public-health-unavailable",
      subject: "public-web",
      category: "availability",
      severity: "P0",
      title: "Публичный сайт не прошёл проверку",
      description: "Два последовательных запроса к health endpoint завершились ошибкой.",
      evidence: {
        attempts: snapshot.publicHealth?.attempts ?? 2,
        status: snapshot.publicHealth?.status ?? null,
      },
      route: "/api/health",
    }));
  }

  const queuedJobs = (snapshot.jobs ?? []).filter((job) => job.status === "queued");
  const runningJobs = (snapshot.jobs ?? []).filter((job) => job.status === "running");
  const recentFailures = (snapshot.jobs ?? []).filter((job) =>
    job.status === "failed" && nowMs - Date.parse(job.finished_at ?? job.started_at) <= 15 * 60_000,
  );
  const oldestQueuedMinutes = maxAgeMinutes(queuedJobs, "available_at", nowMs);
  const oldestRunningMinutes = maxAgeMinutes(runningJobs, "started_at", nowMs);

  if (oldestQueuedMinutes > 15) {
    findings.push(makeFinding({
      ruleKey: "job-queue-stalled",
      subject: "admin-job-queue",
      category: "job",
      severity: oldestQueuedMinutes > 45 ? "P1" : "P2",
      title: "Очередь задач ждёт дольше обычного",
      description: `Самая старая задача ожидает около ${Math.round(oldestQueuedMinutes)} мин.`,
      evidence: { queuedCount: queuedJobs.length, oldestMinutes: Math.round(oldestQueuedMinutes) },
      route: "/admin/jobs?status=queued",
    }));
  }

  if (oldestRunningMinutes > 30) {
    findings.push(makeFinding({
      ruleKey: "job-run-stuck",
      subject: "admin-job-runner",
      category: "job",
      severity: "P1",
      title: "Фоновая задача выполняется слишком долго",
      description: `Самый долгий запуск продолжается около ${Math.round(oldestRunningMinutes)} мин.`,
      evidence: { runningCount: runningJobs.length, oldestMinutes: Math.round(oldestRunningMinutes) },
      route: "/admin/jobs?status=running",
    }));
  }

  if (recentFailures.length >= 2) {
    findings.push(makeFinding({
      ruleKey: "job-failure-burst",
      subject: "admin-job-runner",
      category: "job",
      severity: "P1",
      title: "Несколько фоновых задач завершились ошибкой",
      description: `За последние 15 минут обнаружено ошибок: ${recentFailures.length}.`,
      evidence: { failureCount: recentFailures.length },
      route: "/admin/jobs?status=failed",
    }));
  }

  for (const source of [...(snapshot.newsSources ?? []), ...(snapshot.socialSources ?? [])]) {
    if (!source.is_active) continue;
    const ageMinutes = source.last_success_at
      ? Math.max(0, (nowMs - Date.parse(source.last_success_at)) / 60_000)
      : Number.POSITIVE_INFINITY;
    const threshold = Math.max(30, Number(source.fetch_interval_minutes ?? 30) * 2.5);
    if (source.last_error || ageMinutes > threshold) {
      findings.push(makeFinding({
        ruleKey: "source-stale",
        subject: String(source.id),
        category: "data",
        severity: ageMinutes > threshold * 3 ? "P1" : "P2",
        title: `Источник «${safeLabel(source.name)}» требует проверки`,
        description: source.last_error
          ? "Последняя загрузка источника завершилась ошибкой."
          : `Успешных обновлений не было около ${Math.round(ageMinutes)} мин.`,
        evidence: {
          ageMinutes: finiteOrNull(ageMinutes),
          hasError: Boolean(source.last_error),
          thresholdMinutes: threshold,
        },
        route: "/admin/systems",
        entityType: "source",
        entityId: String(source.id),
      }));
    }
  }

  if (Number(snapshot.notificationFailedCount ?? 0) > 0) {
    findings.push(makeFinding({
      ruleKey: "telegram-delivery-failed",
      subject: "notification-queue",
      category: "job",
      severity: Number(snapshot.notificationFailedCount) >= 5 ? "P1" : "P2",
      title: "Есть неотправленные Telegram-уведомления",
      description: `Не удалось доставить уведомлений: ${Number(snapshot.notificationFailedCount)}.`,
      evidence: { failedCount: Number(snapshot.notificationFailedCount) },
      route: "/admin/notifications?status=failed",
    }));
  }

  const monthlyLimit = Number(snapshot.aiBudget?.monthly_limit_usd ?? 0);
  const monthlySpend = Number(snapshot.aiMonthlySpend ?? 0);
  const budgetRatio = monthlyLimit > 0 ? monthlySpend / monthlyLimit : 0;
  if (budgetRatio >= 0.8) {
    findings.push(makeFinding({
      ruleKey: "ai-budget-threshold",
      subject: "default-monthly",
      category: "cost",
      severity: budgetRatio >= 1 ? "P1" : "P2",
      title: budgetRatio >= 1 ? "Месячный AI-бюджет исчерпан" : "AI-бюджет близок к лимиту",
      description: `Использовано ${Math.round(budgetRatio * 100)}% месячного лимита.`,
      evidence: { ratio: Number(budgetRatio.toFixed(3)), spendUsd: monthlySpend, limitUsd: monthlyLimit },
      route: "/admin/ai",
    }));
  }

  return findings.sort((left, right) => severityOrder.get(left.severity) - severityOrder.get(right.severity));
}

export function makeRuleFingerprintSource(finding) {
  return JSON.stringify([finding.ruleKey, finding.subject]);
}

function makeFinding(input) {
  return {
    ...input,
    entityType: input.entityType ?? "watcher_rule",
    entityId: input.entityId ?? `${input.ruleKey}:${input.subject}`,
    evidence: { ...input.evidence, ruleKey: input.ruleKey, subject: input.subject },
  };
}

function maxAgeMinutes(rows, field, nowMs) {
  return rows.reduce((max, row) => {
    const value = row[field] ?? row.started_at;
    const age = value ? Math.max(0, (nowMs - Date.parse(value)) / 60_000) : 0;
    return Math.max(max, Number.isFinite(age) ? age : 0);
  }, 0);
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
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
