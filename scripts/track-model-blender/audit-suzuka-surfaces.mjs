import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { surfaceIndex } from "./audit-madring-surfaces.mjs";

// Inspect the compressed asset actually delivered to the browser.
export async function auditSuzukaSurfaces(buffer) {
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
    if (!reader || !components) throw new Error(`Unsupported Suzuka accessor ${item.componentType}/${item.type}`);
    const data = new DataView(output.buffer, output.byteOffset, output.byteLength);
    const stride = view.byteStride ?? components * bytes;
    return Array.from({ length: item.count }, (_, row) => Array.from({ length: components }, (_, column) =>
      data[reader]((item.byteOffset ?? 0) + row * stride + column * bytes, true)));
  }
  const meshes = new Map();
  const textures = { physicalPrimitives: 0, texturedPrimitives: 0, missingTextures: [], invalidUvs: [] };
  for (const mesh of gltf.meshes ?? []) {
    const triangles = [];
    for (const primitive of mesh.primitives) {
      const positions = accessor(primitive.attributes.POSITION);
      const indices = primitive.indices === undefined ? positions.map((_, i) => i) : accessor(primitive.indices).flat();
      for (let i = 0; i < indices.length; i += 3) triangles.push(indices.slice(i, i + 3).map((index) => positions[index]));
      if (!mesh.name?.startsWith("Suzuka_") || /Sector/.test(mesh.name)) continue;
      textures.physicalPrimitives += 1;
      const material = gltf.materials?.[primitive.material];
      const image = gltf.images?.[gltf.textures?.[material?.pbrMetallicRoughness?.baseColorTexture?.index]?.source];
      if (image?.bufferView === undefined || primitive.attributes.TEXCOORD_0 === undefined) {
        textures.missingTextures.push({ mesh: mesh.name, material: material?.name });
        continue;
      }
      textures.texturedPrimitives += 1;
      const uv = accessor(primitive.attributes.TEXCOORD_0);
      const spans = [0, 1].map((axis) => uv.reduce((v, p) => Math.max(v, p[axis]), -Infinity) - uv.reduce((v, p) => Math.min(v, p[axis]), Infinity));
      if (uv.length !== positions.length || !uv.flat().every(Number.isFinite) || spans.some((span) => span < .00001)) textures.invalidUvs.push(mesh.name);
    }
    meshes.set(mesh.name, triangles);
  }
  const get = (name) => meshes.get(`Suzuka_${name}_Mesh`) ?? [];
  const roads = [...get("Raceway"), ...get("Pit_Lane")];
  const ground = surfaceIndex(get("Terrain"));
  const roadFloor = surfaceIndex(roads);
  // Paint underneath the crossover must use the lower support, rather than
  // the highest surface at the same XY. Keep spatial lookup bounded.
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
  for (const name of ["Buildings", "Source_Roofs", "Grandstands", "Textured_Seat_Rows", "Main_Grandstand_Roof", "Guardrails", "Catch_Fences", "Vegetation", "Pit_And_Gantry_Details"]) {
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
  let maximumGradePercent = 0;
  for (const [a, b, c] of roads) {
    const u = b.map((v, i) => v - a[i]), v = c.map((value, i) => value - a[i]);
    const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
    if (Math.abs(ny) > .000001) maximumGradePercent = Math.max(maximumGradePercent, Math.hypot(nx, nz) / Math.abs(ny) * 100);
  }
  let minimumBridgeClearanceMeters = Infinity, bridgeSamples = 0;
  for (const triangle of get("Crossover_Bridge")) for (const point of samples(triangle)) {
    const floor = roadBelow(point, point[1] - 1);
    if (floor !== null) { bridgeSamples++; minimumBridgeClearanceMeters = Math.min(minimumBridgeClearanceMeters, point[1] - floor); }
  }
  return {
    road: { ...clearance(roads, (p) => ground(p[0], p[2])), maximumGradePercent },
    paint: clearance(get("Edge_And_Pit_Markings"), (p) => roadBelow(p)),
    structuralConflicts, textures, bridgeSamples,
    minimumBridgeClearanceMeters: Number.isFinite(minimumBridgeClearanceMeters) ? minimumBridgeClearanceMeters : null,
  };
}
