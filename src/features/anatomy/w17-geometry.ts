import * as T from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { TessellateModifier } from "three/addons/modifiers/TessellateModifier.js";
import type { RearWingVariant } from "./catalog.ts";
import { createWheelBrake } from "./w17-brakes.ts";
import { createSlickTyre, addTyreSidewalls } from "./w17-tyres.ts";
import { createCoolingSystem } from "./w17-cooling.ts";
import { seatOilCooler } from "./w17-oil-cooler.ts";
import { seatEngineCoolantPumps } from "./w17-coolant-pump.ts";
import { seatLowTemperaturePump } from "./w17-lt-pump.ts";
import { connectLowTemperatureDrive } from "./w17-lt-drive.ts";
import { connectOilPumpDrive } from "./w17-oil-drive.ts";
import { connectMainCoolantDrives } from "./w17-main-pump-drive.ts";
import { createTurbocharger } from "./w17-turbo.ts";
import { createInboardSuspension } from "./w17-suspension.ts";
import { rearSuspensionMount, openSuspensionPassages } from "./w17-suspension-passages.ts";
import { seatDifferential } from "./w17-differential-mounts.ts";
import { connectDifferentialHydraulics, prepareDifferentialBodyPorts } from "./w17-differential-hydraulics.ts";
import { createMotorGenerator } from "./w17-mguk.ts";
import { createEnergyStore } from "./w17-energy-store.ts";
import { servicePassage } from "./w17-feedthrough.ts";
import { createWastegate, openRadialPort } from "./w17-wastegate.ts";
import { createChargeCooler } from "./w17-charge-cooler.ts";
import { createFuelSystem } from "./w17-fuel.ts";
import { createHydraulicSystem, seatHydraulicSystem } from "./w17-hydraulics.ts";
import { rebuildHydraulicPump } from "./w17-hydraulic-pump.ts";
import { connectHydraulicPumpDrive } from "./w17-hydraulic-drive.ts";
import { createSteeringSystem, seatSteeringSystem } from "./w17-steering.ts";
import { createCockpit, seatPedalMounts } from "./w17-cockpit.ts";
import { connectSteeringSupply } from "./w17-steering-supply.ts";
import { connectFrontBrakes } from "./w17-brake-circuit.ts";
import { createRearBrakeByWire, seatRearBrakeByWire } from "./w17-brake-by-wire.ts";
import { createHeightSampler, createSurfaceSampler } from "./w17-surface.ts";
import { createEngineCore, createEngineMotion, ENGINE_CORE, engineCylinderX } from "./w17-engine-core.ts";
import { createEngineHeads,engineHeadPort } from "./w17-engine-heads.ts";
import { createEngineIgnition } from "./w17-engine-ignition.ts";
import { createEngineTiming } from "./w17-engine-timing.ts";
import { createMotorTransmission } from "./w17-accessory-drive.ts";
import { createFinalDrive } from "./w17-final-drive.ts";
import { createEnginePneumatics } from "./w17-engine-pneumatics.ts";
import { createFireSystem, prepareFireBodyPorts } from "./w17-fire-system.ts";
import { createMirrorHead } from "./w17-mirrors.ts";
import { addNoseDetails, refitNoseRoof } from "./w17-nose-details.ts";
import { createRearLight } from "./w17-rear-light.ts";

// Physical, separately selectable solids. X points forward, Y up, Z across the car.
// The side silhouette is reconstructed from RaceSide's official 1400 × 308 W17
// reference. Width sections are reconstructed, not Mercedes manufacturing data.
export const W17_SCALE = 3.4 / (1135 - 195);
export const W17_AXLES = { front: 1.7, rear: -1.7 };
export const W17_WHEELS = { front: { radius: .3525, width: .28, track: 1.612 }, rear: { radius: .355, width: .375, track: 1.517 } };
// The model's reference plane includes its nominal static ground clearance.
// FIA C5.4.5 and C9.5.1 dimensions are measured above this plane, not the road.
export const W17_REFERENCE_HEIGHT = .056;
// Visual fit to the retained launch silhouette. This compact installation is
// not the 750 mm XDIF endpoint prescribed by the later Issue 20 regulations.
export const W17_REAR_LIGHT_OVERHANG = .540;
export type AeroMode = "corner" | "straight";
export type WingMotion = { value:number; velocity:number };
// A damped presentation transition, not the real actuator's timing. Keeping
// velocity makes an interrupted opening reverse without a position/speed jump.
export function advanceWingOpening(current:WingMotion,target:number,seconds:number):WingMotion {
  if(seconds<=0)return current;
  const rate=18,offset=current.value-target,decay=Math.exp(-rate*seconds);
  const slope=current.velocity+rate*offset;
  const value=target+(offset+slope*seconds)*decay;
  const velocity=(current.velocity-rate*slope*seconds)*decay;
  if(value<=0||value>=1)return {value:T.MathUtils.clamp(value,0,1),velocity:0};
  if(Math.abs(value-target)<.0001&&Math.abs(velocity)<.002)return {value:target,velocity:0};
  return {value,velocity};
}
export type AssemblyMode = "assembled" | "cutaway" | "exploded" | "powertrain" | "isolated";
type V = [number, number, number];
type Section = [number, number, number, number, number?];
type Extras = { structural?: boolean; cover?: boolean; serviceCover?: boolean; installedOnly?: boolean; internal?: boolean; flap?: boolean; rotor?: boolean };
export type WingLinkage = { mesh:T.Mesh; wing:T.Mesh; anchor:T.Vector3; end:T.Vector3; from:number; to:number; fromOffset?:number; toOffset?:number };

// Orthographic reference landmarks, in pixels. Both axles use the same scale.
const referencePoint = (px:number,py:number,z=0):V => [(px-665)*W17_SCALE,(307-py)*W17_SCALE,z];

export function createW17(rearWing:RearWingVariant="mercedes", options:{rearWingOnly?:boolean}={}) {
  const root = new T.Group(); root.name = "Mercedes-W17-reconstruction";
  root.userData.rearWing=rearWing;
  const assemblies = new Map<string,T.Group>();
  const linkages:WingLinkage[]=[];
  const material = (name:string,color:string,metalness:number,roughness:number) => {
    const m=new T.MeshStandardMaterial({color,metalness,roughness}); m.name=name; return m;
  };
  const mat = {
    carbon:material("Carbon composite","#12161a",.02,.72),
    body:material("Neutral bodywork","#8b9297",.12,.48),
    silver:material("Neutral composite shell","#8b9297",.12,.48),
    teal:material("Composite edge","#32383d",.12,.50),
    metal:material("Machined aluminium","#a2a9af",.8,.31),
    cast:material("Cast aluminium","#697177",.6,.48),
    darkMetal:material("Dark magnesium","#34383e",.75,.33),
    anodised:material("Black anodised enclosure","#202328",.35,.61),
    rubber:material("Pirelli slick rubber","#17191b",.02,.88),
    friction:material("Carbon-carbon friction material","#424342",.02,.94),
    bronze:material("Exhaust alloy","#866843",.85,.44),
    orange:material("High voltage insulation","#d77825",.05,.6),
    red:material("Safety red","#c62c24",.25,.4),
    black:material("Intake cavity","#060708",.05,.8),
    white:material("White markings","#eeeeeb",.1,.55),
    ceramic:material("Alumina insulator","#d8d4c8",0,.30),
    copper:material("Insulated winding pack","#9b623d",.65,.45),
    circuit:material("Circuit board laminate","#24423b",.05,.65),
  };
  function group(id:string) { let g=assemblies.get(id); if(!g){g=new T.Group();g.name=id;g.userData.component=id;assemblies.set(id,g);root.add(g);} return g; }
  function mesh(id:string,name:string,geometry:T.BufferGeometry,m:T.Material,position:V=[0,0,0],extra:Extras={}) {
    const object=new T.Mesh(geometry,m);object.name=name;object.position.set(...position);object.castShadow=true;object.receiveShadow=true;
    object.userData={component:id,...extra};group(id).add(object);return object;
  }
  function box(id:string,name:string,position:V,size:V,m:T.Material,extra:Extras={}) {
    return mesh(id,name,new T.BoxGeometry(...size),m,position,extra);
  }
  function roundedBox(id:string,name:string,position:V,size:V,m:T.Material,radius=.004,extra:Extras={}) {
    return mesh(id,name,new RoundedBoxGeometry(...size,3,radius),m,position,extra);
  }
  function annulus(id:string,name:string,a:V,b:V,inner:number,outer:number,m:T.Material,extra:Extras={}) {
    const start=new T.Vector3(...a),direction=new T.Vector3(...b).sub(start),length=direction.length();
    const profile=[[inner,0],[outer,0],[outer,length],[inner,length],[inner,0]].map(([r,y])=>new T.Vector2(r,y));
    const object=mesh(id,name,new T.LatheGeometry(profile,64),m,a,extra);
    object.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),direction.normalize());return object;
  }
  function cylinder(id:string,name:string,a:V,b:V,r:number,m:T.Material,r2=r,extra:Extras={}) {
    const av=new T.Vector3(...a),bv=new T.Vector3(...b),v=bv.clone().sub(av);
    const obj=mesh(id,name,new T.CylinderGeometry(r2,r,v.length(),24,1),m,av.clone().add(bv).multiplyScalar(.5).toArray() as V,extra);
    obj.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),v.normalize());return obj;
  }
  function tube(id:string,name:string,points:V[],radius:number,m:T.Material,extra:Extras={},closed=false) {
    const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)),closed,"centripetal");
    return mesh(id,name,new T.TubeGeometry(curve,Math.max(24,points.length*12),radius,8,closed),m,[0,0,0],extra);
  }
  function hollowTube(id:string,name:string,points:V[],radius:number,wall:number,m:T.Material,extra:Extras={}) {
    const section=new T.Shape();section.absarc(0,0,radius,0,Math.PI*2,false);
    const bore=new T.Path();bore.absarc(0,0,radius-wall,0,Math.PI*2,true);section.holes.push(bore);
    const path=new T.CatmullRomCurve3(points.map(point=>new T.Vector3(...point)),false,"centripetal");
    const part=mesh(id,name,new T.ExtrudeGeometry(section,{extrudePath:path,steps:64,curveSegments:12,bevelEnabled:false}),m,[0,0,0],extra);
    part.userData.route=points;part.userData.boreRadius=radius-wall;part.userData.outerRadius=radius;return part;
  }
  function fairedRail(id:string,name:string,points:V[],width:number,height:number,m:T.Material) {
    const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)),false,"centripetal");
    const segments=160,radial=20,p:number[]=[],ix:number[]=[];
    for(let i=0;i<=segments;i++){
      const c=curve.getPoint(i/segments),t=curve.getTangent(i/segments);
      const n=new T.Vector3(t.z,0,-t.x).normalize(),b=new T.Vector3().crossVectors(t,n).normalize();
      for(let j=0;j<radial;j++){const angle=j/radial*2*Math.PI;p.push(...c.clone().addScaledVector(n,Math.cos(angle)*width).addScaledVector(b,Math.sin(angle)*height).toArray());}
    }
    for(let i=0;i<segments;i++)for(let j=0;j<radial;j++){const a=i*radial+j,b=i*radial+(j+1)%radial;ix.push(a,b,a+radial,b,b+radial,a+radial);}
    for(let j=1;j<radial-1;j++){ix.push(0,j+1,j);const e=segments*radial;ix.push(e,e+j,e+j+1);}
    const g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();return mesh(id,name,g,m);
  }
  function ball(id:string,name:string,p:V,r:number,m:T.Material) { return mesh(id,name,new T.SphereGeometry(r,16,12),m,p); }
  function torus(id:string,name:string,p:V,r:number,t:number,m:T.Material,rotation:V=[0,0,0]) {
    const object=mesh(id,name,new T.TorusGeometry(r,t,10,48),m,p);object.rotation.set(...rotation);return object;
  }
  function polygon(id:string,name:string,pts:V[],m:T.Material,extra:Extras={}) {
    const a=new T.Vector3(...pts[0]),b=new T.Vector3(...pts[1]),c=new T.Vector3(...pts[2]);
    const normal=b.sub(a).cross(c.sub(a)).normalize().multiplyScalar(.002);
    const p=pts.flatMap(v=>new T.Vector3(...v).add(normal).toArray());
    p.push(...pts.flatMap(v=>new T.Vector3(...v).sub(normal).toArray()));
    const n=pts.length,indices=[];
    for(let i=1;i<n-1;i++)indices.push(0,i,i+1,n,n+i+1,n+i);
    for(let i=0;i<n;i++){const j=(i+1)%n;indices.push(i,n+i,j,j,n+i,n+j);}
    const geo=new T.BufferGeometry();geo.setAttribute("position",new T.Float32BufferAttribute(p,3));geo.setIndex(indices);geo.computeVertexNormals();
    return mesh(id,name,geo,m,[0,0,0],extra);
  }
  const laminate=(points:T.Vector3[],indices:number[],boundary:number[],thickness:number)=>{
    const front=new T.BufferGeometry();front.setAttribute("position",new T.Float32BufferAttribute(points.flatMap(p=>p.toArray()),3));front.setIndex(indices);front.computeVertexNormals();
    const normals=front.attributes.normal,count=points.length,positions=points.flatMap(p=>p.toArray()),closed=[...indices];
    for(let i=0;i<count;i++)positions.push(...points[i].clone().addScaledVector(new T.Vector3().fromBufferAttribute(normals,i),-thickness).toArray());
    for(let i=0;i<indices.length;i+=3)closed.push(indices[i]+count,indices[i+2]+count,indices[i+1]+count);
    for(let i=0;i<boundary.length;i++){
      const a=boundary[i],b=boundary[(i+1)%boundary.length];closed.push(a,a+count,b,b,a+count,b+count);
    }
    const geometry=new T.BufferGeometry();geometry.setAttribute("position",new T.Float32BufferAttribute(positions,3));geometry.setIndex(closed);geometry.computeVertexNormals();front.dispose();return geometry;
  };
  // A closed solid loft. Longitudinal interpolation and 40-point cross sections
  // create actual curved body panels rather than scaled cubes or image planes.
  function loft(id:string,name:string,sections:Section[],m:T.Material,extra:Extras={},squareness=2.6) {
    sections=[...sections].sort((a,b)=>a[0]-b[0]);
    const p:number[]=[],uv:number[]=[],ix:number[]=[];const rings:Section[]=[];
    for(let j=0;j<sections.length-1;j++)for(let step=0;step<8;step++){
      const t=step/8;
      const v=Array.from({length:5},(_,k)=>{
        const a=sections[Math.max(0,j-1)][k]??0,b=sections[j][k]??0,c=sections[j+1][k]??0,d=sections[Math.min(sections.length-1,j+2)][k]??0;
        return .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);
      }) as Section;rings.push(v);
    }rings.push(sections.at(-1)!);
    const n=40;
    for(const [x,bottom,top,halfWidth,zc=0] of rings)for(let i=0;i<n;i++){
      const a=i/n*Math.PI*2,c=Math.cos(a),s=Math.sin(a);
      const y=(top+bottom)/2+(top-bottom)/2*Math.sign(c)*Math.pow(Math.abs(c),2/squareness);
      const z=zc+Math.max(.002,halfWidth)*Math.sign(s)*Math.pow(Math.abs(s),2/squareness);
      p.push(x,y,z);uv.push((x/W17_SCALE+665)/1400,(307-y/W17_SCALE)/308);
    }
    for(let j=0;j<rings.length-1;j++)for(let i=0;i<n;i++){const a=j*n+i,b=j*n+(i+1)%n,c=b+n,d=a+n;ix.push(a,b,d,b,c,d);}
    for(let i=1;i<n-1;i++){ix.push(0,i+1,i);const a=(rings.length-1)*n;ix.push(a,a+i,a+i+1);}
    const geo=new T.BufferGeometry();geo.setAttribute("position",new T.Float32BufferAttribute(p,3));geo.setAttribute("uv",new T.Float32BufferAttribute(uv,2));geo.setIndex(ix);geo.computeVertexNormals();
    return mesh(id,name,geo,m,[0,0,0],extra);
  }
  // A closed shell with a narrow spine, broad shoulder and undercut waist.
  // Each longitudinal station follows the photographed silhouette; transverse
  // sections remain a reconstruction because the reference contains no CAD.
  function bodyShell(name:string,stations:number[][]) {
    const curves=stations.map(([px,top,shoulder,waist,bottom,width,waistWidth,bottomWidth,ridge,innerTop=top+3,spineWidth=width*.40,spineBase=innerTop+(shoulder-innerTop)*.45,ledge=innerTop+(shoulder-innerTop)*.8])=>{
      const cockpit=top>230&&ridge>.20;
      const half:[number,number][]=[
        [0,top],
        [cockpit?ridge-.038:ridge*.35,cockpit?top:top+(innerTop-top)*.15],
        [cockpit?ridge-.019:ridge*.70,cockpit?innerTop+6:top+(innerTop-top)*.55],
        [ridge,innerTop],[spineWidth,spineBase],[width*.77,ledge],
        [width,shoulder],[waistWidth,waist],[bottomWidth,bottom],[0,bottom+1],
      ];
      const ring=[...half,...half.slice(1,-1).reverse().map(([z,y])=>[-z,y])];
      const curve=new T.CatmullRomCurve3(ring.map(([z,y])=>new T.Vector3(...referencePoint(px,y,z))),true,"centripetal");
      return {getPoint:(t:number)=>{
        const point=curve.getPoint(t),section=Math.min(t,1-t)*ring.length;
        if(section>6&&section<7){
          // A rounded outer cheek turns into the recessed waist beneath the
          // inlet. Both value and slope vanish at the existing section ends,
          // preserving their joins to the roof and the shared floor return.
          const fullness=.78*T.MathUtils.smoothstep(px,630,780)*Math.sin(Math.PI*(section-6))**2;
          point.z+=Math.sign(point.z)*(width-Math.abs(point.z))*fullness;
        }
        return point;
      }};
    });
    const radial=64,steps=12,positions:number[]=[],indices:number[]=[];
    // Shape-preserving interpolation prevents the cockpit opening's abrupt
    // change of height from pulling the preceding engine cover above its outline.
    const between=(a:number,b:number,c:number,d:number,t:number)=>{
      const left=b-a,middle=c-b,right=d-c;
      const m0=left*middle>0?2*left*middle/(left+middle):0,m1=middle*right>0?2*middle*right/(middle+right):0;
      return (2*t**3-3*t*t+1)*b+(t**3-2*t*t+t)*m0+(-2*t**3+3*t*t)*c+(t**3-t*t)*m1;
    };
    for(let station=0;station<curves.length-1;station++)for(let j=0;j<steps;j++){
      const t=j/steps;
      for(let i=0;i<radial;i++){
        const a=curves[Math.max(0,station-1)].getPoint(i/radial),b=curves[station].getPoint(i/radial),c=curves[station+1].getPoint(i/radial),d=curves[Math.min(curves.length-1,station+2)].getPoint(i/radial);
        const v=new T.Vector3(between(a.x,b.x,c.x,d.x,t),between(a.y,b.y,c.y,d.y,t),between(a.z,b.z,c.z,d.z,t));
        const lowerY=T.MathUtils.lerp(referencePoint(stations[station][0],stations[station][4])[1],referencePoint(stations[station+1][0],stations[station+1][4])[1],t);
        v.y=Math.max(v.y,lowerY);positions.push(...v.toArray());
      }
    }
    for(let i=0;i<radial;i++){const v=curves.at(-1)!.getPoint(i/radial);v.y=Math.max(v.y,referencePoint(stations.at(-1)![0],stations.at(-1)![4])[1]);positions.push(...v.toArray());}
    const rings=(curves.length-1)*steps+1;
    for(let j=0;j<rings-1;j++)for(let i=0;i<radial;i++){const a=j*radial+i,b=j*radial+(i+1)%radial;indices.push(a,b,a+radial,b,b+radial,a+radial);}
    for(const ringIndex of [0,rings-1]){
      const offset=ringIndex*radial;
      const contour=Array.from({length:radial},(_,i)=>new T.Vector2(positions[(offset+i)*3+2],positions[(offset+i)*3+1]));
      const capIndices=contour.map((_,i)=>offset+i),holes:T.Vector2[][]=[];
      if(ringIndex===rings-1){
        // The launch inlet is deep inboard and narrows into a rounded outer
        // end. Its rising lower edge is visible in both GR 4 and GR 6; the old
        // almost-level slot lost that shape and the undercut below it.
        const opening=new T.Shape();opening.moveTo(.290,.551);
        opening.bezierCurveTo(.292,.568,.301,.574,.322,.575);
        opening.bezierCurveTo(.390,.577,.494,.586,.553,.586);
        opening.bezierCurveTo(.580,.586,.588,.574,.587,.554);
        opening.bezierCurveTo(.586,.538,.578,.529,.555,.524);
        opening.bezierCurveTo(.445,.503,.365,.465,.322,.420);
        opening.bezierCurveTo(.308,.411,.300,.423,.300,.443);
        opening.bezierCurveTo(.295,.485,.290,.527,.290,.551);
        const inlet=opening.getPoints(8).slice(0,-1).map(p=>[p.x,p.y]);
        // A hole must lie strictly inside the cap. At the narrow outer lip the
        // former lower edge crossed the shell outline, so Earcut filled one
        // inlet and left overlapping triangles on the other side.
        for(const point of inlet){
          const heights:number[]=[];
          for(let j=0;j<contour.length;j++){
            const a=contour[j],b=contour[(j+1)%contour.length];
            if((a.x<=point[0]&&b.x>point[0])||(b.x<=point[0]&&a.x>point[0]))heights.push(T.MathUtils.lerp(a.y,b.y,(point[0]-a.x)/(b.x-a.x)));
          }
          point[1]=T.MathUtils.clamp(point[1],Math.min(...heights)+.004,Math.max(...heights)-.004);
        }
        for(const side of [-1,1]){
          const points=inlet.map(([z,y])=>new T.Vector2(side*z,y));if(side<0)points.reverse();holes.push(points);
          const x=positions[offset*3],duct:number[]=[],ductIndices:number[]=[];
          for(const point of points){capIndices.push(positions.length/3);positions.push(x,point.y,point.x);duct.push(x-.001,point.y,point.x);}
          // The return moves outboard of the curved cockpit shoulder, so the
          // separate fairing cannot enter the airflow passage behind the lip.
          for(const point of points)duct.push(x-.085,point.y-.005,side*.41+(point.x-side*.41)*.87+side*.018*(1-T.MathUtils.smoothstep(Math.abs(point.x),.30,.40)));
          const count=points.length;
          for(let j=0;j<count;j++){
            const k=(j+1)%count,a=new T.Vector3().fromArray(duct,j*3),b=new T.Vector3().fromArray(duct,k*3),c=new T.Vector3().fromArray(duct,(j+count)*3);
            const normal=b.clone().sub(a).cross(c.clone().sub(a)),inside=new T.Vector3(x-.04,.541,side*.41).sub(a);
            if(normal.dot(inside)>0)ductIndices.push(j,k,j+count,k,k+count,j+count);else ductIndices.push(j,j+count,k,k,j+count,k+count);
          }
          const surface=new T.BufferGeometry();surface.setAttribute("position",new T.Float32BufferAttribute(duct,3));surface.setIndex(ductIndices);surface.computeVertexNormals();
          const normals=surface.attributes.normal,size=count*2;
          for(let i=0;i<size;i++)duct.push(duct[i*3]-normals.getX(i)*.002,duct[i*3+1]-normals.getY(i)*.002,duct[i*3+2]-normals.getZ(i)*.002);
          const innerFaces=[...ductIndices];
          for(let i=0;i<innerFaces.length;i+=3)ductIndices.push(innerFaces[i]+size,innerFaces[i+2]+size,innerFaces[i+1]+size);
          for(const row of[0,1])for(let j=0;j<count;j++){
            let a=row*count+j,b=row*count+(j+1)%count;
            const forward=innerFaces.some((v,i)=>v===a&&innerFaces[i-i%3+(i%3+1)%3]===b);
            if(forward)[a,b]=[b,a];ductIndices.push(a,b,a+size,b,b+size,a+size);
          }
          const ductGeometry=new T.BufferGeometry();ductGeometry.setAttribute("position",new T.Float32BufferAttribute(duct,3));ductGeometry.setIndex(ductIndices);ductGeometry.computeVertexNormals();surface.dispose();
          const throat=mesh("bodywork",`Recessed sidepod inlet ${side}`,ductGeometry,mat.black,[0,0,0],{cover:true});
          throat.userData.inletVertices=count;
          tube("bodywork",`Rolled sidepod inlet edge ${side}`,points.map(point=>[x+.001,point.y,point.x] as V),.0035,mat.body,{cover:true},true);
        }
      }
      for(const face of T.ShapeUtils.triangulateShape(contour,holes)){
        const [a,b,c]=face.map(i=>capIndices[i]);
        const av=new T.Vector3().fromArray(positions,a*3),bv=new T.Vector3().fromArray(positions,b*3),cv=new T.Vector3().fromArray(positions,c*3);
        const xNormal=bv.sub(av).cross(cv.sub(av)).x;
        if(xNormal*(ringIndex===0?-1:1)>0)indices.push(a,b,c);else indices.push(a,c,b);
      }
    }
    const geo=new T.BufferGeometry();geo.setAttribute("position",new T.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();
    const shell=mesh("bodywork",name,geo,mat.body,[0,0,0],{cover:true});shell.userData.shellRings=rings;return shell;
  }
  function profilePlate(id:string,name:string,points:[number,number][],z:number,m:T.Material,extra:Extras={}) {
    const shape=new T.Shape();points.forEach(([px,py],i)=>{const [x,y]=referencePoint(px,py);if(i)shape.lineTo(x,y);else shape.moveTo(x,y);});shape.closePath();
    const geo=new T.ExtrudeGeometry(shape,{depth:.008,bevelEnabled:true,bevelSize:.003,bevelThickness:.002,bevelSegments:2,steps:1});geo.translate(0,0,z-.004);
    return mesh(id,name,geo,m,[0,0,0],extra);
  }
  function aerofoil(id:string,name:string,x:number,y:number,chord:number,span:number,m:T.Material,flap=false,sweep=0,range?:[number,number],rearRise=.082) {
    const p:number[]=[],uv:number[]=[],ix:number[]=[];const radial=40,lateral=32;
    for(let s=0;s<=lateral;s++){
      const z=range?range[0]+s/lateral*(range[1]-range[0]):(s/lateral-.5)*span;
      const taper=1-.18*Math.pow(Math.abs(z/(span/2)),3);
      for(let i=0;i<radial;i++){
        const angle=i/radial*2*Math.PI,u=(1-Math.cos(angle))/2;
        const thick=5*.085*chord*(.2969*Math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1036*u**4);
        const camber=.07*chord*Math.sin(Math.PI*u);
        const across=Math.abs(z/(span/2));
        const rise=(id==="front-wing"?.095:rearRise)*(1-Math.cos(across*Math.PI))/2;
        const rear=id==="rear-wing";
        // The mainplane climbs towards its trailing edge. A horizontal section
        // left an artificial 80–100 mm opening below the next element.
        const rake=name==="Front mainplane"?.055*(1-.18*across*across)*u:0;
        p.push(x-u*chord*taper-(rear?chord*(1-taper):0)+sweep*z*z*(rear?1-u:1),y-camber+Math.sign(Math.sin(angle))*thick+rise*(rear?1-u:1)+rake,z);uv.push(s/lateral,u);
      }
    }
    for(let s=0;s<lateral;s++)for(let i=0;i<radial;i++){const a=s*radial+i,b=s*radial+(i+1)%radial;ix.push(a,b,a+radial,b,b+radial,a+radial);}
    for(const offset of [0,lateral*radial])for(let i=1;i<radial-1;i++)ix.push(offset,offset+i,offset+i+1);
    const g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(p,3));g.setAttribute("uv",new T.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();
    const o=mesh(id,name,g,m,[0,0,0],{flap});
    if(flap){g.translate(-x,-y,0);o.position.set(x,y,0);o.userData.pivot=[x,y,0];}
    return o;
  }
  function hinge(wing:T.Mesh,pivot:V,closed:number,open:number,axis=new T.Vector3(0,0,1)) {
    wing.geometry.translate(...wing.position.toArray());wing.geometry.translate(-pivot[0],-pivot[1],-pivot[2]);
    wing.position.set(...pivot);wing.userData.pivot=[...pivot];wing.userData.closedAngle=closed;wing.userData.openAngle=open;wing.userData.hingeAxis=axis;wing.userData.angle=closed;wing.quaternion.setFromAxisAngle(axis,closed);
  }
  function actuator(wing:T.Mesh,name:string,anchor:V,attachment:V) {
    const origin=new T.Vector3(...anchor),end=new T.Vector3(...attachment).sub(wing.position),rotation=new T.Quaternion();
    let minimum=Infinity,maximum=0;
    for(let step=0;step<=100;step++){
      rotation.setFromAxisAngle(wing.userData.hingeAxis,T.MathUtils.lerp(wing.userData.closedAngle,wing.userData.openAngle,step/100));
      const length=end.clone().applyQuaternion(rotation).add(wing.position).distanceTo(origin);
      minimum=Math.min(minimum,length);maximum=Math.max(maximum,length);
    }
    // Reconstruction dimensions: the barrel and rod are rigid. The piston
    // slides inside a hollow bore; neither solid stretches during animation.
    const barrelEnd=minimum-.009,rodLength=maximum-barrelEnd+.006;
    const ring=(inner:number,outer:number)=>new T.LatheGeometry([
      new T.Vector2(inner,-.5),new T.Vector2(outer,-.5),new T.Vector2(outer,.5),new T.Vector2(inner,.5),new T.Vector2(inner,-.5),
    ],24);
    const part=(label:string,geometry:T.BufferGeometry,material:T.Material,from:number,to:number,fromOffset=0,toOffset=0)=>{
      const o=mesh(wing.userData.component,`${name} ${label}`,geometry,material);
      o.userData.actuator=name;o.userData.actuatorPart=label;
      linkages.push({mesh:o,wing,anchor:origin.clone(),end:end.clone(),from,to,fromOffset,toOffset});
      return o;
    };
    const barrel=part("body",ring(.0065,.008),mat.darkMetal,0,0,.004,barrelEnd);
    barrel.userData.stroke=maximum-minimum;
    part("end cap",new T.CylinderGeometry(.008,.008,1,24),mat.darkMetal,0,0,.001,.004);
    part("gland",ring(.0041,.0085),mat.metal,0,0,barrelEnd-.003,barrelEnd);
    part("rod seal",ring(.004,.0046),mat.rubber,0,0,barrelEnd-.001,barrelEnd+.0005);
    part("rod",new T.CylinderGeometry(.004,.004,1,24),mat.metal,1,1,-rodLength,0);
    part("piston",ring(.004,.0064),mat.metal,1,1,-rodLength,-rodLength+.003);
    part("piston seal",ring(.0061,.0065),mat.rubber,1,1,-rodLength+.001,-rodLength+.002);
    ball(wing.userData.component,`${name} fixed clevis`,anchor,.005,mat.darkMetal);
  }
  function buildRearWing() {
  const inverted=rearWing!=="mercedes",redBull=rearWing==="red-bull";
  // Put the two Miami assemblies on the same installation-height datum as
  // the retained W17. Their inverted flap heights remain design-specific.
  const installationDrop=inverted?(redBull?.045:.058):0;
  let rearFlap:T.Mesh,mainplane:T.Mesh;
  let drive:{name:string;anchorX:number;attachment:V}|undefined;
  if(!inverted){
    mainplane=aerofoil("rear-wing","Rear mainplane",-1.79,.79,.445,1.386,mat.body,false,.015,undefined,.028);
    // Launch/reference views show a shallow spoon, not tips swept sharply up.
    // Lower the leading edge while keeping the trailing lip and flap slot.
    // The 28 mm span rise and 30 mm incidence are photographic estimates.
    // A flatter outer contour and a small residual incidence keep the opened
    // profile inside the endplate height. These are reconstruction values.
    rearFlap=aerofoil("rear-wing","Rear active flap",-1.951,.917,.336,1.386,mat.body,true,.006,undefined,.010);
    hinge(rearFlap,[-2.287,.917,0],-.36,-.12);
    // End the fixed profile just under the closed flap's leading lip. Its old
    // 445 mm chord extended almost to the hinge, leaving a broad second shelf.
    rearFlap.updateMatrixWorld(true);
    const closedSkin=createSurfaceSampler([rearFlap],"y"),fixedPoints=mainplane.geometry.attributes.position;
    for(let row=0;row<=32;row++){
      const z=fixedPoints.getZ(row*40),lip=new T.Vector3().fromBufferAttribute(rearFlap.geometry.attributes.position,row*40).applyMatrix4(rearFlap.matrixWorld);
      const leadingX=fixedPoints.getX(row*40),leadingY=fixedPoints.getY(row*40)-.030;
      const trailingX=lip.x-.024,trailingY=closedSkin(trailingX,z,-1)!-.010,chord=leadingX-trailingX;
      for(let j=0;j<40;j++){
        const angle=j/40*2*Math.PI,u=(1-Math.cos(angle))/2;
        const thickness=5*.085*chord*(.2969*Math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1036*u**4);
        fixedPoints.setXYZ(row*40+j,T.MathUtils.lerp(leadingX,trailingX,u),T.MathUtils.lerp(leadingY,trailingY,u)-.07*chord*Math.sin(Math.PI*u)+Math.sign(Math.sin(angle))*thickness,z);
      }
    }
    mainplane.geometry.computeVertexNormals();
    for(const z of [-.665,.665]){
      cylinder("rear-wing",`Rear flap hinge pin ${z}`,[-2.287,.917,z-.011],[-2.287,.917,z+.011],.004,mat.metal);
      annulus("rear-wing",`Rear pivot bearing ${z}`,[-2.287,.917,z-.007],[-2.287,.917,z+.007],.0041,.0065,mat.darkMetal);
    }
  }else{
    // Miami 2026 references: three profiles, two inverted moving elements.
    // Photographs establish the layout; sections and exact travel are inferred.
    const pivot:V=redBull?[-2.14,.995-installationDrop,0]:[-2.165,.947-installationDrop,0];
    const profileY=redBull?.941-installationDrop:pivot[1];
    const closed=redBull?-.36:-.52,open=redBull?-Math.PI:Math.PI;
    const leading=redBull?-1.98:-1.99,primaryChord=.181,secondLeading=leading-.169,secondChord=.126;
    // The old default 82 mm spoon lifted the leading tips above the trailing
    // lip on Red Bull. The Miami front/rear views show a much shallower bow.
    mainplane=aerofoil("rear-wing","Rear mainplane",redBull?-1.775:-1.79,(redBull?.776:.789)-installationDrop,redBull?.457:.431,1.386,mat.body,false,redBull?.033:.011,undefined,redBull?.030:.028);
    rearFlap=aerofoil("rear-wing","Rear active flap",leading,profileY,primaryChord,1.352,mat.body,true,redBull?.024:.007,undefined,.010);
    const upper=aerofoil("rear-wing","Rear upper flap",secondLeading,profileY+.012,secondChord,1.352,mat.body,true,redBull?.018:.004,undefined,.010);
    hinge(rearFlap,pivot,closed,open);hinge(upper,pivot,closed,open);
    // The lower profile ends just beneath the leading lip of the closed
    // upper pair. The old long, flat mainplane left three separated shelves.
    rearFlap.updateMatrixWorld(true);
    const closedSkin=createSurfaceSampler([rearFlap],"y"),lowerPoints=mainplane.geometry.attributes.position;
    for(let row=0;row<=32;row++){
      const z=lowerPoints.getZ(row*40),sampleZ=T.MathUtils.clamp(z,-.675,.675),across=Math.abs(sampleZ/.676);
      const taper=1-.18*across**3;
      const lip=new T.Vector3(leading-primaryChord*(1-taper)+(redBull?.024:.007)*sampleZ*sampleZ,profileY+.010*(1-Math.cos(across*Math.PI))/2,sampleZ).sub(new T.Vector3(...pivot)).applyAxisAngle(new T.Vector3(0,0,1),closed).add(new T.Vector3(...pivot));
      const trailingX=lip.x-.024;
      // Red Bull's leading lip sweeps down before inverting. Its fixed lower
      // profile must clear that arc, not just the two resting positions.
      // Use the sweep at this trailing-edge X, not the bottom of the entire
      // pivot circle behind it. The latter left a false wide gap when closed.
      const radius=Math.hypot(lip.x-pivot[0],lip.y-pivot[1]);
      const sweepFloor=pivot[1]-Math.sqrt(Math.max(0,radius*radius-(trailingX-pivot[0])**2))-.020;
      const trailingY=Math.min(closedSkin(trailingX,sampleZ,-1)!-.010,redBull?sweepFloor:Infinity);
      const leadingX=lowerPoints.getX(row*40),leadingY=lowerPoints.getY(row*40),chord=leadingX-trailingX;
      for(let j=0;j<40;j++){
        const angle=j/40*2*Math.PI,u=(1-Math.cos(angle))/2;
        const thickness=5*.085*chord*(.2969*Math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1036*u**4);
        lowerPoints.setXYZ(row*40+j,T.MathUtils.lerp(leadingX,trailingX,u),T.MathUtils.lerp(leadingY,trailingY,u)-.07*chord*Math.sin(Math.PI*u)+Math.sign(Math.sin(angle))*thickness,z);
      }
    }
    mainplane.geometry.computeVertexNormals();
    const carry=(part:T.Mesh)=>{
      part.updateMatrix();part.geometry.applyMatrix4(part.matrix);part.geometry.translate(-pivot[0],-pivot[1],0);
      part.position.set(0,0,0);part.quaternion.identity();part.scale.setScalar(1);rearFlap.add(part);
    };
    const attachment=(x:number,y:number,chord:number,sweep:number,u:number,z:number):V=>{
      const across=Math.abs(z/.676),taper=1-.18*across**3;
      return [x-u*chord*taper-chord*(1-taper)+sweep*z*z*(1-u),y-.07*chord*Math.sin(Math.PI*u)+.010*(1-Math.cos(across*Math.PI))/2*(1-u),z];
    };
    for(const side of [-1,1]){
      const z=side*.666;
      const a=attachment(secondLeading,profileY+.012,secondChord,redBull?.018:.004,.70,z),b=attachment(leading,profileY,primaryChord,redBull?.024:.007,.64,z);
      const stay=loft("rear-wing",`Rotating profile stay ${side}`,[[a[0],a[1]-.002,a[1]+.012,.005,z],[b[0],b[1]-.002,b[1]+.012,.005,z]],mat.carbon,{},3);carry(stay);
      const lug=cylinder("rear-wing",`Rotating pivot lug ${side}`,[pivot[0],pivot[1],side*.657],[pivot[0],pivot[1],side*.675],.027,mat.carbon);carry(lug);
      if(redBull){const crank=loft("rear-wing",`Rotating pivot crank ${side}`,[[pivot[0]-.012,profileY-.008,pivot[1]+.008,.008,z],[pivot[0]+.013,profileY-.012,pivot[1]+.008,.008,z]],mat.carbon,{},3);carry(crank);}
      cylinder("rear-wing",`Rear flap hinge pin ${side}`,[pivot[0],pivot[1],side*.665],[pivot[0],pivot[1],side*.701],.013,mat.metal);
      cylinder("rear-wing",`Rear pivot bearing ${side}`,[pivot[0],pivot[1],side*.680],[pivot[0],pivot[1],side*.696],.023,mat.darkMetal);
      if(!redBull){
        cylinder("rear-wing",`Side rotary drive housing ${side}`,[pivot[0],pivot[1],side*.694],[pivot[0],pivot[1],side*.721],.030,mat.carbon);
        for(let i=0;i<4;i++){const a=i*Math.PI/2;ball("rear-wing",`Side drive cover fastener ${side} ${i}`,[pivot[0]+Math.cos(a)*.023,pivot[1]+Math.sin(a)*.023,side*.724],.003,mat.metal);}
      }
    }
    for(const z of [-.26,.26]){
      const a=attachment(secondLeading,profileY+.012,secondChord,redBull?.018:.004,.70,z),b=attachment(leading,profileY,primaryChord,redBull?.024:.007,.64,z);
      const hanger=loft("rear-wing",`Rotating profile hanger ${z}`,[[a[0],a[1]-.002,a[1]+.008,.003,z],[b[0],b[1]-.002,b[1]+.008,.003,z]],mat.carbon,{},3);carry(hanger);
    }
    if(redBull){
      // Carry the rod eye above the primary profile on a forked drive horn.
      // The previous attachment lay behind the leading lip: the cylinder then
      // cut through the closed flap instead of reaching an exposed joint.
      const attachment:V=[-2.06,1.04-installationDrop,0];
      const hornOutline=[[-2.095,.923-installationDrop],[-2.035,.927-installationDrop],[-2.048,1.048-installationDrop],[-2.072,1.048-installationDrop]];
      for(const side of[-1,1]){
        const shape=new T.Shape();hornOutline.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();
        const geometry=new T.ExtrudeGeometry(shape,{depth:.004,bevelEnabled:true,bevelSize:.001,bevelThickness:.001,bevelSegments:2,steps:1});geometry.translate(0,0,side*.014-.002);
        carry(mesh("rear-wing",`Red Bull central drive horn ${side}`,geometry,mat.carbon));
      }
      carry(cylinder("rear-wing","Red Bull moving actuator pin",[attachment[0],attachment[1],-.021],[attachment[0],attachment[1],.021],.004,mat.metal));
      carry(annulus("rear-wing","Red Bull moving actuator eye",[attachment[0],attachment[1],-.009],[attachment[0],attachment[1],.009],.0041,.008,mat.darkMetal));
      drive={name:"Rear central actuator",anchorX:-1.94,attachment};
    }
    else{
      const tab=loft("rear-wing","Ferrari centre flap bracket",[[secondLeading-.07,pivot[1]+.023,pivot[1]+.070,.012],[secondLeading-.035,pivot[1]+.022,pivot[1]+.063,.017]],mat.carbon,{},3);carry(tab);
    }
  }
  const mainplaneSkin=createSurfaceSampler([mainplane],"y");
  for(const s of [-1,1]){
    const outline:[number,number][]=!inverted?[[12,38],[147,41],[161,47],[169,57],[173,81],[165,100],[139,143],[117,183],[113,204],[59,203],[53,181],[17,107],[10,87]]
      :(redBull?[[-2.34,1.018],[-1.79,1.018],[-1.72,.970],[-1.70,.90],[-1.72,.82],[-1.88,.65],[-2.02,.44],[-2.15,.40],[-2.28,.55],[-2.35,.82]]:[[-2.34,1.031],[-1.85,1.029],[-1.76,.976],[-1.73,.90],[-1.77,.80],[-1.91,.63],[-2.05,.42],[-2.18,.41],[-2.31,.59],[-2.35,.84]]).map(([x,y])=>[x/W17_SCALE+665,307-(y-installationDrop*T.MathUtils.smoothstep(y,.45,.80))/W17_SCALE]);
    const endplate=profilePlate("rear-wing",`Rear endplate ${s}`,outline,s*.697,mat.body,{});
    // The lower endplate curls inboard of the rear tyre, rather than cutting
    // through it. Subdivision carries the curvature across the whole panel.
    const original=endplate.geometry.index?endplate.geometry.toNonIndexed():endplate.geometry.clone(),source=original.attributes.position;
    let faces:number[][]=[];for(let i=0;i<source.count;i+=3)faces.push([...new T.Vector3().fromBufferAttribute(source,i).toArray(),...new T.Vector3().fromBufferAttribute(source,i+1).toArray(),...new T.Vector3().fromBufferAttribute(source,i+2).toArray()]);
    for(let pass=0;pass<6;pass++){
      const next:number[][]=[];
      for(const f of faces){
        const a=new T.Vector3().fromArray(f,0),b=new T.Vector3().fromArray(f,3),c=new T.Vector3().fromArray(f,6);
        if(Math.max(a.distanceToSquared(b),b.distanceToSquared(c),c.distanceToSquared(a))<=.024**2){next.push(f);continue;}
        const ab=a.clone().add(b).multiplyScalar(.5),bc=b.clone().add(c).multiplyScalar(.5),ca=c.clone().add(a).multiplyScalar(.5);
        for(const triangle of [[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]])next.push(triangle.flatMap(v=>v.toArray()));
      }
      faces=next;
    }
    const panelWidth=(x:number,y:number)=>{
      const t=T.MathUtils.clamp((y-.47)/.305,0,1),distance=Math.hypot(x-W17_AXLES.rear,y-W17_WHEELS.rear.radius);
      const flare=T.MathUtils.smoothstep(distance,W17_WHEELS.rear.radius+.020,W17_WHEELS.rear.radius+.090);
      return .52+.177*t*t*(3-2*t)*flare;
    };
    const curved=faces.flat();for(let i=0;i<curved.length;i+=3){
      curved[i+2]+=s*(panelWidth(curved[i],curved[i+1])-.697);
    }
    const panel=new T.BufferGeometry();panel.setAttribute("position",new T.Float32BufferAttribute(curved,3));const smoothPanel=mergeVertices(panel,1e-5);smoothPanel.computeVertexNormals();
    // The triangulated cap is deformed by an analytic surface. Its normals
    // must follow that surface, not the irregular fan triangles of the cap.
    const panelPoints=smoothPanel.attributes.position,panelNormals=smoothPanel.attributes.normal;
    for(let i=0;i<panelPoints.count;i++){
      const x=panelPoints.getX(i),y=panelPoints.getY(i),delta=panelPoints.getZ(i)-s*panelWidth(x,y);
      if(Math.abs(Math.abs(delta)-.006)>.000003)continue;
      const dx=(panelWidth(x+.0001,y)-panelWidth(x-.0001,y))/.0002,dy=(panelWidth(x,y+.0001)-panelWidth(x,y-.0001))/.0002;
      const normal=new T.Vector3(-s*dx,-s*dy,1).multiplyScalar(Math.sign(delta)).normalize();panelNormals.setXYZ(i,normal.x,normal.y,normal.z);
    }
    endplate.geometry.dispose();original.dispose();panel.dispose();endplate.geometry=smoothPanel;
    const mountX=inverted?-1.90:-1.87,mountZ=s*.085;
    const mountY=(mainplaneSkin(mountX,mountZ,1)!+mainplaneSkin(mountX,mountZ,-1)!)/2;
    const neck=tube("rear-wing",`Rear swan neck ${s}`,[[-1.93,.36,mountZ],[-1.93,.66-installationDrop*.5,mountZ],[mountX+.04,.713-installationDrop,mountZ],[mountX,mountY,mountZ]],.016,mat.carbon);
    // Seat the complete inclined terminal inside the actual section, rather
    // than ending an open tube below a horizontal pad. Each variant has its
    // own camber and skin height, so its attachment is sampled independently.
    const p=neck.geometry.attributes.position,rows=(neck.geometry as T.TubeGeometry).parameters.tubularSegments,radial=(neck.geometry as T.TubeGeometry).parameters.radialSegments;
    for(let row=0;row<=rows;row++)for(let j=0;j<=radial;j++){
      const i=row*(radial+1)+j,x=p.getX(i),z=p.getZ(i),blend=T.MathUtils.smoothstep(row/rows,.90,1);
      if(!blend)continue;
      const centre=(mainplaneSkin(x,z,1)!+mainplaneSkin(x,z,-1)!)/2;
      p.setY(i,T.MathUtils.lerp(p.getY(i),centre,blend));
    }
    const indices=Array.from(neck.geometry.index!.array),last=rows*(radial+1);
    for(let j=1;j<radial-1;j++)indices.push(last,last+j,last+j+1);
    neck.geometry.setIndex(indices);neck.geometry.computeVertexNormals();
    neck.userData.mount=[mountX,mountY,mountZ];
    annulus("rear-wing",`Mainplane internal bearing ${s}`,[mountX,mountY,mountZ-.020],[mountX,mountY,mountZ+.020],.0033,.0064,mat.darkMetal);
    cylinder("rear-wing",`Mainplane internal pin ${s}`,[mountX,mountY,mountZ-.025],[mountX,mountY,mountZ+.025],.0032,mat.metal);
  }
  if(!inverted)drive={name:"Rear flap actuator",anchorX:-1.95,attachment:[-2.015,.902,0]};
  if(drive){
    const anchor:V=[drive.anchorX,mainplaneSkin(drive.anchorX,0,1)!+.005,0];
    roundedBox("rear-wing",`${drive.name} seated bracket`,[anchor[0],anchor[1]-.003,0],[.028,.014,.026],mat.carbon,.004);
    actuator(rearFlap,drive.name,anchor,drive.attachment);
  }
  }
  if(options.rearWingOnly){
    buildRearWing();
    root.traverse(o=>{if(o instanceof T.Mesh){o.geometry.computeBoundingBox();o.geometry.computeBoundingSphere();}});
    updateWingLinkages(linkages);
    return {root,assemblies,materials:mat,linkages};
  }
  // Floor and diffuser: a thin solid with visible edge thickness and rising tunnels.
  const diffuserHeightAt=(x:number)=>.068+T.MathUtils.clamp((-1.23-x)/.81,0,1)*.167;
  const floorWidths=[[-2.02,.30],[-1.96,.39],[-1.55,.49],[-1.32,.552],[-.98,.57],[-.50,.625],[-.10,.695],[.38,.72],[.79,.79],[1.045,.83]];
  const widthAt=(x:number)=>{
    const index=floorWidths.findIndex(([px])=>px>=x);
    if(index===-1)return floorWidths.at(-1)![1];
    if(index===0)return floorWidths[0][1];
    const [a,b]=[floorWidths[index-1],floorWidths[index]];return T.MathUtils.lerp(a[1],b[1],(x-a[0])/(b[0]-a[0]));
  };
  const floorEdgeX=[1.045,.79,.38,-.10,-.50,-.98,-1.23];
  const outline: [number,number][]=[
    [1.045,-.49],...floorEdgeX.map(x=>[x,-widthAt(x)] as [number,number]),
    [-1.52,-widthAt(-1.52)],[-1.52,-.475],[-1.23,-.475],
    [-1.23,-.15],[-1.80,-.15],[-1.80,.15],[-1.23,.15],
    [-1.23,.475],[-1.52,.475],[-1.52,widthAt(-1.52)],
    ...[...floorEdgeX].reverse().map(x=>[x,widthAt(x)] as [number,number]),
    [1.045,.49],[1.17,.24],[1.37,.18],[1.37,-.18],[1.17,-.24],
  ];
  const floorShape=new T.Shape();outline.forEach(([x,z],i)=>i?floorShape.lineTo(x,-z):floorShape.moveTo(x,-z));floorShape.closePath();
  const floorGeo=new T.ExtrudeGeometry(floorShape,{depth:.018,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.006,bevelThickness:.003});floorGeo.rotateX(-Math.PI/2);
  mesh("floor","Carbon floor",floorGeo,mat.carbon,[0,.056,0]);
  // The flat floor ends at the diffuser ramp. Extending a second flat sheet
  // underneath that ramp closed the exit channels instead of expanding them.
  // Only the central plank land continues aft, between the two open channels.
  box("floor","Central wear plank",[-.25,.037,0],[3.07,.015,.30],mat.bronze);
  for(const side of [-1,1]){
    polygon("diffuser",`Diffuser roof ${side}`,[[-1.23,.068,side*.08],[-1.23,.068,side*.47],[-2.04,.235,side*.45],[-2.04,.235,side*.08]],mat.carbon);
  }
  for(const z of [-.43,-.26,0,.26,.43])polygon("diffuser",`Diffuser fence ${z}`,[[-1.31,.05,z],[-2.07,.05,z],[-2.07,.237,z],[-1.31,.075,z]],mat.carbon);
  // Hollow survival cell and continuous tapering nose. The cockpit remains open.
  loft("monocoque","Survival cell lower shell",[[-.25,.12,.21,.19],[.06,.081,.091,.22],[.13,.081,.091,.22],[.74,.081,.091,.21],[.78,.081,.091,.205],[.90,.14,.24,.18],[1.04,.16,.44,.17]],mat.carbon,{cover:true,structural:true},3);
  // C12.7: the front floor structure is enclosed by the floor/fairing, not an
  // exposed support rail along the sidepods. Exact W17 fixings are not public.
  // A broad rising floor pan encloses the underside of the survival cell.
  // Its leading edge returns to the floor instead of ending as a narrow pod
  // below the keel. The central crest overlaps the cell; the shoulders taper
  // outwards into the floor, leaving the sidepod air passages open.
  loft("floor","Central floor-to-chassis fairing",[
    [-.30,.071,.165,.225],[.12,.071,.195,.263],[.50,.071,.260,.275],
    [.82,.071,.300,.249],[1.04,.071,.320,.218],[1.20,.071,.300,.183],
    [1.28,.071,.245,.178],[1.34,.071,.125,.175],[1.37,.071,.077,.170],
  ],mat.carbon,{},3.2);
  for(const side of [-1,1]){
    loft("monocoque",`Cockpit side ${side}`,[[-.04,.30,.59,.021,side*.235],[.3,.31,.61,.020,side*.259],[.58,.31,.595,.025,side*.219],[.78,.30,.582,.023,side*.20],[.94,.29,.575,.019,side*.20]],mat.carbon,{cover:true,structural:true},3);
    loft("bodywork",`Cockpit shoulder fairing ${side}`,[[-.06,.53,.645,.043,side*.22],[.13,.52,.644,.043,side*.252],[.35,.49,.632,.039,side*.258],[.57,.36,.615,.035,side*.239],[.72,.40,.620,.029,side*.223],[.86,.43,.619,.022,side*.218],[.99,.43,.604,.016,side*.218]],mat.body,{cover:true},3);
  }
  loft("impact","Nose structural core",[[1.80,.14,.430,.133],[2.14,.115,.25,.067],[2.48,.11,.185,.058]],mat.carbon,{},2.8);
  loft("bodywork","Silver nose skin",[
    [855,176,122,.225],[902,189,124,.228],[974,192,127,.203],
    [1030,211,138,.180],[1100,232,161,.162],[1200,258,202,.147],
    [1270,267,225,.134],[1330,268,246,.115],[1354,269,250,.086],
    [1361,268,254,.049],[1364,264,259,.017],[1365,262,261,.0025],
  ].map(([px,bottom,top,width])=>[(px-665)*W17_SCALE,(307-bottom)*W17_SCALE,(307-top)*W17_SCALE,width] as Section),mat.silver,{cover:true},3.2);
  for(const side of [-1,1])loft("monocoque",`Lower side enclosure ${side}`,[[-.22,.14,.31,.020,side*.22],[.18,.14,.34,.020,side*.225],[.53,.14,.40,.020,side*.22],[.94,.16,.42,.018,side*.19]],mat.carbon,{cover:true,structural:true},3.4);
  loft("monocoque","Lower chassis enclosure",[[-1.28,.10,.30,.18],[-.88,.09,.30,.24],[-.37,.09,.32,.235],[.18,.078,.325,.27],[.52,.078,.35,.245],[.78,.078,.36,.23]],mat.carbon,{cover:true},3.5);
  // A real under-seat tray, rather than solid fairing volumes occupying the
  // electrical bay. Flatten the concealed central region; keep the outer
  // floor shoulders and their sidepod junctions unchanged.
  for(const [name,base,ceiling]of[["Central floor-to-chassis fairing",.071,.086],["Lower chassis enclosure",.078,.089]] as const){
    const skin=root.getObjectByName(name) as T.Mesh;
    let p=skin.geometry.attributes.position;
    const tops=new Map<number,number>();
    for(let i=0;i<p.count;i++)tops.set(p.getX(i),Math.max(tops.get(p.getX(i))??0,p.getY(i)));
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),blend=T.MathUtils.smoothstep(x,-.38,-.28)*(1-T.MathUtils.smoothstep(x,.78,.86))*(1-T.MathUtils.smoothstep(Math.abs(p.getZ(i)),name==="Lower chassis enclosure"?.205:.176,name==="Lower chassis enclosure"?.235:.215));
      const scale=T.MathUtils.lerp(1,(ceiling-base)/(tops.get(x)!-base),blend);
      p.setY(i,base+(p.getY(i)-base)*scale);
    }
    // The tub ends at the engine interface. The former aft extension crossed
    // the crankcase and sump all the way to the gearbox. Trim the existing
    // loft rows so the forward electrical bay and service ports stay put.
    const rear=-.263,source=skin.geometry,uv=source.attributes.uv;
    let first=0;
    while(p.getX(first*40)<rear)first++;
    const t=(rear-p.getX((first-1)*40))/(p.getX(first*40)-p.getX((first-1)*40));
    const positions:number[]=[],coordinates:number[]=[];
    for(let i=0;i<40;i++){
      const a=(first-1)*40+i,b=first*40+i;
      positions.push(rear,T.MathUtils.lerp(p.getY(a),p.getY(b),t),T.MathUtils.lerp(p.getZ(a),p.getZ(b),t));
      coordinates.push(T.MathUtils.lerp(uv.getX(a),uv.getX(b),t),T.MathUtils.lerp(uv.getY(a),uv.getY(b),t));
    }
    for(let i=first*40;i<p.count;i++){positions.push(p.getX(i),p.getY(i),p.getZ(i));coordinates.push(uv.getX(i),uv.getY(i));}
    const geometry=new T.BufferGeometry();
    geometry.setAttribute("position",new T.Float32BufferAttribute(positions,3));
    geometry.setAttribute("uv",new T.Float32BufferAttribute(coordinates,2));
    skin.geometry=geometry;source.dispose();p=geometry.attributes.position;
    const indices:number[]=[];
    for(let row=0;row<p.count/40-1;row++)for(let i=0;i<40;i++){
      const a=row*40+i,b=row*40+(i+1)%40;indices.push(a,b,a+40,b,b+40,a+40);
    }
    // The depressed section is concave. Close both ends along the actual
    // contour rather than spanning the electrical cavity with a convex fan.
    for(const [start,side]of[[0,-1],[p.count-40,1]]){
      const contour=Array.from({length:40},(_,i)=>new T.Vector2(p.getY(start+i),p.getZ(start+i)));
      for(const triangle of T.ShapeUtils.triangulateShape(contour,[])){
        const [a,b,c]=triangle.map(i=>new T.Vector3().fromBufferAttribute(p,start+i));
        if(b.sub(a).cross(c.sub(a)).x*side<0)triangle.reverse();
        indices.push(...triangle.map(i=>start+i));
      }
    }
    skin.geometry.setIndex(indices);
    skin.geometry.computeVertexNormals();
  }
  // A closed 2 mm laminate belongs to the tub, independent of the hydraulic
  // system. Make it before drilling the shared service passages through it.
  {
    const pan=root.getObjectByName("Lower chassis enclosure") as T.Mesh;
    const outer=pan.geometry,inner=outer.clone(),p=inner.attributes.position,n=inner.attributes.normal;
    for(let i=0;i<p.count;i++)p.setXYZ(i,p.getX(i)-n.getX(i)*.002,p.getY(i)-n.getY(i)*.002,p.getZ(i)-n.getZ(i)*.002);
    const index=inner.index!;
    for(let i=0;i<index.count;i+=3){const a=index.getX(i);index.setX(i,index.getX(i+2));index.setX(i+2,a);}
    inner.computeVertexNormals();pan.geometry=mergeGeometries([outer,inner]);outer.dispose();inner.dispose();
  }
  loft("monocoque","Front suspension keel",[[.50,.195,.49,.18],[.72,.195,.55,.205],[.85,.19,.448,.198],[1.04,.18,.446,.17]],mat.carbon,{cover:true,structural:true},3.0);
  box("monocoque","Front bulkhead",[1.790,.285,0],[.018,.240,.230],mat.carbon);
  // The front suspension hardpoints belong to the survival cell. Previously
  // the cell stopped behind them and the links were seated on removable skin.
  // Continue the structural tub beneath the nose fairing, placing the removable
  // crash structure ahead of the hardpoints. This is an illustrative layout.
  loft("monocoque","Forward survival cell deck",[
    [.735,.46,.598,.151],[.79,.18,.625,.192],[.85,.175,.655,.207],
    [.92,.17,.625,.194],[1.02,.18,.583,.174],[1.049,.18,.58,.17],
    [1.24,.18,.575,.170],[1.48,.17,.540,.156],[1.68,.15,.485,.144],[1.80,.14,.430,.133],
  ],mat.carbon,{structural:true},2.8);
  {
    // A recessed suspension bay, rather than a solid roof over the dampers.
    // Keep the surrounding tub and all hardpoints; remove just its access lid
    // with the bodywork. The tray supports the existing inboard bracket feet.
    const cell=root.getObjectByName("Forward survival cell deck") as T.Mesh;
    const source=cell.geometry,p=source.attributes.position,index=source.index!;
    const points=Array.from({length:p.count},(_,i)=>new T.Vector3().fromBufferAttribute(p,i));
    const kept:number[]=[],removed:number[]=[],edgeCounts=new Map<string,{a:number;b:number;count:number}>();
    for(let i=0;i<index.count;i+=3){
      const triangle=[index.getX(i),index.getX(i+1),index.getX(i+2)];
      const rings=triangle.map(v=>Math.floor(v/40)),columns=triangle.map(v=>v%40);
      const x=triangle.reduce((sum,v)=>sum+points[v].x,0)/3;
      const roof=columns.every(c=>c<=7||c>=33);
      if(Math.min(...rings)!==Math.max(...rings)&&x>.88&&x<1.33&&roof){
        removed.push(...triangle);
        for(let j=0;j<3;j++){
          const a=triangle[j],b=triangle[(j+1)%3],key=a<b?`${a}/${b}`:`${b}/${a}`;
          const entry=edgeCounts.get(key);if(entry)entry.count++;else edgeCounts.set(key,{a,b,count:1});
        }
      }else kept.push(...triangle);
    }
    const boundaryEdges=[...edgeCounts.values()].filter(edge=>edge.count===1);
    const next=new Map(boundaryEdges.map(edge=>[edge.a,edge.b])),boundary=[boundaryEdges[0].a];
    for(let i=1;i<boundaryEdges.length;i++)boundary.push(next.get(boundary.at(-1)!)!);
    const vertices=[...new Set(removed)],local=new Map(vertices.map((v,i)=>[v,i]));
    const cover=laminate(vertices.map(v=>points[v]),removed.map(v=>local.get(v)!),boundary.map(v=>local.get(v)!),.006);
    mesh("bodywork","Front suspension access cover",cover,mat.carbon,[0,0,0],{cover:true});
    const tray=new Map(vertices.map((v,i)=>[v,points.length+i]));
    const floorPoints=vertices.map(v=>new T.Vector3(points[v].x,.457+.008*T.MathUtils.smoothstep(points[v].x,.90,1.19),points[v].z));
    kept.push(...removed.map(v=>tray.get(v)!));
    for(const {a,b} of boundaryEdges)kept.push(a,b,tray.get(a)!,b,tray.get(b)!,tray.get(a)!);
    const geometry=new T.BufferGeometry();geometry.setAttribute("position",new T.Float32BufferAttribute([...points,...floorPoints].flatMap(v=>v.toArray()),3));geometry.setIndex(kept);geometry.computeVertexNormals();
    cell.geometry=geometry;source.dispose();
  }
  // The nose remains a replaceable crash structure. Its seating profile is
  // identical to the survival-cell face, with recessed attachment hardware.
  for(const side of[-1,1])for(const y of[.21,.36]){
    cylinder("impact",`Front impact fixing ${side} ${y}`,[1.779,y,side*.085],[1.815,y,side*.085],.009,mat.darkMetal);
    annulus("monocoque",`Front impact insert ${side} ${y}`,[1.778,y,side*.085],[1.797,y,side*.085],.009,.015,mat.metal);
  }
  // The fuel-cell partition follows the reclined seat instead of bisecting
  // the tank with a vertical solid block. The lower edge seats in the tub tray.
  const fuelPartition = new T.Shape([
    new T.Vector2(.099,.087),new T.Vector2(.099,.396),new T.Vector2(.025,.500),
    new T.Vector2(-.075,.550),new T.Vector2(-.090,.585),new T.Vector2(-.098,.585),
    new T.Vector2(-.081,.545),new T.Vector2(.019,.494),new T.Vector2(.091,.392),new T.Vector2(.091,.087),
  ]);
  const partitionGeometry = new T.ExtrudeGeometry(fuelPartition,{depth:.390,bevelEnabled:false});
  partitionGeometry.translate(0,0,-.195);
  mesh("monocoque","Rear cockpit bulkhead",partitionGeometry,mat.carbon);
  const cockpitEquipment=createCockpit(mat);
  group("cockpit").add(cockpitEquipment.cockpit);
  group("steering").add(cockpitEquipment.wheel);
  for(const side of [-1,1]){
    loft("cockpit",`Cockpit inner lining ${side}`,[[-.08,.24,.625,.027,side*.204],[.12,.18,.625,.025,side*.206],[.34,.18,.613,.024,side*.211],[.56,.23,.603,.028,side*.211],[.75,.35,.59,.023,side*.155]],mat.carbon,{serviceCover:true},3);
    loft("cockpit",`Headrest cushion ${side}`,[[-.105,.54,.666,.054,side*.164],[.015,.55,.658,.053,side*.20],[.155,.54,.642,.042,side*.215]],mat.rubber,{},3.2);
  }
  roundedBox("cockpit","Rear headrest cushion",[-.09,.618,0],[.030,.09,.252],mat.rubber,.010);
  for(const side of[-1,1]){
    roundedBox("cockpit",`Headrest latch ${side}`,[.155,.626,side*.215],[.025,.006,.018],mat.darkMetal,.003);
    cylinder("cockpit",`Headrest latch pin ${side}`,[.155,.624,side*.215],[.155,.634,side*.215],.003,mat.metal);
  }
  fairedRail("cockpit","Cockpit padded rim",[[-.08,.637,-.20],[.15,.638,-.249],[.40,.624,-.249],[.65,.609,-.19],[.735,.600,0],[.65,.609,.19],[.40,.624,.249],[.15,.638,.249],[-.08,.637,.20]],.022,.016,mat.black).userData.serviceCover=true;
  const steeringSystem=createSteeringSystem(mat);group("steering").add(steeringSystem);
  // Side-reference upper/lower contours, rather than a constant round tube.
  // The rear legs flare into the cockpit shoulder; the crown has a broad,
  // shallow aerodynamic section with softly rounded corners.
  const haloStations = [
    [686,119,121,-.235,.003], [698,98,139,-.237,.033], [708,94,132,-.245,.035],
    [720,91,114,-.254,.036], [742,86,102,-.262,.035],
    [771,79,94,-.251,.037], [799,72,88,-.215,.041],
    [819,69,86,-.138,.044], [829,71,89,-.067,.046], [831,72,90,0,.047],
    [829,71,89,.067,.046], [819,69,86,.138,.044],
    [799,72,88,.215,.041], [771,79,94,.251,.037],
    [742,86,102,.262,.035], [720,91,114,.254,.036],
    [708,94,132,.245,.035], [698,98,139,.237,.033], [686,119,121,.235,.003],
  ];
  const haloCurve=new T.CatmullRomCurve3(haloStations.map(([x,top,bottom,z])=>new T.Vector3(...referencePoint(x,(top+bottom)/2,z))),false,"catmullrom",.35);
  const haloPoints:number[]=[],haloIndices:number[]=[],haloSegments=160,haloRadial=20;
  for(let ring=0;ring<=haloSegments;ring++){
    const t=ring/haloSegments,station=t*(haloStations.length-1),i=Math.min(haloStations.length-2,Math.floor(station)),u=station-i;
    const mix=(k:number)=>T.MathUtils.lerp(haloStations[i][k],haloStations[i+1][k],u);
    const centre=haloCurve.getPoint(t),tangent=haloCurve.getTangent(t);
    // Keep the photographed vertical contour independent of the path slope.
    const across=new T.Vector3(tangent.z,0,-tangent.x).normalize();
    const halfHeight=(mix(2)-mix(1))*W17_SCALE/2,halfWidth=mix(4);
    for(let j=0;j<haloRadial;j++){
      const angle=j/haloRadial*Math.PI*2,c=Math.cos(angle),h=Math.sin(angle);
      const v=centre.clone().addScaledVector(across,Math.sign(c)*Math.abs(c)**.72*halfWidth);
      v.y+=(Math.sign(h)*Math.abs(h)**.72)*halfHeight;haloPoints.push(...v.toArray());
    }
  }
  for(let ring=0;ring<haloSegments;ring++)for(let j=0;j<haloRadial;j++){
    const a=ring*haloRadial+j,b=ring*haloRadial+(j+1)%haloRadial;
    haloIndices.push(a,b,a+haloRadial,b,b+haloRadial,a+haloRadial);
  }
  for(let j=1;j<haloRadial-1;j++){
    const end=haloSegments*haloRadial;haloIndices.push(0,j+1,j,end,end+j,end+j+1);
  }
  const haloGeometry=new T.BufferGeometry();haloGeometry.setAttribute("position",new T.Float32BufferAttribute(haloPoints,3));haloGeometry.setIndex(haloIndices);haloGeometry.computeVertexNormals();
  mesh("halo","Halo aerodynamic fairing",haloGeometry,mat.carbon);
  const haloPylonSections:Section[]=[
    [817,86,70,.021],[832,98,74,.031],[850,111,84,.027],
    [870,121,102,.018],
  ].map(([px,bottom,top,width])=>[(px-665)*W17_SCALE,(307-bottom)*W17_SCALE,(307-top)*W17_SCALE,width] as Section);
  // The fairing widens into a foot and enters the structural deck. Its old
  // rounded end merely touched a second rounded shoe, leaving an open seam.
  haloPylonSections.push([.807,.630,.691,.025],[.835,.632,.676,.030],[.858,.629,.664,.032],[.868,.625,.646,.024],[.877,.620,.632,.010]);
  loft("halo","Halo front pylon",haloPylonSections,mat.carbon,{},3.0);
  for(const side of [-1,1]){
    // Recessed attachment shoe, enclosed by the widened rear fairing.
    roundedBox("halo",`Halo mount ${side}`,referencePoint(701,134,side*.237),[.060,.023,.043],mat.darkMetal,.004);
    loft("monocoque",`Halo rear attachment ${side}`,[
      [.065,.555,.604,.029,side*.237],[.108,.55,.635,.035,side*.237],
      [.155,.55,.635,.035,side*.237],[.185,.555,.614,.027,side*.237],
    ],mat.carbon,{structural:true},3);
    loft("monocoque",`Roll hoop attachment ${side}`,[
      [-.225,.43,.575,.027,side*.14],[-.17,.38,.590,.037,side*.14],[-.078,.35,.60,.043,side*.14],
    ],mat.carbon,{structural:true},3);
    cylinder("halo",`Halo rear mounting bolt ${side}`,[.130,.610,side*.237],[.130,.636,side*.237],.006,mat.metal);
    // Slender fore-aft blades follow the two visible inlet partitions. The
    // former round A-frame crossed the airflow and met at an exposed apex.
    // Hidden section sizes and root geometry are an illustrative load path.
    const sections=[
      [.565,-.20,.140,.030,.020],[.63,-.195,.132,.032,.017],
      [.74,-.18,.112,.035,.012],[.82,-.23,.075,.039,.007],
      [.868,-.258,.050,.043,.0038],[.90,-.225,.043,.043,.0038],
      [.94,-.20,.035,.043,.0038],[.978,-.18,.027,.042,.0045],
      [.985,-.178,.026,.040,.005],
    ],radial=32,vertices:number[]=[],indices:number[]=[];
    for(const [y,x,z,depth,width]of sections)for(let j=0;j<radial;j++){
      const angle=j*Math.PI*2/radial;vertices.push(x+Math.cos(angle)*depth,y,side*z+Math.sin(angle)*width);
    }
    for(let row=0;row<sections.length-1;row++)for(let j=0;j<radial;j++){
      const a=row*radial+j,b=row*radial+(j+1)%radial;indices.push(a,a+radial,b,b,a+radial,b+radial);
    }
    for(const row of[0,sections.length-1]){
      const [y,x,z]=sections[row],centre=vertices.length/3;vertices.push(x,y,side*z);
      for(let j=0;j<radial;j++){const a=row*radial+j,b=row*radial+(j+1)%radial;if(row)indices.push(centre,b,a);else indices.push(centre,a,b);}
    }
    const blade=new T.BufferGeometry();blade.setAttribute("position",new T.Float32BufferAttribute(vertices,3));blade.setIndex(indices);blade.computeVertexNormals();
    mesh("halo",`Roll hoop ${side}`,blade,mat.carbon);
  }
  roundedBox("halo","Roll hoop upper bridge",[-.178,.981,0],[.080,.012,.062],mat.carbon,.004);
  roundedBox("halo","Halo front attachment shoe",[.850,.632,0],[.050,.015,.050],mat.darkMetal,.003);
  for(const z of[-.020,.020])cylinder("halo",`Halo front fixing ${z}`,[.852,.620,z],[.852,.643,z],.004,mat.metal);
  // One continuous outer surface joins the engine spine, downwash shoulders
  // and undercut sidepods. Separate overlapping shells caused false creases.
  // KA 12's planform, checked against KA 7, retains a fuller aft shoulder.
  // Widen the aft shoulder sections progressively, leaving the inlet, spine
  // heights and the two terminal heat-shield sections at their existing datums.
  bodyShell("Continuous undercut sidepod shell",[
    [208,167,220,244,266,.062,.061,.054,.009,168,.025,177,180],
    [270,128,214,244,265,.14,.12,.09,.014,132,.06,164,172],
    [320,114,209,238,266,.30,.19,.15,.020,118,.155,157,165],
    [420,82,194,231,270,.45,.31,.23,.030,87,.23,143,154],
    [510,49,178,226,274,.53,.37,.26,.036,54,.24,128,145],
    [590,31,162,224,275,.60,.40,.27,.074,34,.24,114,135],
    [632,88,154,222,274,.635,.42,.29,.096,91,.24,111,134],
    [645,92,152,220,272,.64,.42,.29,.10,95,.242,112,134],
    [663,254,148,217,270,.645,.42,.29,.229,99,.30,124,136],
    [690,257,147,215,270,.65,.43,.29,.229,97,.31,126,138],
    [712,260,143,216,269,.66,.43,.28,.235,113,.33,132,140],
    [740,264,140,214,269,.665,.44,.28,.24,140,.35,141,140],
    [780,263,138,211,267,.66,.44,.28,.24,140,.35,139,138],
    [806,246,140,207,250,.645,.40,.245,.245,144,.36,141,140],
    [813,223,142,200,227,.61,.38,.22,.245,146,.37,141.5,140.5],
  ]);
  // The sidepod mouth overhangs a receding undercut. The photographed W17
  // does not have a vertical curtain from the intake lip down to the floor.
  for(const part of group("bodywork").children){
    if(!(part instanceof T.Mesh)||!(/sidepod/i.test(part.name)))continue;
    const p=part.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),y=p.getY(i),blend=T.MathUtils.clamp((x-.25)/.285,0,1);
      p.setX(i,x+blend*blend*(.045-.16*T.MathUtils.clamp((.54-y)/.28,0,1)));
    }
    part.geometry.computeVertexNormals();
  }
  // Loft the floor shoulder directly from the sidepod's lower edge. The two
  // selectable parts share the boundary, so the assembled silhouette has no slot.
  const sidepod=root.getObjectByName("Continuous undercut sidepod shell") as T.Mesh;
  const shellPoints=sidepod.geometry.attributes.position,shellRings=sidepod.userData.shellRings as number;
  const reliefBand=(value:number,start:number,fullStart:number,fullEnd:number,end:number)=>
    T.MathUtils.smoothstep(value,start,fullStart)*(1-T.MathUtils.smoothstep(value,fullEnd,end));
  // Continue the engine-cover ridge down to the outlet in one descending line.
  // The rear reference station was too low, producing a dip before the shield.
  const tailRoof=(x:number)=>.518+(x+1.98)*.246;
  const shellTopHeights=Array.from({length:shellRings},(_,ring)=>shellPoints.getY(ring*64));
  // Leave a real cavity behind the separate roll-hoop inlet. The old engine
  // cover occupied this space, forcing a black disc in front of the opening.
  for(let i=0;i<shellPoints.count;i++){
    if(shellPoints.getX(i)>-.211&&shellPoints.getX(i)<.05&&Math.abs(shellPoints.getZ(i))<.137&&shellPoints.getY(i)>.847)shellPoints.setY(i,.847);
    const x=shellPoints.getX(i);
    if(x<-1.23&&Math.abs(shellPoints.getZ(i))>.08)shellPoints.setY(i,Math.max(shellPoints.getY(i),diffuserHeightAt(x)+.010));
    // Local packaging relief for the tailpipe, rear primary, motor coolant
    // return and radiator ears. Fade into the shape before the floor seam and
    // inlet; widening the complete sidepod would change their silhouettes.
    const y=shellPoints.getY(i),z=shellPoints.getZ(i);
    const relief=.022*reliefBand(x,-1.12,-.94,-.70,-.52)*reliefBand(y,.12,.25,.40,.58)
      +.007*reliefBand(x,-.57,-.47,-.36,-.27)*reliefBand(y,.17,.21,.29,.35)
      +.005*reliefBand(x,-.35,-.29,-.19,-.10)*reliefBand(y,.42,.45,.50,.55);
    shellPoints.setZ(i,z+Math.sign(z)*relief);
    // Match the upper rear body to the heat shield's rounded section before
    // tapering into the engine cover. A local width bump left the shield's
    // roof and shoulders standing proud of the much narrower silver skin.
    const rounding=1-T.MathUtils.smoothstep(x,-1.61,-1.37);
    const tailBlend=rounding*T.MathUtils.smoothstep(y,.26,.35);
    if(tailBlend){
      const dy=y-.43,dz=shellPoints.getZ(i);
      const radius=Math.cbrt(Math.abs(dy/.12)**3+Math.abs(dz/.13)**3);
      const scale=1/radius+.001/Math.hypot(dy,dz);
      shellPoints.setY(i,T.MathUtils.lerp(y,.43+dy*scale,tailBlend));
      shellPoints.setZ(i,T.MathUtils.lerp(dz,Math.sign(dz)*Math.max(Math.abs(dz),Math.abs(dz*scale)),tailBlend));
    }
    if(x<-1.20&&shellPoints.getY(i)>.31){
      // Raise the roof without narrowing the forward shoulders or moving their
      // suspension/cable clearances. Stretch above the existing lower waist.
      const originalTop=shellTopHeights[Math.floor(i/64)],roundedTop=T.MathUtils.lerp(originalTop,.551,rounding);
      const desiredTop=T.MathUtils.lerp(originalTop,Math.max(originalTop,tailRoof(x)+.001),1-T.MathUtils.smoothstep(x,-1.44,-1.20));
      shellPoints.setY(i,.31+(shellPoints.getY(i)-.31)*(desiredTop-.31)/(roundedTop-.31));
    }
  }
  for(const side of [-1,1]){
    const positions:number[]=[],indices:number[]=[],across=16;
    for(let ring=0;ring<shellRings;ring++){
      const start=new T.Vector3().fromBufferAttribute(shellPoints,ring*64+(side>0?27:37));
      const next=new T.Vector3().fromBufferAttribute(shellPoints,ring*64+(side>0?28:36));
      const outer=widthAt(start.x)-.010;
      const tangent=next.clone().sub(start).multiplyScalar(1.4);
      const curve=new T.CubicBezierCurve3(start,start.clone().add(tangent),new T.Vector3(start.x,.080,side*(outer-.13)),new T.Vector3(start.x,.077,side*outer));
      for(let j=0;j<=across;j++){
        const point=curve.getPoint(j/across);
        // The side reference has a raised, rounded shoulder ahead of the rear
        // tyre. Keep both seam tangents and the thin outer floor edge intact.
        const rise=1-T.MathUtils.smoothstep(point.x,-1.52,-.85);
        point.y+=.076*rise*Math.sin(Math.PI*(j/across)**1.5)**2;
        if(point.x<-1.23)point.y=Math.max(point.y,diffuserHeightAt(point.x)+.010);
        positions.push(...point.toArray());
      }
    }
    // Continue the raised leading edge into the floor itself. A thin cap on
    // this arch left an open triangle underneath when viewed from the nose.
    // Each transverse point rolls over the crest, then lands horizontally
    // inside the floor skin; these are shared rows of the same shoulder mesh.
    const frontRows=24,floorRings=shellRings+frontRows,frontCurves:T.CubicBezierCurve3[]=[];
    for(let j=0;j<=across;j++){
      const start=new T.Vector3().fromArray(positions,((shellRings-1)*(across+1)+j)*3);
      const previous=new T.Vector3().fromArray(positions,((shellRings-2)*(across+1)+j)*3);
      const tangent=start.clone().sub(previous).normalize();
      // Retain the floor landing after lowering the inlet's inner return.
      const advance=T.MathUtils.lerp(.427,.167,j/across);
      const foot=new T.Vector3(start.x+advance,.075,start.z);
      frontCurves.push(new T.CubicBezierCurve3(start,start.clone().addScaledVector(tangent,.035),new T.Vector3(foot.x-advance*.42,foot.y,foot.z),foot));
    }
    for(let ring=1;ring<=frontRows;ring++)for(const curve of frontCurves)positions.push(...curve.getPoint(ring/frontRows).toArray());
    const face=(a:number,b:number,c:number)=>{if(side>0)indices.push(a,b,c);else indices.push(a,c,b);};
    for(let i=0;i<floorRings-1;i++)for(let j=0;j<across;j++){
      const a=i*(across+1)+j,b=a+1,c=a+across+1,d=c+1;
      face(a,b,c);face(b,d,c);
    }
    const upper=new T.BufferGeometry();upper.setAttribute("position",new T.Float32BufferAttribute(positions,3));upper.setIndex([...indices]);upper.computeVertexNormals();
    const points=upper.attributes.position,surfaceNormals=upper.attributes.normal,count=points.count;
    for(let ring=0;ring<shellRings;ring++){
      const before=new T.Vector3().fromBufferAttribute(shellPoints,ring*64+(side>0?26:38));
      const after=new T.Vector3().fromBufferAttribute(points,ring*17+1);
      const previous=new T.Vector3().fromBufferAttribute(points,Math.max(0,ring-1)*17);
      const next=new T.Vector3().fromBufferAttribute(points,Math.min(shellRings-1,ring+1)*17);
      const normal=after.sub(before).cross(next.sub(previous)).multiplyScalar(side).normalize();
      surfaceNormals.setXYZ(ring*17,normal.x,normal.y,normal.z);
    }
    // Thickness follows the inward surface normal. A vertical extrusion left a
    // 4 mm high outward-facing lip where the undercut slopes back into the car.
    for(let i=0;i<count;i++)positions.push(points.getX(i)-surfaceNormals.getX(i)*.004,points.getY(i)-surfaceNormals.getY(i)*.004,points.getZ(i)-surfaceNormals.getZ(i)*.004);
    const boundary=new Map<string,{a:number;b:number;uses:number}>(),upperIndex=[...indices];
    for(let i=0;i<upperIndex.length;i+=3){
      const [a,b,c]=upperIndex.slice(i,i+3);indices.push(a+count,c+count,b+count);
      for(const [from,to] of [[a,b],[b,c],[c,a]]){
        const key=`${Math.min(from,to)}/${Math.max(from,to)}`,edge=boundary.get(key);
        if(edge)edge.uses++;else boundary.set(key,{a:from,b:to,uses:1});
      }
    }
    // Separate cap vertices keep the laminate edge from flattening the smooth
    // outer normals. Opposite boundary winding closes both mirrored shoulders.
    for(const {a,b,uses} of boundary.values())if(uses===1){
      const start=positions.length/3;
      for(const index of [b,a,a+count,b+count])positions.push(positions[index*3],positions[index*3+1],positions[index*3+2]);
      indices.push(start,start+1,start+2,start,start+2,start+3);
    }
    const geometry=new T.BufferGeometry();geometry.setAttribute("position",new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    const normals=geometry.attributes.normal;
    for(let i=0;i<count;i++){
      normals.setXYZ(i,surfaceNormals.getX(i),surfaceNormals.getY(i),surfaceNormals.getZ(i));
      normals.setXYZ(i+count,-surfaceNormals.getX(i),-surfaceNormals.getY(i),-surfaceNormals.getZ(i));
    }
    upper.dispose();
    mesh("floor",`Sculpted floor shoulder ${side}`,geometry,mat.carbon);
    // The shoulder's inboard edge needs a return down to the floor. Without
    // it, the inlet channel looked straight through the open lower body to
    // the rear suspension. Join the inner laminate edge, preserving the
    // existing exterior body/shoulder seam. Follow the rounded leading
    // extension as well, so its inboard edge cannot open another slit.
    const returnPoints:T.Vector3[]=[],returnIndices:number[]=[],returnAcross=8;
    for(let ring=0;ring<floorRings;ring++){
      const start=new T.Vector3().fromBufferAttribute(geometry.attributes.position,count+ring*(across+1));
      const bottom=start.x<-1.23?diffuserHeightAt(start.x)+.003:.074;
      const foot=new T.Vector3(start.x,bottom,side*Math.max(.035,Math.abs(start.z)-.075));
      const curve=new T.CubicBezierCurve3(start,new T.Vector3(start.x,T.MathUtils.lerp(start.y,bottom,.60),start.z),new T.Vector3(start.x,bottom,foot.z+side*.035),foot);
      for(let j=0;j<=returnAcross;j++)returnPoints.push(curve.getPoint(j/returnAcross));
    }
    for(let ring=0;ring<floorRings-1;ring++)for(let j=0;j<returnAcross;j++){
      const a=ring*(returnAcross+1)+j,b=a+1,c=a+returnAcross+1,d=c+1;
      if(side>0)returnIndices.push(a,b,c,b,d,c);else returnIndices.push(a,c,b,b,c,d);
    }
    const perimeter=[...Array.from({length:returnAcross+1},(_,j)=>j),...Array.from({length:floorRings-1},(_,i)=>(i+1)*(returnAcross+1)+returnAcross),...Array.from({length:returnAcross},(_,j)=>(floorRings-1)*(returnAcross+1)+returnAcross-1-j),...Array.from({length:floorRings-2},(_,i)=>(floorRings-2-i)*(returnAcross+1))];
    if(side<0)perimeter.reverse();
    mesh("floor",`Inner floor return ${side}`,laminate(returnPoints,returnIndices,perimeter,.004),mat.carbon);
  }
  // The removable bodywork is a laminate, not a solid block with a second floor
  // across the engine bay. Keep its exterior and inlet caps, open the underside
  // at the shared floor boundary, then add the inner skin and edge thickness.
  const outerIndices:number[]=[];
  for(let ring=0;ring<shellRings-1;ring++)for(let j=0;j<64;j++){
    if(j>=27&&j<37)continue;
    const a=ring*64+j,b=ring*64+(j+1)%64;
    // The cockpit floor belongs to the survival cell. The loft's recessed
    // centre was a second body panel passing through the under-seat services.
    if([a,b,a+64,b+64].every(i=>shellPoints.getX(i)>-.20&&shellPoints.getX(i)<.60&&shellPoints.getY(i)<(shellPoints.getX(i)<.11?.64:.26)&&Math.abs(shellPoints.getZ(i))<.218))continue;
    outerIndices.push(a,b,a+64,b,b+64,a+64);
  }
  // Keep the shaped front cap and its inlet holes. The rear edge opens into
  // the tail cooling cavity: a cap here is a false bulkhead across the engine
  // bay. The laminate builder below returns the material around this open rim.
  const endCaps=sidepod.geometry.index!.array.slice((shellRings-1)*64*6);
  for(let i=0;i<endCaps.length;i+=3){
    const face=Array.from(endCaps.slice(i,i+3));
    if(!face.every(index=>index<64))outerIndices.push(...face);
  }
  sidepod.geometry.setIndex(outerIndices);
  sidepod.geometry.computeVertexNormals();
  // The removable body and floor remain separate selectable solids, but their
  // visible surfaces share a tangent at the seam. Hidden closure faces must not
  // flatten the normal there or the join reads as a detached ledge.
  const bodyNormals=sidepod.geometry.attributes.normal;
  for(let i=0;i<64;i++){
    const x=shellPoints.getX(i),y=shellPoints.getY(i),z=shellPoints.getZ(i);
    if(y<.35)continue;
    // Retain the prescribed outer tangent at the open, flush tail seam.
    const centre=(tailRoof(x)+.31)/2,halfHeight=(tailRoof(x)-.31)/2,dy=(y-centre)/halfHeight;
    const normal=new T.Vector3(-.123*Math.sign(dy)*dy*dy*(1+dy)/halfHeight,Math.sign(dy)*dy*dy/halfHeight,Math.sign(z)*z*z/.13**3).normalize();
    bodyNormals.setXYZ(i,normal.x,normal.y,normal.z);
  }
  for(const side of [-1,1]){
    const shoulder=root.getObjectByName(`Sculpted floor shoulder ${side}`) as T.Mesh;
    const points=shoulder.geometry.attributes.position,normals=shoulder.geometry.attributes.normal;
    for(let ring=0;ring<shellRings;ring++){
      const before=new T.Vector3().fromBufferAttribute(shellPoints,ring*64+(side>0?26:38));
      const after=new T.Vector3().fromBufferAttribute(points,ring*17+1);
      const previous=new T.Vector3().fromBufferAttribute(points,Math.max(0,ring-1)*17);
      const next=new T.Vector3().fromBufferAttribute(points,Math.min(shellRings-1,ring+1)*17);
      const normal=after.sub(before).cross(next.sub(previous)).multiplyScalar(side).normalize();
      bodyNormals.setXYZ(ring*64+(side>0?27:37),normal.x,normal.y,normal.z);
      normals.setXYZ(ring*17,normal.x,normal.y,normal.z);
    }
  }
  // Compact away the discarded underbody vertices so bounds and intersection
  // checks describe only real surfaces. Retain explicit seam indices for audits.
  const used=[...new Set(outerIndices)],remap=new Map(used.map((index,i)=>[index,i]));
  let exteriorPositions=used.flatMap(i=>[shellPoints.getX(i),shellPoints.getY(i),shellPoints.getZ(i)]);
  let exteriorNormals=used.flatMap(i=>[bodyNormals.getX(i),bodyNormals.getY(i),bodyNormals.getZ(i)]);
  let exteriorIndex=outerIndices.map(i=>remap.get(i)!);
  // Clip the service openings in the exterior before adding laminate thickness.
  // Building its return from this boundary avoids intersecting folded cap skins.
  {
    const key=(x:number,y:number,z:number)=>[x,y,z].map(v=>Math.round(v*1e6)).join();
    const original=new Map(used.map((raw,i)=>[key(...exteriorPositions.slice(i*3,i*3+3) as V),{raw,position:exteriorPositions.slice(i*3,i*3+3) as V,normal:exteriorNormals.slice(i*3,i*3+3)}]));
    const g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(exteriorPositions,3));g.setIndex(exteriorIndex);
    const skin=new T.Mesh(g);
    // Trim the rear cockpit lip at the headrest instead of retaining complete
    // grid triangles below it. Those partial rows formed pointed silver teeth
    // through the cushions. Clip the open skin before adding its laminate.
    const cockpitPlanes=[
      new T.Plane(new T.Vector3(1,0,0),.20),new T.Plane(new T.Vector3(-1,0,0),.11),
      new T.Plane(new T.Vector3(0,1,0),.10),new T.Plane(new T.Vector3(0,-1,0),.668),
      new T.Plane(new T.Vector3(0,0,1),.218),new T.Plane(new T.Vector3(0,0,-1),.218),
    ];
    const clipped:T.Vector3[][]=[],sourcePoints=g.attributes.position,sourceFaces=g.index!;
    for(let i=0;i<sourceFaces.count;i+=3){
      let inside=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(sourcePoints,sourceFaces.getX(i+j)));
      if(cockpitPlanes.some(plane=>inside.every(p=>plane.distanceToPoint(p)<-1e-9))){clipped.push(inside);continue;}
      for(const plane of cockpitPlanes){
        const next:T.Vector3[]=[],outside:T.Vector3[]=[];
        for(let j=0;j<inside.length;j++){
          const a=inside[j],b=inside[(j+1)%inside.length],da=plane.distanceToPoint(a),db=plane.distanceToPoint(b);
          if(da>=-1e-9)next.push(a);if(da<=1e-9)outside.push(a);
          if(da*db< -1e-18){const cut=a.clone().lerp(b,da/(da-db));next.push(cut);outside.push(cut);}
        }
        if(outside.length>=3)clipped.push(outside);
        inside=next;if(inside.length<3)break;
      }
    }
    // Adjacent faces can meet different clipping planes. Split their shared
    // edges at the same rim points so the finished laminate stays watertight.
    const rims=cockpitPlanes.map(plane=>{
      const points=new Map<string,T.Vector3>();
      for(const polygon of clipped)for(const p of polygon)if(Math.abs(plane.distanceToPoint(p))<1e-8)points.set(key(p.x,p.y,p.z),p);
      return [...points.values()];
    });
    const lipPoints:number[]=[],lipFaces:number[]=[];
    for(const polygon of clipped){
      const boundary:T.Vector3[]=[];
      for(let j=0;j<polygon.length;j++){
        const a=polygon[j],b=polygon[(j+1)%polygon.length],delta=b.clone().sub(a),length=delta.lengthSq();
        if(length<1e-18)continue;
        const stops=[{t:0,p:a}],plane=cockpitPlanes.findIndex(plane=>Math.abs(plane.distanceToPoint(a))<1e-8&&Math.abs(plane.distanceToPoint(b))<1e-8);
        if(plane!==-1)for(const p of rims[plane]){
          const t=p.clone().sub(a).dot(delta)/length;
          if(t>1e-7&&t<1-1e-7&&a.clone().addScaledVector(delta,t).distanceToSquared(p)<1e-14)stops.push({t,p});
        }
        stops.sort((a,b)=>a.t-b.t);
        for(let k=0;k<stops.length;k++)if(k===0||stops[k].p.distanceToSquared(stops[k-1].p)>1e-16)boundary.push(stops[k].p);
      }
      if(boundary.length<3)continue;
      const start=lipPoints.length/3;
      if(boundary.length===3){lipPoints.push(...boundary.flatMap(p=>p.toArray()));lipFaces.push(start,start+1,start+2);}
      else{
        const centre=boundary.reduce((sum,p)=>sum.add(p),new T.Vector3()).divideScalar(boundary.length);
        lipPoints.push(...centre.toArray(),...boundary.flatMap(p=>p.toArray()));
        for(let j=0;j<boundary.length;j++)lipFaces.push(start,start+1+j,start+1+(j+1)%boundary.length);
      }
    }
    const lip=new T.BufferGeometry();lip.setAttribute("position",new T.Float32BufferAttribute(lipPoints,3));lip.setIndex(lipFaces);
    skin.geometry=mergeVertices(lip,1e-7);lip.dispose();g.dispose();
    skin.geometry.rotateY(Math.PI/2);
    openRadialPort(skin,[0,.49],.046,1,1.44,false);skin.geometry.rotateY(-Math.PI/2);
    // Open the front of the engine spine behind the inlet. The old uncut skin
    // formed a silver wall across the airbox, just ahead of its dark throat.
    const airboxScale=.087/.057;
    skin.geometry.translate(0,-.933,0);skin.geometry.scale(1,airboxScale,1);skin.geometry.rotateY(Math.PI/2);
    openRadialPort(skin,[0,0],.087,-1,.32,false);
    skin.geometry.rotateY(-Math.PI/2);skin.geometry.scale(1,1/airboxScale,1);skin.geometry.translate(0,.933,0);skin.geometry.computeVertexNormals();
    sidepod.userData.firePortSides=prepareFireBodyPorts(skin);
    sidepod.userData.lsdPassages=prepareDifferentialBodyPorts(skin);
    const p=skin.geometry.attributes.position,n=skin.geometry.attributes.normal;
    for(let i=0;i<p.count;i++){
      let old=original.get(key(p.getX(i),p.getY(i),p.getZ(i)));
      // Float32 projection through the elliptical cut can cross a quantisation
      // boundary. Reattach unchanged vertices and seam indices by proximity.
      if(!old){
        const cell=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e6));
        search:for(const dx of[-1,0,1])for(const dy of[-1,0,1])for(const dz of[-1,0,1]){
          const candidate=original.get([cell[0]+dx,cell[1]+dy,cell[2]+dz].join());
          if(candidate&&Math.hypot(candidate.position[0]-p.getX(i),candidate.position[1]-p.getY(i),candidate.position[2]-p.getZ(i))<2e-7){old=candidate;break search;}
        }
      }
      if(old){remap.set(old.raw,i);p.setXYZ(i,...old.position);n.setXYZ(i,...old.normal as V);}
    }
    exteriorPositions=Array.from(p.array);exteriorNormals=Array.from(n.array);exteriorIndex=Array.from(skin.geometry.index!.array);skin.geometry.dispose();
  }
  const thickness=.0025,innerPositions=[...exteriorPositions],innerIndices:number[]=[],count=exteriorPositions.length/3;
  for(let i=0;i<count;i++){
    const outer=new T.Vector3().fromArray(exteriorPositions,i*3),normal=new T.Vector3().fromArray(exteriorNormals,i*3),inner=outer.clone().addScaledVector(normal,-thickness);
    for(const passage of sidepod.userData.lsdPassages as ReturnType<typeof prepareDifferentialBodyPorts>){
      const axis=new T.Vector3(...passage.axis),delta=outer.clone().sub(new T.Vector3(...passage.point)),along=delta.dot(axis),radial=delta.addScaledVector(axis,-along).length(),dot=normal.dot(axis);
      // Keep the service bore coaxial while preserving normal wall thickness.
      if(Math.abs(along)<.02&&Math.abs(radial-passage.radius)<.00004&&Math.abs(dot)>.25)inner.copy(outer).addScaledVector(axis,-thickness/dot);
    }
    innerPositions.push(...inner.toArray());
  }
  const edges=new Map<string,{a:number;b:number;count:number}>();
  for(let i=0;i<exteriorIndex.length;i+=3){
    const [a,b,c]=exteriorIndex.slice(i,i+3);innerIndices.push(a+count,c+count,b+count);
    for(const [from,to] of [[a,b],[b,c],[c,a]]){const key=`${Math.min(from,to)}/${Math.max(from,to)}`,edge=edges.get(key);if(edge)edge.count++;else edges.set(key,{a:from,b:to,count:1});}
  }
  for(const {a,b,count:uses} of edges.values())if(uses===1)innerIndices.push(a,b+count,b,a,a+count,b+count);
  const innerGeometry=new T.BufferGeometry();innerGeometry.setAttribute("position",new T.Float32BufferAttribute(innerPositions,3));innerGeometry.setIndex(innerIndices);innerGeometry.computeVertexNormals();
  // Unreferenced exterior points are needed only for the narrow edge returns.
  // MergeVertices compacts the indexed inner mesh without changing the surface.
  const compactInner=mergeVertices(innerGeometry,1e-7);innerGeometry.dispose();
  mesh("bodywork","Bodywork inner laminate",compactInner,mat.carbon,[0,0,0],{cover:true});
  sidepod.geometry.setAttribute("position",new T.Float32BufferAttribute(exteriorPositions,3));sidepod.geometry.setAttribute("normal",new T.Float32BufferAttribute(exteriorNormals,3));sidepod.geometry.setIndex(exteriorIndex);
  sidepod.userData.floorSeams=[-1,1].map(side=>Array.from({length:shellRings},(_,ring)=>remap.get(ring*64+(side>0?27:37))!));
  sidepod.userData.laminateThickness=thickness;
  for(const side of [-1,1]){
    // The January launch set shows three slotted outwash blades, not a solid
    // tall board with an inset fascia. Their side silhouettes and swept plan
    // are photo-derived; the hidden mounting details remain reconstructed.
    const boardWidth=(x:number)=>{
      const t=T.MathUtils.clamp((x-.35)/.671,0,1);
      return .692+.128*t+.016*Math.sin(Math.PI*t);
    };
    const boards=[
      {name:"Front floor vane",returnName:"Floor vane leading return",bottom:.232,top:.360,rear:.39,rearBottom:.242,rearTop:.253,shoulder:.625},
      {name:"Middle floor vane",returnName:"Middle floor vane leading return",bottom:.155,top:.222,rear:.35,rearBottom:.150,rearTop:.163,shoulder:.67},
      {name:"Lower floor vane",returnName:"Lower floor vane leading return",bottom:.108,top:.140,rear:.34,rearBottom:.112,rearTop:.122,shoulder:.72},
    ];
    const boardParts:T.Mesh[]=[];
    for(const board of boards){
      const {bottom,top,rear,rearBottom,rearTop,shoulder}=board,shape=new T.Shape();
      shape.moveTo(1.021,top-.004);shape.quadraticCurveTo(1.021,top,1.013,top);
      shape.bezierCurveTo(.91,top,.75,top-.001,shoulder,top-.002);
      shape.bezierCurveTo(shoulder-.055,top-.004,rear+.060,rearTop+.030,rear,rearTop);
      shape.lineTo(rear,rearBottom);
      shape.bezierCurveTo(rear+.12,rearBottom,.86,bottom,1.011,bottom);
      shape.quadraticCurveTo(1.021,bottom,1.021,bottom+.010);shape.closePath();
      // Sample the complete skin before sweeping it. Bending only the sparse
      // triangles of an extruded cap leaves broad diagonal facets in the face.
      const outline=shape.getPoints(48),skin:T.Vector3[]=[],faces:number[]=[],rim:number[]=[],skinRows=96,skinColumns=6;
      for(let row=0;row<=skinRows;row++){
        const x=T.MathUtils.lerp(rear,1.021,row/skinRows),heights:number[]=[];
        for(let i=1;i<outline.length;i++){
          const a=outline[i-1],b=outline[i];
          if(Math.abs(b.x-a.x)<1e-10){if(Math.abs(x-a.x)<1e-8)heights.push(a.y,b.y);continue;}
          const t=(x-a.x)/(b.x-a.x);
          if(t>=-1e-8&&t<=1+1e-8)heights.push(T.MathUtils.lerp(a.y,b.y,T.MathUtils.clamp(t,0,1)));
        }
        const low=Math.min(...heights),high=Math.max(...heights);
        for(let col=0;col<=skinColumns;col++)skin.push(new T.Vector3(x,T.MathUtils.lerp(low,high,col/skinColumns),side*(boardWidth(x)+.002)));
      }
      for(let row=0;row<skinRows;row++)for(let col=0;col<skinColumns;col++){
        const a=row*(skinColumns+1)+col,b=a+1,c=a+skinColumns+1,d=c+1;
        if(side>0)faces.push(a,c,b,b,c,d);else faces.push(a,b,c,b,d,c);
      }
      for(let col=0;col<=skinColumns;col++)rim.push(col);
      for(let row=1;row<=skinRows;row++)rim.push(row*(skinColumns+1)+skinColumns);
      for(let col=skinColumns-1;col>=0;col--)rim.push(skinRows*(skinColumns+1)+col);
      for(let row=skinRows-1;row>0;row--)rim.push(row*(skinColumns+1));
      if(side>0)rim.reverse();
      boardParts.push(mesh("floor",`${board.name} ${side}`,laminate(skin,faces,rim,.004),mat.carbon));

      // Each blade has its own rolled leading edge, leaving both slots open.
      const points:T.Vector3[]=[],indices:number[]=[],boundary:number[]=[],rows=12,columns=20;
      for(let row=0;row<=rows;row++)for(let column=0;column<=columns;column++){
        const y=T.MathUtils.lerp(bottom,top,row/rows),bend=T.MathUtils.clamp((y-bottom)/.010,0,1);
        const x=1.021-.010*(1-bend)**2,angle=column/columns*Math.PI/2;
        points.push(new T.Vector3(x+.042*Math.sin(angle),y,side*(boardWidth(x)+.002-.09*(1-Math.cos(angle)))));
      }
      for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
        const a=row*(columns+1)+column,b=a+columns+1;
        if(side>0)indices.push(a,a+1,b,a+1,b+1,b);else indices.push(a,b,a+1,a+1,b,b+1);
      }
      for(let col=0;col<=columns;col++)boundary.push(col);
      for(let row=1;row<=rows;row++)boundary.push(row*(columns+1)+columns);
      for(let col=columns-1;col>=0;col--)boundary.push(rows*(columns+1)+col);
      for(let row=rows-1;row>0;row--)boundary.push(row*(columns+1));
      if(side<0)boundary.reverse();
      boardParts.push(mesh("floor",`${board.returnName} ${side}`,laminate(points,indices,boundary,.004),mat.carbon));
    }
    const floorRoof=createSurfaceSampler([root.getObjectByName("Carbon floor") as T.Mesh],"y");
    for(const x of [.58,.92]){
      const z=side*(boardWidth(x)-.010),bottom=floorRoof(x,z,1)!-.002,top=.252;
      box("floor",`Floor board stay ${side} ${x}`,[x,(bottom+top)/2,z],[.006,top-bottom,.018],mat.carbon);
      box("floor",`Floor board stay foot ${side} ${x}`,[x,bottom+.003,z-side*.010],[.028,.006,.038],mat.carbon);
    }
    // The photographed floor edge is a stack of narrow shaped laminates, not
    // one swollen surface. Each strip follows the actual upper floor skin.
    const shoulder=root.getObjectByName(`Sculpted floor shoulder ${side}`) as T.Mesh;
    const shoulderHeight=createHeightSampler(shoulder.geometry);
    // A thin closed edge return follows the installed floor, including the
    // rise ahead of the rear tyre. The former round tube had open ends and
    // stood above the flat edge like a separate 12 mm bead.
    const lipPoints:T.Vector3[]=[],lipIndices:number[]=[],lipBoundary:number[]=[],lipColumns=8;
    const lipStations=[...new Set([...Array.from({length:129},(_,i)=>T.MathUtils.lerp(-1.52,1.04,i/128)),
      ...floorWidths.map(([x])=>x).filter(x=>x> -1.52&&x<1.04),-1.23])].sort((a,b)=>a-b);
    for(const x of lipStations)for(let col=0;col<=lipColumns;col++){
      const u=col/lipColumns,width=widthAt(x),z=side*(width-.024+.026*u);
      const seatZ=side*Math.min(Math.abs(z),width-.0101);
      const seat=shoulderHeight(x,seatZ)??(x< -1.23?diffuserHeightAt(x)+.010:.077);
      lipPoints.push(new T.Vector3(x,seat+.002+.0015*Math.sin(Math.PI*u),z));
    }
    for(let row=0;row<lipStations.length-1;row++)for(let col=0;col<lipColumns;col++){
      const a=row*(lipColumns+1)+col,b=a+1,c=a+lipColumns+1,d=c+1;
      if(side>0)lipIndices.push(a,b,c,b,d,c);else lipIndices.push(a,c,b,b,c,d);
    }
    for(let col=0;col<=lipColumns;col++)lipBoundary.push(col);
    for(let row=1;row<lipStations.length;row++)lipBoundary.push(row*(lipColumns+1)+lipColumns);
    for(let col=lipColumns-1;col>=0;col--)lipBoundary.push((lipStations.length-1)*(lipColumns+1)+col);
    for(let row=lipStations.length-2;row>0;row--)lipBoundary.push(row*(lipColumns+1));
    if(side<0)lipBoundary.reverse();
    mesh("floor",`Outer floor lip ${side}`,laminate(lipPoints,lipIndices,lipBoundary,.003),mat.carbon);
    for(let layer=0;layer<2;layer++){
      const points:T.Vector3[]=[],indices:number[]=[],boundary:number[]=[],rows=96,columns=6;
      for(let row=0;row<=rows;row++)for(let col=0;col<=columns;col++){
        const x=T.MathUtils.lerp(-1.53,1.02,row/rows),u=col/columns;
        const offset=layer===0?.012+.033*u:.065+.027*u,z=side*(widthAt(x)-offset);
        const y=(shoulderHeight(x,z)??.079)+.004+layer*.002+.005*Math.sin(Math.PI*u);
        points.push(new T.Vector3(x,y,z));
      }
      for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
        const a=row*(columns+1)+col,b=a+1,c=a+columns+1,d=c+1;
        if(side>0)indices.push(a,c,b,b,c,d);else indices.push(a,b,c,b,d,c);
      }
      for(let col=0;col<=columns;col++)boundary.push(col);
      for(let row=1;row<=rows;row++)boundary.push(row*(columns+1)+columns);
      for(let col=columns-1;col>=0;col--)boundary.push(rows*(columns+1)+col);
      for(let row=rows-1;row>0;row--)boundary.push(row*(columns+1));
      if(side>0)boundary.reverse();
      mesh("floor",`Stepped floor edge ${side} ${layer}`,laminate(points,indices,boundary,.003),mat.carbon);
    }
    // Two swept laminates sit above the rear shoulder in the side reference.
    // Their inboard roots follow the floor; the raised outboard edges taper
    // into the long channel rather than ending as isolated rectangular fins.
    for(let layer=0;layer<2;layer++){
      const points:T.Vector3[]=[],indices:number[]=[],boundary:number[]=[],rows=48,columns=10;
      for(let row=0;row<=rows;row++)for(let col=0;col<=columns;col++){
        const t=row/rows,u=col/columns,x=T.MathUtils.lerp(-1.53+layer*.045,-.64+layer*.10,t);
        const inset=T.MathUtils.lerp(.105+layer*.078,.051+layer*.047,t);
        const width=(.067-layer*.008)*(1-.40*t),z=side*(widthAt(x)-inset+width*u);
        const height=shoulderHeight(x,z);
        const lift=(.026+layer*.010)*Math.sin(Math.PI*t)**.7*Math.sin(Math.PI*u/2);
        points.push(new T.Vector3(x,(height??.079)+.0025+lift,z));
      }
      for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
        const a=row*(columns+1)+col,b=a+1,c=a+columns+1,d=c+1;
        if(side>0)indices.push(a,b,c,b,d,c);else indices.push(a,c,b,b,c,d);
      }
      for(let col=0;col<=columns;col++)boundary.push(col);
      for(let row=1;row<=rows;row++)boundary.push(row*(columns+1)+columns);
      for(let col=columns-1;col>=0;col--)boundary.push(rows*(columns+1)+col);
      for(let row=rows-1;row>0;row--)boundary.push(row*(columns+1));
      if(side<0)boundary.reverse();
      mesh("floor",`Rear floor turning vane ${side} ${layer}`,laminate(points,indices,boundary,.0025),mat.carbon);
    }
    // Small upright in front of the rear tyre, distinct from the horizontal
    // edge laminates. The swept crest and rolled root follow the launch side
    // photograph; the hidden section remains a photographic reconstruction.
    const fencePoints:T.Vector3[]=[],fenceIndices:number[]=[],fenceBoundary:number[]=[],fenceRows=64,fenceColumns=12;
    const crest=new T.CatmullRomCurve3([[-1.46,.123],[-1.34,.198],[-1.23,.178],[-1.10,.112],[-.96,.085]].map(([x,y])=>new T.Vector3(x,y,0)),false,"centripetal");
    for(let row=0;row<=fenceRows;row++)for(let col=0;col<=fenceColumns;col++){
      const t=row/fenceRows,u=col/fenceColumns,top=crest.getPoint(t),rootZ=widthAt(top.x)-.019;
      const bottom=shoulderHeight(top.x,side*rootZ)??.079,y=T.MathUtils.lerp(bottom+.002,Math.max(bottom+.003,top.y),u);
      const lean=.032*Math.sin(Math.PI*t)**.8*Math.sin(Math.PI*u/2);
      fencePoints.push(new T.Vector3(top.x,y,side*(rootZ-lean)));
    }
    for(let row=0;row<fenceRows;row++)for(let col=0;col<fenceColumns;col++){
      const a=row*(fenceColumns+1)+col,b=a+1,c=a+fenceColumns+1,d=c+1;
      if(side>0)fenceIndices.push(a,c,b,b,c,d);else fenceIndices.push(a,b,c,b,d,c);
    }
    for(let col=0;col<=fenceColumns;col++)fenceBoundary.push(col);
    for(let row=1;row<=fenceRows;row++)fenceBoundary.push(row*(fenceColumns+1)+fenceColumns);
    for(let col=fenceColumns-1;col>=0;col--)fenceBoundary.push(fenceRows*(fenceColumns+1)+col);
    for(let row=fenceRows-1;row>0;row--)fenceBoundary.push(row*(fenceColumns+1));
    if(side>0)fenceBoundary.reverse();
    mesh("floor",`Rear tyre floor fence ${side}`,laminate(fencePoints,fenceIndices,fenceBoundary,.003),mat.carbon);
    const boardSurface=createSurfaceSampler(boardParts,"z");
    for(let i=0;i<3;i++){
      // Three separate curved blades project ahead of the tall floor board.
      // The old vertical rectangles sat behind it and left the photographed
      // stepped inlet absent between the board and the front tyre.
      const points:T.Vector3[]=[],indices:number[]=[],boundary:number[]=[],rows=36,columns=16;
      const front=[1.335,1.310,1.282][i],height=[.124,.188,.310][i];
      for(let row=0;row<=rows;row++)for(let col=0;col<=columns;col++){
        const t=row/rows,u=col/columns;
        const x=T.MathUtils.lerp(.86,front-.040*(2*u-1)**2,t);
        const y=height-.024*t+.017*Math.sin(Math.PI*t)+.011*Math.sin(Math.PI*u);
        const rootZ=boardSurface(x,y,-side as 1|-1);
        const outer=rootZ===undefined?.732-.075*T.MathUtils.smoothstep(x,1.063,front):Math.abs(rootZ);
        const width=.19-.10*T.MathUtils.smoothstep(x,1.08,front);
        points.push(new T.Vector3(x,y,side*(outer-width*(1-u))));
      }
      for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
        const a=row*(columns+1)+col,b=a+1,c=a+columns+1,d=c+1;
        if(side>0)indices.push(a,b,c,b,d,c);else indices.push(a,c,b,b,c,d);
      }
      for(let col=0;col<=columns;col++)boundary.push(col);
      for(let row=1;row<=rows;row++)boundary.push(row*(columns+1)+columns);
      for(let col=columns-1;col>=0;col--)boundary.push(rows*(columns+1)+col);
      for(let row=rows-1;row>0;row--)boundary.push(row*(columns+1));
      if(side<0)boundary.reverse();
      mesh("floor",`Side floor louvre ${side} ${i}`,laminate(points,indices,boundary,.003),mat.carbon);
    }
    // Mirror supports belong to their own selectable assembly. Both mounting
    // feet conform to the real body surface, rather than a guessed height.
    const mirrorRoot=(outer:boolean):V=>{
      const surface=root.getObjectByName(outer?"Continuous undercut sidepod shell":`Cockpit shoulder fairing ${side}`) as T.Mesh;
      surface.updateMatrixWorld(true);
      const height=createSurfaceSampler([surface],"y"),x=outer?.52:.665,z=side*(outer?.56:.23);
      const y=height(x,z,1)!;
      const foot=new T.CylinderGeometry(1,1,.005,40),points=foot.attributes.position;
      for(let i=0;i<points.count;i++){
        const px=x+points.getX(i)*.022,pz=z+points.getZ(i)*.012;
        points.setXYZ(i,px,(height(px,pz,1)??y)+points.getY(i)+.0015,pz);
      }
      foot.computeVertexNormals();
      mesh("mirrors",`Mirror ${outer?"outer":"inner"} mounting foot ${side}`,foot,mat.carbon,[0,0,0],{cover:true});
      for(const offset of[-.014,.014]){
        const fixingY=height(x+offset,z,1)!;
        cylinder("mirrors",`Mirror ${outer?"outer":"inner"} fixing ${side} ${offset}`,[x+offset,fixingY+.003,z],[x+offset,fixingY+.0055,z],.0022,mat.darkMetal,.0022,{cover:true});
      }
      return[x,y+.002,z];
    };
    const innerRoute:V[]=[mirrorRoot(false),[.66,.641,side*.273],[.635,.658,side*.42],[.63,.673,side*.59]];
    const outerRoute:V[]=[mirrorRoot(true),[.57,.622,side*.60],[.63,.673,side*.635]];
    const stay=fairedRail("mirrors",`Mirror stay ${side}`,innerRoute,.016,.003,mat.carbon);
    stay.userData.cover=true;stay.userData.route=innerRoute;
    const brace=tube("mirrors",`Mirror outer brace ${side}`,outerRoute,.003,mat.carbon,{cover:true});brace.userData.route=outerRoute;
    group("mirrors").add(...createMirrorHead(side as 1|-1,mat).children);

  }
  // KA 10's fin ends ahead of the rear axle with a gently falling crown and
  // a short raked trailing edge. Seat its root on the actual cover: the old
  // coarse polygon extended aft into the exhaust shield and below its roof.
  {
    const roof=createSurfaceSampler([sidepod],"y"),outline=new T.Shape();
    outline.moveTo(-.29,.997);
    outline.bezierCurveTo(-.49,.997,-.81,.888,-1.12,.852);
    outline.bezierCurveTo(-1.20,.843,-1.28,.840,-1.336,.838);
    outline.quadraticCurveTo(-1.34,.838,-1.341,.834);
    outline.lineTo(-1.40,roof(-1.40,.005,1)!-.004);
    for(let i=1;i<=80;i++){
      const x=T.MathUtils.lerp(-1.40,-.29,i/80);
      outline.lineTo(x,roof(x,.005,1)!-.004);
    }
    outline.closePath();
    const geometry=new T.ExtrudeGeometry(outline,{depth:.006,bevelEnabled:true,bevelSize:.001,bevelThickness:.001,bevelSegments:2,curveSegments:36});
    geometry.translate(0,0,-.003);
    mesh("bodywork","Shark fin",mergeVertices(geometry),mat.carbon,[0,0,0],{cover:true});geometry.dispose();
  }
  // Thin wall around the real open roll-hoop intake, with a recessed throat.
  const inletOuter=new T.Shape();
  inletOuter.moveTo(-.098,.867);inletOuter.quadraticCurveTo(-.118,.867,-.121,.89);inletOuter.bezierCurveTo(-.131,.953,-.102,.994,-.061,.999);inletOuter.quadraticCurveTo(0,1.008,.061,.999);inletOuter.bezierCurveTo(.102,.994,.131,.953,.121,.89);inletOuter.quadraticCurveTo(.118,.867,.098,.867);inletOuter.quadraticCurveTo(0,.862,-.098,.867);
  const inletInner=new T.Path();inletInner.moveTo(-.094,.879);inletInner.quadraticCurveTo(0,.875,.094,.879);inletInner.quadraticCurveTo(.106,.880,.109,.898);inletInner.bezierCurveTo(.116,.946,.095,.981,.058,.987);inletInner.quadraticCurveTo(0,.996,-.058,.987);inletInner.bezierCurveTo(-.095,.981,-.116,.946,-.109,.898);inletInner.quadraticCurveTo(-.106,.880,-.094,.879);inletOuter.holes.push(inletInner);
  // Taper the hollow duct into the engine spine and rake the mouth. This is
  // still a physical wall with an open throat, rather than a dark front cap.
  const inletShell=new T.ExtrudeGeometry(inletOuter,{depth:.175,bevelEnabled:true,bevelSize:.002,bevelThickness:.002,bevelSegments:3,curveSegments:32,steps:12});
  const inletPoints=inletShell.attributes.position;
  for(let i=0;i<inletPoints.count;i++){
    const across=inletPoints.getX(i),y=inletPoints.getY(i),depth=inletPoints.getZ(i),t=T.MathUtils.clamp(depth/.175,0,1);
    const taper=.72+.28*t,front=-.088+(y-.867)/.128*.035;
    inletPoints.setXYZ(i,T.MathUtils.lerp(-.24,front,t),.934+(y-.934)*(t*.13+.87),-across*taper);
  }
  const smoothInlet=mergeVertices(inletShell,1e-6);smoothInlet.computeVertexNormals();inletShell.dispose();
  mesh("intake","Open airbox shell",smoothInlet,mat.body);
  // An open joining rim replaces the old opaque backing. Air can continue
  // through the three channels into the reducer and the filtered-air duct.
  const throatOutline=inletInner.getPoints(32).map(p=>{
    const front=-.088+(p.y-.867)/.128*.035,t=(-.228+.24)/(front+.24);
    return new T.Vector2(p.x*(.72+.28*t)*1.005,.934+(p.y-.934)*(.87+.13*t));
  });
  const throatProfile=new T.Shape(throatOutline);
  throatProfile.holes.push(new T.Path(throatOutline.map(p=>new T.Vector2(p.x*.97,.934+(p.y-.934)*.97)).reverse()));
  const throat=new T.ExtrudeGeometry(throatProfile,{depth:.006,bevelEnabled:false,steps:1,curveSegments:32});
  throat.rotateY(Math.PI/2);throat.translate(-.234,0,0);
  mesh("intake","Recessed airbox throat",throat,mat.black);
  roundedBox("safety","Onboard camera",[-.198,1.0745,0],[.110,.030,.248],mat.darkMetal,.004);
  const intakeRoof=createSurfaceSampler([root.getObjectByName("Open airbox shell") as T.Mesh],"y");
  const cameraFoot=new T.CylinderGeometry(1,1,.004,40),cameraFootPoints=cameraFoot.attributes.position;
  for(let i=0;i<cameraFootPoints.count;i++){
    const x=-.196+cameraFootPoints.getX(i)*.035,z=cameraFootPoints.getZ(i)*.022;
    cameraFootPoints.setXYZ(i,x,intakeRoof(x,z,1)!+cameraFootPoints.getY(i)+.0015,z);
  }
  cameraFoot.computeVertexNormals();mesh("safety","Camera mounting foot",cameraFoot,mat.carbon);
  const mastBase=intakeRoof(-.196,0,1)!+.002;
  const mastProfile=new T.Shape();mastProfile.moveTo(-.014,mastBase);mastProfile.lineTo(.014,mastBase);mastProfile.lineTo(.012,1.038);mastProfile.quadraticCurveTo(.012,1.052,.032,1.0595);mastProfile.lineTo(-.032,1.0595);mastProfile.quadraticCurveTo(-.012,1.052,-.012,1.038);mastProfile.closePath();
  const mast=new T.ExtrudeGeometry(mastProfile,{depth:.042,bevelEnabled:false,curveSegments:12});mast.rotateY(Math.PI/2);mast.translate(-.217,0,0);
  mesh("safety","Camera mounting mast",mast,mat.carbon);
  for(const direction of[-1,1]){
    roundedBox("safety",`Camera lens bezel ${direction}`,[-.198+direction*.0555,1.0745,direction*.094],[.002,.017,.024],mat.black,.001);
    roundedBox("safety",`Camera lens ${direction}`,[-.198+direction*.0566,1.0745,direction*.094],[.0005,.011,.018],mat.metal,.0002);
  }
  for(const side of[-1,1])cylinder("safety",`Camera top fixing ${side}`,[-.185,1.089,side*.042],[-.185,1.090,side*.042],.002,mat.black);
  cylinder("safety","Camera aerial",[-.198,1.089,0],[-.198,1.111,0],.002,mat.black);
  // Three physical front elements and two rear elements, each with real chord,
  // camber, thickness, spanwise sweep, endplates, pivots and mounting pylons.
  // The upright sits near the tyre's inner shoulder. The broad outwash channel,
  // not the upright, reaches the outer shoulder in the overhead reference.
  const frontWallZ=(x:number)=>.736-.033*T.MathUtils.smoothstep(x,2.07,2.49);
  const frontMainplane=aerofoil("front-wing","Front mainplane",2.61,.092,.29,1.844,mat.carbon,false,-.23);
  // The mainplane rises inboard of the endplates, then rolls down into their
  // feet. A single cosine rise produced an unbroken U instead of the W17's
  // shoulder, low outer channel and upturned outwash lip.
  const mainPoints=frontMainplane.geometry.attributes.position;
  for(let i=0;i<mainPoints.count;i++){
    const z=mainPoints.getZ(i),outer=T.MathUtils.smoothstep(Math.abs(z),.57,.922);
    mainPoints.setY(i,mainPoints.getY(i)-.106*outer);
    const shoulder=.57,blend=T.MathUtils.clamp((Math.abs(z)-shoulder)/(.922-shoulder),0,1);
    if(blend>0)mainPoints.setZ(i,Math.sign(z)*T.MathUtils.lerp(shoulder,frontWallZ(mainPoints.getX(i)+.02)-.020,blend));
  }
  frontMainplane.geometry.computeVertexNormals();
  const frontFlapRoot=.153;
  const frontDrives=new Map<number,{wing:T.Mesh;anchor:V;attachment:V}>();
  for(const side of [-1,1]){
    const range:[number,number]=side<0?[-.645,-frontFlapRoot]:[frontFlapRoot,.645];
    const outer:[number,number]=side<0?[-.928,-.659]:[.659,.928];
    for(const [name,x,y,chord,sweep,closed] of [["primary",2.405,.175,.208,-.20,-.30],["secondary",2.242,.236,.166,-.17,-.39]] as const){
      // The upper element turns forward at its outer end in the overhead view.
      // Use one continuous planform for both halves of the hinge seam. Cropping
      // only the fixed tip to clear the tyre produced a thin, disconnected tab.
      const tipSweep=(z:number)=>name==="secondary"?.094*T.MathUtils.smoothstep(Math.abs(z),.57,.928):0;
      const point=(z:number,u=.20):V=>[x-u*chord*(1-.18*Math.abs(z/.928)**3)+sweep*z*z+tipSweep(z),y-.07*chord*Math.sin(Math.PI*u)+.095*(1-Math.cos(Math.abs(z/.928)*Math.PI))/2,z];
      const shapeTip=(part:T.Mesh)=>{
        const p=part.geometry.attributes.position;
        for(let i=0;i<p.count;i++)p.setX(i,p.getX(i)+tipSweep(p.getZ(i)));
      };
      const first=point(range[0]),last=point(range[1]),axis=new T.Vector3(...last).sub(new T.Vector3(...first)).normalize();
      const flap=aerofoil("front-wing",`Front ${name} flap ${side}`,x,y,chord,1.856,mat.body,true,sweep,range);
      shapeTip(flap);
      // W17 shakedown footage shows the rearmost profile moving, with the
      // nose-supported second element stationary. Two actuators, not four.
      hinge(flap,first,closed,name==="primary"?closed:-.025,axis);
      flap.userData.flap=name==="secondary";
      const tip=aerofoil("front-wing",`Fixed outer ${name} tip ${side}`,x,y,chord,1.856,mat.body,false,sweep,outer);
      shapeTip(tip);
      hinge(tip,first,closed,closed,axis);
      // Terminate the fixed tip on the endplate's inner surface. Rotation about
      // the swept hinge otherwise pushes its outboard vertices through the wall.
      tip.geometry.applyQuaternion(tip.quaternion);tip.geometry.translate(...tip.position.toArray());
      const tipPoints=tip.geometry.attributes.position;
      let extent=0;for(let i=0;i<tipPoints.count;i++)extent=Math.max(extent,Math.abs(tipPoints.getZ(i)));
      for(let i=0;i<tipPoints.count;i++)tipPoints.setZ(i,side*(.659+(Math.abs(tipPoints.getZ(i))-.659)*(frontWallZ(tipPoints.getX(i)+.02)-.006-.659)/(extent-.659)));
      tip.geometry.computeVertexNormals();tip.position.set(0,0,0);tip.quaternion.identity();delete tip.userData.pivot;
      for(const position of [first,last]){
        const a=new T.Vector3(...position).addScaledVector(axis,-.009),b=new T.Vector3(...position).addScaledVector(axis,.009);
        cylinder("front-wing",`${name} hinge pin ${position[2]}`,a.toArray() as V,b.toArray() as V,.008,mat.metal);
      }
      const outboard=new T.Vector3(...(side>0?last:first)),outward=axis.clone().multiplyScalar(side);
      annulus("front-wing",`Front ${name} outboard bearing ${side}`,
        outboard.clone().addScaledVector(outward,.005).toArray() as V,
        outboard.clone().addScaledVector(outward,.029).toArray() as V,.0081,.014,mat.darkMetal);
      if(name==="secondary")frontDrives.set(side,{wing:flap,anchor:[x-.13,.200,side*(frontFlapRoot+.015)],attachment:point(side*(frontFlapRoot+.015),.72)});
      if(name==="primary")for(const across of [.26,.40,.54]){
        const z=side*across,attachment=point(z,.72),anchorX=attachment[0]+.070;
        const hit=new T.Raycaster(new T.Vector3(anchorX,1,z),new T.Vector3(0,-1,0)).intersectObject(frontMainplane,false)[0];
        if(!hit)continue;
        const anchor=hit.point.clone();anchor.y-=.001;
        const stay=mesh("front-wing",`Front slot separator ${side} ${across}`,new T.BoxGeometry(.009,1,.0035),mat.metal);
        linkages.push({mesh:stay,wing:flap,anchor,end:new T.Vector3(...attachment).sub(flap.position),from:0,to:1});
      }

    }
  }
  for(const s of [-1,1]){
    // One continuous section: upright, concave heel, broad channel and a
    // rounded outer return. Separate wall/foot meshes left a sharp black fin
    // and an overlapping seam where the reference has a moulded radius.
    const topCurve=new T.CatmullRomCurve3([
      [2.49,.127,0],[2.465,.218,0],[2.36,.283,0],[2.28,.295,0],
      [2.21,.347,0],[2.14,.401,0],[2.076,.408,0],
    ].map(p=>new T.Vector3(...p)),false,"catmullrom",.32);
    const rows=48,columns=80,plateIndices:number[]=[];
    const platePoint=(t:number,v:number)=>{
      const top=topCurve.getPoint(t),bottomX=T.MathUtils.lerp(2.49,1.96,t)-.02;
      const floorY=.067+.008*t,heel=.046,outerZ=.946;
      const wallZ=frontWallZ(bottomX+.02),crestZ=outerZ-.045,crestY=floorY+.073-.010*t;
      let x=bottomX,y:number,z:number;
      if(v<=.30){
        const u=v/.30,ease=u*u*(3-2*u);
        x=T.MathUtils.lerp(top.x-.02,bottomX,ease);
        y=T.MathUtils.lerp(top.y,floorY+heel,u);
        z=frontWallZ(x+.02);
      }else if(v<=.50){
        const angle=(v-.30)/.20*Math.PI/2;
        y=floorY+heel*(1-Math.sin(angle));
        z=wallZ+heel*(1-Math.cos(angle));
      }else if(v<=.80){
        const u=(v-.50)/.30,a=1-u,startZ=wallZ+heel;
        // Horizontal tangents at the trough and crest avoid a pointed fold.
        z=a*a*a*startZ+3*a*a*u*(startZ+.041)+3*a*u*u*(crestZ-.033)+u*u*u*crestZ;
        y=floorY+(crestY-floorY)*(3*u*u-2*u*u*u);
      }else{
        const u=(v-.80)/.20,a=1-u;
        z=a*a*a*crestZ+3*a*a*u*(crestZ+.025)+3*a*u*u*outerZ+u*u*u*outerZ;
        y=a*a*a*crestY+3*a*a*u*crestY+3*a*u*u*(crestY-.025)+u*u*u*(floorY+.017);
      }
      const clearance=W17_AXLES.front+Math.sqrt(Math.max(0,(W17_WHEELS.front.radius+.018)**2-(y-W17_WHEELS.front.radius)**2));
      return new T.Vector3(Math.max(x,clearance-.02),y,s*z);
    };
    // Store both faces and close every edge. Offset along the actual normal,
    // so the turn from vertical endplate to horizontal foot has constant gauge.
    const points:T.Vector3[]=[],boundary:number[]=[];
    for(let i=0;i<=rows;i++)for(let j=0;j<=columns;j++)points.push(platePoint(i/rows,j/columns));
    for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){
      const a=i*(columns+1)+j,b=a+1,c=a+columns+1,d=c+1;
      if(s>0)plateIndices.push(a,c,b,b,c,d);else plateIndices.push(a,b,c,b,d,c);
    }
    for(let j=0;j<=columns;j++)boundary.push(j);
    for(let i=1;i<=rows;i++)boundary.push(i*(columns+1)+columns);
    for(let j=columns-1;j>=0;j--)boundary.push(rows*(columns+1)+j);
    for(let i=rows-1;i>0;i--)boundary.push(i*(columns+1));
    if(s>0)boundary.reverse();
    const plateGeometry=laminate(points,plateIndices,boundary,.005);
    const endplate=mesh("front-wing",`Front endplate ${s}`,plateGeometry,mat.silver);
    const endplateSurface=createSurfaceSampler([endplate],"z");
    // Seat the outer mainplane section on the real curved inner face. An
    // algebraic width clamp alone can leave either a gap or a black spear
    // through the wall when camber and the endplate flare meet.
    const oldSide=endplate.material.side;endplate.material.side=T.DoubleSide;
    for(let i=0;i<mainPoints.count;i++){
      const rawZ=(Math.floor(i/40)/32-.5)*1.844;
      if(rawZ*s<=.57)continue;
      const blend=T.MathUtils.clamp((Math.abs(rawZ)-.57)/(.922-.57),0,1);
      const z=endplateSurface(mainPoints.getX(i),mainPoints.getY(i),-s as 1|-1);
      if(z!==undefined)mainPoints.setZ(i,s*T.MathUtils.lerp(.57,Math.abs(z)+.0007,blend));
    }
    endplate.material.side=oldSide;frontMainplane.geometry.computeVertexNormals();
    // The short outboard vane above the channel is visible ahead of the tyre
    // in the front reference. Its full root lands on the upright's outer face.
    const vanePoints:T.Vector3[]=[],vaneIndices:number[]=[],vaneBoundary:number[]=[],vaneRows=16,vaneColumns=24;
    for(let i=0;i<=vaneRows;i++)for(let j=0;j<=vaneColumns;j++){
      const across=i/vaneRows,chord=j/vaneColumns;
      const x=T.MathUtils.lerp(2.17+.080*across,2.086+.004*across,chord);
      const y=.258+.024*across**1.2+.012*Math.sin(Math.PI*chord)-.013*chord;
      const z=endplateSurface(x,y,s as 1|-1);
      const rootZ=z===undefined?frontWallZ(x+.02):Math.abs(z);
      vanePoints.push(new T.Vector3(x,y,s*T.MathUtils.lerp(rootZ,.944,across)));
    }
    for(let i=0;i<vaneRows;i++)for(let j=0;j<vaneColumns;j++){
      const a=i*(vaneColumns+1)+j,b=a+1,c=a+vaneColumns+1,d=c+1;
      if(s>0)vaneIndices.push(a,b,c,b,d,c);else vaneIndices.push(a,c,b,b,c,d);
    }
    for(let j=0;j<=vaneColumns;j++)vaneBoundary.push(j);
    for(let i=1;i<=vaneRows;i++)vaneBoundary.push(i*(vaneColumns+1)+vaneColumns);
    for(let j=vaneColumns-1;j>=0;j--)vaneBoundary.push(vaneRows*(vaneColumns+1)+j);
    for(let i=vaneRows-1;i>0;i--)vaneBoundary.push(i*(vaneColumns+1));
    if(s<0)vaneBoundary.reverse();
    mesh("front-wing",`Front outboard vane ${s}`,laminate(vanePoints,vaneIndices,vaneBoundary,.003),mat.silver);
    // Two faired saddles join the nose underside to the mainplane. The foot
    // follows the actual upper wing surface, rather than ending in mid-air.
    const mainplane=root.getObjectByName("Front mainplane") as T.Mesh;
    const mainplaneHeight=createHeightSampler(mainplane.geometry);
    const mountPoints:number[]=[],mountIndices:number[]=[],rings=20,radial=40;
    for(let ring=0;ring<=rings;ring++){
      const t=ring/rings,ease=t*t*(3-2*t);
      const centreX=T.MathUtils.lerp(2.485,2.465,ease),chord=T.MathUtils.lerp(.190,.105,ease);
      const centreZ=T.MathUtils.lerp(.107,.063,ease),thickness=.013+.016*(1-t)**4+.011*t**4;
      for(let j=0;j<radial;j++){
        const a=j/radial*Math.PI*2,x=centreX+Math.cos(a)*chord/2,z=s*(centreZ+Math.sin(a)*thickness/2);
        mountPoints.push(x,T.MathUtils.lerp((mainplaneHeight(x,z)??.09)-.001,.166,t),z);
      }
    }
    for(let ring=0;ring<rings;ring++)for(let j=0;j<radial;j++){
      const a=ring*radial+j,b=ring*radial+(j+1)%radial;
      if(s>0)mountIndices.push(a,a+radial,b,b,a+radial,b+radial);else mountIndices.push(a,b,a+radial,b,b+radial,a+radial);
    }
    for(let j=1;j<radial-1;j++){
      const end=rings*radial;
      if(s>0)mountIndices.push(0,j,j+1,end,end+j+1,end+j);else mountIndices.push(0,j+1,j,end,end+j,end+j+1);
    }
    const mountGeometry=new T.BufferGeometry();mountGeometry.setAttribute("position",new T.Float32BufferAttribute(mountPoints,3));mountGeometry.setIndex(mountIndices);mountGeometry.computeVertexNormals();
    mesh("front-wing",`Front mounting pylon ${s}`,mountGeometry,mat.carbon);
  }
  // The outer section follows a concave wall, so a planar triangle fan cuts
  // across the heel even when every perimeter vertex is correctly seated.
  // Tessellate each cap through its interior and seat it on the inner laminate.
  const mainPositions=Array.from(mainPoints.array),mainUV=Array.from(frontMainplane.geometry.attributes.uv.array);
  const mainIndices=Array.from(frontMainplane.geometry.index!.array).slice(0,32*40*6);
  for(const side of [-1,1]){
    const plate=root.getObjectByName(`Front endplate ${side}`) as T.Mesh;
    const plateSurface=createSurfaceSampler([plate],"z");
    const material=plate.material as T.Material,oldSide=material.side;material.side=T.DoubleSide;
    const offset=side<0?0:32*40,centre=new T.Vector3();
    for(let j=0;j<40;j++)centre.add(new T.Vector3().fromBufferAttribute(mainPoints,offset+j));centre.multiplyScalar(1/40);
    const append=(point:T.Vector3)=>{
      const z=plateSurface(point.x,point.y,-side as 1|-1);
      const index=mainPositions.length/3;
      mainPositions.push(point.x,point.y,z===undefined?point.z:z+side*.0007);mainUV.push(side<0?0:1,.5);return index;
    };
    const centreIndex=append(centre),rings:number[][]=[];
    for(let ring=1;ring<=8;ring++){
      const indices:number[]=[];
      for(let j=0;j<40;j++)indices.push(ring===8?offset+j:append(centre.clone().lerp(new T.Vector3().fromBufferAttribute(mainPoints,offset+j),ring/8)));
      rings.push(indices);
    }
    const face=(a:number,b:number,c:number)=>{if(side>0)mainIndices.push(a,b,c);else mainIndices.push(a,c,b);};
    for(let j=0;j<40;j++)face(centreIndex,rings[0][j],rings[0][(j+1)%40]);
    for(let ring=0;ring<rings.length-1;ring++)for(let j=0;j<40;j++){
      const a=rings[ring][j],b=rings[ring][(j+1)%40],c=rings[ring+1][j],d=rings[ring+1][(j+1)%40];face(a,c,b);face(b,c,d);
    }
    material.side=oldSide;
  }
  frontMainplane.geometry.setAttribute("position",new T.Float32BufferAttribute(mainPositions,3));
  frontMainplane.geometry.setAttribute("uv",new T.Float32BufferAttribute(mainUV,2));
  frontMainplane.geometry.setIndex(mainIndices);frontMainplane.geometry.computeVertexNormals();
  buildRearWing();
  // Keep the lamp close to the retained launch-model rear outline. The former
  // 750 mm regulatory datum produced a visibly oversized extension relative
  // to this wing/floor reconstruction. The gearbox bond stays in place.
  const impactRearX=W17_AXLES.rear-W17_REAR_LIGHT_OVERHANG,impactTop=W17_REFERENCE_HEIGHT+.3725;
  const lampY=W17_REFERENCE_HEIGHT+.300;
  const impactSections:Section[]=[impactRearX,-2.18,-2.10,-1.98,-1.84].map(x=>{
    const t=(x-impactRearX)/(-1.84-impactRearX);
    return [x,T.MathUtils.lerp(impactTop-.145,.2525,t),T.MathUtils.lerp(impactTop,.3475,t),T.MathUtils.lerp(.040,.060,t)];
  });
  const rearImpact=loft("impact","Rear crash structure",impactSections,mat.carbon,{},5);
  {
    const p=rearImpact.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),t=(x-impactRearX)/(-1.84-impactRearX);
      const bottom=T.MathUtils.lerp(impactTop-.145,.2525,t),oldTop=T.MathUtils.lerp(impactTop,.3475,t);
      // Retain the gearbox bond and keep the rising neck below the exhaust
      // and its shield; only the unobstructed aft portion reaches full height.
      const top=T.MathUtils.lerp(.3375,impactTop,T.MathUtils.smoothstep(-x,1.84,2.10));
      p.setY(i,bottom+(p.getY(i)-bottom)*(top-bottom)/(oldTop-bottom));
    }
    rearImpact.geometry.computeVertexNormals();
  }
  {
    const outer=rearImpact.geometry,inner=outer.clone(),p=inner.attributes.position,n=inner.attributes.normal,ix=inner.index!;
    for(let i=0;i<p.count;i++)p.setXYZ(i,p.getX(i)-n.getX(i)*.0025,p.getY(i)-n.getY(i)*.0025,p.getZ(i)-n.getZ(i)*.0025);
    for(let i=0;i<ix.count;i+=3){const a=ix.getX(i);ix.setX(i,ix.getX(i+2));ix.setX(i+2,a);}
    inner.computeVertexNormals();rearImpact.geometry=mergeGeometries([outer,inner]);outer.dispose();inner.dispose();
    rearImpact.userData.wallThickness=.0025;
  }
  // Enclose the fixed damper eyes and spring seats on both gearbox shoulders.
  // Keep the narrower exhaust exit; the former taper cut through the springs.
  loft("bodywork","Tail heat shield",[[-1.98,.403,tailRoof(-1.98),.052],[-1.86,.364,tailRoof(-1.86),.073],[-1.76,.33,tailRoof(-1.76),.125],[shellPoints.getX(0)-.003,.31,tailRoof(shellPoints.getX(0)-.003),.130],[-1.54,.31,tailRoof(-1.54),.130],[-1.49,.31,tailRoof(-1.49),.130]],mat.carbon,{cover:true},3);
  // Fuel bladder, electrical store, inverter, ECU, extinguisher and loom.
  const energyStore=createEnergyStore(mat);group("battery").add(energyStore.battery);group("inverter").add(energyStore.inverter);
  root.updateMatrixWorld(true);
  const storeMountHeight=createSurfaceSampler([root.getObjectByName("Survival cell lower shell") as T.Mesh],"y");
  for(const [i,mount]of energyStore.mounts.entries()){
    const [x,y,z]=mount;
    const foot=(storeMountHeight(x,z,1)??.091)-.003;
    cylinder("monocoque",`ES chassis stand-off ${i}`,[x,foot,z],[x,y,z],.008,mat.darkMetal);
    cylinder("battery",`ES mounting bolt ${i}`,[x,foot+.001,z],[x,y+.008,z],.0033,mat.metal);
  }
  // TAG-700 enclosure and its four circular sockets follow Motion Applied's
  // current product photographs. Exact W17 installation coordinates are inferred.
  roundedBox("electronics","FIA ECU TAG-700 case",[.83,.205,0],[.15,.061,.278],mat.anodised,.004);
  roundedBox("electronics","ECU sealed upper lid",[.83,.238,0],[.147,.005,.275],mat.anodised,.0015);
  for(let row=0;row<3;row++)for(let fin=0;fin<9;fin++){
    const z=-.117+row*.09+fin*.007;
    roundedBox("electronics",`ECU heat sink ${row} ${fin}`,[.816,.246,z],[row===1?.074:.098,.012,.0028],mat.anodised,.0012);
  }
  for(const z of [-.145,.145]){
    roundedBox("electronics",`ECU mounting rail ${z}`,[.83,.185,z],[.164,.006,.014],mat.darkMetal,.003);
    for(const x of [.755,.905])annulus("electronics",`ECU mounting eye ${x} ${z}`,[x,.185,z],[x,.191,z],.0028,.0065,mat.darkMetal);
  }
  for(let i=0;i<4;i++){
    const z=-.102+i*.068;
    roundedBox("electronics",`ECU socket flange ${i}`,[.908,.205,z],[.006,.052,.052],mat.darkMetal,.005);
    annulus("electronics",`ECU socket barrel ${i}`,[.911,.205,z],[.931,.205,z],.021,.025,mat.carbon);
    torus("electronics",`ECU socket seal ${i}`,[.922,.205,z],.025,.0009,mat.red,[0,Math.PI/2,0]);
    cylinder("electronics",`ECU socket insert ${i}`,[.912,.205,z],[.915,.205,z],.0205,mat.black);
    const pinPositions:V[]=[];
    for(let row=-4;row<=4;row++)for(let column=-4;column<=4;column++){
      const y=row*.0038,pz=column*.0038+(Math.abs(row)%2)*.0019;
      if(Math.hypot(y,pz)<.018)pinPositions.push([.920,.205+y,z+pz]);
    }
    const pins=new T.InstancedMesh(new T.CylinderGeometry(.00055,.00055,.008,6),mat.bronze,pinPositions.length);
    pins.name=`ECU connector pins ${i}`;pins.userData.component="electronics";
    const rotation=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),Math.PI/2);
    pinPositions.forEach((p,index)=>pins.setMatrixAt(index,new T.Matrix4().compose(new T.Vector3(...p),rotation,new T.Vector3(1,1,1))));
    pins.instanceMatrix.needsUpdate=true;pins.computeBoundingBox();pins.computeBoundingSphere();group("electronics").add(pins);
    for(const dy of [-.021,.021])for(const dz of [-.021,.021])cylinder("electronics",`ECU socket screw ${i} ${dy} ${dz}`,[.912,.205+dy,z+dz],[.914,.205+dy,z+dz],.0018,mat.metal);
  }
  // The previous ECU installation intersected the nose/keel and pedal bay.
  // This inferred service position is above the ES and below the seat, with
  // clearance for the case, cooling fins and forward-facing connector plugs.
  const ecuOffset=new T.Vector3(.190-.83,.224-.205,0);
  for(const part of group("electronics").children)part.position.add(ecuOffset);
  const ecuPoint=(p:V):V=>new T.Vector3(...p).add(ecuOffset).toArray() as V;
  const ecuTrayShape=new T.Shape();
  ecuTrayShape.moveTo(.105,-.176);ecuTrayShape.lineTo(.275,-.176);ecuTrayShape.lineTo(.275,.176);ecuTrayShape.lineTo(.200,.176);
  ecuTrayShape.lineTo(.200,.159);ecuTrayShape.quadraticCurveTo(.200,.155,.196,.155);ecuTrayShape.lineTo(.144,.155);ecuTrayShape.quadraticCurveTo(.140,.155,.140,.159);ecuTrayShape.lineTo(.140,.176);ecuTrayShape.lineTo(.105,.176);ecuTrayShape.closePath();
  const ecuTrayGeometry=new T.ExtrudeGeometry(ecuTrayShape,{depth:.004,bevelEnabled:false,curveSegments:8});ecuTrayGeometry.rotateX(-Math.PI/2);ecuTrayGeometry.translate(0,.187,0);
  mesh("monocoque","ECU mounting tray",ecuTrayGeometry,mat.carbon,[0,0,0],{structural:true});
  root.updateMatrixWorld(true);
  const ecuFootHeight=createSurfaceSampler([root.getObjectByName("Survival cell lower shell") as T.Mesh],"y");
  for(const [x,z]of[[.120,-.168],[.150,.168],[.260,-.168],[.260,.168]]){
    const foot=ecuFootHeight(x,z,1)!;
    cylinder("monocoque",`ECU tray pillar ${x} ${z}`,[x,foot-.002,z],[x,.190,z],.0065,mat.darkMetal,.0065,{structural:true});
    cylinder("electronics",`ECU tray fixing ${x} ${z}`,[x,.184,z],[x,.194,z],.003,mat.metal,.003,{installedOnly:true});
  }
  for(const x of[.115,.265])for(const z of[-.145,.145]){
    cylinder("electronics",`ECU vibration mount ${x} ${z}`,[x,.191,z],[x,.201,z],.006,mat.rubber,.006,{installedOnly:true});
    cylinder("electronics",`ECU mounting bolt ${x} ${z}`,[x,.191,z],[x,.211,z],.0025,mat.metal,.0025,{installedOnly:true});
  }
  group("safety").add(createFireSystem(root,mat));
  // A terminated wiring harness, routed through the existing service passage
  // below the seat. Keep it away from the radiator hoses and hot primaries.
  const loomRoute:V[]=[ecuPoint([.942,.205,-.102]),[.325,.224,-.115],[.320,.224,-.165],[.240,.213,-.175],[.180,.195,-.175],[.123,.164,-.190],[.123,.164,-.235],[.123,.164,-.255],[.123,.164,-.275],[.123,.164,-.290],[.123,.164,-.305],[.08,.174,-.315],[-.13,.180,-.300],[-.245,.215,-.295],[-.245,.215,-.270],[-.245,.215,-.250],[-.245,.215,-.230],[-.245,.215,-.215],[-.245,.235,-.195],[-.245,.245,-.180],[-.242,.245,-.120]];
  const loom=tube("electronics","Main loom",loomRoute,.006,mat.black,{installedOnly:true});
  loom.userData.route=loomRoute;loom.userData.outerRadius=.006;
  cylinder("electronics","ECU harness locking ring",ecuPoint([.926,.205,-.102]),ecuPoint([.934,.205,-.102]),.026,mat.darkMetal,.026,{installedOnly:true});
  cylinder("electronics","ECU harness backshell",ecuPoint([.934,.205,-.102]),loomRoute[0],.023,mat.black,.006,{installedOnly:true});
  root.updateMatrixWorld(true);
  const loomSideSeat=createSurfaceSampler([root.getObjectByName("Lower side enclosure -1") as T.Mesh],"z");
  const loomCurve=(loom.geometry as T.TubeGeometry).parameters.path;
  for(const [i,x]of[.240,.08,-.13].entries()){
    const knot=loomRoute.findIndex(point=>point[0]===x);
    const t=knot/(loomRoute.length-1),centre=loomCurve.getPoint(t),axis=loomCurve.getTangent(t);
    const clamp=annulus("electronics",`Loom retaining clip ${i}`,centre.clone().addScaledVector(axis,-.005).toArray() as V,centre.clone().addScaledVector(axis,.005).toArray() as V,.0061,.0085,mat.darkMetal,{installedOnly:true});
    clamp.userData.routeT=t;
    const z=loomSideSeat(centre.x,centre.y,-1)!;
    const end=centre.z<z?centre.z+.008:centre.z-.008;
    box("electronics",`Loom clip bracket ${i}`,[centre.x,centre.y,(z+end)/2],[.018,.006,Math.abs(end-z)+.006],mat.darkMetal,{installedOnly:true});
    cylinder("electronics",`Loom clip fixing ${i}`,[centre.x,centre.y,z-.004],[centre.x,centre.y,z+.004],.003,mat.metal,.003,{installedOnly:true});
  }
  // M17 architecture: a 90-degree V6 inside a complete casting, with separate
  // head housings and cam covers. Casing details use published HPP engines as
  // visual analogues; the private M17 castings and packaging are not measured.
  const sumpSection=new T.Shape();
  [[-.13,.224],[.13,.224],[.13,.258],[.126,.258],[.126,.227],[-.126,.227],[-.126,.258],[-.13,.258]].forEach(([z,y],i)=>i?sumpSection.lineTo(z,y):sumpSection.moveTo(z,y));sumpSection.closePath();
  // The timing bay has its own closed lower casting and front partition.
  const sumpGeometry=new T.ExtrudeGeometry(sumpSection,{depth:.504,bevelEnabled:false});sumpGeometry.rotateY(Math.PI/2);sumpGeometry.translate(-.778,0,0);
  mesh("engine","Dry sump",sumpGeometry,mat.cast,[0,0,0],{serviceCover:true});
  box("engine","Sump end wall -0.272",[-.272,.241,0],[.004,.034,.26],mat.cast,{serviceCover:true});
  const blockSection=new T.Shape();
  const blockOutline:[number,number][]=[[-.132,.225],[-.157,.323],[-.311,.474],[-.197,.563],[-.092,.456],[0,.364],[.092,.456],[.197,.563],[.311,.474],[.157,.323],[.132,.225]];
  blockOutline.forEach(([z,y],i)=>i?blockSection.lineTo(z,y):blockSection.moveTo(z,y));blockSection.closePath();
  const crankcaseSection=new T.Shape(),crankBay=new T.Path();
  const deckOuter=(.168+.054)*Math.SQRT1_2,deckInner=(.168-.054)*Math.SQRT1_2;
  [[-.132,.225],[-.157,.323],[-deckOuter,.29+deckInner],[-deckInner,.29+deckOuter],[-.046,.406],[0,.360],[.046,.406],[deckInner,.29+deckOuter],[deckOuter,.29+deckInner],[.157,.323],[.132,.225]].forEach(([z,y],i)=>i?crankcaseSection.lineTo(z,y):crankcaseSection.moveTo(z,y));crankcaseSection.closePath();
  // An open crank chamber and bank cavities surround the replaceable liners.
  // Leave the original external mounting envelope for the ancillary systems.
  crankBay.absarc(0,.29,.060,0,-Math.PI,true);
  const bayOutline:[number,number][]=[[-.086,.30],[-.150,.372],[-.082,.440],[-.042,.401],[0,.354],[.042,.401],[.082,.440],[.150,.372],[.086,.30],[.060,.29]];
  bayOutline.forEach(([z,y])=>crankBay.lineTo(z,y));crankBay.closePath();crankcaseSection.holes.push(crankBay);
  const blockGeometry=new T.ExtrudeGeometry(crankcaseSection,{depth:.457,bevelEnabled:false,steps:1});blockGeometry.rotateY(Math.PI/2);blockGeometry.translate(-.778,0,0);
  const crankcase=mesh("engine","Cast V6 crankcase",blockGeometry,mat.cast,[0,0,0],{serviceCover:true});
  for(const side of[-1,1])for(let i=0;i<3;i++){
    const frame=new T.Matrix4().compose(new T.Vector3(engineCylinderX(side,i),.29,0),new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(0,Math.SQRT1_2,side*Math.SQRT1_2)),new T.Vector3(1,1,1));
    crankcase.geometry.applyMatrix4(frame.clone().invert());openRadialPort(crankcase,[0,0],.0475,1,.150,true,.045);crankcase.geometry.applyMatrix4(frame);crankcase.geometry.computeVertexNormals();
    const axis=new T.Vector3(0,Math.SQRT1_2,side*Math.SQRT1_2),origin=new T.Vector3(engineCylinderX(side,i),.29,0);
    annulus("engine",`Liner flange seating shelf ${side} ${i}`,origin.clone().addScaledVector(axis,.161).toArray() as V,origin.clone().addScaledVector(axis,.165).toArray() as V,.0436,.049,mat.cast,{serviceCover:true});
  }
  for(const x of [-.296]){
    const endBlank=new T.ExtrudeGeometry(blockSection,{depth:.008,bevelEnabled:true,bevelSize:.003,bevelThickness:.002,bevelSegments:2});
    const endGeometry=servicePassage(endBlank,Array.from({length:32},(_,i)=>new T.Vector2(Math.cos(i*Math.PI/16)*.0228,.29+Math.sin(i*Math.PI/16)*.0228)));endBlank.dispose();
    endGeometry.rotateY(Math.PI/2);endGeometry.translate(x,0,0);
    mesh("engine",`Engine timing end cover ${x}`,endGeometry,mat.darkMetal,[0,0,0],{serviceCover:true});
  }
  const engineCore=createEngineCore(mat);engineCore.add(createEngineHeads(mat));createEngineTiming(engineCore,mat);createEnginePneumatics(engineCore,mat);createEngineMotion(engineCore)(ENGINE_CORE.initialAngle);group("engine").add(engineCore);
  annulus("engine","Rear crank seal",[-.951,.29,0],[-.94,.29,0],.0226,.052,mat.darkMetal);
  for(const s of [-1,1]){
    for(const y of [.245,.38]){
      cylinder("engine",`Front mounting boss ${s} ${y}`,[s===1&&y===.38?-.300:-.305,y,s*.107],[-.283,y,s*.107],.014,mat.cast,.014,{serviceCover:true});
      cylinder("engine",`Front mounting stud ${s} ${y}`,[-.283,y,s*.107],[-.277,y,s*.107],.006,mat.metal,.006,{serviceCover:true});
    }
  }
  const plenum=loft("intake","Intake plenum",[[-.90,.55,.64,.085],[-.75,.54,.66,.115],[-.36,.55,.65,.11],[-.28,.56,.61,.065]],mat.carbon,{serviceCover:true});
  // Retain the established outer shape but give the plenum a real cavity and
  // a drilled inlet face. The inner aft cap seals the pressure vessel.
  {
    const source=plenum.geometry.attributes.position,n=source.count,positions=Array.from(source.array),rows=n/40,indices:number[]=[];
    for(let row=0;row<rows;row++){
      let centre=0;for(let j=0;j<40;j++)centre+=source.getY(row*40+j);centre/=40;
      for(let j=0;j<40;j++){const i=row*40+j;positions.push(source.getX(i)+(row===0?.002:row===rows-1?-.002:0),centre+(source.getY(i)-centre)*.95,source.getZ(i)*.975);}
    }
    for(let row=0;row<rows-1;row++)for(let j=0;j<40;j++){
      const a=row*40+j,b=row*40+(j+1)%40,c=b+40,d=a+40;indices.push(a,b,d,b,c,d,a+n,d+n,b+n,b+n,d+n,c+n);
    }
    for(let j=1;j<39;j++)indices.push(0,j+1,j,n,n+j,n+j+1);
    const g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();plenum.geometry.dispose();plenum.geometry=g;
    const shape=new T.Shape();for(let j=0;j<40;j++){const i=(rows-1)*40+j,z=source.getZ(i),y=source.getY(i);if(j)shape.lineTo(-z,y);else shape.moveTo(-z,y);}shape.closePath();
    const hole=new T.Path();hole.absarc(0,.585,.0205,0,Math.PI*2,true);shape.holes.push(hole);
    const face=new T.ExtrudeGeometry(shape,{depth:.002,bevelEnabled:false,steps:1,curveSegments:32});face.rotateY(Math.PI/2);face.translate(-.282,0,0);
    mesh("intake","Plenum inlet face",face,mat.carbon,[0,0,0],{serviceCover:true});
  }
  const turbo=createTurbocharger(mat);group("turbo").add(turbo.root);
  // The rear airbox perimeter feeds a hollow reducer. Its outlet and the
  // filtered duct share the same centre and bore, rather than meeting below it.
  const airboxOutlet:V=[-.42,.895,0];
  {
    const rim=inletInner.getPoints(32);if(rim[0].distanceTo(rim.at(-1)!)<1e-8)rim.pop();
    const radial=rim.length,rows=24,positions:number[]=[],indices:number[]=[];
    for(const inner of[false,true])for(let row=0;row<=rows;row++){
      const t=row/rows,e=t*t*(3-2*t);
      for(const p of rim){
        const y=.934+(p.y-.934)*.87,z=-p.x*.72,angle=Math.atan2(z,y-.931),r=inner?.0345:.037;
        const wall=inner?0:.0025;
        positions.push(T.MathUtils.lerp(-.24,airboxOutlet[0],t),T.MathUtils.lerp(y+Math.cos(angle)*wall,airboxOutlet[1]+Math.cos(angle)*r,e),T.MathUtils.lerp(z+Math.sin(angle)*wall,Math.sin(angle)*r,e));
      }
    }
    const n=(rows+1)*radial;
    for(let row=0;row<rows;row++)for(let j=0;j<radial;j++){
      const a=row*radial+j,b=row*radial+(j+1)%radial,c=a+radial,d=b+radial;
      indices.push(a,c,b,b,c,d,a+n,b+n,c+n,b+n,d+n,c+n);
    }
    for(const row of[0,rows])for(let j=0;j<radial;j++){
      const a=row*radial+j,b=row*radial+(j+1)%radial;
      if(row)indices.push(a,b,a+n,b,b+n,a+n);else indices.push(a,a+n,b,b,a+n,b+n);
    }
    const g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();
    mesh("intake","Airbox outlet reducer",g,mat.carbon,[0,0,0],{serviceCover:true});
  }
  hollowTube("intake","Filtered air duct",[airboxOutlet,[-.48,.895,0],[-.68,.78,0],[-.87,.64,0],[-.90,.55,0],[-.934,.51,0],turbo.ports.airInlet],.037,.0025,mat.carbon);
  annulus("intake","Compressor inlet coupling",[turbo.ports.airInlet[0]+.006,.51,0],[turbo.ports.airInlet[0]-.006,.51,0],.0345,.040,mat.darkMetal);
  const crankHeight=W17_REFERENCE_HEIGHT+.09,engineHeightOffset=crankHeight-.29,plenumHeightOffset=engineHeightOffset+.016;
  const chargeCooler=createChargeCooler(mat);group("intake").add(chargeCooler.root);
  hollowTube("intake","Hot charge pipe",[turbo.ports.chargeOutlet,[-1.0485,.478,.181],[-.995,.486,.227],[-.88,.52,.245],chargeCooler.ports.hot],.0218,.0018,mat.carbon);
  const plenumPort:V=[-.280,.585+plenumHeightOffset,0];
  hollowTube("intake","Cooled charge pipe",[chargeCooler.ports.cold,[-.227,.538,.245],[-.178,.51,.19],[-.185,.465,.07],[-.236,plenumPort[1],0],plenumPort],.022,.0015,mat.carbon);
  annulus("intake","Plenum inlet collar",[-.280,plenumPort[1],0],[-.268,plenumPort[1],0],.0205,.024,mat.metal);
  group("intake").userData.ports={...chargeCooler.ports,plenum:plenumPort,compressor:turbo.ports.chargeOutlet};
  for(const name of["Hot charge pipe","Cooled charge pipe"]){
    const pipe=root.getObjectByName(name) as T.Mesh,route=pipe.userData.route as V[],curve=new T.CatmullRomCurve3(route.map(p=>new T.Vector3(...p)),false,"centripetal");
    for(const t of[.02,.98]){const p=curve.getPoint(t),axis=curve.getTangent(t);annulus("intake",`${name} clamp ${t}`,p.clone().addScaledVector(axis,-.003).toArray() as V,p.clone().addScaledVector(axis,.003).toArray() as V,.0218,.0255,mat.metal);}
  }
  for(const side of [-1,1]){
    const collector:V=[-1.10,.386,side*.20];
    for(let i=0;i<3;i++){
      const x=engineCylinderX(side,i);
      const port=engineHeadPort(side,i,"exhaust",crankHeight),normal=new T.Vector3(0,Math.SQRT1_2,side*Math.SQRT1_2);
      const route:V[]=[port,new T.Vector3(...port).addScaledVector(normal,.016).toArray() as V,[x,.285,side*.280],[x,.310,side*.343],[x-.025,.355,side*.374],[x-.060,.370+i*.028,side*(.367+i*.003)],[-.95,.390+i*.028,side*.337],[-1.012,.39+i*.020,side*.265],collector];
      hollowTube("exhaust",`Exhaust primary ${side} ${i}`,route,.019,.0012,mat.bronze);
      const start=new T.Vector3(...route[0]),axis=new T.CatmullRomCurve3(route.map(p=>new T.Vector3(...p)),false,"centripetal").getTangent(0);
      const flange=annulus("exhaust",`Exhaust head flange ${side} ${i}`,start.clone().addScaledVector(axis,-.006).toArray() as V,start.clone().addScaledVector(axis,.003).toArray() as V,.019,.024,mat.darkMetal);
      flange.userData.pipeSeat=start.toArray();flange.userData.pipeAxis=axis.toArray();
    }
    const route:V[]=side>0?[collector,[-1.16,.375,.14],[-1.18,.375,-.10],[-1.18,.420,-.202]]:[collector,[-1.14,.397,-.218],[-1.18,.420,-.202]];
    hollowTube("exhaust",`Exhaust collector ${side}`,route,.023,.0012,mat.bronze);
  }
  hollowTube("exhaust","Exhaust turbine feed",[[-1.18,.420,-.202],[-1.1915,.444,-.211],[-1.1915,.470,-.187],turbo.ports.exhaustInlet],.023,.0012,mat.bronze);
  // Keep the compact outlet height, but finish the descent before the final
  // 150 mm. C3.9.2(h) allows a level/upward exit, never a downward-facing one.
  const exhaustRoute:V[]=[turbo.ports.exhaustOutlet,[-1.31,.51,0],[-1.43,.49,0],[-1.70,.49,0],[-1.82,.485,0],[-1.87,.470,0],[-1.89,.470,0],[-1.94,.470,0],[-2.04,.470,0]];
  hollowTube("exhaust","Exhaust tailpipe",exhaustRoute,.036,.0012,mat.bronze);
  // The shield follows the pipe's route. Cut its bore in the pipe's frame
  // so the top stays intact instead of opening a long slot over the exhaust.
  {
    const points=new T.CatmullRomCurve3(exhaustRoute.map(p=>new T.Vector3(...p)),false,"centripetal").getSpacedPoints(256);
    const heightAt=(x:number)=>{
      for(let i=1;i<points.length;i++)if(x>=points[i].x)return T.MathUtils.lerp(points[i-1].y,points[i].y,T.MathUtils.clamp((x-points[i-1].x)/(points[i].x-points[i-1].x),0,1));
      return points.at(-1)!.y;
    };
    const shield=root.getObjectByName("Tail heat shield") as T.Mesh;
    let positions=shield.geometry.attributes.position;
    for(let i=0;i<positions.count;i++)positions.setY(i,positions.getY(i)-heightAt(positions.getX(i)));
    shield.geometry.rotateY(Math.PI/2);openRadialPort(shield,[0,0],.043,1,1.44);shield.geometry.rotateY(-Math.PI/2);
    // Subdivide the long bore faces before bending them along the pipe.
    // Otherwise each face remains a straight chord through the curved outlet.
    const unbent=shield.geometry;unbent.deleteAttribute("normal");
    const refined=new TessellateModifier(.018,8).modify(unbent);
    shield.geometry=mergeVertices(refined,1e-7);unbent.dispose();refined.dispose();
    positions=shield.geometry.attributes.position;
    for(let i=0;i<positions.count;i++)positions.setY(i,positions.getY(i)+heightAt(positions.getX(i)));
    // Recess the entire overlap beneath the actual faceted body, not only the
    // leading lip. Coincident lofts with different tessellation poke through
    // one another even when their ideal cross-sections agree.
    const ray=new T.Raycaster(),bodyMaterial=sidepod.material as T.Material,oldSide=bodyMaterial.side;
    bodyMaterial.side=T.DoubleSide;sidepod.updateMatrixWorld(true);
    for(let i=0;i<positions.count;i++){
      const x=positions.getX(i),overlap=x-shellPoints.getX(0);
      if(overlap<0||Math.hypot(positions.getY(i)-heightAt(x),positions.getZ(i))<.045)continue;
      const origin=new T.Vector3(x,.40,0),point=new T.Vector3().fromBufferAttribute(positions,i),radial=point.clone().sub(origin);
      ray.set(origin,radial.clone().normalize());ray.far=.45;
      const hit=ray.intersectObject(sidepod,false)[0];
      if(!hit)continue; // The lower lip already sits inside the open underbody.
      const inset=T.MathUtils.lerp(.004,.008,T.MathUtils.smoothstep(overlap,0,.04));
      point.copy(origin.addScaledVector(ray.ray.direction,Math.min(radial.length(),hit.distance-inset)));
      positions.setXYZ(i,point.x,point.y,point.z);
    }
    bodyMaterial.side=oldSide;
    shield.geometry.computeVertexNormals();
    // Both ends are open: the front receives cooling air from the engine bay,
    // and the rear discharges it around the separate exhaust sleeve. Return
    // the 2 mm laminate at both rims instead of sealing the outlet with a cap.
    const source=shield.geometry,sourceIndex=source.index!,outerIndices:number[]=[];
    for(let i=0;i<sourceIndex.count;i+=3){
      const face=[sourceIndex.getX(i),sourceIndex.getX(i+1),sourceIndex.getX(i+2)];
      if([-1.49,-1.98].some(x=>face.every(j=>Math.abs(positions.getX(j)-x)<1e-6)))continue;
      outerIndices.push(...face);
    }
    source.setIndex(outerIndices);source.deleteAttribute("normal");
    const exterior=mergeVertices(source,1e-7);exterior.computeVertexNormals();
    const vertices=exterior.attributes.position,normals=exterior.attributes.normal,index=exterior.index!,count=vertices.count;
    const shellPositions=Array.from(vertices.array),shellIndices=Array.from(index.array),edges=new Map<string,{a:number;b:number;count:number}>();
    for(let i=0;i<count;i++)shellPositions.push(vertices.getX(i)-normals.getX(i)*.002,vertices.getY(i)-normals.getY(i)*.002,vertices.getZ(i)-normals.getZ(i)*.002);
    for(let i=0;i<index.count;i+=3){
      const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2);shellIndices.push(a+count,c+count,b+count);
      for(const [from,to]of[[a,b],[b,c],[c,a]]){
        const key=`${Math.min(from,to)}/${Math.max(from,to)}`,edge=edges.get(key);
        if(edge)edge.count++;else edges.set(key,{a:from,b:to,count:1});
      }
    }
    for(const {a,b,count:uses}of edges.values())if(uses===1)shellIndices.push(a,b+count,b,a,a+count,b+count);
    const shell=new T.BufferGeometry();shell.setAttribute("position",new T.Float32BufferAttribute(shellPositions,3));shell.setIndex(shellIndices);shell.computeVertexNormals();
    shield.geometry=shell;shield.userData.laminateThickness=.002;source.dispose();exterior.dispose();
    annulus("bodywork","Exhaust outlet shield rim",[-1.983,heightAt(-1.983),0],[-1.977,heightAt(-1.977),0],.043,.047,mat.darkMetal,{cover:true});
    // Narrow lateral stays retain the separate exhaust sleeve after opening
    // the cooling outlet. Their ends follow the actual tapered outer wall.
    const probe=new T.Mesh(shell,new T.MeshBasicMaterial({side:T.DoubleSide}));
    const stayX=-1.94,stayY=heightAt(stayX);
    for(const side of[-1,1]){
      const hits=new T.Raycaster(new T.Vector3(stayX,stayY,0),new T.Vector3(0,0,side),0,.15).intersectObject(probe,false);
      const outer=hits.at(-1)!.distance-.0004,inner=.0435;
      box("bodywork",`Tail exhaust sleeve stay ${side}`,[stayX,stayY,side*(outer+inner)/2],[.016,.002,outer-inner],mat.darkMetal,{cover:true});
    }
    probe.material.dispose();
  }
  annulus("exhaust","Turbine outlet clamp",[turbo.ports.exhaustOutlet[0]-.006,.51,0],[turbo.ports.exhaustOutlet[0]+.006,.51,0],.0348,.041,mat.darkMetal);
  const wastegate=createWastegate(mat);group("exhaust").add(wastegate.root);
  // The bypass rejoins the sole tailpipe after the turbine (FIA C5.1.14).
  // Both branch connections have real bores through the parent pipe walls.
  const feed=root.getObjectByName("Exhaust turbine feed") as T.Mesh;
  openRadialPort(feed,[-1.1915,.450],.0138,1,-.208);
  const tailpipe=root.getObjectByName("Exhaust tailpipe") as T.Mesh;
  openRadialPort(tailpipe,[-1.31,.510],.0138,-1);
  hollowTube("exhaust","Wastegate inlet pipe",[[-1.1915,.450,-.195],[-1.1915,.450,-.165],[-1.17,.465,-.18],wastegate.ports.inlet],.015,.0012,mat.bronze,{internal:true});
  // Turn below the turbine, then pass outboard of the hydraulic manifold
  // and rear clevis. The approach clears the separate wastegate feed before
  // turning outward. Tangent-matched bends keep the 30 mm tube round.
  const wastegateReturn=new T.CurvePath<T.Vector3>();
  const returnNeck:V=[-1.096,.465,-.127];
  wastegateReturn.add(new T.LineCurve3(new T.Vector3(...wastegate.ports.outlet),new T.Vector3(...returnNeck)));
  const returnBends:V[][]=[
    [returnNeck,[-1.096,.465,-.1082],[-1.1112,.45705,-.093],[-1.130,.450,-.093]],
    [[-1.130,.450,-.093],[-1.170,.435,-.093],[-1.190,.430,-.150],[-1.25,.430,-.150]],
    [[-1.25,.430,-.150],[-1.36,.430,-.150],[-1.31,.510,-.130],[-1.31,.510,-.028]],
  ];
  for(const [a,b,c,d]of returnBends)wastegateReturn.add(new T.CubicBezierCurve3(new T.Vector3(...a),new T.Vector3(...b),new T.Vector3(...c),new T.Vector3(...d)));
  hollowTube("exhaust","Wastegate return pipe",wastegateReturn.getSpacedPoints(128).map(p=>p.toArray() as V),.015,.0012,mat.bronze,{internal:true});
  for(const [name,port,axis]of[["inlet",wastegate.ports.inlet,[-1,0,0]],["outlet",wastegate.ports.outlet,[0,0,1]]] as const){
    const centre=new T.Vector3(...port),direction=new T.Vector3(...axis);
    annulus("exhaust",`Wastegate ${name} pipe clamp`,centre.clone().addScaledVector(direction,-.003).toArray() as V,centre.clone().addScaledVector(direction,.004).toArray() as V,.015,.021,mat.darkMetal,{internal:true});
  }
  for(const z of[-.204,-.156]){
    annulus("exhaust",`Wastegate bracket eye ${z}`,[-1.045,.465,z],[-1.038,.465,z],.003,.006,mat.darkMetal,{internal:true});
    cylinder("exhaust",`Wastegate mounting bolt ${z}`,[-1.058,.465,z],[-1.035,.465,z],.0028,mat.metal,.0028,{internal:true});
    cylinder("exhaust",`Wastegate support strut ${z}`,[-1.040,.465,z],[-.947,.370,z],.0045,mat.darkMetal,.0045,{internal:true});
    box("exhaust",`Wastegate engine pad ${z}`,[-.941,.370,z],[.010,.028,.022],mat.darkMetal,{internal:true});
    cylinder("exhaust",`Wastegate engine fixing ${z}`,[-.951,.370,z],[-.932,.370,z],.003,mat.metal,.003,{internal:true});
  }
  const chargePipe=root.getObjectByName("Hot charge pipe") as T.Mesh;
  openRadialPort(chargePipe,[-.995,.486],.002,1,.227);
  annulus("intake","Wastegate boost reference union",[-.995,.486,.250],[-.995,.486,.273],.002,.0045,mat.metal,{internal:true});
  hollowTube("exhaust","Wastegate pressure reference",[[-.995,.486,.273],[-.995,.486,.292],[-1.03,.38,.19],[-1.03,.34,0],[-1.03,.35,-.22],[-1.04,.43,-.25],[-1.034,.465,-.250],wastegate.ports.pressure],.0035,.001,mat.black,{internal:true,installedOnly:true});
  // Motor-generator, clutch, eight-speed gear train and rear differential.
  // A complete multi-plate carbon clutch, not an unsupported pile of discs.
  // The 97 mm friction diameter is an AP Racing family reference; it is not a
  // published Mercedes clutch dimension. Carrier, spring and release ring form
  // one assembly between the crankshaft and gearbox input.
  annulus("clutch","Clutch flywheel flange",[-.944,.29,0],[-.952,.29,0],.021,.063,mat.darkMetal);
  annulus("clutch","Clutch splined hub",[-.95,.29,0],[-1.031,.29,0],.012,.022,mat.metal);
  for(let i=0;i<7;i++)annulus("clutch",`Carbon clutch plate ${i}`,[-.955-i*.007,.29,0],[-.960-i*.007,.29,0],.024,.0485,i%2?mat.metal:mat.carbon);
  for(let i=0;i<18;i++){
    const a=i*Math.PI/9;
    const tooth=box("clutch",`Clutch hub spline ${i}`,[-.990,.29+Math.cos(a)*.022,Math.sin(a)*.022],[.072,.004,.0028],mat.metal);tooth.rotation.x=a;
  }
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3,y=.29+Math.cos(a)*.055,z=Math.sin(a)*.055;
    cylinder("clutch",`Clutch basket pillar ${i}`,[-.949,y,z],[-1.020,y,z],.0045,mat.darkMetal);
    cylinder("clutch",`Clutch cover bolt ${i}`,[-1.020,y,z],[-1.026,y,z],.006,mat.metal,.006,{serviceCover:true});
    for(let plate=0;plate<7;plate++){
      const tab=box("clutch",`Clutch drive tab ${i} ${plate}`,[-.9575-plate*.007,.29+Math.cos(a)*.050,Math.sin(a)*.050],[.005,.008,.010],plate%2?mat.metal:mat.carbon);tab.rotation.x=a;
    }
  }
  annulus("clutch","Clutch pressure plate",[-1.004,.29,0],[-1.011,.29,0],.023,.053,mat.darkMetal,{serviceCover:true});
  annulus("clutch","Clutch cover rim",[-1.015,.29,0],[-1.022,.29,0],.043,.063,mat.darkMetal,{serviceCover:true});
  for(let i=0;i<18;i++){
    const a=i*Math.PI/9,points:number[]=[],indices:number[]=[];
    for(const offset of [-.0008,.0008])for(const [r,angle,x] of [[.019,a-.025,-1.031],[.049,a-.074,-1.019],[.049,a+.074,-1.019],[.019,a+.025,-1.031]])points.push(x+offset,.29+Math.cos(angle)*r,Math.sin(angle)*r);
    indices.push(0,2,1,0,3,2,4,5,6,4,6,7);
    for(let j=0;j<4;j++){const k=(j+1)%4;indices.push(j,k,j+4,k,k+4,j+4);}
    const spring=new T.BufferGeometry();spring.setAttribute("position",new T.Float32BufferAttribute(points,3));spring.setIndex(indices);spring.computeVertexNormals();
    mesh("clutch",`Clutch diaphragm finger ${i}`,spring,mat.metal,[0,0,0],{serviceCover:true});
  }
  annulus("clutch","Clutch release ring",[-1.029,.29,0],[-1.036,.29,0],.012,.023,mat.darkMetal,{serviceCover:true});
  // Place the crank, clutch and their attached engine hardware on the same
  // regulation datum. The sump is shallow enough to remain above the floor.
  for(const id of ["engine","clutch"])for(const part of group(id).children)part.position.y+=engineHeightOffset;
  const motor=createMotorGenerator(mat);motor.root.position.set(-.47,.160,.240);group("mguk").add(motor.root);
  const motorPort=(name:string):V=>new T.Vector3(...motor.ports[name]).add(motor.root.position).toArray() as V;
  const motorTransmission=createMotorTransmission(crankHeight,motor.root,engineCore,root.getObjectByName("Engine timing end cover -0.296") as T.Mesh,mat);
  group("mguk").add(motorTransmission.root);
  // Keep the remaining front casting closed around the local transmission
  // pocket. Shortening the complete block would leave both bank cavities open.
  const bridgeBlank=new T.ExtrudeGeometry(crankcaseSection,{depth:.023,bevelEnabled:false});
  bridgeBlank.rotateY(Math.PI/2);bridgeBlank.translate(-.321,engineHeightOffset,0);bridgeBlank.rotateY(-Math.PI/2);
  const bridgeGeometry=servicePassage(bridgeBlank,motorTransmission.caseOutline);bridgeBlank.dispose();bridgeGeometry.rotateY(Math.PI/2);
  mesh("engine","Front crankcase transmission bridge",bridgeGeometry,mat.cast,[0,0,0],{serviceCover:true});
  for(const offset of[-.083,.083]){
    const x=Number((motor.root.position.x+offset).toFixed(3));
    box("engine",`MGU-K engine mounting ledge ${x}`,[x,.152,.169],[.038,.010,.030],mat.cast,{serviceCover:true});
    cylinder("mguk",`MGU-K mounting stud ${x}`,[x,.147,.179],[x,.170,.179],.0033,mat.metal);
    annulus("mguk",`MGU-K mounting washer ${x}`,[x,.163,.179],[x,.166,.179],.0034,.006,mat.metal);
  }
  const inverterPort=energyStore.ports.power,power=motorPort("power");
  const powerRoute:V[]=[inverterPort,[.125,inverterPort[1],inverterPort[2]],[.119,.166,.110],[.119,.166,.20],[.119,.166,.23],[.119,.166,.28],[.119,.166,.30],[-.04,.166,.29],[-.12,.21,.30],[-.20,.20,.30],[-.255,power[1],power[2]],power];
  const cable=tube("inverter","High voltage cable",powerRoute,.009,mat.orange,{installedOnly:true});cable.userData.route=powerRoute;cable.userData.outerRadius=.009;
  annulus("inverter","Motor cable plug",[power[0]+.012,power[1],power[2]],power,.0045,.0115,mat.darkMetal,{installedOnly:true});
  const fuelSystem=createFuelSystem(mat);group("fuel").add(fuelSystem.root);
  // Drill the injector wells in the actual head/cover solids, in a frame whose
  // Z axis follows the injector. This leaves real wall thickness at each bore.
  root.updateMatrixWorld(true);
  const fuelBore=(part:T.Mesh,centre:V,axis:V,radius:number)=>{
    const q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(...axis));
    const frame=new T.Matrix4().compose(new T.Vector3(...centre),q,new T.Vector3(1,1,1));
    const transform=frame.clone().invert().multiply(part.matrixWorld);
    const source=part.geometry.clone().applyMatrix4(transform);
    const profile=Array.from({length:24},(_,i)=>new T.Vector2(Math.cos(i*Math.PI/12)*radius,Math.sin(i*Math.PI/12)*radius));
    const next=servicePassage(source,profile);source.dispose();
    next.applyMatrix4(transform.invert());part.geometry.dispose();part.geometry=next;
  };
  for(const bore of fuelSystem.injectorBores)for(const name of[`Cam cover ${bore.side}`,`Cylinder head housing ${bore.side}`,`Cylinder head ${bore.side} ${bore.index}`]){
    fuelBore(root.getObjectByName(name) as T.Mesh,bore.centre,bore.axis,bore.radius);
  }
  fuelBore(root.getObjectByName("Head end wall -1 front") as T.Mesh,fuelSystem.pumpDrive,[1,0,0],.0065);
  fuelBore(root.getObjectByName("Engine timing end cover -0.296") as T.Mesh,[-.296,crankHeight+.190,.070],[1,0,0],.0031);
  root.getObjectByName("Intake plenum")!.position.y+=plenumHeightOffset;
  root.getObjectByName("Plenum inlet face")!.position.y+=plenumHeightOffset;
  root.updateMatrixWorld(true);
  const plenumHeight=createSurfaceSampler([plenum],"y");
  for(const side of[-1,1] as const)for(let i=0;i<3;i++){
    const port=engineHeadPort(side,i,"intake",crankHeight),x=port[0],z=port[2],py=plenumHeight(x,z,-1)!;
    // Short runners enter the underside directly. The previous side entry
    // needed a tight return bend whose inner wall folded back on itself.
    const frame=new T.Matrix4().makeRotationX(Math.PI/2).multiply(plenum.matrixWorld);
    plenum.geometry.applyMatrix4(frame);openRadialPort(plenum,[x,-z],.0195,-1,(py+plenumHeight(x,z,1)!)/2);plenum.geometry.applyMatrix4(frame.invert());plenum.geometry.computeVertexNormals();
    const route:V[]=[port,[x,py+.001,z]];
    hollowTube("intake",`Cylinder intake runner ${side} ${i}`,route,.0185,.0015,mat.carbon);
    const collar=annulus("intake",`Cylinder intake coupling ${side} ${i}`,[x,py-.012,z],[x,py+.001,z],.0186,.023,mat.darkMetal);
    const positions=collar.geometry.attributes.position;
    for(let j=0;j<positions.count;j++)if(positions.getY(j)>.012)positions.setY(j,plenumHeight(x+positions.getX(j),z+positions.getZ(j),-1)!+.002-(py-.012));
    collar.geometry.computeVertexNormals();
  }
  const engineHarnessFlange=roundedBox("engine","Engine harness mounting flange",[-.283,.245,-.120],[.034,.042,.042],mat.cast,.003,{serviceCover:true});
  engineHarnessFlange.updateWorldMatrix(true,false);
  fuelBore(engineHarnessFlange,[-.283,.245,-.120],[0,1,0],.0011);
  fuelBore(engineHarnessFlange,[-.278,.250,-.120],[0,0,1],.0034);
  cylinder("electronics","Engine harness socket",[-.273,.245,-.120],[-.258,.245,-.120],.014,mat.darkMetal,.014,{installedOnly:true});
  cylinder("electronics","Engine harness plug",[-.261,.245,-.120],[-.249,.245,-.120],.015,mat.darkMetal,.015,{installedOnly:true});
  cylinder("electronics","Engine harness strain relief",[-.249,.245,-.120],loomRoute.at(-1)!,.012,mat.black,.006,{installedOnly:true});
  for(const dy of[-.014,.014])for(const dz of[-.014,.014])cylinder("engine",`Engine harness flange screw ${dy} ${dz}`,[-.269,.245+dy,-.120+dz],[-.264,.245+dy,-.120+dz],.0022,mat.metal,.0022,{serviceCover:true});
  createEngineIgnition(engineCore,mat);

  // C9.5.1: vertical longitudinal shafts, 100 mm centres; the eight-ratio
  // cluster starts 420 mm ahead of the differential. Tooth counts and casing
  // sections are an illustrative reconstruction, not Mercedes gear drawings.
  const mainHeight=crankHeight+.100,selectorHeight=mainHeight+.097,diffHeight=W17_REFERENCE_HEIGHT+.270;
  const gearboxCasing=loft("gearbox","Carbon gearbox casing",[[-1.84,.205,.437,.125],[-1.72,.187,.452,.15],[-1.63,.157,.442,.14],[-1.575,.085,.373,.104],[-1.28,.088,.366,.103],[-1.15,.079,.315,.084]],mat.carbon,{cover:true},3);
  {
    const outer=gearboxCasing.geometry,inner=outer.clone(),p=inner.attributes.position,n=inner.attributes.normal,ix=inner.index!;
    for(let i=0;i<p.count;i++)p.setXYZ(i,p.getX(i)-n.getX(i)*.003,p.getY(i)-n.getY(i)*.003,p.getZ(i)-n.getZ(i)*.003);
    for(let i=0;i<ix.count;i+=3){const a=ix.getX(i);ix.setX(i,ix.getX(i+2));ix.setX(i+2,a);}
    inner.computeVertexNormals();gearboxCasing.geometry=mergeGeometries([outer,inner]);outer.dispose();inner.dispose();
    gearboxCasing.userData.wallThickness=.003;
  }
  // The diffuser fits around the installed gearbox, including its low gear
  // cluster. The former straight centre fence cut through the last ratios,
  // while both inner roof edges intersected the casing's lower sidewalls.
  {
    gearboxCasing.updateMatrixWorld(true);
    const edge=createSurfaceSampler([gearboxCasing],"z"),bottom=createSurfaceSampler([gearboxCasing],"y");
    const spread=(distance:number)=>1-T.MathUtils.smoothstep(Math.abs(distance),0,.060);
    for(const side of[-1,1] as const){
      const rows=Array.from({length:82},(_,i)=>T.MathUtils.lerp(-1.23,-2.04,i/81));
      const widths=rows.map(x=>{
        let width=.08;
        for(const dx of[-.006,0,.006])for(const dy of[-.006,0,.006]){
          const z=edge(x+dx,diffuserHeightAt(x)+dy,side);
          if(z!==undefined)width=Math.max(width,Math.abs(z)+.006);
        }
        return width;
      });
      const points:T.Vector3[]=[],indices:number[]=[],boundary:number[]=[];
      for(const [i,x]of rows.entries()){
        const inner=.08+Math.max(...rows.map((sample,k)=>(widths[k]-.08)*spread(x-sample)));
        points.push(new T.Vector3(x,diffuserHeightAt(x)+.002,side*inner),new T.Vector3(x,diffuserHeightAt(x)+.002,side*T.MathUtils.lerp(.47,.45,i/81)));
        if(i<rows.length-1){const a=i*2;indices.push(...(side>0?[a,a+2,a+1,a+1,a+2,a+3]:[a,a+1,a+2,a+1,a+3,a+2]));}
      }
      boundary.push(0,...rows.map((_,i)=>i*2+1),...rows.slice(1).map((_,i)=>(rows.length-1-i)*2));
      if(side>0)boundary.reverse();
      const roof=root.getObjectByName(`Diffuser roof ${side}`) as T.Mesh;
      roof.geometry.dispose();roof.geometry=laminate(points,indices,boundary,.004);
    }
    const rows=Array.from({length:77},(_,i)=>T.MathUtils.lerp(-1.31,-2.07,i/76));
    const originalTop=(x:number)=>.075+(-1.31-x)/.76*.162;
    const recess=rows.map(x=>{
      let top=originalTop(x);
      for(const dx of[-.006,0,.006])for(const z of[-.006,0,.006]){
        const y=bottom(x+dx,z,-1);if(y!==undefined)top=Math.min(top,y-.006);
      }
      return originalTop(x)-top;
    });
    const outline=[new T.Vector2(rows[0],.05),new T.Vector2(rows.at(-1)!, .05)];
    for(const x of[...rows].reverse())outline.push(new T.Vector2(x,originalTop(x)-Math.max(...rows.map((sample,k)=>recess[k]*spread(x-sample)))));
    const geometry=new T.ExtrudeGeometry(new T.Shape(outline),{depth:.004,bevelEnabled:false});geometry.translate(0,0,-.002);
    const fence=root.getObjectByName("Diffuser fence 0") as T.Mesh;
    fence.geometry.dispose();fence.geometry=mergeVertices(geometry);geometry.dispose();
  }
  const bellProfile=[[.0645,0],[.068,0],[.070,.018],[.072,.18],[.072,.207],[.0645,.207],[.0645,0]].map(([r,y])=>new T.Vector2(r,y));
  const bellGeometry=new T.LatheGeometry(bellProfile,64),bellPoints=bellGeometry.attributes.position;
  for(let i=0;i<bellPoints.count;i++)bellPoints.setX(i,Math.max(bellPoints.getX(i),.078-crankHeight));
  bellGeometry.computeVertexNormals();
  const bell=mesh("gearbox","Clutch bell casing",bellGeometry,mat.carbon,[-.943,crankHeight,0],{cover:true});bell.rotation.z=Math.PI/2;
  for(let i=0;i<8;i++){
    const a=(i+.5)*Math.PI/4,y=crankHeight+Math.cos(a)*.068,z=Math.sin(a)*.068;
    cylinder("gearbox",`Bell casing fastener ${i}`,[-.944,y,z],[-.940,y,z],.003,mat.metal,.003,{cover:true});
  }
  annulus("gearbox","Main bearing casing cover",[-1.15,mainHeight,0],[-1.143,mainHeight,0],.014,.041,mat.darkMetal,{cover:true});
  cylinder("gearbox","Gearbox input shaft",[-.955,crankHeight,0],[-1.578,crankHeight,0],.0115,mat.metal);
  cylinder("gearbox","Gearbox main shaft",[-1.255,mainHeight,0],[-1.659,mainHeight,0],.014,mat.darkMetal);
  function gear(name:string,x:number,y:number,teeth:number,phase=0){
    const pitchRadius=teeth*.001,shape=new T.Shape();
    for(let tooth=0;tooth<teeth;tooth++)for(const [fraction,r] of [[0,pitchRadius-.0025],[.15,pitchRadius-.0025],[.31,pitchRadius+.002],[.69,pitchRadius+.002],[.85,pitchRadius-.0025]]){
      const a=(tooth+fraction)*2*Math.PI/teeth+phase,px=Math.cos(a)*r,py=Math.sin(a)*r;
      if(!tooth&&!fraction)shape.moveTo(px,py);else shape.lineTo(px,py);
    }
    shape.closePath();const bore=new T.Path();bore.absarc(0,0,.0155,0,Math.PI*2,true);shape.holes.push(bore);
    const geometry=new T.ExtrudeGeometry(shape,{depth:.018,bevelEnabled:true,bevelSize:.00035,bevelThickness:.00035,bevelSegments:1,steps:1,curveSegments:24});
    geometry.rotateY(Math.PI/2);geometry.translate(x-.018,y,0);
    const part=mesh("gearbox",name,geometry,mat.metal);part.userData.pitchRadius=pitchRadius;return part;
  }
  for(let i=0;i<8;i++){
    const x=-1.28-i*.035,primaryTeeth=24+i*4;
    gear(`Primary ratio gear ${i+1}`,x,crankHeight,primaryTeeth);
    gear(`Main ratio gear ${i+1}`,x,mainHeight,100-primaryTeeth,Math.PI/(100-primaryTeeth));
    annulus("gearbox",`Input gear hub ${i}`, [x-.020,crankHeight,0],[x+.002,crankHeight,0],.0115,.017,mat.darkMetal);
    if(i%2===0){
      const collarX=x-.026;
      annulus("gearbox",`Selector dog ring ${i/2}`,[collarX-.004,mainHeight,0],[collarX+.004,mainHeight,0],.014,.028,mat.darkMetal);
      // Each fork wraps a collar and reaches the shift rail above the cluster.
      const forkPoints:V[]=Array.from({length:17},(_,j)=>{const a=-Math.PI*.76+j/16*Math.PI*1.52;return [collarX,mainHeight+Math.cos(a)*.031,Math.sin(a)*.031];});
      tube("gearbox",`Selector fork ${i/2}`,forkPoints,.0035,mat.cast);
      cylinder("gearbox",`Selector fork stem ${i/2}`,[collarX,mainHeight+.031,0],[collarX,selectorHeight,0],.004,mat.cast);
    }
  }
  cylinder("gearbox","Gear selector barrel",[-1.27,selectorHeight,0],[-1.56,selectorHeight,0],.014,mat.darkMetal);
  const finalDrive=createFinalDrive(mainHeight,diffHeight,mat);
  group("gearbox").add(finalDrive.gearbox);group("differential").add(finalDrive.differential);
  for(const x of [-1.252,-1.56])for(const [label,y,r] of [["input",crankHeight,.027],["main",mainHeight,.030]] as const){
    annulus("gearbox",`Gearbox ${label} bearing ${x}`,[x-.007,y,0],[x+.007,y,0],label==="input"?.0115:.014,r,mat.darkMetal);
    annulus("gearbox",`Gearbox ${label} bearing seal ${x}`,[x-.008,y,0],[x-.009,y,0],r-.008,r-.002,mat.metal);
  }
  tube("gearbox","Gear cluster oil rail",[[-1.25,.305,.070],[-1.40,.305,.070],[-1.565,.305,.070]],.004,mat.metal);
  for(let i=0;i<8;i++)cylinder("gearbox",`Gear oil jet ${i}`,[-1.288-i*.035,.305,.07],[-1.288-i*.035,.283,.038],.002,mat.metal);
  gearboxCasing.updateMatrixWorld(true);
  for(const side of [-1,1]){
    // Put the cover seam and its fasteners on the actual loft surface.
    const seam:V[]=[];
    for(let i=0;i<=24;i++){
      const x=-1.175-i*.018,y=.294;
      const hit=new T.Raycaster(new T.Vector3(x,y,side),new T.Vector3(0,0,-side)).intersectObject(gearboxCasing)[0];
      if(hit)seam.push([x,y,hit.point.z+side*.001]);
    }
    tube("gearbox",`Gearbox casing service seam ${side}`,seam,.0017,mat.darkMetal,{cover:true});
    for(const i of [1,7,13,19,23]){
      const [x,y,z]=seam[i];cylinder("gearbox",`Gearbox casing seam bolt ${side} ${i}`,[x,y,z],[x,y,z+side*.003],.004,mat.metal,.004,{cover:true});
    }
  }
  // Final drive and joint centres follow the differential axis, not the wheel
  // centre height: the half-shafts run upwards to the rear hubs.
  for(const side of [-1,1]){
    openRadialPort(gearboxCasing,[-1.7,diffHeight],.050,side);
    const flange=new T.LatheGeometry([[.0178,.109],[.027,.109],[.027,.117],[.027,.119],[.025,.125],[.025,.136],[.029,.140],[.029,.153],[.0178,.153],[.0178,.109]].map(([r,z])=>new T.Vector2(r,z)),48);
    flange.rotateX(side*Math.PI/2);flange.translate(-1.7,diffHeight,0);
    mesh("differential",`Differential output flange ${side}`,flange,mat.metal);
    cylinder("differential",`Half shaft ${side}`,[-1.7,diffHeight,side*.175],[-1.7,.355,side*.513],.016,mat.darkMetal);
    ball("differential",`Inner CV joint ${side}`,[-1.7,diffHeight,side*.175],.032,mat.black);
    ball("differential",`CV joint ${side}`,[-1.7,.355,side*.513],.027,mat.black);
    const hubEnd=W17_WHEELS.rear.track/2+W17_WHEELS.rear.width/2-.022;
    cylinder("differential",`Rear drive stub ${side}`,[-1.7,.355,side*.513],[-1.7,.355,side*hubEnd],.018,mat.metal);
    for(const z of[.190,.498])annulus("differential",`Half shaft boot collar ${side} ${z}`,[-1.7,z<.2?diffHeight:.355,side*(z-.003)],[-1.7,z<.2?diffHeight:.355,side*(z+.003)],.015,.026,mat.darkMetal);
  }
  seatDifferential(gearboxCasing,group("differential"),diffHeight,mat);
  const hydraulicSystem=createHydraulicSystem(mat,crankHeight,selectorHeight);
  group("hydraulics").add(hydraulicSystem);
  const brakeByWire=createRearBrakeByWire(mat);group("brake-by-wire").add(brakeByWire);
  const coolingMouths=new Map<number,T.Vector3[]>();
  for(const side of [-1,1]){
    const throat=root.getObjectByName(`Recessed sidepod inlet ${side}`) as T.Mesh;
    const positions=throat.geometry.attributes.position,count=throat.userData.inletVertices as number;
    coolingMouths.set(side,Array.from({length:count},(_,i)=>new T.Vector3().fromBufferAttribute(positions,i+count)));
  }
  group("cooling").add(createCoolingSystem(mat,coolingMouths,{turbo:turbo.ports,charge:chargeCooler.ports,motor:{coolantIn:motorPort("coolantIn"),coolantOut:motorPort("coolantOut")},store:energyStore.ports}));
  // Shared protected route from the under-seat ES bay to the sidepod. The
  // penetration is a reconstructed service passage, not a W17 hardpoint.
  const serviceProfile=[[.095,.100],[.152,.100],[.152,.182],[.095,.182]].map(([x,y])=>new T.Vector2(x,y));
  for(const name of["Central floor-to-chassis fairing","Lower chassis enclosure","Lower side enclosure -1","Lower side enclosure 1","Cockpit inner lining -1","Cockpit inner lining 1"]){
    const skin=root.getObjectByName(name) as T.Mesh,old=skin.geometry;
    skin.geometry=servicePassage(old,serviceProfile);old.dispose();
  }
  // The opposite end now carries the low-voltage loom in its own sealed bore.
  const loomPanel=new T.Shape([new T.Vector2(.091,.096),new T.Vector2(.156,.096),new T.Vector2(.156,.186),new T.Vector2(.091,.186)]);
  const loomBore=new T.Path();loomBore.absarc(.123,.164,.007,0,Math.PI*2,true);loomPanel.holes.push(loomBore);
  mesh("monocoque","Loom service connector plate",new T.ExtrudeGeometry(loomPanel,{depth:.006,bevelEnabled:false,curveSegments:24}),mat.darkMetal,[0,0,-.276],{structural:true});
  annulus("monocoque","Loom service boot",[.123,.164,-.258],[.123,.164,-.282],.006,.010,mat.rubber,{structural:true});
  const servicePanel=new T.Shape([new T.Vector2(.091,.096),new T.Vector2(.156,.096),new T.Vector2(.156,.186),new T.Vector2(.091,.186)]);
  for(const [name,x,y,r]of[["supply",.126,.120,.006],["return",.117,.140,.006],["power",.119,.166,.009]] as const){
    const bore=new T.Path();bore.absarc(x,y,r+.001,0,Math.PI*2,true);servicePanel.holes.push(bore);
    annulus("monocoque",`ES service boot ${name}`,[x,y,.258],[x,y,.280],r,r+.003,mat.rubber,{structural:true});
  }
  mesh("monocoque","ES service passage connector plate",new T.ExtrudeGeometry(servicePanel,{depth:.006,bevelEnabled:false,curveSegments:24}),mat.darkMetal,[0,0,.270],{structural:true});
  for(const side of[-1,1]){
    for(const x of[.093,.154])box("monocoque",`ES service frame upright ${side} ${x}`,[x,.141,side*.255],[.005,.090,.042],mat.carbon,{structural:true});
    for(const y of[.098,.184])box("monocoque",`ES service frame crossbar ${side} ${y}`,[.1235,y,side*.255],[.065,.005,.042],mat.carbon,{structural:true});
  }
  // A second sealed penetration enters the front engine connection. Both
  // walls of the modeled underbody pan are closed; the unused side is capped.
  const engineLoomBore=Array.from({length:16},(_,i)=>new T.Vector2(-.245+Math.cos(i*Math.PI/8)*.010,.215+Math.sin(i*Math.PI/8)*.010));
  const lowerEnclosure=root.getObjectByName("Lower chassis enclosure") as T.Mesh,oldEnclosure=lowerEnclosure.geometry;
  lowerEnclosure.geometry=servicePassage(oldEnclosure,engineLoomBore);oldEnclosure.dispose();
  annulus("monocoque","Engine loom bulkhead boot",[-.245,.215,-.262],[-.245,.215,-.230],.0065,.014,mat.rubber,{structural:true});
  cylinder("monocoque","Engine loom opposite blanking plug",[-.245,.215,.238],[-.245,.215,.252],.013,mat.carbon,.013,{structural:true});
  // Calibrate overhangs against the user's side reference at the same axle
  // scale. A perspective overhead photograph had lengthened the nose by 233 mm.
  for(const name of ["Silver nose skin","Nose structural core"]){
    const part=root.getObjectByName(name) as T.Mesh,p=part.geometry.attributes.position;
    const fixedRoot=name==="Nose structural core"?1.80:.687;
    for(let i=0;i<p.count;i++){const x=p.getX(i),t=T.MathUtils.clamp((x-fixedRoot)/(2.528-fixedRoot),0,1);p.setX(i,x+.100*Math.pow(t,1.7));}
    p.needsUpdate=true;part.geometry.computeVertexNormals();
  }
  // Seat the front flap drives and inner bearings on the finished nose skin.
  // Front-wing objects receive a 20 mm X offset at the end of the build.
  refitNoseRoof(root.getObjectByName("Silver nose skin") as T.Mesh);
  root.updateMatrixWorld(true);
  const noseSkin=root.getObjectByName("Silver nose skin") as T.Mesh;
  for(const side of [-1,1])for(const name of ["primary","secondary"]){
    const pin=root.getObjectByName(`${name} hinge pin ${side*frontFlapRoot}`) as T.Mesh;
    const inward=new T.Vector3(0,1,0).applyQuaternion(pin.quaternion).multiplyScalar(-side);
    const centre=pin.position.clone().add(new T.Vector3(.02,0,0));
    const seat=new T.Raycaster(centre.clone().addScaledVector(inward,-.03),inward,0,.20).intersectObject(noseSkin,false)[0];
    if(seat){
      const a=seat.point.clone().addScaledVector(inward,.006),b=centre.clone().addScaledVector(inward,.005);
      a.x-=.02;b.x-=.02;
      annulus("front-wing",`Front ${name} nose bearing ${side}`,a.toArray() as V,b.toArray() as V,.0082,.014,mat.darkMetal);
    }
    if(name==="secondary"){
      const drive=frontDrives.get(side)!;
      const from=new T.Vector3(drive.anchor[0]+.02,drive.anchor[1],side*.30);
      const hit=new T.Raycaster(from,new T.Vector3(0,0,-side),0,.30).intersectObject(noseSkin,false)[0];
      if(hit)drive.anchor[2]=hit.point.z+side*.003;
      actuator(drive.wing,`Front secondary actuator ${side}`,drive.anchor,drive.attachment);
    }
  }

  // Suspension, wheel bearings, ventilated brake discs and forged magnesium rims.
  const mountingSurfaces=["Silver nose skin","Nose structural core","Front suspension keel","Survival cell lower shell","Continuous undercut sidepod shell","Tail heat shield","Carbon gearbox casing"].map(name=>root.getObjectByName(name)!);
  root.updateMatrixWorld(true);
  function mountedAnchor(anchor:V,end:V):V {
    const from=new T.Vector3(...end),direction=new T.Vector3(...anchor).sub(from).normalize();
    const hit=new T.Raycaster(from,direction,0,1.5).intersectObjects(mountingSurfaces,false)[0];
    return hit?hit.point.addScaledVector(direction,.006).toArray() as V:anchor;
  }
  const frontCell=root.getObjectByName("Forward survival cell deck") as T.Mesh;
  // The cockpit shoulders overlap the rear of the forward deck. Seat the
  // clevis on the outer structural wall, not the deck hidden inside it.
  const frontCellWalls=[frontCell,...[-1,1].map(side=>root.getObjectByName(`Cockpit side ${side}`) as T.Mesh)];
  const frontCellSide=createSurfaceSampler(frontCellWalls,"z");
  function frontWishboneMount(name:string,point:V,side:1|-1):V {
    const [x,y]=point,surface=frontCellSide(x,y,side)!;
    const pivot:V=[x,y,surface+side*.025];
    // A conforming insert transfers the clevis load into the tub laminate.
    // Both faces follow the actual cell surface; the inner face overlaps it.
    const pad=new T.CylinderGeometry(1,1,.006,40);pad.rotateX(Math.PI/2);
    const positions=pad.attributes.position;
    for(let i=0;i<positions.count;i++){
      const px=x+positions.getX(i)*.036,py=y+positions.getY(i)*.022;
      positions.setXYZ(i,px,py,(frontCellSide(px,py,side)??surface)+side*(positions.getZ(i)+.001));
    }
    // Mirroring only the normal reverses the surface winding on the left.
    if(side<0){const index=pad.index!;for(let i=0;i<index.count;i+=3){const b=index.getX(i+1);index.setX(i+1,index.getX(i+2));index.setX(i+2,b);}}
    pad.computeVertexNormals();
    mesh("monocoque",`${name} chassis insert`,pad,mat.darkMetal,[0,0,0],{structural:true});
    for(const cheek of[-1,1]){
      const shape=new T.Shape();shape.moveTo(-.008,-.020);shape.lineTo(.025,-.014);
      shape.quadraticCurveTo(.044,-.014,.044,0);shape.quadraticCurveTo(.044,.014,.025,.014);shape.lineTo(-.008,.020);shape.closePath();
      const hole=new T.Path();hole.absarc(.025,0,.005,0,Math.PI*2,true);shape.holes.push(hole);
      const geometry=new T.ExtrudeGeometry(shape,{depth:.006,bevelEnabled:false,curveSegments:16});
      geometry.translate(0,0,-.003);geometry.rotateY(-side*Math.PI/2);geometry.translate(x+cheek*.014,y,surface);
      mesh("front-suspension",`${name} clevis cheek ${cheek}`,geometry,mat.cast);
      const fastenerZ=frontCellSide(x+cheek*.026,y,side)!;
      cylinder("front-suspension",`${name} mounting bolt ${cheek}`,[x+cheek*.026,y,fastenerZ-side*.008],[x+cheek*.026,y,fastenerZ+side*.006],.004,mat.metal);
    }
    annulus("front-suspension",`${name} spherical bearing`,[x-.009,y,pivot[2]],[x+.009,y,pivot[2]],.005,.012,mat.metal);
    cylinder("front-suspension",`${name} pivot bolt`,[x-.024,y,pivot[2]],[x+.024,y,pivot[2]],.0048,mat.darkMetal);
    for(const end of[-1,1])annulus("front-suspension",`${name} pivot washer ${end}`,[x+end*.017,y,pivot[2]],[x+end*.021,y,pivot[2]],.0048,.008,mat.metal);
    return pivot;
  }
  for(const front of [true,false])for(const s of [-1,1] as const){
    const id=front?"front-suspension":"rear-suspension",x=front?1.7:-1.7;
    const wheelSpec=front?W17_WHEELS.front:W17_WHEELS.rear;
    const z=s*wheelSpec.track/2,r=wheelSpec.radius,w=wheelSpec.width,inner=z-s*w/2;
    const prefix=`${front?"Front":"Rear"} ${s}`;
    const uprightZ=inner-s*.025;
    const outerUpper:V=[x-.012,.455,uprightZ],outerLower:V=[x+.005,.225,uprightZ];
    const upperAnchors:V[]=front?[[1.58,.467,s*.155],[.82,.555,s*.22]]:[[-1.56,.48,s*.145],[-1.14,.54,s*.16]];
    const lowerAnchors:V[]=front?[[1.58,.242,s*.155],[.91,.245,s*.225]]:[[-1.59,.22,s*.125],[-1.16,.235,s*.135]];
    function wishbone(name:string,anchor:V,end:V,chordWidth:number,sectionThickness:number,component=id,mount:"surface"|"rocker"|"fixed"="surface"){
      if(mount==="surface")anchor=mountedAnchor(anchor,end);
      const length=new T.Vector3(...end).distanceTo(new T.Vector3(...anchor));
      // A closed, tapered aerofoil fairing around the load path. The previous
      // scaled cylinder was only 9.9 mm deep and read as a thin wire head-on.
      // These 18–28 mm sections are photographic estimates, not W17 CAD.
      const points:number[]=[],indices:number[]=[],rings=24,radial=40;
      for(let ring=0;ring<=rings;ring++){
        const t=ring/rings,rootTaper=mount==="fixed"?.18:.62;
        const taper=Math.min(rootTaper+(1-rootTaper)*T.MathUtils.smoothstep(t,0,.15),.42+.58*T.MathUtils.smoothstep(1-t,0,.20));
        for(let j=0;j<radial;j++){
          const angle=j/radial*Math.PI*2,u=(1-Math.cos(angle))/2;
          const half=5*sectionThickness*(.2969*Math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1036*u**4);
          points.push((.30-u)*chordWidth*taper,(t-.5)*length,Math.sign(Math.sin(angle))*half*taper);
        }
      }
      for(let ring=0;ring<rings;ring++)for(let j=0;j<radial;j++){
        const a=ring*radial+j,b=ring*radial+(j+1)%radial;indices.push(a,a+radial,b,b,a+radial,b+radial);
      }
      for(let j=1;j<radial-1;j++){const end=rings*radial;indices.push(0,j,j+1,end,end+j+1,end+j);}
      const geometry=new T.BufferGeometry();geometry.setAttribute("position",new T.Float32BufferAttribute(points,3));geometry.setIndex(indices);geometry.computeVertexNormals();
      const arm=mesh(component,`${prefix} ${name}`,geometry,mat.carbon,new T.Vector3(...anchor).add(new T.Vector3(...end)).multiplyScalar(.5).toArray() as V);
      const span=new T.Vector3(...end).sub(new T.Vector3(...anchor)).normalize();
      const chord=new T.Vector3(1,0,0).addScaledVector(span,-span.x).normalize();
      const thickness=new T.Vector3().crossVectors(chord,span).normalize();
      arm.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(chord,span,thickness));
      arm.userData.anchor=anchor;arm.userData.rockerMount=mount==="rocker";arm.userData.terminal=end;arm.userData.armLength=length;
      if(mount!=="fixed")ball(component,`${prefix} ${name} inner joint`,anchor,.012,mat.darkMetal);
    }
    upperAnchors.forEach((anchor,i)=>wishbone(`upper wishbone ${i}`,front?frontWishboneMount(`${prefix} upper wishbone ${i}`,anchor,s):rearSuspensionMount(root,group(id),`${prefix} upper wishbone ${i}`,[i===0?-1.56:-1.23,anchor[1],anchor[2]],s,mat),outerUpper,.070,front?.022:.025,id,"fixed"));
    lowerAnchors.forEach((anchor,i)=>wishbone(`lower wishbone ${i}`,front?frontWishboneMount(`${prefix} lower wishbone ${i}`,anchor,s):rearSuspensionMount(root,group(id),`${prefix} lower wishbone ${i}`,[i===0?-1.59:-1.23,anchor[1],anchor[2]],s,mat),outerLower,.075,front?.026:.028,id,"fixed"));
    const inboard=createInboardSuspension(front,s,mat);group(id).add(inboard.root);
    const pushrodAnchor:V=inboard.pushrod;
    const pushrodEnd:V=[x+.024,.263,uprightZ];
    wishbone("pushrod",pushrodAnchor,pushrodEnd,.044,.025,id,"rocker");
    const trackEnd:V=[x-.070,.325,uprightZ],trackAnchor:V=front?[1.48,.28,s*.25]:rearSuspensionMount(root,group(id),`${prefix} track rod`,[-1.32,.315,s*.14],s,mat);
    if(front){
      ball("steering",`Steering rack joint ${s}`,trackAnchor,.012,mat.metal);
    }
    wishbone("track rod",trackAnchor,trackEnd,.045,.018,front?"steering":id,"fixed");
    cylinder(id,`${prefix} steering arm`,[x,.325,uprightZ],trackEnd,.009,mat.darkMetal);
    for(const [name,end] of [["upper",outerUpper],["lower",outerLower],["pushrod",pushrodEnd]] as const)ball(id,`${prefix} ${name} outer joint`,end,.014,mat.darkMetal);
    const upright=box(id,`${prefix} upright`,[x,.345,uprightZ],[front?.052:.076,.242,.031],mat.darkMetal);
    if(!front){
      for(const face of[-1,1])openRadialPort(upright,[0,r-.345],.032,face);
      annulus(id,`${prefix} hub bearing`,[x,r,uprightZ-s*.018],[x,r,uprightZ+s*.018],.0182,.032,mat.metal);
    }
    const brake=createWheelBrake(front,s,new T.Vector3(x,r,inner+s*.056),w,mat);group("brakes").add(brake.group);
    const hoseEnd=brake.hosePort.toArray() as V,hoseAnchor=mountedAnchor([front?1.4:-1.3,.33,s*.12],hoseEnd);
    if(!front)tube("brakes",`${prefix} brake hose`,[hoseAnchor,[(hoseAnchor[0]+hoseEnd[0])*.5,.375,(hoseAnchor[2]+hoseEnd[2])*.5],[hoseEnd[0],hoseEnd[1]+.02,hoseEnd[2]-s*.025],hoseEnd],.003,mat.black,{installedOnly:true});
    const wheelGroup=new T.Group();wheelGroup.name=`${prefix} wheel`;wheelGroup.position.set(x,r,z);wheelGroup.userData={component:"tyres",wheel:true,side:s,front};group("tyres").add(wheelGroup);
    function wheelMesh(name:string,g:T.BufferGeometry,m:T.Material,p:V=[0,0,0]) {const o=new T.Mesh(g,m);o.name=`${prefix} ${name}`;o.position.set(...p);o.castShadow=true;o.receiveShadow=true;o.userData.component="tyres";wheelGroup.add(o);return o;}
    const tyre=createSlickTyre(r,w);wheelMesh("rounded slick tyre",tyre.geometry,mat.rubber);
    addTyreSidewalls(wheelGroup,prefix,r,tyre.sidewall);
    // Closed inner and outer rim surfaces prevent a view through the wheel barrel.
    const rimProfile=[new T.Vector2(.216,-w/2+.01),new T.Vector2(.229,-w/2+.01),new T.Vector2(.229,w/2-.01),new T.Vector2(.216,w/2-.01),new T.Vector2(.209,w/2-.045),new T.Vector2(.209,-w/2+.045),new T.Vector2(.216,-w/2+.01)];
    const rim=new T.LatheGeometry(rimProfile,80);rim.rotateX(Math.PI/2);wheelMesh("closed rim barrel",rim,mat.darkMetal);
    // The stationary hollow brake shroud belongs to the brake assembly. The
    // tyre/rim spin around it; an opaque outer face remains behind the spokes.
    // A forged wheel has one outboard spoke face. Its inboard barrel surrounds
    // the brake drum; duplicating the spokes inside made it look like two rims.
    wheelMesh("inboard rim lip",new T.TorusGeometry(.230,.004,10,128),mat.darkMetal,[0,0,-s*(w/2-.007)]);
    for(const face of [s]){
      const faceZ=face*(w/2-.025);
      wheelMesh(`rim lip ${face}`,new T.TorusGeometry(.230,.004,10,128),mat.darkMetal,[0,0,face*(w/2-.007)]);
      const bowlSection=new T.Path();bowlSection.moveTo(.151,-.029);
      bowlSection.bezierCurveTo(.175,-.029,.185,-.018,.205,-.001);
      bowlSection.bezierCurveTo(.216,.009,.224,.016,.230,.018);
      bowlSection.lineTo(.230,.010);bowlSection.bezierCurveTo(.211,.004,.190,-.031,.168,-.035);
      bowlSection.lineTo(.151,-.035);bowlSection.closePath();
      const bowlProfile=bowlSection.getPoints(12).map(p=>new T.Vector2(p.x,faceZ+face*p.y));
      // The front profile runs from the hub outward, so its winding is the
      // opposite of the hub flange. Keep the visible forged skin outward.
      if(face>0)bowlProfile.reverse();
      const bowl=new T.LatheGeometry(bowlProfile,128);bowl.rotateX(Math.PI/2);wheelMesh(`recessed rim bowl ${face}`,bowl,mat.darkMetal);
      // Six paired channels and six broad windows form one forged face. The
      // supplied Mercedes image has radiused webs, not ten detached flat bars.
      const webShape=new T.Shape();webShape.absarc(0,0,.190,0,Math.PI*2,false);
      const hubBore=new T.Path();hubBore.absarc(0,0,.043,0,Math.PI*2,true);webShape.holes.push(hubBore);
      for(let pair=0;pair<6;pair++)for(const narrow of [true,false]){
        const profile=new T.Path(),width=narrow?.025:.062,rootWidth=narrow?.011:.014,base=narrow?.057:.062;
        profile.moveTo(-width,.170);profile.lineTo(-rootWidth,base+.013);
        profile.bezierCurveTo(-rootWidth,base-.003,rootWidth,base-.003,rootWidth,base+.013);
        profile.lineTo(width,.170);profile.quadraticCurveTo(0,.179,-width,.170);profile.closePath();
        const angle=pair*Math.PI/3+(narrow?0:Math.PI/6)+Math.PI/2;
        const points=profile.getPoints(20).map(p=>new T.Vector2(p.x*Math.cos(angle)-p.y*Math.sin(angle),p.x*Math.sin(angle)+p.y*Math.cos(angle)));
        webShape.holes.push(new T.Path(points));
      }
      const webGeometry=new T.ExtrudeGeometry(webShape,{depth:.010,bevelEnabled:true,bevelSize:.0016,bevelThickness:.0018,bevelSegments:3,curveSegments:48});
      const wp=webGeometry.attributes.position;
      for(let i=0;i<wp.count;i++)wp.setZ(i,face*(wp.getZ(i)-.026-(Math.hypot(wp.getX(i),wp.getY(i))-.06)*.055));
      if(face<0)for(const attribute of Object.values(webGeometry.attributes))for(let i=0;i<attribute.count;i+=3)for(let k=0;k<attribute.itemSize;k++){
        const a=(i+1)*attribute.itemSize+k,b=(i+2)*attribute.itemSize+k,value=attribute.array[a];attribute.array[a]=attribute.array[b];attribute.array[b]=value;
      }
      webGeometry.computeVertexNormals();
      const web=wheelMesh(`forged paired-spoke web ${face}`,webGeometry,mat.darkMetal,[0,0,faceZ]);web.userData.spokePairs=6;
      const hubProfile=[[.018,-.020],[.045,-.020],[.047,-.011],[.044,-.006],[.018,-.006],[.018,-.020]].map(([r,z])=>new T.Vector2(r,faceZ+face*z));
      if(face<0)hubProfile.reverse();const hub=new T.LatheGeometry(hubProfile,64);hub.rotateX(Math.PI/2);wheelMesh(`hub flange ${face}`,hub,mat.metal);
      const nutShape=new T.Shape();
      for(let i=0;i<48;i++){
        const angle=i*Math.PI*2/48,r=i%4<2?.030:.0245,x=Math.cos(angle)*r,y=Math.sin(angle)*r;
        if(i===0)nutShape.moveTo(x,y);else nutShape.lineTo(x,y);
      }
      nutShape.closePath();const lockBore=new T.Path();lockBore.absarc(0,0,.010,0,Math.PI*2,true);nutShape.holes.push(lockBore);
      const nut=new T.ExtrudeGeometry(nutShape,{depth:.012,bevelEnabled:true,bevelSize:.0008,bevelThickness:.0008,bevelSegments:2,curveSegments:24});
      if(face<0)nut.rotateY(Math.PI);wheelMesh(`centre lock ${face}`,nut,mat.metal,[0,0,faceZ-face*.006]);
      wheelMesh(`centre lock recess ${face}`,new T.TorusGeometry(.012,.002,8,32),mat.carbon,[0,0,faceZ+face*.008]);
      for(let i=0;i<6;i++){
        const a=i*Math.PI/3,lock=wheelMesh(`locking finger ${face} ${i}`,new RoundedBoxGeometry(.004,.015,.003,2,.001),mat.darkMetal,[Math.sin(a)*.026,Math.cos(a)*.026,faceZ+face*.008]);lock.rotation.z=-a+.22;
      }
      wheelMesh(`outer bead detail ${face}`,new T.TorusGeometry(.225,.0009,6,128),mat.darkMetal,[0,0,face*(w/2-.010)]);
      // Seat the valve in the sloped bowl instead of leaving a ring floating
      // at a fixed axial depth above the forged surface.
      const valveX=.062,valveY=.201,valveRadius=Math.hypot(valveX,valveY);
      const bowlFace=bowlSection.curves.slice(0,2).flatMap(curve=>curve.getPoints(24));
      const valveStation=bowlFace.findIndex(point=>point.x>=valveRadius),va=bowlFace[valveStation-1],vb=bowlFace[valveStation];
      const valveZ=faceZ+face*T.MathUtils.lerp(va.y,vb.y,(valveRadius-va.x)/(vb.x-va.x));
      const valve=new T.CylinderGeometry(.0035,.004,.013,10);valve.rotateX(Math.PI/2);
      wheelMesh("tyre valve",valve,mat.darkMetal,[valveX,valveY,valveZ+face*.0055]);
      wheelMesh("valve foot",new T.TorusGeometry(.005,.0014,6,16),mat.metal,[valveX,valveY,valveZ+face*.0007]);
      const valveCap=new T.CylinderGeometry(.0038,.0038,.005,8);valveCap.rotateX(Math.PI/2);
      wheelMesh("valve cap",valveCap,mat.black,[valveX,valveY,valveZ+face*.0135]);
    }
  }

  for(const [id,offset] of [["front-wing",.02],["rear-wing",0]] as const){
    group(id).children.forEach(part=>{part.position.x+=offset;if(part.userData.pivot)part.userData.pivot[0]+=offset;});
    for(const link of linkages)if(link.wing.userData.component===id)link.anchor.x+=offset;
  }
  seatHydraulicSystem(root,hydraulicSystem,mat);
  connectHydraulicPumpDrive(root,hydraulicSystem,mat);
  rebuildHydraulicPump(root,hydraulicSystem,mat);
  connectDifferentialHydraulics(root,hydraulicSystem,mat);
  seatEngineCoolantPumps(root);
  seatLowTemperaturePump(root);
  connectLowTemperatureDrive(root,group("cooling"),mat);
  connectMainCoolantDrives(root,group("cooling"),group("engine"),crankcaseSection,mat);
  connectOilPumpDrive(root,group("cooling"),mat);
  seatOilCooler(root,mat);
  seatSteeringSystem(root,steeringSystem,mat);
  seatPedalMounts(root,cockpitEquipment.cockpit,mat);
  connectSteeringSupply(root,hydraulicSystem,steeringSystem,mat);
  connectFrontBrakes(root,group("brakes"),mat);
  seatRearBrakeByWire(root,brakeByWire,mat);
  addNoseDetails(root,mat);
  openSuspensionPassages(root);
  group("safety").add(createRearLight(rearImpact,mat,impactRearX,lampY));
  createEngineMotion(root)(ENGINE_CORE.initialAngle);
  const internalSystems=new Set(["engine","turbo","fuel","cooling","mguk","battery","inverter","clutch","hydraulics","brake-by-wire","electronics"]);
  root.traverse(o=>{
    if(!(o instanceof T.Mesh))return;
    const id=o.userData.component as string;
    o.userData.internal=o.userData.internal||internalSystems.has(id)||
      (id==="intake"&&!["Open airbox shell","Recessed airbox throat"].includes(o.name))||
      (id==="exhaust"&&/Exhaust primary|Exhaust collector|Exhaust turbine feed|Exhaust head flange|Turbine outlet clamp/.test(o.name))||
      (id==="gearbox"&&!o.name.includes("casing"))||
      (id==="safety"&&o.name==="Fire extinguisher")||
      (id==="steering"&&/Steering column|Steering rack/.test(o.name))||
      (id==="cockpit"&&/Pedal|pedal|Brake master|Brake balance|Brake circuit|Brake fluid|Brake reservoir|Throttle position|Throttle sensor/.test(o.name))||
      (id==="monocoque"&&/Lower chassis enclosure|bulkhead/i.test(o.name))||
      (id.includes("suspension")&&/damper|spring|rocker/.test(o.name));
  });
  root.traverse(o=>{if(o instanceof T.Mesh){o.geometry.computeBoundingBox();o.geometry.computeBoundingSphere();}});
  updateWingLinkages(linkages);
  return {root,assemblies,materials:mat,linkages};
}

/** Both ends stay attached as the flap turns; the actuator telescopes between them. */
export function updateWingLinkages(linkages:WingLinkage[]) {
  const up=new T.Vector3(0,1,0);
  for(const link of linkages){
    const end=link.end.clone().applyQuaternion(link.wing.quaternion).add(link.wing.position);
    const axis=end.clone().sub(link.anchor).normalize();
    const a=link.anchor.clone().lerp(end,link.from).addScaledVector(axis,link.fromOffset??0);
    const b=link.anchor.clone().lerp(end,link.to).addScaledVector(axis,link.toOffset??0),direction=b.clone().sub(a);
    link.mesh.position.copy(a).add(b).multiplyScalar(.5);
    link.mesh.quaternion.setFromUnitVectors(up,direction.clone().normalize());link.mesh.scale.y=direction.length();
  }
}

export const explodeOffset:Record<string,V>={
  // Lift each assembly above its installed footprint. Paired assemblies retain
  // their connections; neither the wheels nor the floor slide out sideways.
  bodywork:[0,2.15,0],mirrors:[0,2.15,0],"front-wing":[0,.65,0],"rear-wing":[0,1.45,0],floor:[0,.12,0],diffuser:[0,.12,0],
  engine:[0,.85,0],turbo:[0,1.30,0],intake:[0,1.70,0],fuel:[0,.85,0],exhaust:[0,1.10,0],cooling:[0,1.30,0],
  mguk:[0,.55,0],battery:[0,.55,0],inverter:[0,.55,0],clutch:[0,.85,0],gearbox:[0,.85,0],differential:[0,.85,0],
  hydraulics:[0,1.10,0],"front-suspension":[0,.65,0],"rear-suspension":[0,.65,0],steering:[0,.95,0],
  brakes:[0,.30,0],"brake-by-wire":[0,.55,0],monocoque:[0,.30,0],halo:[0,1.70,0],impact:[0,.30,0],cockpit:[0,1.05,0],electronics:[0,1.10,0],safety:[0,.85,0],tyres:[0,.30,0],
};
