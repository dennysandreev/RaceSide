import * as T from "three";
import { createSurfaceSampler } from "./w17-surface.ts";
import { openRadialPort } from "./w17-wastegate.ts";
import { servicePassage } from "./w17-feedthrough.ts";

type V = [number, number, number];
type Materials = Record<"carbon" | "metal" | "darkMetal" | "black" | "rubber" | "white" | "red", T.Material>;

// Cut before laminate construction so each opening receives the same closed
// edge return as the airbox and exhaust apertures.
export function prepareFireBodyPorts(skin:T.Mesh) {
  skin.updateMatrixWorld(true);
  const surface=createSurfaceSampler([skin],"z");
  const external=[surface(-.180,.700,-1)!,surface(-.180,.700,1)!];
  for(const side of[-1,1])openRadialPort(skin,[-.180,.700],.008,side,0,false);
  openRadialPort(skin,[.160,.480],.0085,1,-.270,false,.090);
  return external;
}

// Cockpit-only architecture follows FIA C14.1 and Lifeline TB086. The bottle
// envelope, mounting tray and installed coordinates are a reconstruction;
// no Mercedes supplier, capacity or homologation is asserted by this model.
export function createFireSystem(car: T.Group, mat: Materials) {
  const root = new T.Group(); root.name = "Cockpit fire suppression assembly";
  const x = .410, y = .214, radius = .026;
  const add = (name: string, geometry: T.BufferGeometry, material = mat.metal, mount = false) => {
    const part = new T.Mesh(geometry, material); part.name = name;
    part.userData = { component: "safety", internal: true, fireSystem: true, fireMount: mount };
    part.castShadow = part.receiveShadow = true; root.add(part); return part;
  };
  const ring = (name: string, a: V, b: V, inner: number, outer: number, material = mat.metal, mount = false) => {
    const start = new T.Vector3(...a), axis = new T.Vector3(...b).sub(start);
    const profile = [[inner,0],[outer,0],[outer,axis.length()],[inner,axis.length()],[inner,0]].map(p=>new T.Vector2(...p));
    const part = add(name,new T.LatheGeometry(profile,40),material,mount);
    part.position.copy(start);part.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),axis.normalize());return part;
  };
  const box = (name: string, p: V, size: V, material = mat.darkMetal, mount = false) => {
    const part=add(name,new T.BoxGeometry(...size),material,mount);part.position.set(...p);return part;
  };
  const tube = (name: string, curve: T.Curve<T.Vector3>, outer: number, inner: number, material: T.Material) => {
    const outside=new T.TubeGeometry(curve,96,outer,12,false),inside=new T.TubeGeometry(curve,96,inner,12,false);
    const p=outside.attributes.position,q=inside.attributes.position,count=p.count,positions=[...p.array,...q.array],index=Array.from(outside.index!.array);
    for(let i=0;i<inside.index!.count;i+=3)index.push(count+inside.index!.getX(i),count+inside.index!.getX(i+2),count+inside.index!.getX(i+1));
    for(const row of[0,96])for(let j=0;j<12;j++){
      const a=row*13+j,b=a+1;
      if(row)index.push(a,b,a+count,b,b+count,a+count);else index.push(a,a+count,b,b,a+count,b+count);
    }
    const g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(positions,3));g.setIndex(index);g.computeVertexNormals();
    const part=add(name,g,material);part.userData.route=curve.getSpacedPoints(96).map(p=>p.toArray());part.userData.outerRadius=outer;
    outside.dispose();inside.dispose();return part;
  };

  // A slim transverse cylinder occupies the measured free volume above the
  // ES, below the seat. Both domed ends and the firing head are inside the tub.
  const profile=[[.008,-.087],[.010,-.087],[.020,-.083],[radius,-.074],[radius,.112],[.023,.124],[.014,.131],[0,.134],[0,.132],[.013,.129],[.021,.122],[.024,.112],[.024,-.073],[.018,-.081],[.008,-.085],[.008,-.087]].map(p=>new T.Vector2(...p));
  const bottle=add("Fire extinguisher",new T.LatheGeometry(profile,64),mat.carbon);
  bottle.position.set(x,y,0);bottle.rotation.x=Math.PI/2;
  ring("Fire bottle neck",[x,y,-.086],[x,y,-.096],.004,.014);
  ring("Fire bottle end flange",[x,y,-.092],[x,y,-.100],.004,.024);
  ring("Fire firing head",[x,y,-.098],[x,y,-.141],.004,.016,mat.darkMetal);
  ring("Fire outlet socket",[x,y,-.137],[x,y,-.142],.004,.008);
  for(const a of[0,Math.PI/2,Math.PI,Math.PI*1.5]){
    const px=x+Math.cos(a)*.020,py=y+Math.sin(a)*.020;
    ring(`Fire head flange bolt ${a}`,[px,py,-.100],[px,py,-.104],.001,.0026);
  }
  // Rear pressure-relief opening remains exposed; neither strap covers it.
  ring("Fire bottle relief outlet",[x,y,.130],[x,y,.138],.002,.004,mat.darkMetal);
  ring("Fire firing connector",[x+.011,y,-.120],[x+.024,y,-.120],.0025,.005,mat.black);
  box("Fire firing connector insert",[x+.024,y,-.120],[.001,.004,.004],mat.rubber);
  ring("Fire pressure gauge stem",[x+.012,y,-.105],[x+.027,y,-.105],.001,.004);
  ring("Fire pressure gauge bezel",[x+.025,y,-.105],[x+.035,y,-.105],.0075,.009);
  ring("Fire pressure gauge dial",[x+.033,y,-.105],[x+.034,y,-.105],0,.0075,mat.white);
  box("Fire pressure gauge needle",[x+.0344,y+.001,-.106],[.0005,.008,.0007],mat.black);
  for(let i=0;i<7;i++){
    const angle=-Math.PI*.75+i*Math.PI/4;
    ring(`Fire pressure gauge tick ${i}`,[x+.0342,y+Math.cos(angle)*.006,-.105+Math.sin(angle)*.006],[x+.0345,y+Math.cos(angle)*.006,-.105+Math.sin(angle)*.006],0,.0004,mat.black);
  }

  car.updateMatrixWorld(true);
  const structuralFloor=["Survival cell lower shell","Lower chassis enclosure","Central floor-to-chassis fairing"].map(name=>car.getObjectByName(name) as T.Mesh);
  const floor=createSurfaceSampler(structuralFloor,"y");
  const tray=box("Fire bottle mounting tray",[x,.185,0],[.052,.003,.340],mat.carbon,true);
  tray.userData.mounts=[];
  for(const side of[-1,1]){
    const z=side*.164,height=floor(x,z,1)!;
    tray.userData.mounts.push([x,height,z]);
    ring(`Fire tray floor pillar ${side}`,[x,height-.001,z],[x,.186,z],.002,.005,mat.darkMetal,true);
    ring(`Fire tray floor fixing ${side}`,[x,height-.003,z],[x,.190,z],.001,.0025,mat.metal,true);
  }
  for(const z of[-.048,.080]){
    ring(`Fire bottle retaining strap ${z}`,[x,y,z-.006],[x,y,z+.006],radius,radius+.0015,mat.darkMetal,true);
    box(`Fire bottle saddle ${z}`,[x,.1875,z],[.018,.004,.016],mat.rubber,true);
    box(`Fire strap tab ${z}`,[x+.018,.191,z],[.014,.008,.014],mat.darkMetal,true);
    ring(`Fire strap fixing ${z}`,[x+.020,.182,z],[x+.020,.195,z],.001,.0025,mat.metal,true);
  }

  // The smooth 90-degree outlet turns into a heat-sleeved cockpit line.
  const quarter=.5522847498;
  const elbow=new T.CubicBezierCurve3(new T.Vector3(x,y,-.142),new T.Vector3(x,y,-.142-.022*quarter),new T.Vector3(x,.236-.022*quarter,-.164),new T.Vector3(x,.236,-.164));
  tube("Fire outlet elbow",elbow,.006,.004,mat.metal);
  const route=new T.CurvePath<T.Vector3>();
  route.add(new T.CubicBezierCurve3(new T.Vector3(x,.236,-.164),new T.Vector3(x,.300,-.164),new T.Vector3(.350,.380,-.180),new T.Vector3(.290,.380,-.180)));
  route.add(new T.CubicBezierCurve3(new T.Vector3(.290,.380,-.180),new T.Vector3(.290-.024*quarter,.380,-.180),new T.Vector3(.266,.380,-.156-.024*quarter),new T.Vector3(.266,.380,-.156)));
  tube("Fire cockpit discharge line",route,.0048,.003,mat.black);
  ring("Fire nozzle socket",[.266,.380,-.163],[.266,.380,-.149],.004,.008);
  ring("Fire cockpit nozzle",[.266,.380,-.149],[.266,.380,-.131],.002,.006,mat.metal);
  const nozzle=car.getObjectByName("Cockpit inner lining -1") as T.Mesh;
  const lining=createSurfaceSampler([nozzle],"z");
  for(const [i,t]of[.25,.65].entries()){
    const p=route.getPointAt(t),axis=route.getTangentAt(t).normalize(),wall=lining(p.x,p.y,1)!;
    ring(`Fire line clip ${i}`,p.clone().addScaledVector(axis,-.004).toArray() as V,p.clone().addScaledVector(axis,.004).toArray() as V,.0048,.0065,mat.metal,true);
    box(`Fire line clip foot ${i}`,[p.x,p.y,wall],[.016,.016,.003],mat.darkMetal,true);
    ring(`Fire line clip stand ${i}`,[p.x,p.y,wall],[p.x,p.y,p.z-.005],.001,.0025,mat.darkMetal,true);
    ring(`Fire line clip fixing ${i}`,[p.x,p.y,wall-.005],[p.x,p.y,wall+.003],.001,.0025,mat.metal,true);
  }
  const nozzleWall=lining(.266,.380,1)!;
  const bracket=new T.Shape();bracket.moveTo(-.018,-.012);bracket.lineTo(.018,-.012);bracket.lineTo(.018,.012);bracket.lineTo(-.018,.012);bracket.closePath();
  const hole=new T.Path();hole.absarc(0,0,.007,0,Math.PI*2,true);bracket.holes.push(hole);
  const plate=new T.ExtrudeGeometry(bracket,{depth:.003,bevelEnabled:false,curveSegments:20});plate.translate(.266,.380,-.154);
  add("Fire nozzle mounting plate",plate,mat.darkMetal,true);
  for(const dx of[-.014,.014]){
    box(`Fire nozzle bracket foot ${dx}`,[.266+dx,.380,(nozzleWall-.153)/2],[.006,.020,-.153-nozzleWall+.003],mat.darkMetal,true);
    ring(`Fire nozzle bracket fixing ${dx}`,[.266+dx,.380,nozzleWall-.005],[.266+dx,.380,nozzleWall+.003],.001,.0025,mat.metal,true);
  }
  root.userData.ports={discharge:[x,y,-.142],nozzle:[.266,.380,-.131],trigger:[x+.024,y,-.120]};

  // An independent battery and contact circuit serve the firing head. The
  // public TB086 reference uses a 9 V source; this is not a W17 wiring diagram.
  const cx=.440,cy=.435,cz=-.170;
  const control=(part:T.Mesh)=>{part.userData.fireControl=true;return part;};
  const housing=new T.Shape([new T.Vector2(-.035,-.041),new T.Vector2(.035,-.041),new T.Vector2(.035,.041),new T.Vector2(-.035,.041)]);
  housing.holes.push(new T.Path([new T.Vector2(-.033,-.039),new T.Vector2(-.033,.039),new T.Vector2(.033,.039),new T.Vector2(.033,-.039)]));
  const caseGeo=new T.ExtrudeGeometry(housing,{depth:.024,bevelEnabled:false});caseGeo.translate(cx,cy,cz-.012);
  const caseWall=control(add("Fire control enclosure walls",caseGeo,mat.darkMetal));
  caseWall.geometry.rotateX(-Math.PI/2);
  for(const xx of[cx-.019,cx+.019])openRadialPort(caseWall,[xx,cz],.0046,-1,-.450);
  openRadialPort(caseWall,[cx,cz],.0046,1,-.420);
  caseWall.geometry.rotateX(Math.PI/2);
  control(box("Fire control enclosure back",[cx,cy,cz-.011],[.066,.078,.002],mat.darkMetal));
  const front=control(box("Fire control enclosure lid",[cx,cy,cz+.011],[.070,.082,.002],mat.carbon));front.userData.serviceCover=true;
  for(const [xx,r]of[[cx-.014,.0072],[cx+.014,.0052]]){
    const old=front.geometry,next=servicePassage(old,Array.from({length:24},(_,i)=>new T.Vector2(xx-cx+Math.cos(i*Math.PI/12)*r,.456-cy+Math.sin(i*Math.PI/12)*r)));
    front.geometry=next;old.dispose();
  }
  control(box("Fire independent battery",[cx,.418,cz],[.048,.026,.017],mat.black));
  control(box("Fire battery cradle",[cx,.403,cz-.001],[.052,.003,.022],mat.darkMetal));
  control(box("Fire battery retainer",[cx,.418,cz+.009],[.012,.030,.002],mat.darkMetal));
  control(box("Fire contact carrier",[cx,.455,cz-.008],[.055,.029,.003],mat.black));
  for(const [i,xx]of[cx-.013,cx+.013].entries()){
    control(ring(`Fire battery terminal ${i}`,[xx,.431,cz],[xx,.435,cz],.0006,.002));
    control(box(`Fire contact terminal ${i}`,[xx,.443,cz-.004],[.006,.004,.004],mat.metal));
    const wire=new T.CubicBezierCurve3(new T.Vector3(xx,.434,cz),new T.Vector3(xx,.438,cz),new T.Vector3(xx,.439,cz-.004),new T.Vector3(xx,.443,cz-.004));
    control(tube(`Fire battery lead ${i}`,wire,.0008,.0003,i?mat.black:mat.red));
  }
  for(const sign of[-1,1]){
    const z=cz+sign*.0012;
    const points=[[sign===1?cx-.014:cx-.013,sign===1?.452:.443,cz-.004],[.469+sign*.0012,.443,z],[.469+sign*.0012,.399,z],[cx,.399,z],[cx,.394,z]].map(p=>new T.Vector3(...p));
    control(tube(`Fire control output conductor ${sign}`,new T.CatmullRomCurve3(points,false,"centripetal"),.0007,.00025,sign===1?mat.red:mat.black));
    for(const xx of[cx-.019,cx+.019]){
      const points=[[xx,.476,z],[xx,.470,z],[xx,.466,cz-.003],[cx+sign*.014,.456,cz-.003]].map(p=>new T.Vector3(...p));
      control(tube(`Fire trigger contact lead ${xx}/${sign}`,new T.CatmullRomCurve3(points,false,"centripetal"),.0007,.00025,mat.black));
    }
  }
  // The local button and both remote pairs act on the dedicated contact strip;
  // its return is insulated from the casing and the car's electrical ground.
  for(const xx of[cx-.013,cx+.013])control(box(`Fire insulated terminal ${xx}`,[xx,.446,cz-.005],[.006,.006,.002],mat.metal));
  for(const xx of[cx-.014,cx+.014])control(box(`Fire switch terminal ${xx}`,[xx,.452,cz-.004],[.003,.008,.003],mat.metal));
  control(tube("Fire armed driver supply",new T.CubicBezierCurve3(new T.Vector3(cx+.014,.456,cz-.003),new T.Vector3(cx+.014,.464,cz-.003),new T.Vector3(cx-.014,.464,cz-.003),new T.Vector3(cx-.014,.456,cz-.003)),.0007,.00025,mat.red));
  for(const xx of[cx-.030,cx+.030])for(const yy of[cy-.035,cy+.035]){
    const wall=lining(xx,yy,1)!;
    control(ring(`Fire control mount ${xx}/${yy}`,[xx,yy,wall-.002],[xx,yy,cz-.010],.0015,.004,mat.darkMetal,true)).userData.mountSurface="Cockpit inner lining -1";
    control(ring(`Fire control fixing ${xx}/${yy}`,[xx,yy,wall-.003],[xx,yy,cz+.014],.001,.0025,mat.metal,true)).userData.mountSurface="Cockpit inner lining -1";
  }
  control(ring("Fire driver switch body",[cx-.014,.456,cz-.006],[cx-.014,.456,cz+.012],.001,.007,mat.darkMetal));
  control(ring("Fire driver button guard",[cx-.014,.456,cz+.012],[cx-.014,.456,cz+.018],.006,.009,mat.metal));
  control(ring("Fire driver activation button",[cx-.014,.456,cz+.012],[cx-.014,.456,cz+.017],0,.0055,mat.red));
  control(ring("Fire arming switch body",[cx+.014,.456,cz-.006],[cx+.014,.456,cz+.013],.001,.005,mat.darkMetal));
  control(ring("Fire arming lever",[cx+.014,.456,cz+.013],[cx+.014,.462,cz+.022],0,.0017,mat.metal));
  for(const dx of[-.005,.005])control(box(`Fire arming guard ${dx}`,[cx+.014+dx,.456,cz+.017],[.002,.015,.012],mat.darkMetal));
  // The three external plugs are two trigger loops and the independent output.
  const ports={output:[cx,.386,cz] as V,left:[cx-.019,.484,cz] as V,right:[cx+.019,.484,cz] as V};
  for(const [name,p]of Object.entries(ports)){
    const sign=name==="output"?-1:1;
    control(ring(`Fire control socket ${name}`,[p[0],p[1]-sign*.011,p[2]],p,.0022,.0045,mat.darkMetal));
    control(ring(`Fire control plug ${name}`,p,[p[0],p[1]+sign*.004,p[2]],.0016,.004,mat.metal));
  }
  const wire=(name:string,points:V[])=>{
    const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)),false,"centripetal");
    const cable=control(tube(name,curve,.0018,.0008,mat.black));cable.userData.fireCircuit="independent";return {curve,cable};
  };
  const output=wire("Fire firing-head cable",[[cx,.382,cz],[cx,.368,cz],[.370,.365,-.176],...[.60,.45,.30,.15,0].map(t=>route.getPointAt(t).add(new T.Vector3(-.002,.010,-.006)).toArray() as V),[.408,.225,-.177],[.410,.212,-.177],[.428,.208,-.153],[.441,.212,-.130],[.448,.232,-.120],[.448,.222,-.120]]);
  control(ring("Fire firing-head plug",[.433,.214,-.120],[.440,.214,-.120],.0018,.0055,mat.darkMetal));
  const rearRoutes:{curve:T.CatmullRomCurve3;cable:T.Mesh}[]=[];
  const plugElbow=new T.CubicBezierCurve3(new T.Vector3(.440,.214,-.120),new T.Vector3(.440+.008*quarter,.214,-.120),new T.Vector3(.448,.222-.008*quarter,-.120),new T.Vector3(.448,.222,-.120));
  control(tube("Fire firing-head angled backshell",plugElbow,.004,.0018,mat.rubber));
  // Run around the outside of the fuel compartment. A sealed transverse
  // passage through the cockpit side avoids crossing the fuel bladder.
  const passageX=.160,passageY=.480;
  for(const name of["Cockpit inner lining -1","Cockpit side -1"]){
    const panel=car.getObjectByName(name) as T.Mesh;
    const surface=createSurfaceSampler([panel],"z"),a=surface(passageX,passageY,1)!,b=surface(passageX,passageY,-1)!;
    openRadialPort(panel,[passageX,passageY],.007,-1);
    control(ring(`Fire trigger passage ${name}`,[passageX,passageY,a+.001],[passageX,passageY,b-.001],.0055,.0065,mat.rubber,true)).userData.mountSurface=name;
  }

  const outer=car.getObjectByName("Continuous undercut sidepod shell") as T.Mesh;
  const bodySide=createSurfaceSampler([outer],"z");
  control(ring("Fire inner body passage sleeve",[passageX,passageY,-.212],[passageX,passageY,-.225],.0055,.0065,mat.rubber,true));
  const extPorts:V[]=[];
  for(const side of[-1,1] as const){
    const hx=-.180,hy=.700,skin=outer.userData.firePortSides[side===-1?0:1] as number;
    const z=side*(Math.min(...[-.014,.014].flatMap(dx=>[-.011,.011].map(dy=>side*bodySide(hx+dx,hy+dy,side)!)))-.021);
    const contact=control(box(`Fire external dual switch ${side}`,[hx,hy,z],[.026,.020,.020],mat.darkMetal));contact.userData.dualContact=true;
    control(ring(`Fire external plunger ${side}`,[hx,hy,z],[hx,hy,skin+side*.012],.001,.003,mat.metal)).userData.externalFire=true;
    const seal=control(ring(`Fire external panel seal ${side}`,[hx,hy,skin-side*.007],[hx,hy,skin+side*.002],.0032,.0058,mat.rubber,true));seal.userData.externalFire=true;
    const collarGeo=new T.RingGeometry(.0082,.011,32,2);
    const cp=collarGeo.attributes.position;
    for(let i=0;i<cp.count;i++){const xx=hx+cp.getX(i),yy=hy+cp.getY(i);cp.setXYZ(i,xx,yy,bodySide(xx,yy,side)!+side*.0007);}
    if(side===-1){const ix=collarGeo.index!;for(let i=0;i<ix.count;i+=3){const b=ix.getX(i+1);ix.setX(i+1,ix.getX(i+2));ix.setX(i+2,b);}}collarGeo.computeVertexNormals();
    const collar=control(add(`Fire external collar ${side}`,collarGeo,mat.darkMetal,true));collar.userData.externalFire=true;
    const handle=control(ring(`Fire external pull ring ${side}`,[hx,hy-.0015,skin+side*.032],[hx,hy+.0015,skin+side*.032],.020,.023,mat.red));handle.userData.externalFire=true;
    const stem=control(ring(`Fire external pull neck ${side}`,[hx,hy,skin+side*.010],[hx,hy,skin+side*.013],0,.004,mat.red));stem.userData.externalFire=true;
    // The switch carrier reaches the roll-hoop blade, not only its cover.
    const hoop=car.getObjectByName(`Roll hoop ${side}`) as T.Mesh;
    const anchor=createSurfaceSampler([hoop],"z")(hx,hy,side)!;
    const carrier=control(box(`Fire external switch carrier ${side}`,[hx,hy-.006,(anchor+z)/2],[.018,.005,Math.abs(z-anchor)+.008],mat.carbon,true));carrier.userData.mountSurface=hoop.name;
    const fixing=control(ring(`Fire external carrier fixing ${side}`,[hx,hy-.006,anchor-side*.004],[hx,hy-.006,anchor+side*.005],.001,.0025,mat.metal,true));fixing.userData.mountSurface=hoop.name;
    const p:V=[hx,hy-.017,z];extPorts.push(p);
    control(ring(`Fire external switch socket ${side}`,[hx,hy-.008,z],p,.0018,.0038,mat.darkMetal));
    const shift=side*.0022;
    const start=side===-1?ports.left:ports.right;
    const route:V[]=[[start[0],.488,cz],[start[0],.505+shift,cz],[.35,.500+shift,-.171],[.210,.480+shift,-.156],[.175,.480+shift,-.160],[.160,.480+shift,-.170],[.160,.480+shift,-.180],[.160,.480+shift,-.195],[.160,.480+shift,-.230],[.160,.480+shift,-.278],[.145,.480+shift,-.292],[.08,.500+shift,-.294],[-.06,.540+shift,-.290],[-.140,.600+shift,-.230]];
    if(side===1)route.push([-.130,.625,-.190],[-.130,.635,0],[-.130,.625,.190]);
    route.push([-.160,.640,side*.195],[hx,.665,z],p);
    rearRoutes.push(wire(`Fire external trigger cable ${side}`,route));
  }
  const sidePanel=car.getObjectByName("Cockpit side -1") as T.Mesh;
  const sideWall=createSurfaceSampler([sidePanel],"z")(.080,.500,-1)!;
  const sharedCentre=new T.Vector3(.080,.500,-.294),sharedAxis=new T.Vector3(-1,.28,0).normalize();
  control(ring("Fire remote pair retaining clip",sharedCentre.clone().addScaledVector(sharedAxis,-.004).toArray() as V,sharedCentre.clone().addScaledVector(sharedAxis,.004).toArray() as V,.0045,.006,mat.darkMetal,true));
  control(box("Fire remote pair clip foot",[.080,.500,(sideWall-.289)/2],[.014,.006,Math.abs(sideWall+.289)+.003],mat.darkMetal,true)).userData.mountSurface=sidePanel.name;
  control(ring("Fire remote pair clip fixing",[.080,.500,sideWall-.003],[.080,.500,sideWall+.003],.001,.0025,mat.metal,true)).userData.mountSurface=sidePanel.name;
  // Local service loops terminate in connector backshells. Small retained
  // clips attach the cockpit runs to the installed inner lining.
  for(const [label,route,ts]of[["output",output,[.12,.25]],["left",rearRoutes[0],[.14,.25]],["right",rearRoutes[1],[.10,.18]]] as const){
    for(const [i,t]of ts.entries()){
      const p=route.curve.getPoint(t),axis=route.curve.getTangent(t),wall=lining(p.x,p.y,1)!;
      const clip=control(ring(`Fire cable clip ${label}/${i}`,p.clone().addScaledVector(axis,-.003).toArray() as V,p.clone().addScaledVector(axis,.003).toArray() as V,.0018,.003,mat.darkMetal,true));clip.userData.mountSurface="Cockpit inner lining -1";
      const foot=control(box(`Fire cable clip foot ${label}/${i}`,[p.x,p.y,(wall+p.z-.002)/2],[.009,.004,p.z-.002-wall],mat.darkMetal,true));foot.userData.mountSurface="Cockpit inner lining -1";
      const bolt=control(ring(`Fire cable clip bolt ${label}/${i}`,[p.x,p.y,wall-.003],[p.x,p.y,wall+.003],.0006,.0018,mat.metal,true));bolt.userData.mountSurface="Cockpit inner lining -1";
    }
  }
  root.userData.fireActivation={independent:true,voltageReference:9,driver:[cx-.014,.456,cz+.017],battery:"Fire independent battery",output:ports.output,external:extPorts};
  return root;
}
