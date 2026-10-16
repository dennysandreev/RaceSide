import { TimerReset } from "lucide-react";

import { RaceMateLogo } from "@/components/racemate/racemate-logo";
import { cn } from "@/lib/utils";

type NavigationLoadingPlateProps = {
  className?: string;
  label: string;
};

export function NavigationLoadingPlate({ className, label }: NavigationLoadingPlateProps) {
  return (
    <div
      className={cn(
        "relative w-full max-w-sm overflow-hidden rounded-lg border border-border bg-background/96 p-5 shadow-[0_24px_90px_rgb(0_0_0_/_0.36)] backdrop-blur-xl",
        className,
      )}
      role="status"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_0%,rgb(225_6_0_/_0.24),transparent_12rem),linear-gradient(135deg,rgb(255_255_255_/_0.08),transparent_45%)]" />
      <div className="relative grid gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="grid gap-2">
            <RaceMateLogo size="footer" />
            <p className="text-xs text-muted-foreground">Открываем страницу</p>
          </div>
          <TimerReset aria-hidden="true" className="size-5 text-primary" />
        </div>

        <div>
          <p className="font-display text-balance text-2xl font-extrabold leading-tight tracking-[-0.04em]">
            {label}
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Собираем карту, тайминги и replay-данные.
          </p>
        </div>

        <div className="grid gap-2" aria-hidden="true">
          <div className="racemate-loading-progress">
            <span />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <span className="racemate-loading-step racemate-loading-step-1">Трек</span>
            <span className="racemate-loading-step racemate-loading-step-2">Болиды</span>
            <span className="racemate-loading-step racemate-loading-step-3">Тайминг</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function NavigationLoadingOverlay({ label }: { label: string }) {
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-background/70 p-4 backdrop-blur-md">
      <NavigationLoadingPlate label={label} />
    </div>
  );
}
