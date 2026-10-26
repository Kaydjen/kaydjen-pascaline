import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { collectParts, pointInside } from "../parts/proxyOverlap";
import { Assembly } from "../scene/assembly";
import { ASSEMBLED_S, layout } from "../scene/teardown";
import { Mechanism } from "../sim/mechanism";
import {
  AXIS_GEAR,
  angleDelta,
  clockwiseAngle,
  dialFor,
  dialKind,
  digitAt,
  gapTip,
  gearGapAngle,
  hoverZ,
  nearestGearGap,
  nearestWheelGap,
  stepsToStop,
  STYLUS_LENGTH_MM,
  wheelGapAngle,
} from "./dialing";

describe("dialling geometry", () => {
  it("numeral d stands d steps short of the stop lever", () => {
    for (let d = 0; d < 10; d++) expect(digitAt(180 - d * 36)).toBe(d);
    expect(stepsToStop(0)).toBe(5);
  });

  it("finds the nearest gap of a wheel and of gear 45 at any position", () => {
    for (let u = 0; u < 10; u += 0.37) {
      for (let j = 0; j < 10; j++) {
        expect(nearestWheelGap(wheelGapAngle(j, u) + 6, u)).toBe(j);
        expect(nearestGearGap(gearGapAngle(j, u) - 6, u)).toBe(j);
      }
    }
  });

  it("measures angles clockwise from north and takes the short way round", () => {
    expect(clockwiseAngle(0, 1)).toBeCloseTo(0, 9);
    expect(clockwiseAngle(1, 0)).toBeCloseTo(90, 9);
    expect(clockwiseAngle(0, -1)).toBeCloseTo(180, 9);
    expect(angleDelta(350, 10)).toBeCloseTo(20, 9);
    expect(angleDelta(10, 350)).toBeCloseTo(-20, 9);
  });

  it("targets the lid wheels while assembled and gear 45 once the lid is up", () => {
    expect(dialKind(0)).toBe("wheel");
    expect(dialKind(ASSEMBLED_S - 0.001)).toBe("wheel");
    expect(dialKind(ASSEMBLED_S)).toBe("gear");
    expect(hoverZ(0.4)).toBeGreaterThan(layout(0.4).frameZ + 14);
  });
});

describe("the stylus never enters the lid while working on gear 45", () => {
  it("keeps every point of the stylus out of the lid-assembly proxies at s = 0.4, 0.7, 1 over all gaps of all levels", () => {
    const assembly = new Assembly(new Mechanism({ levelCount: 3 }));
    const lidParts = collectParts(assembly.lidAssembly, () => "lid");
    const hits: string[] = [];
    for (const s of [0.4, 0.7, 1]) {
      assembly.setTeardown(s);
      assembly.root.updateMatrixWorld(true);
      for (let level = 0; level < 3; level++) {
        const dial = dialFor("gear", level, 3, 40, s);
        for (let gap = 0; gap < 10; gap++) {
          for (const inserted of [false, true]) {
            const tip = gapTip(dial, gap, 0, inserted);
            for (let d = 0; d <= STYLUS_LENGTH_MM; d += 3) {
              const world = assembly.machine.localToWorld(tip.clone().addScaledVector(AXIS_GEAR, d));
              const part = lidParts.find((p) => pointInside(p, world.clone()));
              if (part) hits.push(`s=${s} level ${level} gap ${gap} d=${d} inside ${part.label}`);
            }
          }
        }
      }
    }
    expect(hits.slice(0, 5)).toEqual([]);
    void Vector3;
  });
});
