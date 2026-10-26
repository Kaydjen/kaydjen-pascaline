import { type PerspectiveCamera, Spherical, Vector3 } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ASSEMBLED_S, NO_LID_S } from "./teardown";

/** A camera view in three coordinates (y up): where it looks, how far, and from which direction (degrees). */
export interface View {
  target: Vector3;
  radius: number;
  elevation: number;
  azimuth: number;
}

export type PresetName = "default" | "reading" | "level" | "exploded";

export interface PresetOptions {
  /** `level`: index of the level whose carry to its neighbour (index + 1) is framed. */
  level?: number;
  /** Jump without the glide (first frame, tests). */
  instant?: boolean;
}

export interface CameraRig {
  /** When false the rig leaves the camera alone (dev scripts that place the camera by hand). */
  enabled: boolean;
  setPreset(name: PresetName, opts?: PresetOptions): void;
  /** Teardown amount 0..1: the camera follows it, keeping the user's orbit as an offset. */
  setTeardown(s: number): void;
  update(dt: number): void;
  readonly busy: boolean;
}

/** Views of the machine; the sizes follow the level count and pitch (mm). */
export interface MachineViews {
  default: View;
  reading: View;
  /** Raised-lid view for the working range of the teardown ("hands-on"). */
  handsOn: View;
  exploded: View;
  level(index: number): View;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;
const view = (x: number, y: number, z: number, radius: number, elevation: number, azimuth: number): View => ({ target: new Vector3(x, y, z), radius, elevation, azimuth });

export function machineViews(levelCount: number, pitch: number): MachineViews {
  const spread = levelCount * pitch;
  const fit = Math.max(1, spread / 130);
  const base = 175 * fit; // distance at which the whole lid fills the view
  return {
    default: view(0, 46, -10, base * 1.0, 42, 14),
    reading: view(0, 48, -6, base * 0.78, 60, 6),
    handsOn: view(0, 80, -6, base * 1.45, 28, -22),
    exploded: view(0, 128, -8, Math.max(560, base * 1.95), 26, -24),
    level: (index) => view(((levelCount - 1) / 2 - index) * pitch - pitch / 2, 38, -12, base * 0.45, 20, 0),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const smooth = (t: number): number => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** Shortest signed angle from a to b, degrees. */
function angleDiff(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

function blend(a: View, b: View, t: number): View {
  return {
    target: a.target.clone().lerp(b.target, t),
    radius: Math.exp(lerp(Math.log(a.radius), Math.log(b.radius), t)),
    elevation: lerp(a.elevation, b.elevation, t),
    azimuth: a.azimuth + angleDiff(a.azimuth, b.azimuth) * t,
  };
}

/** Largest polar angle (from straight up) the camera may reach: 88 degrees, never below the ground. */
export const MAX_POLAR = rad(88);

export function createCameraRig(camera: PerspectiveCamera, controls: OrbitControls, views: MachineViews): CameraRig {
  let sTarget = 0;
  let sSmooth = 0;
  let following = false;
  let delta = { target: new Vector3(), ratio: 1, azimuth: 0, elevation: 0 };
  let tween: { from: View; to: View; t: number; duration: number } | null = null;

  /** The base view for teardown amount `s`: default, hands-on for the working range, exploded at the end. */
  const viewFor = (s: number): View => {
    if (s <= ASSEMBLED_S) return views.default;
    if (s <= NO_LID_S) return blend(views.default, views.handsOn, smooth((s - ASSEMBLED_S) / (NO_LID_S - ASSEMBLED_S)));
    return blend(views.handsOn, views.exploded, smooth((s - NO_LID_S) / (1 - NO_LID_S)));
  };

  const current = (): View => {
    const offset = camera.position.clone().sub(controls.target);
    const sph = new Spherical().setFromVector3(offset);
    return { target: controls.target.clone(), radius: sph.radius, elevation: 90 - (sph.phi * 180) / Math.PI, azimuth: (sph.theta * 180) / Math.PI };
  };

  const apply = (v: View): void => {
    const sph = new Spherical(v.radius, Math.min(Math.max(rad(90 - v.elevation), 0.04), MAX_POLAR), rad(v.azimuth));
    controls.target.copy(v.target);
    camera.position.setFromSpherical(sph).add(v.target);
    camera.lookAt(v.target);
  };

  const compose = (base: View): View => ({
    target: base.target.clone().add(delta.target),
    radius: base.radius * delta.ratio,
    elevation: base.elevation + delta.elevation,
    azimuth: base.azimuth + delta.azimuth,
  });

  const beginFollowing = (): void => {
    const now = current();
    const base = viewFor(sSmooth);
    delta = { target: now.target.clone().sub(base.target), ratio: now.radius / base.radius, azimuth: angleDiff(base.azimuth, now.azimuth), elevation: now.elevation - base.elevation };
    following = true;
  };

  const stopOnUser = (): void => {
    tween = null;
    if (following) {
      following = false;
      sSmooth = sTarget;
    }
  };
  controls.addEventListener("start", stopOnUser);

  const rig: CameraRig = {
    enabled: true,
    get busy() {
      return tween !== null || following;
    },
    setPreset(name, opts = {}) {
      let to: View;
      if (name === "default") to = viewFor(sTarget);
      else if (name === "exploded") to = views.exploded;
      else if (name === "reading") to = views.reading;
      else to = views.level(opts.level ?? 0);
      following = false;
      sSmooth = sTarget;
      if (opts.instant) {
        tween = null;
        apply(to);
        return;
      }
      const from = current();
      const distance = from.target.distanceTo(to.target) + Math.abs(from.radius - to.radius);
      tween = { from, to, t: 0, duration: 0.55 + 0.0015 * distance };
    },
    setTeardown(s) {
      sTarget = Math.min(Math.max(s, 0), 1);
    },
    update(dt) {
      if (!rig.enabled) return;
      if (tween) {
        tween.t += dt;
        const k = smooth(tween.t / tween.duration);
        apply(blend(tween.from, tween.to, k));
        if (tween.t >= tween.duration) tween = null;
        return;
      }
      if (sSmooth === sTarget) return;
      if (!following) beginFollowing();
      sSmooth += (sTarget - sSmooth) * (1 - Math.exp(-dt * 5));
      if (Math.abs(sTarget - sSmooth) < 1e-3) sSmooth = sTarget;
      apply(compose(viewFor(sSmooth)));
      if (sSmooth === sTarget) following = false;
    },
  };
  return rig;
}
