"use client";

import { Html, OrthographicCamera as DreiOrthographicCamera, useGLTF } from "@react-three/drei";
import {
  Canvas,
  type EventManager,
  useFrame,
  useThree,
} from "@react-three/fiber";
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
  Object3D,
  OrthographicCamera,
  Vector3,
} from "three";

import { fitTrackModelFrame, type TrackModelCameraFrame, getTrackModelOrbitPosition } from "@/lib/track-model-camera";
import { cn } from "@/lib/utils";

type TrackModelWebGLProps = {
  frame?: TrackModelCameraFrame;
  assetPath: string;
  camera: {
    fitHeight: number;
    fitWidth: number;
    narrowFitWidth?: number;
    lookAtY: number;
    radius: number;
  };
  circuit: string;
  elevationDatumLabel: string;
  elevationApproximate?: boolean;
  panX: number;
  panY: number;
  previewPath: string;
  rotationDeg: number;
  showElevationAnchors: boolean;
  tiltDeg: number;
  turnCount: number;
  zoom: number;
};

export function TrackModelWebGL({
  frame,
  assetPath,
  camera,
  circuit,
  elevationDatumLabel,
  elevationApproximate = false,
  panX,
  panY,
  previewPath,
  rotationDeg,
  showElevationAnchors,
  tiltDeg,
  turnCount,
  zoom,
}: TrackModelWebGLProps) {
  const [isReady, setIsReady] = useState(false);
  const isNightScene = assetPath.includes("/singapore.glb") || assetPath.includes("/las-vegas.glb");

  return (
    <TrackModelErrorBoundary
      fallback={<TrackModelStaticPreview circuit={circuit} previewPath={previewPath} zoom={zoom} />}
    >
      {/* Keep projected HTML labels inside the scene layer, below map controls. */}
      <div aria-hidden="true" className="absolute inset-0 isolate z-0 size-full overflow-hidden">
        <TrackModelStaticPreview
          circuit={circuit}
          className={cn(
            "transition-opacity duration-200 motion-reduce:transition-none",
            isReady && "opacity-0",
          )}
          previewPath={previewPath}
          zoom={zoom}
        />
        <Canvas
          camera={{ far: 10_000, near: 1, position: [1_500, 1_700, 1_500], zoom: 0.3 }}
          className={cn(
            "absolute inset-0 size-full transition-opacity duration-200 motion-reduce:transition-none",
            isReady ? "opacity-100" : "opacity-0",
          )}
          dpr={[1, 1.5]}
          events={createDisabledEventManager}
          fallback={<TrackModelStaticPreview circuit={circuit} previewPath={previewPath} zoom={zoom} />}
          frameloop="demand"
          gl={{
            alpha: true,
            antialias: true,
            powerPreference: "high-performance",
          }}
          onCreated={({ gl }) => gl.setClearAlpha(0)}
          orthographic
          performance={{ min: 0.5 }}
        >
          {isNightScene ? <color attach="background" args={["#080f1e"]} /> : null}
          <ambientLight intensity={isNightScene ? 0.65 : 1.35} color={isNightScene ? "#8ca9d7" : "#ffffff"} />
          <directionalLight intensity={isNightScene ? 0.65 : 2.1} color={isNightScene ? "#a0bcf0" : "#ffffff"} position={[-900, 1_600, -1_100]} />
          <directionalLight intensity={isNightScene ? 0.3 : 0.65} position={[1_000, 900, 700]} />
          <CameraRig
            camera={camera}
            frame={frame}
            panX={panX}
            panY={panY}
            rotationDeg={rotationDeg}
            tiltDeg={tiltDeg}
            zoom={zoom}
          />
          <Suspense fallback={null}>
            <TrackDigitalTwinScene
              assetPath={assetPath}
              elevationDatumLabel={elevationDatumLabel}
              elevationApproximate={elevationApproximate}
              onReady={() => setIsReady(true)}
              showElevationAnchors={showElevationAnchors}
              turnCount={turnCount}
            />
          </Suspense>
        </Canvas>
      </div>
    </TrackModelErrorBoundary>
  );
}

export function TrackModelStaticPreview({
  circuit,
  className,
  previewPath,
  zoom = 1,
}: {
  circuit: string;
  className?: string;
  previewPath: string;
  zoom?: number;
}) {
  return (
    <div className={cn("absolute inset-0 size-full overflow-hidden", className)}>
      <Image
        alt={`Трасса ${circuit}`}
        className="pointer-events-none object-contain"
        draggable={false}
        fill
        loading="eager"
        sizes="(max-width: 768px) 100vw, 720px"
        src={previewPath}
        style={{ transform: `scale(${zoom})` }}
      />
    </div>
  );
}

function TrackDigitalTwinScene({
  assetPath,
  elevationDatumLabel,
  elevationApproximate,
  onReady,
  showElevationAnchors,
  turnCount,
}: {
  assetPath: string;
  elevationDatumLabel: string;
  elevationApproximate: boolean;
  onReady: () => void;
  showElevationAnchors: boolean;
  turnCount: number;
}) {
  const gltf = useGLTF(assetPath, false, true);
  const invalidate = useThree((state) => state.invalidate);
  const hasReportedReady = useRef(false);
  const scene = useMemo(() => cloneScene(gltf.scene), [gltf.scene]);
  const anchors = useMemo(() => readAnchors(scene, turnCount), [scene, turnCount]);

  useLayoutEffect(() => {
    invalidate();
  }, [invalidate, scene]);

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
      {anchors.turns.map(({ number, position }) => (
        <Html
          center
          key={number}
          pointerEvents="none"
          position={position}
          zIndexRange={[20, 0]}
        >
          <span
            className="pointer-events-none grid size-[1.125rem] place-items-center rounded-full border border-[var(--track-model-turn-line)] bg-[var(--track-model-turn-bg)] font-mono text-[0.52rem] font-black leading-none text-[var(--track-model-turn-text)] shadow-sm @lg/track:size-5 @lg/track:text-[0.6rem]"
          >
            {number}
          </span>
        </Html>
      ))}
      {anchors.speedTrap ? (
        <Html
          center
          pointerEvents="none"
          position={anchors.speedTrap}
          zIndexRange={[20, 0]}
        >
          <span className="pointer-events-none rounded-sm border border-[var(--track-model-speed-trap)] bg-[var(--track-model-speed-trap-bg)] px-1.5 py-1 font-mono text-[0.56rem] font-bold text-[var(--track-model-speed-trap-text)] shadow-sm">
            ST
          </span>
        </Html>
      ) : null}
      {anchors.sectors.map(({ label, position, sector }) => {
        const sectorColor = `var(--track-model-sector-${sector})`;

        return (
        <Html
          center
          key={label}
          pointerEvents="none"
          position={position}
          zIndexRange={[18, 0]}
        >
          <span
            className="pointer-events-none hidden whitespace-nowrap rounded-sm border bg-black/80 px-2 py-1 font-mono text-[0.52rem] font-black text-white @md/track:block"
            style={{
              borderColor: sectorColor,
              boxShadow: `0 0 0 1px color-mix(in srgb, ${sectorColor} 55%, transparent), 0 0 16px color-mix(in srgb, ${sectorColor} 72%, transparent)`,
            }}
          >
            {label}
          </span>
        </Html>
        );
      })}
      {showElevationAnchors && anchors.highPoint ? (
        <Html
          center
          pointerEvents="none"
          position={anchors.highPoint.position}
          zIndexRange={[20, 0]}
        >
          <span title={elevationApproximate ? "Самая высокая точка: примерная высота над уровнем моря" : "Самая высокая точка"}
            className={cn("pointer-events-none whitespace-nowrap rounded border border-[var(--track-model-height-border)] bg-[var(--track-model-height-bg)] px-2 py-1 font-mono text-[0.65rem] font-bold text-[var(--track-model-height-text)] shadow-sm",
              elevationApproximate ? "block" : "hidden @lg/track:block")}>
            {elevationApproximate ? <>{Math.round(anchors.highPoint.elevation).toLocaleString("ru-RU")} {elevationDatumLabel}</>
              : <>{formatElevation(anchors.highPoint.elevation)} {elevationDatumLabel}</>}
          </span>
        </Html>
      ) : null}
      {showElevationAnchors && anchors.lowPoint ? (
        <Html
          center
          pointerEvents="none"
          position={anchors.lowPoint.position}
          zIndexRange={[20, 0]}
        >
          <span title={elevationApproximate ? "Самая низкая точка: примерная высота над уровнем моря" : "Самая низкая точка"}
            className={cn("pointer-events-none whitespace-nowrap rounded border border-[var(--track-model-height-border)] bg-[var(--track-model-height-bg)] px-2 py-1 font-mono text-[0.65rem] font-bold text-[var(--track-model-height-text)] shadow-sm",
              elevationApproximate ? "block" : "hidden @lg/track:block")}>
            {elevationApproximate ? <>{Math.round(anchors.lowPoint.elevation).toLocaleString("ru-RU")} {elevationDatumLabel}</>
              : <>{formatElevation(anchors.lowPoint.elevation)} {elevationDatumLabel}</>}
          </span>
        </Html>
      ) : null}
    </>
  );
}

function CameraRig({
  frame,
  camera: cameraSettings,
  panX,
  panY,
  rotationDeg,
  tiltDeg,
  zoom,
}: Pick<TrackModelWebGLProps, "frame" | "camera" | "panX" | "panY" | "rotationDeg" | "tiltDeg" | "zoom">) {
  const cameraRef = useRef<OrthographicCamera>(null);
  const invalidate = useThree((state) => state.invalidate);
  const height = useThree((state) => state.size.height);
  const width = useThree((state) => state.size.width);

  useLayoutEffect(() => {
    const camera = cameraRef.current;

    if (!camera) {
      return;
    }

    camera.position.set(...getTrackModelOrbitPosition({
      lookAtY: cameraSettings.lookAtY,
      radius: cameraSettings.radius,
      rotationDeg,
      tiltDeg,
    }));
    camera.lookAt(0, cameraSettings.lookAtY, 0);
    const fitWidth = width < 400 ? (cameraSettings.narrowFitWidth ?? cameraSettings.fitWidth) : cameraSettings.fitWidth;
    const fitted = frame ? fitTrackModelFrame(frame.bounds, { ...frame.viewport, width, height }) : null;
    camera.zoom = (fitted?.scale ?? Math.min(width / fitWidth, height / cameraSettings.fitHeight)) * zoom;
    camera.clearViewOffset();
    const offsetX = (fitted?.offsetX ?? 0) * zoom + panX * width;
    const offsetY = frame
      ? frame.bounds.centerY * fitted!.scale * zoom + (frame.viewport.top - frame.viewport.bottom) / 2 + panY * height
      : panY * height;
    if (offsetX !== 0 || offsetY !== 0) camera.setViewOffset(width, height, -offsetX, -offsetY, width, height);

    camera.updateProjectionMatrix();
    invalidate();
  }, [cameraSettings, frame, height, invalidate, panX, panY, rotationDeg, tiltDeg, width, zoom]);

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
  const turns: { number: number | string; position: Vector3 }[] = Array.from({ length: turnCount }, (_, index) => {
    const number = index + 1;
    const anchor = scene.getObjectByName(`Turn_${String(number).padStart(2, "0")}`);

    return anchor ? { number, position: anchor.getWorldPosition(new Vector3()) } : null;
  }).filter((anchor): anchor is { number: number; position: Vector3 } => anchor !== null);

  // Official maps can include lettered corners without increasing the numbered
  // turn count (Madring's 5A and 20A). Their positions still travel with the GLB.
  scene.traverse((anchor) => {
    if (/^Turn_\d+[A-Z]$/.test(anchor.name) && typeof anchor.userData.turn_label === "string") {
      turns.push({ number: anchor.userData.turn_label, position: anchor.getWorldPosition(new Vector3()) });
    }
  });

  return {
    highPoint: readElevationAnchor(scene, "HighPoint"),
    lowPoint: readElevationAnchor(scene, "LowPoint"),
    sectors: [
      { label: "S1", position: readAnchorPosition(scene, "StartFinish"), sector: 1 },
      { label: "S2", position: readAnchorPosition(scene, "SectorBoundary_02"), sector: 2 },
      { label: "S3", position: readAnchorPosition(scene, "SectorBoundary_03"), sector: 3 },
    ].filter(
      (anchor): anchor is { label: string; position: Vector3; sector: number } =>
        anchor.position !== null,
    ),
    speedTrap: readAnchorPosition(scene, "SpeedTrap"),
    turns,
  };
}

function readAnchorPosition(scene: Object3D, name: string) {
  const anchor = scene.getObjectByName(name);
  return anchor ? anchor.getWorldPosition(new Vector3()) : null;
}

function readElevationAnchor(scene: Object3D, name: string) {
  const anchor = scene.getObjectByName(name);

  if (!anchor) {
    return null;
  }

  return {
    elevation: Number(
      anchor.userData.elevation_datum_m
      ?? anchor.userData.elevation_dng_m
      ?? anchor.userData.elevation_nap_m,
    ),
    position: anchor.getWorldPosition(new Vector3()),
  };
}

function formatElevation(value: number) {
  return value.toFixed(1).replace(".", ",");
}

function createDisabledEventManager(): EventManager<HTMLElement> {
  return {
    connect: () => undefined,
    connected: undefined,
    disconnect: () => undefined,
    enabled: false,
    priority: 0,
    update: () => undefined,
  };
}

type TrackModelErrorBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

type TrackModelErrorBoundaryState = {
  hasError: boolean;
};

class TrackModelErrorBoundary extends Component<
  TrackModelErrorBoundaryProps,
  TrackModelErrorBoundaryState
> {
  state = { hasError: false };

  static getDerivedStateFromError(): TrackModelErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch() {
    // The static preview is the intentional recovery path for WebGL and asset failures.
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
