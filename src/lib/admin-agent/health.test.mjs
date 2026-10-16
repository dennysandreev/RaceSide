import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublicHealthPayload,
  createDatabaseHealthProbe,
  getPublicHealthStatus,
} from "./health.ts";
import {
  getRuntimeInstanceId,
  getRuntimeReleaseSha,
  normalizeReleaseSha,
} from "./runtime.ts";

test("public health is unavailable when Supabase or the database is unavailable", () => {
  const missing = buildPublicHealthPayload({
    checkedAt: "2026-08-06T10:00:00.000Z",
    databaseHealthy: false,
    release: null,
    supabaseConfigured: false,
  });
  const failed = buildPublicHealthPayload({
    checkedAt: "2026-08-06T10:00:00.000Z",
    databaseHealthy: false,
    release: "abcdef1",
    supabaseConfigured: true,
  });

  assert.equal(getPublicHealthStatus(missing), 503);
  assert.equal(missing.database, "unhealthy");
  assert.equal(getPublicHealthStatus(failed), 503);
});

test("public health exposes only a safe release identifier", () => {
  const payload = buildPublicHealthPayload({
    checkedAt: "2026-08-06T10:00:00.000Z",
    databaseHealthy: true,
    release: normalizeReleaseSha("ABCDEF123456"),
    supabaseConfigured: true,
  });

  assert.deepEqual(payload, {
    ok: true,
    app: "RaceSide",
    supabase: "configured",
    database: "healthy",
    release: "abcdef123456",
    checkedAt: "2026-08-06T10:00:00.000Z",
  });
  assert.equal(getPublicHealthStatus(payload), 200);
  assert.equal(normalizeReleaseSha("not-a-release"), null);
});

test("runtime identity uses bounded deployment metadata", () => {
  assert.equal(
    getRuntimeReleaseSha({ GITHUB_SHA: "ABCDEF123456" }),
    "abcdef123456",
  );
  assert.equal(
    getRuntimeInstanceId(
      "web",
      { RACESIDE_INSTANCE_ID: "production-web" },
      "ignored-host",
    ),
    "production-web",
  );
  assert.equal(getRuntimeInstanceId("cron", {}, "container-1"), "container-1:cron");
});

test("concurrent health requests share one database write and reuse recent success", async () => {
  let calls = 0;
  let time = 0;
  let finish;
  const check = createDatabaseHealthProbe(() => {
    calls += 1;
    return new Promise((resolve) => { finish = resolve; });
  }, () => time);

  const first = check();
  const second = check();
  await Promise.resolve();
  assert.equal(calls, 1);
  finish(true);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  time = 4_999;
  assert.equal(await check(), true);
  assert.equal(calls, 1);
  time = 5_000;
  const next = check();
  await Promise.resolve();
  assert.equal(calls, 2);
  finish(false);
  assert.equal(await next, false);
});

test("failed health checks remain unhealthy and back off before retrying", async () => {
  let calls = 0;
  let time = 0;
  const check = createDatabaseHealthProbe(async () => {
    calls += 1;
    if (calls === 1) throw new Error("database timeout");
    return true;
  }, () => time);

  assert.equal(await check(), false);
  time = 29_999;
  assert.equal(await check(), false);
  assert.equal(calls, 1);
  time = 30_000;
  assert.equal(await check(), true);
  assert.equal(calls, 2);
});
