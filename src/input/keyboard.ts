import type { Stage } from "../scene/stage";
import type { PrototypeSession } from "../scene/prototype";
import type { TeardownPlayer } from "../scene/teardownPlayer";
import { NO_LID_S } from "../scene/teardown";
import type { TimeControl } from "./controls";
import type { Ghost } from "./ghost";
import type { StylusController } from "./stylusController";

export interface KeyboardContext {
  stage: Stage;
  session: PrototypeSession;
  stylus: StylusController;
  player: TeardownPlayer;
  time: TimeControl;
  ghost: Ghost;
}

/**
 * Keyboard shortcuts (A8; non-input only, nothing is drawn on screen): Space pause/resume, 1/2/3 speeds, Esc stops the demo,
 * arrows step through Closed / Lid off / Apart, M add or subtract, R reading view, L level view, D demo.
 */
export function mountKeyboard(ctx: KeyboardContext): () => void {
  const onKey = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case " ":
        if (target && target.tagName === "BUTTON") return; // a focused button keeps its own Space
        ctx.time.togglePause();
        break;
      case "1":
        ctx.time.setSpeed(1);
        break;
      case "2":
        ctx.time.setSpeed(0.25);
        break;
      case "3":
        ctx.time.setSpeed(0.05);
        break;
      case "Escape":
        ctx.ghost.cancel();
        break;
      case "ArrowRight":
      case "ArrowLeft": {
        const steps = [0, NO_LID_S, 1];
        const now = steps.reduce((best, s, i) => (Math.abs(s - ctx.player.target) < Math.abs(steps[best]! - ctx.player.target) ? i : best), 0);
        ctx.player.play(steps[Math.min(Math.max(now + (event.key === "ArrowRight" ? 1 : -1), 0), 2)]!);
        break;
      }
      case "m":
      case "M":
        ctx.session.setVisibleRow(ctx.session.visibleRow === "ascending" ? "descending" : "ascending");
        break;
      case "r":
      case "R":
        ctx.stage.rig?.setPreset("reading");
        break;
      case "l":
      case "L":
        ctx.stage.rig?.setPreset("level", { level: ctx.stylus.hovered?.level ?? 0 });
        break;
      case "d":
      case "D":
        ctx.ghost.toggle("demo");
        break;
      default:
        return;
    }
    event.preventDefault();
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
