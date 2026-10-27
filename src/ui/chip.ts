import type { Hit } from "../input/hits";
import type { StylusController } from "../input/stylusController";
import type { PrototypeSession } from "../scene/prototype";
import { el } from "./dom";

/** English readings of the engraved French labels (A12), units level first. */
export const LABEL_TRANSLATIONS = ["units", "tens", "hundreds", "thousands", "tens of thousands", "hundreds of thousands"] as const;

const DELAY = 0.35;
const NAMES_KEY = "pascaline.names";

/** The Names switch: captions over the part under the pointer. On unless the visitor turned it off (remembered). */
export class NamesSwitch {
  private value = true;

  constructor() {
    try {
      this.value = localStorage.getItem(NAMES_KEY) !== "0";
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
  update(dt: number, hover: Hit | null, client: { x: number; y: number }): void;
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
    case "lid":
      return "Lid";
    case "frame":
      return "Frame";
    case "box":
      return "Box";
    case "strip":
    case "barrel":
      return "Sliding strip";
    case "pin":
      return "Lid pin";
    case "stand":
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
  const hide = (): void => {
    resting = 0;
    if (shown) {
      node.classList.remove("visible");
      shown = false;
    }
  };
  return {
    update(dt, hover, client) {
      const idle = hover !== null && names.on && stylus.state !== "hand" && stylus.state !== "inserted" && !stylus.dragging;
      let wanted: string | null = null;
      if (idle) {
        const assembly = session.assembly;
        const params = assembly.mechanismParams();
        const index = hover.name.includes(":") ? Number(hover.name.split(":")[1]) : NaN;
        const local = assembly.machine.worldToLocal(hover.point.clone());
        const levelAtPoint = Math.min(Math.max(Math.round((params.levelCount - 1) / 2 - local.x / params.levelPitch), 0), params.levelCount - 1);
        wanted = captionOf(hover.name, hover.name.startsWith("wheel:") || hover.name.startsWith("gear:") ? index : levelAtPoint);
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
