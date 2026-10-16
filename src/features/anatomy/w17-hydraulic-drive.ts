import * as T from "three";
import {createInvoluteGearProfile} from "./w17-engine-timing.ts";

type Materials=Record<"metal"|"cast"|"darkMetal"|"rubber",T.Material>;

// Inferred fixed-ratio take-off inside the existing timing enclosure. The
// original pump, hose ports and camshaft axes are retained; this is not W17 CAD.
export function connectHydraulicPumpDrive(car:T.Group,system:T.Group,mat:Materials){
  car.updateMatrixWorld(true);
  const cam=car.getObjectByName("Camshaft 1 intake")!,camEnd=car.getObjectByName("Camshaft 1 intake timing extension")!;
  const p=cam.getWorldPosition(new T.Vector3()),centres=[new T.Vector2(p.y,p.z),new T.Vector2(.335,.115)];
  const plane=-.913,width=.008,teeth=30,pitch=centres[0].distanceTo(centres[1])/2,scale=pitch/(teeth*.001);
  const direction=centres[1].clone().sub(centres[0]),angle=Math.atan2(direction.y,direction.x),phases=[0,2*angle+Math.PI-Math.PI/teeth];
  const root=new T.Group();root.name="Hydraulic pump mechanical drive";system.add(root);
  const add=(name:string,g:T.BufferGeometry,material:T.Material=mat.metal,cover=false,parent:T.Object3D=root)=>{
    const mesh=new T.Mesh(g,material);mesh.name=`Hydraulic drive ${name}`;mesh.userData={component:"hydraulics",internal:true,hydraulicDrive:true,serviceCover:cover};mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  const axial=(name:string,c:T.Vector2,a:number,b:number,inner:number,outer:number,material:T.Material=mat.metal,cover=false,parent:T.Object3D=root)=>{
    const g=new T.LatheGeometry([[inner,a],[outer,a],[outer,b],[inner,b],[inner,a]].map(v=>new T.Vector2(...v)),40);g.rotateZ(-Math.PI/2);g.translate(0,c.x,c.y);return add(name,g,material,cover,parent);
  };
  const bore=(shape:T.Shape,c:T.Vector2,r:number)=>{const h=new T.Path();h.absarc(-c.y,c.x,r,0,Math.PI*2,true);shape.holes.push(h);};
  const hull=(points:T.Vector2[])=>{
    const sorted=points.sort((a,b)=>a.x-b.x||a.y-b.y),lo:T.Vector2[]=[],hi:T.Vector2[]=[];
    const turn=(a:T.Vector2,b:T.Vector2,c:T.Vector2)=>b.clone().sub(a).cross(c.clone().sub(a));
    for(const p of sorted){while(lo.length>1&&turn(lo.at(-2)!,lo.at(-1)!,p)<=0)lo.pop();lo.push(p);}
    for(const p of sorted.reverse()){while(hi.length>1&&turn(hi.at(-2)!,hi.at(-1)!,p)<=0)hi.pop();hi.push(p);}return [...lo.slice(0,-1),...hi.slice(0,-1)];
  };
  const outline=(gap:number)=>hull(centres.flatMap(c=>Array.from({length:64},(_,i)=>{const a=i*Math.PI/32,r=pitch+.002*scale+gap;return new T.Vector2(-c.y+Math.cos(a)*r,c.x+Math.sin(a)*r);})));
  const normal=new T.Vector2(-direction.y,direction.x).normalize(),mounts=centres.flatMap(c=>[-1,1].map(side=>c.clone().addScaledVector(normal,side*.035)));
  const solid=(name:string,shape:T.Shape,a:number,b:number)=>{const g=new T.ExtrudeGeometry(shape,{depth:b-a,bevelEnabled:false,curveSegments:24});g.rotateY(Math.PI/2);g.translate(a,0,0);return add(name,g,mat.cast,true);};
  const outer=outline(.0075),inner=outline(.0015),wall=new T.Shape(outer);wall.holes.push(new T.Path(inner.slice().reverse()));
  mounts.forEach(c=>bore(wall,c,.0017));solid("case perimeter",wall,-.924,-.902);
  for(const [name,a,b]of[["rear",-.930,-.924],["front",-.902,-.898]] as const){
    const shape=new T.Shape(outer);centres.forEach((c,i)=>bore(shape,c,i?.007:.010));mounts.forEach(c=>bore(shape,c,.0017));solid(`case ${name} plate`,shape,a,b);
  }
  for(const [i,c]of mounts.entries()){
    axial(`case mounting bolt ${i}`,c,-.938,-.896,0,.0016,mat.darkMetal,true);
    axial(`case mounting head ${i}`,c,-.898,-.896,.0007,.0028,mat.metal,true);
  }
  const frame=new T.Matrix4().makeBasis(new T.Vector3(0,1,0),new T.Vector3(0,0,1),new T.Vector3(1,0,0));
  const flat=(r:number,limit:number)=>{const a=Math.acos(limit/r);return Array.from({length:49},(_,i)=>{const t=a+(2*Math.PI-2*a)*i/48;return new T.Vector2(Math.cos(t)*r,Math.sin(t)*r);});};
  const moving:T.Group[]=[];
  for(let i=0;i<2;i++){
    const r=i?.004:.007,inside=i?0:.003,limit=r-.0008,c=centres[i];
    const rotor=new T.Group();rotor.name=`Hydraulic drive ${i?"output":"input"}`;rotor.position.set(plane,c.x,c.y);
    rotor.userData={component:"hydraulics",hydraulicDrive:true,engineMotion:"accessoryGear",ratio:i?-.5:.5,phase:phases[i],teeth,pitchRadius:pitch,mate:i?"Hydraulic drive input":"Camshaft 1 intake"};root.add(rotor);moving.push(rotor);
    const shape=createInvoluteGearProfile(teeth,0);shape.holes=[new T.Path(flat((r+.00004)/scale,(limit+.00004)/scale).reverse())];
    const g=new T.ExtrudeGeometry(shape,{depth:width/scale,bevelEnabled:false});g.scale(scale,scale,scale);g.translate(0,0,-width/2);g.applyMatrix4(frame);add(`${i?"output":"input"} teeth`,g,mat.metal,false,rotor);
    const key=new T.Shape(flat(r,limit));if(inside){const h=new T.Path();h.absarc(0,0,inside,0,Math.PI*2,true);key.holes.push(h);}
    const keyed=new T.ExtrudeGeometry(key,{depth:width,bevelEnabled:false});keyed.translate(0,0,-width/2);keyed.applyMatrix4(frame);add(`${i?"output":"input"} shaft flat`,keyed,mat.darkMetal,false,rotor);
    const end=i?-.896:new T.Box3().setFromObject(camEnd).min.x;
    axial(i?"output rear journal":"input rear journal",new T.Vector2(),(i?-.926:-.9298)-plane,-width/2,inside,r,mat.darkMetal,false,rotor);
    axial(i?"output front journal":"cam extension",new T.Vector2(),width/2,end-plane,inside,r,mat.darkMetal,false,rotor);
    for(const [name,a,b]of[["rear",-.929,-.925],["front",-.902,-.898]] as const){
      axial(`${i} ${name} bush`,c,a,b,r+.0001,i?.007:.010,mat.metal);
      const lo=name==="rear"?-.9298:-.898,hi=name==="rear"?-.929:-.896;
      axial(`${i} ${name} shaft retainer`,new T.Vector2(),lo-plane,hi-plane,r+.0001,r+.0018,mat.darkMetal,false,rotor);
      const a2=name==="rear"?-.925:-.904,b2=name==="rear"?-.923:-.902;
      axial(`${i} ${name} bearing seat`,c,a2,b2,r+.0002,i?.009:.012,mat.cast,true);
    }
    if(i)axial("output front cap",c,-.896,-.893,0,.0065,mat.cast,true);
  }
  // The visible quill is part of the driven shaft, not a disconnected static rod.
  const quill=car.getObjectByName("Hydraulic pump drive quill")!;moving[1].attach(quill);quill.userData.hydraulicDrive=true;
  for(const part of system.children)if(/^Hydraulic pump (body|end plate|drive seal|mounting flange|fixing)/.test(part.name))part.userData.hydraulicDrive=true;

  // Rebuild the native cover profile with the real pump/mounting bores. This
  // keeps both sides closed around each opening without sequential CSG slivers.
  const cover=car.getObjectByName("Engine timing end cover -0.938") as T.Mesh<T.ExtrudeGeometry>;
  const original=cover.geometry,profile=(original.parameters.shapes as T.Shape).clone();
  const toCover=cover.matrixWorld.clone().invert(),local=(c:T.Vector2)=>new T.Vector3(0,c.x,c.y).applyMatrix4(toCover);
  for(const c of mounts){const p=local(c);bore(profile,new T.Vector2(p.y,p.z),.0017);}
  const pump=local(centres[1]);bore(profile,new T.Vector2(pump.y,pump.z),.0062);
  for(let i=0;i<3;i++){const a=i*Math.PI*2/3,c=local(new T.Vector2(.335+Math.cos(a)*.025,.115+Math.sin(a)*.025));bore(profile,new T.Vector2(c.y,c.z),.0015);}
  const next=new T.ExtrudeGeometry(profile,{...original.parameters.options});next.rotateY(Math.PI/2);next.translate(-.940,0,0);original.dispose();cover.geometry=next;

  // The existing seal occupies a real recess rather than overlapping a solid
  // flange. Fixing bolts pass through matching clearance holes in both pieces.
  const flange=car.getObjectByName("Hydraulic pump mounting flange") as T.Mesh;
  const flangeShape=new T.Shape();flangeShape.absarc(-.115,.335,.029,0,Math.PI*2,false);bore(flangeShape,centres[1],.0091);
  for(let i=0;i<3;i++){const a=i*Math.PI*2/3;bore(flangeShape,new T.Vector2(.335+Math.cos(a)*.025,.115+Math.sin(a)*.025),.0015);}
  const fg=new T.ExtrudeGeometry(flangeShape,{depth:.011,bevelEnabled:false,curveSegments:32});fg.rotateY(Math.PI/2);fg.translate(-.951,0,0);flange.geometry.dispose();flange.geometry=fg;flange.position.set(0,0,0);flange.quaternion.identity();
  root.userData={plane,teeth,pitch,ratio:-.5,mounts:mounts.map(c=>c.toArray())};car.updateMatrixWorld(true);
}
