import { createHash } from "node:crypto";

import { getSafeRecoveryProposal } from "./ops-action-policy.mjs";
import {
  evaluateOpsSnapshot,
  makeRuleFingerprintSource,
  OPS_WATCHER_RULESET_VERSION,
} from "./ops-watcher-rules.mjs";
import { upsertServiceHeartbeat } from "./ops-heartbeat.mjs";
import { runDailyPublicSmoke } from "./ops-browser-smoke.mjs";
import {
  escapeSupportTelegramHtml,
  sendSupportTelegramMessage,
} from "./support-telegram.mjs";

const activeStatuses = ["open", "acknowledged", "action_pending", "fixing", "monitoring"];

export async function runOpsWatcher(client, options = {}) {
  const startedAt = new Date();
  const releaseSha = normalizeRelease(options.releaseSha ?? process.env.RACESIDE_RELEASE_SHA);
  const settings = await loadSettings(client);

  if (!settings.is_enabled) {
    await upsertServiceHeartbeat(client, {
      serviceName: "watcher",
      status: "degraded",
      summary: { mode: settings.mode, phase: "disabled" },
    });
    return { itemsProcessed: 0, metadata: { disabled: true, mode: settings.mode } };
  }

  const runResult = await client
    .from("admin_agent_runs")
    .insert({
      run_kind: "watcher",
      trigger_kind: options.triggerKind ?? "schedule",
      status: "running",
      ruleset_version: OPS_WATCHER_RULESET_VERSION,
      release_sha: releaseSha,
    })
    .select("id")
    .single();
  if (runResult.error) throw runResult.error;
  const runId = runResult.data.id;

  try {
    const [snapshot, smoke] = await Promise.all([
      loadOpsSnapshot(client, options),
      runDailyPublicSmoke(client, options),
    ]);
    const findings = evaluateOpsSnapshot(snapshot);
    const activeIds = [];
    let createdCount = 0;
    let alertsSent = 0;
    let proposedCount = 0;

    for (const finding of findings) {
      const fingerprint = createHash("sha256")
        .update(makeRuleFingerprintSource(finding))
        .digest("hex");
      const result = await client.rpc("record_admin_finding", {
        p_fingerprint: fingerprint,
        p_category: finding.category,
        p_severity: finding.severity,
        p_title: finding.title.slice(0, 180),
        p_description: finding.description.slice(0, 4_000),
        p_evidence: finding.evidence,
        p_route: finding.route ?? null,
        p_entity_type: finding.entityType,
        p_entity_id: finding.entityId,
        p_release_sha: releaseSha,
      });
      if (result.error) throw result.error;
      const recorded = result.data?.[0];
      if (!recorded) continue;
      activeIds.push(recorded.finding_id);
      createdCount += recorded.was_created ? 1 : 0;

      if (["P0", "P1"].includes(finding.severity) && settings.telegram_alerts_enabled) {
        const { data: alertState, error: alertStateError } = await client
          .from("admin_findings")
          .select("last_alerted_at")
          .eq("id", recorded.finding_id)
          .single();
        if (alertStateError) throw alertStateError;
        if (!alertState.last_alerted_at) {
          const delivered = await alertAdmins(client, recorded.finding_id, finding, options);
          alertsSent += delivered;
        }
      }

      const proposal = getSafeRecoveryProposal(finding, settings);
      if (proposal) {
        proposedCount += await recordActionProposal(client, recorded.finding_id, finding, proposal);
      }
    }

    const resolvedCount = await resolveRecoveredFindings(client, activeIds);
    const durationMs = Date.now() - startedAt.getTime();
    const counters = {
      active: findings.length,
      alertsSent,
      created: createdCount,
      proposed: proposedCount,
      resolved: resolvedCount,
      smokeChecked: smoke.checked,
      smokeFailures: smoke.failures,
    };
    const finishResult = await client
      .from("admin_agent_runs")
      .update({
        status: "succeeded",
        counters,
        finished_at: new Date().toISOString(),
        duration_ms: durationMs,
      })
      .eq("id", runId);
    if (finishResult.error) throw finishResult.error;

    await upsertServiceHeartbeat(client, {
      serviceName: "watcher",
      status: findings.some((finding) => finding.severity === "P0") ? "degraded" : "healthy",
      summary: { activeFindings: findings.length, mode: settings.mode, ruleset: OPS_WATCHER_RULESET_VERSION },
    });

    return { itemsProcessed: findings.length, metadata: { ...counters, mode: settings.mode } };
  } catch (error) {
    const message = safeErrorMessage(error);
    await client
      .from("admin_agent_runs")
      .update({
        status: "failed",
        error_code: "watcher_run_failed",
        error_message: message,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt.getTime(),
      })
      .eq("id", runId);
    await upsertServiceHeartbeat(client, {
      serviceName: "watcher",
      status: "unhealthy",
      summary: { errorCode: "watcher_run_failed", mode: settings.mode },
    }).catch(() => undefined);
    throw error;
  }
}

async function loadSettings(client) {
  const { data, error } = await client
    .from("admin_agent_settings")
    .select("is_enabled, mode, telegram_alerts_enabled, r2_actions_enabled, shadow_started_at")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw error;
  return data ?? {
    is_enabled: true,
    mode: "shadow",
    telegram_alerts_enabled: true,
    r2_actions_enabled: false,
    shadow_started_at: new Date().toISOString(),
  };
}

async function loadOpsSnapshot(client, options) {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
  const [
    heartbeats,
    jobs,
    newsSources,
    socialSources,
    notificationFailures,
    aiBudget,
    aiSpend,
    telemetryTasks,
    publicHealth,
  ] = await Promise.all([
    client.from("ops_service_heartbeats").select("service_name, status, checked_at").order("checked_at", { ascending: false }).limit(50),
    client.from("job_runs").select("id, status, started_at, finished_at, available_at").gte("started_at", dayAgo).order("started_at", { ascending: false }).limit(250),
    client.from("news_sources").select("id, name, is_active, fetch_interval_minutes, last_success_at, last_error").eq("is_active", true),
    client.from("social_sources").select("id, name, is_active, fetch_interval_minutes, last_success_at, last_error").eq("is_active", true),
    client.from("notification_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
    client.from("admin_ai_budgets").select("monthly_limit_usd").eq("scope", "default").maybeSingle(),
    client.rpc("get_ops_ai_monthly_spend", { p_since: new Date(Date.now() - 30 * 86_400_000).toISOString() }),
    client.rpc("get_admin_operations_snapshot", {}),
    checkPublicHealth(options.healthUrl),
  ]);

  for (const result of [heartbeats, jobs, newsSources, socialSources, notificationFailures, aiBudget, aiSpend, telemetryTasks]) {
    if (result.error) throw result.error;
  }

  return {
    heartbeats: heartbeats.data ?? [],
    jobs: jobs.data ?? [],
    newsSources: newsSources.data ?? [],
    socialSources: socialSources.data ?? [],
    notificationFailedCount: notificationFailures.count ?? 0,
    aiBudget: aiBudget.data,
    aiMonthlySpend: Number(aiSpend.data ?? 0),
    telemetrySummary: telemetryTasks.data?.telemetry ?? null,
    telemetryTasks: [],
    publicHealth,
  };
}

async function checkPublicHealth(configuredUrl) {
  const baseUrl = configuredUrl
    ?? process.env.OPS_HEALTH_URL
    ?? "http://web:3000/api/health";
  let lastStatus = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(baseUrl, {
        headers: { "user-agent": "RaceSide-Ops-Watcher/1.0" },
        signal: AbortSignal.timeout(8_000),
      });
      lastStatus = response.status;
      if (response.ok) return { ok: true, attempts: attempt, status: response.status };
    } catch {
      lastStatus = null;
    }
  }
  return { ok: false, attempts: 2, status: lastStatus };
}

async function resolveRecoveredFindings(client, activeIds) {
  const { data, error } = await client
    .from("admin_findings")
    .select("id, evidence")
    .in("status", activeStatuses)
    .limit(500);
  if (error) throw error;
  const active = new Set(activeIds);
  const recovered = (data ?? []).filter((finding) =>
    isWatcherEvidence(finding.evidence) && !active.has(finding.id),
  );
  for (const finding of recovered) {
    const result = await client.rpc("transition_admin_finding", {
      p_finding_id: finding.id,
      p_status: "resolved",
      p_actor_kind: "system",
      p_resolution: "Проверка снова проходит автоматически.",
    });
    if (result.error) throw result.error;
  }
  return recovered.length;
}

async function recordActionProposal(client, findingId, finding, proposal) {
  const idempotencyKey = `watcher:${findingId}:${proposal.actionName}`;
  const result = await client
    .from("admin_action_requests")
    .upsert({
      finding_id: findingId,
      action_name: proposal.actionName,
      action_args: proposal.actionArgs,
      risk_class: proposal.riskClass,
      status: "proposed",
      idempotency_key: idempotencyKey,
      requested_by_kind: "agent",
      result: { autoExecutable: proposal.autoExecutable, ruleKey: finding.ruleKey },
    }, { onConflict: "idempotency_key", ignoreDuplicates: true })
    .select("id");
  if (result.error) throw result.error;
  return result.data?.length ? 1 : 0;
}

async function alertAdmins(client, findingId, finding, options) {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://raceside.online").replace(/\/$/, "");
  const text = [
    `🚨 <b>RaceSide ${finding.severity}</b>`,
    "",
    escapeSupportTelegramHtml(finding.title),
    escapeSupportTelegramHtml(finding.description),
  ].join("\n");
  const delivery = await sendSupportTelegramMessage({
    text,
    replyMarkup: {
      inline_keyboard: [[{ text: "Открыть находку", url: `${siteUrl}/admin/findings` }]],
    },
  }, { ...options, client });
  if (delivery.ok) {
    const result = await client.rpc("mark_admin_finding_alerted", { p_finding_id: findingId });
    if (result.error) throw result.error;
  }
  return delivery.ok ? 1 : 0;
}

function isWatcherEvidence(value) {
  return Boolean(value) && typeof value === "object" && typeof value.ruleKey === "string";
}

function normalizeRelease(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{7,64}$/.test(normalized) ? normalized : null;
}

function safeErrorMessage(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}
