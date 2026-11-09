import Link from "next/link";
import { Play } from "lucide-react";

import { DriverAvatarBadge } from "@/components/racemate/driver-avatar-badge";
import { GrandPrixRecapShare } from "@/components/racemate/grand-prix-recap-share";
import { NavigationLoadingLink } from "@/components/racemate/navigation-loading-link";
import { Button } from "@/components/ui/button";
import { getTeamAsset } from "@/data/f1-assets";
import { cn } from "@/lib/utils";
import type { GrandPrixReport, RaceReplaySummary } from "@/types/racemate";

type GrandPrixPodiumPreviewProps = {
  className?: string;
  compact?: boolean;
  compactShareAction?: boolean;
  driverSlugByName?: Record<string, string>;
  href: string;
  report: GrandPrixReport;
  replay?: RaceReplaySummary | null;
  showRaceHeading?: boolean;
  showShareAction?: boolean;
};

const podiumTone: Record<number, { step: string; text: string; ring: string }> = {
  1: { ring: "#f4c95d", step: "bg-[#f4c95d] text-[#211a05]", text: "text-[#f4c95d]" },
  2: { ring: "#cbd5e1", step: "bg-[#cbd5e1] text-[#111827]", text: "text-[#cbd5e1]" },
  3: { ring: "#d48a5f", step: "bg-[#d48a5f] text-[#2a1608]", text: "text-[#d48a5f]" },
};

// Классический порядок ступеней: серебро слева, золото по центру, бронза справа.
const podiumOrder = [2, 1, 3];
const stepHeight: Record<number, string> = { 1: "h-14", 2: "h-10", 3: "h-8" };
const compactStepHeight: Record<number, string> = { 1: "h-10", 2: "h-8", 3: "h-7" };

export function GrandPrixPodiumPreview({
  className,
  compact = false,
  compactShareAction = false,
  driverSlugByName = {},
  href,
  report,
  replay,
  showRaceHeading = true,
  showShareAction = true,
}: GrandPrixPodiumPreviewProps) {
  const podium = report.results.slice(0, 3);

  return (
    <div className={cn("grid", compact ? "gap-2.5" : "gap-4", className)}>
      {showRaceHeading ? (
        <div className="min-w-0">
          <Link
            className="inline-block rounded-sm font-display text-lg font-bold leading-tight transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={`/calendar/${report.season}/${report.round}`}
            prefetch={false}
          >
            {report.raceName}
          </Link>
          <p className="mt-1 text-xs text-muted-foreground">{report.raceDate}</p>
        </div>
      ) : null}

      {podium.length >= 3 ? (
        <div className="grid grid-cols-3 items-end gap-2">
          {podiumOrder.map((rank) => {
            const result = podium[rank - 1];
            const team = getTeamAsset(result.team);
            const tone = podiumTone[rank];
            const isCenter = rank === 1;
            const slug = getDriverSlug(driverSlugByName, result.driver);

            return (
              <div className="flex min-w-0 flex-col items-center text-center" key={`${result.position}-${result.driver}`}>
                {slug ? (
                  <Link
                    aria-label={`Открыть профиль: ${result.driver}`}
                    className="group flex w-full min-w-0 flex-col items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    href={`/drivers/${slug}`}
                    prefetch={false}
                  >
                    <DriverAvatarBadge
                      className={isCenter ? "size-16" : "size-12"}
                      color={team?.color ?? tone.ring}
                      name={result.driver}
                      sizes={isCenter ? "4rem" : "3rem"}
                      slug={slug}
                    />
                    <span className={cn("w-full truncate font-bold leading-tight transition-colors group-hover:text-primary", compact ? "mt-1 text-xs" : "mt-1.5 text-sm")}>
                      {getShortDriverName(result.driver)}
                    </span>
                  </Link>
                ) : (
                  <>
                    <DriverAvatarBadge
                      className={isCenter ? "size-16" : "size-12"}
                      color={team?.color ?? tone.ring}
                      name={result.driver}
                      sizes={isCenter ? "4rem" : "3rem"}
                      slug={slug}
                    />
                    <p className={cn("w-full truncate font-bold leading-tight", compact ? "mt-1 text-xs" : "mt-1.5 text-sm")}>
                      {getShortDriverName(result.driver)}
                    </p>
                  </>
                )}
                <p className={cn("mt-0.5 flex min-w-0 max-w-full items-center gap-1 font-semibold text-muted-foreground", compact ? "text-[0.6rem]" : "text-[0.65rem]")}>
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: team?.color ?? tone.ring }}
                  />
                  <span className="truncate">{result.team}</span>
                </p>
                <div
                  className={cn(
                    "grid w-full place-items-center rounded-t-md",
                    compact ? "mt-1.5" : "mt-2",
                    compact ? compactStepHeight[rank] : stepHeight[rank],
                    tone.step,
                  )}
                >
                  <span className={cn("font-display font-black leading-none", compact ? "text-base" : "text-lg")}>{rank}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-md border border-border/70 p-4 text-sm leading-6 text-muted-foreground">
          Подиум появится после синхронизации итоговой классификации.
        </p>
      )}

      <div className={cn("grid", compact ? "gap-1.5" : "gap-2", replay && !compact ? "sm:grid-cols-2" : "")}>
        <div className="flex min-w-0 items-center gap-2">
          <Button asChild className="min-w-0 flex-1 justify-center text-center" size={compact ? "sm" : "default"}>
            <Link className="justify-center text-center" href={href} prefetch={false} scroll={false}>
              Открыть полный отчет
            </Link>
          </Button>
          {showShareAction && compactShareAction ? (
            <GrandPrixRecapShare
              compact
              raceName={report.raceName}
              round={report.round}
              season={report.season}
            />
          ) : null}
        </div>
        {replay ? (
          <Button asChild className="w-full" size={compact ? "sm" : "default"} variant="secondary">
            <NavigationLoadingLink
              href={replay.href}
              loadingLabel={`Готовим повтор Гран-при ${replay.sourceSeason}`}
              prefetch={false}
            >
              <Play aria-hidden="true" data-icon="inline-start" />
              {compact ? `Повтор ${replay.sourceSeason}` : `Гран-при ${replay.sourceSeason}`}
            </NavigationLoadingLink>
          </Button>
        ) : null}
      </div>
      {showShareAction && !compactShareAction ? (
        <GrandPrixRecapShare
          raceName={report.raceName}
          round={report.round}
          season={report.season}
        />
      ) : null}
    </div>
  );
}

function getDriverSlug(driverSlugByName: Record<string, string>, driverName: string) {
  return driverSlugByName[normalizeDriverName(driverName)];
}

function normalizeDriverName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getShortDriverName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  if (parts.at(-1)?.toLowerCase() === "antonelli") {
    return "K. Antonelli";
  }

  if (parts.length < 2) {
    return parts[0] ?? fullName;
  }

  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}
