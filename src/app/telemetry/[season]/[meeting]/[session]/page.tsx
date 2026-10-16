import { notFound } from "next/navigation";
import { TelemetryHub } from "@/features/telemetry/components/telemetry-hub";
import { getTelemetryCatalogPages } from "@/features/telemetry/lib/server";
import { telemetryFlags } from "@/features/telemetry/lib/flags";
import { createPageMetadata } from "@/lib/seo";
import { getSessionUser } from "@/lib/auth";
import { getSubscriptionAccess } from "@/lib/billing/access";
import { getTelemetryDemoScope } from "@/features/telemetry/lib/demo-access";
import { SubscriptionGateContent } from "@/components/racemate/subscription-gate";
import { billingFlags } from "@/lib/billing/config";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ season: string; meeting: string; session: string }>;
}) {
  const p = await params;
  const entry = (await getTelemetryCatalogPages()).find(
    (e) =>
      e.meeting.slug === p.meeting && e.meeting.season === Number(p.season),
  );
  const session = entry?.sessions.find((s) => s.slug === p.session);
  return createPageMetadata({
    title: `${entry?.meeting.name ?? "Гран-при"} ${p.season} — ${session?.name ?? "эволюция кругов"}`,
    description:
      "Телеметрия сессии: сравнение пилотов, скорости, газа и торможений по дистанции трассы.",
    path: `/telemetry/${p.season}/${p.meeting}/${p.session}`,
    noIndex: !session && p.session !== "evolution",
  });
}
export default async function SessionPage({
  params,
}: {
  params: Promise<{ season: string; meeting: string; session: string }>;
}) {
  const p = await params,
    season = Number(p.season),
    meeting = Number(p.meeting.match(/-(\d+)$/)?.[1]),
    session = Number(p.session.match(/-(\d+)$/)?.[1]);
  if (
    !Number.isInteger(season) ||
    season < 2023 ||
    season > new Date().getUTCFullYear() ||
    !meeting ||
    (!session && p.session !== "evolution") ||
    (p.session === "evolution" && !telemetryFlags.trackEvolution)
  )
    notFound();
  const user = await getSessionUser();
  if (!user && billingFlags.entitlementsEnforced) return <SubscriptionGateContent description="Войдите, чтобы открыть демо телеметрии." signedIn={false} title="Телеметрия начинается со входа" />;
  const access = await getSubscriptionAccess(user?.id ?? null);
  if (!access.entitlements.telemetry_full) {
    const demo = await getTelemetryDemoScope();
    const allowed = demo?.meeting.id === meeting && (!session || demo.sessions.some((item) => item.id === session));
    if (!allowed) return <SubscriptionGateContent description="Эта сессия доступна с RaceSide Plus. В демо открыта одна гонка с выбором любых пилотов и кругов." signedIn title="Откройте полную телеметрию" />;
  }
  return (
    <TelemetryHub
      demoMode={!access.entitlements.telemetry_full}
      initialSeason={season}
      initialMeeting={meeting}
      initialSession={session || undefined}
      initialMode={p.session === "evolution" ? "evolution" : "best"}
    />
  );
}
