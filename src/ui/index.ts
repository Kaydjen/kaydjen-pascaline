import type { Ghost } from "../input/ghost";
import type { TimeControl } from "../input/controls";
import type { PointerRouter } from "../input/pointerRouter";
import type { StylusController } from "../input/stylusController";
import type { PrototypeSession } from "../scene/prototype";
import type { TeardownPlayer } from "../scene/teardownPlayer";
import { mountChip } from "./chip";
import { mountDock } from "./dock";
import { mountNames } from "./names";
import { mountLive } from "./live";
import { ASSEMBLED_S } from "../scene/teardown";

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

/** The whole interface: dock (view steps and names, add/subtract, 999 + 1, reset, time), hover chip, part captions, live region. */
export function mountUi(ctx: UiContext): Ui {
  const names = mountNames();
  const dock = mountDock({
    session: ctx.session,
    player: ctx.player,
    time: ctx.time,
    stylus: ctx.stylus,
    demo: () => ctx.ghost.toggle("demo"),
    zero: () => ctx.ghost.toggle("zero"),
    names: { get: () => names.on, set: (on) => (names.on = on) },
    busy: () => ctx.ghost.running !== null || !ctx.session.mechanism.settled(),
  });
  const chip = mountChip(ctx.session, ctx.stylus);
  const live = mountLive(ctx.session);
  return {
    update(dt) {
      dock.update();
      dock.setRunning(ctx.ghost.running);
      chip.update(dt, ctx.router.hovered, ctx.router.client);
      names.update(ctx.router.hovered, ctx.player.target >= ASSEMBLED_S, ctx.session.assembly.mechanismParams().levelCount);
      live.update(dt);
    },
  };
}
