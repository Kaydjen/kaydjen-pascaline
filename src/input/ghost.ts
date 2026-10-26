import { type PerspectiveCamera, Vector2, Vector3 } from "three";
import type { Assembly } from "../scene/assembly";
import type { Mechanism } from "../sim/mechanism";
import { STEP_DEG } from "../sim/params";
import {
  dialFor,
  dialKind,
  gapTip,
  gearGapAngle,
  nearestGearGap,
  nearestWheelGap,
  WHEEL_TIP_RADIUS,
  wheelGapAngle,
  type Dial,
} from "./dialing";
import type { StylusController } from "./stylusController";
import { DIM } from "../parts/dimensions";

export type GhostTask = "demo" | "zero";

export interface GhostHost {
  assembly(): Assembly;
  mechanism(): Mechanism;
  teardown(): number;
}

/** Something the script waits for: a number of seconds, or a condition that must become true. */
type Wait = number | (() => boolean);

/** How fast the ghost drags a wheel, degrees per second (the driver limit is 432: 12 steps/s). */
const SWEEP_DEG_PER_SEC = 280;
const MOVE_SECONDS = 0.9;

const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * Ghost stylus (A7): runs the demo "999999 + 1" and the reset to 000000 with the same stylus, the same states and the same
 * target rule as the mouse. It does not move the model by itself: it only drives the controller's pointer (the projected
 * positions of the gaps) and presses and releases, so everything the user sees comes from the one stylus path.
 */
export class Ghost {
  running: GhostTask | null = null;
  private script: Generator<Wait, void, void> | null = null;
  private waiting: Wait = 0;
  private waited = 0;
  private readonly pointer = new Vector2();

  constructor(
    private readonly host: GhostHost,
    private readonly stylus: StylusController,
    private readonly camera: PerspectiveCamera,
  ) {}

  toggle(task: GhostTask): void {
    if (this.running === task) this.cancel();
    else this.start(task);
  }

  start(task: GhostTask): void {
    this.cancel();
    this.running = task;
    this.script = this.run(task);
    this.waiting = 0;
    this.waited = 0;
  }

  /** Any user click or key cancels: the stylus stays in the hand for the mouse. */
  cancel(): void {
    if (!this.running) return;
    this.running = null;
    this.script = null;
    this.stylus.release();
  }

  update(dt: number): void {
    if (!this.script) return;
    this.waited += dt;
    const w = this.waiting;
    if (typeof w === "number" ? this.waited < w : !w()) return;
    this.waited = 0;
    const next = this.script.next();
    if (next.done) {
      this.running = null;
      this.script = null;
      return;
    }
    this.waiting = next.value;
  }

  // --- script ---------------------------------------------------------------------------------

  private *run(task: GhostTask): Generator<Wait, void, void> {
    yield* this.settle();
    const mech = (): Mechanism => this.host.mechanism();
    const n = mech().levels.length;
    if (task === "demo") {
      // dial nine on every wheel (what is missing to 9), lowest first, then add one: the cascade runs through all levels
      for (let level = 0; level < n; level++) yield* this.dial(level, 9 - mech().digit(level));
      yield* this.dial(0, 1);
      yield* this.settle();
    } else {
      // reset: the complement per wheel, lowest first (the carries add one to the next wheel on their own)
      for (let level = 0; level < n; level++) yield* this.dial(level, (10 - mech().digit(level)) % 10);
    }
    yield* this.settle();
  }

  private *settle(): Generator<Wait, void, void> {
    yield 0.05;
    yield () => this.host.mechanism().settled();
  }

  /** NDC of a machine-space point. */
  private project(point: Vector3): Vector2 {
    const assembly = this.host.assembly();
    const world = assembly.machine.localToWorld(point.clone());
    world.project(this.camera);
    return new Vector2(world.x, world.y);
  }

  private currentDial(level: number): Dial {
    const assembly = this.host.assembly();
    const params = assembly.mechanismParams();
    const s = this.host.teardown();
    return dialFor(dialKind(s), level, params.levelCount, params.levelPitch, s);
  }

  /** The pointer glides to `target` (NDC) in MOVE_SECONDS. */
  private *glide(target: () => Vector2): Generator<Wait, void, void> {
    const from = this.pointer.clone();
    let t = 0;
    while (t < MOVE_SECONDS) {
      yield 1 / 60;
      t += 1 / 60;
      this.pointer.lerpVectors(from, target(), smooth(Math.min(t / MOVE_SECONDS, 1)));
      this.stylus.setPointer(this.pointer);
    }
    this.pointer.copy(target());
    this.stylus.setPointer(this.pointer);
  }

  /** Turns `steps` (0..9) on one level: gets the stylus, hovers over a gap, inserts and drags to the stop or by that many steps. */
  private *dial(level: number, steps: number): Generator<Wait, void, void> {
    if (steps <= 0) return;
    const assembly = this.host.assembly();
    const mech = this.host.mechanism();
    if (this.stylus.state === "slot" || this.stylus.state === "returning") {
      this.stylus.pickUp();
      this.pointer.copy(this.project(assembly.stylus.position));
      this.stylus.setPointer(this.pointer);
      yield 0.2;
    }
    const dial = this.currentDial(level);
    const u = mech.levels[level]!.u;
    // the gap to start from: at the numeral that is `steps` short of the stop (wheel), or the gap nearest the top (gear 45)
    const wanted = dial.kind === "wheel" ? 180 - steps * STEP_DEG : 0;
    const gap = dial.kind === "wheel" ? nearestWheelGap(wanted, u) : nearestGearGap(wanted, u);
    const startAngle = dial.kind === "wheel" ? wheelGapAngle(gap, u) : gearGapAngle(gap, u);
    const radius = dial.kind === "wheel" ? WHEEL_TIP_RADIUS : DIM.pinCircleRadius;
    const pointAt = (angle: number): Vector3 => {
      const a = (angle * Math.PI) / 180;
      const c = this.currentDial(level).centre;
      return dial.kind === "wheel" ? new Vector3(c.x + radius * Math.sin(a), c.y + radius * Math.cos(a), c.z) : new Vector3(c.x + radius * Math.sin(a), c.y, c.z + radius * Math.cos(a));
    };
    yield* this.glide(() => this.project(pointAt(startAngle)));
    // wait for the spring to arrive and the gap to be recognised under the pointer
    const hover = (): Vector3 => gapTip(this.currentDial(level), gap, mech.levels[level]!.u, false);
    yield () => {
      const over = this.stylus.hovered;
      return over !== null && over.level === level && over.gap === gap && this.stylus.pose().tip.distanceTo(hover()) < 2;
    };
    this.stylus.press(null);
    // sweep the pointer clockwise about the dial axis; the sim's driver limit does the rest
    const total = steps * STEP_DEG;
    let swept = 0;
    while (swept < total) {
      yield 1 / 60;
      swept = Math.min(total, swept + SWEEP_DEG_PER_SEC / 60);
      this.pointer.copy(this.project(pointAt(startAngle + swept)));
      this.stylus.setPointer(this.pointer);
    }
    const target = u + steps;
    yield () => mech.levels[level]!.u >= target - 0.02 && this.stylus.dragging;
    yield 0.15;
    this.stylus.release();
    yield* this.settle();
  }
}
