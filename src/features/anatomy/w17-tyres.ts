import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TessellateModifier } from "three/addons/modifiers/TessellateModifier.js";

// Pirelli's 2026 hard-tyre graphics and the retained W17 launch wheel reference.
// The sidewall contours and lettering are reconstructed from those images.
// No image textures or extra runtime downloads are needed by the baked model.
export function createSlickTyre(radius: number, width: number) {
  const half = new T.CurvePath<T.Vector2>();
  const v = (r: number, z: number) => new T.Vector2(r, width / 2 + z);
  half.add(new T.CubicBezierCurve(v(.2286, -.010), v(.238, .001), v(.260, .003), v(.283, .003)));
  half.add(new T.CubicBezierCurve(v(.283, .003), v(radius - .027, .003), v(radius - .007, -.012), v(radius - .002, -.040)));
  half.add(new T.CubicBezierCurve(v(radius - .002, -.040), v(radius, -.052), new T.Vector2(radius, width * .18), new T.Vector2(radius, 0)));
  const outside = half.getPoints(10);
  const profile = [...outside.map(p => new T.Vector2(p.x, -p.y)), ...outside.slice(0, -1).reverse()];
  const geometry = new T.LatheGeometry(profile, 128).rotateX(Math.PI / 2);
  // Use the same sampled section for markings and moulding. This keeps them
  // attached to the actual rubber surface, including the shoulder curvature.
  const sidewall = (r: number) => {
    for (let i = 1; i < outside.length; i++) {
      const a = outside[i - 1], b = outside[i];
      if (r <= b.x) return T.MathUtils.lerp(a.y, b.y, T.MathUtils.clamp((r - a.x) / (b.x - a.x), 0, 1));
    }
    return 0;
  };
  return { geometry, sidewall };
}

function polygon(points: number[][]) {
  const shape = new T.Shape(points.map(([x, y]) => new T.Vector2(x, y)));
  shape.closePath();
  return shape;
}

// Block outlines retain the P Zero slant and Pirelli's extended P crossbar.
// Reusing font glyphs here would replace the tyre's characteristic wordmarks.
function letter(character: string) {
  const box = (x: number, y: number, w: number, h: number) => polygon([[x,y],[x+w,y],[x+w,y+h],[x,y+h]]);
  if (character === "I") return box(0,0,.26,1);
  if (character === "L") return polygon([[0,0],[.76,0],[.76,.22],[.26,.22],[.26,1],[0,1]]);
  if (character === "E") return polygon([[0,0],[.78,0],[.78,.22],[.26,.22],[.26,.40],[.70,.40],[.70,.61],[.26,.61],[.26,.78],[.78,.78],[.78,1],[0,1]]);
  if (character === "Z") return polygon([[0,0],[.83,0],[.83,.22],[.33,.22],[.83,.80],[.83,1],[0,1],[0,.78],[.49,.78],[0,.20]]);
  const shape = character === "O"
    ? polygon([[.16,0],[.69,0],[.85,.16],[.85,.84],[.69,1],[.16,1],[0,.84],[0,.16]])
    : character === "R"
      ? polygon([[0,0],[.26,0],[.26,.34],[.42,.34],[.62,0],[.92,0],[.67,.39],[.83,.53],[.83,.84],[.67,1],[0,1]])
      : polygon([[0,0],[.26,0],[.26,.34],[.67,.34],[.83,.50],[.83,.84],[.67,1],[0,1]]);
  const hole = character === "O" ? box(.25,.22,.35,.56) : box(.26,.57,.31,.21);
  shape.holes.push(new T.Path(hole.getPoints().reverse()));
  return shape;
}

export function addTyreSidewalls(wheel: T.Group, prefix: string, radius: number, sidewall: (r: number) => number) {
  const paint = new T.MeshStandardMaterial({ name: "Pirelli hard compound markings", color: "#c8c8bf", roughness: .94, metalness: 0 });
  const moulding = new T.MeshStandardMaterial({ name: "Moulded sidewall rubber", color: "#202224", roughness: .85, metalness: 0 });
  const add = (name: string, geometry: T.BufferGeometry, material: T.Material) => {
    const part = new T.Mesh(geometry, material); part.name = `${prefix} ${name}`;
    part.userData.component = "tyres"; part.receiveShadow = true; wheel.add(part);
    return part;
  };
  for (const side of [-1, 1]) {
    const painted: T.BufferGeometry[] = [], ribs: T.BufferGeometry[] = [];
    // Map flat outlines onto the curved sidewall. Subdivision keeps wide
    // letters from cutting through the tyre or floating above it on a chord.
    const wrap = (source: T.BufferGeometry, angle: number, radial: number, lift = .00035) => {
      const geometry = new TessellateModifier(.007, 6).modify(source);
      source.dispose();
      const p = geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const r = radial + p.getY(i), a = angle + p.getX(i) / radial;
        p.setXYZ(i, side * r * Math.sin(a), r * Math.cos(a), side * (sidewall(r) + lift));
      }
      geometry.computeVertexNormals();
      return geometry;
    };
    const wordmark = (word: string, angle: number, height: number, extendedP = false) => {
      const pieces: T.BufferGeometry[] = []; let x = 0;
      for (const ch of word) {
        if (ch === " ") { x += .38; continue; }
        const geometry = new T.ShapeGeometry(letter(ch), 3);
        const p = geometry.attributes.position, scale = extendedP && x > 0 ? .68 : 1;
        for (let i = 0; i < p.count; i++) p.setXY(i, p.getX(i) + x + (extendedP ? 0 : p.getY(i) * .18), p.getY(i) * scale);
        pieces.push(geometry); x += (ch === "I" ? .26 : ch === "L" ? .76 : .85) + .12;
      }
      if (extendedP) pieces.push(new T.ShapeGeometry(polygon([[.15,.82],[x-.12,.82],[x-.12,1],[.15,1]])));
      const geometry = mergeGeometries(pieces)!; pieces.forEach(g => g.dispose());
      geometry.translate(-x / 2, -.5, 0).scale(height, height, 1);
      painted.push(wrap(geometry, angle, .292));
    };
    wordmark("PIRELLI", Math.PI / 2, .032, true);
    wordmark("P ZERO", -Math.PI / 2, .032);
    // Two opposing chequered sweeps replace the continuous pre-2026 bands.
    for (const angle of [0, Math.PI]) {
      for (let row = 0; row < 2; row++) for (let column = 0; column < 10; column++) {
        if ((row + column) % 2) continue;
        const x = (column - 5) * .022, y = row * .012 - .012;
        painted.push(wrap(new T.ShapeGeometry(polygon([[x,y],[x+.018,y],[x+.023,y+.009],[x+.005,y+.009]])), angle, .297));
      }
      const sweep = (t: number) => [-.145 + .238 * t, .018 + .014 * t * (1 - t), .002 + .003 * t];
      for (let segment = 0; segment < 32; segment++) {
        const [x0,y0,h0] = sweep(segment / 32), [x1,y1,h1] = sweep((segment + 1) / 32);
        painted.push(wrap(new T.ShapeGeometry(polygon([[x0,y0],[x1,y1],[x1,y1+h1],[x0,y0+h0]])), angle, .297));
      }
    }
    for (const r of [.242, .249, radius - .026]) {
      ribs.push(new T.TorusGeometry(r, .00055, 4, 128).translate(0, 0, side * sidewall(r)).toNonIndexed());
    }
    // Tiny radial mould marks live on the sidewall shoulder, not the slick tread.
    for (let i = 0; i < 96; i++) {
      const a = i * Math.PI * 2 / 96;
      const tick = polygon([[-.0005,0],[.0005,0],[.0005,.0035],[-.0005,.0035]]);
      ribs.push(wrap(new T.ShapeGeometry(tick), a, radius - .022, .00018));
    }
    const marking = add(`2026 hard sidewall markings ${side}`, mergeGeometries(painted)!, paint);
    marking.userData.tyreSidewall = side;
    add(`sidewall moulding ${side}`, mergeGeometries(ribs)!, moulding);
    [...painted, ...ribs].forEach(g => g.dispose());
  }
}
