import { Color, Data3DTexture, DataTexture, type IUniform, LinearFilter, type MeshStandardMaterial, RedFormat, RepeatWrapping, RGBAFormat, type Texture, UnsignedByteType, Vector2, Vector3, Vector4, type WebGLProgramParametersWithUniforms } from "three";

/**
 * Surface character for the standard materials (the shipped look and the lab), computed in the fragment shader from
 * the object-space position, so no UVs are needed and nothing is stretched on curved parts:
 *  - procedural wear: brushing, scratches, grime, patina, grain (amounts 0 = clean .. 1 = heavy);
 *  - photo-scan layer: a CC0 scan (colour, normal, roughness) projected from three sides and mixed with a second, smaller copy so
 *    that the repeat is not visible;
 *  - edge wear on box faces: bright rubbed metal along the edges (uses the face UVs and the face size).
 */
export interface WearSettings {
  /** Direction of the brushing in object space (the streaks run along it): 0 = x, 1 = y, 2 = z. */
  brushAxis: 0 | 1 | 2;
  brushScale: number;
  brushAmount: number;
  brushBump: number;
  scratchAmount: number;
  scratchScale: number;
  scratchBump: number;
  grimeAmount: number;
  grimeScale: number;
  grimeColor: string;
  /** Fine metal grain: tiny roughness and relief noise. */
  grain: number;
  tintVariation: number;
  patinaAmount: number;
  patinaScale: number;
  patinaColor: string;
}

export interface ScanSettings {
  /** Name of a loaded scan, "" for none. */
  scan: string;
  /** How much of the large dark blotches of the scan is kept: 1 = all, 0 = only scratches and fine grain. */
  stain: number;
  /** Size of one tile of the scan in millimetres. */
  tile: number;
  tint: string;
  normal: number;
  roughMul: number;
  roughAdd: number;
  /** Wood grain runs along x also on the faces that look along x. */
  wood: boolean;
  /** Rubbed bright edges (box faces only): amount, width in mm and colour. */
  edge: number;
  edgeWidth: number;
  edgeColor: string;
  /** Unevenness of a sheet: soft waves that bend the reflections (strength, size of one wave in mm). */
  wave: number;
  waveSize: number;
  /** Grime and verdigris that gather at the bottom of a wall (object z of the bottom edge and height of the zone, mm). */
  low: number;
  lowZ: number;
  lowH: number;
  /** Patina colour gathering along the edges and corners of a box face (strength, width in mm). */
  corner: number;
  cornerWidth: number;
  /** Second photo scan that grows over the first one where it would really gather (verdigris crust): which scan, tile, tint. */
  scan2: string;
  tile2: number;
  tint2: string;
  /** Overall strength, bottom zone weight, vertical streaks from the top edge (weight, length in mm), pits and rough spots weight. */
  amount2: number;
  bottom2: number;
  streak2: number;
  streakLen2: number;
  spots2: number;
  /** Dulling and darkening towards the edges of a flat plate (hands polish the middle): strength, centre and half size in mm (object x, y). */
  vig: number;
  vigX: number;
  vigY: number;
  vigHX: number;
  vigHY: number;
  /** Shift of the scan on the part in mm (to move a stain away from the parts that stand on a plate). */
  offX: number;
  offY: number;
  /** Contact dirt around the bases of the parts that stand on a plate (the lid): strength and width in mm. */
  halo: number;
  /** Polished zones where use rubs the dirt away (hands at the front edge, the stylus at the rings, the strip track): 0 = off. */
  zones: number;
  /** Lighter, rubbed rim along the border of the lid plate. */
  rim: number;
  /** Two fine engraved border lines parallel to the lid edge (a groove in the height and a dark film in it): 0 = off. */
  lines: number;
  /** Rubbed bright edges where the surface curves sharply (bevels, rims, dome edges); measured from the normals, no UVs needed. */
  curv: number;
}

export const CLEAN: WearSettings = {
  brushAxis: 0,
  brushScale: 3,
  brushAmount: 0,
  brushBump: 0,
  scratchAmount: 0,
  scratchScale: 1.2,
  scratchBump: 0,
  grimeAmount: 0,
  grimeScale: 0.12,
  grimeColor: "#2a2014",
  grain: 0,
  tintVariation: 0,
  patinaAmount: 0,
  patinaScale: 0.08,
  patinaColor: "#4b5a3a",
};

export const NO_SCAN: ScanSettings = { scan: "", stain: 1, tile: 60, tint: "#ffffff", normal: 1, roughMul: 1, roughAdd: 0, wood: false, edge: 0, edgeWidth: 1.2, edgeColor: "#c9a95a", wave: 0, waveSize: 60, low: 0, lowZ: -35.9, lowH: 20, corner: 0, cornerWidth: 8, scan2: "", tile2: 50, tint2: "#ffffff", amount2: 0, bottom2: 0.7, streak2: 0.7, streakLen2: 30, spots2: 0.3, vig: 0, vigX: 0, vigY: 7, vigHX: 126, vigHY: 50.5, offX: 0, offY: 0, halo: 0, zones: 0, rim: 0, lines: 0, curv: 0 };

export type WearLevel = "none" | "light" | "medium" | "heavy";

/** Three starting strengths for a metal part. */
export function metalPreset(level: WearLevel): WearSettings {
  const k = { none: 0, light: 0.4, medium: 0.75, heavy: 1 }[level];
  return {
    ...CLEAN,
    brushAmount: 0.28 * k,
    brushBump: 0.35 * k,
    scratchAmount: 0.9 * k,
    scratchBump: 0.6 * k,
    grimeAmount: 0.65 * k,
    grain: 0.8 * k,
    tintVariation: 0.22 * k,
    patinaAmount: 0.3 * k * k,
  };
}

/** A set of scan textures that can be assigned to a material. */
export interface ScanTextures {
  color: Texture;
  normal: Texture;
  roughness: Texture;
}

interface WearUniforms {
  [name: string]: IUniform;
}

/**
 * Footprint of everything that stands on the lid (top view, blurred; see `footprint.ts`): the dirt gathers around the real outline of every part.
 * One set of uniform objects shared by all wear materials; black until the footprint is baked.
 */
const black = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat, UnsignedByteType);
black.needsUpdate = true;
export const lidFootprint = {
  map: { value: black } as IUniform<Texture>,
  min: { value: new Vector2(-130, -48) } as IUniform<Vector2>,
  size: { value: new Vector2(260, 110) } as IUniform<Vector2>,
  /** Where the map value turns into full grime (core) and into the faint skirt: the map is the blurred top view of the parts, see `footprint.ts`. */
  core: { value: new Vector2(0.16, 0.5) } as IUniform<Vector2>,
  skirt: { value: new Vector2(0.02, 0.2) } as IUniform<Vector2>,
  skirtWeight: { value: 0 } as IUniform<number>,
  /** How much the grime strength varies over the surface (0 = even). */
  noise: { value: 0.3 } as IUniform<number>,
};
/** Zones of use [x, y, half width, half height, strength]: the right hand rests at the front edge; the stylus is pulled out of the right barrel (its mouth, and the lid in front of it). Nothing near bolts and levers. */
const ZONES: [number, number, number, number, number][] = [
  [70, -39.5, 100, 5, 0.8],
  [-80, -39.5, 60, 4, 0.3],
  [116, 30, 8, 6, 1.1],
  [116, 35.5, 7, 4, 1.4],
  [-116, 35.5, 6, 3, 0.4],
];
const ZONE_A = ZONES.map((z) => new Vector4(z[0], z[1], z[2], z[3]));
const ZONE_S = ZONES.map((z) => z[4]);

const blank = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
blank.needsUpdate = true;

/** 32 x 32 x 32 random values (fixed seed) that repeat in all directions: the lattice of the wear noise. */
const NOISE_SIZE = 32;
const noiseTexture = ((): Data3DTexture => {
  const data = new Uint8Array(NOISE_SIZE ** 3);
  let seed = 0x1f3d5b79;
  for (let i = 0; i < data.length; i++) {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    data[i] = ((t ^ (t >>> 14)) >>> 0) & 255;
  }
  const texture = new Data3DTexture(data, NOISE_SIZE, NOISE_SIZE, NOISE_SIZE);
  texture.format = RedFormat;
  texture.type = UnsignedByteType;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
})();

function uniformsFor(s: WearSettings): WearUniforms {
  const stretch = (axis: number): Vector3 => new Vector3(axis === 0 ? 0.04 : 1, axis === 1 ? 0.04 : 1, axis === 2 ? 0.04 : 1);
  return {
    uBrushStretch: { value: stretch(s.brushAxis) },
    uBrushScale: { value: s.brushScale },
    uBrushAmount: { value: s.brushAmount },
    uBrushBump: { value: s.brushBump },
    uScratchAmount: { value: s.scratchAmount },
    uScratchScale: { value: s.scratchScale },
    uScratchBump: { value: s.scratchBump },
    uGrimeAmount: { value: s.grimeAmount },
    uGrimeScale: { value: s.grimeScale },
    uGrimeColor: { value: new Color(s.grimeColor) },
    uTint: { value: s.tintVariation },
    uGrain: { value: s.grain },
    uPatinaAmount: { value: s.patinaAmount },
    uPatinaScale: { value: s.patinaScale },
    uPatinaColor: { value: new Color(s.patinaColor) },
    // scan layer and edge wear
    uScanOn: { value: 0 },
    uStain: { value: 1 },
    uScanTile: { value: NO_SCAN.tile },
    uScanTint: { value: new Color(NO_SCAN.tint) },
    uScanNormalK: { value: 1 },
    uScanRoughMul: { value: 1 },
    uScanRoughAdd: { value: 0 },
    uScanWood: { value: 0 },
    uScanColor: { value: blank },
    uScanNormalMap: { value: blank },
    uScanRough: { value: blank },
    uEdge: { value: 0 },
    uEdgeWidth: { value: NO_SCAN.edgeWidth },
    uEdgeColor: { value: new Color(NO_SCAN.edgeColor) },
    uFaceSize: { value: new Vector2(100, 100) },
    uWave: { value: 0 },
    uWaveScale: { value: 1 / 60 },
    uLow: { value: 0 },
    uLowZ: { value: -35.9 },
    uLowH: { value: 20 },
    uCorner: { value: 0 },
    uCornerW: { value: 8 },
    uScan2On: { value: 0 },
    uScan2Color: { value: blank },
    uScan2NormalMap: { value: blank },
    uScan2Rough: { value: blank },
    uScan2Tile: { value: 50 },
    uScan2Tint: { value: new Color("#ffffff") },
    uScan2Amount: { value: 0 },
    uScan2Bottom: { value: 0.7 },
    uScan2Streak: { value: 0.7 },
    uScan2StreakLen: { value: 30 },
    uScan2Spots: { value: 0.3 },
    uVig: { value: 0 },
    uVigC: { value: new Vector2(0, 7) },
    uVigH: { value: new Vector2(126, 50.5) },
    uScanOff: { value: new Vector2(0, 0) },
    uHalo: { value: 0 },
    uZones: { value: 0 },
    uRim: { value: 0 },
    uLines: { value: 0 },
    uCurv: { value: 0 },
    uZoneA: { value: ZONE_A },
    uZoneS: { value: ZONE_S },
    uFoot: lidFootprint.map,
    uFootMin: lidFootprint.min,
    uFootSize: lidFootprint.size,
    uFootCore: lidFootprint.core,
    uFootSkirt: lidFootprint.skirt,
    uFootSkirtW: lidFootprint.skirtWeight,
    uFootNoise: lidFootprint.noise,
    uWearNoise: { value: noiseTexture },
  };
}

const VERTEX_DECLARATIONS = /* glsl */ `
#include <common>
varying vec3 vWearPos;
varying vec3 vWearN;
varying vec2 vWearUv;
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
#include <common>
varying vec3 vWearPos;
varying vec3 vWearN;
varying vec2 vWearUv;
uniform mat3 normalMatrix;
uniform vec3 uBrushStretch;
uniform float uBrushScale, uBrushAmount, uBrushBump;
uniform float uScratchAmount, uScratchScale, uScratchBump;
uniform float uGrimeAmount, uGrimeScale, uTint, uGrain;
uniform float uPatinaAmount, uPatinaScale;
uniform vec3 uGrimeColor, uPatinaColor;
uniform float uStain;
uniform float uScanOn, uScanTile, uScanNormalK, uScanRoughMul, uScanRoughAdd, uScanWood;
uniform vec3 uScanTint;
uniform sampler2D uScanColor, uScanNormalMap, uScanRough;
uniform float uEdge, uEdgeWidth;
uniform vec3 uEdgeColor;
uniform vec2 uFaceSize;
uniform float uWave, uWaveScale, uLow, uLowZ, uLowH, uCorner, uCornerW;
uniform float uScan2On, uScan2Tile, uScan2Amount, uScan2Bottom, uScan2Streak, uScan2StreakLen, uScan2Spots;
uniform vec3 uScan2Tint;
uniform float uVig, uHalo;
uniform vec2 uVigC, uVigH, uScanOff;
uniform sampler2D uFoot;
uniform vec2 uFootMin, uFootSize, uFootCore, uFootSkirt;
uniform float uFootSkirtW, uFootNoise;
uniform float uRim, uCurv, uLines;
uniform float uZones;
uniform vec4 uZoneA[5];
uniform float uZoneS[5];
uniform sampler2D uScan2Color, uScan2NormalMap, uScan2Rough;
uniform highp sampler3D uWearNoise;

/** Value noise from a small random 3D texture: the lattice values are texels, the smooth blend is the texture filter (the hash version took seconds to compile). */
float wNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return texture(uWearNoise, (i + f + 0.5) / 32.0).r;
}
float wFbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * wNoise(p);
    p = p * 2.03 + 11.7;
    a *= 0.5;
  }
  return s;
}
float wFbm2(vec3 p) {
  return 0.65 * wNoise(p) + 0.35 * wNoise(p * 2.07 + 5.3);
}
/** A texel of the noise texture, read exactly (the lattice value of cell c in layer k). */
float wCell(vec2 c, float k) {
  return texture(uWearNoise, (vec3(mod(c, 32.0), k) + 0.5) / 32.0).r;
}
/**
 * One hairline scratch per cell at most: a short straight segment at a random angle, length and place inside its cell (so there is no
 * lattice and no cut at the cell border). Its width is about 0.05 mm; farther away it fades into a faint sheen by its pixel coverage.
 */
float wScratchLayer(vec2 q, float cell, float seed, float flow) {
  vec2 cq = q / cell;
  vec2 c = floor(cq);
  vec2 f = fract(cq);
  float present = step(0.55, wCell(c, seed));
  float r1 = wCell(c, seed + 1.0);
  // most scratches of a neighbourhood run the same way (the way the plate was rubbed), a few cross them
  float a = r1 < 0.8 ? flow + (r1 / 0.8 - 0.5) * 0.7 : r1 * 3.14159;
  vec2 dir = vec2(cos(a), sin(a));
  float halfLen = mix(0.14, 0.4, wCell(c, seed + 2.0));
  vec2 centre = vec2(0.5) + (vec2(wCell(c, seed + 3.0), wCell(c, seed + 4.0)) - 0.5) * 0.2;
  vec2 p = f - centre;
  float t = clamp(dot(p, dir), -halfLen, halfLen);
  float d = length(p - dir * t) * cell;
  float px = length(fwidth(q));
  float strength = wCell(c, seed + 5.0);
  float w = mix(0.015, 0.045, strength);
  float taper = 1.0 - smoothstep(0.55, 1.0, abs(t) / halfLen);
  return (1.0 - smoothstep(0.5 * w, w + px, d)) * w / (w + px) * present * taper * (0.25 + 0.75 * strength * strength);
}
float wScratches(vec3 pos, vec3 n, float scale) {
  vec3 an = abs(n);
  vec2 q = an.z > 0.6 ? pos.xy : (an.y > an.x ? pos.xz : pos.yz);
  float flow = wFbm(vec3(q * 0.05, 5.0)) * 9.0;
  return max(max(wScratchLayer(q, 3.2 / scale, 0.0, flow), wScratchLayer(q + 17.3, 1.7 / scale, 8.0, flow)), wScratchLayer(q + 41.9, 5.5 / scale, 16.0, flow));
}
vec3 wearPerturb(vec3 surfPos, vec3 surfNorm, vec2 dH, float faceDirection) {
  vec3 sx = normalize(dFdx(surfPos));
  vec3 sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDirection;
  vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
/** Three-sided projection weights and samples. The x projection runs along y for wood so that the grain stays horizontal. */
vec3 triW(vec3 n) {
  vec3 w = pow(abs(n), vec3(6.0));
  return w / (w.x + w.y + w.z);
}
vec2 triUvX(vec3 p) { return uScanWood > 0.5 ? p.yz : p.zy; }
vec3 triSample(sampler2D t, vec3 p, vec3 w) {
  return texture2D(t, triUvX(p)).rgb * w.x + texture2D(t, p.xz).rgb * w.y + texture2D(t, p.xy).rgb * w.z;
}
vec3 triSampleBias(sampler2D t, vec3 p, vec3 w, float bias) {
  return texture2D(t, triUvX(p), bias).rgb * w.x + texture2D(t, p.xz, bias).rgb * w.y + texture2D(t, p.xy, bias).rgb * w.z;
}
vec3 triNormalOf(sampler2D map, vec3 p, vec3 n, vec3 w) {
  vec3 s = sign(n);
  vec3 tx = texture2D(map, triUvX(p)).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(map, p.xz).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(map, p.xy).xyz * 2.0 - 1.0;
  if (uScanWood > 0.5) tx.xy = tx.yx;
  tx.xy *= uScanNormalK;
  ty.xy *= uScanNormalK;
  tz.xy *= uScanNormalK;
  tx.x *= s.x;
  ty.x *= s.y;
  tz.x *= -s.z;
  tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
  ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
}
vec3 triNormal(vec3 p, vec3 n, vec3 w) {
  return triNormalOf(uScanNormalMap, p, n, w);
}
`;

/** Scan layer first (it replaces the base colour), then the procedural wear on top, then the rubbed edges. */
const COLOR_INJECTION = /* glsl */ `
#include <color_fragment>
vec3 wScanN = normalize(vWearN);
vec3 wBlend = triW(wScanN);
vec3 wP = (vWearPos + vec3(uScanOff, 0.0)) / uScanTile;
float wScanRough = 0.5;
#ifdef W_SCAN
float wScanMask = smoothstep(0.3, 0.7, wFbm(vWearPos * 0.02 + 70.0));
if (uScanOn > 0.0) {
  vec3 colorA = triSample(uScanColor, wP, wBlend);
  vec3 colorB = triSample(uScanColor, wP * 2.3 + 0.37, wBlend);
  vec3 scanColor = mix(colorA, colorB, wScanMask * 0.55);
#ifdef W_STAIN
  if (uStain < 1.0) {
    // remove the large blotches: subtract the low-pass of the scan (blurred by mip bias) minus its overall mean
    vec3 lowA = triSampleBias(uScanColor, wP, wBlend, 6.0);
    vec3 meanA = triSampleBias(uScanColor, wP, wBlend, 11.0);
    scanColor = max(scanColor - (lowA - meanA) * (1.0 - uStain), 0.0);
  }
#endif
  diffuseColor.rgb = mix(diffuseColor.rgb, scanColor * uScanTint, uScanOn);
  vec3 roughA = triSample(uScanRough, wP, wBlend);
  vec3 roughB = triSample(uScanRough, wP * 2.3 + 0.37, wBlend);
  wScanRough = mix(roughA, roughB, wScanMask * 0.55).r;
}
#endif
float wMask2 = 0.0;
#ifdef W_SCAN2
if (uScan2On > 0.0) {
  float zTop = -uLowZ;
  float lowTerm = (1.0 - smoothstep(0.0, uLowH, vWearPos.z - uLowZ)) * (0.5 + 1.1 * wFbm(vWearPos * 0.05 + 90.0));
  float topTerm = 1.0 - smoothstep(0.0, uScan2StreakLen, zTop - vWearPos.z);
  float streakNoise = wFbm(vec3(vWearPos.x * 0.22, vWearPos.y * 0.22, vWearPos.z * 0.025) + 7.0);
  float spotNoise = wFbm(vWearPos * 0.2 + 17.0);
  float field = uScan2Bottom * lowTerm + uScan2Streak * topTerm * smoothstep(0.42, 0.7, streakNoise) + uScan2Spots * smoothstep(0.58, 0.78, spotNoise);
  float crust = wFbm(vWearPos * 0.35 + 3.0);
  wMask2 = smoothstep(0.35, 0.75, field * uScan2Amount + (crust - 0.5) * 0.35 * min(field, 1.0)) * smoothstep(0.02, 0.1, field);
  vec3 p2 = vWearPos / uScan2Tile;
  vec3 color2 = triSample(uScan2Color, p2, wBlend) * uScan2Tint;
  diffuseColor.rgb = mix(diffuseColor.rgb, color2, wMask2);
  wScanRough = mix(wScanRough, triSample(uScan2Rough, p2, wBlend).r, wMask2);
}
#endif
float wearPx = length(fwidth(vWearPos));
float wearBrushFade = 1.0 - smoothstep(0.02, 0.12, wearPx * uBrushScale * 6.0);
float wearScratchFade = 1.0 - smoothstep(0.04, 0.2, wearPx); // hairlines are gone beyond ~0.2 mm per pixel: no glitter at a distance
float wearBrush = 0.5;
#ifdef W_BRUSH
vec3 wb = vWearPos * uBrushScale;
wearBrush = wNoise(wb * uBrushStretch * 6.0 + vec3(3.1)) * 0.65 + wNoise(wb * uBrushStretch * 14.0) * 0.35;
#endif
float wearScratch = 0.0;
#ifdef W_SCRATCH
wearScratch = wScratches(vWearPos, wScanN, uScratchScale);
float wearCluster = smoothstep(0.25, 0.6, wFbm(vWearPos * 0.07 + 4.0));
wearScratch = wearScratch * wearCluster * uScratchAmount * wearScratchFade;
#endif
float wearGrime = 0.0;
#ifdef W_GRIME
wearGrime = smoothstep(0.35, 0.8, wFbm(vWearPos * uGrimeScale + 20.0)) * uGrimeAmount;
#endif
float wearPatina = 0.0;
#ifdef W_PATINA
wearPatina = smoothstep(0.5, 0.75, wFbm(vWearPos * uPatinaScale + 40.0)) * uPatinaAmount;
#endif
float wearTint = 0.0;
#ifdef W_TINT
wearTint = (wFbm(vWearPos * 0.03 + 60.0) - 0.5) * uTint;
#endif
diffuseColor.rgb *= 1.0 + wearTint;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uGrimeColor * 3.2, clamp(wearGrime, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, uPatinaColor, clamp(wearPatina, 0.0, 0.85));
diffuseColor.rgb += wearScratch * 0.12 * (1.0 - 0.6 * wearGrime);
float wearEdge = 0.0;
float wearEdgeDist = min(min(vWearUv.x, 1.0 - vWearUv.x) * uFaceSize.x, min(vWearUv.y, 1.0 - vWearUv.y) * uFaceSize.y);
#ifdef W_CORNER
if (uCorner > 0.0) {
  float cornerMask = (1.0 - smoothstep(0.0, uCornerW, wearEdgeDist + (wFbm(vWearPos * 0.12 + 33.0) - 0.5) * uCornerW * 1.6)) * uCorner;
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * 0.6, uPatinaColor, 0.7), clamp(cornerMask, 0.0, 1.0));
}
#endif
#ifdef W_EDGE
if (uEdge > 0.0) {
  wearEdge = (1.0 - smoothstep(0.0, uEdgeWidth, wearEdgeDist + (wFbm(vWearPos * 0.3) - 0.5) * uEdgeWidth * 1.1)) * uEdge;
  wearEdge = clamp(wearEdge, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, uEdgeColor * (0.8 + 0.3 * wNoise(vWearPos * 2.0)), wearEdge);
}
#endif
float wearLow = 0.0;
#ifdef W_LOW
wearLow = (1.0 - smoothstep(0.0, uLowH, vWearPos.z - uLowZ)) * uLow * (0.4 + 1.2 * wFbm(vWearPos * 0.06 + 90.0));
wearLow = clamp(wearLow, 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * 0.5, uPatinaColor, 0.55), wearLow);
#endif
float wearVig = 0.0;
#ifdef W_VIG
if (uVig > 0.0) {
  vec2 vq = abs((vWearPos.xy - uVigC) / uVigH);
  wearVig = clamp(smoothstep(0.5, 1.0, max(vq.x, vq.y) + (wFbm(vWearPos * 0.05 + 11.0) - 0.5) * 0.3) * uVig, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.45, 0.32), wearVig);
}
#endif
float wearHalo = 0.0;
#ifdef W_HALO
if (uHalo > 0.0) {
  // the footprint is the blurred top view of the parts: about 0.5 at their outline, falling off outside
  float foot = texture2D(uFoot, (vWearPos.xy - uFootMin) / uFootSize).r;
  float core = smoothstep(uFootCore.x, uFootCore.y, foot);
  float skirt = smoothstep(uFootSkirt.x, uFootSkirt.y, foot);
  float patchy = 1.0 + uFootNoise * (wFbm(vWearPos * 0.5 + 5.0) - 0.5);
  wearHalo = clamp((core * 1.0 + skirt * uFootSkirtW) * uHalo * patchy, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.36, 0.31, 0.25), wearHalo);
}
#endif
float wearZone = 0.0;
#ifdef W_ZONES
if (uZones > 0.0) {
  for (int i = 0; i < 5; i++) {
    vec2 q = (vWearPos.xy - uZoneA[i].xy) / uZoneA[i].zw;
    float m = (1.0 - smoothstep(0.5, 1.0, length(q) + (wFbm(vWearPos * 0.3 + float(i) * 3.1) - 0.5) * 0.6)) * uZoneS[i];
    wearZone = max(wearZone, m);
  }
  wearZone = clamp(wearZone * uZones, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, clamp(diffuseColor.rgb * 1.3, 0.0, 1.0) * vec3(1.0, 0.95, 0.82), wearZone * 0.8);
}
#endif
#ifdef W_RIM
if (uRim > 0.0) {
  vec2 rq = abs((vWearPos.xy - uVigC) / uVigH);
  float rim = smoothstep(0.945, 0.995, max(rq.x, rq.y) + (wFbm(vWearPos * 0.4 + 51.0) - 0.5) * 0.04) * uRim;
  diffuseColor.rgb = mix(diffuseColor.rgb, clamp(diffuseColor.rgb * 1.3, 0.0, 1.0) * vec3(1.0, 0.94, 0.8), clamp(rim, 0.0, 1.0));
}
#endif
float wearLine = 0.0;
#ifdef W_LINES
if (uLines > 0.0) {
  // two grooves 2.0 and 2.6 mm inside the border of the plate (the same centre and half size as the rim)
  vec2 lq = uVigH - abs(vWearPos.xy - uVigC);
  float edgeDist = min(lq.x, lq.y);
  // far = the grooves are thinner than a pixel: one soft, wider line without relief and without noise (a hairline there crawls
  // and turns into a dotted zip when the camera moves)
  float lineFar = smoothstep(0.04, 0.12, wearPx);
  float lineHalf = max(0.1, wearPx * mix(0.9, 1.6, lineFar));
  float tent = max(1.0 - abs(edgeDist - 2.3) / lineHalf, 0.0) * lineFar + (1.0 - lineFar) * max(max(1.0 - abs(edgeDist - 2.0) / lineHalf, 0.0), max(1.0 - abs(edgeDist - 2.6) / lineHalf, 0.0));
  float lineNoise = mix(0.75 + 0.5 * wNoise(vWearPos * 1.3), 1.0, lineFar);
  wearLine = tent * (1.0 - lineFar) * lineNoise * uLines;
  float lineInk = clamp(smoothstep(0.0, 0.7, tent) * mix(1.0, 0.45, lineFar) * uLines, 0.0, 0.9);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.16, 0.13, 0.1), lineInk);
}
#endif
#ifdef W_CURV
if (uCurv > 0.0) {
  float curvature = length(fwidth(wScanN)) / max(wearPx, 1e-4);
  float edgeBright = smoothstep(1.2, 3.8, curvature) * uCurv * (0.7 + 0.6 * wNoise(vWearPos * 3.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, clamp(diffuseColor.rgb * 1.5, 0.0, 1.0) * vec3(1.0, 0.93, 0.74), clamp(edgeBright, 0.0, 1.0));
}
#endif
float wearGrain = 0.0;
#ifdef W_GRAIN
float wearGrainFade = 1.0 - smoothstep(0.08, 0.45, wearPx * 38.0);
wearGrain = (wNoise(vWearPos * 38.0) - 0.5) * uGrain * wearGrainFade;
#endif
float wearHeight = (wearBrush - 0.5) * uBrushBump * wearBrushFade + wearScratch * -uScratchBump * 0.6 + wearGrain * 0.35 - wearLine * 1.2;
`;

const ROUGHNESS_INJECTION = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, clamp(wScanRough * uScanRoughMul + uScanRoughAdd, 0.04, 1.0), uScanOn);
roughnessFactor += wearGrain * 0.5 + (wearBrush - 0.5) * uBrushAmount * wearBrushFade + wearGrime * 0.28 + wearScratch * 0.12 + wearPatina * 0.3 - wearEdge * 0.3;
roughnessFactor += wearLow * 0.25 + wearVig * 0.2 + wearHalo * 0.25 - wearZone * 0.1;
roughnessFactor = clamp(roughnessFactor, 0.05, 1.0);
`;

const NORMAL_INJECTION = /* glsl */ `
#include <normal_fragment_maps>
#ifdef W_SCAN
if (uScanOn > 0.0) {
  vec3 scanObj = triNormal(wP, wScanN, wBlend);
#ifdef W_SCAN2
  if (wMask2 > 0.0) scanObj = normalize(mix(scanObj, triNormalOf(uScan2NormalMap, vWearPos / uScan2Tile, wScanN, wBlend), wMask2));
#endif
  vec3 scanNormal = normalize(normalMatrix * scanObj);
  normal = normalize(mix(normal, scanNormal, uScanOn));
}
#endif
#ifdef W_WAVE
if (uWave > 0.0) {
  vec3 wq = vWearPos * uWaveScale;
  float we = 0.3;
  vec3 wg = vec3(wFbm2(wq + vec3(we, 0.0, 0.0)) - wFbm2(wq - vec3(we, 0.0, 0.0)), wFbm2(wq + vec3(0.0, we, 0.0)) - wFbm2(wq - vec3(0.0, we, 0.0)), wFbm2(wq + vec3(0.0, 0.0, we)) - wFbm2(wq - vec3(0.0, 0.0, we))) * (uWaveScale / (2.0 * we));
  wg -= dot(wg, wScanN) * wScanN;
  normal = normalize(normal - normalMatrix * wg * uWave);
}
#endif
normal = wearPerturb(-vViewPosition, normal, vec2(dFdx(wearHeight), dFdy(wearHeight)) * 10.0, faceDirection);
`;

/** Shader features a material needs (the shipped look compiles only these: the full shader takes seconds to compile on a GPU). */
export function wearFeatures(scan: ScanSettings, wear: WearSettings): Set<string> {
  const on: [string, boolean][] = [
    ["SCAN", scan.scan !== ""],
    ["STAIN", scan.scan !== "" && scan.stain < 1],
    ["SCAN2", scan.scan2 !== "" && scan.amount2 > 0],
    ["CORNER", scan.corner > 0],
    ["EDGE", scan.edge > 0],
    ["LOW", scan.low > 0],
    ["VIG", scan.vig > 0],
    ["HALO", scan.halo > 0],
    ["ZONES", scan.zones > 0],
    ["RIM", scan.rim > 0],
    ["LINES", scan.lines > 0],
    ["CURV", scan.curv > 0],
    ["WAVE", scan.wave > 0],
    ["BRUSH", wear.brushAmount > 0 || wear.brushBump > 0],
    ["SCRATCH", wear.scratchAmount > 0],
    ["GRIME", wear.grimeAmount > 0],
    ["PATINA", wear.patinaAmount > 0],
    ["TINT", wear.tintVariation > 0],
    ["GRAIN", wear.grain > 0],
  ];
  return new Set(on.filter(([, enabled]) => enabled).map(([name]) => name));
}
const ALL_FEATURES = ["SCAN", "STAIN", "SCAN2", "CORNER", "EDGE", "LOW", "VIG", "HALO", "ZONES", "RIM", "LINES", "CURV", "WAVE", "BRUSH", "SCRATCH", "GRIME", "PATINA", "TINT", "GRAIN"];

/**
 * Adds the shader to a material (once); later changes go through `updateWear` and `updateScan`. `faceSize` is the box face size in mm for the edge wear.
 * `features` limits the shader to the effects the material will use (default: all, for the lab where every value can change).
 */
export function installWear(material: MeshStandardMaterial, settings: WearSettings = CLEAN, faceSize?: [number, number], features?: Set<string>): void {
  if (material.userData.wear) return;
  const list = features ? ALL_FEATURES.filter((f) => features.has(f)) : ALL_FEATURES;
  material.defines = { ...material.defines, ...Object.fromEntries(list.map((f) => [`W_${f}`, ""])) };
  const uniforms = uniformsFor(settings);
  if (faceSize) (uniforms.uFaceSize!.value as Vector2).set(faceSize[0], faceSize[1]);
  material.userData.wear = uniforms;
  material.customProgramCacheKey = () => `wear-25:${list.join(",")}`;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", VERTEX_DECLARATIONS).replace("#include <begin_vertex>", "#include <begin_vertex>\nvWearPos = transformed;\nvWearN = objectNormal;\nvWearUv = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", FRAGMENT_DECLARATIONS)
      .replace("#include <color_fragment>", COLOR_INJECTION)
      .replace("#include <roughnessmap_fragment>", ROUGHNESS_INJECTION)
      .replace("#include <normal_fragment_maps>", NORMAL_INJECTION);
  };
  material.needsUpdate = true;
}

/** Writes new wear settings into the live uniforms of an installed material. */
export function updateWear(material: MeshStandardMaterial, s: WearSettings): void {
  const u = material.userData.wear as WearUniforms | undefined;
  if (!u) return;
  (u.uBrushStretch!.value as Vector3).copy(uniformsFor(s).uBrushStretch!.value as Vector3);
  u.uBrushScale!.value = s.brushScale;
  u.uBrushAmount!.value = s.brushAmount;
  u.uBrushBump!.value = s.brushBump;
  u.uScratchAmount!.value = s.scratchAmount;
  u.uScratchScale!.value = s.scratchScale;
  u.uScratchBump!.value = s.scratchBump;
  u.uGrimeAmount!.value = s.grimeAmount;
  u.uGrimeScale!.value = s.grimeScale;
  (u.uGrimeColor!.value as Color).set(s.grimeColor);
  u.uTint!.value = s.tintVariation;
  u.uGrain!.value = s.grain;
  u.uPatinaAmount!.value = s.patinaAmount;
  u.uPatinaScale!.value = s.patinaScale;
  (u.uPatinaColor!.value as Color).set(s.patinaColor);
}

/** Writes the scan and edge settings; `textures` is the loaded scan named in `s.scan` (null when none). */
export function updateScan(material: MeshStandardMaterial, s: ScanSettings, textures: ScanTextures | null, textures2: ScanTextures | null = null): void {
  const u = material.userData.wear as WearUniforms | undefined;
  if (!u) return;
  u.uScanOn!.value = textures ? 1 : 0;
  u.uStain!.value = s.stain;
  u.uScanColor!.value = textures?.color ?? blank;
  u.uScanNormalMap!.value = textures?.normal ?? blank;
  u.uScanRough!.value = textures?.roughness ?? blank;
  u.uScanTile!.value = s.tile;
  (u.uScanTint!.value as Color).set(s.tint);
  u.uScanNormalK!.value = s.normal;
  u.uScanRoughMul!.value = s.roughMul;
  u.uScanRoughAdd!.value = s.roughAdd;
  u.uScanWood!.value = s.wood ? 1 : 0;
  u.uEdge!.value = s.edge;
  u.uEdgeWidth!.value = s.edgeWidth;
  (u.uEdgeColor!.value as Color).set(s.edgeColor);
  u.uWave!.value = s.wave;
  u.uWaveScale!.value = 1 / Math.max(s.waveSize, 1);
  u.uLow!.value = s.low;
  u.uLowZ!.value = s.lowZ;
  u.uLowH!.value = s.lowH;
  u.uScan2On!.value = textures2 && s.amount2 > 0 ? 1 : 0;
  u.uScan2Color!.value = textures2?.color ?? blank;
  u.uScan2NormalMap!.value = textures2?.normal ?? blank;
  u.uScan2Rough!.value = textures2?.roughness ?? blank;
  u.uScan2Tile!.value = s.tile2;
  (u.uScan2Tint!.value as Color).set(s.tint2);
  u.uScan2Amount!.value = s.amount2;
  u.uScan2Bottom!.value = s.bottom2;
  u.uScan2Streak!.value = s.streak2;
  u.uScan2StreakLen!.value = s.streakLen2;
  u.uScan2Spots!.value = s.spots2;
  u.uVig!.value = s.vig;
  (u.uScanOff!.value as Vector2).set(s.offX, s.offY);
  u.uZones!.value = s.zones;
  u.uRim!.value = s.rim;
  u.uLines!.value = s.lines;
  u.uCurv!.value = s.curv;
  u.uHalo!.value = s.halo;
  (u.uVigC!.value as Vector2).set(s.vigX, s.vigY);
  (u.uVigH!.value as Vector2).set(s.vigHX, s.vigHY);
  u.uCorner!.value = s.corner;
  u.uCornerW!.value = s.cornerWidth;
}
