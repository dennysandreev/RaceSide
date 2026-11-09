import { createElement } from "react";
import { ImageResponse } from "next/og";
import { getSessionUser } from "@/lib/auth";
import { getSubscriptionAccess } from "@/lib/billing/access";
import { billingFlags } from "@/lib/billing/config";
import { consumeIpRateLimit, getRetryAfterSeconds } from "@/lib/rate-limit";
import { getPredictionShareFonts } from "@/lib/prediction-share-fonts";
import { telemetryFlags } from "@/features/telemetry/lib/flags";
import { telemetryStore, resultKey } from "@/features/telemetry/lib/server";
import { getTelemetryDemoScope } from "@/features/telemetry/lib/demo-access";
import { SessionMetricsShareImage } from "@/features/telemetry/lib/session-metrics-share-image";
import { shareFormats, shareImageScale } from "@/features/telemetry/lib/share-image";
import type { Meeting, SessionMetrics } from "@/features/telemetry/lib/types";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ session: string }> }) {
  if (!telemetryFlags.telemetryHub || !telemetryFlags.telemetryShare) return new Response(null, { status: 404 });
  const user = await getSessionUser();
  if (!user && billingFlags.entitlementsEnforced) return new Response(null, { status: 401 });
  const access = await getSubscriptionAccess(user?.id ?? null);
  const query = new URL(request.url).searchParams;
  const session = Number((await params).session), format = query.get("format") ?? "horizontal";
  if (!Number.isSafeInteger(session) || session <= 0 || session > 1_000_000 || (format !== "horizontal" && format !== "vertical")) return new Response(null, { status: 400 });
  if (!access.entitlements.telemetry_full) {
    const demo = await getTelemetryDemoScope();
    if (!demo?.sessions.some((item) => item.id === session)) return new Response(null, { status: 403 });
  }
  const limit = await consumeIpRateLimit("api:session-metrics-image", request, 20, 60000);
  if (!limit.ok) return new Response(null, { status: 429, headers: { "Retry-After": getRetryAfterSeconds(limit.resetAt) } });
  try {
    const store = telemetryStore();
    const data = await store.get<SessionMetrics>(resultKey({ kind: "session-metrics", session }));
    if (!data) return new Response("Сначала откройте скорость и газ этой сессии.", { status: 409 });
    const metric = query.get("metric") === "throttle" ? "throttle" : query.get("metric") === "map" ? "map" : "speed";
    const [fonts, meetings] = await Promise.all([
      getPredictionShareFonts(), store.get<Meeting[]>(`meetings:${data.session.season}`),
    ]);
    const [width, height] = shareFormats[format];
    return new ImageResponse(createElement(SessionMetricsShareImage, {
      data, metric, format, meetingName: meetings?.find((meeting) => meeting.id === data.session.meetingId)?.name,
    }), { width: width * shareImageScale, height: height * shareImageScale, fonts,
      headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="raceside-session-${session}-${metric}-${format}.png"` } });
  } catch {
    return new Response("Не удалось создать карточку. Попробуйте ещё раз.", { status: 503 });
  }
}
