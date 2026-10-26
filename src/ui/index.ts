import type { Ghost } from "../input/ghost";
import type { TimeControl } from "../input/controls";
import type { PointerRouter } from "../input/pointerRouter";
import type { StylusController } from "../input/stylusController";
import type { PrototypeSession } from "../scene/prototype";
import type { TeardownPlayer } from "../scene/teardownPlayer";
import { mountChip } from "./chip";
import { mountDock } from "./dock";
import { mountHints } from "./hints";
import { mountLive } from "./live";

export interface UiContext {
  session: PrototypeSession;
  player: TeardownPlayer;
  time: TimeControl;
  stylus: StylusController;
  router: PointerRouter;
  ghost: Ghost;
}

export interface Ui {
  update(dt: number): void;
}

/** The whole interface: dock (view steps, add/subtract, demo, reset, time), hover chip, hint line, live region. */
export function mountUi(ctx: UiContext): Ui {
  const dock = mountDock({
    session: ctx.session,
    player: ctx.player,
    time: ctx.time,
    stylus: ctx.stylus,
    demo: () => ctx.ghost.toggle("demo"),
    zero: () => ctx.ghost.toggle("zero"),
  });
  const chip = mountChip(ctx.session, ctx.stylus);
  const hints = mountHints(ctx.session, ctx.stylus, ctx.player);
  const live = mountLive(ctx.session);
  return {
    update(dt) {
      dock.update();
      dock.setRunning(ctx.ghost.running);
      chip.update(dt, ctx.router.hovered, ctx.router.client);
      hints.update(dt);
      live.update(dt);
    },
  };
}
