import * as T from "three";

// Divide the existing throat, rather than placing another inlet through the
// painted sidepod. The concealed split and duct sections are reconstructed.
export function splitCoolingMouth(mouth:T.Vector3[],height:number,upper:boolean) {
  const result:T.Vector3[]=[];
  for(let i=0;i<mouth.length;i++){
    const a=mouth[i],b=mouth[(i+1)%mouth.length],da=(a.y-height)*(upper?1:-1),db=(b.y-height)*(upper?1:-1);
    if(da>=0)result.push(a.clone());
    if(da*db<0)result.push(a.clone().lerp(b,da/(da-db)));
  }
  return result;
}

export function coolingDuctSections(mouth:T.Vector3[],frame:T.Matrix4,halfWidth:number,halfDepth:number,side:number,faceHeight:number,lift:number,taper=0,entryLength=.12,turnBias=0) {
  const centre=mouth.reduce((v,p)=>v.add(p),new T.Vector3()).divideScalar(mouth.length);
  // The area centroid stays inside the narrow, rounded throat even when its
  // densely tessellated corner biases the arithmetic vertex average.
  let area=0,cy=0,cz=0;
  for(let i=0;i<mouth.length;i++){
    const a=mouth[i],b=mouth[(i+1)%mouth.length],cross=a.y*b.z-b.y*a.z;
    area+=cross;cy+=(a.y+b.y)*cross;cz+=(a.z+b.z)*cross;
  }
  centre.y=cy/(3*area);centre.z=cz/(3*area);
  const boundary=(angle:number)=>{
    const dy=Math.cos(angle),dz=side*Math.sin(angle);let distance=Infinity,x=centre.x;
    for(let i=0;i<mouth.length;i++){
      const a=mouth[i],b=mouth[(i+1)%mouth.length],ey=b.y-a.y,ez=b.z-a.z,det=dy*ez-dz*ey;
      if(Math.abs(det)<1e-10)continue;
      const t=((a.y-centre.y)*ez-(a.z-centre.z)*ey)/det,u=((a.y-centre.y)*dz-(a.z-centre.z)*dy)/det;
      if(t>0&&t<distance&&u>=0&&u<=1){distance=t;x=T.MathUtils.lerp(a.x,b.x,u);}
    }
    if(!Number.isFinite(distance))throw new Error(`Cooling inlet has no radial boundary at ${angle}`);
    return new T.Vector3(x,centre.y+dy*distance,centre.z+dz*distance);
  };
  const normal=new T.Vector3(0,1,0).transformDirection(frame);
  return Array.from({length:25},(_,row)=>Array.from({length:64},(_,i)=>{
    const angle=i*Math.PI*2/64,co=Math.cos(angle),si=Math.sin(angle),scale=1/Math.max(Math.abs(co),Math.abs(si));
    const a=boundary(angle),d=new T.Vector3(-halfWidth*co*scale,faceHeight,side*halfDepth*si*scale).applyMatrix4(frame);
    // The short LT plenum needs a shallower lower turn: equal control heights
    // fold that wall back through its roof while turning onto the broad core.
    const b=new T.Vector3(a.x-entryLength,a.y,T.MathUtils.lerp(a.z,d.z,taper)),c=d.clone().addScaledVector(normal,lift*(1+turnBias*(co-1)));
    return new T.CubicBezierCurve3(a,b,c,d).getPoint(row/24);
  }));
}

// Triangle order survives vertex welding and packed-asset quantization. Raw
// vertex offsets do not: use topology to recover the ordered outer sections.
export function readCoolingDuctSections(duct:T.Mesh,side:number) {
  const {position}=duct.geometry.attributes,index=duct.geometry.index!;
  return Array.from({length:25},(_,row)=>Array.from({length:64},(_,col)=>{
    const corner=row===24?(side>0?1:2):0,triangleRow=Math.min(row,23);
    return new T.Vector3().fromBufferAttribute(position,index.getX(triangleRow*384+col*6+corner)).applyMatrix4(duct.matrixWorld);
  }));
}
