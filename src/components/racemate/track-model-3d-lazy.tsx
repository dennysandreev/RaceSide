"use client";

import { useEffect, useRef, useState } from "react";
import { Minimize2, Minus, Plus } from "lucide-react";

import type { TrackModel3DProps } from "@/components/racemate/track-model-3d";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { TrackModelDefinition } from "@/data/track-model-types";
import type { TrackModelId } from "@/data/track-models";

type TrackModel3DLazyProps = Omit<TrackModel3DProps, "model"> & {
  modelId: TrackModelId;
};

type LoadedTrackModel = {
  Component: typeof import("@/components/racemate/track-model-3d")["TrackModel3D"];
  id: TrackModelId;
  model: TrackModelDefinition;
};

export function TrackModel3DLazy({ modelId, ...props }: TrackModel3DLazyProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<LoadedTrackModel | null>(null);
  const [status, setStatus] = useState<"loading" | "error">("loading");

  useEffect(() => {
    const container = containerRef.current;

    if (!container && !props.fullscreenOpen) {
      return;
    }

    let cancelled = false;
    let idleCallbackId: number | null = null;
    let timeoutId: number | null = null;
    const load = async () => {
      try {
        const [{ TrackModel3D }, model] = await Promise.all([
          import("@/components/racemate/track-model-3d"),
          loadTrackModel(modelId),
        ]);

        if (!cancelled) {
          setLoaded({ Component: TrackModel3D, id: modelId, model });
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
        }
      }
    };

    const scheduleLoad = () => {
      if (typeof window.requestIdleCallback === "function") {
        idleCallbackId = window.requestIdleCallback(() => void load(), { timeout: 1_200 });
      } else {
        timeoutId = window.setTimeout(() => void load(), 0);
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          observer.disconnect();
          scheduleLoad();
        }
      },
      { rootMargin: "320px" },
    );

    if (props.fullscreenOpen) void load();
    else if (container) observer.observe(container);

    return () => {
      cancelled = true;
      observer.disconnect();

      if (idleCallbackId !== null) {
        window.cancelIdleCallback(idleCallbackId);
      }

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [attempt, modelId, props.fullscreenOpen]);

  if (loaded?.id === modelId) {
    const { Component, model } = loaded;

    return <Component {...props} model={model} />;
  }

  const placeholder = (
    <div
      className="relative grid size-full min-h-0 place-items-center overflow-hidden"
      ref={containerRef}
      role="status"
    >
      <Skeleton aria-hidden="true" className="absolute inset-0 size-full rounded-none" />
      {status === "error" ? (
        <div className="relative flex flex-col items-center gap-3 px-4 text-center">
          <p className="text-sm font-semibold text-foreground">3D-модель не загрузилась</p>
          <Button
            onClick={() => {
              setStatus("loading");
              setAttempt((current) => current + 1);
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            Попробовать еще раз
          </Button>
        </div>
      ) : (
        <span className={props.fullscreenOpen ? "relative text-sm text-foreground" : "sr-only"}>Загружаем 3D-карту…</span>
      )}
    </div>
  );
  return props.fullscreenOpen ? <Dialog open onOpenChange={props.onFullscreenOpenChange}>
    <DialogContent showCloseButton={false} className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 rounded-none border-0 bg-[var(--track-model-stage)] p-0 motion-reduce:animate-none sm:max-w-none">
      <DialogTitle className="sr-only">Трасса {props.circuit} на весь экран</DialogTitle>
      <DialogDescription className="sr-only">Загружаем 3D-карту трассы.</DialogDescription>
      {placeholder}
      <div role="toolbar" aria-label="Управление картой" className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30 flex items-center gap-1.5">
        <Button size="icon" variant="secondary" className="size-11 sm:size-11" disabled aria-label="Отдалить трассу"><Minus aria-hidden="true" /></Button>
        <Button size="icon" variant="secondary" className="size-11 sm:size-11" disabled aria-label="Приблизить трассу"><Plus aria-hidden="true" /></Button>
        <Button size="icon" variant="secondary" className="size-11 sm:size-11" aria-label="Свернуть карту" title="Свернуть карту" onClick={() => props.onFullscreenOpenChange?.(false)}><Minimize2 aria-hidden="true" /></Button>
      </div>
    </DialogContent>
  </Dialog> : placeholder;
}

async function loadTrackModel(modelId: TrackModelId): Promise<TrackModelDefinition> {
  switch (modelId) {
    case "yas-marina":
      return (await import("@/data/yas-marina-model")).YAS_MARINA_TRACK_MODEL;
    case "qatar":
      return (await import("@/data/qatar-model")).QATAR_TRACK_MODEL;
    case "las-vegas":
      return (await import("@/data/las-vegas-model")).LAS_VEGAS_TRACK_MODEL;
    case "interlagos":
      return (await import("@/data/interlagos-model")).INTERLAGOS_TRACK_MODEL;
    case "mexico":
      return (await import("@/data/mexico-model")).MEXICO_TRACK_MODEL;
    case "singapore":
      return (await import("@/data/singapore-model")).SINGAPORE_TRACK_MODEL;
    case "austin":
      return (await import("@/data/austin-model")).AUSTIN_TRACK_MODEL;
    case "sepang":
      return (await import("@/data/sepang-model")).SEPANG_TRACK_MODEL;
    case "albert-park":
      return (await import("@/data/albert-park-model")).ALBERT_PARK_TRACK_MODEL;
    case "shanghai":
      return (await import("@/data/shanghai-model")).SHANGHAI_TRACK_MODEL;
    case "suzuka":
      return (await import("@/data/suzuka-model")).SUZUKA_TRACK_MODEL;
    case "miami":
      return (await import("@/data/miami-model")).MIAMI_TRACK_MODEL;
    case "montreal":
      return (await import("@/data/montreal-model")).MONTREAL_TRACK_MODEL;
    case "monaco":
      return (await import("@/data/monaco-model")).MONACO_TRACK_MODEL;
    case "monza":
      return (await import("@/data/monza-model")).MONZA_TRACK_MODEL;
    case "baku":
      return (await import("@/data/baku-model")).BAKU_TRACK_MODEL;
    case "madring":
      return (await import("@/data/madring-model")).MADRING_TRACK_MODEL;
    case "catalunya":
      return (await import("@/data/catalunya-model")).CATALUNYA_TRACK_MODEL;
    case "red-bull-ring":
      return (await import("@/data/red-bull-ring-model")).RED_BULL_RING_TRACK_MODEL;
    case "silverstone":
      return (await import("@/data/silverstone-model")).SILVERSTONE_TRACK_MODEL;
    case "spa":
      return (await import("@/data/spa-model")).SPA_TRACK_MODEL;
    case "hungaroring":
      return (await import("@/data/hungaroring-model")).HUNGARORING_TRACK_MODEL;
    case "zandvoort":
      return (await import("@/data/zandvoort-model")).ZANDVOORT_TRACK_MODEL;
  }
}
