import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { surfaceIndex } from "./audit-madring-surfaces.mjs";

// Test the actual compressed delivery geometry, not only Blender's source mesh.
export async function auditSingaporeSurfaces(buffer) {
  await MeshoptDecoder.ready;
  const length = buffer.readUInt32LE(12);
  const gltf = JSON.parse(buffer.toString("utf8", 20, 20 + length));
  const binary = buffer.subarray(28 + length), views = new Map();
  function accessor(index) {
    const item = gltf.accessors[index], view = gltf.bufferViews[item.bufferView];
    if (!views.has(item.bufferView)) {
      const compression = view.extensions?.EXT_meshopt_compression;
      if (compression) {
        const output = new Uint8Array(compression.count * compression.byteStride);
        MeshoptDecoder.decodeGltfBuffer(output, compression.count, compression.byteStride,
          binary.subarray(compression.byteOffset, compression.byteOffset + compression.byteLength), compression.mode, compression.filter);
        views.set(item.bufferView, output);
      } else views.set(item.bufferView, binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
    }
    const output = views.get(item.bufferView);
    const Type = { 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[item.componentType];
    if (!Type) throw new Error(`Unsupported Singapore accessor ${item.componentType}`);
    return new Type(output.buffer, output.byteOffset + (item.byteOffset ?? 0), item.count * (item.type === "VEC3" ? 3 : 1));
  }
  const meshes = new Map();
  for (const mesh of gltf.meshes) {
    const triangles = [];
    for (const primitive of mesh.primitives) {
      const positions = accessor(primitive.attributes.POSITION), indices = accessor(primitive.indices);
      for (let i = 0; i < indices.length; i += 3) triangles.push(Array.from(indices.subarray(i, i + 3), (j) => Array.from(positions.subarray(j * 3, j * 3 + 3))));
    }
    meshes.set(mesh.name, triangles);
  }
  const get = (name) => meshes.get(`Singapore_${name}_Mesh`) ?? [];
  const road = [...get("Raceway"), ...get("Pit_Lane")];
  const roadFloor = surfaceIndex(road), ground = surfaceIndex(get("Terrain"));
  const samples = ([a, b, c]) => [[1/3,1/3,1/3],[.8,.1,.1],[.1,.8,.1],[.1,.1,.8]].map((w) => a.map((_, i) => a[i]*w[0]+b[i]*w[1]+c[i]*w[2]));
  function clearance(triangles, support) {
    let minimum = Infinity, intersections = 0, missingSupport = 0; const failures = [];
    for (const triangle of triangles) for (const p of samples(triangle)) {
      const floor = support(p[0], p[2]);
      if (floor === null) { missingSupport++; if(failures.length<8) failures.push({p,missing:true}); continue; }
      const gap = p[1] - floor;
      minimum = Math.min(minimum, gap);
      if (gap <= .005) { intersections++; if (failures.length < 8) failures.push({p,gap}); }
    }
    return { triangles: triangles.length, minimumClearanceMeters: Number(minimum.toFixed(5)), intersections, missingSupport, failures };
  }
  const structuralConflicts = {};
  // A roof over the track still indicates a misplaced enclosed building. Bridges
  // and the start gantry are separate meshes and have their own clearance audit.
  for (const name of ["Facades","Roofs","Grandstands","Safety_Walls","Landmarks"]) {
    const conflicts=[]; let count=0;
    for (const triangle of get(name)) for (const p of [...triangle,...samples(triangle)]) {
      if (roadFloor(p[0],p[2]) === null) continue;
      count++; if(conflicts.length<6) conflicts.push(p);
    }
    if(count) structuralConflicts[name]={count,points:conflicts};
  }
  let bridgeConflicts = 0, minimumBridgeClearance = Infinity; const bridgeFailureLocations = new Map();
  for (const triangle of get("Elevated_Bridges")) for (const p of [...triangle,...samples(triangle)]) {
    const floor=roadFloor(p[0],p[2]); if(floor===null)continue;
    const gap=p[1]-floor;
    // Source-aligned approach roads meet the city at ground level, beneath the
    // race ribbon. Only geometry above the driving surface can block headroom.
    if (gap < -.03) continue;
    minimumBridgeClearance=Math.min(minimumBridgeClearance,gap);
    if(gap<4.5){bridgeConflicts++; const key=`${Math.round(p[0]/20)},${Math.round(p[2]/20)}`; if(!bridgeFailureLocations.has(key))bridgeFailureLocations.set(key,{p,gap});}
  }
  const bridgeFloor=surfaceIndex([...get("Elevated_Bridges"),...get("Race_Bridge_Decks"),...get("Bridge_Rails_And_Paint")]);
  const standFloor=surfaceIndex(get("Grandstands"));
  let bridgeGrandstandConflicts=0;
  for(const [triangles,support] of [[get("Grandstands"),bridgeFloor],[get("Elevated_Bridges"),standFloor]]) {
    for(const triangle of triangles) for(const p of [...triangle,...samples(triangle)]) {
      if(support(p[0],p[2])!==null)bridgeGrandstandConflicts++;
    }
  }
  // Clearance alone allowed an 8 m false embankment to lift the entire road.
  // Measure the actual triangle gradient after meshopt decoding as well.
  let maximumGrade = 0; let worstTriangle;
  for (const [a,b,c] of road) {
    const u=b.map((v,i)=>v-a[i]),v=c.map((value,i)=>value-a[i]);
    const nx=u[1]*v[2]-u[2]*v[1],ny=u[2]*v[0]-u[0]*v[2],nz=u[0]*v[1]-u[1]*v[0];
    if(Math.abs(ny)>.000001) { const grade=Math.hypot(nx,nz)/Math.abs(ny)*100; if(grade>maximumGrade) { maximumGrade=grade; worstTriangle=[a,b,c]; } }
  }
  return { road:{...clearance(road,ground),maximumGradePercent:maximumGrade,worstTriangle}, paint:clearance([...get("Edge_And_Pit_Paint")],roadFloor),
    structuralConflicts, bridgeConflicts, bridgeGrandstandConflicts, bridgeFailureLocations:[...bridgeFailureLocations.values()], minimumBridgeClearanceMeters:Number.isFinite(minimumBridgeClearance)?minimumBridgeClearance:null };
}
