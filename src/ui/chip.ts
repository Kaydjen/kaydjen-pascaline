import type { Hit } from "../input/hits";
import type { StylusController } from "../input/stylusController";
import type { PrototypeSession } from "../scene/prototype";
import { el } from "./dom";

/** English readings of the engraved French labels (A12), units level first. */
export const LABEL_TRANSLATIONS = ["units", "tens", "hundreds", "thousands", "tens of thousands", "hundreds of thousands"] as const;

const DELAY = 0.35;

export interface Chip {
  update(dt: number, hover: Hit | null, client: { x: number; y: number }): void;
}

/** Hover chip for the engraved label strip: an ink-note with the English reading, after a short rest of the pointer. */
export function mountChip(session: PrototypeSession, stylus: StylusController): Chip {
  const node = el("div", { class: "chip", attrs: { role: "tooltip", "aria-hidden": "true" } });
  document.body.append(node);
  let resting = 0;
  let shown = false;
  return {
    update(dt, hover, client) {
      const onLabel = hover !== null && hover.name === "label" && stylus.state !== "inserted";
      if (!onLabel) {
        resting = 0;
        if (shown) {
          node.classList.remove("visible");
          shown = false;
        }
        return;
      }
      resting += dt;
      if (resting < DELAY) return;
      const assembly = session.assembly;
      const params = assembly.mechanismParams();
      const local = assembly.machine.worldToLocal(hover.point.clone());
      const level = Math.min(Math.max(Math.round((params.levelCount - 1) / 2 - local.x / params.levelPitch), 0), params.levelCount - 1);
      node.textContent = LABEL_TRANSLATIONS[level] ?? "";
      node.style.transform = `translate(${Math.round(client.x + 16)}px, ${Math.round(client.y - 38)}px)`;
      if (!shown) {
        node.classList.add("visible");
        shown = true;
      }
    },
  };
}
