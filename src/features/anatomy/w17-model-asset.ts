import * as T from "three";
import type { WingLinkage } from "./w17-geometry.ts";

type Attribute = { type: string; offset: number; length: number; itemSize: number; normalized: boolean; decode?: { min: number[]; scale: number[] } };
type ModelAsset = {
  version: number;
  object: Parameters<T.ObjectLoader["parseObject"]>[0];
  geometries: { uuid: string; name: string; attributes: Record<string, Attribute>; index?: Attribute; groups: T.BufferGeometry["groups"]; box: [number[], number[]]; sphere: [number[], number] }[];
  materials: Parameters<T.ObjectLoader["parseMaterials"]>[0];
  materialNames: Record<string, string>;
  linkages: { mesh: string; wing: string; anchor: number[]; end: number[]; from: number; to: number; fromOffset?: number; toOffset?: number }[];
};

export function decodeModelAsset(buffer: ArrayBuffer) {
  const jsonLength = new DataView(buffer).getUint32(0, true);
  const data: ModelAsset = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, jsonLength)));
  if (data.version !== 1) throw new Error("Unsupported anatomy model");
  const start = Math.ceil((jsonLength + 4) / 4) * 4;
  const arrays = { Float32Array, Uint32Array, Uint16Array, Uint8Array, Int16Array, Int8Array };
  const attribute = (a: Attribute) => {
    const ArrayType = arrays[a.type as keyof typeof arrays];
    if (!ArrayType) throw new Error("Unsupported model attribute");
    const array = new ArrayType(buffer, start + a.offset, a.length);
    if (a.decode) {
      const { min, scale } = a.decode;
      return new T.BufferAttribute(Float32Array.from(array, (v, i) => min[i % a.itemSize] + v * scale[i % a.itemSize]), a.itemSize);
    }
    return new T.BufferAttribute(array, a.itemSize, a.normalized);
  };
  const geometries: Record<string, T.BufferGeometry> = {};
  for (const record of data.geometries) {
    const g = new T.BufferGeometry(); g.uuid = record.uuid; g.name = record.name;
    for (const [name, a] of Object.entries(record.attributes)) g.setAttribute(name, attribute(a));
    if (record.index) g.setIndex(attribute(record.index));
    g.groups = record.groups;
    g.boundingBox = new T.Box3(new T.Vector3().fromArray(record.box[0]), new T.Vector3().fromArray(record.box[1]));
    g.boundingSphere = new T.Sphere(new T.Vector3().fromArray(record.sphere[0]), record.sphere[1]);
    geometries[g.uuid] = g;
  }
  const loader = new T.ObjectLoader(), materials = loader.parseMaterials(data.materials, {});
  const root = loader.parseObject(data.object, geometries, materials, {}) as T.Group;
  const objects = new Map<string, T.Object3D>();
  root.traverse(part => {
    objects.set(part.uuid, part);
    if (part.userData.hingeAxis) {
      const { x, y, z } = part.userData.hingeAxis;
      part.userData.hingeAxis = new T.Vector3(x, y, z);
    }
  });
  const assemblies = new Map(root.children.map(group => [group.name, group as T.Group]));
  const linkages: WingLinkage[] = data.linkages.map(link => ({
    mesh: objects.get(link.mesh) as T.Mesh, wing: objects.get(link.wing) as T.Mesh,
    anchor: new T.Vector3().fromArray(link.anchor), end: new T.Vector3().fromArray(link.end), from: link.from, to: link.to,
    fromOffset: link.fromOffset, toOffset: link.toOffset,
  }));
  return { root, assemblies, linkages, materials: Object.fromEntries(Object.entries(data.materialNames).map(([name, id]) => [name, materials[id]])) };
}

export async function fetchModelAsset(url: string) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Anatomy model: ${response.status}`);
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  return decodeModelAsset(await new Response(stream).arrayBuffer());
}
