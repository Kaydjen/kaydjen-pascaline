import { PerspectiveCamera, Spherical, Vector3 } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { describe, expect, it } from "vitest";
import { createCameraRig, machineViews } from "./cameraRig";

function setup() {
  const camera = new PerspectiveCamera(35, 1.6, 1, 5000);
  const listeners = new Map<string, () => void>();
  const controls = { target: new Vector3(), addEventListener: (type: string, fn: () => void) => listeners.set(type, fn) } as unknown as OrbitControls;
  const views = machineViews(6, 40);
  const rig = createCameraRig(camera, controls, views);
  const spherical = (): { elevation: number; azimuth: number; radius: number } => {
    const s = new Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    return { elevation: 90 - (s.phi * 180) / Math.PI, azimuth: (s.theta * 180) / Math.PI, radius: s.radius };
  };
  const run = (seconds: number): void => {
    for (let t = 0; t < seconds; t += 1 / 60) rig.update(1 / 60);
  };
  return { camera, controls, views, rig, spherical, run, listeners };
}

describe("camera rig", () => {
  it("jumps to the default view and glides to a preset in 0.55 s plus 1.5 ms per mm of travel", () => {
    const { rig, views, spherical, run, controls } = setup();
    rig.setPreset("default", { instant: true });
    expect(spherical().elevation).toBeCloseTo(views.default.elevation, 4);
    rig.setPreset("reading");
    expect(rig.busy).toBe(true);
    run(0.5);
    expect(rig.busy).toBe(true); // shorter than the minimum duration
    run(2);
    expect(rig.busy).toBe(false);
    expect(spherical().elevation).toBeCloseTo(views.reading.elevation, 3);
    expect(controls.target.distanceTo(views.reading.target)).toBeLessThan(1e-6);
  });

  it("keeps the user's orbit as an offset while following the teardown", () => {
    const { rig, camera, controls, views, spherical, run } = setup();
    rig.setPreset("default", { instant: true });
    // the user orbits 30 degrees to the right
    const s = new Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    s.theta += (30 * Math.PI) / 180;
    camera.position.setFromSpherical(s).add(controls.target);
    rig.setTeardown(1);
    run(4);
    expect(rig.busy).toBe(false);
    expect(spherical().azimuth).toBeCloseTo(views.exploded.azimuth + 30 + (views.default.azimuth - views.default.azimuth), 1);
    // and goes back with the same offset
    rig.setTeardown(0);
    run(4);
    expect(spherical().azimuth).toBeCloseTo(views.default.azimuth + 30, 1);
  });

  it("never lets the camera under the ground (polar angle at most 88 degrees)", () => {
    const { rig, camera, controls, run } = setup();
    rig.setPreset("level", { level: 2, instant: true });
    rig.setTeardown(1);
    run(4);
    expect(camera.position.y - controls.target.y).toBeGreaterThan(0);
  });
});
