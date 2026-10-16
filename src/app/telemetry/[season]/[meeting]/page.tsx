import { notFound } from "next/navigation";
import { TelemetryHub } from "@/features/telemetry/components/telemetry-hub";
import { getTelemetryCatalogPages } from "@/features/telemetry/lib/server";
import { createPageMetadata } from "@/lib/seo";
import { getSessionUser } from "@/lib/auth";
import { getSubscriptionAccess } from "@/lib/billing/access";
import { getTelemetryDemoScope } from "@/features/telemetry/lib/demo-access";
import { SubscriptionGateContent } from "@/components/racemate/subscription-gate";
import { billingFlags } from "@/lib/billing/config";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ season: string; meeting: string }>;
}) {
  const p = await params;
  const entry = (await getTelemetryCatalogPages()).find(
    (e) =>
      e.meeting.slug === p.meeting && e.meeting.season === Number(p.season),
  );
  return createPageMetadata({
    title: `${entry?.meeting.name ?? "Гран-при"} ${p.season} — телеметрия`,
    description: "Сравните лучшие круги, пилотов и сессии гоночного уикенда.",
    path: `/telemetry/${p.season}/${p.meeting}`,
    noIndex: !entry,
  });
}
export default async function MeetingPage({
  params,
}: {
  params: Promise<{ season: string; meeting: string }>;
}) {
  const p = await params,
    season = Number(p.season),
    id = Number(p.meeting.match(/-(\d+)$/)?.[1]);
  if (
    !Number.isInteger(season) ||
    season < 2023 ||
    season > new Date().getUTCFullYear() ||
    !id
  )
    notFound();
  const user = await getSessionUser();
  if (!user && billingFlags.entitlementsEnforced) return <SubscriptionGateContent description="Войдите, чтобы открыть демо телеметрии." signedIn={false} title="Телеметрия начинается со входа" />;
  const access = await getSubscriptionAccess(user?.id ?? null);
  if (!access.entitlements.telemetry_full) {
    const demo = await getTelemetryDemoScope();
    if (!demo || demo.meeting.id !== id) return <SubscriptionGateContent description="Этот Гран-при доступен с RaceSide Plus. В демо открыта одна гонка с выбором любых пилотов и кругов." signedIn title="Откройте полную телеметрию" />;
  }
  return <TelemetryHub demoMode={!access.entitlements.telemetry_full} initialSeason={season} initialMeeting={id} />;
}
