import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { surfaceIndex } from "./audit-madring-surfaces.mjs";

// Inspect the compressed asset actually delivered to the browser.
export async function auditYasMarinaSurfaces(buffer, metadata) {
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
    if (!reader || !components) throw new Error(`Unsupported YasMarina accessor ${item.componentType}/${item.type}`);
    const data = new DataView(output.buffer, output.byteOffset, output.byteLength);
    const stride = view.byteStride ?? components * bytes;
    return Array.from({ length: item.count }, (_, row) => Array.from({ length: components }, (_, column) =>
      data[reader]((item.byteOffset ?? 0) + row * stride + column * bytes, true)));
  }
  const meshes = new Map();
  const textures = { physicalPrimitives: 0, texturedPrimitives: 0, missingTextures: [], invalidUvs: [] };
  const aerialProjection = { samples: 0, maximumErrorMeters: 0, meshes: [] };
  for (const mesh of gltf.meshes ?? []) {
    const triangles = [];
    for (const primitive of mesh.primitives) {
      const positions = accessor(primitive.attributes.POSITION);
      const indices = primitive.indices === undefined ? positions.map((_, i) => i) : accessor(primitive.indices).flat();
      for (let i = 0; i < indices.length; i += 3) triangles.push(indices.slice(i, i + 3).map((index) => positions[index]));
      if (!mesh.name?.startsWith("YasMarina_") || /Sector/.test(mesh.name)) continue;
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
      if (["YasMarina_Terrain_Mesh", "YasMarina_Source_Roofs_Mesh", "YasMarina_Source_Roofs_Mesh"].includes(mesh.name)) {
        aerialProjection.meshes.push(mesh.name);
        for (const [i, position] of positions.entries()) {
          // Blender Z-up is exported as glTF Y-up; glTF also flips image V.
          const expected = [(position[0] + 700) / 1400, (position[2] + 957.5) / 1915];
          aerialProjection.maximumErrorMeters = Math.max(aerialProjection.maximumErrorMeters,
            Math.hypot((uv[i][0] - expected[0]) * 1400, (uv[i][1] - expected[1]) * 1915));
          aerialProjection.samples++;
        }
      }
    }
    meshes.set(mesh.name, triangles);
  }
  const get = (name) => meshes.get(`YasMarina_${name}_Mesh`) ?? [];
  const terraces = surfaceIndex(get("Grandstand_Structures"));
  const seats = surfaceIndex(get("Textured_Blue_Seats"));
  // Independent EPSG:32640 probes along both tiers of the mapped North bowl.
  // A footprint in metadata alone cannot prove that its curved seating was exported.
  const northProbes = [
    [257226,2709310], [257252,2709382], [257270,2709411],
    [257306,2709421], [257349,2709409], [257367,2709380], [257373,2709290],
    [257239,2709310], [257270,2709370], [257285,2709398],
    [257309,2709409], [257334,2709398], [257354,2709366], [257366,2709290],
  ];
  const northGrandstand = { samples: northProbes.length, missingTerraces: 0, missingSeatRows: 0, failures: [] };
  for (const [easting,northing] of northProbes) {
    const x = easting-metadata.originMeters.x, z = -(northing-metadata.originMeters.y);
    const terrace = terraces(x,z);
    let nearbySeat = false;
    for (let dx = -.9; dx <= .91; dx += .3) for (let dz = -.9; dz <= .91; dz += .3) {
      if (seats(x+dx,z+dz) !== null) nearbySeat = true;
    }
    if (terrace === null) northGrandstand.missingTerraces++;
    if (!nearbySeat) northGrandstand.missingSeatRows++;
    if (terrace === null || !nearbySeat) northGrandstand.failures.push({ easting,northing,terrace,nearbySeat });
  }
  const roads = [...get("Raceway"), ...get("Pit_Lane")];
  const ground = surfaceIndex(get("Terrain"));
  const roadFloor = surfaceIndex(roads);
  const runoffFloor = surfaceIndex(get("Current_Turquoise_Runoffs"));
  // Survey-independent observations from the current reference: broad painted
  // aprons, inner islands, and deliberately unpainted grass/service pavement.
  const paintedSurfaceProbes = [
    [257317.5,2709352.3], [257277.9,2709223.7], [257318.9,2709242.2],
    [257343.5,2709018], [257316.1,2708919.5], [257503.5,2708677.5],
    [257592.4,2708408.1], [256986.6,2708324.7], [256942.2,2708174.3],
    [257051.6,2708111.4], [257264.9,2707872.1], [257039.9,2707977.4],
    [257692.9,2707582.2],
  ];
  const unpaintedSurfaceProbes = [[257309,2709170], [257643,2707650], [257268,2709115]];
  const paintedSurfaces = { samples: paintedSurfaceProbes.length, missing: [], unwantedPaint: [], maximumGroundGapMeters: 0 };
  const hasPaint = ([easting,northing]) => runoffFloor(easting-metadata.originMeters.x, -(northing-metadata.originMeters.y)) !== null;
  paintedSurfaces.missing = paintedSurfaceProbes.filter((p) => !hasPaint(p));
  paintedSurfaces.unwantedPaint = unpaintedSurfaceProbes.filter(hasPaint);
  // Select asphalt below the markings, including the joined pit ends.
  // Keep spatial lookup bounded.
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
  for (const triangle of get("Current_Turquoise_Runoffs")) for (const p of samples(triangle)) {
    const floor = ground(p[0],p[2]);
    if (floor !== null) paintedSurfaces.maximumGroundGapMeters = Math.max(paintedSurfaces.maximumGroundGapMeters,p[1]-floor);
  }
  const undergroundPit = [];
  const exposedPit = [];
  const axis = metadata.layoutQuality.pitLane.axis;
  const [tunnelStart,tunnelEnd] = metadata.layoutQuality.pitLane.coveredDistanceRangeMeters;
  function pitDistance(p) {
    let closest = Infinity, distance = 0;
    for (let i = 1; i < axis.length; i++) {
      const a = axis[i-1], b = axis[i];
      const dx = b.x-a.x, dz = b.z-a.z;
      const t = Math.max(0,Math.min(1,((p[0]-a.x)*dx+(p[2]-a.z)*dz)/(dx*dx+dz*dz || 1)));
      const gap = Math.hypot(p[0]-a.x-dx*t,p[2]-a.z-dz*t);
      if (gap < closest) { closest = gap; distance = a.distanceMeters+(b.distanceMeters-a.distanceMeters)*t; }
    }
    return distance;
  }
  for (const triangle of get("Pit_Lane")) {
    const p = samples(triangle)[0];
    // Only the mapped covered tunnel is permitted to sit below the terrain.
    const d = pitDistance(p);
    (d >= tunnelStart && d <= tunnelEnd ? undergroundPit : exposedPit).push(triangle);
  }

  const structuralConflicts = {};
  for (const name of ["Permanent_Buildings", "Source_Roofs", "Grandstand_Structures", "Textured_Blue_Seats", "White_Membrane_Canopies", "W_Hotel_Wings_And_Link", "W_Hotel_Glass_Gridshell", "W_Hotel_Diamond_Frame", "Mapped_Barriers_And_Marina_Piers", "Catch_Fences", "Vegetation", "Mapped_Light_Masts", "Pit_And_Gantry_Details"]) {
    let count = 0;
    const points = [];
    for (const triangle of get(name)) for (const point of samples(triangle)) {
      const floor = roadFloor(point[0], point[2]);
      if (floor === null || (["Pit_And_Gantry_Details", "W_Hotel_Wings_And_Link", "W_Hotel_Glass_Gridshell", "W_Hotel_Diamond_Frame"].includes(name) && point[1] - floor >= 4.5)) continue;
      count++;
      if (points.length < 6) points.push(point);
    }
    if (count) structuralConflicts[name] = { count, points };
  }
  let maximumGradePercent = 0;
  let maximumGradeTriangle = null;
  for (const [a, b, c] of roads) {
    const u = b.map((v, i) => v - a[i]), v = c.map((value, i) => value - a[i]);
    const nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
    if (Math.abs(ny) > .000001) {
      const grade = Math.hypot(nx, nz) / Math.abs(ny) * 100;
      if (grade > maximumGradePercent) { maximumGradePercent = grade; maximumGradeTriangle = [a,b,c]; }
    }
  }
  let minimumBridgeClearanceMeters = Infinity, bridgeSamples = 0;
  for (const triangle of get("W_Hotel_Wings_And_Link")) for (const point of samples(triangle)) {
    const floor = roadBelow(point, point[1] - 1);
    if (floor !== null) { bridgeSamples++; minimumBridgeClearanceMeters = Math.min(minimumBridgeClearanceMeters, point[1] - floor); }
  }
  const tunnelRoof = surfaceIndex(get("Pit_Exit_Tunnel"));
  let tunnelSamples = 0, missingTunnelRoof = 0, minimumTunnelHeadroomMeters = Infinity;
  for (const triangle of undergroundPit) for (const p of samples(triangle)) {
    const d = pitDistance(p);
    if (d < tunnelStart+1 || d > tunnelEnd-1) continue;
    const ceiling = tunnelRoof(p[0],p[2]);
    if (ceiling === null) { missingTunnelRoof++; continue; }
    tunnelSamples++;
    minimumTunnelHeadroomMeters = Math.min(minimumTunnelHeadroomMeters,ceiling-p[1]);
  }
  return {
    road: { ...clearance([...get("Raceway"), ...exposedPit], (p) => ground(p[0], p[2])), maximumGradePercent, maximumGradeTriangle },
    paint: clearance(get("Edge_And_Pit_Markings"), (p) => roadBelow(p)),
    runoff: clearance(get("Current_Turquoise_Runoffs"), (p) => ground(p[0],p[2])),
    undergroundPitTriangles: undergroundPit.length,
    tunnel: { samples: tunnelSamples, missingRoof: missingTunnelRoof,
      minimumHeadroomMeters: Number.isFinite(minimumTunnelHeadroomMeters) ? minimumTunnelHeadroomMeters : null },
    structuralConflicts, textures, aerialProjection, bridgeSamples, northGrandstand, paintedSurfaces,
    minimumBridgeClearanceMeters: Number.isFinite(minimumBridgeClearanceMeters) ? minimumBridgeClearanceMeters : null,
  };
}
