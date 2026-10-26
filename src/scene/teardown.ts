/**
 * Vertical exploded view: one parameter `s` in 0..1; the box never moves, the lid assembly rises first, the frame second.
 * Pure functions of `s`: scrubbing in both directions is trivial and every pose is reproducible.
 */
export const FRAME_LIFT = 95;
/** The lid assembly always rises this much more than the frame (the cages must clear the accumulator pins and wheel-56 tips). */
export const LID_LEAD = 90;
/** `s` at which the lid is fully lifted from the frame (the "no lid" state). */
export const NO_LID_S = 0.4;
/** Below this `s` the machine counts as assembled (stylus targets the lid wheels; above it gear 45). */
export const ASSEMBLED_S = 0.02;

const LID_PHASE: readonly [number, number] = [0, NO_LID_S];
const FRAME_PHASE: readonly [number, number] = [0.3, 0.9];

const clamp01 = (x: number): number => Math.min(Math.max(x, 0), 1);
export const smootherstep = (x: number): number => {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const phase = (s: number, [from, to]: readonly [number, number]): number => smootherstep((s - from) / (to - from));

export interface TeardownLayout {
  /** Lift of the lid assembly above its closed position, mm. */
  lidZ: number;
  /** Lift of the frame above its resting position, mm. */
  frameZ: number;
  /** Forward tilt of the lid, degrees (always 0: a tilt would pull the input shafts out of their bushings). */
  lidTilt: number;
}

export function layout(s: number): TeardownLayout {
  const frameZ = FRAME_LIFT * phase(s, FRAME_PHASE);
  return { lidZ: LID_LEAD * phase(s, LID_PHASE) + frameZ, frameZ, lidTilt: 0 };
}
