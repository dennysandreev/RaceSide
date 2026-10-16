import * as T from "three";
import {createInvoluteGearProfile} from "./w17-engine-timing.ts";
import {servicePassage} from "./w17-feedthrough.ts";
import {openRadialPort} from "./w17-wastegate.ts";
import {createSurfaceSampler} from "./w17-surface.ts";

// The front casting is a uniform extrusion. Recover its cut section and
// extrude it once, discarding the tiny coplanar subdivisions of successive cuts.
function recastBridge(source:T.BufferGeometry){
  source.computeBoundingBox();const box=source.boundingBox!,level=box.min.z+(box.max.z-box.min.z)*.4137291,p=source.attributes.position,ix=source.index;
  const points=new Map<string,T.Vector2>(),edges=new Map<string,string[]>(),seen=new Set<string>();
  const key=(v:T.Vector3)=>{for(const [k,p]of points)if(Math.hypot(p.x-v.x,p.y-v.y)<1e-7)return k;const k=String(points.size);points.set(k,new T.Vector2(v.x,v.y));return k;};
  for(let i=0;i<(ix?.count??p.count);i+=3){
    const vs=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix?ix.getX(i+j):i+j)),hits:T.Vector3[]=[];
    for(let j=0;j<3;j++){const a=vs[j],b=vs[(j+1)%3];if((a.z-level)*(b.z-level)<0)hits.push(a.clone().lerp(b,(level-a.z)/(b.z-a.z)));}
    if(hits.length!==2)continue;const [a,b]=hits.map(key),e=[a,b].sort().join('/');if(a===b||seen.has(e))continue;seen.add(e);
    if(!edges.has(a))edges.set(a,[]);if(!edges.has(b))edges.set(b,[]);edges.get(a)!.push(b);edges.get(b)!.push(a);
  }
  const loops:T.Vector2[][]=[],visited=new Set<string>();
  for(const start of edges.keys()){
    if(visited.has(start))continue;const loop:T.Vector2[]=[];let at=start,previous="";
    do{visited.add(at);loop.push(points.get(at)!);const next=edges.get(at)!.find(k=>k!==previous);if(!next)throw new Error("Open oil-drive casting section");previous=at;at=next;}while(at!==start&&!visited.has(at));
    if(at!==start)throw new Error("Branched oil-drive casting section");
    let changed=true;while(changed&&loop.length>3){changed=false;for(let i=0;i<loop.length;i++){const a=loop[(i+loop.length-1)%loop.length],b=loop[i],c=loop[(i+1)%loop.length],d=c.clone().sub(a);if(Math.abs(d.cross(b.clone().sub(a)))/d.length()<1e-7){loop.splice(i,1);changed=true;break;}}}
    loops.push(loop);
  }
  const contains=(loop:T.Vector2[],p:T.Vector2)=>{let inside=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++){const a=loop[i],b=loop[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;};
  loops.sort((a,b)=>Math.abs(T.ShapeUtils.area(b))-Math.abs(T.ShapeUtils.area(a)));
  const shapes:T.Shape[]=[],outlines:T.Vector2[][]=[];
  for(const loop of loops){const parent=outlines.findIndex(o=>contains(o,loop[0]));if(parent>=0)shapes[parent].holes.push(new T.Path(loop));else{shapes.push(new T.Shape(loop));outlines.push(loop);}}
  const g=new T.ExtrudeGeometry(shapes,{depth:box.max.z-box.min.z,bevelEnabled:false});g.translate(0,0,box.min.z);return g;
}

type Materials=Record<"metal"|"cast"|"darkMetal"|"rubber",T.Material>;
// Reconstructed oil-pump take-off from the mechanically driven coolant shaft.
// Tooth counts and installed packaging are not published Mercedes dimensions.
export function connectOilPumpDrive(car:T.Group,cooling:T.Group,mat:Materials){
  car.updateMatrixWorld(true);
  const root=new T.Group();root.name="Oil pump transmission";cooling.add(root);
  const plane=-.3145,width=.007,input=car.getObjectByName("Coolant drive gear pump -1")!;
  const centres=[new T.Vector2(input.position.y,input.position.z),new T.Vector2(.1915690396299476,-.21697434850667235),new T.Vector2(.133,-.230)];
  const teeth=[12,36,24],ratios=[input.userData.ratio],phases=[input.userData.phase];
  for(let i=1;i<3;i++){const d=centres[i].clone().sub(centres[i-1]),a=Math.atan2(d.y,d.x);ratios.push(-ratios[i-1]*teeth[i-1]/teeth[i]);phases.push(a+Math.PI-(Math.PI-teeth[i-1]*(a-phases[i-1]))/teeth[i]);}
  const add=(name:string,g:T.BufferGeometry,material:T.Material=mat.metal,cover=false,parent:T.Object3D=root)=>{const m=new T.Mesh(g,material);m.name=`Oil drive ${name}`;m.userData={component:"cooling",internal:true,oilPump:true,serviceCover:cover};m.castShadow=m.receiveShadow=true;parent.add(m);return m;};
  const axial=(name:string,c:T.Vector2,a:number,b:number,inner:number,outer:number,material:T.Material=mat.metal,cover=false,parent:T.Object3D=root)=>{const g=new T.LatheGeometry([[inner,a],[outer,a],[outer,b],[inner,b],[inner,a]].map(p=>new T.Vector2(...p)),48);g.rotateZ(-Math.PI/2);g.translate(0,c.x,c.y);return add(name,g,material,cover,parent);};
  const hull=(points:T.Vector2[])=>{const sorted=points.sort((a,b)=>a.x-b.x||a.y-b.y),lo:T.Vector2[]=[],hi:T.Vector2[]=[];const turn=(a:T.Vector2,b:T.Vector2,c:T.Vector2)=>b.clone().sub(a).cross(c.clone().sub(a));for(const p of sorted){while(lo.length>1&&turn(lo.at(-2)!,lo.at(-1)!,p)<=0)lo.pop();lo.push(p);}for(const p of sorted.reverse()){while(hi.length>1&&turn(hi.at(-2)!,hi.at(-1)!,p)<=0)hi.pop();hi.push(p);}return [...lo.slice(0,-1),...hi.slice(0,-1)];};
  const outline=(gap:number)=>hull(centres.flatMap((c,i)=>Array.from({length:48},(_,j)=>{const a=j*Math.PI/24,r=teeth[i]*.001+.002+gap;return new T.Vector2(-c.y+Math.cos(a)*r,c.x+Math.sin(a)*r);})));
  const outer=outline(.006),inner=outline(.002),screws:T.Vector2[]=[];
  const mounts=[5,6].map(i=>{const part=car.getObjectByName(`Coolant drive case screw ${i}`)!;const p=new T.Box3().setFromObject(part).getCenter(new T.Vector3());return {i,c:new T.Vector2(p.y,p.z)};});
  for(let i=0;i<outer.length;i+=Math.ceil(outer.length/12)){const a=outer[i],b=outer[(i+1)%outer.length],d=b.clone().sub(a),p=a.clone().add(b).multiplyScalar(.5).addScaledVector(new T.Vector2(-d.y,d.x).normalize(),.002);screws.push(new T.Vector2(p.y,-p.x));}
  const bore=(s:T.Shape,c:T.Vector2,r:number)=>{const p=new T.Path();p.absarc(-c.y,c.x,r,0,Math.PI*2,true);s.holes.push(p);};
  const solid=(name:string,s:T.Shape,a:number,b:number)=>{const g=new T.ExtrudeGeometry(s,{depth:b-a,bevelEnabled:false,curveSegments:24});g.rotateY(Math.PI/2);g.translate(a,0,0);return add(name,g,mat.cast,true);};
  const wall=new T.Shape(outer);wall.holes.push(new T.Path(inner.slice().reverse()));screws.forEach(p=>bore(wall,p,.0011));solid("case perimeter",wall,-.3205,-.3085);
  for(const [name,a,b]of[["rear",-.323,-.3205],["front",-.3085,-.306]] as const){const s=new T.Shape(outer);centres.forEach((p,i)=>bore(s,p,i===0?.0047:.006));screws.forEach(p=>bore(s,p,.0011));if(name==="rear")mounts.forEach(({c})=>bore(s,c,.0016));solid(`case ${name} cover`,s,a,b);}
  for(const [i,c]of screws.entries()){axial(`case screw ${i}`,c,-.323,-.304,0,.001,mat.darkMetal,true);axial(`case screw head ${i}`,c,-.306,-.304,.0004,.0018,mat.metal,true);}
  for(const {i,c}of mounts){
    const bolt=car.getObjectByName(`Coolant drive case screw ${i}`) as T.Mesh,head=car.getObjectByName(`Coolant drive case screw head ${i}`) as T.Mesh;
    const a=axial(`mount bolt ${i}`,c,-.349,-.319,0,.0015,mat.darkMetal,true),b=axial(`mount head ${i}`,c,-.3205,-.319,.0007,.0027,mat.metal,true);
    bolt.geometry.dispose();head.geometry.dispose();bolt.geometry=a.geometry;head.geometry=b.geometry;bolt.userData.oilPump=head.userData.oilPump=true;root.remove(a,b);
    axial(`mount spacer ${i}`,c,-.326,-.323,.0016,.0027,mat.cast,true);
  }
  for(let i=0;i<3;i++){
    const moving=new T.Group();moving.name=`Oil drive gear ${i}`;moving.position.set(plane,centres[i].x,centres[i].y);moving.userData={component:"cooling",oilPump:true,engineMotion:"accessoryGear",ratio:ratios[i],phase:phases[i],teeth:teeth[i],pitchRadius:teeth[i]*.001,mate:i?`Oil drive gear ${i-1}`:input.name};root.add(moving);
    const s=createInvoluteGearProfile(teeth[i],i===0?.00455:.0038),g=new T.ExtrudeGeometry(s,{depth:width,bevelEnabled:false,curveSegments:24});g.translate(0,0,-width/2);g.applyMatrix4(new T.Matrix4().makeBasis(new T.Vector3(0,1,0),new T.Vector3(0,0,1),new T.Vector3(1,0,0)));add(`gear ${i} teeth`,g,mat.metal,false,moving);
    if(i===0){
      // Two clamping hub shoulders couple the take-off to the existing shaft.
      for(const [a,b]of[[-.3205,-.318],[-.311,-.3085]])axial(`input clamping hub ${a}`,new T.Vector2(),a-plane,b-plane,.00455,.007,mat.metal,false,moving);
      continue;
    }
    const a=i===2?-.496:-.3226,b=-.303;
    axial(`shaft ${i}`,new T.Vector2(),a-plane,b-plane,0,.0038,mat.metal,false,moving);
    for(const x of[-.32175,-.30725]){
      axial(`bearing ${i}/${x}`,centres[i],i===1&&x===-.32175?-.3227:x-.00125,x+.00125,.00385,.006,mat.darkMetal);
      for(const end of[-1,1])if(!(i===1&&x===-.32175&&end===-1))axial(`bearing shoulder ${i}/${x}/${end}`,new T.Vector2(),x+end*.00175-.0005-plane,x+end*.00175+.0005-plane,.0038,.0048,mat.metal,false,moving);
    }
    for(const [end,x]of[["rear",-.325],["front",-.306]] as const){if(i===1&&end==="rear")continue;axial(`seal carrier ${i}/${end}`,centres[i],x,x+.002,.0049,.0075,mat.cast,true);axial(`seal ${i}/${end}`,centres[i],x,x+.002,.00485,.0049,mat.rubber,true);}
    axial(`front cap ${i}`,centres[i],-.304,-.301,.0049,.0075,mat.cast,true);axial(`front cap end ${i}`,centres[i],-.301,-.299,0,.0075,mat.cast,true);
    if(i===1){axial("idler rear cap",centres[i],-.323,-.3227,0,.006,mat.cast,true);}
    else axial("output quill sleeve",centres[i],-.496,-.325,.0039,.0054,mat.cast,true);
  }
  const sleeve=car.getObjectByName("Coolant drive left pump quill sleeve") as T.Mesh;
  sleeve.geometry.dispose();const short=new T.LatheGeometry([[.0046,-.306],[.006,-.306],[.006,-.301],[.0046,-.301],[.0046,-.306]].map(p=>new T.Vector2(...p)),48);short.rotateZ(-Math.PI/2);short.translate(0,centres[0].x,centres[0].y);sleeve.geometry=short;
  for(const name of["Oil pump supply","Oil pressure outlet","Scavenge 0","Scavenge 1","Oil scavenge outlet"])for(const suffix of[" socket"," collar"]){const part=car.getObjectByName(name+suffix);if(part)part.userData.oilPump=true;}
  car.getObjectByName("Scavenge 1 inlet elbow")!.userData.oilPump=true;
  const pump=car.getObjectByName("Dry-sump pump stages")!;
  for(const side of[-1,1]){const rotor=pump.getObjectByName(`Oil pump ${side===1?"drive":"idler"} shaft assembly`)!;rotor.userData.ratio=side===1?ratios[2]:-ratios[2];rotor.userData.phase=side===1?phases[2]:-phases[2]-Math.PI/16;}
  // The local pocket retains the rest of the front casting and both bank walls.
  const bridge=car.getObjectByName("Front crankcase transmission bridge") as T.Mesh;
  bridge.geometry.rotateY(-Math.PI/2);bridge.geometry.scale(1000,1000,1000);const pocket=servicePassage(bridge.geometry,outline(.0061).map(p=>p.multiplyScalar(1000)));bridge.geometry.dispose();pocket.scale(.001,.001,.001);const recast=recastBridge(pocket);pocket.dispose();recast.rotateY(Math.PI/2);bridge.geometry=recast;
  // Pump feet seat on the actual cast sidewall; no relocated hose endpoints.
  const block=car.getObjectByName("Cast V6 crankcase") as T.Mesh;car.updateMatrixWorld(true);const surface=createSurfaceSampler([block],"z");
  for(const [i,x]of[-.499,-.615].entries()){
    const foot=new T.BoxGeometry(.006,.004,.010),p=foot.attributes.position;
    for(let j=0;j<p.count;j++){const px=x+p.getX(j),py=.163+p.getY(j),z=surface(px,py,-1)!;p.setXYZ(j,px,py,z-(p.getZ(j)>0?.0001:.0101));}foot.computeVertexNormals();const mountingFoot=add(`pump mounting foot ${i}`,foot,mat.cast,true);
    const seat=surface(x,.163,-1)!-.0101,shape=new T.Shape([new T.Vector2(.225,.153),new T.Vector2(-seat,.153),new T.Vector2(-seat,.165),new T.Vector2(.225,.165)]);bore(shape,new T.Vector2(.159,-.219),.0017);
    const bracket=solid(`pump bracket ${i}`,shape,x-.003,x+.003);
    for(const part of[mountingFoot,bracket]){
      const local=part.geometry.clone();local.translate(-x,-.163,0);local.scale(1000,1000,1000);
      const drilled=servicePassage(local,Array.from({length:24},(_,j)=>new T.Vector2(Math.cos(j*Math.PI/12)*1.6,Math.sin(j*Math.PI/12)*1.6)));local.dispose();drilled.scale(.001,.001,.001);drilled.translate(x,.163,0);part.geometry.dispose();part.geometry=drilled;
    }
    const end=surface(x,.163,-1)!-.002,shaft=new T.CylinderGeometry(.0015,.0015,end+.225,24);shaft.rotateX(Math.PI/2);shaft.translate(x,.163,(end-.225)/2);add(`pump fixing bolt ${i}`,shaft,mat.darkMetal,true);
    const head=new T.CylinderGeometry(.0025,.0025,.003,6);head.rotateX(Math.PI/2);head.translate(x,.163,-.2265);add(`pump fixing head ${i}`,head,mat.metal,true);

  }
  const bolt=car.getObjectByName("Oil pump through bolt 0.159 -0.219") as T.Mesh,head=car.getObjectByName("Oil pump bolt head 0.159 -0.219") as T.Mesh,nut=car.getObjectByName("Oil pump retaining nut 0.159 -0.219") as T.Mesh;
  for(const [part,a,b,inside,outside]of[[bolt,-.621,-.493,0,.0016],[head,-.496,-.493,.0007,.003],[nut,-.621,-.618,.0017,.0033]] as const){const replacement=axial("mounting bolt replacement",new T.Vector2(.159,-.219),a,b,inside,outside);part.geometry.dispose();part.geometry=replacement.geometry;root.remove(replacement);}
  for(const [i,a,b]of[[0,-.503,-.502],[1,-.612,-.609]])axial(`pump bracket spacer ${i}`,new T.Vector2(.159,-.219),a,b,.0017,.0033,mat.metal,true);
  const lowerShell=car.getObjectByName("Survival cell lower shell") as T.Mesh;
  lowerShell.geometry.translate(.190,0,0);lowerShell.geometry.scale(.4,1,1);openRadialPort(lowerShell,[0,.183],.018,-1,-.04);lowerShell.geometry.scale(2.5,1,1);lowerShell.geometry.translate(-.190,0,0);lowerShell.geometry.computeVertexNormals();
  // Protected service openings for the tank feed. These are local left-side
  // passages; the opposite survival-cell and enclosure walls stay intact.
  for(const [name,x,r]of[["Lower side enclosure -1",-.160,.016],["Lower chassis enclosure",-.160,.016]] as const){
    const skin=car.getObjectByName(name) as T.Mesh;skin.updateWorldMatrix(true,false);skin.geometry.applyMatrix4(skin.matrixWorld);openRadialPort(skin,[x,.183],r,-1,-.04);skin.geometry.applyMatrix4(skin.matrixWorld.clone().invert());skin.geometry.computeVertexNormals();
  }
  root.userData={plane,teeth,ratios,phases,outside:outer.map(p=>p.toArray())};car.updateMatrixWorld(true);
}
