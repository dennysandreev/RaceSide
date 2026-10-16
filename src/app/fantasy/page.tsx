import {
  CheckCircle2,
  ClipboardList,
  Crown,
  Globe2,
  KeyRound,
  Lock,
  Plus,
  Search,
  Users,
} from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";

import {
  createFantasyLeague,
  joinFantasyLeague,
  saveFantasyPrediction,
} from "@/app/fantasy/actions";
import { FantasyLockCountdown } from "@/components/fantasy/fantasy-lock-countdown";
import { FantasyDashboard } from "@/components/fantasy/fantasy-dashboard";
import { FantasySectionHeader } from "@/components/fantasy/fantasy-section-nav";
import { FantasyLeagueAvatar } from "@/components/fantasy/fantasy-league-avatar";
import {
  FantasyDriverPredictionSelect,
  FantasyTeamPredictionSelect,
  type FantasyTeamSelectOption,
} from "@/components/fantasy/fantasy-prediction-select";
import { FantasyTrackVisualImage } from "@/components/fantasy/fantasy-track-visual";
import { PredictionShareModalLauncher } from "@/components/fantasy/PredictionShareModal";
import { AppShell } from "@/components/racemate/app-shell";
import { PageTitle } from "@/components/racemate/page-title";
import { FantasyScoringDialog } from "@/components/racemate/fantasy-scoring-dialog";
import {
  StartingGridButton,
} from "@/components/racemate/fantasy-prediction-tools";
import { GlobalFantasyLeaderboardPanel } from "@/components/racemate/global-fantasy-leaderboard";
import { Top10PredictionPicker } from "@/components/racemate/top10-prediction-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getGlobalFantasyLeaderboard,
  getFantasyLeaderboardPreview,
  getLeagues,
  getPredictionState,
  buildPredictionShareUrls,
  normalizePredictionShareScope,
  getPublicPredictionShareBySlug,
} from "@/data/racemate-repository";
import { getTeamAsset, getTeamProfileAsset } from "@/data/f1-assets";
import { getFantasyTrackVisual } from "@/data/fantasy-track-assets";
import { getSessionProfileSummary, getSessionUser } from "@/lib/auth";
import { resolveFantasyPredictionScope } from "@/lib/fantasy-prediction-scope";
import { formatGrandPrixNameRu } from "@/lib/race-display";
import { createPageMetadata } from "@/lib/seo";
import { cn } from "@/lib/utils";
import type {
  LeagueSummary,
  PredictionState,
  TeamOption,
} from "@/types/racemate";

export type FantasySearchParams = {
  created?: string;
  deleted?: string;
  joined?: string;
  left?: string;
  league?: string;
  leagueSearch?: string;
  message?: string;
  saved?: string;
  scope?: string;
  share?: string;
  shareScope?: string;
  tab?: string;
  v?: string;
};

type PredictionField = {
  allowNoDnf?: boolean;
  helper: string;
  label: string;
  name: "poleDriverId" | "fastestLapDriverId" | "dnfDriverId";
  short: string;
  locked?: boolean;
  value?: string | null;
};

type TeamPredictionField = {
  helper: string;
  label: string;
  name: "topScoringTeamId" | "fastestPitStopTeamId";
  short: string;
  locked?: boolean;
  value?: string | null;
};

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<FantasySearchParams>;
}): Promise<Metadata> {
  const query = await searchParams;

  return createPageMetadata({
    description:
      "Фентази Формулы-1 от RaceSide: прогнозируй топ-10, поул, быстрый круг и результаты команд, создавай лиги и сравнивай очки.",
    noIndex: Object.values(query).some(Boolean),
    path: "/fantasy",
    title: "Фентази Формулы-1 и прогнозы",
  });
}

export default async function FantasyPage({
  searchParams,
}: {
  searchParams: Promise<FantasySearchParams>;
}) {
  const [status, user] = await Promise.all([searchParams, getSessionUser()]);
  const activeTab = status.tab === "picks" || status.tab === "leagues" || status.tab === "leaderboard"
    ? status.tab
    : "overview";
  const [predictionState, leagues, leaderboard, profileSummary, leaderboardPreview] = await Promise.all([
    getPredictionState(user?.id),
    activeTab === "leagues" || activeTab === "overview"
      ? getLeagues(user?.id, { onlyMine: activeTab === "overview" })
      : Promise.resolve([] as LeagueSummary[]),
    activeTab === "leaderboard"
      ? getGlobalFantasyLeaderboard()
      : Promise.resolve({ rows: [], updatedAt: "" }),
    activeTab === "leaderboard" ? getSessionProfileSummary() : Promise.resolve(null),
    activeTab === "overview"
      ? getFantasyLeaderboardPreview(user?.id)
      : Promise.resolve({ currentUser: null, topRows: [], updatedAt: "" }),
  ]);
  const activePredictionScope = resolveFantasyPredictionScope({
    qualificationLocked: Boolean(predictionState.race?.poleLocked),
    requestedScope: status.scope,
  });
  const leagueSearch = status.leagueSearch?.trim() ?? "";
  const normalizedLeagueSearch = leagueSearch.toLocaleLowerCase("ru");
  const myLeagues = leagues.filter((league) => league.isMember || league.isOwner);
  const openLeagues = leagues.filter((league) =>
    !league.isMember
    && !league.isOwner
    && (!normalizedLeagueSearch || league.name.toLocaleLowerCase("ru").includes(normalizedLeagueSearch)),
  );
  const current = predictionState.current;
  const picks = buildPredictionFields(current, predictionState.race);
  const teamPicks = buildTeamPredictionFields(current, predictionState.race);
  const completedTop10 = current?.top10DriverIds?.length ?? 0;
  const completedRaceSpecials = picks.slice(1).filter((pick) =>
    pick.name === "dnfDriverId" && current?.dnfPickKind === "none"
      ? true
      : Boolean(pick.value),
  ).length;
  const completedTeamPicks = teamPicks.filter((pick) => Boolean(pick.value)).length;
  const completedQualificationPicks = current?.poleDriverId ? 1 : 0;
  const completedRacePicks = completedTop10 + completedRaceSpecials + completedTeamPicks;
  const notice = getStatusNotice(status);
  const shareScope = normalizePredictionShareScope(status.shareScope);
  const shareSlug = status.share?.trim() || null;
  const sharePreview = shareSlug ? await getPublicPredictionShareBySlug(shareSlug, shareScope) : null;
  const shareVersion = Number(status.v ?? sharePreview?.shareImageVersion ?? current?.shareImageVersion ?? 1) || 1;
  const shareUrls = sharePreview ? buildPredictionShareUrls(sharePreview.shareSlug, shareScope, shareVersion) : null;

  return (
    <AppShell>
      {activeTab === "overview" ? (
        <FantasyDashboard
          leaderboard={leaderboardPreview}
          leagues={leagues}
          predictionState={predictionState}
          signedIn={Boolean(user)}
        />
      ) : (
      <section className="grid gap-4 pb-6 sm:gap-5">
        <FantasyHero
          activeTab={activeTab}
          predictionScope={activePredictionScope}
          predictionState={predictionState}
          userSignedIn={Boolean(user)}
        />

        {notice ? <StatusNotice notice={notice} /> : null}

        {activeTab === "picks" ? (
          <PredictionModule
            activeScope={activePredictionScope}
            completedQualificationPicks={completedQualificationPicks}
            completedRacePicks={completedRacePicks}
            fields={picks}
            predictionState={predictionState}
            teamFields={teamPicks}
            userSignedIn={Boolean(user)}
          />
        ) : null}

        {activeTab === "leagues" ? (
          <div className="grid gap-5">
            <LeagueActivity
              myLeagues={myLeagues}
              openLeagues={openLeagues}
              race={predictionState.race}
              searchQuery={leagueSearch}
              selectedLeagueId={status.league}
            />
          </div>
        ) : null}

        {activeTab === "leaderboard" ? (
          <GlobalFantasyLeaderboardPanel
            currentDisplayName={profileSummary?.displayName ?? null}
            leaderboard={leaderboard}
          />
        ) : null}
        {sharePreview && shareUrls ? (
          <PredictionShareModalLauncher
            raceName={sharePreview.race.name}
            scope={shareScope}
            shareImageUrl={shareUrls.shareImageUrl}
            shareSlug={sharePreview.shareSlug}
            shareUrl={sharePreview.shareUrl}
          />
        ) : null}
      </section>
      )}
    </AppShell>
  );
}

function FantasyHero({
  activeTab,
  predictionScope,
  predictionState,
  userSignedIn,
}: {
  activeTab: "picks" | "leagues" | "leaderboard";
  predictionScope: "qualification" | "race";
  predictionState: PredictionState;
  userSignedIn: boolean;
}) {
  const current = predictionState.current;
  const qualificationComplete = current?.poleDriverId ? 1 : 0;
  const raceComplete = Math.min(
    14,
    (current?.top10DriverIds.length ?? 0)
      + Number(Boolean(current?.fastestLapDriverId))
      + Number(current?.dnfPickKind === "none" || Boolean(current?.dnfDriverId))
      + Number(Boolean(current?.topScoringTeamId))
      + Number(Boolean(current?.fastestPitStopTeamId)),
  );
  const title = activeTab === "picks"
    ? `Прогноз на ${predictionState.race?.name ?? "следующий этап"}`
    : activeTab === "leagues"
      ? "Лиги"
      : "Общий рейтинг";
  const description = activeTab === "picks"
    ? "Расставь пилотов и сохрани выбор до старта сессии."
    : activeTab === "leagues"
      ? "Соревнуйся с друзьями весь сезон."
      : "";
  const mobileRaceName = predictionState.race?.name
    ? formatGrandPrixNameRu(predictionState.race.name).replace(/^Гран-при\s+/i, "")
    : "следующий этап";

  return (
    <FantasySectionHeader active={activeTab === "picks" ? "prediction" : activeTab}>
      {activeTab === "picks" ? (
        <div className="relative grid w-full grid-cols-[minmax(0,1fr)_2.25rem] items-start gap-x-3 gap-y-3 sm:grid-cols-2 sm:items-center">
          <div className="min-w-0 sm:col-start-1 sm:row-start-1">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <PageTitle className="min-w-0 text-xl sm:text-3xl">
                <span className="sm:hidden">
                  <span className="block whitespace-nowrap">Прогноз на Гран-при</span>
                  <span className="mt-0.5 block whitespace-nowrap text-muted-foreground">{mobileRaceName}</span>
                </span>
                <span className="hidden sm:inline">{title}</span>
              </PageTitle>
              <div className="hidden sm:block">
                <FantasyLockCountdown
                  locked={predictionScope === "qualification" ? Boolean(predictionState.race?.poleLocked) : Boolean(predictionState.race?.raceLocked)}
                  lockedLabel="Закрыто"
                  prefix={predictionScope === "qualification" ? "До квалификации" : "До гонки"}
                  startsAtIso={predictionScope === "qualification" ? predictionState.race?.qualifyingStartsAtIso : predictionState.race?.raceStartsAtIso}
                />
              </div>
            </div>
            {description ? (
              <p className="mt-2 hidden max-w-2xl text-sm leading-6 text-muted-foreground sm:block">
                {description}
              </p>
            ) : null}
          </div>

          <FantasyScoringDialog className="size-9 shrink-0 justify-self-end sm:absolute sm:right-0 sm:top-1/2 sm:-translate-y-1/2" />

          <div className="col-span-2 row-start-2 flex min-w-0 items-center justify-between gap-3 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:justify-center">
            <div className="sm:hidden">
              <FantasyLockCountdown
                locked={predictionScope === "qualification" ? Boolean(predictionState.race?.poleLocked) : Boolean(predictionState.race?.raceLocked)}
                lockedLabel="Закрыто"
                prefix={predictionScope === "qualification" ? "До квалификации" : "До гонки"}
                startsAtIso={predictionScope === "qualification" ? predictionState.race?.qualifyingStartsAtIso : predictionState.race?.raceStartsAtIso}
              />
            </div>
            <div className="shrink-0 text-right sm:text-center">
              <p className="font-telemetry text-xl font-black">
                {predictionScope === "qualification" ? `${qualificationComplete} из 1` : `${raceComplete} из 14`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">заполнено</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
          <div className="min-w-0">
            <PageTitle>{title}</PageTitle>
            {description ? (
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {activeTab === "leagues" ? <LeagueControlPanel userSignedIn={userSignedIn} /> : null}
        </div>
      )}
    </FantasySectionHeader>
  );
}

function PredictionModule({
  activeScope,
  completedQualificationPicks,
  completedRacePicks,
  fields,
  predictionState,
  teamFields,
  userSignedIn,
}: {
  activeScope: "qualification" | "race";
  completedQualificationPicks: number;
  completedRacePicks: number;
  fields: PredictionField[];
  predictionState: PredictionState;
  teamFields: TeamPredictionField[];
  userSignedIn: boolean;
}) {
  const race = predictionState.race;

  if (!race || !predictionState.drivers.length) {
    return (
      <section className="rounded-xl border border-border/70 bg-card/75 p-6" id="fantasy-picks">
        <p className="text-sm leading-6 text-muted-foreground">
          Прогноз откроется, когда RaceSide загрузит этап и список пилотов.
        </p>
      </section>
    );
  }

  const teamOptions = buildTeamSelectOptions(predictionState.teams);
  const predictionDrivers = predictionState.drivers.filter((driver) => driver.code?.toUpperCase() !== "TSU");
  const completedDriverSpecials = fields.slice(1).filter((field) => Boolean(field.value)).length;
  const completedTeams = teamFields.filter((field) => Boolean(field.value)).length;

  return (
    <section className="grid gap-5" id="fantasy-picks">
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border/70 bg-card/70">
        <Link
          className={cn(
            "relative flex min-h-14 items-center justify-center gap-3 px-4 text-sm font-bold transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-0.5",
            activeScope === "qualification"
              ? "bg-primary/8 text-foreground after:bg-primary"
              : "text-muted-foreground after:bg-transparent hover:text-foreground",
          )}
          href="/fantasy/prediction?scope=qualification"
        >
          Квалификация
          {completedQualificationPicks ? <CheckCircle2 aria-hidden="true" className="size-5 text-success" /> : null}
        </Link>
        <Link
          className={cn(
            "relative flex min-h-14 items-center justify-center gap-3 border-l border-border/60 px-4 text-sm font-bold transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-0.5",
            activeScope === "race"
              ? "bg-primary/8 text-foreground after:bg-primary"
              : "text-muted-foreground after:bg-transparent hover:text-foreground",
          )}
          href="/fantasy/prediction?scope=race"
        >
          Гонка
        </Link>
      </div>

      {activeScope === "qualification" ? (
        <form action={saveFantasyPrediction} className="grid gap-5">
          <input name="raceId" type="hidden" value={race.id} />
          <input name="predictionScope" type="hidden" value="qualification" />
          <section className="border-0 bg-transparent p-0 sm:rounded-xl sm:border sm:border-border/70 sm:bg-card/70 sm:p-7">
            <div>
              <h2 className="font-display text-lg font-bold">Кто возьмёт поул?</h2>
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-end">
              <FantasyDriverPredictionSelect drivers={predictionDrivers} field={fields[0]} />
              <PredictionSaveButton
                locked={Boolean(race.poleLocked)}
                lockedLabel="Поул закрыт"
                saveLabel="Сохранить прогноз"
                userSignedIn={userSignedIn}
              />
            </div>
          </section>
        </form>
      ) : (
        <form action={saveFantasyPrediction} className="grid gap-5">
          <input name="raceId" type="hidden" value={race.id} />
          <input name="predictionScope" type="hidden" value="race" />
          <div className="grid min-w-0 gap-5 overflow-x-hidden">
            <section className="min-w-0 overflow-hidden border-0 bg-transparent p-0 sm:rounded-xl sm:border sm:border-border/70 sm:bg-card/70 sm:p-5">
              <Top10PredictionPicker
                belowFinish={(
                  <div className="min-w-0 border-t border-border/70 pt-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className="font-display text-lg font-bold">Другие прогнозы</h3>
                      <Badge variant={race.raceLocked ? "warning" : "secondary"}>
                        {completedDriverSpecials}/2
                      </Badge>
                    </div>
                    <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                      {fields.slice(1).map((field) => (
                        <FantasyDriverPredictionSelect
                          drivers={predictionDrivers}
                          field={field}
                          key={field.name}
                        />
                      ))}
                    </div>
                  </div>
                )}
                defaultValue={predictionState.current?.top10DriverIds ?? []}
                drivers={predictionDrivers}
                headerAction={<StartingGridButton startingGrid={predictionState.startingGrid} />}
                locked={race.raceLocked}
              />
            </section>

            <section className="min-w-0 overflow-hidden border-0 bg-transparent p-0 sm:rounded-xl sm:border sm:border-border/70 sm:bg-card/70 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-lg font-bold">Команды</h2>
                <Badge variant={race.raceLocked ? "warning" : "secondary"}>{completedTeams}/2</Badge>
              </div>
              <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-2">
                {teamFields.map((field) => (
                  <FantasyTeamPredictionSelect field={field} key={field.name} teams={teamOptions} />
                ))}
              </div>
            </section>
          </div>

          <div
            className="sticky bottom-3 z-20 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border/80 bg-background/95 p-3 shadow-lg shadow-black/25 backdrop-blur"
            data-fantasy-sticky-save
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="font-telemetry text-lg font-black">{completedRacePicks} из 14</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">выборов заполнено</span>
            </div>
            <div className="w-40 sm:w-[18rem]">
              <PredictionSaveButton
                locked={Boolean(race.raceLocked)}
                lockedLabel="Прогноз на гонку закрыт"
                saveLabel="Сохранить прогноз"
                userSignedIn={userSignedIn}
              />
            </div>
          </div>
        </form>
      )}
    </section>
  );
}

function PredictionSaveButton({
  locked,
  lockedLabel,
  saveLabel,
  userSignedIn,
}: {
  locked: boolean;
  lockedLabel: string;
  saveLabel: string;
  userSignedIn: boolean;
}) {
  if (!userSignedIn) {
    return (
      <Button asChild className="h-12 w-full">
        <Link href="/auth">Войти, чтобы сохранить</Link>
      </Button>
    );
  }

  return (
    <Button className="h-12 w-full" disabled={locked} type="submit">
      <Lock aria-hidden="true" data-icon="inline-start" />
      {locked ? lockedLabel : saveLabel}
    </Button>
  );
}

function LeagueControlPanel({ userSignedIn }: { userSignedIn: boolean }) {
  return (
    <section className="relative flex w-full flex-wrap justify-start gap-2 sm:w-auto sm:justify-end sm:gap-3">
      <details className="group" name="league-action">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
          <Plus aria-hidden="true" className="size-4" />
          Создать лигу
        </summary>
        <form action={createFantasyLeague} className="absolute right-0 top-[calc(100%+0.75rem)] z-30 grid w-[min(22rem,calc(100vw-2rem))] gap-4 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl shadow-black/35">
          <label className="grid gap-2 text-sm font-semibold" htmlFor="name">
            Название лиги
            <input
              className="min-h-11 rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
              id="name"
              name="name"
              placeholder="Поздний пит-стоп"
              required
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input className="size-4 accent-primary" name="isPublic" type="checkbox" />
            Показывать в общем списке
          </label>
          <Button disabled={!userSignedIn} type="submit">
            {userSignedIn ? "Создать лигу" : "Войти, чтобы создать"}
          </Button>
        </form>
      </details>

      <details className="group" name="league-action">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-bold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
          <KeyRound aria-hidden="true" className="size-4" />
          Войти по коду
        </summary>
        <form action={joinFantasyLeague} className="absolute right-0 top-[calc(100%+0.75rem)] z-30 grid w-[min(22rem,calc(100vw-2rem))] gap-4 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl shadow-black/35">
          <label className="grid gap-2 text-sm font-semibold" htmlFor="inviteCode">
            Код приглашения
            <input
              className="min-h-11 rounded-md border border-input bg-background px-3 font-mono text-sm uppercase outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
              id="inviteCode"
              name="inviteCode"
              placeholder="RACE24"
              required
            />
          </label>
          <Button disabled={!userSignedIn} type="submit" variant="secondary">
            {userSignedIn ? "Войти в лигу" : "Войти в аккаунт"}
          </Button>
        </form>
      </details>
    </section>
  );
}

function LeagueActivity({
  myLeagues,
  openLeagues,
  race,
  searchQuery,
  selectedLeagueId,
}: {
  myLeagues: LeagueSummary[];
  openLeagues: LeagueSummary[];
  race: PredictionState["race"];
  searchQuery: string;
  selectedLeagueId?: string;
}) {
  const featuredLeague = myLeagues[0] ?? (searchQuery ? null : openLeagues[0] ?? null);
  const listedMyLeagues = featuredLeague === myLeagues[0] ? myLeagues.slice(1) : myLeagues;
  const listedOpenLeagues = featuredLeague === openLeagues[0] ? openLeagues.slice(1) : openLeagues;

  return (
    <section className="grid gap-5">
      {featuredLeague ? <FeaturedLeague league={featuredLeague} race={race} /> : null}
      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
        <LeagueList
          emptyText="Ты пока не состоишь в лигах. Создай свою или войди по коду друзей."
          leagues={listedMyLeagues}
          selectedLeagueId={selectedLeagueId}
          title="Мои лиги"
        />
        <LeagueList
          emptyText={searchQuery
            ? `Лиг по запросу «${searchQuery}» не найдено.`
            : "Открытых лиг пока нет. Публичные лиги появятся здесь после создания."}
          leagues={listedOpenLeagues}
          searchQuery={searchQuery}
          selectedLeagueId={selectedLeagueId}
          showJoinAction
          title="Открытые лиги"
        />
      </div>
    </section>
  );
}

function FeaturedLeague({
  league,
  race,
}: {
  league: LeagueSummary;
  race: PredictionState["race"];
}) {
  const trackVisual = race ? getFantasyTrackVisual(race.season, race.round, race.name) : null;

  return (
    <article className="relative grid overflow-hidden rounded-xl border border-border/70 bg-card/75 transition-colors hover:border-primary/55 xl:grid-cols-[minmax(0,1fr)_15rem]">
      <Link
        aria-label={`Открыть лигу «${league.name}»`}
        className="absolute inset-0 z-0 transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href={league.id ? `/fantasy/leagues/${league.id}` : "/fantasy/leagues"}
      />
      <div className="pointer-events-none relative z-10 grid grid-cols-[5rem_minmax(0,1fr)] md:grid-cols-[7rem_minmax(0,1fr)]">
        <div className="grid place-items-center bg-[radial-gradient(circle_at_center,rgb(225_6_0_/_0.16),transparent_68%)] p-3 sm:p-4">
          <FantasyLeagueAvatar avatarUrl={league.avatarUrl} className="size-16 sm:size-20" name={league.name} />
        </div>
        <div className="grid content-center gap-4 p-4 sm:p-5">
          <div>
            <p className="font-telemetry text-xs font-black uppercase tracking-[0.1em] text-primary">
              {league.isMember || league.isOwner ? "Твоя главная лига" : "Лига недели"}
            </p>
            <h2 className="mt-1.5 font-display text-xl font-black sm:text-2xl">{league.name}</h2>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
              {league.members} участников, лидер {league.leader}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 border-t border-border/60 pt-3 sm:gap-4">
            <div>
              <strong className="font-telemetry text-lg sm:text-xl">
                {league.isMember || league.isOwner
                  ? "В лиге"
                  : formatFantasyScore(league.lastRoundAverageScore)}
              </strong>
              <span className="mt-0.5 block text-[0.625rem] leading-tight text-muted-foreground sm:text-xs">
                {league.isMember || league.isOwner ? "статус" : "среднее за этап"}
              </span>
            </div>
            <div><strong className="font-telemetry text-lg sm:text-xl">{league.score}</strong><span className="mt-0.5 block text-[0.625rem] leading-tight text-muted-foreground sm:text-xs">очков у лидера</span></div>
            <div><strong className="font-telemetry text-lg sm:text-xl">{league.members}</strong><span className="mt-0.5 block text-[0.625rem] leading-tight text-muted-foreground sm:text-xs">участников</span></div>
          </div>
        </div>
      </div>
      <div className="pointer-events-none relative z-10 hidden border-l stitch-divider p-4 xl:block [&_a]:pointer-events-auto">
        <p className="text-xs font-semibold text-muted-foreground">Следующий зачёт</p>
        <p className="mt-1 truncate font-display text-base font-bold">{race?.name ?? "Следующий этап"}</p>
        {trackVisual ? (
          <FantasyTrackVisualImage
            className="mt-3 h-24 rounded-lg"
            preload
            showCredit={false}
            sizes="208px"
            variant="card"
            visual={trackVisual}
          />
        ) : (
          <div className="mt-3 h-24 rounded-lg bg-muted/35" />
        )}
      </div>
    </article>
  );
}

function LeagueList({
  emptyText,
  leagues,
  selectedLeagueId,
  searchQuery,
  showJoinAction = false,
  title,
}: {
  emptyText: string;
  leagues: LeagueSummary[];
  selectedLeagueId?: string;
  searchQuery?: string;
  showJoinAction?: boolean;
  title: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-border/70 bg-card/75"
      id={showJoinAction ? "open-leagues" : "my-leagues"}
    >
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-2">
        <a
          className="group inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href={showJoinAction ? "#open-leagues" : "#my-leagues"}
        >
          <span className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
            {showJoinAction
              ? <Globe2 aria-hidden="true" className="size-4" />
              : <Users aria-hidden="true" className="size-4" />}
          </span>
          <h2 className="font-display text-base font-bold transition-colors group-hover:text-primary">{title}</h2>
        </a>
        {showJoinAction ? (
          <form action="/fantasy/leagues" className="relative basis-full sm:min-w-0 sm:max-w-48 sm:flex-1 sm:basis-auto" method="get">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              aria-label="Найти лигу по названию"
              className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              defaultValue={searchQuery}
              name="leagueSearch"
              placeholder="Найти лигу"
              type="search"
            />
          </form>
        ) : (
          <span className="font-telemetry text-xs font-bold text-muted-foreground">{leagues.length}</span>
        )}
      </div>
      <div className="px-4 pb-3 sm:px-5">
        {leagues.length ? (
          leagues.map((league) => {
            const content = (
              <>
                <FantasyLeagueAvatar
                  avatarUrl={league.avatarUrl}
                  className="size-11 self-start sm:self-auto"
                  name={league.name}
                />
                <span className="min-w-0 sm:flex-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="break-words font-display text-base font-bold leading-tight sm:truncate sm:leading-normal">{league.name}</span>
                    {league.isOwner ? (
                      <Badge variant="outline">
                        <Crown aria-hidden="true" className="mr-1 size-3" />
                        Создатель
                      </Badge>
                    ) : null}
                    {league.isMember && !league.isOwner ? <Badge variant="outline">Ты здесь</Badge> : null}
                  </span>
                  <span className={cn(
                    "mt-1 block font-semibold leading-snug text-muted-foreground sm:truncate",
                    showJoinAction ? "text-xs" : "text-sm",
                  )}>
                    {league.members} {pluralize(league.members, ["участник", "участника", "участников"])} · лидер {" "}
                    {league.leader}
                  </span>
                </span>
                <span className="col-start-2 grid grid-cols-2 gap-3 border-t border-border/60 pt-2 text-left sm:col-auto sm:shrink-0 sm:border-t-0 sm:pt-0 sm:text-right">
                  <span className="grid justify-items-start gap-1 sm:justify-items-end">
                    <span className="font-telemetry text-lg font-extrabold leading-none">
                      {formatFantasyScore(league.lastRoundAverageScore)}
                    </span>
                    <span className="max-w-16 text-[0.62rem] font-semibold leading-tight text-muted-foreground">
                      среднее за этап
                    </span>
                  </span>
                  <span className="grid justify-items-start gap-1 sm:justify-items-end">
                    <span className="font-telemetry text-lg font-extrabold leading-none">{league.score}</span>
                    <span className="text-[0.62rem] font-semibold text-muted-foreground">очков</span>
                  </span>
                </span>
                {!showJoinAction ? (
                  <span className="font-telemetry col-start-2 shrink-0 justify-self-start rounded border border-border/70 bg-secondary/40 px-2 py-1 text-[0.68rem] font-extrabold uppercase sm:col-auto sm:justify-self-auto">
                    {league.inviteCode ?? "Закрытая"}
                  </span>
                ) : null}
              </>
            );
            const rowClassName = cn(
              "grid min-h-16 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-t border-border/60 py-3 sm:flex sm:flex-wrap sm:gap-3 sm:py-2.5",
              selectedLeagueId === league.id && "bg-accent/60",
            );

            return (
              <Link
                className={cn(
                  rowClassName,
                  "cursor-pointer transition-colors hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
                href={league.id ? `/fantasy/leagues/${league.id}` : "/fantasy/leagues"}
                key={league.id ?? league.name}
                prefetch={false}
              >
                {content}
              </Link>
            );
          })
        ) : (
          <p className="border-t border-border/60 py-6 text-sm leading-6 text-muted-foreground">{emptyText}</p>
        )}
      </div>
    </div>
  );
}

function StatusNotice({
  notice,
}: {
  notice: {
    icon: typeof CheckCircle2;
    text: string;
    tone: "success" | "warning";
  };
}) {
  return (
    <div
      className={cn(
        "stitch-panel flex items-center gap-3 p-4 text-sm",
        notice.tone === "success" && "border-success/40 bg-success/10",
        notice.tone === "warning" && "border-warning/40 bg-warning/10",
      )}
    >
      <notice.icon
        aria-hidden="true"
        className={cn(
          "size-5 shrink-0",
          notice.tone === "success" ? "text-success" : "text-warning",
        )}
      />
      <span className="leading-6 text-muted-foreground">{notice.text}</span>
    </div>
  );
}

function buildPredictionFields(
  current: PredictionState["current"],
  race?: PredictionState["race"],
): PredictionField[] {
  return [
    {
      helper: "Выберите пилота",
      label: "Поул-позиция (квалификация)",
      name: "poleDriverId",
      short: "Pole position",
      locked: race?.poleLocked,
      value: current?.poleDriverId,
    },
    {
      helper: "Выберите пилота",
      label: "Лучший круг",
      name: "fastestLapDriverId",
      short: "Fastest lap",
      locked: race?.raceLocked,
      value: current?.fastestLapDriverId,
    },
    {
      allowNoDnf: true,
      helper: "Выберите пилота",
      label: "Первый сход",
      name: "dnfDriverId",
      short: "DNF",
      locked: race?.raceLocked,
      value: current?.dnfPickKind === "none" ? "__none" : current?.dnfDriverId,
    },
  ];
}

function buildTeamPredictionFields(
  current: PredictionState["current"],
  race?: PredictionState["race"],
): TeamPredictionField[] {
  return [
    {
      helper: "Выберите команду",
      label: "Команда, которая наберет больше всего очков за этап",
      name: "topScoringTeamId",
      short: "Top team",
      locked: race?.raceLocked,
      value: current?.topScoringTeamId,
    },
    {
      helper: "Выберите команду",
      label: "Команда с самым быстрым пит-стопом",
      name: "fastestPitStopTeamId",
      short: "Pit stop",
      locked: race?.raceLocked,
      value: current?.fastestPitStopTeamId,
    },
  ];
}

function buildTeamSelectOptions(teams: TeamOption[]): FantasyTeamSelectOption[] {
  return teams.map((team) => {
    const visual = getTeamAsset(team.code) ?? getTeamAsset(team.name);
    const profile = getTeamProfileAsset(team.code) ?? getTeamProfileAsset(team.name);

    return {
      carImageUrl: profile?.carImageUrl ?? null,
      code: team.code,
      color: visual?.color ?? null,
      id: team.id,
      logo: visual?.logo ?? null,
      name: team.name,
    };
  });
}

function formatFantasyScore(value: number | null | undefined) {
  return value === null || value === undefined
    ? "-"
    : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(value);
}

function pluralize(value: number, forms: [string, string, string]) {
  const mod10 = value % 10;
  const mod100 = value % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return forms[0];
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return forms[1];
  }

  return forms[2];
}

function getStatusNotice(status: FantasySearchParams) {
  if (status.saved) {
    return {
      icon: CheckCircle2,
      text: "Прогноз сохранен. Его можно поправить до блокировки.",
      tone: "success" as const,
    };
  }

  if (status.created) {
    return {
      icon: CheckCircle2,
      text: "Лига создана. Код приглашения уже доступен в списке.",
      tone: "success" as const,
    };
  }

  if (status.joined) {
    return {
      icon: CheckCircle2,
      text: "Ты в лиге. После гонки очки появятся в таблице.",
      tone: "success" as const,
    };
  }

  if (status.deleted) {
    return {
      icon: CheckCircle2,
      text: "Лига удалена.",
      tone: "success" as const,
    };
  }

  if (status.left) {
    return {
      icon: CheckCircle2,
      text: "Ты вышел из лиги. Личные прогнозы остались на месте.",
      tone: "success" as const,
    };
  }

  if (status.message === "top10") {
    return {
      icon: ClipboardList,
      text: "Один пилот не может занимать несколько мест в топ-10.",
      tone: "warning" as const,
    };
  }

  if (status.message === "driver") {
    return {
      icon: ClipboardList,
      text: "Один из выбранных пилотов уже недоступен. Обнови прогноз и сохрани снова.",
      tone: "warning" as const,
    };
  }

  if (status.message === "locked") {
    return {
      icon: Lock,
      text: "Гонка уже началась, новый прогноз принять нельзя.",
      tone: "warning" as const,
    };
  }

  if (status.message) {
    return {
      icon: ClipboardList,
      text: "Не получилось выполнить действие. Проверь данные и попробуй еще раз.",
      tone: "warning" as const,
    };
  }

  return null;
}
