import { NextResponse } from "next/server";

import {
  buildPublicHealthPayload,
  createDatabaseHealthProbe,
  getPublicHealthStatus,
} from "@/lib/admin-agent/health";
import {
  getRuntimeInstanceId,
  getRuntimeReleaseSha,
} from "@/lib/admin-agent/runtime";
import { getSupabaseServiceEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const checkDatabaseHealth = createDatabaseHealthProbe(async () => {
  const checkedAt = new Date().toISOString();
  const release = getRuntimeReleaseSha();
  const supabase = createSupabaseAdminClient();
  let databaseHealthy = false;

  if (supabase) {
    try {
      const heartbeat = await supabase
        .from("ops_service_heartbeats")
        .upsert(
          {
            service_name: "web",
            instance_id: getRuntimeInstanceId("web"),
            release_sha: release,
            status: "healthy",
            summary: { source: "public-health" },
            checked_at: checkedAt,
            updated_at: checkedAt,
          },
          { onConflict: "service_name,instance_id" },
        )
        .abortSignal(AbortSignal.timeout(4_000));

      databaseHealthy = !heartbeat.error;
    } catch {
      databaseHealthy = false;
    }
  }

  return databaseHealthy;
});

export async function GET() {
  const checkedAt = new Date().toISOString();
  const release = getRuntimeReleaseSha();
  const databaseHealthy = await checkDatabaseHealth();
  const payload = buildPublicHealthPayload({
    checkedAt,
    databaseHealthy,
    release,
    supabaseConfigured: getSupabaseServiceEnv() !== null,
  });

  return NextResponse.json(payload, { status: getPublicHealthStatus(payload) });
}
