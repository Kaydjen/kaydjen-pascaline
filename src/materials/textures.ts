import { CanvasTexture, ClampToEdgeWrapping, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace } from "three";
import { fbm, normalFromHeight, seededRandom, valueNoise } from "./noise";
import { FONT_LABEL } from "./fonts";

/** The lid texture covers this area (mm, spec axes) whatever the level count: x -130..130, y -46..60. */
export const LID_TEXTURE_AREA = { x0: -130, y0: -46, width: 260, height: 106 } as const;

const hasDom = (): boolean => typeof document !== "undefined";

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return [c, c.getContext("2d", { willReadFrequently: true })!];
}

function toTexture(source: HTMLCanvasElement, srgb: boolean, anisotropy = 8): CanvasTexture {
  const texture = new CanvasTexture(source);
  texture.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  texture.anisotropy = anisotropy;
  texture.minFilter = LinearMipmapLinearFilter;
  return texture;
}

export interface LidTextures {
  map: CanvasTexture;
  roughnessMap: CanvasTexture;
  normalMap: CanvasTexture;
}

/** Scratches as thin lines: returns a height field contribution (0..1) drawn on a canvas. */
function scratchLayer(width: number, height: number, count: number, seed: number): Float32Array {
  const [, ctx] = canvas(width, height);
  const random = seededRandom(seed);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.lineCap = "round";
  for (let k = 0; k < count; k++) {
    const x = random() * width;
    const y = random() * height;
    const length = 10 + random() * 90;
    const angle = (random() < 0.7 ? 0 : Math.PI / 2) + (random() - 0.5) * 0.9;
    ctx.strokeStyle = `rgba(255,255,255,${0.08 + random() * 0.3})`;
    ctx.lineWidth = 0.5 + random() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    ctx.stroke();
  }
  const data = ctx.getImageData(0, 0, width, height).data;
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4]! / 255;
  return out;
}

/**
 * Brushed, worn brass for the lid: albedo with blotches and darker worn zones, roughness with brushing streaks along x, scratches
 * and fingerprints, and a tangent-space normal map from the same streaks (photos: strong brushing along x, uneven reflection patches).
 */
export function lidTextures(seed: number): LidTextures | null {
  if (!hasDom()) return null;
  const width = 1280;
  const height = 528;
  const [albedoCanvas, albedoCtx] = canvas(width, height);
  const [roughCanvas, roughCtx] = canvas(width, height);
  const albedo = albedoCtx.createImageData(width, height);
  const rough = roughCtx.createImageData(width, height);
  const heightField = new Float32Array(width * height);
  const scratches = scratchLayer(width, height, 160, seed + 7);
  const pxPerMm = width / LID_TEXTURE_AREA.width;
  // base brass #B89A55, patches #9C8244 / #C9AE6B
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const mmX = x / pxPerMm;
      const mmY = y / pxPerMm;
      const streak = fbm(x * 0.006, y * 0.55, seed, 3); // long along x
      const fine = valueNoise(x * 0.02, y * 1.4, seed + 5);
      const blotch = fbm(mmX * 0.06, mmY * 0.06, seed + 11, 4);
      const wear = Math.max(0, fbm(mmX * 0.025, mmY * 0.025, seed + 21, 3) - 0.55) * 2.2; // darker worn zones
      const finger = Math.max(0, valueNoise(mmX * 0.22, mmY * 0.22, seed + 31) - 0.72) * 3;
      const scratch = scratches[i]!;
      const shade = 0.86 + 0.28 * blotch + 0.1 * (streak - 0.5) - 0.12 * wear;
      albedo.data[i * 4] = Math.min(255, 0xb0 * shade + scratch * 40);
      albedo.data[i * 4 + 1] = Math.min(255, 0x96 * shade + scratch * 36);
      albedo.data[i * 4 + 2] = Math.min(255, 0x5c * shade * (1 - 0.15 * wear) + scratch * 26);
      albedo.data[i * 4 + 3] = 255;
      const roughness = Math.min(0.85, Math.max(0.22, 0.36 + 0.12 * (streak - 0.5) + 0.06 * (fine - 0.5) + 0.06 * finger + 0.1 * wear - 0.08 * scratch));
      rough.data[i * 4] = 255;
      rough.data[i * 4 + 1] = roughness * 255;
      rough.data[i * 4 + 2] = 255; // metalness 1 (multiplied by the material value)
      rough.data[i * 4 + 3] = 255;
      heightField[i] = 0.35 * streak + 0.2 * fine + 0.5 * scratch;
    }
  }
  albedoCtx.putImageData(albedo, 0, 0);
  roughCtx.putImageData(rough, 0, 0);
  const [normalCanvas, normalCtx] = canvas(width, height);
  normalCtx.putImageData(new ImageData(normalFromHeight(heightField, width, height, 1.1), width, height), 0, 0);
  const { x0, y0, width: w, height: h } = LID_TEXTURE_AREA;
  const place = (t: CanvasTexture): CanvasTexture => {
    // UVs of the extruded lid are plain millimetres: map the fixed area onto 0..1 (canvas row 0 is the smallest y)
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.repeat.set(1 / w, 1 / h);
    t.offset.set(-x0 / w, -y0 / h);
    t.flipY = false;
    return t;
  };
  return {
    map: place(toTexture(albedoCanvas, true)),
    roughnessMap: place(toTexture(roughCanvas, false)),
    normalMap: place(toTexture(normalCanvas, false)),
  };
}

/** Wood grain along u: a neutral multiplier map (the material colour tints it). */
export function woodTexture(seed: number): CanvasTexture | null {
  if (!hasDom()) return null;
  const size = 512;
  const [c, ctx] = canvas(size, size);
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const warp = fbm(x * 0.006, y * 0.03, seed, 3) * 3;
      const rings = 0.5 + 0.5 * Math.sin(y * 0.5 + warp * 2.0);
      const fine = valueNoise(x * 0.02, y * 1.6, seed + 3);
      const stain = fbm(x * 0.004, y * 0.008, seed + 9, 3);
      const v = 0.8 + 0.05 * rings + 0.07 * (fine - 0.5) + 0.1 * (stain - 0.5);
      const k = (y * size + x) * 4;
      image.data[k] = image.data[k + 1] = image.data[k + 2] = Math.min(255, v * 255);
      image.data[k + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const t = toTexture(c, true);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** Parchment note glued inside the box: aged paper with the date in brown ink. */
export function noteTexture(seed: number): CanvasTexture | null {
  if (!hasDom()) return null;
  const w = 880;
  const h = 210;
  const [c, ctx] = canvas(w, h);
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, w - x, y, h - y);
      const dark = Math.max(0, 1 - edge / 40);
      const v = 0.85 + 0.12 * fbm(x * 0.02, y * 0.02, seed, 4) - 0.25 * dark * dark;
      const k = (y * w + x) * 4;
      image.data[k] = 0xe0 * v;
      image.data[k + 1] = 0xd2 * v;
      image.data[k + 2] = 0xaa * v;
      image.data[k + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  ctx.fillStyle = "#4a3418";
  ctx.font = `italic 64px ${FONT_LABEL}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-0.025);
  ctx.fillText("20 may 1652", 0, 0);
  ctx.restore();
  return toTexture(c, true);
}

/** Paper of a digit drum: two row backgrounds, aged, stained, with fibres; digits are drawn by the caller on top (see drums.ts). */
export function paperBackground(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number, tints: [string, string]): void {
  const random = seededRandom(seed);
  // the stains are generated at a quarter of the size and scaled up: the paper is soft anyway and the load stays short
  const w = Math.round(width / 2);
  const h = Math.round(height / 2);
  const [small, sctx] = canvas(w, h);
  const rowHeight = h / 2;
  tints.forEach((tint, row) => {
    sctx.fillStyle = tint;
    sctx.fillRect(0, row * rowHeight, w, rowHeight);
  });
  const image = sctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const stain = fbm(x * 0.024, y * 0.06, seed, 3);
      const fibre = valueNoise(x * 0.8, y * 0.08, seed + 2);
      const shade = 0.9 + 0.16 * stain - 0.05 * fibre;
      const k = (y * w + x) * 4;
      image.data[k] = image.data[k]! * shade;
      image.data[k + 1] = image.data[k + 1]! * shade;
      image.data[k + 2] = image.data[k + 2]! * shade * 0.97;
    }
  }
  sctx.putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, width, height);
  for (let k = 0; k < 900; k++) {
    ctx.fillStyle = `rgba(${90 + random() * 60}, ${70 + random() * 40}, 40, ${0.03 + random() * 0.06})`;
    ctx.fillRect(random() * width, random() * height, 1 + random() * 3, 1 + random() * 3);
  }
}
