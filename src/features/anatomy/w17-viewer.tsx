"use client";

/* eslint-disable react-hooks/immutability -- Three.js scene objects, camera and GPU resources are intentionally mutated in the render loop, outside React state. */

import { Canvas, events as pointerEvents, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type ComponentRef } from "react";
import * as T from "three";
import { Pause, Play, Rotate3D, Wind } from "lucide-react";
import Image from "next/image";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { advanceWingOpening, explodeOffset, updateWingLinkages, type AssemblyMode, type AeroMode, type WingMotion } from "./w17-geometry";
import { createModelInstance, disposeInstanceMaterials, preloadModel, replaceRearWing, visibleInCockpit, visibleInCooling, visibleInHydraulics, visibleInPowertrain, type CockpitFocus, type CoolingFocus, type HydraulicFocus } from "./w17-model-cache";
import { components, phases, rearWingOptions, type PhaseId, type RearWingVariant } from "./catalog";
import { type AirflowLayer, type AirflowPath } from "./w17-airflow";
import { loadAirflowPaths } from "./w17-flow-cache";
import { AirflowVolume } from "./airflow-volume";
import { createEngineMotion, ENGINE_CORE } from "./w17-engine-core";
import { createVehicleMotion, VEHICLE_MOTION } from "./w17-vehicle-motion";
import { createHoverInspection } from "./w17-inspection";

import { CameraControls, WingControls, type CameraView } from "./view-controls";
type BrakeAxle = "front" | "rear";
const visibleInDetail=(part:T.Object3D,brakeAxle:BrakeAxle)=>!part.userData.installedOnly&&(!part.userData.brakeAxle||(part.userData.brakeAxle===brakeAxle&&part.userData.brakeSide===1));
type Props = { selected:string; onSelect:(id:string)=>void; phase:PhaseId; together:boolean; playing:boolean; running?:boolean; onRunningChange?:(running:boolean)=>void; aero:AeroMode; onAeroChange:(mode:AeroMode)=>void; rearWing:RearWingVariant; onRearWingChange:(variant:RearWingVariant)=>void };

const modelEvents: typeof pointerEvents = store => {
  const manager = pointerEvents(store), move = manager.handlers?.onPointerMove;
  // OrbitControls handles drags independently. Avoid intersecting millions
  // of triangles before an onPointerMove handler can reject the same drag.
  if (manager.handlers && move) manager.handlers.onPointerMove = event => {
    if (!(event as PointerEvent).buttons) move(event);
  };
  return manager;
};

function RearWingPicker({value,onChange}:{value:RearWingVariant;onChange:(variant:RearWingVariant)=>void}) {
  return <TooltipProvider delayDuration={250}><div className="an-rear-wing-control" role="group" aria-label="Вариант заднего крыла">
    <div className="an-wing-picker-label" aria-hidden="true">Заднее крыло</div>
    {rearWingOptions.map(wing=><Tooltip key={wing.id}><TooltipTrigger asChild><button type="button" className="an-wing-design" aria-label={`Заднее крыло ${wing.name}`} aria-pressed={value===wing.id} onClick={()=>onChange(wing.id)}><Image src={`/f1/teams/logos/2026/${wing.id}.webp`} alt="" width={32} height={32}/></button></TooltipTrigger><TooltipContent side="bottom" sideOffset={8}>Заднее крыло {wing.name}{wing.id!=="mercedes"?" · Майами-2026":""}</TooltipContent></Tooltip>)}
  </div></TooltipProvider>;
}

export default function W17Viewer(props:Props) {
  const [mode,setMode]=useState<AssemblyMode>("assembled");
  const [view,setView]=useState<CameraView>("perspective");
  const [resetKey,setResetKey]=useState(0);
  const [freeView,setFreeView]=useState(false);
  const [hover,setHover]=useState<string|null>(null);
  const [ready,setReady]=useState(false);
  const [failed,setFailed]=useState(false);
  const [active,setActive]=useState(true);
  const [flow,setFlow]=useState(false);
  const [flowStatus,setFlowStatus]=useState<"idle"|"loading"|"ready"|"error">("idle");
  const stage=useRef<HTMLDivElement>(null);
  const current=components.find(c=>c.id===hover);
  const visibleFlow=flow&&mode!=="exploded"&&mode!=="powertrain"?"all":"off";
  useEffect(()=>{void preloadModel();},[]);
  useEffect(()=>{
    const target=stage.current;if(!target)return;
    let visible=true;const update=()=>setActive(visible&&!document.hidden);
    const observer=new IntersectionObserver(([e])=>{visible=e.isIntersecting;update();},{rootMargin:"100px"});observer.observe(target);
    document.addEventListener("visibilitychange",update);
    return()=>{observer.disconnect();document.removeEventListener("visibilitychange",update);};
  },[]);
  return <section className="an-3d-panel" aria-label="Трёхмерная модель болида Формулы-1">
    <div className="an-3d-stage" ref={stage} tabIndex={-1} onPointerDown={event=>{if(event.target instanceof HTMLCanvasElement)event.currentTarget.focus({preventScroll:true});}} data-ready={ready} data-running={!!props.running&&props.playing&&active} data-mode={mode} data-aero={props.aero} data-rear-wing={props.rearWing} data-airflow={visibleFlow} data-flow-playing={visibleFlow!=="off"&&props.playing&&active}>
    <div className="an-studio-toolbar">
    <div className="an-3d-toolbar">
      <div className="an-mode-switch" role="group" aria-label="Сборка модели">{([{id:"assembled",label:"В сборе"},{id:"cutaway",label:"Под кузовом"},{id:"exploded",label:"В разборе"},{id:"powertrain",label:"Двигатель"}] as const).map(o=><button type="button" key={o.id} aria-pressed={mode===o.id} onClick={()=>setMode(o.id)}>{o.label}</button>)}</div>

    </div>
    <div className="an-aero-control">
      <button type="button" className="an-drive-toggle" aria-pressed={!!props.running} onClick={()=>props.onRunningChange?.(!props.running)}>{props.running?<Pause size={15}/>:<Play size={15}/>}<span>В движении</span></button>
      {mode!=="powertrain"&&<div className="an-wing-controls" role="group" aria-label="Крылья">
        <WingControls compact value={props.aero} onChange={props.onAeroChange}/>
        <RearWingPicker value={props.rearWing} onChange={props.onRearWingChange}/>
      </div>}
      {mode!=="powertrain"&&<div className="an-flow-tools">
        <button type="button" className="an-flow-toggle" aria-label="Потоки" aria-pressed={visibleFlow!=="off"} onClick={()=>{setFlow(visibleFlow==="off");if(mode==="exploded")setMode("assembled");}}><Wind size={15}/><span>Потоки</span></button>
        {visibleFlow!=="off"&&<div className="an-flow-legend"><strong>Относительная скорость</strong><i/><div><span>Ниже</span><span>Выше</span></div><small>Учебная визуализация</small>{flowStatus!=="ready"&&<p className="an-flow-loading" role="status">{flowStatus==="error"?"Не удалось показать потоки. Выключи и включи их ещё раз.":"Готовим потоки…"}</p>}</div>}
      </div>}
    </div>
    </div>
      <ModelBoundary onFail={()=>setFailed(true)}>
        <Canvas events={modelEvents} orthographic camera={{position:[5,2.6,5],zoom:110,near:.01,far:80}} dpr={[1,1.5]} shadows={{type:T.PCFShadowMap}} frameloop={active?"demand":"never"} gl={{alpha:true,antialias:true,powerPreference:"high-performance"}} fallback={<div className="an-webgl-fallback">Браузер не поддерживает 3D. Разбор узлов доступен в «Все узлы».</div>} onCreated={({gl,raycaster})=>{raycaster.layers.set(1);gl.setClearAlpha(0);gl.toneMapping=T.ACESFilmicToneMapping;gl.toneMappingExposure=1.05;gl.shadowMap.type=T.PCFShadowMap;gl.shadowMap.autoUpdate=false;gl.shadowMap.needsUpdate=true;}}>
          <ViewCamera view={view}/>
          <ambientLight intensity={.7}/>
          <directionalLight position={[2,6,4]} intensity={2} castShadow shadow-mapSize={[4096,4096]} shadow-radius={2} shadow-camera-near={.5} shadow-camera-far={12} shadow-camera-left={-3.8} shadow-camera-right={3.8} shadow-camera-top={2.5} shadow-camera-bottom={-2.5} shadow-normalBias={.004} shadow-bias={-.0001}/>
          <directionalLight position={[-4,3,-5]} intensity={1.3} color="#cddbe5"/>
          <directionalLight position={[0,-4,2]} intensity={view==="underside"?2:0} color="#d7dde1"/>
          <Suspense fallback={null}>
            <Environment resolution={128} environmentIntensity={.65}>
              <Lightformer form="rect" intensity={3} color="white" scale={[10,4,1]} position={[0,5,-3]} rotation={[-Math.PI/2,0,0]}/>
              <Lightformer form="rect" intensity={2} color="#ccd9e7" scale={[10,2,1]} position={[0,2,5]} rotation={[0,Math.PI,0]}/>
              <Lightformer form="rect" intensity={1.4} color="white" scale={[4,4,1]} position={[-5,2,0]} rotation={[0,Math.PI/2,0]}/>
            </Environment>
            <Model {...props} playing={props.playing&&active} mode={mode} view={view} resetKey={resetKey} flowLayer={visibleFlow} flowPlaying={props.playing&&active} onFlowStatus={setFlowStatus} onOrbit={()=>setFreeView(true)} onHover={setHover} onReady={()=>setReady(true)}/>
          </Suspense>
          <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.006,0]} receiveShadow><planeGeometry args={[30,30]}/><shadowMaterial transparent opacity={.22}/></mesh>
        </Canvas>
      </ModelBoundary>
      {!ready&&!failed&&<div className="an-3d-loading">Загружаем болид…</div>}
      <div className="an-studio-footer">
        <div className="an-studio-hint" aria-live="polite"><Rotate3D size={16} aria-hidden="true"/><span>{current?current.name:"Потяни, чтобы вращать"}<small>{current?"Нажми, чтобы изучить":mode==="assembled"?(props.running?"Движение замедлено · Нажми на деталь":"Нажми на деталь, чтобы изучить её"):props.running?"Движение замедлено · Наведи на корпус":"Наведи на корпус, чтобы заглянуть внутрь"}</small></span></div>
        <CameraControls view={view} free={freeView} onChange={next=>{setView(next);setFreeView(false);setResetKey(k=>k+1);}} onReset={()=>{setView("perspective");setFreeView(false);setResetKey(k=>k+1);}}/>
      </div>
    </div>

  </section>;
}

export function W17ComponentViewer(props:Props&{initialOpen?:boolean;initialView?:CameraView}) {
  const view=props.initialView??"perspective";
  const resetKey=0;
  const [openFor,setOpenFor]=useState<string|null>(props.initialOpen?props.selected:null);
  const [brakeAxle,setBrakeAxle]=useState<BrakeAxle>("front");
  const [cockpitFocus,setCockpitFocus]=useState<CockpitFocus>("all");
  const [coolingFocus,setCoolingFocus]=useState<CoolingFocus>("all");
  const [hydraulicFocus,setHydraulicFocus]=useState<HydraulicFocus>("all");
  const [hydraulicBarrelOpen,setHydraulicBarrelOpen]=useState(false);
  const [enginePlaying,setEnginePlaying]=useState(true);
  const [canvasHost,setCanvasHost]=useState<HTMLDivElement|null>(null);
  const open=openFor===props.selected&&(props.selected!=="hydraulics"||hydraulicFocus!=="all");
  const [active,setActive]=useState(false);
  const [ready,setReady]=useState(false);
  const stage=useRef<HTMLDivElement>(null);
  const selected=components.find(c=>c.id===props.selected);
  useEffect(()=>{
    const target=stage.current;if(!target)return;
    let visible=false;const update=()=>setActive(visible&&!document.hidden);
    const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;update();},{rootMargin:"150px"});observer.observe(target);
    document.addEventListener("visibilitychange",update);
    return()=>{observer.disconnect();document.removeEventListener("visibilitychange",update);};
  },[]);
  const wing=props.selected==="front-wing"||props.selected==="rear-wing";
  return <div className="an-component-model" data-component={props.selected} data-cockpit-focus={props.selected==="cockpit"?cockpitFocus:undefined} data-cooling-focus={props.selected==="cooling"?coolingFocus:undefined}>
    <div className="an-component-3d" ref={stage} data-ready={ready} data-aero={props.aero} data-rear-wing={props.rearWing} aria-label={`Трёхмерная модель: ${selected?.name}`}>
      <div className="an-component-canvas" ref={setCanvasHost}>
      {canvasHost&&
      <ModelBoundary onFail={()=>setReady(true)}>
        {/* Keep a concrete event target while Fiber's asynchronous setup settles
            after a tab closes. A mutable ref can already be null at that point. */}
        <Canvas events={modelEvents} eventSource={canvasHost} orthographic camera={{position:[5,2.6,5],zoom:110,near:.01,far:80}} dpr={[1,1.5]} frameloop={active?"demand":"never"} gl={{alpha:true,antialias:true}} onCreated={({gl,raycaster})=>{raycaster.layers.set(1);gl.setClearAlpha(0);gl.toneMapping=T.ACESFilmicToneMapping;gl.toneMappingExposure=1.05;}}>
          <ViewCamera view={view} technical/>
          <ambientLight intensity={.8}/><directionalLight position={[2,6,4]} intensity={2}/><directionalLight position={[-4,3,-5]} intensity={1.5}/>
          <directionalLight position={[0,-4,2]} intensity={view==="underside"?2:0} color="#d7dde1"/>
          <Suspense fallback={null}>
            <Environment resolution={64} environmentIntensity={.65}><Lightformer form="rect" intensity={3} scale={[10,4,1]} position={[0,5,3]} rotation={[-Math.PI/2,0,0]}/></Environment>
            <Model {...props} playing={props.playing&&(!(props.selected==="engine"||(props.selected==="cooling"&&coolingFocus!=="all")||(props.selected==="hydraulics"&&hydraulicFocus!=="all"))||enginePlaying)} detail mode="isolated" open={open} brakeAxle={brakeAxle} cockpitFocus={cockpitFocus} coolingFocus={coolingFocus} hydraulicFocus={hydraulicFocus} hydraulicBarrelOpen={hydraulicBarrelOpen} view={view} resetKey={resetKey} onHover={()=>{}} onReady={()=>setReady(true)}/>
          </Suspense>
        </Canvas>
      </ModelBoundary>}
      </div>
      <span className="an-rotate-hint"><Rotate3D size={16} aria-hidden="true"/>Потяни, чтобы вращать</span>
    </div>
    <div className="an-component-model-controls">
      {props.selected==="cockpit"&&<div className="an-mode-switch" role="group" aria-label="Детали кокпита">{([{id:"all",label:"Всё"},{id:"seat",label:"Сиденье"},{id:"wheel",label:"Руль"},{id:"pedals",label:"Педали"}] as const).map(focus=><button key={focus.id} type="button" aria-pressed={cockpitFocus===focus.id} onClick={()=>setCockpitFocus(focus.id)}>{focus.label}</button>)}</div>}
      {props.selected==="cooling"&&<div className="an-mode-switch an-cooling-focus" role="group" aria-label="Детали охлаждения">{([{id:"all",label:"Всё"},{id:"left-pump",label:"Левый насос"},{id:"right-pump",label:"Правый насос"},{id:"lt-pump",label:"Насос наддува"},{id:"oil-pump",label:"Масляный насос"}] as const).map(focus=><button key={focus.id} type="button" aria-pressed={coolingFocus===focus.id} onClick={()=>setCoolingFocus(focus.id)}>{focus.label}</button>)}</div>}
      {props.selected==="hydraulics"&&<div className="an-mode-switch" role="group" aria-label="Детали гидравлики">{([{id:"all",label:"Вся система"},{id:"pump-drive",label:"Привод насоса"},{id:"pump",label:"Насос"}] as const).map(focus=><button key={focus.id} type="button" aria-pressed={hydraulicFocus===focus.id} onClick={()=>setHydraulicFocus(focus.id)}>{focus.label}</button>)}</div>}
      {props.selected==="hydraulics"&&hydraulicFocus!=="all"&&<button type="button" aria-pressed={open} onClick={()=>setOpenFor(open?null:props.selected)}>{open?(hydraulicFocus==="pump"?"Закрыть корпус":"Закрыть привод"):"Показать внутри"}</button>}
      {props.selected==="hydraulics"&&hydraulicFocus==="pump"&&open&&<button type="button" aria-pressed={hydraulicBarrelOpen} onClick={()=>setHydraulicBarrelOpen(!hydraulicBarrelOpen)}>{hydraulicBarrelOpen?"Вернуть блок":"Снять блок цилиндров"}</button>}
      {wing?<WingControls detail value={props.aero} onChange={props.onAeroChange}/>:["engine","clutch","gearbox","differential","monocoque","brakes","cooling","turbo","exhaust","mguk","battery","inverter","fuel","steering","cockpit"].includes(props.selected)&&(props.selected!=="cockpit"||cockpitFocus==="all"||cockpitFocus==="seat")?<button type="button" aria-pressed={open} onClick={()=>setOpenFor(open?null:props.selected)}>{props.selected==="cockpit"?(open?"Вернуть обрамление":"Снять обрамление"):props.selected==="fuel"?(open?"Скрыть срез":"Показать срез"):props.selected==="engine"?(open?"Закрыть двигатель":"Открыть двигатель"):props.selected==="clutch"?(open?"Собрать сцепление":"Снять нажимной механизм"):["mguk","battery","inverter","steering","differential"].includes(props.selected)?(open?"Закрыть корпус":"Показать внутри"):props.selected==="exhaust"?(open?"Вернуть корпус клапана":"Показать клапан"):props.selected==="turbo"?(open?"Вернуть корпуса":"Снять корпуса"):props.selected==="gearbox"?(open?"Вернуть корпус":"Снять корпус"):props.selected==="cooling"?(open?"Закрыть корпуса":"Показать внутри"):props.selected==="brakes"?(open?"Вернуть кожух":"Снять кожух"):(open?"Вернуть обшивку":"Снять обшивку")}</button>:null}
      {props.selected==="brakes"&&<div className="an-mode-switch" role="group" aria-label="Тормозной узел">{([{id:"front",label:"Передний"},{id:"rear",label:"Задний"}] as const).map(axle=><button key={axle.id} type="button" aria-pressed={brakeAxle===axle.id} onClick={()=>setBrakeAxle(axle.id)}>{axle.label}</button>)}</div>}
      {(props.selected==="engine"||(props.selected==="cooling"&&coolingFocus!=="all")||(props.selected==="hydraulics"&&hydraulicFocus!=="all"))&&open&&<button type="button" onClick={()=>setEnginePlaying(!enginePlaying)}>{enginePlaying?"Пауза":"Продолжить"}</button>}
    </div>
    {props.selected==="rear-wing"&&<div className="an-component-wing-picker"><RearWingPicker value={props.rearWing} onChange={props.onRearWingChange}/></div>}
  </div>;
}

function ViewCamera({view,technical=false}:{view:CameraView;technical?:boolean}) {
  return !technical&&view==="perspective"
    ? <PerspectiveCamera makeDefault fov={24} position={[5,2.6,5]} near={.01} far={80}/>
    : <OrthographicCamera makeDefault position={[5,2.6,5]} zoom={110} near={.01} far={80}/>;
}

function Model({detail=false,onOrbit,onFlowStatus,selected,onSelect,phase,together,playing,running=false,aero,rearWing,mode,view,resetKey,onHover,onReady,open=false,brakeAxle="front",cockpitFocus="all",coolingFocus="all",hydraulicFocus="all",hydraulicBarrelOpen=false,flowLayer,flowPlaying=false}:Props&{detail?:boolean;onOrbit?:()=>void;onFlowStatus?:(status:"loading"|"ready"|"error")=>void;mode:AssemblyMode;open?:boolean;brakeAxle?:BrakeAxle;cockpitFocus?:CockpitFocus;coolingFocus?:CoolingFocus;hydraulicFocus?:HydraulicFocus;hydraulicBarrelOpen?:boolean;view:CameraView;resetKey:number;onHover:(id:string|null)=>void;onReady:()=>void;flowLayer?:AirflowLayer|"off";flowPlaying?:boolean}) {
  const controls=useRef<ComponentRef<typeof OrbitControls>>(null);
  const hovered=useRef<string|null>(null);
  const {camera,size,gl,invalidate}=useThree();
  const cameraKey=useRef("");
  const assembledCamera=useRef<{position:T.Vector3;target:T.Vector3;zoom:number;fov?:number}|null>(null);
  const reduced=useRef(false);
  const wingMotion=useRef<WingMotion>({value:aero==="straight"?1:0,velocity:0});
  const wingTarget=useRef(aero==="straight"?1:0);
  const ready=useRef(false);
  const component=detail?selected:undefined;
  const data=useMemo(()=>createModelInstance(component),[component]);
  const engineMotion=useMemo(()=>createEngineMotion(data.root),[data]);
  const engineAngle=useRef(ENGINE_CORE.initialAngle);
  const vehicleMotion=useMemo(()=>createVehicleMotion(data.root),[data]);
  const inspection=useRef<ReturnType<typeof createHoverInspection>|null>(null);
  const sceneParts=useRef<{flaps:T.Mesh[];turbo:T.Object3D[];materials:Map<string,Set<T.MeshStandardMaterial>>}>({flaps:[],turbo:[],materials:new Map()});
  const appearanceDirty=useRef(true);
  const shadowTime=useRef(0);
  const [airflowData,setAirflowData]=useState<{variant:RearWingVariant;paths:AirflowPath[]}|null>(null);
  const airflowPaths=airflowData?.variant===rearWing?airflowData.paths:null;
  const flowEnabled=flowLayer!==undefined&&flowLayer!=="off";
  useEffect(()=>{
    if(!flowEnabled)return;
    let cancelled=false;onFlowStatus?.("loading");
    loadAirflowPaths(rearWing).then(paths=>{if(!cancelled){setAirflowData({variant:rearWing,paths});onFlowStatus?.("ready");invalidate();}},()=>{if(!cancelled)onFlowStatus?.("error");});
    return()=>{cancelled=true;};
  },[flowEnabled,rearWing,invalidate,onFlowStatus]);
  const installed=useRef<{data:typeof data;variant:RearWingVariant}|null>(null);
  useLayoutEffect(()=>{
    if(detail)return;
    const controller=createHoverInspection(data.root);inspection.current=controller;
    return()=>{controller.dispose();inspection.current=null;};
  },[data,detail]);
  useLayoutEffect(()=>{
    if(installed.current?.data===data&&installed.current.variant===rearWing)return;
    const changed=replaceRearWing(data,rearWing);
    const wing=changed?data.assemblies.get("rear-wing"):data.root;
    wing?.traverse(part=>{if(part.userData.flap){const angle=T.MathUtils.lerp(part.userData.closedAngle,part.userData.openAngle,wingMotion.current.value);part.userData.angle=angle;part.quaternion.setFromAxisAngle(part.userData.hingeAxis,angle);}});
    installed.current={data,variant:rearWing};
    updateWingLinkages(data.linkages);data.root.updateMatrixWorld(true);gl.shadowMap.needsUpdate=true;invalidate();
  },[data,rearWing,aero,gl,invalidate]);
  useLayoutEffect(()=>{
    const flaps:T.Mesh[]=[],turbo:T.Object3D[]=[],materials=new Map<string,Set<T.MeshStandardMaterial>>();
    for(const [id,g]of data.assemblies){
      g.visible=mode!=="isolated"||id===selected||(selected==="battery"&&id==="inverter");
      const groupMaterials=new Set<T.MeshStandardMaterial>();materials.set(id,groupMaterials);
      g.traverse(o=>{
        if(o instanceof T.Mesh){
          o.visible=!(mode==="cutaway"&&o.userData.cover&&!o.userData.structural)&&!(open&&(o.userData.cover||o.userData.serviceCover)&&!(selected==="hydraulics"&&hydraulicFocus==="pump-drive"&&o.userData.hydraulicPumpCover))&&!(mode==="isolated"&&(!visibleInDetail(o,brakeAxle)||(selected==="cockpit"&&!visibleInCockpit(o,cockpitFocus))||(selected==="cooling"&&!visibleInCooling(o,coolingFocus))||(selected==="hydraulics"&&!visibleInHydraulics(o,hydraulicFocus))))&&!(mode==="powertrain"&&!visibleInPowertrain(o))&&!(mode==="isolated"&&selected==="hydraulics"&&hydraulicFocus==="pump"&&open&&hydraulicBarrelOpen&&o.userData.hydraulicBarrel);
          groupMaterials.add(o.material as T.MeshStandardMaterial);
          if(o.userData.flap)flaps.push(o);
        }
        if(o.userData.turboRotor)turbo.push(o);
      });
    }
    sceneParts.current={flaps,turbo,materials};appearanceDirty.current=true;
    gl.shadowMap.needsUpdate=true;invalidate();
  },[data,rearWing,mode,selected,open,brakeAxle,cockpitFocus,coolingFocus,hydraulicFocus,hydraulicBarrelOpen,phase,together,gl,invalidate]);
  useEffect(()=>{
    const media=window.matchMedia("(prefers-reduced-motion: reduce)");const update=()=>{reduced.current=media.matches;};update();media.addEventListener("change",update);
    return()=>media.removeEventListener("change",update);
  },[]);
  useEffect(()=>()=>disposeInstanceMaterials(data.root),[data]);
  useLayoutEffect(()=>{
    if(!(camera instanceof T.OrthographicCamera)&&!(camera instanceof T.PerspectiveCamera))return;
    const nextKey=`${camera.uuid}/${mode==="isolated"?"detail":mode==="exploded"?"exploded":"car"}/${view}/${resetKey}/${size.width}/${size.height}/${mode==="isolated"?selected+brakeAxle+(selected==="cockpit"?cockpitFocus:selected==="cooling"?coolingFocus:selected==="hydraulics"?hydraulicFocus:"")+(["brakes","cockpit","cooling","engine","hydraulics"].includes(selected)?open:""):""}`;
    if(cameraKey.current===nextKey)return;cameraKey.current=nextKey;
    if(mode!=="exploded"&&assembledCamera.current){
      const saved=assembledCamera.current;assembledCamera.current=null;
      camera.position.copy(saved.position);camera.zoom=saved.zoom;
      if(camera instanceof T.PerspectiveCamera&&saved.fov!==undefined)camera.fov=saved.fov;
      camera.lookAt(saved.target);camera.updateProjectionMatrix();
      if(controls.current){controls.current.target.copy(saved.target);controls.current.update();}
      return;
    }
    const positions:Record<CameraView,T.Vector3>={perspective:new T.Vector3(5,1.8,6.5),side:new T.Vector3(0,0,8),opposite:new T.Vector3(0,0,-8),top:new T.Vector3(0,8,.0001),underside:new T.Vector3(0,-8,.0001),front:new T.Vector3(8,.03,0),rear:new T.Vector3(-8,.03,0)};
    if(mode==="isolated"&&selected==="clutch")positions.perspective.set(-6,2.3,4);
    if(mode==="isolated"&&selected==="brakes")positions.perspective.set(-4,2.8,6);
    if(mode==="isolated"&&selected==="fuel")positions.perspective.set(-3,2.5,6);
    if(mode==="isolated"&&selected==="cockpit"){
      positions.perspective.set(3,6,5);
      if(cockpitFocus==="wheel")positions.perspective.set(-6,1.2,1);
      if(cockpitFocus==="pedals")positions.perspective.set(-5,3,4);
    }
    if(mode==="isolated"&&selected==="hydraulics"&&hydraulicFocus!=="all")positions.perspective.set(hydraulicFocus==="pump"?-2:-6,2.3,hydraulicFocus==="pump"?6:4);
    if(mode==="isolated"&&selected==="cooling"&&coolingFocus!=="all")positions.perspective.set(6,2.3,coolingFocus==="right-pump"?4:-4);
    if(mode==="isolated"&&selected==="steering")positions.perspective.set(-4,3,6);
    if(mode==="isolated"&&(selected==="battery"||selected==="inverter"))positions.perspective.set(4,5,6);
    const target=new T.Vector3(.18,.40,0);
    let fitWidth=5.6,fitHeight=2.80;
    if(view==="side"||view==="opposite")fitHeight=2.05;
    if(view==="top"||view==="underside"){fitWidth=6.0;fitHeight=2.65;}
    if(view==="front"||view==="rear"){fitWidth=2.65;fitHeight=1.65;}
    if(mode==="exploded"){
      if(!assembledCamera.current){
        const previousTarget=controls.current?.target.clone()??target.clone();
        assembledCamera.current={position:camera.position.clone(),target:previousTarget,zoom:camera.zoom,...(camera instanceof T.PerspectiveCamera?{fov:camera.fov}:{})};
        positions[view].copy(camera.position).sub(previousTarget);
      }
      target.y=1.45;fitWidth=6.4;fitHeight=4.4;
    }
    if(mode==="powertrain"){
      const bounds=new T.Box3();data.root.traverse(part=>{if(part instanceof T.Mesh&&visibleInPowertrain(part))bounds.expandByObject(part);});bounds.getCenter(target);
      const direction=positions[view].clone().normalize(),right=new T.Vector3().crossVectors(camera.up,direction).normalize(),up=new T.Vector3().crossVectors(direction,right).normalize();
      let width=0,height=0;
      for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
        const corner=new T.Vector3(x,y,z).sub(target);width=Math.max(width,Math.abs(corner.dot(right))*2);height=Math.max(height,Math.abs(corner.dot(up))*2);
      }
      fitWidth=Math.max(1.8,width*1.25);fitHeight=Math.max(1.3,height*1.25);
    }
    if(mode==="isolated"){
      const g=data.assemblies.get(selected);if(g){
        const old=g.position.clone();g.position.set(0,0,0);g.updateMatrixWorld(true);
        const b=new T.Box3();g.traverse(part=>{if(part instanceof T.Mesh&&visibleInDetail(part,brakeAxle)&&(selected!=="cockpit"||visibleInCockpit(part,cockpitFocus))&&(selected!=="cooling"||visibleInCooling(part,coolingFocus))&&(selected!=="hydraulics"||visibleInHydraulics(part,hydraulicFocus))&&!(["brakes","cockpit","cooling","engine","hydraulics"].includes(selected)&&open&&part.userData.serviceCover&&!(selected==="hydraulics"&&hydraulicFocus==="pump-drive"&&part.userData.hydraulicPumpCover)))b.expandByObject(part);});b.getCenter(target);
        const direction=positions[view].clone().normalize(),right=new T.Vector3().crossVectors(camera.up,direction).normalize(),up=new T.Vector3().crossVectors(direction,right).normalize();
        let width=0,height=0;
        for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){
          const corner=new T.Vector3(x,y,z).sub(target);width=Math.max(width,Math.abs(corner.dot(right))*2);height=Math.max(height,Math.abs(corner.dot(up))*2);
        }
        if(selected==="cockpit"){
          // Fit the visible subassembly, without empty corners around the long seat/heel rest.
          let minRight=Infinity,maxRight=-Infinity,minUp=Infinity,maxUp=-Infinity;
          g.traverse(part=>{
            if(!(part instanceof T.Mesh)||!visibleInDetail(part,brakeAxle)||!visibleInCockpit(part,cockpitFocus)||(open&&part.userData.serviceCover))return;
            const points=part.geometry.attributes.position,p=new T.Vector3();
            for(let i=0;i<points.count;i++){
              p.fromBufferAttribute(points,i).applyMatrix4(part.matrixWorld).sub(target);
              const r=p.dot(right),u=p.dot(up);minRight=Math.min(minRight,r);maxRight=Math.max(maxRight,r);minUp=Math.min(minUp,u);maxUp=Math.max(maxUp,u);
            }
          });
          width=maxRight-minRight;height=maxUp-minUp;
          target.addScaledVector(right,(minRight+maxRight)/2).addScaledVector(up,(minUp+maxUp)/2);
        }
        const smallPump=selected==="hydraulics"&&hydraulicFocus==="pump",padding=smallPump?.004:.025,minimum=smallPump?.025:.08;
        fitWidth=Math.max(minimum,width*1.25+padding);fitHeight=Math.max(minimum,height*1.25+padding);g.position.copy(old);
      }
    }
    camera.up.set(0,1,0);
    if(camera instanceof T.PerspectiveCamera){
      camera.fov=view==="perspective"?24:10;camera.aspect=size.width/size.height;camera.zoom=1;
      const tangent=Math.tan(T.MathUtils.degToRad(camera.fov/2));
      const distance=Math.max(fitHeight/(2*tangent),fitWidth/(2*tangent*camera.aspect))+(view==="perspective"?(mode==="isolated"&&((selected==="cooling"&&coolingFocus!=="all")||(selected==="hydraulics"&&hydraulicFocus!=="all"))?Math.max(fitWidth,fitHeight)*.3:.5):2.1);
      camera.position.copy(target).addScaledVector(positions[view].normalize(),distance);
    }else{
      camera.position.copy(target).add(positions[view]);camera.zoom=Math.min(size.width/fitWidth,size.height/fitHeight);
    }
    camera.lookAt(target);camera.updateProjectionMatrix();
    if(controls.current){controls.current.target.copy(target);controls.current.update();}
  },[camera,size,view,mode,resetKey,selected,rearWing,brakeAxle,cockpitFocus,coolingFocus,hydraulicFocus,open,data]);
  useFrame((_,dt)=>{
    if(!ready.current){ready.current=true;gl.shadowMap.needsUpdate=true;onReady();}
    const target=aero==="straight"?1:0;
    // Demand rendering may have been idle for seconds before this click.
    const motionDelta=wingTarget.current===target?dt:0;wingTarget.current=target;
    wingMotion.current=reduced.current?{value:target,velocity:0}:advanceWingOpening(wingMotion.current,target,motionDelta);
    let moving=wingMotion.current.value!==target;
    const t=reduced.current?1:1-Math.exp(-Math.min(dt,.05)/.18);
    let shadowsMoving=moving;
    for(const [id,g]of data.assemblies){
      const off=mode==="exploded"?(explodeOffset[id]??[0,0,0]):[0,0,0];
      if(Math.abs(g.position.x-off[0])+Math.abs(g.position.y-off[1])+Math.abs(g.position.z-off[2])>.0001){
        g.position.x=T.MathUtils.lerp(g.position.x,off[0],t);g.position.y=T.MathUtils.lerp(g.position.y,off[1],t);g.position.z=T.MathUtils.lerp(g.position.z,off[2],t);moving=shadowsMoving=true;
      }
    }
    if(appearanceDirty.current){
      const active=phases.find(p=>p.id===phase)?.active??[];
      for(const [id,materials]of sceneParts.current.materials){
        const lit=!hovered.current&&(((mode==="cutaway"||mode==="exploded")&&id===selected)||(together&&active.includes(id)));
        const highlight=!detail&&hovered.current===id;
        for(const material of materials){
          material.emissive.set(highlight?"#d86746":lit?(together?"#16483d":"#5a211b"):"#000000");
          material.emissiveIntensity=highlight?.03:lit?.28:0;
        }
      }
      appearanceDirty.current=false;
    }
    for(const part of sceneParts.current.flaps){
      const {closedAngle,openAngle}=part.userData;
      part.userData.angle=T.MathUtils.lerp(closedAngle,openAngle,wingMotion.current.value);
      part.quaternion.setFromAxisAngle(part.userData.hingeAxis,part.userData.angle);
    }
    const fade=inspection.current?.(hovered.current,dt,reduced.current,flowEnabled&&!!airflowPaths?.some(path=>path.layer==="cooling"),mode!=="assembled");
    if(fade?.moving)moving=true;
    if(fade?.shadowsChanged)shadowsMoving=true;
    if(!detail&&running&&playing){
      engineAngle.current-=Math.min(dt,.05)*VEHICLE_MOTION.engineSpeed;
      vehicleMotion(engineAngle.current);moving=true;
    }
    if(detail&&playing&&!reduced.current)for(const rotor of sceneParts.current.turbo){rotor.rotation.x+=Math.min(dt,.05)*1.3;moving=true;}
    if(detail&&((selected==="engine"&&open)||selected==="mguk"||(selected==="cooling"&&coolingFocus!=="all"&&open)||(selected==="hydraulics"&&hydraulicFocus!=="all"&&open))&&playing&&!reduced.current){
      // Clockwise when viewed from the front (+X), as specified by C5.4.5.
      engineAngle.current-=Math.min(dt,.05)*.8;engineMotion(engineAngle.current);moving=true;
    }
    updateWingLinkages(data.linkages);
    // Internal motion needs fresh frames, but not a 4096 squared shadow render
    // on every frame. Assembly changes update immediately; mechanisms at 10 Hz.
    shadowTime.current+=Math.min(dt,.05);
    if(shadowsMoving||(moving&&shadowTime.current>=.1)){gl.shadowMap.needsUpdate=true;shadowTime.current=0;}
    if(moving)invalidate();
  },-1);
  // Camera orbit does not change world-space shadows. Refresh them only when
  // the assembly or moving mechanisms change, not for every camera frame.
  useEffect(()=>{gl.shadowMap.needsUpdate=true;invalidate();},[selected,mode,phase,playing,running,together,aero,open,brakeAxle,cockpitFocus,coolingFocus,hydraulicFocus,hydraulicBarrelOpen,gl,invalidate]);
  function hit(e:ThreeEvent<PointerEvent|MouseEvent>){
    return e.intersections.find(intersection=>{
      let object:T.Object3D|null=intersection.object;
      while(object&&object!==data.root){if(!object.visible)return false;object=object.parent;}
      return object===data.root&&intersection.object.userData.component;
    })?.object.userData.component as string|undefined;
  }
  function highlight(id:string|null){
    if(hovered.current===id)return;
    hovered.current=id;appearanceDirty.current=true;onHover(id);gl.domElement.style.cursor=id?"pointer":"grab";invalidate();
  }

  return <>
    <primitive object={data.root} dispose={null} onClick={(e:ThreeEvent<MouseEvent>)=>{if(e.delta>3)return;const id=hit(e);if(id){e.stopPropagation();onSelect(id);}}} onPointerMove={(e:ThreeEvent<PointerEvent>)=>{if(e.buttons){highlight(null);return;}const id=hit(e);if(id){e.stopPropagation();highlight(id);}}} onPointerOut={()=>highlight(null)}/>
    {airflowPaths&&<AirflowVolume key={rearWing} paths={airflowPaths} layer={flowLayer??"off"} playing={flowPlaying} opening={wingMotion}/>}
    <OrbitControls onStart={()=>{highlight(null);onOrbit?.();}} key={`${view}/${resetKey}`} ref={controls} makeDefault enableDamping dampingFactor={.1} minZoom={25} maxZoom={mode==="isolated"?12000:900} minDistance={.25} maxDistance={28} enablePan maxPolarAngle={Math.PI-.001}/>
  </>;
}

class ModelBoundary extends Component<{children:ReactNode;onFail:()=>void},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return{failed:true};}
  componentDidCatch(){this.props.onFail();}
  render(){return this.state.failed?<div className="an-webgl-fallback">Не удалось открыть 3D. Обнови страницу или попробуй другой браузер. Разбор узлов доступен в «Все узлы».</div>:this.props.children;}
}
