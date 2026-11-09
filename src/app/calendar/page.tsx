import { Suspense } from "react";
import Image from "next/image";
import { IntentLink as Link } from "@/components/racemate/intent-link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarDays, Trophy, Zap } from "lucide-react";

import { PublicPageSkeleton } from "@/components/racemate/public-page-loading";
import { AppShell } from "@/components/racemate/app-shell";
import { JsonLd } from "@/components/racemate/json-ld";
import { PageTitle } from "@/components/racemate/page-title";
import { RaceFlag } from "@/components/racemate/race-flag";
import { SeasonProgress } from "@/components/racemate/season-progress";
import { SeasonSwitcher } from "@/components/racemate/season-switcher";
import { StitchStatusBadge } from "@/components/racemate/stitch-primitives";
import { Badge } from "@/components/ui/badge";
import { getCircuitAsset } from "@/data/f1-assets";
import { getCalendarEvents, getPublishedSeasons } from "@/data/racemate-repository";
import {
  CURRENT_F1_SEASON,
  resolvePublishedSeason,
  shouldMuteCalendarRaceMap,
  type SeasonSearchParams,
} from "@/lib/season-navigation";
import { absoluteUrl, buildSeasonPath, createPageMetadata } from "@/lib/seo";
import { withServerTtlCache } from "@/lib/server-ttl-cache";
import { versionedCircuitAsset } from "@/lib/versioned-public-asset";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/types/racemate";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SeasonSearchParams>;
}): Promise<Metadata> {
  const query = await searchParams;
  const publishedSeasons = await getPublishedSeasons();
  const season = resolvePublishedSeason(query.season, publishedSeasons);

  if (!season) {
    return createPageMetadata({
      description: "Запрошенный сезон пока недоступен в архиве RaceSide.",
      noIndex: true,
      path: "/calendar",
      title: "Сезон не найден",
    });
  }

  return createPageMetadata({
    description: `Календарь Формулы-1 ${season}: даты Гран-при, трассы, расписание этапов, статусы и результаты завершенных гонок.`,
    path: buildSeasonPath("/calendar", season, CURRENT_F1_SEASON),
    title: `Календарь Формулы-1 ${season}`,
  });
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<SeasonSearchParams>;
}) {
  const query = await searchParams;
  const publishedSeasons = await getPublishedSeasons();
  const season = resolvePublishedSeason(query.season, publishedSeasons);

  if (!season) {
    notFound();
  }

  return (
    <AppShell>
      <Suspense fallback={<PublicPageSkeleton label="Календарь загружается" variant="cards" />}>
        <CalendarContent query={query} season={season} publishedSeasons={publishedSeasons} />
      </Suspense>
    </AppShell>
  );
}

async function CalendarContent({ query, season, publishedSeasons }: {
  query: SeasonSearchParams; season: number; publishedSeasons: number[];
}) {
  const calendarEvents = await withServerTtlCache(
    `public:calendar:${season}`,
    season === CURRENT_F1_SEASON ? 30_000 : 5 * 60_000,
    () => getCalendarEvents(season),
    { staleWhileRevalidateMs: season === CURRENT_F1_SEASON ? 5 * 60_000 : 30 * 60_000 },
  );
  const completedCount = calendarEvents.filter((event) => event.status === "Завершен").length;
  const nextRace = calendarEvents.find((event) => event.status !== "Завершен") ?? null;

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          hasPart: {
            "@type": "ItemList",
            itemListElement: calendarEvents.map((event, index) => ({
              "@type": "ListItem",
              item: absoluteUrl(`/calendar/${event.season}/${event.round}`),
              name: event.race,
              position: index + 1,
            })),
          },
          inLanguage: "ru-RU",
          name: `Календарь Формулы-1 ${season}`,
          url: absoluteUrl(buildSeasonPath("/calendar", season, CURRENT_F1_SEASON)),
        }}
      />
      <section className="relative overflow-hidden rounded-xl border border-border bg-card lg:h-40">
        <CalendarHero
          completedCount={completedCount}
          nextRace={nextRace}
          publishedSeasons={publishedSeasons}
          query={query}
          season={season}
          totalCount={calendarEvents.length}
        />
      </section>

      <section className="grid gap-5 pb-8 pt-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {calendarEvents.map((event) => (
            <CalendarRaceCard event={event} key={`${event.season}-${event.round}`} />
          ))}
        </div>
      </section>
    </>
  );
}

function CalendarHero({
  completedCount,
  nextRace,
  publishedSeasons,
  query,
  season,
  totalCount,
}: {
  completedCount: number;
  nextRace: CalendarEvent | null;
  publishedSeasons: number[];
  query: SeasonSearchParams;
  season: number;
  totalCount: number;
}) {
  return (
    <div className="relative min-h-[13rem] p-4 sm:p-5 lg:h-full lg:min-h-0">
      <Image
        alt=""
        className="object-cover opacity-80"
        fill
        priority
        sizes="(max-width: 768px) 100vw, 72rem"
        src="/stitch/calendar-season-hero-v2.webp"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-background/35" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgb(225_6_0_/_0.28),transparent_20rem)]" />
      <div className="relative z-10 grid min-h-[11rem] gap-5 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center">
        <div className="self-center">
          <p className="stitch-label flex items-center gap-2 text-primary">
            <CalendarDays aria-hidden="true" className="size-3.5" />
            Календарь · сезон {season}
          </p>
          <PageTitle className="mt-2 max-w-4xl">
            Календарь Формулы-1
          </PageTitle>
          <SeasonSwitcher
            activeSeason={season}
            className="mt-3"
            pathname="/calendar"
            query={query}
            seasons={publishedSeasons}
          />
        </div>

        <SeasonProgress
          className="lg:w-[22rem]"
          completedCount={completedCount}
          nextRace={nextRace}
          season={season}
          totalCount={totalCount}
        />
      </div>
    </div>
  );
}

async function CalendarRaceCard({ event }: { event: CalendarEvent }) {
  const isCurrentSeason = event.season === CURRENT_F1_SEASON;
  const href = event.status === "Текущий этап" && isCurrentSeason ? "/weekend" : event.href;
  const legacyAsset = isCurrentSeason ? getCircuitAsset(event.circuit || event.country) : null;
  const assetSrc = event.trackMapUrl ?? legacyAsset?.src ?? null;
  const isCurrent = event.status === "Текущий этап" && isCurrentSeason;
  const isCompleted = event.status === "Завершен";
  const isMapMuted = shouldMuteCalendarRaceMap(event.season, event.status);

  return (
    <Link
      className={cn(
        "group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-transform duration-300 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isCurrent && "border-primary/70 bg-primary/10",
      )}
      href={href}
    >
      <div className="relative h-[8.5rem] shrink-0 bg-surface-muted">
        {assetSrc ? (
          <Image
            alt={`Схема трассы ${event.circuit}`}
            className={cn(
              "object-contain px-4 pb-3 pt-11 transition-all duration-500 group-hover:scale-105",
              isMapMuted && "grayscale group-hover:grayscale-0",
            )}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 20rem"
            src={await versionedCircuitAsset(assetSrc)}
          />
        ) : (
          <div className="grid h-full place-items-center font-telemetry text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">
            Схема появится после проверки
          </div>
        )}
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-sm border border-border bg-background/80 px-2 py-1 backdrop-blur">
          <RaceFlag countryCode={event.countryCode} label={event.country} value={event.countryFlag} />
          <span className="font-telemetry text-[0.65rem] font-bold uppercase tracking-[0.1em]">
            Раунд {event.round}
          </span>
        </div>
        {event.hasSprint ? (
          <Badge
            className="absolute right-3 top-3 gap-1.5 bg-background/90 backdrop-blur"
            variant="warning"
          >
            <Zap aria-hidden="true" className="size-3" />
            Спринт
          </Badge>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div>
          <p className="font-telemetry text-[0.68rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            {event.date}
          </p>
          <h3 className="mt-2 text-balance font-display text-base font-bold leading-tight">
            {event.race}
          </h3>
          <p className="mt-1.5 line-clamp-1 text-sm text-muted-foreground">
            {event.circuit}, {event.country}
          </p>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <StitchStatusBadge tone={isCurrent ? "red" : isCompleted ? "live" : "warning"}>
            {event.status}
          </StitchStatusBadge>
          {isCompleted && event.winner ? (
            <span className="flex min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground">
              <Trophy aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{event.winner}</span>
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
