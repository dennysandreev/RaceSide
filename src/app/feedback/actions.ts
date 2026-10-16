"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";

import { type FeedbackState, validateFeedback } from "@/lib/feedback";
import { consumeIpRateLimit, getRequestIp } from "@/lib/rate-limit";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { verifyTurnstileToken } from "@/lib/turnstile";

export async function submitFeedbackAction(
  _previousState: FeedbackState,
  formData: FormData,
): Promise<FeedbackState> {
  const retryKey = Date.now();
  const feedback = validateFeedback(formData.get("message"), formData.get("contact"));
  if (!feedback.ok) {
    return { ok: false, field: feedback.field, message: feedback.error, retryKey };
  }

  const limit = await consumeIpRateLimit("feedback:submit", null, 5, 60 * 60 * 1_000);
  if (!limit.ok) {
    return { ok: false, message: "Слишком много сообщений. Попробуй снова через час.", retryKey };
  }
  if (!await verifyTurnstileToken(String(formData.get("cf-turnstile-response") ?? ""))) {
    return { ok: false, message: "Пройди проверку ещё раз и отправь сообщение.", retryKey };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { ok: false, message: "Не удалось отправить сообщение. Попробуй чуть позже.", retryKey };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const auth = supabase ? await supabase.auth.getUser() : null;
    const fingerprint = createHash("sha256").update(await getRequestIp()).digest("hex");
    const { data, error } = await admin.rpc("submit_site_feedback", {
      p_message: feedback.message,
      p_contact: feedback.contact,
      p_request_fingerprint: fingerprint,
      p_user_id: auth?.data.user?.id ?? null,
    });
    if (error || !data) {
      return {
        ok: false,
        message: error?.message.includes("report_rate_limited")
          ? "Слишком много сообщений. Попробуй снова через час."
          : "Не удалось отправить сообщение. Попробуй чуть позже.",
        retryKey,
      };
    }
  } catch {
    return { ok: false, message: "Не удалось отправить сообщение. Попробуй чуть позже.", retryKey };
  }

  revalidatePath("/admin/issues");
  return { ok: true, message: "Спасибо за обратную связь! Мы получили твоё сообщение.", retryKey };
}
