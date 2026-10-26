import {
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  RingGeometry,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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
  CROWN_EDGE,
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
/** Crown: height of the thick ring below, how far the plate's edges sit inside it, and how far the plate is pushed off-centre (mm). */
const CROWN_BASE_HEIGHT = CROWN_EDGE - 0.4;
const CROWN_PLATE_MARGIN = 0.4;
const CROWN_PLATE_SHIFT_MIN = 0.3;
const CROWN_PLATE_SHIFT_MAX = 0.7;
/** Along the row the shift is capped so that neighbouring plates, which nearly touch at the junction, never overlap. */
const CROWN_PLATE_SHIFT_MAX_X = 0.4;
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

/**
 * Hand-engraved numerals on the crown plate (photos: hairline strokes, pale on the grey metal): every stroke is a V-shaped cut in the height map
 * with a faint dark film in its bottom, so it catches the light like a cut line. Uneven size, slant and offset, an engraver's
 * serif face, short radial notches between the numerals. `bump` draws the same strokes on mid-grey for the bump map (bright = raised).
 */
function crownTexture(inner: number, outer: number, bump: boolean): CanvasTexture | null {
  const size = 2048;
  const pxPerMm = size / 2 / outer;
  return canvasTexture(size, size, (ctx) => {
    ctx.filter = "blur(0.8px)";
    if (bump) {
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, size, size);
    }
    const random = seededRandom(1654);
    const jitter = (amount: number): number => (random() * 2 - 1) * amount;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const mid = (inner + outer) / 2;
    /**
     * A cut line. Height map: the stroke is drawn four times, from wide and shallow to narrow and deep, which gives a V-shaped
     * groove (its two walls then catch the light differently, as in cut metal). Colour map: only a faint dark film in the
     * deepest part (tarnish in the cut), no ink, so the line takes the shine of the metal around it.
     */
    const engrave = (width: number, stroke: () => void): void => {
      const depth = 0.45 + random() * 0.85; // every cut has its own depth, width and darkness: some are deep, some only scratched
      width *= 0.85 + random() * 0.4;
      if (bump) {
        for (let k = 0; k < 4; k++) {
          const level = Math.round(128 - 30 * depth * (k + 1));
          ctx.strokeStyle = `rgb(${level},${level},${level})`;
          ctx.lineWidth = width * (1 - k * 0.22) * pxPerMm;
          stroke();
        }
      } else {
        ctx.strokeStyle = `rgba(28,22,16,${(0.25 + 0.5 * depth).toFixed(2)})`;
        ctx.lineWidth = width * 0.5 * pxPerMm;
        stroke();
      }
    };
    /** A cut numeral: the whole glyph is the groove (not its outline); blurred copies, wide and light to sharp and dark, make a bowl-shaped section. */
    const engraveGlyph = (draw: () => void): void => {
      const depth = 0.45 + random() * 0.85;
      random();
      if (bump) {
        [2.6, 1.7, 0.9, 0.35].forEach((blur, k) => {
          const level = Math.round(128 - 28 * depth * (k + 1));
          ctx.filter = `blur(${blur}px)`;
          ctx.fillStyle = `rgb(${level},${level},${level})`;
          draw();
        });
        ctx.filter = "blur(0.8px)";
      } else {
        ctx.fillStyle = `rgba(28,22,16,${(0.2 + 0.4 * depth).toFixed(2)})`;
        draw();
      }
    };
    for (let d = 0; d < 10; d++) {
      const a = crownAngleDeg(d) * RAD;
      const radius = (mid - 0.3 + jitter(0.15)) * pxPerMm;
      ctx.save();
      ctx.translate(size / 2 + radius * Math.sin(a), size / 2 - radius * Math.cos(a));
      ctx.rotate(numeralRotation(a) + jitter(3) * RAD);
      ctx.font = `${Math.round(3.2 * pxPerMm * (1 + jitter(0.06)))}px ${FONT_NUMERAL}`;
      const dx = jitter(0.15) * pxPerMm;
      engraveGlyph(() => ctx.fillText(String(d), dx, 0.1 * pxPerMm));
      ctx.restore();
      // notch halfway to the next numeral: short, exactly radial (they point at the wheel centre)
      const b = a + (STEP_DEG / 2) * RAD;
      const r0 = (outer - 1.45 + jitter(0.1)) * pxPerMm;
      const r1 = (outer - 0.4 + jitter(0.1)) * pxPerMm;
      const width = 0.1 + random() * 0.05;
      engrave(width + 0.06, () => {
        ctx.beginPath();
        ctx.moveTo(size / 2 + r0 * Math.sin(b), size / 2 - r0 * Math.cos(b));
        ctx.lineTo(size / 2 + r1 * Math.sin(b), size / 2 - r1 * Math.cos(b));
        ctx.stroke();
      });
    }
  });
}

/**
 * Flat-topped ring with crisp corners, as lathes of its own faces (separate profiles keep the corners sharp): outer wall, small
 * top chamfers, flat top, inner wall. The underside is left open (it sits on the lid or on the ring below).
 */
function flatRing(inner: number, outer: number, z0: number, z1: number, chamfer: number): BufferGeometry {
  const profiles: [number, number][][] = [
    [[outer, z0], [outer, z1 - chamfer]],
    [[outer, z1 - chamfer], [outer - chamfer, z1]],
    [[outer - chamfer, z1], [inner + chamfer, z1]],
    [[inner + chamfer, z1], [inner, z1 - chamfer]],
    [[inner, z1 - chamfer], [inner, z0]],
  ];
  const parts = profiles.map((points) => {
    const part = new LatheGeometry(points.map(([x, y]) => new Vector2(x, y)), 64);
    part.rotateX(Math.PI / 2);
    return part;
  });
  return mergeGeometries(parts, false)!;
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

/**
 * Base plate of a stop lever (photos): one thin forged sheet pressed flat on the lid, a faceted leaf on each side of the block
 * that carries the lever, the edges bevelled, a small round rivet head on each leaf. Block, leaves and lever are one piece.
 * Origin at the lid surface, axis z.
 */
function leverPlate(mat: Material): Group {
  const group = new Group();
  const half: [number, number][] = [[1.8, 1.3], [3.3, 1.4], [5.0, 1.0], [5.6, -0.2], [5.0, -1.2], [3.3, -1.4], [1.8, -1.3]];
  const shape = new Shape();
  const outline = [...half, ...[...half].reverse().map(([x, y]): [number, number] => [-x, y])];
  outline.forEach(([x, y], k) => (k === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  // dirt packed round the foot of the plate: a thin dark slab a little larger than the plate
  const slab = new Shape();
  outline.forEach(([x, y], k) => (k === 0 ? slab.moveTo(x * 1.12, y * 1.25) : slab.lineTo(x * 1.12, y * 1.25)));
  slab.closePath();
  group.add(named(new Mesh(new ExtrudeGeometry(slab, { depth: 0.05, bevelEnabled: false }), getMaterial("brass-dark")), "leverShadow"));
  group.add(new Mesh(new ExtrudeGeometry(shape, { depth: 0.4, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.22, bevelSegments: 1 }), mat));
  for (const side of [-1, 1]) {
    const rivet = new Mesh(new SphereGeometry(0.7, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    rivet.rotation.x = Math.PI / 2;
    rivet.position.set(side * 3.9, 0, 0.5);
    rivet.scale.set(1, 0.8, 1);
    group.add(rivet);
  }
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
/** Photos: on every wheel the stop lever and its plate stand a little to the left of the ring centre (seen from the front), not under it. */
const STOP_LEVER_OFFSET_X = -3.5;

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
 * Stop lever of one crown, at its front (six o'clock), after the photos: a small base block on a thin faceted plate
 * with a rivet on each side, and one forged blade that starts as a spade on the block, narrows into a neck, rises and runs on as a
 * slim blade that ends in a fine point over the spokes. Origin: on the lid top at the block centre; the lever runs along +y.
 */
function stopLever(mat: Material, reach: number): Group {
  const lever = new Group();
  lever.add(at(forgedBox(3.6, 2.8, 1.2, mat, 0.2), 0, 0, 0.6));
  lever.add(leverPlate(mat));
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const stations: { y: number; hw: number; z: number }[] = [];
  const start = -1.0;
  const count = 28;
  for (let k = 0; k < count; k++) {
    const t = k / (count - 1);
    const y = start + (reach - start) * t;
    const spade = 0.9 * (1 - smooth(Math.min(t / 0.22, 1))); // the foot narrows into the neck
    const hw = 0.5 * (1 - smooth(Math.max((t - 0.35) / 0.65, 0))) ** 0.8 + 0.14 + spade * 0.8;
    const z = 1.45 + 2.0 * smooth(Math.min(t / 0.45, 1)) - 0.6 * smooth(Math.max((t - 0.72) / 0.28, 0)); // the tip hooks down over the spokes
    stations.push({ y, hw, z });
  }
  lever.add(named(loft(stations, 0.7, mat), "stopTip"));
  return lever;
}

/** Thickness of the brackets and of the numeral plates (the same sheet of metal). */
const BRACKET_THICKNESS = CROWN_EDGE - CROWN_BASE_HEIGHT;

/**
 * Strip that leaves the flat bracket on the lid, climbs over the thick ring in a smooth bend and lies on the edge of the plate,
 * pressing it down. Local frame of the bracket: the ring is towards -y, `edge` is the distance from the bracket's centre to the
 * ring's outer edge; the strip is `width` wide along x.
 */
function pressTongue(mat: Material, edge: number, width: number): Mesh {
  const start = -0.3;
  const climbEnd = -(edge + 0.7);
  const end = climbEnd - 0.9;
  const rest = CROWN_EDGE + BRACKET_THICKNESS / 2; // mid-thickness height while resting on the plate
  const mid = (y: number): number => {
    const s = Math.min(Math.max((y - start) / (climbEnd - start), 0), 1);
    return BRACKET_THICKNESS / 2 + (rest - BRACKET_THICKNESS / 2) * s * s * (3 - 2 * s);
  };
  const steps = 14;
  const ys = Array.from({ length: steps + 1 }, (_, k) => start + ((end - start) * k) / steps);
  const shape = new Shape();
  shape.moveTo(ys[0]!, mid(ys[0]!) - BRACKET_THICKNESS / 2);
  for (const y of ys) shape.lineTo(y, mid(y) - BRACKET_THICKNESS / 2);
  for (const y of [...ys].reverse()) shape.lineTo(y, mid(y) + BRACKET_THICKNESS / 2);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  // shape (y, z) extruded along its depth -> frame (depth = x, shape x = y, shape y = z)
  geometry.applyMatrix4(new Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  geometry.translate(-width / 2, 0, 0);
  return new Mesh(geometry, mat);
}

/**
 * Trefoil bracket with one slotted screw that holds the crown rings (cnam-823-1-IMG_6513.jpg and the whole-lid photo): the same
 * grey sheet as the numeral plates, so as thick as they are. It lies flat on the lid; a bracket that has to hold a ring ends in
 * a tongue that bends up over the thick ring and presses the plate (`ringEdge` = distance from its centre to the ring's edge,
 * towards -y). `size` scales it; the tip points along +y.
 */
function trefoilBracket(mat: Material, screwMat: Material, slotMat: Material, size: number, tongues: { turn: number; edge: number }[] = []): Group {
  const group = new Group();
  const depth = BRACKET_THICKNESS;
  const shape = new Shape();
  shape.absarc(0, 0, 1.9, 0, Math.PI * 2, false);
  group.add(extrude(shape, depth, 0, mat, 20));
  for (const side of [-1, 1]) {
    const lobe = new Shape();
    lobe.absellipse(side * 2.9, -1.0, 1.7, 1.05, 0, Math.PI * 2, false, 0);
    group.add(extrude(lobe, depth, 0, mat, 14));
  }
  const tip = new Shape();
  tip.moveTo(-1.5, 0.5);
  tip.quadraticCurveTo(-0.5, 2.0, 0, 2.8);
  tip.quadraticCurveTo(0.5, 2.0, 1.5, 0.5);
  tip.closePath();
  group.add(extrude(tip, depth, 0, mat, 8));
  group.add(slottedScrew(screwMat, slotMat, 0.95, 0.7));
  group.children[group.children.length - 1]!.position.set(0, 0, depth);
  for (const { turn, edge } of tongues) {
    const tongue = pressTongue(mat, edge / size, 3.2);
    tongue.rotation.z = turn;
    group.add(tongue);
  }
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

  // crown rings (photos): two parts. A thick dark ring stands on the lid; on it lies a thin flat plate that carries the numerals
  // (hand-cut, on a transparent overlay) and sits a little off-centre, a different way on every crown, so the ring below shows on one side
  const innerRadius = CROWN_HOLE_RADIUS - 0.1;
  const plateInner = innerRadius + CROWN_PLATE_MARGIN;
  const plateOuter = crownOuter - CROWN_PLATE_MARGIN;
  const numerals = new MeshStandardMaterial({
    map: crownTexture(plateInner, plateOuter, false),
    bumpMap: crownTexture(plateInner, plateOuter, true),
    bumpScale: 4.5,
    transparent: true,
    metalness: 1,
    roughness: 0.42,
    depthWrite: false,
  });
  const ringGeometry = flatRing(innerRadius, crownOuter, 0, CROWN_BASE_HEIGHT, 0.12);
  const plateGeometry = flatRing(plateInner, plateOuter, CROWN_BASE_HEIGHT, CROWN_EDGE, 0.06);
  const faceGeometry = new RingGeometry(plateInner + 0.06, plateOuter - 0.06, 64, 1);
  const shift = seededRandom(1652);
  const closedDiscGeometry = new CylinderGeometry(CROWN_HOLE_RADIUS, CROWN_HOLE_RADIUS, WHEEL_PLATE_THICKNESS, 64);
  closedDiscGeometry.rotateX(Math.PI / 2);
  const reach = crownOuter + 1.7 - STOP_TIP_RADIUS;
  for (let i = 0; i < levelCount; i++) {
    const crown = named(new Group(), `crown:${i}`);
    crown.position.set(levelX(i), INPUT_SHAFT_Y, LID_TOP);
    const ring = new Mesh(ringGeometry, dark);
    ring.userData.noShadow = true; // 26 k triangles of rings were not worth a place in the shadow pass
    const plate = new Group();
    const direction = shift() * Math.PI * 2;
    const distance = CROWN_PLATE_SHIFT_MIN + shift() * (CROWN_PLATE_SHIFT_MAX - CROWN_PLATE_SHIFT_MIN);
    plate.position.set(Math.max(-CROWN_PLATE_SHIFT_MAX_X, Math.min(CROWN_PLATE_SHIFT_MAX_X, Math.cos(direction) * distance)), Math.sin(direction) * distance, 0);
    const disc = new Mesh(plateGeometry, steel);
    disc.userData.noShadow = true;
    const face = new Mesh(faceGeometry, numerals);
    face.position.z = CROWN_EDGE + 0.015;
    face.userData.noShadow = true;
    plate.add(disc, face);
    crown.add(ring, plate);
    lid.add(crown);
    const wheelPlate = named(at(new Mesh(closedDiscGeometry, getMaterial("brass-plate")), levelX(i), INPUT_SHAFT_Y, LID_TOP + WHEEL_PLATE_THICKNESS / 2), `wheelPlate:${i}`);
    wheelPlate.userData.bearing = true; // the input shaft runs through it
    lid.add(wheelPlate);
    lid.add(named(at(stopLever(getMaterial("brass-lever"), reach), levelX(i) + STOP_LEVER_OFFSET_X, INPUT_SHAFT_Y - crownOuter - 1.7, LID_TOP), `stopLever:${i}`));
  }
  // brackets: an ear at each end of the row and leaves along the top edge (below)
  const cuspY = INPUT_SHAFT_Y + 12;
  // the leaf in the cusp holds both neighbouring plates: a tongue towards the centre of each ring, over its edge
  const cuspReach = Math.hypot(pitch / 2, cuspY - INPUT_SHAFT_Y);
  const cuspTongues = [-1, 1].map((side) => ({ turn: Math.atan2(-(cuspY - INPUT_SHAFT_Y), side * (pitch / 2)) + Math.PI / 2, edge: cuspReach - crownOuter }));
  for (const side of [-1, 1]) {
    const end = at(trefoilBracket(steel, brass, dark, 1.3, [{ turn: 0, edge: 2.2 }]), side * (halfSpan + 2.2), INPUT_SHAFT_Y, LID_TOP);
    end.rotation.z = -side * Math.PI / 2; // the tip points outwards
    lid.add(named(end, `bracket:end${side}`));
  }
  // leaves (whole-lid photo, counted from the left): one over the top of the second and the second-to-last ring, tucked under their plate edge,
  // and one in the cusp at the middle of the row; the row is mirrored, so photo ring p is level n - 1 - p
  if (levelCount >= 4) {
    for (const p of new Set([1, levelCount - 2])) {
      const i = levelCount - 1 - p;
      lid.add(named(at(trefoilBracket(steel, brass, dark, 1.5, [{ turn: 0, edge: 2.2 }]), levelX(i), INPUT_SHAFT_Y + crownOuter + 2.2, LID_TOP), `bracket:top${i}`));
    }
    if (levelCount % 2 === 0) {
      const j = levelCount / 2 - 1;
      lid.add(named(at(trefoilBracket(steel, brass, dark, 1.3, cuspTongues), levelX(j) - pitch / 2, cuspY, LID_TOP), `bracket:${j}`));
    }
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
