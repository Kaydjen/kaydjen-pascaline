import {
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  RingGeometry,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  type Material,
} from "three";
import { getMaterial } from "../materials/factory";
import { FONT_LABEL, FONT_NUMERAL } from "../materials/fonts";
import { STEP_DEG } from "../sim/params";
import { at, box, forgedBox, named } from "./common";
import {
  BAR_TRAVEL,
  BARREL_INNER,
  BARREL_LENGTH,
  BARREL_OUTER,
  CASE_Y_BACK,
  CASE_Y_FRONT,
  CROWN_HOLE_RADIUS,
  crownAngleDeg,
  crownHeight,
  crownOuterRadius,
  LABEL_THICKNESS,
  LABEL_Y_FROM,
  LABEL_Y_TO,
  LABELS,
  LID_BOTTOM,
  LID_OVERHANG,
  LID_THICKNESS,
  LID_TOP,
  numeralRotation,
  seededRandom,
  SLOT_HALF_WIDTH,
  STRIP_CENTRE_Y,
  STRIP_LEG_LENGTH,
  STRIP_LENGTH,
  STRIP_THICKNESS,
  WHEEL_PLATE_THICKNESS,
  WINDOW_HALF_WIDTH,
  WINDOW_Y_FROM,
  WINDOW_Y_TO,
} from "./case";
import { INPUT_SHAFT_Y } from "./dimensions";
import { outerHalfWidth } from "./boxCase";

const RAD = Math.PI / 180;
/** The window opening widens towards the top: extra margin at the front (the lid edge must not clip a digit seen from the default camera), the sides and the back. */
const WINDOW_BEVEL_FRONT = 2.6;
const WINDOW_BEVEL_SIDE = 0.4;
const WINDOW_BEVEL_BACK = 0.2;

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture | null {
  if (typeof document === "undefined") return null; // headless tests build the view without a canvas
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Hand-cut numerals on the crown band: uneven size, slant and offset, an engraver's serif face, short radial notches between them. */
function crownTexture(outer: number): CanvasTexture | null {
  const size = 2048;
  const pxPerMm = size / 2 / outer;
  return canvasTexture(size, size, (ctx) => {
    ctx.filter = "blur(0.7px)"; // ink bleeds a little into the metal: no laser-sharp edges
    const random = seededRandom(1654);
    const jitter = (amount: number): number => (random() * 2 - 1) * amount;
    ctx.fillStyle = "#17110a";
    ctx.strokeStyle = "#17110a";
    ctx.lineCap = "round";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const mid = (CROWN_HOLE_RADIUS + outer) / 2;
    for (let d = 0; d < 10; d++) {
      const a = crownAngleDeg(d) * RAD;
      const radius = (mid - 0.3 + jitter(0.15)) * pxPerMm;
      ctx.save();
      ctx.translate(size / 2 + radius * Math.sin(a), size / 2 - radius * Math.cos(a));
      ctx.rotate(numeralRotation(a) + jitter(3) * RAD);
      ctx.font = `${Math.round(3.7 * pxPerMm * (1 + jitter(0.06)))}px ${FONT_NUMERAL}`;
      ctx.fillText(String(d), jitter(0.15) * pxPerMm, 0.1 * pxPerMm);
      ctx.restore();
      // notch halfway to the next numeral: short, exactly radial (they point at the wheel centre)
      const b = a + (STEP_DEG / 2) * RAD;
      const r0 = (outer - 1.45 + jitter(0.1)) * pxPerMm;
      const r1 = (outer - 0.4 + jitter(0.1)) * pxPerMm;
      ctx.lineWidth = (0.16 + random() * 0.08) * pxPerMm;
      ctx.beginPath();
      ctx.moveTo(size / 2 + r0 * Math.sin(b), size / 2 - r0 * Math.cos(b));
      ctx.lineTo(size / 2 + r1 * Math.sin(b), size / 2 - r1 * Math.cos(b));
      ctx.stroke();
    }
  });
}

/** Ring face as a flat-mapped grid whose heights follow the dome, so that the numeral overlay lies on the band. */
function domedRing(inner: number, outer: number, lift: number): RingGeometry {
  const geometry = new RingGeometry(inner, outer, 64, 4);
  const position = geometry.getAttribute("position");
  for (let k = 0; k < position.count; k++) {
    const t = (Math.hypot(position.getX(k), position.getY(k)) - inner) / (outer - inner);
    position.setZ(k, crownHeight(Math.min(Math.max(t, 0), 1)) + lift);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Solid band of the crown: a lathe of the domed cross-section (axis z after the turn). */
function crownBandGeometry(inner: number, outer: number): LatheGeometry {
  const profile: Vector2[] = [new Vector2(inner, 0), new Vector2(outer, 0)];
  const steps = 5;
  for (let k = 0; k <= steps; k++) {
    const t = 1 - k / steps;
    profile.push(new Vector2(inner + t * (outer - inner), crownHeight(t)));
  }
  profile.push(new Vector2(inner, 0));
  const geometry = new LatheGeometry(profile, 64);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** Handwritten-style French labels, one per level; texture pixels are square (PX_PER_MM both ways). */
function labelTexture(width: number, height: number, levelCount: number, levelX: (i: number) => number): CanvasTexture | null {
  const pxPerMm = 12;
  return canvasTexture(Math.round(width * pxPerMm), Math.round(height * pxPerMm), (ctx) => {
    ctx.fillStyle = "#3b2c14";
    ctx.font = `${Math.round(3.6 * pxPerMm)}px ${FONT_LABEL}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < levelCount; i++) {
      const lines = LABELS[i]!.split("\n");
      const x = (levelX(i) + width / 2) * pxPerMm;
      lines.forEach((line, k) => ctx.fillText(line, x, (height / 2) * pxPerMm + (k - (lines.length - 1) / 2) * 4.2 * pxPerMm));
    }
  });
}

function extrude(shape: Shape, depth: number, z: number, mat: Material, curveSegments = 40): Mesh {
  const mesh = new Mesh(new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments }), mat);
  mesh.position.z = z;
  return mesh;
}

function rectangle(x0: number, y0: number, x1: number, y1: number): Shape {
  const shape = new Shape();
  shape.moveTo(x0, y0);
  shape.lineTo(x1, y0);
  shape.lineTo(x1, y1);
  shape.lineTo(x0, y1);
  shape.closePath();
  return shape;
}

function rectangleHole(x0: number, y0: number, x1: number, y1: number): Path {
  const hole = new Path();
  hole.moveTo(x0, y0);
  hole.lineTo(x0, y1);
  hole.lineTo(x1, y1);
  hole.lineTo(x1, y0);
  hole.closePath();
  return hole;
}

function annulus(inner: number, outer: number): Shape {
  const shape = new Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return shape;
}

/** Octagonal bolt head standing on the lid (axis z). */
function bolt(mat: Material, radius: number, height: number): Mesh {
  const mesh = new Mesh(new CylinderGeometry(radius, radius, height, 8), mat);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

/** Octagonal bolt with a domed top (the big bolts beside the stop levers). Origin at the plate surface, axis z. */
function domedBolt(mat: Material, radius: number, height: number): Group {
  const group = new Group();
  const head = at(bolt(mat, radius, height), 0, 0, height / 2);
  head.rotation.y = Math.PI / 8;
  group.add(head);
  const dome = new Mesh(new SphereGeometry(radius * 0.62, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  dome.rotation.x = Math.PI / 2;
  dome.position.z = height;
  dome.scale.set(1, 0.7, 1);
  group.add(dome);
  return group;
}

/** Slotted round screw head (axis z) lying on a plate: a disc with a dark slot across it. Origin at the plate surface. */
function slottedScrew(mat: Material, slotMat: Material, radius: number, angle: number): Group {
  const screw = new Group();
  const head = new Mesh(new CylinderGeometry(radius, radius, 0.45, 16), mat);
  head.rotation.x = Math.PI / 2;
  head.position.z = 0.225;
  screw.add(head);
  const slot = new Mesh(new PlaneGeometry(2 * radius * 0.9, radius * 0.28), slotMat);
  slot.position.z = 0.46;
  slot.rotation.z = angle;
  screw.add(slot);
  return screw;
}

/** Distance from the wheel centre to the tip of a stop lever (it ends over the inner part of the spokes). */
const STOP_TIP_RADIUS = 8;

/** A flat forged blade lofted along y: at every station its half width, the height of its middle plane and one thickness. */
function loft(stations: { y: number; hw: number; z: number }[], thickness: number, mat: Material): Mesh {
  const h = thickness / 2;
  const positions: number[] = [];
  for (const { y, hw, z } of stations) positions.push(-hw, y, z + h, hw, y, z + h, hw, y, z - h, -hw, y, z - h);
  const index: number[] = [];
  for (let k = 0; k < stations.length - 1; k++) {
    for (let e = 0; e < 4; e++) {
      const a = 4 * k + e;
      const b = 4 * k + ((e + 1) % 4);
      index.push(a, b, a + 4, b, b + 4, a + 4);
    }
  }
  const last = 4 * (stations.length - 1);
  index.push(0, 2, 1, 0, 3, 2, last, last + 1, last + 2, last, last + 2, last + 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  const flat = geometry.toNonIndexed();
  flat.computeVertexNormals();
  return new Mesh(flat, mat);
}

/**
 * Stop lever of one crown, at its front (six o'clock), after the photos: a small base block with a big octagonal bolt
 * head on each side, and one forged blade that starts as a spade on the block, narrows into a neck, rises and runs on as a
 * slim blade that ends in a fine point over the spokes. Origin: on the lid top at the block centre; the lever runs along +y.
 */
function stopLever(mat: Material, reach: number): Group {
  const lever = new Group();
  lever.add(at(forgedBox(4.4, 3.2, 1.2, mat, 0.2), 0, 0, 0.6));
  for (const side of [-1, 1]) lever.add(at(domedBolt(mat, 1.9, 1.5), side * 4.8, 0, 0));
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const stations: { y: number; hw: number; z: number }[] = [];
  const start = -1.0;
  const count = 28;
  for (let k = 0; k < count; k++) {
    const t = k / (count - 1);
    const y = start + (reach - start) * t;
    const spade = 1.9 * (1 - smooth(Math.min(t / 0.22, 1))); // the foot narrows into the neck
    const hw = 0.95 * (1 - smooth(Math.max((t - 0.35) / 0.65, 0))) ** 0.8 + 0.12 + spade * 0.9;
    const z = 1.45 + 2.0 * smooth(Math.min(t / 0.45, 1)) - 0.25 * smooth(Math.max((t - 0.7) / 0.3, 0));
    stations.push({ y, hw, z });
  }
  lever.add(named(loft(stations, 0.7, mat), "stopTip"));
  return lever;
}

/**
 * Trefoil bracket with one slotted screw that holds the crown rings (cnam-823-1-IMG_6513.jpg): a central lobe with two smaller
 * lobes and a pointed tip. `size` scales it; the tip points along +y.
 */
function trefoilBracket(mat: Material, slotMat: Material, size: number): Group {
  const group = new Group();
  const shape = new Shape();
  shape.absarc(0, 0, 1.9, 0, Math.PI * 2, false);
  group.add(extrude(shape, 0.7, 0, mat, 20));
  for (const side of [-1, 1]) {
    const lobe = new Shape();
    lobe.absarc(side * 2.0, -0.7, 1.15, 0, Math.PI * 2, false);
    group.add(extrude(lobe, 0.7, 0, mat, 14));
  }
  const tip = new Shape();
  tip.moveTo(-1.5, 0.5);
  tip.quadraticCurveTo(-0.5, 2.4, 0, 3.4);
  tip.quadraticCurveTo(0.5, 2.4, 1.5, 0.5);
  tip.closePath();
  group.add(extrude(tip, 0.7, 0, mat, 8));
  group.add(slottedScrew(mat, slotMat, 0.95, 0.7));
  group.children[group.children.length - 1]!.position.set(0, 0, 0.7);
  group.scale.set(size, size, 1);
  return group;
}

/** Four sloped faces joining the top rectangle of a window (at the lid top) to its opening (at the lid underside). */
function windowBevel(cx: number, top: { x: number; from: number; to: number }, mat: Material): Mesh {
  const topPoints = [[-top.x, top.from], [top.x, top.from], [top.x, top.to], [-top.x, top.to]] as const;
  const bottom = [[-WINDOW_HALF_WIDTH, WINDOW_Y_FROM], [WINDOW_HALF_WIDTH, WINDOW_Y_FROM], [WINDOW_HALF_WIDTH, WINDOW_Y_TO], [-WINDOW_HALF_WIDTH, WINDOW_Y_TO]] as const;
  const positions: number[] = [];
  for (const [x, y] of topPoints) positions.push(cx + x, y, LID_TOP);
  for (const [x, y] of bottom) positions.push(cx + x, y, LID_BOTTOM);
  const index: number[] = [];
  for (let k = 0; k < 4; k++) {
    const k2 = (k + 1) % 4;
    index.push(k, k2, 4 + k, k2, 4 + k2, 4 + k);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return new Mesh(geometry, mat);
}

/** One corner hook clip of the lid: a small plate with a slotted screw and a tab that folds down over the wall top. */
function cornerClip(index: number, x: number, y: number, outwardX: number, outwardY: number): Group {
  const brass = getMaterial("brass-brushed");
  const dark = getMaterial("brass-dark");
  const clip = named(new Group(), `lidClip:${index}`);
  clip.position.set(x, y, LID_TOP);
  const plate = at(box(5, 3.2, 0.5, brass), 0, 0, 0.25);
  clip.add(plate);
  clip.add(at(slottedScrew(brass, dark, 1.05, 0.5 + index), -outwardX * 0.4, -outwardY * 0.3, 0.5));
  // the hook: a tab over the edge of the lid, bent down along the wall
  clip.add(at(box(2.6, 0.5, 5.2, brass), outwardX * 0.2, outwardY * 2.7, -2.1));
  return clip;
}

export interface LidParts {
  /** Lid plate, crowns, brackets, stop levers, clips and screws. */
  lid: Group;
  /** Raised label strip with its text mesh (named "labelText"). */
  label: Group;
  /** The strip that is pulled by hand along y (by BAR_TRAVEL either way from its centre position), with a barrel on each end. */
  slider: Group;
}

export function buildLid(levelCount: number, pitch: number): LidParts {
  const brass = getMaterial("brass-brushed");
  const steel = getMaterial("steel-ring");
  const dark = getMaterial("brass-dark");
  const halfSpan = (levelCount * pitch) / 2;
  const lidHalf = outerHalfWidth(levelCount, pitch) + LID_OVERHANG;
  const levelX = (i: number): number => ((levelCount - 1) / 2 - i) * pitch;
  const crownOuter = crownOuterRadius(pitch);
  const yFront = CASE_Y_FRONT - LID_OVERHANG;
  const yBack = CASE_Y_BACK + LID_OVERHANG;

  // ---- lid: one flat closed plate (no openings under the wheels) with the window slots cut by narrow dividers
  const lid = named(new Group(), "lid");
  lid.userData.body = "fixed";
  const plate = rectangle(-lidHalf, yFront, lidHalf, yBack);
  const top = { x: WINDOW_HALF_WIDTH + WINDOW_BEVEL_SIDE, from: WINDOW_Y_FROM - WINDOW_BEVEL_FRONT, to: WINDOW_Y_TO + WINDOW_BEVEL_BACK };
  for (let i = 0; i < levelCount; i++) plate.holes.push(rectangleHole(levelX(i) - top.x, top.from, levelX(i) + top.x, top.to));
  // the sliding strip ends bend down into a slot at each end of its row; the slot is as long as the strip's travel (photos)
  const slotX = halfSpan - 1 - 1.8;
  for (const side of [-1, 1]) plate.holes.push(rectangleHole(side * slotX - SLOT_HALF_WIDTH, STRIP_CENTRE_Y - STRIP_LENGTH / 2 - BAR_TRAVEL, side * slotX + SLOT_HALF_WIDTH, STRIP_CENTRE_Y + STRIP_LENGTH / 2 + BAR_TRAVEL));
  lid.add(named(extrude(plate, LID_THICKNESS, LID_BOTTOM, getMaterial("brass-lid")), "lidPlate"));

  // bevel faces of the windows: from the wide top edge down to the opening
  const bevelMaterial = brass.clone();
  bevelMaterial.side = DoubleSide;
  for (let i = 0; i < levelCount; i++) lid.add(named(windowBevel(levelX(i), top, bevelMaterial), `windowBevel:${i}`));

  // double engraved border line inside the edge (a normal-map engraving in the materials step)
  const lineWidth = 0.22;
  for (const inset of [2.0, 2.6]) {
    const x0 = -lidHalf + inset;
    const x1 = lidHalf - inset;
    const y0 = yFront + inset;
    const y1 = yBack - inset;
    const line = (cx: number, cy: number, w: number, h: number): Mesh => {
      const mesh = at(new Mesh(new PlaneGeometry(w, h), dark), cx, cy, LID_TOP + 0.02);
      mesh.name = `lidBorder:${inset}`;
      return mesh;
    };
    lid.add(line(0, y0, x1 - x0, lineWidth), line(0, y1, x1 - x0, lineWidth), line(x0, (y0 + y1) / 2, lineWidth, y1 - y0), line(x1, (y0 + y1) / 2, lineWidth, y1 - y0));
  }

  // four hook clips at the corners, slotted screws at the middle of the front and back edges
  const cornerX = lidHalf - 3.2;
  const clipPositions = [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const;
  clipPositions.forEach(([sx, sy], k) => {
    lid.add(cornerClip(k, sx * cornerX, sy < 0 ? yFront + 3 : yBack - 3, sx, sy));
  });
  for (const [k, y] of [[0, yFront + 3.6], [1, yBack - 3.6]] as const) {
    lid.add(named(at(slottedScrew(brass, dark, 0.8, 0.2 + k), 0, y, LID_TOP), `lidScrew:${k}`));
  }

  // crown rings: wide steel band with a slightly domed top; hand-cut numerals on a transparent overlay; a dark closed disc inside
  const numerals = new MeshStandardMaterial({ map: crownTexture(crownOuter), transparent: true, metalness: 0, roughness: 0.6, depthWrite: false });
  const bandGeometry = crownBandGeometry(CROWN_HOLE_RADIUS - 0.1, crownOuter);
  const faceGeometry = domedRing(CROWN_HOLE_RADIUS - 0.1, crownOuter, 0.015);
  const plateGeometry = new CylinderGeometry(CROWN_HOLE_RADIUS, CROWN_HOLE_RADIUS, WHEEL_PLATE_THICKNESS, 64);
  plateGeometry.rotateX(Math.PI / 2);
  const reach = crownOuter + 1.7 - STOP_TIP_RADIUS;
  for (let i = 0; i < levelCount; i++) {
    const crown = named(new Group(), `crown:${i}`);
    crown.position.set(levelX(i), INPUT_SHAFT_Y, LID_TOP);
    const band = new Mesh(bandGeometry, steel);
    band.userData.noShadow = true; // 26 k triangles of rings are not worth a place in the shadow pass
    const face = new Mesh(faceGeometry, numerals);
    face.userData.noShadow = true;
    crown.add(band, face);
    for (const radius of [CROWN_HOLE_RADIUS - 0.1, crownOuter - 0.12]) {
      const lip = new Mesh(new TorusGeometry(radius, 0.2, 5, 64), steel);
      lip.userData.noShadow = true;
      lip.position.z = crownHeight(radius < CROWN_HOLE_RADIUS ? 0 : 1) + 0.02;
      crown.add(lip);
    }
    lid.add(crown);
    const wheelPlate = named(at(new Mesh(plateGeometry, dark), levelX(i), INPUT_SHAFT_Y, LID_TOP + WHEEL_PLATE_THICKNESS / 2), `wheelPlate:${i}`);
    wheelPlate.userData.bearing = true; // the input shaft runs through it
    lid.add(wheelPlate);
    lid.add(named(at(stopLever(brass, reach), levelX(i), INPUT_SHAFT_Y - crownOuter - 1.7, LID_TOP), `stopLever:${i}`));
  }
  // brackets: an ear at each end of the row and a leaf in the cusp above every second junction, counted from the left (photos)
  const cuspY = INPUT_SHAFT_Y + 11.5;
  for (const side of [-1, 1]) {
    const end = at(trefoilBracket(brass, dark, 1), side * (halfSpan + 1.6), INPUT_SHAFT_Y, LID_TOP);
    end.rotation.z = -side * Math.PI / 2; // the tip points outwards
    lid.add(named(end, `bracket:end${side}`));
  }
  for (let j = 0; j < levelCount - 1; j++) {
    if ((levelCount - 2 - j) % 2 !== 0) continue;
    lid.add(named(at(trefoilBracket(brass, dark, 0.85), levelX(j) - pitch / 2, cuspY, LID_TOP), `bracket:${j}`));
  }

  // ---- label strip: raised plate with scalloped pointed ends, text on its own mesh (hover hit test), screws as on the photo
  const label = named(new Group(), "label");
  label.userData.body = "fixed";
  const length = levelCount * pitch - 6;
  const yc = (LABEL_Y_FROM + LABEL_Y_TO) / 2;
  const half = length / 2;
  const strip = new Shape();
  strip.moveTo(-half, yc);
  strip.quadraticCurveTo(-half + 1.2, LABEL_Y_TO - 1.4, -half + 6, LABEL_Y_TO);
  strip.lineTo(half - 6, LABEL_Y_TO);
  strip.quadraticCurveTo(half - 1.2, LABEL_Y_TO - 1.4, half, yc);
  strip.quadraticCurveTo(half - 1.2, LABEL_Y_FROM + 1.4, half - 6, LABEL_Y_FROM);
  strip.lineTo(-half + 6, LABEL_Y_FROM);
  strip.quadraticCurveTo(-half + 1.2, LABEL_Y_FROM + 1.4, -half, yc);
  label.add(extrude(strip, LABEL_THICKNESS, LID_TOP, brass, 12));
  const textWidth = length - 16;
  const textHeight = LABEL_Y_TO - LABEL_Y_FROM - 1;
  const text = new Mesh(
    new PlaneGeometry(textWidth, textHeight),
    new MeshStandardMaterial({ map: labelTexture(textWidth, textHeight, levelCount, levelX), transparent: true, metalness: 0, roughness: 0.7, depthWrite: false }),
  );
  label.add(named(at(text, 0, yc, LID_TOP + LABEL_THICKNESS + 0.02), "labelText"));
  // one screw at each tip and one on the line between "mille" and "dizaines de mille" and between "Centaine" and "dizaine"
  const screws = [-length / 2 + 4, length / 2 - 4];
  for (const i of [1, 3]) if (i + 1 < levelCount) screws.push((levelX(i) + levelX(i + 1)) / 2);
  for (const x of screws) label.add(at(bolt(brass, 0.9, 0.5), x, yc, LID_TOP + LABEL_THICKNESS + 0.25));

  // ---- sliding strip with its two barrels (open end towards the wheels)
  const slider = named(new Group(), "slider");
  const stripBrass = getMaterial("brass-strip"); // the strip and its barrels: their own material, so that the stylus wear can sit on them
  slider.userData.body = "fixed";
  const stripWidth = 2 * (halfSpan - 1);
  const stripTop = LID_TOP + STRIP_THICKNESS;
  slider.add(named(at(forgedBox(stripWidth, STRIP_LENGTH, STRIP_THICKNESS, stripBrass, 0.18), 0, STRIP_CENTRE_Y, LID_TOP + STRIP_THICKNESS / 2), "bar"));
  // a leg bends down from each end of the strip into its slot
  // two slotted screws hold the strip, one just inside each barrel (strip-barrels-crop.png)
  for (const side of [-1, 1]) {
    slider.add(named(at(slottedScrew(stripBrass, dark, 0.95, 0.3 + side), side * (stripWidth / 2 - 2 * BARREL_OUTER - 2.6), STRIP_CENTRE_Y + STRIP_LENGTH / 2 - 2.4, stripTop), `stripScrew:${side < 0 ? "left" : "right"}`));
  }
  for (const side of [-1, 1]) {
    slider.add(named(at(forgedBox(2 * SLOT_HALF_WIDTH - 0.5, STRIP_LENGTH - 1, STRIP_LEG_LENGTH, stripBrass, 0.2), side * (stripWidth / 2 - 1.8), STRIP_CENTRE_Y, LID_TOP - STRIP_LEG_LENGTH / 2 + STRIP_THICKNESS), `stripLeg:${side < 0 ? "left" : "right"}`));
  }
  const barrelGeometry = new ExtrudeGeometry(annulus(BARREL_INNER, BARREL_OUTER), { depth: BARREL_LENGTH, bevelEnabled: false, curveSegments: 24 });
  barrelGeometry.rotateX(-Math.PI / 2); // axis along +y: from the open end facing the wheels towards the back
  const barrelFrontY = STRIP_CENTRE_Y + STRIP_LENGTH / 2 - BARREL_LENGTH;
  for (const [side, name] of [[-1, "barrel:left"], [1, "barrel:right"]] as const) {
    // the position is baked into the geometry: the wear zones are given in machine coordinates
    const placed = barrelGeometry.clone().translate(side * (stripWidth / 2 - BARREL_OUTER - 0.5), barrelFrontY, stripTop + BARREL_OUTER);
    slider.add(named(new Mesh(placed, stripBrass), name));
  }

  return { lid, label, slider };
}
