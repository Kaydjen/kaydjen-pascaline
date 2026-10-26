/** One digit step of any wheel, in degrees. */
export const STEP_DEG = 36;
/** Wheel position (in steps) of digit 0 after 9; the bars let go of the body slightly before it. */
export const RELEASE_STEPS = 10;

/** Tunable mechanism parameters. Every value is an assumption. */
export interface MechanismParams {
  levelCount: number;
  /** Distance between neighbouring accumulator axes. */
  levelPitch: number;
  /** Radius of the bar tips on the lower accumulator. */
  barRadius: number;
  /** Radius of the pin at each bar tip (the arm rests on its surface). */
  barTipRadius: number;
  /** Length of the carry arm from the upper shaft; the bars can lift it only while their tip is within this reach. */
  armReach: number;
  /** The bar pair sits at +-this angle around its centre; the lead bar starts the lift early. */
  barHalfSpreadDeg: number;
  /** The bars lose the body this far before the wheel comes to rest on 10, so the resting wheel is clear of it. */
  releaseMarginSteps: number;
  /** Fraction of a step at which the detent peaks; past it the wheel can only settle forward (commit point). */
  detentPeak: number;
  /** Upper wheel advance by one kick, in steps. */
  kickSteps: number;
  kickDurationSec: number;
  /** Constant angular acceleration of the free-falling carry body. */
  fallAccelDegPerSec2: number;
  detentRateStepsPerSec: number;
  /** Fastest forward speed of any driver; keeps fast flicks from tunnelling past the release point. */
  maxDriveRateStepsPerSec: number;
}

export const DEFAULT_PARAMS: MechanismParams = {
  levelCount: 2,
  levelPitch: 40,
  barRadius: 16,
  barTipRadius: 0.8,
  armReach: 37,
  barHalfSpreadDeg: 15,
  releaseMarginSteps: 0.25,
  detentPeak: 0.5,
  kickSteps: 1,
  kickDurationSec: 0.18,
  fallAccelDegPerSec2: 1700,
  detentRateStepsPerSec: 8,
  maxDriveRateStepsPerSec: 12,
};

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/**
 * Bar/arm contact model (rod resting on the bar tip). The arm is a rod from the upper shaft that
 * rests on a bar tip while the tip is within `armReach`; the tip circle of radius barRadius around the
 * lower shaft is reached for a window of bar angles psi (clockwise from up, seen from the front).
 */
function contactWindow(p: MechanismParams): { entry: number; exit: number } {
  const D = p.levelPitch;
  const R = p.barRadius;
  const s0 = (p.armReach ** 2 - D * D - R * R) / (2 * D * R);
  // the rod elevation first dips (lowest at psi = 180 + asin(R / D)); the stop bar sits at that lowest point
  const lowest = 180 + Math.asin(R / D) * DEG;
  return { entry: Math.max(180 - Math.asin(s0) * DEG, lowest), exit: 360 + Math.asin(s0) * DEG };
}

/** Elevation of the arm (degrees above horizontal) when it rests on the tip pin of a bar at angle psi. */
function rodElevation(p: MechanismParams, psiDeg: number): number {
  const psi = psiDeg * RAD;
  const x = p.levelPitch + p.barRadius * Math.sin(psi);
  const z = p.barRadius * Math.cos(psi);
  // the arm line runs tangent to the tip pin, on its upper side
  return (Math.atan2(z, x) + Math.asin(p.barTipRadius / Math.hypot(x, z))) * DEG;
}

/** Trailing bar angle at wheel position 0: chosen so the trailing bar leaves the reach exactly at the release point. */
export function trailPhaseDeg(p: MechanismParams): number {
  return contactWindow(p).exit - STEP_DEG * (RELEASE_STEPS - p.releaseMarginSteps);
}

/** Arm elevation while it rests on the stop bar: the lowest the rod on a bar tip can go. */
export function armRestElevationDeg(p: MechanismParams): number {
  return rodElevation(p, contactWindow(p).entry);
}

/** Lift of the body at the release point, degrees above the stop bar. */
export function liftMaxDeg(p: MechanismParams): number {
  return rodElevation(p, contactWindow(p).exit) - armRestElevationDeg(p);
}

/** Wheel position (steps, within one turn) at which the bars let go of the body. */
export function releaseSteps(p: MechanismParams): number {
  return RELEASE_STEPS - p.releaseMarginSteps;
}

/** Wheel position (steps, within one turn) at which the lead bar reaches the carry arm. */
export function liftStartSteps(p: MechanismParams): number {
  return (contactWindow(p).entry - trailPhaseDeg(p) - 2 * p.barHalfSpreadDeg) / STEP_DEG;
}

/**
 * Lift the bars give the carry body when the lower wheel is at `steps` (0 <= steps < 10): the highest
 * arm elevation among the bars within reach, above the stop bar. 0 while no bar is within reach.
 */
export function supportLift(p: MechanismParams, steps: number): number {
  const { entry, exit } = contactWindow(p);
  const rest = armRestElevationDeg(p);
  let best = 0;
  for (const offset of [0, 2 * p.barHalfSpreadDeg]) {
    const psi = (((steps * STEP_DEG + trailPhaseDeg(p) + offset) % 360) + 360) % 360;
    if (psi >= entry && psi < exit) best = Math.max(best, rodElevation(p, psi) - rest);
  }
  return best;
}

/** Body angle at which the sautoir meets the pin of the upper wheel; below it the kick drives the wheel. */
export function kickEngageDeg(p: MechanismParams): number {
  return p.kickSteps * STEP_DEG;
}

export function validateParams(p: MechanismParams): void {
  const fail = (message: string): never => {
    throw new Error(`Invalid mechanism parameters: ${message}`);
  };
  if (!Number.isInteger(p.levelCount) || p.levelCount < 1) fail("levelCount must be a positive integer");
  if (!(p.detentPeak > 0 && p.detentPeak < 1)) fail("detentPeak must be in (0, 1)");
  if (!(p.releaseMarginSteps >= 0 && 10 - p.releaseMarginSteps >= 9 + p.detentPeak)) fail("release must not come before the commit point");
  if (!(p.armReach < p.levelPitch && p.armReach > p.levelPitch - p.barRadius)) fail("armReach must stay short of the lower shaft and reach the bar circle");
  if (!(liftStartSteps(p) > p.detentPeak && liftStartSteps(p) < RELEASE_STEPS - 1)) fail("lift start out of range");
  if (!(liftMaxDeg(p) > kickEngageDeg(p))) fail("lift at release must exceed the kick engage angle");
  if (!(p.kickSteps > 0 && p.kickSteps <= 1)) fail("kickSteps must be in (0, 1]");
  for (const [name, value] of Object.entries(p)) {
    if (!Number.isFinite(value)) fail(`${name} is not finite`);
  }
  if (p.kickDurationSec <= 0 || p.fallAccelDegPerSec2 <= 0) fail("durations and accelerations must be positive");
  if (p.detentRateStepsPerSec <= 0 || p.maxDriveRateStepsPerSec <= 0) fail("rates must be positive");
}
