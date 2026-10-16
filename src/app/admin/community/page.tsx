import { LockKeyhole } from "lucide-react";

import { runAdminJobAction, savePollAction } from "@/app/admin/operations";
import { AdminActionForm } from "@/components/admin/admin-action-form";
import { AdminConfirmedForm } from "@/components/admin/admin-confirmed-form";
import { AdminFilters } from "@/components/admin/admin-filters";
import { AdminUrlTabs } from "@/components/admin/admin-url-tabs";
import {
  AdminMetric,
  AdminPagination,
  AdminPage,
  AdminPageHeader,
  AdminSection,
  AdminStatusBadge,
} from "@/components/admin/admin-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { loadAdminCommunity, parseAdminTableQuery } from "@/data/admin-repository";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminCommunityPage({ searchParams }: PageProps) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Серверный клиент админки недоступен");
  const query = parseAdminTableQuery(await searchParams);
  const data = await loadAdminCommunity(admin, query);

  return (
    <AdminPage>
      <AdminPageHeader
        actions={<AdminConfirmedForm action={runAdminJobAction} confirmLabel="Создать и опубликовать" description="Задача создаст и сразу опубликует опросы ближайшей гонки, а завершённые закроет. Новые опросы увидят читатели." submitLabel="Опубликовать опросы гонки" submitVariant="secondary" title="Опубликовать опросы ближайшей гонки?"><input name="jobName" type="hidden" value="polls.generate_next_race" /></AdminConfirmedForm>}
        description="Опросы можно создавать и закрывать. Лиги, прогнозы и начисления доступны для диагностики без ручной правки."
        title="Сообщество"
      />
      <section className="grid grid-cols-2 gap-y-5 border-b border-border pb-5 lg:grid-cols-4">
        <AdminMetric label="Опросы" value={String(data.pollsCount)} />
        <AdminMetric label="Лиги" value={String(data.leaguesCount)} />
        <AdminMetric label="Прогнозы" value={String(data.predictionsCount)} />
        <AdminMetric label="Не посчитаны — все прогнозы" value={String(data.pendingPredictionsCount)} />
      </section>
      <Alert>
        <LockKeyhole aria-hidden="true" />
        <AlertTitle>Результаты прогнозов защищены</AlertTitle>
        <AlertDescription>
          Пользовательские выборы и начисленные очки не меняются вручную. Повторный подсчёт использует подтверждённые результаты гонки.
        </AlertDescription>
      </Alert>
      <AdminUrlTabs defaultValue="polls" values={["polls", "leagues", "predictions"]}>
        <TabsList variant="line">
          <TabsTrigger value="polls">Опросы</TabsTrigger>
          <TabsTrigger value="leagues">Лиги</TabsTrigger>
          <TabsTrigger value="predictions">Прогнозы</TabsTrigger>
        </TabsList>
        <TabsContent value="polls">
          <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
            <AdminSection description="Варианты блокируются после первого голоса." title="Новый опрос">
              <AdminConfirmedForm action={savePollAction} className="p-4" confirmLabel="Создать" description="Если выбрана публикация, опрос сразу станет доступен читателям." submitLabel="Создать опрос" title="Создать опрос?">
                <FieldGroup>
                  <PollFields />
                </FieldGroup>
              </AdminConfirmedForm>
            </AdminSection>
            <AdminSection description="Публикуй, закрывай и обновляй вопрос без удаления истории." title="Все опросы">
              <AdminFilters query={query} search={query.search} />
              <div className="grid gap-4 p-4">
                {data.polls.map((poll) => (
                  <AdminConfirmedForm action={savePollAction} className="rounded-md border border-border p-4" confirmLabel="Сохранить" description="Изменение публикации или закрытие опроса сразу отразится на сайте." key={poll.id} submitLabel="Сохранить опрос" submitVariant="secondary" title="Сохранить изменения опроса?">
                    <input name="pollId" type="hidden" value={poll.id} />
                    <div className="flex flex-wrap items-center gap-2">
                      <AdminStatusBadge status={poll.status} />
                      <span className="font-mono text-xs text-muted-foreground">{poll.votesCount} голосов</span>
                      {poll.votesCount ? <span className="text-xs text-warning">Варианты заблокированы</span> : null}
                    </div>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor={`poll-question-${poll.id}`}>Вопрос</FieldLabel>
                        <Input defaultValue={poll.question} id={`poll-question-${poll.id}`} name="question" required />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`poll-options-${poll.id}`}>Варианты ответа</FieldLabel>
                        <Textarea
                          defaultValue={poll.options.map((option) => option.label).join("\n")}
                          id={`poll-options-${poll.id}`}
                          name="options"
                          readOnly={poll.votesCount > 0}
                          rows={Math.max(3, poll.options.length)}
                        />
                        <FieldDescription>
                          {poll.votesCount ? "После первого голоса список остаётся неизменным." : "Один вариант на строку."}
                        </FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`poll-status-${poll.id}`}>Состояние</FieldLabel>
                        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue={poll.status} id={`poll-status-${poll.id}`} name="status">
                          <option value="draft">Черновик</option>
                          <option value="published">Опубликован</option>
                          <option value="closed">Закрыт</option>
                        </select>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`poll-close-${poll.id}`}>Закрыть после</FieldLabel>
                        <Input defaultValue={toLocalDateTime(poll.closes_at)} id={`poll-close-${poll.id}`} name="closesAt" type="datetime-local" />
                      </Field>
                    </FieldGroup>
                  </AdminConfirmedForm>
                ))}
              </div>
              <AdminPagination query={query} page={query.page} pageSize={query.pageSize} pathname="/admin/community" total={data.pollsTotal} />
            </AdminSection>
          </div>
        </TabsContent>
        <TabsContent value="leagues">
          <AdminSection description="Поиск и диагностика без изменения участников и результатов." title="Все лиги">
            <AdminFilters query={query} search={query.search} />
            <div className="grid">
              {data.leagues.map((league) => (
                <div className="grid gap-2 border-b border-border p-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto]" key={league.id}>
                  <div>
                    <p className="font-medium">{league.name}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">Код {league.invite_code}</p>
                  </div>
                  <AdminStatusBadge status={league.is_public ? "published" : "private"} />
                </div>
              ))}
            </div>
            <AdminPagination query={query} page={query.page} pageSize={query.pageSize} pathname="/admin/community" total={data.leaguesTotal} />
          </AdminSection>
        </TabsContent>
        <TabsContent value="predictions">
          <AdminSection
            actions={<AdminActionForm action={runAdminJobAction} submitLabel="Пересчитать по результатам" submitVariant="secondary"><input name="jobName" type="hidden" value="predictions.score" /></AdminActionForm>}
            description="Все прогнозы доступны по страницам. Число не посчитанных учитывает все записи, включая ещё открытые гонки."
            title="Состояние прогнозов"
          >

            <div className="grid">
              {data.predictions.map((prediction) => (
                <div className="grid gap-2 border-b border-border p-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto_auto]" key={prediction.id}>
                  <p className="font-mono text-sm">{prediction.id}</p>
                  <AdminStatusBadge status={prediction.scored_at ? "success" : prediction.locked_at ? "pending" : "draft"} />
                  <span className="font-mono text-sm tabular-nums text-muted-foreground">{prediction.score ?? "не посчитан"}</span>
                </div>
              ))}
            </div>
            <AdminPagination query={query} page={query.page} pageSize={query.pageSize} pathname="/admin/community" total={data.predictionsTotal} />
          </AdminSection>
        </TabsContent>
      </AdminUrlTabs>
    </AdminPage>
  );
}

function PollFields() {
  return (
    <>
      <Field>
        <FieldLabel htmlFor="new-poll-question">Вопрос</FieldLabel>
        <Input id="new-poll-question" name="question" placeholder="Кто сильнее проведёт гонку?" required />
      </Field>
      <Field>
        <FieldLabel htmlFor="new-poll-options">Варианты ответа</FieldLabel>
        <Textarea id="new-poll-options" name="options" placeholder={"Первый вариант\nВторой вариант"} required rows={5} />
        <FieldDescription>От двух до восьми вариантов, один на строку.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="new-poll-status">Публикация</FieldLabel>
        <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" defaultValue="draft" id="new-poll-status" name="status">
          <option value="draft">Сохранить черновик</option>
          <option value="published">Опубликовать сразу</option>
          <option value="closed">Создать закрытым</option>
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="new-poll-close">Закрыть после</FieldLabel>
        <Input id="new-poll-close" name="closesAt" type="datetime-local" />
      </Field>
    </>
  );
}

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
