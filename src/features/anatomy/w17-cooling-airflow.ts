import * as T from "three";
import type { AirflowPath } from "./w17-airflow.ts";
import { readCoolingDuctSections } from "./w17-cooling-duct.ts";

type Point = [number, number, number];
// Qualitative paths through the reconstructed free volume. These stations were
// fitted to the installed solids, not calculated with a pressure/heat solver.
// Left and right routes differ because their service hardware is asymmetric.
const outlets: Record<number, Point[]> = {
  [-1]: [
    [-0.178631, 0.399221, -0.415350],
    [-0.211174, 0.399894, -0.419367],
    [-0.270001, 0.400241, -0.419734],
    [-0.290000, 0.401360, -0.418380],
    [-0.310000, 0.404583, -0.413878],
    [-0.350000, 0.415441, -0.391701],
    [-0.380000, 0.420000, -0.375507],
    [-0.410000, 0.424559, -0.366117],
    [-0.460000, 0.437351, -0.352408],
    [-0.510000, 0.439977, -0.342390],
    [-0.560000, 0.440000, -0.319429],
    [-0.620000, 0.440000, -0.276007],
    [-0.650000, 0.440000, -0.263346],
    [-0.680000, 0.440000, -0.260265],
    [-0.870000, 0.440696, -0.259386],
    [-0.900000, 0.445962, -0.255417],
    [-0.950000, 0.471965, -0.242649],
    [-0.970000, 0.480989, -0.240614],
    [-0.990000, 0.486446, -0.240081],
    [-1.030000, 0.489816, -0.240000],
    [-1.150000, 0.490000, -0.239735],
    [-1.180000, 0.490000, -0.236649],
    [-1.210000, 0.490000, -0.223793],
    [-1.290000, 0.490000, -0.155506],
    [-1.340000, 0.490000, -0.124580],
    [-1.380000, 0.490005, -0.093091],
    [-1.400000, 0.490081, -0.080437],
    [-1.420000, 0.490615, -0.073349],
    [-1.440000, 0.492668, -0.070701],
    [-1.530000, 0.516901, -0.070000],
    [-1.570000, 0.519820, -0.070000],
    [-1.680000, 0.519994, -0.070000],
    [-1.720000, 0.519299, -0.069999],
    [-1.740000, 0.516654, -0.069981],
    [-1.770000, 0.503990, -0.069560],
    [-1.800000, 0.481545, -0.066963],
    [-1.830000, 0.460144, -0.061071],
    [-1.850000, 0.449794, -0.056236],
    [-1.880000, 0.439389, -0.048929],
    [-1.910000, 0.433056, -0.043037],
    [-1.930000, 0.430944, -0.040943],
    [-2.020000, 0.431000, -0.045000],
    [-2.080000, 0.440000, -0.055000],
    [-2.200000, 0.450000, -0.065000],
  ],
  1: [
    [-0.178631, 0.399221, 0.415350],
    [-0.230208, 0.399981, 0.419647],
    [-0.260005, 0.400000, 0.417348],
    [-0.280000, 0.400005, 0.412884],
    [-0.320000, 0.400614, 0.401967],
    [-0.350000, 0.404583, 0.394493],
    [-0.390000, 0.415417, 0.374254],
    [-0.420000, 0.419386, 0.358626],
    [-0.480000, 0.420000, 0.344575],
    [-0.530000, 0.420000, 0.325507],
    [-0.550000, 0.420000, 0.321539],
    [-0.620000, 0.420000, 0.319075],
    [-0.710000, 0.420436, 0.308818],
    [-0.790000, 0.429075, 0.291360],
    [-0.870000, 0.431361, 0.288639],
    [-0.890000, 0.434601, 0.285399],
    [-0.940000, 0.449138, 0.270925],
    [-0.970000, 0.456431, 0.264494],
    [-1.020000, 0.466963, 0.259914],
    [-1.050000, 0.469560, 0.256741],
    [-1.070000, 0.469937, 0.250240],
    [-1.120000, 0.470000, 0.225938],
    [-1.140000, 0.470000, 0.221534],
    [-1.190000, 0.470000, 0.215976],
    [-1.210000, 0.470000, 0.209948],
    [-1.230000, 0.470001, 0.200698],
    [-1.260000, 0.470081, 0.182184],
    [-1.290000, 0.471360, 0.159802],
    [-1.360000, 0.487351, 0.101189],
    [-1.380000, 0.489391, 0.086146],
    [-1.400000, 0.490000, 0.076204],
    [-1.420000, 0.490609, 0.071626],
    [-1.440000, 0.492649, 0.070265],
    [-1.500000, 0.507351, 0.070000],
    [-1.540000, 0.509919, 0.070000],
    [-1.690000, 0.509976, 0.070000],
    [-1.740000, 0.506717, 0.069981],
    [-1.770000, 0.494914, 0.069560],
    [-1.820000, 0.463715, 0.063310],
    [-1.850000, 0.449358, 0.056236],
    [-1.890000, 0.436870, 0.046690],
    [-1.930000, 0.430944, 0.040943],
    [-2.020000, 0.431000, 0.045000],
    [-2.080000, 0.440000, 0.055000],
    [-2.200000, 0.450000, 0.065000],
  ],
};

function ductLane(root:T.Object3D,packName:string,ductName:string,side:number,x:number,z:number,halfWidth:number,halfDepth:number,back:number) {
  const pack=root.getObjectByName(packName),duct=root.getObjectByName(ductName) as T.Mesh | undefined;
  if(!pack||!duct)throw new Error(`Missing cooling airflow geometry: ${ductName}`);
  const world=(x:number,y:number,z:number)=>new T.Vector3(x,y,z).applyMatrix4(pack.matrixWorld);
  const rings=readCoolingDuctSections(duct,side);
  const angle=(Math.atan2(side*z/halfDepth,-x/halfWidth)+Math.PI*2)%(Math.PI*2);
  const column=angle*64/(Math.PI*2),j=Math.floor(column),blend=column-j,weight=Math.max(Math.abs(x/halfWidth),Math.abs(z/halfDepth));
  const channel=rings.map(ring=>{
    const centre=ring.reduce((sum,p)=>sum.add(p),new T.Vector3()).divideScalar(ring.length);
    return centre.lerp(ring[j].clone().lerp(ring[(j+1)%64],blend),weight);
  });
  const face=pack.worldToLocal(channel.at(-1)!.clone()).y,correction=world(x,face,z).sub(channel.at(-1)!);
  channel.forEach((p,i)=>p.addScaledVector(correction,(i/24)**2));
  const points=Array.from({length:10},(_,i)=>channel[0].clone().add(new T.Vector3(.25*(1-i/10),0,0))).concat(channel);
  for(let i=1;i<=12;i++)points.push(world(x,T.MathUtils.lerp(face,back,i/12),z));
  return {points,world};
}

export function createCoolingAirflowPaths(root:T.Object3D):AirflowPath[] {
  root.updateMatrixWorld(true);
  const paths:AirflowPath[]=[-1,1].map(side=>{
    // An actual open fin cell, between adjacent coolant tubes.
    const x=-.216,z=-side*.02018181818181818;
    const {points,world}=ductLane(root,`Radiator pack ${side}`,`Radiator inlet duct ${side}`,side,x,z,.299,.112,-.025);
    const radii=points.map(()=>.00065),controls=outlets[side].slice(1).map(p=>new T.Vector3(...p));
    const turn=new T.CubicBezierCurve3(points.at(-1)!,world(x,-.046,z),controls[0].clone().add(new T.Vector3(.025,0,0)),controls[0]);
    for(const [i,p]of turn.getPoints(24).slice(1).entries()){points.push(p);radii.push(T.MathUtils.lerp(.00065,.0012,(i+1)/24));}
    const exit=new T.CatmullRomCurve3(controls,false,"centripetal");
    for(const p of exit.getSpacedPoints(240).slice(1)){points.push(p);radii.push(.0012);}
    return {id:`cooling-${side}`,layer:"cooling",corner:points,straight:points.map(p=>p.clone()),radii};
  });
  // The separate LT circuit receives fresh air through the upper branch of
  // the right inlet. This is cooling air, not compressed combustion air.
  const x=-.074,z=-.00015;
  const {points,world}=ductLane(root,"Charge low-temperature radiator","Charge radiator inlet duct",1,x,z,.148,.075,-.012);
  const radii=points.map(()=>.0006);
  const controls=[[-.16,.535,.390],[-.25,.526,.395],[-.32,.50,.400],[-.37,.445,.380],...outlets[1].slice(7)].map(p=>new T.Vector3(...p));
  const turn=new T.CubicBezierCurve3(points.at(-1)!,world(x,-.028,z),controls[0].clone().add(new T.Vector3(.025,0,0)),controls[0]);
  for(const [i,p]of turn.getPoints(24).slice(1).entries()){points.push(p);radii.push(T.MathUtils.lerp(.0006,.0012,(i+1)/24));}
  for(const p of new T.CatmullRomCurve3(controls,false,"centripetal").getSpacedPoints(260).slice(1)){points.push(p);radii.push(.0012);}
  paths.push({id:"cooling-lt",layer:"cooling",corner:points,straight:points.map(p=>p.clone()),radii});
  return paths;
}
