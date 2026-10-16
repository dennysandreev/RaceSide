import * as T from "three";
import { openRadialPort } from "./w17-wastegate.ts";

type V = [number, number, number];
type Materials = Record<"metal" | "cast" | "darkMetal" | "rubber", T.Material>;

// An engine-driven centrifugal pump reconstructed from public pump sections.
// Neither these dimensions nor the two-bank layout are Mercedes CAD data.
export function createEngineCoolantPump(mat: Materials, side: number) {
  const root = new T.Group(); root.name = `Main coolant pump ${side}`;
  root.position.set(-.280, .190, side * .169); root.rotation.z = -Math.PI / 2;
  const add = (name: string, geometry: T.BufferGeometry, material: T.Material, cover = false) => {
    const part = new T.Mesh(geometry, material); part.name = `Coolant pump ${side} ${name}`;
    part.userData = { component: "cooling", internal: true, coolantPump: side, serviceCover: cover };
    part.castShadow = part.receiveShadow = true; root.add(part); return part;
  };
  const turned = (name: string, profile: number[][], material = mat.metal, cover = false) =>
    add(name, new T.LatheGeometry(profile.map(([r, y]) => new T.Vector2(r, y)), 48), material, cover);
  const ring = (name: string, y1: number, y2: number, inner: number, outer: number, material = mat.metal, cover = false) =>
    turned(name, [[inner,y1],[outer,y1],[outer,y2],[inner,y2],[inner,y1]], material, cover);
  const cylinder = (name: string, a: V, b: V, radius: number, material = mat.metal) => {
    const axis = new T.Vector3(...b).sub(new T.Vector3(...a));
    const part = add(name, new T.CylinderGeometry(radius, radius, axis.length(), 24), material);
    part.position.set(...a).addScaledVector(axis,.5); part.quaternion.setFromUnitVectors(new T.Vector3(0,1,0), axis.normalize()); return part;
  };
  const housing = turned("housing", [[.010,0],[.013,0],[.013,.020],[.034,.024],[.034,.049],[.027,.054],[.016,.058],
    [.012,.058],[.012,.054],[.025,.047],[.031,.045],[.031,.029],[.010,.026],[.010,0]], mat.cast, true);
  housing.name = `Coolant pump ${side}`;
  // The outlet opens into the chamber, through only the discharge-side wall.
  // The discharge leaves the rear edge of the wet chamber, behind the harness.
  const dischargeOffset = side * .023;
  const outletFrame = new T.Matrix4().compose(new T.Vector3(-.022,.024,dischargeOffset),
    new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(-1,0,0)),new T.Vector3(1,1,1));
  housing.geometry.applyMatrix4(outletFrame.clone().invert());
  openRadialPort(housing,[0,0],.0075,1,-.003);
  housing.geometry.applyMatrix4(outletFrame); housing.geometry.computeVertexNormals();

  // The bearing cartridge sits behind the wet chamber. Two rolling-element
  // rows share a sleeve; the mechanical face seal keeps coolant out of it.
  ring("bearing cartridge",.002,.022,.0089,.010,mat.darkMetal);
  cylinder("shaft",[0,-.021,0],[0,.041,0],.0045);
  for(const y of[.006,.018]){
    ring(`bearing inner race ${y}`,y-.0025,y+.0025,.0045,.0058);
    ring(`bearing outer race ${y}`,y-.0025,y+.0025,.0082,.0089);
    for(let i=0;i<10;i++){
      const angle=i*Math.PI/5,ball=add(`bearing ball ${y} ${i}`,new T.SphereGeometry(.0012,10,8),mat.metal);
      ball.position.set(Math.cos(angle)*.007,y,Math.sin(angle)*.007);
    }
    for(const offset of[-.0018,.0018])ring(`bearing cage ${y} ${offset}`,y+offset-.00025,y+offset+.00025,.006,.008,mat.cast);
  }
  for(const y of[.002,.021])ring(`bearing seal ${y}`,y,y+.001,.0046,.009,mat.rubber);
  ring("stationary seal seat",.026,.028,.0059,.0102,mat.darkMetal);
  ring("rotating seal face",.028,.029,.0045,.0102,mat.metal);
  ring("seal bellows",.022,.027,.0045,.006,mat.rubber);
  const springPoints=Array.from({length:97},(_,i)=>{const t=i/96,a=t*Math.PI*8;return new T.Vector3(Math.cos(a)*.0066,.022+t*.004,Math.sin(a)*.0066);});
  add("seal spring",new T.TubeGeometry(new T.CatmullRomCurve3(springPoints),96,.00045,6,false),mat.metal);
  ring("seal spring seat",.0215,.022,.0046,.0072);

  const rotor = new T.Group(); rotor.name = `Coolant pump ${side} impeller`; root.add(rotor);
  const back = ring("impeller back shroud",.032,.0335,.0045,.0245); rotor.add(back);
  const hub = turned("impeller hub",[[.0045,.029],[.007,.029],[.007,.034],[.006,.041],[.0045,.043],[.0045,.029]]); rotor.add(hub);
  // Eight backward-curved blades, each a closed solid with finite thickness.
  for(let blade=0;blade<8;blade++){
    const positions:number[]=[],indices:number[]=[],rows=20;
    for(const face of[-1,1])for(const y of[.0335,.0415])for(let i=0;i<=rows;i++){
      const t=i/rows,r=.007+t*.0175,angle=blade*Math.PI/4-.68*t+face*.00055/r;
      positions.push(Math.cos(angle)*r,y,Math.sin(angle)*r);
    }
    const n=rows+1,quad=(a:number,b:number,c:number,d:number)=>indices.push(a,b,c,b,d,c);
    for(let i=0;i<rows;i++){
      quad(i,i+1,n+i,n+i+1);quad(2*n+i,3*n+i,2*n+i+1,3*n+i+1);
      quad(i,2*n+i,i+1,2*n+i+1);quad(n+i,n+i+1,3*n+i,3*n+i+1);
    }
    quad(0,n,2*n,3*n);quad(n-1,3*n-1,2*n-1,4*n-1);
    const geometry=new T.BufferGeometry();geometry.setAttribute("position",new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    rotor.add(add(`impeller blade ${blade}`,geometry,mat.metal));
  }
  const nut=ring("impeller retaining nut",.041,.043,.003,.0058,mat.darkMetal);rotor.add(nut);
  ring("cover O-ring",.048,.049,.0312,.0322,mat.rubber,true);
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3,x=Math.cos(a)*.0317,z=Math.sin(a)*.0317;
    const screw=cylinder(`cover screw ${i}`,[x,.035,z],[x,.050,z],.0012,mat.darkMetal);screw.userData.serviceCover=true;
    const head=ring(`cover screw head ${i}`,.049,.051,.0007,.0022,mat.metal,true);head.position.set(x,0,z);
  }

  // Turn aft before rising past the harness, then enter the engine cover.
  const path=new T.CurvePath<T.Vector3>(),z=dischargeOffset,loomClearance=side<0?.008:0;
  path.add(new T.CubicBezierCurve3(new T.Vector3(-.025,.024,z),new T.Vector3(-.040,.024,z+loomClearance),
    new T.Vector3(-.068,.008,z+loomClearance),new T.Vector3(-.068,-.008,z)));
  const section=new T.Shape();section.absarc(0,0,.009,0,Math.PI*2,false);
  const bore=new T.Path();bore.absarc(0,0,.0075,0,Math.PI*2,true);section.holes.push(bore);
  add("discharge passage",new T.ExtrudeGeometry(section,{extrudePath:path,steps:64,curveSegments:10,bevelEnabled:false}),mat.cast);
  const outlet=ring("engine discharge flange",-.010,-.004,.0075,.012,mat.metal);outlet.position.set(-.068,0,z);
  const seal=ring("discharge O-ring",-.009,-.008,.0075,.009,mat.rubber);seal.position.set(-.068,0,z);

  ring("mounting sleeve",-.008,.019,.010,.014,mat.cast);
  ring("mounting shoulder",.017,.020,.013,.019,mat.cast);
  for(const [i,x,z]of [[0,-.035,-side*.014],[1,-.010,-side*.039],[2,-.040,side*.021]]){
    cylinder(`mounting rib ${i}`,[0,-.005,0],[x,-.005,z],.005,mat.cast);
    const ear=ring(`mounting ear ${i}`,-.008,-.002,.002,.006,mat.cast);ear.position.set(x,0,z);
    cylinder(`mounting bolt ${i}`,[x,-.015,z],[x,.001,z],.0018,mat.darkMetal);
    const head=ring(`mounting bolt head ${i}`,-.002,.001,.0009,.003,mat.metal);head.position.set(x,0,z);
  }
  ring("drive coupling",-.021,-.012,.0045,.006,mat.darkMetal);
  root.updateMatrixWorld(true);
  root.userData.ports={inlet:new T.Vector3(0,.058,0).applyMatrix4(root.matrixWorld).toArray(),
    outlet:new T.Vector3(-.068,-.008,z).applyMatrix4(root.matrixWorld).toArray(),
    drive:new T.Vector3(0,-.021,0).applyMatrix4(root.matrixWorld).toArray()};
  return root;
}

export function seatEngineCoolantPumps(car: T.Group) {
  car.updateMatrixWorld(true);
  const cover=car.getObjectByName("Engine timing end cover -0.296") as T.Mesh;
  const bore=(part:T.Mesh,point:V,radius:number)=>{
    const frame=new T.Matrix4().compose(new T.Vector3(...point),new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(1,0,0)),new T.Vector3(1,1,1));
    const transform=frame.clone().invert().multiply(part.matrixWorld);
    part.geometry.applyMatrix4(transform);openRadialPort(part,[0,0],radius,1,-.035);
    part.geometry.applyMatrix4(transform.invert());part.geometry.computeVertexNormals();
  };
  for(const side of[-1,1]){
    // The supported quill and discharge register enter bored cover seats;
    // small mounting bolts enter their own holes rather than solid faces.
    bore(cover,[-.286,.190,side*.169],.0142);
    bore(cover,[-.286,.258,side*.192],.0075);
    for(const [y,z]of[[.225,side*.155],[.200,side*.130],[.230,side*.190]])bore(cover,[-.286,y,z],.002);
  }
}
