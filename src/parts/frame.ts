import { BufferGeometry, ExtrudeGeometry, Group, InstancedMesh, Matrix4, Mesh, Path, Shape, SphereGeometry } from "three";
import { getMaterial } from "../materials/factory";
import type { MechanismParams } from "../sim/params";
import { at, BAR, box, named, tag } from "./common";
import { CASE_Y_BACK, CASE_Y_FRONT, FLOOR_TOP, LID_BOTTOM } from "./case";
import { DIM, INPUT_GEAR_Z, INPUT_SHAFT_Y, OUTPUT_SHAFT_Z } from "./dimensions";
import { LEVER_BOTTOM_Y, RAIL_Z } from "./carry";
import { addBoxProxy } from "./proxies";
import { OUTPUT_SHAFT_CENTRE, OUTPUT_SHAFT_LENGTH } from "./drums";
import { INPUT_SHAFT_BOTTOM } from "./wheelGroup";

const FRAME_PLATE_THICKNESS = 1.2;
const FRAME_TOP = 43.5;
/** The partition stays below the under-lid bearing bar (its underside is at z = 42.4). */
const PARTITION_TOP = 42;
/** The partition is 1 mm short of the ledge strips at the front and back wall. */
const PARTITION_Y_FROM = -33;
const PARTITION_Y_TO = 47;
const EAR_LENGTH = 8;
const EAR_THICKNESS = 1.0;

/** End plate of the frame, built in (y, z) and extruded along x: an outer plate with three rounded openings. */
function frameEndPlate(): BufferGeometry {
  const rounded = (target: Path | Shape, y0: number, z0: number, y1: number, z1: number, r: number): void => {
    target.moveTo(y0 + r, z0);
    target.lineTo(y1 - r, z0);
    target.quadraticCurveTo(y1, z0, y1, z0 + r);
    target.lineTo(y1, z1 - r);
    target.quadraticCurveTo(y1, z1, y1 - r, z1);
    target.lineTo(y0 + r, z1);
    target.quadraticCurveTo(y0, z1, y0, z1 - r);
    target.lineTo(y0, z0 + r);
    target.quadraticCurveTo(y0, z0, y0 + r, z0);
  };
  const outline = new Shape();
  rounded(outline, CASE_Y_FRONT + 4, FLOOR_TOP, CASE_Y_BACK - 4, FRAME_TOP, 4);
  for (const [y0, y1] of [[CASE_Y_FRONT + 9, -4], [0, 26], [31, CASE_Y_BACK - 9]] as const) {
    const hole = new Path();
    rounded(hole, y0, FLOOR_TOP + 5, y1, 38.5, 3);
    outline.holes.push(hole);
  }
  const geometry = new ExtrudeGeometry(outline, { depth: FRAME_PLATE_THICKNESS, bevelEnabled: false, curveSegments: 8 });
  // (u, v, w) -> spec (y, z, x)
  geometry.applyMatrix4(new Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  return geometry;
}

/**
 * Arcade strip of the frame (museum photos): a long brass strip along x whose lower edge stands on the floor in short legs
 * at every level boundary, with an arch cut between them. Built in (x, z) and extruded along y, centred on y = 0.
 */
function frameArcade(levelCount: number, pitch: number, topZ: number): BufferGeometry {
  const half = (levelCount * pitch) / 2;
  const leg = 2.5;
  const archBase = FLOOR_TOP + 8;
  const archPeak = topZ - 3;
  const boundary = (k: number): number => half - k * pitch;
  const shape = new Shape();
  shape.moveTo(-half, topZ);
  shape.lineTo(half, topZ);
  shape.lineTo(half, FLOOR_TOP);
  for (let k = 0; k < levelCount; k++) {
    const right = boundary(k) - leg;
    const left = boundary(k + 1) + leg;
    shape.lineTo(right, FLOOR_TOP);
    shape.lineTo(right, archBase);
    shape.quadraticCurveTo((left + right) / 2, archBase + 2 * (archPeak - archBase), left, archBase);
    shape.lineTo(left, FLOOR_TOP);
  }
  shape.lineTo(-half, FLOOR_TOP);
  shape.closePath();
  const thickness = 1.2;
  const geometry = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 12 });
  geometry.rotateX(Math.PI / 2); // shape (x, z) -> spec (x, z); depth -> -y
  geometry.translate(0, thickness / 2, 0);
  return geometry;
}

/** Flange of an end plate: a flat tab that would be screwed to the lid underside (user-frame-front-sothebys.png: ears with holes). Built in (x, y), extruded along z. */
function earGeometry(): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(0, -3);
  shape.lineTo(EAR_LENGTH - 2, -3);
  shape.quadraticCurveTo(EAR_LENGTH, -3, EAR_LENGTH, -1);
  shape.lineTo(EAR_LENGTH, 1);
  shape.quadraticCurveTo(EAR_LENGTH, 3, EAR_LENGTH - 2, 3);
  shape.lineTo(0, 3);
  shape.closePath();
  const hole = new Path();
  hole.absarc(EAR_LENGTH - 3, 0, 1.1, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return new ExtrudeGeometry(shape, { depth: EAR_THICKNESS, bevelEnabled: false, curveSegments: 12 });
}

/** Central partition of the frame: a thin plate across the machine between level 3 and 4 with a large opening (carry arms pass through it). Built in (y, z), extruded along x. */
function partitionGeometry(): BufferGeometry {
  const outline = new Shape();
  outline.moveTo(PARTITION_Y_FROM, FLOOR_TOP);
  outline.lineTo(PARTITION_Y_TO, FLOOR_TOP);
  outline.lineTo(PARTITION_Y_TO, PARTITION_TOP);
  outline.lineTo(PARTITION_Y_FROM, PARTITION_TOP);
  outline.closePath();
  const hole = new Path();
  hole.moveTo(PARTITION_Y_FROM + 5, FLOOR_TOP + 4);
  hole.lineTo(PARTITION_Y_FROM + 5, PARTITION_TOP - 4);
  hole.lineTo(PARTITION_Y_TO - 5, PARTITION_TOP - 4);
  hole.lineTo(PARTITION_Y_TO - 5, FLOOR_TOP + 4);
  hole.closePath();
  outline.holes.push(hole);
  const geometry = new ExtrudeGeometry(outline, { depth: FRAME_PLATE_THICKNESS, bevelEnabled: false });
  geometry.applyMatrix4(new Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  geometry.translate(-FRAME_PLATE_THICKNESS / 2, 0, 0);
  return geometry;
}

/** Row of domed rivets facing `dir` (+-1 along y) on a bar face at `faceY`. One draw call. */
function rivetRow(xs: number[], faceY: number, dir: number, z: number): InstancedMesh {
  const geometry = new SphereGeometry(0.9, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  geometry.rotateX(dir > 0 ? -Math.PI / 2 : Math.PI / 2); // dome pole towards dir
  const rivets = new InstancedMesh(geometry, getMaterial("brass-brushed"), xs.length);
  const m = new Matrix4();
  xs.forEach((x, k) => rivets.setMatrixAt(k, m.makeTranslation(x, faceY, z)));
  rivets.name = `rivets:${dir > 0 ? "back" : "front"}`;
  return rivets;
}

function supportBar(span: number, y: number, z: number, sy: number, sz: number, name: string): Mesh {
  const bar = tag(at(box(span, sy, sz, getMaterial("brass-frame")), 0, y, z), "fixed");
  bar.userData.bearing = true;
  return named(bar, name);
}

/**
 * The frame that stays on the floor and lifts out second: the rail over the pawl levers, the support bars (the input shafts
 * pass through the lower input bar), arcade strips and end plates. The levels themselves are added by the caller.
 */
export function buildFrame(params: MechanismParams): Group {
  const frame = new Group();
  frame.name = "frame";
  const n = params.levelCount;
  const frameMaterial = getMaterial("brass-frame");
  const halfSpan = (n * params.levelPitch) / 2;
  const span = 2 * halfSpan;

  // the rail over the pawl levers ties the posts across the levels
  frame.add(tag(at(box(2 * halfSpan, 3, 4, frameMaterial), 0, LEVER_BOTTOM_Y - 1.5, RAIL_Z), "fixed"));

  // support bars (paper items 43, 44, 38, 51 are the real ones; shapes are [unknown]): each shaft ends on a bar
  // that runs across all levels between the end plates; the bearing bar under the lid belongs to the lid assembly
  frame.add(supportBar(span, -7 - BAR / 2, 0, BAR, 6, "supportBar:0")); // accumulator shafts, front end (shaft from y = -7)
  frame.add(supportBar(span, 33 + BAR / 2, 0, BAR, 6, "supportBar:1")); // accumulator shafts, back end (to y = 33)
  frame.add(supportBar(span, INPUT_SHAFT_Y, INPUT_GEAR_Z + INPUT_SHAFT_BOTTOM - BAR / 2, 4, BAR, "supportBar:2")); // input shafts, lower end
  const outputFront = DIM.y.gear50 + OUTPUT_SHAFT_CENTRE - OUTPUT_SHAFT_LENGTH / 2;
  frame.add(supportBar(span, outputFront - BAR / 2, OUTPUT_SHAFT_Z, BAR, BAR, "supportBar:4")); // output shafts, front end
  frame.add(supportBar(span, outputFront + OUTPUT_SHAFT_LENGTH + BAR / 2, OUTPUT_SHAFT_Z, BAR, BAR, "supportBar:5")); // output shafts, back end

  // arcade strips under the two long accumulator bars: they carry the frame down to the floor
  const arcade = frameArcade(n, params.levelPitch, -BAR / 2);
  for (const y of [-7 - BAR / 2, 33 + BAR / 2]) {
    const strip = tag(at(new Mesh(arcade, frameMaterial), 0, y, 0), "fixed");
    strip.name = `frameArcade:${y < 0 ? "front" : "back"}`;
    frame.add(strip);
  }

  // brass end plates of the frame (museum photos): a plate with rounded openings at each end of the support bars,
  // so that the mechanism reads as one frame standing in the case
  const plateGeometry = frameEndPlate();
  for (const side of [-1, 1]) {
    const plate = tag(new Mesh(plateGeometry, getMaterial("brass-brushed")), "fixed");
    plate.name = side < 0 ? "framePlate:left" : "framePlate:right";
    plate.position.x = side * (halfSpan + 0.1) + (side > 0 ? 0 : -FRAME_PLATE_THICKNESS);
    frame.add(plate);
    // two ears per plate: flat tabs with a hole at the top, bent inwards
    for (const y of EAR_YS) {
      const ear = tag(new Mesh(earGeometry(), frameMaterial), "fixed");
      ear.name = `frameEar:${side < 0 ? "left" : "right"}:${y < 0 ? "front" : "back"}`;
      ear.rotation.z = side < 0 ? 0 : Math.PI; // the tab runs inwards from the plate
      ear.position.set(side * (halfSpan + 0.1) + (side < 0 ? -FRAME_PLATE_THICKNESS : FRAME_PLATE_THICKNESS), y, FRAME_TOP - EAR_THICKNESS);
      addBoxProxy(ear, [EAR_LENGTH, 6, EAR_THICKNESS], [EAR_LENGTH / 2, 0, EAR_THICKNESS / 2]);
      frame.add(ear);
    }
  }

  // central partition between the middle levels, and rivet rows on the two long accumulator bars
  const partition = tag(new Mesh(partitionGeometry(), frameMaterial), "fixed");
  partition.name = "partition";
  // the partition stands in the middle gap (between levels k-1 and k, k = n / 2 rounded down)
  partition.position.x = ((n - 1) / 2 - (Math.floor(n / 2) - 0.5)) * params.levelPitch;
  // proxies: the four bands round the opening (the opening is 5 mm in from the outline)
  const y0 = PARTITION_Y_FROM;
  const y1 = PARTITION_Y_TO;
  const bands: [[number, number, number], [number, number, number]][] = [
    [[FRAME_PLATE_THICKNESS, y1 - y0, 4], [0, (y0 + y1) / 2, FLOOR_TOP + 2]],
    [[FRAME_PLATE_THICKNESS, y1 - y0, 4], [0, (y0 + y1) / 2, PARTITION_TOP - 2]],
    [[FRAME_PLATE_THICKNESS, 5, PARTITION_TOP - FLOOR_TOP], [0, y0 + 2.5, (PARTITION_TOP + FLOOR_TOP) / 2]],
    [[FRAME_PLATE_THICKNESS, 5, PARTITION_TOP - FLOOR_TOP], [0, y1 - 2.5, (PARTITION_TOP + FLOOR_TOP) / 2]],
  ];
  for (const [size, centre] of bands) addBoxProxy(partition, size, centre);
  frame.add(partition);
  const rivetX: number[] = [];
  for (let k = 0; k < n * 2; k++) rivetX.push(-halfSpan + (k + 0.5) * (params.levelPitch / 2));
  frame.add(rivetRow(rivetX, -7 - BAR - 0.05, -1, 0), rivetRow(rivetX, 33 + BAR + 0.05, 1, 0));
  return frame;
}

const EAR_YS = [-30, 38] as const;

/** Bearing bar under the lid for the upper pins of the input shafts; part of the lid assembly (it lifts with the shafts). */
export function buildUnderLidBar(params: MechanismParams): Mesh {
  const span = params.levelCount * params.levelPitch;
  return supportBar(span, INPUT_SHAFT_Y, LID_BOTTOM - 0.2 - BAR / 2, 4, BAR, "supportBar:3");
}
