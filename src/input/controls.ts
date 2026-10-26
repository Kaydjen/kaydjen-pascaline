import type { Clock } from "../sim/clock";

export type Speed = 1 | 0.25 | 0.05;

/** Time control state shared by the dock buttons and the keyboard: pause plus one of three speeds. */
export class TimeControl {
  paused = false;
  speed: Speed = 1;
  private readonly listeners: (() => void)[] = [];

  constructor(private readonly clock: Clock) {}

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  private apply(): void {
    this.clock.timeScale = this.paused ? 0 : this.speed;
    this.listeners.forEach((l) => l());
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
    this.paused = false;
    this.apply();
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.apply();
  }
}
