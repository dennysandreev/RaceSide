import "server-only";

import type { PaymentProvider } from "@/lib/billing/types";
import { parseMinorUnits } from "@/lib/billing/money";

export { parseLavaEvent, verifyLavaWebhook } from "@/lib/billing/providers/lava-event";
export type { LavaEvent } from "@/lib/billing/providers/lava-event";

export const lavaProvider: PaymentProvider = {
  code: "lava",
  capabilities: { automaticRenewal: true, apiRefund: false, remoteStatusLookup: true },
};

export async function createLavaInvoice(input: {
  amountMinor: number;
  apiBase: string;
  apiKey: string;
  currency: "RUB" | "USD";
  email: string;
  offerId: string;
  durationMonths: 1 | 12;
}) {
  const response = await fetch(`${input.apiBase}/api/v3/invoice`, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-Api-Key": input.apiKey },
    body: JSON.stringify({
      email: input.email,
      offerId: input.offerId,
      currency: input.currency,
      periodicity: input.durationMonths === 1 ? "MONTHLY" : "PERIOD_YEAR",
      paymentProvider: input.currency === "RUB" ? "SMART_GLOCAL" : "UNLIMINT",
      paymentMethod: "CARD",
      buyerLanguage: "RU",
    }),
  });
  const data: unknown = await response.json().catch(() => null);
  if (response.status === 400 && isRecord(data) && data.error === "Incorrect email to purchase") {
    throw new Error("LAVA_EMAIL_REJECTED");
  }
  if (!response.ok || !isRecord(data)) {
    throw new Error("LAVA_INVOICE_FAILED");
  }
  const invoiceId = typeof data.id === "string" ? data.id : data.invoiceId;
  const paymentUrl = typeof data.paymentUrl === "string" ? data.paymentUrl : data.checkoutUrl;
  if (typeof invoiceId !== "string" || !/^[a-f0-9-]{36}$/i.test(invoiceId) || typeof paymentUrl !== "string") throw new Error("LAVA_INVOICE_FAILED");
  if (!isRecord(data.amountTotal) || parseLavaAmount(data.amountTotal.amount) !== input.amountMinor || data.amountTotal.currency !== input.currency) {
    throw new Error("LAVA_INVOICE_PRICE_MISMATCH");
  }
  const checkout = new URL(paymentUrl);
  if (checkout.protocol !== "https:" || (checkout.hostname !== "lava.top" && !checkout.hostname.endsWith(".lava.top"))) {
    throw new Error("LAVA_CHECKOUT_URL_INVALID");
  }
  const invoice = await getLavaInvoice({ apiBase: input.apiBase, apiKey: input.apiKey, invoiceId: invoiceId.toLowerCase(), waitForCreation: true });
  if (invoice.type !== "SUBSCRIPTION_FIRST_INVOICE" || invoice.amountMinor !== input.amountMinor || invoice.currency !== input.currency) {
    throw new Error("LAVA_INVOICE_PRICE_MISMATCH");
  }
  return { invoiceId: invoiceId.toLowerCase(), checkoutUrl: checkout.toString() };
}

export async function getLavaInvoice(input: { apiBase: string; apiKey: string; invoiceId: string; waitForCreation?: boolean }) {
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    response = await fetch(`${input.apiBase}/api/v2/invoices/${encodeURIComponent(input.invoiceId)}`, {
      cache: "no-store",
      headers: { Accept: "application/json", "X-Api-Key": input.apiKey },
      signal: AbortSignal.timeout(8_000),
    });
    // A newly created foreign-card invoice may not yet be visible in the read API.
    if (!input.waitForCreation || response.status !== 404 || attempt >= 3) break;
    await response.arrayBuffer();
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(data) || typeof data.id !== "string" || data.id.toLowerCase() !== input.invoiceId || !isRecord(data.receipt)) {
    throw new Error("LAVA_INVOICE_LOOKUP_FAILED");
  }
  const amountMinor = parseLavaAmount(data.receipt.amount);
  const feeMinor = parseLavaAmount(data.receipt.fee) ?? 0;
  const currency = data.receipt.currency;
  if (!amountMinor || feeMinor > amountMinor || (currency !== "RUB" && currency !== "USD" && currency !== "EUR")) throw new Error("LAVA_INVOICE_INVALID");
  const parentInvoiceId = isRecord(data.parentInvoice) && typeof data.parentInvoice.id === "string" ? data.parentInvoice.id.toLowerCase() : null;
  return { amountMinor, feeMinor, currency, status: data.status, type: data.type, parentInvoiceId, occurredAt: typeof data.datetime === "string" ? data.datetime : null };
}

export async function cancelLavaSubscription(input: { apiBase: string; apiKey: string; invoiceId: string; email: string }) {
  const url = new URL("/api/v1/subscriptions", input.apiBase);
  url.searchParams.set("contractId", input.invoiceId);
  url.searchParams.set("email", input.email);
  const response = await fetch(url, { method: "DELETE", cache: "no-store", signal: AbortSignal.timeout(12_000), headers: { "X-Api-Key": input.apiKey } });
  if (response.status !== 204 && response.status !== 404) throw new Error("LAVA_CANCEL_FAILED");
}

function parseLavaAmount(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  try { return parseMinorUnits(String(value)); } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
