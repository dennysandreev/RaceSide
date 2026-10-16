import * as T from "three";

// Reconstruction, not Carbone Industries/Brembo production drawings. Dimensions
// follow FIA 2026 C11.3; the six-piston layout and channel count are illustrative.
export const W17_BRAKES = {
  front: { radius: .170, innerRadius: .095, thickness: .032, rows: 6, channels: 180 },
  rear: { radius: .140, innerRadius: .081, thickness: .028, rows: 4, channels: 140 },
} as const;
const ventRadius = .0013;
type Materials = Record<"carbon" | "metal" | "darkMetal" | "black" | "friction", T.Material>;

// Radial bores are actual open tunnels. Each angular tile has triangulated inner
// and outer walls, circular tunnel walls and unbroken friction faces. The bore
// cross-section stays circular from the inner edge to the outer edge.
function ventilatedDisc(spec: typeof W17_BRAKES[keyof typeof W17_BRAKES]) {
  const { radius, innerRadius, thickness, rows, channels } = spec;
  const positions: number[] = [], normals: number[] = [];
  const half = Math.PI / channels, holeSegments = 12;
  const vector = (r: number, a: number, z: number) => new T.Vector3(r * Math.cos(a), r * Math.sin(a), z);
  function triangle(points: T.Vector3[], ns: T.Vector3[]) {
    const cross = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
    if (cross.dot(ns[0]) < 0) { [points[1], points[2]] = [points[2], points[1]]; [ns[1], ns[2]] = [ns[2], ns[1]]; }
    positions.push(...points.flatMap(p => p.toArray())); normals.push(...ns.flatMap(n => n.toArray()));
  }
  function quad(points: T.Vector3[], ns: T.Vector3[]) {
    triangle([points[0], points[1], points[2]], [ns[0], ns[1], ns[2]]);
    triangle([points[0], points[2], points[3]], [ns[0], ns[2], ns[3]]);
  }
  const rowZ = Array.from({ length: rows }, (_, row) => (row - (rows - 1) / 2) * .0044);
  const contour = [new T.Vector2(-half, -thickness / 2), new T.Vector2(half, -thickness / 2), new T.Vector2(half, thickness / 2), new T.Vector2(-half, thickness / 2)];
  const wallTiles = [innerRadius, radius].map(r => {
    const holes = rowZ.map(z => Array.from({ length: holeSegments }, (_, j) => {
      const a = j * 2 * Math.PI / holeSegments;
      return new T.Vector2(Math.asin(ventRadius * Math.cos(a) / r), z + ventRadius * Math.sin(a));
    }));
    return { r, points: [...contour, ...holes.flat()], indices: T.ShapeUtils.triangulateShape(contour, holes) };
  });
  for (let channel = 0; channel < channels; channel++) {
    const angle = channel * 2 * Math.PI / channels;
    for (const { r, points, indices } of wallTiles) {
      const sign = r === radius ? 1 : -1;
      for (const face of indices) triangle(face.map(i => vector(r, points[i].x + angle, points[i].y)), face.map(i => vector(sign, points[i].x + angle, 0)));
    }
    for (const z of [-thickness / 2, thickness / 2]) {
      const n = new T.Vector3(0, 0, Math.sign(z));
      quad([vector(innerRadius, angle - half, z), vector(radius, angle - half, z), vector(radius, angle + half, z), vector(innerRadius, angle + half, z)], [n, n, n, n]);
    }
    for (const z of rowZ) for (let j = 0; j < holeSegments; j++) {
      const points: T.Vector3[] = [], ns: T.Vector3[] = [];
      for (const [r, index] of [[innerRadius, j], [radius, j], [radius, j + 1], [innerRadius, j + 1]]) {
        const a = index * 2 * Math.PI / holeSegments, tangent = ventRadius * Math.cos(a);
        points.push(vector(r, angle + Math.asin(tangent / r), z + ventRadius * Math.sin(a)));
        ns.push(new T.Vector3(Math.sin(angle) * Math.cos(a), -Math.cos(angle) * Math.cos(a), -Math.sin(a)));
      }
      quad(points, ns);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new T.Float32BufferAttribute(normals, 3));
  return geometry;
}

export function createWheelBrake(front: boolean, side: number, centre: T.Vector3, width: number, mat: Materials) {
  const prefix = `${front ? "Front" : "Rear"} ${side}`, spec = front ? W17_BRAKES.front : W17_BRAKES.rear;
  const group = new T.Group(); group.name = `${prefix} brake assembly`; group.position.copy(centre);
  // Local +Z is always outboard. Reflect only Z so the caliper remains aft and
  // the intake forward on both wheels. Three handles the reflected winding.
  group.scale.z = side;
  const rotor = new T.Group(); rotor.name = `${prefix} rotating brake`; rotor.userData.brakeRotor = true; rotor.userData.side = side; group.add(rotor);
  const add = (name: string, geometry: T.BufferGeometry, material: T.Material, position = new T.Vector3(), parent: T.Group = group) => {
    const part = new T.Mesh(geometry, material); part.name = `${prefix} ${name}`; part.position.copy(position); part.castShadow = true; part.receiveShadow = true; parent.add(part); return part;
  };
  const ring = (name: string, inner: number, outer: number, start: number, end: number, material: T.Material, parent = group) => {
    const geometry = new T.LatheGeometry([[inner,start],[outer,start],[outer,end],[inner,end],[inner,start]].map(([r,y]) => new T.Vector2(r,y)), 96);
    geometry.rotateX(Math.PI / 2); // lathe +Y maps to +Z
    return add(name, geometry, material, undefined, parent);
  };
  const cylinder = (name: string, radius: number, a: T.Vector3, b: T.Vector3, material: T.Material, parent = group, sides = 20) => {
    const d = b.clone().sub(a), part = add(name, new T.CylinderGeometry(radius,radius,d.length(),sides), material, a.clone().add(b).multiplyScalar(.5), parent);
    part.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize()); return part;
  };
  const at = (radius: number, angle: number, z: number) => new T.Vector3(radius * Math.cos(angle), radius * Math.sin(angle), z);
  const pipe = (name: string, points: T.Vector3[], radius: number, material: T.Material) => add(name, new T.TubeGeometry(new T.CatmullRomCurve3(points), 40, radius, 8, false), material);
  const sector = (inner: number, outer: number, angle: number, half: number) => {
    const shape = new T.Shape(); shape.absarc(0,0,outer,angle-half,angle+half,false); shape.absarc(0,0,inner,angle+half,angle-half,true); shape.closePath(); return shape;
  };
  const extrude = (name: string, shape: T.Shape, z: number, depth: number, material: T.Material, parent = group, bevel = .001) => add(name, new T.ExtrudeGeometry(shape,{depth,bevelEnabled:bevel>0,bevelSize:bevel,bevelThickness:bevel,bevelSegments:3,curveSegments:32}), material, new T.Vector3(0,0,z), parent);

  add("carbon friction disc", ventilatedDisc(spec), mat.friction, undefined, rotor);
  const bell=new T.Shape();bell.absarc(0,0,spec.innerRadius-.003,0,Math.PI*2,false);
  const bore=new T.Path();bore.absarc(0,0,.027,0,Math.PI*2,true);bell.holes.push(bore);
  for(let i=0;i<12;i++)bell.holes.push(sector(.050,spec.innerRadius-.013,i*Math.PI/6+Math.PI/12,.13));
  extrude("disc mounting bell",bell,-.009,.018,mat.darkMetal,rotor,.0005);
  ring("hub bearing sleeve", .018, .033, -.065, .045, mat.darkMetal, rotor);
  const wheelSpindle=ring("wheel spindle extension",.018,.029,.044,width-(front?.108:.096),mat.darkMetal,rotor);wheelSpindle.userData.installedOnly=true;
  ring("bell stiffening collar", .032, .048, -.013, .013, mat.metal, rotor);
  for (let i=0;i<12;i++) {
    const a=i*Math.PI/6, p=at(spec.innerRadius-.002,a,0);
    const tab=new T.BoxGeometry(.014,.012,.010); tab.rotateZ(a);
    add(`floating drive tab ${i}`,tab,mat.darkMetal,p,rotor);
    cylinder(`disc drive bobbin ${i}`,.0045,p.clone().setZ(-.008),p.clone().setZ(.008),mat.metal,rotor);
    ring(`bell bolt washer ${i}`,.002,.004,-.010,.010,mat.metal,rotor).position.copy(at(.062,a,0));
  }
  // One opposing pair of carbon pads and six pistons. The outer bridges leave
  // actual service windows above the disc, rather than a solid caliper box.
  const k = spec.radius / W17_BRAKES.front.radius, padInner=.108*k, padOuter=spec.radius-.009;
  const bankInner=.101*k, bankOuter=spec.radius+.014, bankStart=spec.thickness/2+.013, bankDepth=.019;
  for (const face of [-1,1]) {
    const padZ=face>0?spec.thickness/2+.0004:-spec.thickness/2-.0104;
    extrude(`carbon pad ${face}`,sector(padInner,padOuter,Math.PI,.52),padZ,.010,mat.friction,group,0);
    const bank=sector(bankInner,bankOuter,Math.PI,.64);
    for (let i=0;i<3;i++) {
      const p=at(.138*k,Math.PI+(i-1)*.38,0),hole=new T.Path(); hole.absarc(p.x,p.y,.015*k,0,Math.PI*2,true);bank.holes.push(hole);
    }
    const z=face>0?bankStart:-bankStart-bankDepth;
    extrude(`monobloc caliper bank ${face}`,bank,z,bankDepth,mat.metal);
    for(let i=0;i<4;i++){
      const a=Math.PI+(i-1.5)*.36,faceZ=face*(bankStart+bankDepth);
      cylinder(`caliper stiffening rib ${face} ${i}`,.0025,at(bankInner+.008,a,faceZ),at(bankOuter-.006,a,faceZ),mat.metal);
    }
    for (let i=0;i<3;i++) {
      const a=Math.PI+(i-1)*.38,p=at(.138*k,a,0),start=face*(spec.thickness/2+.0098),end=face*(bankStart+bankDepth-.002);
      const piston=ring(`caliper piston ${face} ${i}`,.010*k,.0145*k,Math.min(start,end),Math.max(start,end),mat.darkMetal);piston.position.copy(p);
      cylinder(`piston back ${face} ${i}`,.010*k,p.clone().setZ(end-face*.001),p.clone().setZ(end),mat.darkMetal);
    }
    for (const a of [Math.PI-.55,Math.PI+.55]) {
      const p=at(spec.radius-.028,a,0);
      cylinder(`bleed fitting ${face} ${a}`,.004,p.clone().setZ(face*(bankStart+bankDepth)),p.clone().setZ(face*(bankStart+bankDepth+.007)),mat.metal,group,6);
    }
  }
  for (let i=0;i<4;i++) {
    const a=Math.PI+[-.59,-.20,.20,.59][i];
    extrude(`caliper bridge ${i}`,sector(spec.radius+.003,bankOuter,a,.05),-bankStart-bankDepth,2*(bankStart+bankDepth),mat.metal);
  }
  // The two mounting ears join the caliper body to the upright's inboard side.
  for (const a of [Math.PI-.53,Math.PI+.53]) {
    const start=at(bankInner+.007,a,-bankStart-.010),end=at(bankInner-.018,a,-.075);
    cylinder(`caliper mounting ear ${a}`,.011,start,end,mat.metal);
    cylinder(`caliper mounting bolt ${a}`,.005,end.clone().add(new T.Vector3(0,0,-.005)),end.clone().add(new T.Vector3(0,0,.015)),mat.darkMetal,group,6);
    cylinder(`upright brake bracket ${a}`,.009,end,new T.Vector3(0,end.y,-.081),mat.darkMetal);
  }
  const hosePort=at(bankInner+.016,Math.PI-.22,-.084);
  {
    const union=ring("hydraulic port",.0018,.004,hosePort.z,-bankStart-bankDepth,mat.metal);
    union.position.set(hosePort.x,hosePort.y,0);union.userData.portPoint=hosePort.toArray();
    const nut=new T.Shape();
    for(let i=0;i<6;i++){const a=i*Math.PI/3;if(i===0)nut.moveTo(Math.cos(a)*.006,Math.sin(a)*.006);else nut.lineTo(Math.cos(a)*.006,Math.sin(a)*.006);}
    nut.closePath();const hole=new T.Path();hole.absarc(0,0,.004,0,Math.PI*2,true);nut.holes.push(hole);
    extrude("hydraulic port hex shoulder",nut,-.078,.007,mat.metal,group,0).position.set(hosePort.x,hosePort.y,-.078);
  }
  const crossoverAngle=Math.PI-.60,crossoverRadius=spec.radius+.008;
  pipe("caliper crossover line",[-bankStart-bankDepth,-.018,.018,bankStart+bankDepth].map((z,i)=>at(crossoverRadius+(i===1||i===2?.006:0),crossoverAngle,z)),.0018,mat.metal);

  // Stationary hollow carbon shroud. Its outboard face closes the view behind
  // the spokes; it is not a solid cylinder rotating with the tyre.
  const shieldRadius=.198,back=-.062,face=width-.148;
  const shield=ring("carbon brake drum",shieldRadius-.002,shieldRadius,back,face,mat.carbon);shield.userData.serviceCover=true;shield.userData.cover=true;
  const shieldFace=ring("brake drum outer face",.034,shieldRadius,face-.002,face,mat.carbon);shieldFace.userData.serviceCover=true;shieldFace.userData.cover=true;
  const backShape=new T.Shape();backShape.absarc(0,0,shieldRadius-.003,0,Math.PI*2,false);
  const openings:[[number,number],number][]=[[[0,0],.039],[[.074,-.045],.030]];
  openings.push([[hosePort.x,hosePort.y],.0065]);
  for(const a of [Math.PI-.53,Math.PI+.53]){const p=at(bankInner-.008,a,0);openings.push([[p.x,p.y],.015]);}
  for(const [[x,y],radius] of openings){const opening=new T.Path();opening.absarc(x,y,radius,0,Math.PI*2,true);backShape.holes.push(opening);}
  const backplate=extrude("brake inboard heat shield",backShape,back,.002,mat.carbon,group,0);backplate.userData.serviceCover=true;backplate.userData.cover=true;
  for (let i=0;i<8;i++) {
    const p=at(.187,i*Math.PI/4,face);
    const screw=cylinder(`shroud fastener ${i}`,.0026,p,p.clone().add(new T.Vector3(0,0,.002)),mat.darkMetal,group,6);screw.userData.serviceCover=true;screw.userData.cover=true;
  }
  // Hollow cooling inlet, routed to the disc's inner ventilation annulus.
  const ductShape=new T.Shape();ductShape.moveTo(-.018,-.012);ductShape.lineTo(.018,-.012);ductShape.lineTo(.018,.012);ductShape.lineTo(-.018,.012);ductShape.closePath();
  const ductHole=new T.Path();ductHole.moveTo(-.016,-.010);ductHole.lineTo(-.016,.010);ductHole.lineTo(.016,.010);ductHole.lineTo(.016,-.010);ductHole.closePath();ductShape.holes.push(ductHole);
  const ductPath=new T.CatmullRomCurve3([new T.Vector3(.179,-.042,-.084),new T.Vector3(.14,-.048,-.085),new T.Vector3(.090,-.054,-.077),new T.Vector3(.056,-.03,-.043)]);
  const duct=add("hollow brake cooling inlet",new T.ExtrudeGeometry(ductShape,{steps:32,bevelEnabled:false,extrudePath:ductPath}),mat.carbon);duct.userData.serviceCover=true;duct.userData.cover=true;
  group.traverse(part=>{part.userData={...part.userData,component:"brakes",brakeAxle:front?"front":"rear",brakeSide:side};});
  group.updateMatrixWorld(true);
  return {group,hosePort:group.localToWorld(hosePort)};
}
