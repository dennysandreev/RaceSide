import {
  ArrowRight,
  CalendarDays,
  Clock3,
  ExternalLink,
  MapPin,
  Newspaper,
  Radio,
  Target,
  TrendingUp,
} from "lucide-react";
import { IntentLink as Link } from "@/components/racemate/intent-link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ComponentType, ReactNode, SVGProps } from "react";

import { AppShell } from "@/components/racemate/app-shell";
import { JsonLd } from "@/components/racemate/json-ld";
import { PageTitle } from "@/components/racemate/page-title";
import { CircuitStatsSection } from "@/components/racemate/circuit-stats-section";
import { NavigationLoadingLink } from "@/components/racemate/navigation-loading-link";
import { NewsImage } from "@/components/racemate/news-image";
import { RaceFlag } from "@/components/racemate/race-flag";
import { TeamColorProgress } from "@/components/racemate/team-color";
import { TrackLocalTimeBadge } from "@/components/racemate/track-local-time-badge";
import { TrackMap } from "@/components/racemate/track-map";
import { WeekendSessionBoard } from "@/components/racemate/weekend-session-board";
import { WeekendTyreAllocation } from "@/components/racemate/weekend-tyre-allocation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getCircuitStatsForRace,
  getCurrentRaceReplaySummary,
  getNextSession,
  getCurrentRaceDetail,
  getDriverStandings,
  getPredictionState,
  getRaceNews,
  getSessionResultsBySessionIds,
  getRaceWinnerOdds,
  getWeekendSessions,
} from "@/data/racemate-repository";
import { getTeamAssetForMarketOutcome } from "@/data/f1-assets";
import { getSessionUser } from "@/lib/auth";
import { formatSessionName, splitSessionStart } from "@/lib/session-display";
import { CURRENT_F1_SEASON, getSearchParam } from "@/lib/season-navigation";
import { absoluteUrl, createPageMetadata, SITE_URL } from "@/lib/seo";
import { withServerTtlCache } from "@/lib/server-ttl-cache";
import { cn } from "@/lib/utils";
import type { PredictionState, RaceDetail, RaceWinnerOdds, StandingRow } from "@/types/racemate";

export const dynamic = "force-dynamic";

type WeekendSearchParams = {
  season?: string | string[];
  session?: string | string[];
};

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<WeekendSearchParams>;
}): Promise<Metadata> {
  const [query, nextSession] = await Promise.all([
    searchParams,
    getNextSession(),
  ]);
  const raceName = nextSession.race;

  return createPageMetadata({
    description: `${raceName}: расписание сессий, время старта, погода, новости, результаты и прогнозы на текущий гоночный уикенд.`,
    noIndex: Boolean(query.season || query.session),
    path: "/weekend",
    title: `${raceName}: гоночный уикенд`,
  });
}

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export default async function WeekendPage({
  searchParams,
}: {
  searchParams: Promise<WeekendSearchParams>;
}) {
  const query = await searchParams;
  const requestedSeason = getSearchParam(query.season);
  const requestedSessionId = getSearchParam(query.session);

  if (requestedSeason && Number(requestedSeason) !== CURRENT_F1_SEASON) {
    notFound();
  }

  return (
    <AppShell>
      <WeekendContent requestedSessionId={requestedSessionId} />
    </AppShell>
  );
}

async function WeekendContent({ requestedSessionId }: {
  requestedSessionId: string | undefined;
}) {
  const userPromise = getSessionUser();
  const publicDataPromise = withServerTtlCache(
    "public:weekend",
    3_000,
    getWeekendPagePublicData,
    { staleWhileRevalidateMs: 0 },
  );
  const predictionStatePromise: Promise<PredictionState> = userPromise.then((user) =>
    user ? getPredictionState(user.id) : getEmptyWeekendPredictionState(),
  );
  const [user, publicData, predictionState] = await Promise.all([
    userPromise,
    publicDataPromise,
    predictionStatePromise,
  ]);
  const {
    circuitStats,
    currentRace,
    nextSession,
    raceNews,
    raceReplay,
    resultsBySession,
    standings,
    weekendSessions,
    winnerOdds,
  } = publicData;
  const sessionResults = weekendSessions.map((session) => ({
    results: session.id ? resultsBySession.get(session.id) ?? [] : [],
    session,
  }));
  const completedSessions = sessionResults.filter(
    (item) => item.results.length || item.session.status === "Завершена",
  ).length;
  const raceNewsTagSlug = raceNews
    .flatMap((item) => item.tags)
    .find((tag) => tag.type === "race")?.slug;
  const raceNewsHref =
    raceNewsTagSlug
      ? `/news?tag=${raceNewsTagSlug}`
      : currentRace
        ? `/news?race=${currentRace.season}-${currentRace.round}`
        : "/news";

  return (
    <>
      {currentRace ? (
        <JsonLd
          data={[
            {
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                {
                  "@type": "ListItem",
                  item: SITE_URL,
                  name: "Главная",
                  position: 1,
                },
                {
                  "@type": "ListItem",
                  item: `${SITE_URL}/weekend`,
                  name: currentRace.race,
                  position: 2,
                },
              ],
            },
            {
              "@context": "https://schema.org",
              "@type": "SportsEvent",
              description: `${currentRace.race}, текущий этап сезона Формулы-1 ${currentRace.season}.`,
              eventStatus: currentRace.status === "Завершен"
                ? "https://schema.org/EventCompleted"
                : "https://schema.org/EventScheduled",
              image: currentRace.trackMapUrl
                ? absoluteUrl(currentRace.trackMapUrl)
                : undefined,
              inLanguage: "ru-RU",
              location: {
                "@type": "Place",
                address: {
                  "@type": "PostalAddress",
                  addressCountry: currentRace.country,
                  addressLocality: currentRace.locality,
                },
                name: currentRace.circuit,
              },
              name: `${currentRace.race} ${currentRace.season}`,
              startDate: currentRace.startsAtIso,
              url: `${SITE_URL}/weekend`,
            },
          ]}
        />
      ) : null}
      <section className="grid gap-4 pb-5 sm:gap-5">
        <WeekendHero
          circuitStats={circuitStats}
          currentRace={currentRace}
          nextRace={nextSession.race}
          nextSession={nextSession}
          raceReplay={raceReplay}
          weekendStatus={nextSession.status}
        />

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-stretch">
          <section className="stitch-panel min-w-0 overflow-hidden p-0">
            <PanelHeader
              icon={CalendarDays}
              meta={`${completedSessions} из ${sessionResults.length} сессий завершено`}
              mobileMeta={`${completedSessions} из ${sessionResults.length}`}
              title="Расписание уикенда"
            />
            <WeekendSessionBoard
              activeSessionName={nextSession.session}
              initialSessionId={requestedSessionId}
              sessions={sessionResults}
            />
          </section>

          <WinnerOddsCard odds={winnerOdds} teamLookupRows={standings} />
          <StageNewsPanel href={raceNewsHref} items={raceNews} />
          <FantasyPredictionCard predictionState={predictionState} userSignedIn={Boolean(user)} />
        </div>
      </section>
    </>
  );
}

async function getWeekendPagePublicData() {
  const raceReplayPromise = getCurrentRaceReplaySummary();
  const [nextSession, weekendSessions, currentRace, standings] = await Promise.all([
    getNextSession(),
    getWeekendSessions(),
    getCurrentRaceDetail(),
    getDriverStandings(CURRENT_F1_SEASON),
  ]);
  const sessionResultsPromise = getSessionResultsBySessionIds(
    weekendSessions.map((session) => session.id),
    CURRENT_F1_SEASON,
  );
  const [raceNews, winnerOdds, resultsBySession, circuitStats, raceReplay] = await Promise.all([
    currentRace ? getRaceNews(currentRace.id, 4) : [],
    getRaceWinnerOdds(currentRace),
    sessionResultsPromise,
    currentRace ? getCircuitStatsForRace(currentRace.season, currentRace.round) : null,
    raceReplayPromise,
  ]);

  return {
    circuitStats,
    currentRace,
    nextSession,
    raceNews,
    raceReplay,
    resultsBySession,
    standings,
    weekendSessions,
    winnerOdds,
  };
}

function getEmptyWeekendPredictionState(): PredictionState {
  return {
    current: null,
    drivers: [],
    previousResult: null,
    startingGrid: null,
    race: null,
    seasonSummary: {
      predictionCount: 0,
      scoredPredictionCount: 0,
      totalScore: null,
    },
    teams: [],
  };
}

function WeekendHero({
  circuitStats,
  currentRace,
  nextRace,
  nextSession,
  raceReplay,
  weekendStatus,
}: {
  circuitStats: Awaited<ReturnType<typeof getCircuitStatsForRace>>;
  currentRace: RaceDetail | null;
  nextRace: string;
  nextSession: Awaited<ReturnType<typeof getNextSession>>;
  raceReplay: Awaited<ReturnType<typeof getCurrentRaceReplaySummary>>;
  weekendStatus: string;
}) {
  const isWeekendDone = weekendStatus === "Завершен";
  const isWeekendUpcoming = weekendStatus.startsWith("До старта");
  const nextSessionStart = splitSessionStart(nextSession.startsAt);

  return (
    <section className="stitch-panel overflow-hidden p-0">
      <div className="grid lg:grid-cols-[minmax(0,1.42fr)_minmax(24.5rem,0.8fr)]">
        <div className="flex min-w-0 flex-col border-b stitch-divider lg:border-b-0 lg:border-r">
          <header className="px-4 pb-3 pt-4 sm:px-5 sm:pb-3 sm:pt-5">
            <div className="flex min-w-0 items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-2.5">
                {currentRace ? (
                  <RaceFlag
                    className="shrink-0 text-xl"
                    countryCode={currentRace.countryCode}
                    label={currentRace.country}
                    value={currentRace.countryFlag}
                  />
                ) : null}
                <Badge className="shrink-0" variant="outline">Раунд {currentRace?.round ?? "—"}</Badge>
                <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />
                <p className="hidden min-w-0 items-center gap-1.5 text-sm font-semibold text-muted-foreground sm:flex">
                  <MapPin aria-hidden="true" className="size-4 shrink-0 text-primary" />
                  <span className="truncate">
                    {currentRace ? `${currentRace.locality}, ${currentRace.country}` : "Локация уточняется"}
                  </span>
                </p>
              </div>
              <div className={cn("shrink-0", isWeekendUpcoming && "lg:hidden")}>
                <Badge className="whitespace-nowrap" variant={weekendStatus === "Live" ? "success" : "warning"}>
                  {weekendStatus}
                </Badge>
              </div>
            </div>
            <PageTitle className="mt-2.5 max-w-none">{nextRace}</PageTitle>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-muted-foreground">
              <span className="truncate font-display font-extrabold text-foreground">
                {currentRace?.circuit ?? "Трасса этапа"}
              </span>
              <p className="flex min-w-0 items-center gap-1.5 sm:hidden">
                <MapPin aria-hidden="true" className="size-4 shrink-0 text-primary" />
                <span className="truncate">
                  {currentRace ? `${currentRace.locality}, ${currentRace.country}` : "Локация уточняется"}
                </span>
              </p>
              {isWeekendDone ? <span>Этап завершен</span> : null}
            </div>
          </header>

          <div className="flex flex-1 flex-col px-4 pb-4 sm:px-5 sm:pb-5">
            <div className="h-[16rem] min-w-0 sm:h-[18rem] lg:h-auto lg:min-h-[18rem] lg:flex-1">
              <TrackMap
                assetSrc={currentRace?.trackMapUrl ?? undefined}
                circuit={currentRace?.circuit ?? nextRace}
                fill
                label={nextRace}
                layout={currentRace?.layout}
                modelTogglePlacement="bottom"
                shortModelToggleLabel
                showModel3d
                unframed
              />
            </div>
            {!isWeekendDone ? (
              <div className="border-t stitch-divider pt-4 lg:hidden">
                <WeekendNextSession nextSession={nextSession} start={nextSessionStart} />
              </div>
            ) : null}
          </div>
        </div>

        <aside className="grid min-w-0 content-start divide-y divide-border/70">
          {!isWeekendDone ? (
            <div className="hidden p-4 lg:block lg:p-5">
              <WeekendNextSession nextSession={nextSession} start={nextSessionStart} />
            </div>
          ) : null}
          {currentRace?.tyreAllocation ? (
            <div className="p-4 lg:p-5">
              <WeekendTyreAllocation allocation={currentRace.tyreAllocation} />
            </div>
          ) : null}
          <div className="p-4 lg:p-5">
            <CircuitStatsSection
              circuitName={currentRace?.circuit ?? nextRace}
              embedded
              footerAction={(
                <div className="grid grid-cols-2 items-center gap-2">
                  <Button asChild className="min-w-0 w-full justify-center gap-1.5 px-2" variant="secondary">
                    <Link href="https://vkvideo.ru/@versportaa" rel="noreferrer" target="_blank">
                      Смотреть
                      <ExternalLink aria-hidden="true" className="size-4" data-icon="inline-end" />
                    </Link>
                  </Button>
                  <Button asChild className="min-w-0 w-full gap-2 px-2 font-sans text-sm normal-case tracking-normal">
                    <Link href="/live">
                      <Radio aria-hidden="true" className="size-5" />
                      <span className="whitespace-nowrap">RaceSide LIVE</span>
                    </Link>
                  </Button>
                </div>
              )}
              previewFooter={<TrackLocalTimeBadge timezone={currentRace?.timezone} />}
              previewLayout="list"
              showCircuitName={false}
              showSectionLabel={false}
              stats={circuitStats}
            />
          </div>
          {currentRace?.status === "Завершен" && raceReplay ? (
            <div className="p-4 lg:p-5">
              <Button asChild className="w-full justify-center" size="sm" variant="secondary">
                <NavigationLoadingLink
                  href={raceReplay.href}
                  loadingLabel="Готовим повтор Гран-при"
                >
                  Повтор Гран-при · {raceReplay.sourceSeason}
                </NavigationLoadingLink>
              </Button>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function WeekendNextSession({
  nextSession,
  start,
}: {
  nextSession: Awaited<ReturnType<typeof getNextSession>>;
  start: ReturnType<typeof splitSessionStart>;
}) {
  return (
    <div className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 sm:gap-4">
      <span className="weekend-next-session-icon grid size-11 shrink-0 place-items-center rounded-md text-primary ring-1 ring-border/70">
        <Clock3 aria-hidden="true" className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted-foreground">
          Ближайшая сессия
        </p>
        <p className="mt-0.5 truncate font-display text-lg font-bold leading-tight text-foreground">
          {formatSessionName(nextSession.session)}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-telemetry text-2xl font-extrabold leading-none text-foreground">
          {start.time ?? nextSession.startsAt}
        </p>
        {start.time ? (
          <p className="mt-1 font-telemetry text-[0.68rem] font-semibold text-muted-foreground">
            {start.date}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PanelHeader({
  action,
  hideMetaOnMobile = false,
  icon: Icon,
  meta,
  mobileMeta,
  title,
}: {
  action?: ReactNode;
  hideMetaOnMobile?: boolean;
  icon: IconComponent;
  meta: string;
  mobileMeta?: string;
  title: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b stitch-divider p-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border/70 bg-secondary/40">
          <Icon aria-hidden="true" className="size-4.5 text-primary" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold leading-tight">{title}</h2>
          <p
            className={cn(
              "mt-0.5 truncate text-xs font-semibold text-muted-foreground",
              hideMetaOnMobile && "hidden sm:block",
            )}
          >
            {mobileMeta ? (
              <>
                <span className="sm:hidden">{mobileMeta}</span>
                <span className="hidden sm:inline">{meta}</span>
              </>
            ) : meta}
          </p>
        </div>
      </div>
      {action}
    </div>
  );
}

function StageNewsPanel({
  href,
  items,
}: {
  href: string;
  items: Awaited<ReturnType<typeof getRaceNews>>;
}) {
  return (
    <section className="order-4 stitch-panel overflow-hidden p-0 xl:order-3">
      <PanelHeader
        action={
          <Link
            className="group/action inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={href}
          >
            Все новости
            <ArrowRight
              aria-hidden="true"
              className="size-3.5 transition-transform group-hover/action:translate-x-0.5"
            />
          </Link>
        }
        hideMetaOnMobile
        icon={Newspaper}
        meta="Главное вокруг этого Гран-при"
        title="Новости этапа"
      />
      <div className="divide-y divide-border/70">
        {items.length ? (
          items.map((item, index) => (
            <Link
              className={cn(
                "group grid min-w-0 items-center gap-3 p-4 transition-colors hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:gap-5 sm:p-5",
                index === 0
                  ? "grid-cols-[minmax(0,1fr)_7.5rem] sm:grid-cols-[minmax(0,1fr)_13rem]"
                  : "grid-cols-[minmax(0,1fr)_5.5rem] sm:grid-cols-[minmax(0,1fr)_8rem]",
              )}
              href={`/news/${item.slug}`}
              key={item.slug}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-xs font-semibold text-foreground">{item.source}</span>
                  <span aria-hidden="true" className="size-1 rounded-full bg-primary" />
                  <span className="font-telemetry text-[0.68rem] font-bold uppercase text-muted-foreground">
                    {item.time}
                  </span>
                </div>
                <div className="mt-2 flex min-w-0 items-start gap-2 sm:mt-2.5">
                  <h3
                    className={cn(
                      "min-w-0 flex-1 font-semibold transition-colors group-hover:text-primary",
                      index === 0 ? "text-base leading-6 sm:text-xl sm:leading-7" : "text-sm leading-5 sm:text-base sm:leading-6",
                    )}
                  >
                    {item.title}
                  </h3>
                  <ArrowRight
                    aria-hidden="true"
                    className="mt-1 hidden size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary sm:block"
                  />
                </div>
                <div className="hidden sm:block">
                  <p
                    className={cn(
                      "mt-1.5 text-muted-foreground",
                      index === 0
                        ? "line-clamp-2 text-sm leading-6"
                        : "line-clamp-1 text-xs leading-5 sm:line-clamp-2",
                    )}
                  >
                    {item.summary}
                  </p>
                </div>
              </div>
              {item.imageUrl ? (
                <NewsImage
                  alt={item.title}
                  className={cn(
                    "relative overflow-hidden rounded-md bg-muted",
                    index === 0 ? "aspect-[4/3]" : "aspect-[3/2]",
                  )}
                  src={item.imageUrl}
                />
              ) : (
                <span className="grid h-full min-h-16 place-items-center border-l border-border/70 text-muted-foreground transition-colors group-hover:text-primary">
                  <ArrowRight aria-hidden="true" className="size-5 transition-transform group-hover:translate-x-1" />
                </span>
              )}
            </Link>
          ))
        ) : (
          <p className="px-4 py-7 text-sm leading-6 text-muted-foreground sm:px-5">
            Пока нет новостей, привязанных к этому этапу.
          </p>
        )}
      </div>
    </section>
  );
}

function WinnerOddsCard({
  odds,
  teamLookupRows,
}: {
  odds: RaceWinnerOdds | null;
  teamLookupRows: StandingRow[];
}) {
  return (
    <section className="stitch-panel overflow-hidden p-0">
      <PanelHeader
        action={
          odds ? (
            <Link
              className="inline-flex items-center gap-1 rounded-md text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={odds.marketUrl}
              rel="noreferrer"
              target="_blank"
            >
              Рынок
              <ExternalLink aria-hidden="true" className="size-3" />
            </Link>
          ) : undefined
        }
        icon={TrendingUp}
        meta={odds ? `${odds.source} · обновлено ${odds.updatedAt}` : "Букмекерские вероятности"}
        title="Вероятность победы"
      />
      <div className="p-4">
        {odds ? (
          <div className="grid gap-3">
            {odds.outcomes.map((outcome) => {
              const teamVisual = getTeamAssetForMarketOutcome(outcome.name, teamLookupRows);

              return (
                <div className="grid gap-1.5" key={outcome.name}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-semibold">{outcome.name}</span>
                    <span className="font-telemetry whitespace-nowrap font-bold text-muted-foreground">
                      {outcome.label}
                    </span>
                  </div>
                  <TeamColorProgress
                    color={teamVisual?.color}
                    value={outcome.probability * 100}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            На Polymarket пока нет рынка победителя этого этапа.
          </p>
        )}
      </div>
    </section>
  );
}

function FantasyPredictionCard({
  predictionState,
  userSignedIn,
}: {
  predictionState: PredictionState;
  userSignedIn: boolean;
}) {
  const current = predictionState.current;
  const driversById = new Map(
    predictionState.drivers.map((driver) => [driver.id, driver.name]),
  );
  const picks = [
    { label: "Победитель", value: current?.winnerDriverId },
    { label: "Поул", value: current?.poleDriverId },
    { label: "Лучший круг", value: current?.fastestLapDriverId },
    { label: "Первый сход", value: current?.dnfDriverId },
  ].map((pick) => ({
    label: pick.label,
    value: pick.value ? driversById.get(pick.value) ?? "Пилот выбран" : "—",
  }));

  return (
    <section className="order-3 stitch-panel overflow-hidden p-0 xl:order-4">
      <PanelHeader
        action={
          <span
            className={cn(
              "font-telemetry shrink-0 rounded border px-2 py-1 text-[0.6rem] font-extrabold uppercase tracking-[0.08em]",
              current
                ? "border-[rgba(57,255,20,0.4)] bg-[rgba(57,255,20,0.1)] text-[rgb(97,255,75)]"
                : "border-amber-300/50 bg-amber-400/10 text-amber-300",
            )}
      >
            {current ? "Сделан" : "Нет"}
          </span>
        }
        icon={Target}
        meta="Фэнтези-пики на этот гран-при"
        title="Прогноз на этап"
      />
      <div className="grid gap-4 p-4">
        {current ? (
          <div className="grid gap-1.5">
            {picks.map((pick) => (
              <div
                className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-background/30 px-3 py-2 text-sm"
                key={pick.label}
              >
                <span className="font-semibold text-muted-foreground">{pick.label}</span>
                <span className="min-w-0 truncate text-right font-bold">{pick.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            Собери прогноз до блокировки и сравни его с друзьями после финиша.
          </p>
        )}
        <Button asChild className="w-full" variant={current ? "secondary" : "default"}>
          <Link href={userSignedIn ? "/fantasy" : "/auth"}>
            {userSignedIn
              ? current
                ? "Изменить прогноз"
                : "Сделать прогноз"
              : "Войти, чтобы сохранить"}
          </Link>
        </Button>
      </div>
    </section>
  );
}
