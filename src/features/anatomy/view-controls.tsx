import { RotateCcw } from "lucide-react";
import type { AeroMode } from "./w17-geometry";

export type CameraView = "perspective" | "side" | "opposite" | "top" | "underside" | "front" | "rear";
export const cameraViews = [{ id:"perspective", label:"3/4" }, { id:"side", label:"Справа" }, { id:"opposite", label:"Слева" }, { id:"top", label:"Сверху" }, { id:"underside", label:"Снизу" }, { id:"front", label:"Спереди" }, { id:"rear", label:"Сзади" }] as const;
type Vec = [number, number, number];
const dot = (a: Vec, b: Vec) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const normalize = (v: Vec): Vec => v.map(n => n / Math.hypot(...v)) as Vec;
const cross = (a: Vec, b: Vec): Vec => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

// The same small solid is projected from each camera: a view diagram rather
// than seven unrelated icons. The nose mark makes front/back unambiguous.
function CarView({view}:{view:CameraView}) {
  const directions:Record<CameraView,Vec>={perspective:[5,2.8,6.5],side:[0,.08,8],opposite:[0,.08,-8],top:[0,8,.001],underside:[0,-8,.001],front:[8,.16,0],rear:[-8,.16,0]};
  const direction=normalize(directions[view]),right=normalize(cross([0,1,0],direction)),up=cross(direction,right);
  const faces:{points:Vec[];tone:number;depth:number}[]=[];
  const box=(centre:Vec,size:Vec,tone:number)=>{
    const vertices=Array.from({length:8},(_,i)=>centre.map((v,j)=>v+((i>>j)&1?1:-1)*size[j]/2) as Vec);
    for(const indices of [[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]]){
      const points=indices.map(i=>vertices[i]);
      const edge=(a:Vec,b:Vec)=>a.map((v,j)=>v-b[j]) as Vec;
      const normal=cross(edge(points[1],points[0]),edge(points[2],points[0]));
      if(dot(normal,direction)>=0)continue;
      faces.push({points,tone:Math.min(1,tone*(.65+Math.abs(normalize(normal)[1])*.35)),depth:points.reduce((sum,p)=>sum+dot(p,direction),0)/4});
    }
  };
  box([-.2,.16,0],[2.25,.28,.62],.58);box([.96,.16,0],[1,.16,.25],.9);
  box([.1,.37,0],[.48,.18,.35],.82);box([1.45,.06,0],[.37,.06,1.75],.72);box([-1.45,.46,0],[.34,.08,1.45],.72);
  for(const x of [-1.02,1.02])for(const z of [-.74,.74])box([x,.19,z],[.50,.45,.30],.28);
  box([1.43,.18,0],[.14,.03,.23],1);
  const project=(p:Vec)=>`${40+dot(p,right)*22},${21-dot(p,up)*22}`;
  return <svg viewBox="0 0 80 36" aria-hidden="true">{faces.sort((a,b)=>a.depth-b.depth).map((face,i)=><polygon key={i} points={face.points.map(project).join(" ")} fill={`color-mix(in srgb,currentColor ${Math.round(face.tone*100)}%,var(--card))`}/>)}</svg>;
}

export function CameraControls({view,free=false,onChange,onReset}:{view:CameraView;free?:boolean;onChange:(view:CameraView)=>void;onReset:()=>void}) {
  return <div className="an-view-control">
    <div className="an-view-presets" role="group" aria-label="Ракурс модели">
      {cameraViews.map(option=><button key={option.id} type="button" title={option.label} aria-pressed={!free&&view===option.id} onClick={()=>onChange(option.id)}><CarView view={option.id}/><span>{option.label}</span></button>)}
      <button className="an-view-reset" type="button" aria-label="Вернуть исходный ракурс" title="Исходный ракурс" onClick={onReset}><RotateCcw size={15}/></button>
    </div>
  </div>;
}

function WingView({open}:{open:boolean}) {
  return <svg viewBox="0 0 64 32" aria-hidden="true"><path d="M5 25C15 15 31 21 55 25C33 27 15 28 5 25Z" fill="currentColor" opacity=".35"/><g transform={open?"translate(0 -7)":"rotate(-24 42 16)"}><path d="M20 17C30 8 42 12 60 16C43 18 29 20 20 17Z" fill="currentColor"/></g><path d={open?"M6 9H18M6 13H18":"M7 8L17 12M5 12L15 16"} fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".5"/></svg>;
}

export function WingControls({value,onChange,detail=false,compact=false}:{value:AeroMode;onChange:(mode:AeroMode)=>void;detail?:boolean;compact?:boolean}) {
  if(compact)return <button className="an-wing-toggle" type="button" aria-label={value==="straight"?"Закрыть крылья":"Открыть крылья"} aria-pressed={value==="straight"} onClick={()=>onChange(value==="straight"?"corner":"straight")}><WingView open={value==="straight"}/><span><span>Крылья</span> <strong>{value==="straight"?"открыты":"закрыты"}</strong></span></button>;
  return <div className="an-wing-positions" role="group" aria-label={detail?"Положение крыла в разборе":"Положение крыльев"}>
    <button type="button" aria-label="Закрыть крылья" title="Поворот · больше прижима" aria-pressed={value==="corner"} onClick={()=>onChange("corner")}><WingView open={false}/><span>Закрыты</span></button>
    <button type="button" aria-label="Открыть крылья" title="Прямая · меньше сопротивление" aria-pressed={value==="straight"} onClick={()=>onChange("straight")}><WingView open/><span>Открыты</span></button>
  </div>;
}
