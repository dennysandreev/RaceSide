import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readPublicShareImageDataUrl } from "@/lib/share-image-assets";
import { normalizeDriverAvatarSlug } from "@/lib/driver-avatar-slug";
import { ImageResponse } from "next/og";
import { createElement } from "react";
import { telemetryFlags } from "@/features/telemetry/lib/flags";
import { telemetryStore } from "@/features/telemetry/lib/server";
import {
  TelemetryShareImage,
  shareFormats,
  shareImageScale,
  type ShareFormat,
} from "@/features/telemetry/lib/share-image";
import { getPredictionShareFonts } from "@/lib/prediction-share-fonts";
import { consumeIpRateLimit, getRetryAfterSeconds } from "@/lib/rate-limit";
import type { Meeting } from "@/features/telemetry/lib/types";
import { getSessionUser } from "@/lib/auth";
import { getSubscriptionAccess } from "@/lib/billing/access";
import { configUsesDemoSessions, getTelemetryDemoScope } from "@/features/telemetry/lib/demo-access";
import { billingFlags } from "@/lib/billing/config";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!telemetryFlags.telemetryHub || !telemetryFlags.telemetryShare)
    return new Response(null, { status: 404 });
  const user = await getSessionUser();
  if (!user && billingFlags.entitlementsEnforced) return new Response(null, { status: 401 });
  const limit = await consumeIpRateLimit(
    "api:telemetry-image",
    request,
    20,
    60000,
  );
  if (!limit.ok)
    return new Response(null, {
      status: 429,
      headers: { "Retry-After": getRetryAfterSeconds(limit.resetAt) },
    });
  const { id } = await params,
    query = new URL(request.url).searchParams,
    requestedFormat = query.get("format") ?? "horizontal",
    format =
      requestedFormat === "landscape"
        ? "horizontal"
        : requestedFormat === "post" || requestedFormat === "story"
          ? "vertical"
          : requestedFormat;
  if (!(format in shareFormats)) return new Response(null, { status: 400 });
  try {
    const saved = await telemetryStore().getComparison(id);
    if (!saved) return new Response(null, { status: 404 });
    const access = await getSubscriptionAccess(user?.id ?? null);
    if (!access.entitlements.telemetry_full) {
      const demo = await getTelemetryDemoScope();
      if (!demo || !configUsesDemoSessions(saved.comparison.config, demo)) return new Response(null, { status: 403 });
    }
    const session = saved.comparison.traces[0].session;
    const [meetings, portraits, fonts, monoBytes] = await Promise.all([
      telemetryStore().get<Meeting[]>(`meetings:${session.season}`),
      Promise.all(
        saved.comparison.traces.slice(0, 2).map((trace) => {
          const slug = normalizeDriverAvatarSlug(trace.driver.name);
          return readPublicShareImageDataUrl(
            `/drivers/avatars/${trace.session.season}/${slug}.webp`,
          );
        }),
      ),
      getPredictionShareFonts(),
      readFile(
        join(
          process.cwd(),
          "node_modules/geist/dist/fonts/geist-mono/GeistMono-Bold.ttf",
        ),
      ),
    ]);
    const [width, height] = shareFormats[format as ShareFormat];
    return new ImageResponse(
      createElement(TelemetryShareImage, {
        comparison: saved.comparison,
        format: format as ShareFormat,
        meetingName: meetings?.find(
          (meeting) => meeting.id === session.meetingId,
        )?.name,
        portraits,
      }),
      {
        width: width * shareImageScale,
        height: height * shareImageScale,
        fonts: [
          ...fonts,
          {
            name: "Geist Mono",
            data: monoBytes.buffer.slice(
              monoBytes.byteOffset,
              monoBytes.byteOffset + monoBytes.byteLength,
            ) as ArrayBuffer,
            weight: 700,
            style: "normal",
          },
        ],
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `${query.has("download") ? "attachment" : "inline"}; filename="raceside-telemetry-${format}-${id}.png"`,
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch {
    return new Response("Не удалось создать карточку.", { status: 503 });
  }
}
