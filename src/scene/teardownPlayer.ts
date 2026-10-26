/**
 * Auto-play of the teardown amount: moves `s` linearly to a target (the layout easing lives in `layout`), 1.6 s for
 * 0 -> 0.4 and 3.2 s for 0 -> 1. Scrubbing by hand cancels it.
 */
export class TeardownPlayer {
  private from = 0;
  private to = 0;
  private elapsed = 0;
  private duration = 0;
  private playing = false;

  constructor(
    private readonly read: () => number,
    private readonly write: (s: number) => void,
  ) {}

  get active(): boolean {
    return this.playing;
  }

  get target(): number {
    return this.playing ? this.to : this.read();
  }

  /** Starts moving to `target`; a no-op when already there. */
  play(target: number): void {
    const now = this.read();
    const goal = Math.min(Math.max(target, 0), 1);
    if (Math.abs(goal - now) < 1e-4) {
      this.playing = false;
      return;
    }
    this.from = now;
    this.to = goal;
    this.elapsed = 0;
    this.duration = Math.max(0.6, 3.2 * Math.abs(goal - now) ** 0.8);
    this.playing = true;
  }

  cancel(): void {
    this.playing = false;
  }

  update(dt: number): void {
    if (!this.playing) return;
    this.elapsed += Math.min(dt, 0.1);
    const t = Math.min(this.elapsed / this.duration, 1);
    this.write(this.from + (this.to - this.from) * t);
    if (t >= 1) this.playing = false;
  }
}
