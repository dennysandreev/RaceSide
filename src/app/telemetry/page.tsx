import { TelemetryHub } from "@/features/telemetry/components/telemetry-hub";
import { SubscriptionGateContent } from "@/components/racemate/subscription-gate";
import { getSessionUser } from "@/lib/auth";
import { getSubscriptionAccess } from "@/lib/billing/access";
import { billingFlags } from "@/lib/billing/config";
import { createPageMetadata } from "@/lib/seo";
import { parsePaceLapRange } from "@/features/telemetry/lib/race-pace";
export const metadata = createPageMetadata({
  title: "Телеметрия Формулы-1",
  description:
    "Сравнение кругов, скорости, торможений и траекторий пилотов. Узнайте, на каких участках было выиграно время.",
  path: "/telemetry",
});
export default async function TelemetryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const value = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : undefined;
  const id = (key: string) => {
    const number = Number(value(key));
    return Number.isInteger(number) && number > 0 && number <= 1_000_000
      ? number
      : undefined;
  };
  const user = await getSessionUser();
  if (!user && billingFlags.entitlementsEnforced)
    return (
      <SubscriptionGateContent
        description="Войдите, чтобы бесплатно разбирать круги и темп одной гонки. Другие сессии доступны с RaceSide Plus."
        signedIn={false}
        title="Телеметрия начинается со входа"
      />
    );
  const access = await getSubscriptionAccess(user?.id ?? null);
  const demoMode = !access.entitlements.telemetry_full;
  return (
    <TelemetryHub
      demoMode={demoMode}
      initialRacePace={value("mode") === "race-pace"}
      initialSeason={id("season")}
      initialMeeting={id("meeting")}
      initialSession={id("session")}
      initialPaceView={{
        section: value("view") === "distribution" ? "distribution" : "trend",
        distributionScope: value("scope") === "selected" ? "selected" : "field",
        axis: value("axis") === "age" ? "age" : "lap",
        compound: value("compound")?.slice(0, 24),
        compounds: value("compounds")?.split(",").slice(0, 6),
        drivers: value("drivers")
          ?.split(",")
          .map(Number)
          .filter(
            (number) => Number.isInteger(number) && number > 0 && number < 100,
          )
          .slice(0, 6),
        hidePits: (value("pits") ?? value("clean")) !== "0",
        hideSafetyCar: (value("safety") ?? value("clean")) !== "0",
        trend: value("trend") !== "0",
        field: value("field") === "1",
        lapRange: parsePaceLapRange(value("from"), value("to")),
      }}
    />
  );
}
