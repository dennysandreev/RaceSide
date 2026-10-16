import * as T from "three";
import {createInvoluteGearProfile} from "./w17-engine-timing.ts";
import {servicePassage} from "./w17-feedthrough.ts";

type Materials=Record<"metal"|"cast"|"darkMetal"|"rubber",T.Material>;
type Gear={name:string;centre:T.Vector2;teeth:number;ratio:number;phase:number;side:number|"main";mate?:string};

// A reconstructed front accessory cassette, not a published M17 gear layout.
// The existing pump axes and all coolant hose connections are retained.
export function connectMainCoolantDrives(car:T.Group,cooling:T.Group,engine:T.Group,section:T.Shape,mat:Materials){
  car.updateMatrixWorld(true);
  const crank=car.getObjectByName("V6 crank and piston assembly")!,height=crank.position.y;
  const plane=-.3375,width=.007,rear=plane-width/2,front=plane+width/2;
  const root=new T.Group();root.name="Main coolant pump transmission";cooling.add(root);
  const steel=new T.MeshStandardMaterial({name:"Coolant transmission steel",color:"#879096",metalness:.72,roughness:.42});
  const add=(parent:T.Object3D,name:string,g:T.BufferGeometry,material:T.Material=steel,cover=false,side:number|"main"="main")=>{
    const p=new T.Mesh(g,material);p.name=`Coolant drive ${name}`;
    p.userData={component:"cooling",internal:true,pumpDrive:true,coolantPump:side,serviceCover:cover};p.castShadow=p.receiveShadow=true;parent.add(p);return p;
  };
  const axial=(parent:T.Object3D,name:string,c:T.Vector2,a:number,b:number,inner:number,outer:number,material:T.Material=steel,cover=false,side:number|"main"="main")=>{
    const g=new T.LatheGeometry([[inner,a],[outer,a],[outer,b],[inner,b],[inner,a]].map(p=>new T.Vector2(...p)),48);
    g.rotateZ(-Math.PI/2);g.translate(0,c.x,c.y);return add(parent,name,g,material,cover,side);
  };
  const gears:Gear[]=[{name:"crank",centre:new T.Vector2(height,0),teeth:44,ratio:1,phase:0,side:"main"}];
  const mate=(parent:Gear,name:string,centre:T.Vector2,teeth:number,side:number)=>{
    const line=Math.atan2(centre.y-parent.centre.y,centre.x-parent.centre.x);
    const gear={name,centre,teeth,ratio:-parent.ratio*parent.teeth/teeth,phase:line+Math.PI-(Math.PI-parent.teeth*(line-parent.phase))/teeth,side,mate:parent.name};gears.push(gear);return gear;
  };
  for(const side of[-1,1]){
    const pump=car.getObjectByName(`Main coolant pump ${side}`)!,p=pump.getWorldPosition(new T.Vector3()),target=new T.Vector2(p.y,p.z);
    const delta=target.clone().sub(gears[0].centre),d=delta.length(),a=.094,b=.082,t=(a*a-b*b+d*d)/(2*d),h=Math.sqrt(a*a-t*t),axis=delta.divideScalar(d);
    const c=gears[0].centre.clone().addScaledVector(axis,t).addScaledVector(new T.Vector2(-axis.y,axis.x),-side*h);
    const idler=mate(gears[0],`idler ${side}`,c,50,side),output=mate(idler,`pump ${side}`,target,32,side);
    const frame=new T.Group();frame.name=`Coolant pump ${side} rotor frame`;frame.rotation.z=Math.PI/2;pump.add(frame);
    const moving=new T.Group();moving.name=`Coolant pump ${side} rotating assembly`;frame.add(moving);
    moving.userData={engineMotion:"accessoryShaft",ratio:output.ratio,phase:output.phase,component:"cooling",coolantPump:side};
    car.updateMatrixWorld(true);
    for(const part of [...pump.children])if(part.name===`Coolant pump ${side} impeller`||new RegExp(`^Coolant pump ${side} (shaft$|drive coupling$|bearing inner race |rotating seal face$|seal bellows$|seal spring$|seal spring seat$)`).test(part.name))moving.attach(part);
  }
  const hull=(points:T.Vector2[])=>{
    const sorted=points.sort((a,b)=>a.x-b.x||a.y-b.y),lo:T.Vector2[]=[],hi:T.Vector2[]=[];
    const turn=(a:T.Vector2,b:T.Vector2,c:T.Vector2)=>b.clone().sub(a).cross(c.clone().sub(a));
    for(const p of sorted){while(lo.length>1&&turn(lo.at(-2)!,lo.at(-1)!,p)<=0)lo.pop();lo.push(p);}
    for(const p of sorted.reverse()){while(hi.length>1&&turn(hi.at(-2)!,hi.at(-1)!,p)<=0)hi.pop();hi.push(p);}
    return [...lo.slice(0,-1),...hi.slice(0,-1)];
  };
  const outline=(gap:number)=>hull(gears.flatMap(g=>Array.from({length:64},(_,i)=>{const a=i*Math.PI/32,r=g.teeth*.001+.002+gap;return new T.Vector2(-g.centre.y+Math.sin(a)*r,g.centre.x+Math.cos(a)*r);})));
  const outside=outline(.010),inside=outline(.003);
  const hole=(s:T.Shape,p:T.Vector2,r:number)=>{const h=new T.Path();h.absarc(-p.y,p.x,r,0,Math.PI*2,true);s.holes.push(h);};
  const casting=(name:string,shape:T.Shape,a:number,b:number)=>{const g=new T.ExtrudeGeometry(shape,{depth:b-a,bevelEnabled:false,curveSegments:24});g.rotateY(Math.PI/2);g.translate(a,0,0);return add(root,name,g,mat.cast,true);};
  const screws:T.Vector2[]=[];
  for(let i=0;i<outside.length;i+=Math.ceil(outside.length/16)){
    const a=outside[i],b=outside[(i+1)%outside.length],edge=b.clone().sub(a),p=a.clone().add(b).multiplyScalar(.5).addScaledVector(new T.Vector2(-edge.y,edge.x).normalize(),.0035);screws.push(new T.Vector2(p.y,-p.x));
  }
  const mounts=[new T.Vector2(.132,-.100),new T.Vector2(.132,.100),new T.Vector2(.119,-.070),new T.Vector2(.119,.070)];
  const wall=new T.Shape(outside);wall.holes.push(new T.Path(inside.slice().reverse()));for(const p of screws)hole(wall,p,.0016);
  casting("case perimeter",wall,-.345,-.330);
  for(const [name,a,b]of[["rear",-.349,-.345],["front",-.330,-.326]] as const){
    const s=new T.Shape(outside);for(const g of gears)hole(s,g.centre,g.name==="crank"?.0228:g.name.startsWith("idler")?.0051:.009);
    for(const p of screws)hole(s,p,.0016);if(name==="rear")for(const p of mounts)hole(s,p,.0045);
    casting(`case ${name} cover`,s,a,b);
  }
  for(const [i,p]of screws.entries()){
    axial(root,`case screw ${i}`,p,-.349,-.324,0,.0015,mat.darkMetal,true);
    axial(root,`case screw head ${i}`,p,-.326,-.323,.0007,.0027,steel,true);
  }
  for(const gear of gears){
    const idler=gear.name.startsWith("idler"),input=gear.name==="crank",bore=input?.0226:idler?.010:0;
    const rotor=new T.Group();rotor.name=`Coolant drive gear ${gear.name}`;rotor.position.set(plane,gear.centre.x,gear.centre.y);
    rotor.userData={engineMotion:"accessoryGear",ratio:gear.ratio,phase:gear.phase,teeth:gear.teeth,pitchRadius:gear.teeth*.001,mate:gear.mate?`Coolant drive gear ${gear.mate}`:null,component:"cooling",coolantPump:gear.side,pumpDrive:true};root.add(rotor);
    const shape=createInvoluteGearProfile(gear.teeth,bore);if(!bore)shape.holes=[];
    if(input){const key=new T.Path(),angle=Math.asin(.0021/bore);key.absarc(0,0,bore,angle,Math.PI*2-angle,false);key.lineTo(.0241,-.0021);key.lineTo(.0241,.0021);key.closePath();shape.holes=[key];}
    const g=new T.ExtrudeGeometry(shape,{depth:width,bevelEnabled:false,curveSegments:24});g.translate(0,0,-width/2);g.applyMatrix4(new T.Matrix4().makeBasis(new T.Vector3(0,1,0),new T.Vector3(0,0,1),new T.Vector3(1,0,0)));
    add(rotor,`${gear.name} teeth`,g,steel,false,gear.side);
    const p=gear.centre,local=new T.Vector2();
    if(input){
      const key=add(rotor,"crank key",new T.BoxGeometry(width,.003,.004),steel);key.position.y=.0225;
      // Match the actual round shaft section, including its polygon vertices.
      // A separately sampled round bore would cross the shaft's flat facets.
      const shaft=car.getObjectByName("Crank main-axis section 3") as T.Mesh,sp=shaft.geometry.attributes.position;
      shaft.geometry.computeBoundingBox();const end=shaft.geometry.boundingBox!.max.x,points=new Map<string,T.Vector2>();
      for(let i=0;i<sp.count;i++)if(Math.abs(sp.getX(i)-end)<1e-7&&Math.hypot(sp.getY(i),sp.getZ(i))>.01)points.set(`${sp.getY(i)},${sp.getZ(i)}`,new T.Vector2(sp.getY(i),sp.getZ(i)));
      const bore=[...points.values()].sort((a,b)=>Math.atan2(a.y,a.x)-Math.atan2(b.y,b.x));
      for(const [name,a,b]of[["crank rear shoulder",-.343,rear],["crank retaining collar",front,-.332]] as const){
        const shape=new T.Shape();shape.absarc(0,0,.027,0,Math.PI*2,false);shape.holes.push(new T.Path(bore.slice().reverse()));
        const g=new T.ExtrudeGeometry(shape,{depth:b-a,bevelEnabled:false,curveSegments:24});g.translate(0,0,a-plane);
        g.applyMatrix4(new T.Matrix4().makeBasis(new T.Vector3(0,1,0),new T.Vector3(0,0,1),new T.Vector3(1,0,0)));add(rotor,name,g,steel);
      }
      for(const [a,b]of[[-.349,-.345],[-.330,-.326]])axial(root,`crank seal ${a}`,p,a,b,.02255,.0228,mat.rubber,true);
    }else if(idler){
      axial(root,`${gear.name} spindle`,p,-.352,-.323,0,.005,mat.darkMetal,false,gear.side);
      axial(root,`${gear.name} inner race`,p,rear,front,.0051,.0065,steel,false,gear.side);
      axial(rotor,`${gear.name} outer race`,local,-width/2,width/2,.009,.010,steel,false,gear.side);
      for(let i=0;i<12;i++){const a=i*Math.PI/6,ball=add(root,`${gear.name} ball ${i}`,new T.SphereGeometry(.0012,8,6),steel,false,gear.side);ball.position.set(plane,p.x+Math.cos(a)*.00775,p.y+Math.sin(a)*.00775);}
      for(const sign of[-1,1])axial(root,`${gear.name} bearing cage ${sign}`,p,plane+sign*.0028-.0002,plane+sign*.0028+.0002,.0067,.0088,mat.darkMetal,false,gear.side);
      for(const [a,b]of[[rear-.001,rear],[front,front+.001]])axial(root,`${gear.name} thrust washer ${a}`,p,a,b,.0051,.012,steel,false,gear.side);
      for(const [a,b]of[[-.352,-.349],[-.326,-.323]])axial(root,`${gear.name} spindle head ${a}`,p,a,b,.002,.008,steel,true,gear.side);
    }else{
      axial(rotor,`${gear.name} rear journal`,local,-.351-plane,rear-plane,0,.0045,steel,false,gear.side);
      axial(rotor,`${gear.name} front journal`,local,front-plane,-.301-plane,0,.0045,steel,false,gear.side);
      for(const x of[-.347,-.328]){
        axial(rotor,`${gear.name} bearing inner ${x}`,local,x-.002-plane,x+.002-plane,.0045,.0058,steel,false,gear.side);
        axial(root,`${gear.name} bearing outer ${x}`,p,x-.002,x+.002,.0082,.009,steel,false,gear.side);
        for(let i=0;i<12;i++){const a=i*Math.PI/6,ball=add(root,`${gear.name} bearing ball ${x}/${i}`,new T.SphereGeometry(.00115,8,6),steel,false,gear.side);ball.position.set(x,p.x+Math.cos(a)*.007,p.y+Math.sin(a)*.007);}
        for(const sign of[-1,1])axial(root,`${gear.name} bearing cage ${x}/${sign}`,p,x+sign*.0016-.0002,x+sign*.0016+.0002,.006,.008,mat.darkMetal,false,gear.side);
      }
      for(const [a,b]of[[-.351,-.349],[-.345,rear],[front,-.330],[-.326,-.324]])axial(rotor,`${gear.name} shaft shoulder ${a}`,local,a-plane,b-plane,.0045,.0058,steel,false,gear.side);
      axial(root,`${gear.name} rear cap`,p,-.355,-.349,.0083,.012,mat.cast,true,gear.side);
      axial(root,`${gear.name} rear cap end`,p,-.357,-.355,0,.012,mat.cast,true,gear.side);
      axial(root,`${gear.name} front retainer`,p,-.326,-.324,.0083,.012,mat.cast,true,gear.side);
      axial(root,`${gear.name} front seal`,p,-.326,-.324,.0059,.0083,mat.rubber,true,gear.side);
      if(gear.side===1){
        axial(root,"right pump quill rear sleeve",p,-.324,-.317,.0046,.006,mat.cast,true,gear.side);
        axial(root,"right pump quill tube",p,-.317,-.304,.0046,.0051,mat.cast,true,gear.side);
        axial(root,"right pump quill front register",p,-.304,-.300,.0062,.0142,mat.cast,true,gear.side);
      }else axial(root,"left pump quill sleeve",p,-.324,-.301,.0046,.006,mat.cast,true,gear.side);
    }
  }
  // Retain the bank casting around the cassette instead of cutting a broad
  // opening through the complete engine block. Cylinder seats are farther aft.
  const block=car.getObjectByName("Cast V6 crankcase") as T.Mesh,position=block.geometry.attributes.position;
  for(let i=0;i<position.count;i++)if(position.getX(i)>-.349)position.setX(i,-.349);
  position.needsUpdate=true;block.geometry.computeVertexNormals();block.geometry.computeBoundingBox();block.geometry.computeBoundingSphere();
  const blank=new T.ExtrudeGeometry(section,{depth:.028,bevelEnabled:false});blank.rotateY(Math.PI/2);blank.translate(-.349,block.position.y,0);blank.rotateY(-Math.PI/2);
  const bridge=servicePassage(blank,outline(.0101));blank.dispose();bridge.rotateY(Math.PI/2);
  const extension=new T.Mesh(bridge,mat.cast);extension.name="Front crankcase coolant-drive bridge";extension.userData={component:"engine",internal:true,serviceCover:true};extension.castShadow=extension.receiveShadow=true;engine.add(extension);
  for(const [i,p]of mounts.entries()){
    const boss=axial(engine,`engine mounting boss ${i}`,p,-.349,-.345,.0021,.0045,mat.cast,true);boss.userData.component="engine";delete boss.userData.coolantPump;
    axial(root,`mounting bolt ${i}`,p,-.348,-.342,0,.002,mat.darkMetal,true);
    axial(root,`mounting washer ${i}`,p,-.345,-.344,.0021,.006,steel,true);
    axial(root,`mounting bolt head ${i}`,p,-.344,-.342,.0009,.0035,steel,true);
  }
  root.userData={plane,teeth:gears.map(g=>g.teeth),mounts:mounts.map(p=>p.toArray()),outside:outside.map(p=>p.toArray())};car.updateMatrixWorld(true);
}
