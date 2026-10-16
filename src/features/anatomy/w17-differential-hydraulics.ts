import * as T from "three";
import { openRadialPort } from "./w17-wastegate.ts";
import { createSurfaceSampler } from "./w17-surface.ts";
import { HYDRAULIC_MANIFOLD_OFFSET, hydraulicManifoldPoint } from "./w17-hydraulics.ts";

type V=[number,number,number];
type Materials=Record<"metal"|"darkMetal"|"black"|"rubber",T.Material>;

const cylinderMiddle=(side:number):V[]=>[
  [-1.526,.420,side*.040],[-1.54,.420,side*.040],[-1.565,.405,side*.060],[-1.58,.400,side*.055],
  [-1.61,.350,side*.055],[-1.65,.410,side*.07],[-1.72,.410,side*.07],
  [-1.78,.36,side*.06],[-1.80,.335,side*.08],[-1.79,.326,side*.12],
];

// Cut the exterior before its inner laminate is formed. Cutting two open
// skins independently would create overlapping bore walls and lose seam data.
export function prepareDifferentialBodyPorts(skin:T.Mesh){
  const passages:{side:number;point:V;axis:V;normal:V;radius:number}[]=[];
  for(const side of[-1,1]){
    const route:V[]=[[-1.52,.420,side*.016],[-1.52,.420,side*.028],...cylinderMiddle(side),[-1.776,.326,side*.130],[-1.764,.326,side*.130]];
    const samples=new T.CatmullRomCurve3(route.map(p=>new T.Vector3(...p)),false,"centripetal").getSpacedPoints(400);
    skin.updateWorldMatrix(true,false);const probe=new T.Mesh(skin.geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));probe.matrixWorld.copy(skin.matrixWorld);
    let entry:T.Intersection|undefined,axis=new T.Vector3();
    for(let i=0;i<samples.length-1&&!entry;i++){
      const delta=samples[i+1].clone().sub(samples[i]),length=delta.length();delta.normalize();
      entry=new T.Raycaster(samples[i],delta,0,length).intersectObject(probe,false).find(hit=>hit.point.x< -1.62&&hit.point.x> -1.70);
      if(entry)axis=delta;
    }
    probe.material.dispose();
    // The open cooling tail needs no grommet suspended across its air passage.
    // Only drill and seat a fitting when this route actually crosses a skin.
    if(!entry)continue;
    const point=entry.point,normal=entry.face!.normal.clone().transformDirection(skin.matrixWorld),radius=.0045;
    const frame=new T.Matrix4().compose(point,new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),axis),new T.Vector3(1,1,1));
    const transform=frame.invert().multiply(skin.matrixWorld);skin.geometry.applyMatrix4(transform);
    openRadialPort(skin,[0,0],radius,1,-.100,false,.200);skin.geometry.applyMatrix4(transform.invert());skin.geometry.computeVertexNormals();
    passages.push({side,point:point.toArray() as V,axis:axis.toArray() as V,normal:normal.toArray() as V,radius});
  }
  return passages;
}

// Illustrative three-way proportional valve, fed by the existing pressure and
// return galleries. A stationary cylinder avoids an external hose on the rotor.
export function connectDifferentialHydraulics(car:T.Group,system:T.Group,mat:Materials){
  const valveStart=system.children.length;
  const ports=system.userData.ports as Record<string,{point:V;axis:V;union?:string}>;
  const add=(name:string,g:T.BufferGeometry,m:T.Material,cover=false)=>{
    const part=new T.Mesh(g,m);part.name=`Hydraulic LSD ${name}`;part.userData={component:"hydraulics",serviceCover:cover};
    part.castShadow=part.receiveShadow=true;system.add(part);return part;
  };
  const ring=(name:string,a:V,b:V,inner:number,outer:number,m=mat.metal)=>{
    const d=new T.Vector3(...b).sub(new T.Vector3(...a));
    const g=new T.LatheGeometry([[inner,0],[outer,0],[outer,d.length()],[inner,d.length()],[inner,0]].map(([r,z])=>new T.Vector2(r,z)),32);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),d.normalize()));g.translate(...a);return add(name,g,m);
  };
  const drill=(part:T.Mesh,point:V,axis:V,radius:number,split=-2,depth=Infinity)=>{
    part.updateWorldMatrix(true,false);
    const frame=new T.Matrix4().compose(new T.Vector3(...point),new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(...axis)),new T.Vector3(1,1,1));
    const transform=frame.invert().multiply(part.matrixWorld);part.geometry.applyMatrix4(transform);
    openRadialPort(part,[0,0],radius,1,split,true,depth);part.geometry.applyMatrix4(transform.invert());part.geometry.computeVertexNormals();
  };
  const manifold=system.getObjectByName("Hydraulic control manifold") as T.Mesh;
  // Build the walls of the milled galleries directly, as in the pneumatic
  // head manifold. Repeated crossing boolean bores multiply tiny triangles.
  const blank=[[-1.359,-1.221],[.3795,.4045],[.078,.138]],half=.0022;
  const channels:[V,number][]=[
    [[-1.290,.397,.121],0], [[-1.290,.385,.095],0],
    [[-1.239,.391,.108],2], [[-1.239,.391,.121],1],
    [[-1.306,.391,.121],1], [[-1.306,.391,.108],2], [[-1.270,.391,.108],2],
    [[-1.270,.391,.095],1], [[-1.257,.385,.108],2],
    [[-1.257,.390,.108],1],
  ];
  const cuts=channels.map(([p,axis])=>p.map((v,i)=>i===axis?blank[i]:[v-half,v+half]));
  const grid=blank.map((extent,axis)=>[...new Set([...extent,...cuts.flatMap(c=>c[axis]).filter(v=>v>extent[0]&&v<extent[1])])].sort((a,b)=>a-b));
  const solid=(cell:number[])=>{
    if(cell.some((v,i)=>v<0||v>=grid[i].length-1))return false;
    const p=cell.map((v,i)=>(grid[i][v]+grid[i][v+1])/2);
    return !cuts.some(c=>p.every((v,i)=>v>c[i][0]&&v<c[i][1]));
  };
  const positions:number[]=[],indices:number[]=[];
  for(let x=0;x<grid[0].length-1;x++)for(let y=0;y<grid[1].length-1;y++)for(let z=0;z<grid[2].length-1;z++){
    const cell=[x,y,z];if(!solid(cell))continue;
    for(let axis=0;axis<3;axis++)for(const sign of[-1,1]){
      const neighbor=[...cell];neighbor[axis]+=sign;if(solid(neighbor))continue;
      const u=(axis+1)%3,v=(axis+2)%3,face=[[0,0],[1,0],[1,1],[0,1]].map(([a,b])=>{
        const p=[0,0,0];p[axis]=grid[axis][cell[axis]+(sign>0?1:0)];p[u]=grid[u][cell[u]+a];p[v]=grid[v][cell[v]+b];return p;
      });
      if(sign<0)face.reverse();const offset=positions.length/3;positions.push(...face.flat());indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
    }
  }
  const gallery=new T.BufferGeometry();gallery.setAttribute("position",new T.Float32BufferAttribute(positions,3));gallery.setIndex(indices);gallery.computeVertexNormals();
  gallery.translate(...manifold.position.clone().sub(new T.Vector3(...HYDRAULIC_MANIFOLD_OFFSET)).negate().toArray());manifold.geometry.dispose();manifold.geometry=gallery;manifold.userData.steeringGalleries=true;
  const plug=(name:string,a:V,b:V)=>{
    const d=new T.Vector3(...b).sub(new T.Vector3(...a)),g=new T.BoxGeometry(half*2,d.length(),half*2);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),d.clone().normalize()));g.translate(...new T.Vector3(...a).addScaledVector(d,.5).toArray());return add(name,g,mat.darkMetal);
  };
  plug("pressure gallery end plug",[-1.225,.397,.121],[-1.221,.397,.121]);
  plug("return gallery end plug",[-1.225,.385,.095],[-1.221,.385,.095]);
  plug("pressure cross-drill plug",[-1.239,.391,.078],[-1.239,.391,.082]);
  plug("return cross-drill plug inner",[-1.257,.385,.078],[-1.257,.385,.082]);
  plug("return cross-drill plug outer",[-1.257,.385,.134],[-1.257,.385,.138]);
  plug("return vertical drill plug",[-1.257,.4005,.108],[-1.257,.4045,.108]);
  for(const [x,z]of[[-1.239,.121],[-1.306,.121],[-1.270,.095]]){
    plug(`branch drill plug top ${x}`,[x,.4005,z],[x,.4045,z]);
    plug(`branch drill plug bottom ${x}`,[x,.3795,z],[x,.3815,z]);
  }
  plug("steering pressure cross-drill plug",[-1.306,.391,.078],[-1.306,.391,.082]);
  plug("steering return cross-drill plug",[-1.270,.391,.078],[-1.270,.391,.082]);
  const valve=ring("valve cylinder",[-1.380,.397,.086],[-1.380,.397,.128],.0045,.009,mat.darkMetal);valve.userData.serviceCover=true;
  drill(valve,[-1.380,.397,.121],[1,0,0],.0022);
  drill(valve,[-1.380,.397,.108],[1,0,0],.0022);
  const diagonal=new T.Vector3(0,-1,0);
  drill(valve,[-1.380,.397,.095],diagonal.toArray() as V,.0022);
  // The unused sides of radial drillings are positively plugged.
  ring("valve pressure drill plug",[-1.389,.397,.121],[-1.3855,.397,.121],0,.0022,mat.darkMetal);
  ring("valve outlet drill plug",[-1.3745,.397,.108],[-1.371,.397,.108],0,.0022,mat.darkMetal);
  ring("valve return drill plug",[-1.380,.406,.095],[-1.380,.4025,.095],0,.0022,mat.darkMetal);
  ring("pressure gallery bridge",[-1.359,.397,.121],[-1.371,.397,.121],.0022,.0035);
  const returnCurve=new T.CubicBezierCurve3(new T.Vector3(-1.359,.385,.095),new T.Vector3(-1.370,.385,.095),new T.Vector3(-1.380,.378,.095),new T.Vector3(-1.380,.388,.095));
  const section=new T.Shape();section.absarc(0,0,.0032,0,Math.PI*2,false);const hole=new T.Path();hole.absarc(0,0,.0022,0,Math.PI*2,true);section.holes.push(hole);
  add("return gallery bridge",new T.ExtrudeGeometry(section,{extrudePath:returnCurve,steps:48,curveSegments:12,bevelEnabled:false}),mat.metal);
  ring("valve spool stem",[-1.380,.397,.086],[-1.380,.397,.136],0,.0022);
  for(const [a,b]of[[.090,.093],[.099,.102],[.125,.128]])ring(`valve spool land ${a}`,[-1.380,.397,a],[-1.380,.397,b],.0022,.00445);
  ring("valve spring cap",[-1.380,.397,.082],[-1.380,.397,.086],0,.009,mat.darkMetal).userData.serviceCover=true;
  const spring=new T.CatmullRomCurve3(Array.from({length:81},(_,i)=>new T.Vector3(-1.380+Math.cos(i/80*Math.PI*8)*.003,.397+Math.sin(i/80*Math.PI*8)*.003,.086+i/80*.004)));
  add("valve return spring",new T.TubeGeometry(spring,80,.00035,6,false),mat.metal);
  ring("solenoid armature",[-1.380,.397,.128],[-1.380,.397,.150],.0023,.0045);
  ring("solenoid winding",[-1.380,.397,.130],[-1.380,.397,.149],.0048,.0078,mat.rubber);
  ring("solenoid shell",[-1.380,.397,.128],[-1.380,.397,.153],.008,.010,mat.black).userData.serviceCover=true;
  ring("solenoid end cap",[-1.380,.397,.150],[-1.380,.397,.153],.0022,.008,mat.darkMetal).userData.serviceCover=true;
  ring("valve outlet union",[-1.389,.397,.108],[-1.402,.397,.108],.0022,.0042);
  // Two bored mounting ears join the valve to the existing manifold back face.
  for(const z of[.088,.128]){
    ring(`valve mounting ear ${z}`,[-1.376,.3995,z],[-1.359,.3995,z],.0015,.0035,mat.metal);
    drill(manifold,hydraulicManifoldPoint([-1.350,.3995,z]),[1,0,0],.0015);
    ring(`valve mounting bolt ${z}`,[-1.379,.3995,z],[-1.354,.3995,z],0,.0014,mat.darkMetal);
    ring(`valve mounting screw head ${z}`,[-1.379,.3995,z],[-1.376,.3995,z],.0007,.0025,mat.metal);
    ring(`valve ear brace ${z}`,[-1.380,.403,z],[-1.374,.3995,z],0,.0025,mat.darkMetal);
  }
  // An electrical branch reaches the existing valve-loom socket.
  const lead=new T.CatmullRomCurve3([new T.Vector3(-1.380,.397,.155),new T.Vector3(-1.367,.416,.158),new T.Vector3(-1.330,.420,.159),new T.Vector3(-1.291,.414,.159)]);
  add("solenoid lead",new T.TubeGeometry(lead,64,.0015,8,false),mat.black);
  ring("solenoid connector",[-1.380,.397,.151],[-1.380,.397,.158],.0015,.0035,mat.darkMetal);
  for(const part of system.children.slice(valveStart))part.position.add(new T.Vector3(...HYDRAULIC_MANIFOLD_OFFSET));
  const outlet="LSD valve outlet";ports[outlet]={point:hydraulicManifoldPoint([-1.402,.397,.108]),axis:[-1,0,0]};
  // Installed receiver positions are exported by the stationary cartridges.
  for(const side of[-1,1]){
    const receiver=car.getObjectByName(`Differential LSD pressure union ${side}`)!;
    ports[`LSD cylinder ${side}`]={...receiver.userData.port,union:receiver.name};
  }
  const tee=add("distribution block",new T.BoxGeometry(.016,.012,.016),mat.darkMetal);
  tee.position.set(-1.520,.420,0);
  drill(tee,[-1.520,.420,0],[1,0,0],.0022);drill(tee,[-1.520,.420,0],[0,0,1],.0022);
  ring("distribution drilling plug",[-1.528,.420,0],[-1.524,.420,0],0,.0022,mat.darkMetal);
  for(const [name,p,axis]of[
    ["tee inlet",[-1.504,.420,0],[1,0,0]],
    ["tee right",[-1.520,.420,.016],[0,0,1]],
    ["tee left",[-1.520,.420,-.016],[0,0,-1]],
  ] as [string,V,V][]){
    ports[`LSD ${name}`]={point:p,axis};
    ring(`${name} union`,new T.Vector3(...p).addScaledVector(new T.Vector3(...axis),-.008).toArray() as V,p,.0022,.0042);
  }
  // The tee's brace lands on the real case roof, with a through-bolt and a
  // backing boss below the laminate instead of a floating mounting tab.
  const casing=car.getObjectByName("Carbon gearbox casing") as T.Mesh;
  casing.updateWorldMatrix(true,false);const roof=createSurfaceSampler([casing],"y"),footY=roof(-1.520,-.030,1)!;
  const foot=new T.BoxGeometry(.018,.004,.024),fp=foot.attributes.position;
  for(let i=0;i<fp.count;i++)fp.setY(i,roof(-1.520+fp.getX(i),-.030+fp.getZ(i),1)!+(fp.getY(i)>0?.004:0));
  foot.translate(-1.520,0,-.030);foot.computeVertexNormals();
  const mount=add("distribution mounting foot",foot,mat.metal);drill(mount,[-1.520,footY,-.030],[0,1,0],.0021);
  const a=new T.Vector3(-1.520,footY+.004,-.022),b=new T.Vector3(-1.520,.414,0),axis=b.clone().sub(a);
  const brace=new T.BoxGeometry(.006,axis.length(),.008);brace.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),axis.clone().normalize()));brace.translate(...a.addScaledVector(axis,.5).toArray());
  add("distribution mounting brace",brace,mat.metal);
  drill(casing,[-1.520,footY,-.030],[0,1,0],.0021,-.012);
  ring("distribution backing boss",[-1.520,footY-.007,-.030],[-1.520,footY-.003,-.030],.0021,.005,mat.darkMetal);
  ring("distribution bolt",[-1.520,footY-.007,-.030],[-1.520,footY+.004,-.030],0,.002,mat.darkMetal);
  ring("distribution bolt head",[-1.520,footY+.004,-.030],[-1.520,footY+.007,-.030],.001,.0035);
  const routes:[string,string,string,V[],number][]=[
    ["control hose",outlet,"LSD tee inlet",[[-1.454,.397,.008],[-1.475,.410,0],[-1.480,.420,0]],.010],
    ["right cylinder hose","LSD tee right","LSD cylinder 1",cylinderMiddle(1),.012],
    ["left cylinder hose","LSD tee left","LSD cylinder -1",cylinderMiddle(-1),.012],
  ];
  for(const [name,from,to,middle,approach]of routes){
    const a=ports[from],b=ports[to],points=[a.point,new T.Vector3(...a.point).addScaledVector(new T.Vector3(...a.axis),approach).toArray() as V,...middle,new T.Vector3(...b.point).addScaledVector(new T.Vector3(...b.axis),approach).toArray() as V,b.point];
    const path=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)),false,"centripetal");
    const radius=name==="control hose"?.003:.0025,boreRadius=name==="control hose"?.0022:.0016;
    const shape=new T.Shape();shape.absarc(0,0,radius,0,Math.PI*2,false);const bore=new T.Path();bore.absarc(0,0,boreRadius,0,Math.PI*2,true);shape.holes.push(bore);
    if(name!=="control hose"){
      const samples=path.getSpacedPoints(400);
      for(const [label,names]of[["case",["Carbon gearbox casing"]],["rear panel",["Continuous undercut sidepod shell","Bodywork inner laminate"]],["heat shield",["Tail heat shield"]]] as const){
        const skins=names.map(n=>car.getObjectByName(n) as T.Mesh),hits:{point:T.Vector3;tangent:T.Vector3}[]=[];
        if(label==="rear panel"){
          const passages=skins[0].userData.lsdPassages as ReturnType<typeof prepareDifferentialBodyPorts>;
          const passage=passages.find(p=>p.side===(to==="LSD cylinder 1"?1:-1));
          if(!passage)continue;
          const tangent=new T.Vector3(...passage.axis),outer=new T.Vector3(...passage.point);
          const depth=skins[0].userData.laminateThickness/new T.Vector3(...passage.normal).dot(tangent);
          hits.push({point:outer,tangent},{point:outer.clone().addScaledVector(tangent,-depth),tangent});
        }else for(const skin of skins){
          skin.updateWorldMatrix(true,false);const probe=new T.Mesh(skin.geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));probe.matrixWorld.copy(skin.matrixWorld);
          for(let i=0;i<samples.length-1;i++){
            const delta=samples[i+1].clone().sub(samples[i]),length=delta.length();
            for(const hit of new T.Raycaster(samples[i],delta.normalize(),0,length).intersectObject(probe,false))hits.push({point:hit.point,tangent:delta.clone()});
          }
          probe.material.dispose();
        }
        if(!hits.length)throw new Error(`Missing ${label} passage for ${name}`);
        const centre=hits.reduce((p,h)=>p.add(h.point),new T.Vector3()).divideScalar(hits.length);
        const tangent=hits.reduce((p,h)=>p.add(h.tangent),new T.Vector3()).normalize();
        const offsets=hits.map(h=>h.point.clone().sub(centre).dot(tangent)),start=Math.min(...offsets)-.0015,end=Math.max(...offsets)+.0015;
        if(label!=="rear panel")for(const skin of skins)drill(skin,centre.toArray() as V,tangent.toArray() as V,radius+.0020,label==="case"?-.050:-.025,label==="case"?.100:.050);
        const grommet=ring(`${name} ${label} grommet`,centre.clone().addScaledVector(tangent,start).toArray() as V,centre.clone().addScaledVector(tangent,end).toArray() as V,radius+.0007,radius+.0020,label==="heat shield"?mat.darkMetal:mat.rubber);
        grommet.userData.feedthrough={centre:centre.toArray(),axis:tangent.toArray(),length:end-start,skins:names};
      }
    }
    const hose=add(name,new T.ExtrudeGeometry(shape,{extrudePath:path,steps:160,curveSegments:8,bevelEnabled:false}),mat.black);
    hose.userData={...hose.userData,route:points,outerRadius:radius,from,to};
    for(const [end,label]of[[a,"in"],[b,"out"]] as const)ring(`${name} crimp ${label}`,end.point,new T.Vector3(...end.point).addScaledVector(new T.Vector3(...end.axis),.007).toArray() as V,radius,radius+.0012);
  }
  system.updateMatrixWorld(true);
}
