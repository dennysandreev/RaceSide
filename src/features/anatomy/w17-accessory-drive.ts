import * as T from "three";
import {createInvoluteGearProfile} from "./w17-engine-timing.ts";
import {openRadialPort} from "./w17-wastegate.ts";

type Materials=Record<"metal"|"cast"|"darkMetal"|"rubber",T.Material>;
type Gear={name:string;centre:T.Vector2;teeth:number;phase:number;ratio:number;mate?:string};

// The FIA requires parallel axes and a permanent fixed-ratio crank connection.
// This four-wheel train, its 22:15 ratio and casting are a reconstruction;
// Mercedes has not published the M17 transmission's internal dimensions.
export function createMotorTransmission(crankHeight:number,motor:T.Group,core:T.Group,engineCover:T.Mesh,mat:Materials){
  const root=new T.Group();root.name="MGU-K geared transmission";
  const x=-.310,width=.008,toothModule=.002;
  const gears:Gear[]=[{name:"crank",centre:new T.Vector2(crankHeight,0),teeth:44,phase:0,ratio:1}];
  const mate=(name:string,centre:T.Vector2,teeth:number)=>{
    const a=gears.at(-1)!,line=Math.atan2(centre.y-a.centre.y,centre.x-a.centre.x);
    const gear={name,centre,teeth,phase:line+Math.PI-(Math.PI-a.teeth*(line-a.phase))/teeth,ratio:-a.ratio*a.teeth/teeth,mate:a.name};
    gears.push(gear);return gear;
  };
  const rise=.034;
  const first=mate("inner idler",new T.Vector2(crankHeight+rise,Math.sqrt(.094**2-rise**2)),50);
  const target=new T.Vector2(motor.position.y,motor.position.z),delta=target.clone().sub(first.centre),distance=delta.length();
  // The lower idler leaves a full-radius passage for the coolant-pump shaft
  // above it. Changing an idler's tooth count retains the crank/motor ratio.
  const outerTeeth=42,innerSpacing=(first.teeth+outerTeeth)*toothModule/2,outerSpacing=(30+outerTeeth)*toothModule/2;
  const along=(innerSpacing**2-outerSpacing**2+distance**2)/(2*distance),offset=Math.sqrt(innerSpacing**2-along**2),axis=delta.divideScalar(distance);
  mate("outer idler",first.centre.clone().addScaledVector(axis,along).addScaledVector(new T.Vector2(-axis.y,axis.x),offset),outerTeeth);
  const output=mate("motor",target,30);
  const rotor=motor.getObjectByName("MGU-K rotor assembly")!;
  rotor.userData={...rotor.userData,engineMotion:"accessoryShaft",ratio:output.ratio,phase:output.phase};
  const steel=new T.MeshStandardMaterial({name:"MGU-K transmission steel",color:"#879096",metalness:.72,roughness:.42});
  const add=(parent:T.Object3D,name:string,g:T.BufferGeometry,material:T.Material=mat.metal,cover=false)=>{
    const part=new T.Mesh(g,material);part.name=name;
    part.userData={component:"mguk",internal:true,motorTransmission:true,serviceCover:cover};
    part.castShadow=part.receiveShadow=true;parent.add(part);return part;
  };
  const axial=(parent:T.Object3D,name:string,p:T.Vector2,a:number,b:number,inner:number,outer:number,material:T.Material=mat.metal,cover=false)=>{
    const g=new T.LatheGeometry([[inner,a],[outer,a],[outer,b],[inner,b],[inner,a]].map(p=>new T.Vector2(...p)),32);
    g.rotateZ(-Math.PI/2);g.translate(0,p.x,p.y);return add(parent,name,g,material,cover);
  };
  const hull=(points:T.Vector2[])=>{
    const sorted=points.sort((a,b)=>a.x-b.x||a.y-b.y),lower:T.Vector2[]=[],upper:T.Vector2[]=[];
    const cross=(a:T.Vector2,b:T.Vector2,c:T.Vector2)=>b.clone().sub(a).cross(c.clone().sub(a));
    for(const p of sorted){while(lower.length>1&&cross(lower.at(-2)!,lower.at(-1)!,p)<=0)lower.pop();lower.push(p);}
    for(const p of sorted.reverse()){while(upper.length>1&&cross(upper.at(-2)!,upper.at(-1)!,p)<=0)upper.pop();upper.push(p);}
    return [...lower.slice(0,-1),...upper.slice(0,-1)];
  };
  const outline=(gap:number)=>hull(gears.flatMap(g=>Array.from({length:64},(_,i)=>{
    const angle=i*Math.PI/32,r=g.teeth*toothModule/2+toothModule+gap;
    return new T.Vector2(-g.centre.y+Math.sin(angle)*r,g.centre.x+Math.cos(angle)*r);
  })));
  const outer=outline(.010),inner=outline(.003);
  const mounts=[new T.Vector2(.195,0),new T.Vector2(.106,0),new T.Vector2(.214,.116),new T.Vector2(.130,.125)];
  const hole=(shape:T.Shape,p:T.Vector2,r:number)=>{const bore=new T.Path();bore.absarc(-p.y,p.x,r,0,Math.PI*2,true);shape.holes.push(bore);};
  const casting=(name:string,shape:T.Shape,a:number,b:number)=>{
    const g=new T.ExtrudeGeometry(shape,{depth:b-a,bevelEnabled:false,curveSegments:32});g.rotateY(Math.PI/2);g.translate(a,0,0);
    return add(root,name,g,mat.cast,true);
  };
  // The narrow case fits between the motor end shield and the pump drive ends.
  // Its rear plate seats directly on the shortened front crankcase casting.
  const wallShape=new T.Shape(outer);wallShape.holes.push(new T.Path(inner.slice().reverse()));
  const screws:T.Vector2[]=[];
  for(let i=0;i<outer.length;i+=Math.ceil(outer.length/12)){
    const a=outer[i],b=outer[(i+1)%outer.length],edge=b.clone().sub(a),p=a.clone().add(b).multiplyScalar(.5).addScaledVector(new T.Vector2(-edge.y,edge.x).normalize(),.0035);
    screws.push(new T.Vector2(p.y,-p.x));
  }
  for(const p of screws)hole(wallShape,p,.0018);
  casting("MGU-K accessory transmission",wallShape,-.317,-.304);
  for(const [name,a,b]of[["rear",-.321,-.317],["front",-.304,-.300]] as const){
    const shape=new T.Shape(outer);
    for(const g of gears)hole(shape,g.centre,g.name==="crank"?.0228:g.name==="motor"?(name==="front"?.015:.0106):.0061);
    // The existing coolant-pump quill enters the original engine front plate.
    // This neighbouring cover must leave that passage open as well.
    if(name==="front")hole(shape,new T.Vector2(.190,.169),.0143);
    else hole(shape,new T.Vector2(.190,.169),.0061);
    if(name==="front")for(const p of mounts)hole(shape,p,.0018);
    for(const p of screws)hole(shape,p,.0018);
    casting(`MGU-K transmission ${name} cover`,shape,a,b);
  }
  for(const [i,p]of screws.entries()){
    axial(root,`MGU-K case screw ${i}`,p,-.324,-.299,0,.0017,mat.darkMetal,true);
    axial(root,`MGU-K case screw head ${i}`,p,-.300,-.297,0,.003,mat.metal,true);
  }
  engineCover.updateWorldMatrix(true,false);
  for(const [i,p]of mounts.entries()){
    axial(root,`MGU-K mounting spacer ${i}`,p,-.300,-.298,.0018,.004,mat.cast,true);
    axial(root,`MGU-K mounting bolt ${i}`,p,-.304,-.283,0,.0017,mat.darkMetal,true);
    axial(root,`MGU-K mounting bolt head ${i}`,p,-.286,-.283,.0008,.003,mat.metal,true);
    const frame=new T.Matrix4().makeBasis(new T.Vector3(0,1,0),new T.Vector3(0,0,1),new T.Vector3(1,0,0));frame.setPosition(0,p.x,p.y);
    const transform=frame.invert().multiply(engineCover.matrixWorld);engineCover.geometry.applyMatrix4(transform);
    openRadialPort(engineCover,[0,0],.0018,1,-.330);
    engineCover.geometry.applyMatrix4(transform.invert());engineCover.geometry.computeVertexNormals();
  }
  for(const gear of gears){
    const idler=gear.name.includes("idler"),bore=idler?.014:gear.name==="crank"?.0226:.0105;
    const wheel=new T.Group();wheel.name=`MGU-K drive gear ${gear.name}`;wheel.position.set(x,gear.centre.x,gear.centre.y);
    wheel.userData={engineMotion:"accessoryGear",ratio:gear.ratio,phase:gear.phase,teeth:gear.teeth,pitchRadius:gear.teeth*toothModule/2,mate:gear.mate?`MGU-K drive gear ${gear.mate}`:null};root.add(wheel);
    const profile=createInvoluteGearProfile(gear.teeth,bore);
    if(gear.name==="crank"){
      const keyway=new T.Path(),angle=Math.asin(.0021/bore);
      keyway.absarc(0,0,bore,angle,Math.PI*2-angle,false);keyway.lineTo(.0241,-.0021);keyway.lineTo(.0241,.0021);keyway.closePath();profile.holes=[keyway];
    }
    const g=new T.ExtrudeGeometry(profile,{depth:width,bevelEnabled:false,curveSegments:32});g.translate(0,0,-width/2);
    g.applyMatrix4(new T.Matrix4().makeBasis(new T.Vector3(0,1,0),new T.Vector3(0,0,1),new T.Vector3(1,0,0)));
    add(wheel,`${wheel.name} teeth`,g,steel);
    if(idler){
      axial(root,`MGU-K ${gear.name} spindle`,gear.centre,-.324,-.298,0,.006,mat.darkMetal);
      axial(root,`MGU-K ${gear.name} inner race`,gear.centre,-.314,-.306,.0061,.008,steel);
      axial(wheel,`MGU-K ${gear.name} outer race`,new T.Vector2(),-.004,.004,.012,.014,steel);
      for(let i=0;i<12;i++){
        const angle=i*Math.PI/6,ball=add(root,`MGU-K ${gear.name} ball ${i}`,new T.SphereGeometry(.0019,10,8),steel);
        ball.position.set(x,gear.centre.x+Math.cos(angle)*.010,gear.centre.y+Math.sin(angle)*.010);
      }
      for(const face of[-1,1])axial(root,`MGU-K ${gear.name} thrust washer ${face}`,gear.centre,x+face*.005-.0005,x+face*.005+.0005,.0061,.015,steel);
      for(const face of[-1,1])axial(root,`MGU-K ${gear.name} bearing cage ${face}`,gear.centre,x+face*.003-.0003,x+face*.003+.0003,.0082,.0118,mat.darkMetal);
      axial(root,`MGU-K ${gear.name} retaining head`,gear.centre,-.300,-.297,.002,.009,steel,true);
    }
    if(gear.name==="crank"){
      axial(root,"MGU-K crank drive rear seal",gear.centre,-.321,-.317,.0225,.0228,mat.rubber,true);
      // An axial key engages the wheel hub and matching crank nose slot.
      const key=add(wheel,"MGU-K crank drive key",new T.BoxGeometry(.008,.003,.004),steel);key.position.y=.0225;
    }
    if(gear.name==="motor"){
      // Twelve internal dogs fill the spaces between the motor's real splines.
      for(let i=0;i<12;i++){
        const angle=(i+.5)*Math.PI/6,key=add(wheel,`MGU-K coupling dog ${i}`,new T.BoxGeometry(.008,.0018,.0018),steel);
        key.position.set(0,Math.cos(angle)*.0096,Math.sin(angle)*.0096);key.rotation.x=angle;
      }
      axial(root,"MGU-K output bearing inner race",gear.centre,-.304,-.300,.0085,.0105,steel);
      axial(root,"MGU-K output bearing outer race",gear.centre,-.304,-.300,.0135,.015,steel);
      for(let i=0;i<12;i++){
        const angle=i*Math.PI/6,ball=add(root,`MGU-K output bearing ball ${i}`,new T.SphereGeometry(.00145,10,8),steel);
        ball.position.set(-.302,gear.centre.x+Math.cos(angle)*.012,gear.centre.y+Math.sin(angle)*.012);
      }
      axial(root,"MGU-K drive front seal",gear.centre,-.300,-.299,.0086,.015,mat.rubber,true);
      axial(root,"MGU-K output retaining nut",gear.centre,-.299,-.296,.0085,.012,steel,true);
      axial(root,"MGU-K output dust cap wall",gear.centre,-.300,-.283,.015,.017,mat.cast,true);
      axial(root,"MGU-K output dust cap end",gear.centre,-.283,-.281,0,.017,mat.cast,true);
    }
  }
  // Machine a short key pocket in the crank nose, leaving the adjacent seal
  // journals round. Matching section vertices make the pocket one closed solid.
  const shaft=core.getObjectByName("Crank main-axis section 3") as T.Mesh;
  shaft.updateMatrix();
  const blank=shaft.geometry.clone().applyMatrix4(shaft.matrix);blank.computeBoundingBox();
  const bounds=blank.boundingBox!,radius=.0225,angle=Math.asin(.0021/radius),round:T.Vector2[]=[],notched:T.Vector2[]=[];
  for(let i=0;i<=64;i++){
    const theta=angle+(Math.PI*2-2*angle)*i/64,p=new T.Vector2(Math.cos(theta)*radius,Math.sin(theta)*radius);round.push(p);notched.push(p);
  }
  round.push(new T.Vector2(Math.cos(angle/3)*radius,-Math.sin(angle/3)*radius),new T.Vector2(Math.cos(angle/3)*radius,Math.sin(angle/3)*radius));
  notched.push(new T.Vector2(.0209,-.0021),new T.Vector2(.0209,.0021));
  const positions:number[]=[],indices:number[]=[],sections:[number,T.Vector2[]][]=[[bounds.min.x,round],[-.342,round],[-.342,notched],[-.333,notched],[-.333,round],[-.316,round],[-.316,notched],[-.304,notched],[-.304,round],[bounds.max.x,round]],n=round.length;
  for(const [sx,points]of sections)for(const p of points)positions.push(sx,p.x,p.y);
  const tri=(a:number,b:number,c:number)=>{
    const pa=new T.Vector3().fromArray(positions,a*3),pb=new T.Vector3().fromArray(positions,b*3),pc=new T.Vector3().fromArray(positions,c*3);
    if(pb.sub(pa).cross(pc.sub(pa)).lengthSq()>1e-22)indices.push(a,b,c);
  };
  for(let row=0;row<sections.length-1;row++)for(let i=0;i<n;i++){
    const a=row*n+i,b=row*n+(i+1)%n,c=a+n,d=b+n;tri(a,b,c);tri(b,d,c);
  }
  for(const row of[0,sections.length-1]){
    const centre=positions.length/3;positions.push(sections[row][0],0,0);
    for(let i=0;i<n;i++){const a=row*n+i,b=row*n+(i+1)%n;if(row===0)tri(centre,b,a);else tri(centre,a,b);}
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute("position",new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  shaft.geometry.dispose();blank.dispose();shaft.geometry=geometry;shaft.position.set(0,0,0);shaft.quaternion.identity();
  return {root,caseOutline:outer};
}
