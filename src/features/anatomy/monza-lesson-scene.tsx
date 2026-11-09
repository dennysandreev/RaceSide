"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Html, Lightformer, useGLTF } from "@react-three/drei";
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { ACESFilmicToneMapping, Group, Mesh, PerspectiveCamera, Raycaster, Vector3 } from "three";
import { Button } from "@/components/ui/button";
import { MONZA_TRACK_MODEL } from "@/data/monza-model";
import { TrackSceneLighting } from "@/components/racemate/track-scene-lighting";
import { configureTrackShadows } from "@/lib/track-model-shadows";
import { W17LessonCar } from "./w17-viewer";
import type { LessonFrame } from "./monza-lesson";
import { monzaFollowCameraPosition, sampleMonzaPose } from "./monza-lesson-track";

export type LessonCamera = "follow" | "overview";
type CarProps = Omit<ComponentProps<typeof W17LessonCar>, "onReady">;
type SceneProps = { car: CarProps; cameraMode: LessonCamera; reduced: boolean; callout: string; onInspect: () => void };

export function MonzaLessonScene(props: SceneProps) {
  const [ready, setReady] = useState(false);
  const [flowStatus, setFlowStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  return <div className="an-lesson-world" data-ready={ready} aria-label="Болид на трёхмерной трассе Монцы">
    <SceneBoundary key={retry} onFail={() => setReady(true)} retry={() => { useGLTF.clear(MONZA_TRACK_MODEL.webgl.assetPath); setReady(false); setRetry(value => value + 1); }}>
      <Canvas shadows camera={{ fov: 43, near: .1, far: 12000, position: [-540, 26, 230] }} dpr={[1, 1.5]} frameloop="demand" gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl, raycaster }) => { gl.toneMapping = ACESFilmicToneMapping; gl.toneMappingExposure = 1.15; raycaster.layers.set(1); }}
        fallback={<SceneUnavailable onReady={() => setReady(true)}/>}>
        <color attach="background" args={["#b8c6ca"]}/>
        <Suspense fallback={null}>
          <Environment resolution={64} environmentIntensity={.7}>
            <Lightformer form="rect" intensity={3} scale={[15, 8, 1]} position={[0, 6, 0]} rotation={[-Math.PI / 2, 0, 0]}/>
            <Lightformer form="rect" intensity={1.5} scale={[12, 4, 1]} position={[0, 3, 6]} rotation={[0, Math.PI, 0]}/>
          </Environment>
          <TrackScene {...props} onFlowStatus={setFlowStatus} onReady={() => setReady(true)}/>
        </Suspense>
      </Canvas>
    </SceneBoundary>
    {!ready && <div className="an-lesson-scene-loading" role="status"><span>Монца</span><p>Готовим трассу и болид…</p></div>}
    {ready && props.car.lesson?.system === "aero" && flowStatus !== "ready" && <p className="an-lesson-flow-status" role="status">{flowStatus === "error" ? "Потоки не загрузились. Переключи систему и попробуй ещё раз." : "Готовим потоки воздуха…"}</p>}
  </div>;
}

function SceneUnavailable({ onReady }: { onReady: () => void }) {
  useEffect(() => { onReady(); }, [onReady]);
  return <div className="an-lesson-scene-error">Для поездки по Монце нужен браузер с поддержкой 3D. Пояснения и выбор моментов доступны ниже.</div>;
}

function TrackScene({ car, cameraMode, reduced, callout, onInspect, onReady, onFlowStatus }: SceneProps & { onReady: () => void; onFlowStatus: (status: "loading" | "ready" | "error") => void }) {
  const { scene: template } = useGLTF(MONZA_TRACK_MODEL.webgl.assetPath, false, true);
  const scene = useMemo(() => {
    const copy = template.clone(true);
    // Survey annotations are designed for an overview map, not an on-track shot.
    copy.traverse(part => { if (/anchor|label|annotation/i.test(part.name)) part.visible = false; });
    configureTrackShadows(copy);
    copy.updateMatrixWorld(true);
    return copy;
  }, [template]);
  const road = useMemo(() => scene.getObjectByName("FIA_Monza_Centreline_12m") as Mesh | undefined, [scene]);
  const carRoot = useRef<Group>(null);
  const { camera, size, invalidate } = useThree();
  const ray = useMemo(() => new Raycaster(), []);
  const view = useRef({ initialized: false, mode: cameraMode, inside: car.inside, transition: 0, lastTime: -1, target: new Vector3() });
  const clock = car.lesson!.clock as RefObject<LessonFrame>;
  useLayoutEffect(() => { invalidate(); }, [invalidate, cameraMode, car.inside, car.playing, car.lesson?.revision, size]);
  // R3F owns attachment of the primitive. Removing it in effect cleanup also
  // detaches the live track during React Strict Mode's effect replay.

  useFrame((_, delta) => {
    if (!carRoot.current || !(camera instanceof PerspectiveCamera)) return;
    const frame = clock.current, pose = sampleMonzaPose(frame.progress);
    if (road) {
      ray.set(new Vector3(pose.position.x, 100, pose.position.z), new Vector3(0, -1, 0));
      const hit = ray.intersectObject(road, false)[0];
      if (hit) pose.position.y = hit.point.y;
    }
    carRoot.current.position.copy(pose.position);
    carRoot.current.rotation.set(0, pose.yaw, pose.pitch);
    const aspect = size.width / Math.max(1, size.height);
    const target = pose.position.clone().addScaledVector(pose.forward, car.inside ? 0 : 2);
    target.y += .6;
    const cameraPosition = monzaFollowCameraPosition(pose,car.inside,aspect);
    if (cameraMode === "overview") {
      target.set(80, 18, -450);
      cameraPosition.set(1300, 2350, 1650).sub(target).multiplyScalar(Math.max(1, 1.25 / aspect)).add(target);
    }
    const state = view.current;
    const seeked = Math.abs(frame.time - state.lastTime) > .5;
    if (state.mode !== cameraMode || state.inside !== car.inside) {
      state.transition = reduced ? 0 : .7; state.mode = cameraMode; state.inside = car.inside;
    }
    const blend = !state.initialized || seeked || reduced || state.transition <= 0 ? 1 : 1 - Math.exp(-Math.min(delta, .05) * 9);
    camera.position.lerp(cameraPosition, blend); state.target.lerp(target, blend);
    camera.lookAt(state.target); state.initialized = true; state.lastTime = frame.time;
    state.transition = Math.max(0, state.transition - Math.min(delta, .05));
    if (car.playing || state.transition > 0) invalidate();
  }, -2);

  return <>
    <TrackSceneLighting scene={scene} moving/>
    <primitive object={scene} dispose={null}/>
    <group ref={carRoot}>
      <W17LessonCar {...car} onFlowStatus={onFlowStatus} onReady={() => { if (carRoot.current) configureTrackShadows(carRoot.current); invalidate(); onReady(); }}/>
      {cameraMode === "follow" && <Html position={[-.5, 1.5, 0]} center zIndexRange={[3, 0]} distanceFactor={16}>
        <button type="button" className="an-lesson-world-callout" onClick={onInspect}><span/>{callout}<span aria-hidden="true">↗</span></button>
      </Html>}
      {cameraMode === "overview" && <Html position={[0, 8, 0]} center zIndexRange={[3, 0]}><span className="an-lesson-world-marker" aria-hidden="true"/></Html>}
    </group>
  </>;
}

class SceneBoundary extends Component<{ children: ReactNode; retry: () => void; onFail: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFail(); }
  render() { return this.state.failed ? <div className="an-lesson-scene-error"><p>Трасса не загрузилась</p><Button variant="outline" onClick={this.props.retry}>Попробовать ещё раз</Button></div> : this.props.children; }
}
