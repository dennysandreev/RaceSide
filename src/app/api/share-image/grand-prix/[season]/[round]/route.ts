import { ImageResponse } from "next/og";
import { createElement } from "react";

import { GrandPrixRecapShareImage } from "@/components/racemate/grand-prix-recap-share-image";
import { getGrandPrixReportAnalytics } from "@/data/grand-prix-report-analytics";
import {
  getRaceDetail,
  getRaceGrandPrixReport,
  getRaceSessions,
  getSessionResultsBySessionIds,
} from "@/data/racemate-repository";
import {
  buildGrandPrixRecapData,
  getGrandPrixRecapImageLayout,
} from "@/lib/grand-prix-recap";
import { getPredictionShareFonts } from "@/lib/prediction-share-fonts";
import { consumeIpRateLimit, getRetryAfterSeconds } from "@/lib/rate-limit";
import { readPublicShareImageDataUrl } from "@/lib/share-image-assets";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ round: string; season: string }> },
) {
  const limit = await consumeIpRateLimit("api:grand-prix-recap-share-image", request, 30, 60_000);

  if (!limit.ok) {
    return new Response("Too many requests", {
      headers: { "Retry-After": getRetryAfterSeconds(limit.resetAt) },
      status: 429,
    });
  }

  const { round: roundValue, season: seasonValue } = await params;
  const season = Number(seasonValue);
  const round = Number(roundValue);

  if (!Number.isInteger(season) || !Number.isInteger(round) || season < 1950 || round < 1) {
    return new Response("Invalid race", { status: 400 });
  }

  const [race, report, sessions] = await Promise.all([
    getRaceDetail(season, round),
    getRaceGrandPrixReport(season, round),
    getRaceSessions(season, round),
  ]);

  if (!race || !report || !sessions.length) {
    return new Response("Recap is not ready", { status: 404 });
  }

  const [resultsBySession, analytics] = await Promise.all([
    getSessionResultsBySessionIds(sessions.map((session) => session.id), season),
    getGrandPrixReportAnalytics(report).catch(() => null),
  ]);
  const data = buildGrandPrixRecapData({ race, report, resultsBySession, sessions, analytics });

  if (!data) {
    return new Response("Recap is not ready", { status: 404 });
  }

  const [fonts, ...avatarUrls] = await Promise.all([
    getPredictionShareFonts(),
    ...data.podium.map((entry) => embedPublicImage(entry.avatarPath)),
  ]);

  return new ImageResponse(
    createElement(GrandPrixRecapShareImage, {
      data: {
        ...data,
        podium: data.podium.map((entry, index) => ({
          ...entry,
          avatarUrl: avatarUrls[index] ?? null,
        })),
      },
    }),
    {
      fonts,
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=900",
        "Content-Disposition": `inline; filename="raceside-${season}-round-${round}-recap.png"`,
      },
      height: getGrandPrixRecapImageLayout(data.raceName).canvasHeight,
      width: 1080,
    },
  );
}

function embedPublicImage(value: string | null) {
  return value ? readPublicShareImageDataUrl(value) : Promise.resolve(null);
}
