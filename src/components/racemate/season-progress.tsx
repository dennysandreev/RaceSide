import { CalendarClock } from "lucide-react";
import Link from "next/link";

import { RaceFlag } from "@/components/racemate/race-flag";
import { SeasonChampionBadge } from "@/components/racemate/season-champion-badge";
import { getConfirmedSeasonChampion } from "@/data/season-champions";
import { cn } from "@/lib/utils";

type NextRaceSummary = {
  country: string;
  countryCode?: string | null;
  countryFlag?: string | null;
  date: string;
  race: string;
};

export function SeasonProgress({
  className,
  completedCount,
  nextRace,
  season,
  totalCount,
}: {
  className?: string;
  completedCount: number;
  nextRace: NextRaceSummary | null;
  season: number;
  totalCount: number;
}) {
  const champion = getConfirmedSeasonChampion(season);
  const progressPercent = totalCount
    ? Math.round((completedCount / totalCount) * 100)
    : 0;

  return (
    <div
      className={cn(
        "season-progress grid gap-3 rounded-md border border-border/80 bg-background/78 px-3 py-2.5 shadow-sm backdrop-blur-md",
        className,
      )}
    >
      <div className={cn("flex justify-between", champion ? "items-center gap-3" : "items-end gap-4")}>
        <div className="min-w-0">
          <p className="stitch-label text-foreground/75">Прогресс сезона</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="font-display text-2xl font-extrabold leading-none">
              {progressPercent}%
            </p>
            {champion ? (
              <p className="font-telemetry text-[0.65rem] text-muted-foreground">{completedCount} / {totalCount}</p>
            ) : null}
          </div>
        </div>
        {champion ? (
          <SeasonChampionBadge champion={champion} />
        ) : (
          <p className="font-telemetry text-sm font-bold text-foreground/75">
            {completedCount} / {totalCount}
          </p>
        )}
      </div>
      <div
        aria-label={`Прогресс сезона ${season}`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progressPercent}
        aria-valuetext={`Завершено ${completedCount} из ${totalCount} этапов`}
        className="h-1.5 overflow-hidden rounded-full bg-foreground/15"
        role="progressbar"
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      {nextRace ? (
        <Link
          className="flex min-w-0 items-center gap-1.5 rounded-sm text-xs font-semibold text-foreground/75 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href="/weekend"
          prefetch={false}
        >
          <CalendarClock aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="shrink-0">Следующий этап:</span>
          <RaceFlag
            countryCode={nextRace.countryCode}
            label={nextRace.country}
            value={nextRace.countryFlag}
          />
          <span className="truncate">{nextRace.race} · {nextRace.date}</span>
        </Link>
      ) : (
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-foreground/75">
          <CalendarClock aria-hidden="true" className="size-3.5 shrink-0" />
          <span>{totalCount > 0 && completedCount >= totalCount ? "Сезон завершён" : "Следующий этап уточняется"}</span>
        </p>
      )}
    </div>
  );
}
