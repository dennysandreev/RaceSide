import { hostname } from "node:os";

const serviceNames = new Set([
  "web",
  "worker",
  "cron",
  "admin-job-runner",
  "watcher",
  "live",
]);
const releasePattern = /^[0-9a-f]{7,64}$/;
const pendingHeartbeats = new WeakMap();

export function normalizeHeartbeatRelease(value) {
  const normalized = String(value ?? "").trim().toLowerCase();

  return releasePattern.test(normalized) ? normalized : null;
}

export function buildServiceHeartbeat({
  checkedAt = new Date().toISOString(),
  env = process.env,
  host = hostname(),
  serviceName,
  status = "healthy",
  summary = {},
}) {
  if (!serviceNames.has(serviceName)) {
    throw new Error("Invalid heartbeat service name");
  }

  if (!["healthy", "degraded", "unhealthy"].includes(status)) {
    throw new Error("Invalid heartbeat status");
  }

  const configuredInstanceId = String(env.RACESIDE_INSTANCE_ID ?? "").trim();

  return {
    service_name: serviceName,
    instance_id: (configuredInstanceId || `${host}:${serviceName}`).slice(0, 160),
    release_sha: normalizeHeartbeatRelease(
      env.RACESIDE_RELEASE_SHA ?? env.GITHUB_SHA ?? env.VERCEL_GIT_COMMIT_SHA,
    ),
    status,
    summary: ["worker", "admin-job-runner"].includes(serviceName) ? {
      ...summary,
      legacy_adapters: {
        tribute: Boolean(String(env.TRIBUTE_API_KEY ?? "").trim()),
        yoomoney: Boolean(String(env.YOOMONEY_RECONCILE_SECRET ?? "").trim()),
      },
    } : summary,
    checked_at: checkedAt,
    updated_at: checkedAt,
  };
}

export async function upsertServiceHeartbeat(client, input) {
  const row = buildServiceHeartbeat(input);
  let pending = pendingHeartbeats.get(client);
  if (!pending) {
    pending = new Map();
    pendingHeartbeats.set(client, pending);
  }
  const identity = `${row.service_name}:${row.instance_id}`;
  if (pending.has(identity)) return pending.get(identity);

  const request = writeServiceHeartbeat(client, row).finally(() => {
    pending.delete(identity);
  });
  pending.set(identity, request);
  return request;
}

async function writeServiceHeartbeat(client, row) {
  const { error } = await client
    .from("ops_service_heartbeats")
    .upsert(row, { onConflict: "service_name,instance_id" })
    .abortSignal(AbortSignal.timeout(10_000));

  if (error) {
    throw error;
  }

  return row;
}
