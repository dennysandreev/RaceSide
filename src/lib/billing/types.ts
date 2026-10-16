// Legacy codes identify historical records; new checkout accepts only lava/lava_rub.
export type BillingProviderCode = "tribute" | "yoomoney" | "lava";
export type BillingPaymentMethod =
  | "tribute"
  | "yoomoney_card"
  | "yoomoney_wallet"
  | "lava"
  | "lava_rub";
export type BillingOrderStatus =
  | "failed"
  | "paid"
  | "partially_refunded"
  | "pending"
  | "refunded";
export type BillingPriceCode = "plus_first_year" | "plus_monthly";
export type Entitlement =
  | "ads_disabled"
  | "live"
  | "telegram_notifications"
  | "telemetry_demo"
  | "telemetry_full";

export type BillingPrice = {
  amountMinor: number;
  code: BillingPriceCode;
  currency: "RUB";
  durationMonths: 1 | 12;
  firstPurchaseOnly: boolean;
  label: string;
  shortLabel: string;
};

export type BillingOrder = {
  amountMinor: number;
  checkoutUrl: string | null;
  createdAt: string;
  currency: string;
  durationMonths: number;
  expiresAt: string;
  id: string;
  orderNumber: string;
  paidAt: string | null;
  paymentMethod: BillingPaymentMethod;
  priceCode: BillingPriceCode;
  provider: BillingProviderCode;
  providerLabel: string | null;
  providerOrderId: string | null;
  lavaAutoRenew: boolean;
  lavaCancelledAt: string | null;
  refundedAmountMinor: number;
  status: BillingOrderStatus;
  userId: string;
};

export type SubscriptionAccess = {
  active: boolean;
  effectiveActive: boolean;
  entitlements: Record<Entitlement, boolean>;
  periodEnd: string | null;
  periodStart: string | null;
  status: "active" | "expired" | "guest" | "revoked";
  userId: string | null;
};

export type HostedCheckout = {
  kind: "redirect";
  orderNumber: string;
  url: string;
};

export interface PaymentProvider {
  capabilities: {
    automaticRenewal: boolean;
    apiRefund: boolean;
    remoteStatusLookup: boolean;
  };
  code: BillingProviderCode;
}

export type CheckoutRequest = {
  idempotencyKey: string;
  paymentMethod: BillingPaymentMethod;
  priceCode: BillingPriceCode;
  requestIp: string;
  userEmail?: string;
  userId: string;
};
