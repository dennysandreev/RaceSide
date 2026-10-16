import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createW17 } from "../src/features/anatomy/w17-geometry.ts";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { BufferAttribute } from "three";

// Store the finished geometry, including modified primitives and drilled
// passages. Rebuilding primitive parameters would lose those modifications.
const output = new URL("../public/anatomy/", import.meta.url);
await mkdir(output, { recursive: true });
const manifest = {};
for (const variant of ["mercedes", "ferrari", "red-bull"]) {
  const model = createW17(variant, { rearWingOnly: variant !== "mercedes" });
  // Object3D serialization reads matrices, not the edited position/quaternion.
  // Commit the final wheel, suspension and linkage transforms before export.
  model.root.updateMatrixWorld(true);
  const geometryMap = new Map(), chunks = [], blocks = new Map();
  let offset = 0;
  const attribute = (a, name) => {
    let decode;
    if (name === "position" || name === "uv") {
      const min = Array.from({ length: a.itemSize }, (_, axis) => {
        let value = Infinity; for (let i = axis; i < a.array.length; i += a.itemSize) value = Math.min(value, a.array[i]); return value;
      });
      const max = min.map((_, axis) => {
        let value = -Infinity; for (let i = axis; i < a.array.length; i += a.itemSize) value = Math.max(value, a.array[i]); return value;
      });
      const scale = min.map((v, i) => (max[i] - v) / 65535);
      const packed = Uint16Array.from(a.array, (value, i) => scale[i % a.itemSize] ? Math.round((value - min[i % a.itemSize]) / scale[i % a.itemSize]) : 0);
      decode = { min, scale }; a = new BufferAttribute(packed, a.itemSize);
    } else if (name === "normal") {
      a = new BufferAttribute(Int16Array.from(a.array, value => Math.round(Math.max(-1, Math.min(1, value)) * 32767)), a.itemSize, true);
    }
    const bytes = Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const record = { type: a.array.constructor.name, offset: blocks.get(hash) ?? offset, length: a.array.length, itemSize: a.itemSize, normalized: a.normalized, decode };
    if (blocks.has(hash)) return record;
    blocks.set(hash, offset);
    chunks.push(bytes); offset += bytes.length;
    const padding = (4 - offset % 4) % 4;
    if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding; }
    return record;
  };
  const meta = { geometries: {}, materials: {}, textures: {}, images: {}, shapes: {}, skeletons: {}, animations: {}, nodes: {} };
  model.root.traverse(part => {
    if (!part.isMesh || geometryMap.has(part.geometry.uuid)) return;
    const source = part.geometry.clone();
    // All model materials are untextured. UV seams otherwise duplicate large
    // portions of the exhaust and brakes without affecting their appearance.
    source.deleteAttribute("uv");
    const normals = source.attributes.normal;
    if (normals) for (let i = 0; i < normals.array.length; i++) normals.array[i] = Math.round(normals.array[i] * 32767) / 32767;
    const g = mergeVertices(source, 1e-7); g.uuid = part.geometry.uuid; source.dispose();
    g.computeBoundingBox(); g.computeBoundingSphere();
    geometryMap.set(g.uuid, {
      uuid: g.uuid, name: g.name,
      attributes: Object.fromEntries(Object.entries(g.attributes).map(([name, a]) => [name, attribute(a, name)])),
      index: g.index ? attribute(g.index) : undefined, groups: g.groups,
      box: [g.boundingBox.min.toArray(), g.boundingBox.max.toArray()],
      sphere: [g.boundingSphere.center.toArray(), g.boundingSphere.radius],
    });
    // Skip Object3D.toJSON's procedural primitive serialization.
    meta.geometries[g.uuid] = { uuid: g.uuid };
  });
  const object = model.root.toJSON(meta).object;
  const asset = {
    version: 1, object, geometries: [...geometryMap.values()], materials: Object.values(meta.materials),
    materialNames: Object.fromEntries(Object.entries(model.materials).map(([name, material]) => [name, material.uuid])),
    linkages: model.linkages.map(link => ({ mesh: link.mesh.uuid, wing: link.wing.uuid, anchor: link.anchor.toArray(), end: link.end.toArray(), from: link.from, to: link.to, fromOffset: link.fromOffset, toOffset: link.toOffset })),
  };
  const json = Buffer.from(JSON.stringify(asset));
  const headerLength = Math.ceil((json.length + 4) / 4) * 4, header = Buffer.alloc(headerLength);
  header.writeUInt32LE(json.length); json.copy(header, 4);
  const compressed = gzipSync(Buffer.concat([header, ...chunks]), { level: 9 });
  const revision = createHash("sha256").update(compressed).digest("hex").slice(0, 12);
  await writeFile(new URL(`model-${variant}.bin.gz`, output), compressed);
  manifest[variant] = `/anatomy/model-${variant}.bin.gz?v=${revision}`;
  console.log(`${variant}: ${geometryMap.size} geometries, ${(compressed.length / 1024 / 1024).toFixed(2)} MiB compressed`);
}
await writeFile(new URL("../src/features/anatomy/w17-model-manifest.json", import.meta.url), JSON.stringify(manifest, null, 2) + "\n");
