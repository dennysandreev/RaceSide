import "server-only";

import { parseMinorUnits } from "@/lib/billing/money";
import { makeYooMoneyCanonicalString, signYooMoneyNotification, verifyYooMoneySignature } from "@/lib/billing/signatures";
import type { PaymentProvider } from "@/lib/billing/types";

export const yoomoneyProvider: PaymentProvider = {
  capabilities: {
    apiRefund: false,
    automaticRenewal: false,
    remoteStatusLookup: false,
  },
  code: "yoomoney",
};

export { makeYooMoneyCanonicalString, signYooMoneyNotification };

export function verifyYooMoneyNotification(
  entries: Iterable<[string, string]>,
  receivedSignature: string,
  secret: string,
) {
  return verifyYooMoneySignature(entries, receivedSignature, secret);
}

export function parseYooMoneyNotification(params: URLSearchParams) {
  const notificationType = required(params, "notification_type");
  if (notificationType !== "card-incoming" && notificationType !== "p2p-incoming") {
    throw new Error("UNSUPPORTED_NOTIFICATION_TYPE");
  }
  const currency = required(params, "currency");
  if (currency !== "643") throw new Error("UNSUPPORTED_CURRENCY");
  if (required(params, "unaccepted") !== "false") throw new Error("PAYMENT_UNACCEPTED");
  if (required(params, "codepro") !== "false") throw new Error("PAYMENT_CODEPRO");
  const operationId = required(params, "operation_id");
  const label = required(params, "label");
  if (!/^rs_[A-Za-z0-9_-]{12,60}$/.test(label)) throw new Error("INVALID_PAYMENT_LABEL");
  const occurredAt = new Date(required(params, "datetime"));
  if (Number.isNaN(occurredAt.getTime())) throw new Error("INVALID_PAYMENT_DATE");
  return {
    currency: "RUB" as const,
    eventId: operationId,
    eventType: notificationType,
    grossAmountMinor: parseMinorUnits(required(params, "withdraw_amount")),
    label,
    netAmountMinor: parseMinorUnits(required(params, "amount")),
    occurredAt: occurredAt.toISOString(),
    paymentMethod: notificationType === "card-incoming"
      ? "yoomoney_card" as const
      : "yoomoney_wallet" as const,
    transactionId: operationId,
  };
}

function required(params: URLSearchParams, key: string) {
  const value = params.get(key);
  if (value === null || value === "") throw new Error(`MISSING_${key.toUpperCase()}`);
  return value;
}
