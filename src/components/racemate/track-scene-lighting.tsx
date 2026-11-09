"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Box3, DirectionalLight, Object3D, Vector3 } from "three";
import { trackShadowFrame } from "@/lib/track-model-shadows";

export function TrackSceneLighting({ scene, night = false, moving = false }: {
  scene: Object3D; night?: boolean; moving?: boolean;
}) {
  const light = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const bounds = useMemo(() => new Box3().setFromObject(scene), [scene]);
  const last = useRef({ radius: 0, target: new Vector3(Infinity,Infinity,Infinity) });
  const { gl, size } = useThree();
  const resolution = Math.min(gl.capabilities.maxTextureSize, size.width < 768 ? 2048 : 4096);
  useLayoutEffect(() => {
    if (light.current) light.current.shadow.needsUpdate = true;
  }, [scene,resolution]);
  useFrame(({ camera }) => {
    const sun = light.current;
    if (!sun) return;
    const frame = trackShadowFrame(camera,bounds,resolution);
    const changed = Math.abs(frame.radius-last.current.radius)>.01 || frame.target.distanceToSquared(last.current.target)>.001;
    if (changed) {
      target.position.copy(frame.target);
      target.updateMatrixWorld();
      sun.position.copy(frame.target).add(new Vector3(-1800,3200,-2200));
      sun.updateMatrixWorld();
      const shadowCamera = sun.shadow.camera;
      shadowCamera.left = shadowCamera.bottom = -frame.radius;
      shadowCamera.right = shadowCamera.top = frame.radius;
      shadowCamera.updateProjectionMatrix();
      sun.shadow.normalBias = Math.max(.03,frame.radius/resolution*.25);
      last.current = { radius: frame.radius, target: frame.target };
    }
    sun.shadow.needsUpdate ||= changed || moving;
  }, -1);
  return <>
    <ambientLight intensity={night ? .55 : .8} color={night ? "#8ca9d7" : "#e6edf2"}/>
    <hemisphereLight args={[night ? "#8099bc" : "#dbe8f0", "#515442", night ? .25 : .45]}/>
    <primitive object={target}/>
    <directionalLight ref={light} target={target} castShadow intensity={night ? .85 : 2.4}
      color={night ? "#a0bcf0" : "#fff3df"} position={[-1800,3200,-2200]}
      shadow-mapSize={[resolution,resolution]} shadow-camera-near={1} shadow-camera-far={10000}
      shadow-bias={-.000006} shadow-normalBias={.03} shadow-autoUpdate={false}/>
    <directionalLight intensity={night ? .2 : .35} position={[1000,900,700]}/>
  </>;
}
