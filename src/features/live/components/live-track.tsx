"use client";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useLive, useLiveStore } from "./live-provider";
import type {
  ReplayTrackCar,
  ReplayTrackId,
} from "@/features/race-replay/components/race-replay-zandvoort-3d";
import { Button } from "@/components/ui/button";
import { Crosshair } from "lucide-react";
import { TrackModelViewer } from "@/components/racemate/track-model-viewer";
import type { CircuitModelPoint } from "@/data/track-model-types";
import { TRACK_MODEL_TOUCH_QUERY } from "@/lib/track-model-camera";
import { buildMarshalSectorPath } from "../lib/track-sectors";
const Track3D = dynamic(
  () =>
    import("@/features/race-replay/components/race-replay-zandvoort-3d").then(
      (m) => m.RaceReplayTrack3D,
    ),
  { ssr: false },
);
function modelId(name: string): ReplayTrackId | null {
  const matches: [RegExp, ReplayTrackId][] = [
    [/singapore|marina bay|сингапур|марина.бэй/i, "singapore"],
    [/austin|americas|cota|остин/i, "austin"],
    [/mexico|rodr[ií]guez|мехико|мексик/i, "mexico"],
    [/interlagos|[sс][aã]o paulo|j[oó]s[eé] carlos|интерлагос|сан.пау/i, "interlagos"],
    [/las.vegas|лас.вегас/i, "las-vegas"],
    [/qatar|l[uo]sail|катар|л[уо]с[аэ]/i, "qatar"],
    [/yas|abu.dhabi|яс.марина|абу.даби/i, "yas-marina"],
    [/sepang|malay|kuala lumpur|сепанг|малайз/i, "sepang"],
    [/baku|baki|azerbaijan|баку|азербайджан/i, "baku"],
    [/madr|ifema/i, "madring"],
    [/catal|barcel/i, "catalunya"],
    [/hungar|budapest/i, "hungaroring"],
    [/montreal|gilles/i, "montreal"],
    [/red bull|spielberg|austria/i, "red-bull-ring"],
    [/silverstone/i, "silverstone"],
    [/spa|francorchamps/i, "spa"],
    [/zandvoort/i, "zandvoort"],
  ];
  return matches.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}
export const LiveTrack = memo(function LiveTrack({
  selected,
  onSelect,
}: {
  selected: number | null;
  onSelect: (n: number) => void;
}) {
  const track = useLive("track"),
    drivers = useLive("drivers"),
    flag = useLive("flag"),
    trackSectorCount = useLive("trackSectorCount"),
    yellowSectors = useLive("yellowSectors"),
    store = useLiveStore();
  const [mode, setMode] = useState("2d");
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const markers = useRef(new Map<number, SVGGElement>());
  useEffect(() => {
    let frame = 0;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let last = 0;
    const tick = (time: number) => {
      if (!reduced.matches || time - last > 250) {
        for (const [n, node] of markers.current) {
          const p = store.sample(n);
          if (!p) {
            node.style.visibility = "hidden";
            continue;
          }
          node.style.visibility = "visible";
          node.setAttribute("transform", `translate(${p.x},${p.y})`);
          node.style.opacity = p.stale ? "0.35" : "1";
        }
        last = time;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [store]);
  if (!track)
    return (
      <div className="live-empty">
        <p>Готовим карту трассы</p>
        <span>Тайминг и события появятся по мере поступления данных.</span>
      </div>
    );
  const id = modelId(`${track.circuitName} ${track.circuitKey}`);
  const mapPoints = [...track.centerline, ...(track.pitLane?.points ?? [])];
  const minX = Math.min(...mapPoints.map((p) => p.svgX)) - 65;
  const maxX = Math.max(...mapPoints.map((p) => p.svgX)) + 100;
  const minY = Math.min(...mapPoints.map((p) => p.svgY)) - 50;
  const maxY = Math.max(...mapPoints.map((p) => p.svgY)) + 50;
  const viewBox = mapPoints.length
    ? `${minX} ${minY} ${maxX - minX} ${maxY - minY}`
    : `0 0 ${track.svg.viewBox.width} ${track.svg.viewBox.height}`;
  const activeSectorPaths =
    flag === "YELLOW" && trackSectorCount
      ? yellowSectors
          .map((sector) => ({
            sector,
            path: buildMarshalSectorPath(
              track.centerline,
              sector,
              trackSectorCount,
              track.startFinish.progress,
            ),
          }))
          .filter((item) => item.path)
      : [];
  return (
    <div className="live-map">
      <div className="live-map-mode">
        <Button
          size="sm"
          variant={mode === "2d" ? "secondary" : "ghost"}
          onClick={() => setMode("2d")}
          aria-pressed={mode === "2d"}
        >
          2D
        </Button>
        {id && (
          <Button
            ref={modelTriggerRef}
            size="sm"
            variant={mode === "3d" ? "secondary" : "ghost"}
            onClick={() => {
              setMode("3d");
              setFullscreenOpen(window.matchMedia(TRACK_MODEL_TOUCH_QUERY).matches);
            }}
            aria-pressed={mode === "3d"}
          >
            3D
          </Button>
        )}
      </div>
      {mode === "3d" && id ? (
        <Animated3D trackId={id} selected={selected} onSelect={onSelect} fullscreenOpen={fullscreenOpen}
          onFullscreenOpenChange={(open) => {
            setFullscreenOpen(open);
            if (!open && window.matchMedia(TRACK_MODEL_TOUCH_QUERY).matches) {
              setMode("2d");
              requestAnimationFrame(() => modelTriggerRef.current?.focus());
            }
          }} />
      ) : (
        <svg
          viewBox={viewBox}
          aria-label={
            activeSectorPaths.length
              ? `Положение автомобилей на трассе. Жёлтый флаг: ${activeSectorPaths.map(({ sector }) => `сектор ${sector}`).join(", ")}`
              : "Положение автомобилей на трассе"
          }
          role="group"
        >
          <path
            d={track.svg.technicalPathD || track.svg.visualPathD}
            fill="none"
            stroke="var(--border)"
            strokeWidth="24"
            strokeLinejoin="round"
          />
          <path
            d={track.svg.technicalPathD || track.svg.visualPathD}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth="2"
            opacity=".6"
          />
          {activeSectorPaths.map(({ sector, path }) => (
            <g key={sector} aria-hidden="true">
              <path
                d={path}
                fill="none"
                stroke="#ffd400"
                strokeWidth="18"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity=".28"
              />
              <path
                d={path}
                fill="none"
                stroke="#ffe45c"
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ))}
          {track.pitLane && (
            <g aria-label="Пит-лейн" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d={track.pitLane.visualPathD} stroke="var(--background)" strokeWidth="7" />
              <path d={track.pitLane.visualPathD} stroke="var(--foreground)" strokeWidth="2.5" opacity=".8" />
            </g>
          )}
          <circle
            cx={track.startFinish.svgX}
            cy={track.startFinish.svgY}
            r="5"
            fill="var(--foreground)"
          />
          {Object.values(drivers)
            .filter((d) => !["DNF", "DNS", "RETIRED", "DSQ"].includes(d.status))
            .map((d) => (
              <g
                key={d.driverNumber}
                ref={(node) => {
                  if (node) markers.current.set(d.driverNumber, node);
                  else markers.current.delete(d.driverNumber);
                }}
                role="button"
                tabIndex={0}
                aria-label={`Выбрать ${d.fullName}`}
                aria-pressed={d.driverNumber === selected}
                onClick={() => onSelect(d.driverNumber)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(d.driverNumber);
                  }
                }}
                className="live-car"
              >
                <circle
                  r={d.driverNumber === selected ? 13 : 9}
                  fill={d.teamColour}
                  stroke={
                    d.driverNumber === selected
                      ? "var(--foreground)"
                      : "var(--background)"
                  }
                  strokeWidth="3"
                />
                <text
                  x="16"
                  y="5"
                  fill="var(--foreground)"
                  stroke="var(--background)"
                  strokeWidth="5"
                  paintOrder="stroke"
                  fontSize="16"
                  fontWeight="700"
                >
                  {d.acronym}
                </text>
              </g>
            ))}
        </svg>
      )}
      <div className="live-map-caption">
        {track.circuitName}
        {mode === "2d" && track.pitLane?.source === "verified_circuit_geometry" && (
          <span>
            <a className="pointer-events-auto underline underline-offset-2" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              © OpenStreetMap
            </a>
          </span>
        )}
      </div>
    </div>
  );
});
function Animated3D({ trackId, selected, onSelect, fullscreenOpen, onFullscreenOpenChange }: {
  trackId: ReplayTrackId;
  selected: number | null;
  onSelect: (n: number) => void;
  fullscreenOpen: boolean;
  onFullscreenOpenChange: (open: boolean) => void;
}) {
  const store = useLiveStore();
  const [follow, setFollow] = useState(false);
  const [overviewPoints, setOverviewPoints] = useState<readonly CircuitModelPoint[]>([]);
  const stopFollowing = useCallback(() => setFollow(false), []);
  const sampleCar = useCallback(
    (driverNumber: number): ReplayTrackCar | null => {
      const d = store.state.drivers[driverNumber];
      const p = store.sample(driverNumber);
      if (!d || !p) return null;
      return {
        abbreviation: d.acronym,
        driverNumber,
        fullName: d.fullName,
        isPitLane: p.pitLaneProgress != null,
        isSelected: driverNumber === selected,
        lateralOffset: 0,
        pitLaneProgress: p.pitLaneProgress ?? null,
        pitTrackProgress: p.pitTrackProgress,
        progress: p.progress,
        teamColor: d.teamColour,
      };
    },
    [store, selected],
  );
  const [cars, setCars] = useState<ReplayTrackCar[]>([]);
  useEffect(() => {
    const update = () =>
      setCars(
        Object.keys(store.state.drivers).flatMap((n) => {
          const car = sampleCar(Number(n));
          return car ? [car] : [];
        }),
      );
    const first = requestAnimationFrame(update);
    const timer = setInterval(update, 250);
    return () => {
      cancelAnimationFrame(first);
      clearInterval(timer);
    };
  }, [store, sampleCar]);
  return <TrackModelViewer circuit={store.state.track?.circuitName ?? ""} initialTiltDeg={48} points={overviewPoints}
    fullscreenOpen={fullscreenOpen} onFullscreenOpenChange={onFullscreenOpenChange} onInteract={stopFollowing} onReset={stopFollowing}
    bottomInset={132} toolbarExtra={<Button size="icon" variant={follow ? "default" : "secondary"} className="size-11 sm:size-11"
      aria-pressed={follow} disabled={selected === null} aria-label="Следить за выбранным пилотом"
      onClick={() => setFollow(value => !value)}><Crosshair aria-hidden="true" /></Button>}>
    {view => <>
      <Track3D cars={cars} sampleCar={sampleCar} followDriver={follow ? selected : null}
        onSelectDriver={n => { if (!view.moved.current) onSelect(n); }} onOverviewPoints={setOverviewPoints}
        panX={view.pan.x} panY={view.pan.y} rotationDeg={view.rotationDeg} tiltDeg={view.tiltDeg} trackId={trackId} zoom={view.zoom}
        frameRotationDeg={view.frameRotationDeg} frameTiltDeg={view.frameTiltDeg} viewport={view.viewport} />
      {follow ? <span className="pointer-events-none absolute left-3 top-16 z-20 rounded border border-border bg-background px-2 py-1 text-xs text-foreground">
        Камера за {store.state.drivers[selected!]?.acronym ?? "пилотом"}
      </span> : null}
    </>}
  </TrackModelViewer>;
}
