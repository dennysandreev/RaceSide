import { timingSafeEqual } from "node:crypto";

import { parseMinorUnits } from "../money.ts";

export function verifyLavaWebhook(key: string | null, secret: string) {
  if (!key || !secret) return false;
  const actual = Buffer.from(key);
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type LavaEvent =
  | { kind: "payment"; type: "payment.success" | "payment.failed"; invoiceId: string; amountMinor: number; currency: "RUB" | "USD" | "EUR"; eventId: string; occurredAt: string; reason: string | null }
  | { kind: "renewal"; type: "subscription.recurring.payment.success" | "subscription.recurring.payment.failed"; invoiceId: string; parentInvoiceId: string; amountMinor: number; currency: "RUB" | "USD" | "EUR"; eventId: string; occurredAt: string; reason: string | null }
  | { kind: "cancelled"; type: "subscription.cancelled"; invoiceId: string; email: string; eventId: string; occurredAt: string }
  | { kind: "adjustment"; type: "refund.success" | "chargeback.initiated"; eventId: string; amountMinor: number; currency: "RUB" | "USD" | "EUR"; customerEmail: string; occurredAt: string; reason: string | null; refundType: string | null }
  | { kind: "ignored"; type: string };

export function parseLavaEvent(rawBody: string): LavaEvent {
  const data: unknown = JSON.parse(rawBody);
  if (!isRecord(data)) throw new Error("LAVA_EVENT_INVALID");
  if (data.eventType === "payment.success" || data.eventType === "payment.failed") {
    const invoiceId = data.contractId;
    const amountMinor = parseLavaAmount(data.amount);
    if (typeof invoiceId !== "string" || !/^[a-f0-9-]{36}$/i.test(invoiceId) || !amountMinor || !isCurrency(data.currency)) throw new Error("LAVA_EVENT_INVALID");
    const occurredAt = validDate(data.timestamp);
    return { kind: "payment", type: data.eventType, invoiceId: invoiceId.toLowerCase(), amountMinor, currency: data.currency, eventId: `${data.eventType}:${invoiceId.toLowerCase()}`, occurredAt, reason: typeof data.errorMessage === "string" ? data.errorMessage.slice(0, 160) : null };
  }
  if (data.eventType === "subscription.recurring.payment.success" || data.eventType === "subscription.recurring.payment.failed") {
    const invoiceId = data.contractId;
    const parentInvoiceId = data.parentContractId;
    const amountMinor = parseLavaAmount(data.amount);
    if (!isUuid(invoiceId) || !isUuid(parentInvoiceId) || !amountMinor || !isCurrency(data.currency)) throw new Error("LAVA_EVENT_INVALID");
    return { kind: "renewal", type: data.eventType, invoiceId: invoiceId.toLowerCase(), parentInvoiceId: parentInvoiceId.toLowerCase(), amountMinor, currency: data.currency, eventId: `${data.eventType}:${invoiceId.toLowerCase()}`, occurredAt: validDate(data.timestamp), reason: typeof data.errorMessage === "string" ? data.errorMessage.slice(0, 160) : null };
  }
  if (data.eventType === "subscription.cancelled") {
    if (!isUuid(data.contractId) || !isRecord(data.buyer) || typeof data.buyer.email !== "string") throw new Error("LAVA_EVENT_INVALID");
    const occurredAt = validDate(data.cancelledAt);
    return { kind: "cancelled", type: data.eventType, invoiceId: data.contractId.toLowerCase(), email: data.buyer.email.toLowerCase(), eventId: `${data.eventType}:${data.contractId.toLowerCase()}:${occurredAt}`, occurredAt };
  }
  if (data.event_type === "refund.success" || data.event_type === "chargeback.initiated") {
    if (typeof data.event_id !== "string" || !/^[a-f0-9-]{36}$/i.test(data.event_id) || !isRecord(data.data)) throw new Error("LAVA_EVENT_INVALID");
    const amountMinor = parseLavaAmount(data.data.amount);
    if (!amountMinor || !isCurrency(data.data.currency) || typeof data.data.customer_email !== "string") throw new Error("LAVA_EVENT_INVALID");
    return { kind: "adjustment", type: data.event_type, eventId: data.event_id, amountMinor, currency: data.data.currency, customerEmail: data.data.customer_email, occurredAt: validDate(data.created_at), reason: typeof data.data.reason_description === "string" ? data.data.reason_description.slice(0, 160) : null, refundType: typeof data.data.refund_type === "string" ? data.data.refund_type : null };
  }
  return { kind: "ignored", type: typeof data.eventType === "string" ? data.eventType : typeof data.event_type === "string" ? data.event_type : "unknown" };
}

function parseLavaAmount(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  try { return parseMinorUnits(String(value)); } catch { return null; }
}

function validDate(value: unknown) {
  const date = typeof value === "string" ? new Date(value) : new Date(NaN);
  if (Number.isNaN(date.getTime())) throw new Error("LAVA_EVENT_DATE_INVALID");
  return date.toISOString();
}

function isCurrency(value: unknown): value is "RUB" | "USD" | "EUR" { return value === "RUB" || value === "USD" || value === "EUR"; }
function isUuid(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
