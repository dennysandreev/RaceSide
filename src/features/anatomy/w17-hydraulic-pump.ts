import * as T from "three";
import {mergeGeometries} from "three/addons/utils/BufferGeometryUtils.js";
import {openRadialPort} from "./w17-wastegate.ts";

type Materials=Record<"metal"|"cast"|"darkMetal"|"rubber",T.Material>;
// Illustrative axial-piston mechanism at one operating swash angle. Neither
// the seven-piston layout nor these dimensions are published W17 specifications.
export const HYDRAULIC_PUMP={y:.335,z:.115,pitch:.0107,pistons:7,angle:Math.PI/12,plane:-.963,shoeOffset:.0022};
const frame=new T.Matrix4().makeBasis(new T.Vector3(0,1,0),new T.Vector3(0,0,1),new T.Vector3(1,0,0));
const tilt=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),HYDRAULIC_PUMP.angle);

// Reconcile the native end-face edges with vertices introduced by the two
// transverse cuts. Splitting collinear edges preserves the actual surface.
function joinBoreRims(source:T.BufferGeometry){
  const p=source.attributes.position,ix=source.index,vertices=new Map<string,T.Vector3>(),edges=new Map<string,number>(),faces:string[][]=[];
  for(let i=0;i<(ix?.count??p.count);i+=3){
    const ids=[0,1,2].map(j=>{const v=new T.Vector3().fromBufferAttribute(p,ix?ix.getX(i+j):i+j),k=v.toArray().map(n=>Math.round(n*1e7)).join();vertices.set(k,v);return k;});
    if(new Set(ids).size<3)continue;faces.push(ids);
    for(let j=0;j<3;j++){const k=[ids[j],ids[(j+1)%3]].sort().join("/");edges.set(k,(edges.get(k)??0)+1);}
  }
  const rim=[...new Set([...edges].filter(([,n])=>n===1).flatMap(([k])=>k.split("/")))].map(k=>vertices.get(k)!);
  if(!rim.length)return source;
  const points:number[]=[];
  for(const ids of faces){
    const boundary:T.Vector3[]=[];
    for(let j=0;j<3;j++){
      const a=vertices.get(ids[j])!,b=vertices.get(ids[(j+1)%3])!,d=b.clone().sub(a),length=d.lengthSq(),stops=[{t:0,v:a}];
      for(const v of rim){const t=v.clone().sub(a).dot(d)/length;if(t>1e-5&&t<1-1e-5&&a.clone().addScaledVector(d,t).distanceToSquared(v)<1e-14)stops.push({t,v});}
      stops.sort((a,b)=>a.t-b.t);boundary.push(...stops.map(p=>p.v));
    }
    if(boundary.length===3)points.push(...boundary.flatMap(v=>v.toArray()));
    else{const c=boundary.reduce((s,v)=>s.add(v),new T.Vector3()).divideScalar(boundary.length);for(let j=0;j<boundary.length;j++)points.push(...c.toArray(),...boundary[j].toArray(),...boundary[(j+1)%boundary.length].toArray());}
  }
  const next=new T.BufferGeometry();next.setAttribute("position",new T.Float32BufferAttribute(points,3));next.computeVertexNormals();source.dispose();return next;
}

export function createHydraulicPumpMotion(root:T.Object3D){
  const rotor=root.getObjectByName("Hydraulic pump rotating group"),retainer=root.getObjectByName("Hydraulic pump shoe retainer");
  const pistons=rotor?.children.filter(p=>p.userData.engineMotion==="hydraulicPiston")??[];
  const xAxis=new T.Vector3(1,0,0),spin=new T.Quaternion(),inverse=new T.Quaternion();
  return (angle:number)=>{
    if(!rotor)return;
    const a=angle*rotor.userData.ratio+rotor.userData.phase;
    spin.setFromAxisAngle(xAxis,a);inverse.copy(spin).invert();
    for(const piston of pistons){
      piston.position.x=HYDRAULIC_PUMP.plane-Math.tan(HYDRAULIC_PUMP.angle)*HYDRAULIC_PUMP.pitch*Math.cos(piston.userData.phase+a)-HYDRAULIC_PUMP.shoeOffset/Math.cos(HYDRAULIC_PUMP.angle);
      // The spherical piston end rotates inside a shoe that stays parallel to
      // the stationary swash surface. Only transforms change at runtime.
      piston.children[0].quaternion.copy(inverse).multiply(tilt);
    }
    if(retainer)retainer.quaternion.copy(tilt).multiply(spin);
  };
}

export function rebuildHydraulicPump(car:T.Group,system:T.Group,mat:Materials){
  const {y,z,pitch,pistons,angle,plane}=HYDRAULIC_PUMP;
  const root=new T.Group();root.name="Hydraulic pump internals";root.position.set(0,y,z);system.add(root);
  const add=(name:string,g:T.BufferGeometry,material:T.Material=mat.metal,cover=false,parent:T.Object3D=root)=>{
    const mesh=new T.Mesh(g,material);mesh.name=`Hydraulic pump ${name}`;
    mesh.userData={component:"hydraulics",internal:true,hydraulicPump:true,hydraulicDrive:cover,hydraulicPumpCover:cover,serviceCover:cover};
    mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  const axialGeometry=(shape:T.Shape,a:number,b:number)=>new T.ExtrudeGeometry(shape,{depth:b-a,bevelEnabled:false,curveSegments:32}).applyMatrix4(frame).translate(a,0,0);
  const bore=(shape:T.Shape,cy:number,cz:number,r:number)=>{const h=new T.Path();h.absarc(cy,cz,r,0,Math.PI*2,true);shape.holes.push(h);};
  const disk=(r:number)=>{const s=new T.Shape();s.absarc(0,0,r,0,Math.PI*2,false);return s;};
  const lathe=(points:number[][])=>new T.LatheGeometry(points.map(([x,r])=>new T.Vector2(r,x)),48).rotateZ(-Math.PI/2);
  const ring=(name:string,a:number,b:number,inner:number,outer:number,material:T.Material=mat.metal,cover=false,parent:T.Object3D=root)=>add(name,lathe([[a,inner],[a,outer],[b,outer],[b,inner],[a,inner]]),material,cover,parent);
  const tieCentres=[[-.0168,-.0108],[-.0168,.0108],[.0168,-.0108],[.0168,.0108]];
  const shell=()=>{const s=new T.Shape();s.absellipse(0,0,.024,.020,0,Math.PI*2,false,0);tieCentres.forEach(([y,z])=>bore(s,y,z,.0014));return s;};
  const replace=(name:string,g:T.BufferGeometry)=>{
    const part=car.getObjectByName(`Hydraulic pump ${name}`) as T.Mesh;
    part.geometry.dispose();part.geometry=g;part.position.set(0,y,z);part.quaternion.identity();part.userData={...part.userData,hydraulicPump:true,hydraulicPumpCover:true,serviceCover:true};return part;
  };
  // The pressure gallery is isolated in the taller top wall; the surrounding
  // case remains the inlet chamber. The original hose endpoints are retained.
  const casing=shell();bore(casing,0,0,.017);bore(casing,.0208,0,.0024);
  const body=replace("body",axialGeometry(casing,-.998,-.954));
  // Millimetre-scale bores need a local construction frame: the clipping
  // helper's absolute plane tolerance otherwise leaves tiny rim slivers.
  body.geometry.translate(.98,0,0).scale(100,100,100);
  openRadialPort(body,[-.9,0],.29,1);
  body.geometry.rotateX(Math.PI/2);openRadialPort(body,[1.2,0],.22,1,2.08);body.geometry.rotateX(-Math.PI/2);
  body.geometry.scale(.01,.01,.01).translate(-.98,0,0);body.geometry=joinBoreRims(body.geometry);
  const front=shell();bore(front,0,0,.0071);add("front bearing cap",axialGeometry(front,-.954,-.951),mat.cast,true);
  replace("end plate",axialGeometry(shell(),-1.009,-1.004));
  const sector=(inner:number,outer:number,a:number,b:number)=>{
    const p=new T.Path();p.absarc(0,0,outer,a,b,false);p.lineTo(Math.cos(b)*inner,Math.sin(b)*inner);p.absarc(0,0,inner,b,a,true);p.closePath();return p;
  };
  const plate=disk(.0159);bore(plate,0,0,.0042);
  plate.holes.push(sector(.0081,.0133,.30,Math.PI-.30),sector(.0081,.0133,Math.PI+.30,Math.PI*2-.30));
  add("valve plate",axialGeometry(plate,-.998,-.996),mat.metal);
  const portBlock=shell();bore(portBlock,0,0,.0062);
  portBlock.holes.push(sector(.0081,.017,.30,Math.PI-.30));
  const discharge=new T.Path(),a=Math.PI+.30,b=Math.PI*2-.30;
  discharge.absarc(0,0,.0133,a,b,false);discharge.lineTo(.0208,-.0024);discharge.absarc(.0208,0,.0024,-Math.PI/2,Math.PI/2,false);
  discharge.lineTo(.0148,.0024);discharge.lineTo(Math.cos(b)*.0081,Math.sin(b)*.0081);discharge.absarc(0,0,.0081,b,a,true);discharge.closePath();portBlock.holes.push(discharge);
  add("port block",axialGeometry(portBlock,-1.004,-.998),mat.cast,true);
  for(const [i,[cy,cz]]of tieCentres.entries()){
    ring(`case tie bolt ${i}`,-1.009,-.951,0,.0013,mat.darkMetal,true).position.set(0,cy,cz);
    ring(`case tie head ${i}`,-1.011,-1.009,.0007,.0023,mat.metal,true).position.set(0,cy,cz);
  }
  ring("front shaft bush",-.954,-.951,.0041,.0071);
  ring("rear shaft bush",-1.003,-.999,.0041,.0062);
  ring("rear bearing outer seat",-1.004,-1.003,.0059,.0062,mat.cast);
  ring("front bearing outer seat",-.999,-.998,.0059,.0062,mat.cast);
  const output=car.getObjectByName("Hydraulic drive output")!;
  const rotor=new T.Group();rotor.name="Hydraulic pump rotating group";rotor.userData={component:"hydraulics",hydraulicPump:true,engineMotion:"accessoryShaft",ratio:output.userData.ratio,phase:output.userData.phase};root.add(rotor);
  const spline=(gap:number)=>Array.from({length:24},(_,i)=>{const t=i*Math.PI/12,r=(i%4===0||i%4===3?.0034:.004)+gap;return new T.Vector2(Math.cos(t)*r,Math.sin(t)*r);});
  const barrelBack=-.99598,barrelFront=-.978,pinPitch=.0062;
  const pinCentres=Array.from({length:3},(_,i)=>new T.Vector2(Math.cos(i*Math.PI*2/3)*pinPitch,Math.sin(i*Math.PI*2/3)*pinPitch));
  const barrel=disk(.0155);barrel.holes.push(new T.Path(spline(.00004).reverse()));
  for(let i=0;i<pistons;i++){const t=i*Math.PI*2/pistons;bore(barrel,Math.cos(t)*pitch,Math.sin(t)*pitch,.00255);}
  // Native stepped bore: a spring chamber between two splined lands. Generate
  // its faces and walls directly, so no solid end cap blocks the thrust pins.
  const pieces:T.BufferGeometry[]=[];
  const face=(shape:T.Shape,x:number,sign:number)=>{
    const g=new T.ShapeGeometry(shape,32).applyMatrix4(frame).translate(x,0,0);
    if(sign<0){const ix=g.index!;for(let i=0;i<ix.count;i+=3){const a=ix.getX(i);ix.setX(i,ix.getX(i+2));ix.setX(i+2,a);}}
    g.deleteAttribute("normal");g.deleteAttribute("uv");pieces.push(g.toNonIndexed());g.dispose();
  };
  const wall=(path:T.Path,lo:number,hi:number)=>{
    const pts=path.getPoints(32);if(pts[0].distanceTo(pts.at(-1)!)<1e-8)pts.pop();
    const points:number[]=[];
    for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];points.push(lo,a.x,a.y,lo,b.x,b.y,hi,b.x,b.y,lo,a.x,a.y,hi,b.x,b.y,hi,a.x,a.y);}
    const g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(points,3));pieces.push(g);
  };
  face(barrel,barrelBack,-1);wall(new T.Path(barrel.getPoints(32)),barrelBack,barrelFront);
  barrel.holes.slice(1).forEach(h=>wall(h,barrelBack,barrelFront));
  wall(barrel.holes[0],barrelBack,-.994);wall(barrel.holes[0],-.981,barrelFront);
  const chamber=new T.Path();chamber.absarc(0,0,.0074,0,Math.PI*2,true);wall(chamber,-.994,-.981);
  const rearShoulder=disk(.0074);rearShoulder.holes.push(barrel.holes[0].clone());face(rearShoulder,-.994,1);
  const frontShoulder=rearShoulder.clone(),frontFace=barrel.clone();
  for(const c of pinCentres){bore(frontShoulder,c.x,c.y,.00095);bore(frontFace,c.x,c.y,.00095);wall(frontFace.holes.at(-1)!, -.981,barrelFront);}
  face(frontShoulder,-.981,-1);face(frontFace,barrelFront,1);
  const barrelGeometry=mergeGeometries(pieces)!;pieces.forEach(g=>g.dispose());barrelGeometry.computeVertexNormals();
  add("cylinder barrel",barrelGeometry,mat.cast,false,rotor).userData.hydraulicBarrel=true;
  add("splined shaft",axialGeometry(new T.Shape(spline(0)),barrelBack,-.978),mat.darkMetal,false,rotor);
  ring("front journal",-.978,-.974,0,.004,mat.darkMetal,false,rotor);
  ring("rear journal",-1.0038,barrelBack,0,.004,mat.darkMetal,false,rotor);
  ring("rear shaft retainer",-1.0038,-1.003,.004,.0058,mat.darkMetal,false,rotor);
  ring("front shaft retainer",-.999,-.9982,.004,.0058,mat.darkMetal,false,rotor);

  const ballRadius=.0016,ballStart=-Math.sqrt(ballRadius**2-.001**2),ballEnd=Math.sqrt(ballRadius**2-.0006**2);
  const pistonProfile=[[-.024,.0006],[-.024,.0025],[-.004,.0025],[-.003,.001],[ballStart,.001],...Array.from({length:25},(_,i)=>{const x=ballStart+(ballEnd-ballStart)*i/24;return[x,Math.sqrt(ballRadius**2-x*x)];}),[ballEnd,.0006],[-.024,.0006]];
  const shoeProfile=[[-.0003,.002],[.0008,.002],[.0008,.0036],[.0022,.0036],[.0022,.0011],[.0020,.0011],[.0020,.0005],[.0015,.0005],...Array.from({length:25},(_,i)=>{const x=.0015-(.0015+.0003)*i/24;return[x,Math.sqrt(ballRadius**2-x*x)+.00004];}),[-.0003,.002]];
  const pistonGeometry=lathe(pistonProfile),shoeGeometry=lathe(shoeProfile);
  for(let i=0;i<pistons;i++){
    const phase=i*Math.PI*2/pistons,piston=add(`piston ${i}`,pistonGeometry,mat.metal,false,rotor);
    piston.position.set(0,Math.cos(phase)*pitch,Math.sin(phase)*pitch);piston.userData.engineMotion="hydraulicPiston";piston.userData.phase=phase;
    add(`slipper ${i}`,shoeGeometry,mat.cast,false,piston);
  }
  const swash=ring("swashplate",0,.002,.006,.016,mat.darkMetal);swash.position.x=plane;swash.quaternion.copy(tilt);
  // A fixed support records this explanatory operating angle. Regulation of
  // displacement and its pressure compensator remain outside this mechanism.
  const supportShape=disk(.0158);bore(supportShape,0,0,.008);
  const support=axialGeometry(supportShape,0,.009);
  const sp=support.attributes.position;
  for(let i=0;i<sp.count;i++)sp.setX(i,sp.getX(i)<.004?plane-Math.tan(angle)*sp.getY(i)+.002/Math.cos(angle):-.954);
  support.computeVertexNormals();add("swash support",support,mat.cast);
  const hold=disk(.0158);bore(hold,0,0,.0058);
  for(let i=0;i<pistons;i++){const t=i*Math.PI*2/pistons;bore(hold,Math.cos(t)*pitch,Math.sin(t)*pitch,.0031);}
  const retainer=add("shoe retainer",axialGeometry(hold,-.0021,-.00145),mat.metal);
  const guideRadius=.006,seatRadius=.0058,seatDistance=Math.sqrt(guideRadius**2-seatRadius**2),guideCentre=plane-(seatDistance+.0021)/Math.cos(angle);
  retainer.position.set(guideCentre,0,0).add(new T.Vector3(Math.cos(angle),Math.sin(angle),0).multiplyScalar(seatDistance+.0021));retainer.userData.engineMotion="hydraulicRetainer";
  // The plate pivots about the spherical guide, not its old arbitrary centre.
  // Three guided pins transmit spring load from the barrel to this ball seat.
  const guideStart=-.0022,guideEnd=Math.sqrt(guideRadius**2-.0041**2);
  const guideProfile=[[-.974,.0041],[-.974,.0073],[guideCentre-.0045,.0056],[guideCentre+guideStart,Math.sqrt(guideRadius**2-guideStart**2)],
    ...Array.from({length:33},(_,i)=>{const x=guideStart+(guideEnd-guideStart)*i/32;return[guideCentre+x,Math.sqrt(Math.max(0,guideRadius**2-x*x))];}),[guideCentre+guideEnd,.0041],[-.974,.0041]];
  const guide=add("retainer ball seat",lathe(guideProfile),mat.metal,false,rotor);guide.userData.sphericalGuide={centre:guideCentre,radius:guideRadius,seatRadius};
  for(const [i,c]of pinCentres.entries())ring(`retainer thrust pin ${i}`,-.982,-.974,0,.00085,mat.darkMetal,false,rotor).position.set(0,c.x,c.y);
  ring("preload rear washer",-.994,-.993,.0041,.00735,mat.metal,false,rotor);
  ring("preload front washer",-.983,-.982,.0041,.00735,mat.metal,false,rotor);
  const springCurve=new class extends T.Curve<T.Vector3>{
    constructor(){super();}
    getPoint(t:number,target=new T.Vector3()){
      const u=Math.max(0,Math.min(1,(t-.05)/.9)),blend=.06;
      const rise=(u<blend?u*u/(2*blend):u>1-blend?1-blend-(1-u)**2/(2*blend):u-blend/2)/(1-blend);
      return target.set(-.99255+rise*.00910,Math.cos(t*Math.PI*10)*.00655,Math.sin(t*Math.PI*10)*.00655);
    }
  }(),springGeometry=new T.TubeGeometry(springCurve,240,.00045,8,false);
  // Keep a cross-section vertex on each axial extremum of the ground coils;
  // accumulated Frenet twist would otherwise leave a small seating gap.
  const springVertices=springGeometry.attributes.position;
  for(let i=0;i<=240;i++){
    const t=i/240,p=springCurve.getPointAt(t),tangent=springCurve.getTangentAt(t),n=new T.Vector3(1,0,0).addScaledVector(tangent,-tangent.x).normalize(),b=new T.Vector3().crossVectors(tangent,n);
    for(let j=0;j<=8;j++){const a=j*Math.PI/4,v=p.clone().addScaledVector(n,-Math.cos(a)*.00045).addScaledVector(b,Math.sin(a)*.00045);springVertices.setXYZ(i*9+j,v.x,v.y,v.z);}
  }
  // Close the wire ends; the flattened first/last coils seat on both washers.
  const si=Array.from(springGeometry.index!.array),radial=9,last=240*radial;
  for(let i=1;i<7;i++){si.push(0,i,i+1);si.push(last,last+i+1,last+i);}springGeometry.setIndex(si);springGeometry.computeVertexNormals();
  add("barrel preload spring",springGeometry,mat.darkMetal,false,rotor);
  // The retaining plate's oversized neck holes accommodate the small ellipse
  // traced by shoes in the tilted plane without clipping their ball sockets.
  const pressureUnion=car.getObjectByName("Hydraulic pump pressure union") as T.Mesh;
  pressureUnion.geometry.dispose();pressureUnion.geometry=new T.LatheGeometry([[.00216,0],[.0047,0],[.0047,.006],[.00216,.006],[.00216,0]].map(p=>new T.Vector2(...p)),32);pressureUnion.position.set(-.968,.359,.115);pressureUnion.quaternion.identity();
  const shoulder=car.getObjectByName("Hydraulic pump pressure sealing shoulder") as T.Mesh;
  shoulder.geometry.dispose();shoulder.geometry=new T.LatheGeometry([[.00216,0],[.006,0],[.006,.002],[.00216,.002],[.00216,0]].map(p=>new T.Vector2(...p)),32);shoulder.position.set(-.968,.359,.115);shoulder.quaternion.identity();
  // Curve tangents use a finite difference. Seat their final cross-sections
  // exactly on the union faces instead of leaving a tilted, intersecting rim.
  for(const [name,end,axis,radius]of[
    ["suction hose",new T.Vector3(-.989,.335,.145),new T.Vector3(0,0,1),.004],
    ["delivery hose",new T.Vector3(-.968,.365,.115),new T.Vector3(0,1,0),.003],
  ] as const){
    const hose=car.getObjectByName(`Hydraulic pump ${name}`) as T.Mesh,p=hose.geometry.attributes.position;
    for(let i=0;i<p.count;i++){const v=new T.Vector3().fromBufferAttribute(p,i),d=v.clone().sub(end).dot(axis);if(Math.abs(d)<.00001&&v.distanceTo(end)<radius+.0002){v.addScaledVector(axis,-d);p.setXYZ(i,v.x,v.y,v.z);}}
    p.needsUpdate=true;hose.geometry.computeVertexNormals();
  }
  for(const part of system.children)if(/^Hydraulic pump (drive seal|mounting flange|fixing|inlet|pressure)/.test(part.name))part.userData.hydraulicPump=true;
  for(const part of system.children)if(/^Hydraulic pump (mounting flange|fixing|inlet|pressure)/.test(part.name)){part.userData.serviceCover=true;part.userData.hydraulicPumpCover=true;}
  car.getObjectByName("Hydraulic pump drive quill")!.userData.hydraulicPump=true;
  root.userData={...HYDRAULIC_PUMP,construction:"inferred axial piston mechanism; fixed display angle"};
  car.updateMatrixWorld(true);
}
