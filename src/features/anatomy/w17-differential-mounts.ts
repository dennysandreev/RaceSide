import * as T from "three";
import { createSurfaceSampler } from "./w17-surface.ts";
import { openRadialPort } from "./w17-wastegate.ts";

type Materials=Record<"metal"|"darkMetal"|"rubber",T.Material>;

// Reconstructed bearing cartridges and stationary LSD cylinders. Their outer
// flanges follow the actual case triangles; no Mercedes hardpoints are implied.
export function seatDifferential(casing:T.Mesh,assembly:T.Group,height:number,mat:Materials){
  casing.updateWorldMatrix(true,false);
  const surface=createSurfaceSampler([casing],"z");
  const add=(name:string,geometry:T.BufferGeometry,material=mat.metal,cover=false)=>{
    const part=new T.Mesh(geometry,material);part.name=`Differential ${name}`;
    part.userData={component:"differential",serviceCover:cover};part.castShadow=part.receiveShadow=true;assembly.add(part);return part;
  };
  const holes=Array.from({length:8},(_,i)=>new T.Vector2(-1.7+Math.cos(i*Math.PI/4)*.058,height+Math.sin(i*Math.PI/4)*.058));
  const bore=(geometry:T.BufferGeometry,centres:T.Vector2[],radius:number)=>{
    for(const c of centres){
      const mesh=new T.Mesh(geometry);openRadialPort(mesh,[c.x,c.y],radius,1,-1);geometry=mesh.geometry;
    }return geometry;
  };
  const conformingRing=(side:1|-1,inner:number,outer:number,from:number,to:number)=>{
    const p:number[]=[],ix:number[]=[],n=128;
    for(const offset of[from,to])for(const r of[inner,outer])for(let i=0;i<n;i++){
      const a=i/n*Math.PI*2,x=-1.7+Math.cos(a)*r,y=height+Math.sin(a)*r;
      const sampleR=Math.max(.0506,r),z=surface(-1.7+Math.cos(a)*sampleR,height+Math.sin(a)*sampleR,side)!;
      p.push(x,y,z+side*offset);
    }
    const quad=(a:number,b:number,c:number,d:number,reverse:boolean)=>ix.push(...(reverse?[a,c,b,a,d,c]:[a,b,c,a,c,d]));
    for(let i=0;i<n;i++){
      const j=(i+1)%n;
      quad(i,j,n+j,n+i,side<0);quad(2*n+i,2*n+j,3*n+j,3*n+i,side>0);
      quad(i,2*n+i,2*n+j,j,side<0);quad(n+i,n+j,3*n+j,3*n+i,side<0);
    }
    const g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();return g;
  };
  for(const side of[-1,1] as const){
    // The outer race rests against an inboard shoulder. Its stationary
    // retaining ring occupies the outboard groove and clears the inner race.
    const profile=[[.050,.089],[.050,.157],[.030,.157],[.030,.135],[.0275,.135],[.0275,.120],[.029,.120],[.029,.132],[.0445,.132],[.0445,.104],[.0348,.104],[.0348,.102],[.046,.102],[.046,.101],[.0445,.101],[.0445,.092],[.042,.092],[.042,.089],[.050,.089]];
    let cup=new T.LatheGeometry(profile.map(([r,z])=>new T.Vector2(r,z)),96) as T.BufferGeometry;
    cup.rotateX(side*Math.PI/2);cup.translate(-1.7,height,0);
    // Rear-facing radial port enters the stationary annular chamber.
    cup.rotateY(Math.PI/2);
    const pressureBore=new T.Mesh(cup);openRadialPort(pressureBore,[side*.130,height],.0016,1,1.738);
    cup=pressureBore.geometry;cup.rotateY(-Math.PI/2);
    add(`bearing cartridge ${side}`,cup,mat.darkMetal,true);
    add(`cartridge flange ${side}`,bore(conformingRing(side,.050,.065,.0004,.0064),holes,.0026),mat.metal,true);
    add(`cartridge gasket ${side}`,bore(conformingRing(side,.050,.065,0,.0004),holes,.0026),mat.rubber,true);
    // A retained backing insert spreads the bearing load into the laminate.
    add(`case bearing insert ${side}`,bore(conformingRing(side,.050,.065,-.008,-.003),holes,.0024),mat.metal,true);
    for(let i=0;i<holes.length;i++){
      const c=holes[i],z=surface(c.x,c.y,side)!;
      const shaft=new T.CylinderGeometry(.0022,.0022,.0144,12);shaft.rotateX(Math.PI/2);shaft.translate(c.x,c.y,z-side*.0008);
      add(`cartridge fixing ${side} ${i}`,shaft,mat.darkMetal,true);
      const head=new T.CylinderGeometry(.004,.004,.003,6);head.rotateX(Math.PI/2);head.translate(c.x,c.y,z+side*.0079);
      add(`cartridge bolt head ${side} ${i}`,head,mat.metal,true);
    }
    // Feed from inside the gearbox, clear of the rotating CV boot.
    const union=new T.LatheGeometry([[.0016,0],[.0032,0],[.0032,.014],[.0016,.014],[.0016,0]].map(([r,z])=>new T.Vector2(r,z)),32);
    union.rotateZ(Math.PI/2);union.translate(-1.750,height,side*.130);
    const port=add(`LSD pressure union ${side}`,union);
    port.userData.port={point:[-1.764,height,side*.130],axis:[-1,0,0]};

  }
  casing.geometry=bore(casing.geometry,holes,.0026);
}
