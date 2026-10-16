import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

type V = [number, number, number];
type Materials = Record<"metal"|"cast"|"darkMetal"|"black"|"orange"|"bronze"|"white"|"rubber",T.Material>;
export const ENERGY_STORE_POSITION: V = [.46,.096,0];

// FIA C5.17.7 puts the CU-K and HV protection inside the ES main enclosure.
// Cell format/count, module topology and dimensions below are an educational
// reconstruction, not a disclosed Mercedes battery design or capacity claim.
export function createEnergyStore(mat: Materials) {
  const battery=new T.Group(),inverter=new T.Group();
  battery.name="ES main enclosure assembly";inverter.name="CU-K inverter cartridge";
  battery.position.set(...ENERGY_STORE_POSITION);inverter.position.copy(battery.position);
  const ports:Record<string,V>={power:[-.322,.049,.088],coolantIn:[-.322,.024,-.100],coolantOut:[-.322,.024,-.055]};
  const add=(name:string,g:T.BufferGeometry,m:T.Material,parent=battery,cover=false)=>{
    const p=new T.Mesh(g,m);p.name=name;p.userData={component:parent===inverter?"inverter":"battery",internal:true,serviceCover:cover};
    p.castShadow=true;p.receiveShadow=true;parent.add(p);return p;
  };
  const box=(name:string,p:V,size:V,m:T.Material,parent=battery,cover=false)=>{
    const part=add(name,new RoundedBoxGeometry(...size,2,Math.min(.002,...size.map(v=>v/5))),m,parent,cover);part.position.set(...p);return part;
  };
  const ring=(name:string,a:V,b:V,inner:number,outer:number,m:T.Material,parent=battery,cover=false)=>{
    const direction=new T.Vector3(...b).sub(new T.Vector3(...a));
    const g=new T.LatheGeometry([[inner,0],[outer,0],[outer,direction.length()],[inner,direction.length()],[inner,0]].map(([x,y])=>new T.Vector2(x,y)),32);
    const part=add(name,g,m,parent,cover);part.position.set(...a);part.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),direction.normalize());return part;
  };
  const wire=(name:string,route:V[],radius:number,m:T.Material,parent=battery)=>{
    const g=new T.TubeGeometry(new T.CatmullRomCurve3(route.map(p=>new T.Vector3(...p)),false,"centripetal"),Math.max(20,route.length*10),radius,8,false);
    return add(name,g,m,parent);
  };
  const screw=(name:string,p:V,parent=battery,cover=false)=>{
    ring(`${name} washer`,[p[0],p[1]-.001,p[2]],[p[0],p[1]+.0005,p[2]],.0013,.0032,mat.darkMetal,parent,cover);
    return ring(name,[p[0],p[1],p[2]],[p[0],p[1]+.002,p[2]],.001,.0024,mat.metal,parent,cover);
  };
  const rectangle=(x0:number,x1:number,z0:number,z1:number)=>new T.Shape([new T.Vector2(x0,z0),new T.Vector2(x1,z0),new T.Vector2(x1,z1),new T.Vector2(x0,z1)]);
  const plate=(name:string,shape:T.Shape,y:number,depth:number,m:T.Material,parent=battery,cover=false)=>{
    const g=new T.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:16});g.rotateX(-Math.PI/2);g.translate(0,y,0);return add(name,g,m,parent,cover);
  };
  // Closed lower tray, drilled connector bulkhead, removable gasketed lid.
  box("ES lower tray",[0,.003,0],[.600,.006,.300],mat.orange);
  for(const side of[-1,1])box(`ES side wall ${side}`,[0,.040,side*.147],[.600,.074,.006],mat.orange);
  const front=rectangle(-.144,.144,.003,.077),vent=new T.Path();vent.absarc(.115,.050,.006,0,Math.PI*2,true);front.holes.push(vent);
  const frontGeometry=new T.ExtrudeGeometry(front,{depth:.006,bevelEnabled:false,curveSegments:24});frontGeometry.rotateY(Math.PI/2);frontGeometry.translate(.294,0,0);add("ES front wall",frontGeometry,mat.orange);
  const back=rectangle(-.144,.144,.003,.077);
  for(const [y,z,r]of[[.049,.088,.0125],[.024,-.100,.0055],[.024,-.055,.0055],[.053,-.091,.010]]){
    const hole=new T.Path();hole.absarc(z,y,r,0,Math.PI*2,true);back.holes.push(hole);
  }
  const backGeometry=new T.ExtrudeGeometry(back,{depth:.006,bevelEnabled:false,curveSegments:24});
  backGeometry.rotateY(-Math.PI/2);backGeometry.translate(-.294,0,0);add("ES connector bulkhead",backGeometry,mat.orange);
  const gasket=rectangle(-.298,.298,-.148,.148);gasket.holes.push(new T.Path([new T.Vector2(-.288,-.138),new T.Vector2(-.288,.138),new T.Vector2(.288,.138),new T.Vector2(.288,-.138)]));
  plate("ES lid seal",gasket,.075,.002,mat.rubber);
  box("ES access lid",[0,.080,0],[.600,.006,.300],mat.orange,battery,true);
  for(const side of[-1,1])for(let i=0;i<8;i++)screw(`ES lid fastener ${side} ${i}`,[-.278+i*.0794,.084,side*.140],battery,true);
  for(const z of[-.06,.06])box(`ES lid stiffening bead ${z}`,[.04,.084,z],[.44,.003,.009],mat.orange,battery,true);
  // A geometric HV emblem stays sharp at any zoom; no image skin or texture.
  const triangle=new T.Shape([new T.Vector2(-.025,-.018),new T.Vector2(.025,-.018),new T.Vector2(0,.025)]);
  const label=plate("ES high-voltage warning",triangle,.084,.0006,mat.black,battery,true);label.position.x=.18;
  const bolt=new T.Shape([new T.Vector2(.004,.016),new T.Vector2(-.009,-.003),new T.Vector2(-.001,-.003),new T.Vector2(-.004,-.014),new T.Vector2(.012,.005),new T.Vector2(.003,.005)]);
  const symbol=plate("ES high-voltage symbol",bolt,.0847,.0003,mat.white,battery,true);symbol.position.x=.18;
  // Drilled mounting ears and insulating stand-offs, shared with car mounts.
  const mounts:V[]=[];
  for(const x of[-.25,.25])for(const side of[-1,1]){
    const shape=rectangle(x-.018,x+.018,side*.164-.017,side*.164+.017),hole=new T.Path();hole.absarc(x,side*.164,.0035,0,Math.PI*2,true);shape.holes.push(hole);
    plate(`ES mounting ear ${x} ${side}`,shape,.004,.005,mat.cast);
    mounts.push([x,.004,-side*.164]);
  }
  // Eight compressed cell modules. Instanced pouches/tabs preserve detail
  // without adding hundreds of draw calls to every car viewer.
  const cellGeometry=new RoundedBoxGeometry(.0036,.041,.112,2,.0005),tabGeometry=new T.BoxGeometry(.0016,.009,.011);
  const moduleEnds:{positive:V;negative:V}[]=[];
  for(let bank=0;bank<2;bank++)for(let moduleIndex=0;moduleIndex<4;moduleIndex++){
    const id=bank*4+moduleIndex,sign=bank===0?1:-1,z=bank===0?-.075:.075;
    const x=-.064+(bank===0?moduleIndex:3-moduleIndex)*.092;
    box(`ES module ${id} cold plate`,[x,.010,z],[.086,.008,.122],mat.metal);
    box(`ES module ${id} thermal interface`,[x,.01425,z],[.080,.0005,.113],mat.black);
    const cells=new T.InstancedMesh(cellGeometry,mat.metal,20),tabs=new T.InstancedMesh(tabGeometry,mat.bronze,40),matrix=new T.Matrix4();
    for(const [part,name]of[[cells,`ES module ${id} cells`],[tabs,`ES module ${id} tabs`]] as const){part.name=name;part.userData={component:"battery",internal:true};part.castShadow=true;part.receiveShadow=true;battery.add(part);}
    for(let cell=0;cell<20;cell++){
      const cx=x+sign*(-.038+cell*.004),positiveZ=z+(cell%2?-.034:.034),negativeZ=z-(cell%2?-.034:.034);
      cells.setMatrixAt(cell,matrix.makeTranslation(cx,.035,z));
      tabs.setMatrixAt(cell*2,matrix.makeTranslation(cx,.059,positiveZ));tabs.setMatrixAt(cell*2+1,matrix.makeTranslation(cx,.059,negativeZ));
      if(cell<19)box(`ES module ${id} series link ${cell}`,[cx+sign*.002,.064,negativeZ],[.0056,.0015,.011],mat.bronze);
      if(cell===0)moduleEnds[id]={positive:[cx,.064,positiveZ],negative:[0,0,0]};
      if(cell===19)moduleEnds[id].negative=[cx,.064,negativeZ];
    }
    cells.instanceMatrix.needsUpdate=true;tabs.instanceMatrix.needsUpdate=true;
    for(const end of[-1,1])box(`ES module ${id} compression plate ${end}`,[x+end*.042,.036,z],[.004,.045,.120],mat.darkMetal);
    for(const side of[-1,1])ring(`ES module ${id} tie rod ${side}`,[x-.045,.029,z+side*.057],[x+.045,.029,z+side*.057],.0005,.0017,mat.metal);
  }
  for(let i=0;i<7;i++){
    const a=moduleEnds[i].negative,b=moduleEnds[i+1].positive;
    wire(`ES inter-module bus ${i}`,[a,[a[0]+(i===3?.014:0),.069,a[2]],[b[0]+(i===3?.014:0),.069,b[2]],b],.0018,mat.bronze);
  }
  // Central BMS board and sense looms remain above the insulating cell dividers.
  box("ES BMS board",[.078,.067,0],[.365,.0016,.025],mat.darkMetal);
  for(const x of[-.085,.08,.24]){ring(`ES BMS stand-off ${x}`,[x,.006,0],[x,.0662,0],.0008,.0022,mat.black);screw(`ES BMS fixing ${x}`,[x,.068,0]);}
  for(let i=0;i<8;i++){
    box(`ES BMS monitor ${i}`,[-.077+i*.044,.070,0],[.018,.003,.014],mat.black);
    const p=moduleEnds[i].positive;wire(`ES sense loom ${i}`,[p,[p[0],.071,p[2]],[p[0],.071,0]],.0008,mat.black);
  }
  box("ES insulating partition",[-.112,.034,0],[.003,.055,.274],mat.black);
  for(const side of[-1,1]){
    const z=side*.074;
    ring(`ES main contactor ${side}`,[-.126,.014,z],[-.126,.037,z],.001,.010,mat.white);
    for(const dx of[-.004,.004])ring(`ES contactor terminal ${side} ${dx}`,[-.126+dx,.036,z],[-.126+dx,.043,z],.0005,.002,mat.bronze);
    box(`ES contactor foot ${side}`,[-.126,.010,z],[.024,.008,.026],mat.darkMetal);
  }
  box("ES main fuse",[-.123,.049,-.024],[.018,.014,.028],mat.white);
  box("ES fuse cradle",[-.123,.024,-.024],[.020,.036,.030],mat.black);
  const first=moduleEnds[0].positive,last=moduleEnds[7].negative;
  wire("ES positive cell bus",[first,[-.108,.067,first[2]],[-.117,.061,-.024],[-.123,.056,-.024]],.002,mat.bronze);
  wire("ES fused positive bus",[[-.123,.049,-.038],[-.122,.045,-.052],[-.122,.043,-.074]],.002,mat.bronze);
  wire("ES negative cell bus",[last,[-.108,.067,last[2]],[-.118,.050,.074],[-.122,.043,.074]],.002,mat.bronze);
  box("ES isolation monitor",[.274,.034,-.076],[.027,.040,.050],mat.darkMetal);
  box("ES manual disconnect base",[.273,.036,.062],[.030,.050,.050],mat.black);
  box("ES manual disconnect grip",[.273,.065,.062],[.032,.008,.046],mat.orange);
  box("ES disconnect mounting foot",[.273,.0085,.062],[.030,.005,.050],mat.darkMetal);
  box("ES monitor mounting foot",[.274,.010,-.076],[.027,.008,.050],mat.darkMetal);
  ring("ES vent outlet",[.280,.050,-.115],[.313,.050,-.115],.004,.006,mat.metal);
  ring("ES vent membrane",[.301,.050,-.115],[.302,.050,-.115],.0003,.004,mat.white);
  // The CU-K has its own EMI cover but lives inside the common orange shell.
  box("CU-K liquid cold plate",[-.217,.011,0],[.148,.010,.262],mat.metal,inverter);
  for(const z of[-.128,.128])box(`CU-K side wall ${z}`,[-.217,.041,z],[.148,.052,.004],mat.cast,inverter);
  for(const x of[-.289,-.145]){
    const face=rectangle(-.126,.126,.015,.067);
    const holes=x<-.2?[[.049,.088,.0125],[.024,-.100,.0055],[.024,-.055,.0055]]:[[.043,-.074,.006],[.043,.074,.006]];
    for(const [y,z,r]of holes){const hole=new T.Path();hole.absarc(-z,y,r,0,Math.PI*2,true);face.holes.push(hole);}
    const geometry=new T.ExtrudeGeometry(face,{depth:.004,bevelEnabled:false,curveSegments:24});geometry.rotateY(Math.PI/2);geometry.translate(x-.002,0,0);add(`CU-K end wall ${x}`,geometry,mat.cast,inverter);
  }
  box("CU-K EMI lid",[-.217,.069,0],[.148,.004,.262],mat.cast,inverter,true);
  for(const x of[-.280,-.153])for(const z of[-.119,0,.119])screw(`CU-K cover fastener ${x} ${z}`,[x,.071,z],inverter,true);
  box("CU-K DC-link capacitor bank",[-.265,.032,0],[.038,.032,.235],mat.black,inverter);
  for(let i=0;i<6;i++)box(`CU-K capacitor end ${i}`,[-.265,.049,-.100+i*.040],[.033,.002,.025],mat.darkMetal,inverter);
  for(let phase=0;phase<3;phase++){
    const z=(phase-1)*.081;
    for(const upper of[false,true]){
      const x=upper?-.172:-.214;
      box(`CU-K phase ${phase} ${upper?"high":"low"} switch`,[x,.022,z],[.030,.010,.053],mat.black,inverter);
      for(const dx of[-.010,.010])screw(`CU-K switch fixing ${phase} ${upper} ${dx}`,[x+dx,.028,z],inverter);
    }
    box(`CU-K phase ${phase} gate board`,[-.193,.040,z],[.069,.0016,.065],mat.darkMetal,inverter);
    for(const x of[-.225,-.162])for(const dz of[-.030,.030]){
      ring(`CU-K gate board stand-off ${phase} ${x} ${dz}`,[x,.016,z+dz],[x,.0392,z+dz],.0007,.0015,mat.black,inverter);
      screw(`CU-K gate board fixing ${phase} ${x} ${dz}`,[x,.041,z+dz],inverter);
    }
    for(const x of[-.211,-.174])box(`CU-K gate driver ${phase} ${x}`,[x,.043,z],[.012,.004,.014],mat.black,inverter);
    // Each phase is a half bridge. The three output contacts share a sealed
    // feedthrough; DC input bus plates remain insulated from one another.
    wire(`CU-K phase output ${phase}`,[[-.193,.027,z],[-.193,.033,z+.026],[-.238,.052,z+.026],[-.275,.052,.088+(phase-1)*.004],[-.311,.049,.088+(phase-1)*.004]],.0015,mat.bronze,inverter);
    wire(`CU-K phase ${phase} positive supply`,[[-.214,.027,z-.018],[-.214,.030,z-.022],[-.158,.029,z-.022]],.0012,mat.bronze,inverter);
    wire(`CU-K phase ${phase} negative supply`,[[-.172,.027,z+.018],[-.172,.034,z+.022],[-.158,.033,z+.022]],.0012,mat.bronze,inverter);
  }
  for(const [y,m,name]of[[.029,mat.bronze,"positive"],[.031,mat.black,"insulator"],[.033,mat.bronze,"negative"]] as const){
    box(`CU-K DC bus ${name}`,[-.158,y,0],[.012,.0015,.236],m,inverter);
  }
  for(const side of[-1,1]){
    wire(`CU-K contactor link ${side}`,[[-.130,.043,side*.074],[-.139,.043,side*.074],[-.149,.043,side*.074],[-.158,.043,side*.074],[-.158,side<0?.029:.033,side*.074]],.0015,mat.bronze,inverter);
    ring(`CU-K DC socket ${side}`,[-.148,.043,side*.074],[-.138,.043,side*.074],.0025,.006,mat.orange,inverter);
  }
  box("CU-K control board",[-.266,.057,0],[.030,.0016,.234],mat.darkMetal,inverter);
  for(const z of[-.112,.112])ring(`CU-K control board stand-off ${z}`,[-.266,.050,z],[-.266,.0562,z],.0007,.0017,mat.black,inverter);
  for(let i=0;i<5;i++)box(`CU-K controller ${i}`,[-.266,.060,-.084+i*.042],[.017,.004,.020],mat.black,inverter);
  // A compact auxiliary converter occupies the free front end of the enclosure.
  box("ES DC-DC converter",[.275,.026,0],[.029,.028,.041],mat.cast);
  box("ES DC-DC mounting foot",[.275,.009,0],[.029,.006,.041],mat.darkMetal);
  wire("ES DC-DC protected supply",[[-.158,.033,.117],[-.125,.036,.132],[-.10,.036,.137],[.05,.036,.137],[.20,.036,.137],[.263,.036,.130],[.275,.038,.070],[.275,.038,.020]],.0015,mat.orange);
  for(const [name,z]of[["in",-.100],["out",-.055]] as const){
    ring(`ES coolant ${name} union`,[-.284,.024,z],ports[name==="in"?"coolantIn":"coolantOut"],.004,.0055,mat.metal);
    // Two common headers join the cold plates through the insulated module gap.
    wire(`ES coolant ${name} manifold`,[[-.284,.024,z],[-.285,.018,z],[-.280,.010,z],[-.26,.009,z],[-.14,.009,z],[-.10,.009,z],[.26,.009,z]],.0025,mat.metal);
  }
  ring("Inverter motor outlet",[-.286,.049,.088],ports.power,.009,.012,mat.darkMetal,inverter);
  ring("CU-K phase feedthrough insulator",[-.294,.049,.088],[-.316,.049,.088],.005,.009,mat.orange,inverter);
  for(let i=0;i<3;i++)ring(`CU-K phase socket ${i}`,[-.303,.049,.088+(i-1)*.004],[-.316,.049,.088+(i-1)*.004],.0004,.0013,mat.bronze,inverter);
  ring("ES low voltage socket",[-.294,.053,-.091],[-.314,.053,-.091],.006,.010,mat.darkMetal);
  for(let i=0;i<6;i++){const a=i*Math.PI/3;ring(`ES low voltage pin ${i}`,[-.307,.053+Math.cos(a)*.003,-.091+Math.sin(a)*.003],[-.313,.053+Math.cos(a)*.003,-.091+Math.sin(a)*.003],.0002,.00055,mat.metal);}
  battery.userData.ports=ports;battery.userData.mounts=mounts;
  const worldPorts=Object.fromEntries(Object.entries(ports).map(([name,p])=>[name,new T.Vector3(...p).add(battery.position).toArray() as V]));
  return {battery,inverter,ports:worldPorts,mounts:mounts.map(p=>new T.Vector3(...p).add(battery.position).toArray() as V)};
}
