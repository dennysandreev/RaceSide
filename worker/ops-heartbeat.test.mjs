import assert from "node:assert/strict";
import test from "node:test";

import {
  buildServiceHeartbeat,
  normalizeHeartbeatRelease,
  upsertServiceHeartbeat,
} from "./ops-heartbeat.mjs";

test("builds a bounded heartbeat without leaking arbitrary environment data", () => {
  const row = buildServiceHeartbeat({
    checkedAt: "2026-08-06T10:00:00.000Z",
    env: {
      RACESIDE_INSTANCE_ID: "cron-primary",
      RACESIDE_RELEASE_SHA: "ABCDEF123456",
      SUPABASE_SERVICE_ROLE_KEY: "must-not-appear",
    },
    host: "container-1",
    serviceName: "cron",
    summary: { loop: "schedule" },
  });

  assert.deepEqual(row, {
    service_name: "cron",
    instance_id: "cron-primary",
    release_sha: "abcdef123456",
    status: "healthy",
    summary: { loop: "schedule" },
    checked_at: "2026-08-06T10:00:00.000Z",
    updated_at: "2026-08-06T10:00:00.000Z",
  });
  assert.doesNotMatch(JSON.stringify(row), /must-not-appear/);
});

test("rejects unknown services and malformed release identifiers", () => {
  assert.equal(normalizeHeartbeatRelease("release-latest"), null);
  assert.equal(buildServiceHeartbeat({ serviceName: "live" }).service_name, "live");
  assert.throws(
    () => buildServiceHeartbeat({ serviceName: "shell" }),
    /Invalid heartbeat service name/,
  );
});
test("runner reports only the presence of legacy adapters and never their secrets", () => {
  const row = buildServiceHeartbeat({
    serviceName: "admin-job-runner",
    env: { TRIBUTE_API_KEY: "private-tribute-value", YOOMONEY_RECONCILE_SECRET: " " },
  });
  assert.deepEqual(row.summary.legacy_adapters, { tribute: true, yoomoney: false });
  assert.doesNotMatch(JSON.stringify(row), /private-tribute-value|TRIBUTE_API_KEY|YOOMONEY_RECONCILE_SECRET/);
  assert.deepEqual(buildServiceHeartbeat({ serviceName: "worker", env: {} }).summary.legacy_adapters, { tribute: false, yoomoney: false });
});

test("upserts on the stable service and instance identity", async () => {
  let receivedRow;
  let receivedOptions;
  const client = {
    from(table) {
      assert.equal(table, "ops_service_heartbeats");
      return {
        upsert(row, options) {
          receivedRow = row;
          receivedOptions = options;
          return {
            async abortSignal(signal) {
              assert.ok(signal instanceof AbortSignal);
              assert.equal(signal.aborted, false);
              return { error: null };
            },
          };
        },
      };
    },
  };

  await upsertServiceHeartbeat(client, {
    checkedAt: "2026-08-06T10:00:00.000Z",
    env: {},
    host: "worker-1",
    serviceName: "worker",
  });

  assert.equal(receivedRow.instance_id, "worker-1:worker");
  assert.deepEqual(receivedOptions, { onConflict: "service_name,instance_id" });
});

test("coalesces overlapping heartbeats and retries after an unsuccessful write", async () => {
  let writes = 0;
  let finish;
  const client = {
    from() {
      return {
        upsert() {
          writes += 1;
          return {
            abortSignal() {
              return new Promise((resolve) => { finish = resolve; });
            },
          };
        },
      };
    },
  };
  const input = { serviceName: "live", env: {}, host: "live-1" };
  const first = upsertServiceHeartbeat(client, input);
  const second = upsertServiceHeartbeat(client, input);
  assert.equal(writes, 1);
  finish({ error: new Error("database unavailable") });
  const failed = await Promise.allSettled([first, second]);
  assert.deepEqual(failed.map((result) => result.status), ["rejected", "rejected"]);

  const next = upsertServiceHeartbeat(client, input);
  assert.equal(writes, 2);
  finish({ error: null });
  assert.equal((await next).service_name, "live");
});

test("does not combine heartbeats from different services", async () => {
  const resolvers = [];
  const client = {
    from() {
      return {
        upsert() {
          return {
            abortSignal() {
              return new Promise((resolve) => { resolvers.push(resolve); });
            },
          };
        },
      };
    },
  };
  const pending = ["live", "cron"].map((serviceName) =>
    upsertServiceHeartbeat(client, { serviceName }),
  );
  assert.equal(resolvers.length, 2);
  resolvers.forEach((resolve) => resolve({ error: null }));
  assert.deepEqual((await Promise.all(pending)).map((row) => row.service_name), ["live", "cron"]);
});
