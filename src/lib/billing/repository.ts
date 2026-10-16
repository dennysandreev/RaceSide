import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { billingPriceCatalog } from "@/lib/billing/catalog";
import {
  billingFlags,
  getLavaConfig,
} from "@/lib/billing/config";
import { isOpenPendingCheckout } from "@/lib/billing/order-state";
import { cancelLavaSubscription, createLavaInvoice } from "@/lib/billing/providers/lava";
import type {
  BillingOrder,
  BillingPaymentMethod,
  BillingPriceCode,
  HostedCheckout,
} from "@/lib/billing/types";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const internationalAmountMinor: Record<BillingPriceCode, number> = {
  plus_monthly: 500,
  plus_first_year: 4990,
};

export async function createCheckout(input: {
  idempotencyKey: string;
  paymentMethod: BillingPaymentMethod;
  priceCode: BillingPriceCode;
  userId: string;
  userEmail?: string;
}): Promise<HostedCheckout> {
  if (!billingFlags.checkout) throw new Error("CHECKOUT_DISABLED");
  if (input.paymentMethod !== "lava" && input.paymentMethod !== "lava_rub")
    throw new Error("PROVIDER_DISABLED");
  if (!billingFlags.lava || !getLavaConfig()) throw new Error("LAVA_UNAVAILABLE");
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("BILLING_UNAVAILABLE");
  const price = billingPriceCatalog[input.priceCode];
  const provider = "lava";
  if (!/^[a-f0-9-]{16,64}$/i.test(input.idempotencyKey))
    throw new Error("INVALID_IDEMPOTENCY_KEY");

  const { data: prior } = await admin
    .from("billing_orders")
    .select("*")
    .eq("user_id", input.userId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (prior) {
    const existing = mapOrder(prior);
    if (existing.paymentMethod !== input.paymentMethod || existing.priceCode !== input.priceCode) throw new Error("CHECKOUT_BUSY");
    return checkoutFromOrder(existing);
  }

  if (await getUserActiveLavaSubscription(input.userId)) throw new Error("LAVA_SUBSCRIPTION_EXISTS");

  if (price.firstPurchaseOnly) {
    const { count } = await admin
      .from("billing_orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", input.userId)
      .eq("status", "paid");
    if ((count ?? 0) > 0) throw new Error("FIRST_YEAR_UNAVAILABLE");
  }

  const dbPriceCode = input.paymentMethod === "lava" ? `${input.priceCode}_international` : input.priceCode;
  const [{ data: plan }, { data: dbPrice }] = await Promise.all([
    admin
      .from("subscription_plans")
      .select("id, name")
      .eq("code", "raceside_plus")
      .eq("active", true)
      .single(),
    admin
      .from("subscription_prices")
      .select("id, amount_minor, currency, duration_months, first_purchase_only")
      .eq("code", dbPriceCode)
      .eq("active", true)
      .lte("valid_from", new Date().toISOString())
      .or(`valid_until.is.null,valid_until.gt.${new Date().toISOString()}`)
      .single(),
  ]);
  if (!plan || !dbPrice) throw new Error("BILLING_CATALOG_UNAVAILABLE");
  if (dbPrice.currency !== (input.paymentMethod === "lava_rub" ? "RUB" : "USD")) throw new Error("BILLING_CATALOG_UNAVAILABLE");
  if (Number(dbPrice.duration_months) !== price.durationMonths || Boolean(dbPrice.first_purchase_only) !== price.firstPurchaseOnly) throw new Error("BILLING_CATALOG_UNAVAILABLE");
  const amountMinor = Number(dbPrice.amount_minor);
  const currency = dbPrice.currency;
  const expectedAmountMinor = input.paymentMethod === "lava" ? internationalAmountMinor[input.priceCode] : price.amountMinor;
  if (amountMinor !== expectedAmountMinor) throw new Error("BILLING_CATALOG_UNAVAILABLE");
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("BILLING_CATALOG_UNAVAILABLE");
  const buyerEmail = input.userEmail?.trim().toLowerCase();
  if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail) || buyerEmail.length > 254) throw new Error("LAVA_EMAIL_REQUIRED");

  const now = new Date().toISOString();
  await admin
    .from("billing_orders")
    .update({
      failed_at: now,
      failure_reason: "CHECKOUT_EXPIRED",
      status: "failed",
      updated_at: now,
    })
    .eq("user_id", input.userId)
    .eq("status", "pending")
    .lte("expires_at", now);

  const { data: pendingOrder } = await admin
    .from("billing_orders")
    .select("*")
    .eq("user_id", input.userId)
    .eq("status", "pending")
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingOrder) {
    const pending = mapOrder(pendingOrder);
    if (
      pending.priceCode === input.priceCode &&
      pending.paymentMethod === input.paymentMethod
    ) {
      if (pending.provider === "lava" && !pending.checkoutUrl) {
        throw new Error("CHECKOUT_IN_PROGRESS");
      }
      return checkoutFromOrder(pending);
    }
    throw new Error("CHECKOUT_BUSY");
  }

  const orderNumber = `RS-${new Date().getUTCFullYear()}-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const providerLabel = null;
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const { data: order, error } = await admin
    .from("billing_orders")
    .insert({
      amount_minor: amountMinor,
      currency,
      buyer_email: buyerEmail,
      duration_months: price.durationMonths,
      expires_at: expiresAt,
      idempotency_key: input.idempotencyKey,
      order_number: orderNumber,
      payment_method: input.paymentMethod,
      plan_id: plan.id,
      plan_name_snapshot: plan.name,
      price_id: dbPrice.id,
      price_name_snapshot: price.label,
      provider,
      provider_label: providerLabel,
      user_id: input.userId,
    })
    .select("*")
    .single();
  if (error || !order) {
    if (error?.code === "23505") throw new Error("CHECKOUT_BUSY");
    throw new Error("BILLING_ORDER_CREATE_FAILED");
  }

  try {
    const config = getLavaConfig();
    if (!config || !buyerEmail) throw new Error("LAVA_UNAVAILABLE");
    const remote = await createLavaInvoice({
      amountMinor, apiBase: config.apiBase, apiKey: config.apiKey,
      currency: currency as "RUB" | "USD", email: buyerEmail, offerId: config.offerId,
      durationMonths: price.durationMonths,
    });
    const { data: savedOrder, error: updateError } = await admin.from("billing_orders").update({
      checkout_url: remote.checkoutUrl, provider_order_id: remote.invoiceId, lava_auto_renew: true,
      updated_at: new Date().toISOString(),
    }).eq("id", order.id).eq("status", "pending").select("id").maybeSingle();
    if (updateError || !savedOrder) throw new Error("LAVA_ORDER_SAVE_FAILED");
    return { kind: "redirect", orderNumber, url: remote.checkoutUrl };
  } catch (checkoutError) {
    await admin
      .from("billing_orders")
      .update({
        failed_at: new Date().toISOString(),
        failure_reason:
          checkoutError instanceof Error
            ? checkoutError.message
            : "CHECKOUT_FAILED",
        status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);
    throw checkoutError;
  }
}

export async function consumeBillingCheckoutRateLimit(
  userId: string,
  requestIp: string,
) {
  const admin = createSupabaseAdminClient();
  if (!admin) return false;
  const identities = [
    ["user", userId, 10],
    ["ip", requestIp, 20],
  ] as const;
  const results = await Promise.all(
    identities.map(async ([kind, value, limit]) => {
      const identityHash = createHash("sha256")
        .update(`billing:${kind}:${value}`)
        .digest("hex");
      const { data, error } = await admin.rpc("billing_consume_rate_limit", {
        p_identity_hash: identityHash,
        p_limit: limit,
        p_scope: "checkout",
        p_window_seconds: 3600,
      });
      return !error && Boolean(data?.[0]?.allowed);
    }),
  );
  return results.every(Boolean);
}

export async function getUserOrders(userId: string, limit = 20) {
  const admin = createSupabaseAdminClient();
  if (!admin) return [];
  const { data } = await admin
    .from("billing_orders")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map(mapOrder);
}

export async function getUserActiveLavaSubscription(userId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.from("billing_orders").select("*")
    .eq("user_id", userId).eq("provider", "lava").eq("lava_auto_renew", true)
    .is("lava_parent_contract_id", null).in("status", ["paid", "partially_refunded", "refunded"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error?.code === "42703") return null;
  if (error) throw error;
  return data ? mapOrder(data) : null;
}

export async function cancelUserLavaSubscription(userId: string, expectedOrderId?: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("BILLING_UNAVAILABLE");
  const target = expectedOrderId
    ? await admin.from("billing_orders").select("*").eq("id", expectedOrderId).eq("user_id", userId).eq("provider", "lava").is("lava_parent_contract_id", null).maybeSingle()
    : null;
  if (target?.error) throw target.error;
  const order = expectedOrderId ? target?.data ? mapOrder(target.data) : null : await getUserActiveLavaSubscription(userId);
  if (!order?.providerOrderId || !["paid", "partially_refunded", "refunded"].includes(order.status)) throw new Error("LAVA_SUBSCRIPTION_NOT_FOUND");
  if (!order.lavaAutoRenew && order.lavaCancelledAt) return { alreadyCancelled: true, cancelledAt: order.lavaCancelledAt };
  if (!order.lavaAutoRenew) throw new Error("LAVA_SUBSCRIPTION_NOT_FOUND");
  const config = getLavaConfig();
  if (!config) throw new Error("BILLING_UNAVAILABLE");
  const { data, error: buyerError } = await admin.from("billing_orders").select("buyer_email").eq("id", order.id).single();
  if (buyerError) throw buyerError;
  if (!data?.buyer_email) throw new Error("LAVA_SUBSCRIPTION_NOT_FOUND");
  await cancelLavaSubscription({ apiBase: config.apiBase, apiKey: config.apiKey, invoiceId: order.providerOrderId, email: data.buyer_email });
  const cancelledAt = new Date().toISOString();
  const { error } = await admin.from("billing_orders").update({ lava_auto_renew: false, lava_cancelled_at: cancelledAt, updated_at: cancelledAt }).eq("id", order.id);
  if (error) throw error;
  return { alreadyCancelled: false, cancelledAt };
}

export async function canUseFirstYearPrice(userId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return false;
  const { count } = await admin
    .from("billing_orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "paid");
  return (count ?? 0) === 0;
}

export async function getUserOrder(userId: string, orderNumber: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data } = await admin
    .from("billing_orders")
    .select("*")
    .eq("user_id", userId)
    .eq("order_number", orderNumber)
    .maybeSingle();
  return data ? mapOrder(data) : null;
}

export async function getUserLavaOrderByInvoice(userId: string, invoiceId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data } = await admin.from("billing_orders").select("*")
    .eq("user_id", userId).eq("provider", "lava").eq("provider_order_id", invoiceId).maybeSingle();
  return data ? mapOrder(data) : null;
}

export async function getInternationalPrices() {
  const admin = createSupabaseAdminClient();
  if (!admin) return {} as Partial<Record<BillingPriceCode, { amountMinor: number; currency: "USD" }>>;
  const now = new Date().toISOString();
  const { data } = await admin.from("subscription_prices")
    .select("code, amount_minor, currency")
    .in("code", ["plus_monthly_international", "plus_first_year_international"])
    .eq("active", true).lte("valid_from", now).or(`valid_until.is.null,valid_until.gt.${now}`);
  const result: Partial<Record<BillingPriceCode, { amountMinor: number; currency: "USD" }>> = {};
  for (const row of data ?? []) {
    if (row.currency !== "USD") continue;
    const code = row.code === "plus_monthly_international" ? "plus_monthly" : row.code === "plus_first_year_international" ? "plus_first_year" : null;
    if (code) result[code] = { amountMinor: Number(row.amount_minor), currency: row.currency };
  }
  return result;
}

export async function getPendingUserOrder(userId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data } = await admin
    .from("billing_orders")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? mapOrder(data) : null;
}

export async function resumeUserCheckout(userId: string, orderNumber: string) {
  const order = await getUserOrder(userId, orderNumber);
  if (!order) throw new Error("CHECKOUT_NOT_FOUND");
  if (!isOpenPendingCheckout(order)) throw new Error("CHECKOUT_CLOSED");
  return checkoutFromOrder(order);
}

export async function cancelUserCheckout(userId: string, orderNumber: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("BILLING_UNAVAILABLE");
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("billing_orders")
    .update({ expires_at: now, updated_at: now })
    .eq("user_id", userId)
    .eq("order_number", orderNumber)
    .eq("status", "pending")
    .gt("expires_at", now)
    .select("*")
    .maybeSingle();
  if (error) throw new Error("CHECKOUT_CANCEL_FAILED");
  if (data) return "cancelled" as const;

  const order = await getUserOrder(userId, orderNumber);
  if (order?.status === "paid") return "paid" as const;
  return "closed" as const;
}

export async function findOrderByProviderReference(
  provider: "tribute" | "yoomoney" | "lava",
  reference: string,
) {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const column =
    provider === "yoomoney" ? "provider_label" : "provider_order_id";
  const { data } = await admin
    .from("billing_orders")
    .select("*")
    .eq("provider", provider)
    .eq(column, reference)
    .maybeSingle();
  return data ? mapOrder(data) : null;
}

function checkoutFromOrder(order: BillingOrder): HostedCheckout {
  if (order.provider === "lava") {
    if (!order.checkoutUrl) throw new Error("CHECKOUT_NOT_READY");
    return {
      kind: "redirect",
      orderNumber: order.orderNumber,
      url: order.checkoutUrl,
    };
  }
  throw new Error("PROVIDER_DISABLED");
}

function mapOrder(row: Record<string, unknown>): BillingOrder {
  return {
    amountMinor: Number(row.amount_minor),
    checkoutUrl: typeof row.checkout_url === "string" ? row.checkout_url : null,
    createdAt: String(row.created_at),
    currency: String(row.currency),
    durationMonths: Number(row.duration_months),
    expiresAt: String(row.expires_at),
    id: String(row.id),
    orderNumber: String(row.order_number),
    paidAt: typeof row.paid_at === "string" ? row.paid_at : null,
    paymentMethod: row.payment_method as BillingPaymentMethod,
    priceCode: Number(row.duration_months) === 12 ? "plus_first_year" : "plus_monthly",
    provider: row.provider as BillingOrder["provider"],
    providerLabel:
      typeof row.provider_label === "string" ? row.provider_label : null,
    providerOrderId:
      typeof row.provider_order_id === "string" ? row.provider_order_id : null,
    lavaAutoRenew: row.lava_auto_renew === true,
    lavaCancelledAt: typeof row.lava_cancelled_at === "string" ? row.lava_cancelled_at : null,
    refundedAmountMinor: Number(row.refunded_amount_minor ?? 0),
    status: row.status as BillingOrder["status"],
    userId: String(row.user_id),
  };
}
