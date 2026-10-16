import "server-only";

import type { PaymentProvider } from "@/lib/billing/types";
import { verifyRawBodyHmac } from "@/lib/billing/signatures";

export const tributeProvider: PaymentProvider = {
  capabilities: {
    apiRefund: true,
    automaticRenewal: false,
    remoteStatusLookup: true,
  },
  code: "tribute",
};

export type TributeShopOrder = {
  amount: number;
  currency: "rub";
  paymentUrl: string | null;
  status: "failed" | "paid" | "pending" | "prepaid";
  uuid: string;
  webappPaymentUrl?: string;
};

export type TributeWebhookEvent =
  | { amountMinor: number; eventId: string; eventType: string; kind: "failed"; orderId: string }
  | { amountMinor: number; eventId: string; eventType: string; kind: "refunded"; orderId: string }
  | { eventType: string; kind: "ignored"; orderId: string }
  | {
      currency: "RUB";
      eventId: string;
      eventType: string;
      grossAmountMinor: number;
      kind: "paid";
      netAmountMinor: number;
      occurredAt: string;
      orderId: string;
      paymentMethod: "tribute";
      transactionId: string;
    };

export function verifyTributeWebhook(rawBody: string, signature: string, apiKey: string) {
  return verifyRawBodyHmac(rawBody, signature, apiKey);
}

export function parseTributeWebhook(rawBody: string): TributeWebhookEvent {
  const event = JSON.parse(rawBody) as unknown;
  if (!isRecord(event) || typeof event.name !== "string" || !isRecord(event.payload)) {
    throw new Error("INVALID_TRIBUTE_EVENT");
  }
  const payload = event.payload;
  const orderId = stringValue(payload.uuid);
  const amount = integerValue(payload.amount);
  const currency = stringValue(payload.currency).toLowerCase();
  if (!orderId || !amount || currency !== "rub") throw new Error("INVALID_TRIBUTE_PAYMENT");
  const createdAt = typeof event.created_at === "string" ? new Date(event.created_at) : new Date();
  if (Number.isNaN(createdAt.getTime())) throw new Error("INVALID_TRIBUTE_DATE");
  if (event.name === "shop_order_payment_failed") {
    return { eventId: `${event.name}:${orderId}`, eventType: event.name, kind: "failed" as const, amountMinor: amount, orderId };
  }
  if (event.name === "shop_order_refunded") {
    return { eventId: `${event.name}:${orderId}`, eventType: event.name, kind: "refunded" as const, amountMinor: amount, orderId };
  }
  if (event.name !== "shop_order" && event.name !== "shop_order_payment_received") {
    return { kind: "ignored" as const, eventType: event.name, orderId };
  }
  if (payload.status !== "paid") throw new Error("TRIBUTE_PAYMENT_NOT_PAID");
  const feeMinor = Math.max(0, integerValue(payload.fee));
  const transactionId = payload.transactionId !== undefined
    ? String(payload.transactionId)
    : orderId;
  return {
    currency: "RUB" as const,
    eventId: `${event.name}:${orderId}:${transactionId}`,
    eventType: event.name,
    grossAmountMinor: amount,
    kind: "paid" as const,
    netAmountMinor: Math.max(0, amount - feeMinor),
    occurredAt: createdAt.toISOString(),
    orderId,
    paymentMethod: "tribute" as const,
    transactionId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function integerValue(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
}
