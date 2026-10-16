import * as T from "three";
import { servicePassage } from "./w17-feedthrough.ts";

type Materials=Record<"metal"|"cast"|"darkMetal",T.Material>;
type Gear={name:string;centre:T.Vector2;teeth:number;x:number;width:number;phase:number;ratio:number;parent?:string;cam?:T.Object3D};
const MODULE=.002,PRESSURE_ANGLE=Math.PI/9;
const pitch=(teeth:number)=>MODULE*teeth/2;

// Standard involute flanks with a small running backlash. Hidden tooth counts,
// shaft spacing and case layout are a reconstruction, not Mercedes dimensions.
export function createInvoluteGearProfile(teeth:number,bore:number){
  const radius=pitch(teeth),base=radius*Math.cos(PRESSURE_ANGLE),root=radius-1.25*MODULE,tip=radius+MODULE;
  const involute=(r:number)=>{const a=Math.acos(Math.min(1,base/r));return Math.tan(a)-a;};
  const half=(r:number)=>Math.PI/(2*teeth)-.00004/radius+involute(radius)-involute(r);
  const points:T.Vector2[]=[],at=(r:number,a:number)=>points.push(new T.Vector2(Math.cos(a)*r,Math.sin(a)*r));
  for(let tooth=0;tooth<teeth;tooth++){
    const angle=tooth*Math.PI*2/teeth,start=Math.max(root,base),width=half(start);
    at(root,angle-width);
    for(let i=0;i<=8;i++){const r=T.MathUtils.lerp(start,tip,i/8);at(r,angle-half(r));}
    for(let i=1;i<=4;i++)at(tip,angle+T.MathUtils.lerp(-half(tip),half(tip),i/4));
    for(let i=7;i>=0;i--){const r=T.MathUtils.lerp(start,tip,i/8);at(r,angle+half(r));}
    at(root,angle+width);
    for(let i=1;i<4;i++)at(root,angle+T.MathUtils.lerp(width,Math.PI*2/teeth-width,i/4));
  }
  const shape=new T.Shape(points),hole=new T.Path();hole.absarc(0,0,bore,0,Math.PI*2,true);shape.holes.push(hole);return shape;
}

function intersections(a:T.Vector2,ra:number,b:T.Vector2,rb:number){
  const delta=b.clone().sub(a),d=delta.length(),along=(ra*ra-rb*rb+d*d)/(2*d),height=Math.sqrt(Math.max(0,ra*ra-along*along));
  if(d>ra+rb+1e-9||d<Math.abs(ra-rb)-1e-9)throw new Error("Timing centres cannot mesh");
  const axis=delta.divideScalar(d),centre=a.clone().addScaledVector(axis,along),normal=new T.Vector2(-axis.y,axis.x);
  return [centre.clone().addScaledVector(normal,height),centre.clone().addScaledVector(normal,-height)];
}

function hull(points:T.Vector2[]){
  const sorted=points.slice().sort((a,b)=>a.x-b.x||a.y-b.y),lo:T.Vector2[]=[],hi:T.Vector2[]=[];
  const turn=(a:T.Vector2,b:T.Vector2,c:T.Vector2)=>b.clone().sub(a).cross(c.clone().sub(a));
  for(const p of sorted){while(lo.length>1&&turn(lo.at(-2)!,lo.at(-1)!,p)<=0)lo.pop();lo.push(p);}
  for(const p of sorted.reverse()){while(hi.length>1&&turn(hi.at(-2)!,hi.at(-1)!,p)<=0)hi.pop();hi.push(p);}
  return [...lo.slice(0,-1),...hi.slice(0,-1)];
}

export function createEngineTiming(core:T.Group,mat:Materials){
  const steel=new T.MeshStandardMaterial({name:"Timing steel",color:"#879096",metalness:.72,roughness:.42});
  core.updateMatrixWorld(true);
  const inverse=core.matrixWorld.clone().invert(),gears:Gear[]=[{name:"crank",centre:new T.Vector2(),teeth:28,x:-.832,width:.008,phase:0,ratio:1}];
  const mate=(parent:Gear,gear:Omit<Gear,"phase"|"ratio"|"parent">)=>{
    const line=Math.atan2(gear.centre.y-parent.centre.y,gear.centre.x-parent.centre.x);
    const phase=line+Math.PI-(Math.PI-parent.teeth*(line-parent.phase))/gear.teeth;
    const result:Gear={...gear,phase,ratio:-parent.ratio*parent.teeth/gear.teeth,parent:parent.name};gears.push(result);return result;
  };
  for(const side of[-1,1]){
    const cams=["intake","exhaust"].map(kind=>{
      const cam=core.getObjectByName(`Camshaft ${side} ${kind}`)!;
      const point=cam.getWorldPosition(new T.Vector3()).applyMatrix4(inverse);
      return {name:`${side} ${kind}`,centre:new T.Vector2(point.y,point.z),teeth:56,x:kind==="intake"?-.814:-.832,width:.008,cam};
    });
    const upper=intersections(cams[0].centre,.104,cams[1].centre,.104).sort((a,b)=>a.lengthSq()-b.lengthSq())[0];
    const lower=upper.clone().normalize().multiplyScalar(.054);
    const middle=intersections(lower,.052,upper,.074).sort((a,b)=>side*(b.y-a.y))[0];
    const first=mate(gears[0],{name:`${side} lower idler`,centre:lower,teeth:26,x:-.832,width:.008});
    const second=mate(first,{name:`${side} middle idler`,centre:middle,teeth:26,x:-.832,width:.008});
    const third=mate(second,{name:`${side} upper idler`,centre:upper,teeth:48,x:-.823,width:.026});
    cams.forEach(cam=>mate(third,cam));
  }
  const root=new T.Group();root.name="V6 mechanical timing drive";core.add(root);
  const add=(parent:T.Object3D,name:string,g:T.BufferGeometry,material=mat.metal,cover=false)=>{
    const mesh=new T.Mesh(g,material);mesh.name=name;mesh.userData={component:"engine",internal:true,engineTiming:true,serviceCover:cover};mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  const axial=(parent:T.Object3D,name:string,centre:T.Vector2,inner:number,outer:number,a:number,b:number,material=mat.metal,cover=false)=>{
    const g=new T.LatheGeometry([[inner,a],[outer,a],[outer,b],[inner,b],[inner,a]].map(p=>new T.Vector2(...p)),40);g.rotateZ(-Math.PI/2);g.translate(0,centre.x,centre.y);return add(parent,name,g,material,cover);
  };
  const profile=(clearance:number)=>hull([
    ...gears.flatMap(g=>Array.from({length:48},(_,i)=>{const angle=i*Math.PI/24,r=pitch(g.teeth)+MODULE+clearance;return new T.Vector2(-g.centre.y+Math.sin(angle)*r,g.centre.x+Math.cos(angle)*r);})),
    ...[-1,1].map(side=>new T.Vector2(side*(.130+clearance),-.055-clearance)),
  ]);
  const outside=profile(.010),inside=profile(.003),caseShape=new T.Shape(outside);caseShape.holes.push(new T.Path(inside.slice().reverse()));
  const casting=(name:string,shape:T.Shape,a:number,b:number,material=mat.cast)=>{
    const g=new T.ExtrudeGeometry(shape,{depth:b-a,bevelEnabled:false,curveSegments:32});g.rotateY(Math.PI/2);g.translate(a,0,0);return add(root,name,g,material,true);
  };
  const circle=(shape:T.Shape,centre:T.Vector2,radius:number)=>{const path=new T.Path();path.absarc(-centre.y,centre.x,radius,0,Math.PI*2,true);shape.holes.push(path);};
  const bolts:T.Vector2[]=[];
  // Cover screws sit in the perimeter wall, with matching open bores.
  for(let i=0;i<outside.length;i+=Math.max(1,Math.floor(outside.length/12))){
    const a=outside[i],b=outside[(i+1)%outside.length],edge=b.clone().sub(a),p=a.clone().add(b).multiplyScalar(.5).addScaledVector(new T.Vector2(-edge.y,edge.x).normalize(),.0035);
    bolts.push(new T.Vector2(p.y,-p.x));
  }
  for(const point of bolts)circle(caseShape,point,.0018);
  casting("Engine timing case wall",caseShape,-.930,-.782);
  for(const [name,a,b]of[["Engine timing end cover -0.938",-.940,-.930],["Engine timing case front plate",-.782,-.778]] as const){
    const shape=new T.Shape(outside);circle(shape,new T.Vector2(),.0228);
    for(const gear of gears){
      if(gear.name.includes("idler"))circle(shape,gear.centre,.0061);
      if(gear.cam&&a>-.9)circle(shape,gear.centre,.0074);
    }
    for(const p of bolts)circle(shape,p,.0018);
    casting(name,shape,a,b,mat.darkMetal);
  }
  for(const [i,p]of bolts.entries()){
    axial(root,`Timing cover screw ${i}`,p,0,.0017,-.942,-.918,mat.darkMetal,true);
    axial(root,`Timing cover screw head ${i}`,p,0,.003,-.946,-.940,mat.metal,true);
  }
  for(const gear of gears){
    const idler=gear.name.includes("idler"),bore=gear.cam?.007:idler?.010:.0225;
    const wheel=new T.Group();wheel.name=`Timing gear ${gear.name}`;wheel.position.set(gear.x,gear.centre.x,gear.centre.y);
    wheel.userData={engineMotion:"timingGear",ratio:gear.ratio,phase:gear.phase,teeth:gear.teeth,pitchRadius:pitch(gear.teeth),mate:gear.parent??null};root.add(wheel);
    const g=new T.ExtrudeGeometry(createInvoluteGearProfile(gear.teeth,bore),{depth:gear.width,bevelEnabled:false,curveSegments:32});g.translate(0,0,-gear.width/2);
    g.applyMatrix4(new T.Matrix4().makeBasis(new T.Vector3(0,1,0),new T.Vector3(0,0,1),new T.Vector3(1,0,0)));
    add(wheel,`Timing gear ${gear.name} teeth`,g,steel);
    axial(wheel,`Timing gear ${gear.name} hub`,new T.Vector2(),bore,bore+.004,-gear.width/2-.004,-gear.width/2,steel);
    if(idler){
      axial(root,`Timing ${gear.name} spindle`,gear.centre,0,.006,-.944,-.774,mat.darkMetal);
      axial(root,`Timing ${gear.name} bearing`,gear.centre,.0061,.010,gear.x-gear.width/2,gear.x+gear.width/2);
      for(const [a,b]of[[-.932,-.922],[-.792,-.778]])axial(root,`Timing ${gear.name} support ${a}`,gear.centre,.0061,.014,a,b,mat.cast,true);
      axial(root,`Timing ${gear.name} retaining head`,gear.centre,0,.010,-.947,-.940,mat.metal,true);
    }
    if(gear.cam){
      const cam=gear.cam,shaft=core.getObjectByName(`${cam.name} shaft`)!;
      const end=new T.Box3().setFromObject(shaft).min.x;
      axial(cam,`${cam.name} timing extension`,new T.Vector2(),.003,.007,gear.x-gear.width/2-.006,end,mat.darkMetal);
      axial(root,`${cam.name} timing neck`,gear.centre,.0074,.012,-.782,end+.002,mat.cast,true);
      axial(root,`${cam.name} timing bearing`,gear.centre,.0071,.010,-.790,-.782);
      const wall=core.getObjectByName(`Head end wall ${cam.userData.side} rear`) as T.Mesh;
      const frame=new T.Matrix4().makeBasis(new T.Vector3(0,1,0),new T.Vector3(0,0,1),new T.Vector3(1,0,0));frame.setPosition(0,gear.centre.x,gear.centre.y);
      const transform=frame.invert().multiply(inverse.clone().multiply(wall.matrixWorld)),source=wall.geometry.clone().applyMatrix4(transform);
      const next=servicePassage(source,Array.from({length:32},(_,i)=>new T.Vector2(Math.cos(i*Math.PI/16)*.0074,Math.sin(i*Math.PI/16)*.0074)));source.dispose();next.applyMatrix4(transform.invert());wall.geometry.dispose();wall.geometry=next;
    }
  }
  return root;
}
