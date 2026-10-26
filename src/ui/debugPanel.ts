import { COVER_NAMES } from "../scene/assembly";
import type { PrototypeSession } from "../scene/prototype";

/**
 * Developer panel for the M1 prototype (dev builds only). It stands in for the stylus:
 * the slider holds the lower wheel the way a stylus would, letting go releases it.
 */
export function mountDebugPanel(session: PrototypeSession): void {
  const panel = document.createElement("div");
  panel.id = "debug";
  panel.innerHTML = `
    <div class="row" data-speeds></div>
    <div class="row"><span>units wheel</span><input type="range" min="0" max="9" step="0.01" value="0" data-hold /></div>
    <div class="row" data-actions></div>
    <pre data-readout></pre>
    <pre data-log></pre>`;
  document.body.append(panel);

  const button = (parent: Element, label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", onClick);
    parent.append(b);
    return b;
  };

  const speeds = panel.querySelector("[data-speeds]")!;
  const speedButtons: [string, number, HTMLButtonElement][] = [];
  for (const [label, scale] of [["pause", 0], ["0.05x", 0.05], ["0.25x", 0.25], ["1x", 1]] as const) {
    const b = button(speeds, label, () => {
      session.clock.timeScale = scale;
      speedButtons.forEach(([, s, el]) => el.classList.toggle("on", s === scale));
    });
    speedButtons.push([label, scale, b]);
  }
  speedButtons[3]![2].classList.add("on");

  const slider = panel.querySelector<HTMLInputElement>("[data-hold]")!;
  let anchor: number | null = null;
  // the browser may move the thumb to the pointer on press; only movement after the first input counts
  let origin: number | null = null;
  // "+1 digit" turns the wheel at hand speed, not at the driver speed limit
  const HAND_STEPS_PER_SEC = 5;
  let autoTarget: number | null = null;
  let autoPosition = 0;
  slider.addEventListener("pointerdown", () => {
    anchor = Math.round(session.mechanism.levels[0]!.u);
    origin = null;
    autoTarget = null;
  });
  slider.addEventListener("input", () => {
    if (anchor === null) return;
    origin ??= Number(slider.value);
    session.mechanism.setDrive(0, anchor + Number(slider.value) - origin);
  });
  const letGo = (): void => {
    if (anchor === null) return;
    anchor = null;
    session.mechanism.setDrive(0, null);
    slider.value = "0";
  };
  slider.addEventListener("pointerup", letGo);
  slider.addEventListener("pointercancel", letGo);
  slider.addEventListener("blur", letGo);

  const actions = panel.querySelector("[data-actions]")!;
  button(actions, "+1 digit", () => {
    const u = session.mechanism.levels[0]!.u;
    autoTarget = Math.round(u) + 1;
    autoPosition = u;
  });
  const n = session.levelCount;
  const rowButton = button(actions, "row: ascending", () => {
    session.setVisibleRow(session.visibleRow === "ascending" ? "descending" : "ascending");
    rowButton.textContent = `row: ${session.visibleRow}`;
  });
  const covers = document.createElement("div");
  covers.className = "row";
  actions.after(covers);
  for (const name of COVER_NAMES) {
    const label = (): string => `${name.replace("wall:", "")}: ${session.cover(name) ? "on" : "off"}`;
    const b = button(covers, label(), () => {
      session.setCover(name, !session.cover(name));
      b.textContent = label();
    });
  }
  const apart = document.createElement("input");
  apart.type = "range";
  apart.min = "0";
  apart.max = "1";
  apart.step = "0.005";
  apart.value = String(session.teardown);
  apart.title = "teardown view";
  apart.addEventListener("input", () => session.setTeardown(Number(apart.value)));
  covers.append(apart);
  button(actions, "zero", () => session.reset());
  button(actions, "units 9", () => session.reset([9, ...Array<number>(n - 1).fill(0)]));
  button(actions, "all 9", () => session.reset(Array<number>(n).fill(9)));
  button(actions, "units+next 9", () => session.reset([9, 9, ...Array<number>(Math.max(0, n - 2)).fill(0)].slice(0, n)));

  const readout = panel.querySelector<HTMLElement>("[data-readout]")!;
  const log = panel.querySelector<HTMLElement>("[data-log]")!;
  let lastTick = performance.now();
  const tick = (now: number): void => {
    requestAnimationFrame(tick);
    const dt = Math.min((now - lastTick) / 1000, 0.1);
    lastTick = now;
    const m = session.mechanism;
    if (autoTarget !== null) {
      autoPosition = Math.min(autoTarget, autoPosition + HAND_STEPS_PER_SEC * dt * session.clock.timeScale);
      m.setDrive(0, autoPosition);
      if (autoPosition >= autoTarget && Math.abs(m.levels[0]!.u - autoTarget) < 1e-6) {
        m.setDrive(0, null);
        autoTarget = null;
      }
    }
    const lines = [`t ${m.time.toFixed(2)} s   value ${String(m.value()).padStart(n, "0")}`];
    m.levels.forEach((l, i) => {
      const c = m.carryOn(i);
      lines.push(
        `L${i} u ${l.u.toFixed(3).padStart(7)}  digit ${m.digit(i)}  ` + (c ? `body ${c.phase.padEnd(7)} lift ${c.lift.toFixed(1).padStart(5)}` : "body -"),
      );
    });
    readout.textContent = lines.join("\n");
    log.textContent = session.recentEvents
      .slice(-10)
      .map((e) => `${e.t.toFixed(3)} ${e.type} L${e.level}${"digit" in e ? " " + e.digit : ""}`)
      .join("\n");
  };
  requestAnimationFrame(tick);
}
