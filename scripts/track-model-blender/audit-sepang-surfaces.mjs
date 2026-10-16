import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { surfaceIndex } from "./audit-madring-surfaces.mjs";

// Inspect decoded delivery geometry, including Meshopt rounding and pit openings.
export async function auditSepangSurfaces(buffer, appearance) {
  await MeshoptDecoder.ready;
  const length = buffer.readUInt32LE(12);
  const gltf = JSON.parse(buffer.toString("utf8", 20, 20 + length));
  const binary = buffer.subarray(28 + length);
  const views = new Map();
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
    if (!Type) throw new Error(`Unsupported Sepang accessor ${item.componentType}`);
    return new Type(output.buffer, output.byteOffset + (item.byteOffset ?? 0), item.count * (item.type === "VEC3" ? 3 : 1));
  }
  const meshes = new Map(), colours = new Map();
  for (const mesh of gltf.meshes) {
    if (!mesh.name.startsWith("Sepang_") && !mesh.name.startsWith("FIA_Pit_Wall")) continue;
    const triangles = [], palette = new Map();
    for (const primitive of mesh.primitives) {
      const positions = accessor(primitive.attributes.POSITION), indices = accessor(primitive.indices);
      for (let i = 0; i < indices.length; i += 3) triangles.push(Array.from(indices.subarray(i, i + 3), (j) => Array.from(positions.subarray(j * 3, j * 3 + 3))));
      if (primitive.attributes.COLOR_0 !== undefined) {
        const values = accessor(primitive.attributes.COLOR_0);
        for (let i = 0; i < values.length; i += 3) {
          const colour = Array.from(values.subarray(i, i + 3));
          palette.set(colour.map((value) => value.toFixed(5)).join(","), colour);
        }
      }
    }
    meshes.set(mesh.name, triangles);
    colours.set(mesh.name, [...palette.values()]);
  }
  // glTF vertex colours are linear. Check the exported values, so accidentally
  // passing encoded sRGB to Blender cannot wash the roofs out again.
  function missingColours(hexColours, meshName) {
    const delivered = colours.get(`Sepang_${meshName}_Mesh`) ?? [];
    return [...new Set(hexColours)].filter((hex) => {
      const expected = hex.slice(1).match(/../g).map((channel) => {
        const value = parseInt(channel, 16) / 255;
        return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
      });
      return !delivered.some((colour) => colour.every((value, i) => Math.abs(value - expected[i]) < .003));
    });
  }
  const appearanceAudit = appearance ? {
    missingBuildingColours: missingColours(appearance.buildingGroups.flatMap((group) =>
      [group.roof, group.wall, group.glazing, group.garageDoor].filter(Boolean)), "Current_Footprint_Buildings_33_Garages"),
    missingGrandstandColours: missingColours(appearance.grandstands.flatMap((stand) =>
      [stand.roof, stand.underside, stand.frame, stand.truss, stand.concrete, stand.seatGreen, stand.seatYellow, stand.seatGrey]), "Main_K1_F_Grandstands"),
    buildingPaletteColours: colours.get("Sepang_Current_Footprint_Buildings_33_Garages_Mesh")?.length ?? 0,
    grandstandPaletteColours: colours.get("Sepang_Main_K1_F_Grandstands_Mesh")?.length ?? 0,
  } : null;
  const get = (name) => meshes.get(`Sepang_${name}_Mesh`) ?? [];
  const ground = surfaceIndex(get("Copernicus_Terrain"));
  const pit = surfaceIndex(get("Pit_Lane"));
  const road = [...get("Grand_Prix_16m"), ...get("Pit_Lane")];
  const roadFloor = surfaceIndex(road);
  function clearance(triangles, support) {
    let minimum = Infinity, intersections = 0, missingSupport = 0; const failures = [];
    for (const triangle of triangles) {
      const p = triangle[0].map((_, axis) => triangle.reduce((sum, v) => sum + v[axis], 0) / 3);
      const floor = support(p[0], p[2]);
      if (floor === null) { missingSupport++; continue; }
      const gap = p[1] - floor;
      minimum = Math.min(minimum, gap);
      if (gap <= 0) { intersections++; if (failures.length < 8) failures.push({p,gap}); }
    }
    return { failures, triangles: triangles.length, minimumClearanceMeters: Number(minimum.toFixed(5)), intersections, missingSupport };
  }
  let roadBarrierTrianglesInsidePit = 0;
  for (const triangle of get("Mapped_Barriers")) {
    const p = triangle[0].map((_, axis) => triangle.reduce((sum, v) => sum + v[axis], 0) / 3);
    if (pit(p[0], p[2]) !== null) roadBarrierTrianglesInsidePit++;
  }
  let vegetationTrianglesAboveRoad = 0;
  for (const triangle of get("Mapped_Palms")) {
    const p = triangle[0].map((_, axis) => triangle.reduce((sum, v) => sum + v[axis], 0) / 3);
    if (roadFloor(p[0], p[2]) !== null) vegetationTrianglesAboveRoad++;
  }
  let structuralRoadConflicts = 0, minimumOverhangClearanceMeters = Infinity; const conflicts = [];
  for (const triangle of [...get("Current_Footprint_Buildings_33_Garages"), ...get("Main_K1_F_Grandstands")]) {
    for (const vertex of triangle) {
      const floor = roadFloor(vertex[0], vertex[2]);
      if (floor === null) continue;
      const gap = vertex[1] - floor;
      minimumOverhangClearanceMeters = Math.min(minimumOverhangClearanceMeters, gap);
      if (gap < 4.5) { structuralRoadConflicts++; if (conflicts.length < 12) conflicts.push({vertex,gap}); }
    }
  }
  return { structuralRoadConflicts, conflicts, minimumOverhangClearanceMeters: Number.isFinite(minimumOverhangClearanceMeters) ? minimumOverhangClearanceMeters : null, road: clearance(road, ground), paint: clearance([...get("Track_Edge_Lines"), ...get("33_Pit_Marks_And_Fast_Lane")], roadFloor), roadBarrierTrianglesInsidePit, vegetationTrianglesAboveRoad, appearance: appearanceAudit };
}
