export type PublicHealthPayload = {
  ok: boolean;
  app: "RaceSide";
  supabase: "configured" | "missing";
  database: "healthy" | "unhealthy";
  release: string | null;
  checkedAt: string;
};

export function buildPublicHealthPayload({
  checkedAt,
  databaseHealthy,
  release,
  supabaseConfigured,
}: {
  checkedAt: string;
  databaseHealthy: boolean;
  release: string | null;
  supabaseConfigured: boolean;
}): PublicHealthPayload {
  const ok = supabaseConfigured && databaseHealthy;

  return {
    ok,
    app: "RaceSide",
    supabase: supabaseConfigured ? "configured" : "missing",
    database: databaseHealthy ? "healthy" : "unhealthy",
    release,
    checkedAt,
  };
}

export function getPublicHealthStatus(payload: PublicHealthPayload) {
  return payload.ok ? 200 : 503;
}

export function createDatabaseHealthProbe(
  probe: () => Promise<boolean>,
  now: () => number = Date.now,
) {
  let inFlight: Promise<boolean> | null = null;
  let healthy = false;
  let nextCheckAt = 0;

  return function checkDatabaseHealth(): Promise<boolean> {
    if (inFlight) return inFlight;
    if (now() < nextCheckAt) return Promise.resolve(healthy);

    inFlight = Promise.resolve()
      .then(probe)
      .catch(() => false)
      .then((result) => {
        healthy = result;
        // An unavailable database must not receive a write for every health request.
        nextCheckAt = now() + (healthy ? 5_000 : 30_000);
        return healthy;
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  };
}
