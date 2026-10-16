import type { BillingPrice, BillingPriceCode } from "@/lib/billing/types";

export const billingPriceCatalog: Record<BillingPriceCode, BillingPrice> = {
  plus_monthly: {
    amountMinor: 39_000,
    code: "plus_monthly",
    currency: "RUB",
    durationMonths: 1,
    firstPurchaseOnly: false,
    label: "RaceSide Plus на месяц",
    shortLabel: "390 ₽ за месяц",
  },
  plus_first_year: {
    amountMinor: 390_000,
    code: "plus_first_year",
    currency: "RUB",
    durationMonths: 12,
    firstPurchaseOnly: false,
    label: "RaceSide Plus на год",
    shortLabel: "3 900 ₽ за год",
  },
};

export function getBillingPrice(value: string): BillingPrice | null {
  return value in billingPriceCatalog
    ? billingPriceCatalog[value as BillingPriceCode]
    : null;
}

export function formatMoney(amountMinor: number, currency = "RUB") {
  return new Intl.NumberFormat("ru-RU", {
    currency,
    maximumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
    style: "currency",
  }).format(amountMinor / 100);
}

export function formatProvider(provider: string, method?: string) {
  if (method === "lava_rub") return "Российская карта через Lava.top";
  if (method === "lava") return "Зарубежная карта через Lava.top";
  if (provider === "lava") return "Lava.top";
  if (provider === "tribute") return "Tribute";
  if (provider === "yoomoney_wallet" || method === "yoomoney_wallet") return "Кошелёк ЮMoney";
  if (provider === "yoomoney") return "Банковская карта через ЮMoney";
  return "Способ оплаты неизвестен";
}
