import assert from "node:assert/strict";
import test from "node:test";
import { parseAdminTableQuery, adminSearchFilter, adminSearchPattern, adminSearchOperator, adminSearchValue, makeAdminPageHref, readAdminPage } from "./admin-table-query.ts";
import { parseMoscowPaymentDate } from "./admin-billing-policy.ts";
import { getAdminTelemetrySignal, isNewsPubliclyAvailable } from "./admin-policies.ts";
import { startAdminAudit, finishAdminAudit } from "./admin-audit.ts";
import { claimNotification } from "../../worker/notification-rules.mjs";

test("admin queries keep literal search, defaults, dates and deep pages", () => {
  const query = parseAdminTableQuery({ search: "news.audit_recent", page: "13315", tab: "sources", sort: "oldest", pageSize: "50", from: "2026-02-31", to: "2026-13-01" });
  assert.equal(parseAdminTableQuery({}, { pageSize: 20 }).pageSize, 20);
  assert.equal(parseAdminTableQuery({ pageSize: "" }).pageSize, 25);
  assert.equal(query.page, 13315);
  assert.equal(query.search, "news.audit_recent");
  assert.equal(query.from, undefined);
  assert.equal(query.to, undefined);
  assert.equal(adminSearchPattern(query.search), "%news.audit\\_recent%");
  assert.equal(adminSearchFilter(["job_name"], 'a,b)"'), 'job_name.ilike."%a,b)\\\"%"');
  assert.equal(adminSearchOperator("news*"), "imatch");
  assert.equal(adminSearchValue("*a.b[1](c)+?$^|\\"), "\\*a\\.b\\[1\\]\\(c\\)\\+\\?\\$\\^\\|\\\\");
  const url = new URL(makeAdminPageHref("/admin/jobs", 2, query), "https://example.test");
  assert.equal(url.searchParams.get("tab"), "sources");
  assert.equal(url.searchParams.get("sort"), "oldest");
  assert.equal(url.searchParams.get("pageSize"), "50");
  assert.equal(url.searchParams.get("search"), "news.audit_recent");
});

test("successful and failed audit completion preserve the original reason", async () => {
  let row;
  const db = { from: () => ({
    insert: (input) => { row = { id: "audit", ...input }; return { select: () => ({ single: async () => ({ data: { id: row.id } }) }) }; },
    update: (update) => ({ eq: async () => { row = { ...row, ...update }; return {}; } }),
  }) };
  const id = await startAdminAudit(db, { actorUserId: "actor", action: "billing.grant", entityType: "user", metadata: { reason: "Оплачено вручную", token: "hidden" } });
  await finishAdminAudit(db, id, { outcome: "succeeded", afterData: { granted: true } });
  assert.deepEqual(row.metadata, { reason: "Оплачено вручную" });
  await finishAdminAudit(db, id, { outcome: "failed", error: new Error("offline") });
  assert.equal(row.metadata.reason, "Оплачено вручную");
  await finishAdminAudit(db, id, { outcome: "succeeded", metadata: { reason: "Новая причина", api_key: "hidden" } });
  assert.deepEqual(row.metadata, { reason: "Новая причина" });
});

test("parallel dispatchers claim an unsent notification only once", async () => {
  const row = { id: "queue", status: "pending", attempts: 0, sent_at: null };
  const db = { from: () => ({ update: (update) => {
    const filters = [];
    const request = { eq: (k, v) => { filters.push([k, v]); return request; }, is: (k, v) => { filters.push([k, v]); return request; }, select: () => request,
      maybeSingle: async () => { if (!filters.every(([k, v]) => row[k] === v)) return { data: null }; Object.assign(row, update); return { data: { id: row.id } }; } };
    return request;
  } }) };
  assert.deepEqual(await Promise.all([claimNotification(db, { ...row }), claimNotification(db, { ...row })]), [true, false]);
  assert.equal(row.status, "sending");
  assert.equal(row.attempts, 1);
  row.status = "sent"; row.sent_at = new Date().toISOString();
  assert.equal(await claimNotification(db, row), false);
});

test("manual payment dates use Moscow time and reject missing or normalized dates", () => {
  assert.equal(parseMoscowPaymentDate("2026-10-04T12:30"), "2026-10-04T09:30:00.000Z");
  for (const value of ["", "2026-02-31T12:30", "2026-10-04T25:30", "2026-13-01T12:30", "2026-10-04T12:30Z"]) assert.equal(parseMoscowPaymentDate(value), null);
});

test("public news links follow the public article availability rules", () => {
  const article = { status: "processed", publication_status: "published", duplicate_of: null, ai_model: "model" };
  assert.equal(isNewsPubliclyAvailable(article), true);
  for (const change of [{ status: "pending" }, { publication_status: "draft" }, { publication_status: "duplicate" }, { duplicate_of: "other" }, { ai_model: "fallback" }]) assert.equal(isNewsPubliclyAvailable({ ...article, ...change }), false);
});

test("paging clamps an out-of-range page using the full filtered total", async () => {
  const calls = [], query = parseAdminTableQuery({ page: "999" }, { pageSize: 20 });
  const request = { range: async (from, to) => { calls.push([from, to]); return { count: 41, data: [{ index: from }], error: null }; } };
  const result = await readAdminPage(request, query);
  assert.equal(query.page, 3);
  assert.deepEqual(calls, [[0, 0], [40, 59]]);
  assert.equal(result.data[0].index, 40);
});

test("cached telemetry does not hide failed or stale requests and cannot prove executor health", () => {
  const snapshot = { failed24h: 0, queuedErrors: 0, staleQueued: 0, queued: 0, ready24h: 0, cacheUpdatedAt: new Date().toISOString() };
  assert.equal(getAdminTelemetrySignal(snapshot), "unknown");
  assert.equal(getAdminTelemetrySignal({ ...snapshot, ready24h: 1 }), "healthy");
  assert.equal(getAdminTelemetrySignal({ ...snapshot, queued: 1 }), "warning");
  assert.equal(getAdminTelemetrySignal({ ...snapshot, ready24h: 1, staleQueued: 1 }), "stale");
  assert.equal(getAdminTelemetrySignal({ ...snapshot, ready24h: 1, queuedErrors: 1 }), "warning");
  assert.equal(getAdminTelemetrySignal({ ...snapshot, ready24h: 1, failed24h: 1 }), "failed");
});
