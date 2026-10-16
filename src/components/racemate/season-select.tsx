"use client";

import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

type SeasonSelectProps = {
  activeSeason: number;
  className?: string;
  hrefBySeason: Record<number, string>;
  onNavigate?: (season: number) => void;
  onSeasonChange?: (season: number) => void;
  seasons: number[];
};

export function SeasonSelect({
  activeSeason,
  className,
  hrefBySeason,
  onNavigate,
  onSeasonChange,
  seasons,
}: SeasonSelectProps) {
  const router = useRouter();

  return (
    <label className={cn("relative block sm:hidden", className)}>
      <span className="sr-only">Сезон</span>
      <select
        aria-label="Сезон"
        className="font-telemetry h-11 w-full appearance-none rounded-md border border-border/80 bg-background/80 px-3 pr-9 text-xs font-extrabold uppercase tracking-[0.08em] text-foreground shadow-sm outline-none backdrop-blur-sm transition-[border-color,background-color] duration-200 hover:bg-accent focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        onChange={(event) => {
          const season = Number(event.target.value);
          const href = hrefBySeason[season];
          if (href) {
            onNavigate?.(season);
            if (onSeasonChange) onSeasonChange(season);
            else router.push(href);
          }
        }}
        value={activeSeason}
      >
        {seasons.map((season) => (
          <option key={season} value={season}>
            Сезон {season}
          </option>
        ))}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.65rem] text-muted-foreground"
      >
        ▼
      </span>
    </label>
  );
}
