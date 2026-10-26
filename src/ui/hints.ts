import type { StylusController } from "../input/stylusController";
import type { PrototypeSession } from "../scene/prototype";
import type { TeardownPlayer } from "../scene/teardownPlayer";
import { ASSEMBLED_S } from "../scene/teardown";
import { el } from "./dom";

export interface Hints {
  update(dt: number): void;
}

/**
 * One quiet line above the dock that says what the mouse does right now. It follows the state (closed / opened, add / subtract)
 * and goes away while a wheel is being dragged.
 */
export function mountHints(session: PrototypeSession, stylus: StylusController, player: TeardownPlayer): Hints {
  const line = el("p", { class: "hint", attrs: { "aria-hidden": "true" } });
  document.body.append(line);
  let t = 0;
  let shown = "";
  return {
    update(dt) {
      t += dt;
      const apart = player.target >= ASSEMBLED_S;
      const subtract = session.visibleRow === "descending";
      const verb = subtract ? "takes that much away" : "adds";
      const text = `${subtract ? "Subtract: each" : "Each"} ${apart ? "gear" : "wheel"} you drag clockwise ${verb}  ·  drag the background to look around`;
      if (text !== shown) {
        line.textContent = text;
        shown = text;
      }
      line.classList.toggle("visible", t > 1 && stylus.state !== "inserted");
    },
  };
}
