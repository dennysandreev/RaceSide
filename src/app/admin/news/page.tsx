import Link from "next/link";
import { ExternalLink, X } from "lucide-react";

import {
  hideNewsArticleAction,
  publishDuplicateNewsAction,
  reprocessNewsArticleAction,
  saveDigestAction,
  saveNewsArticleAction,
  toggleNewsSourceAction,
} from "@/app/admin/operations";
import { AdminActionForm } from "@/components/admin/admin-action-form";
import { AdminArticleEditorDialog } from "@/components/admin/admin-article-editor-dialog";
import { AdminConfirmedAction } from "@/components/admin/admin-confirmed-action";
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
} from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { loadAdminNews, parseAdminTableQuery } from "@/data/admin-repository";
import { normalizeDailyDigestBody } from "@/lib/daily-digest-content";
import { isNewsRemovedFromFeed } from "@/lib/admin-policies";
import { newsReviewIssueLabel, newsArticleTypeLabel, NEWS_ARTICLE_TYPE_OPTIONS } from "@/lib/news-editorial";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminNewsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Серверный клиент админки недоступен");
  const query = parseAdminTableQuery(await searchParams);
  const data = await loadAdminNews(admin, query);

  return (
    <AdminPage>
      <AdminPageHeader
        description="Редактируй русскую версию, управляй публикацией и повторной обработкой. Публичный адрес после первой публикации не меняется."
        title="Новости и сводки"
      />
      <AdminUrlTabs sourceIds={data.sources.map(source => source.id)} defaultValue="materials" values={["materials", "sources", "digests"]}>
        <TabsList variant="line">
          <TabsTrigger value="materials">Материалы</TabsTrigger>
          <TabsTrigger value="sources">RSS-источники</TabsTrigger>
          <TabsTrigger value="digests">Дневные сводки</TabsTrigger>
        </TabsList>

        <TabsContent value="materials">
          <AdminSection
            description={`${data.total} материалов по текущему запросу.`}
            title="Материалы"
          >
            <AdminFilters query={query}
              search={query.search}
              status={query.status}
              statuses={[
                { value: "review", label: "Нужна проверка" },
                { value: "published", label: "Опубликованы" },
                { value: "draft", label: "Черновики" },
                { value: "removed", label: "Сняты с ленты" },
                { value: "duplicate", label: "Дубли" },
                { value: "rejected", label: "Отклонены" },
                { value: "processing", label: "Обрабатываются" },
              ]}
            />
            {data.items.length ? (
              <>
                <div className="hidden overflow-x-auto xl:block">
                  <Table className="min-w-[76rem] table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Материал</TableHead>
                        <TableHead className="w-36">Источник</TableHead>
                        <TableHead className="w-40">Состояние</TableHead>
                        <TableHead className="w-40">Обновлён</TableHead>
                        <TableHead className="w-80 text-right">Действия</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.map((article) => (
                        <TableRow key={article.id}>
                          <TableCell className="min-w-0">
                            <p className="line-clamp-2 break-words font-medium">{article.ai_title_ru ?? article.original_title}</p>
                            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">/{article.slug}</p>
                          </TableCell>
                          <TableCell><p className="line-clamp-2">{article.sourceName}</p></TableCell>
                          <TableCell>
                            {isNewsRemovedFromFeed(article.publication_status, article.published_at) ? (
                              <AdminStatusBadge status="removed_from_feed" />
                            ) : (
                              <AdminStatusBadge status={article.publication_status === "draft" && article.editorialReview?.decision === "MANUAL_REVIEW" ? "review" : article.publication_status} />
                            )}
                            {article.aiFailureLabel ? (
                              <p className="mt-1 text-xs leading-4 text-destructive">{article.aiFailureLabel}</p>
                            ) : null}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(article.updated_at)}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              <Button asChild size="sm" variant="ghost">
                                <Link href={article.publicAvailable ? `/news/${article.slug}` : article.canonical_url} target="_blank"><ExternalLink aria-hidden="true" data-icon="inline-start" />{article.publicAvailable ? "На сайте" : "Оригинал"}</Link>
                              </Button>
                              <AdminArticleEditorDialog title={article.ai_title_ru ?? article.original_title}>
                                <ArticleEditor article={article} />
                              </AdminArticleEditorDialog>
                              {article.publication_status === "published" ? (
                                <AdminConfirmedAction
                                  action={hideNewsArticleAction}
                                  confirmLabel="Убрать"
                                  description="Материал исчезнет из публичной ленты, но сохранится в админке. Его можно будет опубликовать снова."
                                  title="Убрать материал из ленты?"
                                  triggerIcon={<X aria-hidden="true" />}
                                  triggerIconOnly
                                  triggerLabel="Убрать из ленты"
                                  triggerVariant="ghost"
                                >
                                  <input name="articleId" type="hidden" value={article.id} />
                                </AdminConfirmedAction>
                              ) : null}
                              {article.publication_status === "duplicate" ? (
                                <AdminConfirmedAction
                                  action={publishDuplicateNewsAction}
                                  confirmLabel="Опубликовать"
                                  description="Материал перестанет считаться дублем и появится в публичной ленте как отдельная новость."
                                  title="Опубликовать дубль?"
                                  triggerLabel="Опубликовать"
                                >
                                  <input name="articleId" type="hidden" value={article.id} />
                                </AdminConfirmedAction>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="grid xl:hidden">
                  {data.items.map((article) => (
                    <article className="grid gap-3 border-b border-border p-4 last:border-b-0" key={article.id}>
                      <div className="flex items-start justify-between gap-3">
                        <h2 className="min-w-0 break-words text-sm font-medium leading-6">{article.ai_title_ru ?? article.original_title}</h2>
                        <div className="shrink-0">
                          {isNewsRemovedFromFeed(article.publication_status, article.published_at) ? (
                            <AdminStatusBadge status="removed_from_feed" />
                          ) : (
                            <AdminStatusBadge status={article.publication_status === "draft" && article.editorialReview?.decision === "MANUAL_REVIEW" ? "review" : article.publication_status} />
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">{article.sourceName}, {formatDate(article.updated_at)}</p>
                      {article.aiFailureLabel ? (
                        <p className="text-xs leading-5 text-destructive">{article.aiFailureLabel}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="ghost">
                          <Link href={article.publicAvailable ? `/news/${article.slug}` : article.canonical_url} target="_blank"><ExternalLink aria-hidden="true" data-icon="inline-start" />{article.publicAvailable ? "На сайте" : "Оригинал"}</Link>
                        </Button>
                        <AdminArticleEditorDialog title={article.ai_title_ru ?? article.original_title}>
                          <ArticleEditor article={article} />
                        </AdminArticleEditorDialog>
                        {article.publication_status === "published" ? (
                          <AdminConfirmedAction
                            action={hideNewsArticleAction}
                            confirmLabel="Убрать"
                            description="Материал исчезнет из публичной ленты, но сохранится в админке. Его можно будет опубликовать снова."
                            title="Убрать материал из ленты?"
                            triggerIcon={<X aria-hidden="true" />}
                            triggerIconOnly
                            triggerLabel="Убрать из ленты"
                            triggerVariant="ghost"
                          >
                            <input name="articleId" type="hidden" value={article.id} />
                          </AdminConfirmedAction>
                        ) : null}
                        {article.publication_status === "duplicate" ? (
                          <AdminConfirmedAction
                            action={publishDuplicateNewsAction}
                            confirmLabel="Опубликовать"
                            description="Материал перестанет считаться дублем и появится в публичной ленте как отдельная новость."
                            title="Опубликовать дубль?"
                            triggerLabel="Опубликовать"
                          >
                            <input name="articleId" type="hidden" value={article.id} />
                          </AdminConfirmedAction>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
                <AdminPagination query={query}
                  page={query.page}
                  pageSize={query.pageSize}
                  pathname="/admin/news"
                  search={query.search}
                  status={query.status}
                  total={data.total}
                />
              </>
            ) : (
              <AdminEmpty
                description="Измени фильтр или запусти проверку RSS-источников."
                title="Материалов по запросу нет"
              />
            )}
          </AdminSection>
        </TabsContent>

        <TabsContent value="sources">
          <AdminSection
            description="Пауза сохраняет историю и исключает источник из следующего RSS-запуска."
            id="sources"
            title="RSS-источники"
          >
            <div className="grid">
              {data.sources.map((source) => (
                <div className="grid gap-3 border-b border-border p-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center" id={`source-${source.id}`} key={source.id}>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{source.name}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{source.url}</p>
                    {source.last_error ? <p className="mt-2 text-xs text-danger">{source.last_error}</p> : null}
                  </div>
                  <AdminStatusBadge status={source.is_active ? "active" : "paused"} />
                  <AdminActionForm
                    action={toggleNewsSourceAction}
                    submitLabel={source.is_active ? "Поставить на паузу" : "Включить"}
                    submitVariant="secondary"
                  >
                    <input name="sourceId" type="hidden" value={source.id} />
                  </AdminActionForm>
                </div>
              ))}
            </div>
          </AdminSection>
        </TabsContent>

        <TabsContent value="digests">
          <AdminSection
            description="Сводку можно отредактировать, опубликовать или скрыть без удаления."
            title="Дневные сводки"
          >
            <AdminFilters query={query} search={query.search} status={query.status} statuses={[{ value: "draft", label: "Черновики" }, { value: "published", label: "Опубликованы" }, { value: "hidden", label: "Скрыты" }]} />
            {data.digests.length ? (
              <div className="grid gap-4 p-4">
                {data.digests.map((digest) => (
                  <AdminConfirmedForm
                    action={saveDigestAction}
                    className="rounded-md border border-border p-4"
                    confirmLabel="Сохранить"
                    description="Если выбрана публикация, сводка сразу станет доступна читателям."
                    key={digest.id}
                    submitLabel="Сохранить сводку"
                    submitVariant="secondary"
                    title="Сохранить сводку?"
                  >
                    <input name="digestId" type="hidden" value={digest.id} />
                    <AdminDigestMeta dateKey={digest.date_key} status={digest.status} />
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor={`digest-title-${digest.id}`}>Заголовок</FieldLabel>
                        <Input defaultValue={digest.title} id={`digest-title-${digest.id}`} name="title" />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`digest-body-${digest.id}`}>Текст сводки</FieldLabel>
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
            ) : (
              <AdminEmpty description="Запусти сбор дневной сводки в разделе AI или задач." title="Сводок пока нет" />
            )}
            <AdminPagination query={query} page={query.page} pageSize={query.pageSize} pathname="/admin/news" total={data.digestsTotal} />
          </AdminSection>
        </TabsContent>
      </AdminUrlTabs>
    </AdminPage>
  );
}

function ArticleEditor({
  article,
}: {
  article: Awaited<ReturnType<typeof loadAdminNews>>["items"][number];
}) {
  return (
    <div className="grid gap-4 text-left">
      {typeof article.editorialMeta?.request_count === "number" ? (
        <p className="text-sm text-muted-foreground">
          Обработка: {article.editorialMeta.request_count} запроса, {(article.editorialMeta.token_usage ?? 0).toLocaleString("ru-RU")} токенов.
        </p>
      ) : null}
      {article.editorialReview?.issues.length ? <section aria-label="Результат проверки" className="grid gap-2 text-sm leading-6">
        <h3 className="font-semibold">Что нужно проверить</h3>
        <ul className="list-disc pl-5">{article.editorialReview.issues.map((issue, index) => <li key={index}>{newsReviewIssueLabel(issue)}</li>)}</ul>
        <Link className="text-primary underline-offset-4 hover:underline" href={article.canonical_url} target="_blank" rel="noreferrer">Сверить с оригиналом</Link>
      </section> : null}
      <AdminConfirmedForm
        action={saveNewsArticleAction}
        confirmLabel="Сохранить"
        description={article.editorialReview?.decision === "MANUAL_REVIEW"
          ? "Материал остановлен автоматической проверкой. Публикуй его только после сверки фактов, авторства и оговорок с оригиналом."
          : "Если выбрана публикация, материал сразу появится в публичной ленте."}
        submitLabel="Сохранить материал"
        submitVariant="secondary"
        title="Сохранить материал?"
      >
        <input name="articleId" type="hidden" value={article.id} />
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`type-${article.id}`}>Тип материала</FieldLabel>
            <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue={article.editorialMeta?.article_type ?? "news"} id={`type-${article.id}`} name="articleType">
              {NEWS_ARTICLE_TYPE_OPTIONS.map(type => <option key={type} value={type}>{newsArticleTypeLabel(type)}</option>)}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`authors-${article.id}`}>Автор оригинала</FieldLabel>
            <Input defaultValue={article.editorialMeta?.source_authors?.join(", ") ?? ""} id={`authors-${article.id}`} name="sourceAuthors" placeholder="Имя автора из источника" />
            <FieldDescription>Если подписи нет, оставь пустым. Несколько авторов — через запятую.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`title-${article.id}`}>Русский заголовок</FieldLabel>
            <Input defaultValue={article.ai_title_ru ?? ""} id={`title-${article.id}`} name="title" />
            <FieldDescription>Публичный адрес /{article.slug} останется прежним.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`summary-${article.id}`}>Короткий лид</FieldLabel>
            <Textarea defaultValue={article.ai_summary_ru ?? ""} id={`summary-${article.id}`} name="summary" rows={3} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`body-${article.id}`}>Текст материала</FieldLabel>
            <Textarea defaultValue={article.ai_summary_long_ru ?? ""} id={`body-${article.id}`} name="body" rows={10} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`tags-${article.id}`}>Редакторские теги</FieldLabel>
            <Input defaultValue={article.tagNames.join(", ")} id={`tags-${article.id}`} name="tags" placeholder="Стратегия, трансферы, регламент" />
            <FieldDescription>До восьми тегов через запятую. Спортивные связи сохраняются отдельно.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`publication-${article.id}`}>Публикация</FieldLabel>
            <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue={normalizePublicationStatus(article.publication_status)} id={`publication-${article.id}`} name="publicationStatus">
              <option value="draft">Черновик</option>
              <option value="published">Опубликован</option>
              <option value="rejected">Отклонён</option>
            </select>
          </Field>
        </FieldGroup>
      </AdminConfirmedForm>
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <AdminActionForm action={reprocessNewsArticleAction} submitLabel="Пересобрать текст" submitVariant="secondary">
          <input name="articleId" type="hidden" value={article.id} />
          <input name="mode" type="hidden" value="ai" />
        </AdminActionForm>
        <AdminActionForm action={reprocessNewsArticleAction} submitLabel="Проверить дубли" submitVariant="secondary">
          <input name="articleId" type="hidden" value={article.id} />
          <input name="mode" type="hidden" value="dedup" />
        </AdminActionForm>
      </div>
    </div>
  );
}

function normalizePublicationStatus(value: string) {
  return ["published", "rejected"].includes(value) ? value : "draft";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(value));
}
