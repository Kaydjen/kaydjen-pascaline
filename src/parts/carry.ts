import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh } from "three";
import { getMaterial } from "../materials/factory";
import { armRestElevationDeg, STEP_DEG, type MechanismParams } from "../sim/params";
import { at, box, cylinder, forgedBox, R, RAD, tag } from "./common";
import { FLOOR_TOP } from "./case";
import { DIM } from "./dimensions";

/** Half-width of the pawl and sautoir tips (thin blades). */
const TIP_HALF_WIDTH = 0.8;
/** Angle between a pin and a blade resting against its side, seen from the wheel axis. */
const PIN_HALF_DEG = (Math.asin((DIM.pinRadius + TIP_HALF_WIDTH) / R) * 180) / Math.PI;
/** The sautoir points here, clockwise from up, when the body rests on the stop bar: just behind a pin of gear 48. */
export const SAUTOIR_REST_DEG = 108 - PIN_HALF_DEG;
const ARM_THICKNESS = 3.4;
/** Radial position of the pawl and sautoir lever centrelines: the pins pass underneath, the hook hangs down to the pin circle. */
export const LEVER_Z = R + 4.1;
const LEVER_THICKNESS = 2.2;
/** Tangential lever lengths from pivot to hook; the pivot stands upstream of the hook so a pin pushes the hook towards the pivot. */
export const PAWL_LEVER_LENGTH = 12;
export const SAUTOIR_LEVER_LENGTH = 10;
/** The pivot supports (posts, risers) end here (y), the lever lies on top of them. */
export const LEVER_BOTTOM_Y = DIM.y.gear48 - 1.5;
/** Stop bar centre below the arm line (mm): half its 3 mm width, so the top face touches the leg face. */
const STOP_OFFSET = 1.5;
/** Height of the rail that carries the pawl posts; top of the floor. */
export const RAIL_Z = 36;
const BASE_TOP = FLOOR_TOP;
/** Backstop pawl tip direction; it sits just behind a pin whenever a wheel rests on a detent. */
export const PAWL_DEG = -PIN_HALF_DEG;

/**
 * Lever pivoting about a vertical pin at its origin: a bar along local +x with a thin hook at its far end that
 * hangs down (local -z) to the pin circle. Local +z is radial outward when the parent frame is aligned to the hook.
 */
function hookLever(length: number, body: string): Group {
  const steel = getMaterial("steel");
  const lever = tag(new Group(), body);
  lever.add(at(forgedBox(length, 3, LEVER_THICKNESS, steel), length / 2, 0, 0));
  const hookLength = LEVER_THICKNESS / 2 + (LEVER_Z - R);
  const hook = at(forgedBox(2 * TIP_HALF_WIDTH, 3, hookLength, steel, 0.25), length, 0, (LEVER_THICKNESS / 2 - (LEVER_Z - R)) / 2);
  hook.userData.hook = true;
  lever.add(hook);
  lever.add(at(cylinder(1.2, 2, "y", steel, 12), 0, 2.5, 0));
  return lever;
}

/** Place of a point given in a frame turned by `deg` (clockwise from up) around the axis: (tangential, radial) -> (x, z). */
function frameToLevel(deg: number, tangential: number, radial: number): { x: number; z: number } {
  const a = deg * RAD;
  return { x: radial * Math.sin(a) + tangential * Math.cos(a), z: radial * Math.cos(a) - tangential * Math.sin(a) };
}

/** Leaf spring ribbon: samples along a quadratic curve, two vertex rows spread along y. */
const SPRING_SAMPLES = 14;
const SPRING_HALF_WIDTH = 1.25;

function springGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(SPRING_SAMPLES * 2 * 3), 3));
  const index: number[] = [];
  for (let k = 0; k < SPRING_SAMPLES - 1; k++) {
    const a = 2 * k;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setIndex(index);
  return geometry;
}

export function shapeSpring(geometry: BufferGeometry, anchor: [number, number], control: [number, number], end: [number, number]): void {
  const position = geometry.getAttribute("position") as BufferAttribute;
  for (let k = 0; k < SPRING_SAMPLES; k++) {
    const t = k / (SPRING_SAMPLES - 1);
    const x = (1 - t) ** 2 * anchor[0] + 2 * (1 - t) * t * control[0] + t * t * end[0];
    const z = (1 - t) ** 2 * anchor[1] + 2 * (1 - t) * t * control[1] + t * t * end[1];
    position.setXYZ(2 * k, x, DIM.y.gear48 - SPRING_HALF_WIDTH, z);
    position.setXYZ(2 * k + 1, x, DIM.y.gear48 + SPRING_HALF_WIDTH, z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

/**
 * Radial lift of a blade tip whose inner end rests on the pin circle between two pins: while a pin
 * passes underneath, the blade rides over its surface (zero when the pin is beside it, up to the
 * pin radius when the pin is straight below).
 */
export function tipLift(tipDeg: number, wheelSteps: number): number {
  const offset = (((wheelSteps * STEP_DEG - tipDeg + STEP_DEG / 2) % STEP_DEG) + STEP_DEG) % STEP_DEG - STEP_DEG / 2;
  const lateral = R * Math.sin(Math.abs(offset) * RAD);
  const reach = Math.max(0, lateral - TIP_HALF_WIDTH);
  return reach >= DIM.pinRadius ? 0 : Math.sqrt(DIM.pinRadius ** 2 - reach ** 2);
}

/** Angle of the carry arm at rest, clockwise from up. */
export const armRestDeg = (params: MechanismParams): number => 90 - armRestElevationDeg(params);

/**
 * Backstop pawl of one level: a lever on a pivot upstream of the hook, resting on a post that hangs from the rail.
 * Mounted on `level`; returns the lever that rides over the pins.
 */
export function buildPawl(level: Group, index: number): Group {
  const frameMaterial = getMaterial("brass-frame");
  const pawlPivot = frameToLevel(PAWL_DEG, -PAWL_LEVER_LENGTH, LEVER_Z);
  const pawlLever = hookLever(PAWL_LEVER_LENGTH, `pawl:${index}`);
  const pawlFrame = at(new Group(), pawlPivot.x, DIM.y.gear48, pawlPivot.z);
  pawlFrame.rotation.y = PAWL_DEG * RAD;
  pawlFrame.add(pawlLever);
  level.add(pawlFrame);
  const postBottom = pawlPivot.z - 2;
  level.add(tag(at(box(3, 3, RAIL_Z - postBottom, frameMaterial), pawlPivot.x, LEVER_BOTTOM_Y - 1.5, (RAIL_Z + postBottom) / 2), "fixed"));
  pawlLever.name = `pawl:${index}`;
  pawlLever.traverse((o) => void (o.userData.hook === true && (o.name = `pawlTip:${index}`)));
  return pawlLever;
}

export interface CarryParts {
  body: Group;
  sautoirLever: Group;
  spring: BufferGeometry;
}

/**
 * Carry assembly of a receiving level (not the units level): hub and bridge above the own bars, a leg that drops to the
 * bar plane beyond the bar circle, and the sautoir on a riser at the gear-48 plane. Mounted on `level`.
 */
export function buildCarry(level: Group, index: number, params: MechanismParams): CarryParts {
  const carryMetal = getMaterial("brass-forged");
  const frameMaterial = getMaterial("brass-frame");
  const dark = getMaterial("brass-dark");
  const rest = armRestDeg(params);
  // the sautoir sits at an offset against the arm so that its tip rests just behind a pin
  const sautoirOffsetDeg = SAUTOIR_REST_DEG - rest;
  const legLength = params.armReach - 20;

  const body = tag(new Group(), `body:${index}`);
  level.add(body);
  const hubY = DIM.y.hub;
  const legY = DIM.y.leg;
  body.add(at(cylinder(6, 3, "y", carryMetal, 24), 0, hubY, 0));
  body.add(at(forgedBox(ARM_THICKNESS, 3, 23, carryMetal), -ARM_THICKNESS / 2, hubY, 11.5));
  body.add(at(forgedBox(ARM_THICKNESS, hubY - legY + 2.5, 3, carryMetal), -ARM_THICKNESS / 2, (hubY + legY) / 2 - 0.25, 21.5));
  const leg = at(forgedBox(ARM_THICKNESS, 4, legLength, carryMetal), -ARM_THICKNESS / 2, legY, 20 + legLength / 2);
  leg.userData.kind = "leg";
  body.add(leg);

  // sautoir (paper items 67, 68): the body's bridge runs under the pin ring at the hub plane and outside the ring
  // rises to a pivot; the sautoir lever lies on it. A leaf spring from a stub presses on the lever.
  const sautoir = new Group();
  sautoir.rotation.y = sautoirOffsetDeg * RAD;
  body.add(sautoir);
  const L = SAUTOIR_LEVER_LENGTH;
  const riserTop = LEVER_BOTTOM_Y;
  sautoir.add(at(forgedBox(2.4, 3, LEVER_Z + 1.2, carryMetal), 0, hubY, (LEVER_Z + 1.2) / 2));
  sautoir.add(at(forgedBox(L + 2.4, 3, 2.4, carryMetal), -L / 2, hubY, LEVER_Z));
  sautoir.add(at(forgedBox(2.4, riserTop - (hubY - 1.5), 4.6, carryMetal), -L, (riserTop + hubY - 1.5) / 2, LEVER_Z + 1.1));
  sautoir.add(at(forgedBox(1.6, 3, 1.6, carryMetal), -L, DIM.y.gear48, LEVER_Z + 3.5));
  const sautoirLever = hookLever(L, `sautoir:${index}`);
  sautoirLever.position.set(-L, DIM.y.gear48, LEVER_Z);
  sautoir.add(sautoirLever);
  const spring = springGeometry();
  const springMaterial = getMaterial("steel").clone();
  springMaterial.side = DoubleSide;
  const springMesh = new Mesh(spring, springMaterial);
  springMesh.userData.dynamic = true; // its shape is rebuilt every frame
  sautoir.add(springMesh);

  // stop bar below the leg at rest, touching the leg face; it stands on a post on the base plate
  // 2.4 mm tall, above the bar tips of the level below (they reach y = 9.5)
  const stop = tag(at(box(3, 2.4, 3, dark), 0, legY + 0.8, 0), "fixed");
  stop.userData.kind = "stop";
  const r = rest * RAD;
  stop.position.set(30 * Math.sin(r) + STOP_OFFSET * Math.cos(r), legY + 0.8, 30 * Math.cos(r) - STOP_OFFSET * Math.sin(r));
  stop.rotation.y = r;
  level.add(stop);
  const postTop = stop.position.z - 2;
  level.add(tag(at(box(3, 2.4, postTop - BASE_TOP, frameMaterial), stop.position.x, legY + 0.8, (postTop + BASE_TOP) / 2), "fixed"));

  body.name = `carryBody:${index}`;
  sautoirLever.name = `sautoir:${index}`;
  sautoirLever.traverse((o) => void (o.userData.hook === true && (o.name = `sautoirTip:${index}`)));
  leg.name = `carryContact:${index}`;
  stop.name = `stop:${index}`;
  return { body, sautoirLever, spring };
}

/** Poses the pawl lever and the carry parts of one level for wheel position `u` (steps) and body lift (degrees). */
export function poseCarry(pawlLever: Group, carry: CarryParts | null, u: number, lift: number, params: MechanismParams): void {
  // a hook rides over each pin that passes under it: the lever turns about its pivot by the lift of the hook
  pawlLever.rotation.y = -Math.asin(tipLift(PAWL_DEG, u) / PAWL_LEVER_LENGTH);
  if (!carry) return;
  carry.body.rotation.y = (armRestDeg(params) - lift) * RAD;
  const phi = Math.asin(tipLift(SAUTOIR_REST_DEG - lift, u) / SAUTOIR_LEVER_LENGTH);
  carry.sautoirLever.rotation.y = -phi;
  // the spring leans on the lever's outer edge 8.5 mm from the pivot
  const L = SAUTOIR_LEVER_LENGTH;
  const end: [number, number] = [-L + 8.5 * Math.cos(phi) - 1.1 * Math.sin(phi), LEVER_Z + 8.5 * Math.sin(phi) + 1.1 * Math.cos(phi) + 0.05];
  shapeSpring(carry.spring, [-L + 0.8, LEVER_Z + 3.5], [-L / 2 - 0.5, LEVER_Z + 5.4], end);
}
