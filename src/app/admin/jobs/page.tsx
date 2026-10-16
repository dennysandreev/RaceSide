import {
  retryAdminJobAction,
  runAdminJobAction,
} from "@/app/admin/operations";
import { AdminActionForm } from "@/components/admin/admin-action-form";
import { AdminUrlTabs } from "@/components/admin/admin-url-tabs";
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
  AdminTechnicalValue,
} from "@/components/admin/admin-ui";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadAdminJobs, parseAdminTableQuery } from "@/data/admin-repository";
import { validateAdminJobRequest } from "@/lib/admin-job-catalog";
import { sanitizeAdminAuditPayload } from "@/lib/admin-audit";
import { getAdminJobCopy } from "@/lib/admin-display";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { AdminJobDefinition } from "@/types/admin";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminJobsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Серверный клиент админки недоступен");
  const query = parseAdminTableQuery(await searchParams);
  const data = await loadAdminJobs(admin, query);

  return (
    <AdminPage>
      <AdminPageHeader
        description="Только разрешённые действия и проверенные параметры. Произвольные служебные команды из интерфейса недоступны."
        title="Фоновые задачи"
      />
      <AdminUrlTabs defaultValue="runs" values={["runs", "catalog"]}>
        <TabsList variant="line">
          <TabsTrigger value="runs">Очередь и история</TabsTrigger>
          <TabsTrigger value="catalog">Каталог задач</TabsTrigger>
        </TabsList>
        <TabsContent value="runs">
          <AdminSection description={`${data.total} запусков по текущему запросу.`} title="Запуски">
            <AdminFilters query={query} dateRange filters={[{ name: "sort", label: "Порядок", value: query.sort, options: [{ value: "newest", label: "Сначала новые" }, { value: "oldest", label: "Сначала старые" }] }]}
              search={query.search}
              status={query.status}
              statuses={[
                { value: "queued", label: "В очереди" },
                { value: "running", label: "Выполняются" },
                { value: "success", label: "Готовы" },
                { value: "failed", label: "С ошибкой" },
              ]}
            />
            {data.items.length ? (
              <div className="grid">
                {data.items.map((job) => {
                  const legacy = job.status === "queued" && job.queueVersion !== 1;
                  const args = job.metadata && typeof job.metadata === "object" && !Array.isArray(job.metadata) ? job.metadata.args : {};
                  const validation = validateAdminJobRequest(job.jobName, args && typeof args === "object" && !Array.isArray(args) ? args : {});
                  const availability = data.catalog.find(definition => definition.name === job.jobName)?.availability;
                  const available = validation.ok && availability?.available !== false;
                  const retryable = (job.status === "failed" || legacy) && available;
                  const jobCopy = getAdminJobCopy(job.jobName);
                  return (
                    <article className="grid gap-4 border-b border-border p-4 last:border-b-0 xl:grid-cols-[minmax(0,1fr)_15rem]" key={job.id}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <AdminStatusBadge status={legacy ? "legacy" : job.status} />
                          <span className="text-xs text-muted-foreground">{formatDate(job.startedAt)}</span>
                        </div>
                        <h2 className="mt-3 font-medium">{jobCopy.title}</h2>
                        <p className="mt-1 max-w-[72ch] text-sm leading-6 text-muted-foreground">{jobCopy.description}</p>
                        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                          <div><dt className="text-xs text-muted-foreground">Обработано</dt><dd className="mt-1 font-mono">{job.itemsProcessed}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">Попытка</dt><dd className="mt-1 font-mono">{job.attemptCount}/{job.maxAttempts}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">Начата обработка</dt><dd className="mt-1">{job.claimedAt ? formatDate(job.claimedAt) : "нет"}</dd></div>
                          <div><dt className="text-xs text-muted-foreground">Длительность</dt><dd className="mt-1">{formatDuration(job.startedAt, job.finishedAt)}</dd></div>
                        </dl>
                        {job.errorMessage ? <p className="mt-3 text-sm leading-6 text-danger">{job.errorMessage}</p> : null}
                        <details className="mt-3">
                          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Технические данные запуска</summary>
                          <p className="mt-2 font-mono text-xs text-muted-foreground">Код задачи: {job.jobName}</p>
                          <div className="mt-2"><AdminTechnicalValue value={sanitizeAdminAuditPayload(job.metadata)} /></div>
                        </details>
                      </div>
                      <div className="grid content-start gap-3">
                        {legacy ? <p className="text-xs leading-5 text-warning">Прежний запрос не будет выполнен автоматически.</p> : null}
                        {(job.status === "failed" || legacy) && !available ? <p className="text-xs leading-5 text-muted-foreground">{availability?.available === false ? availability.detail : "Команда или её параметры больше недоступны. Для нового запуска выбери задачу в каталоге."}</p> : null}
                        {retryable && validation.ok && validation.definition.danger ? (
                          <AdminConfirmedAction action={retryAdminJobAction} confirmLabel="Повторить" description={validation.definition.confirmation ?? validation.definition.description} title={`Повторить «${validation.definition.title}»?`} triggerLabel="Повторить"><input name="jobRunId" type="hidden" value={job.id} /></AdminConfirmedAction>
                        ) : retryable ? (
                          <AdminActionForm action={retryAdminJobAction} submitLabel="Повторить" submitVariant="secondary">
                            <input name="jobRunId" type="hidden" value={job.id} />
                          </AdminActionForm>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
                <AdminPagination query={query} page={query.page} pageSize={query.pageSize} pathname="/admin/jobs" search={query.search} status={query.status} total={data.total} />
              </div>
            ) : <AdminEmpty description="Измени фильтр или запусти задачу из каталога." title="Запусков по запросу нет" />}
          </AdminSection>
        </TabsContent>
        <TabsContent value="catalog">
          <AdminSection description="Параметры ограничены каталогом и повторно проверяются перед запуском." title="Разрешённые задачи">
            <div className="grid gap-4 p-4 lg:grid-cols-2 2xl:grid-cols-3">
              {data.catalog.filter(definition => definition.group !== "legacy").map((definition) => (
                <JobDefinitionForm definition={definition} key={definition.name} />
              ))}
            </div>
          </AdminSection>
          <details className="mt-5 rounded-lg border border-border p-4"><summary className="cursor-pointer font-medium">Поддержка прошлых оплат</summary><p className="mt-2 text-sm text-muted-foreground">ЮMoney и Tribute обслуживают историю ранее оформленных заказов. Новые оплаты проходят через Lava.top.</p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">{data.catalog.filter(definition => definition.group === "legacy").map(definition => <JobDefinitionForm definition={definition} key={definition.name} />)}</div>
          </details>
        </TabsContent>
      </AdminUrlTabs>
    </AdminPage>
  );
}

function JobDefinitionForm({ definition }: { definition: AdminJobDefinition }) {
  if (definition.availability?.available === false) return <div className="grid gap-2 rounded-md border border-border p-4"><h2 className="font-medium">{definition.title}</h2><p className="text-sm text-muted-foreground">{definition.description}</p><p className="text-xs text-muted-foreground">{definition.availability.detail}</p></div>;
  const fields = (
    <>
      <input name="jobName" type="hidden" value={definition.name} />
      <div>
        <h2 className="font-medium">{definition.title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{definition.description}</p>
        {definition.availability ? <p className="mt-2 text-xs text-muted-foreground">{definition.availability.detail}</p> : null}
      </div>
      {definition.parameters.map((parameter) => (
        <Field key={parameter.name}>
          <FieldLabel htmlFor={`${definition.name}-${parameter.name}`}>{parameterLabels[parameter.name] ?? parameter.name}</FieldLabel>
          {parameter.type === "boolean" ? (
            <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue="false" id={`${definition.name}-${parameter.name}`} name={parameter.name}>
              <option value="false">Нет</option>
              <option value="true">Да</option>
            </select>
          ) : (
            <Input
              id={`${definition.name}-${parameter.name}`}
              max={parameter.max}
              min={parameter.min}
              name={parameter.name}
              required={parameter.required}
              type={parameter.type === "integer" ? "number" : "text"}
            />
          )}
          {parameter.min !== undefined || parameter.max !== undefined ? (
            <FieldDescription>Допустимо: {parameter.min ?? "любое"}-{parameter.max ?? "любое"}</FieldDescription>
          ) : null}
        </Field>
      ))}
    </>
  );

  if (definition.danger) {
    return (
      <AdminConfirmedForm action={runAdminJobAction} confirmFields={definition.parameters.map(parameter => ({ name: parameter.name, label: parameterLabels[parameter.name] ?? parameter.name }))} className="rounded-md border border-warning/40 p-4" confirmLabel="Запустить задачу" description={definition.confirmation ?? definition.description} title={`Запустить «${definition.title}»?`} submitLabel="Проверить и запустить" submitVariant="secondary">
        {fields}
      </AdminConfirmedForm>
    );
  }

  return (
    <AdminActionForm action={runAdminJobAction} className="rounded-md border border-border p-4" submitLabel="Запустить" submitVariant="secondary">
      {fields}
    </AdminActionForm>
  );
}

const parameterLabels: Record<string, string> = {
  taskId: "Запрос телеметрии",
  reconcileSeason: "Проверить весь сезон",
  articleId: "ID материала",
  force: "Полная перезагрузка",
  limit: "Лимит записей",
  postId: "ID публикации",
  round: "Этап",
  season: "Сезон",
  sourceId: "ID источника",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(value));
}

function formatDuration(startedAt: string, finishedAt: string | null) {
  const seconds = Math.max(0, Math.round((Date.parse(finishedAt ?? new Date().toISOString()) - Date.parse(startedAt)) / 1_000));
  if (seconds < 60) return `${seconds} с`;
  return `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
}
