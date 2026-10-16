import Link from "next/link";
import { ExternalLink, LockKeyhole } from "lucide-react";

import {
  clearDriverAvatarAction,
  runAdminJobAction,
  uploadDriverAvatarAction,
} from "@/app/admin/operations";
import { AdminActionForm } from "@/components/admin/admin-action-form";
import { AdminConfirmedAction } from "@/components/admin/admin-confirmed-action";
import { AdminUrlTabs } from "@/components/admin/admin-url-tabs";
import {
  AdminEmpty,
  AdminMetric,
  AdminPage,
  AdminPageHeader,
  AdminSection,
  AdminStatusBadge,
  AdminTechnicalValue,
} from "@/components/admin/admin-ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminFilters } from "@/components/admin/admin-filters";
import { AdminPagination } from "@/components/admin/admin-ui";
import { loadAdminSport, parseAdminTableQuery } from "@/data/admin-repository";
import { getAdminJobCopy } from "@/lib/admin-display";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export default async function AdminSportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Серверный клиент админки недоступен");
  const query = parseAdminTableQuery(await searchParams);
  const data = await loadAdminSport(admin, query);

  return (
    <AdminPage>
      <AdminPageHeader
        description="Спортивные данные всегда сверяются с первичными источниками. Результаты и таблицы исправляются только повторной синхронизацией."
        title="Спортивные данные"
      />
      <Alert>
        <LockKeyhole aria-hidden="true" />
        <AlertTitle>Ручное редактирование классификаций отключено</AlertTitle>
        <AlertDescription>
          Календарь, результаты и чемпионат должны совпадать с источником. Для восстановления используй задачи ниже.
        </AlertDescription>
      </Alert>
      <AdminFilters hideSearch query={query} filters={[{ name: "season", allowAll: false, label: "Сезон для диагностики", value: String(data.selectedSeason), options: data.seasons.map(item => ({ value: String(item.year), label: String(item.year) })) }]} />
      <section className="grid grid-cols-2 gap-y-5 border-b border-border pb-5 lg:grid-cols-4">
        <AdminMetric helper={`Сезон ${data.selectedSeason}`} label="Сессии" value={String(data.counts.sessions)} />
        <AdminMetric helper={`Сезон ${data.selectedSeason}`} label="Результаты" value={String(data.counts.results)} />
        <AdminMetric helper={`Сезон ${data.selectedSeason}`} label="Личный зачёт" value={String(data.counts.driverStandings)} />
        <AdminMetric helper={`Сезон ${data.selectedSeason}`} label="Командный зачёт" value={String(data.counts.constructorStandings)} />
      </section>

      <p className="text-xs text-muted-foreground">Все сезоны в базе: {data.globalCounts.sessions} сессий, {data.globalCounts.results} результатов. Готовность архива проверяется по всем его сезонам.</p>
      <AdminUrlTabs defaultValue="health" values={["health", "archive", "assets", "drivers", "replay"]}>
        <TabsList variant="line">
          <TabsTrigger value="health">Состояние</TabsTrigger>
          <TabsTrigger value="archive">Архив</TabsTrigger>
          <TabsTrigger value="assets">Материалы</TabsTrigger>
          <TabsTrigger value="drivers">Гонщики</TabsTrigger>
          <TabsTrigger value="replay">Race Replay</TabsTrigger>
        </TabsList>

        <TabsContent value="health">
          <div className="grid gap-5 xl:grid-cols-2">
            <AdminSection description="Безопасные синхронизации текущего сезона." title="Синхронизация">
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                {[
                  ["jolpica.sync_calendar", "Обновить календарь"],
                  ["jolpica.sync_results", "Обновить результаты"],
                  ["jolpica.sync_standings", "Обновить чемпионат"],
                  ["openf1.check_current_sessions", "Проверить сессии этапа"],
                  ["weather.sync_weekend", "Обновить погоду"],
                  ["circuit_stats.sync_all", "Пересчитать трассы"],
                ].map(([jobName, label]) => {
                  const jobCopy = getAdminJobCopy(jobName);

                  return (
                    <AdminActionForm action={runAdminJobAction} className="rounded-md border border-border p-4" key={jobName} submitLabel={label} submitVariant="secondary">
                      <input name="jobName" type="hidden" value={jobName} />
                      <div>
                        <h3 className="text-sm font-medium">{jobCopy.title}</h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{jobCopy.description}</p>
                      </div>
                    </AdminActionForm>
                  );
                })}
              </div>
            </AdminSection>
            <AdminSection description="Повторная загрузка восстанавливает пропущенные классификации без ручного изменения результатов." title="Восстановление">
              <div className="grid gap-4 p-4">
                {[
                  ["jolpica.repair_race_results", "Восстановить гонки"],
                  ["jolpica.repair_qualifying_results", "Восстановить квалификации"],
                ].map(([jobName, label]) => {
                  const jobCopy = getAdminJobCopy(jobName);

                  return (
                    <AdminActionForm action={runAdminJobAction} className="rounded-md border border-border p-4" key={jobName} submitLabel={label} submitVariant="secondary">
                      <input name="jobName" type="hidden" value={jobName} />
                      <div>
                        <h3 className="text-sm font-medium">{jobCopy.title}</h3>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{jobCopy.description}</p>
                      </div>
                      <Field>
                        <FieldLabel htmlFor={`season-${jobName}`}>Сезон</FieldLabel>
                        <Input defaultValue={data.currentSeason} id={`season-${jobName}`} max="2100" min="2020" name="season" type="number" />
                      </Field>
                    </AdminActionForm>
                  );
                })}
              </div>
            </AdminSection>
          </div>
        </TabsContent>

        <TabsContent value="archive">
          <AdminSection
            actions={data.archiveReady && !data.archivePublished ? (
              <AdminConfirmedAction
                action={runAdminJobAction}
                confirmLabel="Опубликовать архив"
                description="Фоновая проверка сверит каждый сезон, результаты, профили и официальные материалы. Публикация не начнётся при любой ошибке."
                title="Опубликовать архив 2020-2025?"
                triggerLabel="Опубликовать архив"
              >
                <input name="jobName" type="hidden" value="jolpica.publish_history" />
              </AdminConfirmedAction>
            ) : null}
            description="Исторические сезоны открываются одной публикацией только после полного зелёного gate."
            title="Архив 2020-2025"
          >
            <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <AdminStatusBadge status={data.archivePublished ? "published" : data.archiveReady ? "ready" : "pending"} />
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {data.archivePublished
                    ? "Полный архив опубликован."
                    : data.archiveReady
                      ? "Локальная проверка материалов пройдена. Перед публикацией система выполнит финальную проверку."
                      : "Не все сезонные профили и материалы прошли проверку."}
                </p>
              </div>
              <AdminActionForm action={runAdminJobAction} submitLabel="Подготовить архив" submitVariant="secondary">
                <input name="jobName" type="hidden" value="jolpica.prepare_history" />
              </AdminActionForm>
            </div>
            <div className="grid border-t border-border sm:grid-cols-2 lg:grid-cols-3">
              {data.seasons.filter((season) => season.year >= 2020 && season.year <= 2025).map((season) => (
                <div className="flex items-center justify-between gap-3 border-b border-border p-4 sm:border-r" key={season.year}>
                  <span className="font-mono text-lg">{season.year}</span>
                  <div className="flex items-center gap-2">
                    <AdminStatusBadge status={season.is_published ? "published" : "draft"} />
                    <AdminActionForm action={runAdminJobAction} submitLabel="Проверить" submitVariant="ghost">
                      <input name="jobName" type="hidden" value="jolpica.validate_season" />
                      <input name="season" type="hidden" value={season.year} />
                    </AdminActionForm>
                  </div>
                </div>
              ))}
            </div>
          </AdminSection>
        </TabsContent>

        <TabsContent value="assets">
          <div className="grid gap-5">
            <AdminSection description="Логотипы и болиды read-only. Источник, checksum и проверки берутся из manifest-файлов." title="Команды и болиды">
              <div className="grid gap-0">
                {data.teamAssets.slice(0, 80).map((asset) => (
                  <details className="border-b border-border p-4 last:border-b-0" key={asset.id}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                      <span>{asset.season_year} · {asset.display_name}</span>
                      <AdminStatusBadge status={asset.assets_verified_at && asset.logo_image_url && asset.car_image_url ? "ready" : "pending"} />
                    </summary>
                    <div className="mt-3"><AdminTechnicalValue value={asset.source_urls} /></div>
                  </details>
                ))}
              </div>
            </AdminSection>
            <AdminSection description="Карты трасс read-only и обновляются через репозиторий." title="Карты трасс">
              <div className="grid gap-0">
                {data.trackAssets.map((asset) => (
                  <details className="border-b border-border p-4 last:border-b-0" key={asset.id}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                      <span className="font-mono text-sm">{asset.layout_slug}</span>
                      <AdminStatusBadge status={asset.is_verified && asset.checksum_sha256 ? "ready" : "pending"} />
                    </summary>
                    <div className="mt-3 grid gap-3">
                      <p className="break-all font-mono text-xs text-muted-foreground">SHA-256: {asset.checksum_sha256 ?? "не рассчитан"}</p>
                      {asset.source_url ? <Button asChild size="sm" variant="ghost"><Link href={asset.source_url} target="_blank">Открыть источник<ExternalLink aria-hidden="true" data-icon="inline-end" /></Link></Button> : null}
                      <AdminTechnicalValue value={asset.source_manifest} />
                    </div>
                  </details>
                ))}
              </div>
            </AdminSection>
          </div>
        </TabsContent>

        <TabsContent value="drivers">
          <AdminSection description="Загрузка текущих AI-аватаров сохранена. Исторические портреты остаются read-only." title="Текущие гонщики">
            <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
              {data.currentDrivers.map((driver) => (
                <article className="grid content-start gap-3 rounded-md border border-border p-4" key={driver.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-medium">{driver.full_name}</h2>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">/{driver.slug ?? "slug-ne-zadan"}</p>
                    </div>
                    <AdminStatusBadge status={driver.ai_avatar_url ? "ready" : "pending"} />
                  </div>
                  <AdminActionForm action={uploadDriverAvatarAction} submitLabel="Загрузить аватар">
                    <input name="driverId" type="hidden" value={driver.id} />
                    <input name="slug" type="hidden" value={driver.slug ?? ""} />
                    <Field>
                      <FieldLabel htmlFor={`avatar-${driver.id}`}>PNG, JPEG или WebP</FieldLabel>
                      <Input accept="image/webp,image/png,image/jpeg" id={`avatar-${driver.id}`} name="avatar" type="file" />
                      <FieldDescription>До 2 МБ.</FieldDescription>
                    </Field>
                  </AdminActionForm>
                  {driver.ai_avatar_url ? (
                    <AdminConfirmedAction action={clearDriverAvatarAction} confirmLabel="Убрать" description="Аватар исчезнет из публичного профиля гонщика." title="Убрать аватар?" triggerLabel="Убрать из профиля" triggerVariant="secondary">
                      <input name="driverId" type="hidden" value={driver.id} />
                      <input name="slug" type="hidden" value={driver.slug ?? ""} />
                    </AdminConfirmedAction>
                  ) : null}
                </article>
              ))}
            </div>
          </AdminSection>
        </TabsContent>

        <TabsContent value="replay">
          <AdminSection
            actions={<AdminActionForm action={runAdminJobAction} submitLabel="Подготовить последний повтор" submitVariant="secondary"><input name="jobName" type="hidden" value="race_replay.prepare_current" /></AdminActionForm>}
            description="Состояние подготовленных повторов. Исходные спортивные данные здесь не редактируются."
            title="Race Replay"
          >
            {data.replays.length ? (
              <div className="grid">
                {data.replays.map((replay) => (
                  <div className="grid gap-2 border-b border-border p-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto]" key={replay.id}>
                    <div>
                      <p className="font-medium">{replay.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{replay.source_season}, session key {replay.source_session_key}</p>
                    </div>
                    <AdminStatusBadge status={replay.status} />
                  </div>
                ))}
              </div>
            ) : <AdminEmpty description="Подготовь повтор после появления полной телеметрии гонки." title="Race Replay пока нет" />}
            <AdminPagination query={query} page={query.page} pageSize={query.pageSize} pathname="/admin/sport" total={data.replaysTotal} />
          </AdminSection>
        </TabsContent>
      </AdminUrlTabs>
    </AdminPage>
  );
}
