"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { stopLavaRenewal } from "@/app/account/subscription/actions";
import { Button } from "@/components/ui/button";

export function LavaSubscriptionCancel() {
  const router = useRouter();
  const [state, action, pending] = useActionState(stopLavaRenewal, {});
  useEffect(() => { if (state.stopped) router.refresh(); }, [router, state.stopped]);
  return <form action={action} className="mt-4 grid justify-items-start gap-2">
    <Button disabled={pending} type="submit" variant="outline">{pending ? "Отключаем…" : "Отключить продление"}</Button>
    {state.error ? <p aria-live="polite" className="text-sm text-danger">{state.error}</p> : null}
  </form>;
}
