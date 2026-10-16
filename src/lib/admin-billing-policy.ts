export function parseMoscowPaymentDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+03:00`);
  if (!Number.isFinite(date.getTime())) return null;
  const roundTrip = new Date(date.getTime() + 3 * 60 * 60_000).toISOString().slice(0, 16);
  return roundTrip === value ? date.toISOString() : null;
}

export function getBillingFailureLabel(code: string | null) {
  if (!code) return null;
  const labels: Record<string, string> = {
    LAVA_EMAIL_REJECTED: "Платёжный сервис не принял email покупателя",
    LAVA_ORDER_SAVE_FAILED: "Не удалось сохранить счёт",
    ORDER_SAVE_FAILED: "Не удалось сохранить счёт",
    CHECKOUT_EXPIRED: "Срок оплаты истёк",
    LAVA_INVOICE_FAILED: "Платёжный сервис не создал счёт",
    LAVA_INVOICE_CREATE_FAILED: "Платёжный сервис не создал счёт",
    INVOICE_FAILED: "Платёжный сервис не создал счёт",
  };
  return labels[code] ?? "Оформление оплаты завершилось ошибкой";
}
