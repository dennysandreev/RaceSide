import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  ChevronDown,
  ChevronRight,
  Flag,
  Gauge,
  Heart,
  Medal,
  Newspaper,
  Shield,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";

import { addFavoriteDriver } from "@/app/drivers/[slug]/actions";
import { DriverCumulativePointsChart } from "@/components/racemate/driver-cumulative-points-chart";
import { JsonLd } from "@/components/racemate/json-ld";
import {
  getDriverInitials,
  getHistoricalDriverFallbackSrc,
  getLocalDriverAvatarSrc,
} from "@/components/racemate/driver-avatar-badge";
import { RaceFlag } from "@/components/racemate/race-flag";
import { SeasonSwitcher } from "@/components/racemate/season-switcher";
import { TeamLogo } from "@/components/racemate/team-logo";
import {
  StitchMetric,
  StitchPanel,
  StitchPanelHeader,
} from "@/components/racemate/stitch-primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getDriverProfileBySlug,
  getPublishedSeasons,
} from "@/data/racemate-repository";
import { getTeamProfileAsset } from "@/data/f1-assets";
import { getConfirmedSeasonChampion } from "@/data/season-champions";
import { getSessionUser } from "@/lib/auth";
import {
  CURRENT_F1_SEASON,
  resolvePublishedSeason,
  type SeasonSearchParams,
} from "@/lib/season-navigation";
import { absoluteUrl, createPageMetadata, SITE_URL } from "@/lib/seo";
import { cn } from "@/lib/utils";
import type { DriverProfile, DriverRaceResultRow } from "@/types/racemate";

export const dynamic = "force-dynamic";

type DriverPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SeasonSearchParams>;
};

export async function generateMetadata({ params, searchParams }: DriverPageProps): Promise<Metadata> {
  const [{ slug }, query, publishedSeasons] = await Promise.all([
    params,
    searchParams,
    getPublishedSeasons(),
  ]);
  const season = resolvePublishedSeason(query.season, publishedSeasons);

  if (!season) {
    return createPageMetadata({
      description: "Профиль гонщика не найден в опубликованном архиве RaceSide.",
      noIndex: true,
      path: `/drivers/${slug}`,
      title: "Гонщик не найден",
    });
  }

  const profile = await getDriverProfileBySlug(slug, season);

  if (!profile) {
    return createPageMetadata({
      description: "Профиль гонщика не найден в опубликованном архиве RaceSide.",
      noIndex: true,
      path: `/drivers/${slug}`,
      title: "Гонщик не найден",
    });
  }

  const image = profile.aiAvatarUrl
    || getLocalDriverAvatarSrc(profile.slug, profile.season)
    || getHistoricalDriverFallbackSrc(profile.season);

  return createPageMetadata({
    description: `${profile.fullName} в сезоне Формулы-1 ${profile.season}: результаты, очки, форма, статистика по этапам и сравнение с напарником.`,
    image,
    path: profile.season === CURRENT_F1_SEASON
      ? `/drivers/${profile.slug}`
      : `/drivers/${profile.slug}?season=${profile.season}`,
    title: `${profile.fullName} в Формуле-1 ${profile.season}`,
  });
}

export default async function DriverProfilePage({ params, searchParams }: DriverPageProps) {
  const [{ slug }, query, user, publishedSeasons] = await Promise.all([
    params,
    searchParams,
    getSessionUser(),
    getPublishedSeasons(),
  ]);
  const season = resolvePublishedSeason(query.season, publishedSeasons);

  if (!season) {
    notFound();
  }

  const profile = await getDriverProfileBySlug(slug, season, user?.id);

  if (!profile) {
    notFound();
  }

  const availableSeasons = [...new Set([profile.season, ...(profile.availableSeasons ?? [])])]
    .filter((item) => publishedSeasons.includes(item));
  const isCurrentSeason = profile.season === CURRENT_F1_SEASON;
  const profileUrl = absoluteUrl(
    isCurrentSeason
      ? `/drivers/${profile.slug}`
      : `/drivers/${profile.slug}?season=${profile.season}`,
  );
  const profileImage = profile.aiAvatarUrl
    || getLocalDriverAvatarSrc(profile.slug, profile.season)
    || getHistoricalDriverFallbackSrc(profile.season);

  return (
    <>
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
                  profile.season === CURRENT_F1_SEASON
                    ? "/drivers"
                    : `/drivers?season=${profile.season}`,
                ),
                name: `Пилоты ${profile.season}`,
                position: 2,
              },
              {
                "@type": "ListItem",
                item: profileUrl,
                name: profile.fullName,
                position: 3,
              },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "Person",
            affiliation: {
              "@type": "SportsTeam",
              name: profile.team.name,
              url: profile.team.slug
                ? absoluteUrl(
                    profile.season === CURRENT_F1_SEASON
                      ? `/teams/${profile.team.slug}`
                      : `/teams/${profile.team.slug}?season=${profile.season}`,
                  )
                : undefined,
            },
            image: profileImage ? absoluteUrl(profileImage) : undefined,
            jobTitle: "Гонщик Формулы-1",
            name: profile.fullName,
            nationality: profile.country ?? undefined,
            url: profileUrl,
          },
        ]}
      />
      <div className="sport-profile-page grid gap-4 pb-6 sm:gap-5">
        <DriverHero
          availableSeasons={availableSeasons}
          profile={profile}
          query={query}
          signedIn={Boolean(user)}
        />

        <SeasonStats profile={profile} />

        <div className="grid min-w-0 gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-stretch">
          <DriverCumulativePointsChart profile={profile} />
          <FormPanel profile={profile} />
        </div>

        <div className="grid min-w-0 gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-stretch">
          <RaceResultsPanel results={profile.results} season={profile.season} />
          <aside className="grid h-full min-w-0 gap-4 sm:gap-5">
            <TeammatePanel profile={profile} />
            <DeltaPanel profile={profile} />
          </aside>
        </div>

        {isCurrentSeason ? (
          <div className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
            <DriverNewsPanel profile={profile} />
            <DriverSocialPanel profile={profile} />
          </div>
        ) : null}
      </div>
    </>
  );
}

function DriverHero({
  availableSeasons,
  profile,
  query,
  signedIn,
}: {
  availableSeasons: number[];
  profile: DriverProfile;
  query: SeasonSearchParams;
  signedIn: boolean;
}) {
  const teamProfile = profile.season === CURRENT_F1_SEASON
    ? getTeamProfileAsset(profile.team.code) ?? getTeamProfileAsset(profile.team.name)
    : null;
  const teamSlug = profile.team.slug ?? teamProfile?.slug;
  const avatarUrl = profile.aiAvatarUrl
    || getLocalDriverAvatarSrc(profile.slug, profile.season)
    || getHistoricalDriverFallbackSrc(profile.season);
  const teamColor = profile.team.color ?? "var(--primary)";
  const isChampion = getConfirmedSeasonChampion(profile.season)?.driverSlug === profile.slug
    || (profile.season < CURRENT_F1_SEASON && profile.stats.championshipPosition === 1);

  return (
    <section className="stitch-panel relative overflow-hidden p-0">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle at 82% 0%, ${hexWithAlpha(profile.team.color, 0.3) ?? "rgb(225 6 0 / 0.24)"}, transparent 30rem), linear-gradient(135deg, rgb(255 255 255 / 0.06), transparent 40%)`,
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-1"
        style={{ backgroundColor: teamColor }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-4 -top-10 select-none font-display text-[11rem] font-black leading-none tracking-tighter opacity-[0.07] sm:text-[16rem]"
        style={{ color: teamColor }}
      >
        {profile.number ?? profile.code ?? ""}
      </span>

      <div className="relative grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:grid-rows-[auto_minmax(0,1fr)] lg:items-start lg:gap-5">
        <div className="order-1 flex min-w-0 items-start justify-between gap-3 lg:col-span-2 lg:order-none lg:items-center">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="secondary">
              <RaceFlag
                className="mr-1 align-[-0.08em]"
                countryCode={profile.countryCode}
                label={profile.country ?? "Страна"}
              />
              {profile.country ?? "Страна уточняется"}
            </Badge>
            <Badge variant="outline">
              <span className="font-telemetry">№ {profile.number ?? profile.code ?? "—"}</span>
            </Badge>
            {isChampion ? (
              <Badge className="border-[#f4c95d]/55 bg-[#f4c95d]/15 text-[#8a6500] dark:text-[#f4c95d]" variant="outline">
                <Trophy aria-hidden="true" className="mr-1 size-3" />
                Чемпион {profile.season}
              </Badge>
            ) : null}
          </div>

          <SeasonSwitcher
            activeSeason={profile.season}
            className="w-[9rem] shrink-0 sm:w-auto"
            expandDirection="left"
            loadingLabel="Обновляем сезон"
            pathname={`/drivers/${profile.slug}`}
            query={query}
            seasons={availableSeasons}
          />
        </div>

        <div className="order-3 mt-1 min-w-0 lg:col-start-1 lg:row-start-2 lg:mt-0 lg:flex lg:min-h-64 lg:flex-col lg:justify-end">
          <h1 className="text-balance font-display leading-[0.94] tracking-[-0.04em]">
            <span className="block text-xl font-bold text-muted-foreground sm:text-3xl">
              {profile.firstName}
            </span>
            <span className="block text-4xl font-black uppercase sm:text-6xl">
              {profile.lastName}
            </span>
          </h1>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              className="group inline-flex min-w-0 items-center gap-2.5 rounded-md border border-border/70 bg-background/40 py-1.5 pl-1.5 pr-2.5 transition-colors hover:border-primary/40 hover:bg-accent/50"
              href={teamSlug
                ? `/teams/${teamSlug}?season=${profile.season}`
                : `/leaderboard?season=${profile.season}&table=constructors`}
              prefetch={false}
            >
              <TeamLogo
                code={profile.team.code}
                color={profile.team.color}
                logo={profile.team.logo}
                name={profile.team.name}
                season={profile.season}
                size="sm"
              />
              <span className="min-w-0 truncate text-sm font-bold">{profile.team.name}</span>
              <ChevronRight
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
              />
            </Link>
            <FavoriteAction profile={profile} signedIn={signedIn} />
          </div>
        </div>

        <div className="relative order-2 mx-auto w-full max-w-[15rem] lg:col-start-2 lg:row-start-2 lg:mx-0 lg:max-w-none">
          {avatarUrl ? (
            <div className="relative h-56 sm:h-64">
              <Image
                alt={`Аватар ${profile.fullName}`}
                className="object-contain object-bottom"
                fill
                priority
                sizes="(min-width: 1024px) 17rem, 15rem"
                src={avatarUrl}
                unoptimized={profile.season !== CURRENT_F1_SEASON}
              />
              <span
                aria-hidden="true"
                className="absolute inset-x-6 bottom-0 h-1 rounded-full"
                style={{ backgroundColor: teamColor }}
              />
            </div>
          ) : (
            <div
              aria-hidden="true"
              className="relative grid h-56 place-items-center overflow-hidden rounded-xl border border-border/70 bg-background/40 sm:h-64"
            >
              <span
                className="absolute select-none font-display text-[8rem] font-black leading-none opacity-[0.08] sm:text-[10rem]"
                style={{ color: teamColor }}
              >
                {getDriverInitials(profile.fullName)}
              </span>
              <span className="relative grid size-24 place-items-center rounded-full border border-border/80 bg-background/75 font-telemetry text-4xl font-black shadow-sm sm:size-28 sm:text-5xl">
                {profile.number ?? profile.code ?? getDriverInitials(profile.fullName)}
              </span>
              <span
                className="absolute inset-x-6 bottom-0 h-1 rounded-full"
                style={{ backgroundColor: teamColor }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="relative grid grid-cols-2 border-t stitch-divider bg-background/30 sm:grid-cols-4">
        <HeroStat label="Место" value={formatPosition(profile.stats.championshipPosition)} />
        <HeroStat accent label="Очки" value={formatStat(profile.stats.points)} />
        <HeroStat label="Победы" value={formatStat(profile.stats.wins)} />
        <HeroStat label="Подиумы" value={formatStat(profile.stats.podiums)} />
      </div>
    </section>
  );
}

function HeroStat({ accent, label, value }: { accent?: boolean; label: string; value: string }) {
  return (
    <div className="border-r stitch-divider px-4 py-3 last:border-r-0 sm:px-6 [&:nth-child(2)]:border-r-0 sm:[&:nth-child(2)]:border-r [&:nth-child(-n+2)]:border-b sm:[&:nth-child(-n+2)]:border-b-0">
      <p className="stitch-label text-[0.56rem] text-muted-foreground">{label}</p>
      <p className={cn("font-telemetry mt-1.5 text-xl font-extrabold leading-none sm:text-2xl", accent && "text-primary")}>
        {value}
      </p>
    </div>
  );
}

function FavoriteAction({ profile, signedIn }: { profile: DriverProfile; signedIn: boolean }) {
  if (profile.season !== CURRENT_F1_SEASON) {
    return null;
  }

  if (!signedIn) {
    const next = `/drivers/${profile.slug}?season=${profile.season}`;

    return (
      <Button asChild>
        <Link href={`/auth?next=${encodeURIComponent(next)}`} prefetch={false}>
          <Heart aria-hidden="true" data-icon="inline-start" />
          Войти и добавить
        </Link>
      </Button>
    );
  }

  if (profile.isFavorite) {
    return (
      <Button disabled variant="secondary">
        <Heart aria-hidden="true" data-icon="inline-start" />
        Уже в избранном
      </Button>
    );
  }

  if (profile.favoriteLimitReached) {
    return (
      <Button asChild variant="secondary">
        <Link href="/onboarding" prefetch={false}>
          Изменить избранное
        </Link>
      </Button>
    );
  }

  return (
    <form action={addFavoriteDriver}>
      <input name="driverId" type="hidden" value={profile.id} />
      <input name="season" type="hidden" value={profile.season} />
      <input name="slug" type="hidden" value={profile.slug} />
      <Button type="submit">
        <Heart aria-hidden="true" data-icon="inline-start" />
        Добавить в избранное
      </Button>
    </form>
  );
}

function SeasonStats({ profile }: { profile: DriverProfile }) {
  const stats = [
    ["Очки", formatStat(profile.stats.points)],
    ["Место", formatPosition(profile.stats.championshipPosition)],
    ["Победы", formatStat(profile.stats.wins)],
    ["Подиумы", formatStat(profile.stats.podiums)],
    ["Поулы", formatStat(profile.stats.poles)],
    ["Быстрые круги", formatStat(profile.stats.fastestLaps)],
    ["Сходы", formatStat(profile.stats.dnfs)],
    ["Финиши в очках", formatStat(profile.stats.pointsFinishes)],
    ["Средний старт", formatDecimal(profile.stats.averageStart)],
    ["Средний финиш", formatDecimal(profile.stats.averageFinish)],
    ["Лучший результат", formatPosition(profile.stats.bestResult)],
    ["Худший результат", formatPosition(profile.stats.worstResult)],
  ];

  return (
    <StitchPanel>
      <StitchPanelHeader icon={Gauge} title="Статистика сезона" />
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 sm:gap-3 sm:p-4 lg:grid-cols-4 xl:grid-cols-6">
        {stats.map(([label, value]) => (
          <div className="rounded-md border border-border/70 bg-background/35 px-3 py-2.5" key={label}>
            <p className="stitch-label text-[0.54rem] text-muted-foreground">{label}</p>
            <p className="font-telemetry mt-1.5 text-lg font-extrabold leading-none">{value}</p>
          </div>
        ))}
      </div>
    </StitchPanel>
  );
}

function RaceResultsPanel({ results, season }: { results: DriverRaceResultRow[]; season: number }) {
  const completedResults = results.filter((result) => result.finishPosition !== null || result.isDnf);
  const recentResults = completedResults.slice(-10);
  const hasHiddenResults = results.length > recentResults.length;

  return (
    <StitchPanel className="h-full overflow-hidden">
      <StitchPanelHeader icon={Flag} title="Результаты по этапам" />
      {hasHiddenResults ? (
        <>
          <details className="group peer">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 border-b stitch-divider px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Показать все этапы · {results.length}</span>
              <span className="hidden group-open:inline">Оставить последние 10</span>
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <RaceResultsContent results={results} season={season} />
          </details>
          <div className="peer-open:hidden">
            <RaceResultsContent results={recentResults} season={season} />
          </div>
        </>
      ) : (
        <RaceResultsContent results={results} season={season} />
      )}
    </StitchPanel>
  );
}

function RaceResultsContent({ results, season }: { results: DriverRaceResultRow[]; season: number }) {
  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Этап</th>
              <th className="px-4 py-3 text-right font-medium">Квалиф.</th>
              <th className="px-4 py-3 text-right font-medium">Старт</th>
              <th className="px-4 py-3 text-right font-medium">Финиш</th>
              <th className="px-4 py-3 text-right font-medium">+/-</th>
              <th className="px-4 py-3 text-right font-medium">Очки</th>
              <th className="px-4 py-3 font-medium">Статус</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => (
              <tr className="border-t border-border/70" key={`${result.round}-${result.raceName}`}>
                <td className="px-4 py-3">
                  <Link
                    className="flex min-w-[12rem] items-center gap-2 rounded-sm font-medium transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={`/calendar/${season}/${result.round}`}
                    prefetch={false}
                  >
                    <RaceFlag countryCode={result.countryCode} label={result.country || result.raceName} />
                    <span>R{result.round} · {result.raceName}</span>
                  </Link>
                  <div className="mt-1 text-xs text-muted-foreground">{result.raceDate}</div>
                </td>
                <td className="px-4 py-3 text-right font-telemetry">{formatPosition(result.qualifyingPosition)}</td>
                <td className="px-4 py-3 text-right font-telemetry">{formatPosition(result.startPosition)}</td>
                <td className="px-4 py-3 text-right font-telemetry">
                  <span className={cn(result.isWin && "text-[#f4c95d]", result.isPodium && !result.isWin && "text-[#d48a5f]")}>
                    {formatPosition(result.finishPosition)}
                  </span>
                </td>
                <td className={cn("px-4 py-3 text-right font-telemetry", getDeltaClassName(result.positionDelta))}>
                  {formatDelta(result.positionDelta)}
                </td>
                <td className={cn("px-4 py-3 text-right font-telemetry", result.scoredPoints && "text-primary")}>
                  {formatStat(result.points)}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <Badge variant={result.isDnf ? "danger" : result.finishPosition ? "outline" : "secondary"}>
                    {result.isDnf ? "Сход" : result.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-2 p-3 sm:hidden">
        {results.map((result) => (
          <article
            className="rounded-md border border-border/70 bg-background/35 p-3"
            key={`m-${result.round}-${result.raceName}`}
          >
            <div className="flex items-start justify-between gap-2">
              <Link
                className="flex min-w-0 items-center gap-2 rounded-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={`/calendar/${season}/${result.round}`}
                prefetch={false}
              >
                <RaceFlag countryCode={result.countryCode} label={result.country || result.raceName} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">R{result.round} · {result.raceName}</p>
                  <p className="mt-0.5 text-[0.65rem] font-semibold text-muted-foreground">{result.raceDate}</p>
                </div>
              </Link>
              <Badge className="shrink-0" variant={result.isDnf ? "danger" : result.finishPosition ? "outline" : "secondary"}>
                {result.isDnf ? "Сход" : result.status}
              </Badge>
            </div>
            <div className="mt-2.5 grid grid-cols-4 gap-1.5">
              <MobileResultCell label="Квалиф." value={formatPosition(result.qualifyingPosition)} />
              <MobileResultCell label="Старт" value={formatPosition(result.startPosition)} />
              <MobileResultCell
                label="Финиш"
                value={formatPosition(result.finishPosition)}
                valueClassName={cn(
                  result.isWin && "text-[#f4c95d]",
                  result.isPodium && !result.isWin && "text-[#d48a5f]",
                )}
              />
              <MobileResultCell
                label="Очки"
                value={formatStat(result.points)}
                valueClassName={cn(result.scoredPoints && "text-primary")}
              />
            </div>
            {result.positionDelta ? (
              <p className={cn("mt-2 text-[0.68rem] font-bold", getDeltaClassName(result.positionDelta))}>
                Старт → финиш: {formatDelta(result.positionDelta)}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </>
  );
}

function MobileResultCell({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded border border-border/60 bg-background/40 px-1.5 py-1.5 text-center">
      <p className="text-[0.54rem] font-bold uppercase tracking-[0.06em] text-muted-foreground">{label}</p>
      <p className={cn("font-telemetry mt-1 text-sm font-extrabold leading-none", valueClassName)}>{value}</p>
    </div>
  );
}

function FormPanel({ profile }: { profile: DriverProfile }) {
  return (
    <StitchPanel className="h-full">
      <StitchPanelHeader icon={Medal} title="Последние 5 этапов" />
      <div className="grid gap-4 p-4">
        <div className="flex flex-wrap gap-2">
          {profile.form.labels.length ? profile.form.labels.map((label, index) => (
            <span
              className={cn(
                "rounded-md border border-border bg-background/35 px-3 py-2 font-telemetry text-sm font-bold",
                label === "DNF" && "border-danger/50 text-danger",
                label === "P1" && "border-[#f4c95d]/50 text-[#f4c95d]",
                (label === "P2" || label === "P3") && "border-[#d48a5f]/45 text-[#d48a5f]",
              )}
              key={`${label}-${index}`}
            >
              {label}
            </span>
          )) : (
            <p className="text-sm text-muted-foreground">Форма появится после первых результатов.</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <StitchMetric label="Очки" value={formatStat(profile.form.points)} />
          <StitchMetric label="Подиумы" value={formatStat(profile.form.podiums)} />
          <StitchMetric label="Сходы" value={formatStat(profile.form.dnfs)} />
          <StitchMetric label="Лучший финиш" value={formatPosition(profile.form.bestResult)} />
          <StitchMetric label="Средняя квалификация" value={formatDecimal(profile.form.averageQualifyingPosition)} />
          <StitchMetric label="Средняя позиция в гонке" value={formatDecimal(profile.form.averageFinishPosition)} />
        </div>
      </div>
    </StitchPanel>
  );
}

function TeammatePanel({ profile }: { profile: DriverProfile }) {
  const comparison = profile.teammateComparison;
  const teammateLastName = comparison.teammateNames
    .map((name) => name.trim().split(/\s+/).at(-1))
    .filter(Boolean)
    .join(", ") || "Напарник";
  const rows: Array<{
    label: string;
    driver: number | null;
    teammate: number | null;
    decimals?: boolean;
    lowerIsBetter?: boolean;
  }> = [
    { driver: comparison.qualifying.driver, label: "Квалификации", teammate: comparison.qualifying.teammate },
    { driver: comparison.races.driver, label: "Гонки", teammate: comparison.races.teammate },
    { driver: comparison.points.driver, label: "Очки", teammate: comparison.points.teammate },
    { driver: comparison.podiums.driver, label: "Подиумы", teammate: comparison.podiums.teammate },
    { driver: comparison.wins.driver, label: "Победы", teammate: comparison.wins.teammate },
    {
      decimals: true,
      driver: comparison.averageStart.driver,
      label: "Средний старт",
      lowerIsBetter: true,
      teammate: comparison.averageStart.teammate,
    },
    {
      decimals: true,
      driver: comparison.averageFinish.driver,
      label: "Средний финиш",
      lowerIsBetter: true,
      teammate: comparison.averageFinish.teammate,
    },
    { driver: comparison.dnfs.driver, label: "Сходы", lowerIsBetter: true, teammate: comparison.dnfs.teammate },
  ];

  return (
    <StitchPanel>
      <StitchPanelHeader icon={Users} title="Сравнение с напарником" />
      <div className="grid gap-1.5 p-3 sm:p-4">
        {rows.map((row) => {
          const driverBetter = isBetter(row.driver, row.teammate, row.lowerIsBetter);
          const teammateBetter = isBetter(row.teammate, row.driver, row.lowerIsBetter);
          const format = row.decimals ? formatDecimal : formatStat;

          return (
            <div
              className="grid grid-cols-[3.25rem_minmax(0,1fr)_3.25rem] items-center gap-2 rounded-md border border-border/70 bg-background/35 px-3 py-2"
              key={row.label}
            >
              <span
                className={cn(
                  "font-telemetry text-sm font-extrabold",
                  driverBetter ? "text-primary" : "text-muted-foreground",
                )}
              >
                {format(row.driver)}
              </span>
              <span className="min-w-0 truncate text-center text-xs font-semibold text-muted-foreground">
                {row.label}
              </span>
              <span
                className={cn(
                  "text-right font-telemetry text-sm font-extrabold",
                  teammateBetter ? "text-primary" : "text-muted-foreground",
                )}
              >
                {format(row.teammate)}
              </span>
            </div>
          );
        })}
        <p className="mt-1 flex items-center justify-between text-[0.62rem] font-semibold text-muted-foreground">
          <span className="text-primary">{profile.lastName}</span>
          <span>{teammateLastName}</span>
        </p>
      </div>
    </StitchPanel>
  );
}

function isBetter(a: number | null, b: number | null, lowerIsBetter?: boolean) {
  if (a === null || b === null || a === b) {
    return false;
  }

  return lowerIsBetter ? a < b : a > b;
}

function DeltaPanel({ profile }: { profile: DriverProfile }) {
  return (
    <StitchPanel>
      <StitchPanelHeader icon={Sparkles} title="Старт → финиш" />
      <div className="grid gap-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <StitchMetric label="Суммарно" value={formatDelta(profile.positionDelta.totalDelta)} />
          <StitchMetric label="В среднем" value={formatDelta(profile.positionDelta.averageDelta)} />
        </div>
        <ComparisonRow
          label="Лучший прорыв"
          value={profile.positionDelta.bestGain ? `+${profile.positionDelta.bestGain.value} · ${profile.positionDelta.bestGain.raceName}` : "—"}
        />
        <ComparisonRow
          label="Самая большая потеря"
          value={profile.positionDelta.biggestDrop ? `${profile.positionDelta.biggestDrop.value} · ${profile.positionDelta.biggestDrop.raceName}` : "—"}
        />
      </div>
    </StitchPanel>
  );
}

function DriverNewsPanel({ profile }: { profile: DriverProfile }) {
  return (
    <StitchPanel className="grid h-full min-w-0 grid-rows-[auto_1fr_auto] overflow-hidden">
      <StitchPanelHeader icon={Newspaper} title="Новости по гонщику" />
      {profile.news.length ? (
        <div className="divide-y divide-border">
          {profile.news.map((item) => (
            <Link
              className="group grid gap-2 p-4 transition-colors hover:bg-accent/35 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-start sm:p-5"
              href={item.href}
              key={item.href}
              prefetch={false}
            >
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
          <p className="mt-1 text-sm text-muted-foreground">Новости появятся после обновления ленты RaceSide.</p>
        </div>
      )}
      <div className="border-t border-border p-4">
        <Button asChild variant="secondary">
          <Link href={`/news?tag=driver-${profile.slug}`} prefetch={false}>
            Все новости гонщика
            <ChevronRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </StitchPanel>
  );
}

function DriverSocialPanel({ profile }: { profile: DriverProfile }) {
  return (
    <StitchPanel className="grid h-full min-w-0 grid-rows-[auto_1fr_auto] overflow-hidden">
      <StitchPanelHeader icon={Shield} title="Лента соцсетей" />
      <div className="divide-y divide-border">
        {profile.socialPosts.length ? profile.socialPosts.slice(0, 5).map((post) => (
          <a
            className="group block p-4 transition-colors hover:bg-accent/35"
            href={post.href}
            key={post.href}
            rel="noreferrer"
            target="_blank"
          >
            <div className="flex items-start justify-between gap-3">
              <Badge variant="outline">{post.source}</Badge>
              <span className="shrink-0 text-xs text-muted-foreground">{post.publishedAt}</span>
            </div>
            <p className="mt-2 line-clamp-3 text-sm font-semibold leading-6 group-hover:text-primary">{post.title}</p>
          </a>
        )) : (
          <div className="p-6 text-center">
            <p className="font-bold">Публикаций пока нет</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Новые сообщения появятся после обработки ленты.</p>
          </div>
        )}
      </div>
      <div className="mt-auto border-t border-border p-4">
        <Button asChild className="w-full" variant="secondary">
          <Link href={`/social?driver=driver-${profile.slug}`} prefetch={false}>
            Все публикации гонщика
            <ChevronRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </StitchPanel>
  );
}

function ComparisonRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-background/35 px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right font-telemetry text-sm font-bold">{value}</span>
    </div>
  );
}

function formatStat(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDecimal(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }

  return value.toFixed(1);
}

function formatPosition(value: number | null | undefined) {
  return value ? `P${value}` : "—";
}

function formatDelta(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }

  if (value > 0) {
    return `+${value}`;
  }

  return String(value);
}

function getDeltaClassName(value: number | null | undefined) {
  if (!value) {
    return "";
  }

  return value > 0 ? "text-success" : "text-danger";
}

function hexWithAlpha(hex: string | null | undefined, alpha: number) {
  if (!hex) {
    return null;
  }

  const normalized = hex.trim();

  if (!/^#([0-9a-f]{6})$/i.test(normalized)) {
    return null;
  }

  const r = parseInt(normalized.slice(1, 3), 16);
  const g = parseInt(normalized.slice(3, 5), 16);
  const b = parseInt(normalized.slice(5, 7), 16);

  return `rgb(${r} ${g} ${b} / ${alpha})`;
}
