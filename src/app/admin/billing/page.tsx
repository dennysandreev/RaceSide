import { CreditCard, ShieldAlert, UsersRound } from "lucide-react";

import { AdminUrlTabs } from "@/components/admin/admin-url-tabs";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadAdminBilling, parseAdminTableQuery } from "@/data/admin-repository";
import { getBillingFailureLabel } from "@/lib/admin-billing-policy";
import { AdminFilters } from "@/components/admin/admin-filters";
import { AdminConfirmedForm } from "@/components/admin/admin-confirmed-form";
import {
  AdminEmpty,
  AdminPage,
  AdminPageHeader,
  AdminSection,
  AdminPagination,
  AdminStatusBadge,
} from "@/components/admin/admin-ui";
import { formatMoney, formatProvider } from "@/lib/billing/catalog";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  reconcileBillingPaymentAction,
  recordBillingRefundAction,
  resendBillingConfirmationAction,
} from "@/app/admin/operations";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminBillingPage({ searchParams }: PageProps) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Серверный клиент админки недоступен");
  const query = parseAdminTableQuery(await searchParams);
  const data = await loadAdminBilling(admin, query);
  const { orders, profileById, transactionByOrder, periodByOrder } = data;
  const eventTab = query.params?.tab === "events";

  return (
    <AdminPage>
      <AdminPageHeader
        description="Платежи Lava.top, сроки подписок и уведомления об оплате."
        title="Подписки и оплаты"
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <Metric icon={UsersRound} label="Активные подписки" value={data.subscriptionsCount} />
        <Metric icon={CreditCard} label="Заказы по фильтрам" value={data.ordersTotal} />
        <Metric icon={ShieldAlert} label="Ошибки событий за 24 часа — все сервисы" value={data.eventFailures24h} warning={Boolean(data.eventFailures24h)} />
        <Metric icon={ShieldAlert} label="Споры по оплате" value={data.disputesCount} warning={Boolean(data.disputesCount)} />
      </div>

      <AdminSection description={query.from || query.to ? "Ошибки оформления за выбранный период и по фильтрам заказов." : "Ошибки оформления за последние 24 часа и по фильтрам заказов."} title="Оформление оплаты">
        <div className="flex flex-wrap gap-4 p-4">{data.failures.length ? data.failures.map(item => <p className="text-sm" key={item.reason}>{getBillingFailureLabel(item.reason)}: <strong>{item.count}</strong></p>) : <p className="text-sm text-muted-foreground">Ошибок оформления за этот период нет.</p>}</div>
      </AdminSection>
      <AdminUrlTabs defaultValue="orders" values={["orders", "events"]}>
        <TabsList variant="line"><TabsTrigger value="orders">Заказы</TabsTrigger><TabsTrigger value="events">События оплаты</TabsTrigger></TabsList>
        <AdminFilters query={query} search={query.search} status={query.status} dateRange statuses={(eventTab ? ["received", "processed", "rejected", "failed"] : ["pending", "paid", "failed", "partially_refunded", "refunded", "cancelled"]).map(value => ({ value, label: billingStatusLabel(value) }))} filters={[
          { name: "provider", label: "Платёжный сервис", value: query.params?.provider, options: [{ value: "lava", label: "Lava.top" }, { value: "tribute", label: "Tribute — прошлые оплаты" }, { value: "yoomoney", label: "ЮMoney — прошлые оплаты" }] },
          ...(!eventTab ? [{ name: "currency", label: "Валюта заказа", value: query.params?.currency, options: [{ value: "RUB", label: "Рубли" }, { value: "USD", label: "Доллары" }] }] : []),
        ]} />
      <TabsContent value="orders"><AdminSection description={`${data.ordersTotal} заказов по текущему запросу. Поиск по номеру заказа, пользователю и платёжной операции выполняется по всей базе.`} title="Заказы">
        {orders.length ? (
          <div className="grid divide-y divide-border">
            {orders.map((order) => {
              const profile = profileById.get(order.user_id);
              const transaction = transactionByOrder.get(order.id);
              const period = periodByOrder.get(order.id);
              return (
                <article className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-start" key={order.id}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-mono text-sm font-bold">{order.order_number}</h2>
                      <AdminStatusBadge status={statusTone(order.status)} />
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">{profile?.display_name || "Без имени"} · {profile?.email || shortReference(order.user_id)}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{formatProvider(order.provider, order.payment_method)} · {shortReference(order.provider_order_id || order.provider_label || "ожидается")}</p>
                    {order.failure_reason ? <p className="mt-1 text-xs text-muted-foreground">{getBillingFailureLabel(order.failure_reason)}</p> : null}
                    {order.payment_dispute_status === "initiated" ? <p className="mt-1 text-xs font-semibold text-danger">Открыт спор по оплате — проверьте Lava.top</p> : null}
                    {Number(order.refunded_amount_minor) > 0 ? <p className="mt-1 text-xs text-muted-foreground">Возвращено {formatMoney(Number(order.refunded_amount_minor), order.currency)}</p> : null}
                    {transaction ? <p className="mt-1 text-xs text-muted-foreground">Зачислено {formatMoney(Number(transaction.net_amount_minor), transaction.currency)} · комиссия {formatMoney(Number(transaction.provider_fee_minor), transaction.currency)} · операция <span className="font-mono">{shortReference(transaction.provider_transaction_id)}</span></p> : null}
                    {period ? <p className="mt-1 text-xs text-muted-foreground">Доступ: {formatDate(period.starts_at)} — {formatDate(period.ends_at)} · {period.status === "active" ? "активен" : period.status === "refunded" ? "возвращён" : "отозван"}</p> : null}
                  </div>
                  <div className="text-sm lg:text-right"><p className="font-display text-lg font-bold">{formatMoney(Number(order.amount_minor), order.currency)}</p><p className="text-xs text-muted-foreground">{order.duration_months === 12 ? "12 месяцев" : "1 месяц"}</p></div>
                  <div className="grid justify-items-start gap-2 lg:justify-items-end"><time className="text-xs text-muted-foreground" dateTime={order.paid_at || order.created_at}>{formatDate(order.paid_at || order.created_at)}</time><BillingOrderActions order={order} /></div>
                </article>
              );
            })}
          </div>
        ) : <AdminEmpty description="Проверьте номер заказа или идентификатор." title="Заказы не найдены" />}
        <AdminPagination query={query} page={query.page} pageSize={query.pageSize} pathname="/admin/billing" total={data.ordersTotal} />
      </AdminSection></TabsContent>

      <TabsContent value="events"><AdminSection description="Принятые и отклонённые callback-события без платёжных секретов." title="Уведомления провайдеров">
        <div className="grid divide-y divide-border">
          {data.events.map((event) => (
            <article className="grid gap-2 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center" key={event.id}>
              <AdminStatusBadge status={event.status === "processed" ? "success" : event.status === "received" ? "pending" : "failed"} />
              <div className="min-w-0"><p className="font-medium">{formatProvider(event.provider)} · {event.provider_event_type}</p><p className="mt-1 truncate font-mono text-xs text-muted-foreground">{shortReference(event.provider_reference || "без ссылки")} · попыток: {event.attempts}</p>{event.last_error ? <p className="mt-1 text-xs text-danger">Событие не обработано. Проверь операцию в кабинете платёжного сервиса.</p> : null}</div>
              <time className="text-xs text-muted-foreground" dateTime={event.received_at}>{formatDate(event.received_at)}</time>
            </article>
          ))}
        </div>
        <AdminPagination query={query} page={query.page} pageSize={query.pageSize} pathname="/admin/billing" total={data.eventsTotal} />
      </AdminSection></TabsContent></AdminUrlTabs>
    </AdminPage>
  );
}

function Metric({ icon: Icon, label, value, warning = false }: { icon: typeof CreditCard; label: string; value: number; warning?: boolean }) {
  return <div className="rounded-lg border border-border bg-card p-4"><Icon aria-hidden="true" className={warning ? "size-5 text-danger" : "size-5 text-primary"} /><p className="mt-4 font-display text-3xl font-black tabular-nums">{value}</p><p className="mt-1 text-sm text-muted-foreground">{label}</p></div>;
}

function shortReference(value: string) {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(value));
}

function statusTone(status: string) {
  if (status === "paid") return "success";
  if (status === "pending") return "pending";
  if (status === "refunded" || status === "partially_refunded") return "warning";
  return "failed";
}

function BillingOrderActions({ order }: { order: { id: string; amount_minor: number; status: string; failure_reason: string | null; currency: string; order_number: string } }) {
  if (order.status === "paid") {
    return <div className="flex flex-wrap justify-end gap-2"><AdminConfirmedForm action={resendBillingConfirmationAction} className="w-full" confirmLabel="Отправить" description="Письмо будет заново поставлено в очередь. Новый период подписки не создаётся." submitLabel="Повторить письмо" submitVariant="outline" title="Отправить подтверждение ещё раз?"><input name="orderId" type="hidden" value={order.id} /></AdminConfirmedForm><details className="w-full rounded-md border border-danger/25 p-2 text-left"><summary className="cursor-pointer text-xs font-bold text-danger">Зафиксировать возврат</summary><AdminConfirmedForm action={recordBillingRefundAction} className="mt-3" confirmLabel="Возврат уже выполнен" description="Продолжайте только после фактического возврата денег у платёжного сервиса. Доступ пользователя будет пересчитан." submitLabel="Зафиксировать" submitVariant="outline" title="Возврат точно выполнен?"><input name="orderId" type="hidden" value={order.id} /><label className="grid gap-1 text-sm"><span className="text-xs text-muted-foreground">Ссылка на возврат</span><input className="h-9 w-full min-w-0 rounded-md border border-border bg-background px-3" maxLength={160} name="refundReference" required /></label><label className="grid gap-1 text-sm"><span className="text-xs text-muted-foreground">Причина</span><input className="h-9 w-full min-w-0 rounded-md border border-border bg-background px-3" maxLength={500} minLength={3} name="reason" required /></label></AdminConfirmedForm></details></div>;
  }
  if (order.status !== "pending" && !(order.status === "failed" && order.failure_reason === "CHECKOUT_EXPIRED")) return null;
  return <details className="w-full min-w-0 max-w-64 rounded-md border border-border p-2 text-left"><summary className="cursor-pointer text-xs font-bold">Сверить оплату</summary><AdminConfirmedForm action={reconcileBillingPaymentAction} confirmFields={[{ name: "netAmount", label: `Зачислено, ${order.currency}` }, { name: "paidAt", label: "Дата оплаты — Москва (UTC+3)" }, { name: "operationReference", label: "Операция" }, { name: "reason", label: "Причина" }]} className="mt-3" confirmLabel="Подтвердить оплату" description={`Заказ ${order.order_number}, ${formatMoney(order.amount_minor, order.currency)}. Проверь операцию у платёжного сервиса и её дату по Москве. Подтверждение сразу выдаст доступ.`} submitLabel="Подтвердить вручную" title="Операция действительно найдена?"><input name="orderId" type="hidden" value={order.id} /><label className="grid gap-1 text-sm"><span className="text-xs text-muted-foreground">ID операции</span><input className="h-9 w-full min-w-0 rounded-md border border-border bg-background px-3" maxLength={160} name="operationReference" required /></label><label className="grid gap-1 text-sm"><span className="text-xs text-muted-foreground">Зачислено, {order.currency === "USD" ? "$" : "₽"}</span><input className="h-9 w-full min-w-0 rounded-md border border-border bg-background px-3" defaultValue={(Number(order.amount_minor) / 100).toFixed(2)} inputMode="decimal" name="netAmount" required /></label><label className="grid gap-1 text-sm"><span className="text-xs text-muted-foreground">Дата оплаты (Москва, UTC+3)</span><input className="h-9 w-full min-w-0 rounded-md border border-border bg-background px-3" name="paidAt" type="datetime-local" required /></label><label className="grid gap-1 text-sm"><span className="text-xs text-muted-foreground">Причина ручной сверки</span><input className="h-9 w-full min-w-0 rounded-md border border-border bg-background px-3" maxLength={500} minLength={3} name="reason" required /></label></AdminConfirmedForm></details>;
}

function billingStatusLabel(value: string) {
  return ({ pending: "Ожидают оплаты", paid: "Оплачены", failed: "С ошибкой", partially_refunded: "Частичный возврат", refunded: "Возвращены", cancelled: "Отменены", received: "Получены", processed: "Обработаны", rejected: "Отклонены", ignored: "Пропущены" } as Record<string, string>)[value] ?? value;
}
