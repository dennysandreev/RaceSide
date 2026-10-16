import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

type V = [number, number, number];
type Materials = Record<"carbon" | "metal" | "cast" | "darkMetal", T.Material>;

// A water/air plate-fin construction, not a measured Mercedes cooler. The
// longitudinal air passages and transverse coolant channels stay separate.
export function createChargeCooler(mat: Materials) {
  const root=new T.Group();root.name="Charge-air cooler";
  const ports:Record<string,V>={hot:[-.755,.538,.245],cold:[-.285,.538,.245],waterIn:[-.52,.570,.329],waterOut:[-.52,.506,.329]};
  const add=(name:string,g:T.BufferGeometry,m:T.Material,cover=false)=>{
    const part=new T.Mesh(g,m);part.name=name;part.userData={component:"intake",internal:true,serviceCover:cover};
    part.castShadow=true;part.receiveShadow=true;root.add(part);return part;
  };
  const rectangle=(x:number,y:number)=>new T.Shape([new T.Vector2(-x,-y),new T.Vector2(x,-y),new T.Vector2(x,y),new T.Vector2(-x,y)]);
  const ring=(name:string,a:V,b:V,inner:number,outer:number)=>{
    const axis=new T.Vector3(...b).sub(new T.Vector3(...a));
    const g=new T.LatheGeometry([[inner,0],[outer,0],[outer,axis.length()],[inner,axis.length()],[inner,0]].map(([r,y])=>new T.Vector2(r,y)),40);
    const part=add(name,g,mat.metal);part.position.set(...a);part.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),axis.normalize());return part;
  };
  const plateShape=rectangle(.140,.0015),bore=new T.Path();
  bore.moveTo(-.138,-.00075);bore.lineTo(-.138,.00075);bore.lineTo(.138,.00075);bore.lineTo(.138,-.00075);bore.closePath();plateShape.holes.push(bore);
  const plate=new T.ExtrudeGeometry(plateShape,{depth:.112,bevelEnabled:false,steps:1});plate.translate(-.52,0,.189);
  for(let i=0;i<9;i++){const g=plate.clone();g.translate(0,.506+i*.008,0);add(`Charge cooler water plate ${i}`,g,mat.metal);}plate.dispose();
  // Corrugated fins span each air gap. Their extrusion runs with the charge
  // flow, so neither face of the core is covered by a decorative solid slab.
  const points:T.Vector2[]=[];
  for(let i=0;i<=32;i++)points.push(new T.Vector2((i%2?1:-1)*.00235,-.054+i*.108/32));
  const finShape=new T.Shape([...points.map(p=>new T.Vector2(p.x-.0001,p.y)),...points.slice().reverse().map(p=>new T.Vector2(p.x+.0001,p.y))]);
  const fin=new T.ExtrudeGeometry(finShape,{depth:.280,bevelEnabled:false,steps:1});
  fin.rotateY(Math.PI/2);fin.rotateX(-Math.PI/2);fin.translate(-.66,0,.245);
  for(let i=0;i<8;i++){const g=fin.clone();g.translate(0,.510+i*.008,0);add(`Charge cooler air fins ${i}`,g,mat.metal);}fin.dispose();
  for(const y of [.502,.574]){const p=add(`Charge cooler cover ${y}`,new RoundedBoxGeometry(.284,.003,.116,2,.001),mat.cast,true);p.position.set(-.52,y,.245);}
  // Two thin header chambers collect the transverse water plates. End walls
  // are drilled around the return pipes rather than capped behind a fitting.
  for(const z of [.181,.309]){
    for(const y of [.497,.579]){const p=add(`Charge water header rail ${z} ${y}`,new T.BoxGeometry(.284,.002,.016),mat.cast);p.position.set(-.52,y,z);}
    for(const x of [-.661,-.379]){const p=add(`Charge water header end ${z} ${x}`,new T.BoxGeometry(.002,.082,.016),mat.cast);p.position.set(x,.538,z);}
    const shape=rectangle(.142,.041);
    if(z>.2)for(const y of [-.032,.032]){const hole=new T.Path();hole.absarc(0,y,.0055,0,Math.PI*2,true);shape.holes.push(hole);}
    const g=new T.ExtrudeGeometry(shape,{depth:.002,bevelEnabled:false,steps:1,curveSegments:16});g.translate(-.52,.538,z<.2?z-.009:z+.007);
    add(`Charge water header wall ${z}`,g,mat.cast);
    const tubePlate=rectangle(.142,.041);
    for(let i=0;i<9;i++){
      const y=-.032+i*.008,hole=new T.Path();hole.moveTo(-.138,y-.00075);hole.lineTo(-.138,y+.00075);hole.lineTo(.138,y+.00075);hole.lineTo(.138,y-.00075);hole.closePath();tubePlate.holes.push(hole);
    }
    const separator=new T.ExtrudeGeometry(tubePlate,{depth:.001,bevelEnabled:false,steps:1});separator.translate(-.52,.538,z<.2?.188:.301);
    add(`Charge cooler fluid separator ${z}`,separator,mat.cast);
  }
  for(const [name,y]of[["in",.570],["out",.506]]as const)ring(`Charge coolant ${name} union`,[-.52,y,.316],[-.52,y,.329],.0055,.0085);
  // Smooth rectangular-to-round tanks, with two skins and open end rims.
  for(const side of [-1,1]){
    const positions:number[]=[],indices:number[]=[],rows=16,radial=64;
    for(const inner of [false,true])for(let row=0;row<=rows;row++){
      const t=row/rows,e=t*t*(3-2*t),x=-.52+side*(.142+t*.093),wall=inner?.0015:0;
      for(let j=0;j<radial;j++){
        const angle=j/radial*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle);
        const flatY=(.037-wall)*Math.sign(c)*Math.pow(Math.abs(c),.3),flatZ=(.057-wall)*Math.sign(s)*Math.pow(Math.abs(s),.3);
        positions.push(x,.538+T.MathUtils.lerp(flatY,(.022-wall)*c,e),.245+T.MathUtils.lerp(flatZ,(.022-wall)*s,e));
      }
    }
    const n=(rows+1)*radial;
    for(let row=0;row<rows;row++)for(let j=0;j<radial;j++){
      const a=row*radial+j,b=row*radial+(j+1)%radial,c=a+radial,d=b+radial;
      indices.push(a,b,c,b,d,c,a+n,c+n,b+n,b+n,c+n,d+n);
    }
    for(const row of[0,rows])for(let j=0;j<radial;j++){
      const a=row*radial+j,b=row*radial+(j+1)%radial;
      if(row)indices.push(a,a+n,b,b,a+n,b+n);else indices.push(a,b,a+n,b,b+n,a+n);
    }
    if(side<0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
    const g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();
    add(`Charge cooler ${side<0?"hot":"cold"} tank`,g,mat.cast,true);
    ring(`Charge cooler air collar ${side}`,[-.52+side*.229,.538,.245],[-.52+side*.240,.538,.245],.0205,.025);
  }
  for(const x of[-.63,-.41])for(const z of[.176,.314]){
    const p=add(`Charge cooler mounting ear ${x} ${z}`,new RoundedBoxGeometry(.025,.007,.023,2,.002),mat.cast);p.position.set(x,.499,z);
    ring(`Charge cooler mounting bush ${x} ${z}`,[x,.495,z],[x,.505,z],.003,.0055);
  }
  root.userData.ports=ports;return{root,ports};
}
