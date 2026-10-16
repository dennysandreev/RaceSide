import { IntentLink as Link } from "@/components/racemate/intent-link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Newspaper,
  Trophy,
  ArrowRight,
} from "lucide-react";

import { AppShell } from "@/components/racemate/app-shell";
import { GrandPrixReportDialog } from "@/components/racemate/grand-prix-report-dialog";
import { GrandPrixPodiumPreview } from "@/components/racemate/grand-prix-podium-preview";
import {
  HomeSidebarCarousels,
  HomeStandingsCarousel,
  type HomeMarketSlide,
  type HomeStandingSlide,
} from "@/components/racemate/home-sidebar-carousels";
import { NewsImage } from "@/components/racemate/news-image";
import { NewsTagBadge } from "@/components/racemate/news-tag-badge";
import { SeasonGlobeExplorer } from "@/components/racemate/season-globe/season-globe-explorer";
import type { SessionWithResults } from "@/components/racemate/session-results-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCircuitAsset, getTeamAssetForMarketOutcome, getTeamProfileAsset } from "@/data/f1-assets";
import { getGrandPrixReportAnalytics } from "@/data/grand-prix-report-analytics";
import {
  getConstructorChampionshipMatrix,
  getConstructorChampionOdds,
  getCurrentRaceDetail,
  getDriverChampionshipMatrix,
  getDriverSlugMap,
  getGrandPrixReportBySlug,
  getLatestGrandPrixReport,
  getNewsItems,
  getNextSession,
  getPolls,
  getSeasonGlobeData,
  getSessionResultsBySessionIds,
  getSeasonChampionOdds,
  getWeekendSessions,
} from "@/data/racemate-repository";
import type {
  GrandPrixReport,
  NextSession,
  NewsItem,
  RaceDetail,
  StandingRow,
} from "@/types/racemate";
import { normalizeAuthNext } from "@/lib/auth-redirect";
import { getSessionUser } from "@/lib/auth";
import { CURRENT_F1_SEASON } from "@/lib/season-navigation";
import { withServerTtlCache } from "@/lib/server-ttl-cache";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; next?: string; raceReport?: string }>;
}) {
  const query = await searchParams;

  if (query.code) {
    const callbackParams = new URLSearchParams({
      code: query.code,
      next: normalizeAuthNext(query.next),
    });

    redirect(`/auth/callback?${callbackParams.toString()}`);
  }

  return (
    <AppShell>
      <header className="sr-only">
        <h1>RaceSide - Формула-1 на русском</h1>
        <p>
          Новости, календарь, результаты и статистика чемпионата Формулы-1.
        </p>
      </header>
      <section className="grid grid-cols-[minmax(0,1fr)] gap-5 pb-5 xl:grid-cols-[minmax(0,1fr)_22.5rem] xl:items-start">
        <div className="contents xl:grid xl:min-w-0 xl:gap-5">
          <div className="order-1 xl:order-none">
            <Suspense fallback={<Skeleton className="h-[38rem] w-full" />}>
              <HomeRacePanel />
            </Suspense>
          </div>
          <div className="order-5 xl:order-none">
            <Suspense fallback={<Skeleton className="h-96 w-full" />}><HomeNewsPanel /></Suspense>
          </div>
        </div>

        <aside className="contents xl:grid xl:gap-5">
          <div className="order-2 xl:order-none">
            <Suspense fallback={<Skeleton className="h-72 w-full" />}><HomeReportPanel /></Suspense>
          </div>
          <div className="order-3 xl:order-none">
            <Suspense fallback={<Skeleton className="h-80 w-full" />}><HomeStandingsPanel /></Suspense>
          </div>
          <div className="order-4 grid gap-5 xl:order-none">
            <Suspense fallback={<Skeleton className="h-[36rem] w-full" />}><HomeMarketsPanel /></Suspense>
          </div>
        </aside>
      </section>
      <Suspense fallback={null}><HomeReportDialog slug={query.raceReport} /></Suspense>
    </AppShell>
  );
}

async function HomeRacePanel() {
  const { currentRace, nextSession, seasonGlobeData, sessionResults } = await withServerTtlCache(
    "public:home:race", 15_000, getHomePagePublicData, { staleWhileRevalidateMs: 5 * 60_000 },
  );
  return <CurrentRaceCard currentRace={currentRace} nextSession={nextSession} seasonGlobeData={seasonGlobeData} sessions={sessionResults} />;
}

async function HomeNewsPanel() {
  const result = await withServerTtlCache("public:home:news", 30_000,
    () => getNewsItems({ includeTotal: false, pageSize: 7 }), { staleWhileRevalidateMs: 5 * 60_000 });
  return <NewsCard items={result.items} />;
}

function getHomeStandings() {
  return withServerTtlCache("public:home:standings:v2", 60_000,
    async () => {
      const [drivers, constructors] = await Promise.all([
        getDriverChampionshipMatrix(CURRENT_F1_SEASON),
        getConstructorChampionshipMatrix(CURRENT_F1_SEASON),
      ]);

      return [
        drivers.rows.map((row) => ({ ...row, points: row.total })),
        constructors.rows,
      ] as const;
    },
    { staleWhileRevalidateMs: 5 * 60_000 });
}

function getHomeDriverSlugs() {
  return withServerTtlCache("public:home:driver-slugs", 5 * 60_000, getDriverSlugMap);
}

async function HomeReportPanel() {
  const [latestReport, driverSlugByName] = await Promise.all([
    withServerTtlCache("public:home:report", 60_000, getLatestGrandPrixReport, { staleWhileRevalidateMs: 5 * 60_000 }),
    getHomeDriverSlugs(),
  ]);
  return <LatestReportCard driverSlugByName={driverSlugByName} report={latestReport} />;
}

async function HomeReportDialog({ slug }: { slug?: string }) {
  if (!slug) return null;
  const [report, driverSlugByName] = await Promise.all([getGrandPrixReportBySlug(slug), getHomeDriverSlugs()]);
  const analytics = report?.raceSlug === slug ? await getGrandPrixReportAnalytics(report) : null;
  return <GrandPrixReportDialog analytics={analytics} driverSlugByName={driverSlugByName} open={report?.raceSlug === slug} report={report} />;
}

async function HomeStandingsPanel() {
  const [standings, constructorStandings] = await getHomeStandings();
  const standingSlides: HomeStandingSlide[] = [
    {
      actionHref: "/leaderboard",
      actionLabel: "Подробнее",
      id: "drivers",
      rows: standings.slice(0, 6).map((row) => ({
        avatarUrl: row.avatarUrl,
        color: row.teamColor,
        driverSlug: row.driverSlug,
        href: row.driverSlug ? `/drivers/${row.driverSlug}` : undefined,
        meta: row.team,
        name: row.driverSlug === "andrea-kimi-antonelli" ? "Andrea K Antonelli" : row.driver,
        points: row.points,
        position: row.position,
      })),
      title: "Личный зачет",
    },
    {
      actionHref: "/leaderboard?table=constructors",
      actionLabel: "Подробнее",
      id: "constructors",
      rows: constructorStandings.slice(0, 6).map((row) => {
        const profile = getTeamProfileAsset(row.teamCode) ?? getTeamProfileAsset(row.team);

        return {
          color: row.teamColor,
          href: profile ? `/teams/${profile.slug}` : undefined,
          meta: row.wins ? `${row.wins} побед` : "Побед пока нет",
          name: row.team,
          points: row.points,
          position: row.position,
          teamCode: row.teamCode,
          teamLogo: row.teamLogo,
        };
      }),
      title: "Кубок конструкторов",
    },
  ];

  return <HomeStandingsCarousel slides={standingSlides} />;
}

async function HomeMarketsPanel() {
  const [[championOdds, constructorOdds], [standings], polls] = await Promise.all([
    withServerTtlCache("public:home:markets", 60_000,
      () => Promise.all([getSeasonChampionOdds(), getConstructorChampionOdds()]), { staleWhileRevalidateMs: 5 * 60_000 }),
    getHomeStandings(),
    getSessionUser().then((user) => getPolls({ userId: user?.id })),
  ]);
  const marketSlides: HomeMarketSlide[] = [
    buildMarketSlide({
      emptyText: "На Polymarket пока нет рынка чемпионства сезона.",
      id: "drivers",
      odds: championOdds,
      standings,
      title: "Шансы на титул",
    }),
    buildMarketSlide({
      emptyText: "На Polymarket пока нет рынка Кубка конструкторов.",
      id: "constructors",
      odds: constructorOdds,
      standings,
      title: "Шансы конструкторов",
    }),
  ];
  return <HomeSidebarCarousels marketSlides={marketSlides} polls={polls} />;
}

async function getHomePagePublicData() {
  const weekendSessionsPromise = getWeekendSessions();
  const sessionResultsPromise = weekendSessionsPromise.then(async (sessions) => {
    const visibleSessions = sessions.slice(0, 5);
    const resultsBySession = await getSessionResultsBySessionIds(
      visibleSessions.map((session) => session.id),
      CURRENT_F1_SEASON,
    );

    return visibleSessions.map((session) => ({
      results: session.id ? resultsBySession.get(session.id) ?? [] : [],
      session,
    }));
  });
  const [nextSession, currentRace, seasonGlobeData, sessionResults] = await Promise.all([
    getNextSession(),
    getCurrentRaceDetail(),
    getSeasonGlobeData(CURRENT_F1_SEASON),
    sessionResultsPromise,
  ]);

  return { currentRace, nextSession, seasonGlobeData, sessionResults };
}

function CurrentRaceCard({
  currentRace,
  nextSession,
  seasonGlobeData,
  sessions,
}: {
  currentRace: RaceDetail | null;
  nextSession: NextSession;
  seasonGlobeData: Awaited<ReturnType<typeof getSeasonGlobeData>>;
  sessions: SessionWithResults[];
}) {
  return (
    <section className="home-season-hero min-w-0" aria-labelledby="next-race-title">
      <SeasonGlobeExplorer
        currentRace={currentRace}
        data={seasonGlobeData}
        fallbackTrack={{
          assetSrc: currentRace?.trackMapUrl ?? getCircuitAsset(nextSession.circuit)?.src ?? null,
          circuit: nextSession.circuit,
          layout: currentRace?.layout ?? null,
        }}
        initialSessions={sessions}
        initialSessionsRound={currentRace?.round ?? seasonGlobeData.nextRound}
        nextSession={nextSession}
      />
    </section>
  );
}

function NewsCard({ items }: { items: NewsItem[] }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="h-14 justify-center border-b border-border/70 px-4 py-2 sm:px-5 sm:py-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Newspaper aria-hidden="true" className="size-4" />
          </span>
          Свежие новости
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {items.length ? (
          <div className="divide-y divide-border/70">
            {items.map((item) => (
              <Link
                className="group grid min-w-0 grid-cols-[minmax(0,1fr)_5.25rem] gap-x-3 gap-y-2.5 p-4 transition-colors hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_8rem] sm:gap-x-5 sm:p-5"
                href={`/news/${item.slug}`}
                key={item.slug}
              >
                <div className="col-span-2 min-w-0">
                  <NewsMeta item={item} />
                </div>
                <h2 className="col-span-2 min-w-0 text-base font-semibold leading-6 transition-colors group-hover:text-primary sm:text-lg">
                  {item.title}
                </h2>
                <p className="line-clamp-3 min-w-0 self-center text-sm leading-6 text-muted-foreground sm:line-clamp-4">
                  {item.summary}
                </p>
                {item.imageUrl ? (
                  <NewsImage
                    alt={item.title}
                    className="relative aspect-square self-center overflow-hidden rounded-md bg-muted sm:aspect-[4/3]"
                    sizes="(max-width: 639px) 84px, 128px"
                    src={item.imageUrl}
                  />
                ) : (
                  <span className="grid min-h-20 place-items-center border-l border-border/70 text-muted-foreground group-hover:text-primary">
                    <ArrowRight aria-hidden="true" className="size-5 transition-transform group-hover:translate-x-1" />
                  </span>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <p className="px-5 py-7 text-sm text-muted-foreground">
            Свежих новостей пока нет.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function NewsMeta({ item }: { item: NewsItem }) {
  const visibleTag = item.tags.find((tag) => tag.type === "race");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-telemetry text-[0.68rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {item.time}
      </span>
      <Badge variant="outline">{item.source}</Badge>
      {visibleTag ? <NewsTagBadge tag={visibleTag} /> : null}
    </div>
  );
}

function LatestReportCard({
  driverSlugByName,
  report,
}: {
  driverSlugByName: Record<string, string>;
  report: GrandPrixReport | null;
}) {
  const isReady = isGrandPrixReportReady(report);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="h-14 justify-center border-b border-border/70 px-4 py-2 sm:px-5 sm:py-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Trophy aria-hidden="true" className="size-4" />
          </span>
          Отчет прошлого Гран-при
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 sm:pt-4">
        {report && isReady ? (
          <GrandPrixPodiumPreview
            compactShareAction
            driverSlugByName={driverSlugByName}
            href={`/?raceReport=${report.raceSlug}`}
            report={report}
          />
        ) : report ? (
          <div className="rounded-lg border border-border bg-muted/45 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{report.raceName}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {report.circuitName} · {report.raceDate}
                </p>
              </div>
              <Badge variant="warning">Формируется</Badge>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Отчет уже в процессе формирования. Как только соберем классификацию, темп и ключевые события,
              здесь появится полный разбор Гран-при.
            </p>
          </div>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            Отчет появится после завершения гонки и синхронизации результатов.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function isGrandPrixReportReady(report: GrandPrixReport | null) {
  return Boolean(report && (report.status === "ready" || report.status === "partial"));
}

function buildMarketSlide({
  emptyText,
  id,
  odds,
  standings,
  title,
}: {
  emptyText: string;
  id: HomeMarketSlide["id"];
  odds: Awaited<ReturnType<typeof getSeasonChampionOdds>>;
  standings: StandingRow[];
  title: string;
}): HomeMarketSlide {
  return {
    emptyText,
    id,
    title,
    odds: odds
      ? {
          ...odds,
          outcomes: odds.outcomes.map((outcome) => ({
            ...outcome,
            color: getTeamAssetForMarketOutcome(outcome.name, standings)?.color,
          })),
        }
      : null,
  };
}
