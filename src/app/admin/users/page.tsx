import { BellRing, Crown } from "lucide-react";

import {
  disconnectTelegramAction,
  sendTestNotificationAction,
  cancelAdminLavaSubscriptionAction,
  grantSubscriptionAction,
  revokeSubscriptionAction,
} from "@/app/admin/operations";
import { AdminActionForm } from "@/components/admin/admin-action-form";
import { AdminConfirmedAction } from "@/components/admin/admin-confirmed-action";
import { AdminConfirmedForm } from "@/components/admin/admin-confirmed-form";
import { AdminFilters } from "@/components/admin/admin-filters";
import {
  AdminEmpty,
  AdminPage,
  AdminPageHeader,
  AdminPagination,
  AdminSection,
  AdminStatusBadge,
} from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { loadAdminUsers, parseAdminTableQuery } from "@/data/admin-repository";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminUsersPage({ searchParams }: PageProps) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Серверный клиент админки недоступен");
  const query = parseAdminTableQuery(await searchParams);
  const data = await loadAdminUsers(admin, query);

  return (
    <AdminPage>
      <AdminPageHeader
        description="Профиль, первоначальная настройка, избранное, прогнозы, лиги и состояние Telegram. Email и пароль здесь не меняются."
        title="Пользователи"
      />
      <AdminSection description={`${data.total} профилей по текущему запросу.`} title="Поддержка пользователей">
        <AdminFilters query={query} search={query.search} />
        {data.items.length ? (
          <>
            <div className="hidden overflow-x-auto xl:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Профиль</TableHead>
                    <TableHead>Профиль настроен</TableHead>
                    <TableHead>Избранное</TableHead>
                    <TableHead>Прогнозы</TableHead>
                    <TableHead>Лиги</TableHead>
                    <TableHead>Telegram</TableHead>
                    <TableHead>Plus</TableHead>
                    <TableHead className="text-right">Поддержка</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((profile) => (
                    <TableRow key={profile.id}>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{profile.display_name || "Без имени"}</p>
                          {profile.is_bot ? <Badge variant="outline">Бот</Badge> : null}
                        </div>
                        <p className="text-xs text-muted-foreground">{profile.email || "Email не указан"}</p>
                      </TableCell>
                      <TableCell><AdminStatusBadge status={profile.onboarding_completed ? "success" : "pending"} /></TableCell>
                      <TableCell className="font-mono tabular-nums">{profile.favoriteDrivers + profile.favoriteTeams}</TableCell>
                      <TableCell className="font-mono tabular-nums">{profile.predictions}</TableCell>
                      <TableCell className="font-mono tabular-nums">{profile.leagues}</TableCell>
                      <TableCell>
                        <AdminStatusBadge status={profile.telegram?.is_active ? "active" : profile.telegram ? "warning" : "unknown"} />
                      </TableCell>
                      <TableCell><SubscriptionStatus subscription={profile.subscription} /><p className="mt-1 text-xs text-muted-foreground">{subscriptionLabel(profile.subscription)}</p><AutoRenewStatus contract={profile.lavaContract} userId={profile.id} userName={profile.display_name || profile.email || "Пользователь"} /></TableCell>
                      <TableCell>
                        <div className="flex flex-col items-end gap-2">
                          {profile.telegram?.is_active ? (
                            <>
                              <AdminActionForm action={sendTestNotificationAction} submitLabel="Отправить тест" submitVariant="secondary">
                                <input name="userId" type="hidden" value={profile.id} />
                              </AdminActionForm>
                              <AdminConfirmedAction
                                action={disconnectTelegramAction}
                                confirmLabel="Отключить связь"
                                description="Пользовательский аккаунт RaceSide останется активным. Отключится только проблемная Telegram-связь."
                                title="Отключить Telegram?"
                                triggerLabel="Отключить"
                                triggerVariant="ghost"
                              >
                                <input name="userId" type="hidden" value={profile.id} />
                              </AdminConfirmedAction>
                            </>
                          ) : null}
                          <details className="w-64 rounded-md border border-border p-2 text-left"><summary className="cursor-pointer text-xs font-bold">{subscriptionActionLabel(profile.subscription)}</summary><GrantSubscriptionForm email={profile.email} name={profile.display_name} subscription={profile.subscription} userId={profile.id} /></details>
                          {isActiveSubscription(profile.subscription) ? <RevokeSubscriptionForm userId={profile.id} /> : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="grid xl:hidden">
              {data.items.map((profile) => (
                <article className="grid gap-4 border-b border-border p-4 last:border-b-0" key={profile.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate font-medium">{profile.display_name || "Без имени"}</h2>
                        {profile.is_bot ? <Badge variant="outline">Бот</Badge> : null}
                      </div>
                      <p className="mt-1 truncate text-sm text-muted-foreground">{profile.email || "Email не указан"}</p>
                    </div>
                    <AdminStatusBadge status={profile.onboarding_completed ? "success" : "pending"} />
                  </div>
                  <dl className="grid grid-cols-3 gap-3 text-sm">
                    <div><dt className="text-xs text-muted-foreground">Избранное</dt><dd className="mt-1 font-mono">{profile.favoriteDrivers + profile.favoriteTeams}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Прогнозы</dt><dd className="mt-1 font-mono">{profile.predictions}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Лиги</dt><dd className="mt-1 font-mono">{profile.leagues}</dd></div>
                  </dl>
                  <div className="rounded-md border border-border p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">RaceSide Plus</p><p className="mt-1 text-xs text-muted-foreground">{subscriptionLabel(profile.subscription)}</p></div><SubscriptionStatus subscription={profile.subscription} /></div></div>
                  <div className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">Telegram</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {profile.telegram?.username ? `@${profile.telegram.username}` : profile.telegram ? "Подключение без username" : "Не подключён"}
                        </p>
                      </div>
                      <AdminStatusBadge status={profile.telegram?.is_active ? "active" : profile.telegram ? "warning" : "unknown"} />
                    </div>
                    {profile.telegram?.last_error ? <p className="mt-2 text-xs text-danger">{profile.telegram.last_error}</p> : null}
                    {profile.telegram?.is_active ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <AdminActionForm action={sendTestNotificationAction} submitLabel="Отправить тест" submitVariant="secondary">
                          <input name="userId" type="hidden" value={profile.id} />
                          <BellRing aria-hidden="true" className="size-4" />
                        </AdminActionForm>
                        <AdminConfirmedAction
                          action={disconnectTelegramAction}
                          confirmLabel="Отключить связь"
                          description="Пользовательский аккаунт RaceSide останется активным. Отключится только проблемная Telegram-связь."
                          title="Отключить Telegram?"
                          triggerLabel="Отключить"
                          triggerVariant="ghost"
                        >
                          <input name="userId" type="hidden" value={profile.id} />
                        </AdminConfirmedAction>
                      </div>
                    ) : null}
                  </div>
                  <AutoRenewStatus contract={profile.lavaContract} userId={profile.id} userName={profile.display_name || profile.email || "Пользователь"} />
                  <GrantSubscriptionForm email={profile.email} name={profile.display_name} subscription={profile.subscription} userId={profile.id} />
                  {isActiveSubscription(profile.subscription) ? <RevokeSubscriptionForm userId={profile.id} /> : null}
                </article>
              ))}
            </div>
            <AdminPagination query={query} page={query.page} pageSize={query.pageSize} pathname="/admin/users" search={query.search} total={data.total} />
          </>
        ) : (
          <AdminEmpty description="Проверь имя или email в строке поиска." title="Профиль не найден" />
        )}
      </AdminSection>
    </AdminPage>
  );
}

function GrantSubscriptionForm({ email, name, subscription, userId }: { email: string | null; name: string | null; subscription: { status: string; current_period_end: string | null } | null; userId: string }) {
  const actionLabel = subscriptionActionLabel(subscription);
  return <AdminConfirmedForm action={grantSubscriptionAction} confirmLabel={actionLabel} description="Новый срок начнётся после уже активного, если подписка ещё действует. Действие сохранится в журнале админки." submitLabel={actionLabel} title={`${actionLabel} пользователю?`}>
    <div className="rounded-md bg-muted p-2 text-xs"><p className="font-medium">{name || "Без имени"}</p><p className="mt-0.5 text-muted-foreground">{email || "Email не указан"}</p></div>
    <input name="userId" type="hidden" value={userId} /><input name="idempotencyKey" type="hidden" value={crypto.randomUUID()} />
    <label className="grid gap-1 text-sm"><span className="text-xs text-muted-foreground">Срок</span><select className="h-9 rounded-md border border-border bg-background px-3" defaultValue="month" name="duration"><option value="month">1 месяц</option><option value="year">1 год</option><option value="custom">До выбранной даты</option></select></label>
    <label className="grid gap-1 text-sm"><span className="text-xs text-muted-foreground">Дата окончания для своего срока</span><input className="h-9 rounded-md border border-border bg-background px-3" name="customEnd" type="datetime-local" /></label>
    <label className="grid gap-1 text-sm"><span className="text-xs text-muted-foreground">Причина</span><input className="h-9 rounded-md border border-border bg-background px-3" maxLength={500} minLength={3} name="reason" placeholder="Например, подарок победителю конкурса" required /></label>
  </AdminConfirmedForm>;
}

function RevokeSubscriptionForm({ userId }: { userId: string }) {
  return <AdminConfirmedForm action={revokeSubscriptionAction} confirmLabel="Отозвать Plus" description="LIVE, полная телеметрия и Telegram-уведомления закроются сразу. Автопродление в Lava продолжит действовать: его можно отключить отдельно. Действие сохранится в журнале админки." submitLabel="Отозвать" submitVariant="outline" title="Отозвать подписку?">
    <input name="userId" type="hidden" value={userId} />
    <label className="grid gap-1 text-sm"><span className="text-xs text-muted-foreground">Причина</span><input className="h-9 rounded-md border border-border bg-background px-3" maxLength={500} minLength={3} name="reason" placeholder="Например, подписка выдана по ошибке" required /></label>
  </AdminConfirmedForm>;
}

function SubscriptionStatus({ subscription }: { subscription: { status: string; current_period_end: string | null } | null }) {
  const active = isActiveSubscription(subscription);
  return <span className={active ? "inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-1 text-xs font-bold text-success" : "text-xs text-muted-foreground"}>{active ? <Crown className="size-3" /> : null}{active ? "Активен" : "Нет"}</span>;
}

function subscriptionLabel(subscription: { status: string; current_period_end: string | null } | null) {
  return isActiveSubscription(subscription) && subscription?.current_period_end ? `До ${new Intl.DateTimeFormat("ru-RU").format(new Date(subscription.current_period_end))}` : subscription?.status === "revoked" ? "Доступ отозван" : "Подписка не активна";
}

function isActiveSubscription(subscription: { status: string; current_period_end: string | null } | null) {
  return subscription?.status === "active" && Boolean(subscription.current_period_end) && Date.parse(subscription.current_period_end ?? "") > Date.now();
}

function subscriptionActionLabel(subscription: { status: string; current_period_end: string | null } | null) {
  if (isActiveSubscription(subscription)) return "Продлить Plus";
  return subscription ? "Выдать снова" : "Выдать Plus";
}

function AutoRenewStatus({ contract, userId, userName }: { contract: { id: string; lava_auto_renew: boolean; lava_cancelled_at: string | null } | null; userId: string; userName: string }) {
  if (!contract) return <p className="mt-2 text-xs text-muted-foreground">Договор автопродления не найден</p>;
  return <div className="mt-2 grid gap-2 text-xs">
    <p>{contract.lava_auto_renew ? "Автопродление включено" : contract.lava_cancelled_at ? `Автопродление отключено ${new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow" }).format(new Date(contract.lava_cancelled_at))}` : "Автопродление отключено"}</p>
    {contract.lava_auto_renew ? <details><summary className="cursor-pointer font-medium">Отключить автопродление</summary>
      <AdminConfirmedForm action={cancelAdminLavaSubscriptionAction} confirmFields={[{ name: "reason", label: "Причина" }]} className="mt-2 max-w-64" confirmLabel="Отключить автопродление" description={`${userName}. Новые списания прекратятся после подтверждения Lava. Уже оплаченный доступ сохранится до конца срока.`} submitLabel="Отключить" submitVariant="outline" title="Отключить будущие списания?">
        <input name="userId" type="hidden" value={userId} /><input name="orderId" type="hidden" value={contract.id} />
        <label className="grid gap-1">Причина<input className="h-9 rounded-md border border-input bg-background px-2" name="reason" minLength={3} maxLength={500} required /></label>
      </AdminConfirmedForm>
    </details> : null}
  </div>;
}
