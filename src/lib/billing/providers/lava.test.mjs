import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as nodeCrypto from "node:crypto";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";

import { isOpenPendingCheckout } from "../order-state.ts";
import { parseMinorUnits } from "../money.ts";
import { parseLavaEvent, verifyLavaWebhook } from "./lava-event.ts";

const invoiceId = "cf82e620-7c40-48ad-a627-dcab233e42d3";
const parentId = "48f2bc4d-e8a2-4232-bdc8-f3a320410180";

function loadModule(path, dependencies, globals = {}) {
  const context = vm.createContext({ exports: {}, URL, AbortSignal, Buffer, setTimeout: (callback) => callback(), console: { error() {} }, ...globals,
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
      return dependencies[name];
    },
  });
  vm.runInContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  return context.exports;
}

function provider(fetch) {
  return loadModule("./lava.ts", { "server-only": {}, "@/lib/billing/money": { parseMinorUnits },
    "@/lib/billing/providers/lava-event": { parseLavaEvent, verifyLavaWebhook } }, { fetch });
}

function remoteInvoice(currency = "RUB", amount = 390, type = "SUBSCRIPTION_FIRST_INVOICE") {
  return { id: invoiceId, type, status: "IN_PROGRESS", receipt: { amount, currency, fee: 0 }, parentInvoice: { id: invoiceId } };
}

test("Lava checkout accepts the actual amountTotal response and verifies the first subscription invoice", async () => {
  for (const [currency, durationMonths, amountMinor] of [["RUB", 1, 39000], ["RUB", 12, 390000], ["USD", 1, 500], ["USD", 12, 4990]]) {
    const calls = [];
    const lava = provider(async (url, options) => {
      calls.push({ url, options });
      return Response.json(options.method === "POST"
        ? { id: invoiceId, status: "new", amountTotal: { amount: amountMinor / 100, currency }, paymentUrl: "https://app.lava.top/payment" }
        : remoteInvoice(currency, amountMinor / 100));
    });
    const result = await lava.createLavaInvoice({ apiBase: "https://gate.lava.top", apiKey: "test", email: "buyer@example.com", offerId: parentId, currency, durationMonths, amountMinor });
    assert.equal(result.invoiceId, invoiceId);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://gate.lava.top/api/v3/invoice");
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.paymentMethod, "CARD");
    assert.equal(body.paymentProvider, currency === "RUB" ? "SMART_GLOCAL" : "UNLIMINT");
    assert.equal(body.periodicity, durationMonths === 1 ? "MONTHLY" : "PERIOD_YEAR");
    assert.equal(calls[1].url, `https://gate.lava.top/api/v2/invoices/${invoiceId}`);
  }
});

test("Lava checkout rejects a changed price, ordinary invoice or untrusted redirect", async () => {
  for (const variant of ["amount", "currency", "ordinary", "url"]) {
    const lava = provider(async (_url, options) => Response.json(options.method === "POST"
      ? { id: invoiceId, amountTotal: { amount: variant === "amount" ? 391 : 390, currency: variant === "currency" ? "USD" : "RUB" }, paymentUrl: variant === "url" ? "https://example.com/pay" : "https://app.lava.top/payment" }
      : remoteInvoice("RUB", 390, variant === "ordinary" ? "INVOICE" : "SUBSCRIPTION_FIRST_INVOICE")));
    await assert.rejects(lava.createLavaInvoice({ apiBase: "https://gate.lava.top", apiKey: "test", email: "buyer@example.com", offerId: parentId, currency: "RUB", durationMonths: 1, amountMinor: 39000 }));
  }
});

test("Lava checkout distinguishes a rejected buyer email from other provider failures", async () => {
  const input = { apiBase: "https://gate.lava.top", apiKey: "test", email: "buyer@example.com", offerId: parentId, currency: "RUB", durationMonths: 1, amountMinor: 39000 };
  for (const [status, error, expected] of [
    [400, "Incorrect email to purchase", "LAVA_EMAIL_REJECTED"],
    [400, "Invalid offer", "LAVA_INVOICE_FAILED"],
    [500, "Incorrect email to purchase", "LAVA_INVOICE_FAILED"],
  ]) {
    const lava = provider(async () => Response.json({ error }, { status }));
    await assert.rejects(lava.createLavaInvoice(input), { message: expected });
  }
});

test("Checkout offers email recovery and uses the explicitly supplied payment email", async () => {
  const emails = [];
  const actions = loadModule("../../../app/plus/actions.ts", {
    "next/cache": { revalidatePath() {} },
    "@/lib/auth": { requireUser: async () => ({ id: "user-1", email: "account@example.com" }) },
    "@/lib/billing/config": { isTrustedBillingOrigin: () => true },
    "@/lib/billing/repository": {
      consumeBillingCheckoutRateLimit: async () => true,
      createCheckout: async (input) => {
        emails.push(input.userEmail);
        if (input.userEmail === "account@example.com") throw new Error("LAVA_EMAIL_REJECTED");
        return { kind: "redirect", orderNumber: "order-1", url: "https://app.lava.top/payment" };
      },
    },
    "@/lib/rate-limit": { consumeRateLimit: () => ({ ok: true }), getRequestIp: async () => "127.0.0.1" },
    "next/headers": { headers: async () => new Headers() },
  }, { Error });
  const form = new FormData();
  form.set("priceCode", "plus_monthly");
  form.set("paymentMethod", "lava_rub");
  form.set("idempotencyKey", invoiceId);
  const rejected = await actions.startCheckout({}, form);
  assert.equal(rejected.emailRejected, true);
  assert.match(rejected.error, /Lava.top не принимает этот email/);
  form.set("email", "payment@example.com");
  const recovered = await actions.startCheckout(rejected, form);
  assert.equal(recovered.checkout.url, "https://app.lava.top/payment");
  assert.deepEqual(emails, ["account@example.com", "payment@example.com"]);
});

test("Checkout shows the payment email before any Lava error, prefilled from the account", () => {
  const effects = [];
  const { PlusCheckout } = loadModule("../../../components/racemate/plus-checkout.tsx", {
    "react/jsx-runtime": jsxRuntime,
    react: {
      useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
      useActionState: (_action, initial) => [initial, () => {}, false],
      useEffect: (effect) => effects.push(effect),
      useMemo: (callback) => callback(),
      useRef: (current) => ({ current }),
    },
    "next/link": { default: () => null },
    "next/image": { default: () => null },
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "lucide-react": {},
    "@/app/plus/actions": { startCheckout() {}, cancelCheckout() {} },
    "@/components/ui/button": { Button: () => null },
    "@/lib/utils": { cn: (...classes) => classes.filter(Boolean).join(" ") },
  }, { crypto: { randomUUID: () => invoiceId } });
  function findEmail(element) {
    if (!element || typeof element !== "object") return undefined;
    if (element.type === "input" && element.props.name === "email") return element;
    const children = element.props?.children;
    return (Array.isArray(children) ? children.flat(Infinity) : [children]).map(findEmail).find(Boolean);
  }
  const base = { accountEmail: "account@example.com", signedIn: true, activeSubscription: false,
    recurringSubscription: false, pendingOrder: null, lava: true, tribute: true,
    initialPriceCode: "plus_monthly", internationalPrices: { plus_monthly: { amountMinor: 500, currency: "USD" } } };
  for (const initialPaymentOption of ["russian_card", "international_card"]) {
    effects.length = 0;
    const form = PlusCheckout({ ...base, initialPaymentOption });
    let resetPrevented = false;
    let resetHandler;
    const formNode = { ownerDocument: {
      addEventListener(name, handler) { assert.equal(name, "reset"); resetHandler = handler; },
      removeEventListener(name, handler) { assert.equal(name, "reset"); assert.equal(handler, resetHandler); },
    } };
    form.props.ref.current = formNode;
    const cleanups = effects.map((effect) => effect()).filter(Boolean);
    resetHandler({ target: {}, preventDefault() { resetPrevented = true; } });
    assert.equal(resetPrevented, false, "Other forms must not be affected");
    resetHandler({ target: formNode, preventDefault() { resetPrevented = true; } });
    assert.equal(resetPrevented, true, "Action completion must not clear the selected period or payment email");
    cleanups.forEach((cleanup) => cleanup());
    const email = findEmail(form);
    assert.equal(email.props.defaultValue, "account@example.com");
    assert.equal(email.props.type, "email");
    assert.equal(email.props.required, true);
  }
  assert.equal(findEmail(PlusCheckout({ ...base, initialPaymentOption: "russian_card", accountEmail: null })).props.defaultValue, "");
  for (const overrides of [{ signedIn: false }, { initialPriceCode: undefined }, { initialPaymentOption: "crypto" }]) {
    assert.equal(findEmail(PlusCheckout({ ...base, initialPaymentOption: "russian_card", ...overrides })), undefined);
  }
});

test("Lava retries only a newly created invoice's temporary 404 and stops after four lookups", async () => {
  for (const available of [true, false]) {
    let lookups = 0;
    const lava = provider(async (_url, options) => {
      if (options.method === "POST") return Response.json({ id: invoiceId, amountTotal: { amount: 5, currency: "USD" }, paymentUrl: "https://app.lava.top/payment" });
      lookups++;
      return available && lookups === 2 ? Response.json(remoteInvoice("USD", 5)) : Response.json({ error: "not found" }, { status: 404 });
    });
    const input = { apiBase: "https://gate.lava.top", apiKey: "test", email: "buyer@example.com", offerId: parentId, currency: "USD", durationMonths: 1, amountMinor: 500 };
    if (available) assert.equal((await lava.createLavaInvoice(input)).invoiceId, invoiceId);
    else await assert.rejects(lava.createLavaInvoice(input), /LAVA_INVOICE_LOOKUP_FAILED/);
    assert.equal(lookups, available ? 2 : 4);
  }
});

test("Lava webhook accepts first and renewal invoice types and rejects a mismatched renewal parent", async () => {
  for (const [kind, type, remoteParent, expected] of [
    ["payment.success", "SUBSCRIPTION_FIRST_INVOICE", invoiceId, 200],
    ["payment.success", "INVOICE", invoiceId, 422],
    ["subscription.recurring.payment.success", "SUBSCRIPTION_RENEWAL", parentId, 200],
    ["subscription.recurring.payment.success", "SUBSCRIPTION_RENEWAL", invoiceId, 422],
  ]) {
    const rpcCalls = [];
    const admin = { rpc: async (name, args) => {
      if (name === "billing_apply_payment") assert.equal(args.p_payment_method, "lava_rub");
      rpcCalls.push(name); return { data: "order-1", error: null };
    },
      from: () => ({ upsert: async () => ({ error: null }), select: () => ({ eq: () => ({ single: async () => ({ data: { user_id: "user-1" } }) }) }) }) };
    const route = loadModule("../../../app/api/payments/lava/webhook/route.ts", {
      "node:crypto": await import("node:crypto"),
      "next/server": { NextResponse: Response },
      "@/lib/billing/access": { invalidateSubscriptionAccess() {} },
      "@/lib/billing/config": { getLavaConfig: () => ({ apiBase: "https://gate.lava.top", apiKey: "test", webhookSecret: "secret" }) },
      "@/lib/billing/providers/lava": { parseLavaEvent, verifyLavaWebhook, getLavaInvoice: async () => ({ status: "COMPLETED", type, amountMinor: 39000, feeMinor: 0, currency: "RUB", parentInvoiceId: remoteParent }) },
      "@/lib/billing/repository": { findOrderByProviderReference: async () => ({ id: "order-1", providerOrderId: invoiceId, paymentMethod: "lava_rub", amountMinor: 39000, currency: "RUB", lavaAutoRenew: true, userId: "user-1" }) },
      "@/lib/supabase/server": { createSupabaseAdminClient: () => admin },
    });
    const response = await route.POST(new Request("https://example.com/webhook", { method: "POST", headers: { "Content-Type": "application/json", "X-Api-Key": "secret" }, body: JSON.stringify({ eventType: kind, contractId: invoiceId, parentContractId: parentId, amount: 390, currency: "RUB", timestamp: "2026-10-01T08:13:35Z" }) }));
    assert.equal(response.status, expected, `${kind} ${type} ${remoteParent}`);
    assert.equal(rpcCalls.length, expected === 200 ? 1 : 0);
  }
});

function checkoutRepository(createAdmin, flags = { checkout: true, lava: true, tribute: true, yoomoney: true }) {
  return loadModule("../repository.ts", {
    "server-only": {},
    "node:crypto": nodeCrypto,
    "@/lib/billing/catalog": { billingPriceCatalog: {} },
    "@/lib/billing/config": { billingFlags: flags, getLavaConfig: () => ({}) },
    "@/lib/billing/order-state": { isOpenPendingCheckout },
    "@/lib/billing/providers/lava": {},
    "@/lib/supabase/server": { createSupabaseAdminClient: createAdmin },
  });
}

test("new checkout rejects legacy methods even with their old flags enabled", async () => {
  const repository = checkoutRepository(() => { assert.fail("legacy checkout must not touch the database"); });
  for (const paymentMethod of ["tribute", "yoomoney_card", "yoomoney_wallet", "unknown"]) {
    await assert.rejects(repository.createCheckout({ paymentMethod, priceCode: "plus_monthly", userId: "buyer", idempotencyKey: invoiceId }), /PROVIDER_DISABLED/);
  }
});

test("resuming a pending checkout only redirects to Lava.top", async () => {
  let providerCode;
  const query = {
    select() { return this; }, eq() { return this; },
    async maybeSingle() { return { data: {
      id: "order-id", user_id: "buyer", order_number: "RS-2026-123456789ABC",
      provider: providerCode, status: "pending", expires_at: new Date(Date.now() + 60000).toISOString(),
      checkout_url: providerCode === "lava" ? "https://app.lava.top/payment" : "https://tribute.tg/payment",
    } }; },
  };
  const repository = checkoutRepository(() => ({ from: () => query }));
  for (providerCode of ["tribute", "yoomoney"]) {
    await assert.rejects(repository.resumeUserCheckout("buyer", "RS-2026-123456789ABC"), /PROVIDER_DISABLED/);
  }
  providerCode = "lava";
  assert.equal((await repository.resumeUserCheckout("buyer", "RS-2026-123456789ABC")).url, "https://app.lava.top/payment");
});
