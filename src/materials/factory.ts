import { type CanvasTexture, DoubleSide, MeshPhysicalMaterial, MeshStandardMaterial, type Texture } from "three";
import { loadFonts } from "./fonts";
import { lidTextures, noteTexture, woodTexture, type LidTextures } from "./textures";

export type MaterialName =
  | "brass-brushed"
  | "brass-hub"
  | "brass-lever"
  | "brass-spoke"
  | "brass-plate"
  | "brass-strip"
  | "brass-lid"
  | "brass-dark"
  | "brass-frame"
  | "brass-forged"
  | "steel-ring"
  | "steel"
  | "wood-dark"
  | "wood-plinth"
  | "bronze-trim"
  | "wood-raw"
  | "paper-aged"
  | "paper-note";

interface Spec {
  color: number;
  metalness: number;
  roughness: number;
  doubleSide?: boolean;
}

/** Colour, metalness and roughness of every named material (start values, tuned by eye against the photos). */
const SPECS: Record<MaterialName, Spec> = {
  "brass-brushed": { color: 0xb89a55, metalness: 0.8, roughness: 0.4 },
  "brass-hub": { color: 0xb89a55, metalness: 0.8, roughness: 0.4 },
  "brass-lever": { color: 0xb89a55, metalness: 0.8, roughness: 0.4 },
  "brass-spoke": { color: 0xb89a55, metalness: 0.8, roughness: 0.4 },
  "brass-plate": { color: 0xb89a55, metalness: 0.8, roughness: 0.4 },
  "brass-strip": { color: 0xb89a55, metalness: 0.8, roughness: 0.4 },
  "brass-lid": { color: 0xb89a55, metalness: 0.8, roughness: 0.4 },
  "brass-dark": { color: 0x6b5a33, metalness: 0.7, roughness: 0.55 },
  "brass-frame": { color: 0x76673c, metalness: 0.8, roughness: 0.58 },
  "brass-forged": { color: 0x8a7240, metalness: 0.85, roughness: 0.5 },
  "steel-ring": { color: 0xb3a58c, metalness: 0.75, roughness: 0.38 },
  steel: { color: 0x8f8d88, metalness: 1, roughness: 0.3 },
  "wood-dark": { color: 0x6c5b37, metalness: 0.72, roughness: 0.52 },
  "wood-plinth": { color: 0x6a4a30, metalness: 0, roughness: 0.65 },
  "bronze-trim": { color: 0x6a5238, metalness: 0.85, roughness: 0.5 },
  "wood-raw": { color: 0xa8855a, metalness: 0, roughness: 0.7 },
  "paper-aged": { color: 0xcdc2aa, metalness: 0, roughness: 0.8, doubleSide: true },
  "paper-note": { color: 0xffffff, metalness: 0, roughness: 0.85, doubleSide: true },
};

interface TextureSet {
  lid: LidTextures | null;
  wood: CanvasTexture | null;
  note: CanvasTexture | null;
}

const textures: TextureSet = { lid: null, wood: null, note: null };
const cache = new Map<string, MeshStandardMaterial>();

export interface TextureStats {
  ms: number;
  /** Estimated GPU memory of the generated textures (RGBA8 with mipmaps), megabytes. */
  megabytes: number;
}

export let textureStats: TextureStats = { ms: 0, megabytes: 0 };

function create(name: MaterialName): MeshStandardMaterial {
  const spec = SPECS[name];
  let material: MeshStandardMaterial;
  if (name === "brass-lid" && textures.lid) {
    const lid = new MeshPhysicalMaterial({ map: textures.lid.map, roughnessMap: textures.lid.roughnessMap, normalMap: textures.lid.normalMap, metalness: spec.metalness, roughness: 1 });
    lid.anisotropy = 0.5;
    lid.normalScale.set(0.45, 0.45);
    material = lid;
  } else if (name === "paper-note" && textures.note) {
    material = new MeshStandardMaterial({ map: textures.note, metalness: 0, roughness: spec.roughness });
  } else if ((name === "wood-dark" || name === "wood-plinth" || name === "wood-raw") && textures.wood) {
    material = new MeshStandardMaterial({ color: spec.color, map: textures.wood, metalness: spec.metalness, roughness: spec.roughness });
  } else {
    material = new MeshStandardMaterial({ color: spec.color, metalness: spec.metalness, roughness: spec.roughness });
  }
  if (spec.doubleSide) material.side = DoubleSide;
  material.name = name;
  return material;
}

/** Called once for every material the factory creates (the lab installs its wear shader here). */
let hook: ((material: MeshStandardMaterial, name: MaterialName, faceSize?: [number, number]) => void) | null = null;

export function setMaterialHook(next: typeof hook): void {
  hook = next;
}

export function getMaterial(name: MaterialName): MeshStandardMaterial {
  let material = cache.get(name);
  if (!material) {
    material = create(name);
    hook?.(material, name);
    cache.set(name, material);
  }
  return material;
}

/** Wood material whose grain repeats once per 100 mm of surface (box faces use 0..1 UVs): `lengthU` x `lengthV` is the face size in mm. */
export function getWoodMaterial(name: "wood-dark" | "wood-plinth" | "wood-raw", lengthU: number, lengthV: number): MeshStandardMaterial {
  const key = `${name}:${lengthU.toFixed(0)}:${lengthV.toFixed(0)}`;
  let material = cache.get(key);
  if (!material) {
    material = create(name);
    hook?.(material, name, [lengthU, lengthV]);
    if (textures.wood && material.map) {
      const map: Texture = textures.wood.clone();
      map.repeat.set(lengthU / 100, lengthV / 100);
      map.needsUpdate = true;
      material.map = map;
    }
    cache.set(key, material);
  }
  return material;
}

const megabytes = (t: Texture | null | undefined): number => {
  const image = t?.image as { width: number; height: number } | undefined;
  return image ? (image.width * image.height * 4 * 1.33) / 1048576 : 0;
};

/** Loads the bundled fonts, then generates the shared textures with fixed seeds; materials are rebuilt on the next `getMaterial`. */
export async function buildTextures(seed: number): Promise<void> {
  await loadFonts();
  const t0 = performance.now();
  textures.lid = lidTextures(seed);
  textures.wood = woodTexture(seed + 1);
  textures.note = noteTexture(seed + 2);
  cache.clear();
  const all = [textures.lid?.map, textures.lid?.roughnessMap, textures.lid?.normalMap, textures.wood, textures.note];
  textureStats = { ms: performance.now() - t0, megabytes: all.reduce((sum, t) => sum + megabytes(t), 0) };
}
