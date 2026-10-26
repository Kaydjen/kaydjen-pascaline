import { describe, expect, it } from "vitest";
import { Clock } from "./clock";

const options = { step: 0.01, maxDelta: 0.1 };

describe("Clock", () => {
  it("yields the same step count for the same input", () => {
    const a = new Clock(options);
    const b = new Clock(options);
    const deltas = [0.016, 0.017, 0.033, 0.016, 0.05];
    const total = (c: Clock) => deltas.reduce((n, d) => n + c.advance(d), 0);
    expect(total(a)).toBe(total(b));
  });

  it("carries the remainder between frames", () => {
    const clock = new Clock(options);
    expect(clock.advance(0.015)).toBe(1);
    expect(clock.advance(0.015)).toBe(2);
  });

  it("stops at timeScale 0", () => {
    const clock = new Clock(options);
    clock.timeScale = 0;
    expect(clock.advance(0.1)).toBe(0);
  });

  it("stretches time with a small timeScale", () => {
    const clock = new Clock(options);
    clock.timeScale = 0.1;
    let steps = 0;
    for (let i = 0; i < 100; i++) steps += clock.advance(0.01);
    expect(steps).toBe(10);
  });

  it("clamps a huge delta", () => {
    const clock = new Clock(options);
    expect(clock.advance(60)).toBe(10);
  });

  it("ignores negative deltas", () => {
    const clock = new Clock(options);
    expect(clock.advance(-1)).toBe(0);
  });
});
