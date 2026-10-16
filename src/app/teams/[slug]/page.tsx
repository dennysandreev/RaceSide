import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Gauge,
  Newspaper,
  Radio,
  Trophy,
  Users,
} from "lucide-react";

import { AppShell } from "@/components/racemate/app-shell";
import { DriverAvatarBadge } from "@/components/racemate/driver-avatar-badge";
import { JsonLd } from "@/components/racemate/json-ld";
import { RaceFlag } from "@/components/racemate/race-flag";
import { SeasonSwitcher } from "@/components/racemate/season-switcher";
import { TeamCumulativePointsChart } from "@/components/racemate/team-cumulative-points-chart";
import { TeamLogo } from "@/components/racemate/team-logo";
import { StitchPanel, StitchPanelHeader } from "@/components/racemate/stitch-primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPublishedSeasons, getTeamProfileBySlug } from "@/data/racemate-repository";
import { getTeamInformation, type TeamInformation } from "@/data/team-information";
import {
  CURRENT_F1_SEASON,
  resolvePublishedSeason,
  type SeasonSearchParams,
} from "@/lib/season-navigation";
import { absoluteUrl, buildSeasonPath, createPageMetadata, SITE_URL } from "@/lib/seo";
import { cn } from "@/lib/utils";
import type { TeamProfile, TeamRaceResultRow } from "@/types/racemate";

export const dynamic = "force-dynamic";

type TeamPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SeasonSearchParams>;
};

export async function generateMetadata({ params, searchParams }: TeamPageProps): Promise<Metadata> {
  const [{ slug }, query, publishedSeasons] = await Promise.all([
    params,
    searchParams,
    getPublishedSeasons(),
  ]);
  const season = resolvePublishedSeason(query.season, publishedSeasons);
  const team = season ? await getTeamProfileBySlug(slug, season) : null;

  if (!team) {
    return createPageMetadata({
      description: "Профиль команды не найден в опубликованном архиве RaceSide.",
      noIndex: true,
      path: `/teams/${slug}`,
      title: "Команда не найдена",
    });
  }

  return createPageMetadata({
    description: `${team.shortName} в сезоне Формулы-1 ${team.season}: состав пилотов, положение в чемпионате, статистика и результаты по этапам.`,
    image: team.carImageUrl || team.logo,
    path: team.season === CURRENT_F1_SEASON
      ? `/teams/${team.slug}`
      : `/teams/${team.slug}?season=${team.season}`,
    title: `${team.shortName} в Формуле-1 ${team.season}`,
  });
}

export default async function TeamProfilePage({ params, searchParams }: TeamPageProps) {
  const [{ slug }, query, publishedSeasons] = await Promise.all([
    params,
    searchParams,
    getPublishedSeasons(),
  ]);
  const season = resolvePublishedSeason(query.season, publishedSeasons);

  if (!season) {
    notFound();
  }

  const team = await getTeamProfileBySlug(slug, season);

  if (!team) {
    notFound();
  }

  const availableSeasons = [...new Set([team.season, ...(team.availableSeasons ?? [])])]
    .filter((item) => publishedSeasons.includes(item));
  const isCurrentSeason = team.season === CURRENT_F1_SEASON;

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
                item: absoluteUrl(buildSeasonPath("/teams", team.season, CURRENT_F1_SEASON)),
                name: `Команды ${team.season}`,
                position: 2,
              },
              {
                "@type": "ListItem",
                item: absoluteUrl(
                  team.season === CURRENT_F1_SEASON
                    ? `/teams/${team.slug}`
                    : `/teams/${team.slug}?season=${team.season}`,
                ),
                name: team.shortName,
                position: 3,
              },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "SportsTeam",
            athlete: team.drivers.map((driver) => ({
              "@type": "Person",
              name: driver.fullName,
              url: driver.slug
                ? absoluteUrl(
                    team.season === CURRENT_F1_SEASON
                      ? `/drivers/${driver.slug}`
                      : `/drivers/${driver.slug}?season=${team.season}`,
                  )
                : undefined,
            })),
            image: team.carImageUrl ? absoluteUrl(team.carImageUrl) : undefined,
            logo: team.logo ? absoluteUrl(team.logo) : undefined,
            name: team.name,
            sport: "Автоспорт",
            url: absoluteUrl(
              team.season === CURRENT_F1_SEASON
                ? `/teams/${team.slug}`
                : `/teams/${team.slug}?season=${team.season}`,
            ),
          },
        ]}
      />
      <div className="sport-profile-page grid min-w-0 gap-5 pb-6 sm:gap-6 sm:pb-8">
        <TeamHero availableSeasons={availableSeasons} query={query} team={team} />

        <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
          <DriverLineup team={team} />
          <TeamForm team={team} />
        </section>

        <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-stretch">
          <TeamCumulativePointsChart team={team} />
          <TeamSeasonStats team={team} />
        </section>
        <TeamResultsTable drivers={team.drivers} results={team.results} season={team.season} />
        {isCurrentSeason ? (
          <section className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-stretch">
            <TeamNews team={team} />
            <TeamSocial team={team} />
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

function TeamHero({
  availableSeasons,
  query,
  team,
}: {
  availableSeasons: number[];
  query: SeasonSearchParams;
  team: TeamProfile;
}) {
  const information = getTeamInformation(team.slug, team.season);

  return (
    <section
      className="relative min-h-[31rem] overflow-hidden rounded-xl border border-border bg-card sm:min-h-[35rem]"
      style={{
        backgroundImage: `radial-gradient(circle at 68% 38%, color-mix(in srgb, ${team.color} 24%, transparent), transparent 42%)`,
      }}
    >
      <div className="pointer-events-none absolute inset-x-3 top-24 h-[15rem] sm:inset-x-8 sm:top-8 sm:h-[22rem]">
        {team.carImageUrl ? (
          <Image
            alt={`Болид ${team.shortName} сезона ${team.season}`}
            className="object-contain object-center drop-shadow-[0_16px_14px_rgb(0_0_0_/_0.3)]"
            fill
            priority
            sizes="(min-width: 1280px) 75rem, 100vw"
            src={team.carImageUrl}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center rounded-md border border-border/70 bg-background/30 text-center font-telemetry text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
            Болид проходит проверку
          </div>
        )}
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/25 to-transparent" />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: team.color }}
      />

      <div
        className={cn(
          "relative flex min-h-[31rem] flex-col justify-between p-5 text-foreground sm:min-h-[35rem] sm:p-7",
          information && "gap-28 sm:gap-40 xl:gap-28",
        )}
      >
        <div>
          <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] items-center gap-2 sm:flex sm:justify-between sm:gap-3">
            <Button asChild size="sm" variant="secondary">
              <Link href={`/teams?season=${team.season}`} prefetch={false}>
                <ArrowLeft aria-hidden="true" data-icon="inline-start" />
                Все команды
              </Link>
            </Button>
            <SeasonSwitcher
              activeSeason={team.season}
              className="min-w-0 sm:w-auto"
              expandDirection="left"
              loadingLabel="Обновляем сезон"
              pathname={`/teams/${team.slug}`}
              query={query}
              seasons={availableSeasons}
            />
          </div>

          <h1 className="mt-4 text-balance font-display text-4xl font-black leading-[0.95] tracking-[-0.04em] sm:hidden">
            {team.shortName}
          </h1>
        </div>

        <div className={cn("grid min-w-0 gap-6", information && "xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.85fr)] xl:items-end")}>
          <div className="min-w-0 max-w-2xl">
            <div className="mb-4 hidden items-center sm:flex">
              <TeamLogo code={team.code} color={team.color} logo={team.logo} name={team.name} season={team.season} size="md" />
            </div>
            <h1 className="hidden text-balance font-display text-4xl font-black leading-[0.95] tracking-[-0.04em] sm:block sm:text-6xl">
              {team.shortName}
            </h1>
            <div className="mt-3 flex min-h-10 items-center justify-between gap-4">
              {team.country ? (
                <p className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-muted-foreground sm:text-base">
                  <RaceFlag countryCode={team.countryCode} label={team.country} />
                  <span className="truncate">{team.country}</span>
                </p>
              ) : <span />}
              <span className="shrink-0 sm:hidden">
                <TeamLogo code={team.code} color={team.color} logo={team.logo} name={team.name} season={team.season} size="md" />
              </span>
            </div>

            <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-md border border-border bg-background/80 backdrop-blur-sm sm:grid-cols-4">
              <HeroMetric label="Место" value={formatPosition(team.stats.championshipPosition)} />
              <HeroMetric label="Очки" value={formatStat(team.stats.points)} />
              <HeroMetric label="Победы" value={formatStat(team.stats.wins)} />
              <HeroMetric label="Подиумы" value={formatStat(team.stats.podiums)} />
            </div>
          </div>
          {information ? <TeamInformationSection information={information} /> : null}
        </div>
      </div>
    </section>
  );
}

function TeamInformationSection({ information }: { information: TeamInformation }) {
  const rows = [
    { label: "Первое участие", values: [String(information.firstEntryYear)] },
    { label: "База команды", values: [information.base] },
    {
      label: information.teamPrincipals.length > 1 ? "Руководство команды" : "Руководитель команды",
      values: information.teamPrincipals,
    },
    {
      label: information.technicalDirectors.length > 1 ? "Технические директора" : "Технический директор",
      values: information.technicalDirectors,
    },
    { label: "Шасси", values: [information.chassis] },
  ];

  return (
    <section aria-label="О команде" className="min-w-0 border-t border-border/70 pt-5 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
      <div className="flex min-h-11 items-center">
        <h2 className="font-display text-base font-bold">О команде</h2>
      </div>
      <dl className="mt-1 divide-y divide-border/60">
        {rows.map((row) => (
          <div className="grid min-w-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start gap-3 py-2.5 xl:py-1.5" key={row.label}>
            <dt className="text-xs leading-5 text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 break-words text-right text-sm font-semibold leading-5">
              {row.values.map((value) => <span className="block" key={value}>{value}</span>)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-h-20 content-center border-l border-border px-3 first:border-l-0 sm:min-h-24 sm:px-5">
      <p className="text-[0.65rem] font-bold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-telemetry text-2xl font-extrabold sm:text-3xl">{value}</p>
    </div>
  );
}

function DriverLineup({ team }: { team: TeamProfile }) {
  return (
    <StitchPanel className="grid min-w-0 grid-rows-[auto_1fr]">
      <StitchPanelHeader icon={Users} title="Пилоты команды" />
      <div className="grid h-full gap-3 p-4 sm:grid-cols-2 sm:p-5">
        {team.drivers.map((driver) => (
          <Link
            className="group grid min-h-[14rem] min-w-0 grid-cols-[6rem_minmax(0,1fr)_auto] content-start gap-x-4 gap-y-4 rounded-md border border-border bg-background/35 p-4 transition-colors hover:border-foreground/25 hover:bg-accent/55 sm:p-5"
            href={driver.slug
              ? `/drivers/${driver.slug}?season=${team.season}`
              : `/leaderboard?season=${team.season}`}
            key={driver.id}
            prefetch={false}
          >
            <DriverAvatarBadge
              className="size-24"
              color={team.color}
              fallbackClassName="font-telemetry text-3xl text-foreground"
              fallbackLabel={driver.number ?? driver.code}
              name={driver.fullName}
              season={team.season}
              sizes="6rem"
              slug={driver.slug}
              src={driver.avatarUrl}
            />
            <div className="min-w-0 self-center">
              <p className="text-balance font-display text-lg font-extrabold leading-tight group-hover:text-primary">{driver.fullName}</p>
              <p className="mt-1 font-telemetry text-xs font-bold text-muted-foreground">
                {driver.code ?? "—"} · № {driver.number ?? "—"}
              </p>
              <p className="mt-3 text-xs font-semibold text-muted-foreground">
                {driver.championshipPosition ? `${driver.championshipPosition}-е место в чемпионате` : "Позиция уточняется"}
              </p>
            </div>
            <ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
            <div className="col-span-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
              <DriverMetric label="Очки" value={formatStat(driver.points)} />
              <DriverMetric label="Победы" value={formatStat(driver.wins)} />
              <DriverMetric label="Подиумы" value={formatStat(driver.podiums)} />
              <DriverMetric label="Лучший финиш" value={formatPosition(driver.bestResult)} />
            </div>
          </Link>
        ))}
      </div>
    </StitchPanel>
  );
}

function DriverMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="grid min-h-16 content-center bg-card px-3 py-2">
      <span className="stitch-label text-[0.55rem] text-muted-foreground">{label}</span>
      <span className="mt-1 font-telemetry text-base font-extrabold">{value}</span>
    </span>
  );
}

function TeamForm({ team }: { team: TeamProfile }) {
  const bestQualifyingPosition = team.results
    .slice(-5)
    .map((result) => result.qualifyingBest)
    .filter((position): position is number => position !== null)
    .sort((left, right) => left - right)[0] ?? null;

  return (
    <StitchPanel className="min-w-0">
      <StitchPanelHeader icon={Gauge} title="Последние 5 этапов" />
      <div className="grid gap-4 p-5">
        <div className="grid grid-cols-5 gap-2">
          {team.form.labels.length ? team.form.labels.map((label, index) => (
            <span
              className={cn(
                "grid min-h-10 min-w-0 place-items-center whitespace-nowrap rounded border px-1 font-telemetry text-[0.62rem] font-extrabold sm:text-[0.68rem]",
                getTeamFormTone(label) === "winner" && "border-[#f4c95d]/60 bg-[#f4c95d]/10 text-[#f4c95d]",
                getTeamFormTone(label) === "classified" && "border-border bg-card",
                getTeamFormTone(label) === "dnf" && "border-primary/50 bg-primary/10 text-primary",
              )}
              key={`${label}-${index}`}
            >
              {label}
            </span>
          )) : <span className="text-sm text-muted-foreground">Результаты появятся после гонок</span>}
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border">
          <MiniMetric label="Очки" value={formatStat(team.form.points)} />
          <MiniMetric label="Подиумы" value={formatStat(team.form.podiums)} />
          <MiniMetric label="Лучший финиш" value={formatPosition(team.form.bestResult)} />
          <MiniMetric label="Лучшая квалификация" value={formatPosition(bestQualifyingPosition)} />
        </div>
      </div>
    </StitchPanel>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-3">
      <p className="stitch-label text-muted-foreground">{label}</p>
      <p className="mt-2 font-telemetry text-lg font-extrabold">{value}</p>
    </div>
  );
}

function TeamSeasonStats({ team }: { team: TeamProfile }) {
  const stats = [
    ["Подиумы", formatStat(team.stats.podiums)],
    ["Поулы", formatStat(team.stats.poles)],
    ["Быстрые круги", formatStat(team.stats.fastestLaps)],
    ["Сходы", formatStat(team.stats.dnfs)],
    ["Финиши в очках", formatStat(team.stats.pointsFinishes)],
    ["Средний финиш", team.stats.averageFinish === null ? "—" : team.stats.averageFinish.toFixed(1)],
    ["Лучший результат", formatPosition(team.stats.bestResult)],
  ];

  return (
    <StitchPanel className="grid h-full min-w-0 grid-rows-[auto_1fr_auto] overflow-hidden">
      <StitchPanelHeader icon={Trophy} title={`Статистика сезона ${team.season}`} />
      <div className="grid grid-cols-2 gap-3 p-4">
        {stats.map(([label, value]) => (
          <div className="rounded-md border border-border/70 bg-card p-3" key={label}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-2 font-telemetry text-lg font-bold">{value}</p>
          </div>
        ))}
      </div>
    </StitchPanel>
  );
}

function TeamResultsTable({
  drivers,
  results,
  season,
}: {
  drivers: TeamProfile["drivers"];
  results: TeamRaceResultRow[];
  season: number;
}) {
  return (
    <StitchPanel className="min-w-0 overflow-hidden">
      <StitchPanelHeader icon={CalendarDays} title="Результаты по этапам" />
      <div className="hidden grid-cols-[minmax(13rem,1.35fr)_minmax(10rem,1fr)_7rem_7rem_7rem_5rem] items-center gap-3 border-b border-border bg-background/35 px-5 py-3 lg:grid">
        <span className="stitch-label text-muted-foreground">Этап</span>
        <span className="stitch-label text-muted-foreground">Гонщик</span>
        <span className="stitch-label text-center text-muted-foreground">Квалиф.</span>
        <span className="stitch-label text-center text-muted-foreground">Финиш</span>
        <span className="stitch-label text-center text-muted-foreground">Старт → финиш</span>
        <span className="stitch-label text-right text-muted-foreground">Очки</span>
      </div>
      <ol className="divide-y divide-border/70">
        {results.map((result) => {
          const driverRows = getTeamResultDriverRows(result, drivers);

          return (
            <li
              className="grid min-w-0 gap-3 p-4 transition-colors hover:bg-accent/30 lg:grid-cols-[minmax(13rem,1.35fr)_minmax(10rem,1fr)_7rem_7rem_7rem_5rem] lg:items-center lg:px-5 lg:py-3.5"
              key={result.round}
            >
              <Link
                className="flex min-w-0 items-center gap-3 rounded-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={`/calendar/${season}/${result.round}`}
                prefetch={false}
              >
                <RaceFlag countryCode={result.countryCode} label={result.country || result.raceName} />
                <div className="min-w-0">
                  <p className="truncate font-bold">{result.raceName}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Раунд {result.round}</p>
                </div>
              </Link>

              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_4.75rem_4.75rem] gap-2 rounded-md border border-border/70 bg-secondary/20 p-3 lg:contents">
                <div className="grid min-w-0 content-start gap-1.5">
                  <span className="stitch-label mb-1 text-[0.55rem] text-muted-foreground lg:hidden">Гонщик</span>
                  {driverRows.map((driver) => (
                    <div className="flex min-h-7 min-w-0 items-center" key={`${result.round}-${driver.id}`}>
                      {driver.slug ? (
                        <Link
                          className="min-w-0 truncate text-xs font-semibold text-muted-foreground transition-colors hover:text-primary"
                          href={`/drivers/${driver.slug}?season=${season}`}
                          prefetch={false}
                        >
                          {driver.name}
                        </Link>
                      ) : (
                        <span className="min-w-0 truncate text-xs font-semibold text-muted-foreground">
                          {driver.name}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="grid content-start justify-items-center gap-1.5">
                  <span className="stitch-label mb-1 text-[0.55rem] text-muted-foreground lg:hidden">Квалиф.</span>
                  {driverRows.map((driver) => (
                    <div className="flex min-h-7 items-center" key={`${result.round}-${driver.id}`}>
                      <Badge
                        className="min-w-10 shrink-0 justify-center"
                        variant={getPositionBadgeVariant(driver.qualifyingPosition)}
                      >
                        {formatPosition(driver.qualifyingPosition)}
                      </Badge>
                    </div>
                  ))}
                </div>
                <div className="grid content-start justify-items-center gap-1.5">
                  <span className="stitch-label mb-1 text-[0.55rem] text-muted-foreground lg:hidden">Финиш</span>
                  {driverRows.map((driver) => (
                    <div className="flex min-h-7 items-center" key={`${result.round}-${driver.id}`}>
                      <Badge
                        className="min-w-10 justify-center"
                        variant={getPositionBadgeVariant(driver.finishPosition, driver.isDnf)}
                      >
                        {driver.isDnf ? "Сход" : formatPosition(driver.finishPosition)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border lg:contents">
                <div className="bg-card p-3 text-center lg:bg-transparent lg:p-0">
                  <p className="stitch-label text-[0.55rem] text-muted-foreground lg:hidden">Старт → финиш</p>
                  <p
                    className={cn(
                      "mt-1 font-telemetry text-base font-extrabold lg:mt-0",
                      result.positionDelta !== null && result.positionDelta > 0 && "text-success",
                      result.positionDelta !== null && result.positionDelta < 0 && "text-danger",
                      result.positionDelta === 0 && "text-muted-foreground",
                    )}
                  >
                    {formatPositionDelta(result.positionDelta)}
                  </p>
                </div>
                <div className="bg-card p-3 text-center lg:bg-transparent lg:p-0 lg:text-right">
                  <p className="stitch-label text-[0.55rem] text-muted-foreground lg:hidden">Очки</p>
                  <p className="mt-1 font-telemetry text-base font-extrabold lg:mt-0">{formatStat(result.points)}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </StitchPanel>
  );
}

function TeamNews({ team }: { team: TeamProfile }) {
  return (
    <StitchPanel className="grid h-full min-w-0 grid-rows-[auto_1fr_auto] overflow-hidden">
      <StitchPanelHeader icon={Newspaper} title={`Новости ${team.shortName}`} />
      {team.news.length ? (
        <div className="divide-y divide-border">
          {team.news.map((item) => (
            <Link className="group grid gap-2 p-4 hover:bg-accent/35 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-start sm:p-5" href={`/news/${item.slug}`} key={item.slug} prefetch={false}>
              <p className="text-xs font-semibold text-muted-foreground">{item.source} · {item.time}</p>
              <div className="min-w-0">
                <p className="font-display text-base font-extrabold group-hover:text-primary">{item.title}</p>
                <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{item.summary}</p>
              </div>
              <ChevronRight aria-hidden="true" className="hidden size-4 text-muted-foreground group-hover:text-primary sm:block" />
            </Link>
          ))}
        </div>
      ) : (
        <div className="p-7 text-center">
          <p className="font-bold">Свежих материалов пока нет</p>
          <p className="mt-1 text-sm text-muted-foreground">Новые публикации появятся после обработки ленты RaceSide.</p>
        </div>
      )}
      <div className="border-t border-border p-4">
        <Button asChild variant="secondary">
          <Link href={`/news?tag=team-${team.code.toLowerCase()}`} prefetch={false}>
            Все новости команды
            <ChevronRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </StitchPanel>
  );
}

function TeamSocial({ team }: { team: TeamProfile }) {
  return (
    <StitchPanel className="grid h-full min-w-0 grid-rows-[auto_1fr_auto] overflow-hidden">
      <StitchPanelHeader icon={Radio} title="Лента соцсетей" />
      <div className="divide-y divide-border">
        {team.socialPosts.length ? team.socialPosts.slice(0, 5).map((post) => (
          <a
            className="group block p-4 transition-colors hover:bg-accent/35"
            href={post.href}
            key={`${post.platform}-${post.href}`}
            rel="noreferrer"
            target="_blank"
          >
            <div className="flex items-start justify-between gap-3">
              <Badge variant="outline">{post.source}</Badge>
              <span className="shrink-0 text-xs text-muted-foreground">{post.publishedAt}</span>
            </div>
            <p className="mt-2 line-clamp-3 text-sm font-semibold leading-6 group-hover:text-primary">
              {post.title}
            </p>
          </a>
        )) : (
          <div className="p-6 text-center">
            <p className="font-bold">Публикаций пока нет</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Новые сообщения команды появятся после обработки ленты.
            </p>
          </div>
        )}
      </div>
      <div className="mt-auto border-t border-border p-4">
        <Button asChild className="w-full" variant="secondary">
          <Link href={`/social?team=team-${team.code.toLowerCase()}`} prefetch={false}>
            Все публикации команды
            <ChevronRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </StitchPanel>
  );
}

function formatPosition(value: number | null) {
  return value === null ? "—" : `P${value}`;
}

function formatStat(value: number | null) {
  if (value === null) {
    return "—";
  }

  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function formatPositionDelta(value: number | null) {
  if (value === null) {
    return "—";
  }

  return value > 0 ? `+${value}` : String(value);
}

function getTeamFormTone(label: string) {
  const positions = [...label.matchAll(/P(\d+)/g)].map((match) => Number(match[1]));

  if (positions.length && Math.min(...positions) === 1) {
    return "winner";
  }

  return label.includes("DNF") && !positions.length ? "dnf" : "classified";
}

function getTeamResultDriverRows(result: TeamRaceResultRow, drivers: TeamProfile["drivers"]) {
  const resultDrivers = new Map(
    [...result.qualifyingResults, ...result.finishResults]
      .filter((driver) => driver.driverId)
      .map((driver) => [driver.driverId as string, driver]),
  );
  const orderedDrivers = drivers.length
    ? drivers.slice(0, 2).map((driver) => ({
        id: driver.id,
        name: driver.fullName,
        slug: driver.slug,
      }))
    : [...resultDrivers.entries()].map(([id, driver]) => ({
        id,
        name: driver.driver,
        slug: driver.driverSlug,
      }));

  return orderedDrivers.map((driver) => {
    const qualifying = result.qualifyingResults.find((item) => item.driverId === driver.id);
    const finish = result.finishResults.find((item) => item.driverId === driver.id);

    return {
      ...driver,
      finishPosition: finish?.position ?? null,
      isDnf: finish?.isDnf ?? (result.finishResults.length > 0 && Boolean(qualifying)),
      qualifyingPosition: qualifying?.position ?? null,
    };
  });
}

function getPositionBadgeVariant(position: number | null, isDnf = false) {
  if (isDnf) {
    return "danger" as const;
  }

  if (position === 1) {
    return "warning" as const;
  }

  if (position && position <= 3) {
    return "secondary" as const;
  }

  return "outline" as const;
}
