import { surfaceIndex } from "./audit-madring-surfaces.mjs";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

// Audit the decoded delivery asset, including lossy Meshopt filters. Blender's
// source mesh alone cannot reveal collapsed paint or lost surface clearance.
export async function readMonzaMeshes(buffer) {
  await MeshoptDecoder.ready;
  const jsonLength = buffer.readUInt32LE(12);
  const gltf = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength));
  const binary = buffer.subarray(28 + jsonLength);
  const views = new Map();
  function accessor(index) {
    const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
    if (!views.has(a.bufferView)) {
      const compression = view.extensions?.EXT_meshopt_compression;
      if (compression) {
        const decoded = new Uint8Array(compression.count * compression.byteStride);
        MeshoptDecoder.decodeGltfBuffer(decoded, compression.count, compression.byteStride,
          binary.subarray(compression.byteOffset, compression.byteOffset + compression.byteLength), compression.mode, compression.filter);
        views.set(a.bufferView, decoded);
      } else {
        views.set(a.bufferView, binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
      }
    }
    const data = views.get(a.bufferView), offset = a.byteOffset ?? 0;
    const Constructor = { 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
    if (!Constructor) throw new Error(`Unsupported Monza accessor component ${a.componentType}`);
    const components = a.type === "VEC3" ? 3 : 1;
    return new Constructor(data.buffer, data.byteOffset + offset, a.count * components);
  }
  const meshes = new Map();
  for (const mesh of gltf.meshes) {
    const triangles = [];
    for (const primitive of mesh.primitives) {
      const positions = accessor(primitive.attributes.POSITION), indices = accessor(primitive.indices);
      for (let i = 0; i < indices.length; i += 3) {
        triangles.push(Array.from(indices.subarray(i, i + 3), (index) => Array.from(positions.subarray(index * 3, index * 3 + 3))));
      }
    }
    meshes.set(mesh.name, triangles);
  }
  return meshes;
}

// Clip in plan view while retaining height. Unlike a centroid test, this also
// catches a thin fence, a long wall, or a triangle whose tip crosses the road.
export function clipToRoad(triangle, road) {
  let polygon = triangle;
  const cross = (a,b,p) => (b[0]-a[0])*(p[2]-a[2])-(b[2]-a[2])*(p[0]-a[0]);
  const orientation = Math.sign(cross(road[0],road[1],road[2]));
  if (!orientation) return [];
  for (let i=0;i<3 && polygon.length;i++) {
    const a=road[i], b=road[(i+1)%3], output=[];
    for (let j=0;j<polygon.length;j++) {
      const p=polygon[j], q=polygon[(j+1)%polygon.length];
      const dp=orientation*cross(a,b,p), dq=orientation*cross(a,b,q);
      if(dp>=0) output.push(p);
      if((dp>=0)!==(dq>=0)) {
        const t=dp/(dp-dq);
        output.push(p.map((v,k)=>v+t*(q[k]-v)));
      }
    }
    polygon=output;
  }
  return polygon;
}

function triangleIndex(triangles) {
  const cells=new Map(), size=16;
  function keys(triangle) {
    const xs=triangle.map(v=>Math.floor(v[0]/size)), zs=triangle.map(v=>Math.floor(v[2]/size));
    const result=[];
    for(let x=Math.min(...xs);x<=Math.max(...xs);x++) for(let z=Math.min(...zs);z<=Math.max(...zs);z++) result.push(`${x},${z}`);
    return result;
  }
  for(const triangle of triangles) for(const key of keys(triangle)) {
    if(!cells.has(key))cells.set(key,[]);
    cells.get(key).push(triangle);
  }
  return triangle=>new Set(keys(triangle).flatMap(key=>cells.get(key)??[]));
}

export function auditCorridorObjects(meshes, road, allowedOverhead = () => false) {
  const candidates=triangleIndex(road), floor=surfaceIndex(road);
  const obstructions=[], elevated=[];
  let checkedTriangles=0;
  for(const [name,triangles] of meshes) for(const triangle of triangles) {
    checkedTriangles++;
    for(const roadTriangle of candidates(triangle)) {
      const polygon=clipToRoad(triangle,roadTriangle);
      if(!polygon.length)continue;
      const gaps=polygon.map(p=>p[1]-(floor(p[0],p[2])??Infinity));
      const min=Math.min(...gaps), max=Math.max(...gaps);
      if(max<=.18)continue; // Surface paint/kerb height, or buried foundations.
      const p=polygon[0];
      if(min>=4.5 && allowedOverhead(name,p)) elevated.push(min);
      else {
        obstructions.push({mesh:name,clearanceMeters:Number(min.toFixed(4)),point:p});
        break;
      }
    }
  }
  return {checkedTriangles,obstructions,elevated};
}

export async function auditMonzaSurfaces(buffer) {
  const meshes=await readMonzaMeshes(buffer);
  const get=name=>meshes.get(`${name}_Mesh`)??[];
  const gp=get("FIA_Monza_Centreline_12m"), pit=get("FIA_Pit_Lane");
  const road=[...gp,...pit], roadFloor=surfaceIndex(road);
  const ground=surfaceIndex(get("PCN_Monza_DTM_Terrain_RealScale"));
  function clearance(triangles,support) {
    let minimum=Infinity, intersections=0, missingSupport=0;
    for(const triangle of triangles) for(const weights of [[1/3,1/3,1/3],[.9,.05,.05],[.05,.9,.05],[.05,.05,.9]]) {
      const p=triangle[0].map((_,axis)=>triangle.reduce((sum,v,i)=>sum+v[axis]*weights[i],0));
      const floor=support(p[0],p[2]);
      if(floor===null){missingSupport++;continue;}
      const gap=p[1]-floor;
      minimum=Math.min(minimum,gap);
      if(gap<=.005)intersections++;
    }
    return {triangles:triangles.length,minimumClearanceMeters:Number(minimum.toFixed(5)),intersections,missingSupport};
  }
  const structures=new Map([...meshes].filter(([name])=>!/(?:Terrain|Centreline|^FIA_Pit_Lane_Mesh|Track_Edge_Lines|Control_Lines|Runoff|Curbs|Markings|Working_Boxes)/.test(name)));
  // The north banking crosses the GP before Ascari. No blanket "Oval" exception:
  // a raised historic straight over start/finish is an error, whatever its height.
  const {utm32nFromWgs84}=await import("./export-monza-track-data.mjs");
  const [east,north]=utm32nFromWgs84(45.62479645,9.2892197);
  const crossing={x:east-522415,z:5051590-north};
  const audit=auditCorridorObjects(structures,road,(name,p)=>
    /Start_Finish_Gantry|Garage_Pit_Complex/.test(name) ||
    (/Historic_Banked_Oval/.test(name)&&Math.hypot(p[0]-crossing.x,p[2]-crossing.z)<35));
  const gpFloor=surfaceIndex(gp);
  let mergeSamples=0,maximumMergeStep=0;
  for(const triangle of pit) {
    const p=triangle[0].map((_,axis)=>triangle.reduce((sum,v)=>sum+v[axis],0)/3);
    const floor=gpFloor(p[0],p[2]);
    if(floor===null)continue;
    mergeSamples++;
    maximumMergeStep=Math.max(maximumMergeStep,Math.abs(p[1]-floor));
  }
  return {
    road:clearance(road,ground),edgePaint:clearance(get("Track_Edge_Lines"),roadFloor),
    pitPaint:clearance(get("Monza_Pit_Fast_Lane_And_10_Working_Boxes"),roadFloor),
    pitJoins:{samples:mergeSamples,maximumStepMeters:Number(maximumMergeStep.toFixed(5))},
    elevatedCrossings:{samples:audit.elevated.length,minimumHeadroomMeters:Number(Math.min(...audit.elevated).toFixed(4))},
    obstructions:{checkedTriangles:audit.checkedTriangles,triangles:audit.obstructions.length,examples:audit.obstructions.slice(0,20)},
  };
}
