import Link from "next/link";
import { ExternalLink } from "lucide-react";

import {
  runAdminJobAction,
  saveDigestAction,
  saveGrandPrixReportAction,
} from "@/app/admin/operations";
import { AdminActionForm } from "@/components/admin/admin-action-form";
import { AdminConfirmedForm } from "@/components/admin/admin-confirmed-form";
import { AdminUrlTabs } from "@/components/admin/admin-url-tabs";
import { AdminFilters } from "@/components/admin/admin-filters";
import {
  AdminDigestMeta,
  AdminEmpty,
  AdminPage,
  AdminPageHeader,
  AdminPagination,
  AdminSection,
  AdminStatusBadge,
  AdminTechnicalValue,
} from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { loadAdminReports, parseAdminTableQuery } from "@/data/admin-repository";
import { normalizeDailyDigestBody } from "@/lib/daily-digest-content";
import { requireAdmin } from "@/lib/auth";
import { formatGrandPrixNameRu } from "@/lib/race-display";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminReportsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Серверный клиент админки недоступен");
  const query = parseAdminTableQuery(await searchParams);
  const data = await loadAdminReports(admin, query);

  return (
    <AdminPage>
      <AdminPageHeader
        actions={(
          <AdminActionForm action={runAdminJobAction} submitLabel="Проверить отчёты" submitVariant="secondary">
            <input name="jobName" type="hidden" value="reports.check_latest" />
          </AdminActionForm>
        )}
        description="Состояние источников, краткие выводы редактора и безопасная перезагрузка данных завершённых Гран-при."
        title="Отчёты Гран-при"
      />
      <AdminUrlTabs defaultValue="reports" values={["reports", "digests"]}>
        <TabsList variant="line">
          <TabsTrigger value="reports">Отчёты</TabsTrigger>
          <TabsTrigger value="digests">Дневные сводки</TabsTrigger>
        </TabsList>
        <TabsContent value="reports">
          <AdminSection description={`${data.total} отчётов по текущему запросу.`} title="Отчёты">
            <AdminFilters query={query}
              search={query.search}
              status={query.status}
              statuses={[
                { value: "ready", label: "Готовы" },
                { value: "partial", label: "Частичные" },
                { value: "pending", label: "Ожидают данных" },
                { value: "failed", label: "С ошибкой" },
              ]}
            />
            {data.items.length ? (
              <div className="grid">
                {data.items.map((report) => (
                  <article className="grid gap-4 border-b border-border p-4 last:border-b-0 xl:grid-cols-[minmax(0,1fr)_22rem]" key={report.id}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <AdminStatusBadge status={report.status} />
                        <AdminStatusBadge status={report.is_hidden ? "hidden" : "published"} />
                        <AdminStatusBadge status={report.summary_status} />
                      </div>
                      <h2 className="mt-3 font-semibold">{formatGrandPrixNameRu(report.race_name)}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {report.season}, этап {report.round}
                        {report.circuit_name ? `, ${report.circuit_name}` : ""}
                      </p>
                      {report.ai_summary ? <p className="mt-3 max-w-[80ch] text-sm leading-6">{report.ai_summary}</p> : null}
                      {report.last_error ? <p className="mt-3 text-sm text-danger">{report.last_error}</p> : null}
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Состояние источников</summary>
                        <div className="mt-2"><AdminTechnicalValue value={report.source_errors} /></div>
                      </details>
                      <div className="mt-3">
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/calendar/${report.season}/${report.round}`} target="_blank">Открыть этап<ExternalLink aria-hidden="true" data-icon="inline-end" /></Link>
                        </Button>
                      </div>
                    </div>
                    <div className="grid content-start gap-3">
                      <AdminConfirmedForm action={saveGrandPrixReportAction} confirmLabel="Сохранить" description="Изменение видимости сразу отразится на публичной странице этапа." submitLabel="Сохранить отчёт" submitVariant="secondary" title="Сохранить отчёт?">
                        <input name="reportId" type="hidden" value={report.id} />
                        <FieldGroup>
                          <Field>
                            <FieldLabel htmlFor={`report-summary-${report.id}`}>Краткий вывод</FieldLabel>
                            <Textarea defaultValue={report.ai_summary ?? ""} id={`report-summary-${report.id}`} name="summary" rows={7} />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor={`report-visibility-${report.id}`}>Показ на сайте</FieldLabel>
                            <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue={String(report.is_hidden)} id={`report-visibility-${report.id}`} name="isHidden">
                              <option value="false">Показывать</option>
                              <option value="true">Скрыть</option>
                            </select>
                          </Field>
                        </FieldGroup>
                      </AdminConfirmedForm>
                      <AdminActionForm action={runAdminJobAction} submitLabel="Загрузить заново" submitVariant="secondary">
                        <input name="jobName" type="hidden" value="reports.generate" />
                        <input name="season" type="hidden" value={report.season} />
                        <input name="round" type="hidden" value={report.round} />
                        <input name="force" type="hidden" value="true" />
                      </AdminActionForm>
                      <AdminActionForm action={runAdminJobAction} submitLabel="Пересобрать вывод" submitVariant="secondary">
                        <input name="jobName" type="hidden" value="reports.generate_summary" />
                        <input name="season" type="hidden" value={report.season} />
                        <input name="round" type="hidden" value={report.round} />
                      </AdminActionForm>
                    </div>
                  </article>
                ))}
                <AdminPagination query={query} page={query.page} pageSize={query.pageSize} pathname="/admin/reports" search={query.search} status={query.status} total={data.total} />
              </div>
            ) : (
              <AdminEmpty description="Измени фильтр или проверь данные завершённых гонок." title="Отчётов по запросу нет" />
            )}
          </AdminSection>
        </TabsContent>
        <TabsContent value="digests">
          <AdminSection description="Те же дневные сводки доступны из раздела новостей." title="Сводки дня">
            <AdminFilters query={query} search={query.search} status={query.status} statuses={[{ value: "draft", label: "Черновики" }, { value: "published", label: "Опубликованы" }, { value: "hidden", label: "Скрыты" }]} />
            {data.digests.length ? (
              <div className="grid gap-4 p-4">
                {data.digests.map((digest) => (
                  <AdminConfirmedForm action={saveDigestAction} className="rounded-md border border-border p-4" confirmLabel="Сохранить" description="Если выбрана публикация, сводка сразу станет доступна читателям." key={digest.id} submitLabel="Сохранить сводку" submitVariant="secondary" title="Сохранить сводку?">
                    <input name="digestId" type="hidden" value={digest.id} />
                    <AdminDigestMeta dateKey={digest.date_key} status={digest.status} />
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor={`digest-title-${digest.id}`}>Заголовок</FieldLabel>
                        <Input defaultValue={digest.title} id={`digest-title-${digest.id}`} name="title" />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`digest-body-${digest.id}`}>Текст</FieldLabel>
                        <Textarea defaultValue={normalizeDailyDigestBody(digest.body_md)} id={`digest-body-${digest.id}`} name="body" rows={8} />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`digest-status-${digest.id}`}>Публикация</FieldLabel>
                        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue={digest.status} id={`digest-status-${digest.id}`} name="status">
                          <option value="draft">Черновик</option>
                          <option value="published">Опубликована</option>
                          <option value="hidden">Скрыта</option>
                        </select>
                      </Field>
                    </FieldGroup>
                  </AdminConfirmedForm>
                ))}
              </div>
            ) : <AdminEmpty description="Сводка появится после первой AI-генерации." title="Сводок пока нет" />}
            <AdminPagination query={query} page={query.page} pageSize={query.pageSize} pathname="/admin/reports" total={data.digestsTotal} />
          </AdminSection>
        </TabsContent>
      </AdminUrlTabs>
    </AdminPage>
  );
}
