import assert from "node:assert/strict";
import test from "node:test";

import { parseLavaEvent, verifyLavaWebhook } from "./lava-event.ts";

test("Lava webhook key must match exactly", () => {
  assert.equal(verifyLavaWebhook("webhook-key", "webhook-key"), true);
  assert.equal(verifyLavaWebhook("api-key", "webhook-key"), false);
  assert.equal(verifyLavaWebhook(null, "webhook-key"), false);
});

test("Lava payment events use invoice and whole-currency amounts", () => {
  const event = parseLavaEvent(JSON.stringify({ eventType: "payment.success", contractId: "7ea82675-4ded-4133-95a7-a6efbaf165cc", amount: 5, currency: "USD", timestamp: "2026-09-29T12:00:00Z" }));
  assert.equal(event.kind, "payment");
  assert.equal(event.amountMinor, 500);
  assert.equal(event.invoiceId, "7ea82675-4ded-4133-95a7-a6efbaf165cc");
  assert.throws(() => parseLavaEvent(JSON.stringify({ eventType: "payment.success", contractId: "7ea82675-4ded-4133-95a7-a6efbaf165cc", amount: 4.991, currency: "USD", timestamp: "2026-09-29T12:00:00Z" })));
  assert.equal(parseLavaEvent(JSON.stringify({ eventType: "payment.success", contractId: "7ea82675-4ded-4133-95a7-a6efbaf165cc", amount: 390, currency: "RUB", timestamp: "2026-09-29T12:00:00Z" })).amountMinor, 39000);
});

test("Lava refunds and disputes use their separate event envelope", () => {
  const refund = parseLavaEvent(JSON.stringify({ event_id: "11111111-1111-4111-8111-111111111111", event_type: "refund.success", created_at: "2026-09-29T12:00:00Z", data: { amount: 1.5, currency: "EUR", customer_email: "buyer@example.com", refund_type: "partial" } }));
  assert.equal(refund.kind, "adjustment");
  assert.equal(refund.amountMinor, 150);
  assert.equal(refund.refundType, "partial");
  const dispute = parseLavaEvent(JSON.stringify({ event_id: "22222222-2222-4222-8222-222222222222", event_type: "chargeback.initiated", created_at: "2026-09-29T12:00:00Z", data: { amount: 5, currency: "USD", customer_email: "buyer@example.com", reason_description: "Bank dispute" } }));
  assert.equal(dispute.kind, "adjustment");
  assert.equal(dispute.type, "chargeback.initiated");
  assert.throws(() => parseLavaEvent('{"eventType":"subscription.cancelled"}'));
});

test("Lava recurring events retain their parent invoice", () => {
  const event = parseLavaEvent(JSON.stringify({ eventType: "subscription.recurring.payment.success", contractId: "7ea82675-4ded-4133-95a7-a6efbaf165cc", parentContractId: "11111111-1111-4111-8111-111111111111", amount: 49.9, currency: "USD", timestamp: "2026-09-29T12:00:00Z" }));
  assert.equal(event.kind, "renewal");
  assert.equal(event.parentInvoiceId, "11111111-1111-4111-8111-111111111111");
  assert.equal(event.amountMinor, 4990);
  const cancellation = parseLavaEvent(JSON.stringify({ eventType: "subscription.cancelled", contractId: "7ea82675-4ded-4133-95a7-a6efbaf165cc", buyer: { email: "Buyer@Example.com" }, cancelledAt: "2026-09-29T12:00:00Z" }));
  assert.equal(cancellation.kind, "cancelled");
  assert.equal(cancellation.email, "buyer@example.com");
});
