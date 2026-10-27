import { CanvasTexture, CylinderGeometry, Group, Mesh, MeshStandardMaterial, RingGeometry, SRGBColorSpace } from "three";
import { getMaterial } from "../materials/factory";
import { FONT_NUMERAL } from "../materials/fonts";
import { paperBackground } from "../materials/textures";
import { at, cylinder, RAD, shaft, tag } from "./common";
import { DIGIT_HEIGHT, DRUM_ROW_Y, seededRandom } from "./case";
import { DIM, OUTPUT_SHAFT_Z } from "./dimensions";
import { toothWheelGeometry } from "./gears";

/** Output shaft (axis y, group frame at the wheel-56 plane): between its two support bars. */
export const OUTPUT_SHAFT_LENGTH = 20;
export const OUTPUT_SHAFT_CENTRE = 7;
/** Drum: paper wound on a metal core between two flanges (the paper stays 0.3 mm under the flange rims). */
const DRUM_PAPER_RADIUS = DIM.drumRadius;
const DRUM_CORE_RADIUS = DIM.drumRadius - 0.3;
const DRUM_FLANGE_RADIUS = DIM.drumRadius + 0.15;
const DRUM_FLANGE_THICKNESS = 0.6;
/** Digits are drawn larger than DIGIT_HEIGHT: in the photos the figure fills about 60 % of the visible window. */
const DIGIT_SCALE = 1.3;

/** Paper wound by hand is not a perfect cylinder: the radius wobbles a little round the drum and along it (at most 0.12 mm, under the flange rims). */
const PAPER_WAVE = 0.12;
function wavyPaper(geometry: CylinderGeometry, level: number): void {
  const random = seededRandom(7000 + level);
  const phase = [random() * 6.28, random() * 6.28, random() * 6.28];
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = position.getY(i);
    const angle = Math.atan2(z, x);
    const wobble = 0.5 * Math.sin(2 * angle + phase[0]!) + 0.35 * Math.sin(5 * angle + phase[1]! + y * 0.08) + 0.25 * Math.sin(3 * angle + phase[2]! - y * 0.15);
    const k = (DRUM_PAPER_RADIUS + PAPER_WAVE * wobble) / DRUM_PAPER_RADIUS;
    position.setXYZ(i, x * k, y, z * k);
  }
  geometry.computeVertexNormals();
}

/** Position around the drum (0..1, from the top, clockwise seen from the front) where digit d is read. */
export const drumCentreU = (digit: number): number => digit / 10;

function digitTexture(level: number): CanvasTexture | null {
  if (typeof document === "undefined") return null; // headless tests build the view without a canvas
  const circumference = 2 * Math.PI * DIM.drumRadius;
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = Math.round((canvas.width * DIM.drumLength) / circumference); // square pixels
  const ctx = canvas.getContext("2d")!;
  const pxPerMm = canvas.width / circumference;
  const random = seededRandom(1652 + level);
  const jitter = (amount: number): number => (random() * 2 - 1) * amount;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // canvas top = +y end of the drum (y = 45): descending row at the back, ascending row at the front (paper p07); the two
  // rows are 8 mm apart (case.ts DRUM_ROW_Y) with a blank band between them that the strip edge covers
  const drumFrontY = DIM.y.gear50 + 3;
  const rowCentre = (row: "ascending" | "descending"): number => (drumFrontY + DIM.drumLength - DRUM_ROW_Y[row]) * pxPerMm;
  // aged, stained paper (generated per drum), then plain ink numerals; the hand is a little uneven
  paperBackground(ctx, canvas.width, canvas.height, 1652 + level, ["#d9cdb4", "#e6dcc5"]);
  for (const row of ["descending", "ascending"] as const) {
    ctx.fillStyle = "#1d1812";
    for (let d = 0; d < 10; d++) {
      const x = drumCentreU(d) * canvas.width;
      const shown = String(row === "ascending" ? d : 9 - d);
      const size = Math.round((DIGIT_HEIGHT * DIGIT_SCALE / 0.66) * pxPerMm * (1 + jitter(0.06)));
      ctx.font = `${size}px ${FONT_NUMERAL}`;
      const dx = jitter(0.25) * pxPerMm;
      const dy = pxPerMm * 0.2 + jitter(0.15) * pxPerMm;
      const tilt = jitter(3) * RAD;
      for (const shift of [0, canvas.width]) { // wrap: digit 0 straddles the seam
        ctx.save();
        ctx.translate(x + shift + dx, rowCentre(row) + dy);
        ctx.rotate(tilt);
        ctx.fillText(shown, 0, 0);
        ctx.restore();
      }
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Output shaft of one level: wheel 56, its shaft and the digit drum with its hub bosses. Group frame at the wheel-56 plane
 * (x = 0 of the level); it rotates about y by minus the level angle. The drum child is named `drum:i`.
 */
export function buildOutput(level: number): Group {
  const brass = getMaterial("brass-brushed");
  const steel = getMaterial("steel");
  const coreMaterial = getMaterial("brass-frame");
  const paperEdgeMaterial = getMaterial("paper-aged");
  // the drum is a metal core with the digit paper wound round it (the paper is only the side; the caps are metal)
  const paperMaterial = new MeshStandardMaterial({ map: digitTexture(level), color: 0x7a6c50, metalness: 0, roughness: 0.6 });
  const output = tag(at(new Group(), 0, DIM.y.gear50, OUTPUT_SHAFT_Z), `output:${level}`);
  output.name = `output:${level}`;
  output.add(new Mesh(toothWheelGeometry(), brass));
  output.add(at(shaft(1.2, OUTPUT_SHAFT_LENGTH, "y", steel), 0, OUTPUT_SHAFT_CENTRE, 0));
  const drum = at(new Group(), 0, 2 + DIM.drumLength / 2 + 1, 0);
  drum.name = `drum:${level}`;
  const paperGeometry = new CylinderGeometry(DRUM_PAPER_RADIUS, DRUM_PAPER_RADIUS, DIM.drumLength, 96, 8, true);
  wavyPaper(paperGeometry, level);
  const paper = new Mesh(paperGeometry, paperMaterial);
  paper.userData.keep = true; // textured per drum: stays a mesh of its own (the look checks read it)
  drum.add(paper, cylinder(DRUM_CORE_RADIUS, DIM.drumLength, "y", coreMaterial, 64));
  for (const side of [-1, 1]) {
    drum.add(at(cylinder(DRUM_FLANGE_RADIUS, DRUM_FLANGE_THICKNESS, "y", coreMaterial, 64), 0, (side * (DIM.drumLength + DRUM_FLANGE_THICKNESS)) / 2, 0));
    const edge = new Mesh(new RingGeometry(DRUM_CORE_RADIUS, DRUM_PAPER_RADIUS, 96), paperEdgeMaterial);
    edge.rotation.x = Math.PI / 2;
    drum.add(at(edge, 0, (side * DIM.drumLength) / 2, 0));
  }
  output.add(drum);
  // hub boss on the wheel and a boss with rivets on each drum end (museum photos: metal ends with a central hub)
  output.add(at(cylinder(3.2, DIM.accPinSpanY + 2.4, "y", brass, 24), 0, 0, 0));
  for (const side of [-1, 1]) {
    drum.add(at(cylinder(3, 1.4, "y", brass, 24), 0, (side * (DIM.drumLength + DRUM_FLANGE_THICKNESS * 2 + 1.4)) / 2, 0));
    for (let k = 0; k < 6; k++) {
      const a = k * 60 * RAD;
      drum.add(at(cylinder(0.45, 0.4, "y", brass, 8), 6.5 * Math.sin(a), (side * (DIM.drumLength + DRUM_FLANGE_THICKNESS * 2 + 0.4)) / 2, 6.5 * Math.cos(a)));
    }
  }
  return output;
}
