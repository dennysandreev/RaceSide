"use client";

import { Crosshair, TrendingDown, TrendingUp } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef } from "react";
import { TrackModelViewer, type TrackModelView } from "@/components/racemate/track-model-viewer";
import type { TrackModelDefinition } from "@/data/track-model-types";
import { getTrackModelFrame } from "@/lib/track-model-camera";
import {
  createTrackModelScene, drawTrackModel, getTrackModelCanvasFrame, projectTrackModel,
  TRACK_MODEL_VIEW_SIZE, type TrackModelPalette
} from "@/lib/track-model-renderer";
import { cn } from "@/lib/utils";

const TrackModelWebGL = dynamic(() => import("@/components/racemate/track-model-webgl").then(m => m.TrackModelWebGL), { loading: () => null, ssr: false });
export type TrackModel3DProps = {
  circuit: string;
  compact?: boolean;
  fill?: boolean;
  model: TrackModelDefinition;
  fullscreenOpen?: boolean;
  onFullscreenOpenChange?: (open: boolean) => void;
};
const SECTOR_TOKEN_NAMES = ["--track-model-sector-1", "--track-model-sector-2", "--track-model-sector-3"] as const;

export function TrackModel3D({ circuit, compact = false, fill = false, model, fullscreenOpen, onFullscreenOpenChange }: TrackModel3DProps) {
  return <TrackModelViewer circuit={circuit} initialRotationDeg={model.camera.rotationDeg} initialTiltDeg={model.camera.tiltDeg}
    points={model.data.points} fullscreenOpen={fullscreenOpen} onFullscreenOpenChange={onFullscreenOpenChange}
    bottomInset={84} wideBottomInset={44} className={cn(!fill && !compact && "min-h-[22rem] sm:min-h-[27rem]")}>
    {view => <TrackModelViewport circuit={circuit} model={model} view={view} />}
  </TrackModelViewer>;
}

function TrackModelViewport({ circuit, model, view }: { circuit: string; model: TrackModelDefinition; view: TrackModelView }) {
  const { pan, rotationDeg, tiltDeg, zoom, fullscreen } = view;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scene = useMemo(() => createTrackModelScene(model), [model]);
  const frame = useMemo(() => ({
    bounds: model.webgl
      ? getTrackModelFrame(model.data.points, view.frameRotationDeg, view.frameTiltDeg, rotationDeg, tiltDeg)
      : getTrackModelCanvasFrame(scene, view.frameRotationDeg, view.frameTiltDeg, rotationDeg, tiltDeg), viewport: view.viewport
  }),
    [model, scene, view.frameRotationDeg, view.frameTiltDeg, view.viewport, rotationDeg, tiltDeg]);
  const projection = useMemo(() => projectTrackModel(scene, rotationDeg, zoom, tiltDeg, pan.x, pan.y, frame),
    [scene, rotationDeg, zoom, tiltDeg, pan.x, pan.y, frame]);
  const annotationOffsets = model.rendering.annotationOffsets;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => drawTrackModel(canvas, scene, rotationDeg, readPalette(), zoom, tiltDeg, pan.x, pan.y, frame);
    const themeObserver = new MutationObserver(render);
    themeObserver.observe(document.documentElement, { attributeFilter: ["data-theme"], attributes: true });
    render();
    return () => themeObserver.disconnect();
  }, [scene, rotationDeg, zoom, tiltDeg, pan.x, pan.y, frame]);

  return <>
    {model.webgl ? <TrackModelWebGL assetPath={model.webgl.assetPath} camera={model.webgl.camera} circuit={circuit}
      elevationDatumLabel={model.webgl.elevationDatumLabel} elevationApproximate={model.webgl.elevationApproximate}
      panX={pan.x} panY={pan.y} previewPath={model.webgl.previewPath}
      rotationDeg={rotationDeg} showElevationAnchors={fullscreen && (!model.webgl.elevationApproximate || model.id === "mexico")}
      tiltDeg={tiltDeg} turnCount={model.webgl.turnCount} zoom={zoom} frame={frame} />
      : <canvas aria-hidden="true" className="absolute inset-0 size-full" ref={canvasRef} />}
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0",
        model.webgl && "hidden",
      )}
    >
      <span
        aria-label="Спид-трап"
        className="absolute flex -translate-x-1/2 -translate-y-[210%] items-center gap-1 rounded-sm border border-[var(--track-model-speed-trap)] bg-[var(--track-model-speed-trap-bg)] px-1.5 py-1 font-mono text-[0.56rem] font-bold text-[var(--track-model-speed-trap-text)] shadow-sm sm:-translate-y-[150%]"
        style={{
          left: annotationPosition(
            projection.speedTrap.x,
            annotationOffsets?.speedTrap?.[0],
          ),
          top: annotationPosition(
            projection.speedTrap.y,
            annotationOffsets?.speedTrap?.[1],
          ),
        }}
        title="Спид-трап"
      >
        <Crosshair aria-hidden="true" className="size-3" />
        ST
      </span>

      <span
        className={cn(
          "absolute translate-x-[10%] -translate-y-[220%] whitespace-nowrap rounded border border-[var(--track-model-height-border)] bg-[var(--track-model-height-bg)] px-2 py-1.5 text-left text-[0.6rem] font-semibold leading-tight text-[var(--track-model-height-text)] shadow-sm sm:-translate-y-[180%]",
          model.webgl && "hidden @md/track:block",
        )}
        style={{
          left: annotationPosition(
            projection.highPoint.x,
            annotationOffsets?.highPoint?.[0],
          ),
          top: annotationPosition(
            projection.highPoint.y,
            annotationOffsets?.highPoint?.[1],
          ),
        }}
      >
        <strong className="block font-mono text-xs">+{model.data.elevationChangeM} м</strong>
      </span>

      <span
        className={cn(
          "absolute whitespace-nowrap rounded border border-[var(--track-model-height-border)] bg-[var(--track-model-height-bg)] px-2 py-1.5 text-left text-[0.6rem] font-semibold leading-tight text-[var(--track-model-height-text)] shadow-sm",
          model.webgl ? "hidden" : "hidden @md/track:block",
        )}
        style={{
          left: annotationPosition(
            projection.lowPoint.x,
            annotationOffsets?.lowPoint?.[0],
          ),
          top: annotationPosition(
            projection.lowPoint.y,
            annotationOffsets?.lowPoint?.[1],
          ),
          transform: "translate(-110%, 18%)",
        }}
      >
        <strong className="block font-mono text-xs">0 м</strong>
      </span>
    </div>

    <div className={cn(
      "pointer-events-none absolute bottom-[max(0.25rem,env(safe-area-inset-bottom))] left-2 z-30 flex flex-wrap items-end gap-1.5 @lg/track:flex-nowrap sm:gap-2",
      fullscreen ? "right-2" : "right-16",
    )}>
      <div className="flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded border border-border bg-background/90 px-2 text-[0.68rem] font-bold text-foreground shadow-sm sm:px-2.5">
        {SECTOR_TOKEN_NAMES.map((token, index) => (
          <span className="flex items-center gap-1.5" key={token}>
            <span
              aria-hidden="true"
              className="size-2 rounded-sm"
              style={{ backgroundColor: `var(${token})` }}
            />
            S{index + 1}
          </span>
        ))}
      </div>

      <div className="flex h-9 min-w-0 basis-full grow items-center justify-center gap-1.5 rounded border border-border bg-background/90 px-2 text-xs font-semibold text-foreground shadow-sm @lg/track:basis-0 @md/track:min-w-64 @md/track:px-2.5">
        <span className="shrink-0 whitespace-nowrap font-mono font-bold">
          {model.id === "mexico" && <span className="mr-1 font-sans font-medium">Круг</span>}
          {model.data.lapLengthKm.toLocaleString("ru-RU", {
            maximumFractionDigits: 3,
            minimumFractionDigits: 3,
          })} км
        </span>
        <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />
        <ElevationProfile approximate={model.webgl?.elevationApproximate} scene={scene} />
        {!model.webgl?.elevationApproximate && <>
          <span className="hidden shrink-0 items-center gap-1 whitespace-nowrap @2xl/track:flex">
            <TrendingUp aria-hidden="true" className="size-3.5" />
            {model.data.maxUphillPercent.toLocaleString("ru-RU")}%
          </span>
          <span className="hidden shrink-0 items-center gap-1 whitespace-nowrap @2xl/track:flex">
            <TrendingDown aria-hidden="true" className="size-3.5" />
            {model.data.maxDownhillPercent.toLocaleString("ru-RU")}%
          </span>
        </>}
      </div>
    </div>

    {model.id === "austin" ? <a className="absolute right-2 top-16 z-20 text-[11px] text-muted-foreground underline underline-offset-2" href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer" target="_blank">© OpenStreetMap</a> : null}
  </>;
}

function ElevationProfile({ approximate = false, scene }: { approximate?: boolean; scene: ReturnType<typeof createTrackModelScene> }) {
  const width = 122;
  const height = 30;
  const minElevation = scene.lowPoint.elevationM;
  const maxElevation = scene.highPoint.elevationM;
  const range = Math.max(maxElevation - minElevation, 1);
  const samples = scene.track.filter((_, index) => index % 5 === 0);
  const line = samples
    .map((point, index) => {
      const x = (index / Math.max(samples.length - 1, 1)) * width;
      const y = height - 3 - ((point.elevationM - minElevation) / range) * (height - 7);
      return `${index === 0 ? "M" : "L"}${round(x)} ${round(y)}`;
    })
    .join(" ");

  return (
    <span className="flex min-w-0 shrink-0 items-center gap-1.5" title={approximate ? "Высоты приблизительные: по спутниковой модели рельефа" : undefined}>
      <span className="hidden text-muted-foreground @md/track:inline">Перепад</span>
      <svg
        aria-hidden="true"
        className="h-5 w-16 min-w-12 @md/track:h-6 @md/track:w-28"
        viewBox={`0 0 ${width} ${height}`}
      >
        <path
          d={`${line} L${width} ${height} L0 ${height} Z`}
          fill="var(--track-model-profile-fill)"
        />
        <path
          d={line}
          fill="none"
          stroke="var(--track-model-profile-line)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
      <strong className="shrink-0 whitespace-nowrap font-mono">
        {scene.definition.data.elevationChangeM} м
      </strong>
    </span>
  );
}

function readPalette(): TrackModelPalette {
  const styles = getComputedStyle(document.documentElement);
  const value = (token: string) => styles.getPropertyValue(token).trim();

  return {
    asphalt: value("--track-model-asphalt"),
    asphaltEdge: value("--track-model-asphalt-edge"),
    asphaltHighlight: value("--track-model-asphalt-highlight"),
    contour: value("--track-model-contour"),
    curbRed: value("--track-model-curb-red"),
    curbWhite: value("--track-model-curb-white"),
    fog: value("--track-model-fog"),
    grassHigh: value("--track-model-grass-high"),
    grassLow: value("--track-model-grass-low"),
    gravel: value("--track-model-gravel"),
    runoff: value("--track-model-runoff"),
    sectorOne: value("--track-model-sector-1"),
    sectorThree: value("--track-model-sector-3"),
    sectorTwo: value("--track-model-sector-2"),
    shadow: value("--track-model-shadow"),
    skyBottom: value("--track-model-sky-bottom"),
    skyTop: value("--track-model-sky-top"),
    slab: value("--track-model-slab"),
    speedTrap: value("--track-model-speed-trap"),
    turnBackground: value("--track-model-turn-bg"),
    turnBorder: value("--track-model-turn-line"),
    turnText: value("--track-model-turn-text"),
  };
}

function annotationPosition(projectedPosition: number, offset = 0) {
  const percentage = (projectedPosition / TRACK_MODEL_VIEW_SIZE) * 100;

  return offset === 0 ? `${percentage}%` : `calc(${percentage}% + ${offset}px)`;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
