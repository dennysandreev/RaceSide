import Link from "next/link";
import { Trophy } from "lucide-react";

import { DriverAvatarBadge } from "@/components/racemate/driver-avatar-badge";
import type { ConfirmedSeasonChampion } from "@/data/season-champions";

export function SeasonChampionBadge({ champion }: { champion: ConfirmedSeasonChampion }) {
  return (
    <Link
      aria-label={`${champion.name}, чемпион мира ${champion.season}. Открыть профиль`}
      className="group inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      href={`/drivers/${champion.driverSlug}?season=${champion.season}`}
      prefetch={false}
    >
      <span className="relative flex size-10 shrink-0">
        <DriverAvatarBadge
          className="size-10"
          color="#c79632"
          name={champion.name}
          season={champion.season}
          sizes="2.5rem"
          slug={champion.driverSlug}
        />
        <span className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-background text-amber-700 ring-2 ring-background dark:text-amber-300">
          <Trophy aria-hidden="true" className="size-3" />
        </span>
      </span>
      <span className="grid gap-0.5 leading-tight">
        <span className="text-[0.65rem] font-medium text-amber-700 dark:text-amber-300">Чемпион мира</span>
        <span className="whitespace-nowrap text-xs font-bold transition-colors group-hover:text-amber-700 motion-reduce:transition-none dark:group-hover:text-amber-300 sm:text-sm">
          {champion.name}
        </span>
      </span>
    </Link>
  );
}
