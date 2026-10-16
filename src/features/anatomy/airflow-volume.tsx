"use client";

/* eslint-disable react-hooks/immutability -- Buffer attributes belong to the Three render loop. */

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as T from "three";
import { airflowRadius, illustrativeFlowSpeed, sampleAirflowPoint, type AirflowLayer, type AirflowPath } from "./w17-airflow";
import type { WingMotion } from "./w17-geometry";

const radial=6;
const palette=[new T.Color("#477de0"),new T.Color("#43c8dd"),new T.Color("#b9da85"),new T.Color("#f3b765")];
function flowColor(speed:number,target:T.Color) {
  const value=T.MathUtils.clamp((speed-.4)/1.3,0,1)*3,index=Math.min(2,Math.floor(value));
  return target.copy(palette[index]).lerp(palette[index+1],value-index);
}

export function AirflowVolume({paths,layer,playing,opening}:{paths:AirflowPath[];layer:AirflowLayer|"off";playing:boolean;opening:RefObject<WingMotion>}) {
  const {invalidate}=useThree();
  const reduced=useRef(false),time=useRef(0),built=useRef(Number.NaN);
  const graphics=useMemo(()=>{
    const root=new T.Group();root.name="Illustrative volumetric airflow";
    const material=new T.ShaderMaterial({
      transparent:true,depthWrite:false,depthTest:true,side:T.FrontSide,
      uniforms:{time:{value:0}},
      vertexShader:`attribute vec3 color; attribute float travel; attribute float progress;
        varying vec3 flowColor; varying float flowTravel; varying float flowProgress;
        void main(){flowColor=color;flowTravel=travel;flowProgress=progress;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader:`uniform float time; varying vec3 flowColor; varying float flowTravel; varying float flowProgress;
        void main(){float pulse=pow(fract(flowTravel-time*.65),13.0);
          float fade=smoothstep(0.0,.08,flowProgress)*(1.0-smoothstep(.85,1.0,flowProgress));
          gl_FragColor=vec4(flowColor*(1.0+pulse*.2),(.22+pulse*.4)*fade);}`,
    });
    const particleMaterial=new T.ShaderMaterial({
      transparent:true,depthWrite:false,depthTest:true,
      vertexShader:`attribute vec3 color; varying vec3 flowColor;
        void main(){flowColor=color;vec4 p=modelViewMatrix*vec4(position,1.0);
          gl_Position=projectionMatrix*p;gl_PointSize=4.0;}`,
      fragmentShader:`varying vec3 flowColor;
        void main(){float r=length(gl_PointCoord-vec2(.5));if(r>.5)discard;
          gl_FragColor=vec4(flowColor,1.0-smoothstep(.18,.5,r));}`,
    });
    const entries=paths.map((path,index)=>{
      const samples=path.corner.length;
      const group=new T.Group();root.add(group);
      const geometry=new T.BufferGeometry(),positions=new T.Float32BufferAttribute(new Float32Array(samples*radial*3),3),colors=new T.Float32BufferAttribute(new Float32Array(samples*radial*3),3),travel=new T.Float32BufferAttribute(new Float32Array(samples*radial),1),indices:number[]=[];
      for(let row=0;row<samples-1;row++)for(let col=0;col<radial;col++){
        const a=row*radial+col,b=row*radial+(col+1)%radial,c=a+radial,d=b+radial;indices.push(a,b,c,b,d,c);
      }
      geometry.setAttribute("position",positions);geometry.setAttribute("color",colors);geometry.setAttribute("travel",travel);geometry.setIndex(indices);
      geometry.setAttribute("progress",new T.Float32BufferAttribute(Array.from({length:samples*radial},(_,i)=>Math.floor(i/radial)/(samples-1)),1));
      const tube=new T.Mesh(geometry,material);tube.frustumCulled=false;tube.raycast=()=>{};group.add(tube);
      const dots=new T.BufferGeometry(),dotPositions=new T.Float32BufferAttribute(new Float32Array(4*3),3),dotColors=new T.Float32BufferAttribute(new Float32Array(4*3),3);
      dots.setAttribute("position",dotPositions);dots.setAttribute("color",dotColors);
      const particles=new T.Points(dots,particleMaterial);particles.frustumCulled=false;particles.raycast=()=>{};group.add(particles);
      return {path,index,samples,group,geometry,positions,colors,travel,dots,dotPositions,dotColors,centres:Array.from({length:samples},()=>new T.Vector3()),times:new Float32Array(samples)};
    });
    return {root,entries,material,particleMaterial,point:new T.Vector3(),tangent:new T.Vector3(),normal:new T.Vector3(),binormal:new T.Vector3(),color:new T.Color()};
  },[paths]);
  useEffect(()=>{
    const media=matchMedia("(prefers-reduced-motion: reduce)");
    const update=()=>{reduced.current=media.matches;invalidate();};update();media.addEventListener("change",update);
    return()=>{media.removeEventListener("change",update);graphics.entries.forEach(e=>{e.geometry.dispose();e.dots.dispose();});graphics.material.dispose();graphics.particleMaterial.dispose();};
  },[graphics,invalidate]);
  useEffect(()=>{invalidate();},[layer,playing,invalidate]);
  useFrame((_,delta)=>{
    graphics.root.visible=layer!=="off";if(layer==="off")return;
    const dt=Math.min(delta,.05),blend=opening.current.value;
    const moving=playing&&!reduced.current;if(moving)time.current+=dt;
    graphics.material.uniforms.time.value=time.current;
    const rebuild=!Number.isFinite(built.current)||Math.abs(built.current-blend)>.0001;
    const {point,tangent,normal,binormal,color}=graphics;
    for(const entry of graphics.entries){
      const samples=entry.samples;
      entry.group.visible=layer==="all"||layer===entry.path.layer;
      if(rebuild){
        for(let i=0;i<samples;i++)sampleAirflowPoint(entry.path,i/(samples-1),blend,entry.centres[i]);
        for(let i=0;i<samples;i++){
          const t=i/(samples-1),centre=entry.centres[i],speed=illustrativeFlowSpeed(entry.path,t,blend);
          entry.times[i]=i?entry.times[i-1]+centre.distanceTo(entry.centres[i-1])/speed:0;
          tangent.subVectors(entry.centres[Math.min(samples-1,i+1)],entry.centres[Math.max(0,i-1)]).normalize();
          normal.set(0,1,0).addScaledVector(tangent,-tangent.y).normalize();binormal.crossVectors(tangent,normal);
          flowColor(speed,color);
          // Thin stream tubes leave the body readable. The wake expands, while
          // the underside tubes stay within the measured ground clearance.
          const radius=airflowRadius(entry.path,t);
          for(let j=0;j<radial;j++){
            const angle=j/radial*Math.PI*2,k=i*radial+j;
            point.copy(centre).addScaledVector(normal,Math.cos(angle)*radius).addScaledVector(binormal,Math.sin(angle)*radius);
            entry.positions.setXYZ(k,point.x,point.y,point.z);entry.colors.setXYZ(k,color.r,color.g,color.b);entry.travel.setX(k,entry.times[i]+entry.index*.173);
          }
        }
        entry.positions.needsUpdate=true;entry.colors.needsUpdate=true;entry.travel.needsUpdate=true;
      }
      if(!entry.group.visible)continue;
      const duration=entry.times[samples-1];
      for(let i=0;i<entry.dotPositions.count;i++){
        const travel=(time.current*.65+i/entry.dotPositions.count*duration+entry.index*.173)%duration;
        let low=0,high=samples-1;
        while(high-low>1){const middle=(low+high)>>1;if(entry.times[middle]>travel)high=middle;else low=middle;}
        const fraction=(travel-entry.times[low])/(entry.times[high]-entry.times[low]),t=(low+fraction)/(samples-1);
        point.copy(entry.centres[low]).lerp(entry.centres[high],fraction);flowColor(illustrativeFlowSpeed(entry.path,t,blend),color);
        entry.dotPositions.setXYZ(i,point.x,point.y,point.z);entry.dotColors.setXYZ(i,color.r,color.g,color.b);
      }
      entry.dotPositions.needsUpdate=true;entry.dotColors.needsUpdate=true;
    }
    if(rebuild)built.current=blend;
    if(moving)invalidate();
  });
  return <primitive object={graphics.root}/>;
}
