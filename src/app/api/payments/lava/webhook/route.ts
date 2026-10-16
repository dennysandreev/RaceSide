import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { invalidateSubscriptionAccess } from "@/lib/billing/access";
import { getLavaConfig } from "@/lib/billing/config";
import { getLavaInvoice, parseLavaEvent, verifyLavaWebhook, type LavaEvent } from "@/lib/billing/providers/lava";
import { findOrderByProviderReference } from "@/lib/billing/repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") return reply("unsupported content type", 415);
  const config = getLavaConfig();
  if (!config) return reply("billing unavailable", 503);
  if (!verifyLavaWebhook(request.headers.get("x-api-key"), config.webhookSecret)) return reply("unauthorized", 403);
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > 64 * 1024) return reply("payload too large", 413);
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  let event: LavaEvent | null = null;
  try {
    event = parseLavaEvent(rawBody);
    if (event.kind === "ignored") return reply("OK", 200);
    const admin = createSupabaseAdminClient();
    if (!admin) return reply("billing unavailable", 503);

    if (event.kind === "renewal") {
      if (event.type === "subscription.recurring.payment.failed") {
        await recordEvent(event, payloadHash, "processed", event.parentInvoiceId, event.reason);
        return reply("OK", 200);
      }
      const remote = await getLavaInvoice({ apiBase: config.apiBase, apiKey: config.apiKey, invoiceId: event.invoiceId });
      if (String(remote.status).toUpperCase() !== "COMPLETED" || remote.type !== "SUBSCRIPTION_RENEWAL" || remote.parentInvoiceId !== event.parentInvoiceId || remote.amountMinor !== event.amountMinor || remote.currency !== event.currency) throw new Error("LAVA_RENEWAL_MISMATCH");
      const { data: orderId, error } = await admin.rpc("billing_apply_lava_renewal", {
        p_parent_contract_id: event.parentInvoiceId, p_invoice_id: event.invoiceId,
        p_amount_minor: event.amountMinor, p_fee_minor: remote.feeMinor,
        p_currency: event.currency, p_occurred_at: remote.occurredAt || event.occurredAt,
        p_payload_hash: payloadHash,
      });
      if (error) throw error;
      const { data: order } = await admin.from("billing_orders").select("user_id").eq("id", orderId).single();
      if (order) invalidateSubscriptionAccess(order.user_id);
      return reply("OK", 200);
    }

    if (event.kind === "cancelled") {
      const { error } = await admin.rpc("billing_mark_lava_cancelled", {
        p_invoice_id: event.invoiceId, p_email: event.email, p_event_id: event.eventId,
        p_occurred_at: event.occurredAt, p_payload_hash: payloadHash,
      });
      if (error) throw error;
      return reply("OK", 200);
    }

    if (event.kind === "payment") {
      const order = await findOrderByProviderReference("lava", event.invoiceId);
      if (!order || order.providerOrderId !== event.invoiceId) throw new Error("LAVA_ORDER_NOT_FOUND");
      if (order.amountMinor !== event.amountMinor || order.currency !== event.currency) throw new Error("LAVA_AMOUNT_MISMATCH");
      if (event.type === "payment.failed") {
        const { error } = await admin.from("billing_orders").update({
          failed_at: event.occurredAt, failure_reason: "PROVIDER_PAYMENT_FAILED", status: "failed", updated_at: new Date().toISOString(),
        }).eq("id", order.id).eq("status", "pending");
        if (error) throw error;
        await recordEvent(event, payloadHash, "processed", order.id, event.reason);
        return reply("OK", 200);
      }
      const remote = await getLavaInvoice({ apiBase: config.apiBase, apiKey: config.apiKey, invoiceId: event.invoiceId });
      if (String(remote.status).toUpperCase() !== "COMPLETED" || remote.amountMinor !== order.amountMinor || remote.currency !== order.currency || (order.lavaAutoRenew && remote.type !== "SUBSCRIPTION_FIRST_INVOICE")) throw new Error("LAVA_INVOICE_MISMATCH");
      const { error } = await admin.rpc("billing_apply_payment", {
        p_order_id: order.id, p_provider: "lava", p_provider_event_id: event.eventId,
        p_provider_event_type: event.type, p_provider_reference: event.invoiceId,
        p_provider_transaction_id: event.invoiceId, p_payment_method: order.paymentMethod,
        p_gross_amount_minor: order.amountMinor, p_net_amount_minor: order.amountMinor - remote.feeMinor,
        p_currency: order.currency, p_occurred_at: remote.occurredAt || event.occurredAt,
        p_payload_hash: payloadHash, p_safe_payload: { invoiceId: event.invoiceId },
      });
      if (error) throw error;
      invalidateSubscriptionAccess(order.userId);
      return reply("OK", 200);
    }

    // Lava adjustment events omit the invoice ID. Never guess when several purchases match.
    const { data: priorEvent, error: priorError } = await admin.from("billing_notification_events")
      .select("status").eq("provider", "lava").eq("provider_event_id", event.eventId).maybeSingle();
    if (priorError) throw priorError;
    if (priorEvent?.status === "processed") return reply("OK", 200);
    const { data: matches, error: lookupError } = await admin.from("billing_orders")
      .select("id, user_id, amount_minor, refunded_amount_minor, currency, status")
      .eq("provider", "lava").eq("buyer_email", event.customerEmail.toLowerCase())
      .eq("currency", event.currency).in("status", ["paid", "partially_refunded"])
      .lte("paid_at", event.occurredAt).limit(2);
    if (lookupError) throw lookupError;
    if (matches?.length !== 1) throw new Error("LAVA_ADJUSTMENT_AMBIGUOUS");
    const order = matches[0];
    if (event.amountMinor > Number(order.amount_minor) - Number(order.refunded_amount_minor)) throw new Error("LAVA_ADJUSTMENT_AMOUNT_MISMATCH");
    const { data: applied, error } = await admin.rpc("billing_apply_lava_adjustment", {
      p_order_id: order.id, p_event_id: event.eventId, p_event_type: event.type,
      p_amount_minor: event.amountMinor, p_currency: event.currency,
      p_payload_hash: payloadHash, p_safe_payload: { reason: event.reason, refundType: event.refundType },
    });
    if (error) throw error;
    if (event.type === "refund.success") invalidateSubscriptionAccess(order.user_id);
    if (event.type === "chargeback.initiated" && applied) await notifyAdminOfChargeback(order.id, event);
    return reply("OK", 200);
  } catch (error) {
    await recordEvent(event, payloadHash, "failed", null, safeError(error));
    console.error("billing_lava_webhook_failed", safeError(error));
    return reply("processing failed", 422);
  }
}

async function recordEvent(event: LavaEvent | null, hash: string, status: "failed" | "processed", reference: string | null, reason: string | null) {
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  const id = event && event.kind !== "ignored" ? event.eventId : `failed:${hash}`;
  const { error } = await admin.from("billing_notification_events").upsert({
    provider: "lava", provider_event_id: id, provider_event_type: event?.type ?? "unknown",
    provider_reference: reference, signature_valid: true, status, payload_hash: hash,
    safe_payload: {}, last_error: reason,
    processed_at: status === "processed" ? new Date().toISOString() : null,
  }, { onConflict: "provider,provider_event_id" });
  if (error) throw error;
}

async function notifyAdminOfChargeback(orderId: string, event: Extract<LavaEvent, { kind: "adjustment" }>) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.BILLING_EMAIL_FROM?.trim() || process.env.AUTH_EMAIL_FROM?.trim();
  const recipients = process.env.ADMIN_EMAILS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  if (!apiKey || !from || !recipients.length) return;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(8_000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: recipients, subject: "RaceSide: открыт спор по оплате", text: `Lava.top сообщил о chargeback. Заказ: ${orderId}. Сумма: ${event.amountMinor / 100} ${event.currency}. Событие: ${event.eventId}. Проверьте раздел подписок в админке.` }),
    });
    if (!response.ok) console.error("billing_lava_chargeback_alert_failed", orderId);
  } catch { console.error("billing_lava_chargeback_alert_failed", orderId); }
}

function reply(body: string, status: number) { return new NextResponse(body, { status, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } }); }
function safeError(error: unknown) { return error instanceof Error ? error.message.slice(0, 160) : "unknown"; }
