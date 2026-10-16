import * as T from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { servicePassage } from "./w17-feedthrough.ts";
import { createSurfaceSampler } from "./w17-surface.ts";

type V=[number,number,number];
type Materials=Record<"carbon"|"cast"|"metal"|"darkMetal",T.Material>;

// The body panel is removable. Suspension loads enter the gearbox through
// retained brackets, rather than ending on that panel or the heat shield.
// Hidden bracket dimensions remain illustrative, not Mercedes hardpoint CAD.
export function rearSuspensionMount(root:T.Group,parent:T.Group,name:string,point:V,side:1|-1,mat:Materials):V {
  root.updateMatrixWorld(true);
  const casing=root.getObjectByName("Carbon gearbox casing") as T.Mesh;
  const wall=createSurfaceSampler([casing],"z"),roof=createSurfaceSampler([casing],"y");
  const [x,y]=point,surface=wall(x,y,side),upper=surface===undefined;
  const z=upper?side*(name.includes("wishbone 0")?.098:.136):surface+side*.025;
  const baseZ=upper?side*.075:surface!,baseY=upper?roof(x,baseZ,1)!:y;
  const pivot:V=[x,y,z];
  const add=(suffix:string,g:T.BufferGeometry,m=mat.cast)=>{
    const mesh=new T.Mesh(g,m);mesh.name=`${name} ${suffix}`;
    mesh.userData={component:"rear-suspension",structural:true};
    mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  const footGeometry=new T.BoxGeometry(.054,upper?.010:.042,upper?.036:.008);
  const p=footGeometry.attributes.position;
  for(let i=0;i<p.count;i++){
    const px=x+p.getX(i),py=p.getY(i),pz=p.getZ(i);
    if(upper)p.setXYZ(i,px,(roof(px,baseZ+pz,1)??baseY)+py,baseZ+pz);
    else p.setXYZ(i,px,y+py,(wall(px,y+py,side)??baseZ)+pz);
  }
  footGeometry.computeVertexNormals();
  const foot=add("gearbox bracket foot",footGeometry,mat.carbon);
  foot.userData.seatDirection=upper?[0,-1,0]:[0,0,-side];
  for(const cheek of [-1,1]){
    // In the YZ section, a broad seated foot tapers into a drilled eye.
    const shape=new T.Shape();
    if(upper){
      shape.moveTo(baseZ-.016,baseY-.003);shape.lineTo(baseZ+.016,baseY-.003);
      shape.lineTo(z+.013,y);shape.absarc(z,y,.013,0,Math.PI,false);shape.closePath();
    }else{
      shape.moveTo(baseZ-side*.004,y-.019);shape.lineTo(z,y-.013);
      shape.absarc(z,y,.013,-Math.PI/2,Math.PI/2,side<0);
      shape.lineTo(baseZ-side*.004,y+.019);shape.closePath();
    }
    const bore=new T.Path();bore.absarc(z,y,.005,0,Math.PI*2,true);shape.holes.push(bore);
    const geometry=new T.ExtrudeGeometry(shape,{depth:.006,bevelEnabled:false,curveSegments:12});
    // Local (z,y,depth) -> world (x,y,z), with outward winding retained.
    geometry.rotateY(-Math.PI/2);geometry.translate(x+cheek*.014+.003,0,0);
    add(`gearbox clevis ${cheek}`,geometry);
    const bolt=new T.CylinderGeometry(.0035,.0035,.014,8);
    if(upper)bolt.translate(x+cheek*.020,baseY+.003,baseZ);
    else{bolt.rotateX(Math.PI/2);bolt.translate(x+cheek*.020,y,baseZ);}
    add(`gearbox fixing ${cheek}`,bolt,mat.metal);
  }
  const bearing=new T.LatheGeometry([[.005,-.009],[.012,-.009],[.012,.009],[.005,.009],[.005,-.009]].map(v=>new T.Vector2(...v)),24);
  bearing.rotateZ(-Math.PI/2);bearing.translate(...pivot);add("spherical bearing",bearing,mat.metal);
  const pin=new T.CylinderGeometry(.0048,.0048,.042,16);pin.rotateZ(Math.PI/2);pin.translate(...pivot);add("pivot bolt",pin,mat.darkMetal);
  return pivot;
}

function convexHull(points:T.Vector2[]){
  const sorted=points.sort((a,b)=>a.x-b.x||a.y-b.y);
  const cross=(a:T.Vector2,b:T.Vector2,c:T.Vector2)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const half=(values:T.Vector2[])=>{
    const result:T.Vector2[]=[];
    for(const p of values){while(result.length>1&&cross(result.at(-2)!,result.at(-1)!,p)<=1e-12)result.pop();result.push(p);}
    return result;
  };
  const hull=[...half(sorted).slice(0,-1),...half([...sorted].reverse()).slice(0,-1)];
  // Near-identical projected ring points create microscopic clipping planes.
  // Removing <0.02 mm deviations keeps the 3.5 mm clearance and a stable rim.
  for(let i=hull.length-1;i>=0;i--){
    const a=hull[(i+hull.length-1)%hull.length],b=hull[i],c=hull[(i+1)%hull.length];
    if(Math.abs(cross(a,b,c))/a.distanceTo(c)<.00002)hull.splice(i,1);
  }
  return hull;
}

function hollowCover(part:T.Mesh){
  const outer=part.geometry.clone();outer.deleteAttribute("uv");
  const inner=outer.clone(),p=inner.attributes.position,n=inner.attributes.normal,index=inner.index!;
  const key=(i:number)=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e6)).join();
  const welded=new Map<string,{point:T.Vector3;normal:T.Vector3}>();
  for(let i=0;i<p.count;i++){
    const k=key(i),entry=welded.get(k)??{point:new T.Vector3().fromBufferAttribute(p,i),normal:new T.Vector3()};
    entry.normal.add(new T.Vector3().fromBufferAttribute(n,i));welded.set(k,entry);
  }
  for(const entry of welded.values())entry.point.addScaledVector(entry.normal.normalize(),-.0025);
  for(let i=0;i<p.count;i++){
    // Sharp edges have duplicate vertices with different shading normals.
    // Offset their shared position once so the inside remains a joined skin.
    const v=welded.get(key(i))!.point;p.setXYZ(i,v.x,v.y,v.z);
    n.setXYZ(i,-n.getX(i),-n.getY(i),-n.getZ(i));
  }
  for(let i=0;i<index.count;i+=3){const a=index.getX(i);index.setX(i,index.getX(i+2));index.setX(i+2,a);}
  part.geometry.dispose();part.geometry=mergeGeometries([outer,inner]);outer.dispose();inner.dispose();
}

// Repair only sub-micron boolean rim remnants after returning to world units.
// Keep the original normals and material ownership of every physical face.
function cleanCut(geometry:T.BufferGeometry){
  const p=geometry.attributes.position,index=geometry.index!,vertices:T.Vector3[]=[],ids:number[]=[],keys=new Map<string,number>();
  for(let i=0;i<p.count;i++){
    const v=new T.Vector3().fromBufferAttribute(p,i),key=v.toArray().map(n=>Math.round(n*1e6)).join();
    if(!keys.has(key)){keys.set(key,vertices.length);vertices.push(v);}
    const id=keys.get(key)!;ids.push(id);p.setXYZ(i,vertices[id].x,vertices[id].y,vertices[id].z);
  }
  type Face={ids:number[];vertices:number[];material:number};
  const unique=new Map<string,Face>();let sourceGroup=0;
  for(let i=0;i<index.count;i+=3){
    const indices=[0,1,2].map(j=>index.getX(i+j)),vs=indices.map(j=>ids[j]);
    if(new Set(vs).size<3)continue;
    while(sourceGroup<geometry.groups.length-1&&i>=geometry.groups[sourceGroup].start+geometry.groups[sourceGroup].count)sourceGroup++;
    const key=[...vs].sort((a,b)=>a-b).join(),other=unique.get(key);
    if(other&&other.vertices[(other.vertices.indexOf(vs[0])+1)%3]===vs[2])unique.delete(key);
    else unique.set(key,{ids:indices,vertices:vs,material:geometry.groups[sourceGroup]?.materialIndex??0});
  }
  const faces=[...unique.values()];
  const edgeMap=()=>{
    const edges=new Map<string,{face:number;a:number;b:number}[]>();
    faces.forEach((face,i)=>{for(let j=0;j<3;j++){
      const a=face.vertices[j],b=face.vertices[(j+1)%3],key=a<b?`${a}/${b}`:`${b}/${a}`;
      const uses=edges.get(key)??[];uses.push({face:i,a,b});edges.set(key,uses);
    }});return edges;
  };
  // A nearly collinear clipped sliver can acquire the opposite numerical
  // winding. Propagate orientation from the largest original triangle.
  const edges=edgeMap(),neighbours=faces.map(()=>[] as {face:number;opposite:boolean}[]);
  for(const uses of edges.values())if(uses.length===2){
    const [a,b]=uses;neighbours[a.face].push({face:b.face,opposite:a.a===b.a});neighbours[b.face].push({face:a.face,opposite:a.a===b.a});
  }
  const area=(vs:number[])=>{const [a,b,c]=vs.map(i=>vertices[i]);return b.clone().sub(a).cross(c.clone().sub(a)).length();};
  const order=faces.map((_,i)=>i).sort((a,b)=>area(faces[b].vertices)-area(faces[a].vertices));
  const flips=new Map<number,boolean>();
  for(const seed of order){
    if(flips.has(seed))continue;flips.set(seed,false);const pending=[seed];
    while(pending.length){const i=pending.pop()!;for(const n of neighbours[i])if(!flips.has(n.face)){flips.set(n.face,flips.get(i)!==n.opposite);pending.push(n.face);}}
  }
  for(const [i,flip]of flips)if(flip){faces[i].ids.reverse();faces[i].vertices.reverse();}
  const boundary=[...edgeMap().values()].filter(uses=>uses.length===1).map(uses=>uses[0]),used=new Set<number>();
  for(let start=0;start<boundary.length;start++){
    if(used.has(start))continue;
    const loop:number[]=[],parts:number[]=[],first=boundary[start].a;let i=start;
    while(i!==-1&&!used.has(i)){
      used.add(i);parts.push(i);loop.push(boundary[i].a);
      const next=boundary[i].b;if(next===first)break;
      i=boundary.findIndex((e,j)=>!used.has(j)&&e.a===next);
    }
    if(!parts.length||boundary[parts.at(-1)!].b!==first||loop.length<3)continue;
    const bounds=new T.Box3().setFromPoints(loop.map(i=>vertices[i]));
    let patchArea=0;for(let j=1;j<loop.length-1;j++)patchArea+=area([loop[0],loop[j],loop[j+1]]);
    if(bounds.getSize(new T.Vector3()).length()>.005||patchArea>2e-9)continue;
    const representative=(id:number)=>ids.indexOf(id);
    for(let j=1;j<loop.length-1;j++){
      const vs=[loop[0],loop[j+1],loop[j]];
      faces.push({vertices:vs,ids:vs.map(representative),material:geometry.groups.length>1?1:0});
    }
  }
  const indices:number[]=[];geometry.clearGroups();
  for(const face of faces){
    const last=geometry.groups.at(-1);if(last&&last.materialIndex===face.material)last.count+=3;else geometry.addGroup(indices.length,3,face.material);
    indices.push(...face.ids);
  }
  geometry.setIndex(indices);
}

// Tight, rounded slots follow the actual aerofoil at each skin intersection.
// Both sides share an XY profile, preserving symmetry without drilling an
// oblique tunnel through the opposite roof. The existing cutter closes the
// laminate rim and keeps the original surface normals outside the opening.
export function openSuspensionPassages(root:T.Group){
  root.updateMatrixWorld(true);
  const skins=["Silver nose skin","Continuous undercut sidepod shell","Tail heat shield",...[-1,1].map(s=>`Cockpit shoulder fairing ${s}`)].map(n=>root.getObjectByName(n) as T.Mesh);
  const cuts=new Map<T.Mesh,T.Vector2[][]>();
  for(const axle of ["Front","Rear"])for(const label of ["upper wishbone 0","upper wishbone 1","lower wishbone 0","lower wishbone 1","pushrod","track rod"]){
    const arm=root.getObjectByName(`${axle} -1 ${label}`) as T.Mesh;
    const anchor=new T.Vector3(...arm.userData.anchor as V),end=new T.Vector3(...arm.userData.terminal as V),span=end.clone().sub(anchor).normalize();
    const ray=new T.Raycaster(end,span.clone().negate(),0,end.distanceTo(anchor)+.045);
    const hits=ray.intersectObjects(skins,false).filter(h=>h.point.z<-.025);
    for(const skin of skins){
      const skinHits=hits.filter(h=>h.object===skin);if(!skinHits.length)continue;
      const p=arm.geometry.attributes.position,points:T.Vector2[]=[];
      const rim=(v:T.Vector3)=>{
        for(let k=0;k<12;k++)points.push(new T.Vector2(v.x+Math.cos(k*Math.PI/6)*.0035,v.y+Math.sin(k*Math.PI/6)*.0035));
      };
      if(axle==="Rear"){
        // The shoulder is curved in both directions. Projecting every section
        // onto the centre-line hit's Z plane misses where its leading/trailing
        // edges actually enter the skin. Trace the installed fairing surface
        // through both laminate faces before taking the rounded XY envelope.
        const targets=[skin];
        if(skin.name==="Continuous undercut sidepod shell")targets.push(root.getObjectByName("Bodywork inner laminate") as T.Mesh);
        const material=new T.MeshBasicMaterial({side:T.DoubleSide});
        const probes=targets.map(part=>{const probe=new T.Mesh(part.geometry,material);probe.matrixWorld.copy(part.matrixWorld);return probe;});
        const a=new T.Vector3(),b=new T.Vector3(),direction=new T.Vector3(),edgeRay=new T.Raycaster();
        for(let ring=0;ring<24;ring++)for(let j=0;j<40;j++){
          a.fromBufferAttribute(p,ring*40+j).applyMatrix4(arm.matrixWorld);
          b.fromBufferAttribute(p,(ring+1)*40+j).applyMatrix4(arm.matrixWorld);
          const length=a.distanceTo(b);direction.subVectors(b,a).normalize();edgeRay.set(a,direction);edgeRay.far=length;
          for(const hit of edgeRay.intersectObjects(probes,false))if(hit.point.z<-.025)rim(hit.point);
        }
        material.dispose();
      }
      for(const hit of skinHits){
      const t=T.MathUtils.clamp(hit.point.clone().sub(anchor).dot(span)/arm.userData.armLength,0,1);
      // Include the neighbouring rings: a curved panel meets the leading and
      // trailing edges at different depths along the tapered fairing.
      const first=Math.max(0,Math.floor(t*24)-(axle==="Rear"?2:0));
      const last=Math.min(24,axle==="Rear"?Math.ceil(t*24)+3:first+1);
      if(axle!=="Rear"||!points.length)for(let ring=first;ring<=last;ring++)for(let j=0;j<40;j++){
        const v=new T.Vector3().fromBufferAttribute(p,ring*40+j).applyMatrix4(arm.matrixWorld);
        v.addScaledVector(span,(hit.point.z-v.z)/span.z);
        rim(v);
      }
      if(label.includes("wishbone")&&t<.09){
        // Clearance for the pivot and both clevis cheeks behind the fairing.
        for(let i=0;i<32;i++)points.push(new T.Vector2(anchor.x+.031*Math.cos(i*Math.PI/16),anchor.y+.019*Math.sin(i*Math.PI/16)));
      }
      }
      const profile=convexHull(points);
      const targets=skin.name.startsWith("Cockpit shoulder")?skins.filter(p=>p.name.startsWith("Cockpit shoulder")):[skin];
      for(const target of targets)cuts.set(target,[...(cuts.get(target)??[]),profile]);
    }
  }
  for(const [skin,profiles] of cuts){
    const isBody=skin.name==="Continuous undercut sidepod shell";
    const inner=isBody?root.getObjectByName("Bodywork inner laminate") as T.Mesh:undefined;
    const seams=isBody?(skin.userData.floorSeams as number[][]).map(side=>side.map(i=>({p:new T.Vector3().fromBufferAttribute(skin.geometry.attributes.position,i),n:new T.Vector3().fromBufferAttribute(skin.geometry.attributes.normal,i)}))):undefined;
    if(inner){
      const original=skin.geometry,outer=original.clone(),inside=inner.geometry.clone();outer.deleteAttribute("uv");inside.deleteAttribute("uv");
      skin.geometry=mergeGeometries([outer,inside],true);original.dispose();outer.dispose();inside.dispose();
    }
    // seatSteeringSystem already makes the nose a 2 mm shell. Only these
    // separate shoulder fairings still need their inner surface.
    if(skin.name.startsWith("Cockpit shoulder"))hollowCover(skin);
    for(const profile of profiles){
      const original=skin.geometry;
      // Work in centimetres so the cutter's weld tolerance cannot erase
      // tiny edge fragments on the finely tessellated nose panel joint.
      const scaled=original.clone();scaled.setAttribute("position",new T.BufferAttribute(Float64Array.from(original.attributes.position.array),3));scaled.scale(100,100,100);
      // The central exhaust sleeve is a separate wall, well inside the side
      // skin. A suspension slot must not drill through that sleeve as well.
      const protectedHalfWidth=skin.name==="Tail heat shield"?7:0;
      const cut=servicePassage(scaled,profile.map(p=>p.clone().multiplyScalar(100)),true,protectedHalfWidth);cut.scale(.01,.01,.01);
      skin.geometry=cut;original.dispose();scaled.dispose();
    }
    cleanCut(skin.geometry);
    if(inner){
      const source=skin.geometry;
      const extract=(material:number)=>{
        const g=source.clone(),indices:number[]=[];
        for(const group of source.groups)if(group.materialIndex===material)for(let i=group.start;i<group.start+group.count;i++)indices.push(source.index!.getX(i));
        g.setIndex(indices);g.clearGroups();g.setAttribute("position",new T.Float32BufferAttribute(g.attributes.position.array,3));
        const compact=mergeVertices(g,1e-7);g.dispose();return compact;
      };
      skin.geometry=extract(0);inner.geometry.dispose();inner.geometry=extract(1);source.dispose();
      const p=skin.geometry.attributes.position,n=skin.geometry.attributes.normal;
      skin.userData.floorSeams=seams!.map(side=>side.map(seam=>{
        let best=-1,distance=Infinity;
        for(let i=0;i<p.count;i++){const d=new T.Vector3().fromBufferAttribute(p,i).distanceToSquared(seam.p);if(d<distance){distance=d;best=i;}}
        p.setXYZ(best,seam.p.x,seam.p.y,seam.p.z);n.setXYZ(best,seam.n.x,seam.n.y,seam.n.z);return best;
      }));
    }else skin.geometry.setAttribute("position",new T.Float32BufferAttribute(skin.geometry.attributes.position.array,3));
    skin.userData.suspensionPassages=profiles.map(profile=>profile.map(p=>p.toArray()));
  }
}
