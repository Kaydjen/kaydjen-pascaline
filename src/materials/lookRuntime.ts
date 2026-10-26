import { EquirectangularReflectionMapping, NoColorSpace, PMREMGenerator, RepeatWrapping, SRGBColorSpace, TextureLoader, type MeshStandardMaterial, type Texture, type WebGLRenderer, type WebGLRenderTarget } from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { bakeLidFootprint } from "./footprint";
import { createAoTarget, installAo } from "../scene/ao";
import { setWallRelief } from "../parts/boxCase";
import type { StageDebug } from "../scene/stage";
import { setMaterialHook, type MaterialName } from "./factory";
import { resolveMaterial, scanIds, type ResolvedMaterial } from "./lookApply";
import type { Look, MaterialLook } from "./looks";
import { CLEAN, installWear, updateScan, updateWear, wearFeatures, type ScanTextures } from "./wear";

/** Baked scans and the studio HDRI live in public/ (made by `npm run bake` from the git-ignored lab-assets/). */
const SCAN_URL = (id: string, kind: string): string => `/scans/${id}/${kind}.webp`;
const HDRI_URL = "/hdri/studio.hdr";
/** Width of the grime line around the parts that stand on the lid (mm). */
const GRIME_BLUR_MM = 0.7;

/** Dev: re-applies one material of the look with changed values (through the same `apply` as the start-up). */
export type MaterialTuner = (name: MaterialName, patch: MaterialLook) => Promise<{ missing: string[] }>;

export interface LookRuntime {
  /** Loads the scans and the studio light, then applies the light, the occlusion and the scans; resolves when the look is complete. */
  attach(debug: StageDebug): Promise<void>;
  /** For `createStage`: the stage compiles its shaders for the occlusion composer (null: the look has no occlusion). */
  readonly compileTarget: ((renderer: WebGLRenderer) => WebGLRenderTarget) | undefined;
}

/**
 * Installs a look: every material the factory creates gets the wear shader with its settings at once (the scans follow after `attach`).
 * Call before the machine is built; the wall unevenness is part of the build.
 */
export function installLook(look: Look): LookRuntime {
  interface Entry {
    material: MeshStandardMaterial;
    resolved: ResolvedMaterial;
    features: Set<string>;
    /** Colour, metalness and roughness before the look touched them (a variant that sets none of them restores these). */
    plain: { color: number; metalness: number; roughness: number };
  }
  const registry = new Map<MaterialName, Entry[]>();
  const scans: Record<string, ScanTextures> = {};
  setWallRelief(look.geometry ? { uneven: look.geometry.uneven ?? 0, dents: look.geometry.dents ?? 0, seed: look.geometry.seed ?? 7 } : null);

  const apply = (material: MeshStandardMaterial, resolved: ResolvedMaterial): void => {
    updateScan(material, resolved.scan, scans[resolved.scan.scan] ?? null, scans[resolved.scan.scan2] ?? null);
    if (resolved.color) material.color.set(resolved.color);
    if (resolved.metalness !== undefined) material.metalness = resolved.metalness;
    if (resolved.roughness !== undefined && !material.roughnessMap) material.roughness = resolved.roughness;
    updateWear(material, resolved.wear);
  };

  setMaterialHook((material, name, faceSize) => {
    const resolved = resolveMaterial(look, name);
    if (!resolved) return; // not in the look: the plain material stays (no wear shader)
    const features = wearFeatures(resolved.scan, resolved.wear);
    installWear(material, CLEAN, faceSize, features);
    const plain = { color: material.color.getHex(), metalness: material.metalness, roughness: material.roughness };
    registry.set(name, [...(registry.get(name) ?? []), { material, resolved, features, plain }]);
    apply(material, resolved);
  });

  const loader = new TextureLoader();
  const loadMap = async (id: string, kind: "color" | "normal" | "roughness"): Promise<Texture> => {
    const texture = await loader.loadAsync(SCAN_URL(id, kind));
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.anisotropy = 8;
    texture.colorSpace = kind === "color" ? SRGBColorSpace : NoColorSpace;
    return texture;
  };

  // the files start loading at once, while the machine is still being built
  const loadScan = async (id: string): Promise<void> => {
    const [color, normal, roughness] = await Promise.all([loadMap(id, "color"), loadMap(id, "normal"), loadMap(id, "roughness")]);
    scans[id] = { color, normal, roughness };
  };
  const hdrLoading = new HDRLoader().loadAsync(HDRI_URL);
  const scansLoading = Promise.all(scanIds(look).map(loadScan));
  hdrLoading.catch(() => undefined);
  scansLoading.catch(() => undefined);

  // dev: the patch is always relative to the shipped look, so variants on one sheet do not leak into each other ({} restores the look)
  const tuneMaterial: MaterialTuner = async (name, patch) => {
    const base = look.materials[name] ?? {};
    const merged: MaterialLook = { ...base, ...patch, scale: { ...base.scale, ...patch.scale }, set: { ...base.set, ...patch.set }, scan: { ...base.scan, ...patch.scan } };
    const resolved = resolveMaterial({ ...look, materials: { [name]: merged } }, name);
    if (!resolved) return { missing: [] };
    for (const id of [resolved.scan.scan, resolved.scan.scan2]) if (id && !scans[id]) await loadScan(id);
    const needed = wearFeatures(resolved.scan, resolved.wear);
    const missing = new Set<string>();
    for (const entry of registry.get(name) ?? []) {
      for (const f of needed) if (!entry.features.has(f)) missing.add(f);
      entry.resolved = resolved;
      entry.material.color.setHex(entry.plain.color);
      entry.material.metalness = entry.plain.metalness;
      entry.material.roughness = entry.plain.roughness;
      apply(entry.material, resolved);
    }
    // a feature the material was built without has no shader code: the value does nothing until it is in the look in looks.ts and the page is reloaded
    return { missing: [...missing] };
  };

  let aoTarget: WebGLRenderTarget | null = null;
  return {
    compileTarget: look.ao?.on ? (renderer) => (aoTarget = createAoTarget(renderer)) : undefined,
    async attach(debug) {
      const { renderer, scene, lights } = debug;
      const l = look.light;
      renderer.toneMappingExposure = l.exposure;
      scene.environmentIntensity = l.envIntensity;
      lights.key.intensity = l.key;
      lights.fill.intensity = l.fill;
      lights.rim.intensity = l.rim;

      try {
        const hdr = await hdrLoading;
        await scansLoading;
        hdr.mapping = EquirectangularReflectionMapping;
        const pmrem = new PMREMGenerator(renderer);
        scene.environment = pmrem.fromEquirectangular(hdr).texture;
        hdr.dispose();
        pmrem.dispose();
      } catch {
        return; // the files did not arrive: the machine stays with the plain studio light
      }
      for (const entries of registry.values()) for (const { material, resolved } of entries) apply(material, resolved);

      bakeLidFootprint(renderer, scene, GRIME_BLUR_MM);
      const ao = look.ao?.on && aoTarget ? installAo(debug, look.ao, aoTarget) : null;
      if (import.meta.env.DEV) void import("../dev/tune").then((m) => m.mountTune(debug, ao, tuneMaterial));
    },
  };
}
