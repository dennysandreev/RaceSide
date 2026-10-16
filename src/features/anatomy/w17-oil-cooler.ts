import * as T from "three";
import {mergeGeometries} from "three/addons/utils/BufferGeometryUtils.js";

type Materials=Record<"metal"|"cast"|"darkMetal"|"rubber",T.Material>;

// A reconstructed brazed bar/plate oil core. The oil passages run along X;
// separate corrugated air passages run along Z. Mercedes's hidden core size,
// channel count, mounting bosses and installation are not public drawings.
export function createOilCooler(mat:Materials){
  const root=new T.Group();root.name="Oil heat exchanger";
  root.position.set(-.53,.507,-.348);root.rotation.x=-.18;
  const add=(name:string,g:T.BufferGeometry,material:T.Material,cover=false)=>{
    const p=new T.Mesh(g,material);p.name=name;p.userData={component:"cooling",serviceCover:cover,oilCooler:true};
    p.castShadow=p.receiveShadow=true;root.add(p);return p;
  };
  const rectangle=(x:number,y:number)=>new T.Shape([new T.Vector2(-x,-y),new T.Vector2(x,-y),new T.Vector2(x,y),new T.Vector2(-x,y)]);
  const extrude=(shape:T.Shape,depth:number)=>new T.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:24});
  const box=(name:string,p:[number,number,number],size:[number,number,number],material=mat.cast,cover=false)=>{
    const g=new T.BoxGeometry(...size);g.translate(...p);return add(name,g,material,cover);
  };
  const ring=(name:string,x:number,z:number,a:number,b:number,inner:number,outer:number,material:T.Material)=>{
    const g=new T.LatheGeometry([[inner,a],[outer,a],[outer,b],[inner,b],[inner,a]].map(p=>new T.Vector2(...p)),32);
    g.translate(x,0,z);return add(name,g,material);
  };
  // 96 communicating oil passages, with actual separator webs between them.
  // The section's X maps to -Z when extruded along the cooler's X axis.
  const section=rectangle(.045,.0015);
  for(let channel=0;channel<8;channel++){
    const z=(channel-3.5)*.0108,h=new T.Path();
    h.moveTo(z-.0049,-.0009);h.lineTo(z-.0049,.0009);h.lineTo(z+.0049,.0009);h.lineTo(z+.0049,-.0009);h.closePath();section.holes.push(h);
  }
  const plates:T.BufferGeometry[]=[];
  for(let row=0;row<12;row++){
    const g=extrude(section,.174);g.rotateY(Math.PI/2);g.translate(-.087,row*.005,0);plates.push(g);
  }
  add("Oil cooler plate stack",mergeGeometries(plates)!,mat.metal);plates.forEach(g=>g.dispose());
  const folds:T.Vector2[]=[];
  for(let i=0;i<=86;i++)folds.push(new T.Vector2(-.086+i*.002,(i%2?1:-1)*.00085));
  const ribbon=new T.Shape([...folds.map(p=>new T.Vector2(p.x,p.y-.00015)),...folds.slice().reverse().map(p=>new T.Vector2(p.x,p.y+.00015))]);
  const fins:T.BufferGeometry[]=[];
  for(let row=0;row<11;row++){const g=extrude(ribbon,.086);g.translate(0,row*.005+.0025,-.043);fins.push(g);}
  add("Oil cooler folded air fins",mergeGeometries(fins)!,mat.metal);fins.forEach(g=>g.dispose());
  box("Oil cooler bottom guard",[0,-.00225,0],[.176,.0015,.090]);
  box("Oil cooler top guard",[0,.05725,0],[.176,.0015,.090],mat.cast,true);
  for(const side of[-1,1]){
    const plate=rectangle(.048,.032);
    for(let row=0;row<12;row++)for(let channel=0;channel<8;channel++){
      const z=(channel-3.5)*.0108,y=row*.005-.028,h=new T.Path();
      h.moveTo(z-.0049,y-.0009);h.lineTo(z-.0049,y+.0009);h.lineTo(z+.0049,y+.0009);h.lineTo(z+.0049,y-.0009);h.closePath();plate.holes.push(h);
    }
    const tubePlate=extrude(plate,.002);tubePlate.rotateY(Math.PI/2);tubePlate.translate(side*.087-.001,.028,0);
    add(`Oil cooler tube plate ${side}`,tubePlate,mat.cast);
    const back=rectangle(.048,.032),bore=new T.Path();bore.absarc(0,0,.008,0,Math.PI*2,true);back.holes.push(bore);
    const wall=extrude(back,.002);wall.rotateY(Math.PI/2);wall.translate(side*.112-.001,.028,0);
    add(`Oil cooler header ${side} port wall`,wall,mat.cast,true);
    for(const y of[-.003,.059])box(`Oil cooler header ${side} rail ${y}`,[side*.100,y,0],[.026,.002,.096]);
    for(const z of[-.047,.047])box(`Oil cooler header ${side} end ${z}`,[side*.100,.028,z],[.026,.060,.002]);
    for(const z of[-.062,.062]){
      // The four ears are outside the oil cavity. Bush sleeves and bolts go
      // through the ears, not into the thin pressure-containing header walls.
      const ear=rectangle(.011,.015),hole=new T.Path();hole.absarc(0,z>0?-.002:.002,.0045,0,Math.PI*2,true);ear.holes.push(hole);
      const g=extrude(ear,.004);g.rotateX(-Math.PI/2);g.translate(side*.100,-.008,z>0?.060:-.060);
      add(`Oil cooler mounting ear ${side} ${Math.sign(z)}`,g,mat.cast);
      ring(`Oil cooler rubber bush ${side} ${Math.sign(z)}`,side*.100,z,-.021,-.002,.0025,.0045,mat.rubber);
      for(const y of[-.010,-.004])ring(`Oil cooler rubber shoulder ${side} ${Math.sign(z)} ${y}`,side*.100,z,y,y+.002,.0025,.006,mat.rubber);
      ring(`Oil cooler mounting sleeve ${side} ${Math.sign(z)}`,side*.100,z,-.021,-.002,.0016,.0025,mat.metal);
      ring(`Oil cooler mounting bolt ${side} ${Math.sign(z)}`,side*.100,z,-.030,.003,0,.0015,mat.darkMetal);
      ring(`Oil cooler mounting washer ${side} ${Math.sign(z)}`,side*.100,z,-.002,0,.0016,.006,mat.metal);
      ring(`Oil cooler bolt head ${side} ${Math.sign(z)}`,side*.100,z,0,.003,.0008,.003,mat.darkMetal);
      ring(`Oil cooler retaining nut ${side} ${Math.sign(z)}`,side*.100,z,-.030,-.025,.0016,.0035,mat.darkMetal);
    }
    const bar=rectangle(.011,.074);
    for(const z of[-.062,.062]){const h=new T.Path();h.absarc(0,z,.0016,0,Math.PI*2,true);bar.holes.push(h);}
    const g=extrude(bar,.004);g.rotateX(-Math.PI/2);g.translate(side*.100,-.025,0);
    add(`Oil cooler support crossbar ${side}`,g,mat.cast);
  }
  return root;
}

// Keep installation separate from the core. Seats use the existing head bank
// frame and leave the exhaust/valve cover untouched. All bosses are blind, so
// the retaining bolts do not open an oil passage into the head's interior.
export function seatOilCooler(root:T.Group,mat:Materials){
  root.updateMatrixWorld(true);
  const cooler=root.getObjectByName("Oil heat exchanger")!,head=root.getObjectByName("Cylinder head housing -1")!;
  const headPoint=(x:number,y:number,z:number)=>new T.Vector3(x,y,z).applyMatrix4(head.matrixWorld);
  const cooling=root.getObjectByName("cooling")!,engine=root.getObjectByName("engine")!;
  const add=(parent:T.Object3D,name:string,g:T.BufferGeometry,material:T.Material)=>{
    const mesh=new T.Mesh(g,material);mesh.name=name;mesh.userData={component:parent===engine?"engine":"cooling",internal:true,oilCoolerMount:true,serviceCover:parent===engine};
    mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  for(const [side,x]of[[-1,-.670],[1,-.485]]){
    const foot=new T.Shape([new T.Vector2(x-.014,.265),new T.Vector2(x+.014,.265),new T.Vector2(x+.014,.283),new T.Vector2(x-.014,.283)]);
    for(const dx of[-.008,.008]){const h=new T.Path();h.absarc(x+dx,.274,.0016,0,Math.PI*2,true);foot.holes.push(h);}
    const fg=new T.ExtrudeGeometry(foot,{depth:.003,bevelEnabled:false,curveSegments:24});fg.translate(0,0,-.082);fg.applyMatrix4(head.matrixWorld);
    add(cooling,`Oil cooler support foot ${side}`,fg,mat.cast);
    const start=headPoint(x,.274,-.083),end=new T.Vector3(side*.100,-.023,.030).applyMatrix4(cooler.matrixWorld);
    const route=[start,new T.Vector3(x,.341,-.280),end];
    const strut=add(cooling,`Oil cooler support strut ${side}`,new T.TubeGeometry(new T.CatmullRomCurve3(route,false,"centripetal"),32,.0035,12,false),mat.cast);
    strut.userData.mountRoute=route.map(p=>p.toArray());strut.userData.mountRadius=.0035;
    for(const dx of[-.008,.008]){
      const axial=(name:string,a:number,b:number,inner:number,outer:number,material:T.Material,parent:T.Object3D)=>{
        const g=new T.LatheGeometry([[inner,a],[outer,a],[outer,b],[inner,b],[inner,a]].map(p=>new T.Vector2(...p)),32);
        g.rotateX(Math.PI/2);g.translate(x+dx,.274,0);g.applyMatrix4(head.matrixWorld);
        return add(parent,`Oil cooler ${name} ${side} ${dx}`,g,material);
      };
      axial("head boss base",-.071,-.0605,0,.0045,mat.cast,engine);
      axial("head boss",-.079,-.071,.0016,.0045,mat.cast,engine);
      axial("head mounting bolt",-.087,-.0715,0,.0015,mat.darkMetal,cooling);
      axial("head mounting washer",-.084,-.082,.0016,.0035,mat.metal,cooling);
      axial("head mounting bolt head",-.087,-.084,.0008,.003,mat.darkMetal,cooling);
    }
  }
}
