import Link from "next/link";
import { AlertTriangle, ArrowRight, Play } from "lucide-react";

import { runAdminJobAction } from "@/app/admin/operations";
import { AdminActionForm } from "@/components/admin/admin-action-form";
import {
  AdminEmpty,
  AdminMetric,
  AdminPage,
  AdminPageHeader,
  AdminSection,
  AdminStatusBadge,
} from "@/components/admin/admin-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { loadAdminOverview } from "@/data/admin-repository";
import { getAdminJobCopy } from "@/lib/admin-display";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export default async function AdminOverviewPage() {
  await requireAdmin();
  const admin = createSupabaseAdminClient();

  if (!admin) {
    throw new Error("Серверный клиент админки недоступен");
  }

  const overview = await loadAdminOverview(admin);
  const urgentSignals = overview.urgentSignalsCount + overview.metrics.urgentFindings;

  return (
    <AdminPage>
      <AdminPageHeader
        actions={(
          <AdminActionForm
            action={runAdminJobAction}
            className="min-w-64"
            submitLabel="Проверить источники"
            submitVariant="secondary"
          >
            <input name="jobName" type="hidden" value="rss.fetch_all" />
          </AdminActionForm>
        )}
        description="Свежесть данных, очереди и ошибки в одном месте. Интервалы рассчитаны по расписанию каждой фоновой задачи."
        title="Операционный обзор"
      />

      {urgentSignals ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Нужна проверка</AlertTitle>
          <AlertDescription>
            Требуют внимания проверки или проблемы: {urgentSignals}. Подробности доступны
            в операционных разделах.
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid grid-cols-2 gap-x-0 gap-y-5 border-b border-border pb-5 lg:grid-cols-4">
        <AdminMetric
          helper={`${overview.metrics.urgentFindings} срочных`}
          label="Проблемы"
          tone={overview.metrics.activeFindings ? "warning" : "success"}
          value={String(overview.metrics.activeFindings)}
        />
        <AdminMetric
          helper={`${overview.metrics.failedJobs} с ошибкой за 24 часа`}
          label="В очереди и обработке"
          tone={overview.metrics.failedJobs ? "danger" : "default"}
          value={String(overview.metrics.queuedJobs)}
        />
        <AdminMetric
          helper={`${overview.metrics.notificationFailed} с ошибкой`}
          label="Telegram"
          tone={overview.metrics.notificationFailed ? "danger" : "default"}
          value={String(overview.metrics.notificationQueued)}
        />
        <AdminMetric
          helper={`${overview.metrics.aiRuns} запусков за 30 дней`}
          label="AI-расходы"
          value={`$${overview.metrics.aiCost.toFixed(2)}`}
        />
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)]">
        <AdminSection
          actions={<Button asChild size="sm" variant="secondary"><Link href="/admin/jobs">Все задачи<ArrowRight aria-hidden="true" data-icon="inline-end" /></Link></Button>}
          description="Последние запросы из админки и расписания."
          title="Задачи"
        >
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Задача</TableHead>
                  <TableHead>Состояние</TableHead>
                  <TableHead>Обработано</TableHead>
                  <TableHead>Начало</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <p className="font-medium">{getAdminJobCopy(job.jobName).title}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{getAdminJobCopy(job.jobName).description}</p>
                    </TableCell>
                    <TableCell><AdminStatusBadge status={job.queueVersion === null && job.status === "queued" ? "legacy" : job.status} /></TableCell>
                    <TableCell className="font-mono tabular-nums">{job.itemsProcessed}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(job.startedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="grid gap-0 md:hidden">
            {overview.jobs.map((job) => (
              <article className="grid gap-2 border-b border-border p-4 last:border-b-0" key={job.id}>
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">{getAdminJobCopy(job.jobName).title}</p>
                  <AdminStatusBadge status={job.queueVersion === null && job.status === "queued" ? "legacy" : job.status} />
                </div>
                <p className="text-xs leading-5 text-muted-foreground">{getAdminJobCopy(job.jobName).description}</p>
                <p className="text-xs text-muted-foreground">{formatDate(job.startedAt)}, обработано {job.itemsProcessed}</p>
              </article>
            ))}
          </div>
        </AdminSection>

        <AdminSection
          actions={(
            <Button asChild size="sm" variant="ghost">
              <Link href="/admin/systems">Все системы <ArrowRight data-icon="inline-end" /></Link>
            </Button>
          )}
          description={`Ошибки и проверки, которые не обновились по активному расписанию. Показано ${overview.signals.length} из ${overview.attentionSignalsCount}.`}
          title="Что требует внимания"
        >
          {overview.signals.length ? <div className="grid">
            {overview.signals.map((signal) => (
              <Link
                className="grid gap-2 border-b border-border p-4 transition-colors last:border-b-0 hover:bg-accent/50 sm:grid-cols-[minmax(0,1fr)_auto]"
                href={signal.href ?? "/admin"}
                key={signal.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{signal.label}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{signal.detail}</p>
                </div>
                <AdminStatusBadge status={signal.status} />
              </Link>
            ))}
          </div> : (
            <AdminEmpty
              description="Источники отвечают, а плановые проверки обновляются вовремя."
              title="Сейчас всё работает"
            />
          )}
        </AdminSection>
      </div>

      <details className="rounded-lg border border-border p-4"><summary className="cursor-pointer font-medium">На паузе: {overview.pausedSignals.length}</summary><p className="mt-2 text-xs text-muted-foreground">Сбор уведомлений уже включает отправку: пауза отдельной задачи доставки не останавливает Telegram. Историческая причина остальных пауз может быть не указана.</p><div className="mt-3 grid gap-2">{overview.pausedSignals.map(signal => <Link className="text-sm text-muted-foreground hover:text-foreground" href={signal.href ?? "/admin/systems"} key={signal.id}>{signal.label} — на паузе</Link>)}</div></details>

      <AdminSection
        description="Безопасные команды для самых частых проверок."
        title="Быстрые действия"
      >
        <div className="grid gap-4 p-4 md:grid-cols-3">
          {[
            ["social.fetch_all", "Проверить соцсети"],
            ["jolpica.sync_results", "Обновить результаты"],
            ["notifications.dispatch", "Отправить уведомления"],
          ].map(([jobName, label]) => {
            const jobCopy = getAdminJobCopy(jobName);

            return (
              <AdminActionForm
                action={runAdminJobAction}
                className="rounded-md border border-border p-4"
                key={jobName}
                submitLabel={label}
                submitVariant="secondary"
              >
                <input name="jobName" type="hidden" value={jobName} />
                <Play aria-hidden="true" className="size-5 text-primary" />
                <div>
                  <h3 className="text-sm font-medium">{jobCopy.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{jobCopy.description}</p>
                </div>
              </AdminActionForm>
            );
          })}
        </div>
      </AdminSection>
    </AdminPage>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Moscow",
  }).format(new Date(value));
}
