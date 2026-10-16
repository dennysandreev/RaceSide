import * as T from "three";
import { servicePassage } from "./w17-feedthrough.ts";
import { createHeightSampler, createSurfaceSampler } from "./w17-surface.ts";

type Materials=Record<"silver"|"carbon"|"metal"|"darkMetal",T.Material>;
type V=[number,number,number];

// Visible proportions follow the January W17 launch renders. The concealed
// ventilation route is reconstructed; it is not a Mercedes duct drawing.
const ductStations=[
  [.680,.560],[.750,.560],[.850,.590],[.920,.605],
  [1.050,.630],[1.120,.647],[1.200,.667],[1.250,.673],
];
function ductHeight(x:number){
  const i=Math.max(0,Math.min(ductStations.length-2,ductStations.findIndex(s=>s[0]>=x)-1));
  // Beyond the scoop the cutting path leaves the roof immediately. Extending
  // a level bore forward would cut through the aerial's mounting surface.
  if(x>=1.250)return .673+(x-1.250)*2;
  const [a,b]=[ductStations[i],ductStations[i+1]];
  return T.MathUtils.lerp(a[1],b[1],T.MathUtils.clamp((x-a[0])/(b[0]-a[0]),0,1));
}

// Fit the visible roof behind the front axle to KA 10, retaining the nose
// underside and the forward wing interfaces. These are photo-derived offsets,
// not a rescaling of the crash structure or measured Mercedes sections.
export function refitNoseRoof(nose:T.Mesh){
  const offsets=[[.850,0],[1.000,.012],[1.200,.028],[1.350,.049],
    [1.470,.073],[1.600,.090],[1.750,.080],[1.950,.036],[2.130,0]];
  nose.updateWorldMatrix(true,false);
  const p=nose.geometry.attributes.position,surface=createSurfaceSampler([nose],"y");
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),j=offsets.findIndex(s=>s[0]>=x);
    if(j<=0)continue;
    const [a,b]=[offsets[j-1],offsets[j]],t=(x-a[0])/(b[0]-a[0]);
    // Cubic Hermite interpolation with shared centred slopes avoids a kink
    // in the roof at each reference station.
    const slope=(k:number)=>k===0||k===offsets.length-1?0:
      (offsets[k+1][1]-offsets[k-1][1])/(offsets[k+1][0]-offsets[k-1][0]);
    const lift=(2*t**3-3*t*t+1)*a[1]+(t**3-2*t*t+t)*(b[0]-a[0])*slope(j-1)
      +(-2*t**3+3*t*t)*b[1]+(t**3-t*t)*(b[0]-a[0])*slope(j);
    const lo=surface(x,0,-1)!,hi=surface(x,0,1)!;
    p.setY(i,y+lift*T.MathUtils.smoothstep((y-lo)/(hi-lo),.35,1));
  }
  p.needsUpdate=true;nose.geometry.computeVertexNormals();
  nose.geometry.computeBoundingBox();nose.geometry.computeBoundingSphere();
}
function section(halfHeight:number,halfWidth:number){
  return Array.from({length:64},(_,i)=>{
    const a=i*Math.PI/32,c=Math.abs(Math.cos(a))<1e-12?0:Math.cos(a),s=Math.abs(Math.sin(a))<1e-12?0:Math.sin(a);
    return new T.Vector2(Math.sign(c)*Math.abs(c)**.5*halfHeight,Math.sign(s)*Math.abs(s)**.5*halfWidth);
  });
}
function geometry(points:number[],indices:number[]){
  const g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(points,3));g.setIndex(indices);g.computeVertexNormals();return g;
}

// Resolve a narrow panel joint only where it crosses the existing roof. Shared
// edge splits keep the skin watertight; the rest of the nose keeps its mesh and
// interpolated normals. The joint is recessed into the skin, not laid over it.
function panelJoint(nose:T.Mesh,material:T.Material){
  const roof=createHeightSampler(nose.geometry);
  const path=new T.CatmullRomCurve3([
    [1.310,0,-.176],[1.140,0,-.124],[1.040,0,-.090],[1.000,0,-.073],
    [.985,0,-.050],[.983,0,0],[.985,0,.050],[1.000,0,.073],
    [1.040,0,.090],[1.140,0,.124],[1.310,0,.176],
  ].map(p=>new T.Vector3(...p)),false,"centripetal");
  const line=path.getPoints(72),segments=line.slice(1).map((b,i)=>new T.Line3(line[i],b));
  const distance=(v:T.Vector3)=>{
    const flat=new T.Vector3(v.x,0,v.z),closest=new T.Vector3();let best=Infinity;
    for(const segment of segments)best=Math.min(best,segment.closestPointToPoint(flat,true,closest).distanceToSquared(flat));
    return Math.sqrt(best);
  };
  const source=nose.geometry,p=source.attributes.position,normal=source.attributes.normal,ix=source.index!;
  const vertices=Array.from({length:p.count},(_,i)=>new T.Vector3().fromBufferAttribute(p,i));
  const normals=vertices.map((_,i)=>new T.Vector3().fromBufferAttribute(normal,i));
  let faces=Array.from({length:ix.count/3},(_,i)=>[ix.getX(i*3),ix.getX(i*3+1),ix.getX(i*3+2)]);
  const key=(a:number,b:number)=>[vertices[a],vertices[b]].map(v=>v.toArray().map(n=>Math.round(n*1e7)).join()).sort().join("/");
  const near=(f:number[])=>{
    const [a,b,c]=f.map(i=>vertices[i]);
    if(Math.max(a.x,b.x,c.x)<.980||Math.min(a.x,b.x,c.x)>1.315||Math.min(a.y,b.y,c.y)<.48)return false;
    const centre=a.clone().add(b).add(c).multiplyScalar(1/3);
    if(Math.abs(centre.y-roof(centre.x,centre.z)!)>.002)return false;
    // The triangle's circumscribing radius bounds its distance to the joint;
    // this also catches a seam crossing a face with all three corners outside.
    return distance(centre)<.0015+Math.max(centre.distanceTo(a),centre.distanceTo(b),centre.distanceTo(c));
  };
  for(let pass=0;pass<17;pass++){
    const split=new Map<string,number>();
    for(const f of faces)if(near(f)){
      let longest=0,length=0;
      for(let j=0;j<3;j++){const d=vertices[f[j]].distanceToSquared(vertices[f[(j+1)%3]]);if(d>length){length=d;longest=j;}}
      if(length<=.0007**2)continue;
      const a=f[longest],b=f[(longest+1)%3],k=key(a,b);
      if(!split.has(k)){
        split.set(k,vertices.length);vertices.push(vertices[a].clone().lerp(vertices[b],.5));normals.push(normals[a].clone().lerp(normals[b],.5).normalize());
      }
    }
    if(!split.size)break;
    const next:number[][]=[];
    for(const f of faces){
      const mid=f.map((a,j)=>split.get(key(a,f[(j+1)%3]))),count=mid.filter(i=>i!==undefined).length;
      if(!count){next.push(f);continue;}
      if(count===3){const [a,b,c]=f,[u,v,w]=mid as number[];next.push([a,u,w],[u,b,v],[w,v,c],[u,v,w]);continue;}
      const j=count===1?mid.findIndex(i=>i!==undefined):mid.findIndex(i=>i===undefined);
      const a=f[j],b=f[(j+1)%3],c=f[(j+2)%3];
      if(count===1){const m=mid[j]!;next.push([a,m,c],[m,b,c]);}
      else{const u=mid[(j+1)%3]!,v=mid[(j+2)%3]!;next.push([a,b,u],[a,u,v],[v,u,c]);}
    }
    faces=next;
  }
  const recessed=new Set<number>();
  vertices.forEach((v,i)=>{
    if(v.x<.98||v.x>1.315||Math.abs(v.y-roof(v.x,v.z)!)>.00001)return;
    const d=distance(v);if(d>=.0012)return;
    v.y-=.0006*(1-T.MathUtils.smoothstep(d,0,.0012));recessed.add(i);
  });
  const result=geometry(vertices.flatMap(v=>v.toArray()),faces.flat()),rn=result.attributes.normal;
  normals.forEach((n,i)=>{if(!recessed.has(i))rn.setXYZ(i,n.x,n.y,n.z);});
  nose.geometry=result;source.dispose();

  const actualRoof=createHeightSampler(result),gp:number[]=[],gi:number[]=[];
  // A narrow seal sits on the floor of the groove, below the original roof.
  for(let i=0;i<line.length;i++){
    const v=line[i],t=path.getTangent(i/(line.length-1)),side=new T.Vector3(-t.z,0,t.x).normalize();
    for(const [offset,depth]of[[-.00016,-.00020],[.00016,-.00020],[.00016,.00002],[-.00016,.00002]]){
      const q=v.clone().addScaledVector(side,offset);gp.push(q.x,actualRoof(q.x,q.z)!+depth,q.z);
    }
    if(i)for(let j=0;j<4;j++){const a=(i-1)*4+j,b=(i-1)*4+(j+1)%4;gi.push(a,b,a+4,b,b+4,a+4);}
  }
  gi.push(0,2,1,0,3,2);const end=(line.length-1)*4;gi.push(end,end+1,end+2,end,end+2,end+3);
  const seal=new T.Mesh(geometry(gp,gi),material);seal.name="Nose service panel recessed joint";
  seal.userData={component:"bodywork",cover:true};nose.parent!.add(seal);
  return actualRoof;
}
// Boolean rims can carry sub-micron folded faces after returning to Float32
// world coordinates. Collapse only branching edges shorter than 3 µm and
// discard their zero-area attached flaps; preserve all physical wall surfaces.
function cleanRim(source:T.BufferGeometry){
  const p=source.attributes.position,ix=source.index!,vertices:T.Vector3[]=[],keys=new Map<string,number>(),remap:number[]=[];
  for(let i=0;i<p.count;i++){
    const v=new T.Vector3().fromBufferAttribute(p,i),key=v.toArray().map(n=>Math.round(n*1e6)).join();
    if(!keys.has(key)){keys.set(key,vertices.length);vertices.push(v);}
    remap.push(keys.get(key)!);
  }
  let faces=Array.from({length:ix.count/3},(_,i)=>[0,1,2].map(j=>remap[ix.getX(i*3+j)])).filter(f=>new Set(f).size===3);
  // A clipping plane tangent to the curved centreline can emit the same
  // triangle in both directions. It encloses no material; cancel the pair.
  const unique=new Map<string,number[]>();
  for(const face of faces){
    const key=[...face].sort((a,b)=>a-b).join(),other=unique.get(key);
    if(other&&other[(other.indexOf(face[0])+1)%3]===face[2])unique.delete(key);
    else unique.set(key,face);
  }
  faces=[...unique.values()];
  const edges=()=>{
    const result=new Map<string,number[]>();
    faces.forEach((f,i)=>{for(let j=0;j<3;j++){
      const key=[f[j],f[(j+1)%3]].sort((a,b)=>a-b).join();result.set(key,[...(result.get(key)??[]),i]);
    }});return result;
  };
  for(let pass=0;pass<3;pass++){
    let changed=false;
    for(const [key,incident]of edges()){
      const [a,b]=key.split(",").map(Number);
      if(incident.length>2&&vertices[a].distanceToSquared(vertices[b])<9e-12){
        faces=faces.map(f=>f.map(i=>i===b?a:i)).filter(f=>new Set(f).size===3);changed=true;
      }
    }
    if(!changed)break;
  }
  const neighbours=faces.map(()=>[] as number[]);
  for(const incident of edges().values())if(incident.length===2){const [a,b]=incident;neighbours[a].push(b);neighbours[b].push(a);}
  const seen=new Set<number>(),keep:number[][]=[];
  for(let i=0;i<faces.length;i++){
    if(seen.has(i))continue;
    const pending=[i],component:number[]=[];let area=0;
    while(pending.length){
      const j=pending.pop()!;if(seen.has(j))continue;seen.add(j);component.push(j);
      const [a,b,c]=faces[j].map(k=>vertices[k]);area+=b.clone().sub(a).cross(c.clone().sub(a)).length()/2;
      pending.push(...neighbours[j].filter(k=>!seen.has(k)));
    }
    if(area>1e-8)keep.push(...component.map(j=>faces[j]));
  }
  const result=geometry(vertices.flatMap(v=>v.toArray()),keep.flat());source.dispose();return result;
}
function retainSkinNormals(result:T.BufferGeometry,flat:T.BufferGeometry,profile:T.Vector2[]){
  const p=flat.attributes.position,normal=flat.attributes.normal,ix=flat.index!;
  flat.computeBoundingBox();const bounds=flat.boundingBox!,nx=64,nz=24;
  const dx=(bounds.max.z-bounds.min.z)/nx||1,dz=(bounds.max.y-bounds.min.y)/nz||1;
  const cellX=(x:number)=>T.MathUtils.clamp(Math.floor((x-bounds.min.z)/dx),0,nx-1);
  const cellZ=(z:number)=>T.MathUtils.clamp(Math.floor((z-bounds.min.y)/dz),0,nz-1);
  const cells:number[][]=Array.from({length:nx*nz},()=>[]),triangles:T.Triangle[]=[];
  for(let i=0;i<ix.count;i+=3){
    const vs=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,ix.getX(i+j))),id=triangles.length;
    triangles.push(new T.Triangle(...vs as [T.Vector3,T.Vector3,T.Vector3]));
    for(let x=cellX(Math.min(...vs.map(v=>v.z)));x<=cellX(Math.max(...vs.map(v=>v.z)));x++)for(let z=cellZ(Math.min(...vs.map(v=>v.y)));z<=cellZ(Math.max(...vs.map(v=>v.y)));z++)cells[x*nz+z].push(id);
  }
  const rp=result.attributes.position,rn=result.attributes.normal,point=new T.Vector3(),closest=new T.Vector3(),weights=new T.Vector3();
  const h=Math.max(...profile.map(p=>p.x)),w=Math.max(...profile.map(p=>p.y));
  for(let i=0;i<rp.count;i++){
    const x=rp.getX(i),y=rp.getY(i)-ductHeight(x),z=rp.getZ(i);
    if((y/h)**4+(z/w)**4<1.10)continue;
    point.set(y*100,z*100,(x-1.2)*100);
    for(const id of cells[cellX(point.z)*nz+cellZ(point.y)]){
      const triangle=triangles[id];triangle.closestPointToPoint(point,closest);
      if(closest.distanceToSquared(point)>1e-6)continue;
      triangle.getBarycoord(closest,weights);
      const n=new T.Vector3();[weights.x,weights.y,weights.z].forEach((a,j)=>n.addScaledVector(new T.Vector3().fromBufferAttribute(normal,ix.getX(id*3+j)),a));
      n.normalize();rn.setXYZ(i,n.x,n.y,n.z);break;
    }
  }
}
// Flatten the curved route into the existing longitudinal passage cutter.
// The inverse transform restores every uncut vertex to its original position.
function bore(part:T.Mesh,profile:T.Vector2[]){
  const source=part.geometry,flat=source.clone();
  flat.setAttribute("position",new T.BufferAttribute(Float64Array.from(source.attributes.position.array),3));
  const p=flat.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);p.setXYZ(i,(y-ductHeight(x))*100,z*100,(x-1.2)*100);
  }
  const cut=servicePassage(flat,profile.map(p=>p.clone().multiplyScalar(100))),q=cut.attributes.position;
  for(let i=0;i<q.count;i++){
    const y=q.getX(i)/100,z=q.getY(i)/100,x=q.getZ(i)/100+1.2;q.setXYZ(i,x,y+ductHeight(x),z);
  }
  part.geometry=cleanRim(cut);retainSkinNormals(part.geometry,flat,profile);source.dispose();flat.dispose();
}

export function addNoseDetails(root:T.Group,mat:Materials){
  const nose=root.getObjectByName("Silver nose skin") as T.Mesh;
  const roof=panelJoint(nose,mat.carbon),body=nose.parent!;
  const add=(name:string,g:T.BufferGeometry,material:T.Material,parent=body)=>{
    const mesh=new T.Mesh(g,material);mesh.name=name;
    mesh.userData={component:parent===body?"bodywork":"cockpit",cover:parent===body};
    mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  const rod=(name:string,a:V,b:V,r:number,r2=r,material=mat.darkMetal)=>{
    const axis=new T.Vector3(...b).sub(new T.Vector3(...a));
    const part=add(name,new T.CylinderGeometry(r2,r,axis.length(),16),material);
    part.position.set(...a).addScaledVector(axis,.5);part.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),axis.normalize());return part;
  };
  for(const side of[-1,1])for(const [i,x,z]of[[0,1.295,.164],[1,1.125,.107],[2,.998,.025]]){
    const y=roof(x,side*z)!,step=.0001;
    const n=new T.Vector3(-(roof(x+step,side*z)!-roof(x-step,side*z)!)/(step*2),1,
      -(roof(x,side*z+step)!-roof(x,side*z-step)!)/(step*2)).normalize();
    const profile=[[0,-.001],[.0015,-.001],[.002,0],[.0007,0],[.0007,-.0004],[0,-.0004]].map(p=>new T.Vector2(...p));
    const screw=add(`Nose service panel fixing ${side} ${i}`,new T.LatheGeometry(profile,16),mat.darkMetal);
    screw.position.set(x,y,side*z).addScaledVector(n,.00015);screw.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),n);
  }
  const connect=(indices:number[],a:number,b:number,n:number,reverse=false)=>{
    for(let j=0;j<n;j++){
      const k=(j+1)%n,faces=[a+j,a+k,b+j,a+k,b+k,b+j];
      if(reverse)for(let f=0;f<faces.length;f+=3)[faces[f+1],faces[f+2]]=[faces[f+2],faces[f+1]];
      indices.push(...faces);
    }
  };

  // A shallow rounded scoop with a buried return. Its rim and the nose are
  // bored together, so the inlet is a real opening rather than a dark decal.
  const points:number[]=[],faces:number[]=[],rings=49,n=64;
  for(let r=0;r<rings;r++){
    const t=r/(rings-1),x=1.250-.240*t,h=.030*(1-T.MathUtils.smoothstep(t,0,1));
    const width=.091-.020*T.MathUtils.smoothstep(t,0,1);
    for(let j=0;j<n;j++){
      const a=j*Math.PI*2/n,z=Math.sin(a)*width;
      points.push(x,roof(x,z)!-.003+(Math.cos(a)>=-1e-12?.001+Math.max(0,Math.cos(a))**.25*h:0),z);
    }
    if(r)connect(faces,(r-1)*n,r*n,n);
  }
  for(const r of[0,rings-1]){
    const profile=Array.from({length:n},(_,j)=>new T.Vector2(points[(r*n+j)*3+1],points[(r*n+j)*3+2]));
    for(const [a,b,c]of T.ShapeUtils.triangulateShape(profile,[]))faces.push(...(r===0?[r*n+a,r*n+c,r*n+b]:[r*n+a,r*n+b,r*n+c]));
  }
  for(let i=0;i<faces.length;i+=3)[faces[i+1],faces[i+2]]=[faces[i+2],faces[i+1]];
  const scoop=add("Nose driver cooling scoop",geometry(points,faces),mat.silver);
  const clearance=section(.010,.0712);
  bore(scoop,clearance);
  for(const part of[nose,root.getObjectByName("Forward survival cell deck"),root.getObjectByName("Front suspension access cover")])bore(part as T.Mesh,clearance);

  // Closed 2–3 mm duct walls, both ends open. Stations include every change
  // in slope; the front lip is seated inside the scoop's aperture.
  const xs:number[]=[];
  for(let i=0;i<ductStations.length-1;i++){
    const a=ductStations[i][0],b=ductStations[i+1][0],steps=Math.ceil((b-a)/.01);
    for(let j=0;j<steps;j++)xs.push(T.MathUtils.lerp(a,b,j/steps));
  }
  xs.push(1.248);
  const dp:number[]=[],di:number[]=[],outer=section(.0098,.071),inner=section(.0078,.069),count=xs.length*n;
  for(const profile of[outer,inner])for(const x of xs)for(const p of profile)dp.push(x,ductHeight(x)+p.x,p.y);
  for(let i=0;i<xs.length-1;i++){
    connect(di,i*n,(i+1)*n,n);connect(di,count+i*n,count+(i+1)*n,n,true);
  }
  connect(di,0,count,n,true);connect(di,(xs.length-1)*n,count+(xs.length-1)*n,n);
  const cockpit=root.getObjectByName("Cockpit inner lining 1")!.parent!;
  const duct=add("Cockpit nose ventilation duct",geometry(dp,di),mat.carbon,cockpit);
  duct.userData.internal=true;
  duct.userData.ports={inlet:[1.248,ductHeight(1.248),0],outlet:[.680,.560,0]};

  // Conforming feet use the actual finished nose, not a guessed horizontal
  // plane. A thin root, two fixings and tapered stems avoid floating antennae.
  function foot(name:string,x:number,rx:number,rz:number){
    const points:number[]=[],faces:number[]=[],n=32;
    for(const lift of[0,.002]){
      points.push(x,roof(x,0)!+lift,0);
      for(let i=0;i<n;i++){
        const a=i*Math.PI*2/n,px=x+Math.cos(a)*rx,z=Math.sin(a)*rz;
        points.push(px,roof(px,z)!+lift,z);
      }
    }
    for(let i=0;i<n;i++){
      const a=1+i,b=1+(i+1)%n,off=n+1;
      faces.push(0,a,b,off,b+off,a+off,a,a+off,b,b,a+off,b+off);
    }
    add(`${name} mounting foot`,geometry(points,faces),mat.darkMetal);
    for(const side of[-1,1]){
      const px=x+side*rx*.65,y=roof(px,0)!;
      rod(`${name} fixing ${side}`,[px,y,0],[px,y+.0025,0],.0014,.0014,mat.metal);
    }
    return roof(x,0)!+.002;
  }
  const mastX=1.470,mastY=foot("Nose air-data mast",mastX,.018,.009);
  rod("Nose air-data mast",[mastX,mastY,0],[mastX-.005,mastY+.155,0],.004,.0018);
  for(const [i,height]of[.111,.145].entries()){
    const x=mastX-.005*height/.155,y=mastY+height;
    const profile=[[.00075,0],[.00135,0],[.0016,.052],[.00075,.052],[.00075,0]].map(p=>new T.Vector2(...p));
    const tube=add(`Nose air-data probe ${i}`,new T.LatheGeometry(profile,24),mat.metal);
    tube.position.set(x,y,0);tube.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),new T.Vector3(1,.06,0).normalize());
  }
  for(const [i,x,height]of[[0,1.280,.073],[1,.900,.080]]){
    const y=foot(`Nose antenna ${i}`,x,.011,.007);
    rod(`Nose antenna ${i} base`,[x,y,0],[x,y+.006,0],.0024,.0015);
    rod(`Nose antenna ${i} whip`,[x,y+.005,0],[x-.003,y+height,0],.00085,.00035,mat.metal);
  }
  root.updateMatrixWorld(true);
}
