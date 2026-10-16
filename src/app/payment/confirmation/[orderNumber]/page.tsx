import Link from "next/link";
import { CheckCircle2, CircleX, Clock3, ReceiptText } from "lucide-react";
import { notFound } from "next/navigation";

import { AppShell as BaseAppShell } from "@/components/racemate/app-shell";
import { PaymentRecoveryActions } from "@/components/racemate/payment-recovery-actions";
import { PaymentStatusPoller } from "@/components/racemate/payment-status-poller";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { formatMoney, formatProvider } from "@/lib/billing/catalog";
import { isOpenPendingCheckout } from "@/lib/billing/order-state";
import { getUserOrder } from "@/lib/billing/repository";

export const dynamic = "force-dynamic";

export default async function ConfirmationPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const user = await requireUser();
  const { orderNumber } = await params;
  const order = await getUserOrder(user.id, orderNumber);
  if (!order) notFound();

  const paid = order.status === "paid";
  const pending = isOpenPendingCheckout(order);
  const title = paid
    ? "Оплата подтверждена"
    : pending
      ? "Платёж обрабатывается"
      : "Оплата не завершена";
  const description = paid
    ? "Доступ RaceSide Plus включён."
    : pending
      ? order.provider === "lava"
        ? "Если вы закрыли платёжный сервис, можно открыть эту же оплату ещё раз или отменить попытку."
        : "Проверяем предыдущую оплату. Можно отменить попытку и оформить подписку через Lava.top."
      : "Можно вернуться к подписке и выбрать срок и способ оплаты заново.";

  return (
    <AppShell>
      {pending ? <PaymentStatusPoller /> : null}
      <section className="mx-auto max-w-3xl py-8">
        <div className="stitch-panel overflow-hidden p-0">
          <div className="border-b stitch-divider p-6 sm:p-8">
            <span className="grid size-12 place-items-center rounded-full bg-primary/10">
              {paid ? (
                <CheckCircle2 className="size-6 text-success" />
              ) : pending ? (
                <Clock3 className="size-6 text-primary" />
              ) : (
                <CircleX className="size-6 text-muted-foreground" />
              )}
            </span>
            <h1 className="mt-5 font-display text-3xl font-black">{title}</h1>
            <p className="mt-2 text-muted-foreground">{description}</p>
          </div>
          <dl className="grid gap-px bg-border sm:grid-cols-2">
            <OrderFact label="Заказ" value={order.orderNumber} />
            <OrderFact label="Сумма" value={formatMoney(order.amountMinor, order.currency)} />
            <OrderFact
              label="Способ"
              value={formatProvider(order.provider, order.paymentMethod)}
            />
            <OrderFact
              label="Статус"
              value={
                paid
                  ? "Оплачен"
                  : pending
                    ? "Ожидает подтверждения"
                    : "Не оплачен"
              }
            />
          </dl>
          <div className="flex flex-col gap-3 p-6 sm:flex-row sm:flex-wrap sm:items-start sm:p-8">
            {paid ? (
              <Button asChild>
                <Link href="/live">Открыть LIVE</Link>
              </Button>
            ) : pending ? (
              <PaymentRecoveryActions orderNumber={order.orderNumber} canResume={order.provider === "lava"} />
            ) : (
              <Button asChild>
                <Link href="/plus#checkout">Попробовать снова</Link>
              </Button>
            )}
            <Button asChild variant="secondary">
              <Link href="/account/subscription">Моя подписка</Link>
            </Button>
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function OrderFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-5">
      <dt className="font-telemetry text-[0.65rem] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-2 flex items-center gap-2 font-semibold">
        <ReceiptText className="size-4 text-primary" />
        {value}
      </dd>
    </div>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  return <BaseAppShell hideAds>{children}</BaseAppShell>;
}
