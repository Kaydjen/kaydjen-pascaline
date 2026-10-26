import { Box3, Mesh, Object3D } from "three";
import { describe, expect, it } from "vitest";
import { Mechanism } from "../sim/mechanism";
import { BAR_TRAVEL, CROWN_HOLE_RADIUS, crownAngleDeg, crownOuterRadius, LID_BOTTOM, LID_TOP } from "./case";
import { DIM } from "./dimensions";
import { Assembly } from "../scene/assembly";
import { SPOKE_BASE_HALF_WIDTH, SPOKE_HUB_RADIUS, SPOKE_TIP_HALF_WIDTH } from "./wheelGroup";
import { STEP_DEG } from "../sim/params";

function bodyOf(object: Object3D): string {
  for (let o: Object3D | null = object; o; o = o.parent) {
    if (typeof o.userData.body === "string") return o.userData.body;
  }
  return "";
}

/** The machine group turns spec (x, y, z) into three (x, z + 30, -y). */
const specZ = (threeY: number): number => threeY - 30;

describe("case and lid", () => {
  const m = new Mechanism({ levelCount: 3 });
  const view = new Assembly(m);

  function movingMeshes(): Mesh[] {
    const found: Mesh[] = [];
    view.root.traverse((o) => {
      if (o instanceof Mesh && bodyOf(o) !== "fixed" && bodyOf(o) !== "") found.push(o);
    });
    return found;
  }

  it("moving parts stay under the lid (the input wheels reach up into its openings)", () => {
    const meshes = movingMeshes();
    let worst = -Infinity;
    const sample = (): void => {
      view.update();
      view.root.updateMatrixWorld(true);
      for (const mesh of meshes) {
        if (bodyOf(mesh).startsWith("input:")) continue;
        worst = Math.max(worst, specZ(new Box3().setFromObject(mesh, true).max.y));
      }
    };
    m.presetDigits([9, 9, 3]);
    m.setDrive(0, Math.round(m.levels[0]!.u) + 1);
    for (let i = 0; i < 2000; i++) {
      m.step(1 / 240);
      if (i % 20 === 0) sample();
    }
    expect(worst).toBeLessThanOrEqual(LID_BOTTOM - 0.2);
    // and the paper sits just under the lid: the drum top is within 1.5 mm of it
    expect(LID_BOTTOM - (28 + DIM.drumRadius)).toBeLessThan(1.5);
  });

  it("each input wheel lies just above the closed lid and fits inside its crown ring", () => {
    view.root.updateMatrixWorld(true);
    const wheels = movingMeshes().filter((o) => bodyOf(o).startsWith("input:") && o.name === "starWheel");
    expect(wheels).toHaveLength(3);
    for (const wheel of wheels) {
      const box = new Box3().setFromObject(wheel, true);
      expect(specZ(box.min.y)).toBeGreaterThan(LID_TOP);
      expect(specZ(box.max.y)).toBeLessThan(LID_TOP + 2.5);
      expect(box.max.x - box.min.x).toBeLessThanOrEqual(2 * (CROWN_HOLE_RADIUS - 0.2));
    }
  });

  it("spokes clear the crown ring and leave a stylus gap", () => {
    const tip = Math.hypot(16, SPOKE_TIP_HALF_WIDTH);
    expect(tip).toBeLessThan(CROWN_HOLE_RADIUS - 0.2 + 0.3);
    const gapAtTip = 2 * 16 * Math.sin((STEP_DEG * Math.PI) / 360) - 2 * SPOKE_TIP_HALF_WIDTH;
    expect(gapAtTip).toBeGreaterThan(4); // a stylus tip is about 3 mm
    // flat blades that taper towards the rim (user-wheel-macro-2.png and the Diderot drawings; the reverse taper was wrong)
    expect(SPOKE_TIP_HALF_WIDTH).toBeLessThan(SPOKE_BASE_HALF_WIDTH);
    expect(SPOKE_HUB_RADIUS).toBeLessThan(16);
  });

  it("neighbouring crown rings touch and numeral 0 is at the front stop", () => {
    expect(2 * crownOuterRadius(40)).toBeGreaterThan(39.8);
    expect(2 * crownOuterRadius(40)).toBeLessThanOrEqual(40);
    expect(crownAngleDeg(0)).toBe(180);
    expect(crownAngleDeg(1)).toBeCloseTo(180 - STEP_DEG, 9);
  });

  it("every anchor for the later glow and hover lamps exists", () => {
    const names = new Set<string>();
    view.root.traverse((o) => o.name && names.add(o.name));
    for (const i of [0, 1, 2]) {
      for (const base of ["wheel", "crown", "stopLever", "pawl", "pawlTip", "drum", "accumulator"]) expect(names, `${base}:${i}`).toContain(`${base}:${i}`);
    }
    for (const i of [1, 2]) for (const base of ["carryBody", "sautoir", "sautoirTip", "carryContact", "stop"]) expect(names, `${base}:${i}`).toContain(`${base}:${i}`);
    for (const name of ["barrel:left", "barrel:right", "bar", "labelText", "stopTip", "lidPlate", "wheelPlate:0", "wall:front", "wall:back", "wall:left", "wall:right", "supportBar:0"]) expect(names).toContain(name);
  });

  it("covers hide separately; the lid takes the label strip and the bar with it", () => {
    const v = new Assembly(new Mechanism({ levelCount: 3 }));
    const visible = (name: string): boolean => {
      let found = false;
      let shown = true;
      v.root.traverse((o) => {
        if (o.name !== name) return;
        found = true;
        for (let p: Object3D | null = o; p; p = p.parent) shown &&= p.visible;
      });
      return found && shown;
    };
    expect(["lidPlate", "labelText", "bar", "wall:left"].map(visible)).toEqual([true, true, true, true]);
    v.setCover("bar", false);
    expect(["lidPlate", "labelText", "bar", "barrel:left"].map(visible)).toEqual([true, true, false, false]);
    v.setCover("bar", true);
    v.setCover("wall:left", false);
    expect(["wall:left", "wall:right", "lidPlate"].map(visible)).toEqual([false, true, true]);
    v.setCover("lid", false);
    expect(["lidPlate", "labelText", "bar", "wall:right"].map(visible)).toEqual([false, false, false, true]);
  });
});

describe("sliding panel", () => {
  const make = (): Assembly => new Assembly(new Mechanism({ levelCount: 3 }));
  const offsetOf = (v: Assembly): number => {
    let y = NaN;
    v.root.traverse((o) => o.name === "slider" && (y = o.position.y));
    return y;
  };

  it("ascending (front) row is visible at rest: the panel sits over the rear half of the windows", () => {
    expect(offsetOf(make())).toBeCloseTo(BAR_TRAVEL, 9);
  });

  it("settles on the target for any frame times and any number of quick switches, with at most a tiny overshoot (row-switch bug)", () => {
    const v = make();
    const frames = [1 / 60, 1 / 60, 1 / 30, 0.5, 0, -0.01, 3, 1 / 144, 1 / 15];
    const rows = ["descending", "ascending"] as const;
    let k = 0;
    for (let click = 0; click < 12; click++) {
      v.setVisibleRow(rows[click % 2]!);
      const target = click % 2 === 0 ? -BAR_TRAVEL : BAR_TRAVEL;
      for (let f = 0; f < 140; f++) {
        v.update(undefined, frames[k++ % frames.length]);
        const now = offsetOf(v);
        // never beyond the ends by more than 15 % of the half stroke (a switch in flight carries its speed), and never past the target by more than 7 % of it
        expect(Math.abs(now)).toBeLessThanOrEqual(BAR_TRAVEL * 1.15);
        expect((now - target) * Math.sign(target)).toBeLessThanOrEqual(2 * BAR_TRAVEL * 0.07);
      }
      for (let f = 0; f < 200; f++) v.update(undefined, 1 / 60);
      expect(offsetOf(v)).toBeCloseTo(target, 6);
    }
  });

  it("one stalled frame moves it only a bounded part of the way", () => {
    const v = make();
    v.setVisibleRow("descending");
    const before = offsetOf(v);
    v.update(undefined, 5);
    expect(Math.abs(offsetOf(v) - before)).toBeLessThan(0.7 * 2 * BAR_TRAVEL);
  });

  it("an instant switch (after a reset) starts at the target", () => {
    const v = make();
    v.setVisibleRow("descending", true);
    expect(offsetOf(v)).toBeCloseTo(BAR_TRAVEL, 9); // applied on the next update
    v.update(undefined, 0);
    expect(offsetOf(v)).toBeCloseTo(-BAR_TRAVEL, 9);
  });
});
