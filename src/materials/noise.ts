/** Seeded value noise for the generated textures: the same pixels on every build. */
export { seededRandom } from "../parts/case";

function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Value noise in 0..1; `x` and `y` are in lattice cells. */
export function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal sum of `octaves` value noises, 0..1. */
export function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amplitude = 0.5;
  let norm = 0;
  let scale = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * valueNoise(x * scale, y * scale, seed + o * 101);
    norm += amplitude;
    amplitude *= 0.5;
    scale *= 2;
  }
  return sum / norm;
}

/** Normal map pixels (tangent space, RGBA bytes) from a height field in 0..1 using a Sobel filter; `strength` scales the slope. */
export function normalFromHeight(height: Float32Array, width: number, h: number, strength: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(width * h * 4));
  const at = (x: number, y: number): number => height[((y + h) % h) * width + ((x + width) % width)]!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < width; x++) {
      const dx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const dy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      let nx = -dx * strength;
      let ny = dy * strength; // canvas y grows downwards, texture v upwards
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      const i = (y * width + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}
