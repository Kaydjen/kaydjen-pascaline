import type { Hit } from "../input/hits";
import { el } from "./dom";
import { LABEL_TRANSLATIONS } from "./chip";

export interface Names {
  on: boolean;
  update(hover: Hit | null, apart: boolean, levelCount: number): void;
}

const KEY = "pascaline.names";

/** Plain names of the parts that take part in the mouse picking. */
function nameOf(hit: Hit, levelCount: number): string | null {
  const [kind, index] = hit.name.split(":");
  const level = Number(index);
  const place = LABEL_TRANSLATIONS[level] ?? "";
  switch (kind) {
    case "wheel":
      return `Input wheel, ${place}`;
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
    case "label":
      return "Label strip";
    default:
      void levelCount;
      return null;
  }
}

/** Part captions: bottom left above the dock, shown only while the machine is apart and the switch is on (default on). */
export function mountNames(): Names {
  const node = el("p", { class: "caption", attrs: { "aria-hidden": "true" } });
  document.body.append(node);
  let on = true;
  try {
    on = localStorage.getItem(KEY) !== "0";
  } catch {
    // storage unavailable: the default stays
  }
  let shown = "";
  const names: Names = {
    get on() {
      return on;
    },
    set on(value: boolean) {
      on = value;
      try {
        localStorage.setItem(KEY, value ? "1" : "0");
      } catch {
        // nothing to remember
      }
    },
    update(hover, apart, levelCount) {
      const text = on && apart && hover ? (nameOf(hover, levelCount) ?? "") : "";
      if (text && text !== shown) node.textContent = text;
      if (text) shown = text;
      node.classList.toggle("visible", text !== "");
    },
  };
  return names;
}
