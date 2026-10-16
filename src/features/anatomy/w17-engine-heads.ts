import * as T from "three";
import { ENGINE_CORE, ENGINE_VALVETRAIN, engineCylinderX, engineValveEvent } from "./w17-engine-core.ts";
import { servicePassage } from "./w17-feedthrough.ts";
import { openRadialPort } from "./w17-wastegate.ts";

type Materials=Record<"metal"|"cast"|"darkMetal"|"carbon"|"black"|"rubber",T.Material>;
type V=[number,number,number];

export function engineHeadPort(side:number,index:number,kind:"intake"|"exhaust",crankHeight=.146):V{
  const angle=kind==="intake"?Math.PI/4:Math.PI/2;
  return new T.Vector3(engineCylinderX(side,index)+(kind==="intake"?.028:0),.195+.030*(1-Math.cos(angle)),(kind==="intake"?-side:side)*(.060+.030*Math.sin(angle))).applyAxisAngle(new T.Vector3(1,0,0),side*Math.PI/4).add(new T.Vector3(0,crankHeight,0)).toArray() as V;
}

// All head coordinates share the liner's crank-centred frame. Hidden casting,
// pneumatic returns and cam contours are reconstructed, not supplier CAD.
export function createEngineHeads(mat:Materials){
  const root=new T.Group();root.name="V6 cylinder heads and valve train";
  const add=(parent:T.Object3D,name:string,geometry:T.BufferGeometry,material=mat.metal,cover=false)=>{
    const part=new T.Mesh(geometry,material);part.name=name;part.userData={component:"engine",internal:true,engineHead:true,serviceCover:cover};
    part.castShadow=part.receiveShadow=true;parent.add(part);return part;
  };
  const box=(parent:T.Object3D,name:string,p:V,size:V,material=mat.cast,cover=false)=>{
    const part=add(parent,name,new T.BoxGeometry(...size),material,cover);part.position.set(...p);return part;
  };
  const ring=(parent:T.Object3D,name:string,inner:number,outer:number,a:number,b:number,material=mat.metal,cover=false)=>
    add(parent,name,new T.LatheGeometry([[inner,a],[outer,a],[outer,b],[inner,b],[inner,a]].map(p=>new T.Vector2(...p)),32),material,cover);
  const bore=(part:T.Mesh,centre:V,axis:V,radius:number)=>{
    part.updateMatrix();const frame=new T.Matrix4().compose(new T.Vector3(...centre),new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(...axis)),new T.Vector3(1,1,1));
    const transform=frame.clone().invert().multiply(part.matrix),source=part.geometry.clone().applyMatrix4(transform);
    const next=servicePassage(source,Array.from({length:32},(_,i)=>new T.Vector2(Math.cos(i*Math.PI/16)*radius,Math.sin(i*Math.PI/16)*radius)));source.dispose();
    next.applyMatrix4(transform.invert());part.geometry.dispose();part.geometry=next;
  };
  const {tilt,baseRadius,noseRadius,noseOffset}=ENGINE_VALVETRAIN;
  // Convex tangent-flank profile: the follower displacement is the support
  // function of the same base and nose circles used to build the actual cam.
  const points=[...Array.from({length:96},(_,i)=>new T.Vector2(Math.cos(i*Math.PI/48)*baseRadius,Math.sin(i*Math.PI/48)*baseRadius)),...Array.from({length:96},(_,i)=>new T.Vector2(Math.cos(i*Math.PI/48)*noseRadius,noseOffset+Math.sin(i*Math.PI/48)*noseRadius))].sort((a,b)=>a.x-b.x||a.y-b.y);
  const turn=(a:T.Vector2,b:T.Vector2,c:T.Vector2)=>b.clone().sub(a).cross(c.clone().sub(a));
  const lower:T.Vector2[]=[],upper:T.Vector2[]=[];
  for(const p of points){while(lower.length>1&&turn(lower.at(-2)!,lower.at(-1)!,p)<=0)lower.pop();lower.push(p);}
  for(const p of points.slice().reverse()){while(upper.length>1&&turn(upper.at(-2)!,upper.at(-1)!,p)<=0)upper.pop();upper.push(p);}
  const camShape=new T.Shape([...lower.slice(0,-1),...upper.slice(0,-1)]);
  const camGeometry=new T.ExtrudeGeometry(camShape,{depth:.010,bevelEnabled:false});camGeometry.translate(0,0,-.005);
  camGeometry.applyMatrix4(new T.Matrix4().makeBasis(new T.Vector3(0,0,1),new T.Vector3(0,1,0),new T.Vector3(-1,0,0)));

  for(const side of[-1,1]){
    const bank=new T.Group();bank.name=`Cylinder head bank ${side}`;bank.rotation.x=side*Math.PI/4;root.add(bank);
    const first=engineCylinderX(side,0),last=engineCylinderX(side,2),front=last+.052,rear=first-.052;
    const section=new T.Shape();[[-.061,.168],[.061,.168],[.061,.287],[.057,.287],[.057,.172],[-.057,.172],[-.057,.287],[-.061,.287]].forEach(([z,y],i)=>i?section.lineTo(z,y):section.moveTo(z,y));section.closePath();
    const shell=new T.ExtrudeGeometry(section,{depth:front-rear,bevelEnabled:false});shell.rotateY(Math.PI/2);shell.translate(rear,0,0);
    const housing=add(bank,`Cylinder head housing ${side}`,shell,mat.cast,true);
    for(let i=0;i<3;i++)bore(housing,[engineCylinderX(side,i),.168,0],[0,1,0],.040);
    for(const [end,x]of[["rear",rear+.002],["front",front-.002]] as const)box(bank,`Head end wall ${side} ${end}`,[x,.2295,0],[.004,.115,.122],mat.cast,true);
    const coverShape=new T.Shape();[[-.063,.285],[-.063,.299],[.063,.299],[.063,.285],[.060,.285],[.060,.296],[-.060,.296],[-.060,.285]].forEach(([z,y],i)=>i?coverShape.lineTo(z,y):coverShape.moveTo(z,y));coverShape.closePath();
    const coverGeometry=new T.ExtrudeGeometry(coverShape,{depth:front-rear+.002,bevelEnabled:false});coverGeometry.rotateY(Math.PI/2);coverGeometry.translate(rear-.001,0,0);
    const cover=add(bank,`Cam cover ${side}`,coverGeometry,mat.carbon,true);
    const deckShape=new T.Shape([new T.Vector2(rear+.004,-.057),new T.Vector2(front-.004,-.057),new T.Vector2(front-.004,.057),new T.Vector2(rear+.004,.057)]);
    const guideHoles:{x:number;z:number;sign:number}[]=[];
    for(const kind of["intake","exhaust"])for(let i=0;i<3;i++)for(const pair of[-1,1]){
      const sign=kind==="intake"?-side:side,z=sign*(kind==="intake"?.0157:.0175),seatY=.182-Math.abs(z)*Math.tan(tilt),x=engineCylinderX(side,i)+pair*(kind==="intake"?.0175:.015),hitZ=z+sign*(.2105-seatY)*Math.tan(tilt);
      const hole=new T.Path();hole.absellipse(x,hitZ,.0046,.0046/Math.cos(tilt),0,Math.PI*2,true,0);deckShape.holes.push(hole);guideHoles.push({x,z:hitZ,sign});
    }
    for(let i=0;i<3;i++){const hole=new T.Path();hole.absarc(engineCylinderX(side,i),0,.0051,0,Math.PI*2,true);deckShape.holes.push(hole);}
    const galleryGeometry=new T.ExtrudeGeometry(deckShape,{depth:.003,bevelEnabled:false,curveSegments:20}),gp=galleryGeometry.attributes.position;
    for(let j=0;j<gp.count;j++){
      const x=gp.getX(j),z=gp.getY(j),depth=gp.getZ(j),hole=guideHoles.find(h=>Math.abs(((x-h.x)/.0046)**2+((z-h.z)*Math.cos(tilt)/.0046)**2-1)<1e-4);
      gp.setXYZ(j,x,.2105-depth,z-(hole?.sign??0)*depth*Math.tan(tilt));
    }
    galleryGeometry.computeVertexNormals();add(bank,`Head port gallery roof ${side}`,galleryGeometry,mat.cast,true);
    const galleryWall=box(bank,`Head port gallery centre wall ${side}`,[(rear+front)/2,.195,0],[front-rear-.008,.026,.003],mat.cast,true);
    for(let i=0;i<2;i++)box(bank,`Head port gallery separator ${side}/${i}`,[first+(i+.5)*ENGINE_CORE.pitch,.1935,0],[.004,.034,.114],mat.cast,true);
    for(const edge of[-1,1])for(let i=0;i<4;i++){
      const x=rear+.014+i*(front-rear-.028)/3;
      const bolt=ring(bank,`Cover fastener ${side} ${edge} ${i}`,0,.003,.293,.302,mat.metal,true);bolt.position.set(x,0,edge*.059);
    }
    for(const kind of["intake","exhaust"]){
      const sign=kind==="intake"?-side:side,z=sign*(kind==="intake"?.0157:.0175),seatY=.182-Math.abs(z)*Math.tan(tilt),axis=new T.Vector3(0,Math.cos(tilt),sign*Math.sin(tilt));
      const camCentre=new T.Vector3(0,seatY,z).addScaledVector(axis,.083+baseRadius);
      const cam=new T.Group();cam.name=`Camshaft ${side} ${kind}`;cam.position.copy(camCentre);cam.userData={engineMotion:"camshaft",side,kind};bank.add(cam);
      const shaft=ring(cam,`Camshaft ${side} ${kind} shaft`,.003,.007,rear+.006,front-.006,mat.darkMetal);shaft.rotation.z=-Math.PI/2;
      const guideCentre=new T.Vector3((rear+front)/2,seatY,z).addScaledVector(axis,.032);
      const bridge=box(bank,`Valve guide bridge ${side} ${kind}`,guideCentre.toArray() as V,[front-rear-.016,.006,.028],mat.cast);
      bridge.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),axis);
      for(let i=0;i<3;i++)for(const pair of[-1,1])bore(bridge,[engineCylinderX(side,i)+pair*(kind==="intake"?.0175:.015),seatY,z],axis.toArray() as V,.0046);
      for(let j=0;j<4;j++){
        const x=first-ENGINE_CORE.pitch/2+j*ENGINE_CORE.pitch,edge=guideCentre.z+sign*.012;
        box(bank,`Valve guide bridge foot ${side} ${kind}/${j}`,[x,guideCentre.y-sign*.012*Math.sin(sign*tilt),(edge+sign*.059)/2],[.012,.006,Math.abs(sign*.059-edge)+.004],mat.cast);
      }
      for(let j=0;j<4;j++){
        const x=first-ENGINE_CORE.pitch/2+j*ENGINE_CORE.pitch;
        const bearing=ring(bank,`Cam bearing ${side} ${kind}/${j}`,.0071,.010,x-.004,x+.004,mat.metal);bearing.rotation.z=-Math.PI/2;bearing.position.copy(camCentre);
        const carrier=box(bank,`Cam bearing carrier ${side} ${kind}/${j}`,[x,camCentre.y-.008,camCentre.z],[.012,.024,.027],mat.cast);
        bore(carrier,[x,camCentre.y,camCentre.z],[1,0,0],.010);
        // The carrier foot joins the bank wall rather than hovering over it.
        box(bank,`Cam carrier foot ${side} ${kind}/${j}`,[x,camCentre.y-.018,(camCentre.z+sign*.059)/2],[.012,.005,Math.abs(sign*.059-camCentre.z)+.010],mat.cast);
      }
      for(let i=0;i<3;i++)for(const pair of[-1,1]){
        const x=engineCylinderX(side,i)+pair*(kind==="intake"?.0175:.015),seat:V=[x,seatY,z],name=`Valve ${side} ${i} ${kind} ${pair}`;
        const valve=new T.Group();valve.name=name;valve.position.set(...seat);valve.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),axis);valve.userData={engineMotion:"valve",side,cylinder:i,kind,seat,axis:axis.toArray()};bank.add(valve);
        const diameter=kind==="intake"?ENGINE_VALVETRAIN.intakeDiameter:ENGINE_VALVETRAIN.exhaustDiameter;
        const profile=[[0,-.001],[diameter/2,-.001],[diameter/2,.0003],[diameter/2-.001,.0016],[.006,.006],[.0025,.010],[.0025,.079],[0,.079],[0,-.001]].map(p=>new T.Vector2(...p));
        add(valve,`${name} head and stem`,new T.LatheGeometry(profile,48),mat.darkMetal);
        ring(valve,`${name} bucket`,.003,.013,.076,.083,mat.metal);
        ring(valve,`${name} pneumatic piston`,.0025,.009,.047,.050,mat.metal);
        ring(valve,`${name} piston seal`,.0088,.0093,.048,.049,mat.rubber);
        ring(valve,`${name} keeper`,.0025,.004,.070,.074,mat.darkMetal);
        const guide=new T.Group();guide.name=`${name} guide assembly`;guide.position.set(...seat);guide.quaternion.copy(valve.quaternion);bank.add(guide);
        ring(guide,`${name} seat`,diameter/2-.001,diameter/2+.0008,.0004,.003,mat.metal,true);
        ring(guide,`${name} stem guide`,.00255,.0045,.015,.0345,mat.metal);
        ring(guide,`${name} guide shoulder`,.00255,.006,.0325,.0345,mat.metal);
        ring(guide,`${name} pneumatic cylinder`,.0094,.011,.035,.071,mat.darkMetal);
        ring(guide,`${name} pneumatic lower seal`,.0026,.0094,.035,.037,mat.rubber);
        ring(guide,`${name} pneumatic cap`,.0026,.011,.069,.071,mat.metal);
        const lobe=add(cam,`Cam lobe ${side} ${i} ${kind} ${pair}`,camGeometry,mat.darkMetal);lobe.position.x=x;lobe.rotation.x=Math.PI+sign*tilt-engineValveEvent(side,i,kind)/2;
      }
    }
    for(let i=0;i<3;i++){
      const x=engineCylinderX(side,i);
      // A pentroof chamber closes the liner. Its four valve seats are bored
      // in their own tilted frames, so no opaque roof crosses an open valve.
      const chamberShape=new T.Shape([new T.Vector2(x-ENGINE_CORE.pitch/2,-.061),new T.Vector2(x+ENGINE_CORE.pitch/2,-.061),new T.Vector2(x+ENGINE_CORE.pitch/2,.061),new T.Vector2(x-ENGINE_CORE.pitch/2,.061)]);
      const seatHoles:{x:number;z:number;radius:number;sign:number}[]=[];
      for(const kind of["intake","exhaust"])for(const pair of[-1,1]){
        const sign=kind==="intake"?-side:side,z=sign*(kind==="intake"?.0157:.0175),radius=(kind==="intake"?.033:.028)/2+.0008,px=x+pair*(kind==="intake"?.0175:.015);
        const hole=new T.Path();hole.absellipse(px,z,radius,radius*Math.cos(tilt),0,Math.PI*2,true,0);chamberShape.holes.push(hole);seatHoles.push({x:px,z,radius,sign});
      }
      const sparkHole=new T.Path();sparkHole.absarc(x,0,.005,0,Math.PI*2,true);chamberShape.holes.push(sparkHole);
      const chamberGeometry=new T.ExtrudeGeometry(chamberShape,{depth:.006,bevelEnabled:false,curveSegments:24}),p=chamberGeometry.attributes.position;
      for(let j=0;j<p.count;j++){
        const xx=p.getX(j),z=p.getY(j),depth=p.getZ(j),seat=seatHoles.find(h=>Math.abs(((xx-h.x)/h.radius)**2+((z-h.z)/(h.radius*Math.cos(tilt)))**2-1)<1e-4);
        const roof=seat?.sign? .182-Math.abs(seat.z)*Math.tan(tilt)-seat.sign*(z-seat.z)*Math.tan(tilt):.182-Math.min(.0376,Math.abs(z))*Math.tan(tilt);
        p.setXYZ(j,xx,roof-depth*(seat?Math.cos(tilt):1),z-(seat?.sign??0)*depth*Math.sin(tilt));
      }
      chamberGeometry.computeVertexNormals();add(bank,`Cylinder head ${side} ${i}`,chamberGeometry,mat.cast,true);
      bore(galleryWall,[x,.180,0],[0,1,0],.0051);
      bore(cover,[x,.299,0],[0,1,0],.009);
      const deck=ring(bank,`Head gasket fire ring ${side} ${i}`,.040,.046,.168,.169,mat.darkMetal,true);deck.position.x=x;
      // Each cylinder has two distinct port galleries. The side opening and
      // hollow oval-to-round neck share their edges with the actual casting.
      for(const kind of["intake","exhaust"]){
        const sign=kind==="intake"?-side:side,shift=kind==="intake"?.028:0,width=kind==="intake"?.018:.021,positions:number[]=[],indices:number[]=[];
        const scale=new T.Matrix4().makeScale(1/width,1/.012,1);
        housing.geometry.applyMatrix4(scale);openRadialPort(housing,[(x+shift)/width,.195/.012],1,sign);housing.geometry.applyMatrix4(scale.invert());housing.geometry.computeVertexNormals();
        const steps=16,stride=48*(steps+1);
        for(const wall of[0,1])for(let station=0;station<=steps;station++)for(let j=0;j<48;j++){
          const t=station/steps,a=j*Math.PI/24,angle=t*(kind==="intake"?Math.PI/4:Math.PI/2),r=wall?.019:.0205,rx=T.MathUtils.lerp(wall?width:width+.002,r,t),ry=T.MathUtils.lerp(wall?.012:.014,r,t);
          const cy=.195+.030*(1-Math.cos(angle)),cz=sign*(.060+.030*Math.sin(angle));
          positions.push(x+shift+Math.cos(a)*rx,cy+sign*Math.cos(angle)*Math.sin(a)*ry,cz-Math.sin(angle)*Math.sin(a)*ry);
        }
        const quad=(a:number,b:number,c:number,d:number,reverse=false)=>indices.push(...(reverse?[a,c,b,a,d,c]:[a,b,c,a,c,d]));
        for(let station=0;station<steps;station++)for(let j=0;j<48;j++){
          const k=(j+1)%48,a=station*48,b=a+48;quad(a+j,a+k,b+k,b+j);quad(stride+a+j,stride+b+j,stride+b+k,stride+a+k);
        }
        for(let j=0;j<48;j++){
          const k=(j+1)%48,last=steps*48;quad(j,stride+j,stride+k,k);quad(last+j,last+k,stride+last+k,stride+last+j);
        }
        const geometry=new T.BufferGeometry();geometry.setAttribute("position",new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
        add(bank,`Head ${kind} outlet ${side} ${i}`,geometry,mat.cast,true);
      }
    }
  }
  return root;
}
