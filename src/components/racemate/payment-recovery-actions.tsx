"use client";

import { useActionState, useEffect } from "react";
import { LoaderCircle, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  cancelCheckout,
  repeatCheckout,
  type CancelCheckoutState,
  type CheckoutState,
} from "@/app/plus/actions";
import { Button } from "@/components/ui/button";
import type { HostedCheckout } from "@/lib/billing/types";

const initialCheckoutState: CheckoutState = {};
const initialCancelState: CancelCheckoutState = {};

export function PaymentRecoveryActions({
  orderNumber,
  canResume,
}: {
  orderNumber: string;
  canResume: boolean;
}) {
  const router = useRouter();
  const [repeatState, repeatAction, repeating] = useActionState(
    repeatCheckout,
    initialCheckoutState,
  );
  const [cancelState, cancelAction, cancelling] = useActionState(
    cancelCheckout,
    initialCancelState,
  );

  useEffect(() => {
    if (repeatState.checkout) submitHostedCheckout(repeatState.checkout);
  }, [repeatState.checkout]);

  useEffect(() => {
    if (cancelState.cancelled) {
      router.replace("/plus#checkout");
      router.refresh();
    } else if (cancelState.paid) {
      router.refresh();
    }
  }, [cancelState.cancelled, cancelState.paid, router]);

  const busy = repeating || cancelling;

  return (
    <div className="w-full sm:w-auto">
      <div className="flex flex-col gap-2 sm:flex-row">
        {canResume ? <form action={repeatAction}>
          <input name="orderNumber" type="hidden" value={orderNumber} />
          <Button className="w-full sm:w-auto" disabled={busy} type="submit">
            {repeating ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin"
                data-icon="inline-start"
              />
            ) : (
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
            )}
            {repeating ? "Открываем оплату" : "Повторить оплату"}
          </Button>
        </form> : null}
        <form action={cancelAction}>
          <input name="orderNumber" type="hidden" value={orderNumber} />
          <Button
            className="w-full sm:w-auto"
            disabled={busy}
            type="submit"
            variant="outline"
          >
            {cancelling ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin"
                data-icon="inline-start"
              />
            ) : (
              <X aria-hidden="true" data-icon="inline-start" />
            )}
            {cancelling ? "Отменяем" : "Отменить оплату"}
          </Button>
        </form>
      </div>
      {repeatState.error || cancelState.error ? (
        <p aria-live="polite" className="mt-3 text-sm text-danger">
          {repeatState.error ?? cancelState.error}
        </p>
      ) : null}
    </div>
  );
}

function submitHostedCheckout(checkout: HostedCheckout) {
  window.location.assign(checkout.url);
}
