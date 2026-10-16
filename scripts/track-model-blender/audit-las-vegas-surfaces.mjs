import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { surfaceIndex } from "./audit-madring-surfaces.mjs";

// Inspect the compressed asset actually delivered to the browser.
export async function auditLasVegasSurfaces(buffer) {
  await MeshoptDecoder.ready;
  const jsonLength = buffer.readUInt32LE(12);
  const gltf = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength));
  const binary = buffer.subarray(28 + jsonLength);
  const views = new Map();
  function accessor(index) {
    const item = gltf.accessors[index];
    const view = gltf.bufferViews[item.bufferView];
    if (!views.has(item.bufferView)) {
      const compression = view.extensions?.EXT_meshopt_compression;
      if (compression) {
        const output = new Uint8Array(compression.count * compression.byteStride);
        MeshoptDecoder.decodeGltfBuffer(output, compression.count, compression.byteStride,
          binary.subarray(compression.byteOffset, compression.byteOffset + compression.byteLength), compression.mode, compression.filter);
        views.set(item.bufferView, output);
      } else {
        views.set(item.bufferView, binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
      }
    }
    const output = views.get(item.bufferView);
    const [bytes, reader] = { 5121: [1, "getUint8"], 5123: [2, "getUint16"], 5125: [4, "getUint32"], 5126: [4, "getFloat32"] }[item.componentType] ?? [];
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[item.type];
    if (!reader || !components) throw new Error(`Unsupported LasVegas accessor ${item.componentType}/${item.type}`);
    const data = new DataView(output.buffer, output.byteOffset, output.byteLength);
    const stride = view.byteStride ?? components * bytes;
    return Array.from({ length: item.count }, (_, row) => Array.from({ length: components }, (_, column) =>
      data[reader]((item.byteOffset ?? 0) + row * stride + column * bytes, true)));
  }
  const meshes = new Map();
  const facadeHorizontalTiles = [], facadeVerticalTiles = [];
  const textures = { physicalPrimitives: 0, texturedPrimitives: 0, missingTextures: [], invalidUvs: [], collapsedKerbUvTriangles: 0 };
  const ribbonTopology = {};
  const ribbonEdges = new Map();
  for (const mesh of gltf.meshes ?? []) {
    const triangles = [];
    for (const primitive of mesh.primitives) {
      const positions = accessor(primitive.attributes.POSITION);
      const indices = primitive.indices === undefined ? positions.map((_, i) => i) : accessor(primitive.indices).flat();
      if (/LasVegas_(Raceway|Pit_Lane|Casino_Kerbs|Edge_And_Pit_Markings)_Mesh/.test(mesh.name)) {
        const entry = ribbonTopology[mesh.name] ??= { positive: 0, negative: 0, degenerate: 0, adjacentWindingFlips: 0, minimumAreaSquareMeters: Infinity };
        const edges = ribbonEdges.get(mesh.name) ?? new Map();
        ribbonEdges.set(mesh.name,edges);
        for (let i = 0; i < indices.length; i += 3) {
          const [a,b,c] = indices.slice(i,i+3).map(index => positions[index]);
          const area = ((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]))/2;
          entry.minimumAreaSquareMeters=Math.min(entry.minimumAreaSquareMeters,Math.abs(area));
          if (Math.abs(area)<.00001) entry.degenerate++;
          else entry[area>0?'positive':'negative']++;
          // Opposite sides of paint/kerbs intentionally use opposite winding.
          // A sign change across an edge shared by two triangles is a fold.
          const keys=[a,b,c].map(p=>p.map(v=>v.toFixed(3)).join(','));
          for (const [first,second] of [[0,1],[1,2],[2,0]]) {
            const key=[keys[first],keys[second]].sort().join('|');
            if (edges.has(key) && edges.get(key)*area<0) entry.adjacentWindingFlips++;
            edges.set(key,area);
          }
        }
      }
      for (let i = 0; i < indices.length; i += 3) triangles.push(indices.slice(i, i + 3).map((index) => positions[index]));
      if (!mesh.name?.startsWith("LasVegas_") || /Sector/.test(mesh.name)) continue;
      textures.physicalPrimitives += 1;
      const material = gltf.materials?.[primitive.material];
      const image = gltf.images?.[gltf.textures?.[material?.pbrMetallicRoughness?.baseColorTexture?.index]?.source];
      if (image?.bufferView === undefined || primitive.attributes.TEXCOORD_0 === undefined) {
        textures.missingTextures.push({ mesh: mesh.name, material: material?.name });
        continue;
      }
      textures.texturedPrimitives += 1;
      const uv = accessor(primitive.attributes.TEXCOORD_0);
      if (mesh.name === "LasVegas_Casino_Kerbs_Mesh") for (let i=0;i<indices.length;i+=3) {
        const [a,b,c]=indices.slice(i,i+3).map(index=>uv[index]);
        const area=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
        if (area<.00001) textures.collapsedKerbUvTriangles++;
      }
      if (mesh.name === "LasVegas_Buildings_Mesh") {
        for (let i = 0; i < indices.length; i += 3) {
          const [p,q,r] = indices.slice(i,i+3).map(index=>positions[index]);
          const u=q.map((v,k)=>v-p[k]), v=r.map((value,k)=>value-p[k]);
          const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
          if(Math.abs(normal[1]) / Math.hypot(...normal) > .9) continue; // Guitar cap surfaces are roofs.
          for (const [a, b] of [[indices[i], indices[i + 1]], [indices[i + 1], indices[i + 2]], [indices[i + 2], indices[i]]]) {
          const dy = Math.abs(positions[a][1] - positions[b][1]);
          const horizontal = Math.hypot(positions[a][0] - positions[b][0], positions[a][2] - positions[b][2]);
          const du = Math.abs(uv[a][0] - uv[b][0]), dv = Math.abs(uv[a][1] - uv[b][1]);
          if (dy > .5 && horizontal < .005 && du < .00001 && dv > .001) facadeVerticalTiles.push(dy / dv);
          if (horizontal > 2 && dy < .005 && dv < .00001 && du > .001) facadeHorizontalTiles.push(horizontal / du);
          }
        }
      }
      const spans = [0, 1].map((axis) => uv.reduce((v, p) => Math.max(v, p[axis]), -Infinity) - uv.reduce((v, p) => Math.min(v, p[axis]), Infinity));
      if (uv.length !== positions.length || !uv.flat().every(Number.isFinite) || spans.some((span) => span < .00001)) textures.invalidUvs.push(mesh.name);
    }
    meshes.set(mesh.name, triangles);
  }
  const get = (name) => meshes.get(`LasVegas_${name}_Mesh`) ?? [];
  const roads = [...get("Raceway"), ...get("Pit_Lane")];
  const ground = surfaceIndex(get("Terrain"));
  const roadFloor = surfaceIndex(roads);
  // Resolve paint against the delivered road at each XY with bounded lookup.
  const cells = new Map();
  for (const triangle of roads) {
    const xs = triangle.map((p) => Math.floor(p[0] / 12)), zs = triangle.map((p) => Math.floor(p[2] / 12));
    for (let x = Math.min(...xs); x <= Math.max(...xs); x++) for (let z = Math.min(...zs); z <= Math.max(...zs); z++) {
      const key = `${x},${z}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(triangle);
    }
  }
  function roadBelow(point, cap = point[1] + .04) {
    const candidates = cells.get(`${Math.floor(point[0] / 12)},${Math.floor(point[2] / 12)}`) ?? [];
    const heights = candidates.map((triangle) => surfaceIndex([triangle])(point[0], point[2])).filter((height) => height !== null && height <= cap);
    return heights.length ? Math.max(...heights) : null;
  }
  const samples = ([a, b, c]) => [[1 / 3, 1 / 3, 1 / 3], [.8, .1, .1], [.1, .8, .1], [.1, .1, .8]]
    .map((w) => a.map((_, axis) => a[axis] * w[0] + b[axis] * w[1] + c[axis] * w[2]));
  function clearance(triangles, support) {
    let minimum = Infinity, intersections = 0, missingSupport = 0;
    const failures = [];
    for (const triangle of triangles) for (const point of samples(triangle)) {
      const floor = support(point);
      if (floor === null) { missingSupport++; if (failures.length < 6) failures.push({ point, missing: true }); continue; }
      const gap = point[1] - floor;
      minimum = Math.min(minimum, gap);
      if (gap < .005) { intersections++; if (failures.length < 6) failures.push({ point, gap }); }
    }
    return { triangles: triangles.length, minimumClearanceMeters: Number.isFinite(minimum) ? minimum : null, intersections, missingSupport, failures };
  }
  const structuralConflicts = {};
  for (const name of ["Buildings", "NAIP_Roofs", "Grandstands", "Textured_Seat_Rows", "Main_Grandstand_Roof", "Pit_Wall", "Safety_Barriers", "Catch_Fences", "Mapped_Palms", "Pit_And_Gantry_Details", "Pit_Pavilion_Details", "Eiffel_And_High_Roller", "Sphere_Exosphere"]) {
    let count = 0;
    const points = [];
    for (const triangle of get(name)) for (const point of samples(triangle)) {
      const floor = roadFloor(point[0], point[2]);
      if (floor === null || (name === "Pit_And_Gantry_Details" && point[1] - floor >= 4.5)) continue;
      count++;
      if (points.length < 6) points.push(point);
    }
    if (count) structuralConflicts[name] = { count, points };
  }
  let maximumGradePercent = 0, maximumGradeTriangle = null;
  for (const [a, b, c] of roads) {
    const u = b.map((v, i) => v - a[i]), v = c.map((value, i) => value - a[i]);
    const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
    const grade = Math.abs(ny) > .000001 ? Math.hypot(nx, nz) / Math.abs(ny) * 100 : 0;
    if (grade > maximumGradePercent) { maximumGradePercent = grade; maximumGradeTriangle = [a, b, c]; }
  }
  const span = (values) => {
    const sorted=values.slice().sort((a,b)=>a-b);
    return {samples:values.length, minimum:sorted[0]??null, maximum:sorted.at(-1)??null, median:sorted[Math.floor(sorted.length/2)]??null};
  };
  return { ribbonTopology, facadeTileScaleMeters:{horizontal:span(facadeHorizontalTiles),vertical:span(facadeVerticalTiles)},
    road: { ...clearance(roads, (p) => ground(p[0], p[2])), maximumGradePercent, maximumGradeTriangle },
    paint: clearance(get("Edge_And_Pit_Markings"), roadBelow), structuralConflicts, textures };
}
