import { describe, expect, it } from "vitest";
import { Assembly } from "../scene/assembly";
import { Mechanism } from "../sim/mechanism";
import { collectParts, findOverlaps } from "./proxyOverlap";

describe("part overlap over simulated motion", () => {
  it("finds no unintended overlaps between moving parts", () => {
    const m = new Mechanism({ levelCount: 3 });
    const view = new Assembly(m);
    const parts = collectParts(view.root);
    const found = new Map<string, string>();
    const sample = (): void => {
      view.update();
      view.root.updateMatrixWorld(true);
      const context = `t=${m.time.toFixed(2)} u=[${m.levels.map((l) => l.u.toFixed(2))}] carries=[${m.carries.map((c) => `${c.phase}@${c.lift.toFixed(1)}`)}]`;
      // parts that are both "fixed" never move against each other
      for (const hit of findOverlaps(parts, (a, b) => a.body === "fixed" && b.body === "fixed")) if (!found.has(hit)) found.set(hit, context);
    };

    const runs: { digits: number[]; pushes: number[] }[] = [
      { digits: [9, 9, 3], pushes: [1] },
      { digits: [0, 0, 0], pushes: [4, 6, 9, 3] },
      { digits: [7, 4, 9], pushes: [5, 5, 5] },
    ];
    for (const run of runs) {
      m.presetDigits(run.digits);
      let n = 0;
      for (const steps of run.pushes) {
        const target = Math.round(m.levels[0]!.u) + steps;
        m.setDrive(0, target);
        for (let i = 0; i < 4000 && m.levels[0]!.u < target - 1e-9; i++) {
          m.step(1 / 240);
          if (++n % 4 === 0) sample();
        }
        m.setDrive(0, null);
        for (let i = 0; i < 480; i++) {
          m.step(1 / 240);
          if (++n % 4 === 0) sample();
        }
      }
    }
    expect([...found].map(([hit, context]) => `${hit} (first at ${context})`), "unintended overlaps").toEqual([]);
  }, 60000); // many small parts (rivets, bosses): the pairwise sweep takes a while
});
