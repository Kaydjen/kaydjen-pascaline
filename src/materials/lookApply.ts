import type { MaterialName } from "./factory";
import type { Look } from "./looks";
import { CLEAN, metalPreset, NO_SCAN, type ScanSettings, type WearLevel, type WearSettings } from "./wear";

export const METALS: MaterialName[] = ["brass-strip", "bronze-trim", "brass-brushed", "brass-hub", "brass-lever", "brass-spoke", "brass-plate", "brass-lid", "brass-dark", "brass-frame", "brass-gear", "brass-forged", "steel-ring", "steel"];
export const WOODS: MaterialName[] = ["wood-dark", "wood-plinth", "wood-raw"];

/** Wear strengths of a material kind at a level (metals full, woods gentler, papers dirtier). */
export function wearFor(name: MaterialName, level: WearLevel): WearSettings {
  const base = { ...metalPreset(level), grimeScale: 0.22 };
  if (METALS.includes(name)) return base;
  if (WOODS.includes(name)) return { ...CLEAN, brushAmount: base.brushAmount * 0.5, brushBump: base.brushBump * 0.4, scratchAmount: base.scratchAmount * 0.5, scratchBump: base.scratchBump * 0.4, grimeAmount: base.grimeAmount * 0.7, grimeScale: 0.35, grain: base.grain * 0.4, tintVariation: base.tintVariation * 1.4 };
  return { ...CLEAN, grimeAmount: base.grimeAmount * 1.1, grimeScale: 0.2, tintVariation: base.tintVariation * 1.5 };
}

export interface ResolvedMaterial {
  color?: string;
  metalness?: number;
  roughness?: number;
  scan: ScanSettings;
  wear: WearSettings;
}

/** What a look says about one material (null: the plain material stays). */
export function resolveMaterial(look: Look, name: MaterialName): ResolvedMaterial | null {
  const m = look.materials[name];
  if (!m) return null;
  let wear = CLEAN;
  if (m.wear) {
    const w = wearFor(name, m.wear);
    for (const [key, factor] of Object.entries(m.scale ?? {})) (w as unknown as Record<string, number>)[key]! *= factor;
    wear = { ...w, ...m.set };
  }
  return { color: m.color, metalness: m.metalness, roughness: m.roughness, scan: { ...NO_SCAN, ...m.scan }, wear };
}

/** Names of the scans a look needs. */
export function scanIds(look: Look): string[] {
  const ids = new Set<string>();
  for (const m of Object.values(look.materials)) for (const id of [m?.scan?.scan, m?.scan?.scan2]) if (id) ids.add(id);
  return [...ids];
}
