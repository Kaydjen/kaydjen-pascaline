import { type BoxGeometry, type CylinderGeometry, Mesh, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { Mechanism } from "../sim/mechanism";
import { DIM } from "./dimensions";
import { Assembly } from "../scene/assembly";

/** Parts that must touch at rest may be at most this far apart, and may sink in by at most `SINK`. */
const GAP = 0.05;
const SINK = 0.1;

function findAll(root: Object3D, predicate: (o: Object3D) => boolean): Object3D[] {
  const found: Object3D[] = [];
  root.traverse((o) => {
    if (predicate(o)) found.push(o);
  });
  return found;
}

/** Reads the visual primitives (the proxies are their hidden twins and would count every part twice). */
function find(root: Object3D, predicate: (o: Object3D) => boolean): Object3D[] {
  const found: Object3D[] = [];
  root.traverse((o) => {
    if (o.userData.proxy !== true && predicate(o)) found.push(o);
  });
  return found;
}

const dims = (m: Mesh): BoxGeometry["parameters"] => (m.geometry as BoxGeometry).parameters;

function bodyOf(object: Object3D): string {
  for (let o: Object3D | null = object; o; o = o.parent) {
    if (typeof o.userData.body === "string") return o.userData.body;
  }
  return "";
}

describe("contacts at rest", () => {
  const mechanism = new Mechanism({ levelCount: 3 });
  const view = new Assembly(mechanism);
  view.root.updateMatrixWorld(true);

  it("the carry leg lies on its stop bar", () => {
    const legs = find(view.root, (o) => o.userData.kind === "leg") as Mesh[];
    const stops = find(view.root, (o) => o.userData.kind === "stop") as Mesh[];
    expect(legs).toHaveLength(2);
    expect(stops).toHaveLength(2);
    legs.forEach((leg, k) => {
      const stop = stops[k]!;
      // both boxes share the arm's yaw; in the leg's frame the stop's near face is x = stop centre - half width
      const p = leg.worldToLocal(stop.getWorldPosition(new Vector3()));
      const gap = p.x - (dims(leg).width / 2 + dims(stop).width / 2);
      expect(gap).toBeLessThanOrEqual(GAP);
      expect(gap).toBeGreaterThanOrEqual(-SINK);
      // and the stop is under the leg's length, not beside it
      expect(Math.abs(p.z)).toBeLessThan(dims(leg).depth / 2);
    });
  });

  it("every pawl and sautoir hook rests against the side of a pin of gear 48", () => {
    const hooks = find(view.root, (o) => o.userData.hook === true) as Mesh[];
    expect(hooks).toHaveLength(3 + 2); // three pawls, two sautoirs
    for (const hook of hooks) {
      const level = bodyOf(hook).split(":")[1]!;
      const pins = find(
        view.root,
        (o) =>
          o instanceof Mesh &&
          bodyOf(o) === `acc:${level}` &&
          o.geometry.type === "CylinderGeometry" &&
          Math.abs(o.position.y - DIM.y.gear48) < 1e-9 &&
          Math.abs(o.geometry.parameters.radiusTop - DIM.pinRadius) < 1e-9,
      );
      expect(pins).toHaveLength(DIM.pinCount);
      const hx = dims(hook).width / 2;
      const hz = dims(hook).depth / 2;
      let nearest = Infinity;
      for (const pin of pins) {
        const p = hook.worldToLocal(pin.getWorldPosition(new Vector3()));
        const d = Math.hypot(Math.max(Math.abs(p.x) - hx, 0), Math.max(Math.abs(p.z) - hz, 0)) - DIM.pinRadius;
        nearest = Math.min(nearest, d);
      }
      expect(nearest, bodyOf(hook)).toBeLessThanOrEqual(GAP);
      expect(nearest, bodyOf(hook)).toBeGreaterThanOrEqual(-SINK);
    }
  });

  it("each lever sits on its support (no gap between lever underside and riser or post top)", () => {
    const levers = find(view.root, (o) => /^(pawl|sautoir):/.test(o.userData.body ?? "")).filter((o) => o.userData.body);
    expect(levers).toHaveLength(5);
    for (const lever of levers) {
      const bottom = lever.getWorldPosition(new Vector3());
      // the supports are boxes of other bodies whose top face is at the same height as the lever underside
      // supports are boxes of other bodies: plain visuals and the proxies of forged parts
      const supports = findAll(view.root, (o) => o instanceof Mesh && o.geometry.type === "BoxGeometry" && bodyOf(o) !== bodyOf(lever)) as Mesh[];
      const near = supports.filter((s) => {
        const p = s.worldToLocal(lever.getWorldPosition(new Vector3()));
        const h = dims(s);
        return Math.abs(p.x) <= h.width / 2 + 0.01 && Math.abs(p.z) <= h.depth / 2 + 0.01;
      });
      expect(near.length, `support under ${bodyOf(lever)}`).toBeGreaterThan(0);
      const tops = near.map((s) => {
        const top = new Vector3(0, dims(s).height / 2, 0);
        return s.localToWorld(top);
      });
      // three.js y is spec z; the lever's underside is 1.5 mm below its pivot, spec y is three -z
      const underside = DIM.y.gear48 - 1.5;
      const specY = (v: Vector3): number => -v.z;
      expect(Math.min(...tops.map((t) => Math.abs(specY(t) - underside))), bodyOf(lever)).toBeLessThanOrEqual(GAP);
      void bottom;
    }
  });

  it("every shaft rests on at least two support bars", () => {
    const shafts = find(view.root, (o) => o.userData.shaft === true) as Mesh[];
    const bars = find(view.root, (o) => o.userData.bearing === true) as Mesh[];
    expect(shafts).toHaveLength(9); // accumulator, input and output shaft on three levels
    expect(bars.length).toBeGreaterThan(0);
    for (const shaft of shafts) {
      const params = (shaft.geometry as CylinderGeometry).parameters;
      const touching = new Set<Mesh>();
      for (let k = 0; k <= 40; k++) {
        const world = shaft.localToWorld(new Vector3(0, ((k / 40) - 0.5) * params.height, 0));
        for (const bar of bars) {
          const p = bar.worldToLocal(world.clone());
          const h = dims(bar);
          const d = Math.hypot(Math.max(Math.abs(p.x) - h.width / 2, 0), Math.max(Math.abs(p.y) - h.height / 2, 0), Math.max(Math.abs(p.z) - h.depth / 2, 0));
          if (d <= GAP) touching.add(bar);
        }
      }
      expect(touching.size, `${bodyOf(shaft)} shaft`).toBeGreaterThanOrEqual(2);
    }
  });
});
