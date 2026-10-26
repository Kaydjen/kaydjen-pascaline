import { BufferGeometry, CanvasTexture, CylinderGeometry, Float32BufferAttribute, Group, LatheGeometry, Mesh, MeshStandardMaterial, RingGeometry, SRGBColorSpace, Vector2 } from "three";
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
const WHEEL_THICKNESS = 1.5;
const WHEEL_CLEARANCE = 0.3;
const INPUT_WHEEL_Z = LID_TOP + WHEEL_CLEARANCE + WHEEL_THICKNESS / 2 - INPUT_GEAR_Z;
/** The lower input shaft ends in the bearing bar under the lid; the pin above it belongs to the same wheel group (teardown view). */
const INPUT_BEARING_Z = LID_BOTTOM - 0.2 - 1.5 - INPUT_GEAR_Z;
const INPUT_SHAFT_LENGTH = INPUT_BEARING_Z - INPUT_SHAFT_BOTTOM;
/** Top of the wheel's spokes (group frame): the hub disc and the nut stand on it. */
const WHEEL_TOP_Z = INPUT_WHEEL_Z + WHEEL_THICKNESS / 2;
/** Hub disc on the input wheel: carries the numerals that show the wheel's count against the stop. */
const HUB_DISC_RADIUS = 8.1; // the numeral plate
const HUB_PLATE_THICKNESS = 0.3; // at the rim
const HUB_PLATE_DOME = 0.5; // how much higher the plate stands at its centre than at its rim (photos)
const HUB_PLATE_SHIFT = 0.45; // how far the plate sits off-centre, at most (mm)
/**
 * Ten flat blade spokes (user-wheel-macro-2.png, the Diderot drawings): broad where they leave the hub plate, tapering towards the
 * rim, with a rounded tip. Hub radius, tip radius and half widths at the hub and at the tip, mm [inference]. Two neighbouring
 * spokes carry three punched dots each.
 */
export const SPOKE_HUB_RADIUS = 5.5;
export const SPOKE_TIP_RADIUS = 15.6;
export const SPOKE_BASE_HALF_WIDTH = 1.9;
export const SPOKE_TIP_HALF_WIDTH = 1.5;
/** How far the top of a spoke sinks towards its tip (mm). */
const SPOKE_DROP = 0.9;
/** Spokes (0-based) that carry the dots, and the dot radii along the spoke. */
export const DOTTED_SPOKES: readonly number[] = [1, 2];
const DOT_RADII = [12.1, 13.5, 14.9];

/** Numerals on the hub disc: numeral m stands where it meets the stop when the wheel has counted m (same angles as the crown). */
function hubTexture(bump: boolean): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  if (bump) {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, size, size);
  }
  ctx.filter = "blur(0.7px)";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const scale = size / 2 / (HUB_DISC_RADIUS - 0.2);
  const radius = 5.95 * scale;
  const random = seededRandom(1642);
  const jitter = (amount: number): number => (random() * 2 - 1) * amount;
  ctx.font = `92px ${FONT_NUMERAL}`;
  for (let d = 0; d < 10; d++) {
    const a = crownAngleDeg(d) * RAD;
    ctx.save();
    ctx.translate(size / 2 + (radius + jitter(3)) * Math.sin(a), size / 2 - (radius + jitter(3)) * Math.cos(a));
    ctx.rotate(numeralRotation(a) + jitter(3) * RAD);
    const dx = jitter(2);
    const depth = 0.8 + random() * 0.7; // each cut has its own depth, all deep enough to read
    random();
    if (bump) {
      // the whole glyph is the groove; blurred copies from wide and light to sharp and dark make a bowl-shaped section
      [2.2, 1.4, 0.8, 0.3].forEach((blur, k) => {
        const level = Math.round(128 - 28 * depth * (k + 1));
        ctx.filter = `blur(${blur}px)`;
        ctx.fillStyle = `rgb(${level},${level},${level})`;
        ctx.fillText(String(d), dx, 3);
      });
    } else {
      ctx.filter = "blur(0.5px)";
      ctx.fillStyle = `rgba(28,22,16,${(0.22 + 0.3 * depth).toFixed(2)})`;
      ctx.fillText(String(d), dx, 3);
    }
    ctx.restore();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
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

/** The stretch of a dotted spoke whose top face is built cell by cell, so that the three holes are real openings with walls and a floor. */
const PATCH_FROM = 11;
const PATCH_TO = 15.5;
const HOLE_RADIUS = 0.5;
const HOLE_FLOOR = 0.35; // height of the floor of a hole above the underside

function addHolePatch(out: number[], half: (r: number) => number, top: (r: number) => number, chamfer: number, bottom: number): void {
  const columns = 52;
  const cell = 0.05;
  const rowCount = Math.round((PATCH_TO - PATCH_FROM) / cell);
  const inHole = (x: number, y: number): boolean => DOT_RADII.some((r) => Math.hypot(x, y - r) < HOLE_RADIUS);
  const xAt = (u: number, y: number): number => ((u / columns) * 2 - 1) * (half(y) - chamfer);
  const yAt = (j: number): number => PATCH_FROM + j * cell;
  const floorZ = bottom + HOLE_FLOOR;
  const emit = (a: number[], b: number[], c: number[], want: number[]): void => {
    const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
    const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
    const dot = (uy * vz - uz * vy) * want[0]! + (uz * vx - ux * vz) * want[1]! + (ux * vy - uy * vx) * want[2]!;
    out.push(...(dot >= 0 ? [...a, ...b, ...c] : [...a, ...c, ...b]));
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], want: number[]): void => {
    emit(a, b, c, want);
    emit(a, c, d, want);
  };
  const cellHole = (i: number, j: number): boolean => {
    const y = yAt(j) + cell / 2;
    return inHole(xAt(i + 0.5, y), y);
  };
  for (let j = 0; j < rowCount; j++) {
    const y0 = yAt(j), y1 = yAt(j + 1);
    for (let i = 0; i < columns; i++) {
      const p = (u: number, y: number, z: number): number[] => [xAt(u, y), y, z];
      const corners = [p(i, y0, top(y0)), p(i + 1, y0, top(y0)), p(i + 1, y1, top(y1)), p(i, y1, top(y1))];
      const hole = cellHole(i, j);
      if (hole) {
        quad(p(i, y0, floorZ), p(i + 1, y0, floorZ), p(i + 1, y1, floorZ), p(i, y1, floorZ), [0, 0, 1]);
      } else {
        quad(corners[0]!, corners[1]!, corners[2]!, corners[3]!, [0, 0, 1]);
      }
      // walls where this cell and its neighbour differ: seen from the hole side
      const sides: [number, number, number[], number[], number[]][] = [
        [i - 1, j, corners[0]!, corners[3]!, [1, 0, 0]],
        [i + 1, j, corners[1]!, corners[2]!, [-1, 0, 0]],
        [i, j - 1, corners[0]!, corners[1]!, [0, 1, 0]],
        [i, j + 1, corners[3]!, corners[2]!, [0, -1, 0]],
      ];
      for (const [ni, nj, a, b, towardsThis] of sides) {
        if (hole || ni < 0 || ni >= columns || nj < 0 || nj >= rowCount || !cellHole(ni, nj)) continue;
        // this is a solid cell next to a hole cell: the wall faces the hole, i.e. away from this cell
        const away = towardsThis.map((v) => -v);
        quad(a, b, [b[0]!, b[1]!, floorZ], [a[0]!, a[1]!, floorZ], away);
      }
    }
  }
}

/**
 * One spoke as a loft of cross-sections taken every half millimetre, so that its top face is exactly a function of the radius (an extruded
 * outline lets the triangulation tilt the face across the blade): flat out to the gear's edge, then sinking towards the tip. The tip is cut
 * square, only its corners knocked off.
 */
function spokeGeometry(dotted: boolean): BufferGeometry {
  const inner = 3.5;
  const half = (r: number): number => SPOKE_BASE_HALF_WIDTH + (SPOKE_TIP_HALF_WIDTH - SPOKE_BASE_HALF_WIDTH) * Math.min(Math.max((r - SPOKE_HUB_RADIUS) / (SPOKE_TIP_RADIUS - SPOKE_HUB_RADIUS), 0), 1);
  const top = (r: number): number => {
    const t = Math.min(Math.max((r - HUB_DISC_RADIUS) / (SPOKE_TIP_RADIUS - HUB_DISC_RADIUS), 0), 1);
    return WHEEL_THICKNESS / 2 - SPOKE_DROP * t * t * (3 - 2 * t);
  };
  const bottom = -WHEEL_THICKNESS / 2;
  const chamfer = 0.1;
  const rows: { y: number; hw: number }[] = [];
  const steps = Math.round((SPOKE_TIP_RADIUS - 0.2 - inner) / 0.5);
  for (let k = 0; k <= steps; k++) {
    const y = inner + ((SPOKE_TIP_RADIUS - 0.2 - inner) * k) / steps;
    rows.push({ y, hw: half(y) });
  }
  rows.push({ y: SPOKE_TIP_RADIUS, hw: half(SPOKE_TIP_RADIUS) - 0.2 });
  // each section: bottom-left, left side top, top-left, top-right, right side top, bottom-right
  const section = ({ y, hw }: { y: number; hw: number }): number[][] => {
    const z = top(y);
    return [[-hw, y, bottom], [-hw, y, z - chamfer], [-hw + chamfer, y, z], [hw - chamfer, y, z], [hw, y, z - chamfer], [hw, y, bottom]];
  };
  const n = 6;
  const positions: number[] = [];
  for (const row of rows) for (const p of section(row)) positions.push(...p);
  const index: number[] = [];
  for (let k = 0; k < rows.length - 1; k++) {
    for (let e = 0; e < n; e++) {
      if (dotted && e === 2 && rows[k]!.y >= PATCH_FROM - 1e-6 && rows[k + 1]!.y <= PATCH_TO + 1e-6) continue; // the top face of this stretch is built cell by cell below
      const a = k * n + e;
      const b = k * n + ((e + 1) % n);
      index.push(a, b, a + n, b, b + n, a + n);
    }
  }
  const last = (rows.length - 1) * n;
  for (let e = 1; e < n - 1; e++) index.push(0, e, e + 1, last, last + e + 1, last + e);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  const flat = geometry.toNonIndexed();
  if (dotted) {
    const extra: number[] = [];
    addHolePatch(extra, half, top, chamfer, bottom);
    const merged = new Float32Array(flat.getAttribute("position").count * 3 + extra.length);
    merged.set(flat.getAttribute("position").array as Float32Array);
    merged.set(extra, flat.getAttribute("position").count * 3);
    flat.setAttribute("position", new Float32BufferAttribute(merged, 3));
  }
  flat.computeVertexNormals();
  flat.setAttribute("uv", new Float32BufferAttribute(new Float32Array((positions.length / 3) * 2 * 0 + flat.getAttribute("position").count * 2), 2));
  return flat;
}

function buildInputWheelGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let k = 0; k < DIM.pinCount; k++) {
    const spoke = spokeGeometry(DOTTED_SPOKES.includes(k));
    spoke.rotateZ(-(k + 0.5) * STEP_DEG * RAD);
    parts.push(spoke);
  }
  // the middle of the gear is as thick as the spokes at their root: one flat piece, no raised boss (photos)
  const disc = new CylinderGeometry(HUB_DISC_RADIUS - 0.1, HUB_DISC_RADIUS - 0.1, WHEEL_THICKNESS, 40).toNonIndexed();
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
  const nutMaterial = getMaterial("brass-forged"); // the nut is a darker olive than the spokes (photos)
  const dirt = getMaterial("brass-dark"); // the dark film in the joints between the layers
  const hubPlateMaterial = getMaterial("brass-hub"); // the numeral plate: the colour of the spokes, only a little more polished (user, photos)
  const hubDiscMaterial = new MeshStandardMaterial({ map: hubTexture(false), bumpMap: hubTexture(true), bumpScale: 4.5, transparent: true, metalness: 1, roughness: 0.45, depthWrite: false });
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
  group.add(at(named(new Mesh(inputWheelGeometry(), getMaterial("brass-spoke")), "starWheel"), 0, 0, INPUT_WHEEL_Z));
  // the numbered disc is built like the crown rings (photos): the gear itself, and on it a thin numeral plate that sits a
  // little off-centre, so the gear shows on one side
  const baseTop = WHEEL_TOP_Z;
  const plateTop = baseTop + HUB_PLATE_THICKNESS;
  const shift = seededRandom(1700 + level);
  const heading = shift() * Math.PI * 2;
  const offset = HUB_PLATE_SHIFT * (0.5 + shift() * 0.5);
  const hubPlate = new Group();
  hubPlate.position.set(Math.cos(heading) * offset, Math.sin(heading) * offset, 0);
  const dome = (r: number): number => HUB_PLATE_DOME * (1 - (r / HUB_DISC_RADIUS) ** 2);
  const profile = [new Vector2(HUB_DISC_RADIUS, baseTop), new Vector2(HUB_DISC_RADIUS, baseTop + HUB_PLATE_THICKNESS - 0.06)];
  for (let k = 0; k <= 12; k++) {
    const r = HUB_DISC_RADIUS * (1 - k / 12);
    profile.push(new Vector2(Math.max(r, 0.001), baseTop + HUB_PLATE_THICKNESS + dome(r) - (k === 0 ? 0.06 : 0)));
  }
  const plateBody = new LatheGeometry(profile, 56);
  plateBody.rotateX(Math.PI / 2);
  hubPlate.add(new Mesh(plateBody, hubPlateMaterial));
  const numbers = new RingGeometry(3.4, HUB_DISC_RADIUS - 0.2, 56, 6);
  const numberPosition = numbers.getAttribute("position");
  for (let k = 0; k < numberPosition.count; k++) numberPosition.setZ(k, plateTop + dome(Math.hypot(numberPosition.getX(k), numberPosition.getY(k))) + 0.02);
  numbers.computeVertexNormals();
  hubPlate.add(new Mesh(numbers, hubDiscMaterial));
  group.add(hubPlate);
  // dirt packed into the joints (as the grime on the lid): a thin dark ring where the plate meets the gear
  hubPlate.add(at(new Mesh(new RingGeometry(HUB_DISC_RADIUS - 0.1, HUB_DISC_RADIUS + 0.1, 56, 1), dirt), 0, 0, baseTop + 0.01));
  // octagonal prism nut with a round boss on top (IMG_6513)
  const nutBase = plateTop + HUB_PLATE_DOME - 0.05;
  const nutGeometry = new CylinderGeometry(3.0, 3.0, 1.0, 8);
  const nut = named(at(new Mesh(nutGeometry, nutMaterial), 0, 0, nutBase + 0.5), "nut");
  nut.rotation.x = Math.PI / 2;
  nut.rotation.y = Math.PI / 8;
  group.add(nut);
  // dirt packed around the foot of the nut
  group.add(at(new Mesh(new RingGeometry(2.95, 3.12, 40, 1), dirt), 0, 0, nutBase + 0.08));
  group.add(at(cylinder(1.1, 0.5, "z", nutMaterial, 20), 0, 0, nutBase + 1.2));
  // mouse target: a disc over the wheel (radius 18, generous for a 3 mm stylus tip)
  group.add(at(hitCylinder(`wheel:${level}`, 18, 8, "z"), 0, 0, INPUT_WHEEL_Z));
  return group;
}
