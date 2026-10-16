"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { createPortal } from "react-dom";

import { ProfileLoadingOverlay } from "@/components/racemate/profile-loading-overlay";
import { SeasonSelect } from "@/components/racemate/season-select";
import { buildSeasonHref, type SeasonSearchParams } from "@/lib/season-navigation";
import { cn } from "@/lib/utils";

type SeasonSwitcherProps = {
  activeSeason: number;
  className?: string;
  expandDirection?: "left" | "right";
  label?: string;
  loadingLabel?: string;
  onSeasonChange?: (season: number) => void;
  pathname: string;
  query?: SeasonSearchParams;
  seasons: number[];
};

export function SeasonSwitcher({
  activeSeason,
  className,
  expandDirection = "right",
  label = "Сезон",
  loadingLabel,
  onSeasonChange,
  pathname,
  query = {},
  seasons,
}: SeasonSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [pendingSeason, setPendingSeason] = useState<number | null>(null);
  const navId = useId();
  const normalizedSeasons = [...new Set(seasons)].sort((a, b) => b - a);

  if (!normalizedSeasons.length) {
    return null;
  }

  if (normalizedSeasons.length === 1) {
    return (
      <div className={cn("font-telemetry inline-flex h-11 items-center rounded-md border border-border/80 bg-background/70 px-3 text-[0.68rem] font-extrabold uppercase text-muted-foreground backdrop-blur-sm", className)}>
        {label} {normalizedSeasons[0]}
      </div>
    );
  }

  const otherSeasons = normalizedSeasons
    .filter((season) => season !== activeSeason)
    .sort((a, b) => expandDirection === "left" ? a - b : b - a);
  const DirectionIcon = expandDirection === "left" ? ChevronLeft : ChevronRight;
  const hrefBySeason = Object.fromEntries(
    normalizedSeasons.map((season) => [season, buildSeasonHref(pathname, season, query)]),
  );

  return (
    <>
      <SeasonSelect
        activeSeason={activeSeason}
        className={className}
        hrefBySeason={hrefBySeason}
        onNavigate={(season) => {
          if (loadingLabel) {
            setPendingSeason(season);
          }
        }}
        onSeasonChange={onSeasonChange}
        seasons={normalizedSeasons}
      />

      <div
        className={cn(
          "hidden max-w-full min-w-0 items-center gap-1 sm:flex",
          expandDirection === "left" && "flex-row-reverse",
          className,
        )}
      >
        <button
          aria-controls={navId}
          aria-expanded={open}
          className="font-telemetry inline-flex h-11 shrink-0 items-center gap-2 rounded-md border border-border/80 bg-background/75 px-3 text-[0.68rem] font-extrabold uppercase text-foreground shadow-sm backdrop-blur-sm transition-colors duration-200 hover:border-primary/45 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <span>{label} {activeSeason}</span>
          <DirectionIcon
            aria-hidden="true"
            className={cn(
              "size-3.5 transition-transform duration-200 motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </button>

        {open ? (
          <div className="min-w-0 max-w-full overflow-x-auto" id={navId}>
            <nav
              aria-label="Выбрать сезон"
              className="flex w-max items-center gap-1 rounded-md border border-border/80 bg-background/75 p-1 shadow-sm backdrop-blur-sm"
            >
              {otherSeasons.map((season) => {
                const className =
                  "font-telemetry inline-flex h-9 min-w-12 items-center justify-center rounded-sm px-2.5 text-[0.68rem] font-extrabold text-muted-foreground outline-none transition-colors duration-200 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none";
                const selectSeason = () => {
                  setOpen(false);
                  if (loadingLabel) setPendingSeason(season);
                };
                return onSeasonChange ? (
                  <button
                    className={className}
                    key={season}
                    onClick={() => {
                      selectSeason();
                      onSeasonChange(season);
                    }}
                    type="button"
                  >
                    {season}
                  </button>
                ) : (
                  <Link
                    className={className}
                    href={hrefBySeason[season]}
                    key={season}
                    onClick={selectSeason}
                    prefetch={false}
                  >
                    {season}
                  </Link>
                );
              })}
            </nav>
          </div>
        ) : null}
      </div>

      {pendingSeason !== null && pendingSeason !== activeSeason && loadingLabel && typeof document !== "undefined"
        ? createPortal(
            <ProfileLoadingOverlay label={loadingLabel} />,
            document.body,
          )
        : null}
    </>
  );
}
