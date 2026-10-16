"use client";

import { Html, OrthographicCamera as DreiOrthographicCamera, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import Image from "next/image";
import {
  Component,
  type ReactNode,
  Suspense,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MathUtils,
  Group,
  Object3D,
  OrthographicCamera,
  Vector3,
} from "three";

import {
  ZANDVOORT_MODEL,
  ZANDVOORT_REPLAY_PATH,
} from "@/data/zandvoort-model";
import {
  CATALUNYA_REPLAY_PATH,
  CATALUNYA_TRACK_MODEL,
} from "@/data/catalunya-model";
import {
  HUNGARORING_REPLAY_PATH,
  HUNGARORING_TRACK_MODEL,
} from "@/data/hungaroring-model";
import {
  MONTREAL_REPLAY_PATH,
  MONTREAL_TRACK_MODEL,
} from "@/data/montreal-model";
import {
  SILVERSTONE_REPLAY_PATH,
  SILVERSTONE_TRACK_MODEL,
} from "@/data/silverstone-model";
import { SPA_REPLAY_PATH, SPA_TRACK_MODEL } from "@/data/spa-model";
import { MADRING_MODEL, MADRING_TRACK_MODEL } from "@/data/madring-model";
import madringLivePath from "@/data/madring-live-path.json";
import {
  RED_BULL_RING_REPLAY_PATH,
  RED_BULL_RING_TRACK_MODEL,
} from "@/data/red-bull-ring-model";
import { BAKU_REPLAY_PATH, BAKU_TRACK_MODEL } from "@/data/baku-model";
import { SEPANG_MODEL, SEPANG_TRACK_MODEL } from "@/data/sepang-model";
import sepangLivePath from "@/data/sepang-live-path.json";
import preparedLivePaths from "@/data/live-2026-paths.json";
import { SINGAPORE_TRACK_MODEL } from "@/data/singapore-model";
import { AUSTIN_TRACK_MODEL } from "@/data/austin-model";
import { MEXICO_TRACK_MODEL } from "@/data/mexico-model";
import { INTERLAGOS_TRACK_MODEL } from "@/data/interlagos-model";
import { LAS_VEGAS_TRACK_MODEL } from "@/data/las-vegas-model";
import { QATAR_TRACK_MODEL } from "@/data/qatar-model";
import { YAS_MARINA_TRACK_MODEL } from "@/data/yas-marina-model";
import type { CircuitModelPoint, TrackModelDefinition } from "@/data/track-model-types";
import { cn } from "@/lib/utils";
import { fitTrackModelFrame, getTrackModelFrame, trackModelCameraPolarDeg, type TrackModelViewport } from "@/lib/track-model-camera";
import { alignPitTrackProgress, connectModelPitLane, type PitTrackProgress } from "../lib/pit-path";

const ZANDVOORT_ASSET_PATH = "/f1/tracks/3d/zandvoort.glb";
const ZANDVOORT_PREVIEW_PATH = "/f1/tracks/3d/zandvoort-preview.webp";

export type ReplayTrackCar = {
  abbreviation: string;
  driverNumber: number;
  fullName: string;
  isPitLane: boolean;
  isSelected: boolean;
  lateralOffset: number;
  pitLaneProgress: number | null;
  pitTrackProgress?: PitTrackProgress;
  progress: number;
  teamColor: string;
};

export type ZandvoortReplayCar = ReplayTrackCar;
export type ReplayTrackId = "baku" | "catalunya" | "hungaroring" | "madring" | "montreal" | "red-bull-ring" | "sepang" | "silverstone" | "spa" | "zandvoort"
  | "singapore" | "austin" | "mexico" | "interlagos" | "las-vegas" | "qatar" | "yas-marina";

type ReplayTrackConfig = {
  alt: string;
  ariaLabel: string;
  assetPath: string;
  camera: {
    fitHeight: number;
    fitWidth: number;
    lookAtY: number;
    radius: number;
  };
  path: {
    pitTrackProgress?: PitTrackProgress;
    baseElevationMeters: number;
    pitLanePoints: readonly CircuitModelPoint[];
    startFinishProgress: number;
    surfaceOffsetMeters: number;
    trackPoints: readonly CircuitModelPoint[];
    trackWidthMeters: number;
  };
  previewPath: string;
  turnCount: number;
};

function preparedTrackConfig(model: TrackModelDefinition, path: typeof preparedLivePaths.singapore): ReplayTrackConfig {
  if (!model.webgl) throw new Error(`Missing 3D track asset: ${model.id}`);
  return {
    alt: model.data.circuitName,
    ariaLabel: `3D-карта трассы ${model.data.circuitName}`,
    assetPath: model.webgl.assetPath,
    camera: model.webgl.camera,
    previewPath: model.webgl.previewPath,
    turnCount: model.webgl.turnCount,
    path: { ...path, trackPoints: model.data.points,
      pitLanePoints: path.pitLanePoints.map(([progress, x, y, z]) => [progress, x, y, z] as const) },
  };
}

const REPLAY_TRACK_CONFIGS: Record<ReplayTrackId, ReplayTrackConfig> = {
  singapore: preparedTrackConfig(SINGAPORE_TRACK_MODEL, preparedLivePaths.singapore),
  austin: preparedTrackConfig(AUSTIN_TRACK_MODEL, preparedLivePaths.austin),
  mexico: preparedTrackConfig(MEXICO_TRACK_MODEL, preparedLivePaths.mexico),
  interlagos: preparedTrackConfig(INTERLAGOS_TRACK_MODEL, preparedLivePaths.interlagos),
  "las-vegas": preparedTrackConfig(LAS_VEGAS_TRACK_MODEL, preparedLivePaths["las-vegas"]),
  qatar: preparedTrackConfig(QATAR_TRACK_MODEL, preparedLivePaths.qatar),
  "yas-marina": preparedTrackConfig(YAS_MARINA_TRACK_MODEL, preparedLivePaths["yas-marina"]),
  sepang: {
    alt: "Трасса Сепанг",
    ariaLabel: "3D-карта трассы Сепанг",
    assetPath: SEPANG_TRACK_MODEL.webgl.assetPath,
    camera: SEPANG_TRACK_MODEL.webgl.camera,
    path: {
      baseElevationMeters: sepangLivePath.baseElevationMeters,
      startFinishProgress: 0,
      surfaceOffsetMeters: 0.45,
      trackPoints: SEPANG_MODEL.points,
      pitLanePoints: sepangLivePath.pitLanePoints as [number, number, number, number][],
      trackWidthMeters: 16,
    },
    previewPath: SEPANG_TRACK_MODEL.webgl.previewPath,
    turnCount: SEPANG_TRACK_MODEL.webgl.turnCount,
  },
  baku: {
    alt: "Трасса Баку",
    ariaLabel: "3D-карта городской трассы Баку",
    assetPath: BAKU_TRACK_MODEL.webgl.assetPath,
    camera: { ...BAKU_TRACK_MODEL.webgl.camera, fitWidth: 3_000, fitHeight: 2_100 },
    path: BAKU_REPLAY_PATH,
    previewPath: BAKU_TRACK_MODEL.webgl.previewPath,
    turnCount: BAKU_TRACK_MODEL.webgl.turnCount,
  },
  madring: {
    alt: "Трасса Мадринг",
    ariaLabel: "3D-карта трассы Мадринг",
    assetPath: MADRING_TRACK_MODEL.webgl.assetPath,
    camera: MADRING_TRACK_MODEL.webgl.camera,
    path: {
      baseElevationMeters: 640,
      startFinishProgress: 0,
      surfaceOffsetMeters: 0.45,
      trackPoints: MADRING_MODEL.points,
      pitLanePoints: madringLivePath.pitLanePoints as [number, number, number, number][],
      trackWidthMeters: 12,
    },
    previewPath: MADRING_TRACK_MODEL.webgl.previewPath,
    turnCount: MADRING_TRACK_MODEL.webgl.turnCount,
  },
  catalunya: {
    alt: "Трасса Барселона-Каталунья",
    ariaLabel: "3D-повтор Гран-при Испании на трассе Барселона-Каталунья",
    assetPath: CATALUNYA_TRACK_MODEL.webgl.assetPath,
    camera: CATALUNYA_TRACK_MODEL.webgl.camera,
    path: CATALUNYA_REPLAY_PATH,
    previewPath: CATALUNYA_TRACK_MODEL.webgl.previewPath,
    turnCount: CATALUNYA_TRACK_MODEL.webgl.turnCount,
  },
  hungaroring: {
    alt: "Трасса Хунгароринг",
    ariaLabel: "3D-повтор Гран-при Венгрии на трассе Хунгароринг",
    assetPath: HUNGARORING_TRACK_MODEL.webgl.assetPath,
    camera: HUNGARORING_TRACK_MODEL.webgl.camera,
    path: HUNGARORING_REPLAY_PATH,
    previewPath: HUNGARORING_TRACK_MODEL.webgl.previewPath,
    turnCount: HUNGARORING_TRACK_MODEL.webgl.turnCount,
  },
  montreal: {
    alt: "Трасса имени Жиля Вильнёва",
    ariaLabel: "3D-повтор Гран-при Канады на трассе имени Жиля Вильнёва",
    assetPath: MONTREAL_TRACK_MODEL.webgl.assetPath,
    camera: MONTREAL_TRACK_MODEL.webgl.camera,
    path: MONTREAL_REPLAY_PATH,
    previewPath: MONTREAL_TRACK_MODEL.webgl.previewPath,
    turnCount: MONTREAL_TRACK_MODEL.webgl.turnCount,
  },
  "red-bull-ring": {
    alt: "Трасса Ред Булл Ринг",
    ariaLabel: "3D-повтор Гран-при Австрии на трассе Ред Булл Ринг",
    assetPath: RED_BULL_RING_TRACK_MODEL.webgl.assetPath,
    camera: RED_BULL_RING_TRACK_MODEL.webgl.camera,
    path: RED_BULL_RING_REPLAY_PATH,
    previewPath: RED_BULL_RING_TRACK_MODEL.webgl.previewPath,
    turnCount: RED_BULL_RING_TRACK_MODEL.webgl.turnCount,
  },
  silverstone: {
    alt: "Трасса Сильверстоун",
    ariaLabel: "3D-повтор Гран-при Великобритании на трассе Сильверстоун",
    assetPath: SILVERSTONE_TRACK_MODEL.webgl.assetPath,
    camera: SILVERSTONE_TRACK_MODEL.webgl.camera,
    path: SILVERSTONE_REPLAY_PATH,
    previewPath: SILVERSTONE_TRACK_MODEL.webgl.previewPath,
    turnCount: SILVERSTONE_TRACK_MODEL.webgl.turnCount,
  },
  spa: {
    alt: "Трасса Спа-Франкоршам",
    ariaLabel: "3D-повтор Гран-при Бельгии на трассе Спа-Франкоршам",
    assetPath: SPA_TRACK_MODEL.webgl.assetPath,
    camera: SPA_TRACK_MODEL.webgl.camera,
    path: {
      baseElevationMeters: SPA_REPLAY_PATH.baseElevationDngMeters,
      pitLanePoints: SPA_REPLAY_PATH.pitLanePoints,
      startFinishProgress: SPA_REPLAY_PATH.startFinishProgress,
      surfaceOffsetMeters: SPA_REPLAY_PATH.surfaceOffsetMeters,
      trackPoints: SPA_REPLAY_PATH.trackPoints,
      trackWidthMeters: SPA_REPLAY_PATH.trackWidthMeters,
    },
    previewPath: SPA_TRACK_MODEL.webgl.previewPath,
    turnCount: SPA_TRACK_MODEL.webgl.turnCount,
  },
  zandvoort: {
    alt: "Трасса Зандворт",
    ariaLabel: "3D-повтор Гран-при Нидерландов на трассе Зандворт",
    assetPath: ZANDVOORT_ASSET_PATH,
    camera: { fitHeight: 1_600, fitWidth: 1_900, lookAtY: 8, radius: 2_650 },
    path: {
      baseElevationMeters: ZANDVOORT_REPLAY_PATH.baseElevationNapMeters,
      pitLanePoints: ZANDVOORT_REPLAY_PATH.pitLanePoints,
      startFinishProgress: ZANDVOORT_REPLAY_PATH.startFinishProgress,
      surfaceOffsetMeters: ZANDVOORT_REPLAY_PATH.surfaceOffsetMeters,
      trackPoints: ZANDVOORT_MODEL.points,
      trackWidthMeters: ZANDVOORT_REPLAY_PATH.trackWidthMeters,
    },
    previewPath: ZANDVOORT_PREVIEW_PATH,
    turnCount: 14,
  },
};

type RaceReplayTrack3DProps = {
  onOverviewPoints?: (points: readonly CircuitModelPoint[]) => void;
  frameRotationDeg?: number;
  frameTiltDeg?: number;
  viewport?: TrackModelViewport;
  sampleCar?: (driverNumber: number) => ReplayTrackCar | null;
  cars: ReplayTrackCar[];
  followDriver: number | null;
  onSelectDriver: (driverNumber: number) => void;
  panX: number;
  panY: number;
  rotationDeg: number;
  tiltDeg: number;
  trackId: ReplayTrackId;
  zoom: number;
};

type CarPose = ReplayTrackCar & {
  heading: number;
  position: readonly [number, number, number];
};

export function RaceReplayTrack3D({
  onOverviewPoints, frameRotationDeg, frameTiltDeg, viewport,
  sampleCar,
  cars,
  followDriver,
  onSelectDriver,
  panX,
  panY,
  rotationDeg,
  tiltDeg,
  trackId,
  zoom,
}: RaceReplayTrack3DProps) {
  const [isReady, setIsReady] = useState(false);
  const [eventSource, setEventSource] = useState<HTMLDivElement | null>(null);
  const config = useMemo(() => {
    const source = REPLAY_TRACK_CONFIGS[trackId];
    const pit = connectModelPitLane(source.path.trackPoints, source.path.pitLanePoints);
    return { ...source, path: { ...source.path, pitLanePoints: pit.points, pitTrackProgress: pit.anchors } };
  }, [trackId]);
  useLayoutEffect(() => { onOverviewPoints?.(config.path.trackPoints); }, [config, onOverviewPoints]);
  const poses = useMemo(() => cars.map((car) => buildCarPose(car, config)), [cars, config]);
  const followPosition = followDriver === null
    ? null
    : poses.find((car) => car.driverNumber === followDriver)?.position ?? null;

  return (
    <ReplayMapErrorBoundary fallback={<ReplayMapPreview config={config} />}>
      <div
        ref={setEventSource}
        aria-label={config.ariaLabel}
        className="relative size-full overflow-hidden rounded-lg border border-border/70 bg-black/35"
        role="img"
      >
        <ReplayMapPreview
          className={cn("transition-opacity duration-200 motion-reduce:transition-none", isReady && "opacity-0")}
          config={config}
        />
        {eventSource && <Canvas
          eventSource={eventSource}
          camera={{ far: 10_000, near: 1, position: [1_500, 1_700, 1_500], zoom: 0.3 }}
          className={cn(
            "absolute inset-0 size-full transition-opacity duration-200 motion-reduce:transition-none",
            isReady ? "opacity-100" : "opacity-0",
          )}
          dpr={[1, 1.5]}
          frameloop={sampleCar ? "always" : "demand"}
          gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
          onCreated={({ gl }) => gl.setClearAlpha(0)}
          orthographic
          performance={{ min: 0.5 }}
        >
          <ambientLight intensity={1.35} />
          <directionalLight intensity={2.1} position={[-900, 1_600, -1_100]} />
          <directionalLight intensity={0.7} position={[1_000, 900, 700]} />
          <ReplayCameraRig
            cameraConfig={config.camera}
            frame={viewport ? { bounds: getTrackModelFrame(config.path.trackPoints, frameRotationDeg ?? 0, frameTiltDeg ?? 10, rotationDeg, tiltDeg), viewport } : undefined}
            followPosition={followPosition}
            sampleFollowPosition={sampleCar && followDriver !== null ? () => {
              const car = sampleCar(followDriver);
              return car ? buildCarPose(car, config).position : null;
            } : undefined}
            panX={panX}
            panY={panY}
            rotationDeg={rotationDeg}
            tiltDeg={tiltDeg}
            zoom={zoom}
          />
          <Suspense fallback={null}>
            <TrackReplayScene
              cars={poses}
              sampleCar={sampleCar}
              config={config}
              onReady={() => setIsReady(true)}
              onSelectDriver={onSelectDriver}
            />
          </Suspense>
        </Canvas>}
        {!isReady ? <span className="sr-only">Готовим 3D-повтор гонки</span> : null}
      </div>
    </ReplayMapErrorBoundary>
  );
}

export function RaceReplayZandvoort3D(props: Omit<RaceReplayTrack3DProps, "trackId">) {
  return <RaceReplayTrack3D {...props} trackId="zandvoort" />;
}

function TrackReplayScene({
  sampleCar,
  cars,
  config,
  onReady,
  onSelectDriver,
}: {
  sampleCar?: RaceReplayTrack3DProps["sampleCar"];
  cars: CarPose[];
  config: ReplayTrackConfig;
  onReady: () => void;
  onSelectDriver: (driverNumber: number) => void;
}) {
  const gltf = useGLTF(config.assetPath, false, true);
  const invalidate = useThree((state) => state.invalidate);
  const hasReportedReady = useRef(false);
  const scene = useMemo(() => cloneScene(gltf.scene), [gltf.scene]);
  const anchors = useMemo(() => readAnchors(scene, config.turnCount), [config.turnCount, scene]);

  useLayoutEffect(() => {
    invalidate();
  }, [cars, invalidate, scene]);

  useFrame(() => {
    if (hasReportedReady.current) {
      return;
    }

    hasReportedReady.current = true;
    requestAnimationFrame(onReady);
  });

  return (
    <>
      <primitive dispose={null} object={scene} />
      <TrackAnnotations anchors={anchors} />
      {cars.map((car) => (
        <ReplayCar
          car={car}
          config={config}
          sampleCar={sampleCar}
          key={car.driverNumber}
          onSelect={() => onSelectDriver(car.driverNumber)}
        />
      ))}
    </>
  );
}

function ReplayCar({ car, config, sampleCar, onSelect }: {
  car: CarPose;
  config: ReplayTrackConfig;
  sampleCar?: RaceReplayTrack3DProps["sampleCar"];
  onSelect: () => void;
}) {
  const group = useRef<Group>(null);
  const label = useRef<HTMLSpanElement>(null);
  // LIVE samples the time buffer on every WebGL frame. React only updates
  // driver membership and selection, not the position of 22 cars per frame.
  useFrame(() => {
    if (!sampleCar || !group.current) return;
    const sample = sampleCar(car.driverNumber);
    group.current.visible = Boolean(sample);
    if (label.current) label.current.style.visibility = sample ? "visible" : "hidden";
    if (!sample) return;
    const pose = buildCarPose(sample, config);
    group.current.position.set(...pose.position);
    group.current.rotation.y = pose.heading;
  }, -1);
  return (
    <group
      ref={group}
      name={`ReplayCar_${car.driverNumber}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      position={car.position}
      rotation={[0, car.heading, 0]}
      scale={car.isSelected ? 1.16 : 1}
    >
      {car.isSelected ? (
        <mesh position={[0, -0.38, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[3.5, 4.15, 40]} />
          <meshBasicMaterial color={car.teamColor} depthWrite={false} transparent opacity={0.9} />
        </mesh>
      ) : null}
      <mesh castShadow position={[0, 0, -0.15]}>
        <boxGeometry args={[1.42, 0.52, 3.45]} />
        <meshStandardMaterial color={car.teamColor} metalness={0.12} roughness={0.5} />
      </mesh>
      <mesh castShadow position={[0, -0.02, 2.05]}>
        <boxGeometry args={[0.68, 0.3, 1.55]} />
        <meshStandardMaterial color={car.teamColor} metalness={0.12} roughness={0.5} />
      </mesh>
      <mesh castShadow position={[0, 0.32, -0.5]}>
        <boxGeometry args={[0.8, 0.44, 1.05]} />
        <meshStandardMaterial color="#14161a" metalness={0.15} roughness={0.42} />
      </mesh>
      <mesh position={[0, 0.15, 2.72]}>
        <boxGeometry args={[1.75, 0.12, 0.46]} />
        <meshStandardMaterial color={car.teamColor} roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.48, -2.05]}>
        <boxGeometry args={[1.85, 0.22, 0.42]} />
        <meshStandardMaterial color={car.teamColor} roughness={0.55} />
      </mesh>
      {[-1, 1].flatMap((side) => [-1.45, 1.35].map((z) => (
        <mesh key={`${side}-${z}`} position={[side * 0.92, -0.02, z]}>
          <boxGeometry args={[0.36, 0.55, 0.72]} />
          <meshStandardMaterial color="#08090b" metalness={0.05} roughness={0.82} />
        </mesh>
      )))}
      <Html
        center
        pointerEvents="none"
        position={[0, 3.1, 0]}
        zIndexRange={[28, 0]}
      >
        <span
          ref={label}
          className={cn(
            "pointer-events-none whitespace-nowrap rounded border bg-black/88 px-1.5 py-0.5 font-mono text-[0.58rem] font-black leading-none text-white shadow-lg",
            car.isSelected && "px-2 py-1 text-[0.68rem]",
            car.isPitLane && "border-amber-400",
          )}
          style={{ borderColor: car.isPitLane ? undefined : car.teamColor }}
          title={car.fullName}
        >
          {car.abbreviation}
        </span>
      </Html>
    </group>
  );
}

function ReplayCameraRig({
  frame,
  sampleFollowPosition,
  cameraConfig,
  followPosition,
  panX,
  panY,
  rotationDeg,
  tiltDeg,
  zoom,
}: {
  frame?: import("@/lib/track-model-camera").TrackModelCameraFrame;
  sampleFollowPosition?: () => readonly [number, number, number] | null;
  cameraConfig: ReplayTrackConfig["camera"];
  followPosition: readonly [number, number, number] | null;
  panX: number;
  panY: number;
  rotationDeg: number;
  tiltDeg: number;
  zoom: number;
}) {
  const cameraRef = useRef<OrthographicCamera>(null);
  const invalidate = useThree((state) => state.invalidate);
  const height = useThree((state) => state.size.height);
  const width = useThree((state) => state.size.width);

  useFrame(() => {
    const position = sampleFollowPosition?.();
    const camera = cameraRef.current;
    if (!position || !camera) return;
    const polar = MathUtils.degToRad(trackModelCameraPolarDeg(tiltDeg));
    const azimuth = MathUtils.degToRad(38 + rotationDeg);
    const radius = cameraConfig.radius;
    camera.position.set(position[0] + Math.sin(azimuth) * Math.sin(polar) * radius,
      position[1] + Math.cos(polar) * radius,
      position[2] + Math.cos(azimuth) * Math.sin(polar) * radius);
    camera.lookAt(...position);
  }, -1);

  useLayoutEffect(() => {
    const camera = cameraRef.current;

    if (!camera) {
      return;
    }

    const target = followPosition ? new Vector3(...followPosition) : new Vector3(0, cameraConfig.lookAtY, 0);
    const polarDeg = trackModelCameraPolarDeg(tiltDeg);
    const polar = MathUtils.degToRad(polarDeg);
    const azimuth = MathUtils.degToRad(38 + rotationDeg);
    const radius = cameraConfig.radius;
    const horizontalRadius = Math.sin(polar) * radius;

    camera.position.set(
      target.x + Math.sin(azimuth) * horizontalRadius,
      target.y + Math.cos(polar) * radius,
      target.z + Math.cos(azimuth) * horizontalRadius,
    );
    camera.lookAt(target);
    const fitted = frame ? fitTrackModelFrame(frame.bounds, { ...frame.viewport, width, height }) : null;
    camera.zoom = (fitted?.scale ?? Math.min(width / cameraConfig.fitWidth, height / cameraConfig.fitHeight)) * zoom;
    camera.clearViewOffset();

    if (!followPosition) {
      const offsetX = (fitted?.offsetX ?? 0) * zoom + panX * width;
      const offsetY = fitted && frame
        ? frame.bounds.centerY * fitted.scale * zoom + (frame.viewport.top - frame.viewport.bottom) / 2 + panY * height
        : panY * height;
      if (offsetX !== 0 || offsetY !== 0) camera.setViewOffset(width, height, -offsetX, -offsetY, width, height);
    }

    camera.updateProjectionMatrix();
    invalidate();
  }, [cameraConfig, frame, followPosition, height, invalidate, panX, panY, rotationDeg, tiltDeg, width, zoom]);

  return (
    <DreiOrthographicCamera
      far={10_000}
      makeDefault
      near={1}
      position={[1_500, 1_700, 1_500]}
      ref={cameraRef}
      zoom={0.3}
    />
  );
}

function TrackAnnotations({ anchors }: { anchors: ReturnType<typeof readAnchors> }) {
  return (
    <>
      {anchors.turns.map(({ number, position }) => (
        <Html center key={number} pointerEvents="none" position={position} zIndexRange={[20, 0]}>
          <span className="pointer-events-none grid size-[1.125rem] place-items-center rounded-full border border-white/45 bg-black/85 font-mono text-[0.52rem] font-black leading-none text-white shadow-sm">
            {number}
          </span>
        </Html>
      ))}
      {anchors.speedTrap ? (
        <Html center pointerEvents="none" position={anchors.speedTrap} zIndexRange={[20, 0]}>
          <span className="pointer-events-none rounded-sm border border-emerald-400/80 bg-black/85 px-1.5 py-1 font-mono text-[0.56rem] font-bold text-emerald-300 shadow-sm">
            ST
          </span>
        </Html>
      ) : null}
      {anchors.sectors.map(({ label, position, sector }) => (
        <Html center key={label} pointerEvents="none" position={position} zIndexRange={[18, 0]}>
          <span
            className="pointer-events-none hidden whitespace-nowrap rounded-sm border bg-black/85 px-2 py-1 font-mono text-[0.52rem] font-black text-white shadow-[0_0_18px_currentColor] sm:block"
            style={{ color: `var(--track-model-sector-${sector})` }}
          >
            {label}
          </span>
        </Html>
      ))}
    </>
  );
}

function buildCarPose(car: ReplayTrackCar, config: ReplayTrackConfig): CarPose {
  const path = car.isPitLane && car.pitLaneProgress !== null
    ? config.path.pitLanePoints
    : config.path.trackPoints;
  const progress = car.isPitLane && car.pitLaneProgress !== null
    ? car.pitLaneProgress
    : car.pitTrackProgress && config.path.pitTrackProgress
      ? alignPitTrackProgress(car.progress, car.pitTrackProgress, config.path.pitTrackProgress)
      : normalizeProgress(car.progress + config.path.startFinishProgress);
  const sample = sampleReplayPath(path, progress, config.path);
  const lateralOffsetMeters = car.isPitLane
    ? 0
    : car.lateralOffset * (config.path.trackWidthMeters / 26);
  const normalX = -sample.directionZ;
  const normalZ = sample.directionX;

  return {
    ...car,
    heading: Math.atan2(sample.directionX, sample.directionZ),
    position: [
      sample.x + normalX * lateralOffsetMeters,
      sample.y,
      sample.z + normalZ * lateralOffsetMeters,
    ],
  };
}

function sampleReplayPath(
  points: readonly CircuitModelPoint[],
  requestedProgress: number,
  pathConfig: ReplayTrackConfig["path"],
) {
  const progress = Math.max(0, Math.min(1, requestedProgress));
  let upper = points.findIndex((point) => point[0] >= progress);

  if (upper < 0) upper = points.length - 1;
  if (upper === 0) {
    upper = 1;
  }

  const first = points[upper - 1];
  const second = points[Math.min(upper, points.length - 1)];
  const blend = MathUtils.clamp((progress - first[0]) / Math.max(second[0] - first[0], 1e-9), 0, 1);
  const x = first[1] + (second[1] - first[1]) * blend;
  const sourceY = first[2] + (second[2] - first[2]) * blend;
  const elevationNapMeters = (first[3] + (second[3] - first[3]) * blend) / 10;
  const directionXRaw = second[1] - first[1];
  const directionZRaw = -(second[2] - first[2]);
  const directionLength = Math.hypot(directionXRaw, directionZRaw) || 1;

  return {
    directionX: directionXRaw / directionLength,
    directionZ: directionZRaw / directionLength,
    x,
    y: elevationNapMeters - pathConfig.baseElevationMeters + pathConfig.surfaceOffsetMeters,
    z: -sourceY,
  };
}

function normalizeProgress(progress: number) {
  return ((progress % 1) + 1) % 1;
}

function cloneScene(source: Object3D) {
  const cloned = source.clone(true);

  cloned.traverse((object) => {
    object.frustumCulled = true;
  });
  cloned.updateMatrixWorld(true);
  return cloned;
}

function readAnchors(scene: Object3D, turnCount: number) {
  scene.updateMatrixWorld(true);
  const turns = Array.from({ length: turnCount }, (_, index) => {
    const number = index + 1;
    const anchor = scene.getObjectByName(`Turn_${String(number).padStart(2, "0")}`);

    return anchor ? { number, position: anchor.getWorldPosition(new Vector3()) } : null;
  }).filter((anchor): anchor is { number: number; position: Vector3 } => anchor !== null);

  return {
    sectors: [
      { label: "S1", position: readAnchorPosition(scene, "StartFinish"), sector: 1 },
      { label: "S2", position: readAnchorPosition(scene, "SectorBoundary_02"), sector: 2 },
      { label: "S3", position: readAnchorPosition(scene, "SectorBoundary_03"), sector: 3 },
    ].filter(
      (anchor): anchor is { label: string; position: Vector3; sector: number } => anchor.position !== null,
    ),
    speedTrap: readAnchorPosition(scene, "SpeedTrap"),
    turns,
  };
}

function readAnchorPosition(scene: Object3D, name: string) {
  const anchor = scene.getObjectByName(name);
  return anchor ? anchor.getWorldPosition(new Vector3()) : null;
}

function ReplayMapPreview({ className, config }: { className?: string; config: ReplayTrackConfig }) {
  return (
    <div className={cn("absolute inset-0 size-full overflow-hidden bg-black/25", className)}>
      <Image
        alt={config.alt}
        className="pointer-events-none object-contain opacity-80"
        draggable={false}
        fill
        loading="eager"
        sizes="(max-width: 768px) 100vw, 960px"
        src={config.previewPath}
      />
    </div>
  );
}

type ReplayMapErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

class ReplayMapErrorBoundary extends Component<ReplayMapErrorBoundaryProps, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    // Static preview is the intentional recovery path when WebGL is unavailable.
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

useGLTF.preload(ZANDVOORT_ASSET_PATH);
useGLTF.preload(SPA_TRACK_MODEL.webgl.assetPath);
useGLTF.preload(HUNGARORING_TRACK_MODEL.webgl.assetPath);
useGLTF.preload(RED_BULL_RING_TRACK_MODEL.webgl.assetPath);
