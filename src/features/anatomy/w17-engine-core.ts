import * as T from "three";
import { createHydraulicPumpMotion } from "./w17-hydraulic-pump.ts";
import { servicePassage } from "./w17-feedthrough.ts";

type Materials = Record<"metal" | "cast" | "darkMetal", T.Material>;

// FIA 2026 C5.1/C5.4: dimensions in metres. Journal phasing, bank stagger,
// counterweights and casting details are reconstructions, not Mercedes CAD.
export const ENGINE_CORE = {
  bore: .080, pitch: .101, displacement: .0016, rodLength: .120,
  deck: .168, pinDiameter: .0185, mainDiameter: .045, journalDiameter: .042,
  bankStagger: .0196, centreX: -.610, initialAngle: .40,
};
export const ENGINE_STROKE = ENGINE_CORE.displacement / (6 * Math.PI * (ENGINE_CORE.bore / 2) ** 2);
const throwRadius = ENGINE_STROKE / 2;
const crownHeight = ENGINE_CORE.deck - ENGINE_CORE.rodLength - throwRadius - .001;
export const engineCylinderX = (side: number, index: number) => ENGINE_CORE.centreX + (index - 1) * ENGINE_CORE.pitch + side * ENGINE_CORE.bankStagger / 2;

// Valve sizes follow C5.4.12–15. Cam profile, inclination, lift and timing are
// explanatory reconstruction values, not the Mercedes combustion calibration.
export const ENGINE_VALVETRAIN = { intakeDiameter:.033, exhaustDiameter:.028, stemDiameter:.005, tilt:Math.PI/15, baseRadius:.012, noseRadius:.005, noseOffset:.014 };
export function engineValveEvent(side:number,index:number,kind:string) {
  return side*Math.PI/4-index*Math.PI*2/3+(kind==="intake"?2.5:1.5)*Math.PI;
}
export function engineValveLift(side:number,index:number,kind:string,angle:number) {
  const {baseRadius,noseRadius,noseOffset}=ENGINE_VALVETRAIN;
  return Math.max(0,noseRadius+noseOffset*Math.cos((angle-engineValveEvent(side,index,kind))/2)-baseRadius);
}

export function enginePistonPose(side: number, index: number, angle: number) {
  const axis = new T.Vector3(0, Math.SQRT1_2, side * Math.SQRT1_2);
  const phase = angle + index * Math.PI * 2 / 3;
  const journal = new T.Vector3(engineCylinderX(side, index), Math.cos(phase) * throwRadius, Math.sin(phase) * throwRadius);
  const projection = journal.dot(axis);
  const distance = projection + Math.sqrt(ENGINE_CORE.rodLength ** 2 - throwRadius ** 2 + projection ** 2);
  const pin = axis.clone().multiplyScalar(distance); pin.x = journal.x;
  return { journal, pin, axis, crown: pin.clone().addScaledVector(axis, crownHeight) };
}

// Cache references once per model clone. Updating transforms never rebuilds a
// mesh and cannot mutate the geometry shared with the assembled car.
export function createEngineMotion(root: T.Object3D) {
  const crank = root.getObjectByName("Crankshaft"), pistons: T.Object3D[] = [], rods: T.Object3D[] = [], cams:T.Object3D[]=[],valves:T.Object3D[]=[],gears:T.Object3D[]=[];
  root.traverse(part => {
    if (part.userData.engineMotion === "piston") pistons.push(part);
    if (part.userData.engineMotion === "rod") rods.push(part);
    if (part.userData.engineMotion === "camshaft") cams.push(part);
    if (part.userData.engineMotion === "valve") valves.push(part);
    if (["timingGear","accessoryGear","accessoryShaft"].includes(part.userData.engineMotion)) gears.push(part);
  });
  const hydraulicPumpMotion=createHydraulicPumpMotion(root);
  return (angle: number) => {
    hydraulicPumpMotion(angle);
    if (crank) crank.rotation.x = angle;
    for(const cam of cams)cam.rotation.x=angle/2;
    for(const gear of gears)gear.rotation.x=angle*gear.userData.ratio+gear.userData.phase;
    for(const valve of valves){
      const {side,cylinder,kind,seat,axis}=valve.userData;
      valve.position.fromArray(seat).addScaledVector(new T.Vector3(...axis),-engineValveLift(side,cylinder,kind,angle));
    }
    for (const part of pistons) {
      const { side, cylinder } = part.userData;
      part.position.copy(enginePistonPose(side, cylinder, angle).pin);
    }
    for (const part of rods) {
      const { journal, pin } = enginePistonPose(part.userData.side, part.userData.cylinder, angle);
      part.position.copy(journal);
      part.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), pin.sub(journal).normalize());
    }
  };
}

export function createEngineCore(mat: Materials) {
  const root = new T.Group(); root.name = "V6 crank and piston assembly";
  // The existing builder applies its common engine-height offset afterward.
  root.position.y = .29;
  const crank = new T.Group(); crank.name = "Crankshaft"; root.add(crank);
  const add = (parent: T.Object3D, name: string, geometry: T.BufferGeometry, material = mat.metal, cover = false) => {
    const part = new T.Mesh(geometry, material); part.name = name;
    part.userData = { component: "engine", internal: true, serviceCover: cover, engineCore: true };
    part.castShadow = part.receiveShadow = true; parent.add(part); return part;
  };
  const axial = (parent: T.Object3D, name: string, x: number, length: number, radius: number, y = 0, z = 0, material = mat.darkMetal) => {
    const part = add(parent, name, new T.CylinderGeometry(radius, radius, length, 48), material);
    part.rotation.z = -Math.PI / 2; part.position.set(x, y, z); return part;
  };
  const ring = (parent: T.Object3D, name: string, inner: number, outer: number, length: number, material = mat.metal, cover = false) =>
    add(parent, name, new T.LatheGeometry([[inner, -length/2], [outer, -length/2], [outer, length/2], [inner, length/2], [inner, -length/2]].map(p => new T.Vector2(...p)), 48), material, cover);
  const splitRing = (parent: T.Object3D, name: string, inner: number, outer: number, length: number, start: number, sweep: number, material = mat.metal) => {
    const shape = new T.Shape();
    shape.absarc(0, 0, outer, start, start + sweep, false);
    shape.absarc(0, 0, inner, start + sweep, start, true); shape.closePath();
    const geometry = new T.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, curveSegments: 24 });
    geometry.translate(0, 0, -length/2); geometry.rotateX(Math.PI/2);
    return add(parent, name, geometry, material);
  };

  const first = ENGINE_CORE.centreX - ENGINE_CORE.pitch, last = ENGINE_CORE.centreX + ENGINE_CORE.pitch;
  // No straight shaft through the offset big ends: the main-axis segments end
  // at the cheeks, and three common journals carry both banks' rods.
  const boundaries = [-.948, first-.026, first+.026, ENGINE_CORE.centreX-.026, ENGINE_CORE.centreX+.026, last-.026, last+.026, -.260];
  for (let i=0; i<boundaries.length; i+=2) axial(crank, `Crank main-axis section ${i/2}`, (boundaries[i]+boundaries[i+1])/2, boundaries[i+1]-boundaries[i], .0225);
  for (let i=0; i<3; i++) {
    const x = ENGINE_CORE.centreX + (i-1)*ENGINE_CORE.pitch, angle = i*Math.PI*2/3;
    const y = Math.cos(angle)*throwRadius, z = Math.sin(angle)*throwRadius;
    const journal = axial(crank, `Crank rod journal ${i}`, x, .0394, .021, y, z);
    journal.userData.engineJournal = i;
    for (const side of [-1,1]) {
      const shape = new T.Shape();
      shape.absarc(0, 0, .024, Math.PI/2, Math.PI*1.5, false);
      shape.absarc(throwRadius, 0, .024, Math.PI*1.5, Math.PI*2.5, false); shape.closePath();
      const geometry = new T.ExtrudeGeometry(shape, {depth:.0063, bevelEnabled:true, bevelSize:.0008, bevelThickness:.0008, bevelSegments:2, curveSegments:20});
      // Shape X maps to the crank throw in YZ; extrusion maps to engine X.
      const basis = new T.Matrix4().makeBasis(new T.Vector3(0,Math.cos(angle),Math.sin(angle)),new T.Vector3(0,-Math.sin(angle),Math.cos(angle)),new T.Vector3(1,0,0));
      geometry.translate(0,0,-.00315); geometry.applyMatrix4(basis); geometry.translate(x+side*.02285,0,0);
      add(crank, `Crank cheek ${i} ${side}`, geometry, mat.darkMetal);
      const counterweight = splitRing(crank, `Crank counterweight ${i} ${side}`, .016, .051, .0078, Math.PI-1.02, 2.04, mat.darkMetal);
      // The sector lies opposite the journal after mapping its axis to X.
      counterweight.rotation.z = Math.PI/2; counterweight.rotation.x = angle;
      counterweight.position.x = x+side*.02285;
    }
  }

  for (let i=0; i<4; i++) {
    const x = first - ENGINE_CORE.pitch/2 + i*ENGINE_CORE.pitch;
    for (const half of [0,1]) {
      const bearing = splitRing(root, `Crank main bearing ${i} shell ${half}`, .0226, .0243, .0195, half*Math.PI-Math.PI/2, Math.PI, mat.metal);
      bearing.rotation.z = -Math.PI/2; bearing.position.x=x;
      const saddle = splitRing(root, `Crank main bearing ${i} saddle ${half}`, .0243, .033, .023, half*Math.PI-Math.PI/2, Math.PI, mat.cast);
      saddle.rotation.z = -Math.PI/2; saddle.position.x=x;
    }
    for (const side of [-1,1]) {
      const foot=add(root,`Crank bearing ${i} mounting foot ${side}`,new T.BoxGeometry(.023,.023,.050),mat.cast);
      foot.position.set(x,-.008,side*.0475);
      const bolt=add(root,`Crank bearing ${i} cap bolt ${side}`,new T.CylinderGeometry(.003,.003,.043,16),mat.darkMetal);
      bolt.position.set(x,-.012,side*.038);
      const head=add(root,`Crank bearing ${i} bolt head ${side}`,new T.CylinderGeometry(.005,.005,.004,6),mat.metal);
      head.position.set(x,-.034,side*.038);
    }
  }
  for (const x of [first-ENGINE_CORE.pitch/2-.0125,first-ENGINE_CORE.pitch/2+.0125]) {
    const thrust=ring(root,`Crank thrust washer ${x}`,.0227,.032,.002,mat.metal);
    thrust.rotation.z=-Math.PI/2; thrust.position.x=x;
  }

  for (const side of [-1,1]) for (let i=0; i<3; i++) {
    const x=engineCylinderX(side,i), name=`Cylinder ${side} ${i}`;
    const bank=new T.Group(); bank.name=`${name} liner assembly`;bank.position.x=x;bank.rotation.x=side*Math.PI/4;root.add(bank);
    const liner=ring(bank,`Cylinder barrel ${side} ${i}`,.040,.0435,ENGINE_CORE.deck-.064,mat.metal,true);
    liner.position.y=(ENGINE_CORE.deck+.064)/2;
    const lip=ring(bank,`${name} liner flange`,.040,.047,.003,mat.metal,true);lip.position.y=ENGINE_CORE.deck-.0015;

    const piston=new T.Group();piston.name=`${name} piston assembly`;
    piston.userData={engineMotion:"piston",side,cylinder:i};piston.rotation.x=side*Math.PI/4;root.add(piston);
    // Closed crown and a hollow skirt. Three ring grooves are machined into
    // the outside profile; the wrist-pin bores pass through the skirt walls.
    const profile:T.Vector2[]=[new T.Vector2(.0345,-.021),new T.Vector2(.03985,-.021)];
    for(const [depth,width] of [[.012,.0016],[.007,.0009],[.003,.0009]]) {
      const y=crownHeight-depth;
      profile.push(new T.Vector2(.03985,y-width/2),new T.Vector2(.0388,y-width/2),new T.Vector2(.0388,y+width/2),new T.Vector2(.03985,y+width/2));
    }
    profile.push(new T.Vector2(.03985,crownHeight),new T.Vector2(0,crownHeight),new T.Vector2(0,crownHeight-.004),new T.Vector2(.0345,crownHeight-.004),new T.Vector2(.0345,-.021));
    const skirt=new T.LatheGeometry(profile,64);skirt.rotateY(Math.PI/2);
    const boreFrame=new T.Matrix4().makeRotationY(Math.PI/2);
    skirt.applyMatrix4(boreFrame);
    const pinHole=Array.from({length:32},(_,j)=>new T.Vector2(Math.cos(j*Math.PI/16)*.00935,Math.sin(j*Math.PI/16)*.00935));
    const bored=servicePassage(skirt,pinHole);skirt.dispose();bored.applyMatrix4(boreFrame.clone().invert());
    add(piston,`${name} piston crown and skirt`,bored,mat.metal);
    for(const end of [-1,1]) {
      const boss=ring(piston,`${name} piston pin boss ${end}`,.00935,.0125,.023,mat.metal);boss.rotation.z=-Math.PI/2;boss.position.x=end*.026;
      const retainer=splitRing(piston,`${name} pin circlip ${end}`,.0091,.0102,.0008,.12,Math.PI*2-.24,mat.darkMetal);retainer.rotation.z=-Math.PI/2;retainer.position.x=end*.0373;
    }
    const pin=ring(piston,`${name} wrist pin`,.005,.00925,.073,mat.darkMetal);pin.rotation.z=-Math.PI/2;
    for(const [index,depth,width]of [[0,.003,.0008],[1,.007,.0008],[2,.012,.0015]]) {
      const gapAngle=.006, ringPart=splitRing(piston,`${name} piston ring ${index}`,.0389,.03998,width,index*Math.PI*2/3+gapAngle,Math.PI*2-gapAngle*2,mat.darkMetal);
      ringPart.position.y=crownHeight-depth;
      ringPart.userData.pistonRing=index===2?"oil":"compression";
    }

    const rod=new T.Group();rod.name=`${name} connecting rod`;
    rod.userData={engineMotion:"rod",side,cylinder:i};root.add(rod);
    for(const half of [0,1]) {
      const end=splitRing(rod,`${name} rod big end ${half}`,.0220,.028,.0182,half*Math.PI-Math.PI/2,Math.PI,mat.darkMetal);
      end.rotation.z=-Math.PI/2;
      const shell=splitRing(rod,`${name} rod bearing ${half}`,.0211,.0220,.018,half*Math.PI-Math.PI/2,Math.PI,mat.metal);shell.rotation.z=-Math.PI/2;
    }
    const small=ring(rod,`${name} rod small end`,.0101,.014,.016,mat.darkMetal);small.rotation.z=-Math.PI/2;small.position.y=ENGINE_CORE.rodLength;
    const bush=ring(rod,`${name} small end bushing`,.00935,.0101,.016,mat.metal);bush.rotation.z=-Math.PI/2;bush.position.y=ENGINE_CORE.rodLength;
    // Tapered I-section: thin central web and two edge flanges, ending in the
    // forged eyes rather than in disconnected cylinders.
    const webShape=new T.Shape();webShape.moveTo(-.011,.021);webShape.lineTo(.011,.021);webShape.lineTo(.0065,.110);webShape.lineTo(-.0065,.110);webShape.closePath();
    const webGeometry=new T.ExtrudeGeometry(webShape,{depth:.0035,bevelEnabled:true,bevelSize:.0005,bevelThickness:.0005,bevelSegments:2});
    webGeometry.translate(0,0,-.00175);webGeometry.rotateY(Math.PI/2);
    add(rod,`${name} rod web`,webGeometry,mat.darkMetal);
    for(const end of [-1,1]) {
      const railShape=new T.Shape();railShape.moveTo(end*.009,.021);railShape.lineTo(end*.012,.021);railShape.lineTo(end*.008,.110);railShape.lineTo(end*.005,.110);railShape.closePath();
      const railGeometry=new T.ExtrudeGeometry(railShape,{depth:.011,bevelEnabled:true,bevelSize:.0005,bevelThickness:.0005,bevelSegments:2});railGeometry.translate(0,0,-.0055);railGeometry.rotateY(Math.PI/2);
      add(rod,`${name} rod flange ${end}`,railGeometry,mat.darkMetal);
      const lug=add(rod,`${name} rod cap bolt seat ${end}`,new T.BoxGeometry(.0182,.006,.010),mat.darkMetal);lug.position.set(0,-.016,end*.022);
      const bolt=add(rod,`${name} rod cap bolt ${end}`,new T.CylinderGeometry(.0023,.0023,.023,12),mat.metal);bolt.position.set(0,-.006,end*.022);
      const head=add(rod,`${name} rod cap bolt head ${end}`,new T.CylinderGeometry(.0035,.0035,.004,6),mat.metal);head.position.set(0,-.020,end*.022);
    }
  }
  createEngineMotion(root)(ENGINE_CORE.initialAngle);
  return root;
}
