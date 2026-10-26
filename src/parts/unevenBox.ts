import { BoxGeometry } from "three";

/** Unevenness of the box walls in mm (waves and a gentle bow) and the number of shallow dents. */
export interface WallRelief {
  uneven: number;
  dents: number;
  seed: number;
}

function noise3(x: number, y: number, z: number): number {
  const h = (a: number, b: number, c: number): number => {
    let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1274126177);
    n = Math.imul(n ^ (n >>> 13), 1103515245);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const f = (t: number): number => t * t * (3 - 2 * t);
  const fx = f(x - xi);
  const fy = f(y - yi);
  const fz = f(z - zi);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), fx), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), fx), fy),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), fx), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), fx), fy),
    fz,
  );
}

/** A wall box rebuilt as a grid with soft low-frequency waves, a gentle bow and a few shallow dents (displacement along the face normal, zero at the edges). */
export function unevenBox(src: BoxGeometry, g: WallRelief, flatSide: -1 | 0 | 1 = 0): BoxGeometry {
  const { width, height, depth } = src.parameters;
  const geo = new BoxGeometry(width, height, depth, Math.max(1, Math.round(width / 4)), Math.max(1, Math.round(height / 4)), Math.max(1, Math.round(depth / 4)));
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  let seed = g.seed >>> 0;
  const random = (): number => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const half = [width / 2, height / 2, depth / 2];
  // the big faces of a wall look along its thinnest dimension
  const thin = half.indexOf(Math.min(...half));
  const dentList = Array.from({ length: g.dents }, () => {
    const sign = random() < 0.5 ? -1 : 1;
    const c = [(random() * 2 - 1) * half[0]! * 0.85, (random() * 2 - 1) * half[1]! * 0.85, (random() * 2 - 1) * half[2]! * 0.85];
    c[thin] = sign * half[thin]!;
    return { c, sign, radius: 7 + random() * 15, depth: 0.25 + random() * 0.7 };
  });
  for (let i = 0; i < pos.count; i++) {
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const n = [nor.getX(i), nor.getY(i), nor.getZ(i)];
    // the whole sheet bends along its thin axis; the fade depends on the position only, so that neighbouring faces stay joined
    void n;
    const inPlane = [0, 1, 2].filter((a) => a !== thin) as [number, number];
    const [b, c] = inPlane;
    const edge = Math.min(half[b]! - Math.abs(p[b]!), half[c]! - Math.abs(p[c]!));
    const fade = Math.min(Math.max(edge / 16, 0), 1);
    const smooth = fade * fade * fade * (fade * (fade * 6 - 15) + 10) * fade; // very flat near the edges: the bent sheet must not cover the moulding or the lid
    const wave = (noise3(p[0]! * 0.022, p[1]! * 0.022, p[2]! * 0.022) - 0.5) * 2 + 0.5 * (noise3(p[0]! * 0.06 + 9, p[1]! * 0.06, p[2]! * 0.06) - 0.5) * 2;
    const bow = Math.cos((Math.PI * p[b]!) / (2 * half[b]!)) * Math.cos((Math.PI * p[c]!) / (2 * half[c]!)) * 0.5;
    let d = (wave + bow) * g.uneven;
    for (const dent of dentList) {
      const dist = Math.hypot(p[b]! - dent.c[b]!, p[c]! - dent.c[c]!);
      d -= dent.sign * dent.depth * Math.exp(-((dist / dent.radius) ** 2)) * Math.max(g.uneven, 0.4);
    }
    d *= smooth; // zero at the edges: the walls must still meet the lid and the base
    if (Math.sign(p[thin]!) !== flatSide) p[thin] = p[thin]! + d; // the flat side (the inside of a wall) stays put: the thin liner lies against it
    pos.setXYZ(i, p[0]!, p[1]!, p[2]!);
  }
  geo.computeVertexNormals();
  return geo;
}
