export interface ClockOptions {
  /** Fixed simulation step in seconds. */
  step: number;
  /** Largest real-time delta accepted per advance, in seconds. */
  maxDelta: number;
}

/** Fixed-step accumulator with a time scale (0 = pause) and a delta clamp. */
export class Clock {
  timeScale = 1;
  private accumulator = 0;

  constructor(private readonly options: ClockOptions = { step: 1 / 240, maxDelta: 0.1 }) {}

  get step(): number {
    return this.options.step;
  }

  /** Fraction of the next fixed step already accumulated, for render interpolation. */
  get alpha(): number {
    return this.accumulator / this.options.step;
  }

  /** Feeds a real-time delta and returns the number of fixed steps to simulate. */
  advance(realDelta: number): number {
    const delta = Math.min(Math.max(realDelta, 0), this.options.maxDelta);
    this.accumulator += delta * this.timeScale;
    const steps = Math.floor(this.accumulator / this.options.step + 1e-9);
    this.accumulator -= steps * this.options.step;
    return steps;
  }
}
