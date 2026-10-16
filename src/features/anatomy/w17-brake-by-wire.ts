import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { openRadialPort } from "./w17-wastegate.ts";
import { createSurfaceSampler } from "./w17-surface.ts";

type V = [number, number, number];
type Materials = Record<"metal" | "cast" | "darkMetal" | "black" | "rubber", T.Material>;
const v = (p: V) => new T.Vector3(...p);
export type BrakePort = {point:V;axis:V;mesh:string};

// Reconstructed combined actuator: a hydraulic piston drives a separate brake
// piston across a dry, sealed separator. No proprietary W17 dimensions implied.
export function createRearBrakeByWire(mat: Materials) {
  const root = new T.Group(); root.name = "Rear brake-by-wire actuator";
  root.position.set(-1.28,.255,.140);
  const localPorts: Record<string,BrakePort> = {};
  const add = (name: string, geometry: T.BufferGeometry, material = mat.metal, cover = false) => {
    const mesh = new T.Mesh(geometry,material);mesh.name=`BBW ${name}`;
    mesh.userData={component:"brake-by-wire",internal:true,serviceCover:cover};
    mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);return mesh;
  };
  const box = (name: string, p: V, size: V, material = mat.cast, cover = false) => {
    const mesh=add(name,new RoundedBoxGeometry(...size,2,.001),material,cover);mesh.position.set(...p);return mesh;
  };
  const ring = (name: string, a: V, b: V, inner: number, outer: number, material = mat.metal, cover = false) => {
    const axis=v(b).sub(v(a));
    const mesh=add(name,new T.LatheGeometry([[inner,0],[outer,0],[outer,axis.length()],[inner,axis.length()],[inner,0]].map(p=>new T.Vector2(...p)),32),material,cover);
    mesh.position.set(...a);mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),axis.normalize());return mesh;
  };
  const rod = (name:string,a:V,b:V,radius:number,material=mat.metal,cover=false,sides=24) => {
    const axis=v(b).sub(v(a)),mesh=add(name,new T.CylinderGeometry(radius,radius,axis.length(),sides),material,cover);
    mesh.position.copy(v(a)).addScaledVector(axis,.5);mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),axis.normalize());return mesh;
  };
  const screw = (name:string,a:V,b:V,cover=false) => {
    rod(`${name} shank`,a,b,.0012,mat.darkMetal,cover);
    ring(`${name} head`,b,v(b).addScaledVector(v(b).sub(v(a)).normalize(),.0018).toArray() as V,.0008,.0022,mat.metal,cover);
  };
  const spring = (name:string,a:number,b:number,y:number,z:number,radius:number,wire:number,turns:number) => {
    const points=Array.from({length:turns*32+1},(_,i)=>{const t=i/(turns*32),angle=t*turns*Math.PI*2;return new T.Vector3(a+(b-a)*t,y+Math.cos(angle)*radius,z+Math.sin(angle)*radius);});
    return add(name,new T.TubeGeometry(new T.CatmullRomCurve3(points),turns*32,wire,8,false));
  };
  const bore = (mesh:T.Mesh,p:V,axis:V,radius:number,split=0) => {
    mesh.updateMatrix();
    const frame=new T.Matrix4().compose(v(p),new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),v(axis)),new T.Vector3(1,1,1));
    const transform=frame.clone().invert().multiply(mesh.matrix);
    mesh.geometry.applyMatrix4(transform);openRadialPort(mesh,[0,0],radius,1,split);mesh.geometry.applyMatrix4(transform.invert());mesh.geometry.computeVertexNormals();
  };
  const port = (name:string,p:V,axis:V,radius=.0025) => {
    const a=v(p).addScaledVector(v(axis),-.009).toArray() as V;
    const mesh=ring(`${name} union`,a,p,radius*.72,radius+.0013);
    ring(`${name} shoulder`,a,v(a).addScaledVector(v(axis),.003).toArray() as V,radius+.0013,radius+.0025,mat.darkMetal);
    localPorts[name]={point:p,axis,mesh:mesh.name};return p;
  };

  const drive=ring("hydraulic cylinder",[-.010,0,0],[.070,0,0],.0135,.017,mat.cast,true);
  ring("hydraulic rear gland",[-.014,0,0],[-.006,0,0],.0032,.018,mat.darkMetal,true);
  rod("hydraulic front cap",[.070,0,0],[.074,0,0],.018,mat.cast,true);
  ring("hydraulic piston",[.020,0,0],[.026,0,0],.003,.0132,mat.metal);
  ring("hydraulic piston seal",[.021,0,0],[.025,0,0],.0127,.0135,mat.rubber);
  rod("transfer rod",[-.035,0,0],[.032,0,0],.003);
  const separator=ring("dry separator",[-.026,0,0],[-.014,0,0],.006,.011,mat.darkMetal,true);
  for(const x of[-.025,-.014])ring(`separator rod seal ${x}`,[x-.001,0,0],[x+.001,0,0],.003,.006,mat.rubber);
  bore(separator,[-.020,-.008,0],[0,-1,0],.0015);
  ring("separator telltale vent",[-.020,-.009,0],[-.020,-.015,0],.0015,.0024,mat.darkMetal,true);
  const chamber=ring("brake pressure cylinder",[-.070,0,0],[-.026,0,0],.009,.012,mat.cast,true);
  rod("brake cylinder end cap",[-.073,0,0],[-.070,0,0],.013,mat.cast,true);
  ring("brake piston",[-.039,0,0],[-.030,0,0],.003,.0088,mat.metal);
  ring("brake piston cup seal",[-.039,0,0],[-.036,0,0],.0082,.009,mat.rubber);
  spring("brake piston return spring",-.068,-.041,0,0,.005,.00065,5);
  for(const x of[-.068,-.041])ring(`brake return spring seat ${x}`,[x-.001,0,0],[x+.001,0,0],.002,.007,mat.darkMetal);
  for(const x of[-.073,.072])for(let i=0;i<4;i++){
    const angle=i*Math.PI/2+Math.PI/4,r=x<0?.010:.014;
    screw(`end cap fixing ${x}/${i}`,[x+.002,Math.cos(angle)*r,Math.sin(angle)*r],[x-.002,Math.cos(angle)*r,Math.sin(angle)*r],true);
  }

  // Spring-return selector: the direct pedal path is retained as the fallback.
  const bypass=box("bypass valve body",[-.048,.042,0],[.052,.026,.034],mat.cast,true);
  const sleeve=ring("bypass sleeve",[-.073,.042,0],[-.022,.042,0],.0038,.0055,mat.darkMetal);
  bore(bypass,[-.048,.042,0],[1,0,0],.0055,-.030);
  rod("bypass spool",[-.068,.042,0],[-.028,.042,0],.0022);
  for(const x of[-.060,-.036])rod(`bypass land ${x}`,[x-.003,.042,0],[x+.003,.042,0],.0037);
  spring("bypass return spring",-.072,-.062,.042,0,.0027,.00045,4);
  rod("bypass spring cap",[-.077,.042,0],[-.073,.042,0],.005,mat.darkMetal,true,6);
  // A short riser connects the brake-fluid chamber to the selector body.
  ring("generated pressure riser",[-.060,.008,0],[-.060,.032,0],.0018,.0035);
  bore(chamber,[-.060,.010,0],[0,1,0],.0018);
  bore(bypass,[-.060,.030,0],[0,-1,0],.0018,-.010);
  port("pedal input",[-.086,.042,.008],[-1,0,0]);
  port("rear output -1",[-.042,.042,-.026],[0,0,-1]);
  port("rear output 1",[-.042,.042,.026],[0,0,1]);
  bore(bypass,[-.074,.042,.008],[-1,0,0],.0018,-.010);
  bore(bypass,[-.042,.042,-.016],[0,0,-1],.0018,-.008);
  bore(bypass,[-.042,.042,.016],[0,0,1],.0018,-.008);
  // Pressure transducers are on the driver and caliper sides of the selector.
  for(const [name,z]of[["request",.010],["delivery",-.010]] as const){
    rod(`${name} pressure sensor`,[-.022,.042,z],[-.005,.042,z],.0045);
    ring(`${name} sensor collar`,[-.022,.042,z],[-.018,.042,z],.002,.0055,mat.darkMetal);
    rod(`${name} sensor terminal`,[-.005,.042,z],[.001,.042,z],.003,mat.black);
  }

  // Compact E024-class valve envelope, with separate P/T and A/B connections.
  // It is a visual analogue, not an assertion of Mercedes' exact supplier.
  const valve=box("servo valve block",[.042,.039,0],[.034,.018,.026],mat.cast,true);
  box("servo mounting bridge",[.042,.023,0],[.041,.016,.024],mat.darkMetal);
  ring("servo spool sleeve",[.025,.039,0],[.059,.039,0],.0028,.0045,mat.darkMetal);
  bore(valve,[.042,.039,0],[1,0,0],.0045,-.030);
  rod("servo spool",[.026,.039,0],[.058,.039,0],.0013);
  for(const x of[.029,.040,.052])rod(`servo metering land ${x}`,[x,.039,0],[x+.003,.039,0],.0027);
  const cap=new T.Shape();cap.moveTo(-.015,-.009);cap.lineTo(.015,-.009);cap.lineTo(.015,.005);cap.quadraticCurveTo(.012,.014,.004,.014);cap.lineTo(-.004,.014);cap.quadraticCurveTo(-.012,.014,-.015,.005);cap.closePath();
  const capGeometry=new T.ExtrudeGeometry(cap,{depth:.014,bevelEnabled:true,bevelSize:.0005,bevelThickness:.0005,bevelSegments:2,curveSegments:8});capGeometry.translate(.042,.055,-.007);
  add("torque motor cover",capGeometry,mat.darkMetal,true);
  box("torque motor core",[.042,.055,0],[.018,.012,.009],mat.darkMetal);
  for(const z of[-.007,.007])box(`torque motor winding ${z}`,[.042,.055,z],[.016,.010,.004],mat.black);
  rod("servo armature link",[.042,.039,0],[.042,.055,0],.0012);
  for(const x of[.027,.057])for(const z of[-.011,.011])screw(`servo mounting ${x}/${z}`,[x,.022,z],[x,.049,z],true);
  for(const [name,x,z]of[["supply",.032,.023],["return",.052,.023],["ram A",.032,-.023],["ram B",.052,-.023]] as const){
    port(name,[x,.039,z],[0,0,Math.sign(z)]);
    bore(valve,[x,.039,Math.sign(z)*.012],[0,0,Math.sign(z)],.0018,-.008);
  }
  for(const [name,x]of[["cylinder A",0],["cylinder B",.061]] as const){
    port(name,[x,.026,0],[0,1,0]);bore(drive,[x,.015,0],[0,1,0],.0018);;
  }
  // Retained shell saddles transfer loads into gearbox-side mounting inserts.
  for(const x of[-.052,.045]){
    const radius=x<0?.012:.017;
    ring(`housing saddle ${x}`,[x-.004,0,0],[x+.004,0,0],radius,radius+.002,mat.darkMetal);
    box(`mounting ear ${x}`,[x,.007,-.018],[.018,.014,.019]);
  }
  box("loom connector body",[.008,.055,.012],[.018,.013,.018],mat.black);
  ring("loom connector sleeve",[.008,.055,.018],[.008,.055,.035],.003,.005,mat.darkMetal);
  localPorts.loom={point:[.008,.055,.035],axis:[0,0,1],mesh:"BBW loom connector sleeve"};
  for(const [name,route]of[
    ["request sensor lead",[[.001,.042,.010],[.004,.049,.012],[.008,.055,.012]]],
    ["delivery sensor lead",[[.001,.042,-.010],[.004,.055,-.008],[.008,.055,.012]]],
    ["servo lead",[[.042,.055,.008],[.025,.062,.014],[.008,.055,.012]]],
  ] as [string,V[]][]){add(name,new T.TubeGeometry(new T.CatmullRomCurve3(route.map(v)),24,.0011,8,false),mat.black);}
  sleeve.userData.medium="brake";drive.userData.medium="hydraulic";chamber.userData.medium="brake";
  root.userData.ports=Object.fromEntries(Object.entries(localPorts).map(([name,p])=>[name,{...p,point:v(p.point).add(root.position).toArray()}]));
  return root;
}

export function seatRearBrakeByWire(car:T.Group,unit:T.Group,mat:Materials){
  car.updateMatrixWorld(true);
  const casing=car.getObjectByName("Carbon gearbox casing") as T.Mesh;
  const side=createSurfaceSampler([casing],"z");
  for(const x of[-.052,.045]){
    const centre=unit.localToWorld(new T.Vector3(x,.007,-.018)),z=side(centre.x,centre.y,1);
    if(z===undefined)throw new Error("Missing BBW gearbox mounting surface");
    const start=new T.Vector3(centre.x,centre.y,z-.0015),end=centre.clone();end.z-=.003;
    const geometry=new T.BoxGeometry(.016,.012,end.z-start.z),foot=new T.Mesh(geometry,mat.cast);
    foot.name=`BBW gearbox insert ${x}`;foot.position.copy(start).add(end).multiplyScalar(.5).sub(unit.position);
    foot.userData={component:"brake-by-wire",internal:true,seat:{point:[start.x,start.y,z],body:casing.name}};unit.add(foot);
    const bolt=new T.Mesh(new T.CylinderGeometry(.0023,.0023,end.z-start.z+.016,6),mat.metal);
    bolt.rotation.x=Math.PI/2;bolt.position.copy(foot.position);bolt.name=`BBW mounting bolt ${x}`;
    bolt.userData={component:"brake-by-wire",internal:true};unit.add(bolt);
  }
  car.updateMatrixWorld(true);
}
