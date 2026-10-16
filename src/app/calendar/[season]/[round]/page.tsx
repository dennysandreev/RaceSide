import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Clock3,
  Flag,
  MapPin,
  Newspaper,
  Ruler,
  type LucideIcon,
} from "lucide-react";
import { cache, type ReactNode } from "react";

import { AppShell } from "@/components/racemate/app-shell";
import { CircuitStatsSection } from "@/components/racemate/circuit-stats-section";
import { RaceSessionResultsPanel } from "@/components/racemate/race-session-results-panel";
import { TrackMap } from "@/components/racemate/track-map";
import { GrandPrixReportDialog } from "@/components/racemate/grand-prix-report-dialog";
import { GrandPrixPodiumPreview } from "@/components/racemate/grand-prix-podium-preview";
import { getGrandPrixReportAnalytics } from "@/data/grand-prix-report-analytics";
import { JsonLd } from "@/components/racemate/json-ld";
import { Badge } from "@/components/ui/badge";
import {
  getCircuitStatsForRace,
  getRaceDetail,
  getDriverSlugMap,
  getRaceGrandPrixReport,
  getGrandPrixReportBySlug,
  getPublishedSeasons,
  getRaceNews,
  getRaceReplaySummaryByRaceId,
  getRaceSessions,
  getSessionResultsBySessionIds,
} from "@/data/racemate-repository";
import { CURRENT_F1_SEASON } from "@/lib/season-navigation";
import { absoluteUrl, createPageMetadata, SITE_URL } from "@/lib/seo";
import { cn } from "@/lib/utils";
import type { GrandPrixReport } from "@/types/racemate";

export const dynamic = "force-dynamic";

type RaceCalendarPageProps = {
  params: Promise<{ season: string; round: string }>;
  searchParams: Promise<{ session?: string; raceReport?: string }>;
};

const getCachedRaceDetail = cache(getRaceDetail);

export async function generateMetadata({
  params,
}: RaceCalendarPageProps): Promise<Metadata> {
  const { season, round } = await params;

  if (!/^\d{4}$/.test(season) || !/^[1-9]\d*$/.test(round)) {
    return createPageMetadata({
      description: "Этап не найден в календаре RaceSide.",
      noIndex: true,
      path: `/calendar/${season}/${round}`,
      title: "Этап не найден",
    });
  }

  const race = await getCachedRaceDetail(Number(season), Number(round));

  if (!race) {
    return createPageMetadata({
      description: "Этап не найден в опубликованном календаре RaceSide.",
      noIndex: true,
      path: `/calendar/${season}/${round}`,
      title: "Этап не найден",
    });
  }

  return createPageMetadata({
    description: `${race.race} ${race.season}: расписание сессий, результаты, статистика трассы ${race.circuit} и материалы этапа.`,
    image: race.trackMapUrl,
    path: `/calendar/${race.season}/${race.round}`,
    title: `${race.race} ${race.season}: расписание и результаты`,
  });
}

export default async function RaceCalendarPage({
  params,
  searchParams,
}: RaceCalendarPageProps) {
  const [{ season, round }, query] = await Promise.all([params, searchParams]);
  if (!/^\d{4}$/.test(season) || !/^[1-9]\d*$/.test(round)) {
    notFound();
  }

  const seasonYear = Number(season);
  const raceRound = Number(round);

  const publishedSeasons = await getPublishedSeasons();

  if (!publishedSeasons.includes(seasonYear)) {
    notFound();
  }

  const race = await getCachedRaceDetail(seasonYear, raceRound);

  if (!race) {
    notFound();
  }

  const isCurrentSeason = seasonYear === CURRENT_F1_SEASON;
  const [sessions, driverSlugByName, circuitStats] = await Promise.all([
    getRaceSessions(seasonYear, raceRound),
    isCurrentSeason ? getDriverSlugMap() : Promise.resolve({}),
    getCircuitStatsForRace(seasonYear, raceRound),
  ]);
  const [raceNews, raceReport, queryReport, raceReplay] = isCurrentSeason
    ? await Promise.all([
        getRaceNews(race.id, 5),
        getRaceGrandPrixReport(seasonYear, raceRound),
        getGrandPrixReportBySlug(query.raceReport),
        race.status === "Завершен"
          ? getRaceReplaySummaryByRaceId(race.id, CURRENT_F1_SEASON)
          : Promise.resolve(null),
      ])
    : [[], null, null, null] as const;
  const resultsBySession = await getSessionResultsBySessionIds(
    sessions.map((session) => session.id),
    seasonYear,
  );
  const defaultSession = race.status === "Завершен"
    ? sessions.find((session) => session.type === "race" || session.name.toLowerCase().includes("гонка")) ?? sessions[0]
    : sessions[0];
  const selectedSession = sessions.find((session) => session.id === query.session) ?? defaultSession;
  const sessionsWithResults = sessions.map((session) => ({
    results: session.id ? resultsBySession.get(session.id) ?? [] : [],
    session,
  }));
  const dialogReport = queryReport ?? raceReport;
  const isReportOpen = Boolean(query.raceReport && dialogReport?.raceSlug === query.raceReport);
  const reportAnalytics = isReportOpen && dialogReport
    ? await getGrandPrixReportAnalytics(dialogReport)
    : null;
  const overviewReport = race.status === "Завершен" ? raceReport : null;
  const calendarHref = isCurrentSeason ? "/calendar" : `/calendar?season=${seasonYear}`;
  const raceTitleLength = Array.from(race.race).length;
  const raceTitleSizeClass = raceTitleLength > 32
    ? "text-[1.55rem] sm:text-[1.85rem] lg:text-[1.95rem]"
    : raceTitleLength > 22
      ? "text-[1.7rem] sm:text-[2rem] lg:text-[2.15rem]"
      : "text-3xl sm:text-4xl lg:text-[2.55rem]";

  return (
    <AppShell>
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
                item: absoluteUrl(
                  seasonYear === CURRENT_F1_SEASON
                    ? "/calendar"
                    : `/calendar?season=${seasonYear}`,
                ),
                name: `Календарь ${seasonYear}`,
                position: 2,
              },
              {
                "@type": "ListItem",
                item: absoluteUrl(`/calendar/${seasonYear}/${raceRound}`),
                name: race.race,
                position: 3,
              },
            ],
          },
          {
            "@context": "https://schema.org",
            "@id": `${absoluteUrl(`/calendar/${seasonYear}/${raceRound}`)}#event`,
            "@type": "SportsEvent",
            description: `${race.race}, сезон Формулы-1 ${seasonYear}, раунд ${raceRound}.`,
            eventStatus: race.status === "Завершен"
              ? "https://schema.org/EventCompleted"
              : "https://schema.org/EventScheduled",
            image: race.trackMapUrl ? absoluteUrl(race.trackMapUrl) : undefined,
            inLanguage: "ru-RU",
            location: {
              "@type": "Place",
              address: {
                "@type": "PostalAddress",
                addressCountry: race.country,
                addressLocality: race.locality,
              },
              name: race.circuit,
            },
            name: `${race.race} ${seasonYear}`,
            startDate: race.startsAtIso,
            url: absoluteUrl(`/calendar/${seasonYear}/${raceRound}`),
          },
        ]}
      />
      <article className="grid gap-5 pb-8">
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-2.5 sm:px-5">
            <nav aria-label="Навигация по календарю" className="min-w-0">
              <ol className="flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold text-muted-foreground">
                <li>
                  <Link
                    className="rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={calendarHref}
                  >
                    Календарь
                  </Link>
                </li>
                <li aria-hidden="true">
                  <ChevronRight className="size-3.5" />
                </li>
                <li className="font-telemetry">Сезон {seasonYear}</li>
                <li aria-hidden="true">
                  <ChevronRight className="size-3.5" />
                </li>
                <li className="font-telemetry text-foreground">Раунд {raceRound}</li>
              </ol>
            </nav>
            <div className="hidden items-center justify-end gap-2 sm:flex">
              <Badge variant={getRaceStatusVariant(race.status)}>{race.status}</Badge>
            </div>
          </div>

          <div className="grid xl:grid-cols-[23rem_minmax(0,1fr)]">
            <div
              className={cn(
                "flex min-w-0 flex-col justify-between",
                overviewReport ? "xl:min-h-[29rem]" : "xl:min-h-[27rem]",
                overviewReport ? "p-4 sm:p-5" : "p-5 sm:p-7",
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground">
                    <MapPin aria-hidden="true" className="size-4 shrink-0 text-primary" />
                    <span className="truncate">{race.locality}, {race.country}</span>
                  </div>
                  <Badge className="shrink-0 sm:hidden" variant={getRaceStatusVariant(race.status)}>
                    {race.status}
                  </Badge>
                </div>
                <h1
                  className={cn(
                    "max-w-4xl text-balance font-display font-extrabold leading-[1.04]",
                    overviewReport ? "mt-3" : "mt-4",
                    raceTitleSizeClass,
                  )}
                >
                  {race.race}
                </h1>
                <p className={cn("text-pretty text-base leading-6 text-muted-foreground", overviewReport ? "mt-2" : "mt-4")}>
                  {race.circuit}
                </p>
              </div>

              {overviewReport ? (
                <RaceReportPreview
                  compact
                  driverSlugByName={driverSlugByName}
                  href={`/calendar/${seasonYear}/${raceRound}?raceReport=${overviewReport.raceSlug}`}
                  replay={raceReplay}
                  report={overviewReport}
                />
              ) : (
                <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 xl:grid-cols-1">
                  <RaceOverviewMetric icon={CalendarDays} label="Старт гонки" value={race.startsAt} />
                  <RaceOverviewMetric
                    icon={Ruler}
                    label="Длина трассы"
                    value={formatTrackLength(circuitStats)}
                  />
                  <RaceOverviewMetric icon={Flag} label="Круги" value={formatRaceLaps(circuitStats)} />
                </div>
              )}
            </div>

            <div className="min-h-[19rem] border-t border-border bg-card p-3 sm:min-h-[23rem] sm:p-4 xl:min-h-[27rem] xl:border-l xl:border-t-0">
              <TrackMap
                assetSrc={race.trackMapUrl ?? (isCurrentSeason ? undefined : null)}
                circuit={race.circuit}
                className="min-h-[17.5rem] sm:min-h-[21rem] xl:min-h-[25rem]"
                fill
                label={race.country}
                layout={race.layout}
                modelTogglePlacement="mobile-bottom"
                showModel3d={isCurrentSeason}
                toolbarLeading={(
                  <CircuitStatsSection
                    buttonSize="sm"
                    circuitName={race.circuit}
                    className="w-auto"
                    mode="button"
                    stats={circuitStats}
                  />
                )}
                unframed
              />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-start">
          <div className="contents xl:grid xl:min-w-0 xl:gap-5">
            <section className="order-1 min-w-0 overflow-hidden rounded-xl border border-border bg-card xl:order-none">
              <SectionTitle icon={Clock3}>Сессии и результаты</SectionTitle>
              <div className="p-4 sm:p-5">
                <RaceSessionResultsPanel
                  includeWeather={isCurrentSeason}
                  initialSessionId={selectedSession?.id}
                  season={seasonYear}
                  sessions={sessionsWithResults}
                />
              </div>
            </section>
          </div>

          <aside className="contents xl:grid xl:content-start xl:gap-5">
            {raceReport && !overviewReport ? (
              <section className="order-2 overflow-hidden rounded-xl border border-border bg-card xl:order-none">
                <SectionTitle icon={Flag}>Итоги этапа</SectionTitle>
                <RaceReportPreview
                  driverSlugByName={driverSlugByName}
                  href={`/calendar/${seasonYear}/${raceRound}?raceReport=${raceReport.raceSlug}`}
                  replay={raceReplay}
                  report={raceReport}
                />
              </section>
            ) : null}

            {isCurrentSeason ? (
              <div className="order-3 xl:order-none">
                <RaceNewsSection
                  allHref={`/news?race=${seasonYear}-${raceRound}`}
                  compact
                  items={raceNews}
                />
              </div>
            ) : null}
          </aside>
        </section>
      </article>
      {isCurrentSeason ? (
        <GrandPrixReportDialog analytics={reportAnalytics} driverSlugByName={driverSlugByName} open={isReportOpen} report={dialogReport} />
      ) : null}
    </AppShell>
  );
}

function getRaceStatusVariant(status: string): "success" | "danger" | "warning" {
  if (status === "Завершен") {
    return "success";
  }

  if (status === "Текущий этап") {
    return "danger";
  }

  return "warning";
}

function formatTrackLength(
  stats: Awaited<ReturnType<typeof getCircuitStatsForRace>>,
) {
  const length = stats?.circuit.lapLengthKm;

  return length === null || length === undefined ? "Уточняется" : `${length.toFixed(3)} км`;
}

function formatRaceLaps(
  stats: Awaited<ReturnType<typeof getCircuitStatsForRace>>,
) {
  const laps = stats?.circuit.raceLaps;

  return laps === null || laps === undefined ? "Уточняется" : `${laps} кругов`;
}

function RaceNewsSection({
  allHref,
  compact = false,
  items,
}: {
  allHref: string;
  compact?: boolean;
  items: Readonly<Awaited<ReturnType<typeof getRaceNews>>>;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <SectionTitle
        action={(
          <Link
            className="group/action inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={allHref}
          >
            Все новости
            <ArrowRight
              aria-hidden="true"
              className="size-3.5 transition-transform group-hover/action:translate-x-0.5"
            />
          </Link>
        )}
        icon={Newspaper}
      >
        Новости этапа
      </SectionTitle>
      {items.length ? (
        <div className={cn("grid gap-px bg-border", !compact && "md:grid-cols-2")}>
          {items.map((item, index) => (
            <Link
              className={cn(
                "group bg-card p-5 transition-colors hover:bg-accent/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                !compact && "sm:p-6",
                !compact && index === 0 && "md:col-span-2",
              )}
              href={`/news/${item.slug}`}
              key={item.slug}
            >
              <Badge variant="secondary">{item.source}</Badge>
              <h3
                className={cn(
                  "mt-3 text-balance font-display font-bold leading-tight transition-colors group-hover:text-primary",
                  !compact && index === 0 ? "max-w-4xl text-2xl sm:text-3xl" : "text-base",
                )}
              >
                {item.title}
              </h3>
              <p
                className={cn(
                  "mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground",
                  !compact && index === 0 && "max-w-4xl sm:text-base sm:leading-7",
                )}
              >
                {item.summary}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="p-5 text-sm leading-6 text-muted-foreground">
          Свежих новостей об этом этапе пока нет.
        </div>
      )}
    </section>
  );
}

function RaceOverviewMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 bg-card px-4 py-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        <p className="text-xs font-semibold">{label}</p>
      </div>
      <p className="mt-2 break-words font-telemetry text-sm font-bold leading-5 text-foreground">
        {value}
      </p>
    </div>
  );
}

function SectionTitle({
  action,
  children,
  icon: Icon,
}: {
  action?: ReactNode;
  children: ReactNode;
  icon: LucideIcon;
}) {
  return (
    <div className="flex h-14 items-center justify-between gap-3 border-b border-border/70 px-4 py-2 sm:px-5 sm:py-2">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <h2 className="truncate font-display text-base font-bold leading-none tracking-[-0.02em]">
          {children}
        </h2>
      </div>
      {action}
    </div>
  );
}

function RaceReportPreview({
  compact = false,
  driverSlugByName,
  href,
  replay,
  report,
}: {
  compact?: boolean;
  driverSlugByName: Record<string, string>;
  href: string;
  replay: Awaited<ReturnType<typeof getRaceReplaySummaryByRaceId>>;
  report: GrandPrixReport;
}) {
  return (
    <GrandPrixPodiumPreview
      className={compact ? "mt-5" : "p-5 sm:p-6"}
      compact={compact}
      compactShareAction={compact}
      driverSlugByName={driverSlugByName}
      href={href}
      replay={replay}
      report={report}
      showRaceHeading={false}
    />
  );
}
