import type { PrototypeSession } from "../scene/prototype";
import { el } from "./dom";

export interface Live {
  update(dt: number): void;
}

/** Visually hidden polite live region that announces the number on the drums once the machine rests (accessibility). */
export function mountLive(session: PrototypeSession): Live {
  const region = el("div", { class: "sr-only", attrs: { "aria-live": "polite", role: "status" } });
  document.body.append(region);
  let last = "";
  let quiet = 0;
  return {
    update(dt) {
      const m = session.mechanism;
      const text = Array.from({ length: m.levels.length }, (_, i) => String(m.digit(m.levels.length - 1 - i))).join("");
      if (text !== last) {
        last = text;
        quiet = 0;
        return;
      }
      quiet += dt;
      if (quiet > 0.5 && region.textContent !== `Value ${text}`) region.textContent = `Value ${text}`;
    },
  };
}
