import * as T from "three";
import { engineCylinderX } from "./w17-engine-core.ts";

type V=[number,number,number];
type Materials=Record<"metal"|"darkMetal"|"rubber"|"black"|"ceramic"|"copper",T.Material>;
const vec=(p:V)=>new T.Vector3(...p);

// C5.10: one coil and one conventional exposed-gap plug per cylinder.
// Pencil-coil packaging, dimensions and loom routing are reconstructed;
// these are not identified Mercedes supplier parts or factory windings.
export function createEngineIgnition(core:T.Group,mat:Materials){
  const root=new T.Group();root.name="Engine ignition system";core.add(root);
  const add=(parent:T.Object3D,name:string,g:T.BufferGeometry,material=mat.metal,cover=false)=>{
    const part=new T.Mesh(g,material);part.name=name;part.userData={component:"engine",internal:true,engineIgnition:true,serviceCover:cover};part.castShadow=part.receiveShadow=true;parent.add(part);return part;
  };
  const ring=(parent:T.Object3D,name:string,inner:number,outer:number,a:number,b:number,material=mat.metal,cover=false,segments=24)=>
    add(parent,name,new T.LatheGeometry([[inner,a],[outer,a],[outer,b],[inner,b],[inner,a]].map(p=>new T.Vector2(...p)),segments),material,cover);
  const box=(parent:T.Object3D,name:string,p:V,size:V,material=mat.black,cover=false)=>{const m=add(parent,name,new T.BoxGeometry(...size),material,cover);m.position.set(...p);return m;};
  const cable=(parent:T.Object3D,name:string,points:V[],radius:number,from:string,to:string)=>{
    const curve=new T.CatmullRomCurve3(points.map(vec),false,"centripetal");
    const m=add(parent,name,new T.TubeGeometry(curve,Math.max(16,points.length*8),radius,8,false),mat.black);
    m.userData={...m.userData,ignitionRoute:points,outerRadius:radius,ignitionFrom:from,ignitionTo:to};return m;
  };
  const bankPoint=(side:number,p:V):V=>vec(p).applyAxisAngle(new T.Vector3(1,0,0),side*Math.PI/4).toArray() as V;
  const entry:V=[-.278,.104,-.141],split:V=[-.255,.248,-.160];
  const feed=cable(root,"Ignition supply loom",[entry,[-.278,.104,-.153],[-.270,.119,-.170],[-.255,.165,-.170],split],.0033,"Engine harness socket","Ignition loom split");
  const boot=ring(root,"Ignition harness exit boot",.0033,.005,0,.008,mat.rubber);boot.rotation.x=-Math.PI/2;boot.position.set(...entry);
  box(root,"Ignition loom split",split,[.009,.012,.012],mat.rubber);
  root.userData.ignitionEntry=entry;
  feed.userData.ignitionEndpoint="Engine harness mounting flange";
  for(const side of[-1,1]){
    const bank=new T.Group();bank.name=`Ignition bank ${side}`;bank.rotation.x=side*Math.PI/4;root.add(bank);
    const first=engineCylinderX(side,0),last=engineCylinderX(side,2),front=last+.052;
    const trunkStart:V=[front+.015,.314,-side*.040],trunkEnd:V=[first,.314,-side*.040];
    const start=bankPoint(side,trunkStart);
    const cross:V[]=side===1?[[-.280,.248,-.130],[-.280,.248,-.080],[-.280,.248,.080],[-.280,.248,.130]]:[];
    cable(root,`Ignition bank feed ${side}`,[split,...cross,[-.255,.248,side*.190],[-.255,.315,side*.190],[-.350,.315,side*.194],[-.410,.280,side*.194],start],.0028,"Ignition loom split",`Ignition rail ${side}`);
    cable(bank,`Ignition rail ${side}`,[trunkStart,trunkEnd],.0022,`Ignition bank feed ${side}`,`Ignition connector ${side} 0`);
    // Two saddles hold each loom above the cam cover, between plug wells.
    for(let i=0;i<2;i++){
      const x=(engineCylinderX(side,i)+engineCylinderX(side,i+1))/2;
      const clip=ring(bank,`Ignition rail clip ${side} ${i}`,.0022,.0035,-.004,.004,mat.rubber);clip.rotation.z=-Math.PI/2;clip.position.set(x,.314,-side*.040);
      box(bank,`Ignition rail saddle ${side} ${i}`,[x,.305,-side*.040],[.010,.012,.008],mat.darkMetal);
    }
    for(let i=0;i<3;i++){
      const x=engineCylinderX(side,i),unit=new T.Group();unit.name=`Ignition unit ${side} ${i}`;unit.position.x=x;bank.add(unit);
      const id=`${side} ${i}`;
      // Metal shell and seating washer surround a continuous ceramic insulator.
      ring(unit,`Spark plug ${id}`,.0025,.00455,.176,.212,mat.metal);
      const threadPoints=Array.from({length:289},(_,j)=>{const t=j/288,a=t*Math.PI*2*16;return new T.Vector3(Math.cos(a)*.00462,.178+t*.016,Math.sin(a)*.00462);});
      add(unit,`Spark plug thread ${id}`,new T.TubeGeometry(new T.CatmullRomCurve3(threadPoints),288,.00025,4,false),mat.metal);
      ring(unit,`Spark plug seat ${id}`,.0025,.0067,.2105,.212,mat.metal);
      ring(unit,`Spark plug hex ${id}`,.0025,.0069,.212,.219,mat.metal,false,6);
      const profile=[[.0005,.1748],[.0017,.1748],[.0025,.180],[.0025,.219],[.0042,.221],[.0042,.238],[.0032,.241],[.0032,.250],[.0005,.250],[.0005,.1748]];
      add(unit,`Spark plug insulator ${id}`,new T.LatheGeometry(profile.map(p=>new T.Vector2(...p)),24),mat.ceramic);
      ring(unit,`Spark plug centre electrode ${id}`,0,.0005,.1745,.250,mat.metal);
      ring(unit,`Spark plug terminal ${id}`,.0005,.0022,.248,.257,mat.metal);
      ring(unit,`Spark plug dry well ${id}`,.0086,.009,.2105,.299,mat.darkMetal,true);
      // Ground strap meets the shell and leaves a 0.6 mm open firing gap.
      box(unit,`Spark plug ground leg ${id}`,[.004,.176,0],[.0014,.0064,.0015],mat.metal);
      box(unit,`Spark plug ground tip ${id}`,[.00165,.1733,0],[.0047,.0012,.0015],mat.metal);
      ring(unit,`Ignition boot ${id}`,.0043,.0059,.232,.265,mat.rubber,true);
      ring(unit,`Ignition terminal contact ${id}`,.0022,.0027,.251,.260,mat.metal);
      ring(unit,`Ignition HV contact ${id}`,0,.001,.259,.267,mat.metal);
      ring(unit,`Ignition HV winding termination ${id}`,.001,.0044,.266,.267,mat.copper);
      // Concentric winding packs and insulation, without drawing thousands
      // of fictitious individual turns or assigning a supplier specification.
      ring(unit,`Ignition magnetic core ${id}`,0,.0023,.268,.307,mat.darkMetal);
      ring(unit,`Ignition secondary bobbin ${id}`,.0023,.0028,.266,.309,mat.rubber);
      ring(unit,`Ignition secondary winding pack ${id}`,.0028,.0044,.267,.307,mat.copper);
      ring(unit,`Ignition interwinding insulation ${id}`,.0044,.0049,.266,.309,mat.rubber);
      ring(unit,`Ignition primary winding pack ${id}`,.0049,.0063,.268,.307,mat.copper);
      ring(unit,`Ignition connector ${id}`,.0063,.0085,.265,.317,mat.black,true);
      ring(unit,`Ignition boot shoulder ${id}`,.0059,.0085,.263,.265,mat.black,true);
      ring(unit,`Ignition coil cap ${id}`,0,.0085,.317,.319,mat.black,true);
      ring(unit,`Ignition well seal ${id}`,.0085,.010,.298,.301,mat.rubber,true);
      box(unit,`Ignition retaining tab ${id}`,[.013,.302,0],[.017,.006,.010],mat.darkMetal,true);
      const fixing=ring(unit,`Ignition retaining screw ${id}`,0,.002,.296,.307,mat.metal,true);fixing.position.x=.018;
      const socketZ=-side*.014,plugZ=-side*.022;
      box(unit,`Ignition socket ${id}`,[0,.312,socketZ],[.012,.010,.012],mat.black,true);
      box(unit,`Ignition plug ${id}`,[0,.312,plugZ],[.010,.008,.008],mat.rubber,true);
      box(unit,`Ignition connector latch ${id}`,[0,.317,-side*.019],[.005,.002,.014],mat.darkMetal,true);
      for(const px of[-.003,0,.003]){
        const pin=ring(unit,`Ignition contact pin ${id} ${px}`,0,.00065,.006,.024,mat.metal);pin.rotation.x=-side*Math.PI/2;pin.position.set(px,.312,0);
        const z=px===0?.0035:.0055,lead=new T.CatmullRomCurve3([new T.Vector3(px,.312,-side*.007),new T.Vector3(px,.310,-side*z),new T.Vector3(px,.307,-side*z)],false,"centripetal");
        add(unit,`Ignition winding terminal lead ${id} ${px}`,new T.TubeGeometry(lead,12,.00035,6,false),mat.copper);
      }
      cable(bank,`Ignition coil lead ${id}`,[[x,.312,-side*.026],[x,.312,-side*.030],[x,.314,-side*.036],[x,.314,-side*.040]],.0018,`Ignition plug ${id}`,`Ignition rail ${side}`);
    }
  }
  return root;
}
