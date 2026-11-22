import type { Object3D, Vector3 } from "three";
import type { Hit } from "../input/hits";
import type { StylusController } from "../input/stylusController";
import type { PrototypeSession } from "../scene/prototype";
import { el } from "./dom";

/** English readings of the engraved French labels (A12), units level first. */
export const LABEL_TRANSLATIONS = ["units", "tens", "hundreds", "thousands", "tens of thousands", "hundreds of thousands"] as const;

const DELAY = 0.35;
const NAMES_KEY = "pascaline.names.v2"; // v2: the first version defaulted to on and remembered it; the new default is off

/** The Names switch: captions over the part under the pointer. Off until the visitor turns it on (remembered). */
export class NamesSwitch {
  private value = false;

  constructor() {
    try {
      this.value = localStorage.getItem(NAMES_KEY) === "1";
    } catch {
      // storage unavailable: the default stays
    }
  }

  get on(): boolean {
    return this.value;
  }

  set on(on: boolean) {
    this.value = on;
    try {
      localStorage.setItem(NAMES_KEY, on ? "1" : "0");
    } catch {
      // nothing to remember
    }
  }
}

export interface Chip {
  /** `see` looks for the drawn surface under the pointer; it is asked only when the mouse target names no single part. */
  update(dt: number, hover: Hit | null, client: { x: number; y: number }, see: () => { object: Object3D; point: Vector3 } | null): void;
}

/** Mouse targets that enclose many parts: the caption names the drawn part under the pointer instead. */
const ENCLOSING = new Set(["frame", "box"]);
/** The drawn part is looked up once the pointer has rested this long (s)... */
const LOOK_REST = 0.12;
/** ...and again this often (s) while it keeps resting: the mechanism moves under it. */
const LOOK_EVERY = 0.5;

/** Name of the part a drawn mesh belongs to: its nearest ancestor (or itself) that has a caption, e.g. "sautoir:3", "frame". */
export function partOf(object: Object3D): string | null {
  for (let o: Object3D | null = object; o; o = o.parent) if (o.name && captionOf(o.name, 0) !== null) return o.name;
  return null;
}

/** Plain name of the part a mouse target stands for, or null when it has none worth saying. `level` is the level under the pointer. */
export function captionOf(name: string, level: number): string | null {
  const place = LABEL_TRANSLATIONS[level] ?? "";
  switch (name.split(":")[0]) {
    case "label":
      return place;
    case "wheel":
      return `Wheel, ${place}`;
    case "gear":
      return `Gear 45, ${place}`;
    case "accumulator":
      return `Gear train, ${place}`;
    case "output":
    case "drum":
      return `Digit drum, ${place}`;
    case "pawl":
      return `Backstop pawl, ${place}`;
    case "carryBody":
      return `Carry lever, ${place}`;
    case "sautoir":
      return `Sautoir, ${place}`;
    case "lid":
    case "lidAssembly":
      return "Lid";
    case "frame":
      return "Frame";
    case "box":
      return "Box";
    case "strip":
    case "slider":
    case "barrel":
      return "Sliding strip";
    case "pin":
      return "Lid pin";
    case "stand":
    case "stylusStand":
    case "stylus":
      return "Stylus";
    default:
      return null;
  }
}

/**
 * The caption over the pointer: a small plate with the part name (and the English reading of the engraved labels), after a short rest
 * of the pointer. Off with the Names switch, and away while the stylus is in the hand (the stylus is the pointer then).
 */
export function mountChip(session: PrototypeSession, stylus: StylusController, names: NamesSwitch): Chip {
  const node = el("div", { class: "chip", attrs: { role: "tooltip", "aria-hidden": "true" } });
  document.body.append(node);
  let resting = 0;
  let shown = false;
  let text = "";
  let looked: { x: number; y: number } | null = null;
  let lookAge = 0;
  let still = 0;
  let seenCaption: string | null = null;
  /** Level under a world point (the units level is 0). */
  const levelAt = (point: Vector3): number => {
    const assembly = session.assembly;
    const params = assembly.mechanismParams();
    const local = assembly.machine.worldToLocal(point.clone());
    return Math.min(Math.max(Math.round((params.levelCount - 1) / 2 - local.x / params.levelPitch), 0), params.levelCount - 1);
  };
  const hide = (): void => {
    resting = 0;
    if (shown) {
      node.classList.remove("visible");
      shown = false;
    }
  };
  return {
    update(dt, hover, client, see) {
      const idle = names.on && stylus.state !== "hand" && stylus.state !== "inserted" && !stylus.dragging;
      let wanted: string | null = null;
      if (idle && hover && !ENCLOSING.has(hover.name)) {
        const index = hover.name.includes(":") ? Number(hover.name.split(":")[1]) : NaN;
        wanted = captionOf(hover.name, hover.name.startsWith("wheel:") || hover.name.startsWith("gear:") ? index : levelAt(hover.point));
        looked = null;
        seenCaption = null;
      } else if (idle) {
        // the lookup is a full raycast of the drawn machine (a few ms): only when the pointer rests, and again now and then as the mechanism moves under it
        const moved = !looked || looked.x !== client.x || looked.y !== client.y;
        if (moved) {
          looked = { x: client.x, y: client.y };
          still = 0;
          lookAge = Infinity;
        } else still += dt;
        lookAge += dt;
        if (still >= LOOK_REST && lookAge >= LOOK_EVERY) {
          lookAge = 0;
          const seen = see();
          const part = seen ? partOf(seen.object) : null;
          const index = part ? Number(part.split(":")[1]) : NaN;
          seenCaption = part ? captionOf(part, Number.isInteger(index) ? index : levelAt(seen!.point)) : null;
        }
        wanted = seenCaption;
      } else {
        looked = null;
        seenCaption = null;
      }
      if (!wanted) return hide();
      if (wanted !== text) {
        text = wanted;
        node.textContent = text;
        if (shown) resting = DELAY; // moving from one part to the next: no new wait
      }
      resting += dt;
      if (resting < DELAY && !shown) return;
      const half = node.offsetWidth / 2 + 10;
      const x = Math.min(Math.max(client.x, half), window.innerWidth - half);
      node.style.transform = `translate(calc(${Math.round(x)}px - 50%), calc(${Math.round(client.y - 22)}px - 100%))`;
      if (!shown) {
        node.classList.add("visible");
        shown = true;
      }
    },
  };
}
