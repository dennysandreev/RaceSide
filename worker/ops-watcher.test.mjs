import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getSafeRecoveryProposal } from "./ops-action-policy.mjs";
import { evaluateOpsSnapshot } from "./ops-watcher-rules.mjs";

const now = new Date("2026-08-06T15:00:00.000Z");

test("watcher loads monthly AI spend with one aggregate RPC", () => {
  const source = readFileSync(new URL("./ops-watcher.mjs", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../supabase/migrations/20260911093000_reduce_background_database_pressure.sql", import.meta.url),
    "utf8",
  );

  assert.match(source, /rpc\("get_ops_ai_monthly_spend"/);
  assert.doesNotMatch(source, /from\("ai_usage_logs"\)[\s\S]{0,200}limit\(10_000\)/);
  assert.match(migration, /sum\(estimated_cost_usd\)/);
  assert.match(migration, /grant execute[\s\S]*service_role/i);
  assert.match(migration, /revoke all[\s\S]*anon, authenticated/i);
});

test("healthy snapshot does not create findings", () => {
  const findings = evaluateOpsSnapshot({
    heartbeats: ["web", "live", "admin-job-runner", "cron"].map((service_name) => ({
      service_name,
      status: "healthy",
      checked_at: "2026-08-06T14:58:00.000Z",
    })),
    publicHealth: { ok: true, attempts: 1, status: 200 },
    jobs: [],
    newsSources: [],
    socialSources: [],
    notificationFailedCount: 0,
    aiBudget: { monthly_limit_usd: 10 },
    aiMonthlySpend: 2,
  }, now);

  assert.deepEqual(findings, []);
});

test("stale queue and public outage are deterministic findings", () => {
  const findings = evaluateOpsSnapshot({
    heartbeats: ["web", "live", "admin-job-runner", "cron"].map((service_name) => ({
      service_name,
      status: "healthy",
      checked_at: "2026-08-06T14:58:00.000Z",
    })),
    publicHealth: { ok: false, attempts: 2, status: 503 },
    jobs: [{ status: "queued", available_at: "2026-08-06T14:10:00.000Z", started_at: "2026-08-06T14:10:00.000Z" }],
    newsSources: [],
    socialSources: [],
    notificationFailedCount: 0,
  }, now);

  assert.equal(findings[0].severity, "P0");
  assert.deepEqual(findings.map((finding) => finding.ruleKey), ["public-health-unavailable", "job-queue-stalled"]);
});

test("recent telemetry failures create a data finding", () => {
  const findings = evaluateOpsSnapshot({
    heartbeats: ["web", "live", "admin-job-runner", "cron"].map((service_name) => ({
      service_name,
      status: "healthy",
      checked_at: "2026-08-06T14:58:00.000Z",
    })),
    publicHealth: { ok: true, attempts: 1, status: 200 },
    jobs: [],
    newsSources: [],
    socialSources: [],
    notificationFailedCount: 0,
    telemetryTasks: [{ status: "failed", updated_at: "2026-08-06T14:55:00.000Z" }],
  }, now);

  assert.deepEqual(findings.map((finding) => finding.ruleKey), ["telemetry-task-failed"]);
});

test("old queued telemetry errors require reconciliation without reporting a permanent live failure", () => {
  const findings = evaluateOpsSnapshot({
    heartbeats: ["web", "live", "admin-job-runner", "cron"].map(service_name => ({ service_name, status: "healthy", checked_at: now.toISOString() })),
    publicHealth: { ok: true }, jobs: [], newsSources: [], socialSources: [],
    telemetrySummary: { failed24h: 0, queuedErrors: 10, ready24h: 5 },
  }, now);
  assert.deepEqual(findings.map(finding => [finding.ruleKey, finding.severity]), [["telemetry-history-inconsistent", "P3"]]);
});

test("R2 proposal stays disabled during shadow and first seven days", () => {
  const finding = { ruleKey: "job-queue-stalled" };
  assert.equal(getSafeRecoveryProposal(finding, {
    is_enabled: true,
    mode: "shadow",
    r2_actions_enabled: true,
    shadow_started_at: "2026-07-01T00:00:00.000Z",
  }, now), null);
  assert.equal(getSafeRecoveryProposal(finding, {
    is_enabled: true,
    mode: "limited",
    r2_actions_enabled: true,
    shadow_started_at: "2026-08-01T00:00:00.000Z",
  }, now), null);
});
