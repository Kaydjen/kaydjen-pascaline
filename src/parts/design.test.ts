import { BufferGeometry, type CylinderGeometry, Mesh, type MeshStandardMaterial, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { Mechanism } from "../sim/mechanism";
import { crownAngleDeg, DIGIT_HEIGHT, DRUM_ROW_Y, numeralRotation, STRIP_CENTRE_Y } from "./case";
import { Assembly } from "../scene/assembly";
import { STEP_DEG } from "../sim/params";
import { DOTTED_SPOKES } from "./wheelGroup";
import { FINAL_LOOK } from "../materials/looks";
import { NO_SCAN } from "../materials/wear";

/**
 * Design rules read from the reference photos (docs/reference/photos). They catch shape mistakes that the physics tests
 * cannot see (a part turned the wrong way, a taper reversed). Each rule names the photo it comes from.
 */
const view = new Assembly(new Mechanism({ levelCount: 3 }));
view.root.updateMatrixWorld(true);

function findObject(name: string): Object3D {
  let found: Object3D | null = null;
  view.root.traverse((o: Object3D) => o.name === name && !found && (found = o));
  if (!found) throw new Error(`nothing named ${name}`);
  return found;
}

const find = (name: string): Mesh => findObject(name) as Mesh;

function vertices(mesh: Mesh): Vector3[] {
  const position = (mesh.geometry as BufferGeometry).getAttribute("position");
  return Array.from({ length: position.count }, (_, i) => new Vector3().fromBufferAttribute(position, i));
}

const widthAt = (points: Vector3[], from: number, to: number, axis: "x" | "z"): number => {
  const slice = points.filter((p) => p.y >= from && p.y <= to);
  return Math.max(...slice.map((p) => Math.abs(p[axis])));
};

describe("design rules from the photos", () => {
  it("stop lever (macro photo): thick at its base on the lid edge, tapering to a point towards the wheel centre", () => {
    const tip = find("stopTip");
    const rod = vertices(tip).map((p) => p.applyMatrix4(tip.matrix)); // in the lever's frame, +y towards the wheel centre
    const ys = rod.map((p) => p.y);
    const [lo, hi] = [Math.min(...ys), Math.max(...ys)];
    // local +y of the lever group runs from the crown edge towards the wheel centre
    expect(widthAt(rod, lo, lo + 0.2, "x")).toBeGreaterThan(widthAt(rod, hi - 0.2, hi, "x") * 2);
  });

  it("star wheel (cnam-823-1-IMG_6513.jpg): ten flat blade spokes of constant thickness, narrowing towards the rim, two with three dots", () => {
    const wheel = vertices(find("starWheel"));
    const radius = (p: Vector3): number => Math.hypot(p.x, p.y);
    const zs = wheel.filter((p) => radius(p) > 9).map((p) => p.z); // beyond the boss in the middle
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(1.6); // one plate thickness, the top sinks towards the tip
    // width of spoke 0 (pointing at phi = half a step clockwise from up) near the tip and near the hub
    const phi = (0.5 * STEP_DEG * Math.PI) / 180;
    const along = (p: Vector3): number => p.x * Math.sin(phi) + p.y * Math.cos(phi);
    const across = (p: Vector3): number => Math.abs(p.x * Math.cos(phi) - p.y * Math.sin(phi));
    const sector = (r0: number, r1: number): number => Math.max(...wheel.filter((p) => along(p) >= r0 && along(p) <= r1 && across(p) < 3.5).map(across));
    expect(sector(3, 6)).toBeGreaterThan(sector(13, 15.4) + 0.3);
    expect(DOTTED_SPOKES).toHaveLength(2);
    expect(Math.abs(DOTTED_SPOKES[0]! - DOTTED_SPOKES[1]!)).toBe(1); // neighbours
  });

  it("octagonal nut with a round boss on every wheel (IMG_6513)", () => {
    const nut = find("nut");
    expect((nut.geometry as CylinderGeometry).parameters.radialSegments).toBe(8);
  });

  it("stop lever (IMG_6513): a forged blade that rises from the foot to its tip", () => {
    const tip = find("stopTip");
    const pts = vertices(tip);
    const ys = pts.map((p) => p.y);
    const low = pts.filter((p) => p.y < Math.min(...ys) + 0.3);
    const high = pts.filter((p) => p.y > Math.max(...ys) - 0.3);
    expect(Math.max(...high.map((p) => p.z))).toBeGreaterThan(Math.max(...low.map((p) => p.z)) + 1);
  });

  it("the plate between the spokes is lit brass, not black (audit 1)", () => {
    const plate = (find("wheelPlate:0").material as MeshStandardMaterial).color;
    expect(0.2126 * plate.r + 0.7152 * plate.g + 0.0722 * plate.b).toBeGreaterThan(0.1);
  });

  it("numerals: bottoms towards the viewer, never reaching the radial angle", () => {
    for (let d = 0; d < 10; d++) {
      const a = (crownAngleDeg(d) * Math.PI) / 180;
      expect(Math.abs(numeralRotation(a))).toBeLessThan(Math.PI / 4);
    }
    expect(numeralRotation(Math.PI)).toBeCloseTo(0, 9); // upright at the front stop
  });

  it("the crown ring stands higher than the spokes, which sink towards their tips (photos)", () => {
    const crown = findObject("crown:0");
    const ringTop = new Vector3();
    crown.getWorldPosition(ringTop);
    const wheelBox = vertices(find("starWheel"));
    const wheel = find("starWheel");
    const topNear = wheel.localToWorld(new Vector3(0, 0, Math.max(...wheelBox.filter((p) => Math.hypot(p.x, p.y) > 3 && Math.hypot(p.x, p.y) < 4.5).map((p) => p.z)))).y;
    const topFar = wheel.localToWorld(new Vector3(0, 0, Math.max(...wheelBox.filter((p) => Math.hypot(p.x, p.y) > 14).map((p) => p.z)))).y;
    const ringHeight = ringTop.y + 2.2; // the crown group origin is at the lid top; the ring top is CROWN_EDGE above it
    expect(ringHeight - topNear).toBeGreaterThan(0.3);
    expect(ringHeight - topNear).toBeLessThan(1.5);
    expect(topNear - topFar).toBeGreaterThan(0.25); // the tip sits lower than the hub end
  });

  it("lid (bw-front-view.png, strip-barrels-crop.png): four upright corner clips, screws at the edge middles, border line 2-3 mm inside the edge", () => {
    for (let k = 0; k < 4; k++) expect(findObject(`lidClip:${k}`)).toBeDefined();
    expect(findObject("lidScrew:0")).toBeDefined();
    // the border lines are engraved by the lid material measured from the plate outline the shader is told about (`vigX/vigY/vigHX/vigHY`)
    const plate = new Assembly(new Mechanism({ levelCount: 6 })).root.getObjectByName("lidPlate") as Mesh; // the shader defaults describe the 6-wheel lid
    plate.geometry.computeBoundingBox();
    const box = plate.geometry.boundingBox!;
    const scan = NO_SCAN;
    expect((FINAL_LOOK.materials["brass-lid"]!.scan as { lines: number }).lines).toBeGreaterThan(0);
    expect(box.max.x).toBeCloseTo(scan.vigX + scan.vigHX, 0);
    expect(box.max.y).toBeCloseTo(scan.vigY + scan.vigHY, 0);
    expect(box.min.y).toBeCloseTo(scan.vigY - scan.vigHY, 0);
  });

  it("box: patinated sheet walls on a lighter plinth, raw wood inside, ledge under the lid", () => {
    const material = (name: string): string => ((find(name).material as { name: string }).name);
    expect(material("wall:front")).toBe("wood-dark");
    expect(material("plinth")).toBe("wood-plinth");
    expect(material("liner:front")).toBe("wood-raw");
    expect(findObject("ledge:front")).toBeDefined();
  });

  it("windows (strip-barrels-crop.png): rectangular opening, one row of digits well apart from the strip edge", () => {
    expect(DRUM_ROW_Y.descending - DRUM_ROW_Y.ascending).toBeGreaterThanOrEqual(7.9);
    const half = DIGIT_HEIGHT / 2;
    // the strip edge (centre of the strip travel) lies between the rows with room for its 3 mm shadow on the paper
    expect(STRIP_CENTRE_Y).toBeGreaterThan(DRUM_ROW_Y.ascending + half);
    expect(STRIP_CENTRE_Y + 3.2).toBeLessThan(DRUM_ROW_Y.descending - half);
    expect(findObject("windowBevel:0")).toBeDefined();
  });
});
