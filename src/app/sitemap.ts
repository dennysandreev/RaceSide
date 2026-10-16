import { getTelemetryCatalogPages } from "@/features/telemetry/lib/server";
import { telemetryFlags } from "@/features/telemetry/lib/flags";
import type { MetadataRoute } from "next";

import { legalPages, staticDocumentPages } from "@/content/static-pages";
import {
  getCalendarEvents,
  getDriverStandings,
  getPublishedSeasons,
  getSitemapNewsEntries,
  getTeamProfiles,
} from "@/data/racemate-repository";
import { CURRENT_F1_SEASON } from "@/lib/season-navigation";
import { absoluteUrl } from "@/lib/seo";

export const revalidate = 3_600;

const staticPaths = [
  "",
  "/news",
  "/social",
  "/calendar",
  "/weekend",
  "/leaderboard",
  "/drivers",
  "/teams",
  "/fantasy",
  "/fantasy/leaderboard",
  "/leagues",
  "/polls",
  "/feedback",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    ...staticPaths.map((path) => ({ url: absoluteUrl(path || "/") })),
    ...Object.keys(staticDocumentPages).map((slug) => ({
      lastModified: new Date("2026-07-01T00:00:00.000Z"),
      url: absoluteUrl(`/${slug}`),
    })),
    ...Object.keys(legalPages).map((slug) => ({
      lastModified: new Date("2026-07-01T00:00:00.000Z"),
      url: absoluteUrl(`/legal/${slug}`),
    })),
  ];

  try {
    const [publishedSeasons, news] = await Promise.all([
      getPublishedSeasons(),
      getSitemapNewsEntries(),
    ]);
    const seasonEntries = await Promise.all(
      publishedSeasons.map(async (season) => {
        const [calendar, drivers, teams] = await Promise.all([
          getCalendarEvents(season),
          getDriverStandings(season),
          getTeamProfiles(season),
        ]);

        return { calendar, drivers, season, teams };
      }),
    );

    entries.push(
      ...news.map((item) => ({
        ...(item.modifiedAt || item.publishedAt ? { lastModified: item.modifiedAt ?? item.publishedAt! } : {}),
        url: absoluteUrl(`/news/${item.slug}`),
      })),
    );

    for (const { calendar, drivers, season, teams } of seasonEntries) {
      const seasonQuery = season === CURRENT_F1_SEASON ? "" : `?season=${season}`;

      entries.push(
        { url: absoluteUrl(`/calendar${seasonQuery}`) },
        { url: absoluteUrl(`/leaderboard${seasonQuery}`) },
        { url: absoluteUrl(`/drivers${seasonQuery}`) },
        {
          url: absoluteUrl(
            season === CURRENT_F1_SEASON
              ? "/leaderboard?table=constructors"
              : `/leaderboard?season=${season}&table=constructors`,
          ),
        },
        { url: absoluteUrl(`/teams${seasonQuery}`) },
        ...calendar.map((race) => ({
          url: absoluteUrl(`/calendar/${season}/${race.round}`),
        })),
        ...drivers.flatMap((driver) =>
          driver.driverSlug
            ? [{
                url: absoluteUrl(
                  season === CURRENT_F1_SEASON
                    ? `/drivers/${driver.driverSlug}`
                    : `/drivers/${driver.driverSlug}?season=${season}`,
                ),
              }]
            : [],
        ),
        ...teams.map((team) => ({
          url: absoluteUrl(
            season === CURRENT_F1_SEASON
              ? `/teams/${team.slug}`
              : `/teams/${team.slug}?season=${season}`,
          ),
        })),
      );
    }
  } catch {
    // Keep the static sitemap available during a temporary database outage.
  }

  if (telemetryFlags.telemetryHub) {
    entries.push({ url: absoluteUrl("/telemetry") });
    for (const { meeting, sessions } of await getTelemetryCatalogPages()) {
      entries.push({ url: absoluteUrl(`/telemetry/${meeting.season}/${meeting.slug}`) });
      for (const session of sessions) entries.push({ url: absoluteUrl(`/telemetry/${meeting.season}/${meeting.slug}/${session.slug}`) });
    }
  }
  return deduplicateSitemap(entries);
}

function deduplicateSitemap(entries: MetadataRoute.Sitemap) {
  return [...new Map(entries.map((entry) => [entry.url, entry])).values()];
}
