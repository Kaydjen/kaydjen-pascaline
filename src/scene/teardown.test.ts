import type { Object3D } from "three";
import { describe, expect, it } from "vitest";
import { collectParts, findOverlaps } from "../parts/proxyOverlap";
import { Mechanism } from "../sim/mechanism";
import { Assembly } from "./assembly";
import { ASSEMBLED_S, FRAME_LIFT, layout, LID_LEAD, NO_LID_S } from "./teardown";

describe("teardown layout", () => {
  it("is zero when assembled and fully apart at 1", () => {
    expect(layout(0)).toEqual({ lidZ: 0, frameZ: 0, lidTilt: 0 });
    expect(layout(1).frameZ).toBeCloseTo(FRAME_LIFT, 9);
    expect(layout(1).lidZ).toBeCloseTo(FRAME_LIFT + LID_LEAD, 9);
  });

  it("is monotone and the lid always leads the frame", () => {
    let previous = layout(0);
    for (let s = 0.005; s <= 1.0001; s += 0.005) {
      const now = layout(s);
      expect(now.lidZ).toBeGreaterThanOrEqual(previous.lidZ - 1e-9);
      expect(now.frameZ).toBeGreaterThanOrEqual(previous.frameZ - 1e-9);
      expect(now.lidZ).toBeGreaterThanOrEqual(now.frameZ - 1e-9);
      previous = now;
    }
  });

  it("lifts the lid by more than the shaft length plus 10 mm before the frame starts to move (amendment 1)", () => {
    let frameStart = 0;
    while (layout(frameStart).frameZ < 1e-6) frameStart += 0.001;
    expect(layout(frameStart).lidZ).toBeGreaterThan(38 + 10);
    expect(layout(NO_LID_S).frameZ).toBeLessThan(5); // "no lid" shows the frame still in its box
    expect(ASSEMBLED_S).toBeLessThan(NO_LID_S);
  });
});

const GROUPS = ["box", "frame", "lidAssembly"];

describe("lowering the lid after manual turning", () => {
  it("never makes a part pass through another for any wheel position (10-fold symmetry of the pin gears)", () => {
    const mechanism = new Mechanism({ levelCount: 3 });
    const assembly = new Assembly(mechanism);
    const groupOf = (o: Object3D): string => {
      for (let p: Object3D | null = o; p; p = p.parent) if (GROUPS.includes(p.name)) return p.name;
      return "machine";
    };
    const parts = collectParts(assembly.root, groupOf);
    assembly.setTeardown(0);
    const hits = new Map<string, number>();
    for (let u = 0; u < 10; u += 0.1) {
      mechanism.levels.forEach((level, i) => (level.u = u + i * 0.37));
      assembly.update();
      assembly.root.updateMatrixWorld(true);
      for (const hit of findOverlaps(parts)) if (!hits.has(hit)) hits.set(hit, u);
    }
    expect([...hits].map(([hit, u]) => `${hit} (first at u=${u.toFixed(1)})`)).toEqual([]);
  }, 120000);
});

describe("teardown sweep", () => {
  it("no part of one group passes through a part of another at any s (shafts in bushings excepted)", () => {
    const assembly = new Assembly(new Mechanism({ levelCount: 3 }));
    const groupOf = (o: Object3D): string => {
      for (let p: Object3D | null = o; p; p = p.parent) if (GROUPS.includes(p.name)) return p.name;
      return "machine";
    };
    const parts = collectParts(assembly.root, groupOf);
    const hits = new Map<string, number>();
    for (let s = 0; s <= 1.0001; s += 0.01) {
      assembly.setTeardown(s);
      assembly.root.updateMatrixWorld(true);
      for (const hit of findOverlaps(parts)) if (!hits.has(hit)) hits.set(hit, s);
    }
    expect([...hits].map(([hit, s]) => `${hit} (first at s=${s.toFixed(2)})`)).toEqual([]);
  }, 120000);
});
