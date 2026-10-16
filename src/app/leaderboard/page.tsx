import { Suspense } from "react";
import Image from "next/image";
import { IntentLink as Link } from "@/components/racemate/intent-link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ChevronRight, Trophy } from "lucide-react";

import polymarketMark from "../../../public/brands/polymarket-mark-v2.png";

import { PublicPageSkeleton } from "@/components/racemate/public-page-loading";
import { AppShell } from "@/components/racemate/app-shell";
import { DriverAvatarBadge } from "@/components/racemate/driver-avatar-badge";
import { JsonLd } from "@/components/racemate/json-ld";
import { PageTitle } from "@/components/racemate/page-title";
import { RaceFlag } from "@/components/racemate/race-flag";
import { SeasonProgress } from "@/components/racemate/season-progress";
import { SeasonSwitcher } from "@/components/racemate/season-switcher";
import { SyncedHorizontalScroller } from "@/components/racemate/synced-horizontal-scroller";
import { getTeamProfileAsset } from "@/data/f1-assets";
import { cn } from "@/lib/utils";
import {
  getCalendarEvents,
  getConstructorChampionOdds,
  getConstructorChampionshipMatrix,
  getDriverChampionshipMatrix,
  getPublishedSeasons,
  getSeasonChampionOdds,
} from "@/data/racemate-repository";
import {
  CURRENT_F1_SEASON,
  resolvePublishedSeason,
  type SeasonSearchParams,
} from "@/lib/season-navigation";
import { absoluteUrl, createPageMetadata } from "@/lib/seo";
import { withServerTtlCache } from "@/lib/server-ttl-cache";
import type { ChampionshipRound } from "@/types/racemate";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SeasonSearchParams>;
}): Promise<Metadata> {
  const query = await searchParams;
  const table = Array.isArray(query.table) ? query.table[0] : query.table;
  const activeTable = table === "constructors" ? "constructors" : "drivers";
  const publishedSeasons = await getPublishedSeasons();
  const season = resolvePublishedSeason(query.season, publishedSeasons);

  if (!season) {
    return createPageMetadata({
      description: "Таблица запрошенного сезона пока недоступна.",
      noIndex: true,
      path: "/leaderboard",
      title: "Чемпионат не найден",
    });
  }

  const isConstructors = activeTable === "constructors";

  return createPageMetadata({
    description: isConstructors
      ? `Кубок конструкторов Формулы-1 ${season}: позиции команд, очки, победы и результаты по каждому этапу сезона.`
      : `Личный зачет Формулы-1 ${season}: позиции пилотов, очки, победы, подиумы и результаты по каждому этапу сезона.`,
    path: getLeaderboardPath(season, activeTable),
    title: isConstructors
      ? `Кубок конструкторов Формулы-1 ${season}`
      : `Личный зачет Формулы-1 ${season}`,
  });
}

function getLeaderboardPath(
  season: number,
  table: "constructors" | "drivers",
) {
  const search = new URLSearchParams();

  if (season !== CURRENT_F1_SEASON) {
    search.set("season", String(season));
  }

  if (table === "constructors") {
    search.set("table", "constructors");
  }

  const query = search.toString();
  return query ? `/leaderboard?${query}` : "/leaderboard";
}

type StandingEntry = {
  position: number;
  name: string;
  href?: string;
  driverSlug?: string;
  driverNumber?: number;
  avatarUrl?: string | null;
  subtitle?: string;
  teamName: string;
  teamCode?: string;
  teamLogo?: string;
  teamCarImage?: string;
  teamColor?: string;
  teamHref?: string;
  points: number;
  wins: number;
  podiums: number;
  titleOdds?: string;
  pointsByRound: Record<number, number>;
  positionByRound?: Record<number, number>;
  podiumByRound?: Record<number, "winner" | "second" | "third">;
};

const podiumTone: Record<number, { badge: string; label: string }> = {
  1: { badge: "bg-[#f4c95d] text-[#211a05]", label: "Лидер чемпионата" },
  2: { badge: "bg-[#cbd5e1] text-[#111827]", label: "Второе место" },
  3: { badge: "bg-[#d48a5f] text-[#2a1608]", label: "Третье место" },
};

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<SeasonSearchParams>;
}) {
  const query = await searchParams;
  const table = Array.isArray(query.table) ? query.table[0] : query.table;
  const activeTable = table === "constructors" ? "constructors" : "drivers";
  const publishedSeasons = await getPublishedSeasons();
  const season = resolvePublishedSeason(query.season, publishedSeasons);

  if (!season) {
    notFound();
  }

  return (
    <AppShell leaderboardTable={activeTable}>
      <Suspense fallback={<PublicPageSkeleton label="Таблица загружается" variant="table" />}>
        <LeaderboardContent query={query} season={season} publishedSeasons={publishedSeasons} activeTable={activeTable} />
      </Suspense>
    </AppShell>
  );
}

async function LeaderboardContent({ query, season, publishedSeasons, activeTable }: {
  query: SeasonSearchParams; season: number; publishedSeasons: number[]; activeTable: "drivers" | "constructors";
}) {
  const isCurrentSeason = season === CURRENT_F1_SEASON;
  const [drivers, constructors, calendar, driverOdds, constructorOdds] = await withServerTtlCache(
    `public:leaderboard:${season}`,
    isCurrentSeason ? 60_000 : 5 * 60_000,
    () => Promise.all([
      getDriverChampionshipMatrix(season),
      getConstructorChampionshipMatrix(season),
      getCalendarEvents(season),
      isCurrentSeason ? getSeasonChampionOdds() : Promise.resolve(null),
      isCurrentSeason ? getConstructorChampionOdds() : Promise.resolve(null),
    ]),
    { staleWhileRevalidateMs: isCurrentSeason ? 5 * 60_000 : 30 * 60_000 },
  );

  const rounds = activeTable === "drivers" ? drivers.rounds : constructors.rounds;
  const entries = activeTable === "drivers"
    ? drivers.rows.map((row): StandingEntry => {
        const profileAsset = isCurrentSeason
          ? getTeamProfileAsset(row.teamCode) ?? getTeamProfileAsset(row.team)
          : null;
        const teamSlug = row.teamSlug ?? profileAsset?.slug;

        return {
          avatarUrl: row.avatarUrl,
          driverSlug: row.driverSlug,
          driverNumber: row.driverNumber,
          href: row.driverSlug ? `/drivers/${row.driverSlug}?season=${season}` : undefined,
          name: row.driver,
          podiumByRound: row.podiumByRound,
          podiums: Object.keys(row.podiumByRound).length,
          points: row.total,
          pointsByRound: row.pointsByRound,
          positionByRound: row.positionByRound,
          position: row.position,
          subtitle: row.team,
          titleOdds: findMarketOddsLabel(row.driver, driverOdds?.outcomes),
          teamCode: row.teamCode,
          teamColor: row.teamColor,
          teamHref: teamSlug ? `/teams/${teamSlug}?season=${season}` : undefined,
          teamLogo: row.teamLogo,
          teamName: row.team,
          wins: Object.values(row.podiumByRound).filter((finish) => finish === "winner").length,
        };
      })
    : constructors.rows.map((row): StandingEntry => {
        const profileAsset = isCurrentSeason
          ? getTeamProfileAsset(row.teamCode) ?? getTeamProfileAsset(row.team)
          : null;
        const teamSlug = row.teamSlug ?? profileAsset?.slug;

        return {
          href: teamSlug ? `/teams/${teamSlug}?season=${season}` : undefined,
          name: row.team,
          podiums: 0,
          points: row.points,
          pointsByRound: row.pointsByRound ?? {},
          position: row.position,
          teamCode: row.teamCode,
          teamCarImage: row.carImageUrl ?? profileAsset?.carImageUrl,
          teamColor: row.teamColor,
          teamLogo: row.teamLogo,
          teamName: row.team,
          titleOdds: findMarketOddsLabel(row.team, constructorOdds?.outcomes),
          wins: row.wins,
        };
      });

  const leaderPoints = Math.max(entries[0]?.points ?? 0, 1);
  const roundMaxPoints = buildRoundMaxPoints(rounds, entries);
  const podium = entries.filter((entry) => entry.position >= 1 && entry.position <= 3);
  const seasonRaces = calendar;
  const totalRounds = seasonRaces.length;
  const completedRounds = seasonRaces.filter((event) => event.status === "Завершен").length;
  const nextRace = seasonRaces.find((event) => event.status !== "Завершен") ?? null;

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          hasPart: {
            "@type": "ItemList",
            itemListElement: entries.map((entry) => ({
              "@type": "ListItem",
              item: entry.href ? absoluteUrl(entry.href) : absoluteUrl(getLeaderboardPath(season, activeTable)),
              name: entry.name,
              position: entry.position,
            })),
          },
          inLanguage: "ru-RU",
          name: activeTable === "drivers"
            ? `Личный зачет Формулы-1 ${season}`
            : `Кубок конструкторов Формулы-1 ${season}`,
          url: absoluteUrl(getLeaderboardPath(season, activeTable)),
        }}
      />
      <section className="grid gap-4 pb-6 sm:gap-5 sm:pb-8">
        <section className="stitch-panel relative overflow-hidden p-0 lg:h-40">
          <Image
            alt=""
            className="object-cover object-[center_42%] opacity-95"
            fill
            priority
            sizes="(max-width: 768px) 100vw, 72rem"
            src="/stitch/championship-statistics-hero.png"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background via-background/76 to-background/15" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgb(225_6_0_/_0.25),transparent_22rem)]" />

          <div className="relative z-10 flex flex-col gap-3 p-4 sm:p-5 lg:grid lg:h-full lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center lg:gap-6">
            <div className="order-1 min-w-0 lg:order-none">
              <p className="stitch-label flex items-center gap-2 text-primary">
                <Trophy aria-hidden="true" className="size-3.5" />
                Чемпионат · сезон {season}
              </p>
              <PageTitle className="mt-2">
                {activeTable === "drivers" ? "Личный зачет" : "Кубок конструкторов"}
              </PageTitle>
              <SeasonSwitcher
                activeSeason={season}
                className="mt-3"
                pathname="/leaderboard"
                query={query}
                seasons={publishedSeasons}
              />
            </div>

            <nav aria-label="Тип зачета" className="order-3 grid grid-cols-2 gap-1 rounded-md border border-border/70 bg-background/55 p-1 backdrop-blur-sm sm:inline-flex sm:justify-self-start lg:absolute lg:left-1/2 lg:top-[37%] lg:order-none lg:-translate-x-1/2 lg:-translate-y-1/2">
              <TableTab active={activeTable === "drivers"} href={`/leaderboard?season=${season}`}>
                Пилоты
              </TableTab>
              <TableTab active={activeTable === "constructors"} href={`/leaderboard?season=${season}&table=constructors`}>
                Конструкторы
              </TableTab>
            </nav>
            <SeasonProgress
              className="order-2 mt-1 lg:order-none lg:col-start-2 lg:mt-0 lg:w-[22rem]"
              completedCount={completedRounds}
              nextRace={nextRace}
              totalCount={totalRounds}
            />
          </div>
        </section>

        {podium.length === 3 ? (
          <div className="grid grid-cols-3 items-end gap-2 sm:gap-4">
            {[podium[1], podium[0], podium[2]].map((entry) => (
              <PodiumCard
                entry={entry}
                isChampionLeader={entry.position === 1}
                key={entry.position}
                season={season}
                showAvatar={activeTable === "drivers"}
              />
            ))}
          </div>
        ) : null}

        <section className="stitch-panel overflow-hidden p-0">
          <div className="hidden items-center gap-3 border-b stitch-divider px-4 py-2.5 lg:grid lg:grid-cols-[2.2rem_2.75rem_minmax(13rem,1fr)_minmax(0,auto)_5.5rem]">
            <span className="stitch-label text-[0.6rem] text-muted-foreground">#</span>
            <span />
            <span className="stitch-label text-[0.6rem] text-muted-foreground">
              {activeTable === "drivers" ? "Пилот" : "Команда"}
            </span>
            <RoundHeaderStrip rounds={rounds} />
            <span className="stitch-label justify-self-end text-[0.65rem] text-muted-foreground">Очки</span>
          </div>
          <ol>
            {entries.map((entry) => (
              <StandingRow
                entry={entry}
                key={`${entry.position}-${entry.name}`}
                leaderPoints={leaderPoints}
                roundMaxPoints={roundMaxPoints}
                rounds={rounds}
                season={season}
                showAvatar={activeTable === "drivers"}
              />
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t stitch-divider px-4 py-3">
            <LegendSwatch className="bg-[#f4c95d]" label="Победа" />
            <LegendSwatch className="bg-[#cbd5e1]" label="2-е место" />
            <LegendSwatch className="bg-[#d48a5f]" label="3-е место" />
            <LegendSwatch className="bg-primary/60" label="В очках" />
            <LegendSwatch className="bg-secondary" label="Без очков" />
          </div>
        </section>
      </section>
    </>
  );
}

function TableTab({ active, children, href }: { active: boolean; children: React.ReactNode; href: string }) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-10 items-center justify-center rounded-sm px-4 py-2 font-display text-sm font-bold leading-none transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      href={href}
    >
      {children}
    </Link>
  );
}

function PodiumCard({
  entry,
  isChampionLeader,
  season,
  showAvatar,
}: {
  entry: StandingEntry;
  isChampionLeader: boolean;
  season: number;
  showAvatar: boolean;
}) {
  const tone = podiumTone[entry.position] ?? podiumTone[3];
  const displayName = showAvatar ? formatDriverPodiumName(entry.name) : entry.name;
  const podiumBadgeSize = entry.position === 1
    ? "-top-4 size-10 text-lg sm:-top-5 sm:size-12 sm:text-xl"
    : entry.position === 2
      ? "-top-3.5 size-9 text-base sm:-top-4 sm:size-10 sm:text-lg"
      : "-top-3 size-8 text-sm sm:-top-3.5 sm:size-9 sm:text-base";
  const podiumVisualSize = "size-24 sm:size-36";

  return (
    <article
      className={cn(
        "stitch-panel relative isolate grid h-full justify-items-center content-start gap-1.5 px-2 pb-3 pt-8 text-center sm:gap-2 sm:px-4 sm:pb-5 sm:pt-10",
        !isChampionLeader && "mt-3 sm:mt-6",
      )}
    >
      <span
        aria-label={tone.label}
        className={cn(
          "absolute left-1/2 z-40 grid -translate-x-1/2 place-items-center rounded-full font-display font-extrabold shadow-lg",
          podiumBadgeSize,
          tone.badge,
        )}
      >
        {entry.position}
      </span>
      {entry.titleOdds ? (
        <span
          className="absolute right-2 top-2 z-30 flex flex-col items-center gap-0.5 text-center sm:right-3 sm:top-3 sm:grid sm:size-14 sm:place-content-center sm:rounded-md sm:border sm:border-border/80 sm:bg-background/90 sm:shadow-sm sm:backdrop-blur-sm"
          title={showAvatar
            ? "Вероятность победы в чемпионате по данным Polymarket"
            : "Вероятность победы в Кубке конструкторов по данным Polymarket"}
        >
          <span className="grid justify-items-center gap-0.5">
            <Image
              alt="Polymarket"
              className="size-4 rounded-[2px]"
              height={16}
              src={polymarketMark}
              width={16}
            />
            <span className="font-telemetry text-sm font-extrabold leading-none text-primary sm:text-base">
              {entry.titleOdds}
            </span>
          </span>
          <span className="mt-0.5 hidden text-[0.5rem] font-bold uppercase leading-none text-muted-foreground sm:block">
            {showAvatar ? "Титул" : "Кубок"}
          </span>
        </span>
      ) : null}
      {!showAvatar && entry.teamCarImage ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-md"
          style={{
            background: `radial-gradient(circle at 50% 38%, color-mix(in srgb, ${entry.teamColor ?? "var(--primary)"} 24%, transparent), transparent 68%)`,
          }}
        >
          <Image
            alt=""
            className="scale-[1.12] object-contain object-[center_36%] opacity-85 drop-shadow-[0_8px_8px_rgb(0_0_0_/_0.28)]"
            fill
            sizes="(min-width: 640px) 24rem, 33vw"
            src={entry.teamCarImage}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/20 to-background/90" />
        </div>
      ) : null}
      {showAvatar && entry.driverNumber ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-md"
          style={{
            background: `radial-gradient(circle at 58% 50%, ${entry.teamColor ?? "var(--primary)"}24, transparent 72%)`,
          }}
        >
          <span
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none font-display text-[7rem] font-black leading-none opacity-[0.14] sm:text-[11rem] sm:opacity-[0.1] lg:text-[15rem]"
            style={{ color: entry.teamColor ?? "var(--primary)" }}
          >
            {entry.driverNumber}
          </span>
        </div>
      ) : null}
      {showAvatar ? (
        <div className={cn("relative z-10", podiumVisualSize)}>
          {entry.href ? (
            <Link
              aria-label={`Открыть профиль ${entry.name}`}
              className="relative z-10 block size-full rounded-full p-1 outline-none transition-transform hover:scale-[1.02] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-2"
              href={entry.href}
            >
              <DriverAvatarBadge
                className="size-full"
                color={entry.teamColor}
                fallbackClassName="font-telemetry text-3xl text-foreground sm:text-5xl"
                fallbackLabel={entry.driverNumber}
                name={entry.name}
                season={season}
                sizes="(min-width: 640px) 9rem, 6rem"
                slug={entry.driverSlug}
                src={entry.avatarUrl}
              />
            </Link>
          ) : (
            <DriverAvatarBadge
              className="size-full"
              color={entry.teamColor}
              fallbackClassName="font-telemetry text-3xl text-foreground sm:text-5xl"
              fallbackLabel={entry.driverNumber}
              name={entry.name}
              season={season}
              sizes="(min-width: 640px) 9rem, 6rem"
              slug={entry.driverSlug}
              src={entry.avatarUrl}
            />
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 grid justify-items-center rounded-md border border-border/80 bg-background/90 px-1.5 py-1 shadow-sm backdrop-blur-sm">
            <p className="font-telemetry text-base font-extrabold leading-none sm:text-xl">
              {formatPoints(entry.points)}
              <span className="ml-1 text-[0.52rem] font-bold text-muted-foreground sm:text-[0.6rem]">очк.</span>
            </p>
            <p className="mt-1 hidden whitespace-nowrap text-[0.56rem] font-semibold leading-none text-muted-foreground sm:block">
              {entry.wins} {pluralize(entry.wins, ["победа", "победы", "побед"])}
              {entry.podiums > 0 ? ` · ${entry.podiums} ${pluralize(entry.podiums, ["подиум", "подиума", "подиумов"])}` : ""}
            </p>
          </div>
        </div>
      ) : (
        <div className={cn("relative z-10 grid place-items-center", podiumVisualSize)}>
          <VisualProfileLink className="place-items-center" entry={entry} label={`Открыть профиль команды ${entry.name}`}>
            <TeamMark className="size-14 sm:size-20" entry={entry} season={season} />
          </VisualProfileLink>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 grid justify-items-center rounded-md border border-border/80 bg-background/90 px-1.5 py-1 shadow-sm backdrop-blur-sm">
            <p className="font-telemetry text-base font-extrabold leading-none sm:text-xl">
              {formatPoints(entry.points)}
              <span className="ml-1 text-[0.52rem] font-bold text-muted-foreground sm:text-[0.6rem]">очк.</span>
            </p>
            <p className="mt-1 hidden whitespace-nowrap text-[0.56rem] font-semibold leading-none text-muted-foreground sm:block">
              {entry.wins} {pluralize(entry.wins, ["победа", "победы", "побед"])}
            </p>
          </div>
        </div>
      )}
      <div className="relative z-10 w-full min-w-0">
        {entry.href ? (
          <Link
            className="block max-w-full truncate font-display text-sm font-extrabold leading-tight hover:text-primary sm:text-lg"
            href={entry.href}
          >
            {displayName}
          </Link>
        ) : (
          <p className="max-w-full truncate font-display text-sm font-extrabold leading-tight sm:text-lg">{displayName}</p>
        )}
        {entry.subtitle ? (
          <p className="mt-0.5 flex min-w-0 items-center justify-center gap-1.5 text-[0.65rem] font-semibold text-muted-foreground sm:text-xs">
            <span
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: entry.teamColor ?? "var(--border)" }}
            />
            {entry.teamHref ? (
              <Link className="truncate transition-colors hover:text-primary" href={entry.teamHref}>
                {entry.subtitle}
              </Link>
            ) : (
              <span className="truncate">{entry.subtitle}</span>
            )}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function StandingRow({
  entry,
  leaderPoints,
  roundMaxPoints,
  rounds,
  season,
  showAvatar,
}: {
  entry: StandingEntry;
  leaderPoints: number;
  roundMaxPoints: Record<number, number>;
  rounds: ChampionshipRound[];
  season: number;
  showAvatar: boolean;
}) {
  const gap = leaderPoints - entry.points;

  return (
    <li className="grid grid-cols-[1.8rem_2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t stitch-divider px-3 py-2.5 transition-colors hover:bg-accent/40 sm:px-4 lg:grid-cols-[2.2rem_2.75rem_minmax(13rem,1fr)_minmax(0,auto)_5.5rem]">
      <span
        className={cn(
          "font-telemetry text-sm font-extrabold",
          entry.position === 1 && "text-[#f4c95d]",
          entry.position === 2 && "text-[#cbd5e1]",
          entry.position === 3 && "text-[#d48a5f]",
          entry.position > 3 && "text-muted-foreground",
        )}
      >
        {entry.position}
      </span>
      {showAvatar ? (
        <VisualProfileLink entry={entry} label={`Открыть профиль ${entry.name}`}>
          <DriverAvatarBadge
            className="size-10"
            color={entry.teamColor}
            fallbackClassName="font-telemetry text-sm text-foreground"
            fallbackLabel={entry.driverNumber}
            name={entry.name}
            season={season}
            sizes="2.5rem"
            slug={entry.driverSlug}
            src={entry.avatarUrl}
          />
        </VisualProfileLink>
      ) : (
        <VisualProfileLink entry={entry} label={`Открыть профиль команды ${entry.name}`}>
          <TeamMark className="size-10" entry={entry} season={season} />
        </VisualProfileLink>
      )}
      <div className="min-w-0">
        {entry.href ? (
          <Link
            className="group inline-flex max-w-full items-center gap-1 truncate text-sm font-bold hover:text-primary"
            href={entry.href}
          >
            <span className="truncate">{entry.name}</span>
            <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
          </Link>
        ) : (
          <p className="truncate text-sm font-bold">{entry.name}</p>
        )}
        {entry.subtitle ? (
          entry.teamHref ? (
            <Link
              className="mt-0.5 block truncate text-xs font-semibold text-muted-foreground transition-colors hover:text-primary"
              href={entry.teamHref}
            >
              {entry.subtitle}
            </Link>
          ) : (
            <p className="mt-0.5 truncate text-xs font-semibold text-muted-foreground">{entry.subtitle}</p>
          )
        ) : null}
        <div aria-hidden="true" className="mt-1.5 h-1 max-w-56 overflow-hidden rounded-full bg-secondary/50">
          <div
            className="h-full rounded-full"
            style={{
              backgroundColor: entry.teamColor ?? "var(--primary)",
              width: `${Math.max(2, Math.round((entry.points / leaderPoints) * 100))}%`,
            }}
          />
        </div>
      </div>
      <div className="order-last col-span-full lg:order-none lg:col-span-1 lg:justify-self-end">
        <RoundStrip entry={entry} roundMaxPoints={roundMaxPoints} rounds={rounds} season={season} />
      </div>
      <div className="text-right">
        <p className="font-telemetry text-lg font-extrabold leading-none">{formatPoints(entry.points)}</p>
        <p className="mt-1 text-[0.65rem] font-semibold text-muted-foreground">
          {entry.position === 1 ? `${entry.wins} ${pluralize(entry.wins, ["победа", "победы", "побед"])}` : `−${formatPoints(gap)}`}
        </p>
      </div>
    </li>
  );
}

/*
 * Лента этапов: по ячейке с очками на каждый завершенный гран-при — новые
 * гонки добавляются в конец по мере финиша. Цвет: подиум, очки или ноль.
 */
function RoundStrip({
  entry,
  roundMaxPoints,
  rounds,
  season,
}: {
  entry: StandingEntry;
  roundMaxPoints: Record<number, number>;
  rounds: ChampionshipRound[];
  season: number;
}) {
  return (
    <SyncedHorizontalScroller
      className="pb-1 lg:overflow-visible lg:pb-0"
      group="leaderboard-rounds"
    >
      <div className="grid w-max grid-flow-col auto-cols-[1.6rem] gap-1">
        {rounds.map((round) => {
          const points = entry.pointsByRound[round.round];
          const finishPosition = entry.positionByRound?.[round.round];
          const podium = entry.podiumByRound?.[round.round];
          const roundMax = Math.max(roundMaxPoints[round.round] ?? 0, 1);
          const title = `${round.raceName}${
            finishPosition ? ` · P${finishPosition}` : ""
          }`;

          let style: React.CSSProperties | undefined;
          let className = "bg-secondary/60 text-muted-foreground";

          if (podium === "winner") {
            className = "bg-[#f4c95d] text-[#211a05]";
          } else if (podium === "second") {
            className = "bg-[#cbd5e1] text-[#111827]";
          } else if (podium === "third") {
            className = "bg-[#d48a5f] text-[#2a1608]";
          } else if (typeof points === "number" && points > 0) {
            className = "text-foreground";
            style = {
              backgroundColor: `rgb(225 6 0 / ${(0.28 + 0.5 * Math.min(points / roundMax, 1)).toFixed(2)})`,
            };
          } else if (typeof points !== "number") {
            className = "border border-border/60 bg-transparent text-muted-foreground/70";
          }

          return (
            <Link
              aria-label={title}
              className="grid w-[1.6rem] gap-1 rounded-sm outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              href={`/calendar/${season}/${round.round}`}
              key={round.round}
                  title={title}
            >
              <span
                aria-hidden="true"
                className="grid h-5 place-items-center rounded-sm border border-border/60 bg-background/65 text-sm leading-none lg:hidden"
              >
                <RaceFlag
                  className="h-3.5"
                  countryCode={round.countryCode}
                  label={round.raceName}
                  value={round.flag}
                />
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "grid h-6 min-w-[1.6rem] place-items-center rounded px-0.5 font-telemetry text-[0.65rem] font-extrabold leading-none",
                  className,
                )}
                style={style}
              >
                {typeof points === "number" ? formatPoints(points) : "–"}
              </span>
            </Link>
          );
        })}
      </div>
    </SyncedHorizontalScroller>
  );
}

function RoundHeaderStrip({ rounds }: { rounds: ChampionshipRound[] }) {
  return (
    <div className="grid grid-flow-col auto-cols-[1.6rem] gap-1 justify-self-end" aria-label="Этапы сезона">
      {rounds.map((round) => (
        <span
          aria-label={`${round.raceName}, раунд ${round.round}`}
          className="grid h-6 place-items-center text-base leading-none"
          key={round.round}
          title={`${round.raceName} · раунд ${round.round}`}
        >
          <RaceFlag
            className="h-4"
            countryCode={round.countryCode}
            label={round.raceName}
            value={round.flag}
          />
        </span>
      ))}
    </div>
  );
}

function TeamMark({
  className,
  entry,
  season,
}: {
  className?: string;
  entry: StandingEntry;
  season: number;
}) {
  const usesHistoricalWhiteSurface = season >= 2020 && season <= 2023;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center overflow-hidden rounded-full border-2 p-1.5",
        usesHistoricalWhiteSurface
          ? "border-black/10 bg-white"
          : "team-logo-surface",
        className,
      )}
      style={{ borderColor: entry.teamColor ?? "var(--border)" }}
      title={entry.teamName}
    >
      {entry.teamLogo ? (
        <span
          className="block h-full w-full bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${entry.teamLogo})` }}
        />
      ) : (
        <span className={cn(
          "font-display text-xs font-bold",
          usesHistoricalWhiteSurface ? "text-neutral-700" : "text-white/70",
        )}>
          {entry.teamCode ?? entry.teamName.slice(0, 3).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function VisualProfileLink({
  children,
  className,
  entry,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  entry: StandingEntry;
  label: string;
}) {
  if (!entry.href) {
    return children;
  }

  return (
    <Link
      aria-label={label}
      className={cn(
        "inline-grid shrink-0 rounded-full outline-none transition-transform hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
      href={entry.href}
    >
      {children}
    </Link>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn("size-2.5 rounded-[3px]", className)} />
      <span className="text-[0.62rem] font-semibold text-muted-foreground">{label}</span>
    </span>
  );
}

function buildRoundMaxPoints(rounds: ChampionshipRound[], entries: StandingEntry[]) {
  const maxByRound: Record<number, number> = {};

  for (const round of rounds) {
    let max = 0;

    for (const entry of entries) {
      const points = entry.pointsByRound[round.round];

      if (typeof points === "number" && points > max) {
        max = points;
      }
    }

    maxByRound[round.round] = max;
  }

  return maxByRound;
}

function formatPoints(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDriverPodiumName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  if (parts.length < 2) {
    return fullName;
  }

  return `${parts[0][0]}. ${parts.at(-1)}`;
}

function findMarketOddsLabel(
  name: string,
  outcomes?: Array<{ name: string; label: string }>,
) {
  if (!outcomes?.length) {
    return undefined;
  }

  const normalizedName = normalizeMarketName(name);
  return outcomes.find((outcome) => {
    const normalizedOutcome = normalizeMarketName(outcome.name);
    return normalizedOutcome === normalizedName
      || normalizedOutcome.includes(normalizedName)
      || normalizedName.includes(normalizedOutcome);
  })?.label;
}

function normalizeMarketName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/f1|team|racing/g, "");
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
