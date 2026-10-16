import * as T from "three";
import {createInvoluteGearProfile} from "./w17-engine-timing.ts";
import {openRadialPort} from "./w17-wastegate.ts";

type Materials=Record<"metal"|"cast"|"darkMetal"|"rubber",T.Material>;

// Reconstructed cam-end take-off, not a published Mercedes drive layout.
// The paired wheels have a fixed ratio; the existing pump and hose positions
// remain the installation datums rather than moving to suit the gear train.
export function connectLowTemperatureDrive(car:T.Group,cooling:T.Group,mat:Materials){
  car.updateMatrixWorld(true);
  const pump=car.getObjectByName("Low-temperature coolant pump")!;
  const cam=car.getObjectByName("Camshaft 1 intake")!;
  const camShaft=car.getObjectByName("Camshaft 1 intake shaft")!;
  const camPoint=cam.getWorldPosition(new T.Vector3()),pumpPoint=pump.getWorldPosition(new T.Vector3());
  const centres=[new T.Vector2(camPoint.y,camPoint.z),new T.Vector2(pumpPoint.y,pumpPoint.z)];
  const distance=centres[0].distanceTo(centres[1]),teeth=36,toothModule=distance/teeth,pitch=distance/2;
  const plane=-.350,width=.007,rear=plane-width/2,front=plane+width/2;
  const root=new T.Group();root.name="LT coolant pump geared drive";cooling.add(root);
  const steel=new T.MeshStandardMaterial({name:"LT pump drive steel",color:"#879096",metalness:.72,roughness:.42});
  const add=(parent:T.Object3D,name:string,g:T.BufferGeometry,material:T.Material=steel,cover=false)=>{
    const part=new T.Mesh(g,material);part.name=`LT drive ${name}`;
    part.userData={component:"cooling",coolantPump:"lt",pumpDrive:true,internal:true,serviceCover:cover};
    part.castShadow=part.receiveShadow=true;parent.add(part);return part;
  };
  const axial=(parent:T.Object3D,name:string,p:T.Vector2,a:number,b:number,inner:number,outer:number,material:T.Material=steel,cover=false)=>{
    const g=new T.LatheGeometry([[inner,a],[outer,a],[outer,b],[inner,b],[inner,a]].map(p=>new T.Vector2(...p)),48);
    g.rotateZ(-Math.PI/2);g.translate(0,p.x,p.y);return add(parent,name,g,material,cover);
  };
  const drill=(part:T.Mesh,p:T.Vector2,r:number)=>{
    part.updateWorldMatrix(true,false);
    const frame=new T.Matrix4().makeBasis(new T.Vector3(0,1,0),new T.Vector3(0,0,1),new T.Vector3(1,0,0));frame.setPosition(0,p.x,p.y);
    const transform=frame.invert().multiply(part.matrixWorld);part.geometry.applyMatrix4(transform);
    openRadialPort(part,[0,0],r,1,-.465,true,.155);part.geometry.applyMatrix4(transform.invert());part.geometry.computeVertexNormals();
  };
  const camEnd=new T.Box3().setFromObject(camShaft).max.x;
  const inputPhase=cam.parent!.getWorldQuaternion(new T.Quaternion());
  const inputAngle=new T.Euler().setFromQuaternion(inputPhase).x;
  const line=Math.atan2(centres[1].y-centres[0].y,centres[1].x-centres[0].x);
  const phases=[inputAngle,line+Math.PI-(Math.PI-teeth*(line-inputAngle))/teeth];
  const rotors=centres.map((p,i)=>{
    const rotor=new T.Group();rotor.name=`LT drive ${i?"pump":"cam"} rotor`;rotor.position.set(plane,p.x,p.y);
    rotor.userData={engineMotion:"accessoryGear",ratio:i?-.5:.5,phase:phases[i],teeth,pitchRadius:pitch,mate:i?"LT drive cam rotor":null,component:"cooling",coolantPump:"lt",pumpDrive:true};root.add(rotor);
    const shape=createInvoluteGearProfile(teeth,i?0:.003/(toothModule/.002));
    if(i)shape.holes=[];
    const g=new T.ExtrudeGeometry(shape,{depth:width,bevelEnabled:false,curveSegments:24});g.scale(toothModule/.002,toothModule/.002,1);g.translate(0,0,-width/2);
    g.applyMatrix4(new T.Matrix4().makeBasis(new T.Vector3(0,1,0),new T.Vector3(0,0,1),new T.Vector3(1,0,0)));
    add(rotor,`${i?"pump":"cam"} gear`,g);
    const bore=i?0:.003,radius=i?.0035:.007;
    // The pinion and its journals share end faces: no solid shaft intersects
    // the teeth, and the cam's hollow oil bore continues through its extension.
    axial(rotor,`${i?"pump":"cam"} rear journal`,new T.Vector2(),(i?-.365:camEnd)-plane,rear-plane,bore,radius);
    axial(rotor,`${i?"pump":"cam"} front journal`,new T.Vector2(),front-plane,(i?-.329:-.337)-plane,bore,radius);
    return rotor;
  });
  // The pump's rotating pieces share the output wheel's speed and phase. An
  // inverse frame keeps that rotation about the global longitudinal axis.
  const frame=new T.Group();frame.name="LT pump rotor frame";frame.rotation.z=Math.PI/2;pump.add(frame);
  const moving=new T.Group();moving.name="LT pump rotating assembly";frame.add(moving);
  moving.userData={engineMotion:"accessoryShaft",ratio:-.5,phase:phases[1],component:"cooling",coolantPump:"lt"};
  car.updateMatrixWorld(true);
  for(const part of [...pump.children])if(part instanceof T.Mesh&&/LT coolant pump (shaft$|drive coupling$|impeller |bearing inner race |rotating seal face$|seal bellows$|seal spring$|seal spring seat$)/.test(part.name))moving.attach(part);
  // A hollow extension carrier seats on the existing head's front wall.
  const head=car.getObjectByName("Head end wall 1 front") as T.Mesh;
  drill(head,centres[0],.0102);
  const headEnd=new T.Box3().setFromObject(head).max.x;
  const camSupport=car.getObjectByName("Cam bearing carrier 1 intake/3")!;
  const carrierStart=new T.Box3().setFromObject(camSupport).max.x;
  axial(root,"cam bearing carrier",centres[0],carrierStart,-.359,.0102,.014,mat.cast,true);
  const holes=(shape:T.Shape,p:T.Vector2,r:number)=>{const path=new T.Path();path.absarc(-p.y,p.x,r,0,Math.PI*2,true);shape.holes.push(path);};
  const hull=(points:T.Vector2[])=>{
    const sorted=points.sort((a,b)=>a.x-b.x||a.y-b.y),lo:T.Vector2[]=[],hi:T.Vector2[]=[];
    const turn=(a:T.Vector2,b:T.Vector2,c:T.Vector2)=>b.clone().sub(a).cross(c.clone().sub(a));
    for(const p of sorted){while(lo.length>1&&turn(lo.at(-2)!,lo.at(-1)!,p)<=0)lo.pop();lo.push(p);}
    for(const p of sorted.reverse()){while(hi.length>1&&turn(hi.at(-2)!,hi.at(-1)!,p)<=0)hi.pop();hi.push(p);}
    return [...lo.slice(0,-1),...hi.slice(0,-1)];
  };
  const outline=(gap:number)=>hull(centres.flatMap(p=>Array.from({length:64},(_,i)=>new T.Vector2(-p.y+Math.sin(i*Math.PI/32)*(pitch+toothModule+gap),p.x+Math.cos(i*Math.PI/32)*(pitch+toothModule+gap)))));
  const outer=outline(.008),inner=outline(.002),wall=new T.Shape(outer);wall.holes.push(new T.Path(inner.slice().reverse()));
  const screws:T.Vector2[]=[];
  for(let i=0;i<outer.length;i+=8){const a=outer[i],b=outer[(i+1)%outer.length],edge=b.clone().sub(a),p=a.clone().add(b).multiplyScalar(.5).addScaledVector(new T.Vector2(-edge.y,edge.x).normalize(),.003);screws.push(new T.Vector2(p.y,-p.x));}
  const casting=(name:string,shape:T.Shape,a:number,b:number)=>{const g=new T.ExtrudeGeometry(shape,{depth:b-a,bevelEnabled:false,curveSegments:24});g.rotateY(Math.PI/2);g.translate(a,0,0);return add(root,name,g,mat.cast,true);};
  for(const p of screws)holes(wall,p,.0016);
  casting("case perimeter",wall,-.355,-.345);
  for(const [name,a,b]of[["rear",-.359,-.355],["front",-.345,-.341]] as const){
    const shape=new T.Shape(outer);centres.forEach((p,i)=>holes(shape,p,i?.0075:.012));for(const p of screws)holes(shape,p,.0016);
    casting(`case ${name} cover`,shape,a,b);
  }
  for(const [i,p]of screws.entries()){
    axial(root,`case screw ${i}`,p,-.359,-.339,0,.0015,mat.darkMetal,true);
    axial(root,`case screw head ${i}`,p,-.341,-.338,.0007,.0027,steel,true);
  }
  centres.forEach((p,i)=>{
    const shaft=i?.0035:.007,inner=i?.0046:.0085,outer=i?.0065:.0105,seat=i?.0075:.012;
    for(const x of[-.357,-.343]){
      axial(rotors[i],`${i?"pump":"cam"} bearing inner ${x}`,new T.Vector2(),x-.002-plane,x+.002-plane,shaft,inner);
      axial(root,`${i?"pump":"cam"} bearing outer ${x}`,p,x-.002,x+.002,outer,seat);
      for(let j=0;j<12;j++){
        const angle=j*Math.PI/6,r=(inner+outer)/2,ball=add(root,`${i?"pump":"cam"} bearing ball ${x}/${j}`,new T.SphereGeometry((outer-inner)/2-.00005,8,6));ball.position.set(x,p.x+Math.cos(angle)*r,p.y+Math.sin(angle)*r);
      }
      for(const side of[-1,1])axial(root,`${i?"pump":"cam"} bearing cage ${x}/${side}`,p,x+side*.0014-.0002,x+side*.0014+.0002,inner+.0002,outer-.0002,mat.darkMetal);
    }
    for(const [label,a,b]of[["rear shoulder",-.355,rear],["front shoulder",front,-.345],["rear retainer",-.361,-.359],["front retainer",-.341,-.339]] as const){
      axial(rotors[i],`${i?"pump":"cam"} ${label}`,new T.Vector2(),a-plane,b-plane,shaft,inner,steel);
    }
    axial(root,`${i?"pump":"cam"} outer race retainer`,p,-.341,-.339,outer+.0001,seat+.002,steel,true);
    axial(root,`${i?"pump":"cam"} front seal`,p,-.341,-.339,inner+.0001,outer+.0001,mat.rubber,true);
  });
  // Opposed bolt lugs mount the hollow carrier to the head, not to a cover
  // floating in space. The stem's outer end supports the case's rear bearing.
  for(const sign of[-1,1]){
    const offset=new T.Vector2(-Math.sin(Math.PI/4),Math.cos(Math.PI/4)).multiplyScalar(sign*.018),p=centres[0].clone().add(offset);
    axial(root,`head mounting ear ${sign}`,p,headEnd,carrierStart+.005,.0021,.0042,mat.cast,true);
    const brace=new T.BoxGeometry(.005,.006,.014);brace.rotateX(Math.PI/4);
    brace.translate(carrierStart+.0025,centres[0].x+offset.x*.7,centres[0].y+offset.y*.7);
    const rib=add(root,`head mounting rib ${sign}`,brace,mat.cast,true);drill(rib,centres[0],.0102);drill(rib,p,.0021);
    drill(head,p,.0021);axial(root,`head mounting bolt ${sign}`,p,headEnd-.004,carrierStart+.007,0,.002,mat.darkMetal,true);axial(root,`head bolt head ${sign}`,p,carrierStart+.005,carrierStart+.008,.0009,.0035,steel,true);
  }
  axial(root,"pump coupling sleeve",centres[1],-.339,-.329,.0036,.006,mat.darkMetal,true);
  axial(root,"cam front cap",centres[0],-.339,-.334,.0071,.014,mat.cast,true);
  axial(root,"cam cap end",centres[0],-.334,-.331,0,.014,mat.cast,true);
  axial(root,"pump rear cap",centres[1],-.367,-.359,.0066,.009,mat.cast,true);
  axial(root,"pump rear cap end",centres[1],-.370,-.367,0,.009,mat.cast,true);
  root.userData={centres:centres.map(p=>p.toArray()),camEnd,headEnd,carrierStart,plane,toothModule,teeth,rotors:rotors.map(p=>p.name)};
  car.updateMatrixWorld(true);
}
