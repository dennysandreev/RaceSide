"use server";

import { revalidatePath } from "next/cache";
import type {
  BillingPaymentMethod,
  BillingPriceCode,
  HostedCheckout,
} from "@/lib/billing/types";
import { requireUser } from "@/lib/auth";
import { isTrustedBillingOrigin } from "@/lib/billing/config";
import {
  cancelUserCheckout,
  consumeBillingCheckoutRateLimit,
  createCheckout,
  resumeUserCheckout,
} from "@/lib/billing/repository";
import { consumeRateLimit, getRequestIp } from "@/lib/rate-limit";
import { headers } from "next/headers";

export type CheckoutState = {
  checkout?: HostedCheckout;
  error?: string;
  emailRejected?: boolean;
};

export type CancelCheckoutState = {
  cancelled?: boolean;
  error?: string;
  paid?: boolean;
};

export async function startCheckout(
  _state: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const user = await requireUser();
  const headerList = await headers();
  if (
    !isTrustedBillingOrigin(
      headerList.get("origin"),
      headerList.get("sec-fetch-site"),
    )
  ) {
    return {
      error:
        "Не удалось подтвердить запрос. Обновите страницу и попробуйте снова.",
    };
  }
  const requestIp = await getRequestIp();
  const localUserLimit = consumeRateLimit(
    "billing:checkout",
    user.id,
    10,
    60 * 60_000,
  );
  const localIpLimit = consumeRateLimit(
    "billing:checkout",
    `ip:${requestIp}`,
    20,
    60 * 60_000,
  );
  if (
    !localUserLimit.ok ||
    !localIpLimit.ok ||
    !(await consumeBillingCheckoutRateLimit(user.id, requestIp))
  ) {
    return { error: "Слишком много попыток оплаты. Попробуйте немного позже." };
  }
  const priceCode = formData.get("priceCode");
  const paymentMethod = formData.get("paymentMethod");
  const idempotencyKey = formData.get("idempotencyKey");
  if (
    !isPriceCode(priceCode) ||
    !isPaymentMethod(paymentMethod) ||
    typeof idempotencyKey !== "string"
  ) {
    return {
      error:
        "Не удалось подготовить оплату. Обновите страницу и попробуйте снова.",
    };
  }
  try {
    const paymentEmail = formData.get("email");
    return {
      checkout: await createCheckout({
        idempotencyKey,
        paymentMethod,
        priceCode,
        userId: user.id,
        userEmail: typeof paymentEmail === "string" && paymentEmail.trim() ? paymentEmail : user.email,
      }),
    };
  } catch (error) {
    return {
      error: checkoutMessage(error),
      emailRejected: error instanceof Error && error.message === "LAVA_EMAIL_REJECTED",
    };
  }
}

export async function repeatCheckout(
  _state: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const user = await requireUser();
  if (!(await hasTrustedOrigin())) {
    return {
      error:
        "Не удалось подтвердить запрос. Обновите страницу и попробуйте снова.",
    };
  }
  const orderNumber = formData.get("orderNumber");
  if (!isOrderNumber(orderNumber)) {
    return {
      error: "Не удалось найти эту оплату. Вернитесь к выбору подписки.",
    };
  }
  try {
    return { checkout: await resumeUserCheckout(user.id, orderNumber) };
  } catch (error) {
    return { error: checkoutMessage(error) };
  }
}

export async function cancelCheckout(
  _state: CancelCheckoutState,
  formData: FormData,
): Promise<CancelCheckoutState> {
  const user = await requireUser();
  if (!(await hasTrustedOrigin())) {
    return {
      error:
        "Не удалось подтвердить запрос. Обновите страницу и попробуйте снова.",
    };
  }
  const orderNumber = formData.get("orderNumber");
  if (!isOrderNumber(orderNumber)) {
    return {
      error:
        "Не удалось найти эту оплату. Обновите страницу и попробуйте снова.",
    };
  }
  try {
    const result = await cancelUserCheckout(user.id, orderNumber);
    revalidatePath("/plus");
    revalidatePath(`/payment/confirmation/${orderNumber}`);
    if (result === "paid") return { paid: true };
    return { cancelled: true };
  } catch {
    return { error: "Не удалось отменить оплату. Попробуйте ещё раз." };
  }
}

async function hasTrustedOrigin() {
  const headerList = await headers();
  return isTrustedBillingOrigin(
    headerList.get("origin"),
    headerList.get("sec-fetch-site"),
  );
}

function isPriceCode(
  value: FormDataEntryValue | null,
): value is BillingPriceCode {
  return value === "plus_monthly" || value === "plus_first_year";
}

function isPaymentMethod(
  value: FormDataEntryValue | null,
): value is BillingPaymentMethod {
  return (
    value === "lava" ||
    value === "lava_rub"
  );
}

function isOrderNumber(value: FormDataEntryValue | null): value is string {
  return typeof value === "string" && /^RS-\d{4}-[A-Z0-9]{12}$/.test(value);
}

function checkoutMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "LAVA_SUBSCRIPTION_EXISTS")
    return "Подписка уже продлевается. Управлять ею можно в личном кабинете.";
  if (code === "CHECKOUT_IN_PROGRESS")
    return "Предыдущая попытка оплаты ещё создаётся. Подождите несколько секунд.";
  if (code === "CHECKOUT_BUSY")
    return "У вас уже открыта другая оплата. Завершите её или попробуйте позже.";
  if (code === "CHECKOUT_CLOSED")
    return "Эта попытка оплаты уже закрыта. Вернитесь к выбору подписки.";
  if (code === "CHECKOUT_NOT_FOUND")
    return "Не удалось найти эту оплату. Вернитесь к выбору подписки.";
  if (code === "LAVA_EMAIL_REQUIRED")
    return "Добавьте email, чтобы перейти к оплате картой.";
  if (code === "LAVA_EMAIL_REJECTED")
    return "Lava.top не принимает этот email для покупки. Попробуйте другую почту для оплаты — аккаунт RaceSide останется прежним.";
  if (code.endsWith("_DISABLED") || code.endsWith("_UNAVAILABLE"))
    return "Этот способ оплаты сейчас недоступен. Выберите другой.";
  return "Оплата временно недоступна. Попробуйте ещё раз чуть позже.";
}
