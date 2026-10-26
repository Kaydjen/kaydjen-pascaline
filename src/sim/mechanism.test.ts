import { describe, expect, it } from "vitest";
import { Clock } from "./clock";
import { Mechanism, type SimEvent } from "./mechanism";
import { armRestElevationDeg, kickEngageDeg, liftMaxDeg, liftStartSteps, releaseSteps, supportLift } from "./params";

const DT = 1 / 240;

/** Runs until the mechanism is settled with no driver holding it; returns the elapsed sim time. */
function runToRest(m: Mechanism, maxSeconds = 10): number {
  const start = m.time;
  while (m.time - start < maxSeconds) {
    m.step(DT);
    if (m.settled() && m.levels.every((l) => l.drive === null)) return m.time - start;
  }
  throw new Error("mechanism did not come to rest");
}

/** Drives a wheel forward by `steps` and lets go. */
function turn(m: Mechanism, level: number, steps: number): void {
  const target = (m.levels[level]?.u ?? 0) + steps;
  m.setDrive(level, target);
  for (let i = 0; i < 20000; i++) {
    m.step(DT);
    if (Math.abs((m.levels[level]?.u ?? 0) - target) < 1e-9) break;
  }
  m.setDrive(level, null);
}

const types = (events: SimEvent[]): string[] => events.map((e) => `${e.type}:${e.level}`);

describe("lift from bar contact", () => {
  const p = new Mechanism().params;
  it("starts at zero when the lead bar reaches the arm and tops out at the release point", () => {
    expect(supportLift(p, liftStartSteps(p) - 0.01)).toBe(0);
    expect(supportLift(p, liftStartSteps(p) + 0.01)).toBeGreaterThan(0);
    expect(supportLift(p, releaseSteps(p) - 0.001)).toBeCloseTo(liftMaxDeg(p), 1);
    expect(supportLift(p, releaseSteps(p) + 0.001)).toBe(0);
    expect(supportLift(p, 0)).toBe(0);
  });
  it("is continuous except at the bar hand-over and at the release", () => {
    let jumps = 0;
    let prev = 0;
    for (let u = 0; u < 10; u += 0.001) {
      const lift = supportLift(p, u);
      if (Math.abs(lift - prev) > 0.5) jumps++;
      prev = lift;
    }
    expect(jumps).toBe(2);
  });
  it("keeps the hand-over dip small and the lift range above the kick angle", () => {
    let peak = 0;
    let dip = 0;
    for (let u = liftStartSteps(p); u < releaseSteps(p); u += 0.001) {
      const lift = supportLift(p, u);
      peak = Math.max(peak, lift);
      dip = Math.max(dip, peak - lift);
    }
    expect(dip).toBeLessThan(5);
    expect(liftMaxDeg(p)).toBeGreaterThan(kickEngageDeg(p));
    expect(armRestElevationDeg(p)).toBeLessThan(0);
  });
});

describe("single carry", () => {
  it("adds one to the upper wheel when the lower wheel passes 9 -> 0", () => {
    const m = new Mechanism({ levelCount: 2 });
    m.presetDigits([9, 4]);
    turn(m, 0, 1);
    runToRest(m);
    expect([m.digit(0), m.digit(1)]).toEqual([0, 5]);
    expect(types(m.takeEvents().filter((e) => e.type.startsWith("carry") || e.type === "stopHit"))).toEqual([
      "carryReleased:1",
      "carryKick:1",
      "stopHit:1",
    ]);
  });

  it("works for every upper digit, losing the unit past the top level", () => {
    for (let d = 0; d <= 9; d++) {
      const m = new Mechanism({ levelCount: 2 });
      m.presetDigits([9, d]);
      turn(m, 0, 1);
      runToRest(m);
      expect(m.digit(1)).toBe((d + 1) % 10);
      expect(m.digit(0)).toBe(0);
    }
  });

  it("carries in the middle of a chain for every digit", () => {
    for (let d = 0; d <= 9; d++) {
      const m = new Mechanism({ levelCount: 3 });
      m.presetDigits([0, 9, d]);
      turn(m, 1, 1);
      runToRest(m);
      expect([m.digit(1), m.digit(2)]).toEqual([0, (d + 1) % 10]);
    }
  });

  it("fires exactly once per ten digits of the lower wheel", () => {
    const m = new Mechanism({ levelCount: 2 });
    let released = 0;
    for (let digit = 1; digit <= 30; digit++) {
      turn(m, 0, 1);
      runToRest(m);
      released += m.takeEvents().filter((e) => e.type === "carryReleased").length;
      expect(released).toBe(Math.floor(digit / 10));
      expect(m.value()).toBe(digit % 100);
    }
  });

  it("is armed from the lead bar position onwards", () => {
    const m = new Mechanism({ levelCount: 2 });
    for (let digit = 0; digit <= 9; digit++) {
      m.presetDigits([digit, 0]);
      expect((m.carryOn(1)?.lift ?? 0) > 0).toBe(digit > liftStartSteps(m.params));
    }
  });
});

describe("commit point (hysteresis sweep)", () => {
  it("never leaves the digit and the carry out of step, for every stop position", () => {
    for (let s = 8.5; s <= 10.0001; s += 0.01) {
      const m = new Mechanism({ levelCount: 2 });
      m.presetDigits([8, 3]);
      m.setDrive(0, s);
      for (let i = 0; i < 400; i++) {
        m.step(DT);
        const carry = m.carryOn(1)!;
        const lowerTurns = Math.floor((m.levels[0]!.u + m.params.releaseMarginSteps) / 10 + 1e-9);
        const upper = m.levels[1]!.u;
        // the release is answered in the very step the lower wheel reaches 10
        expect(carry.turnsSeen).toBe(lowerTurns);
        // the upper wheel moves only after a release, and a started carry always runs to its end
        if (lowerTurns === 0) expect(upper).toBe(3);
        else expect(upper > 3 || carry.phase !== "contact").toBe(true);
      }
      m.setDrive(0, null);
      runToRest(m);
      const committed = s >= 9.5 - 1e-9;
      expect(m.digit(0), `stop at ${s.toFixed(2)}`).toBe(committed ? 0 : 9);
      expect(m.digit(1), `stop at ${s.toFixed(2)}`).toBe(committed ? 4 : 3);
    }
  });

  it("returns the body to the bars when the wheel settles back", () => {
    const m = new Mechanism({ levelCount: 2 });
    m.presetDigits([9, 0]);
    m.setDrive(0, 9.3);
    for (let i = 0; i < 100; i++) m.step(DT);
    m.setDrive(0, null);
    runToRest(m);
    expect(m.digit(0)).toBe(9);
    expect(m.carryOn(1)?.lift).toBeCloseTo(supportLift(m.params, 9), 9);
  });
});

describe("wheel rules", () => {
  it("never moves backward past the pawl, whatever the driver does", () => {
    const m = new Mechanism({ levelCount: 3 });
    let seed = 12345;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const floors = m.levels.map(() => 0);
    for (let n = 0; n < 4000; n++) {
      if (n % 25 === 0) {
        const level = Math.floor(random() * 3);
        m.setDrive(level, random() < 0.2 ? null : (m.levels[level]?.u ?? 0) + (random() - 0.4) * 6);
      }
      m.step(DT);
      m.levels.forEach((l, i) => {
        expect(l.u).toBeGreaterThanOrEqual(l.pawlFloor - 1e-9);
        expect(l.pawlFloor).toBeGreaterThanOrEqual(floors[i]! - 1e-12);
        floors[i] = l.pawlFloor;
      });
    }
  });

  it("settles every wheel on a detent after any input", () => {
    const m = new Mechanism({ levelCount: 3 });
    m.presetDigits([3, 9, 9]);
    m.setDrive(0, 7.3);
    for (let i = 0; i < 300; i++) m.step(DT);
    m.setDrive(0, null);
    runToRest(m);
    expect(m.levels.every((l) => Math.abs(l.u - Math.round(l.u)) < 1e-9)).toBe(true);
  });

  it("completes a carry even while the stylus holds the receiving wheel", () => {
    const m = new Mechanism({ levelCount: 2 });
    m.presetDigits([9, 3]);
    m.setDrive(1, 3); // held, not pushing
    turn(m, 0, 1);
    for (let i = 0; i < 480; i++) m.step(DT);
    m.setDrive(1, null);
    runToRest(m);
    expect([m.digit(0), m.digit(1)]).toEqual([0, 4]);
  });

  it("does not jam or lose carries when a driver runs far ahead", () => {
    const m = new Mechanism({ levelCount: 3 });
    m.presetDigits([5, 0, 0]);
    m.setDrive(0, 25); // two full carries in one push, faster than a carry cycle
    for (let i = 0; i < 2400; i++) m.step(DT);
    m.setDrive(0, null);
    runToRest(m);
    expect(m.value()).toBe(25); // 5 + 20 steps: units wheel on 5, two carries delivered
    expect(m.takeEvents().filter((e) => e.type === "carryReleased")).toHaveLength(2);
  });
});

/** Dials a number the way a user does: digit by digit, units first, each wheel left to settle. */
function dial(m: Mechanism, n: number): void {
  for (let level = 0; level < m.levels.length; level++) {
    const digit = Math.floor(n / 10 ** level) % 10;
    if (digit > 0) {
      turn(m, level, digit);
      runToRest(m);
    }
  }
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("arithmetic", () => {
  const MOD = 10 ** 6;

  it("repeated dialing equals addition modulo 10^6", () => {
    const random = seededRandom(7);
    const m = new Mechanism({ levelCount: 6 });
    let expected = 0;
    for (let n = 0; n < 40; n++) {
      const addend = Math.floor(random() * MOD);
      dial(m, addend);
      expected = (expected + addend) % MOD;
      expect(m.value()).toBe(expected);
    }
  });

  it("handles addends that force long carry chains", () => {
    const m = new Mechanism({ levelCount: 6 });
    m.presetDigits([9, 9, 9, 0, 9, 9]);
    dial(m, 1);
    expect(m.value()).toBe(991000); // 990999 + 1
  });

  it("subtracts through the descending row: set the complement of A, add B, read A - B", () => {
    const random = seededRandom(99);
    for (let n = 0; n < 25; n++) {
      const a = Math.floor(random() * MOD);
      const b = Math.floor(random() * MOD);
      const m = new Mechanism({ levelCount: 6 });
      dial(m, MOD - 1 - a); // descending row now reads A
      expect(m.complementValue()).toBe(a);
      dial(m, b);
      expect(m.complementValue()).toBe((((a - b) % MOD) + MOD) % MOD);
    }
  });

  it("carries 9 -> 0 on every one of the five carry positions, for every upper digit", () => {
    for (let level = 0; level < 5; level++) {
      for (let d = 0; d <= 9; d++) {
        const digits = [0, 0, 0, 0, 0, 0];
        digits[level] = 9;
        digits[level + 1] = d;
        const m = new Mechanism({ levelCount: 6 });
        m.presetDigits(digits);
        const before = m.value();
        turn(m, level, 1);
        runToRest(m);
        expect(m.value()).toBe((before + 10 ** level) % MOD);
      }
    }
  });
});

describe("robustness under arbitrary input (6 levels)", () => {
  // Random stylus pushes, holds and releases on any wheel, also while a cascade is running.
  it("never moves back, never jams, never loses or duplicates a carry", () => {
    let totalCarries = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const random = seededRandom(seed * 7919);
      const m = new Mechanism({ levelCount: 6 });
      // half the runs start on a field of 9s so that cascades overlap with the input
      if (seed % 2 === 0) m.presetDigits([9, 9, 9, 9, 9, 9]);
      const startTurns = m.levels.map((l) => Math.round(l.u));
      const floors = m.levels.map((l) => l.pawlFloor);
      const backward: string[] = [];
      for (let n = 0; n < 6000; n++) {
        if (n % 20 === 0) {
          const level = Math.floor(random() * 6);
          m.setDrive(level, random() < 0.25 ? null : (m.levels[level]?.u ?? 0) + (random() - 0.3) * 8);
        }
        m.step(DT);
        m.levels.forEach((l, i) => {
          if (l.u < l.pawlFloor - 1e-9 || l.pawlFloor < floors[i]! - 1e-12) backward.push(`seed ${seed}, step ${n}, level ${i}`);
          floors[i] = l.pawlFloor;
        });
      }
      expect(backward).toEqual([]);
      m.levels.forEach((_, i) => m.setDrive(i, null));
      runToRest(m); // throws if anything is stuck
      expect(m.levels.every((l) => Math.abs(l.u - Math.round(l.u)) < 1e-9)).toBe(true);
      // one carry per full ten steps of the wheel below, none lost, none doubled
      const released = new Array<number>(6).fill(0);
      for (const e of m.takeEvents()) if (e.type === "carryReleased") released[e.level]!++;
      for (let i = 1; i < 6; i++) {
        const passes = Math.floor(m.levels[i - 1]!.u / 10) - Math.floor(startTurns[i - 1]! / 10);
        expect(released[i], `seed ${seed}, level ${i}`).toBe(passes);
        totalCarries += passes;
      }
    }
    expect(totalCarries).toBeGreaterThan(50); // the fuzz really exercises carries, not just idle wheels
  });
});

describe("cascade", () => {
  it("999999 + 1 ripples through all six levels, one carry after the other", () => {
    const m = new Mechanism({ levelCount: 6 });
    m.presetDigits([9, 9, 9, 9, 9, 9]);
    turn(m, 0, 1);
    const duration = runToRest(m);
    const events = m.takeEvents().filter((e) => e.type === "carryReleased" || e.type === "carryKick" || e.type === "stopHit");
    const at = (type: string, level: number): number => events.find((e) => e.type === type && e.level === level)!.t;
    for (let i = 1; i <= 5; i++) {
      expect(at("carryReleased", i)).toBeLessThan(at("carryKick", i));
      expect(at("carryKick", i)).toBeLessThan(at("stopHit", i));
      // the next carry is released by the end of this kick: dominoes, never simultaneous
      if (i < 5) {
        expect(at("carryReleased", i + 1)).toBeGreaterThan(at("carryKick", i));
        expect(at("carryReleased", i + 1)).toBeLessThanOrEqual(at("stopHit", i));
      }
    }
    expect(events).toHaveLength(15);
    expect(m.value()).toBe(0);
    expect(duration).toBeGreaterThan(1.0);
    expect(duration).toBeLessThan(2.0);
  });

  it("is deterministic and independent of time scale and frame chopping", () => {
    const run = (timeScale: number, frame: number): string[] => {
      const m = new Mechanism({ levelCount: 6 });
      m.presetDigits([9, 9, 9, 9, 9, 9]);
      m.setDrive(0, 10);
      const clock = new Clock({ step: DT, maxDelta: 1 });
      clock.timeScale = timeScale;
      const log: string[] = [];
      let steps = 0;
      while (steps < 2000 / timeScale || !m.settled()) {
        const n = clock.advance(frame);
        for (let i = 0; i < n; i++) {
          m.step(clock.step);
          steps++;
          for (const e of m.takeEvents()) log.push(`${e.type}:${e.level}@${steps}`);
        }
        if (steps > 100000) break;
      }
      return log;
    };
    expect(run(1, 1 / 60)).toEqual(run(1, 1 / 37));
    const slow = run(0.05, 1 / 60);
    const fast = run(1, 1 / 60);
    const stripTime = (log: string[]): string[] => log.map((s) => s.split("@")[0]!);
    expect(stripTime(slow)).toEqual(stripTime(fast));
  });
});
