import * as T from "three";
import { engineCylinderX } from "./w17-engine-core.ts";
import { servicePassage } from "./w17-feedthrough.ts";
import { openRadialPort } from "./w17-wastegate.ts";

type V=[number,number,number];
type Materials=Record<"metal"|"cast"|"darkMetal"|"carbon"|"rubber"|"black",T.Material>;
const vec=(p:V)=>new T.Vector3(...p);

// FIA C8.2.5 / Appendix C4 items 70–71 establish the regulator, bottle,
// filling valves and lines. Packaging and internal dimensions are reconstructed.
export function createEnginePneumatics(core:T.Group,mat:Materials){
  const root=new T.Group();root.name="Engine pneumatic valve supply";core.add(root);
  const ports:Record<string,{point:V;axis:V}>={},connections:[string,string][]=[];
  const add=(parent:T.Object3D,name:string,g:T.BufferGeometry,material=mat.metal,cover=false)=>{
    const p=new T.Mesh(g,material);p.name=`Pneumatic ${name}`;p.userData={component:"engine",internal:true,enginePneumatic:true,serviceCover:cover};p.castShadow=p.receiveShadow=true;parent.add(p);return p;
  };
  const ring=(parent:T.Object3D,name:string,a:V,b:V,inner:number,outer:number,material=mat.metal,cover=false)=>{
    const axis=vec(b).sub(vec(a)),g=new T.LatheGeometry([[inner,0],[outer,0],[outer,axis.length()],[inner,axis.length()],[inner,0]].map(p=>new T.Vector2(...p)),32);
    const p=add(parent,name,g,material,cover);p.position.set(...a);p.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),axis.normalize());return p;
  };
  const box=(parent:T.Object3D,name:string,point:V,size:V,material=mat.cast,cover=false)=>{const p=add(parent,name,new T.BoxGeometry(...size),material,cover);p.position.set(...point);return p;};
  const drill=(mesh:T.Mesh,point:V,axis:V,radius:number,oneSide=false)=>{
    mesh.updateMatrix();const frame=new T.Matrix4().compose(vec(point),new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),vec(axis)),new T.Vector3(1,1,1));
    // Work in millimetres for these small intersecting galleries. The shared
    // cutter's absolute epsilon otherwise drops slivers at submillimetre bores.
    const transform=new T.Matrix4().makeScale(1000,1000,1000).multiply(frame.clone().invert().multiply(mesh.matrix));mesh.geometry.applyMatrix4(transform);
    if(oneSide)openRadialPort(mesh,[0,0],radius*1000,1);
    else {const source=mesh.geometry;mesh.geometry=servicePassage(source,Array.from({length:24},(_,i)=>new T.Vector2(Math.cos(i*Math.PI/12)*radius*1000,Math.sin(i*Math.PI/12)*radius*1000)));source.dispose();}
    mesh.geometry.applyMatrix4(transform.invert());mesh.geometry.computeVertexNormals();
  };
  const port=(parent:T.Object3D,name:string,p:V,axis:V)=>{
    parent.updateWorldMatrix(true,false);core.updateWorldMatrix(true,false);
    const transform=core.matrixWorld.clone().invert().multiply(parent.matrixWorld);
    ports[name]={point:vec(p).applyMatrix4(transform).toArray() as V,axis:vec(axis).transformDirection(transform).toArray() as V};
  };
  const pipe=(parent:T.Object3D,name:string,points:V[],radius:number,from:string,to:string,material=mat.metal,electrical=false)=>{
    const curve=new T.CatmullRomCurve3(points.map(vec),false,"centripetal"),shape=new T.Shape(),hole=new T.Path();
    shape.absarc(0,0,radius,0,Math.PI*2,false);hole.absarc(0,0,radius*.66,0,Math.PI*2,true);shape.holes.push(hole);
    const p=add(parent,name,new T.ExtrudeGeometry(shape,{extrudePath:curve,steps:Math.max(40,points.length*4),curveSegments:8,bevelEnabled:false}),material);
    p.userData={...p.userData,pneumaticRoute:points,outerRadius:radius,pneumaticFrom:from,pneumaticTo:to,electrical};if(!electrical)connections.push([from,to]);return p;
  };
  const spring=(parent:T.Object3D,name:string,a:V,b:V,radius:number,wire:number,turns=5)=>{
    const axis=vec(b).sub(vec(a)),q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),axis.clone().normalize()),points=[];
    for(let i=0;i<=80;i++){const t=i/80,angle=t*Math.PI*2*turns;points.push(new T.Vector3(Math.cos(angle)*radius,axis.length()*t,Math.sin(angle)*radius).applyQuaternion(q).add(vec(a)));}
    add(parent,name,new T.TubeGeometry(new T.CatmullRomCurve3(points),80,wire,6,false),mat.darkMetal);
  };

  // The charged vessel sits below the plenum, between the two head castings.
  const bottleY=.219,profile=[[.0035,-.480],[.007,-.480],[.009,-.490],[.018,-.496],[.024,-.510],[.024,-.680],[.020,-.693],[.010,-.703],[0,-.706],[0,-.703],[.009,-.700],[.018,-.691],[.0215,-.679],[.0215,-.511],[.016,-.499],[.006,-.493],[.0035,-.488],[.0035,-.480]];
  const bottle=add(root,"gas bottle",new T.LatheGeometry(profile.toReversed().map(p=>new T.Vector2(...p)),64),mat.carbon);bottle.rotation.z=-Math.PI/2;bottle.position.y=bottleY;
  ring(root,"bottle neck",[-.490,bottleY,0],[-.476,bottleY,0],.0035,.007,mat.metal);
  ring(root,"bottle union",[-.480,bottleY,0],[-.476,bottleY,0],.002,.008,mat.darkMetal);
  port(root,"bottle",[-.476,bottleY,0],[1,0,0]);
  for(const x of[-.635,-.535]){
    ring(root,`bottle band ${x}`,[x-.005,bottleY,0],[x+.005,bottleY,0],.024,.0255,mat.darkMetal);
    box(root,`bottle saddle ${x}`,[x,bottleY-.026,0],[.018,.004,.025],mat.rubber);
    // Two braces seat on the inboard cast head faces, below the cam covers.
    for(const side of[-1,1]){
      const bank=core.getObjectByName(`Cylinder head bank ${side}`)!;
      const a=new T.Vector3(x,.235,-side*.061).applyQuaternion(bank.quaternion),b=new T.Vector3(x,bottleY-.028,side*.010);
      const axis=b.clone().sub(a),beam=box(root,`bottle brace ${x}/${side}`,a.clone().add(b).multiplyScalar(.5).toArray() as V,[.010,.004,axis.length()],mat.cast);
      beam.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),axis.normalize());
      const foot=box(root,`bottle foot ${x}/${side}`,[x,.235,-side*.063],[.018,.018,.004],mat.cast);foot.position.applyQuaternion(bank.quaternion);foot.quaternion.copy(bank.quaternion);
      foot.userData.pneumaticSeat={body:`Cylinder head housing ${side}`,point:a.toArray()};
      const direction=new T.Vector3(0,0,-side).applyQuaternion(bank.quaternion);
      drill(foot,a.toArray() as V,direction.toArray() as V,.0021);
      drill(bank.getObjectByName(`Cylinder head housing ${side}`) as T.Mesh,[x,.235,0],[0,0,-side],.0021,true);
      ring(root,`bottle foot bolt ${x}/${side}`,a.clone().addScaledVector(direction,-.002).toArray() as V,a.clone().addScaledVector(direction,.007).toArray() as V,0,.002,mat.metal);
    }
    box(root,`band tab ${x}`,[x,bottleY-.025,.018],[.015,.006,.014],mat.darkMetal);
    ring(root,`band fixing ${x}`,[x,bottleY-.033,.018],[x,bottleY-.020,.018],0,.002,mat.metal);
  }

  // Passive diaphragm regulator: separate high- and low-pressure volumes,
  // a seated poppet, stem, diaphragm and preloaded adjustment spring.
  const lower=ring(root,"regulator inlet block",[-.480,bottleY,0],[-.446,bottleY,0],.002,.004,mat.cast,true);
  drill(lower,[-.460,bottleY,0],[0,1,0],.0016,true);
  drill(lower,[-.470,bottleY,0],[0,0,1],.0015);
  ring(root,"inlet gallery end plug",[-.448,bottleY,0],[-.444,bottleY,0],0,.003,mat.darkMetal);
  ring(root,"regulator inlet neck",[-.460,.222,0],[-.460,.224,0],.0016,.003,mat.metal);
  ring(root,"regulator chamber floor",[-.460,.223,0],[-.460,.224,0],.0016,.014,mat.cast,true);
  const wall=ring(root,"regulator pressure chamber",[-.460,.224,0],[-.460,.236,0],.011,.014,mat.cast,true);
  drill(wall,[-.460,.228,0],[0,0,1],.0015);
  ring(root,"regulator valve seat",[-.460,.224,0],[-.460,.225,0],.001,.003,mat.metal);
  const poppet=add(root,"regulator poppet",new T.LatheGeometry([[0,.223],[.0015,.223],[.0015,.2235],[.001,.224],[.0008,.2242],[0,.2242],[0,.223]].map(p=>new T.Vector2(...p)),32),mat.darkMetal);poppet.position.x=-.460;
  ring(root,"regulator valve stem",[-.460,.224,0],[-.460,.237,0],0,.0008,mat.metal);
  ring(root,"regulator diaphragm",[-.460,.2355,0],[-.460,.236,0],.0008,.011,mat.rubber);
  ring(root,"regulator spring seat",[-.460,.236,0],[-.460,.237,0],.0008,.007,mat.metal);
  spring(root,"regulator spring",[-.460,.237,0],[-.460,.250,0],.004,.0006);
  ring(root,"regulator spring bonnet",[-.460,.236,0],[-.460,.254,0],.011,.014,mat.darkMetal,true);
  ring(root,"regulator bonnet roof",[-.460,.252,0],[-.460,.254,0],.0025,.014,mat.darkMetal,true);
  ring(root,"regulator adjustment screw",[-.460,.248,0],[-.460,.259,0],0,.0024,mat.metal);
  ring(root,"regulator adjustment head",[-.460,.256,0],[-.460,.260,0],0,.005,mat.darkMetal);
  port(root,"regulator inlet",[-.476,bottleY,0],[-1,0,0]);connections.push(["bottle","regulator inlet"]);
  // Closed service inlet and the high-pressure monitoring port share the HP gallery.
  ring(root,"fill valve body",[-.470,bottleY,-.003],[-.470,bottleY,-.029],.0015,.0035,mat.metal);
  ring(root,"fill valve seat",[-.470,bottleY,-.020],[-.470,bottleY,-.022],.0007,.0015,mat.metal);
  const fillBall=add(root,"fill check ball",new T.SphereGeometry(.0011,16,10),mat.metal);fillBall.position.set(-.470,bottleY,-.019);
  spring(root,"fill check spring",[-.470,bottleY,-.0145],[-.470,bottleY,-.0179],.0006,.00015,4);
  ring(root,"fill socket cap",[-.470,bottleY,-.029],[-.470,bottleY,-.033],0,.0042,mat.darkMetal);
  ring(root,"pressure sensor stem",[-.470,bottleY,.003],[-.470,bottleY,.020],.0015,.003,mat.metal);
  ring(root,"pressure sensor",[-.470,bottleY,.020],[-.470,bottleY,.034],0,.0045,mat.darkMetal);
  ring(root,"pressure sensor connector",[-.470,bottleY,.034],[-.470,bottleY,.040],.001,.003,mat.black);
  port(root,"pressure signal",[-.470,bottleY,.040],[0,0,1]);
  port(root,"engine harness",[-.283,.126,-.120],[0,1,0]);
  ring(root,"sensor harness terminal",[-.283,.126,-.120],[-.283,.120,-.120],.001,.003,mat.black);
  ring(root,"sensor harness insulator",[-.283,.125,-.120],[-.283,.099,-.120],0,.001,mat.rubber);
  ring(root,"sensor lead bulkhead sleeve",[-.300,.190,.070],[-.284,.190,.070],.0011,.003,mat.rubber);
  ring(root,"sensor lead bulkhead lip",[-.286,.190,.070],[-.284,.190,.070],.0011,.004,mat.rubber);
  pipe(root,"pressure sensor cable",[[-.470,bottleY,.040],[-.470,bottleY,.048],[-.410,.214,.070],[-.320,.190,.070],[-.310,.190,.070],[-.296,.190,.070],[-.280,.190,.070],[-.280,.170,-.030],[-.280,.160,-.100],[-.283,.145,-.120],[-.283,.137,-.120],[-.283,.126,-.120]],.001,"pressure signal","engine harness",mat.black,true);

  for(const side of[-1,1]){
    const bank=core.getObjectByName(`Cylinder head bank ${side}`)!,distribution=new T.Group();distribution.name=`Pneumatic head distribution ${side}`;distribution.quaternion.copy(bank.quaternion);root.add(distribution);
    const first=engineCylinderX(side,0),front=engineCylinderX(side,2)+.052,manifoldX=front+.018;
    // A milled manifold with covered rectangular galleries. Build the shared
    // walls directly; repeated tiny boolean cuts left cracks at the end faces.
    const xs=[-.004,-.0015,.0015,.004],ys=[-.0035,-.0015,.0015,.0035],zs=[-.053,-.0515,-.0485,-.0015,.0015,.0485,.0515,.053];
    const solid=(x:number,y:number,z:number)=>x>=0&&x<3&&y>=0&&y<3&&z>=0&&z<7&&!(y===1&&(x===1||(x===0&&(z===1||z===5))||(x===2&&z===3)));
    const positions:number[]=[],indices:number[]=[];
    for(let x=0;x<3;x++)for(let y=0;y<3;y++)for(let z=0;z<7;z++)if(solid(x,y,z)){
      const bounds=[[xs[x],xs[x+1]],[ys[y],ys[y+1]],[zs[z],zs[z+1]]];
      for(let axis=0;axis<3;axis++)for(const sign of[-1,1]){
        const neighbor=[x,y,z];neighbor[axis]+=sign;if(solid(...neighbor as [number,number,number]))continue;
        const u=(axis+1)%3,v=(axis+2)%3,face=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>{const p=[0,0,0];p[axis]=bounds[axis][sign>0?1:0];p[u]=bounds[u][a>0?1:0];p[v]=bounds[v][b>0?1:0];return p;});
        if(sign<0)face.reverse();const offset=positions.length/3;positions.push(...face.flat());indices.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
      }
    }
    const manifoldGeometry=new T.BufferGeometry();manifoldGeometry.setAttribute("position",new T.Float32BufferAttribute(positions,3));manifoldGeometry.setIndex(indices);manifoldGeometry.computeVertexNormals();
    const manifold=add(distribution,`head manifold ${side}`,manifoldGeometry,mat.cast);manifold.position.set(manifoldX,.216,0);
    for(const edge of[-1,1])ring(distribution,`manifold cross-bore plug ${side}/${edge}`,[manifoldX,.216,edge*.052],[manifoldX,.216,edge*.055],0,.0025,mat.darkMetal);
    ring(distribution,`head inlet ${side}`,[manifoldX+.003,.216,0],[front+.040,.216,0],.0015,.0025,mat.metal);
    const wall=core.getObjectByName(`Head end wall ${side} front`) as T.Mesh;
    for(const z of[-.030,.030]){
      const lug=box(distribution,`manifold mounting lug ${side}/${z}`,[manifoldX,.223,z],[.016,.008,.010],mat.cast);
      drill(wall,[front-.002,.224,z],[1,0,0],.0016);drill(lug,[manifoldX,.224,z],[1,0,0],.0016);
      ring(distribution,`manifold stand ${side}/${z}`,[front,.224,z],[front+.010,.224,z],.0016,.004,mat.cast);
      ring(distribution,`manifold fixing ${side}/${z}`,[front-.003,.224,z],[front+.026,.224,z],0,.0015,mat.darkMetal);
      ring(distribution,`manifold fixing head ${side}/${z}`,[front+.026,.224,z],[front+.029,.224,z],0,.003,mat.metal);
    }
    const inlet=`head ${side}`;port(distribution,inlet,[front+.040,.216,0],[1,0,0]);
    ring(root,`regulated outlet ${side}`,[-.460,.228,side*.011],[-.460,.228,side*.020],.0015,.0025,mat.metal);
    const output=`regulated ${side}`;port(root,output,[-.460,.228,side*.020],[0,0,side]);connections.push(["regulator inlet",output]);
    const end=ports[inlet].point;
    pipe(root,`head feed ${side}`,[ports[output].point,[-.460,.228,side*.030],[-.405,.205,side*.065],[end[0]+.040,.170,side*.125],[end[0]+.035,end[1],end[2]],[end[0]+.020,end[1],end[2]],end],.0016,output,inlet,mat.black);
    for(const kind of["intake","exhaust"]){
      const sign=kind==="intake"?-side:side;
      const name=`Valve ${side} 0 ${kind} -1`,guide=core.getObjectByName(`${name} guide assembly`)!;
      guide.updateMatrix();const level=new T.Vector3(0,.0385,0).applyMatrix4(guide.matrix).y;
      const headerName=`header ${side} ${kind}`,header=ring(distribution,headerName,[first-.047,level,sign*.050],[manifoldX-.003,level,sign*.050],.0012,.0025,mat.metal);
      ring(distribution,`${headerName} rear plug`,[first-.047,level,sign*.050],[first-.0462,level,sign*.050],0,.0025,mat.darkMetal);
      drill(wall,[front-.002,level,sign*.050],[1,0,0],.0026);
      connections.push([inlet,headerName]);
      for(let cylinder=0;cylinder<3;cylinder++)for(const pair of[-1,1]){
        const stem=`Valve ${side} ${cylinder} ${kind} ${pair}`,guide=core.getObjectByName(`${stem} guide assembly`)!,chamber=core.getObjectByName(`${stem} pneumatic cylinder`) as T.Mesh;
        const cartridge=new T.Group();cartridge.name=`Pneumatic check cartridge ${stem}`;cartridge.position.copy(guide.position);cartridge.quaternion.copy(guide.quaternion);distribution.add(cartridge);
        drill(chamber,[0,.0385,0],[pair,0,0],.0009,true);
        ring(cartridge,`${stem} check body`,[pair*.010,.0385,0],[pair*.022,.0385,0],.0009,.0019,mat.metal);
        ring(cartridge,`${stem} check seat`,[pair*.0187,.0385,0],[pair*.0195,.0385,0],.00065,.0009,mat.darkMetal);
        const ball=add(cartridge,`${stem} check ball`,new T.SphereGeometry(.0008,12,8),mat.metal);ball.position.set(pair*.01795,.0385,0);
        spring(cartridge,`${stem} check spring`,[pair*.0125,.0385,0],[pair*.01715,.0385,0],.00045,.00012,4);
        guide.updateMatrix();const from=new T.Vector3(pair*.022,.0385,0).applyMatrix4(guide.matrix),to=new T.Vector3(guide.position.x+pair*.027,level,sign*.0475);
        const headerPort=`${stem} branch`,springPort=`${stem} spring`;
        port(distribution,headerPort,to.toArray() as V,[0,0,-sign]);port(distribution,springPort,from.toArray() as V,[pair,0,0]);connections.push([headerName,headerPort]);
        drill(header,[to.x,level,sign*.050],[0,0,-sign],.0009,true);
        // A formed elbow keeps a 4 mm bend radius; a sparse interpolated corner
        // pinched the tube immediately after its check-valve cartridge.
        const bend:V[]=[from.toArray() as V,from.clone().add(new T.Vector3(pair*.001,0,0)).toArray() as V];
        for(let j=1;j<=10;j++){const a=j*Math.PI/20;bend.push([from.x+pair*(.001+.004*Math.sin(a)),level,from.z+sign*.004*(1-Math.cos(a))]);}
        bend.push([to.x,level,sign*.041],to.toArray() as V);
        pipe(distribution,`${stem} branch`,bend,.0012,springPort,headerPort);
      }
      // Fixed header clamps seat on the casting's inner face, away from valves.
      for(const x of[first+.047,first+.148]){
        ring(distribution,`${headerName} clamp ${x}`,[x-.003,level,sign*.050],[x+.003,level,sign*.050],.0025,.0035,mat.darkMetal);
        box(distribution,`${headerName} clamp foot ${x}`,[x,level,sign*.0555],[.008,.006,.004],mat.cast);
      }
    }
  }
  root.userData.pneumaticPorts=ports;root.userData.pneumaticConnections=connections;
  return root;
}
