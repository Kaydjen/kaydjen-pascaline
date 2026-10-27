import { Vector3 } from "three";
import { DIM, INPUT_SHAFT_Y } from "../parts/dimensions";
import { LID_TOP } from "../parts/case";
import { STEP_DEG } from "../sim/params";
import { ASSEMBLED_S, layout } from "../scene/teardown";

/**
 * Geometry of dialling, all in machine (spec) coordinates: +x right, +y away from the user, +z up, millimetres.
 * Angles are degrees clockwise: from +y seen from above for the lid wheels, from +z seen from the front (looking along +y) for gear 45.
 */
export type DialKind = "wheel" | "gear";

/** The stop lever stands at the front of a lid wheel: 180 degrees clockwise from north. */
export const STOP_ANGLE = 180;
/** Radius at which the stylus tip stands in a wheel gap, mm. */
export const WHEEL_TIP_RADIUS = 11;
/** Height of the stylus tip over the wheel's middle plane when it works between the spokes (below the spoke tops, above the lid), mm. */
export const WHEEL_TIP_Z = 0;
/**
 * The tip does not stand in the middle of a gap: it leans on the spoke that it pushes (the one behind it, as the wheel turns
 * clockwise). At the tip radius a spoke edge is 9.25 degrees from the gap middle; the point's own radius takes about 2.5 more.
 */
export const WHEEL_TIP_LEAD_DEG = 6.6;
/** Height over the lid (hover) and over the pin tops of gear 45 while the stylus is in hand but not inserted, mm. */
export const HOVER_ABOVE_LID = 14;
export const HOVER_ABOVE_GEAR = 12;

export interface Dial {
  kind: DialKind;
  level: number;
  /** Centre of the wheel (x, y at the wheel plane) or of gear 45 (x, z at the shaft). */
  centre: { x: number; y: number; z: number };
}

/** Which kind of target the stylus works on for teardown amount `s`: the lid wheels while assembled, gear 45 otherwise. */
export const dialKind = (s: number): DialKind => (s < ASSEMBLED_S ? "wheel" : "gear");

export function levelX(level: number, levelCount: number, pitch: number): number {
  return ((levelCount - 1) / 2 - level) * pitch;
}

export function dialFor(kind: DialKind, level: number, levelCount: number, pitch: number, s: number): Dial {
  const { lidZ, frameZ } = layout(s);
  const x = levelX(level, levelCount, pitch);
  if (kind === "wheel") return { kind, level, centre: { x, y: INPUT_SHAFT_Y, z: lidZ + LID_TOP } };
  return { kind, level, centre: { x, y: DIM.y.gear45 + DIM.accPinSpanY / 2, z: frameZ } };
}

/** Height of the free-hover plane for the stylus at teardown amount `s`. */
export function hoverZ(s: number): number {
  const { lidZ, frameZ } = layout(s);
  return s < ASSEMBLED_S ? lidZ + LID_TOP + HOVER_ABOVE_LID : frameZ + DIM.pinCircleRadius + DIM.pinRadius + HOVER_ABOVE_GEAR;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Angle of the point (a, b) about the origin, clockwise from +b, in degrees (0..360). */
export const clockwiseAngle = (a: number, b: number): number => mod((Math.atan2(a, b) * 180) / Math.PI, 360);

/** World angle of gap `j` of a wheel at position `u` (steps): the spokes sit at (j + 0.5) steps, gaps at whole steps. */
export const wheelGapAngle = (j: number, u: number): number => mod((j + u) * STEP_DEG, 360);

/** Gap of a wheel at position `u` that is nearest to the world angle `angle`. */
export const nearestWheelGap = (angle: number, u: number): number => mod(Math.round(angle / STEP_DEG - u), DIM.pinCount);

/** World angle of gap `j` between the pins of gear 45 at position `u`: pins at whole steps, gaps half a step later. */
export const gearGapAngle = (j: number, u: number): number => mod((j + 0.5 + u) * STEP_DEG, 360);

export const nearestGearGap = (angle: number, u: number): number => mod(Math.round(angle / STEP_DEG - 0.5 - u), DIM.pinCount);

/**
 * Steps a wheel may still be pushed clockwise from the gap that stands at `gapAngle` until that gap meets the stop lever
 * (the stylus sits in the gap and pushes it forward; the lever blocks it).
 */
export const stepsToStop = (gapAngle: number): number => Math.round(mod(STOP_ANGLE - gapAngle, 360) / STEP_DEG);

/** Digit that dialling from the gap at `gapAngle` to the stop adds (digit d stands d steps short of the stop). */
export const digitAt = (gapAngle: number): number => stepsToStop(gapAngle) % 10;

/** Smallest signed difference of two angles in degrees, (-180, 180]. */
export const angleDelta = (from: number, to: number): number => {
  const d = mod(to - from, 360);
  return d > 180 ? d - 360 : d;
};

/** Stylus axis (from the tip towards the knob) when held over the lid and when working on gear 45. */
export const AXIS_WHEEL = new Vector3(0.22, -0.5, 1).normalize();
export const AXIS_GEAR = new Vector3(0.12, -0.62, 0.78).normalize();
export const STYLUS_LENGTH_MM = 70;

/** Tip position in a gap of the dial: hovering a little above it, or inserted. */
export function gapTip(dial: Dial, gap: number, u: number, inserted: boolean): Vector3 {
  const c = dial.centre;
  if (dial.kind === "wheel") {
    const a = ((wheelGapAngle(gap, u) - WHEEL_TIP_LEAD_DEG) * Math.PI) / 180;
    return new Vector3(c.x + WHEEL_TIP_RADIUS * Math.sin(a), c.y + WHEEL_TIP_RADIUS * Math.cos(a), c.z + (inserted ? WHEEL_TIP_Z : WHEEL_TIP_Z + 5));
  }
  const a = (gearGapAngle(gap, u) * Math.PI) / 180;
  const r = DIM.pinCircleRadius + (inserted ? 0 : 4);
  return new Vector3(c.x + r * Math.sin(a), c.y, c.z + r * Math.cos(a));
}
