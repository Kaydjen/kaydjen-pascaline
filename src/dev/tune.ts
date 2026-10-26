import type { Material, Mesh } from "three";
import { bakeLidFootprint } from "../materials/footprint";
import { lidFootprint } from "../materials/wear";
import type { MaterialTuner } from "../materials/lookRuntime";
import type { AoHandle } from "../scene/ao";
import type { StageDebug } from "../scene/stage";

export interface GrimeTune {
  /** Re-bake the footprint with this blur (mm). */
  sigma?: number;
  core?: [number, number];
  skirt?: [number, number];
  skirtWeight?: number;
  noise?: number;
  /** Strength of the grime colour (the `halo` setting of the lid scan). */
  halo?: number;
}

export interface AoTune {
  on?: boolean;
  intensity?: number;
  radius?: number;
  direct?: number;
  from?: number;
  to?: number;
}

/** Dev only: lets scripts/spots.mjs switch the look variants at run time (no reload), so that they can be compared on one sheet. */
export function mountTune(debug: StageDebug, ao: AoHandle | null, material: MaterialTuner): void {
  const wearUniforms = (): Record<string, { value: number }>[] => {
    const list: Record<string, { value: number }>[] = [];
    debug.scene.traverse((o) => {
      const material = (o as Mesh).material as Material | undefined;
      const u = material?.userData?.wear as Record<string, { value: number }> | undefined;
      if (u) list.push(u);
    });
    return list;
  };
  const tune = {
    /** `material("steel-ring", { scan: { tint: "#3a3228" } })`: values relative to the shipped look, `{}` restores it. Resolves with the shader features the material lacks. */
    material,
    /** The compiled shader programs (count and who uses them), for scripts/programs.mjs. */
    programs(): { name: string; key: string; used: number }[] {
      return (debug.renderer.info.programs ?? []).map((p) => ({ name: p.name, key: p.cacheKey, used: p.usedTimes }));
    },
    grime(o: GrimeTune): void {
      if (o.sigma !== undefined) bakeLidFootprint(debug.renderer, debug.scene, o.sigma);
      if (o.core) lidFootprint.core.value.set(...o.core);
      if (o.skirt) lidFootprint.skirt.value.set(...o.skirt);
      if (o.skirtWeight !== undefined) lidFootprint.skirtWeight.value = o.skirtWeight;
      if (o.noise !== undefined) lidFootprint.noise.value = o.noise;
      if (o.halo !== undefined) for (const u of wearUniforms()) if (u.uHalo) u.uHalo.value = o.halo;
    },
    ao(o: AoTune): void {
      if (!ao) return;
      if (o.on !== undefined) ao.gtao.enabled = o.on;
      if (o.intensity !== undefined) ao.gtao.blendIntensity = o.intensity;
      if (o.radius !== undefined) ao.gtao.updateGtaoMaterial({ radius: o.radius });
      if (o.direct !== undefined) ao.blend.uniforms.directStrength!.value = o.direct;
      if (o.from !== undefined) ao.blend.uniforms.fade!.value.x = o.from;
      if (o.to !== undefined) ao.blend.uniforms.fade!.value.y = o.to;
    },
  };
  (window as unknown as { __tune: unknown }).__tune = tune;
}
