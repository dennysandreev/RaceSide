"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { requireUser } from "@/lib/auth";
import { isTrustedBillingOrigin } from "@/lib/billing/config";
import { cancelUserLavaSubscription } from "@/lib/billing/repository";

export async function stopLavaRenewal(_state: { error?: string; stopped?: boolean }): Promise<{ error?: string; stopped?: boolean }> {
  void _state;
  const user = await requireUser();
  const requestHeaders = await headers();
  if (!isTrustedBillingOrigin(requestHeaders.get("origin"), requestHeaders.get("sec-fetch-site"))) {
    return { error: "Не удалось подтвердить запрос. Обновите страницу и попробуйте снова." };
  }
  try {
    await cancelUserLavaSubscription(user.id);
    revalidatePath("/account/subscription");
    revalidatePath("/plus");
    return { stopped: true };
  } catch {
    return { error: "Не удалось отключить продление. Попробуйте позже." };
  }
}
