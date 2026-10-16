import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createSurfaceSampler } from "./w17-surface.ts";
import lettering from "./cockpit-markings.json" with { type: "json" };

type V = [number, number, number];
type Materials = Record<"carbon" | "black" | "rubber" | "metal" | "darkMetal" | "cast" | "red" | "white" | "orange", T.Material>;
const v = (p: V) => new T.Vector3(...p);

// W17's removable carbon seat and six-point restraint are confirmed by Mercedes.
// Contours, controls and pedal packaging are reconstructed, not factory CAD.
export function createCockpit(mat: Materials) {
  const cockpit = new T.Group(); cockpit.name = "Cockpit equipment";
  const wheel = new T.Group(); wheel.name = "Complete steering wheel";
  let cockpitSection: "seat" | "pedals" = "seat";
  const webbing = (mat.red as T.MeshStandardMaterial).clone();
  webbing.roughness = .94; webbing.metalness = 0;
  const add = (parent: T.Group, name: string, geometry: T.BufferGeometry, material: T.Material) => {
    const part = new T.Mesh(geometry, material); part.name = name;
    part.userData = { component: parent === wheel ? "steering" : "cockpit", cockpitDetail: parent === wheel, cockpitSection: parent === wheel ? "wheel" : cockpitSection };
    part.castShadow = part.receiveShadow = true; parent.add(part); return part;
  };
  const box = (parent: T.Group, name: string, p: V, size: V, material: T.Material, radius = .001) => {
    const part = add(parent, name, new RoundedBoxGeometry(...size, 2, Math.min(radius, ...size.map(n => n / 3))), material); part.position.set(...p); return part;
  };
  const cylinder = (parent: T.Group, name: string, a: V, b: V, radius: number, material: T.Material, inner = 0) => {
    const axis = v(b).sub(v(a)), length = axis.length();
    const geometry = inner ? new T.LatheGeometry([[inner, 0], [radius, 0], [radius, length], [inner, length], [inner, 0]].map(p => new T.Vector2(...p)), 24) : new T.CylinderGeometry(radius, radius, length, 24).translate(0, length / 2, 0);
    const part = add(parent, name, geometry, material); part.position.copy(v(a)); part.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize());
    part.userData.axis = [a, b]; return part;
  };
  const bolt = (parent: T.Group, name: string, a: V, b: V, radius = .0025) => {
    cylinder(parent, `${name} shank`, a, b, radius * .55, mat.darkMetal);
    const axis = v(b).sub(v(a)).normalize();
    cylinder(parent, `${name} socket head`, b, v(b).addScaledVector(axis, .0015).toArray() as V, radius, mat.metal, radius * .45);
  };
  const line = (parent: T.Group, name: string, points: V[], radius: number, material: T.Material) => {
    const curve = new T.CatmullRomCurve3(points.map(v), false, "centripetal");
    const part = add(parent, name, new T.TubeGeometry(curve, name.endsWith("return spring") ? 192 : 48, radius, 8, false), material); part.userData.route = points; return part;
  };

  // Smooth section interpolation retains the established outer seat envelope.
  const stations = [[-.075,.570,.180,.602],[.025,.520,.160,.570],[.160,.330,.170,.430],[.350,.250,.160,.300],[.550,.260,.130,.320],[.720,.370,.105,.440]];
  const section = (x: number) => {
    let i = 0; while (i < stations.length - 2 && stations[i + 1][0] < x) i++;
    const a = stations[i], b = stations[i + 1], t = T.MathUtils.clamp((x - a[0]) / (b[0] - a[0]), 0, 1);
    return [1,2,3].map(k => {
      const slope = (j: number) => {
        const left = stations[Math.max(0,j-1)], right = stations[Math.min(stations.length-1,j+1)];
        const dl = j ? (stations[j][k]-left[k])/(stations[j][0]-left[0]) : (right[k]-stations[j][k])/(right[0]-stations[j][0]);
        const dr = j < stations.length-1 ? (right[k]-stations[j][k])/(right[0]-stations[j][0]) : dl;
        return dl * dr <= 0 ? 0 : Math.sign(dl) * Math.min(Math.abs(dl), Math.abs(dr));
      };
      return (2*t*t*t-3*t*t+1)*a[k]+(t*t*t-2*t*t+t)*slope(i)*(b[0]-a[0])+(-2*t*t*t+3*t*t)*b[k]+(t*t*t-t*t)*slope(i+1)*(b[0]-a[0]);
    });
  };
  const seatY = (x: number, z: number) => { const [bottom,width,edge] = section(x); return bottom+(edge-bottom)*Math.pow(Math.abs(z/width),4); };
  const rows = [...new Set([...stations.flatMap((s,i) => i === stations.length-1 ? [s[0]] : Array.from({length:12},(_,j) => s[0]+(stations[i+1][0]-s[0])*j/12)), -.055,-.010,.405,.450])].sort((a,b)=>a-b);
  const cols = [...new Set([...Array.from({length:33},(_,i)=>i/16-1),-.62,-.30,-.25,-.06,.06,.25,.30,.62])].sort((a,b)=>a-b);
  const vertices: number[] = [], faces: number[] = [], edgeUses = new Map<string,{a:number;b:number;uses:number}>();
  for (const x of rows) for (const u of cols) { const z=u*section(x)[1]; vertices.push(x,seatY(x,z),z); }
  const count = vertices.length/3;
  for (let i=0;i<count;i++) vertices.push(vertices[i*3],vertices[i*3+1]-.008,vertices[i*3+2]);
  const quad = (a:number,b:number,c:number,d:number) => {
    faces.push(a,b,c,b,d,c,a+count,c+count,b+count,b+count,c+count,d+count);
    for(const [p,q] of [[a,b],[b,d],[d,c],[c,a]]) { const key=p<q?`${p}/${q}`:`${q}/${p}`, edge=edgeUses.get(key); if(edge)edge.uses++;else edgeUses.set(key,{a:p,b:q,uses:1}); }
  };
  for(let i=0;i<rows.length-1;i++)for(let j=0;j<cols.length-1;j++){
    const x=(rows[i]+rows[i+1])/2,u=Math.abs((cols[j]+cols[j+1])/2);
    if((x>-.055&&x<-.010&&u>.30&&u<.62)||(x>.405&&x<.450&&u>.06&&u<.25))continue;
    const a=i*cols.length+j;quad(a,a+1,a+cols.length,a+cols.length+1);
  }
  for(const {a,b,uses}of edgeUses.values())if(uses===1)faces.push(a,b,b+count,a,b+count,a+count);
  const seat = new T.BufferGeometry();seat.setAttribute("position",new T.Float32BufferAttribute(vertices,3));seat.setIndex(faces);seat.computeVertexNormals();
  add(cockpit,"Sculpted carbon seat",seat,mat.carbon);
  for(const side of[-1,1]){
    line(cockpit,`Seat rolled edge ${side}`,rows.map(x=>[x,section(x)[2],side*section(x)[1]]),.0028,mat.black);
    for(const x of[.28,.55]){
      const [,width,y]=section(x);
      box(cockpit,`Seat chassis lug ${x}/${side}`,[x,y-.008,side*(width+.228)/2],[.036,.008,.228-width+.012],mat.carbon);
      bolt(cockpit,`Seat retaining bolt ${x}/${side}`,[x,y-.017,side*(width-.004)],[x,y+.001,side*(width-.004)],.0035);
    }
    // Small pads follow the seat surface; no solid upholstery block fills it.
    for(const [label,x1,x2,w]of[["lumbar",.105,.22,.105],["hip",.26,.39,.105],["thigh",.48,.61,.080]] as const){
      const pos:number[]=[],ix:number[]=[];
      for(let i=0;i<=12;i++)for(let j=0;j<=12;j++){
        const x=T.MathUtils.lerp(x1,x2,i/12),z=(j/6-1)*w;
        pos.push(x,seatY(x,z)+.001+.003*Math.sin(Math.PI*i/12)*Math.sin(Math.PI*j/12),z);
      }
      for(let i=0;i<12;i++)for(let j=0;j<12;j++){const a=i*13+j;ix.push(a,a+1,a+13,a+1,a+14,a+13);}
      if(side===1){const g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(pos,3));g.setIndex(ix);g.computeVertexNormals();add(cockpit,`Seat ${label} pad`,g,mat.rubber);}
    }
  }

  const ribbon = (name:string, points:V[], width:number, across:V) => {
    const curve = new T.CatmullRomCurve3(points.map(v),false,"centripetal"),p:number[]=[],ix:number[]=[],edges:V[][]=[[],[]];
    const drape=(point:T.Vector3,height:number)=>{
      const above=name.startsWith("Lap")||(name.startsWith("Shoulder")&&point.x>-.010)||(name.startsWith("Sub")&&point.x<.405);
      if(above&&point.x>=stations[0][0]&&point.x<=stations.at(-1)![0]&&Math.abs(point.z)<=section(point.x)[1])point.y=Math.max(point.y,seatY(point.x,point.z)+height);
      return point;
    };
    for(let i=0;i<=72;i++){
      const t=i/72,c=curve.getPoint(t),d=curve.getTangent(t),cross=v(across).addScaledVector(d,-v(across).dot(d)).normalize(),n=d.clone().cross(cross).normalize();
      if(n.y<0)n.negate();
      for(const [sign,h]of[[-1,0],[1,0],[-1,-.002],[1,-.002]])p.push(...drape(c.clone().addScaledVector(cross,sign*width/2).addScaledVector(n,h),h===0?.007:.005).toArray());
      for(let e=0;e<2;e++)edges[e].push(drape(c.clone().addScaledVector(cross,(e?1:-1)*(width/2-.002)).addScaledVector(n,.0003),.0074).toArray() as V);
      if(i<72){const a=i*4;for(const [b,c,d,e]of[[0,1,4,5],[2,6,3,7],[0,4,2,6],[1,3,5,7]])ix.push(a+b,a+c,a+d,a+c,a+e,a+d);}
    }
    ix.push(0,2,1,1,2,3,288,289,290,289,291,290);
    const g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();
    const part=add(cockpit,name,g,webbing);part.userData.route=points;part.userData.harness=true;
    const stitch=edges.map(points=>new T.TubeGeometry(new T.CatmullRomCurve3(points.map(v)),72,.00035,4,false));
    add(cockpit,`${name} edge stitching`,mergeGeometries(stitch)!,mat.darkMetal);stitch.forEach(g=>g.dispose());
    return curve;
  };
  for(const side of[-1,1]){
    const z=side*.078;
    const shoulder:V[]=[[-.092,.565,z],[-.065,.548,z],[-.034,seatY(-.034,z)+.004,z],...[-.005,.025,.065,.11,.16,.21,.26].map(x=>[x,seatY(x,z)+.006,z] as V),[.31,.283,side*.018]];
    ribbon(`Shoulder harness ${side}`,shoulder,.044,[0,0,1]);
    const lap:V[]=[[.29,.292,side*.195],[.29,.354,side*.174],[.30,seatY(.30,side*.145)+.012,side*.145],[.31,.282,side*.08],[.31,.283,side*.018]];
    ribbon(`Lap harness ${side}`,lap,.041,[1,0,0]);
    const sub:V[]=[[.46,.244,side*.045],[.435,seatY(.435,side*.025)+.002,side*.025],[.405,seatY(.405,side*.025)+.006,side*.025],[.365,.274,side*.015],[.328,.283,side*.011]];
    ribbon(`Sub harness ${side}`,sub,.022,[0,0,1]);
    for(const [name,p]of[["Shoulder",shoulder[0]],["Lap",lap[0]],["Sub",sub[0]]] as const){
      box(cockpit,`${name} harness anchor ${side}`,[p[0],p[1]-.003,p[2]],[.031,.006,.030],mat.darkMetal);
      bolt(cockpit,`${name} harness anchor ${side}`,[p[0],p[1]-.008,p[2]],[p[0],p[1]+.002,p[2]],.004);
    }
    box(cockpit,`Lap harness structural insert ${side}`,[.29,.284,side*.209],[.042,.012,.042],mat.darkMetal);
    box(cockpit,`Sub harness anchor carrier ${side}`,[.46,.239,side*.127],[.034,.006,.190],mat.carbon);
    // Retained adjuster frames bridge the webbing, with the webbing visible inside.
    const x=.073,y=Math.max(seatY(x,z-.025),seatY(x,z+.025))+.009,angle=Math.atan2(seatY(x+.002,z)-seatY(x-.002,z),.004);
    const adjuster=new T.Group();adjuster.name=`Harness adjuster ${side}`;adjuster.position.set(x,y,z);adjuster.rotation.z=angle;cockpit.add(adjuster);
    for(const zz of[-.025,.025]){const p=box(cockpit,"Harness adjuster rail",[0,0,zz],[.034,.003,.004],mat.metal);adjuster.add(p);}
    for(const xx of[-.017,0,.017]){const p=box(cockpit,"Harness adjuster bar",[xx,0,0],[.004,.003,.054],mat.metal);adjuster.add(p);}
  }
  cylinder(cockpit,"Harness buckle",[.31,.272,0],[.31,.287,0],.027,mat.darkMetal);
  cylinder(cockpit,"Harness buckle release bezel",[.31,.287,0],[.31,.290,0],.021,mat.metal,.016);
  box(cockpit,"Harness rotary release lever",[.31,.293,0],[.036,.005,.010],mat.red,.003);
  for(const a of[0,Math.PI/2,Math.PI,Math.PI*1.5])bolt(cockpit,"Harness buckle fixing",[.31+Math.cos(a)*.022,.283,Math.sin(a)*.022],[.31+Math.cos(a)*.022,.289,Math.sin(a)*.022],.0017);

  // An open two-pedal assembly: independent shafts, bearings, levers and returns.
  cockpitSection = "pedals";
  for(const z of[-.116,.116])box(cockpit,`Pedal mounting rail ${z}`,[1.065,.287,z],[.39,.012,.016],mat.darkMetal);
  for(const z of[-.116,.116])for(const x of[.94,.98,1.06,1.17,1.21]){
    cylinder(cockpit,`Pedal rail adjustment insert ${x}/${z}`,[x,.290,z],[x,.294,z],.0032,mat.metal,.0018);
  }
  for(const x of[.91,1.02,1.13,1.24])box(cockpit,`Pedal crossmember ${x}`,[x,.287,0],[.040,x===1.13?.022:.012,.246],mat.cast);
  const heel=new T.Shape([new T.Vector2(.705,.366),new T.Vector2(.87,.298),new T.Vector2(1.005,.298),new T.Vector2(1.005,.294),new T.Vector2(.87,.294),new T.Vector2(.705,.362)]);
  const heelGeo=new T.ExtrudeGeometry(heel,{depth:.204,bevelEnabled:false});heelGeo.translate(0,0,-.102);add(cockpit,"Pedal heel rest",heelGeo,mat.carbon);
  for(const [name,z,width]of[["Brake",-.060,.075],["Throttle",.065,.050]] as const){
    const pivot:V=[1.02,.314,z],toe:V=[.974,.392,z];
    cylinder(cockpit,`${name} pedal pivot`,[1.02,.314,z-.030],[1.02,.314,z+.030],.004,mat.metal);
    for(const s of[-1,1]){
      box(cockpit,`${name} pedal bearing pedestal ${s}`,[1.02,.300,z+s*.025],[.030,.026,.010],mat.cast);
      cylinder(cockpit,`${name} pedal pivot bearing ${s}`,[1.02,.314,z+s*.025-.005],[1.02,.314,z+s*.025+.005],.009,mat.darkMetal,.004);
      bolt(cockpit,`${name} pedal pedestal fixing ${s}`,[1.02,.283,z+s*.025],[1.02,.294,z+s*.025]);
    }
    const outline=new T.Shape([new T.Vector2(1.012,.309),new T.Vector2(1.028,.315),new T.Vector2(.988,.420),new T.Vector2(.972,.416)]);
    const lever=new T.ExtrudeGeometry(outline,{depth:.012,bevelEnabled:true,bevelSize:.001,bevelThickness:.001,bevelSegments:2});lever.translate(0,0,z-.006);add(cockpit,`${name} pedal lever`,lever,mat.metal);
    const face = new T.Shape();face.moveTo(-width/2,-.042);face.lineTo(width/2,-.042);face.lineTo(width/2,.042);face.quadraticCurveTo(0,.052,-width/2,.042);face.closePath();
    for(const h of[-.025,0,.025])for(const w of[-width*.25,width*.25]){const hole=new T.Path();hole.absarc(w,h,.004,0,Math.PI*2,true);face.holes.push(hole);}
    const g=new T.ExtrudeGeometry(face,{depth:.004,bevelEnabled:true,bevelSize:.001,bevelThickness:.0006,bevelSegments:2,curveSegments:8});g.rotateY(-Math.PI/2);
    const plate=add(cockpit,`${name} pedal face`,g,mat.darkMetal);plate.position.copy(v(toe));plate.rotation.z=.18;
    // Raised tread lies between the perforations, on the driver's side.
    for(const h of[-.035,-.012,.012,.035]){
      const p=new T.Vector3(-.005,h,0).applyAxisAngle(new T.Vector3(0,0,1),.18).add(v(toe));
      const tread=box(cockpit,`${name} pedal tread ${h}`,p.toArray() as V,[.002,.002,width*.84],mat.metal,.0005);tread.rotation.z=.18;
    }
    for(const h of[-.034,.034]){
      const a=new T.Vector3(.003,h,0).applyAxisAngle(new T.Vector3(0,0,1),.18).add(v(toe));
      const b=new T.Vector3(-.005,h,0).applyAxisAngle(new T.Vector3(0,0,1),.18).add(v(toe));
      bolt(cockpit,`${name} pedal face fixing ${h}`,a.toArray() as V,b.toArray() as V);
    }
    const springPoints:V[]=Array.from({length:121},(_,i)=>{const t=i/120;return [1.035+t*.068,.329+Math.cos(t*Math.PI*14)*.005,z+Math.sin(t*Math.PI*14)*.005];});
    line(cockpit,`${name} pedal return spring`,springPoints,.0008,mat.metal);
    cylinder(cockpit,`${name} pedal spring stem`,[1.014,.329,z],[1.115,.329,z],.0014,mat.darkMetal);
    for(const x of[1.033,1.103])cylinder(cockpit,`${name} pedal spring seat ${x}`,[x,.329,z],[x+.003,.329,z],.0062,mat.metal,.0015);
    box(cockpit,`${name} pedal spring stop`,[1.113,.310,z],[.009,.043,.018],mat.cast);
    if(name==="Brake"){
      cylinder(cockpit,"Brake balance bar",[1.014,.350,z-.032],[1.014,.350,z+.032],.0035,mat.metal);
      for(const s of[-1,1]){
        const zz=z+s*.025;
        cylinder(cockpit,`Brake master pushrod ${s}`,[1.014,.350,zz],[1.145,.350,zz],.003,mat.metal);
        cylinder(cockpit,`Brake master cylinder ${s}`,[1.11,.350,zz],[1.218,.350,zz],.012,mat.cast);
        cylinder(cockpit,`Brake master boot ${s}`,[1.092,.350,zz],[1.119,.350,zz],.007,mat.rubber);
        box(cockpit,`Brake master mounting flange ${s}`,[1.13,.335,zz],[.008,.080,.037],mat.darkMetal);
        for(const y of[.306,.366])bolt(cockpit,`Brake master fixing ${s}/${y}`,[1.122,y,zz],[1.137,y,zz]);
        cylinder(cockpit,`Brake fluid feed neck ${s}`,[1.18,.358,zz],[1.18,.379,zz],.004,mat.metal);
        cylinder(cockpit,`Brake fluid reservoir ${s}`,[1.18,.375,zz],[1.18,.414,zz],.015,mat.white);
        cylinder(cockpit,`Brake reservoir cap ${s}`,[1.18,.414,zz],[1.18,.419,zz],.016,mat.darkMetal);
        // Bulkhead unions delimit the pedal module; remote brake plumbing is separate.
        cylinder(cockpit,`Brake circuit outlet ${s}`,[1.218,.350,zz],[1.231,.350,zz],.005,mat.metal,.002);
      }
    }else{
      cylinder(cockpit,"Throttle position sensor",[1.02,.314,z+.030],[1.02,.314,z+.044],.012,mat.black);
      box(cockpit,"Throttle sensor connector",[1.034,.315,z+.039],[.018,.012,.009],mat.darkMetal);
      line(cockpit,"Throttle sensor lead",[[1.041,.315,z+.039],[1.06,.315,z+.039],[1.085,.30,.102],[1.19,.30,.102]],.0024,mat.black);
      box(cockpit,"Pedal loom connector",[1.198,.300,.102],[.020,.014,.014],mat.darkMetal);
      bolt(cockpit,"Pedal loom connector fixing",[1.198,.282,.102],[1.198,.308,.102]);
    }
    cockpit.userData[`${name.toLowerCase()}Pedal`] = {pivot,toe};
  }

  // Closed carbon wheel shell, proper hand openings, retained paddles and controls.
  const outline = new T.Shape();outline.moveTo(-.102,-.067);outline.lineTo(-.132,-.040);outline.quadraticCurveTo(-.151,.008,-.133,.045);outline.quadraticCurveTo(-.124,.067,-.093,.064);outline.lineTo(.093,.064);outline.quadraticCurveTo(.124,.067,.133,.045);outline.quadraticCurveTo(.151,.008,.132,-.040);outline.lineTo(.102,-.067);outline.lineTo(.065,-.055);outline.lineTo(-.065,-.055);outline.closePath();
  for(const s of[-1,1]){
    const hole=new T.Path();hole.moveTo(s*.094,-.030);hole.lineTo(s*.108,-.034);hole.quadraticCurveTo(s*.128,0,s*.116,.034);hole.lineTo(s*.095,.034);hole.closePath();outline.holes.push(hole);
  }
  const wg=new T.ExtrudeGeometry(outline,{depth:.022,bevelEnabled:true,bevelSize:.002,bevelThickness:.002,bevelSegments:3,curveSegments:16});wg.rotateY(Math.PI/2);
  add(wheel,"Steering wheel carbon face",wg,mat.carbon).position.set(.492,.527,0);
  for(const s of[-1,1]){
    line(wheel,`Wheel grip ${s}`,[[.503,.575,s*.124],[.501,.549,s*.138],[.501,.514,s*.138],[.503,.482,s*.118]],.012,mat.rubber);
    for(const [label,y,z,w,h]of[["Gearshift",.542,s*.104,.040,.060],["Clutch",.486,s*.081,.060,.029]] as const){
      box(wheel,`${label} paddle ${s}`,[.537,y,z],[.004,h,w],mat.carbon,.003);
      box(wheel,`${label} paddle hinge mount ${s}`,[.520,y,s*.061],[.018,.019,.017],mat.darkMetal);
      cylinder(wheel,`${label} paddle pivot ${s}`,[.528,y-.011,s*.061],[.528,y+.011,s*.061],.002,mat.metal);
      cylinder(wheel,`${label} paddle arm ${s}`,[.528,y,s*.061],[.537,y,z],.004,mat.darkMetal);
      cylinder(wheel,`${label} paddle return ${s}`,[.515,y,z],[.535,y,z],.003,mat.metal);
    }
    for(let i=0;i<4;i++){
      const y=.570-i*.025,z=s*(i%2?.081:.073);
      cylinder(wheel,`Steering button guard ${s} ${i}`,[.487,y,z],[.481,y,z],.0085,mat.darkMetal,.0062);
      cylinder(wheel,`Steering button ${s} ${i}`,[.487,y,z],[.477,y,z],.0058,[mat.red,mat.white,mat.orange,mat.white][i]);
    }
    cylinder(wheel,`Wheel thumb encoder ${s}`,[.485,.537,s*.098],[.475,.537,s*.098],.009,mat.darkMetal);
    const teeth=Array.from({length:20},(_,i)=>{
      const a=i*Math.PI/10;
      return new T.BoxGeometry(.008,.0014,.0015).rotateX(a).translate(.480,.537+Math.cos(a)*.009,s*.098+Math.sin(a)*.009);
    });
    add(wheel,`Wheel thumb encoder knurl ${s}`,mergeGeometries(teeth)!,mat.darkMetal);teeth.forEach(g=>g.dispose());
  }
  const rect=(w:number,h:number)=>new T.Shape([new T.Vector2(-w/2,-h/2),new T.Vector2(w/2,-h/2),new T.Vector2(w/2,h/2),new T.Vector2(-w/2,h/2)]);
  const bezel=rect(.100,.049);bezel.holes.push(new T.Path(rect(.087,.038).getPoints().reverse()));
  const bezelGeo=new T.ExtrudeGeometry(bezel,{depth:.008,bevelEnabled:true,bevelSize:.001,bevelThickness:.001,bevelSegments:2});bezelGeo.rotateY(-Math.PI/2);
  add(wheel,"Steering screen bezel",bezelGeo,mat.darkMetal).position.set(.491,.556,0);
  box(wheel,"Steering display",[.485,.556,0],[.002,.037,.086],mat.black);
  const text=(name:string,label:string,p:V,height:number,material=mat.white)=>{
    const glyphs=lettering.glyphs as Record<string,{advance:number;path:string}>,path=new T.ShapePath();let offset=0;
    for(const ch of label){const glyph=glyphs[ch];if(!glyph)continue;const tokens=glyph.path.match(/[MLQCZ]|-?\d+(?:\.\d+)?/g)!;let i=0;
      const x=()=>Number(tokens[i++])+offset,y=()=>Number(tokens[i++]);
      while(i<tokens.length){const cmd=tokens[i++];if(cmd==="M")path.moveTo(x(),y());else if(cmd==="L")path.lineTo(x(),y());else if(cmd==="Q")path.quadraticCurveTo(x(),y(),x(),y());else if(cmd==="C")path.bezierCurveTo(x(),y(),x(),y(),x(),y());else if(cmd==="Z")path.currentPath?.closePath();}
      offset+=glyph.advance;
    }
    const g=new T.ShapeGeometry(path.toShapes(),4);g.translate(-offset/2,0,0);g.scale(height/lettering.capHeight,height/lettering.capHeight,1);g.rotateY(-Math.PI/2);
    add(wheel,name,g,material).position.set(...p);
  };
  text("Wheel display neutral indication","N",[.4838,.547,0],.019);
  for(const s of[-1,1]){
    text(`Wheel radio pit legend ${s}`,s<0?"RAD":"PIT",[.489,.582,s*.073],.0034);
    text(`Wheel paddle legend ${s}`,s<0?"-":"+",[.489,.505,s*.119],.007);
  }
  for(const [label,z]of[["BB",-.043],["MODE",0],["DIFF",.043]] as const){
    cylinder(wheel,`Rotary selector ${label}`,[.490,.502,z],[.478,.502,z],.012,mat.darkMetal);
    const teeth=Array.from({length:24},(_,i)=>{
      const a=i*Math.PI/12;
      return new T.BoxGeometry(.009,.0016,.0015).rotateX(a).translate(.484,.502+Math.cos(a)*.012,z+Math.sin(a)*.012);
    });
    add(wheel,`Rotary selector knurl ${label}`,mergeGeometries(teeth)!,mat.darkMetal);teeth.forEach(g=>g.dispose());
    box(wheel,`Rotary pointer ${label}`,[.4765,.506,z],[.002,.010,.002],mat.white);
    for(let i=0;i<10;i++){const a=i*Math.PI*2/10;box(wheel,`Rotary detent ${label} ${i}`,[.488,.502+Math.cos(a)*.016,z+Math.sin(a)*.016],[.001,.002,.0015],mat.white);}
    text(`Rotary legend ${label}`,label,[.489,.476,z],.0037);
  }
  for(let i=0;i<15;i++){
    box(wheel,`Shift LED socket ${i}`,[.487,.588,-.049+i*.007],[.005,.005,.005],mat.darkMetal);
    box(wheel,`Shift LED ${i}`,[.4835,.588,-.049+i*.007],[.002,.003,.0035],i<5?mat.white:i<10?mat.orange:mat.red);
  }
  for(const y of[.469,.585])for(const z of[-.057,.057])bolt(wheel,`Wheel face fastener ${y}/${z}`,[.512,y,z],[.487,y,z],.0018);
  cylinder(wheel,"Wheel rear electronics cover",[.515,.527,0],[.526,.527,0],.039,mat.darkMetal);
  cylinder(wheel,"Quick release boss",[.520,.527,0],[.568,.515,0],.026,mat.metal);
  const releaseStart=v([.520,.527,0]),releaseAxis=v([.568,.515,0]).sub(releaseStart).normalize();
  const releasePoint=(t:number)=>releaseStart.clone().addScaledVector(releaseAxis,t).toArray() as V;
  cylinder(wheel,"Quick release locking collar",releasePoint(.024),releasePoint(.035),.030,mat.darkMetal,.026);
  cylinder(wheel,"Quick release retaining ring",releasePoint(.036),releasePoint(.038),.027,mat.metal,.024);
  const collarFrame=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),releaseAxis);
  const ribs=Array.from({length:24},(_,i)=>{
    const a=i*Math.PI/12;
    return new T.BoxGeometry(.002,.009,.002).rotateY(-a).translate(Math.cos(a)*.030,.0295,Math.sin(a)*.030).applyQuaternion(collarFrame).translate(...releaseStart.toArray());
  });
  add(wheel,"Quick release collar grip",mergeGeometries(ribs)!,mat.darkMetal);ribs.forEach(g=>g.dispose());
  for(let i=0;i<6;i++){const a=i*Math.PI/3;bolt(wheel,`Wheel boss fastener ${i}`,[.514,.527+Math.cos(a)*.033,Math.sin(a)*.033],[.527,.527+Math.cos(a)*.033,Math.sin(a)*.033],.0021);}
  return {cockpit,wheel};
}

export function seatPedalMounts(car:T.Group,cockpit:T.Group,mat:Materials){
  car.updateMatrixWorld(true);
  const cell=car.getObjectByName("Forward survival cell deck") as T.Mesh,surface=createSurfaceSampler([cell],"y");
  for(const x of[.91,1.24])for(const z of[-.116,.116]){
    const y=surface(x,z,-1);if(y===undefined)throw new Error("Missing pedal mounting surface");
    const part=new T.Mesh(new RoundedBoxGeometry(.026,.286-y,.022,2,.001),mat.cast);
    part.name=`Pedal chassis mount ${x}/${z}`;part.position.set(x,(.284+y)/2,z);part.userData={component:"cockpit",cockpitSection:"pedals",internal:true,seat:[x,y,z]};cockpit.add(part);
  }
}
