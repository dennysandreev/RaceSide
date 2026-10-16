import * as T from "three";
import { createSurfaceSampler } from "./w17-surface.ts";
import { updateWingLinkages, type WingLinkage } from "./w17-geometry.ts";
import { createCoolingAirflowPaths } from "./w17-cooling-airflow.ts";

export type AirflowLayer = "all" | "body" | "floor" | "wings" | "wake" | "cooling";
export type AirflowPath = { id:string; layer:Exclude<AirflowLayer,"all">; corner:T.Vector3[]; straight:T.Vector3[]; states?:T.Vector3[][]; radii?:number[] };

// Qualitative streamlines, not a CFD solution. The sampling only keeps the
// illustration clear of the actual solids; it does not solve pressure or drag.
export function createAirflowPaths(root:T.Group,linkages:WingLinkage[]=[]):AirflowPath[] {
  root.updateMatrixWorld(true);
  const exterior:T.Mesh[]=[],front:T.Mesh[]=[],rear:T.Mesh[]=[],flaps:T.Mesh[]=[];
  root.traverse(part=>{
    if(!(part instanceof T.Mesh)||part.userData.internal)return;
    exterior.push(part);
    if(part.userData.component==="front-wing")front.push(part);
    if(part.userData.component==="rear-wing")rear.push(part);
    if(part.userData.flap)flaps.push(part);
  });

  const original=flaps.map(part=>part.quaternion.clone()),swept=flaps.map(()=>new T.Box3());
  const rearSweeps:T.Box3[]=[];
  const inverted=root.userData.rearWing&&root.userData.rearWing!=="mercedes";
  for(const fraction of Array.from({length:inverted?25:5},(_,i)=>i/(inverted?24:4))){
    flaps.forEach(part=>part.quaternion.setFromAxisAngle(part.userData.hingeAxis,T.MathUtils.lerp(part.userData.closedAngle,part.userData.openAngle,fraction)));updateWingLinkages(linkages);root.updateMatrixWorld(true);
    const rearBounds=new T.Box3();
    flaps.forEach((part,i)=>{const bounds=new T.Box3().setFromObject(part);swept[i].union(bounds);if(part.userData.component==="rear-wing")rearBounds.union(bounds);});rearSweeps.push(rearBounds);
  }
  flaps.forEach((part,i)=>part.quaternion.copy(original[i]));updateWingLinkages(linkages);root.updateMatrixWorld(true);
  const vertical=createSurfaceSampler(exterior,"y"),horizontal=createSurfaceSampler(exterior,"z");
  const upper=(surface:ReturnType<typeof createSurfaceSampler>,x:number,z:number,fallback:number)=>Math.max(...[-.012,0,.012].map(offset=>surface(x,z+offset,1)??fallback));
  // An envelope with a bounded slope avoids a vertical turn at a panel edge.
  const soften=(points:T.Vector3[],axis:"y"|"z",slope:number,side=1)=>{
    for(const direction of [1,-1])for(let step=1;step<points.length;step++){
      const i=direction===1?step:points.length-1-step,previous=i-direction;
      const limit=side*points[previous][axis]-Math.abs(points[i].x-points[previous].x)*slope;
      points[i][axis]=side*Math.max(side*points[i][axis],limit);
    }
    // Smooth the conservative envelope rather than tracing each polygon edge.
    // A positive kernel plus an outward correction preserves clearance while
    // rounding the tent-shaped corners introduced by the slope bound.
    const radius=12,sigma=5,source=points.map(p=>side*p[axis]);
    const smoothed=source.map((_,i)=>{
      let sum=0,weight=0;
      for(let j=-radius;j<=radius;j++){
        const w=Math.exp(-.5*(j/sigma)**2);
        sum+=source[T.MathUtils.clamp(i+j,0,source.length-1)]*w;weight+=w;
      }
      return sum/weight;
    });
    const clearance=Math.max(0,...source.map((v,i)=>v-smoothed[i]));
    points.forEach((p,i)=>{p[axis]=side*(smoothed[i]+clearance);if(axis==="y")p.y=Math.max(.015,p.y);});
    return points;
  };
  const sample=(start:number,end:number,point:(x:number,t:number)=>T.Vector3)=>Array.from({length:121},(_,i)=>point(T.MathUtils.lerp(start,end,i/120),i/120));
  const paths:AirflowPath[]=[];
  for(const side of [-1,1]){
    for(const lane of [.12,.38,.70,.91]){
    const roof=sample(3.15,-2.85,(x)=>{
      const z=side*lane,envelope=swept.filter(b=>x>=b.min.x-.015&&x<=b.max.x+.015&&z>=b.min.z&&z<=b.max.z);
      return new T.Vector3(x,Math.max(upper(vertical,x,z,.24),...envelope.map(b=>b.max.y),x<-2.2?.98+(-x-2.2)*.2:0)+.045,z);
    });
    soften(roof,"y",.48);
    for(const lift of [0,.14]){const points=roof.map(p=>p.clone().add(new T.Vector3(0,lift,0)));paths.push({id:`roof-${side}-${lane}-${lift}`,layer:"body",corner:points,straight:points.map(p=>p.clone())});}
    }
    for(const height of [.30,.47,.62]){
    const shoulder=sample(1.24,-2.85,(x)=>{
      // Descend into the coke-bottle exit, below the half-shaft and the now
      // full-section pushrod fairing. A constant height cut through that arm.
      const y=height-.035*T.MathUtils.smoothstep(-x,1.25,1.60);
      // Include the span between samples: a narrow mirror stay can otherwise
      // fall between both endpoints and be crossed by the connecting segment.
      const edge=Math.max(...[-.035,0,.035].flatMap(dx=>[-.012,0,.012].map(offset=>Math.abs(horizontal(x+dx,y+offset,side as 1|-1)??0))));
      const envelope=swept.filter(b=>x>=b.min.x-.02&&x<=b.max.x+.02&&y>=b.min.y-.02&&y<=b.max.y+.02);
      return new T.Vector3(x,y,side*Math.max(.46,edge+.045,...envelope.map(b=>Math.max(Math.abs(b.min.z),Math.abs(b.max.z))+.045)));
    });
    soften(shoulder,"z",.40,side);paths.push({id:`sidepod-${side}-${height}`,layer:"body",corner:shoulder,straight:shoulder.map(p=>p.clone())});
    }
    for(const z of [.12,.18,.26,.34]){
      const floor=sample(3.15,-2.85,(x)=>{
        // Include the next segment and marker radius before entering a sharp
        // leading edge; sampling only its endpoints can cut through the plank.
        const ceilings=[-.04,0,.04].flatMap(dx=>[-.012,0,.012].map(dz=>vertical(x+dx,side*z+dz,-1))).filter((y):y is number=>y!==undefined);
        const ceiling=ceilings.length?Math.min(...ceilings):undefined;
        const y=ceiling===undefined?(x>0?.045:.18+(-x-2.04)*.13):Math.min(.20,ceiling*.52);
        return new T.Vector3(x,Math.max(.015,y),side*z);
      });
      soften(floor,"y",.18,-1);
      const points=floor;paths.push({id:`floor-${side}-${z}`,layer:"floor",corner:points,straight:points.map(p=>p.clone())});
    }
  }
  const wingSurfaces=new Map<string,ReturnType<typeof createSurfaceSampler>>();
  try{
    for(const side of [-1,1])for(const end of ["front","rear"] as const)for(const lane of [.20,.40,.60]){
      const states:T.Vector3[][]=[];
      const count=end==="rear"&&inverted?25:2;
      for(let state=0;state<count;state++){
        const fraction=state/(count-1);
        flaps.forEach(part=>part.quaternion.setFromAxisAngle(part.userData.hingeAxis,T.MathUtils.lerp(part.userData.closedAngle,part.userData.openAngle,fraction)));updateWingLinkages(linkages);root.updateMatrixWorld(true);
        // A near-vertical flap can cross a route between two sampled angles
        // without appearing in either vertical ray. Cover the neighbouring
        // swept boxes too, rather than letting that thin edge cut the line.
        const envelope=new T.Box3();
        if(count>2)for(let neighbour=Math.max(0,state-1);neighbour<=Math.min(count-1,state+1);neighbour++)envelope.union(rearSweeps[neighbour]);
        const key=`${end}-${state}`;
        let surface=wingSurfaces.get(key);
        if(!surface){surface=createSurfaceSampler(end==="front"?front:rear,"y");wingSurfaces.set(key,surface);}
        const points=end==="front"
          ?sample(3.10,1.91,(x,t)=>new T.Vector3(x,Math.max(upper(surface,x,side*lane,0)+.030,.12+Math.pow(t,1.5)*T.MathUtils.lerp(.23,.11,fraction)),side*lane))
          :sample(-1.25,-3.05,(x,t)=>new T.Vector3(x,Math.max(upper(surface,x,side*lane,0)+.040,x>=envelope.min.x-.04&&x<=envelope.max.x+.04?envelope.max.y+.04:0,.89+Math.pow(t,1.7)*T.MathUtils.lerp(.40,.16,fraction)),side*lane));
        soften(points,"y",.60);states.push(points);
      }
      for(const lift of [0]){
        const shifted=states.map(points=>points.map(p=>p.clone().add(new T.Vector3(0,lift,0))));
        paths.push({id:`${end}-wing-${side}${lane===.40&&lift===0?"":`-${lane}-${lift}`}`,layer:"wings",corner:shifted[0],straight:shifted.at(-1)!,...(count>2?{states:shifted}:{})});
      }
    }
  }finally{flaps.forEach((part,i)=>part.quaternion.copy(original[i]));updateWingLinkages(linkages);root.updateMatrixWorld(true);}
  // A gently spreading, weakly rolling wake, not a row of corkscrews. Upper
  // trails follow wing upwash; tyre trails stay low with mild inward drift.
  for(const side of [-1,1])for(const height of [.29,1.04])for(const phase of [0,Math.PI]){
    const wake=(opening:number)=>sample(-2.58,-4.05,(x,t)=>{
      const radius=(.012+.045*t)*(height>.5?1-opening*.35:1),angle=side*(t*1.8+phase);
      return new T.Vector3(x,height+radius*Math.sin(angle)+(height>.5?t*(.20-opening*.14):t*.025),side*(height>.5?.63:.86-.055*t)+radius*Math.cos(angle));
    });
    paths.push({id:`wake-${side}-${height}-${phase}`,layer:"wake",corner:wake(0),straight:wake(1)});
  }
  return paths.concat(createCoolingAirflowPaths(root));
}

export function airflowRadius(path:AirflowPath,t:number) {
  if(path.radii){
    const position=T.MathUtils.clamp(t,0,1)*(path.radii.length-1),i=Math.min(Math.floor(position),path.radii.length-2);
    return T.MathUtils.lerp(path.radii[i],path.radii[i+1],position-i);
  }
  return path.layer==="floor"?.003:path.layer==="wake"?.004+t*.004:.0045;
}

export function sampleAirflowPoint(path:AirflowPath,t:number,aero:number,target=new T.Vector3()):T.Vector3 {
  const position=T.MathUtils.clamp(t,0,1)*(path.corner.length-1),i=Math.min(Math.floor(position),path.corner.length-2),u=position-i;
  const states=path.states??[path.corner,path.straight],state=T.MathUtils.clamp(aero,0,1)*(states.length-1),first=Math.min(Math.floor(state),states.length-2),blend=state-first;
  const a=states[first][i],b=states[first][i+1],c=states[first+1][i],d=states[first+1][i+1];
  return target.set(T.MathUtils.lerp(T.MathUtils.lerp(a.x,b.x,u),T.MathUtils.lerp(c.x,d.x,u),blend),T.MathUtils.lerp(T.MathUtils.lerp(a.y,b.y,u),T.MathUtils.lerp(c.y,d.y,u),blend),T.MathUtils.lerp(T.MathUtils.lerp(a.z,b.z,u),T.MathUtils.lerp(c.z,d.z,u),blend));
}

// Dimensionless visual cues: faster below the floor/around profiles, slower in
// the wake. These deliberately have no pressure or real-world speed units.
export function illustrativeFlowSpeed(path:AirflowPath,t:number,aero:number) {
  const point=sampleAirflowPoint(path,t,aero);
  if(path.layer==="cooling")return .68;
  if(path.layer==="wake")return .72-.30*t;
  if(path.layer==="floor")return 1+.68*Math.exp(-(((point.x+.1)/1.25)**2));
  if(path.layer==="wings")return 1+(.50-.22*aero)*Math.sin(Math.PI*t)**2;
  return .94+.24*Math.sin(Math.PI*t)**2;
}
