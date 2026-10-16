import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { servicePassage } from "./w17-feedthrough.ts";
import { ENGINE_VALVETRAIN, engineCylinderX } from "./w17-engine-core.ts";

type V = [number, number, number];
type Materials = Record<"metal" | "cast" | "darkMetal" | "black" | "rubber" | "red", T.Material>;

// Functional order follows FIA 2026 C6.6.4. ATL construction and Mercedes' public
// specification inform the materials; shape, hardware and installation are an
// illustrative reconstruction, not a capacity model or proprietary W17 CAD.
export function createFuelSystem(mat: Materials) {
  const root = new T.Group(); root.name = "Complete fuel system";
  const bladderMaterial = new T.MeshStandardMaterial({ color: "#65533b", roughness: .88, metalness: 0 });
  bladderMaterial.name = "Reinforced flexible fuel cell";
  const ports: Record<string, V> = {};
  // Fit the cell behind the reclined seat and ahead of the existing oil tank.
  // Transform longitudinal packaging coordinates, keeping circular fittings and
  // pump diameters circular. This does not establish the real tank capacity.
  const cellLength = .67, cellX = (x:number) => .084 + (x - .084) * cellLength;
  const skinPoint=(p:T.Vector3)=>{
    const roof=.4985-.5*p.x;
    const scale=1-(1-Math.min(1,(roof-.3)/.263))*T.MathUtils.smoothstep(p.x,-.14,-.09);
    if(p.y>.3)p.y=.3+(p.y-.3)*scale;
    p.z*=1-.5*(1-T.MathUtils.smoothstep(p.x,-.080,-.050))*T.MathUtils.smoothstep(p.y,.330,.380);
    return p;
  };
  const cellSkin=(geometry:T.BufferGeometry)=>{
    geometry.applyMatrix4(cellTransform);const p=geometry.attributes.position;
    for(let i=0;i<p.count;i++){const v=skinPoint(new T.Vector3().fromBufferAttribute(p,i));p.setXYZ(i,v.x,v.y,v.z);}
    geometry.computeVertexNormals();return geometry;
  };
  let inCell = true;
  const place = (p:V):V => inCell ? [cellX(p[0]),p[1],p[2]] : p;
  const cellTransform = new T.Matrix4().makeScale(cellLength,1,1).setPosition(.084*(1-cellLength),0,0);
  const add = (name: string, geometry: T.BufferGeometry, material: T.Material, cover = false) => {
    const part = new T.Mesh(geometry, material); part.name = name;
    part.userData = { component: "fuel", internal: true, serviceCover: cover };
    part.castShadow = part.receiveShadow = true; root.add(part); return part;
  };
  const box = (name: string, p: V, size: V, material = mat.metal, cover = false) => {
    const part = add(name, new RoundedBoxGeometry(size[0]*(inCell?cellLength:1),size[1],size[2], 2, Math.min(.003, ...size.map(v => v / 4))), material, cover);
    part.position.set(...place(p)); return part;
  };
  const ring = (name: string, a: V, b: V, inner: number, outer: number, material = mat.metal, cover = false) => {
    a=place(a);b=place(b);
    const axis = new T.Vector3(...b).sub(new T.Vector3(...a));
    const section = [[inner, 0], [outer, 0], [outer, axis.length()], [inner, axis.length()], [inner, 0]].map(([r, y]) => new T.Vector2(r, y));
    const part = add(name, new T.LatheGeometry(section, 32), material, cover);
    part.position.set(...a); part.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize()); return part;
  };
  const pipe = (name: string, points: V[], radius = .004, material = mat.darkMetal) => {
    points=points.map(place);
    const curve = new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p)), false, "centripetal");
    const part = add(name, new T.TubeGeometry(curve, Math.max(32, points.length * 12), radius, 12, false), material);
    part.userData.route = points; part.userData.outerRadius = radius; return part;
  };
  const circle = (x: number, y: number, radius: number, n = 32) => Array.from({ length: n }, (_, i) => new T.Vector2(x + radius * Math.cos(i / n * Math.PI * 2), y + radius * Math.sin(i / n * Math.PI * 2)));
  const outline = () => {
    const s = new T.Shape();
    s.moveTo(-.230, .225); s.lineTo(.071, .225); s.quadraticCurveTo(.084, .225, .084, .238);
    s.lineTo(.084, .382); s.quadraticCurveTo(.084, .395, .076, .407);
    s.lineTo(.025, .480); s.lineTo(-.075, .530); s.lineTo(-.110, .557);
    s.quadraticCurveTo(-.118, .563, -.130, .563); s.lineTo(-.216, .563);
    s.quadraticCurveTo(-.242, .563, -.242, .532); s.lineTo(-.242, .240);
    s.quadraticCurveTo(-.242, .225, -.230, .225); s.closePath(); return s;
  };
  // A real hollow wall with capped thickness; only the right side is removed
  // for inspection. The inspection cut is not a detachable real bladder panel.
  const wall = outline(), inner = new T.Path();
  const centre = new T.Vector2(-.080, .385), points = wall.getPoints(32);
  points.forEach((p, i) => { const q = p.clone().sub(centre).multiplyScalar(.967).add(centre); if (i) inner.lineTo(q.x, q.y); else inner.moveTo(q.x, q.y); });
  inner.closePath(); wall.holes.push(inner);
  let wallGeometry = new T.ExtrudeGeometry(wall, { depth: .338, bevelEnabled: false, curveSegments: 32 }) as T.BufferGeometry;
  wallGeometry.translate(0, 0, -.169);
  cellSkin(wallGeometry);
  // The service opening is on the rear face. Rotate the closed wall into the
  // cutter's transverse frame, then restore world axes after making the bore.
  wallGeometry.rotateY(Math.PI / 2);
  const cutWall = servicePassage(wallGeometry, circle(0, .414, .066));
  cutWall.rotateY(-Math.PI / 2); wallGeometry.rotateY(-Math.PI / 2);
  // Limit this opening to the rear wall; a transverse cutter would otherwise
  // also pierce the opposite sloping face. The split lies outside the bore.
  const skin:number[]=[];
  for(const [geometry,rear] of [[cutWall,true],[wallGeometry,false]] as const){
    const p=geometry.attributes.position,index=geometry.index;
    for(let i=0;i<(index?.count??p.count);i+=3){
      const vertices=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j));
      if((vertices.reduce((sum,v)=>sum+v.x,0)/3<cellX(-.230))===rear)skin.push(...vertices.flatMap(v=>v.toArray()));
    }
  }
  cutWall.dispose();wallGeometry.dispose();wallGeometry=new T.BufferGeometry();
  wallGeometry.setAttribute("position",new T.Float32BufferAttribute(skin,3));wallGeometry.computeVertexNormals();
  add("Fuel bladder", wallGeometry, bladderMaterial);
  for (const side of [-1, 1]) {
    const g = new T.ExtrudeGeometry(outline(), { depth: .003, bevelEnabled: false, curveSegments: 32 });
    g.translate(0, 0, side < 0 ? -.172 : .169);
    add(`Fuel bladder side ${side}`, cellSkin(g), bladderMaterial, side > 0);
    const seam = new T.CurvePath<T.Vector3>();
    for(let i=0;i<points.length-1;i++)seam.add(new T.LineCurve3(skinPoint(new T.Vector3(cellX(points[i].x),points[i].y,side*.169)),skinPoint(new T.Vector3(cellX(points[i+1].x),points[i+1].y,side*.169))));
    add(`Fuel bladder bonded seam ${side}`, new T.TubeGeometry(seam, 180, .0014, 6, true), mat.rubber, side > 0);
  }
  ring("Fuel service bonded insert", [-.244, .414, 0], [-.237, .414, 0], .066, .081, mat.darkMetal);
  const service = new T.Shape(circle(0, .414, .077));
  const servicePorts = [
    { name: "feed", y: .433, z: -.030, r: .005 },
    { name: "sample", y: .389, z: -.030, r: .004 },
    { name: "filler", y: .414, z: .030, r: .014 },
    { name: "vent", y: .460, z: .020, r: .004 },
    { name: "pressure", y: .480, z: -.018, r: .003 },
    { name: "electrical", y: .369, z: .024, r: .006 },
  ];
  for (const port of servicePorts) {
    const h = new T.Path(circle(port.z, port.y, port.r)); service.holes.push(h);
    ports[port.name] = [-.254, port.y, port.z];
    ring(`Fuel ${port.name} bulkhead union`, [-.235, port.y, port.z], ports[port.name], port.r * .72, port.r * 1.35);
  }
  const plate = new T.ExtrudeGeometry(service, { depth: .004, bevelEnabled: false, curveSegments: 32 });
  plate.rotateY(Math.PI / 2); plate.translate(-.248, 0, 0);
  // Rotation maps the drawn horizontal axis to -Z; mirror the source first.
  const platePoints = plate.attributes.position;
  for (let i = 0; i < platePoints.count; i++) platePoints.setZ(i, -platePoints.getZ(i));
  // Mirroring reverses winding; keep the plate's exterior normals correct.
  for (let i = 0; i < platePoints.count; i += 3) {
    const a = new T.Vector3().fromBufferAttribute(platePoints, i + 1), b = new T.Vector3().fromBufferAttribute(platePoints, i + 2);
    platePoints.setXYZ(i + 1, b.x, b.y, b.z); platePoints.setXYZ(i + 2, a.x, a.y, a.z);
  }
  plate.computeVertexNormals(); add("Fuel service plate", plate.applyMatrix4(cellTransform), mat.cast);
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2, y = .414 + Math.cos(a) * .072, z = Math.sin(a) * .072;
    ring(`Fuel closure bolt ${i}`, [-.251, y, z], [-.246, y, z], .001, .0035);
  }
  // A rigid, supported collector retains fuel around the primer under lateral
  // acceleration. Its cut face reveals the pickup instead of a solid inner box.
  box("Fuel collector base", [-.110, .251, 0], [.122, .006, .150], mat.darkMetal);
  box("Fuel collector rear wall", [-.171, .303, 0], [.004, .100, .150], mat.cast);
  box("Fuel collector front wall", [-.049, .303, 0], [.004, .100, .150], mat.cast);
  for (const side of [-1, 1]) box(`Fuel collector side ${side}`, [-.110, .303, side * .075], [.122, .100, .004], mat.cast, side > 0);
  box("Fuel collector lid", [-.110, .354, 0], [.126, .004, .154], mat.darkMetal, true);
  for (const x of [-.158, -.062]) for (const z of [-.058, .058]) {
    ring(`Fuel collector foot ${x} ${z}`, [x, .231, z], [x, .248, z], .002, .0065, mat.rubber);
    ring(`Fuel collector fixing ${x} ${z}`, [x, .246, z], [x, .258, z], .001, .0025);
  }
  for (const side of [-1, 1]) {
    const z = side * .122;
    box(`Fuel lift strainer ${side}`, [-.105, .243, z], [.066, .012, .032], mat.darkMetal);
    ring(`Fuel lift pump ${side}`, [-.105, .249, z], [-.105, .314, z], 0, .014, mat.metal);
    ring(`Fuel lift pump clamp ${side}`, [-.105, .272, z], [-.105, .280, z], .014, .016, mat.darkMetal);
    box(`Fuel lift pump saddle ${side}`, [-.105, .276, side * .094], [.034, .012, .034], mat.cast);
    ring(`Fuel strainer foot ${side}`, [-.105,.231,z],[-.105,.237,z],.002,.007,mat.rubber);
    pipe(`Fuel lift discharge ${side}`, [[-.105, .314, z], [-.105, .332, z], [-.130, .340, z], [-.145, .335, side * .075], [-.145, .324, side * .058]], .0035);
    ring(`Fuel collector inlet check ${side}`, [-.145, .335, side * .080], [-.145, .335, side * .070], .0036, .007, mat.cast);
    for (let i = 0; i < 7; i++) box(`Fuel strainer slot ${side} ${i}`, [-.129 + i * .008, .2495, z], [.002, .001, .026], mat.metal);
  }
  ring("Fuel primer strainer", [-.110, .257, 0], [-.110, .264, 0], .003, .018, mat.darkMetal);
  ring("Fuel primer pump", [-.110, .264, 0], [-.110, .326, 0], 0, .019);
  ring("Fuel primer retaining collar", [-.110, .269, 0], [-.110, .278, 0], .019, .022, mat.cast);
  ring("Fuel primer non-return valve", [-.110, .326, 0], [-.110, .343, 0], .0035, .007, mat.cast);
  // The meter is wholly inside the flexible cell, downstream of the primer.
  box("Fuel flow meter", [-.158, .405, -.066], [.072, .040, .032], mat.darkMetal);
  for (const x of [-.165, -.129]) {
    box(`Fuel meter support ${x}`, [x, .377, -.066], [.012, .018, .028], mat.cast);
    box(`Fuel meter mounting rail ${x}`, [x, .365, -.044], [.012, .006, .108], mat.cast);
    box(`Fuel meter bracket ${x}`, [x, .357, -.075], [.012, .016, .012], mat.cast);
  }
  ring("Fuel filter", [-.065, .385, -.030], [-.065, .420, -.030], .003, .010, mat.metal);
  ring("Fuel filter strap", [-.065, .397, -.030], [-.065, .405, -.030], .010, .012, mat.cast);
  box("Fuel filter bracket", [-.049, .376, -.030], [.010, .050, .018], mat.cast);
  box("Fuel filter bracket arm", [-.058, .400, -.030], [.021, .006, .018], mat.cast);
  pipe("Fuel primer to filter", [[-.110, .343, 0], [-.110, .370, 0], [-.065, .374, -.030], [-.065, .385, -.030]]);
  pipe("Fuel filter to meter", [[-.065, .420, -.030], [-.065, .437, -.030], [-.104, .437, -.066], [-.116, .405, -.066], [-.122, .405, -.066]]);
  ring("Fuel meter inlet union", [-.122, .405, -.066], [-.113, .405, -.066], .003, .006);
  ring("Fuel meter outlet union", [-.194, .405, -.066], [-.203, .405, -.066], .003, .006);
  pipe("Fuel metered outlet", [[-.194, .405, -.066], [-.213, .405, -.066], [-.220, .433, -.060], [-.220, .433, -.030], [-.235, .433, -.030]]);
  ring("Fuel breakaway valve", ports.feed, [-.268, .433, -.030], .0035, .0085, mat.cast);
  for (const [name, x] of [["inlet", -.117], ["outlet", -.200]] as const) {
    ring(`Fuel meter ${name} pressure sensor`, [x, .405, -.066], [x, .420, -.066], .0015, .0045, mat.cast);
    ring(`Fuel meter ${name} temperature sensor`, [x, .405, -.066], [x, .405, -.064], .001, .0035, mat.darkMetal);
  }
  ring("Fuel collector pressure relief", [-.060, .325, .020], [-.038, .325, .020], .003, .006, mat.cast);
  pipe("Fuel collector relief return", [[-.038, .325, .020], [-.020, .325, .020], [-.012, .302, .020]], .003);
  pipe("Fuel sampling pickup", [[-.145, .265, .040], [-.145, .370, .040], [-.202, .378, -.030], [-.222, .389, -.030], [-.235, .389, -.030]], .003);
  ring("Fuel sample dry-break cap", [-.254, .389, -.030], [-.260, .389, -.030], 0, .006, mat.red);
  pipe("Fuel filler internal tube", [[-.235, .414, .030], [-.200, .414, .030], [-.190, .378, .030]], .011);
  ring("Fuel filler dry-break neck", ports.filler, [-.264, .414, .030], .010, .017, mat.cast);
  ring("Fuel filler closed valve", [-.265, .414, .030], [-.269, .414, .030], 0, .014, mat.darkMetal);
  pipe("Fuel tank vent riser", [[-.235, .460, .020], [-.204, .460, .020], [-.196, .490, .020], [-.196, .540, .020]], .003);
  ring("Fuel tank pressure relief valve", ports.vent, [-.267, .460, .020], .0015, .0065, mat.cast);
  ring("Fuel tank pressure sensor", [-.248, .480, -.018], [-.262, .480, -.018], 0, .005, mat.darkMetal);
  // Supported vertical loom and sealed electrical bulkhead, separate from fuel.
  ring("Fuel electrical connector", [-.245, .369, .024], [-.258, .369, .024], 0, .008, mat.black);
  pipe("Fuel pump wiring", [[-.243, .369, .024], [-.205, .369, .024], [-.193, .295, .024], [-.144, .295, .024], [-.126, .295, 0]], .002, mat.black);
  for (const side of [-1, 1]) pipe(`Fuel lift wiring ${side}`, [[-.144, .295, .024], [-.146, .293, side * .090], [-.119, .293, side * .122]], .0015, mat.black);
  // Tubes cross drilled collector walls/lid, never opaque plates. Draw the
  // holes in the installed frame so compressed packaging does not oval them.
  root.updateMatrixWorld(true);
  const bore=(name:string,point:V,axis:V,radius:number)=>{
    const part=root.getObjectByName(name) as T.Mesh;
    const frame=new T.Matrix4().compose(new T.Vector3(...place(point)),new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(...axis)),new T.Vector3(1,1,1));
    const transform=frame.clone().invert().multiply(part.matrixWorld),source=part.geometry.clone().applyMatrix4(transform);
    const next=servicePassage(source,circle(0,0,radius,24));source.dispose();
    next.applyMatrix4(transform.invert());part.geometry.dispose();part.geometry=next;
  };
  for(const side of [-1,1]){
    bore(`Fuel collector side ${side}`,[-.145,.335,side*.075],[0,0,1],.006);
    bore(`Fuel collector side ${side}`,[-.145,.293,side*.075],[0,0,1],.003);
  }
  bore("Fuel collector front wall",[-.049,.325,.020],[1,0,0],.0065);
  bore("Fuel collector rear wall",[-.171,.295,.024],[1,0,0],.0035);
  bore("Fuel collector lid",[-.110,.354,0],[0,1,0],.005);
  bore("Fuel collector lid",[-.145,.354,.040],[0,1,0],.004);
  // High-pressure pump engages a camshaft end. Its flange and drive are carried
  // by the front cylinder-head housing, not suspended from the feed hose.
  for(const [name,p] of Object.entries(ports))ports[name]=place(p);
  ports.breakaway=place([-.268,.433,-.030]);
  inCell=false;
  const pumpStart=root.children.length;
  const pumpCentre: V = [-.272, .419, -.299];
  ring("Fuel pump cam drive", [-.306, pumpCentre[1], pumpCentre[2]], [-.269, pumpCentre[1], pumpCentre[2]], .002, .006, mat.darkMetal);
  ring("Fuel high-pressure pump flange", [-.292, pumpCentre[1], pumpCentre[2]], [-.282, pumpCentre[1], pumpCentre[2]], .0065, .025, mat.cast);
  ring("Fuel high-pressure pump", [-.282, pumpCentre[1], pumpCentre[2]], [-.253, pumpCentre[1], pumpCentre[2]], .006, .020, mat.cast);
  ring("Fuel high-pressure pump end", [-.253, pumpCentre[1], pumpCentre[2]], [-.249, pumpCentre[1], pumpCentre[2]], 0, .019, mat.metal);
  for (const sign of [-1, 1]) ring(`Fuel pump flange bolt ${sign}`, [-.295, .419 + sign * .020, -.299], [-.279, .419 + sign * .020, -.299], .001, .003);
  ports.pumpIn = [-.265, .447, -.299]; ports.pumpOut = [-.265, .419, -.270];
  ring("Fuel high-pressure inlet", [-.265, .430, -.299], ports.pumpIn, .0035, .006);
  ring("Fuel high-pressure outlet", [-.265, .419, -.288], ports.pumpOut, .0018, .0045);
  const tilt=ENGINE_VALVETRAIN.tilt,camHeight=.182-.0157*Math.tan(tilt)+(.083+ENGINE_VALVETRAIN.baseRadius)*Math.cos(tilt),camZ=.0157+(.083+ENGINE_VALVETRAIN.baseRadius)*Math.sin(tilt);
  const pumpOffset=new T.Vector3(engineCylinderX(-1,2)+.052+.292,.146+(camHeight+camZ)*Math.SQRT1_2-.419,(-camHeight+camZ)*Math.SQRT1_2+.299);
  for(const part of root.children.slice(pumpStart))part.position.add(pumpOffset);
  for(const name of["pumpIn","pumpOut"])ports[name]=new T.Vector3(...ports[name]).add(pumpOffset).toArray() as V;
  const pumpDrive=new T.Vector3(-.306,.419,-.299).add(pumpOffset).toArray() as V;
  pipe("Fuel low-pressure engine feed", [ports.breakaway, [-.164,.433,-.030],[-.164,.421,-.080],[-.152,.370,-.085],[-.152,.325,-.090],[-.160,.325,-.200],[-.180,.475,-.250],[-.360,.460,-.250],[-.430,.430,-.220],[ports.pumpIn[0],ports.pumpIn[1]+.016,ports.pumpIn[2]],ports.pumpIn], .0045);
  ring("Fuel primer pressure-temperature sensor", [-.180, .475, -.250], [-.180, .490, -.250], .001, .005, mat.cast);
  const injectorBores: { centre: V; axis: V; radius: number; side: number; index: number }[] = [];
  const onBank = (side: number, x: number, y: number, z: number): V => new T.Vector3(x, y, z).applyAxisAngle(new T.Vector3(1, 0, 0), side * Math.PI / 4).add(new T.Vector3(0, .146,0)).toArray() as V;
  for (const side of [-1, 1]) {
    const injectorAngle=70*Math.PI/180,length=.120;
    const point = (x: number, distance: number) => onBank(side,x,.175+distance*Math.cos(injectorAngle),-side*(.032+distance*Math.sin(injectorAngle)));
    const front=engineCylinderX(side,2)+.035,rear=engineCylinderX(side,0)-.035;
    const railFront = point(front,length), railBack = point(rear,length);
    ports[`rail${side}`] = railFront;
    pipe(`Fuel rail ${side}`, [railBack, point(engineCylinderX(side,1),length), railFront], .005, mat.metal);
    ring(`Fuel rail front union ${side}`, point(front-.007,length), point(front+.007,length), .003, .007, mat.cast);
    ring(`Fuel rail rear closure ${side}`, point(rear-.005,length), railBack, 0, .006);
    for (let i = 0; i < 3; i++) {
      const x = engineCylinderX(side, i), tip = point(x,0), top = point(x,length);
      const injector=ring(`Direct injector ${side} ${i}`, tip, top, .0008, .006);injector.userData.injectorLength=length;
      ring(`Fuel injector seal ${side} ${i}`, point(x,.029), point(x,.036), .006, .0075, mat.rubber);
      ring(`Fuel injector rail coupling ${side} ${i}`, point(x,length-.017), top, .006, .009, mat.cast);
      const plug=point(x+.012,.070);box(`Fuel injector plug ${side} ${i}`,plug,[.013,.012,.012],mat.black);
      injectorBores.push({ centre: tip, axis:new T.Vector3(...top).sub(new T.Vector3(...tip)).normalize().toArray() as V, radius:.0065,side,index:i });
    }
    for (const x of [engineCylinderX(side,0)+.0505,engineCylinderX(side,1)+.0505]) {
      ring(`Fuel rail support ${side} ${x}`,onBank(side,x,.230,-side*.059),point(x,length),.0015,.0035,mat.cast);
      ring(`Fuel rail clamp ${side} ${x}`, point(x-.006,length),point(x+.006,length),.005,.007,mat.darkMetal);
    }
  }
  pipe("Fuel high-pressure first rail", [ports.pumpOut,[ports.pumpOut[0]+.012,ports.pumpOut[1]+.02,ports.pumpOut[2]],[ports["rail-1"][0]+.015,ports["rail-1"][1],ports["rail-1"][2]],ports["rail-1"]], .0028, mat.metal);
  pipe("Fuel rail crossover", [ports["rail-1"],[-.437,ports["rail-1"][1],ports["rail-1"][2]],[-.430,.402,0],[-.417,ports.rail1[1],ports.rail1[2]],ports.rail1], .0028, mat.metal);
  root.userData.ports = ports;
  return { root, ports, injectorBores,pumpDrive };
}
