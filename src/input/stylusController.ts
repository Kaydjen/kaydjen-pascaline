import { Matrix4, Quaternion, type Ray, Vector2, Vector3 } from "three";
import { stylusParkedPose } from "../parts/stylus";
import type { Assembly } from "../scene/assembly";
import { ASSEMBLED_S } from "../scene/teardown";
import { STEP_DEG } from "../sim/params";
import type { Mechanism } from "../sim/mechanism";
import {
  AXIS_GEAR,
  AXIS_WHEEL,
  angleDelta,
  clockwiseAngle,
  dialFor,
  dialKind,
  gapTip,
  gearGapAngle,
  hoverZ,
  nearestGearGap,
  nearestWheelGap,
  STOP_ANGLE,
  wheelGapAngle,
  type Dial,
  type DialKind,
} from "./dialing";
import type { Hit, HitTester } from "./hits";

/** Where the stylus is: on its stand, held by the pointer, or inserted in a wheel or gear and being dragged. */
export type StylusState = "slot" | "hand" | "inserted" | "returning";

/** Source of a stylus pose: the mouse controller and the ghost stylus (demo) both implement it. */
export interface StylusSource {
  pose(): { tip: Vector3; pressed: boolean };
}

export interface StylusHost {
  assembly(): Assembly;
  mechanism(): Mechanism;
  teardown(): number;
}

/** Spring that pulls the stylus tip to its target: stiffness 180 per s^2, damping ratio 0.8. */
const STIFFNESS = 180;
/** While inserted the tip follows the wheel much more tightly. */
const STIFFNESS_INSERTED = 1600;
const TAKEN_KEY = "pascaline.stylusTaken";
const Y = new Vector3(0, 1, 0);
/** Orientation of the parked stylus: the knob (local +y) points to -y, towards the wheels. */
const PARKED_QUATERNION = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);

/** Free end of the stylus above a plane: where the ray meets it, or null. */
function intersectPlane(ray: Ray, axis: "x" | "y" | "z", value: number): Vector3 | null {
  const d = ray.direction[axis];
  if (Math.abs(d) < 1e-4) return null;
  const t = (value - ray.origin[axis]) / d;
  return t > 0 ? ray.origin.clone().addScaledVector(ray.direction, t) : null;
}

/**
 * The stylus: picking it up, hovering on a surface above the wheels (or above gear 45 when the machine is apart), snapping into
 * a gap, and turning a wheel by dragging. One state machine for both: only the target depends on the teardown amount.
 */
export class StylusController implements StylusSource {
  state: StylusState = "slot";
  private readonly position = new Vector3();
  private readonly velocity = new Vector3();
  private readonly orientation = new Quaternion();
  private readonly toLocal = new Matrix4();
  private pointer: Vector2 | null = null;
  private pressed = false;
  /** Hover target under the pointer (wheel or gear and the nearest gap), or null. */
  private over: { dial: Dial; gap: number } | null = null;
  private drag: { dial: Dial; gap: number; anchorU: number; lastAngle: number; swept: number; effective: number; maxDeg: number; s: number } | null = null;
  /** The current drag is made by the bare pointer (lid open), not by the stylus. */
  private cursorDrag = false;

  constructor(
    private readonly host: StylusHost,
    private readonly hits: HitTester,
  ) {
    this.position.copy(this.parkedPosition()); // the stylus starts on its stand
    try {
      this.taken = localStorage.getItem(TAKEN_KEY) === "1";
    } catch {
      // storage unavailable: the highlight shows again
    }
    if (new URLSearchParams(location.search).has("hint")) this.taken = false; // ?hint shows the first-visit highlight again (for review)
  }

  /** The stylus has been taken before (remembered between visits). */
  private taken = false;
  /** The stand highlight runs only once the page is visible (the load takes seconds); a rebuilt assembly picks it up from here. */
  private hintArmed = false;

  /** Called when the scene becomes visible: from now on the stand breathes until the first take. */
  armHint(): void {
    this.hintArmed = true;
  }

  get dragging(): boolean {
    return this.state === "inserted" || this.cursorDrag;
  }

  /** Once the lid is up the stylus rests on its stand and the bare pointer turns wheels and gears. */
  get cursorMode(): boolean {
    return this.host.teardown() >= ASSEMBLED_S;
  }

  /** The dial the pointer is over (for the hover hint lamp), or null. */
  get hovered(): { kind: DialKind; level: number; gap: number } | null {
    return this.over ? { kind: this.over.dial.kind, level: this.over.dial.level, gap: this.over.gap } : null;
  }

  setPointer(ndc: Vector2 | null): void {
    this.pointer = ndc;
  }

  pose(): { tip: Vector3; pressed: boolean } {
    return { tip: this.position.clone(), pressed: this.pressed };
  }

  /** Picks the stylus up from its stand (it flies to the pointer). */
  pickUp(): void {
    if (this.state !== "slot" && this.state !== "returning") return;
    if (this.cursorMode) return;
    const assembly = this.host.assembly();
    assembly.stylusParked = false;
    if (!this.taken) {
      this.taken = true;
      try {
        localStorage.setItem(TAKEN_KEY, "1");
      } catch {
        // storage unavailable: nothing to remember
      }
    }
    this.position.copy(assembly.stylus.position);
    this.velocity.set(0, 0, 0);
    this.orientation.copy(assembly.stylus.quaternion);
    this.state = "hand";
  }

  /** Esc or a click on the stand: the stylus goes back to the stand. */
  park(): void {
    if (this.state === "slot") return;
    this.release();
    this.state = "returning";
  }

  /** True when a press at the current pointer was taken by the stylus (so that other click behaviours stay quiet). */
  press(hit: Hit | null): boolean {
    void hit;
    if (this.cursorMode) {
      if (this.over && !this.cursorDrag) {
        this.startDrag(this.over.dial, this.over.gap);
        this.cursorDrag = true;
        return true;
      }
      return false;
    }
    if (this.state === "hand") {
      if (this.over) {
        this.insert(this.over.dial, this.over.gap);
        return true;
      }
    }
    return false;
  }

  /** Releases the wheel (the stylus lifts out); safe to call at any time. */
  release(): void {
    if (this.drag) this.host.mechanism().setDrive(this.drag.dial.level, null);
    this.drag = null;
    this.cursorDrag = false;
    this.pressed = false;
    if (this.state === "inserted") this.state = "hand";
  }

  private parkedPosition(): Vector3 {
    const params = this.host.assembly().mechanismParams();
    const park = stylusParkedPose((params.levelCount * params.levelPitch) / 2);
    return new Vector3(park.x, park.y, park.z);
  }

  private insert(dial: Dial, gap: number): void {
    this.startDrag(dial, gap);
    this.pressed = true;
    this.state = "inserted";
  }

  private startDrag(dial: Dial, gap: number): void {
    const u = this.host.mechanism().levels[dial.level]!.u;
    const gapAngle = dial.kind === "wheel" ? wheelGapAngle(gap, u) : gearGapAngle(gap, u);
    const lastAngle = this.pointerAngle(dial) ?? gapAngle;
    // a lid wheel stops when the gap meets the stop lever; gear 45 has no stop (several digits per drag)
    const maxDeg = dial.kind === "wheel" ? ((STOP_ANGLE - gapAngle + 720) % 360) : Infinity;
    this.drag = { dial, gap, anchorU: u, lastAngle, swept: 0, effective: 0, maxDeg, s: this.host.teardown() };
  }

  /** Follows the pointer about the dial axis: the dial only turns forward and no further than its stop. */
  private driveDrag(drag: NonNullable<StylusController["drag"]>): void {
    const mech = this.host.mechanism();
    const angle = this.pointerAngle(drag.dial);
    if (angle !== null) {
      drag.swept += angleDelta(drag.lastAngle, angle);
      drag.lastAngle = angle;
    }
    drag.effective = Math.min(Math.max(drag.effective, drag.swept), drag.maxDeg);
    mech.setDrive(drag.dial.level, drag.anchorU + drag.effective / STEP_DEG);
  }

  /** The pointer ray in machine coordinates (x right, y away, z up). */
  private localRay(): Ray | null {
    if (!this.pointer) return null;
    const machine = this.host.assembly().machine;
    machine.updateWorldMatrix(true, false);
    this.toLocal.copy(machine.matrixWorld).invert();
    const ray = this.hits.ray(this.pointer).clone();
    ray.applyMatrix4(this.toLocal);
    return ray;
  }

  /** Angle of the pointer about the dial axis, in the dial's own convention. */
  private pointerAngle(dial: Dial): number | null {
    const ray = this.localRay();
    if (!ray) return null;
    if (dial.kind === "wheel") {
      const p = intersectPlane(ray, "z", dial.centre.z);
      return p ? clockwiseAngle(p.x - dial.centre.x, p.y - dial.centre.y) : null;
    }
    const p = intersectPlane(ray, "y", dial.centre.y);
    return p ? clockwiseAngle(p.x - dial.centre.x, p.z - dial.centre.z) : null;
  }

  /** Looks for a dial under the pointer of the kind that matches the teardown amount. */
  private findOver(): void {
    this.over = null;
    if (!this.pointer) return;
    const s = this.host.teardown();
    // with the lid up both the wheels on it and gear 45 can be turned (by the pointer); closed, only the wheels
    const kinds: DialKind[] = this.cursorMode ? ["wheel", "gear"] : [dialKind(s)];
    const hit = this.hits.pick(this.pointer, (name) => kinds.some((k) => name.startsWith(`${k}:`)));
    if (!hit) return;
    const kind: DialKind = hit.name.startsWith("wheel:") ? "wheel" : "gear";
    const level = Number(hit.name.split(":")[1]);
    const params = this.host.assembly().mechanismParams();
    const dial = dialFor(kind, level, params.levelCount, params.levelPitch, s);
    // the angle comes from the ray meeting the dial's own plane (the hit disc is taller than the wheel: its top face would skew it)
    const angle = this.pointerAngle(dial);
    if (angle === null) return;
    const u = this.host.mechanism().levels[level]!.u;
    const gap = kind === "wheel" ? nearestWheelGap(angle, u) : nearestGearGap(angle, u);
    this.over = { dial, gap };
  }

  /** True when a point of the hover plane lies over the machine (a grazing ray from a low camera meets the plane far away). */
  private onStage(p: Vector3): boolean {
    const params = this.host.assembly().mechanismParams();
    const halfX = (params.levelCount * params.levelPitch) / 2 + 40;
    return Math.abs(p.x) <= halfX && p.y >= -80 && p.y <= 95;
  }

  /**
   * Where the stylus hovers when the pointer is not over the hover plane (camera low, looking at the walls): just in front of the
   * surface under the pointer, or at the depth of the machine when the pointer is over empty space. It follows the pointer on screen.
   */
  private surfaceTarget(): Vector3 | null {
    if (!this.pointer) return null;
    const machine = this.host.assembly().machine;
    machine.updateWorldMatrix(true, false);
    const ray = this.hits.ray(this.pointer);
    const hit = this.hits.pick(this.pointer, (name) => name !== "stylus");
    const depth = hit ? Math.max(hit.distance - 8, 5) : ray.origin.distanceTo(machine.getWorldPosition(new Vector3()));
    return machine.worldToLocal(ray.at(depth, new Vector3()));
  }

  update(dt: number): void {
    const assembly = this.host.assembly();
    assembly.standHint = this.hintArmed && !this.taken;
    const step = Math.min(dt, 1 / 30);
    if (this.cursorMode) {
      if (this.state === "hand" || this.state === "inserted") this.park(); // the lid went up: the stylus goes back to its stand
      if (this.drag && this.cursorDrag) {
        if (Math.abs(this.drag.s - this.host.teardown()) > 1e-3) this.release(); // the dial moved away under the pointer
        else this.driveDrag(this.drag);
      } else {
        this.findOver();
      }
    } else if (this.cursorDrag) {
      this.release();
    }
    if (this.state === "slot") {
      assembly.stylusParked = true;
      if (!this.cursorMode) this.over = null;
      return;
    }
    let target: Vector3;
    let axis = AXIS_WHEEL;
    let wanted: Quaternion | null = null;
    let stiffness = STIFFNESS;
    if (this.state === "returning") {
      target = this.parkedPosition();
      wanted = PARKED_QUATERNION;
      if (!this.cursorMode) this.over = null;
      if (this.position.distanceTo(target) < 0.4 && this.velocity.length() < 2) {
        this.state = "slot";
        assembly.stylusParked = true;
        return;
      }
    } else if (this.state === "hand") {
      this.findOver();
      const s = this.host.teardown();
      if (this.over) {
        const u = this.host.mechanism().levels[this.over.dial.level]!.u;
        target = gapTip(this.over.dial, this.over.gap, u, false);
        if (this.over.dial.kind === "gear") axis = AXIS_GEAR;
      } else {
        const ray = this.localRay();
        const p = ray ? intersectPlane(ray, "z", hoverZ(s)) : null;
        target = p && this.onStage(p) ? p : (this.surfaceTarget() ?? this.position.clone());
        if (dialKind(s) === "gear") axis = AXIS_GEAR;
      }
    } else {
      const drag = this.drag!;
      this.driveDrag(drag);
      const u = this.host.mechanism().levels[drag.dial.level]!.u;
      target = gapTip(drag.dial, drag.gap, u, true);
      stiffness = STIFFNESS_INSERTED;
      if (drag.dial.kind === "gear") axis = AXIS_GEAR;
    }
    // critically damped spring towards the target (semi-implicit Euler, sub-stepped so that fast flicks stay stable)
    const damping = 2 * 0.8 * Math.sqrt(stiffness);
    const sub = Math.max(1, Math.ceil(step / (1 / 240)));
    const h = step / sub;
    for (let i = 0; i < sub; i++) {
      this.velocity.addScaledVector(target.clone().sub(this.position), stiffness * h).addScaledVector(this.velocity, -damping * h);
      this.position.addScaledVector(this.velocity, h);
    }
    this.orientation.slerp(wanted ?? new Quaternion().setFromUnitVectors(Y, axis), 1 - Math.exp(-step * 12));
    assembly.stylusParked = false;
    assembly.stylus.position.copy(this.position);
    assembly.stylus.quaternion.copy(this.orientation);
  }
}

