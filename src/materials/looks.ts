import type { MaterialName } from "./factory";
import type { ScanSettings, WearLevel, WearSettings } from "./wear";

/**
 * The look of the machine as data: light, per-material scans and wear, wall unevenness, occlusion. `FINAL_LOOK` is what the app ships;
 * the dev hook `src/dev/tune.ts` and scripts/spots.mjs switch variants of it at run time (the app is the lab, no separate copy of the pipeline).
 */
export interface LightSettings {
  env: "strips" | "room" | "softbox" | "brown1" | "brown2" | "ferndale";
  exposure: number;
  envIntensity: number;
  key: number;
  fill: number;
  rim: number;
}

export interface MaterialLook {
  color?: string;
  metalness?: number;
  roughness?: number;
  wear?: WearLevel;
  /** Multipliers applied to the preset wear amounts. */
  scale?: Partial<Record<"brushAmount" | "brushBump" | "scratchAmount" | "scratchBump" | "grimeAmount" | "grain" | "tintVariation" | "patinaAmount", number>>;
  set?: Partial<WearSettings>;
  scan?: Partial<ScanSettings>;
}

export interface Look {
  name: string;
  note: string;
  light: LightSettings;
  materials: Partial<Record<MaterialName, MaterialLook>>;
  geometry?: { uneven?: number; dents?: number; seed?: number };
  ao?: { on: boolean; radius: number; intensity: number; distanceExponent: number; thickness: number; directStrength?: number; fadeFrom?: number; fadeTo?: number };
}

type Materials = Look["materials"];

/** Hairline scratches of the lid and the crown plates, three times the preset (user, 2026-10-26: scratch layer rewritten as random short segments). */
const HAIRLINES = { scratchAmount: 3, scratchBump: 3 } as const;

/** Brass parts from one scan, ring from another, frame darker. */
function machineBase(opts: { lid: string; ring: string; small: string; frame: string; lidTint?: string; ringTint?: string; wearLevel?: WearLevel }): Materials {
  const wear = opts.wearLevel ?? "light";
  return {
    "brass-strip": { metalness: 1, wear, scan: { scan: opts.small, tile: 34, tint: "#d8cba8", normal: 1, zones: 1.0 } },
    "brass-lid": { metalness: 1, wear, scale: HAIRLINES, scan: { scan: opts.lid, tile: 70, tint: opts.lidTint ?? "#ffffff", normal: 1.1 } },
    "brass-brushed": { metalness: 1, wear, scale: { grimeAmount: 1.5 }, scan: { scan: opts.small, tile: 34, tint: "#c2ae80", normal: 1 } },
    // hub disc and its nut: the brass of the spokes, but more rubbed and a little greyer (user, photos)
    "brass-spoke": { metalness: 1, wear, scan: { scan: opts.frame, tile: 40, tint: "#b9a577", normal: 1 } }, // the spokes and the boss: close to the stop lever, a little brighter (user)
    // the closed plate under the spokes: as light as the lid but matte, so that the polished spokes above it stand out without the plate going dark (user)
    "brass-plate": { metalness: 1, wear, scan: { scan: opts.small, tile: 34, tint: "#d8cba8", normal: 1, roughAdd: 0.3 } },
    // the stop levers and their plates: mid-bright and worn (user: bright was too new), so that they stand out from the lid and the ring without looking fresh
    "brass-lever": { metalness: 1, wear, scale: { grimeAmount: 2, scratchAmount: 2, scratchBump: 2 }, set: { grimeScale: 0.35 }, scan: { scan: opts.small, tile: 34, tint: "#c2ae80", normal: 1, roughAdd: -0.04 } },
    "brass-hub": { metalness: 1, wear, scale: HAIRLINES, scan: { scan: opts.frame, tile: 40, tint: "#a8986c", normal: 1, roughAdd: -0.1 } }, // the numeral plate: browner and a little more polished
    "steel-ring": { metalness: 1, wear, scale: { ...HAIRLINES, grimeAmount: 3 }, set: { grimeScale: 0.35 }, scan: { scan: opts.ring, tile: 46, tint: opts.ringTint ?? "#9a94a6", normal: 1 } },
    "brass-frame": { metalness: 1, wear, scan: { scan: opts.frame, tile: 40, tint: "#9a8a68", normal: 1 } },
    "brass-forged": { metalness: 1, wear, scan: { scan: opts.frame, tile: 40, tint: "#b8a577", normal: 1 } },
    "brass-dark": { metalness: 1, wear, scan: { scan: "Metal008", tile: 90, tint: "#8a7a5c", normal: 1 } },
    steel: { metalness: 1, wear, scan: { scan: "Metal048C", tile: 30, tint: "#a8a090", normal: 1 } },
    "bronze-trim": { metalness: 1, wear, scan: { scan: "Metal047B", tile: 40, tint: "#9a8a78", normal: 1.1 } },
  };
}

/** Every brass part gets rubbed bright edges where its surface curves sharply (bevels and rims). */
function machine(opts: Parameters<typeof machineBase>[0]): Materials {
  const m = machineBase(opts);
  for (const key of Object.keys(m) as MaterialName[]) {
    const e = m[key];
    if (e?.scan) e.scan = { ...e.scan, curv: key === "brass-lid" ? 0 : 1.0 };
  }
  return m;
}

const LIGHT: LightSettings = { env: "brown1", exposure: 1.0, envIntensity: 1.3, key: 3.0, fill: 0.2, rim: 0.4 };
const BASE = { lid: "Metal007", ring: "Metal048C", small: "Metal007", frame: "Metal042B" } as const;

/** The chosen wall: dark pitted bronze, warm and matte; `extra` adds the second scan and other options, `wear` the procedural wear. */
function wall(extra: Partial<ScanSettings> = {}, wear: Partial<WearSettings> = {}): Materials {
  return {
    "wood-dark": {
      color: "#ffffff",
      metalness: 0.9,
      wear: "light",
      set: wear,
      scan: { scan: "Metal047B", tile: 90, tint: "#a8806a", normal: 1.2, roughAdd: 0.12, edge: 0.35, edgeWidth: 0.7, edgeColor: "#7a6a44", wave: 1.4, waveSize: 55, ...extra },
    },
    "wood-raw": { wear: "light" },
    "paper-aged": { wear: "light" },
  };
}

/** The board under the box (the lit top face is the visible part). */
function plinth(scan: string, tint: string, extra: Partial<ScanSettings> = {}, wood = true): Materials {
  return { "wood-plinth": { color: "#ffffff", wear: "light", scan: { scan, tile: 110, tint, wood, normal: 1.1, edge: 0.4, edgeWidth: 0.8, edgeColor: "#8a6a4a", ...extra } } };
}
const PLINTH_DEFAULT = plinth("Wood027", "#6a4c38", { edge: 0 });

/** The chosen wall (variant 6 = soft rubbed edges, unevenness 0.7, slightly darker). */
const FINAL_WALL = { edge: 0.6, edgeWidth: 1.3, edgeColor: "#a88c4e", tint: "#92705c" } as const;
/** The previous, lighter wall, kept in the set "saved" in case a lighter one is needed. */
const NO_SOOT = {} as const;

/** The lid is a single plate: scan shift, dirt around every part, polished zones of use (hand, stylus, strip) and the light rubbed rim. */
function lid(offX: number, offY: number, extra: Partial<ScanSettings> = {}, level: WearLevel = "light"): Look["materials"] {
  return {
    ...machine(BASE),
    ...PLINTH_DEFAULT,
    ...wall({ ...FINAL_WALL }, NO_SOOT),
    "brass-lid": { metalness: 1, wear: level, scan: { scan: "Metal007", tile: 70, tint: "#fff4d8", normal: 1.1, roughMul: 0.7, wave: 0.5, waveSize: 80, offX, offY, ...extra } },
  };
}
const LID_GEOMETRY = { uneven: 0.7, dents: 3, seed: 7 } as const;
/** Occlusion belongs to the ambient light: on bright, directly lit metal it is faded to a quarter (choice E). */
const AO = { on: true, radius: 2.5, intensity: 1.9, distanceExponent: 2, thickness: 3, directStrength: 0.25, fadeFrom: 0.15, fadeTo: 0.8 } as const;
const LID_USE = { halo: 1.2, vig: 0.4, zones: 1.0, rim: 0.3, lines: 1.0 } as const;

/** FINAL lid: 30 % of the scan blotches, more dirt in the crevices, polished zones at the front edge and the barrel mouths. */
const FINAL_LID = { ...LID_USE, stain: 0.3, halo: 1.6 } as const;
/** The plank: pale aged oak (your base 4), darker, more worn, uneven. */
function plank(tint: string, extra: Partial<ScanSettings> = {}, wear: WearLevel = "medium", scan = "Wood060"): Look["materials"] {
  // the dirt along the bottom is brown, never green: the green-blue patina colour made the plank glow
  return { ...lid(60, -50, { ...LID_USE }), "wood-plinth": { color: "#ffffff", wear, set: { patinaColor: "#2a2016", grimeColor: "#2a2016" }, scan: { scan, tile: 110, tint, wood: true, normal: 1.4, edge: 0, wave: 1.6, waveSize: 40, low: 0.5, lowH: 6, lowZ: -34, ...extra } } };
}

const BASE_LOOKS: Look[] = [
  { name: "FINAL plank (base 3: oak, darker, heavy wear, brown dirt)", note: "chosen", light: LIGHT, materials: { ...plank("#7a6c60", { roughAdd: 0.15 }, "heavy"), ...lid(60, -50, { ...FINAL_LID }), "wood-plinth": plank("#7a6c60", { roughAdd: 0.15 }, "heavy")["wood-plinth"]! }, geometry: LID_GEOMETRY, ao: AO },
];


/** The look the main app ships with: the chosen plank, bronze walls and polished lid together. */
export const FINAL_LOOK: Look = BASE_LOOKS[0]!;
