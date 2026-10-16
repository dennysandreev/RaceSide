import Link from "next/link";
import { CalendarClock, Check, ReceiptText } from "lucide-react";

import { AppShell as BaseAppShell } from "@/components/racemate/app-shell";
import { LavaSubscriptionCancel } from "@/components/racemate/lava-subscription-cancel";
import { PageTitle } from "@/components/racemate/page-title";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { getSubscriptionAccess } from "@/lib/billing/access";
import { formatMoney, formatProvider } from "@/lib/billing/catalog";
import { getUserActiveLavaSubscription, getUserOrders } from "@/lib/billing/repository";

export const dynamic = "force-dynamic";

export default async function SubscriptionPage() {
  const user = await requireUser();
  const [access, orders, recurringOrder] = await Promise.all([
    getSubscriptionAccess(user.id), getUserOrders(user.id), getUserActiveLavaSubscription(user.id),
  ]);
  return <AppShell><section className="grid gap-5 py-4">
    <div className="stitch-panel relative overflow-hidden p-5">
      <div aria-hidden className="absolute inset-y-0 right-0 w-72 bg-[radial-gradient(circle_at_right,rgb(225_6_0_/.22),transparent_70%)]" />
      <p className="stitch-label text-primary">RaceSide Plus</p>
      <PageTitle className="mt-2">{access.active ? "Подписка активна" : "Больше данных о гонке"}</PageTitle>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        {access.active && access.periodEnd
          ? `Доступ открыт до ${formatDate(access.periodEnd)} ${recurringOrder ? "Подписка продлится автоматически." : "Для продления оформите подписку снова."}`
          : "Откройте LIVE, полную телеметрию и Telegram-уведомления без рекламы."}
      </p>
      {recurringOrder ? <LavaSubscriptionCancel /> : null}
      {!access.active ? <Button asChild className="mt-4"><Link href="/plus#checkout">Выбрать подписку</Link></Button> : null}
    </div>
    <div className="stitch-panel overflow-hidden p-0">
      <div className="flex items-center gap-3 border-b stitch-divider p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border/70 bg-secondary/40">
          <ReceiptText aria-hidden="true" className="size-4.5 text-primary" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold leading-tight">История платежей</h2>
          <p className="mt-0.5 text-xs font-semibold text-muted-foreground">Все попытки оплаты этого аккаунта</p>
        </div>
      </div>
      {orders.length ? <div className="divide-y divide-border">{orders.map((order) => <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]" key={order.id}><div className="col-span-2 min-w-0 sm:col-span-1"><p className="text-sm font-semibold">{order.priceCode === "plus_first_year" ? "Год Plus" : "Месяц Plus"}</p><p className="mt-0.5 break-words text-xs text-muted-foreground">{order.orderNumber} · {formatProvider(order.provider, order.paymentMethod)}</p></div><span className="text-sm font-bold tabular-nums">{formatMoney(order.amountMinor, order.currency)}</span><Status status={order.status} /></div>)}</div> : <div className="grid min-h-44 place-items-center p-6 text-center text-sm text-muted-foreground"><div><CalendarClock className="mx-auto mb-3 size-7" /><p>Платежей пока нет.</p></div></div>}
    </div>
  </section></AppShell>;
}

function Status({ status }: { status: string }) { const paid = status === "paid"; return <span className={paid ? "inline-flex items-center gap-1 rounded-full bg-[var(--success)]/10 px-2.5 py-1 text-xs font-bold text-[var(--success)]" : "inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-bold text-muted-foreground"}>{paid ? <Check className="size-3" /> : null}{paid ? "Оплачен" : status === "failed" ? "Не оплачен" : status === "refunded" ? "Возврат" : status === "partially_refunded" ? "Частичный возврат" : "Ожидает"}</span>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "Europe/Moscow" }).format(new Date(value)); }
function AppShell({ children }: { children: React.ReactNode }) { return <BaseAppShell hideAds>{children}</BaseAppShell>; }
