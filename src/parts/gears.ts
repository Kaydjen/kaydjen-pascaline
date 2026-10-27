import { BufferGeometry, ExtrudeGeometry, Group, Mesh, Path, Shape } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { getMaterial } from "../materials/factory";
import { STEP_DEG, trailPhaseDeg, type MechanismParams } from "../sim/params";
import { at, cylinder, box, RAD, R, shaft, tag } from "./common";
import { DIM } from "./dimensions";
import { outputToothProfile, profileVertices } from "./meshing";
import { hitCylinder } from "./proxies";

/**
 * Plate of a pin wheel after the Diderot engraving (Pl. 2): a flat rim ring that carries the pins, three curved spokes
 * and a hub boss. Axis z, centred on z = 0. The rim ring and the spokes are one flat plate `thickness` thick.
 */
const PIN_RIM_HALF_WIDTH = 1.7;
export const PIN_HUB_RADIUS = 2.6;

const plateCache = new Map<number, BufferGeometry>();

/** Plate geometry is built once per thickness; callers get their own copy (they may rotate it). */
export function pinWheelPlate(thickness: number): BufferGeometry {
  let plate = plateCache.get(thickness);
  if (!plate) plateCache.set(thickness, (plate = buildPinWheelPlate(thickness)));
  return plate.clone();
}

function buildPinWheelPlate(thickness: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const extrudeFlat = (shape: Shape): BufferGeometry => {
    const g = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 24 });
    g.translate(0, 0, -thickness / 2);
    return g;
  };
  const rim = new Shape();
  rim.absarc(0, 0, R + PIN_RIM_HALF_WIDTH, 0, Math.PI * 2, false);
  const rimHole = new Path();
  rimHole.absarc(0, 0, R - PIN_RIM_HALF_WIDTH, 0, Math.PI * 2, true);
  rim.holes.push(rimHole);
  parts.push(extrudeFlat(rim));
  const hub = new Shape();
  hub.absarc(0, 0, PIN_HUB_RADIUS + 0.6, 0, Math.PI * 2, false);
  parts.push(extrudeFlat(hub));
  // three spokes sweeping 40 degrees between the hub and the rim, narrower in the middle
  for (let k = 0; k < 3; k++) {
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const radius = PIN_HUB_RADIUS + (R - PIN_RIM_HALF_WIDTH + 0.4 - PIN_HUB_RADIUS) * t;
      const angle = (k * 120 + 40 * t) * RAD;
      const half = 0.75 + 0.5 * Math.abs(2 * t - 1);
      const tangent = [Math.cos(angle), -Math.sin(angle)]; // direction of growing angle (clockwise) at the point, approximately
      const x = radius * Math.sin(angle);
      const y = radius * Math.cos(angle);
      left.push([x + tangent[0]! * half, y + tangent[1]! * half]);
      right.push([x - tangent[0]! * half, y - tangent[1]! * half]);
    }
    const shape = new Shape();
    shape.moveTo(left[0]![0], left[0]![1]);
    for (const [x, y] of left) shape.lineTo(x, y);
    for (const [x, y] of right.reverse()) shape.lineTo(x, y);
    shape.closePath();
    parts.push(extrudeFlat(shape));
  }
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  return merged ?? parts[0]!;
}

/** Accumulator of one level: gears 45, 48, 50, the bar pair and the horizontal shaft. Origin on the shaft axis, rotates about y. */
export function buildAccumulator(level: number, params: MechanismParams): Group {
  const brass = getMaterial("brass-gear");
  const steel = getMaterial("steel");
  const acc = tag(new Group(), `acc:${level}`);
  const plateGeometry = pinWheelPlate(0.8);
  plateGeometry.rotateX(Math.PI / 2); // axis z -> y
  acc.add(at(shaft(1.2, 40, "y", steel), 0, 13, 0));
  // rings (not plates) on the +y side only: the input gear's pins pass on the -y side and the carry must stay visible
  for (const y of [DIM.y.gear45, DIM.y.gear48, DIM.y.gear50]) {
    for (let k = 0; k < DIM.pinCount; k++) {
      const a = k * STEP_DEG * RAD;
      acc.add(at(cylinder(DIM.pinRadius, DIM.accPinSpanY, "y", brass, 12), R * Math.sin(a), y, R * Math.cos(a)));
    }
    acc.add(at(new Mesh(plateGeometry, brass), 0, y + DIM.accPinSpanY / 2, 0));
    acc.add(at(cylinder(PIN_HUB_RADIUS, 1.6, "y", brass, 24), 0, y + DIM.accPinSpanY / 2 + 0.3, 0)); // hub boss
    for (let k = 0; k < DIM.pinCount; k++) {
      const a = k * STEP_DEG * RAD;
      acc.add(at(cylinder(DIM.pinRadius + 0.35, 0.4, "y", brass, 10), R * Math.sin(a), y + DIM.accPinSpanY / 2 + 0.5, R * Math.cos(a))); // rivet heads
    }
  }
  acc.add(at(cylinder(2.2, 3.5, "y", brass), 0, DIM.y.bars - 1.25, 0));
  // bars: a spoke under the carry leg's plane carrying a tip pin that rises into it
  for (const offset of [0, 2 * params.barHalfSpreadDeg]) {
    const psi = (trailPhaseDeg(params) + offset) * RAD; // trailing bar first, lead bar ahead of it
    const length = params.barRadius - 2;
    const mid = 2 + length / 2;
    const spoke = at(box(1.6, 3.5, length, brass), mid * Math.sin(psi), DIM.y.bars - 1.25, mid * Math.cos(psi));
    spoke.rotation.y = psi;
    acc.add(spoke);
    const tip = cylinder(params.barTipRadius, 6, "y", brass, 10);
    acc.add(at(tip, params.barRadius * Math.sin(psi), DIM.y.bars, params.barRadius * Math.cos(psi)));
  }
  // mouse target while the machine is apart: the pin ring of gear 45 plus a margin
  acc.add(at(hitCylinder(`gear:${level}`, 20, 8, "y"), 0, DIM.y.gear45 + DIM.accPinSpanY / 2, 0));
  return acc;
}

/** Wheel 56 as an extruded star-shaped profile in the xz plane, thickness along y, centred on y = 0. */
let toothCache: BufferGeometry | null = null;

export function toothWheelGeometry(): BufferGeometry {
  toothCache ??= buildToothWheelGeometry();
  return toothCache.clone();
}

function buildToothWheelGeometry(): BufferGeometry {
  const vertices = profileVertices(outputToothProfile());
  const shape = new Shape();
  vertices.forEach((v, i) => {
    if (i % 5 !== 0) return;
    if (i === 0) shape.moveTo(v.x, v.z);
    else shape.lineTo(v.x, v.z);
  });
  shape.closePath();
  // three round lightening holes between hub and teeth: the wheel reads as a wheel with crossings, not a plate
  for (let k = 0; k < 3; k++) {
    const a = (k * 120 + 60) * RAD;
    const hole = new Path();
    hole.absarc(8.6 * Math.sin(a), 8.6 * Math.cos(a), 3.3, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const geometry = new ExtrudeGeometry(shape, { depth: DIM.accPinSpanY, bevelEnabled: false, curveSegments: 16 });
  geometry.rotateX(Math.PI / 2); // shape (x, y) -> (x, z); depth -> -y
  geometry.translate(0, DIM.accPinSpanY / 2, 0);
  return geometry;
}
