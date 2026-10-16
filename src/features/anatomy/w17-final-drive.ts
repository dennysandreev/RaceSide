import * as T from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { createInvoluteGearProfile } from "./w17-engine-timing.ts";

const crownBoltRadius=.064;

type Materials=Record<"metal"|"darkMetal",T.Material>;

// The main shaft is 80 mm below the differential axis, so this is an offset
// hypoid arrangement, not an ordinary pair of intersecting bevel axes.
// Tooth forms/counts are a static reconstruction, not a generated Mercedes
// gear set or a validated loaded contact/kinematic simulation.
export function createFinalDrive(mainHeight:number,diffHeight:number,mat:Materials){
  const gearbox=new T.Group(),differential=new T.Group();
  gearbox.name="Final drive input";differential.name="Final drive output";
  const add=(parent:T.Group,name:string,geometry:T.BufferGeometry,material:T.Material)=>{
    const mesh=new T.Mesh(geometry,material);mesh.name=name;
    mesh.userData.component=parent===gearbox?"gearbox":"differential";
    mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  const trapezoid=(phase:number)=>T.MathUtils.clamp((.29-Math.abs(T.MathUtils.euclideanModulo(phase+.5,1)-.5))/.14,0,1);
  const indexed=(positions:number[],indices:number[])=>{
    const g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();return g;
  };
  const ring=(name:string,start:number,end:number,inner:number,outer:number,material=mat.metal)=>{
    [start,end]=[Math.min(start,end),Math.max(start,end)];
    const g=new T.LatheGeometry([[inner,start],[outer,start],[outer,end],[inner,end],[inner,start]].map(p=>new T.Vector2(...p)),64);
    g.rotateX(Math.PI/2);g.translate(-1.7,diffHeight,0);return add(differential,name,g,material);
  };
  // Sample the same tooth stations on every section. A fixed world-angle
  // grid puts triangles across the moving tooth edges and creates rippled
  // highlights even though the underlying spiral is smooth.
  const stations=[0,.05,.10,.15,.22,.29,.36,.43,.50,.57,.64,.71,.78,.85,.90,.95];
  const toothAngle=(j:number,teeth:number)=>(Math.floor(j/16)+stations[j%16])*Math.PI*2/teeth;
  // Follow the crown's spiral at the lower contact track. The former positive
  // twist ran across that track and its 32 mm tip radius only grazed one edge
  // of the crown. The shortened 36 mm pinion seats on the same main shaft,
  // engages the tooth depth and clears the carrier above its rear end.
  const positions:number[]=[],indices:number[]=[],around=14*16,rows=12,bore=.014;
  const pinionStart=-1.651,pinionLength=.021;
  const pinionPhase=(x:number)=>{
    const r=Math.hypot(x+1.7,mainHeight-diffHeight);
    const crownPhase=Math.atan2(mainHeight-diffHeight,x+1.7)-.1063560013-(r-.092)*7;
    return -Math.PI/2-Math.PI/14-crownPhase*32/14-.006;
  };
  for(let row=0;row<=rows;row++)for(let j=0;j<around;j++){
    const t=row/rows,x=pinionStart+t*pinionLength,a=toothAngle(j,14)+pinionPhase(x);
    const r=.026+.010*trapezoid(stations[j%16]);
    positions.push(x,mainHeight+Math.cos(a)*r,Math.sin(a)*r);
  }
  for(let row=0;row<rows;row++)for(let j=0;j<around;j++){
    const a=row*around+j,b=row*around+(j+1)%around;indices.push(a,b,a+around,b,b+around,a+around);
  }
  const innerStart=positions.length/3;
  for(const x of[pinionStart,pinionStart+pinionLength])for(let j=0;j<around;j++){
    const a=toothAngle(j,14)+pinionPhase(x);positions.push(x,mainHeight+Math.cos(a)*bore,Math.sin(a)*bore);
  }
  for(let j=0;j<around;j++){
    const k=(j+1)%around,a=innerStart+j,b=innerStart+k;
    indices.push(a,a+around,b,b,a+around,b+around);
    indices.push(j,a,k,k,a,b);
    const end=rows*around;indices.push(end+j,end+k,a+around,end+k,b+around,a+around);
  }
  const pinion=add(gearbox,"Final drive hypoid pinion",indexed(positions,indices),mat.metal);
  pinion.userData.teeth=14;pinion.userData.axisOffset=diffHeight-mainHeight;

  // The old crown was a smooth washer. The new one has a closed annular web
  // and a spiral tooth face with running clearance at the installed phase.
  const cp:number[]=[],ci:number[]=[],radial=8,angular=32*16;
  for(let face=0;face<2;face++)for(let row=0;row<=radial;row++)for(let j=0;j<angular;j++){
    // Preserve every original tooth station above the new bored hub seat.
    const r=.0765+row*.0034375,a=toothAngle(j,32)+.1063560013+(r-.092)*7;
    const height=.011*T.MathUtils.smoothstep(r,.077,.081)*trapezoid(stations[j%16]);
    cp.push(-1.7+Math.cos(a)*r,diffHeight+Math.sin(a)*r,face===0?-.0475:-.0408+height);
  }
  const count=(radial+1)*angular;
  for(let face=0;face<2;face++)for(let row=0;row<radial;row++)for(let j=0;j<angular;j++){
    const a=face*count+row*angular+j,b=face*count+row*angular+(j+1)%angular;
    ci.push(...(face===0?[a,b,a+angular,b,b+angular,a+angular]:[a,a+angular,b,b,a+angular,b+angular]));
  }
  for(const row of[radial])for(let j=0;j<angular;j++){
    const a=row*angular+j,b=row*angular+(j+1)%angular;
    ci.push(...(row===0?[a,a+count,b,b,a+count,b+count]:[a,b,a+count,b,b+count,a+count]));
  }
  const crownBolts=Array.from({length:8},(_,i)=>new T.Vector2(Math.cos(i*Math.PI/4)*crownBoltRadius,Math.sin(i*Math.PI/4)*crownBoltRadius));
  // Build the flat bored web directly. Repeated whole-gear Boolean cuts
  // subdivide thousands of unrelated tooth faces and make preparation slow.
  const webShape=new T.Shape(Array.from({length:angular},(_,j)=>{
    const a=toothAngle(j,32)+.1063560013+(.0765-.092)*7;return new T.Vector2(Math.cos(a)*.0765,Math.sin(a)*.0765);
  }));
  for(const [x,y,r]of[[0,0,.0602],...crownBolts.map(c=>[c.x,c.y,.0022])]){
    const hole=new T.Path();hole.absarc(x,y,r,0,Math.PI*2,true);webShape.holes.push(hole);
  }
  const webRaw=new T.ExtrudeGeometry(webShape,{depth:.0067,bevelEnabled:false,curveSegments:64}),wp=webRaw.attributes.position,webPoints:number[]=[];
  for(let i=0;i<wp.count;i+=3){
    if([0,1,2].every(j=>Math.abs(Math.hypot(wp.getX(i+j),wp.getY(i+j))-.0765)<1e-7))continue;
    for(let j=0;j<3;j++)webPoints.push(wp.getX(i+j)-1.7,wp.getY(i+j)+diffHeight,wp.getZ(i+j)-.0475);
  }
  webRaw.dispose();const web=new T.BufferGeometry();web.setAttribute("position",new T.Float32BufferAttribute(webPoints,3));web.computeVertexNormals();
  const teeth=indexed(cp,ci),toothFaces=teeth.toNonIndexed(),joined=mergeGeometries([toothFaces,web]);
  const crown=add(differential,"Final drive crown wheel",mergeVertices(joined,1e-7),mat.metal);
  teeth.dispose();toothFaces.dispose();joined.dispose();web.dispose();
  crown.userData.teeth=32;crown.userData.finalDriveDiameter=.208;
  // Conventional paired-pinion differential: two coaxial sun gears and four
  // mutually meshing planet pairs. The topology is documented in Honda's F1
  // technical review; all dimensions and this installation are reconstructed.
  const centreRadius=.036,halfPair=Math.asin(.024/(2*centreRadius));
  const centres=Array.from({length:8},(_,i)=>{
    const angle=Math.floor(i/2)*Math.PI/2+(i%2===0?-halfPair:halfPair);
    return new T.Vector2(Math.cos(angle)*centreRadius,Math.sin(angle)*centreRadius);
  });
  const matePhase=(line:number,parentPhase:number,parentTeeth:number,childTeeth:number)=>line+Math.PI-(Math.PI-parentTeeth*(line-parentPhase))/childTeeth;
  const gear=(name:string,teeth:number,bore:number,centre:T.Vector2,start:number,end:number,phase:number)=>{
    const shape=createInvoluteGearProfile(teeth,bore);
    if(teeth===24){
      const hole=new T.Path();
      for(let j=256;j>=0;j--){
        const a=j/256*Math.PI*2-phase,key=Math.abs(T.MathUtils.euclideanModulo(a+phase+Math.PI/8,Math.PI/4)-Math.PI/8)<.06;
        const r=key?.020:bore;
        if(j===256)hole.moveTo(Math.cos(a)*r,Math.sin(a)*r);else hole.lineTo(Math.cos(a)*r,Math.sin(a)*r);
      }
      shape.holes=[hole];
    }
    const g=new T.ExtrudeGeometry(shape,{depth:end-start,bevelEnabled:false,curveSegments:24});
    g.rotateZ(phase);g.translate(-1.7+centre.x,diffHeight+centre.y,start);
    const part=add(differential,name,g,mat.metal);part.userData.teeth=teeth;part.userData.pitchRadius=teeth*.001;return part;
  };
  let rightPhase=0;
  for(let pair=0;pair<4;pair++){
    const left=centres[pair*2],right=centres[pair*2+1];
    const leftPhase=matePhase(Math.atan2(left.y,left.x),0,24,12);
    const phase=matePhase(Math.atan2(right.y-left.y,right.x-left.x),leftPhase,12,12);
    rightPhase=matePhase(Math.atan2(-right.y,-right.x),phase,12,24);
    gear(`Differential planet ${pair} left`,12,.0041,left,-.040,.008,leftPhase);
    gear(`Differential planet ${pair} right`,12,.0041,right,-.008,.040,phase);
  }
  gear("Differential sun -1",24,.0179,new T.Vector2(),-.035,-.013,0);
  gear("Differential sun 1",24,.0179,new T.Vector2(),.013,.035,rightPhase);
  // The carrier tapers to its bearing journals. Longitudinal dog slots in
  // the clutch bays engage the outer plates rather than burying them in steel.
  const profile=[[-.101,.034,.019],[-.092,.034,.019],[-.084,.045,.020],[-.080,.052,.045],[-.074,.054,.046],[-.054,.058,.046],[-.052,.060,.046],[-.0475,.060,.052],[.048,.060,.052],[.050,.058,.046],[.074,.054,.046],[.080,.052,.045],[.084,.045,.020],[.092,.034,.019],[.101,.034,.019]];
  const shellPoints:number[]=[],shellIndices:number[]=[],segments=128;
  for(let surface=0;surface<2;surface++)for(const [z,outer,inner]of profile)for(let j=0;j<segments;j++){
    const a=j/segments*Math.PI*2,slot=Math.abs(T.MathUtils.euclideanModulo(a+Math.PI/8,Math.PI/4)-Math.PI/8)<.062;
    const r=surface===0?outer:inner+(slot&&Math.abs(z)>=.050&&Math.abs(z)<=.074?.004:0);
    shellPoints.push(-1.7+Math.cos(a)*r,diffHeight+Math.sin(a)*r,z);
  }
  const shellSize=profile.length*segments;
  for(let surface=0;surface<2;surface++)for(let row=0;row<profile.length-1;row++)for(let j=0;j<segments;j++){
    if(surface===0&&profile[row][0]===-.052&&profile[row+1][0]===-.0475)continue;
    const a=surface*shellSize+row*segments+j,b=surface*shellSize+row*segments+(j+1)%segments;
    shellIndices.push(...(surface===0?[a,b,a+segments,b,b+segments,a+segments]:[a,a+segments,b,b,a+segments,b+segments]));
  }
  for(const row of[0,profile.length-1])for(let j=0;j<segments;j++){
    const a=row*segments+j,b=row*segments+(j+1)%segments;
    shellIndices.push(...(row===0?[a,a+shellSize,b,b,a+shellSize,b+shellSize]:[a,b,a+shellSize,b,b+shellSize,a+shellSize]));
  }
  const flangeShape=new T.Shape();flangeShape.absarc(0,0,.068,0,Math.PI*2,false);
  for(const [x,y,r]of[[0,0,.060],...crownBolts.map(c=>[c.x,c.y,.0022])]){
    const hole=new T.Path();hole.absarc(x,y,r,0,Math.PI*2,true);flangeShape.holes.push(hole);
  }
  const flangeRaw=new T.ExtrudeGeometry(flangeShape,{depth:.0045,bevelEnabled:false,curveSegments:64}),fp=flangeRaw.attributes.position,flangePoints:number[]=[];
  for(let i=0;i<fp.count;i+=3){
    if([0,1,2].every(j=>Math.abs(Math.hypot(fp.getX(i+j),fp.getY(i+j))-.060)<1e-7))continue;
    for(let j=0;j<3;j++)flangePoints.push(fp.getX(i+j)-1.7,fp.getY(i+j)+diffHeight,fp.getZ(i+j)-.052);
  }
  flangeRaw.dispose();const flange=new T.BufferGeometry();flange.setAttribute("position",new T.Float32BufferAttribute(flangePoints,3));flange.computeVertexNormals();
  const shell=indexed(shellPoints,shellIndices),shellFaces=shell.toNonIndexed(),combined=mergeGeometries([shellFaces,flange]);
  add(differential,"Differential drum",mergeVertices(combined,1e-7),mat.darkMetal).userData.serviceCover=true;
  shell.dispose();shellFaces.dispose();combined.dispose();flange.dispose();
  for(let i=0;i<centres.length;i++){
    const c=centres[i],g=new T.CylinderGeometry(.004,.004,.095,16);g.rotateX(Math.PI/2);g.translate(-1.7+c.x,diffHeight+c.y,0);
    add(differential,`Differential planet pin ${i}`,g,mat.darkMetal);
  }
  for(const side of[-1,1]){
    // Bored planet-support plates seat on the carrier's inner shoulders.
    const plate=new T.Shape();plate.absarc(0,0,.052,0,Math.PI*2,false);
    for(const [x,y,r]of[[0,0,.0205],...centres.map(c=>[c.x,c.y,.00405])]){
      const hole=new T.Path();hole.absarc(x,y,r,0,Math.PI*2,true);plate.holes.push(hole);
    }
    const web=new T.ExtrudeGeometry(plate,{depth:.0045,bevelEnabled:false,curveSegments:24});
    web.translate(-1.7,diffHeight,side<0?-.0475:.043);
    add(differential,`Differential planet support ${side}`,web,mat.darkMetal).userData.serviceCover=true;
    for(const [name,start,end,bore]of[["end",.101,.107,.018],["seal seat",.107,.109,.021]] as const){
      const cap=ring(`Differential carrier ${name} ${side}`,side*start,side*end,bore,.034,mat.darkMetal);
      cap.userData.serviceCover=true;
    }
    ring(`Differential output shaft ${side}`,side*.013,side*.178,0,.0178,mat.metal);
    ring(`Differential bearing inner race ${side}`,side*.092,side*.101,.034,.036,mat.metal);
    ring(`Differential bearing outer race ${side}`,side*.092,side*.101,.042,.0445,mat.darkMetal);
    for(let i=0;i<20;i++){
      const a=i/20*Math.PI*2,g=new T.CylinderGeometry(.003,.003,.007,10);g.rotateX(Math.PI/2);
      g.translate(-1.7+Math.cos(a)*.039,diffHeight+Math.sin(a)*.039,side*.0965);
      add(differential,`Differential bearing roller ${side} ${i}`,g,mat.metal);
    }
    ring(`Differential bearing retainer ${side}`,side*.101,side*.102,.0365,.046,mat.metal).userData.serviceCover=true;
    ring(`Differential output seal ${side}`,side*.107,side*.109,.0179,.021,mat.darkMetal).userData.serviceCover=true;
    // Alternating plates couple the carrier dogs and the keyed output hub.
    for(let i=0;i<7;i++){
      const outerPlate=i%2===0,points:T.Vector2[]=[];
      for(let j=0;j<256;j++){
        const a=j/256*Math.PI*2,dog=Math.abs(T.MathUtils.euclideanModulo(a+Math.PI/8,Math.PI/4)-Math.PI/8)<.027;
        const r=outerPlate&&dog?.0495:.0445;points.push(new T.Vector2(Math.cos(a)*r,Math.sin(a)*r));
      }
      const shape=new T.Shape(points),hole=new T.Path();
      for(let j=256;j>=0;j--){
        const a=j/256*Math.PI*2,key=Math.abs(T.MathUtils.euclideanModulo(a+Math.PI/8,Math.PI/4)-Math.PI/8)<.06;
        const r=outerPlate?.0205:key?.020:.018;
        if(j===256)hole.moveTo(Math.cos(a)*r,Math.sin(a)*r);else hole.lineTo(Math.cos(a)*r,Math.sin(a)*r);
      }
      shape.holes.push(hole);
      const g=new T.ExtrudeGeometry(shape,{depth:.0017,bevelEnabled:false});
      g.translate(-1.7,diffHeight,side*(.051+i*.003)-(side<0?.0017:0));
      add(differential,`Differential clutch plate ${side} ${i}`,g,outerPlate?mat.metal:mat.darkMetal);
    }
    for(let i=0;i<8;i++){
      const a=i*Math.PI/4,g=new T.BoxGeometry(.0023,.0015,.066);g.rotateZ(a);
      g.translate(-1.7+Math.cos(a)*.0185,diffHeight+Math.sin(a)*.0185,side*.043);
      add(differential,`Differential output key ${side} ${i}`,g,mat.darkMetal);
    }
    ring(`Differential clutch pressure ring ${side}`,side*.073,side*.077,.0205,.0445,mat.metal);
    // A stationary actuator loads the output's axial shoulder through a
    // thrust bearing. The sliding keyed hub then presses the internal plate;
    // no hydraulic line or stationary pushrod crosses the rotating carrier.
    ring(`Differential output thrust shoulder ${side}`,side*.077,side*.080,.0178,.028,mat.metal);
    ring(`Differential clutch rotating collar ${side}`,side*.117,side*.119,.027,.042,mat.metal);
    ring(`Differential thrust rotating race ${side}`,side*.119,side*.120,.029,.042,mat.darkMetal);
    ring(`Differential thrust stationary race ${side}`,side*.122,side*.123,.029,.042,mat.darkMetal);
    for(let i=0;i<24;i++){
      const a=i*Math.PI/12,g=new T.CylinderGeometry(.001,.001,.009,10);
      g.rotateZ(a-Math.PI/2);g.translate(-1.7+Math.cos(a)*.0355,diffHeight+Math.sin(a)*.0355,side*.121);
      add(differential,`Differential thrust roller ${side} ${i}`,g,mat.metal);
    }
    ring(`Differential clutch piston ${side}`,side*.123,side*.127,.0293,.0442,mat.metal);
    ring(`Differential piston inner seal ${side}`,side*.127,side*.128,.029,.0303,mat.darkMetal);
    ring(`Differential piston outer seal ${side}`,side*.127,side*.128,.0432,.0445,mat.darkMetal);
    for(let i=0;i<6;i++){
      const a=i*Math.PI/3,g=new T.CylinderGeometry(.0023,.0023,.003,6);g.rotateX(Math.PI/2);
      g.translate(-1.7+Math.cos(a)*.030,diffHeight+Math.sin(a)*.030,side*.1105);
      add(differential,`Differential end bolt ${side} ${i}`,g,mat.metal).userData.serviceCover=true;
    }
  }
  for(let i=0;i<8;i++){
    const a=i*Math.PI/4,g=new T.CylinderGeometry(.002,.002,.014,12);g.rotateX(Math.PI/2);
    g.translate(-1.7+Math.cos(a)*crownBoltRadius,diffHeight+Math.sin(a)*crownBoltRadius,-.0478);
    add(differential,`Crown carrier bolt ${i}`,g,mat.darkMetal);
    const head=new T.CylinderGeometry(.0034,.0034,.003,6);head.rotateX(Math.PI/2);
    head.translate(-1.7+Math.cos(a)*crownBoltRadius,diffHeight+Math.sin(a)*crownBoltRadius,-.0393);
    add(differential,`Crown carrier bolt head ${i}`,head,mat.darkMetal);
  }
  return {gearbox,differential};
}
