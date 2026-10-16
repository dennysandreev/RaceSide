import { AdminFilters } from "@/components/admin/admin-filters";
import {
  AdminEmpty,
  AdminPage,
  AdminPageHeader,
  AdminPagination,
  AdminSection,
  AdminStatusBadge,
  AdminTechnicalValue,
} from "@/components/admin/admin-ui";
import { loadAdminAudit, parseAdminTableQuery } from "@/data/admin-repository";
import { sanitizeAdminAuditPayload } from "@/lib/admin-audit";
import { getAdminAuditActionCopy, getAdminEntityLabel } from "@/lib/admin-display";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminAuditPage({ searchParams }: PageProps) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Серверный клиент админки недоступен");
  const query = parseAdminTableQuery(await searchParams, { pageSize: 50 });
  const data = await loadAdminAudit(admin, query);

  return (
    <AdminPage>
      <AdminPageHeader
        description="Неизменяемый журнал административных действий. Секреты, исходные служебные данные и идентификаторы Telegram сюда не записываются."
        title="Аудит действий"
      />
      <AdminSection description={`${data.total} записей по текущему запросу.`} title="Журнал">
        <AdminFilters query={query}
          search={query.search}
          status={query.status}
          statuses={[
            { value: "started", label: "Начато" },
            { value: "succeeded", label: "Готово" },
            { value: "failed", label: "Ошибка" },
          ]}
        />
        {data.items.length ? (
          <div className="grid">
            {data.items.map((entry) => {
              const actionCopy = getAdminAuditActionCopy(entry.action);

              return (
                <article className="grid gap-4 border-b border-border p-4 last:border-b-0 xl:grid-cols-[minmax(0,1fr)_16rem]" key={entry.id}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <AdminStatusBadge status={entry.outcome} />
                      <span className="text-xs text-muted-foreground">{formatDate(entry.createdAt)}</span>
                    </div>
                    <h2 className="mt-3 font-medium">{actionCopy.title}</h2>
                    <p className="mt-1 max-w-[72ch] text-sm leading-6 text-muted-foreground">{actionCopy.description}</p>
                    <p className="mt-3 text-sm">
                      {getAdminEntityLabel(entry.entityType)}
                      {entry.entityId ? <span className="font-mono text-muted-foreground"> · {shortId(entry.entityId)}</span> : null}
                    </p>
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Технические данные и изменения</summary>
                      <div className="mt-3 grid gap-2 rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground">
                        <p>Код действия: {entry.action}</p>
                        <p>Тип объекта: {entry.entityType}</p>
                      </div>
                      <div className="mt-3 grid gap-3 lg:grid-cols-3">
                        <div>
                          <p className="mb-2 text-xs font-medium text-muted-foreground">До</p>
                          <AdminTechnicalValue value={sanitizeAdminAuditPayload(entry.beforeData)} />
                        </div>
                        <div>
                          <p className="mb-2 text-xs font-medium text-muted-foreground">После</p>
                          <AdminTechnicalValue value={sanitizeAdminAuditPayload(entry.afterData)} />
                        </div>
                        <div>
                          <p className="mb-2 text-xs font-medium text-muted-foreground">Контекст</p>
                          <AdminTechnicalValue value={sanitizeAdminAuditPayload(entry.metadata)} />
                        </div>
                      </div>
                    </details>
                  </div>
                  <dl className="grid content-start gap-3 text-sm">
                    <div><dt className="text-xs text-muted-foreground">Администратор</dt><dd className="mt-1 font-mono">{shortId(entry.actorUserId)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Завершено</dt><dd className="mt-1">{entry.finishedAt ? formatDate(entry.finishedAt) : "ещё выполняется"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Запись</dt><dd className="mt-1 font-mono">{shortId(entry.id)}</dd></div>
                  </dl>
                </article>
              );
            })}
            <AdminPagination query={query} page={query.page} pageSize={query.pageSize} pathname="/admin/audit" search={query.search} status={query.status} total={data.total} />
          </div>
        ) : <AdminEmpty description="Измени фильтр. Новые административные действия будут записаны автоматически." title="Записей по запросу нет" />}
      </AdminSection>
    </AdminPage>
  );
}

function shortId(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Moscow" }).format(new Date(value));
}
