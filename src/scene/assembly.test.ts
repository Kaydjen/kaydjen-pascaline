import { Mesh, Object3D } from "three";
import { describe, expect, it } from "vitest";
import { Mechanism } from "../sim/mechanism";
import { Assembly } from "./assembly";

const assembly = new Assembly(new Mechanism({ levelCount: 3 }));

const find = (name: string): Object3D | undefined => {
  let found: Object3D | undefined;
  assembly.root.traverse((o) => o.name === name && !found && (found = o));
  return found;
};

const isIn = (object: Object3D | undefined, ancestor: Object3D): boolean => {
  for (let o = object; o; o = o.parent ?? undefined) if (o === ancestor) return true;
  return false;
};

describe("assembly groups", () => {
  it("splits the machine into box, frame and lid assembly", () => {
    expect(assembly.machine.children).toEqual(expect.arrayContaining([assembly.box, assembly.frame, assembly.lidAssembly]));
    for (const name of ["wall:front", "floor", "plinth"]) expect(isIn(find(name), assembly.box), name).toBe(true);
    for (const name of ["accumulator:0", "output:1", "pawl:2", "carryBody:1", "supportBar:0", "supportBar:2", "framePlate:left"]) {
      expect(isIn(find(name), assembly.frame), name).toBe(true);
    }
  });

  it("carries the cages, shafts, wheels and the bearing bar under the lid in the lid assembly", () => {
    for (const name of ["lidPlate", "labelText", "slider", "wheel:0", "wheel:2", "starWheel", "supportBar:3", "crown:1"]) {
      expect(isIn(find(name), assembly.lidAssembly), name).toBe(true);
    }
    let shafts = 0;
    assembly.lidAssembly.traverse((o) => o.userData.shaft === true && shafts++);
    expect(shafts).toBe(3); // one input shaft per level
  });

  it("gives every box and cylinder visual a hidden proxy twin, and hand-made proxies point at their visual", () => {
    let visuals = 0;
    let twins = 0;
    assembly.root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      if (o.userData.proxy === true) {
        expect(o.visible).toBe(false);
        expect(o.userData.of).toBe(o.parent);
        return;
      }
      if (o.userData.hit !== undefined) return; // mouse targets are neither visuals nor collision proxies
      if (o.geometry.type !== "BoxGeometry" && o.geometry.type !== "CylinderGeometry") return;
      visuals++;
      if (o.children.some((c) => c.userData.proxy === true && (c as Mesh).geometry === o.geometry)) twins++;
    });
    expect(twins).toBe(visuals);
    expect(visuals).toBeGreaterThan(100);
  });

  it("offers every mouse target, hidden and on the hit layer only", () => {
    const names = assembly.hitTargets().map((o) => o.userData.hit as string);
    for (const name of ["wheel:0", "wheel:2", "gear:0", "gear:2", "stylus", "barrel:0", "barrel:1", "strip", "label", "lid", "frame", "box"]) expect(names, name).toContain(name);
    for (const o of assembly.hitTargets()) {
      expect(o.visible).toBe(false);
      expect(o.layers.isEnabled(0)).toBe(false);
    }
  });

  it("frame details (user-frame-front-sothebys.png): partition at the middle, ears with holes, rivet rows", () => {
    const partition = find("partition")!;
    expect(isIn(partition, assembly.frame)).toBe(true);
    expect((Math.abs(partition.position.x) + 20) % 40).toBeLessThan(1); // three levels: in the gap between level 0 and 1 (x = 20)
    const ears: string[] = [];
    assembly.frame.traverse((o) => o.name.startsWith("frameEar:") && ears.push(o.name));
    expect(ears).toHaveLength(4);
    expect(find("rivets:front")).toBeDefined();
  });
});
