import type { TimeControl, Speed } from "../input/controls";
import type { StylusController } from "../input/stylusController";
import type { PrototypeSession } from "../scene/prototype";
import type { TeardownPlayer } from "../scene/teardownPlayer";
import { NO_LID_S } from "../scene/teardown";
import { el, icon } from "./dom";

export interface DockContext {
  session: PrototypeSession;
  player: TeardownPlayer;
  time: TimeControl;
  stylus: StylusController;
  demo: () => void;
  zero: () => void;
}

export interface Dock {
  update(): void;
  /** The demo or the zeroing is running: the word turns accent while it does. */
  setRunning(which: "demo" | "zero" | null): void;
}

const PAUSE = "M8 5v14M16 5v14";
const PLAY = "M7 5l12 7-12 7z";

/** The three resting states of the teardown, with the words the user sees. */
export const VIEW_STEPS: readonly { label: string; s: number; title: string }[] = [
  { label: "Closed", s: 0, title: "the machine as it stands" },
  { label: "Lid off", s: NO_LID_S, title: "lift the lid and look at the mechanism" },
  { label: "Apart", s: 1, title: "lift the mechanism out of the box" },
];

/** A row of exclusive text buttons; the current one is brass. */
function segmented(label: string, items: { text: string; title: string; onClick: () => void }[]): { node: HTMLElement; select(index: number): void } {
  const buttons = items.map((item) => {
    const b = el("button", { class: "text", text: item.text, attrs: { type: "button", title: item.title, "aria-pressed": "false" } });
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
 * Bottom bar. Left: how far the machine is taken apart (Closed / Lid off / Apart). Centre: the one switch that matters for
 * calculating, Add or Subtract. Right: demo, reset, pause and speed. Nothing else is on screen.
 */
export function mountDock(ctx: DockContext): Dock {
  const { session, player, time } = ctx;

  const view = segmented(
    "View",
    VIEW_STEPS.map((step) => ({ text: step.label, title: step.title, onClick: () => player.play(step.s) })),
  );
  const mode = segmented("Operation", [
    { text: "Add", title: "the drums show the number", onClick: () => session.setVisibleRow("ascending") },
    { text: "Subtract", title: "the drums show the complement: turning a wheel takes that much away", onClick: () => session.setVisibleRow("descending") },
  ]);

  const pause = el("button", { class: "glyph", attrs: { type: "button", title: "pause (space)" } });
  const syncPause = (): void => {
    pause.replaceChildren(icon(time.paused ? PLAY : PAUSE, time.paused ? "Play" : "Pause"));
    pause.setAttribute("aria-label", time.paused ? "Resume" : "Pause");
    pause.setAttribute("aria-pressed", String(time.paused));
  };
  pause.addEventListener("click", () => time.togglePause());

  const speeds: [Speed, string][] = [[1, "1×"], [0.25, "¼×"], [0.05, "1/20×"]];
  const speedButtons = speeds.map(([speed, label]) => {
    const b = el("button", { class: "text", text: label, attrs: { type: "button", "aria-label": `Speed ${label}`, title: `slow motion ${label}` } });
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

  const button = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = el("button", { class: "text", text: label, attrs: { type: "button", title } });
    b.addEventListener("click", onClick);
    return b;
  };
  const demo = button("Demo", "999999 + 1: watch the carry run through every wheel (d)", ctx.demo);
  const zero = button("Reset", "turn every wheel back to 0", ctx.zero);

  const bar = el("nav", {
    class: "dock",
    attrs: { "aria-label": "Controls" },
    children: [
      el("div", { class: "dock-left", children: [view.node] }),
      el("div", { class: "dock-centre", children: [mode.node] }),
      el("div", { class: "dock-right", children: [demo, zero, el("span", { class: "sep" }), pause, ...speedButtons.map(([, b]) => b)] }),
    ],
  });
  document.body.append(bar);

  return {
    update() {
      const goal = player.target;
      let nearest = 0;
      VIEW_STEPS.forEach((step, i) => {
        if (Math.abs(step.s - goal) < Math.abs(VIEW_STEPS[nearest]!.s - goal)) nearest = i;
      });
      view.select(nearest);
      mode.select(session.visibleRow === "ascending" ? 0 : 1);
    },
    setRunning(which) {
      demo.classList.toggle("accent", which === "demo");
      zero.classList.toggle("accent", which === "zero");
    },
  };
}
