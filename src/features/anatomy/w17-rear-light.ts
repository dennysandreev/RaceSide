import * as T from "three";
import {RoundedBoxGeometry} from "three/addons/geometries/RoundedBoxGeometry.js";
import {mergeGeometries} from "three/addons/utils/BufferGeometryUtils.js";
import {openRadialPort} from "./w17-wastegate.ts";

type V=[number,number,number];
type Materials=Record<"carbon"|"metal"|"darkMetal"|"black"|"rubber"|"red"|"copper"|"circuit",T.Material>;
const vec=(p:V)=>new T.Vector3(...p);

// Retain the rectangular lamp in the launch reference set. Its board, plug,
// mounting inserts are reconstructed, not supplier CAD. The chassis supply
// loom is not yet fitted; do not publish an intersecting provisional route.
export function createRearLight(impact:T.Mesh,mat:Materials,rearX:number,lampY:number){
  const root=new T.Group();root.name="Rear light assembly";
  const unit=new T.Group();unit.name="Rear light sealed unit";unit.position.set(rearX,lampY,0);root.add(unit);
  const add=(parent:T.Object3D,name:string,g:T.BufferGeometry,material=mat.metal,installed=false)=>{
    const m=new T.Mesh(g,material);m.name=name;m.userData={component:"safety",rearLight:true,installedOnly:installed};m.castShadow=m.receiveShadow=true;parent.add(m);return m;
  };
  const box=(parent:T.Object3D,name:string,p:V,size:V,material=mat.black,installed=false)=>{const m=add(parent,name,new T.BoxGeometry(...size),material,installed);m.position.set(...p);return m;};
  const ring=(parent:T.Object3D,name:string,a:V,b:V,inner:number,outer:number,material=mat.metal,installed=false,segments=24)=>{
    const axis=vec(b).sub(vec(a)),g=new T.LatheGeometry([[inner,0],[outer,0],[outer,axis.length()],[inner,axis.length()],[inner,0]].map(p=>new T.Vector2(...p)),segments);
    const m=add(parent,name,g,material,installed);m.position.set(...a);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),axis.normalize());return m;
  };
  const boreX=(mesh:T.Mesh,y:number,z:number,radius:number,side:number,split:number)=>{
    mesh.geometry.rotateY(-Math.PI/2);openRadialPort(mesh,[-z,y],radius,side,split);mesh.geometry.rotateY(Math.PI/2);mesh.geometry.computeVertexNormals();
  };
  const outer=new RoundedBoxGeometry(.016,.100,.062,3,.006),inner=new RoundedBoxGeometry(.012,.096,.058,3,.004);
  outer.translate(-.008,0,0);inner.scale(-1,1,1);inner.translate(-.008,0,0);inner.computeVertexNormals();
  const housing=add(unit,"Rear rain light housing",mergeGeometries([outer,inner]),mat.carbon);outer.dispose();inner.dispose();
  housing.userData.wallThickness=.002;
  boreX(housing,0,0,.0062,1,-.008);
  box(unit,"Rear light circuit board",[-.010,0,0],[.0016,.090,.054],mat.circuit);
  for(let row=0;row<5;row++)for(let col=0;col<3;col++){
    const y=(row-2)*.018,z=(col-1)*.018;
    boreX(housing,y,z,.0054,-1,-.008);
    box(unit,`Rear light emitter pad ${row} ${col}`,[-.0114,y,z],[.0012,.006,.006],mat.metal);
    box(unit,`Rear light emitter ${row} ${col}`,[-.0126,y,z],[.0012,.003,.003],mat.red);
    ring(unit,`Rear rain light LED ${row} ${col}`,[-.0138,y,z],[-.0175,y,z],0,.0055,mat.red);
    // A separate pair of copper lands joins each SMD package to its string.
    for(const sign of[-1,1])box(unit,`Rear light LED land ${row} ${col}/${sign}`,[-.0109,y,z+sign*.004],[.0002,.002,.004],mat.copper);
  }
  for(let col=0;col<3;col++){
    const z=(col-1)*.018;
    box(unit,`Rear light string trace ${col}`,[-.0091,0,z],[.0002,.075,.001],mat.copper);
    box(unit,`Rear light current driver ${col}`,[-.0075,-.040,z],[.003,.005,.007],mat.black);
    box(unit,`Rear light driver land ${col}`,[-.0091,-.039,z],[.0002,.006,.008],mat.copper);
    box(unit,`Rear light return trace ${col}`,[-.0091,0,z+.006],[.0002,.075,.001],mat.copper);
  }
  box(unit,"Rear light control IC",[-.0075,.040,0],[.003,.006,.012],mat.black);
  box(unit,"Rear light supply bus",[-.0091,.037,0],[.0002,.001,.048],mat.copper);
  box(unit,"Rear light ground bus",[-.0091,-.037,0],[.0002,.001,.048],mat.copper);
  // Recessed rear-facing connector; a flange and compressed seal seat on the
  // lamp back. The front face of the impact member has a matching service bore.
  ring(unit,"Rear light connector socket",[-.004,0,0],[.008,0,0],.0045,.006,mat.darkMetal);
  ring(unit,"Rear light connector flange",[-.001,0,0],[.0015,0,0],.006,.0085,mat.metal);
  ring(unit,"Rear light connector seal",[.0055,0,0],[.007,0,0],.006,.0068,mat.rubber);
  ring(unit,"Rear light connector plug",[.006,0,0],[.018,0,0],.0045,.007,mat.darkMetal);
  ring(unit,"Rear light connector insert",[-.004,0,0],[.018,0,0],0,.0044,mat.black);
  ring(unit,"Rear light connector backshell",[.018,0,0],[.030,0,0],.0028,.0045,mat.rubber);
  for(let i=0;i<4;i++){
    const y=(i<2?-1:1)*.0014,z=(i%2?-1:1)*.0014;
    ring(unit,`Rear light connector pin ${i}`,[-.0042,y,z],[.015,y,z],0,.0005,mat.copper);
    box(unit,`Rear light board terminal ${i}`,[-.0068,y,z],[.0052,.001,.001],mat.copper);
  }
  for(const dy of[-.032,.032]){
    boreX(housing,dy,0,.0016,1,-.008);
    ring(unit,`Rear light mounting insert ${dy}`,[-.007,dy,0],[-.001,dy,0],.0015,.0035,mat.metal);
    ring(unit,`Rear light stud ${dy}`,[-.007,dy,0],[.011,dy,0],0,.0015,mat.metal,true);
    ring(unit,`Rear light washer ${dy}`,[.0025,dy,0],[.004,dy,0],.0016,.004,mat.metal,true);
    ring(unit,`Rear light mounting nut ${dy}`,[.004,dy,0],[.008,dy,0],.0015,.0035,mat.darkMetal,true,6);
    boreX(impact,lampY+dy,0,.0017,-1,rearX+.015);
  }
  boreX(impact,lampY,0,.0086,-1,rearX+.015);
  return root;
}
