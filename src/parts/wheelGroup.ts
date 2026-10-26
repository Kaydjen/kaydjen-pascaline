import { BufferGeometry, CanvasTexture, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Path, RingGeometry, Shape, SRGBColorSpace, TorusGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { getMaterial } from "../materials/factory";
import { FONT_NUMERAL } from "../materials/fonts";
import { STEP_DEG } from "../sim/params";
import { at, cylinder, named, R, RAD, shaft, tag } from "./common";
import { crownAngleDeg, LID_BOTTOM, LID_TOP, numeralRotation, seededRandom } from "./case";
import { DIM, INPUT_GEAR_Z, INPUT_SHAFT_Y } from "./dimensions";
import { PIN_HUB_RADIUS, pinWheelPlate } from "./gears";
import { hitCylinder } from "./proxies";

/** Input shaft (axis z, group frame at the gear-40 disc): from just below the support bar to the wheel centre. */
export const INPUT_SHAFT_BOTTOM = -7;
/** The thin star wheel lies just above the closed lid plate (and its dark disc): z of its middle plane, spec frame. */
const WHEEL_THICKNESS = 1.2;
const WHEEL_CLEARANCE = 0.3;
const INPUT_WHEEL_Z = LID_TOP + WHEEL_CLEARANCE + WHEEL_THICKNESS / 2 - INPUT_GEAR_Z;
/** The lower input shaft ends in the bearing bar under the lid; the pin above it belongs to the same wheel group (teardown view). */
const INPUT_BEARING_Z = LID_BOTTOM - 0.2 - 1.5 - INPUT_GEAR_Z;
const INPUT_SHAFT_LENGTH = INPUT_BEARING_Z - INPUT_SHAFT_BOTTOM;
/** Top of the wheel's spokes (group frame): the hub disc and the nut stand on it. */
const WHEEL_TOP_Z = INPUT_WHEEL_Z + WHEEL_THICKNESS / 2;
/** Hub disc on the input wheel: carries the numerals that show the wheel's count against the stop. */
const HUB_DISC_RADIUS = 7.6;
const HUB_DISC_THICKNESS = 0.5;
/**
 * Ten flat blade spokes (user-wheel-macro-2.png, the Diderot drawings): broad where they leave the hub plate, tapering towards the
 * rim, with a rounded tip. Hub radius, tip radius and half widths at the hub and at the tip, mm [inference]. Two neighbouring
 * spokes carry three punched dots each.
 */
export const SPOKE_HUB_RADIUS = 5.5;
export const SPOKE_TIP_RADIUS = 15.6;
export const SPOKE_BASE_HALF_WIDTH = 1.55;
export const SPOKE_TIP_HALF_WIDTH = 0.7;
/** Spokes (0-based) that carry the dots, and the dot radii along the spoke. */
export const DOTTED_SPOKES: readonly number[] = [1, 2];
const DOT_RADII = [12.1, 13.5, 14.9];
const DOT_SIZE = 0.3;

/** Numerals on the hub disc: numeral m stands where it meets the stop when the wheel has counted m (same angles as the crown). */
function hubTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#2a2012";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const scale = size / 2 / (HUB_DISC_RADIUS - 0.2);
  const radius = 5.6 * scale;
  const random = seededRandom(1642);
  const jitter = (amount: number): number => (random() * 2 - 1) * amount;
  ctx.font = `70px ${FONT_NUMERAL}`;
  for (let d = 0; d < 10; d++) {
    const a = crownAngleDeg(d) * RAD;
    ctx.save();
    ctx.translate(size / 2 + (radius + jitter(3)) * Math.sin(a), size / 2 - (radius + jitter(3)) * Math.cos(a));
    ctx.rotate(numeralRotation(a) + jitter(3) * RAD);
    ctx.fillText(String(d), jitter(2), 3);
    ctx.restore();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Spoke outline in (tangential x, radial y), spoke pointing up; `dotted` punches three small holes near the tip. */
function spokeShape(dotted: boolean): Shape {
  const inner = 3.5;
  const half = (r: number): number => SPOKE_BASE_HALF_WIDTH + (SPOKE_TIP_HALF_WIDTH - SPOKE_BASE_HALF_WIDTH) * Math.min(Math.max((r - SPOKE_HUB_RADIUS) / (SPOKE_TIP_RADIUS - SPOKE_HUB_RADIUS), 0), 1);
  const shape = new Shape();
  shape.moveTo(-half(inner), inner);
  shape.lineTo(half(inner), inner);
  const tipHalf = half(SPOKE_TIP_RADIUS);
  shape.lineTo(tipHalf, SPOKE_TIP_RADIUS - tipHalf);
  shape.absarc(0, SPOKE_TIP_RADIUS - tipHalf, tipHalf, 0, Math.PI, false); // rounded tip
  shape.closePath();
  if (dotted) {
    for (const r of DOT_RADII) {
      const hole = new Path();
      hole.absarc(0, r, DOT_SIZE, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
  }
  return shape;
}

/**
 * Input wheel: a small hub disc with ten flat paddle spokes, axis z, thin, centred on z = 0.
 * The stylus gap k (between two spokes) is centred at step k.
 */
let wheelCache: BufferGeometry | null = null;

function inputWheelGeometry(): BufferGeometry {
  wheelCache ??= buildInputWheelGeometry();
  return wheelCache.clone();
}

function buildInputWheelGeometry(): BufferGeometry {
  const bevel = 0.1;
  const parts: BufferGeometry[] = [];
  for (let k = 0; k < DIM.pinCount; k++) {
    const spoke = new ExtrudeGeometry(spokeShape(DOTTED_SPOKES.includes(k)), { depth: WHEEL_THICKNESS - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
    spoke.translate(0, 0, -WHEEL_THICKNESS / 2 + bevel);
    spoke.rotateZ(-(k + 0.5) * STEP_DEG * RAD);
    parts.push(spoke);
  }
  const disc = new CylinderGeometry(SPOKE_HUB_RADIUS + 0.3, SPOKE_HUB_RADIUS + 0.3, WHEEL_THICKNESS, 32).toNonIndexed();
  disc.rotateX(Math.PI / 2);
  parts.push(disc);
  return mergeGeometries(parts)!;
}

/**
 * Everything that turns with one input shaft and rides in the lid assembly: the pin cage (gear 40) with its shaft, the star
 * wheel and its hub disc and nut. Group frame at the gear-40 disc (axis z); it rotates about z by minus the level angle.
 */
export function buildWheelGroup(level: number, x: number): Group {
  const brass = getMaterial("brass-brushed");
  const steel = getMaterial("steel");
  const hubDiscMaterial = new MeshStandardMaterial({ map: hubTexture(), transparent: true, metalness: 0, roughness: 0.6, depthWrite: false });
  const group = tag(at(new Group(), x, INPUT_SHAFT_Y, INPUT_GEAR_Z), `input:${level}`);
  group.name = `wheel:${level}`;

  // gear 40: plate, hub boss, ten pins hanging down, and the shaft down to the lower support bar
  group.add(at(new Mesh(pinWheelPlate(0.8), brass), 0, 0, 0.4));
  group.add(at(cylinder(PIN_HUB_RADIUS, 1.8, "z", brass, 24), 0, 0, 0.9));
  for (let k = 0; k < DIM.pinCount; k++) {
    const a = (k * STEP_DEG + DIM.inputPinPhaseDeg) * RAD;
    group.add(at(cylinder(DIM.pinRadius, DIM.inputPinSpanZ, "z", brass, 12), R * Math.sin(a), R * Math.cos(a), -DIM.inputPinSpanZ / 2));
  }
  group.add(at(shaft(1.5, INPUT_SHAFT_LENGTH, "z", steel), 0, 0, INPUT_SHAFT_BOTTOM + INPUT_SHAFT_LENGTH / 2));

  // upper pin through the bearing bar and the closed lid, star wheel, numbered hub disc, nut and rivets
  const pinBottom = LID_BOTTOM - 0.2 - INPUT_GEAR_Z; // top of the bearing bar
  const pin = at(cylinder(1.5, INPUT_WHEEL_Z - pinBottom, "z", steel), 0, 0, (INPUT_WHEEL_Z + pinBottom) / 2);
  pin.userData.pin = true; // runs through the closed lid like the shaft below it
  group.add(pin);
  group.add(at(named(new Mesh(inputWheelGeometry(), brass), "starWheel"), 0, 0, INPUT_WHEEL_Z));
  group.add(at(cylinder(HUB_DISC_RADIUS, HUB_DISC_THICKNESS, "z", brass, 48), 0, 0, WHEEL_TOP_Z + HUB_DISC_THICKNESS / 2));
  group.add(at(new Mesh(new RingGeometry(3.6, HUB_DISC_RADIUS - 0.2, 48), hubDiscMaterial), 0, 0, WHEEL_TOP_Z + HUB_DISC_THICKNESS + 0.02));
  // octagonal chamfered nut with a round boss on top (IMG_6513)
  const nutBase = WHEEL_TOP_Z + HUB_DISC_THICKNESS;
  const nut = named(at(cylinder(3.0, 1.3, "z", brass, 8), 0, 0, nutBase + 0.65), "nut");
  nut.rotation.y = Math.PI / 8;
  group.add(nut);
  const chamfer = at(cylinder(2.55, 0.35, "z", brass, 8), 0, 0, nutBase + 1.45);
  chamfer.rotation.y = Math.PI / 8;
  group.add(chamfer);
  group.add(at(cylinder(1.35, 0.7, "z", brass, 20), 0, 0, nutBase + 1.95));
  // the numbered disc is a separate plate riveted on the spoke wheel: a raised rim and five rivets show it
  group.add(at(new Mesh(new TorusGeometry(HUB_DISC_RADIUS - 0.15, 0.2, 6, 48), brass), 0, 0, WHEEL_TOP_Z + HUB_DISC_THICKNESS));
  for (let k = 0; k < 5; k++) {
    const a = (18 + 72 * k) * RAD;
    group.add(at(cylinder(0.4, 0.35, "z", brass, 8), 6.9 * Math.sin(a), 6.9 * Math.cos(a), WHEEL_TOP_Z + HUB_DISC_THICKNESS + 0.1));
  }
  // mouse target: a disc over the wheel (radius 18, generous for a 3 mm stylus tip)
  group.add(at(hitCylinder(`wheel:${level}`, 18, 8, "z"), 0, 0, INPUT_WHEEL_Z));
  return group;
}
