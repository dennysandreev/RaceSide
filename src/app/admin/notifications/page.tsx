import {
  retryNotificationAction,
  runAdminJobAction,
} from "@/app/admin/operations";
import { AdminActionForm } from "@/components/admin/admin-action-form";
import { AdminUrlTabs } from "@/components/admin/admin-url-tabs";
import { AdminFilters } from "@/components/admin/admin-filters";
import {
  AdminEmpty,
  AdminPage,
  AdminPageHeader,
  AdminPagination,
  AdminSection,
  AdminStatusBadge,
} from "@/components/admin/admin-ui";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { loadAdminNotifications, parseAdminTableQuery } from "@/data/admin-repository";
import { getAdminEntityLabel, getAdminNotificationEventLabel } from "@/lib/admin-display";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminNotificationsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Серверный клиент админки недоступен");
  const query = parseAdminTableQuery(await searchParams);
  const data = await loadAdminNotifications(admin, query);

  return (
    <AdminPage>
      <AdminPageHeader
        actions={(
          <>
            <AdminActionForm action={runAdminJobAction} submitLabel="Собрать очередь" submitVariant="secondary"><input name="jobName" type="hidden" value="notifications.enqueue" /></AdminActionForm>
            <AdminActionForm action={runAdminJobAction} submitLabel="Отправить готовые"><input name="jobName" type="hidden" value="notifications.dispatch" /></AdminActionForm>
          </>
        )}
        description="Очередь и журнал Telegram без идентификаторов чатов, токенов и содержимого служебных запросов."
        title="Уведомления"
      />
      <AdminUrlTabs defaultValue="queue" values={["queue", "logs", "connections"]}>
        <TabsList variant="line">
          <TabsTrigger value="queue">Очередь</TabsTrigger>
          <TabsTrigger value="logs">Журнал</TabsTrigger>
          <TabsTrigger value="connections">Подключения</TabsTrigger>
        </TabsList>
        <TabsContent value="queue">
          <AdminSection description={`${data.total} записей по текущему запросу.`} title="Очередь Telegram">
            <AdminFilters query={query}
              search={query.search}
              status={query.status}
              statuses={[
                { value: "pending", label: "В очереди" },
                { value: "sending", label: "Отправляются" },
                { value: "sent", label: "Отправлены" },
                { value: "failed", label: "С ошибкой" },
                { value: "cancelled", label: "Отменены" },
              ]}
            />
            {data.queue.length ? (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Событие</TableHead>
                        <TableHead>Состояние</TableHead>
                        <TableHead>Попытки</TableHead>
                        <TableHead>Создано</TableHead>
                        <TableHead>Ошибка</TableHead>
                        <TableHead className="text-right">Действие</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.queue.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <p className="font-medium">{getAdminNotificationEventLabel(entry.event_type)}</p>
                            <p className="text-xs text-muted-foreground">{entry.entity_type ? getAdminEntityLabel(entry.entity_type) : "Без привязки"}</p>
                          </TableCell>
                          <TableCell><AdminStatusBadge status={entry.status} /></TableCell>
                          <TableCell className="font-mono tabular-nums">{entry.attempts}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(entry.created_at)}</TableCell>
                          <TableCell className="max-w-sm"><p className="line-clamp-2 text-xs text-danger">{entry.last_error ?? ""}</p></TableCell>
                          <TableCell>
                            {entry.status === "failed" && !entry.sent_at ? (
                              <AdminActionForm action={retryNotificationAction} submitLabel="Повторить" submitVariant="secondary">
                                <input name="queueId" type="hidden" value={entry.id} />
                              </AdminActionForm>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="grid md:hidden">
                  {data.queue.map((entry) => (
                    <article className="grid gap-3 border-b border-border p-4 last:border-b-0" key={entry.id}>
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium">{getAdminNotificationEventLabel(entry.event_type)}</p>
                        <AdminStatusBadge status={entry.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">{formatDate(entry.created_at)}, попыток: {entry.attempts}</p>
                      {entry.last_error ? <p className="text-xs leading-5 text-danger">{entry.last_error}</p> : null}
                      {entry.status === "failed" && !entry.sent_at ? (
                        <AdminActionForm action={retryNotificationAction} submitLabel="Повторить" submitVariant="secondary">
                          <input name="queueId" type="hidden" value={entry.id} />
                        </AdminActionForm>
                      ) : null}
                    </article>
                  ))}
                </div>
                <AdminPagination query={query} page={query.page} pageSize={query.pageSize} pathname="/admin/notifications" search={query.search} status={query.status} total={data.total} />
              </>
            ) : <AdminEmpty description="Измени фильтр или собери уведомления для ближайших событий." title="Очередь пуста" />}
          </AdminSection>
        </TabsContent>
        <TabsContent value="logs">
          <AdminSection description="Последние попытки отправки без внешних и персональных идентификаторов Telegram." title="Журнал отправки">
            <div className="max-w-full overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Событие</TableHead><TableHead>Канал</TableHead><TableHead>Состояние</TableHead><TableHead>Время</TableHead><TableHead>Ошибка</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.logs.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{getAdminNotificationEventLabel(entry.event_type)}</TableCell>
                      <TableCell>{entry.channel}</TableCell>
                      <TableCell><AdminStatusBadge status={entry.status} /></TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(entry.created_at)}</TableCell>
                      <TableCell className="min-w-72 text-xs text-danger">{entry.error_message ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </AdminSection>
        </TabsContent>
        <TabsContent value="connections">
          <AdminSection description="Показываются только безопасные признаки подключения." title="Состояние Telegram">
            <div className="grid">
              {data.accounts.map((account) => (
                <div className="grid gap-2 border-b border-border p-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto]" key={account.user_id}>
                  <div>
                    <p className="font-medium">{account.username ? `@${account.username}` : "Подключение без username"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Последняя доставка: {account.last_delivery_at ? formatDate(account.last_delivery_at) : "ещё не было"}</p>
                    {account.last_error ? <p className="mt-2 text-xs text-danger">{account.last_error}</p> : null}
                  </div>
                  <AdminStatusBadge status={account.is_active ? "active" : "warning"} />
                </div>
              ))}
            </div>
          </AdminSection>
        </TabsContent>
      </AdminUrlTabs>
    </AdminPage>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(value));
}
