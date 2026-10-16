import Link from "next/link";
import { ExternalLink } from "lucide-react";

import {
  saveAdminAgentSettingsAction,
  transitionAdminFindingAction,
} from "@/app/admin/operations";
import { AdminActionForm } from "@/components/admin/admin-action-form";
import { AdminFilters } from "@/components/admin/admin-filters";
import {
  AdminEmpty,
  AdminMetric,
  AdminPage,
  AdminPageHeader,
  AdminPagination,
  AdminSection,
  AdminStatusBadge,
  AdminTechnicalValue,
} from "@/components/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { loadAdminFindings, parseAdminTableQuery } from "@/data/admin-repository";
import { sanitizeAdminAuditPayload } from "@/lib/admin-audit";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { AdminFinding, AdminFindingEvent } from "@/types/admin";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminFindingsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Серверный клиент админки недоступен");
  const query = parseAdminTableQuery(await searchParams, { pageSize: 20 });
  const data = await loadAdminFindings(admin, query);
  const latestRun = data.runs[0] ?? null;
  const latestWatcherHeartbeat = data.heartbeats.find((heartbeat) => heartbeat.service_name === "watcher") ?? null;

  return (
    <AdminPage>
      <AdminPageHeader
        description="Автоматическая проверка круглосуточно следит за сайтом, фиксирует отклонения и сообщает о критичных событиях."
        title="Проблемы и проверки"
      />

      <section className="grid grid-cols-2 gap-y-5 border-b border-border pb-5 lg:grid-cols-4">
        <AdminMetric label="Активные" tone={data.metrics.active ? "warning" : "success"} value={String(data.metrics.active)} />
        <AdminMetric label="Срочные" tone={data.metrics.urgent ? "danger" : "default"} value={String(data.metrics.urgent)} />
        <AdminMetric label="Режим" helper="Автоисправления выключены" value={modeLabel(data.settings.mode)} />
        <AdminMetric
          helper={latestRun ? `последний запуск ${formatDate(latestRun.started_at)}` : "запусков ещё не было"}
          label="Проверка"
          tone={latestWatcherHeartbeat?.status === "healthy" ? "success" : "warning"}
          value={latestWatcherHeartbeat?.status === "healthy" ? "Работает" : "Ожидание"}
        />
      </section>

      <AdminSection
        description="Аварийная остановка действует со следующего цикла. Автоисправления можно будет включить только после отдельного решения по итогам периода наблюдения."
        title="Режим работы"
      >
        <AdminActionForm
          action={saveAdminAgentSettingsAction}
          className="grid gap-4 p-4 lg:grid-cols-3 lg:items-end"
          submitLabel="Сохранить режим"
          submitVariant="secondary"
        >
          <Field>
            <FieldLabel htmlFor="agent-enabled">Наблюдение</FieldLabel>
            <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue={String(data.settings.isEnabled)} id="agent-enabled" name="isEnabled">
              <option value="true">Включено</option>
              <option value="false">Остановлено</option>
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="agent-mode">Режим</FieldLabel>
            <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue={data.settings.mode === "limited" ? "recommend" : data.settings.mode} id="agent-mode" name="mode">
              <option value="shadow">Только наблюдать</option>
              <option value="recommend">Готовить рекомендации</option>
            </select>
            <FieldDescription>Автоматические изменения сайта здесь не включаются.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="agent-telegram">Срочные сообщения</FieldLabel>
            <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue={String(data.settings.telegramAlertsEnabled)} id="agent-telegram" name="telegramAlertsEnabled">
              <option value="true">Отправлять администраторам</option>
              <option value="false">Не отправлять</option>
            </select>
          </Field>
        </AdminActionForm>
      </AdminSection>

      <AdminSection
        description={`${data.total} записей по текущему запросу. Повторные срабатывания объединяются.`}
        title="Журнал"
      >
        <AdminFilters query={query}
          search={query.search}
          status={query.status}
          statuses={[
            { value: "open", label: "Открытые" },
            { value: "acknowledged", label: "Принятые" },
            { value: "monitoring", label: "Под наблюдением" },
            { value: "resolved", label: "Исправленные" },
            { value: "ignored", label: "Без действий" },
          ]}
        />
        {data.items.length ? (
          <div className="divide-y divide-border">
            {data.items.map(({ finding, events }) => (
              <FindingRow events={events} finding={finding} key={finding.id} />
            ))}
            <AdminPagination query={query} page={query.page} pageSize={query.pageSize} pathname="/admin/findings" search={query.search} status={query.status} total={data.total} />
          </div>
        ) : (
          <AdminEmpty
            description="Автоматическая проверка продолжает следить за доступностью, очередями, источниками и бюджетом."
            title="Отклонений не найдено"
          />
        )}
      </AdminSection>
    </AdminPage>
  );
}

function FindingRow({ finding, events }: { finding: AdminFinding; events: AdminFindingEvent[] }) {
  const active = !["resolved", "ignored"].includes(finding.status);

  return (
    <article className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={severityVariant(finding.severity)}>{finding.severity}</Badge>
          <AdminStatusBadge status={finding.status} />
          <span className="text-xs text-muted-foreground">{categoryLabel(finding.category)}</span>
        </div>
        <h2 className="mt-3 font-medium">{finding.title}</h2>
        <p className="mt-1 max-w-[80ch] text-sm leading-6 text-muted-foreground">{finding.description}</p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>Впервые: {formatDate(finding.firstSeenAt)}</span>
          <span>Последняя проверка: {formatDate(finding.lastSeenAt)}</span>
          <span>Повторов: {finding.occurrenceCount}</span>
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">История и технические данные</summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <AdminTechnicalValue value={sanitizeAdminAuditPayload(finding.evidence)} />
            <ol className="max-h-64 overflow-auto rounded-md border border-border p-3 text-xs">
              {events.slice(0, 20).map((event) => (
                <li className="flex justify-between gap-3 border-b border-border py-2 last:border-b-0" key={event.id}>
                  <span>{eventLabel(event.eventType)}</span>
                  <time className="shrink-0 text-muted-foreground">{formatDate(event.createdAt)}</time>
                </li>
              ))}
            </ol>
          </div>
        </details>
      </div>
      <div className="grid content-start gap-3">
        {finding.route ? (
          <Button asChild size="sm" variant="outline">
            <Link href={finding.route}>
              <ExternalLink data-icon="inline-start" />
              Открыть связанный раздел
            </Link>
          </Button>
        ) : null}
        {active && finding.status !== "acknowledged" ? (
          <AdminActionForm action={transitionAdminFindingAction} submitLabel="Принять в работу" submitVariant="secondary">
            <input name="findingId" type="hidden" value={finding.id} />
            <input name="status" type="hidden" value="acknowledged" />
          </AdminActionForm>
        ) : null}
        {active ? (
          <AdminActionForm action={transitionAdminFindingAction} submitLabel="Отметить исправленной" submitVariant="default">
            <input name="findingId" type="hidden" value={finding.id} />
            <input name="resolution" type="hidden" value="Проверено администратором." />
            <input name="status" type="hidden" value="resolved" />
          </AdminActionForm>
        ) : null}
        {active ? (
          <AdminActionForm action={transitionAdminFindingAction} submitLabel="Не требует действий" submitVariant="ghost">
            <input name="findingId" type="hidden" value={finding.id} />
            <input name="resolution" type="hidden" value="Администратор исключил находку из работы." />
            <input name="status" type="hidden" value="ignored" />
          </AdminActionForm>
        ) : null}
      </div>
    </article>
  );
}

function severityVariant(severity: string) {
  return severity === "P0" || severity === "P1" ? "danger" as const : severity === "P2" ? "warning" as const : "secondary" as const;
}

function modeLabel(mode: string) {
  return ({ shadow: "Наблюдение", recommend: "Рекомендации", limited: "Ограниченный" })[mode] ?? mode;
}

function categoryLabel(category: string) {
  return ({ availability: "Доступность", data: "Данные", job: "Задачи", content: "Контент", browser: "Интерфейс", security: "Безопасность", cost: "Расходы", ux: "UX", seo: "SEO" })[category] ?? category;
}

function eventLabel(eventType: string) {
  return ({ detected: "Обнаружено", repeated: "Повторилось", severity_changed: "Приоритет изменён", acknowledged: "Принято в работу", resolved: "Исправлено", ignored: "Закрыто без действий", reopened: "Открыто снова", alert_sent: "Сообщение отправлено", action_requested: "Предложено действие" })[eventType] ?? "Состояние обновлено";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(value));
}
