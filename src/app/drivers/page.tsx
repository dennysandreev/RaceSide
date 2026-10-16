import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { GitCompareArrows, UsersRound } from "lucide-react";

import { DriverDirectory } from "@/components/racemate/driver-directory";
import { JsonLd } from "@/components/racemate/json-ld";
import { PageTitle } from "@/components/racemate/page-title";
import { SeasonSwitcher } from "@/components/racemate/season-switcher";
import { getDriverDirectory, getPublishedSeasons } from "@/data/racemate-repository";
import {
  CURRENT_F1_SEASON,
  resolvePublishedSeason,
  type SeasonSearchParams,
} from "@/lib/season-navigation";
import { absoluteUrl, buildSeasonPath, createPageMetadata } from "@/lib/seo";

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
      description: "Пилоты запрошенного сезона пока недоступны.",
      noIndex: true,
      path: "/drivers",
      title: "Пилоты не найдены",
    });
  }

  return createPageMetadata({
    description: `Пилоты Формулы-1 сезона ${season}: составы команд, позиции, очки и переход к сравнению результатов по этапам.`,
    path: buildSeasonPath("/drivers", season, CURRENT_F1_SEASON),
    title: `Пилоты Формулы-1 ${season}`,
  });
}

export default async function DriversPage({
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

  const teams = await getDriverDirectory(season);
  const drivers = teams.flatMap((team) => team.drivers);

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          hasPart: {
            "@type": "ItemList",
            itemListElement: drivers.map((driver, index) => ({
              "@type": "ListItem",
              item: absoluteUrl(
                season === CURRENT_F1_SEASON
                  ? `/drivers/${driver.slug}`
                  : `/drivers/${driver.slug}?season=${season}`,
              ),
              name: driver.fullName,
              position: index + 1,
            })),
          },
          inLanguage: "ru-RU",
          name: `Пилоты Формулы-1 ${season}`,
          url: absoluteUrl(buildSeasonPath("/drivers", season, CURRENT_F1_SEASON)),
        }}
      />

      <div className="grid gap-5 pb-6 sm:pb-8">
        <header className="stitch-panel relative min-h-[11.5rem] overflow-hidden p-4 sm:p-5 lg:h-40 lg:min-h-0">
          <Image
            alt=""
            className="object-cover object-right opacity-80 lg:object-center"
            fill
            priority
            sizes="(max-width: 768px) 100vw, 72rem"
            src="/stitch/drivers-hero.webp"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background via-background/76 to-background/18" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgb(225_6_0_/_0.2),transparent_22rem),linear-gradient(135deg,rgb(255_255_255_/_0.04),transparent_48%)]" />
          <div className="relative z-10 grid gap-3 lg:h-full lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <p className="stitch-label flex items-center gap-2 text-primary">
                <UsersRound aria-hidden="true" className="size-4" />
                Пилоты · сезон {season}
              </p>
              <PageTitle className="mt-2">Пилоты Формулы-1</PageTitle>
              <SeasonSwitcher
                activeSeason={season}
                className="mt-3"
                pathname="/drivers"
                query={query}
                seasons={publishedSeasons}
              />
            </div>
            <div className="hidden items-center gap-3 rounded-md border border-border bg-background/35 px-4 py-2 lg:flex">
              <GitCompareArrows aria-hidden="true" className="size-5 text-primary" />
              <div>
                <p className="font-telemetry text-xl font-extrabold">{drivers.length}</p>
                <p className="text-xs font-semibold text-muted-foreground">пилотов в сезоне</p>
              </div>
            </div>
          </div>
        </header>

        {teams.length ? (
          <DriverDirectory season={season} teams={teams} />
        ) : (
          <div className="stitch-panel p-8 text-center">
            <p className="font-display text-xl font-bold">Пилоты появятся после обновления чемпионата</p>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
              RaceSide покажет составы команд, как только сезонные данные будут готовы.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
