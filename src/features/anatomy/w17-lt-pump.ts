import * as T from "three";
import { openRadialPort } from "./w17-wastegate.ts";

type V = [number, number, number];
type Materials = Record<"metal" | "cast" | "darkMetal" | "rubber", T.Material>;

// The shared LT circuit includes charge-air cooling, so its pump needs the
// fixed-ratio mechanical drive required by C5.11.3. This cam-end installation
// and its dimensions are a reconstruction, not a published Mercedes assembly.
export function createLowTemperaturePump(mat: Materials) {
  const root = new T.Group(); root.name = "Low-temperature coolant pump";
  root.position.set(-.255, .383, .238); root.rotation.z = -Math.PI / 2;
  const add = (name: string, geometry: T.BufferGeometry, material: T.Material, cover = false) => {
    const part = new T.Mesh(geometry, material); part.name = `LT coolant pump ${name}`;
    part.userData = { component: "cooling", internal: true, coolantPump: "lt", serviceCover: cover };
    part.castShadow = part.receiveShadow = true; root.add(part); return part;
  };
  const turned = (name: string, profile: number[][], material = mat.metal, cover = false) =>
    add(name, new T.LatheGeometry(profile.map(([r,y]) => new T.Vector2(r,y)),48),material,cover);
  const ring = (name: string, a: number, b: number, inner: number, outer: number, material = mat.metal, cover = false) =>
    turned(name,[[inner,a],[outer,a],[outer,b],[inner,b],[inner,a]],material,cover);
  const housing=turned("housing",[[.007,-.004],[.011,-.004],[.011,.024],[.027,.030],[.028,.048],
    [.018,.059],[.0085,.064],[.0055,.064],[.0055,.058],[.016,.054],[.025,.046],[.024,.033],[.007,.029],[.007,-.004]],mat.cast,true);
  // An open tangential discharge starts at the wet chamber's upper wall.
  const outletFrame=new T.Matrix4().compose(new T.Vector3(.025,.043,.008),
    new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(1,0,0)),new T.Vector3(1,1,1));
  housing.geometry.applyMatrix4(outletFrame.clone().invert());openRadialPort(housing,[0,0],.0055,1,-.010);
  housing.geometry.applyMatrix4(outletFrame);housing.geometry.computeVertexNormals();
  // Degas from the upper chamber shoulder. An inboard-facing union would
  // send this line into the roll-hoop mounting structure.
  const bleedFrame=new T.Matrix4().compose(new T.Vector3(-.021,.055,0),
    new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(-1,0,0)),new T.Vector3(1,1,1));
  housing.geometry.applyMatrix4(bleedFrame.clone().invert());openRadialPort(housing,[0,0],.003,1,-.020);
  housing.geometry.applyMatrix4(bleedFrame);housing.geometry.computeVertexNormals();
  ring("shaft",-.074,.045,0,.0035);
  ring("drive coupling",-.074,-.049,.0035,.0055,mat.darkMetal);
  ring("bearing sleeve",-.004,.019,.0075,.0095,mat.cast);
  for(const y of[.002,.014]){
    ring(`bearing inner race ${y}`,y-.002,y+.002,.0035,.0046);
    ring(`bearing outer race ${y}`,y-.002,y+.002,.0068,.0075);
    for(let i=0;i<10;i++){
      const a=i*Math.PI/5,ball=add(`bearing ball ${y} ${i}`,new T.SphereGeometry(.0011,10,8),mat.metal);
      ball.position.set(Math.cos(a)*.0057,y,Math.sin(a)*.0057);
    }
    for(const dy of[-.0015,.0015])ring(`bearing cage ${y} ${dy}`,y+dy-.0002,y+dy+.0002,.0047,.0067,mat.cast);
  }
  for(const y of[-.001,.017])ring(`bearing seal ${y}`,y,y+.001,.0036,.0075,mat.rubber);
  ring("stationary seal seat",.024,.027,.0049,.0083,mat.darkMetal);
  ring("rotating seal face",.027,.028,.0035,.0083);
  ring("seal bellows",.019,.025,.0035,.005,mat.rubber);
  const spring=Array.from({length:65},(_,i)=>{const a=i/64*Math.PI*8;return new T.Vector3(Math.cos(a)*.0057,.019+i/64*.005,Math.sin(a)*.0057);});
  add("seal spring",new T.TubeGeometry(new T.CatmullRomCurve3(spring),64,.00035,6,false),mat.metal);
  ring("seal spring seat",.018,.019,.0036,.0062);
  ring("impeller back shroud",.033,.034,.0035,.021);
  turned("impeller hub",[[.0035,.028],[.0055,.028],[.0055,.035],[.0048,.045],[.0035,.046],[.0035,.028]]);
  for(let blade=0;blade<8;blade++){
    const shape=new T.Shape(),outline:T.Vector2[]=[];
    for(const side of[1,-1])for(let i=0;i<=24;i++){
      const t=(side===1?i:24-i)/24,r=.0055+t*.0155,a=blade*Math.PI/4-.70*t+side*.00045/r;
      outline.push(new T.Vector2(Math.cos(a)*r,Math.sin(a)*r));
    }
    shape.setFromPoints(outline);shape.closePath();
    const geometry=new T.ExtrudeGeometry(shape,{depth:.009,bevelEnabled:false});
    geometry.rotateX(Math.PI/2);geometry.translate(0,.043,0);
    add(`impeller blade ${blade}`,geometry,mat.metal);
  }
  ring("impeller nut",.044,.046,.002,.0048,mat.darkMetal);
  ring("casing seal",.048,.049,.025,.026,mat.rubber,true);
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3,screw=ring(`cover screw ${i}`,.037,.050,0,.0012,mat.darkMetal,true);
    screw.position.set(Math.cos(a)*.0257,0,Math.sin(a)*.0257);
    const head=ring(`cover screw head ${i}`,.049,.051,.0006,.002,mat.metal,true);head.position.copy(screw.position);
  }
  ring("mounting flange",-.010,-.004,.011,.0215,mat.cast);
  for(const x of[-.013,.013]){
    const foot=ring(`mounting foot ${x}`,-.0313,-.010,.0019,.005,mat.cast);foot.position.set(x,0,x);
    const bolt=ring(`mounting bolt ${x}`,-.054,-.001,0,.0018,mat.darkMetal);bolt.position.set(x,0,x);
    const head=ring(`mounting bolt head ${x}`,-.004,-.001,.0008,.003);head.position.set(x,0,x);
  }
  root.updateMatrixWorld(true);
  return {root, ports:{
    inlet:{point:[-.191,.383,.238] as V,axis:[1,0,0] as V},
    outlet:{point:[-.212,.358,.246] as V,axis:[0,-1,0] as V},
    bleed:{point:[-.200,.404,.238] as V,axis:[0,1,0] as V},
  }};
}

export function seatLowTemperaturePump(car: T.Group) {
  car.updateMatrixWorld(true);
  const head=car.getObjectByName("Cylinder head housing 1") as T.Mesh;
  const flange=car.getObjectByName("LT coolant pump mounting flange") as T.Mesh;
  const cover=car.getObjectByName("Engine timing end cover -0.296") as T.Mesh;
  // Two bored mounting feet reach the cover's structural seats, leaving
  // clearance behind the regular flange instead of projecting the whole face
  // onto discontinuous casting edges.
  const bore=(part:T.Mesh,p:V,r:number)=>{
    const frame=new T.Matrix4().compose(new T.Vector3(...p),new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(1,0,0)),new T.Vector3(1,1,1));
    const transform=frame.clone().invert().multiply(part.matrixWorld);
    part.geometry.applyMatrix4(transform);openRadialPort(part,[0,0],r,1,-.025);
    part.geometry.applyMatrix4(transform.invert());part.geometry.computeVertexNormals();
  };
  for(const support of[head,cover]){
    bore(support,[-.292,.383,.238],.006);
    for(const d of[-.013,.013])bore(support,[-.292,.383-d,.238+d],.0019);
  }
  // Actual bolt passages in the flange rather than bolts crossing solid metal.
  for(const d of[-.013,.013])bore(flange,[-.292,.383-d,.238+d],.0019);
}
