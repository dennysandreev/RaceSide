import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { readFile } from "node:fs/promises";
import { surfaceIndex } from "./audit-madring-surfaces.mjs";

// Inspect the compressed asset actually delivered to the browser.
export async function auditAlbertParkSurfaces(buffer) {
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
    if (!reader || !components) throw new Error(`Unsupported AlbertPark accessor ${item.componentType}/${item.type}`);
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
      if (!mesh.name?.startsWith("AlbertPark_") || /Sector/.test(mesh.name)) continue;
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
  const get = (name) => meshes.get(`AlbertPark_${name}_Mesh`) ?? [];
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
  for (const name of ["Buildings", "Source_Roofs", "Grandstands", "Textured_Seat_Rows", "Main_Grandstand_Roof", "Guardrails", "Catch_Fences", "Event_Barriers", "Event_Catch_Fences", "Vegetation", "Pit_Wall", "Pit_And_Gantry_Details"]) {
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
  let maximumGradePercent = 0, maximumGradeTriangle = null, maximumGradeMesh = null;
  for (const name of ["Raceway", "Pit_Lane"]) for (const [a, b, c] of get(name)) {
    const u = b.map((v, i) => v - a[i]), v = c.map((value, i) => value - a[i]);
    const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
    if (Math.abs(ny) > .000001) {
      const grade = Math.hypot(nx, nz) / Math.abs(ny) * 100;
      if (grade > maximumGradePercent) { maximumGradePercent = grade; maximumGradeTriangle = [a, b, c]; maximumGradeMesh = name; }
    }
  }
  let minimumBridgeClearanceMeters = Infinity, bridgeSamples = 0;
  for (const triangle of get("Pedestrian_Bridges")) for (const point of samples(triangle)) {
    const floor = roadBelow(point, point[1] - 1);
    if (floor !== null) { bridgeSamples++; minimumBridgeClearanceMeters = Math.min(minimumBridgeClearanceMeters, point[1] - floor); }
  }
  // Independently reviewed current-corridor midpoint controls at the public
  // junction before T6 (MGA55 minus the model origin, glTF north = -Z).
  // The old OSM road jog lies outside this 12 m racing-surface envelope.
  const start = [-435.736265, -779.065024], end = [-410.224376, -788.781718];
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const tangent = end.map((value, axis) => (value - start[axis]) / length);
  let junctionSamples = 0, junctionEnvelopeMeters = 0;
  for (const triangle of get("Raceway")) for (const point of triangle) {
    const x = point[0] - start[0], z = point[2] - start[1];
    const along = x * tangent[0] + z * tangent[1];
    if (along < 3 || along > length - 3) continue;
    const sideways = Math.abs(x * tangent[1] - z * tangent[0]);
    if (sideways > 20) continue; // Discard distant return branches of the lap.
    junctionSamples++;
    junctionEnvelopeMeters = Math.max(junctionEnvelopeMeters, sideways);
  }
  // Unchanged OSM straight, anchored to control node 9123374386 in MGA55.
  // A shared paved junction must not move the race axis or
  // send the pit exit across the opposite edge of the main straight.
  const straightStart = [-177.126240, 416.890036], straightEnd = [-292.279968, 305.806200];
  const straightLength = Math.hypot(...straightEnd.map((v, i) => v - straightStart[i]));
  const straightTangent = straightEnd.map((v, i) => (v - straightStart[i]) / straightLength);
  let straightSamples = 0, straightEnvelopeMeters = 0, pitExitSamples = 0, pitExitOppositeEdgeMeters = -Infinity;
  const mainSurface = surfaceIndex(get("Raceway"));
  let joinSamples = 0, maximumJoinHeightDifferenceMeters = 0;
  for (const triangle of get("Pit_Lane")) for (const point of samples(triangle)) {
    const mainHeight = mainSurface(point[0], point[2]);
    if (mainHeight === null) continue;
    joinSamples++;
    maximumJoinHeightDifferenceMeters = Math.max(maximumJoinHeightDifferenceMeters, Math.abs(mainHeight - point[1]));
  }
  let frontageSamples = 0, frontageOverlapSamples = 0;
  for (const triangle of get("Pit_Lane")) for (const point of samples(triangle)) {
    const x = point[0] - straightStart[0], z = point[2] - straightStart[1];
    const along = x * straightTangent[0] + z * straightTangent[1];
    const sideways = x * straightTangent[1] - z * straightTangent[0];
    if (along < -280 || along > -60 || Math.abs(sideways) > 25) continue;
    frontageSamples++;
    if (mainSurface(point[0], point[2]) !== null) frontageOverlapSamples++;
  }
  for (const name of ["Raceway", "Pit_Lane"]) for (const triangle of get(name)) for (const point of triangle) {
    const x = point[0] - straightStart[0], z = point[2] - straightStart[1];
    const along = x * straightTangent[0] + z * straightTangent[1];
    const sideways = x * straightTangent[1] - z * straightTangent[0];
    if (along < 5 || along > straightLength - 5 || Math.abs(sideways) > 30) continue;
    if (name === "Raceway") {
      straightSamples++;
      straightEnvelopeMeters = Math.max(straightEnvelopeMeters, Math.abs(sideways));
    } else {
      pitExitSamples++;
      pitExitOppositeEdgeMeters = Math.max(pitExitOppositeEdgeMeters, sideways);
    }
  }
  // Independent native source controls, not anchors derived from this model.
  // Read actual compressed-road cross sections so a displaced but internally
  // consistent centreline/annotation pair cannot pass this check.
  const southern = JSON.parse(await readFile(new URL("../../docs/track-model-albert-park-south-reference.json", import.meta.url), "utf8"));
  const reviewedSouthernTurns = {};
  for (const [number, controls] of Object.entries(southern.reviewControls)) {
    let count = 0, missing = 0, maximumDeviation = 0;
    for (const control of controls) {
      const direction = control.after.map((value, axis) => value - control.before[axis]);
      const length = Math.hypot(...direction);
      const normal = [-direction[1] / length, direction[0] / length];
      for (const along of [-2, 0, 2]) {
        const world = control.world.map((value, axis) => value + along * direction[axis] / length);
        const groups = [];
        let active = null;
        for (let offset = -30; offset <= 30; offset += .25) {
          const height = mainSurface(world[0] - 321430 + normal[0] * offset,
            -(world[1] - 5809350 + normal[1] * offset));
          if (height !== null) {
            if (!active) { active = [offset, offset]; groups.push(active); }
            active[1] = offset;
          } else active = null;
        }
        const section = groups.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]))[0];
        if (!section || section[0] === -30 || section[1] === 30) { missing++; continue; }
        count++;
        maximumDeviation = Math.max(maximumDeviation, Math.abs((section[0] + section[1]) / 2));
      }
    }
    reviewedSouthernTurns[number] = { samples: count, missingCrossSections: missing, maximumAxisDeviationMeters: maximumDeviation };
  }
  const [exitStart, exitEnd] = southern.mainStraightAxisWorld;
  const exitDirection = exitEnd.map((value, axis) => value - exitStart[axis]);
  const exitLength = Math.hypot(...exitDirection);
  const exitTangent = exitDirection.map((v) => v / exitLength);
  let exitSamples = 0, maximumExitEdgeDeviation = 0;
  for (const triangle of get("Raceway")) for (const point of triangle) {
    const x = point[0] + 321430 - exitEnd[0], y = -point[2] + 5809350 - exitEnd[1];
    const along = x * exitTangent[0] + y * exitTangent[1];
    const side = Math.abs(x * exitTangent[1] - y * exitTangent[0]);
    if (along < -400 || along > -250 || side > 30) continue;
    exitSamples++;
    maximumExitEdgeDeviation = Math.max(maximumExitEdgeDeviation, side);
  }
  return {
    road: { ...clearance(roads, (p) => ground(p[0], p[2])), maximumGradePercent, maximumGradeTriangle, maximumGradeMesh },
    paint: clearance(get("Edge_And_Pit_Markings"), (p) => roadBelow(p)),
    structuralConflicts, textures, bridgeSamples,
    minimumBridgeClearanceMeters: Number.isFinite(minimumBridgeClearanceMeters) ? minimumBridgeClearanceMeters : null,
    reviewedJunction: { samples: junctionSamples, maximumRoadEdgeDeviationMeters: junctionEnvelopeMeters },
    reviewedMainStraight: { samples: straightSamples, maximumRoadEdgeDeviationMeters: straightEnvelopeMeters },
    reviewedPitExit: { samples: pitExitSamples, maximumOppositeEdgeDeviationMeters: pitExitOppositeEdgeMeters },
    reviewedPitFrontage: { samples: frontageSamples, mainRoadOverlapSamples: frontageOverlapSamples },
    reviewedRoadJoins: { samples: joinSamples, maximumHeightDifferenceMeters: maximumJoinHeightDifferenceMeters },
    reviewedSouthernTurns,
    reviewedTurn14Exit: { samples: exitSamples, maximumRoadEdgeDeviationMeters: maximumExitEdgeDeviation },
  };
}
