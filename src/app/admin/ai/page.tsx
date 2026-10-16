import Link from "next/link";

import {
  moderateSocialPostAction,
  reprocessNewsArticleAction,
  runAdminJobAction,
  saveAiBudgetAction,
  saveXApiBudgetAction,
} from "@/app/admin/operations";
import { AdminActionForm } from "@/components/admin/admin-action-form";
import { AdminConfirmedAction } from "@/components/admin/admin-confirmed-action";
import { AdminUrlTabs } from "@/components/admin/admin-url-tabs";
import { AdminAiPromptRegistry } from "@/components/admin/admin-ai-prompt-registry";
import { AdminCostChart } from "@/components/admin/admin-cost-chart";
import {
  AdminEmpty,
  AdminMetric,
  AdminPage,
  AdminPageHeader,
  AdminSection,
  AdminStatusBadge,
} from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AdminFilters } from "@/components/admin/admin-filters";
import { AdminPagination } from "@/components/admin/admin-ui";
import { loadAdminAi, parseAdminTableQuery } from "@/data/admin-repository";
import {
  getAdminAiPromptLabel,
  getAdminAiPurposeLabel,
} from "@/lib/admin-display";
import { requireAdmin } from "@/lib/auth";
import { loadOpenRouterModels } from "@/lib/openrouter-models";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { AdminAiUsageSummaryRow } from "@/types/admin";

export default async function AdminAiPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Серверный клиент админки недоступен");
  const query = parseAdminTableQuery(await searchParams);
  const [data, models] = await Promise.all([
    loadAdminAi(admin, query),
    loadOpenRouterModels().catch(() => []),
  ]);
  const todayCost = Number(data.budgetUsage?.daily_spend_usd ?? 0);
  const totalTokens = data.totalInputTokens + data.totalOutputTokens;
  const promptVersionById = new Map(
    data.prompts.flatMap((item) =>
      item.history.map((version) => [version.id, version.version] as const),
    ),
  );

  return (
    <AdminPage>
      <AdminPageHeader
        actions={<AdminActionForm action={runAdminJobAction} submitLabel="Обработать новости" submitVariant="secondary"><input name="jobName" type="hidden" value="ai.process_news" /></AdminActionForm>}
        description="Инструкции для AI, расходы, рабочие лимиты и материалы с проблемной обработкой. Ключи доступа и серверные настройки здесь недоступны."
        title="AI и бюджет"
      />
      <section className="grid grid-cols-2 gap-y-5 border-b border-border pb-5 lg:grid-cols-5">
        <AdminMetric label="Сегодня (UTC)" tone={todayCost >= Number(data.budget.daily_limit_usd) ? "danger" : "default"} value={`$${todayCost.toFixed(2)}`} />
        <AdminMetric label="За 30 дней" tone={data.totalCost >= Number(data.budget.monthly_limit_usd) ? "danger" : "default"} value={`$${data.totalCost.toFixed(2)}`} />
        <AdminMetric label="Обращения к AI" value={formatInteger(data.totalRuns)} />
        <AdminMetric label="Токены" value={formatCompactInteger(totalTokens)} />
        <AdminMetric
          helper={`${formatInteger(data.xApiPosts30Days)} прочитанных постов`}
          label="X API за 30 дней"
          tone={data.xApiSpend30Days >= Number(data.xApiBudget.monthly_limit_usd) ? "danger" : "default"}
          value={`$${data.xApiSpend30Days.toFixed(2)}`}
        />
      </section>
      <AdminUrlTabs defaultValue="prompts" values={["prompts", "history", "usage", "problems", "limits"]}>
        <TabsList variant="line">
          <TabsTrigger value="prompts">Промпты и задачи</TabsTrigger>
          <TabsTrigger value="history">История инструкций</TabsTrigger>
          <TabsTrigger value="usage">Расходы</TabsTrigger>
          <TabsTrigger value="problems">Проблемные материалы</TabsTrigger>
          <TabsTrigger value="limits">Лимиты</TabsTrigger>
        </TabsList>
        <TabsContent value="prompts">
          <Alert>
            <AlertTitle>Инструкции фоновых задач RaceSide</AlertTitle>
            <AlertDescription>
              Можно менять инструкции и лимит ответа для задач из этого каталога.
              Радио LIVE использует общий бюджет. Его перевод и распознавание настраиваются в коде и не входят в этот каталог.
              Ключи, исходные материалы и ответы AI здесь не показываются.
              Защищённый формат ответа остаётся неизменным.
            </AlertDescription>
          </Alert>
          <AdminSection
            className="mt-5"
            description="Черновик не влияет на обработку. Новая инструкция начинает работать только после публикации версии."
            title="Инструкции для AI"
          >
            <AdminAiPromptRegistry items={data.prompts} models={models} />
          </AdminSection>
        </TabsContent>
        <TabsContent value="history">
          <AdminSection title="История выбранной инструкции" description={`${data.historyTotal} версий. История сохраняется отдельно для каждой инструкции.`}>
            <AdminFilters hideSearch query={query} filters={[{ name: "promptKey", allowAll: false, label: "Инструкция", value: data.selectedPrompt.key, options: data.prompts.map(item => ({ value: item.definition.key, label: item.definition.title })) }]} />
            <div className="divide-y divide-border">{data.history.map(version => <article className="grid gap-2 p-4" key={version.id}>
              <div className="flex flex-wrap items-center gap-3"><strong>Версия {version.version}</strong><AdminStatusBadge status={version.status} /><span className="text-xs text-muted-foreground">{formatDate(version.publishedAt ?? version.createdAt)}</span></div>
              <p className="text-sm text-muted-foreground">{version.changeNote || "Описание изменений не добавлено"}</p>
              <p className="text-xs text-muted-foreground">{version.model} · до {version.maxTokens} токенов</p>
            </article>)}</div>
            <AdminPagination query={query} page={query.page} pageSize={query.pageSize} pathname="/admin/ai" total={data.historyTotal} />
          </AdminSection>
        </TabsContent>
        <TabsContent value="usage">
          <AdminSection
            description="AI API считается по записанной стоимости OpenRouter, X API — по числу прочитанных постов и установленной цене за один пост."
            title="Расходы по дням"
          >
            <div className="max-w-full overflow-x-auto p-4">
              <AdminCostChart data={data.costTimeline} />
            </div>
          </AdminSection>
          <div className="grid gap-5 xl:grid-cols-3">
            <UsageTable rows={data.byDay} title="По дням" />
            <UsageTable rows={data.byModel} title="По моделям" />
            <UsageTable formatBucket={getAdminAiPurposeLabel} rows={data.byPurpose} title="По назначению" />
          </div>
          <AdminSection className="mt-5" description="Последние 100 обращений без ключей, исходных материалов и ответов AI." title="Последние обращения">
            <div className="max-w-full overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Время</TableHead><TableHead>Задача</TableHead><TableHead>Версия</TableHead><TableHead>Модель</TableHead><TableHead>Токены</TableHead><TableHead>Стоимость</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.recent.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(row.created_at)}</TableCell>
                      <TableCell>{getAdminAiPromptLabel(row.prompt_key) ?? getAdminAiPurposeLabel(row.purpose)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatPromptVersion(
                          row.prompt_key,
                          row.prompt_version_id,
                          promptVersionById,
                        )}
                      </TableCell>
                      <TableCell className="font-mono">{row.model}</TableCell>
                      <TableCell className="font-mono tabular-nums">{formatInteger((row.input_tokens ?? 0) + (row.output_tokens ?? 0))}</TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {row.estimated_cost_usd === null ? "Не записана" : `$${Number(row.estimated_cost_usd).toFixed(6)}`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </AdminSection>
        </TabsContent>
        <TabsContent value="problems">
          <div className="grid gap-5 xl:grid-cols-2">
            <AdminSection description="Последние 100 резервных текстов и материалов со сбоем обработки." title="Новости">
              {data.problemArticles.length ? (
                <div className="grid">
                  {data.problemArticles.map((article) => (
                    <article className="grid gap-3 border-b border-border p-4 last:border-b-0" key={article.id}>
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium">{article.ai_title_ru ?? article.original_title}</p>
                        <AdminStatusBadge status={article.publication_status} />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="ghost"><Link href={`/admin/news?search=${encodeURIComponent(article.ai_title_ru ?? article.original_title)}`}>Открыть материал</Link></Button>
                        <AdminActionForm action={reprocessNewsArticleAction} submitLabel="Пересобрать текст" submitVariant="secondary">
                          <input name="articleId" type="hidden" value={article.id} />
                          <input name="mode" type="hidden" value="ai" />
                        </AdminActionForm>
                      </div>
                    </article>
                  ))}
                </div>
              ) : <AdminEmpty description="Резервные тексты и ошибки появятся здесь." title="Проблемных новостей нет" />}
            </AdminSection>
            <AdminSection description="Последние 100 постов с ошибкой AI-обработки." title="Соцсети">
              {data.problemPosts.length ? (
                <div className="grid">
                  {data.problemPosts.map((post) => (
                    <article className="grid gap-3 border-b border-border p-4 last:border-b-0" key={post.id}>
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium">{post.ai_title_ru ?? post.title ?? "Публикация без заголовка"}</p>
                        <AdminStatusBadge status={post.status} />
                      </div>
                      <p className="text-xs leading-5 text-danger">{post.last_processing_error}</p>
                      <AdminConfirmedAction action={moderateSocialPostAction} confirmLabel="Переработать" description="Публикация снова попадёт в очередь AI-обработки." title="Запустить обработку заново?" triggerLabel="Переработать публикацию" triggerVariant="secondary">
                        <input name="postId" type="hidden" value={post.id} />
                        <input name="moderationAction" type="hidden" value="retry" />
                      </AdminConfirmedAction>
                    </article>
                  ))}
                </div>
              ) : <AdminEmpty description="Новые ошибки обработки появятся здесь." title="Проблемных постов нет" />}
            </AdminSection>
          </div>
        </TabsContent>
        <TabsContent value="limits">
          <div className="grid gap-5 xl:grid-cols-2">
          <AdminSection description="Останавливает новые обращения ко всем AI-задачам после достижения лимита." title="Общий AI-бюджет">
            <AdminActionForm action={saveAiBudgetAction} className="p-4" submitLabel="Сохранить общий бюджет">
              <input name="scope" type="hidden" value="default" />
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="ai-daily-limit">Лимит за сутки UTC, USD</FieldLabel>
                  <Input defaultValue={Number(data.budget.daily_limit_usd)} id="ai-daily-limit" min="0.01" name="dailyLimitUsd" step="0.01" type="number" />
                  <FieldDescription>Расход за текущие сутки UTC: ${todayCost.toFixed(2)}.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="ai-monthly-limit">Лимит за 30 дней, USD</FieldLabel>
                  <Input defaultValue={Number(data.budget.monthly_limit_usd)} id="ai-monthly-limit" min="0.01" name="monthlyLimitUsd" step="0.01" type="number" />
                  <FieldDescription>Расход за последние 30 дней: ${data.totalCost.toFixed(2)}.</FieldDescription>
                </Field>
              </FieldGroup>
            </AdminActionForm>
          </AdminSection>
          <AdminSection description="Оценка расходов на чтение постов через X API. Цена применяется к новым обращениям и не меняет уже записанную историю." title="Бюджет X API">
            <AdminActionForm action={saveXApiBudgetAction} className="p-4" submitLabel="Сохранить бюджет X API">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="x-unit-cost">Цена чтения одного поста, USD</FieldLabel>
                  <Input defaultValue={Number(data.xApiBudget.unit_cost_usd)} id="x-unit-cost" min="0.000001" name="unitCostUsd" step="0.000001" type="number" />
                  <FieldDescription>Сейчас один прочитанный пост оценивается в ${Number(data.xApiBudget.unit_cost_usd).toFixed(6)}.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="x-daily-limit">Дневной лимит, USD</FieldLabel>
                  <Input defaultValue={Number(data.xApiBudget.daily_limit_usd)} id="x-daily-limit" min="0.01" name="dailyLimitUsd" step="0.01" type="number" />
                  <FieldDescription>Сегодня: ${data.xApiSpendToday.toFixed(2)} за {formatInteger(data.xApiPostsToday)} постов.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="x-monthly-limit">Лимит на 30 дней, USD</FieldLabel>
                  <Input defaultValue={Number(data.xApiBudget.monthly_limit_usd)} id="x-monthly-limit" min="0.01" name="monthlyLimitUsd" step="0.01" type="number" />
                  <FieldDescription>За 30 дней: ${data.xApiSpend30Days.toFixed(2)} за {formatInteger(data.xApiPosts30Days)} постов.</FieldDescription>
                </Field>
              </FieldGroup>
            </AdminActionForm>
          </AdminSection>
          </div>
        </TabsContent>
      </AdminUrlTabs>
    </AdminPage>
  );
}

function UsageTable({
  formatBucket = (bucket) => bucket,
  rows,
  title,
}: {
  formatBucket?: (bucket: string) => string;
  rows: AdminAiUsageSummaryRow[];
  title: string;
}) {
  return (
    <AdminSection title={title}>
      <div className="grid">
        {rows.slice(0, 12).map((row) => (
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0" key={row.bucket}>
            <div className="min-w-0">
              <p className="truncate text-sm">{formatBucket(row.bucket)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatInteger(row.input_tokens + row.output_tokens)} токенов · {formatInteger(row.request_count)} вызовов
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-sm tabular-nums">${row.cost_usd.toFixed(6)}</p>
              {row.unpriced_count ? <p className="mt-1 text-xs text-warning">Без цены: {formatInteger(row.unpriced_count)}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </AdminSection>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(value));
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

function formatCompactInteger(value: number) {
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatPromptVersion(
  promptKey: string | null,
  promptVersionId: string | null,
  versions: Map<string, number>,
) {
  if (!promptKey) return "Прежний вызов";
  if (!promptVersionId) return "Стандартная";
  const version = versions.get(promptVersionId);
  return version ? `Версия ${version}` : "Из истории";
}
