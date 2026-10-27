import type { TimeControl, Speed } from "../input/controls";
import type { StylusController } from "../input/stylusController";
import type { PrototypeSession } from "../scene/prototype";
import type { TeardownPlayer } from "../scene/teardownPlayer";
import { ASSEMBLED_S, NO_LID_S } from "../scene/teardown";
import { el, icon } from "./dom";

export interface DockContext {
  session: PrototypeSession;
  player: TeardownPlayer;
  time: TimeControl;
  stylus: StylusController;
  demo: () => void;
  zero: () => void;
  /** The part names switch. */
  names: { get(): boolean; set(on: boolean): void };
  /** Something moves on its own (the demo, a reset, the mechanism still running). */
  busy: () => boolean;
}

export interface Dock {
  update(): void;
  /** The demo or the zeroing is running: the word turns accent while it does. */
  setRunning(which: "demo" | "zero" | null): void;
}

const PAUSE = "M8 5v14M16 5v14";
const PLAY = "M7 5l12 7-12 7z";

/** The three resting states of the teardown, with the words the user sees. */
export const VIEW_STEPS: readonly { label: string; s: number }[] = [
  { label: "Closed", s: 0 },
  { label: "Lid off", s: NO_LID_S },
  { label: "Apart", s: 1 },
];

/** A row of exclusive text buttons; the current one is brass. */
function segmented(label: string, items: { text: string; onClick: () => void }[]): { node: HTMLElement; select(index: number): void } {
  const buttons = items.map((item) => {
    const b = el("button", { class: "text", text: item.text, attrs: { type: "button", "aria-pressed": "false" } });
    b.addEventListener("click", item.onClick);
    return b;
  });
  const node = el("div", { class: "segmented", attrs: { role: "group", "aria-label": label }, children: buttons });
  return {
    node,
    select(index) {
      buttons.forEach((b, i) => {
        b.classList.toggle("on", i === index);
        b.setAttribute("aria-pressed", String(i === index));
      });
    },
  };
}

/**
 * Bottom bar. Left: how far the machine is taken apart (Closed / Lid off / Apart) and the part names. Right: Add or Subtract,
 * the demo and reset. Centre: pause and speed, only while they are needed. Nothing else is on screen.
 */
export function mountDock(ctx: DockContext): Dock {
  const { session, player, time } = ctx;

  const view = segmented(
    "View",
    VIEW_STEPS.map((step) => ({ text: step.label, onClick: () => player.play(step.s) })),
  );
  const mode = segmented("Operation", [
    { text: "Add", onClick: () => session.setVisibleRow("ascending") },
    { text: "Subtract", onClick: () => session.setVisibleRow("descending") },
  ]);

  const pause = el("button", { class: "glyph", attrs: { type: "button" } });
  const syncPause = (): void => {
    pause.replaceChildren(icon(time.paused ? PLAY : PAUSE, time.paused ? "Play" : "Pause"));
    pause.setAttribute("aria-label", time.paused ? "Resume" : "Pause");
    pause.setAttribute("aria-pressed", String(time.paused));
  };
  pause.addEventListener("click", () => time.togglePause());

  const speeds: [Speed, string][] = [[1, "1×"], [0.25, "¼×"], [0.05, "1/20×"]];
  const speedButtons = speeds.map(([speed, label]) => {
    const b = el("button", { class: "text", text: label, attrs: { type: "button", "aria-label": `Speed ${label}` } });
    b.addEventListener("click", () => time.setSpeed(speed));
    return [speed, b] as const;
  });
  const syncSpeeds = (): void => {
    for (const [speed, b] of speedButtons) {
      const on = !time.paused && time.speed === speed;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    syncPause();
  };
  time.onChange(syncSpeeds);
  syncSpeeds();

  const button = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = el("button", { class: "text boxed", text: label, attrs: { type: "button" } });
    b.addEventListener("click", onClick);
    return b;
  };
  const demo = button("Demo", ctx.demo);
  const zero = button("Reset", ctx.zero);
  const names = button("Names", () => {
    ctx.names.set(!ctx.names.get());
    names.classList.toggle("on", ctx.names.get());
    names.setAttribute("aria-pressed", String(ctx.names.get()));
  });
  names.classList.toggle("on", ctx.names.get());
  names.setAttribute("aria-pressed", String(ctx.names.get()));
  const timeBox = el("div", { class: "time", children: [pause, ...speedButtons.map(([, b]) => b)] });

  const bar = el("nav", {
    class: "dock",
    attrs: { "aria-label": "Controls" },
    children: [
      el("div", { class: "dock-left", children: [view.node, names] }),
      el("div", { class: "dock-centre", children: [timeBox] }),
      el("div", { class: "dock-right", children: [mode.node, demo, zero] }),
    ],
  });
  document.body.append(bar);

  let wasOpen = false;
  return {
    update() {
      const goal = player.target;
      let nearest = 0;
      VIEW_STEPS.forEach((step, i) => {
        if (Math.abs(step.s - goal) < Math.abs(VIEW_STEPS[nearest]!.s - goal)) nearest = i;
      });
      view.select(nearest);
      mode.select(session.visibleRow === "ascending" ? 0 : 1);
      // pause and the speeds are there only while something moves, when time is not running normally, or when the machine is apart
      // back in the closed view the time controls are reset and go away: nothing runs slowly or stays paused behind hidden buttons
      if (goal >= ASSEMBLED_S) wasOpen = true;
      else if (wasOpen && !player.active) {
        wasOpen = false;
        if (time.paused || time.speed !== 1) time.setSpeed(1);
      }
      const show = goal >= ASSEMBLED_S || ctx.busy() || player.active || ctx.time.paused || ctx.time.speed !== 1;
      timeBox.classList.toggle("shown", show);
    },
    setRunning(which) {
      demo.classList.toggle("accent", which === "demo");
      zero.classList.toggle("accent", which === "zero");
    },
  };
}
