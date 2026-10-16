import { sendSupportTelegramMessage } from "./support-telegram.mjs";

export function formatSiteFeedbackMessage(report) {
  return [
    "Новое пожелание для RaceSide",
    "",
    report.message,
    "",
    `Контакт: ${report.contact || "не оставлен"}`,
    `Сообщение: ${report.id.slice(0, 8)}`,
  ].join("\n");
}

export async function dispatchSiteFeedback(client, options = {}) {
  const send = options.send ?? ((input) => sendSupportTelegramMessage(input, { client }));
  if (!options.send && (!process.env.TELEGRAM_SUPPORT_BOT_TOKEN?.trim()
    || (!process.env.TELEGRAM_SUPPORT_CHAT_ID?.trim() && !process.env.TELEGRAM_SUPPORT_USERNAME?.trim()))) {
    return { itemsProcessed: 0, sent: 0, failed: 0, skipped: "support_not_configured" };
  }
  const { data: reports, error } = await client.rpc("claim_site_feedback_delivery");
  if (error) throw error;

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://raceside.online").replace(/\/$/, "");
  let sent = 0;
  let failed = 0;
  for (const report of reports ?? []) {
    let delivery;
    try {
      delivery = await send({
        text: formatSiteFeedbackMessage(report),
        parseMode: null,
        replyMarkup: {
          inline_keyboard: [[{ text: "Открыть обратную связь", url: `${siteUrl}/admin/issues#message-${report.id}` }]],
        },
      });
    } catch {
      // Never persist exception text: a fetch error may contain the bot token.
      delivery = { ok: false, status: "failed", reason: "telegram_unavailable" };
    }
    const retryDelay = delivery.status === "not_configured"
      ? 60 * 60_000
      : Math.min(60 * 60_000, 60_000 * 2 ** Math.min(report.telegram_attempts - 1, 6));
    const { error: updateError } = await client.from("user_error_reports").update({
      telegram_status: delivery.status,
      telegram_error: delivery.ok ? null : delivery.reason,
      telegram_sent_at: delivery.ok ? new Date().toISOString() : null,
      telegram_retry_at: new Date(Date.now() + retryDelay).toISOString(),
    }).eq("id", report.id).eq("telegram_last_attempt_at", report.telegram_last_attempt_at);
    if (updateError) throw updateError;
    if (delivery.ok) sent += 1;
    else failed += 1;
  }
  return { itemsProcessed: (reports ?? []).length, sent, failed };
}
