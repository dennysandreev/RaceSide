import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createEngineCoolantPump } from "./w17-coolant-pump.ts";
import { createLowTemperaturePump } from "./w17-lt-pump.ts";
import { createOilCooler } from "./w17-oil-cooler.ts";
import { createOilPump, OIL_PUMP } from "./w17-oil-pump.ts";
import { coolingDuctSections, splitCoolingMouth } from "./w17-cooling-duct.ts";

type V = [number, number, number];
type Materials = Record<"carbon" | "metal" | "cast" | "darkMetal" | "black" | "rubber", T.Material>;

// Construction follows public tube-and-fin and dry-sump examples. The W17's
// private radiator specification, circuit split and port locations are inferred.
export function createCoolingSystem(mat: Materials, mouths: Map<number, T.Vector3[]>, connections?:{turbo:Record<string,V>;charge:Record<string,V>;motor:Record<string,V>;store:Record<string,V>}) {
  const root = new T.Group(); root.name = "Cooling and lubrication pack";
  const ports: Record<string, V> = {};
  const portDirections: Record<string, V> = {};
  const add = (name: string, geometry: T.BufferGeometry, material: T.Material, parent: T.Group = root) => {
    const part = new T.Mesh(geometry, material); part.name = name;
    part.userData.component = "cooling"; part.castShadow = true; part.receiveShadow = true; parent.add(part); return part;
  };
  const box = (name: string, p: V, size: V, material: T.Material, parent = root) => {
    const part = add(name, new RoundedBoxGeometry(...size, 2, Math.min(.003, ...size.map(v => v / 4))), material, parent);
    part.position.set(...p); return part;
  };
  const ring = (name: string, a: V, b: V, inner: number, outer: number, material: T.Material, parent = root) => {
    const direction = new T.Vector3(...b).sub(new T.Vector3(...a)), length = direction.length();
    const profile = [[inner, 0], [outer, 0], [outer, length], [inner, length], [inner, 0]].map(([x, y]) => new T.Vector2(x, y));
    const part = add(name, new T.LatheGeometry(profile, 32), material, parent); part.position.set(...a);
    part.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction.normalize()); return part;
  };
  const port = (name: string, a: V, direction: V, radius = .012, length = .026) => {
    const start = new T.Vector3(...a), axis = new T.Vector3(...direction).normalize(), end = start.clone().addScaledVector(axis, length);
    ring(`${name} socket`, a, end.toArray() as V, radius, radius + .003, mat.metal);
    ring(`${name} collar`, start.clone().addScaledVector(axis, length-.012).toArray() as V, start.clone().addScaledVector(axis, length-.005).toArray() as V, radius + .003, radius + .006, mat.darkMetal);
    ports[name] = end.toArray() as V; portDirections[name] = axis.toArray() as V; return end;
  };
  const hose = (name: string, points: T.Vector3[], radius = .014, steps = 64) => {
    const section = new T.Shape(); section.absarc(0, 0, radius, 0, 2 * Math.PI, false);
    const bore = new T.Path(); bore.absarc(0, 0, radius - .002, 0, 2 * Math.PI, true); section.holes.push(bore);
    const path = new T.CatmullRomCurve3(points, false, "centripetal");
    const part = add(name, new T.ExtrudeGeometry(section, { steps, bevelEnabled: false, curveSegments: 8, extrudePath: path }), mat.rubber);
    part.userData.route = points.map(p => p.toArray()); part.userData.outerRadius = radius;
    for (const end of [0, 1]) {
      const t = end ? .98 : .02, c = path.getPoint(t), axis = path.getTangent(t);
      ring(`${name} clamp ${end}`, c.clone().addScaledVector(axis, -.004).toArray() as V, c.clone().addScaledVector(axis, .004).toArray() as V, radius, radius + .0017, mat.metal);
    }
    return part;
  };
  const fittedHose = (name: string, from: string, to: string, middle: V[], radius: number) => {
    const a = new T.Vector3(...ports[from]), b = new T.Vector3(...ports[to]);
    const entry = new T.Vector3(...portDirections[from]), exit = new T.Vector3(...portDirections[to]);
    // Two straight terminal sections keep the hose and crimp coaxial with
    // each socket before the flexible line starts to bend.
    const part = hose(name, [a, a.clone().addScaledVector(entry, .012), a.clone().addScaledVector(entry, .026),
      ...middle.map(p => new T.Vector3(...p)), b.clone().addScaledVector(exit, .026), b.clone().addScaledVector(exit, .012), b], radius, 128);
    part.userData.from = from; part.userData.to = to;
    return part;
  };
  const bend = (a:V,b:V,c:V,d:V) => new T.CubicBezierCurve3(new T.Vector3(...a),new T.Vector3(...b),new T.Vector3(...c),new T.Vector3(...d)).getPoints(20);
  const rectangle = (x: number, y: number) => new T.Shape([new T.Vector2(-x, -y), new T.Vector2(x, -y), new T.Vector2(x, y), new T.Vector2(-x, y)]);
  const slab = (shape: T.Shape, depth: number) => new T.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 16 });

  // A thin, open-ended duct. Both skins and rim returns are real geometry;
  // there is no black disc closing either the inlet or the radiator face.
  const duct = (name: string, rings: T.Vector3[][], wall = .0018) => {
    const count = rings[0].length, rows = rings.length, positions: number[] = [], indices: number[] = [];
    for (const row of rings) positions.push(...row.flatMap(p => p.toArray()));
    for (let row = 0; row < rows - 1; row++) for (let col = 0; col < count; col++) {
      const a = row * count + col, b = row * count + (col + 1) % count;
      if (rings[0][0].z < 0) indices.push(a, b, a + count, b, b + count, a + count);
      else indices.push(a, a + count, b, b, a + count, b + count);
    }
    const front = new T.BufferGeometry(); front.setAttribute("position", new T.Float32BufferAttribute(positions, 3)); front.setIndex(indices); front.computeVertexNormals();
    const n = front.attributes.normal, size = rows * count;
    for (let i = 0; i < size; i++) positions.push(...new T.Vector3().fromBufferAttribute(front.attributes.position, i).addScaledVector(new T.Vector3().fromBufferAttribute(n, i), -wall).toArray());
    const faces = [...indices];
    for (let i = 0; i < indices.length; i += 3) faces.push(indices[i] + size, indices[i + 2] + size, indices[i + 1] + size);
    // Use each boundary edge's existing orientation for its closed rim.
    for (const row of [0, rows - 1]) for (let col = 0; col < count; col++) {
      let a = row * count + col, b = row * count + (col + 1) % count;
      const forward = indices.some((v, i) => v === a && indices[i - i % 3 + (i % 3 + 1) % 3] === b);
      if (forward) [a, b] = [b, a]; faces.push(a, b, a + size, b, b + size, a + size);
    }
    const geometry = new T.BufferGeometry(); geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3)); geometry.setIndex(faces); geometry.computeVertexNormals(); front.dispose();
    const part = add(name, geometry, mat.carbon); part.userData.serviceCover = true; part.userData.airflowCover = true; return part;
  };

  for (const side of [-1, 1]) {
    const pack = new T.Group(); pack.name = `Radiator pack ${side}`; root.add(pack);
    pack.position.set(.035, .455, side * .416); pack.rotation.set(-side * .32, 0, .05); pack.scale.z = .90; pack.updateMatrixWorld(true);
    const world = (x: number, y: number, z: number) => new T.Vector3(x, y, z).applyMatrix4(pack.matrixWorld);
    const tubeCount = 48, pitch = .012, tubeWidth = .0034, coreDepth = .036;
    // Flattened coolant tubes run between two header tanks. Air passes through
    // the corrugated fins between tubes, normal to the inclined radiator face.
    const tubeShape = rectangle(tubeWidth / 2, coreDepth / 2), hole = new T.Path();
    hole.moveTo(-.001, -.0165); hole.lineTo(-.001, .0165); hole.lineTo(.001, .0165); hole.lineTo(.001, -.0165); hole.closePath(); tubeShape.holes.push(hole);
    const tubeGeometry = slab(tubeShape, .228); tubeGeometry.translate(0, 0, -.114);
    const tubes = new T.InstancedMesh(tubeGeometry, mat.metal, tubeCount); tubes.name = `Radiator fluid tubes ${side}`; tubes.userData.component = "cooling"; pack.add(tubes);
    for (let i = 0; i < tubeCount; i++) tubes.setMatrixAt(i, new T.Matrix4().makeTranslation((i - (tubeCount - 1) / 2) * pitch, 0, 0));
    const finPoints: T.Vector2[] = [], gap = pitch - tubeWidth, folds = 44;
    for (let j = 0; j <= folds; j++) finPoints.push(new T.Vector2((j % 2 ? 1 : -1) * (gap / 2 - .00018), -.111 + j / folds * .222));
    const ribbon = new T.Shape([...finPoints.map(p => new T.Vector2(p.x - .00015, p.y)), ...finPoints.slice().reverse().map(p => new T.Vector2(p.x + .00015, p.y))]);
    const fins = slab(ribbon, coreDepth); fins.rotateX(Math.PI / 2); fins.translate(0, coreDepth / 2, 0);
    const finMesh = new T.InstancedMesh(fins, mat.metal, tubeCount - 1); finMesh.name = `Radiator folded fins ${side}`; finMesh.userData.component = "cooling"; pack.add(finMesh);
    for (let i = 0; i < tubeCount - 1; i++) finMesh.setMatrixAt(i, new T.Matrix4().makeTranslation((i - (tubeCount - 2) / 2) * pitch, 0, 0));
    for (const zSide of [-1, 1]) {
      const z = zSide * .132;
      // Perforated tube plate, enclosing rails, and end plates with real bores.
      const plate = rectangle(.305, .023);
      for (let i = 0; i < tubeCount; i++) {
        const x = (i - (tubeCount - 1) / 2) * pitch, opening = new T.Path();
        opening.moveTo(x - .0017, -.018); opening.lineTo(x - .0017, .018); opening.lineTo(x + .0017, .018); opening.lineTo(x + .0017, -.018); opening.closePath(); plate.holes.push(opening);
      }
      const plateGeometry = slab(plate, .002); plateGeometry.translate(0, 0, zSide > 0 ? .112 : -.114);
      add(`Radiator tube plate ${side} ${zSide}`, plateGeometry, mat.cast, pack);
      box(`Header outer wall ${side} ${zSide}`, [0, 0, zSide * .153], [.610, .046, .002], mat.cast, pack);
      for (const y of [-.024, .024]) box(`Header rail ${side} ${zSide} ${y}`, [0, y, z], [.610, .002, .044], mat.cast, pack);
      for (const xSide of [-1, 1]) {
        const end = rectangle(.025, .022), opening = new T.Path();
        // One port per header, opposite corners for a complete crossflow pass.
        if (xSide === zSide) { opening.absarc(0, 0, .012, 0, Math.PI * 2, true); end.holes.push(opening); }
        const geometry = slab(end, .002); geometry.rotateY(Math.PI / 2); geometry.rotateX(Math.PI / 2); geometry.translate(xSide * .305, 0, z);
        add(`Header end ${side} ${zSide} ${xSide}`, geometry, mat.cast, pack);
      }
      const base = world(zSide * .307, 0, z), axis = new T.Vector3(zSide, 0, 0).transformDirection(pack.matrixWorld);
      if(side===1&&zSide===-1){
        // The inboard header needs an outboard-facing elbow. A rear-facing
        // straight socket sends its hose into the two adjacent low-temp lines.
        const tangent=.025*4/3*Math.tan(Math.PI/8);
        const bend=new T.CubicBezierCurve3(world(-.307,0,z),world(-.307-tangent,0,z),
          world(-.332,0,z+.025-tangent),world(-.332,0,z+.025));
        const section=new T.Shape();section.absarc(0,0,.015,0,Math.PI*2,false);
        const bore=new T.Path();bore.absarc(0,0,.012,0,Math.PI*2,true);section.holes.push(bore);
        add("Radiator 1 cold elbow",new T.ExtrudeGeometry(section,{extrudePath:bend,steps:32,curveSegments:8,bevelEnabled:false}),mat.metal);
        const outlet=new T.Vector3(0,0,1).transformDirection(pack.matrixWorld);
        port("Radiator 1 cold",bend.getPoint(1).toArray() as V,outlet.toArray() as V);
      }else port(`Radiator ${side} ${zSide > 0 ? "hot" : "cold"}`, base.toArray() as V, axis.toArray() as V);
    }
    for (const x of [-.302, .302]) box(`Core side rail ${side} ${x}`, [x, 0, 0], [.014, .043, .228], mat.darkMetal, pack);
    for (const x of [-.26, .26]) for (const z of [-.161, .161]) {
      box(`Radiator mounting ear ${side} ${x} ${z}`, [x, -.016, z], [.038, .008, .034], mat.cast, pack);
      ring(`Radiator rubber bush ${side} ${x} ${z}`, [x, -.022, z], [x, -.007, z], .004, .009, mat.rubber, pack);
      ring(`Radiator mounting sleeve ${side} ${x} ${z}`, [x, -.023, z], [x, -.006, z], .0025, .004, mat.metal, pack);
    }
    const mouth = mouths.get(side)!;
    const normal = new T.Vector3(0, 1, 0).transformDirection(pack.matrixWorld);
    const split = side === 1 && !!connections;
    const rows = coolingDuctSections(split ? splitCoolingMouth(mouth, .548, false) : mouth,
      pack.matrixWorld, .299, .112, side, split ? .027 : .023, split ? .083 : .065, 0, split ? .03 : .12);
    duct(`Radiator inlet duct ${side}`, rows);
    // Gasket meets the same perimeter as the duct and radiator rails.
    const seal = new T.CatmullRomCurve3(rows.at(-1)!, true, "centripetal");
    add(`Radiator face seal ${side}`, new T.TubeGeometry(seal, 128, .0022, 6, true), mat.rubber);
    port(`Engine ${side} hot`, [-.289, .335, side * .270], [1, 0, 0]);
    // A rigid inlet elbow faces upward into the rear engine-bay opening.
    // The former forward-facing union forced a tight hose loop into the tub.
    const inletRadius=.025,inletTangent=inletRadius*4/3*Math.tan(Math.PI/8);
    const inletBend=new T.CubicBezierCurve3(new T.Vector3(-.222,.190,side*.169),new T.Vector3(-.222+inletTangent,.190,side*.169),
      new T.Vector3(-.197,.215-inletTangent,side*.169),new T.Vector3(-.197,.215,side*.169));
    const inletSection=new T.Shape();inletSection.absarc(0,0,.015,0,Math.PI*2,false);
    const inletBore=new T.Path();inletBore.absarc(0,0,.012,0,Math.PI*2,true);inletSection.holes.push(inletBore);
    const inletElbow=add(`Coolant pump inlet elbow ${side}`,new T.ExtrudeGeometry(inletSection,{extrudePath:inletBend,steps:32,curveSegments:8,bevelEnabled:false}),mat.metal);
    inletElbow.userData.coolantPump=side;inletElbow.userData.serviceCover=true;
    port(`Engine ${side} cold`, [-.197, .215, side * .169], [0, 1, 0]);
    for(const name of["socket","collar"]){const fitting=root.getObjectByName(`Engine ${side} cold ${name}`)!;fitting.userData.coolantPump=side;fitting.userData.serviceCover=true;}
    // Route beneath the inclined core, then turn around its front header.
    // All intermediate points use the pack frame, so neither side cuts through it.
    fittedHose(`Coolant hot line ${side}`, `Engine ${side} hot`, `Radiator ${side} hot`,
      [[-.215,.335,side*.315], ...[world(-.20,-.095,-side*.075), world(.25,-.095,-side*.075), world(.375,-.065,0), world(.375,-.035,.132)].map(p => p.toArray() as V)], .014);
    const returnBend:V[]=side===1
      ?[[-.30,.432,.401],[-.305,.424,.426],[-.31,.400,.438],[-.31,.37,.433],[-.29,.30,.36]]
      :[[-.35,.47,-.527],[-.366,.448,-.501],[-.37,.415,-.46],[-.366,.37,-.39]];
    // Cross above the pan behind the tub's rear edge, then approach the
    // upward-facing inlet. The fuel cell and structural side walls stay intact.
    fittedHose(`Coolant return line ${side}`, `Radiator ${side} cold`, `Engine ${side} cold`,
      [...returnBend,[-.29,.27,side*.30],[-.2503,.2822,side*.2271],[-.239,.2927,side*.1901],[-.218,.2937,side*.1734],[-.205,.285,side*.1695]], .014);
    box(`Coolant manifold ${side}`, [-.294, .335, side * .270], [.024, .045, .035], mat.cast);
    root.add(createEngineCoolantPump(mat,side));
    root.userData[`radiator${side}`] = { centre: world(0, 0, 0).toArray(), normal: normal.toArray() };
  }

  // Separate dry-sump reservoir, pressure/scavenge stages and oil cooler.
  const tank = add("Dry-sump oil reservoir", new T.LatheGeometry([[0, 0], [.048, 0], [.062, .014], [.062, .23], [.048, .245], [0, .245]].map(([r, y]) => new T.Vector2(r, y)), 48), mat.cast);
  tank.position.set(-.212, .16, 0);
  ring("Oil filler neck", [-.212, .405, 0], [-.212, .423, 0], .017, .022, mat.metal);
  const cap = add("Oil filler cap", new T.CylinderGeometry(.025, .025, .008, 12), mat.darkMetal); cap.position.set(-.212, .427, 0);
  for (const y of [.205, .355]) { const strap = add(`Oil tank retaining band ${y}`, new T.TorusGeometry(.063, .0025, 8, 48), mat.darkMetal); strap.rotation.x = Math.PI / 2; strap.position.set(-.212, y, 0); }
  root.add(createOilPump(mat));
  port("Oil reservoir supply", [-.212, .183, -.058], [0, 0, -1], .008);
  port("Oil pump supply", OIL_PUMP.supply, [1, 0, 0], .008);
  const oilFeedPath=new T.CurvePath<T.Vector3>();
  const oilLine=(a:V,b:V)=>oilFeedPath.add(new T.LineCurve3(new T.Vector3(...a),new T.Vector3(...b)));
  const oilBend=(a:V,b:V,c:V,d:V)=>oilFeedPath.add(new T.CubicBezierCurve3(new T.Vector3(...a),new T.Vector3(...b),new T.Vector3(...c),new T.Vector3(...d)));
  oilLine(ports["Oil reservoir supply"],[-.212,.183,-.110]);
  oilBend([-.212,.183,-.110],[-.212,.183,-.142],[-.160,.183,-.133],[-.160,.183,-.165]);
  oilLine([-.160,.183,-.165],[-.160,.183,-.240]);
  oilBend([-.160,.183,-.240],[-.160,.183,-.26209],[-.17791,.183,-.280],[-.200,.183,-.280]);
  oilLine([-.200,.183,-.280],[-.300,.183,-.280]);
  oilBend([-.300,.183,-.280],[-.340,.183,-.280],[-.335,.114,-.280],[-.375,.114,-.280]);
  oilBend([-.375,.114,-.280],[-.405,.114,-.280],[-.410,.112,-.224],[-.440,.112,-.224]);
  oilLine([-.440,.112,-.224],ports["Oil pump supply"]);
  // Even spacing preserves the designed bend radii when the shared hose
  // builder interpolates the route; sparse straight runs caused tight kinks.
  const oilFeed=hose("Oil reservoir supply hose",oilFeedPath.getSpacedPoints(240),.010,192);
  oilFeed.userData.from="Oil reservoir supply";oilFeed.userData.to="Oil pump supply";
  const filter = add("Oil filter housing", new T.CylinderGeometry(.024, .024, .075, 32), mat.darkMetal); filter.rotation.z = Math.PI / 2; filter.position.set(-.69, .146, -.255);
  port("Oil filter feed", [-.69, .170, -.255], [0, 1, 0], .007);
  port("Oil pressure outlet", [-.52, .164, -.240], [0, 1, 0], .007,.018);
  // Turn directly beyond the upright sockets: the previous long straight
  // extension reached the exhaust outlet before the flexible hose bent away.
  const pressureHose=hose("Oil pressure hose",[
    new T.Vector3(...ports["Oil pressure outlet"]),new T.Vector3(-.52,.186,-.240),
    ...bend([-.52,.190,-.240],[-.52,.203,-.240],[-.52,.209,-.250],[-.52,.209,-.266]),
    ...bend([-.52,.209,-.266],[-.52,.209,-.277],[-.529,.209,-.286],[-.540,.209,-.286]).slice(1),new T.Vector3(-.63,.209,-.286),
    ...bend([-.63,.209,-.286],[-.665,.209,-.286],[-.69,.222,-.295],[-.69,.222,-.271]).slice(1),
    ...bend([-.69,.222,-.271],[-.69,.222,-.262163],[-.69,.214837,-.255],[-.69,.206,-.255]).slice(1),new T.Vector3(...ports["Oil filter feed"]),
  ],.009,128);
  pressureHose.userData.from="Oil pressure outlet";pressureHose.userData.to="Oil filter feed";
  for (let i = 0; i < 2; i++) {
    // Keep the suction lines inside the raised floor return. Outward-facing
    // pump unions previously sent both loops through the carbon floor skin.
    const pickup=port(`Sump pickup ${i}`, [i===0?-.556:-.735,.103,-.12], [0,0,-1], .007,.028);
    let inlet:T.Vector3;
    if(i===0)inlet=port("Scavenge 0",[-.556,.120,-.214],[0,0,1],.007,.012);
    else{
      const path=new T.CurvePath<T.Vector3>();
      path.add(new T.LineCurve3(new T.Vector3(-.592,.120,-.214),new T.Vector3(-.592,.120,-.204)));
      path.add(new T.CubicBezierCurve3(new T.Vector3(-.592,.120,-.204),new T.Vector3(-.592,.120,-.19516),new T.Vector3(-.59916,.120,-.188),new T.Vector3(-.608,.120,-.188)));
      const section=new T.Shape();section.absarc(0,0,.010,0,Math.PI*2,false);
      const bore=new T.Path();bore.absarc(0,0,.007,0,Math.PI*2,true);section.holes.push(bore);
      add("Scavenge 1 inlet elbow",new T.ExtrudeGeometry(section,{steps:32,curveSegments:12,bevelEnabled:false,extrudePath:path}),mat.metal);
      inlet=port("Scavenge 1",[-.608,.120,-.188],[-1,0,0],.007,.014);
    }
    const route=i===0
      ?bend(pickup.toArray() as V,[-.556,.103,-.170],[-.556,.120,-.180],inlet.toArray() as V)
      :[...bend(pickup.toArray() as V,[-.735,.103,-.180],[-.710,.120,-.188],[-.680,.120,-.188]),new T.Vector3(-.648,.120,-.188),new T.Vector3(-.634,.120,-.188),inlet];
    const line=hose(`Sump scavenge hose ${i}`,route,.009,128);
    line.userData.from=`Sump pickup ${i}`;line.userData.to=`Scavenge ${i}`;
  }
  const cooler=createOilCooler(mat);root.add(cooler);cooler.updateMatrixWorld(true);
  const coolerPoint = (x: number) => new T.Vector3(x, .028, 0).applyMatrix4(cooler.matrixWorld);
  port("Oil scavenge outlet", [-.592, .164, -.240], [0, 1, 0], .008);
  const coolerIn = port("Oil cooler inlet", coolerPoint(.113).toArray() as V, [1, 0, 0], .008);
  const coolerOut = port("Oil cooler outlet", coolerPoint(-.113).toArray() as V, [-1, 0, 0], .008);
  // Return beneath the cooler, then enter an aft-facing union. A rigid elbow
  // makes the turn at the reservoir; the rubber hose meets it without a kink.
  const returnElbow = new T.CurvePath<T.Vector3>();
  returnElbow.add(new T.LineCurve3(new T.Vector3(-.212,.365,-.058),new T.Vector3(-.212,.365,-.084)));
  returnElbow.add(new T.CubicBezierCurve3(new T.Vector3(-.212,.365,-.084),new T.Vector3(-.212,.365,-.09615),new T.Vector3(-.22185,.365,-.106),new T.Vector3(-.234,.365,-.106)));
  const returnSection = new T.Shape(); returnSection.absarc(0,0,.011,0,Math.PI*2,false);
  const returnBore = new T.Path(); returnBore.absarc(0,0,.008,0,Math.PI*2,true); returnSection.holes.push(returnBore);
  add("Oil reservoir return elbow",new T.ExtrudeGeometry(returnSection,{steps:32,bevelEnabled:false,curveSegments:12,extrudePath:returnElbow}),mat.metal);
  const tankReturn = port("Oil reservoir return", [-.234, .365, -.106], [-1, 0, 0], .008);
  const coolerFeed=hose("Oil cooler feed hose",[
    ...bend(ports["Oil scavenge outlet"],[-.592,.212,-.240],[-.590,.235,-.252],[-.580,.237,-.280]),
    ...bend([-.580,.237,-.280],[-.570,.239,-.308],[-.560,.235,-.30714],[-.540,.235,-.310]).slice(1),
    ...([[-.40,.235,-.330],[-.335,.25,-.35],[-.315,.32,-.37],[-.315,.50,-.37],[-.33,coolerIn.y,coolerIn.z]] as V[]).map(p=>new T.Vector3(...p)),
    coolerIn.clone().add(new T.Vector3(.026,0,0)),coolerIn.clone().add(new T.Vector3(.012,0,0)),coolerIn,
  ],.010,160);
  coolerFeed.userData.from="Oil scavenge outlet";coolerFeed.userData.to="Oil cooler inlet";
  // A broad return bend passes below the isolated mounting rails. Reusing
  // the old route through their bolt centres would cut the new supports.
  const turn=coolerOut.clone().add(new T.Vector3(-.026,0,0));
  const returnHeight=.453,returnLateral=-.425;
  const returnHose=hose("Oil cooler return hose",[
    coolerOut,coolerOut.clone().add(new T.Vector3(-.012,0,0)),
    ...bend(turn.toArray() as V,[turn.x-.050,turn.y,turn.z],[turn.x-.050,returnHeight,returnLateral],[turn.x,returnHeight,returnLateral]),
    new T.Vector3(turn.x+.012,returnHeight,returnLateral),new T.Vector3(turn.x+.026,returnHeight,returnLateral),
    new T.Vector3(-.55,returnHeight,returnLateral),new T.Vector3(-.43,returnHeight,returnLateral),
    new T.Vector3(-.385,.461,-.360),
    ...bend([-.355,.475,-.280],[-.305,.510,-.200],[-.321,.455,-.106],[-.321,.400,-.106]),
    ...bend([-.321,.400,-.106],[-.321,.38067,-.106],[-.30533,.365,-.106],[-.286,.365,-.106]).slice(1),
    new T.Vector3(-.272,.365,-.106),tankReturn,
  ],.010,160);
  returnHose.userData.from="Oil cooler outlet";returnHose.userData.to="Oil reservoir return";
  const gallery = port("Engine oil gallery", [-.76, .151, -.185], [0, 0, -1], .007);
  const filtered = port("Filtered oil outlet", [-.731, .146, -.255], [-1, 0, 0], .007);
  hose("Filtered engine oil hose", [filtered, new T.Vector3(-.814,.146,-.255), new T.Vector3(-.824,.165,-.275), new T.Vector3(-.76,.151,-.24), gallery], .009);
  if(connections){
    // A filtered pressure take-off and a separate falling return. The return
    // enters the dry sump above its pickup; it never drains into the pressure line.
    const turboFeed=port("Turbo filtered oil take-off",[-.714,.166,-.255],[0,1,0],.003);
    const turboDrain=port("Turbo sump return",[-.885,.105,-.13],[0,0,-1],.006);
    ports["Turbo oil feed"]=connections.turbo.oilFeed;ports["Turbo oil drain"]=connections.turbo.oilDrain;
    hose("Turbo oil pressure line",[turboFeed,new T.Vector3(-.80,.18,-.25),new T.Vector3(-.98,.19,-.23),new T.Vector3(-1.02,.34,-.15),new T.Vector3(-1.12,.57,-.055),new T.Vector3(-1.12,.581,0),new T.Vector3(...connections.turbo.oilFeed)],.005);
    hose("Turbo oil gravity return",[new T.Vector3(...connections.turbo.oilDrain),new T.Vector3(-1.12,.425,0),new T.Vector3(-1.095,.34,-.088),new T.Vector3(-1.02,.20,-.16),new T.Vector3(-.98,.13,-.19),new T.Vector3(-.90,.105,-.19),turboDrain],.008);

    // The shared low-temperature circuit uses a mechanical pump because it
    // also serves the charge cooler (FIA C5.11.3), separate from engine water.
    const lt=new T.Group();lt.name="Charge low-temperature radiator";lt.position.set(.015,.560,.390);lt.rotation.x=-.22;root.add(lt);lt.updateMatrixWorld(true);
    const world=(p:V)=>new T.Vector3(...p).applyMatrix4(lt.matrixWorld);
    const mouth=mouths.get(1)!;
    const ltRows=coolingDuctSections(splitCoolingMouth(mouth,.552,true),lt.matrixWorld,.148,.075,1,.008,.046,.85,.03,.2);
    duct("Charge radiator inlet duct",ltRows);
    const ltSeal=new T.CatmullRomCurve3(ltRows.at(-1)!,true,"centripetal");
    add("Charge radiator face seal",new T.TubeGeometry(ltSeal,128,.0022,6,true),mat.rubber);
    // The 4 mm splitter closes the gap between the two throat branches. Its
    // aft edge tapers between their separating walls, without a second intake.
    const splitPoints:V[]=[];
    for(const y of[.548,.552]){
      const line=splitCoolingMouth(mouth,y,true).filter(p=>Math.abs(p.y-y)<1e-8).sort((a,b)=>a.z-b.z);
      splitPoints.push(line[0].toArray() as V,line.at(-1)!.toArray() as V);
    }
    const splitterPositions=[...splitPoints,...splitPoints.map(([x,y,z])=>[x-.026,.550+(y-.550)*.3,z] as V)].flat();
    const splitter=new T.BufferGeometry();splitter.setAttribute("position",new T.Float32BufferAttribute(splitterPositions,3));
    splitter.setIndex([0,2,1,1,2,3,4,5,6,5,7,6,0,1,4,1,5,4,2,6,3,3,6,7,0,4,2,2,4,6,1,3,5,3,7,5]);splitter.computeVertexNormals();
    const divider=add("Cooling inlet branch splitter",splitter,mat.carbon);divider.userData.serviceCover=true;divider.userData.airflowCover=true;

    const tubeShape=rectangle(.002,.006),bore=new T.Path();bore.moveTo(-.0012,-.005);bore.lineTo(-.0012,.005);bore.lineTo(.0012,.005);bore.lineTo(.0012,-.005);bore.closePath();tubeShape.holes.push(bore);
    const g=slab(tubeShape,.30);g.rotateY(Math.PI/2);g.translate(-.15,0,0);
    const tubes=new T.InstancedMesh(g,mat.metal,22);tubes.name="Charge radiator coolant tubes";tubes.userData.component="cooling";lt.add(tubes);
    for(let i=0;i<22;i++)tubes.setMatrixAt(i,new T.Matrix4().makeTranslation(0,0,(i-10.5)*.007));
    const folds:T.Vector2[]=[];for(let i=0;i<=60;i++)folds.push(new T.Vector2((i%2?1:-1)*.0014,-.148+i*.296/60));
    const finShape=new T.Shape([...folds.map(p=>new T.Vector2(p.x-.0001,p.y)),...folds.slice().reverse().map(p=>new T.Vector2(p.x+.0001,p.y))]);
    const fin=slab(finShape,.012);fin.rotateZ(Math.PI/2);fin.rotateX(Math.PI/2);fin.translate(0,.006,0);
    const fins=new T.InstancedMesh(fin,mat.metal,21);fins.name="Charge radiator folded fins";fins.userData.component="cooling";lt.add(fins);
    for(let i=0;i<21;i++)fins.setMatrixAt(i,new T.Matrix4().makeTranslation(0,0,(i-10)*.007));
    for(const side of[-1,1]){
      const x=side*.160;
      for(const y of[-.008,.008])box(`Charge radiator header rail ${side} ${y}`,[x,y,0],[.023,.002,.160],mat.cast,lt);
      box(`Charge radiator header back ${side}`,[side*.172,0,0],[.002,.018,.160],mat.cast,lt);
      for(const z of[-.080,.080]){
        const shape=rectangle(.012,.009);if(z*side>0){const h=new T.Path();h.absarc(0,0,.0055,0,Math.PI*2,true);shape.holes.push(h);}
        const end=slab(shape,.002);end.translate(x,0,z-.001);add(`Charge radiator header end ${side} ${z}`,end,mat.cast,lt);
      }
      const plate=rectangle(.009,.080);
      for(let i=0;i<22;i++){const z=(i-10.5)*.007,h=new T.Path();h.moveTo(-.006,z-.002);h.lineTo(-.006,z+.002);h.lineTo(.006,z+.002);h.lineTo(.006,z-.002);h.closePath();plate.holes.push(h);}
      const face=slab(plate,.002);face.rotateY(Math.PI/2);face.rotateX(Math.PI/2);face.translate(side*.150,0,0);add(`Charge radiator tube plate ${side}`,face,mat.cast,lt);
      const base=world([x,0,side*.082]);
      {
        // Both rigid elbows turn outside the headers. Their hoses leave
        // fore/aft, clear of the nearby fuel rail and radiator frame.
        const path=new T.CurvePath<T.Vector3>();
        path.add(new T.LineCurve3(base,world([x,0,side*.090])));
        path.add(new T.CubicBezierCurve3(world([x,0,side*.090]),world([x,0,side*.099941]),world([x-side*.008059,0,side*.108]),world([x-side*.018,0,side*.108])));
        const section=new T.Shape();section.absarc(0,0,.0085,0,Math.PI*2,false);
        const bore=new T.Path();bore.absarc(0,0,.0055,0,Math.PI*2,true);section.holes.push(bore);
        add(side>0?"Charge radiator return elbow":"Charge radiator feed elbow",new T.ExtrudeGeometry(section,{steps:32,bevelEnabled:false,curveSegments:12,extrudePath:path}),mat.metal);
        port(side>0?"Charge radiator hot":"Charge radiator cold",world([x-side*.018,0,side*.108]).toArray() as V,[-side,0,0],.0055);
      }
    }
    for(const z of[-.082,.082])box(`Charge radiator side rail ${z}`,[0,0,z],[.30,.018,.004],mat.darkMetal,lt);
    for(const x of[-.14,.14])for(const z of[-.085,.085])ring(`Charge radiator mounting eye ${x} ${z}`,[x,-.012,z],[x,-.005,z],.003,.006,mat.darkMetal,lt);
    const pump=createLowTemperaturePump(mat);root.add(pump.root);
    port("Charge pump inlet",pump.ports.inlet.point,pump.ports.inlet.axis,.0055);
    const pumpOut=port("Charge pump outlet",pump.ports.outlet.point,pump.ports.outlet.axis,.0055);
    ports["Charge cooler water inlet"]=connections.charge.waterIn;ports["Charge cooler water outlet"]=connections.charge.waterOut;
    fittedHose("Charge cooled water line","Charge radiator cold","Charge pump inlet",[[-.055,.525,.275],[-.08,.44,.25],[-.10,.383,.238]],.0075);
    ports["MGU-K coolant inlet"]=connections.motor.coolantIn;ports["MGU-K coolant outlet"]=connections.motor.coolantOut;
    const motorIn=new T.Vector3(...connections.motor.coolantIn),motorOut=new T.Vector3(...connections.motor.coolantOut);
    // Illustrative LT series circuit. It now includes the enclosed battery /
    // CU-K cold plates; neither union terminates as an unconnected pipe.
    const storeIn=new T.Vector3(...connections.store.coolantIn),storeOut=new T.Vector3(...connections.store.coolantOut);
    ports["ES coolant inlet"]=connections.store.coolantIn;ports["ES coolant outlet"]=connections.store.coolantOut;
    hose("ES coolant supply",[
      pumpOut,pumpOut.clone().add(new T.Vector3(0,-.012,0)),pumpOut.clone().add(new T.Vector3(0,-.026,0)),
      new T.Vector3(-.18,.265,.29),new T.Vector3(-.12,.235,.33),new T.Vector3(-.08,.18,.322),
      new T.Vector3(-.08,.14,.30),new T.Vector3(-.05,.115,.27),new T.Vector3(.01,.120,.30),
      // Rounded approach to the service boot, followed by its straight bore.
      new T.Vector3(.080,.120,.300),new T.Vector3(.106,.120,.300),new T.Vector3(.12014,.120,.29414),
      new T.Vector3(.126,.120,.28),new T.Vector3(.126,.120,.274),new T.Vector3(.126,.120,.27),new T.Vector3(.126,.120,.18),
      // Pass below the return union before turning into the battery inlet.
      new T.Vector3(.107,.105,.02),new T.Vector3(.107,.110,-.050),new T.Vector3(.107,.120,-.070),
      new T.Vector3(.107,.120,-.080),new T.Vector3(.11286,.120,-.09414),
      storeIn.clone().add(new T.Vector3(-.015,0,0)),storeIn,
    ],.006,192);
    hose("ES coolant return",[storeOut,storeOut.clone().add(new T.Vector3(-.012,0,0)),new T.Vector3(.117,.140,-.040),new T.Vector3(.117,.140,.20),new T.Vector3(.117,.140,.23),new T.Vector3(.117,.140,.28),new T.Vector3(.117,.140,.30),new T.Vector3(-.04,.140,.29),new T.Vector3(-.10,.21,.29),new T.Vector3(-.215,.205,.285),motorIn.clone().add(new T.Vector3(.030,0,0)),motorIn],.006);
    const motorReturnStart=motorOut.x-.020;
    hose("MGU-K coolant return",[motorOut,new T.Vector3(motorReturnStart,.175,.278),...bend([motorReturnStart,.175,.278],[motorReturnStart-.031,.175,.278],[motorReturnStart-.039,.20,.300],[motorReturnStart-.005,.20,.300]).slice(1),new T.Vector3(-.45,.223,.333),new T.Vector3(-.34,.26,.355),new T.Vector3(-.335,.43,.36),new T.Vector3(-.335,.56,.37),new T.Vector3(-.52,.570,.353),new T.Vector3(...connections.charge.waterIn)],.006,128);
    const chargeReturn=new T.Vector3(...ports["Charge radiator hot"]);
    hose("Charge warm water line",[new T.Vector3(...connections.charge.waterOut),new T.Vector3(-.52,.506,.354),new T.Vector3(-.35,.555,.38),new T.Vector3(-.10,.56,.48),chargeReturn.clone().add(new T.Vector3(-.075,0,0)),chargeReturn],.0075);
    const bottle=add("Charge coolant expansion bottle",new T.CylinderGeometry(.021,.024,.075,32),mat.cast);bottle.position.set(-.30,.628,.19);
    const cap=add("Charge coolant pressure cap",new T.CylinderGeometry(.017,.017,.008,12),mat.darkMetal);cap.position.set(-.30,.670,.19);
    port("Charge expansion return",[-.30,.592,.19],[0,-1,0],.003);
    port("Charge pump bleed",pump.ports.bleed.point,pump.ports.bleed.axis,.003);
    fittedHose("Charge expansion hose","Charge expansion return","Charge pump bleed",[[-.30,.50,.23],[-.25,.481,.238],[-.225,.481,.238],[-.20732,.47368,.238]],.005);
    for(const name of["Charge pump inlet","Charge pump outlet","Charge pump bleed"])for(const suffix of["socket","collar"]){
      const part=root.getObjectByName(`${name} ${suffix}`)!;part.userData.coolantPump="lt";part.userData.serviceCover=true;
    }
  }
  root.userData.ports = ports;
  root.updateMatrixWorld(true); return root;
}
