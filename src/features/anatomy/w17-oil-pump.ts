import * as T from "three";
import {createInvoluteGearProfile} from "./w17-engine-timing.ts";
import {servicePassage} from "./w17-feedthrough.ts";

type Materials=Record<"metal"|"cast"|"darkMetal"|"rubber",T.Material>;
export const OIL_PUMP={y:.133,z:-.240,shaftZ:-.230,supply:[-.503,.112,-.224] as [number,number,number],teeth:16,pitch:.010};

// A three-stage external-gear dry-sump reconstruction. The compact installed
// envelope is retained; stage count, displacement and shaft details are inferred.
export function createOilPump(mat:Materials){
  const root=new T.Group();root.name="Dry-sump pump stages";
  const add=(name:string,g:T.BufferGeometry,material:T.Material=mat.metal,cover=false,parent:T.Object3D=root)=>{
    const p=new T.Mesh(g,material);p.name=name;p.userData={component:"cooling",oilPump:true,serviceCover:cover};p.castShadow=p.receiveShadow=true;parent.add(p);return p;
  };
  const blank=()=>{const s=new T.Shape(),w=.026,h=.031,r=.004;s.moveTo(-w+r,-h);s.lineTo(w-r,-h);s.quadraticCurveTo(w,-h,w,-h+r);s.lineTo(w,h-r);s.quadraticCurveTo(w,h,w-r,h);s.lineTo(-w+r,h);s.quadraticCurveTo(-w,h,-w,h-r);s.lineTo(-w,-h+r);s.quadraticCurveTo(-w,-h,-w+r,-h);s.closePath();return s;};
  const bore=(s:T.Shape,x:number,y:number,r:number)=>{const h=new T.Path();h.absarc(x,y,r,0,Math.PI*2,true);s.holes.push(h);};
  const screws=[[0,-.026],[.021,-.026],[-.021,.026],[.021,.026]];
  const drilled=()=>{const s=blank();for(const [x,y]of screws)bore(s,x,y,.0017);return s;};
  const solid=(name:string,s:T.Shape,a:number,b:number,material:T.Material=mat.cast,cover=true)=>{
    const g=new T.ExtrudeGeometry(s,{depth:b-a,bevelEnabled:false,curveSegments:24});g.rotateY(Math.PI/2);g.translate(-(b-a)/2,0,0);const p=add(name,g,material,cover);p.position.set((a+b)/2,OIL_PUMP.y,OIL_PUMP.z);return p;
  };
  const axial=(name:string,y:number,z:number,a:number,b:number,inner:number,outer:number,material:T.Material=mat.metal,cover=false,parent:T.Object3D=root)=>{
    const g=new T.LatheGeometry([[inner,a],[outer,a],[outer,b],[inner,b],[inner,a]].map(p=>new T.Vector2(...p)),48);g.rotateZ(-Math.PI/2);g.translate(0,y,z);return add(name,g,material,cover,parent);
  };
  const drill=(p:T.Mesh,axis:"x"|"y"|"z",centre:[number,number],r:number)=>{
    if(axis==="x")p.geometry.rotateY(-Math.PI/2);if(axis==="y")p.geometry.rotateX(Math.PI/2);
    p.geometry.scale(1000,1000,1000);
    const g=servicePassage(p.geometry,Array.from({length:32},(_,i)=>new T.Vector2((centre[0]+Math.cos(i*Math.PI/16)*r)*1000,(centre[1]+Math.sin(i*Math.PI/16)*r)*1000)));g.scale(.001,.001,.001);p.geometry.dispose();p.geometry=g;
    if(axis==="x")p.geometry.rotateY(Math.PI/2);if(axis==="y")p.geometry.rotateX(-Math.PI/2);p.geometry.computeVertexNormals();
  };
  const plug=(name:string,p:[number,number,number],axis:"y"|"z",r:number)=>{const g=new T.CylinderGeometry(r,r,.002,32);if(axis==="z")g.rotateX(Math.PI/2);g.translate(...p);return add(name,g,mat.darkMetal,true);};
  const r=.01145,angle=Math.acos(.010/r);
  const bronze=new T.MeshStandardMaterial({name:"Oil pump bronze bushes",color:"#8b7150",metalness:.7,roughness:.4});
  for(let i=0;i<3;i++){
    const x=-.520-i*.036,section=drilled();
    {
      // Mill each discharge chamber open from the top and close it
      // with a drilled lid. This avoids intersecting round bores/sliver faces.
      const w=.026,bottom=-.031,top=.029,slot=.008,edge=.004,alpha=Math.acos((slot-.010)/r);
      section.curves=[];section.moveTo(-w+edge,bottom);section.lineTo(w-edge,bottom);section.quadraticCurveTo(w,bottom,w,bottom+edge);section.lineTo(w,top);section.lineTo(slot,top);section.lineTo(slot,Math.sin(alpha)*r);
      section.absarc(.010,0,r,alpha,-Math.PI+angle,true);
      section.absarc(-.010,0,r,-angle,Math.PI-alpha-Math.PI*2,true);
      section.lineTo(-slot,top);section.lineTo(-w,top);section.lineTo(-w,bottom+edge);section.quadraticCurveTo(-w,bottom,-w+edge,bottom);section.closePath();
    }
    const body=solid(`Oil pump stage ${i}`,section,x-.013,x+.013);
    // Cut small intersecting oil passages in the cartridge's local frame.
    // World-space Float32 rounding otherwise splits shared bore rim vertices.
    if(i===0){
      body.geometry.rotateY(-Math.PI/2);
      const g=servicePassage(body.geometry,Array.from({length:32},(_,j)=>new T.Vector2(-.016+Math.cos(j*Math.PI/16)*.008,-.021+Math.sin(j*Math.PI/16)*.008)));body.geometry.dispose();body.geometry=g;body.geometry.rotateY(Math.PI/2);
    }else{
      drill(body,"z",[0,-.013],.007);
      plug(`Oil pump ${i} suction drilling plug`,[x,.120,-.267],"z",.009);
    }
    // Pressure leaves above the mesh; the two scavenge sections share a high
    // return gallery, separate from the pressure stage and lower suction ports.
    {
      const lid=new T.Shape([new T.Vector2(-.013,-.026),new T.Vector2(.013,-.026),new T.Vector2(.013,.026),new T.Vector2(-.013,.026)]);
      if(i!==1)bore(lid,0,0,i===0?.007:.008);
      const g=new T.ExtrudeGeometry(lid,{depth:.002,bevelEnabled:false,curveSegments:24});g.rotateX(-Math.PI/2);g.translate(x,.162,-.240);
      add(i===1?"Oil pump scavenge manifold drilling plug":`Oil pump ${i} outlet lid`,g,mat.cast,true);
    }
    for(const side of[-1,1]){
      const s=drilled();for(const z of[-.010,.010])bore(s,-z,0,.0055);
      if(i>0)bore(s,0,.023,.0045);
      if(i===0&&side===1)bore(s,-.016,-.021,.008);
      const a=side===1?x+.013:x-.017,b=a+.004;
      solid(`Oil pump ${i} ${side===1?"front":"rear"} plate`,s,a,b);
      for(const z of[-.250,-.230])axial(`Oil pump ${i} bush ${side} ${z}`,.133,z,a,b,.00385,.0055,bronze);
    }
    if(i<2){const s=drilled();for(const z of[-.010,.010])bore(s,-z,0,.0039);if(i===1)bore(s,0,.023,.0045);solid(`Oil pump stage seam ${i}`,s,x-.019,x-.017,mat.rubber);}
  }
  axial("Oil pump scavenge gallery plug",.156,-.240,-.613,-.609,0,.006,mat.cast,true);
  // Each machined shaft is round at the bushes and has a short flat under each
  // removable gear. The two complete shafts retain independent moving frames.
  for(const side of[-1,1]){
    const rotor=new T.Group();rotor.name=`Oil pump ${side===1?"drive":"idler"} shaft assembly`;rotor.position.set(0,.133,-.240+side*.010);
    rotor.userData={component:"cooling",oilPump:true,engineMotion:"accessoryShaft",ratio:side===1?1:-1,phase:side===1?0:-Math.PI/16};root.add(rotor);
    const flat=(radius:number,limit:number)=>{const alpha=Math.acos(limit/radius);return Array.from({length:49},(_,i)=>{const a=alpha+(Math.PI*2-2*alpha)*i/48;return new T.Vector2(Math.cos(a)*radius,Math.sin(a)*radius);});};
    const cut=(name:string,profile:T.Vector2[],a:number,b:number)=>{const g=new T.ExtrudeGeometry(new T.Shape(profile),{depth:b-a,bevelEnabled:false});g.translate(0,0,a);g.applyMatrix4(new T.Matrix4().makeBasis(new T.Vector3(0,1,0),new T.Vector3(0,0,1),new T.Vector3(1,0,0)));return add(name,g,mat.metal,false,rotor);};
    let end=-.611;
    for(const i of[2,1,0]){
      const x=-.520-i*.036,a=x-.011,b=x+.011;
      axial(`Oil pump ${side} round journal ${i}`,0,0,end,a,0,.0038,mat.metal,false,rotor);
      cut(`Oil pump ${side} gear shaft flat ${i}`,flat(.0038,.0030),a,b);end=b;
      const shape=createInvoluteGearProfile(16,.006);shape.holes=[new T.Path(flat(.00386/.625,.00306/.625).reverse())];
      const g=new T.ExtrudeGeometry(shape,{depth:.022/.625,bevelEnabled:false,curveSegments:24});g.scale(.625,.625,.625);g.translate(0,0,a);g.applyMatrix4(new T.Matrix4().makeBasis(new T.Vector3(0,1,0),new T.Vector3(0,0,1),new T.Vector3(1,0,0)));
      add(`Oil pump stage ${i} gear ${side}`,g,mat.metal,false,rotor);
    }
    axial(`Oil pump ${side} front journal`,0,0,end,side===1?-.496:-.501,0,.0038,mat.metal,false,rotor);
    for(const [a,b]of[[-.613,-.611],[-.503,-.501]])axial(`Oil pump ${side} shaft retainer ${a}`,0,0,a,b,.0038,.0057,mat.metal,false,rotor);
    const z=-.240+side*.010;
    axial(`Oil pump ${side} rear cap`,.133,z,-.615,-.609,.0058,.0075,mat.cast,true);
    axial(`Oil pump ${side} rear cap end`,.133,z,-.617,-.615,0,.0075,mat.cast,true);
    axial(`Oil pump ${side} front seal`,.133,z,-.501,-.499,.0038,.0058,mat.rubber,true);
    axial(`Oil pump ${side} front seal carrier`,.133,z,-.503,-.499,.0058,.0075,mat.cast,true);
    if(side===-1)axial("Oil pump idler front cap",.133,z,-.499,-.497,0,.0075,mat.cast,true);
  }
  for(const [y,z]of screws.map(([z,y])=>[y+.133,-z-.240])){
    axial(`Oil pump through bolt ${y} ${z}`,y,z,-.612,-.500,0,.0016,mat.darkMetal,true);
    axial(`Oil pump bolt head ${y} ${z}`,y,z,-.503,-.500,.0007,.003,mat.metal,true);
    axial(`Oil pump retaining nut ${y} ${z}`,y,z,-.612,-.609,.0017,.0033,mat.metal,true);
  }
  root.userData={stages:[{x:-.520,kind:"pressure"},{x:-.556,kind:"scavenge"},{x:-.592,kind:"scavenge"}],shaft:[.133,-.230],gearTeeth:16,gearPitch:.010};
  return root;
}
