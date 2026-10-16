"use client";

import Image from "next/image";
import { Box, Map } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { TrackModel3DLazy } from "@/components/racemate/track-model-3d-lazy";
import { Button } from "@/components/ui/button";
import { getCircuitAsset } from "@/data/f1-assets";
import { getThreeDimensionalTrackModelId } from "@/data/track-models";
import { TRACK_MODEL_TOUCH_QUERY } from "@/lib/track-model-camera";
import { cn } from "@/lib/utils";
import type { TrackLayout } from "@/types/racemate";

type TrackMapProps = {
  assetSrc?: string | null;
  circuit: string;
  className?: string;
  compact?: boolean;
  fill?: boolean;
  label?: string;
  layout?: TrackLayout | null;
  modelTogglePlacement?: "top" | "bottom" | "mobile-bottom";
  shortModelToggleLabel?: boolean;
  showModel3d?: boolean;
  toolbarLeading?: ReactNode;
  unframed?: boolean;
};

export function TrackMap({
  assetSrc,
  circuit,
  className,
  compact,
  fill = false,
  modelTogglePlacement = "top",
  shortModelToggleLabel = false,
  showModel3d = false,
  toolbarLeading,
  unframed = false,
}: TrackMapProps) {
  const legacyAsset = assetSrc === undefined ? getCircuitAsset(circuit) : null;
  const imageSrc = assetSrc ?? legacyAsset?.src ?? null;
  const trackModelId = getThreeDimensionalTrackModelId(circuit);
  const modelViewKey = trackModelId ? `${trackModelId}:${imageSrc ?? "no-image"}` : null;
  const [mobileModelOpen, setMobileModelOpen] = useState(false);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const [activeModelView, setActiveModelView] = useState<string | null>(null);
  const canShowModel3d = showModel3d && modelViewKey !== null;
  const useModel3d = canShowModel3d && activeModelView === modelViewKey;

  return (
    <div
      className={cn(
        "relative flex min-w-0 max-w-full flex-col overflow-hidden",
        !unframed && "race-track-surface rounded-md",
        fill ? "h-full w-full" : "gap-2 p-3",
        className,
      )}
    >
      {!fill && !unframed ? (
        <div className="race-track-overlay absolute inset-0 bg-[radial-gradient(circle_at_24%_18%,rgb(225_6_0_/_0.16),transparent_15rem)]" />
      ) : null}
      {toolbarLeading || canShowModel3d ? (
        <div
          className={cn(
            "relative flex flex-wrap items-center gap-2",
            toolbarLeading ? (canShowModel3d ? "justify-between" : "justify-start") : "justify-end",
            fill && modelTogglePlacement === "top" && "mb-2",
            fill && modelTogglePlacement === "bottom" && "absolute bottom-2 right-0 z-30",
            fill && modelTogglePlacement === "mobile-bottom" && "order-2 mt-2 sm:static sm:order-none sm:mb-2 sm:mt-0",
          )}
        >
          {toolbarLeading ? <div className="min-w-0">{toolbarLeading}</div> : null}
          {canShowModel3d ? (
            <Button
              ref={modelTriggerRef}
              className={cn(fill && modelTogglePlacement === "mobile-bottom" && "sm:absolute sm:bottom-2 sm:right-0 sm:z-30")}
              aria-label={useModel3d ? "Схема" : undefined}
              aria-pressed={useModel3d}
              title={useModel3d ? "Схема" : undefined}
              onClick={() => {
                if (window.matchMedia(TRACK_MODEL_TOUCH_QUERY).matches) setMobileModelOpen(true);
                else setActiveModelView(useModel3d ? null : modelViewKey);
              }}
              size="sm"
              type="button"
              variant="secondary"
            >
              {useModel3d ? (
                <Map aria-hidden="true" data-icon="inline-start" />
              ) : (
                <Box aria-hidden="true" data-icon="inline-start" />
              )}
              {!useModel3d ? (
                <>
                  <span className="sm:hidden">3D</span>
                  <span className="hidden sm:inline">
                    {shortModelToggleLabel ? "3D" : "3D-визуализация"}
                  </span>
                </>
              ) : null}
            </Button>
          ) : null}
        </div>
      ) : null}
      {mobileModelOpen && trackModelId ? (
        <div className="sr-only">
          <TrackModel3DLazy circuit={circuit} compact fill modelId={trackModelId}
            fullscreenOpen onFullscreenOpenChange={(open) => {
              setMobileModelOpen(open);
              if (!open) requestAnimationFrame(() => modelTriggerRef.current?.focus());
            }} />
        </div>
      ) : null}
      {useModel3d && trackModelId ? (
        <div
          className={cn(
            "race-track-image-stage relative min-w-0 max-w-full overflow-hidden rounded border border-white/10 bg-black/40",
            fill
              ? "min-h-0 w-full flex-1"
              : compact
                ? "h-52 sm:h-64"
                : "h-[22rem] sm:h-[27rem]",
          )}
        >
          <TrackModel3DLazy
            circuit={circuit}
            compact={compact}
            fill={fill}
            key={trackModelId}
            modelId={trackModelId}
          />
        </div>
      ) : imageSrc ? (
        <div
          className={cn(
            "race-track-image-stage relative grid min-w-0 max-w-full place-items-center overflow-hidden rounded",
            fill || unframed ? "border-0 bg-transparent p-0" : "border border-white/10 bg-black/40 p-2",
            fill ? "min-h-0 w-full flex-1" : compact ? "h-32 sm:h-36" : "h-48",
          )}
        >
          <Image
            alt={`Официальная схема трассы ${circuit}`}
            className="object-contain"
            fill
            priority
            sizes={compact ? "(max-width: 640px) 360px, (max-width: 1024px) 720px, 56rem" : "(max-width: 640px) 360px, 48rem"}
            src={imageSrc}
            unoptimized
          />
        </div>
      ) : (
        <div
          className={cn(
            "race-track-image-stage relative grid min-w-0 max-w-full place-items-center overflow-hidden rounded text-center",
            fill || unframed ? "border-0 bg-transparent" : "border border-border/70 bg-background/50",
            fill ? "min-h-0 w-full flex-1" : compact ? "h-32 sm:h-36" : "h-48",
          )}
        >
          <div>
            <p className="text-sm font-medium">Схема трассы пока недоступна</p>
            <p className="mt-2 max-w-sm text-xs leading-5 text-muted-foreground">
              Покажем официальный макет F1, когда он появится в открытых ассетах.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
