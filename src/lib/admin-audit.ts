import type { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { Json } from "@/types/supabase";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

const BLOCKED_KEYS = /(^|_)(authorization|password|secret|token|api_key|service_role|raw_payload|chat_id|telegram_user_id|provider_message_id)($|_)/i;
const EMAIL_PATTERN = /([a-z0-9._%+-]{1,64})@([a-z0-9.-]+\.[a-z]{2,})/gi;

export function sanitizeAdminAuditPayload(value: unknown, depth = 0): Json {
  if (depth > 4) {
    return "[скрыто]";
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return value
      .replace(EMAIL_PATTERN, (_, name: string, domain: string) => `${name.slice(0, 2)}***@${domain}`)
      .slice(0, 1_000);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeAdminAuditPayload(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !BLOCKED_KEYS.test(key))
        .slice(0, 40)
        .map(([key, item]) => [key, sanitizeAdminAuditPayload(item, depth + 1)]),
    );
  }

  return String(value).slice(0, 1_000);
}

export async function startAdminAudit(
  admin: AdminClient,
  input: {
    actorUserId: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    beforeData?: unknown;
    metadata?: unknown;
  },
) {
  const { data, error } = await admin
    .from("admin_audit_log")
    .insert({
      actor_user_id: input.actorUserId,
      action: input.action.slice(0, 160),
      entity_type: input.entityType.slice(0, 80),
      entity_id: input.entityId?.slice(0, 200) ?? null,
      outcome: "started",
      before_data: sanitizeAdminAuditPayload(input.beforeData ?? {}),
      metadata: sanitizeAdminAuditPayload(input.metadata ?? {}),
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data.id;
}

export async function finishAdminAudit(
  admin: AdminClient,
  auditId: string,
  input:
    | { outcome: "succeeded"; afterData?: unknown; metadata?: unknown }
    | { outcome: "failed"; error: unknown; metadata?: unknown },
) {
  const failed = input.outcome === "failed";
  const errorCode = failed
    ? input.error instanceof Error
      ? input.error.name
      : "admin_action_failed"
    : null;
  const errorMessage = failed
    ? input.error instanceof Error
      ? input.error.message
      : String(input.error)
    : null;

  const { error } = await admin
    .from("admin_audit_log")
    .update({
      outcome: input.outcome,
      after_data: sanitizeAdminAuditPayload(
        failed ? { error: errorMessage } : input.afterData ?? {},
      ),
      error_code: errorCode?.slice(0, 120) ?? null,
      ...(input.metadata === undefined ? {} : { metadata: sanitizeAdminAuditPayload(input.metadata) }),
      finished_at: new Date().toISOString(),
    })
    .eq("id", auditId);

  if (error) {
    throw error;
  }
}
