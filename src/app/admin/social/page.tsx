import Link from "next/link";
import { ExternalLink } from "lucide-react";

import {
  addManualXPostAction,
  hideSocialPostAction,
  moderateSocialPostAction,
  runAdminJobAction,
  saveSocialSourceAction,
  toggleSocialSourceAction,
} from "@/app/admin/operations";
import { AdminActionForm } from "@/components/admin/admin-action-form";
import { AdminConfirmedAction } from "@/components/admin/admin-confirmed-action";
import { AdminConfirmedForm } from "@/components/admin/admin-confirmed-form";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { loadAdminSocial, parseAdminTableQuery } from "@/data/admin-repository";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminSocialPage({ searchParams }: PageProps) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Серверный клиент админки недоступен");
  const query = parseAdminTableQuery(await searchParams);
  const data = await loadAdminSocial(admin, query);

  return (
    <AdminPage>
      <AdminPageHeader
        description="Источники X, Reddit и Telegram, ручные публикации и очередь модерации. Исходный текст показан без служебных данных."
        title="Социальные источники"
      />
      <AdminUrlTabs sourceIds={data.sources.map(source => source.id)} defaultValue="moderation" values={["moderation", "sources", "manual"]}>
        <TabsList variant="line">
          <TabsTrigger value="moderation">Модерация</TabsTrigger>
          <TabsTrigger value="sources">Источники</TabsTrigger>
          <TabsTrigger value="manual">Ручная публикация</TabsTrigger>
        </TabsList>

        <TabsContent value="moderation">
          <AdminSection description={`${data.total} публикаций по текущему запросу.`} title="Очередь модерации">
            <AdminFilters query={query}
              search={query.search}
              status={query.status}
              statuses={[
                { value: "review", label: "На проверке" },
                { value: "pending", label: "Ожидают обработки" },
                { value: "published", label: "Опубликованы" },
                { value: "rejected", label: "Отклонены" },
              ]}
            />
            {data.items.length ? (
              <div className="grid">
                {data.items.map((post) => (
                  <article className="grid gap-4 border-b border-border p-4 last:border-b-0 xl:grid-cols-[minmax(0,1fr)_20rem]" key={post.id}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <AdminStatusBadge status={post.status} />
                        <span className="font-mono text-xs text-muted-foreground">{post.platform}</span>
                        <span className="text-xs text-muted-foreground">{formatDate(post.created_at)}</span>
                      </div>
                      <h2 className="mt-3 font-medium leading-6">{post.ai_title_ru ?? post.title ?? "Публикация без заголовка"}</h2>
                      {post.ai_summary_ru ? <p className="mt-2 text-sm leading-6">{post.ai_summary_ru}</p> : null}
                      <details className="mt-3 rounded-md border border-border bg-muted/30">
                        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Исходный текст и медиа</summary>
                        <div className="grid gap-3 border-t border-border p-3">
                          <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{post.body ?? post.title ?? "Источник не передал текст."}</p>
                          {post.media.length ? (
                            <div className="flex flex-wrap gap-2">
                              {post.media.map((media) => (
                                <Button asChild key={media.id} size="sm" variant="outline">
                                  <Link href={media.url} rel="noreferrer" target="_blank">{media.media_type}<ExternalLink aria-hidden="true" data-icon="inline-end" /></Link>
                                </Button>
                              ))}
                            </div>
                          ) : null}
                          <Button asChild size="sm" variant="ghost">
                            <Link href={post.original_url} rel="noreferrer" target="_blank">Открыть источник<ExternalLink aria-hidden="true" data-icon="inline-end" /></Link>
                          </Button>
                        </div>
                      </details>
                      {post.last_processing_error ? <p className="mt-3 text-sm text-danger">{post.last_processing_error}</p> : null}
                    </div>
                    <div className="grid content-start gap-3">
                      <AdminConfirmedForm
                        action={moderateSocialPostAction}
                        confirmLabel="Опубликовать"
                        description="Публикация сразу появится в публичной ленте. Проверь тему и текст перед подтверждением."
                        submitLabel="Опубликовать"
                        title="Опубликовать материал?"
                      >
                        <input name="postId" type="hidden" value={post.id} />
                        <input name="moderationAction" type="hidden" value="publish" />
                        <Field>
                          <FieldLabel htmlFor={`topic-${post.id}`}>Тема</FieldLabel>
                          <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue="" id={`topic-${post.id}`} name="topic">
                            <option value="">Оставить текущую</option>
                            <option value="social-race-weekend">Этап и результаты</option>
                            <option value="social-technical">Техника и регламент</option>
                            <option value="social-transfers">Трансферы и контракты</option>
                            <option value="social-statements">Комментарии</option>
                            <option value="social-incidents">Инциденты и штрафы</option>
                            <option value="social-rumors">Слухи</option>
                            <option value="social-discussion">Обсуждения</option>
                          </select>
                        </Field>
                      </AdminConfirmedForm>
                      <AdminConfirmedAction action={moderateSocialPostAction} confirmLabel="Отклонить" description="Публикация не появится в публичной ленте." title="Отклонить публикацию?" triggerLabel="Отклонить" triggerVariant="secondary">
                        <input name="postId" type="hidden" value={post.id} />
                        <input name="moderationAction" type="hidden" value="reject" />
                      </AdminConfirmedAction>
                      <AdminConfirmedAction action={moderateSocialPostAction} confirmLabel="Переработать" description="Текущая обработка будет сброшена, а публикация снова попадёт в очередь." title="Запустить обработку заново?" triggerLabel="Переработать публикацию" triggerVariant="secondary">
                        <input name="postId" type="hidden" value={post.id} />
                        <input name="moderationAction" type="hidden" value="retry" />
                      </AdminConfirmedAction>
                      {post.status === "published" ? (
                        <AdminConfirmedAction
                          action={hideSocialPostAction}
                          confirmLabel="Убрать"
                          description="Публикация исчезнет из публичной ленты, но останется в админке. Её можно будет опубликовать снова."
                          title="Убрать публикацию из ленты?"
                          triggerLabel="Убрать из ленты"
                          triggerVariant="secondary"
                        >
                          <input name="postId" type="hidden" value={post.id} />
                        </AdminConfirmedAction>
                      ) : null}
                    </div>
                  </article>
                ))}
                <AdminPagination query={query} page={query.page} pageSize={query.pageSize} pathname="/admin/social" search={query.search} status={query.status} total={data.total} />
              </div>
            ) : (
              <AdminEmpty description="Измени фильтр или проверь активные источники." title="Публикаций по запросу нет" />
            )}
          </AdminSection>
        </TabsContent>

        <TabsContent value="sources">
          <div className="grid gap-5 xl:grid-cols-[minmax(22rem,0.7fr)_minmax(0,1.3fr)]">
            <AdminSection description="Одинаковая ссылка обновляет существующий источник." id="sources" title="Добавить источник">
              <AdminActionForm action={saveSocialSourceAction} className="p-4" submitLabel="Сохранить источник">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="source-platform">Площадка</FieldLabel>
                    <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue="x" id="source-platform" name="platform">
                      <option value="x">X</option>
                      <option value="reddit">Reddit</option>
                      <option value="telegram">Telegram</option>
                    </select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="source-name">Название</FieldLabel>
                    <Input id="source-name" name="name" placeholder="Команда или издание" required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="source-url">Ссылка</FieldLabel>
                    <Input id="source-url" name="url" placeholder="https://x.com/team" />
                    <FieldDescription>Для Telegram можно оставить пустой, если ниже указан канал.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="source-key">Аккаунт или канал</FieldLabel>
                    <Input id="source-key" name="externalKey" placeholder="team или formula1" required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="source-mode">Публикация</FieldLabel>
                    <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue="review" id="source-mode" name="publicationMode">
                      <option value="review">Сначала проверить</option>
                      <option value="auto">Публиковать автоматически</option>
                    </select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="source-interval">Интервал, минут</FieldLabel>
                    <Input defaultValue="15" id="source-interval" max="1440" min="5" name="fetchIntervalMinutes" type="number" />
                  </Field>
                  <Field orientation="horizontal">
                    <Checkbox id="include-reposts" name="includeReposts" />
                    <FieldLabel htmlFor="include-reposts">Учитывать репосты</FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <Checkbox id="include-replies" name="includeReplies" />
                    <FieldLabel htmlFor="include-replies">Учитывать ответы</FieldLabel>
                  </Field>
                </FieldGroup>
              </AdminActionForm>
            </AdminSection>
            <AdminSection description="Проверка запускается только для выбранного источника." title="Подключённые источники">
              <div className="grid">
                {data.sources.map((source) => (
                  <div className="grid gap-3 border-b border-border p-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-start" id={`source-${source.id}`} key={source.id}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{source.name}</p>
                        <AdminStatusBadge status={source.is_active ? "active" : "paused"} />
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{source.platform}, {source.adapter}, каждые {source.fetch_interval_minutes} мин</p>
                      {source.last_error ? <p className="mt-2 text-xs text-danger">{source.last_error}</p> : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <AdminActionForm action={runAdminJobAction} submitLabel="Проверить" submitVariant="secondary">
                        <input name="jobName" type="hidden" value={`social.fetch_${source.platform}`} />
                        <input name="sourceId" type="hidden" value={source.id} />
                      </AdminActionForm>
                      <AdminActionForm action={toggleSocialSourceAction} submitLabel={source.is_active ? "Пауза" : "Включить"} submitVariant="secondary">
                        <input name="sourceId" type="hidden" value={source.id} />
                      </AdminActionForm>
                    </div>
                  </div>
                ))}
              </div>
            </AdminSection>
          </div>
        </TabsContent>

        <TabsContent value="manual">
          <AdminSection description="Публикация попадёт в очередь модерации и не выйдет автоматически." title="Добавить пост из X">
            <AdminActionForm action={addManualXPostAction} className="max-w-2xl p-4" submitLabel="Добавить на проверку">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="manual-x-url">Ссылка на пост</FieldLabel>
                  <Input id="manual-x-url" name="url" placeholder="https://x.com/account/status/…" required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="manual-x-author">Автор</FieldLabel>
                  <Input id="manual-x-author" name="author" placeholder="@account" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="manual-x-title">Короткое описание</FieldLabel>
                  <Textarea id="manual-x-title" name="title" placeholder="Что произошло и почему это важно" rows={4} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="manual-x-image">Ссылка на изображение</FieldLabel>
                  <Input id="manual-x-image" name="imageUrl" placeholder="https://…" />
                </Field>
              </FieldGroup>
            </AdminActionForm>
          </AdminSection>
        </TabsContent>
      </AdminUrlTabs>
    </AdminPage>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(value));
}
