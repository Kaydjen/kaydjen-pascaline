import {
  DEFAULT_PARAMS,
  kickEngageDeg,
  liftMaxDeg,
  liftStartSteps,
  RELEASE_STEPS,
  supportLift,
  validateParams,
  type MechanismParams,
} from "./params";

export type SimEvent =
  | { type: "carryArmed" | "carryReleased" | "carryKick" | "stopHit"; level: number; t: number }
  | { type: "digitChanged"; level: number; digit: number; t: number }
  | { type: "pawlClick"; level: number; t: number };

export type CarryPhase = "contact" | "falling" | "kicking";

export interface LevelState {
  /** Master angle in digit steps, unwrapped; everything else is derived from it. */
  u: number;
  /** Lowest position the backstop pawl still allows. Never decreases. */
  pawlFloor: number;
  /** Position a driver (stylus) pushes towards, or null when nobody holds the wheel. */
  drive: number | null;
}

export interface CarryState {
  phase: CarryPhase;
  /** Body angle above the stop bar, degrees. */
  lift: number;
  fallSpeed: number;
  kickProgress: number;
  /** Full turns of the lower wheel already answered by a release. */
  turnsSeen: number;
  /** Releases that are due but could not start yet. */
  pending: number;
}

const EPS = 1e-9;
const mod = (a: number, n: number): number => ((a % n) + n) % n;

/**
 * Kinematics of the digit wheels plus the carry bodies between them.
 * Level 0 is the units wheel; carry assembly `i - 1` sits on level i and is fed by level i - 1.
 * No rendering knowledge: poses are read from `levels` and `carries`.
 */
export class Mechanism {
  readonly params: MechanismParams;
  readonly levels: LevelState[];
  readonly carries: CarryState[];
  time = 0;
  private events: SimEvent[] = [];

  constructor(params: Partial<MechanismParams> = {}) {
    this.params = { ...DEFAULT_PARAMS, ...params };
    validateParams(this.params);
    this.levels = Array.from({ length: this.params.levelCount }, () => ({ u: 0, pawlFloor: 0, drive: null }));
    this.carries = Array.from({ length: this.params.levelCount - 1 }, () => ({
      phase: "contact" as CarryPhase,
      lift: 0,
      fallSpeed: 0,
      kickProgress: 0,
      turnsSeen: 0,
      pending: 0,
    }));
  }

  /** Digit shown by a level (nearest detent). */
  digit(level: number): number {
    return mod(this.nearestStep(this.level(level).u), 10);
  }

  /** Displayed number, units level first. */
  value(): number {
    return this.levels.reduce((sum, _, i) => sum + this.digit(i) * 10 ** i, 0);
  }

  /** Digit on the descending (9's complement) drum row of a level. */
  complementDigit(level: number): number {
    return 9 - this.digit(level);
  }

  /** Number read from the descending row, units level first: what the machine shows with the subtraction row visible. */
  complementValue(): number {
    return this.levels.reduce((sum, _, i) => sum + this.complementDigit(i) * 10 ** i, 0);
  }

  /** The carry body sitting on `level` (fed by `level - 1`), or null for the units level. */
  carryOn(level: number): CarryState | null {
    return this.carries[level - 1] ?? null;
  }

  /** True when every wheel rests on a detent and every carry body rests on its stop bar or its bars. */
  settled(): boolean {
    return (
      this.carries.every(
        (c, k) =>
          c.phase === "contact" &&
          c.pending === 0 &&
          Math.abs(c.lift - supportLift(this.params, mod(this.level(k).u, RELEASE_STEPS))) < EPS,
      ) &&
      this.levels.every((l) => Math.abs(l.u - Math.round(l.u)) < EPS)
    );
  }

  /** Hands out the events emitted since the last call. */
  takeEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Sets the position a driver pushes the wheel towards; null lets go. A target behind the wheel holds it. */
  setDrive(level: number, target: number | null): void {
    this.level(level).drive = target;
  }

  /** Places the wheels directly on digits (units first) with consistent carry state. For tests and presets. */
  presetDigits(digits: readonly number[]): void {
    if (digits.length !== this.levels.length) throw new Error("presetDigits: one digit per level expected");
    digits.forEach((d, i) => {
      if (!Number.isInteger(d) || d < 0 || d > 9) throw new Error(`presetDigits: bad digit ${d}`);
      const level = this.level(i);
      level.u = d;
      level.pawlFloor = this.pawlFloorOf(d);
      level.drive = null;
    });
    this.carries.forEach((c, k) => {
      const lower = this.level(k);
      c.phase = "contact";
      c.lift = supportLift(this.params, mod(lower.u, RELEASE_STEPS));
      c.fallSpeed = 0;
      c.kickProgress = 0;
      c.turnsSeen = this.turnsOf(lower.u);
      c.pending = 0;
    });
    this.events = [];
  }

  /** Advances the simulation by one fixed step. */
  step(dt: number): void {
    this.time += dt;
    for (let j = 0; j < this.levels.length; j++) this.moveByDriver(j, dt);
    for (let i = 1; i < this.levels.length; i++) this.updateCarry(i, dt);
  }

  // --- wheel motion -------------------------------------------------------------------------

  private level(index: number): LevelState {
    const level = this.levels[index];
    if (!level) throw new Error(`No level ${index}`);
    return level;
  }

  private nearestStep(u: number): number {
    return Math.floor(u + 1 - this.params.detentPeak + EPS);
  }

  private pawlFloorOf(u: number): number {
    const k = Math.floor(u + EPS);
    return u - k >= this.params.detentPeak ? k + this.params.detentPeak : k;
  }

  private turnsOf(u: number): number {
    return Math.floor((u + this.params.releaseMarginSteps) / RELEASE_STEPS + EPS);
  }

  private busyAbove(level: number): boolean {
    const above = this.carryOn(level + 1);
    return above !== null && above.phase !== "contact";
  }

  /** A wheel may not run into the lift zone while the body above it is still falling or kicking. */
  private clampAdvance(level: number, u: number, du: number): number {
    if (du <= 0 || !this.busyAbove(level)) return du;
    const limit = Math.floor(u / RELEASE_STEPS + EPS) * RELEASE_STEPS + liftStartSteps(this.params);
    return u < limit ? Math.min(du, limit - u) : du;
  }

  private moveByDriver(index: number, dt: number): void {
    const level = this.level(index);
    const carry = this.carryOn(index);
    if (carry && carry.phase === "kicking") return; // the kick owns this wheel until it completes
    const old = level.u;
    let du = 0;
    if (level.drive !== null) {
      if (level.drive > level.u) du = Math.min(level.drive - level.u, this.params.maxDriveRateStepsPerSec * dt);
    } else {
      const gap = this.nearestStep(level.u) - level.u;
      du = Math.sign(gap) * Math.min(Math.abs(gap), this.params.detentRateStepsPerSec * dt);
    }
    du = this.clampAdvance(index, level.u, du);
    level.u = du < 0 ? Math.max(level.u + du, level.pawlFloor) : level.u + du;
    if (level.drive === null && Math.abs(level.u - this.nearestStep(level.u)) < EPS) level.u = this.nearestStep(level.u);
    this.afterMove(index, old);
  }

  private afterMove(index: number, old: number): void {
    const level = this.level(index);
    const floor = this.pawlFloorOf(level.u);
    if (floor > level.pawlFloor + EPS) {
      if (floor - level.pawlFloor > this.params.detentPeak - EPS) this.emit({ type: "pawlClick", level: index, t: this.time });
      level.pawlFloor = floor;
    }
    const before = mod(this.nearestStep(old), 10);
    const after = mod(this.nearestStep(level.u), 10);
    if (before !== after) this.emit({ type: "digitChanged", level: index, digit: after, t: this.time });
  }

  // --- carry --------------------------------------------------------------------------------

  private updateCarry(index: number, dt: number): void {
    const carry = this.carryOn(index);
    if (!carry) return;
    const p = this.params;
    const lower = this.level(index - 1);

    const turns = this.turnsOf(lower.u);
    if (turns > carry.turnsSeen) {
      carry.pending += turns - carry.turnsSeen;
      carry.turnsSeen = turns;
    }

    if (carry.phase === "contact") {
      if (carry.pending > 0) {
        carry.pending--;
        carry.phase = "falling";
        carry.lift = liftMaxDeg(p);
        carry.fallSpeed = 0;
        this.emit({ type: "carryReleased", level: index, t: this.time });
      } else {
        // the body rests on the bars; when the support drops (lead bar leaves its reach, wheel settles back) it falls onto them
        const support = supportLift(p, mod(lower.u, RELEASE_STEPS));
        const before = carry.lift;
        if (support >= carry.lift) {
          carry.lift = support;
          carry.fallSpeed = 0;
        } else {
          carry.fallSpeed += p.fallAccelDegPerSec2 * dt;
          carry.lift = Math.max(support, carry.lift - carry.fallSpeed * dt);
          if (carry.lift === support) carry.fallSpeed = 0;
        }
        if (before === 0 && carry.lift > 0) this.emit({ type: "carryArmed", level: index, t: this.time });
        return;
      }
    }

    if (carry.phase === "falling") {
      carry.fallSpeed += p.fallAccelDegPerSec2 * dt;
      carry.lift -= carry.fallSpeed * dt;
      const engage = kickEngageDeg(p);
      if (carry.lift > engage) return;
      carry.lift = engage;
      carry.phase = "kicking";
      carry.kickProgress = 0;
      carry.fallSpeed = 0;
      this.emit({ type: "carryKick", level: index, t: this.time });
      return;
    }

    // Kick: the upper wheel is advanced kinematically; the body is coupled to it, so the kick always completes.
    const upper = this.level(index);
    const old = upper.u;
    const want = Math.min(1 - carry.kickProgress, dt / p.kickDurationSec);
    const moved = this.clampAdvance(index, upper.u, want * p.kickSteps);
    upper.u += moved;
    carry.kickProgress += moved / p.kickSteps;
    if (carry.kickProgress >= 1 - EPS) {
      carry.kickProgress = 1;
      carry.phase = "contact";
      carry.lift = 0;
      if (Math.abs(upper.u - Math.round(upper.u)) < 1e-6) upper.u = Math.round(upper.u);
      this.emit({ type: "stopHit", level: index, t: this.time });
    } else {
      carry.lift = kickEngageDeg(p) * (1 - carry.kickProgress);
    }
    this.afterMove(index, old);
  }

  private emit(event: SimEvent): void {
    this.events.push(event);
  }
}
