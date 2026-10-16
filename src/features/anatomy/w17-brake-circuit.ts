import * as T from "three";
import { createSurfaceSampler } from "./w17-surface.ts";
import { servicePassage } from "./w17-feedthrough.ts";
import { cleanSteeringBoreSeams } from "./w17-steering.ts";
import { openRadialPort } from "./w17-wastegate.ts";

type V = [number, number, number];
type Materials = Record<"metal" | "darkMetal" | "black" | "rubber", T.Material>;
const v = (p: V) => new T.Vector3(...p);

// Two separate pedal circuits are required. This reconstruction completes the
// direct front circuit; rear pressure must go through its own BBW/bypass unit.
export function connectFrontBrakes(car: T.Group, brakes: T.Group, mat: Materials) {
  const root = new T.Group(); root.name = "Front brake circuit"; brakes.add(root);
  const ports: Record<string, { point: V; axis: V; mesh: string }> = {};
  const add = (name: string, geometry: T.BufferGeometry, material = mat.metal) => {
    const mesh = new T.Mesh(geometry, material); mesh.name = name;
    mesh.userData = { component: "brakes", internal: true, installedOnly: true };
    mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); return mesh;
  };
  const ring = (name: string, a: V, b: V, inner: number, outer: number, material = mat.metal) => {
    const axis = v(b).sub(v(a));
    const mesh = add(name, new T.LatheGeometry([[inner,0],[outer,0],[outer,axis.length()],[inner,axis.length()],[inner,0]].map(p => new T.Vector2(...p)), 24), material);
    mesh.position.set(...a); mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0), axis.normalize()); return mesh;
  };
  const box = (name: string, p: V, size: V, material = mat.darkMetal) => {
    const mesh = add(name, new T.BoxGeometry(...size), material); mesh.position.set(...p); return mesh;
  };
  const union = (name: string, point: V, axis: V) => {
    const a = v(point).addScaledVector(v(axis), -.010).toArray() as V;
    const mesh = ring(`Front brake ${name} union`, a, point, .0018, .004);
    ring(`Front brake ${name} nut`, a, v(a).addScaledVector(v(axis), .004).toArray() as V, .004, .006, mat.darkMetal);
    ports[name] = {point, axis, mesh: mesh.name};
  };
  const line = (name: string, from: string, to: string, middle: V[], radius = .0025) => {
    const a = ports[from], b = ports[to];
    const points: V[] = [a.point, v(a.point).addScaledVector(v(a.axis), .012).toArray() as V,
      v(a.point).addScaledVector(v(a.axis), .026).toArray() as V, ...middle,
      v(b.point).addScaledVector(v(b.axis), .026).toArray() as V,
      v(b.point).addScaledVector(v(b.axis), .012).toArray() as V, b.point];
    const curve = new T.CatmullRomCurve3(points.map(v), false, "centripetal");
    const section = new T.Shape(); section.absarc(0,0,radius,0,Math.PI*2,false);
    const bore = new T.Path(); bore.absarc(0,0,.0018,0,Math.PI*2,true); section.holes.push(bore);
    const mesh = add(name, new T.ExtrudeGeometry(section,{extrudePath:curve,steps:Math.max(24,Math.ceil(curve.getLength()/.006)),curveSegments:3,bevelEnabled:false}), mat.black);
    mesh.userData = {...mesh.userData,route:points,outerRadius:radius,from,to};
    for (const [label, end] of [["in",a],["out",b]] as const) ring(`${name} crimp ${label}`,end.point,v(end.point).addScaledVector(v(end.axis),.009).toArray() as V,radius,radius+.001);
    return curve;
  };
  const drill = (mesh: T.Mesh, x: number, y: number, radius: number) => {
    mesh.updateWorldMatrix(true, false);
    const original = mesh.geometry;
    const world = original.clone().applyMatrix4(mesh.matrixWorld);
    mesh.geometry = servicePassage(world, Array.from({length:16},(_,i) => new T.Vector2(x+Math.cos(i*Math.PI/8)*radius,y+Math.sin(i*Math.PI/8)*radius)));
    mesh.geometry.applyMatrix4(mesh.matrixWorld.clone().invert()); world.dispose(); original.dispose();
  };
  car.updateMatrixWorld(true);
  const cell = car.getObjectByName("Forward survival cell deck") as T.Mesh;
  const skin = car.getObjectByName("Silver nose skin") as T.Mesh;
  const cellSurface = createSurfaceSampler([cell],"z"), outerSurface = createSurfaceSampler([cell,skin],"z");
  const x = 1.34, y = .360, teeZ = -.120;
  const tee = box("Front brake distribution tee",[x,y,teeZ],[.016,.016,.020],mat.metal);
  drill(tee,x,y,.0018);
  // Intersecting X/Z bores form a real three-way junction. Close the unused
  // end of the manufacturing cross-drilling with a retained plug.
  tee.geometry.rotateY(Math.PI/2);
  const crossDrilling = tee.geometry;
  tee.geometry = servicePassage(crossDrilling,Array.from({length:16},(_,i) => new T.Vector2(Math.cos(i*Math.PI/8)*.0018,Math.sin(i*Math.PI/8)*.0018)));
  crossDrilling.dispose();
  tee.geometry.rotateY(-Math.PI/2);
  const plug = add("Front brake tee gallery plug",new T.CylinderGeometry(.0026,.0026,.003,6),mat.darkMetal);
  plug.rotation.z = Math.PI/2; plug.position.set(x+.0085,y,teeZ);
  union("tee inlet",[x-.018,y,teeZ],[-1,0,0]);
  for (const side of [-1,1]) union(`tee ${side}`,[x,y,teeZ+side*.020],[0,0,side]);
  const innerZ = cellSurface(x,y,-1)! + .002;
  const foot = box("Front brake tee mounting foot",[x,y-.009,(innerZ+teeZ)/2],[.018,.006,Math.abs(innerZ-teeZ)+.012]);
  foot.userData.seat = {point:[x,y-.009,innerZ-.002],body:cell.name};
  for (const dx of [-.005,.005]) ring(`Front brake tee fixing ${dx}`,[x+dx,y-.009,innerZ-.003],[x+dx,y-.009,innerZ+.004],.0008,.0022);
  const master = car.getObjectByName("Brake circuit outlet -1") as T.Mesh;
  ports.master = {point:master.userData.axis[1],axis:[1,0,0],mesh:master.name};
  line("Front brake master line","master","tee inlet",[[1.273,.353,-.091],[1.285,.357,-.114]]);
  const junctions = [["tee inlet","tee -1"],["tee inlet","tee 1"]];
  for (const side of [-1,1]) {
    const cellZ = cellSurface(x,y,side as 1|-1)!, outerZ = outerSurface(x,y,side as 1|-1)!;
    const inPoint: V = [x,y,cellZ-side*.014], outPoint: V = [x,y,outerZ+side*.015];
    union(`bulkhead inside ${side}`,inPoint,[0,0,-side]);
    union(`bulkhead outside ${side}`,outPoint,[0,0,side]);
    ring(`Front brake bulkhead sleeve ${side}`,inPoint,outPoint,.0018,.004);
    const washer = ring(`Front brake bulkhead washer ${side}`,[x,y,cellZ-side*.002],[x,y,cellZ+side*.002],.004,.009,mat.darkMetal);
    washer.userData.seat = {point:[x,y,cellZ],body:cell.name};
    junctions.push([`bulkhead inside ${side}`,`bulkhead outside ${side}`]);
    // The short near-side branch is straight; adding spline lead-ins longer
    // than this gap would reverse the line and create a kink.
    const start = ports[`tee ${side}`].point, end = ports[`bulkhead inside ${side}`].point;
    const points = [start,end], path = new T.LineCurve3(v(start),v(end));
    const section = new T.Shape(); section.absarc(0,0,.0025,0,Math.PI*2,false);
    const hole = new T.Path(); hole.absarc(0,0,.0018,0,Math.PI*2,true); section.holes.push(hole);
    const branch = add(`Front brake distribution branch ${side}`,new T.ExtrudeGeometry(section,{extrudePath:path,steps:1,curveSegments:8,bevelEnabled:false}));
    branch.userData = {...branch.userData,route:points,outerRadius:.0025,from:`tee ${side}`,to:`bulkhead inside ${side}`,straight:true};
    const assembly = car.getObjectByName(`Front ${side} brake assembly`) as T.Group;
    const port = assembly.getObjectByName(`Front ${side} hydraulic port`)!;
    ports[`caliper ${side}`] = {point:assembly.localToWorld(v(port.userData.portPoint)).toArray() as V,axis:[0,0,-side],mesh:port.name};
    const hose = line(`Front ${side} brake hose`,`bulkhead outside ${side}`,`caliper ${side}`,
      [[1.345,.362,side*.235],[1.39,.38,side*.275],[1.52,.425,side*.32],
        [1.61,.434,side*.40],[1.63,.432,side*.50],[1.62,.410,side*.535],[1.59,.385,side*.565]],.003);
    // A retained saddle carries the flexible line beneath the wishbone; the
    // final free loop allows relative upright/steering movement.
    const arm = car.getObjectByName(`Front ${side} upper wishbone 0`) as T.Mesh;
    const samples = hose.getSpacedPoints(600);
    const p = samples.reduce((best,p) => Math.abs(p.z-side*.45)<Math.abs(best.z-side*.45)?p:best,samples[0]);
    const index = samples.indexOf(p), tangent = samples[index+1].clone().sub(samples[index-1]).normalize();
    const bottom = createSurfaceSampler([arm],"y")(p.x,p.z,-1);
    if (bottom === undefined) throw new Error("Missing front brake hose wishbone support");
    ring(`Front brake wishbone saddle ${side}`,p.clone().addScaledVector(tangent,-.004).toArray() as V,p.clone().addScaledVector(tangent,.004).toArray() as V,.0035,.005,mat.rubber);
    const carrier = box(`Front brake wishbone carrier ${side}`,[p.x,(p.y+.0045+bottom)/2,p.z],[.010,bottom-p.y-.0045+.001,.009]);
    carrier.userData.seat = {point:[p.x,bottom,p.z],body:arm.name};
  }
  for (const panel of [cell,skin]) {
    // Clip only the neighbourhood of each aperture. Passing the whole nose
    // through every cutting plane subdivides distant faces unnecessarily.
    panel.updateWorldMatrix(true,false);
    panel.geometry.applyMatrix4(panel.matrixWorld);
    for (const side of [-1,1]) openRadialPort(panel,[x,y],panel===cell?.0043:.007,side);
    panel.geometry.applyMatrix4(panel.matrixWorld.clone().invert());
  }
  cleanSteeringBoreSeams([cell]);
  root.userData = {ports,junctions}; car.updateMatrixWorld(true);
}
