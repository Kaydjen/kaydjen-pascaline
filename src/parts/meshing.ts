import { DIM, INPUT_GEAR_Z, INPUT_SHAFT_Y, OUTPUT_SHAFT_Z, type Dimensions } from "./dimensions";

const RAD = Math.PI / 180;
type Dim = Dimensions;

export interface PolarProfile {
  /** Wheel-frame angle of sample i is `i * stepDeg`, clockwise from up (+z), seen from the front. */
  stepDeg: number;
  radius: Float64Array;
}

/** Distance from `value` to the interval [lo, hi] (0 inside). */
const outside = (value: number, lo: number, hi: number): number => (value < lo ? lo - value : value > hi ? value - hi : 0);

/**
 * Input stage (G2): vertical pins of gear 40 against y-parallel pins of gear 45, ideal 1:1 lockstep.
 * Both pin families are axis-aligned segments, so the exact distance of a perpendicular pair is
 * the root of the three clamped axis offsets. Returns the closest centre-line distance over one pitch.
 */
export function inputStageMinCentreDistance(dim: Dim = DIM, stepDeg = 0.25): number {
  const n = dim.pinCount;
  const pitch = 360 / n;
  const R = dim.pinCircleRadius;
  let min = Infinity;
  for (let theta = 0; theta < pitch; theta += stepDeg) {
    for (let m = 0; m < n; m++) {
      const b = (theta + m * pitch + dim.inputPinPhaseDeg) * RAD;
      const xv = R * Math.sin(b);
      const yv = INPUT_SHAFT_Y + R * Math.cos(b);
      const dy = outside(yv, -dim.accPinSpanY / 2, dim.accPinSpanY / 2);
      for (let k = 0; k < n; k++) {
        const a = (theta + k * pitch) * RAD;
        const dx = xv - R * Math.sin(a);
        if (Math.abs(dx) > min) continue;
        const dz = outside(R * Math.cos(a), INPUT_GEAR_Z - dim.inputPinSpanZ, INPUT_GEAR_Z);
        min = Math.min(min, Math.hypot(dx, dy, dz));
      }
    }
  }
  return min;
}

/** Position of pin `k` of the output-stage lantern gear 50, expressed in the frame of wheel 56. */
function pinInWheelFrame(dim: Dim, thetaDeg: number, k: number): { x: number; z: number } {
  const a = (thetaDeg + (k * 360) / dim.pinCount) * RAD;
  const px = dim.pinCircleRadius * Math.sin(a);
  const pz = dim.pinCircleRadius * Math.cos(a) - OUTPUT_SHAFT_Z;
  const t = thetaDeg * RAD; // wheel 56 turns counter-clockwise by theta; undo it
  return { x: px * Math.cos(t) + pz * Math.sin(t), z: -px * Math.sin(t) + pz * Math.cos(t) };
}

/**
 * Output stage (G2): tooth profile of the 10-tooth wheel 56 as the inner envelope of every pin disc
 * (pin radius + clearance) swept relative to the wheel, capped at the tip radius. The profile is
 * star-shaped about the wheel axis, which keeps the clearance test a single radial comparison.
 */
export function outputToothProfile(dim: Dim = DIM, profileStepDeg = 0.1, sweepStepDeg = 0.25): PolarProfile {
  const samples = Math.round(360 / profileStepDeg);
  const radius = new Float64Array(samples).fill(dim.toothTipRadius);
  const rho = dim.pinRadius + dim.toothClearance;
  for (let theta = 0; theta < 360; theta += sweepStepDeg) {
    for (let k = 0; k < dim.pinCount; k++) {
      const c = pinInWheelFrame(dim, theta, k);
      const d = Math.hypot(c.x, c.z);
      if (d - rho > dim.toothTipRadius) continue;
      const beta = Math.atan2(c.x, c.z);
      const reach = Math.asin(Math.min(rho / d, 1));
      const first = Math.floor((beta - reach) / RAD / profileStepDeg);
      const last = Math.ceil((beta + reach) / RAD / profileStepDeg);
      for (let i = first; i <= last; i++) {
        const delta = i * profileStepDeg * RAD - beta;
        const perp = d * Math.sin(delta);
        if (Math.abs(perp) >= rho || Math.cos(delta) <= 0) continue;
        const hit = d * Math.cos(delta) - Math.sqrt(rho * rho - perp * perp);
        const index = ((i % samples) + samples) % samples;
        if (hit < radius[index]!) radius[index] = hit;
      }
    }
  }
  return { stepDeg: profileStepDeg, radius };
}

/** Profile as polygon vertices (x, z) in the wheel frame, counter-clockwise order not guaranteed. */
export function profileVertices(profile: PolarProfile): { x: number; z: number }[] {
  return Array.from(profile.radius, (r, i) => {
    const phi = i * profile.stepDeg * RAD;
    return { x: r * Math.sin(phi), z: r * Math.cos(phi) };
  });
}

/** Signed distance from a wheel-frame point to the profile boundary (negative inside the tooth material). */
export function signedDistanceToProfile(profile: PolarProfile, x: number, z: number): number {
  const n = profile.radius.length;
  const phi = Math.atan2(x, z) / RAD;
  const centre = Math.round(((phi % 360) + 360) % 360 / profile.stepDeg);
  const window = Math.round(30 / profile.stepDeg);
  let best = Infinity;
  const vertex = (i: number): { x: number; z: number } => {
    const index = ((i % n) + n) % n;
    const r = profile.radius[index]!;
    const a = index * profile.stepDeg * RAD;
    return { x: r * Math.sin(a), z: r * Math.cos(a) };
  };
  let prev = vertex(centre - window);
  for (let i = centre - window + 1; i <= centre + window; i++) {
    const cur = vertex(i);
    const ex = cur.x - prev.x;
    const ez = cur.z - prev.z;
    const t = Math.max(0, Math.min(1, ((x - prev.x) * ex + (z - prev.z) * ez) / (ex * ex + ez * ez || 1)));
    best = Math.min(best, Math.hypot(x - (prev.x + t * ex), z - (prev.z + t * ez)));
    prev = cur;
  }
  const own = profile.radius[centre % n]!;
  return Math.hypot(x, z) < own ? -best : best;
}

/** Smallest gap between any pin surface and the wheel-56 profile over a full revolution (negative = overlap). */
export function outputStageMinClearance(profile: PolarProfile, dim: Dim = DIM, stepDeg = 0.1): number {
  let min = Infinity;
  for (let theta = stepDeg / 2; theta < 360; theta += stepDeg) {
    for (let k = 0; k < dim.pinCount; k++) {
      const c = pinInWheelFrame(dim, theta, k);
      min = Math.min(min, signedDistanceToProfile(profile, c.x, c.z) - dim.pinRadius);
    }
  }
  return min;
}
