import * as T from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

type V = [number, number, number];
type Materials = Record<"metal" | "cast" | "darkMetal" | "bronze" | "black", T.Material>;

// Wheel envelopes follow FIA 2026 C5.3.5. Scroll sections, bearing type,
// fasteners and installation ports are reconstructed, not Mercedes CAD.
export function createTurbocharger(mat: Materials) {
  const root = new T.Group(); root.name = "Single-shaft turbocharger";
  const rotor = new T.Group(); rotor.name = "Turbo rotating assembly";
  rotor.position.set(-1.12, .51, 0); rotor.userData.turboRotor = true; root.add(rotor);
  const ports: Record<string, V> = {};
  const add = (name: string, geometry: T.BufferGeometry, material: T.Material, cover = false, parent = root) => {
    const part = new T.Mesh(geometry, material); part.name = name;
    part.userData = { component: "turbo", serviceCover: cover };
    part.castShadow = true; part.receiveShadow = true; parent.add(part); return part;
  };
  const ring = (name: string, a: V, b: V, inner: number, outer: number, material = mat.metal) => {
    const start = new T.Vector3(...a), axis = new T.Vector3(...b).sub(start), length = axis.length();
    const profile = [[inner, 0], [outer, 0], [outer, length], [inner, length], [inner, 0]].map(([r, x]) => new T.Vector2(r, x));
    const part = add(name, new T.LatheGeometry(profile, 48), material);
    part.position.copy(start); part.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize()); return part;
  };
  const cylinder = (name: string, a: V, b: V, radius: number, material = mat.metal, segments = 24) => {
    const axis = new T.Vector3(...b).sub(new T.Vector3(...a));
    const part = add(name, new T.CylinderGeometry(radius, radius, axis.length(), segments), material);
    part.position.set(...a).addScaledVector(axis, .5); part.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis.normalize()); return part;
  };
  const reverse = (geometry: T.BufferGeometry) => {
    if (geometry.index) {
      const ix = geometry.index.array;
      for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
    } else for (const attribute of Object.values(geometry.attributes)) for (let i = 0; i < attribute.count; i += 3) for (let k = 0; k < attribute.itemSize; k++) {
      const a = (i + 1) * attribute.itemSize + k, b = (i + 2) * attribute.itemSize + k;
      [attribute.array[a], attribute.array[b]] = [attribute.array[b], attribute.array[a]];
    }
  };
  // Local X is the axial distance from a wheel's back face toward its inlet.
  const axial = (geometry: T.BufferGeometry, base: number, sign: number, parent = root) => {
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      p.setXYZ(i, base + sign * x - parent.position.x, .51 + y - parent.position.y, z - parent.position.z);
    }
    if (sign < 0) reverse(geometry);
    geometry.computeVertexNormals(); return geometry;
  };
  const turned = (profile: number[][]) => {
    const geometry = new T.LatheGeometry(profile.map(([x, r]) => new T.Vector2(r, x)), 96);
    geometry.rotateZ(-Math.PI / 2); return geometry;
  };
  // One shaft and two attached wheels. The blade roots overlap the smooth
  // hub surface; curved blades have thickness and open inter-blade passages.
  const shaft = cylinder("Turbo shaft", [-1.231, .51, 0], [-1.012, .51, 0], .005);
  root.updateMatrixWorld(true); rotor.attach(shaft);
  for (const compressor of [true, false]) {
    const name = compressor ? "Compressor" : "Turbine", base = compressor ? -1.055 : -1.185, sign = compressor ? 1 : -1;
    const length = compressor ? .033 : .037, radius = compressor ? .0525 : .0475, tip = compressor ? .033 : .031;
    const hubRadius = (t: number) => .008 + (radius - .010) * (1 - t) ** 2.3;
    const hubProfile = [[-.003, 0], [-.003, radius - .002], ...Array.from({ length: 41 }, (_, i) => { const t = i / 40; return [length * t, hubRadius(t)]; }), [length + .003, .006], [length + .003, 0]];
    add(`${name} wheel hub`, axial(turned(hubProfile), base, sign, rotor), mat.metal, false, rotor);
    const blades = compressor ? 12 : 11;
    for (let blade = 0; blade < blades; blade++) {
      const points: number[] = [], indices: number[] = [], rows = 24, columns = 8, thickness = .00075;
      const split = compressor && blade % 2 === 1;
      for (const face of [-1, 1]) for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
        const t = row / rows * (split ? .70 : 1), u = col / columns;
        const inner = hubRadius(t) - .00035, outer = T.MathUtils.lerp(radius, tip, t ** .75), r = T.MathUtils.lerp(inner, outer, u);
        const angle = blade * Math.PI * 2 / blades + (compressor ? -.80 : .65) * (1 - t) * (.3 + .7 * u) + face * thickness / (2 * r);
        points.push(length * t, Math.cos(angle) * r, Math.sin(angle) * r);
      }
      const count = (rows + 1) * (columns + 1);
      for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
        const a = row * (columns + 1) + col, b = a + 1, c = a + columns + 1, d = c + 1;
        indices.push(a, c, b, b, c, d, a + count, b + count, c + count, b + count, d + count, c + count);
      }
      const boundary = [...Array.from({ length: columns + 1 }, (_, i) => i), ...Array.from({ length: rows }, (_, i) => (i + 1) * (columns + 1) + columns), ...Array.from({ length: columns }, (_, i) => rows * (columns + 1) + columns - 1 - i), ...Array.from({ length: rows - 1 }, (_, i) => (rows - 1 - i) * (columns + 1))];
      for (let i = 0; i < boundary.length; i++) { const a = boundary[i], b = boundary[(i + 1) % boundary.length]; indices.push(a, b, a + count, b, b + count, a + count); }
      const geometry = new T.BufferGeometry(); geometry.setAttribute("position", new T.Float32BufferAttribute(points, 3)); geometry.setIndex(indices);
      reverse(geometry);
      const part = add(`${name} curved blade ${blade}`, axial(geometry, base, sign, rotor), mat.metal, false, rotor);
      part.userData.turboBlade = name;
    }
    const nut = new T.CylinderGeometry(.0065, .0065, .005, 6); nut.rotateZ(-Math.PI / 2); nut.translate(length + .004, 0, 0);
    add(`${name} shaft nut`, axial(nut, base, sign, rotor), mat.darkMetal, false, rotor);

    // The expanding scroll has a tangential mouth, not a closed torus. A
    // contoured front shroud, rear plate and open-ended peripheral wall bound
    // one hollow chamber. The neck and discharge contain no opaque discs.
    const scroll: T.Vector2[] = [], steps = 128, mouthSide = compressor ? 1 : -1;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, angle = T.MathUtils.lerp(.43, Math.PI * 2, t), r = .066 + .020 * t;
      scroll.push(new T.Vector2(Math.cos(angle) * r, Math.sin(angle) * r));
    }
    scroll.push(new T.Vector2(.086, .109), new T.Vector2(.060, .109));
    const shape = new T.Shape(scroll), bore = new T.Path(); bore.absarc(0, 0, .059, 0, Math.PI * 2, true); shape.holes.push(bore);
    const shroudX = (r: number) => .020 + .040 * (1 - T.MathUtils.smoothstep(r, .0345, .059));
    const face = new T.ExtrudeGeometry(shape, { depth: .003, bevelEnabled: false, curveSegments: 64 });
    const p = face.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getX(i), z = p.getY(i), depth = p.getZ(i); p.setXYZ(i, .020 + depth, y, mouthSide * z); }
    if (mouthSide < 0) reverse(face);
    const material = compressor ? mat.cast : mat.darkMetal;
    add(`${name} contoured casing`, axial(face, base, sign), material, true);
    // A turned meridian supplies uniform radial sampling and a smooth inlet
    // bell. Bending triangulated cap faces produced visible diagonal facets.
    const curve = Array.from({ length: 33 }, (_, i) => { const r = T.MathUtils.lerp(.0345, .059, i / 32); return [shroudX(r), r]; });
    const skin = [...curve, ...curve.slice().reverse().map(([x, r]) => [x + .003, r]), curve[0]];
    add(`${name} curved inlet shroud`, axial(turned(skin), base, sign), material, true);
    const throat = turned([[.059, .0345], [.060, .038], [.082, .038], [.083, .037], [.083, .0345], [.059, .0345]]);
    add(`${name} open neck`, axial(throat, base, sign), material, true);
    ports[compressor ? "airInlet" : "exhaustOutlet"] = [base + sign * .083, .51, 0];

    const backShape = new T.Shape(scroll), bearingBore = new T.Path(); bearingBore.absarc(0, 0, .006, 0, Math.PI * 2, true); backShape.holes.push(bearingBore);
    const back = new T.ExtrudeGeometry(backShape, { depth: .003, bevelEnabled: false, curveSegments: 48 }), bp = back.attributes.position;
    for (let i = 0; i < bp.count; i++) { const y = bp.getX(i), z = bp.getY(i), x = bp.getZ(i); bp.setXYZ(i, -.010 + x, y, mouthSide * z); }
    if (mouthSide < 0) reverse(back);
    add(`${name} bearing backplate`, axial(back, base, sign), material, true);
    // A continuous U-shaped strip follows the casting perimeter. The mouth
    // edge is absent, so the tangential adapter opens into the scroll cavity.
    const edgePath = Array.from({ length: scroll.length }, (_, i) => scroll[(steps + 2 + i) % scroll.length]);
    const outerPath = edgePath.map((point, i) => {
      const before = edgePath[Math.max(0, i - 1)], after = edgePath[Math.min(edgePath.length - 1, i + 1)];
      return point.clone().add(new T.Vector2(after.y - before.y, before.x - after.x).normalize().multiplyScalar(.003));
    });
    const wallShape = new T.Shape([...edgePath, ...outerPath.reverse()]);
    const wall = new T.ExtrudeGeometry(wallShape, { depth: .030, bevelEnabled: true, bevelSize: .001, bevelThickness: .0015, bevelSegments: 3, curveSegments: 8 });
    const wp = wall.attributes.position;
    for (let i = 0; i < wp.count; i++) { const y = wp.getX(i), z = wp.getY(i), x = wp.getZ(i); wp.setXYZ(i, -.0085 + x, y, mouthSide * z); }
    if (mouthSide < 0) reverse(wall);
    // Keep the extruder's bevel normals smooth around the outer casting.
    wall.deleteAttribute("normal"); wall.deleteAttribute("uv");
    const smoothWall = mergeVertices(wall, 1e-7); wall.dispose();
    add(`${name} scroll wall`, axial(smoothWall, base, sign), material, true);
    // Rectangular scroll exit turns into the round duct through a short,
    // continuous hollow transition; both rims have the same wall thickness.
    const adapterPoints: number[] = [], adapterIndices: number[] = [], rows = 12, radial = 48;
    for (const inner of [false, true]) for (let row = 0; row <= rows; row++) for (let col = 0; col < radial; col++) {
      const t = row / rows, angle = col / radial * Math.PI * 2, co = Math.cos(angle), si = Math.sin(angle), square = 1 / Math.max(Math.abs(co), Math.abs(si)), wall = inner ? 0 : .003;
      const x = .0065 + T.MathUtils.lerp((.0165 + wall) * co * square, (.0165 + wall) * co, t);
      const y = .073 + T.MathUtils.lerp((.013 + wall) * si * square, (.0165 + wall) * si, t);
      adapterPoints.push(x, y, mouthSide * (.109 + .035 * t));
    }
    const n = (rows + 1) * radial;
    for (let row = 0; row < rows; row++) for (let col = 0; col < radial; col++) {
      const a = row * radial + col, b = row * radial + (col + 1) % radial, c = a + radial, d = b + radial;
      adapterIndices.push(a, b, c, b, d, c, a + n, c + n, b + n, b + n, c + n, d + n);
    }
    for (const row of [0, rows]) for (let col = 0; col < radial; col++) {
      const a = row * radial + col, b = row * radial + (col + 1) % radial;
      if (row) adapterIndices.push(a, b, a + n, b, b + n, a + n); else adapterIndices.push(a, a + n, b, b, a + n, b + n);
    }
    const adapter = new T.BufferGeometry(); adapter.setAttribute("position", new T.Float32BufferAttribute(adapterPoints, 3)); adapter.setIndex(adapterIndices);
    if (mouthSide < 0) reverse(adapter);
    add(`${name} tangential port`, axial(adapter, base, sign), material, true);
    const port: V = [base + sign * .0065, .583, mouthSide * .144]; ports[compressor ? "chargeOutlet" : "exhaustInlet"] = port;
    ring(`${name} port collar`, [port[0], port[1], port[2] - mouthSide * .009], port, .0165, .022, material).userData.serviceCover = true;
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4 + .18, y = .51 + Math.cos(angle) * .061, z = Math.sin(angle) * .061;
      const bolt = cylinder(`${name} backplate fastener ${i}`, [base - sign * .013, y, z], [base - sign * .010, y, z], .0035, mat.metal, 6);
      bolt.userData.serviceCover = true;
    }
    // Clock the scroll outlets down toward the wider lower engine-cover
    // envelope; a horizontal top outlet pierced the narrowing spine.
    const clocking = new T.Matrix4().makeTranslation(0, .51, 0).multiply(new T.Matrix4().makeRotationX(mouthSide * .60)).multiply(new T.Matrix4().makeTranslation(0, -.51, 0));
    for (const part of root.children) if (part.name.startsWith(`${name} `)) part.applyMatrix4(clocking);
    const portKey = compressor ? "chargeOutlet" : "exhaustInlet";
    ports[portKey] = new T.Vector3(...ports[portKey]).applyMatrix4(clocking).toArray() as V;
  }
  ring("Turbo bearing housing", [-1.175, .51, 0], [-1.065, .51, 0], .0185, .028, mat.cast).userData.serviceCover = true;
  for (const x of [-1.155, -1.085]) {
    ring(`Turbo bearing outer race ${x}`, [x - .006, .51, 0], [x + .006, .51, 0], .014, .0185, mat.darkMetal);
    ring(`Turbo bearing inner race ${x}`, [x - .006, .51, 0], [x + .006, .51, 0], .005, .009, mat.metal);
    for (let i = 0; i < 10; i++) {
      const angle = i * Math.PI / 5;
      const ball = add(`Turbo bearing ball ${x} ${i}`, new T.SphereGeometry(.003, 12, 8), mat.metal);
      ball.position.set(x, .51 + Math.cos(angle) * .0115, Math.sin(angle) * .0115);
    }
  }
  for (const [name, y, direction, inner] of [["feed", .538, 1, .003], ["drain", .482, -1, .006]] as const) {
    ring(`Turbo oil ${name} boss`, [-1.12, y - direction * .003, 0], [-1.12, y + direction * .009, 0], inner, inner + .004, mat.cast).userData.serviceCover = true;
    ring(`Turbo oil ${name} union`, [-1.12, y + direction * .009, 0], [-1.12, y + direction * .021, 0], inner, inner + .002, mat.metal).userData.serviceCover = true;
    ports[`oil${name === "feed" ? "Feed" : "Drain"}`] = [-1.12, y + direction * .021, 0];
  }
  for (const side of [-1, 1]) {
    const foot = new T.Shape();
    foot.moveTo(-.0185, -.0225); foot.lineTo(.0185, -.0225); foot.quadraticCurveTo(.0225, -.0225, .0225, -.0185);
    foot.lineTo(.0225, .0185); foot.quadraticCurveTo(.0225, .0225, .0185, .0225); foot.lineTo(-.0185, .0225);
    foot.quadraticCurveTo(-.0225, .0225, -.0225, .0185); foot.lineTo(-.0225, -.0185); foot.quadraticCurveTo(-.0225, -.0225, -.0185, -.0225);
    const hole = new T.Path(); hole.absarc(0, side * .012, .0045, 0, Math.PI * 2, true); foot.holes.push(hole);
    const geometry = new T.ExtrudeGeometry(foot, { depth: .010, bevelEnabled: false, curveSegments: 12 }); geometry.rotateX(Math.PI / 2);
    const ear = add(`Turbo support foot ${side}`, geometry, mat.cast, true); ear.position.set(-1.12, .488, side * .033);
    ring(`Turbo mounting eye ${side}`, [-1.12, .475, side * .045], [-1.12, .489, side * .045], .004, .008, mat.darkMetal).userData.serviceCover = true;
  }
  root.userData.ports = ports;
  return { root, ports };
}
