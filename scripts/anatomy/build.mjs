// Anatomy (MIT): geometry is generated at build time; no drawing library ships to the browser.
import { writeFileSync } from "node:fs";
import * as k from "./vendor/iso-kit.mjs";
import * as G from "./vendor/lathe.mjs";
import * as A from "./vendor/audit.mjs";

// World: front is -X, left/right is Y, up is Z. This is an educational cutaway,
// not a team's CAD model. Dimensions below are drawing units, not millimetres.
const width = 1100, height = 640;
const P = k.fitProjection([[-275,-150,0],[260,150,0],[-260,-130,135],[245,130,170]], width, height, { pad: 30, azimuth: 112, elevation: 28 });
const R = A.recorder(P);
const at = (p) => k.iso(p, P);
const items = R.items;
const shifts = {
  "front-wing": [-28,0,8], "rear-wing": [20,0,50], floor:[0,0,-18], diffuser:[35,0,-8],
  bodywork:[0,0,105], engine:[0,0,50], turbo:[10,0,63], intake:[0,0,77], fuel:[0,0,28],
  exhaust:[15,0,57], cooling:[0,0,24], mguk:[0,0,30], battery:[0,0,18], inverter:[0,0,35],
  clutch:[18,0,35], gearbox:[30,0,28], differential:[45,0,20], hydraulics:[0,0,38],
  "front-suspension":[-10,0,2], "rear-suspension":[25,0,2], steering:[0,0,20],
  tyres:[0,0,0], brakes:[0,0,0], "brake-by-wire":[0,0,26], monocoque:[0,0,0],
  halo:[0,0,75], impact:[0,0,0], cockpit:[0,0,30], electronics:[0,0,25], safety:[0,0,35],
};
function put(node, name, point, paths, shape, material="metal", extra={}) {
  const move = extra.move ?? shifts[node] ?? [0,0,0];
  const origin = at([0,0,0]), end=at(move);
  const svg = k.solidSvg(paths, { tone: "mid", crease: "faint", inner: extra.inner ?? "" });
  R.put({ at:point, name, piece:node, move, svg, material, cover:extra.cover ?? false, kind:extra.kind ?? "", dx:end[0]-origin[0], dy:end[1]-origin[1], shapes:[R.solid({...shape, name, owner:node})] });
}
function box(node,name,x,y,z,w,d,h,material="metal",extra={}) {
  const plan={x,y,w,d,r:Math.min(2,w/8,d/8)};
  const details=extra.detail ? k.lineSvg(k.planOutline(k.insetPlan(plan,1.4),z+h,P),{tone:"lo"})+k.dotsSvg(k.corners(plan,2.6).map(([a,b])=>at([a,b,z+h])),{size:.7}) : "";
  put(node,name,[x+w/2,y+d/2,z+h/2],k.slabOf(plan,z,h,P,4,.4),A.slab(plan,z,h,{},4),material,{...extra,inner:details+(extra.inner??"")});
}
function prism(node,name,points,z,h,material="carbon",extra={}) {
  const centre=points.reduce((a,p)=>[a[0]+p[0]/points.length,a[1]+p[1]/points.length],[0,0]);
  put(node,name,[...centre,z+h/2],k.extrude(points,z,h,P,{convex:false,bevel:.4}),A.extruded(points,z,h),material,extra);
}
function round(node,name,o,axis,r,length,material="metal",extra={}) {
  const F=G.frameAlong(o,axis);
  put(node,name,G.add3(o,G.mul3(F.a,length/2)),G.disc(0,length,r,F,P,{steps:32,bevel:.3}),A.disc(F,0,length,r),material,extra);
}
function rod(node,name,a,b,r,material="metal",extra={}) {
  const v=G.sub3(b,a); round(node,name,a,v,r,G.len3(v),material,extra);
}
function ring(node,name,o,axis,inner,outer,length,material="metal",extra={}) {
  const F=G.frameAlong(o,axis);
  put(node,name,G.add3(o,G.mul3(F.a,length/2)),G.ringBand(0,length,inner,outer,F,P,{steps:48}),A.ring(F,0,length,inner,outer),material,extra);
}

// Floor, plank, diffuser and its physical fences.
prism("floor","floor.main",[[-125,-53],[-77,-71],[118,-68],[174,-43],[176,43],[118,68],[-77,71],[-125,53]],6,4,"carbon");
box("floor","floor.plank",-155,-9,3,310,18,3,"plank");
for(const side of [-1,1]) {
  box("floor",`floor.edge.${side}`,-92,side*67-1,10,211,2,3,"carbon");
  for(let i=0;i<3;i++) box("floor",`floor.fence.${side}.${i}`,-120+i*9,side*51-2,10,3,13,10,"carbon");
}
prism("diffuser","diffuser.exit",[[126,-48],[207,-45],[219,-33],[219,33],[207,45],[126,48]],11,5,"carbon");
for(const y of [-42,-21,0,21,42]) box("diffuser",`diffuser.fence.${y}`,155,y-1,16,57,2,15,"carbon");

// Survival cell, open cockpit, nose and crash structures; the near wall is removable.
prism("monocoque","monocoque.base",[[-168,-12],[-105,-26],[-65,-29],[18,-29],[27,-20],[27,20],[18,29],[-65,29],[-105,26],[-168,12]],12,12,"carbon");
for(const side of [-1,1]) box("monocoque",`monocoque.wall.${side}`,-94,side*26-3,24,115,6,31,"carbon",{cover:side===1,detail:true});
box("monocoque","monocoque.bulkhead",17,-26,24,8,52,34,"carbon",{detail:true});
prism("impact","nose.crash",[[-229,-6],[-163,-13],[-115,-22],[-109,22],[-163,13],[-229,6]],18,12,"body",{detail:true});
box("impact","rear.crash",188,-8,26,44,16,10,"carbon");
for(const side of [-1,1]) {
  rod("impact",`side.crash.${side}`,[-6,side*29,37],[-6,side*54,37],4,"carbon");
  box("safety",`mirror.stalk.${side}`,-57,side*38-1,52,3,14,2,"carbon");
  box("safety",`mirror.${side}`,-62,side*51-3,53,14,6,6,"body");
}
// Seat, controls, steering and driver protection.
box("cockpit","seat.base",-55,-13,25,40,26,5,"rubber");
box("cockpit","seat.back",-18,-13,30,7,26,23,"rubber");
for(const y of [-7,7]) box("cockpit",`seat.belt.${y}`,-22,y-1,30,3,3,25,"belt");
box("cockpit","pedal.box",-113,-13,25,17,26,8,"metal",{detail:true});
for(const y of [-7,7]) box("cockpit",`pedal.${y}`,-100,y-3,33,4,6,7,"metal");
rod("steering","steering.column",[-80,0,38],[-127,0,31],1.5);
rod("steering","steering.rack",[-134,-30,29],[-134,30,29],2.2);
box("cockpit","steering.wheel",-82,-12,40,4,24,11,"rubber",{detail:true});
box("electronics","wheel.display",-81,-5,51,3,10,1,"display");
for(const y of [-10,10]) round("cockpit",`wheel.dial.${y}`,[-81,y,48],[1,0,0],1.5,1,"belt");
for(const side of [-1,1]) {
  rod("halo",`halo.rear.${side}`,[-11,side*25,55],[-17,side*22,79],2.5,"metal");
  rod("halo",`halo.rail.${side}`,[-17,side*22,79],[-72,side*17,76],2.5,"metal");
  rod("halo",`halo.front.${side}`,[-72,side*17,76],[-82,0,70],2.5,"metal");
}
rod("halo","halo.pillar",[-82,0,70],[-85,0,53],2.5,"metal");
prism("halo","roll.hoop",[[-6,-16],[8,-12],[8,12],[-6,16]],57,24,"carbon");
box("intake","airbox.inlet",-10,-11,81,14,22,7,"rubber",{detail:true});
box("intake","airbox.trunk",4,-9,58,42,18,19,"metal");
// Protected fuel bladder, battery, control units.
box("fuel","fuel.bladder",-7,-20,25,25,40,30,"rubber",{detail:true});
box("battery","battery.case",-52,-21,13,64,42,10,"battery",{detail:true});
for(let i=0;i<8;i++) box("battery",`battery.cell.${i}`,-49+i*7.2,-17,23,5.6,34,3,"battery");
box("inverter","inverter.case",24,20,19,29,17,12,"electric",{detail:true});
for(let i=0;i<6;i++) box("inverter",`inverter.fin.${i}`,26+i*4,21,31,1,15,3,"metal");
box("electronics","ecu.case",-95,-21,15,28,40,7,"electric",{detail:true});
for(let i=0;i<4;i++) box("electronics",`ecu.connector.${i}`,-91+i*6,20,16,4,5,4,"rubber");
box("hydraulics","hydraulic.block",94,16,26,17,13,12,"metal",{detail:true});
round("hydraulics","hydraulic.accumulator",[96,34,25],[1,0,0],4,16);
box("brake-by-wire","bbw.module",151,-13,22,14,26,7,"electric",{detail:true});
round("safety","extinguisher",[-98,-19,24],[1,0,0],4,22,"body");
box("safety","rear.light",232,-5,27,3,10,7,"belt");
box("safety","driver.cooling",-36,17,27,13,7,13,"metal");
// Engine crankcase, two banks of three cylinders, heads and cam covers.
box("engine","engine.sump",30,-15,14,62,30,10,"metal",{detail:true});
round("engine","engine.crankshaft",[28,0,30],[1,0,0],4,68,"metal");
box("engine","engine.crankcase",31,-16,24,61,32,14,"metal",{detail:true});
for(const side of [-1,1]) {
  for(let i=0;i<3;i++) {
    const x=41+i*18;
    round("engine",`engine.cylinder.${side}.${i}`,[x,side*6,34],[0,side*.707,.707],7.1,22,"metal");
    round("engine",`engine.head.${side}.${i}`,[x,side*21.6,49.6],[0,side*.707,.707],7.5,5,"metal");
    round("fuel",`injector.${side}.${i}`,[x,side*25,55],[0,0,1],1.2,5,"metal");
  }
  box("engine",`cam.cover.${side}`,33,side*26-4,55,59,8,5,"body",{detail:true});
}
box("intake","plenum",33,-9,60,57,18,9,"metal",{detail:true});
// Turbo, collector, exhaust. Separate rigid sections terminate on housings.
round("turbo","turbo.shaft",[99,0,48],[1,0,0],2,29);
round("turbo","turbo.compressor",[99,0,48],[1,0,0],12,9,"metal");
round("turbo","turbo.turbine",[118,0,48],[1,0,0],12,10,"hot");
for(const side of [-1,1]) {
  rod("exhaust",`exhaust.collector.${side}`,[36,side*31,42],[101,side*31,42],3,"hot");
  rod("exhaust",`exhaust.feed.${side}`,[101,side*31,42],[123,side*10,48],3,"hot");
}
rod("exhaust","exhaust.tail",[128,0,48],[217,0,48],4,"hot");
ring("exhaust","exhaust.tip",[217,0,48],[1,0,0],3.2,4,9,"hot");
// Motor, output, clutch and gearbox.
round("mguk","mguk.body",[36,33,23],[1,0,0],8,24,"electric");
round("mguk","mguk.endcap",[60,33,23],[1,0,0],8,3,"metal");
round("clutch","clutch.pack",[93,0,30],[1,0,0],11,10,"metal");
for(let i=0;i<5;i++) ring("clutch",`clutch.disc.${i}`,[94+i*1.5,0,30],[1,0,0],5,11.5,.8,"metal");
box("gearbox","gearbox.case",104,-13,16,63,26,20,"metal",{detail:true});
box("gearbox","gearbox.cover",109,-14,36,50,28,5,"carbon",{cover:true,detail:true});
for(let i=0;i<8;i++) {
  round("gearbox",`gearbox.gear.${i}`,[108+i*6.5,-6,35],[1,0,0],7-(i*.35),2.5,"metal");
  round("gearbox",`gearbox.mate.${i}`,[108+i*6.5,7,35],[1,0,0],6+(i*.35),2.5,"metal");
}
round("differential","differential.body",[170,-14,32],[0,1,0],11,28,"metal");
for(const side of [-1,1]) rod("differential",`driveshaft.${side}`,[170,side*14,32],[170,side*79,33],2.6);
// Radiators and heat exchanger plates. Many thin fins are physical, bounded parts.
for(const side of [-1,1]) {
  const y=side===1?41:-62;
  box("cooling",`radiator.frame.${side}`,1,y,15,82,20,4,"metal",{detail:true});
  for(let i=0;i<19;i++) box("cooling",`radiator.fin.${side}.${i}`,3+i*4.1,y+1,19,1.2,18,19,"metal");
  box("cooling",`radiator.top.${side}`,1,y,38,82,20,3,"metal");
  round("cooling",`radiator.header.${side}`,[0,y+10,22],[0,0,1],4,16,"metal");
  prism("bodywork",`sidepod.${side}`,[[-21,side*31],[-16,side*58],[16,side*66],[87,side*56],[122,side*33],[74,side*29]],22,25,"body",{cover:true,move:[0,side*26,75]});
  for(let i=0;i<8;i++) box("bodywork",`sidepod.vent.${side}.${i}`,28+i*6,side*46-5,47,2,10,1,"rubber",{cover:true,move:[0,side*26,75]});
}
prism("bodywork","engine.cover",[[7,-19],[40,-29],[81,-22],[140,-9],[178,-5],[178,5],[140,9],[81,22],[40,29],[7,19]],61,8,"body",{cover:true});
prism("bodywork","shark.fin",[[9,-1],[99,-1],[157,0],[99,1],[9,1]],69,20,"body",{cover:true});
// Wings: each profile is a true solid, with mounts and endplates.
for(let i=0;i<3;i++) {
  prism("front-wing",`front.profile.${i}`,[[-247+i*11,-83],[-236+i*11,-83],[-232+i*11,-31],[-236+i*11,0],[-232+i*11,31],[-236+i*11,83],[-247+i*11,83],[-243+i*11,0]],9+i*4,3,"body",{kind:i>0?"flap":""});
  box("rear-wing",`rear.profile.${i}`,199+i*9,-72,82+i*6,8,144,3,"body",{kind:i>0?"flap":""});
}
for(const side of [-1,1]) {
  box("front-wing",`front.endplate.${side}`,-249,side*83-1,8,38,2,19,"carbon");
  box("rear-wing",`rear.endplate.${side}`,195,side*73-1,65,33,2,37,"carbon");
  box("front-wing",`front.mount.${side}`,-226,side*7-1,12,7,2,7,"carbon");
  box("rear-wing",`rear.mount.${side}`,196,side*7-1,36,3,2,47,"carbon");
}
// Four wheel assemblies, wishbones, steering/toe links, uprights, brake rotors.
for(const x of [-145,170]) for(const side of [-1,1]) {
  const front=x<0, system=front?"front-suspension":"rear-suspension", prefix=`${front?"front":"rear"}.${side}`;
  const cy=side*86, w=front?25:31, m=[front?-16:24,side*43,0];
  const inner=cy-side*w/2;
  for(const z of [24,42]) for(const delta of [-23,23]) rod(system,`${prefix}.wishbone.${z}.${delta}`,[x+delta,side*(front?23:14),z],[x,inner-side*3,34],1.6,"carbon");
  rod(system,`${prefix}.pushrod`,[x+8,side*19,53],[x,inner-side*3,29],1.4,"metal");
  rod(front?"steering":system,`${prefix}.tie`,[x-9,side*23,31],[x-9,inner-side*2,32],1.2);
  box(system,`${prefix}.rocker`,x+1,side*20-4,48,12,8,6,"metal");
  round(system,`${prefix}.damper`,[x+6,side*12,51],[1,0,0],3,16);
  for(let i=0;i<6;i++) ring(system,`${prefix}.spring.${i}`,[x+7+i*2.1,side*12,51],[1,0,0],3,4,.8,"metal");
  box(system,`${prefix}.upright`,x-4,inner-side*3-2,23,8,4,22,"metal");
  const wo=[x,cy-w/2,34], axis=[0,1,0];
  ring("tyres",`${prefix}.tyre`,wo,axis,21,33,w,"rubber",{move:m});
  ring("tyres",`${prefix}.rim`,[x,cy-w/2+1,34],axis,18,21,w-2,"metal",{move:m});
  round("tyres",`${prefix}.hub`,[x,cy-w/2,34],axis,5,w,"metal",{move:m});
  const face=cy+side*w/2;
  for(let i=0;i<10;i++) {
    const a=i*Math.PI/5, a2=a+.09;
    rod("tyres",`${prefix}.spoke.${i}`,[x+Math.cos(a)*5,face,34+Math.sin(a)*5],[x+Math.cos(a2)*19,face,34+Math.sin(a2)*19],1.5,"metal",{move:m});
  }
  ring("brakes",`${prefix}.rotor`,[x,inner-side*1,34],[0,-side,0],5,15,2.5,"brake",{move:[m[0],side*23,0]});
  box("brakes",`${prefix}.caliper`,x-15,inner-side*3-3,32,8,6,16,"metal",{move:[m[0],side*23,0],detail:true});
  round("tyres",`${prefix}.nut`,[x,face,34],[0,side,0],3.8,3,"hot",{move:m});
}
// Sort by measured overlaps of the real recorded geometry, rather than SVG guesswork.
A.settle(R,P,{states:[0,1],step:2,least:5});
items.sort((a,b)=>a.key-b.key);
const markup=items.map(item=>`<g data-node="${item.piece}" data-part="${item.name}" data-material="${item.material}" data-cover="${item.cover}" data-kind="${item.kind}" data-depth="${item.key.toFixed(3)}" data-lift="${G.dot3(item.move,R.V).toFixed(3)}" data-dx="${item.dx.toFixed(2)}" data-dy="${item.dy.toFixed(2)}">${item.svg}</g>`).join("");
const centres=Object.fromEntries([...new Set(items.map(i=>i.piece))].map(id=>{
  const own=items.filter(i=>i.piece===id); const bounds=own.map(i=>A.markupBox(i.svg)).filter(Boolean);
  const xs=bounds.flatMap(b=>[b[0],b[2]]), ys=bounds.flatMap(b=>[b[1],b[3]]);
  return [id,{x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)}];
}));
writeFileSync(new URL("../../src/features/anatomy/scene.json",import.meta.url),JSON.stringify({width,height,count:items.length,markup,centres}));
writeFileSync(new URL("../../output/anatomy/geometry-manifest.json",import.meta.url),JSON.stringify({projection:P,parts:items.map(({name,piece,move})=>({name,component:piece,move}))},null,2));
console.log(`Anatomy: ${items.length} solids, ${Object.keys(centres).length} components, generated scene.json`);
A.auditOrExit(R,P);
