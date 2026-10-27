import { ExtrudeGeometry, Group, Mesh, Shape } from "three";
import { getMaterial, getWoodMaterial } from "../materials/factory";
import { CASE_Y_FRONT, CASE_Z_BOTTOM, FOOT_HEIGHT, PLINTH_HEIGHT, PLINTH_OVERHANG, WALL } from "./case";
import { at, box, cylinder, named, tag } from "./common";
import { hitBox } from "./proxies";

/** Three cradle shapes for the sheet; the shipped one is chosen once the user has judged them. */
export type StandVariant = "v" | "forks" | "saddle";
export const STAND_VARIANTS: readonly StandVariant[] = ["v", "forks", "saddle"];

const BLOCK_WIDTH = 16;
const BLOCK_DEPTH = 46;
const BLOCK_HEIGHT = 4.5;
/** The cradles stand this far (mm along y) from the middle of the block. */
const CRADLE_OFFSET = 13;
/** Height of the stylus axis above the top of the block (every variant rests it at the same height). */
const REST_HEIGHT = 6.6;
/** Gap between the plinth overhang and the block. */
const SIDE_GAP = 20;

/** Plan position of the stand (middle of the block) and the table level, machine frame (x right, y away, z up). */
export function standPlacement(halfSpan: number): { x: number; y: number; tableZ: number; restZ: number } {
  const outerHalf = halfSpan + 3 + WALL / 2;
  const tableZ = CASE_Z_BOTTOM - PLINTH_HEIGHT - FOOT_HEIGHT;
  return { x: outerHalf + PLINTH_OVERHANG + SIDE_GAP + BLOCK_WIDTH / 2, y: CASE_Y_FRONT + 32, tableZ, restZ: tableZ + BLOCK_HEIGHT + REST_HEIGHT };
}

/** A thin brass plate (x, z profile) extruded `thickness` along y, centred on y = 0. */
function plate(points: [number, number][], thickness: number, material: Mesh["material"]): Mesh {
  const shape = new Shape();
  points.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z)));
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.2, bevelSegments: 2 });
  geometry.translate(0, 0, -thickness / 2);
  geometry.rotateX(Math.PI / 2); // profile y -> world z (up), extrusion axis -> y
  return new Mesh(geometry, material);
}

/**
 * The stand: a small oak block on the table beside the box and two brass cradles that hold the stylus along y.
 * The group origin is the middle of the block's bottom face. Never moves with the lid or the teardown.
 */
export function buildStylusStand(variant: StandVariant = "saddle"): Group {
  const stand = tag(named(new Group(), "stylusStand"), "fixed");
  const wood = getWoodMaterial("wood-plinth", 100, 40);
  const brass = getMaterial("brass-brushed");
  stand.add(named(at(box(BLOCK_WIDTH, BLOCK_DEPTH, BLOCK_HEIGHT, wood), 0, 0, BLOCK_HEIGHT / 2), "standBlock"));
  const top = BLOCK_HEIGHT;
  const axisZ = top + REST_HEIGHT;
  for (const side of [-1, 1]) {
    const y = side * CRADLE_OFFSET;
    if (variant === "v") {
      // a brass post with a V notch, standing on the block
      const height = REST_HEIGHT + 3.2;
      const post = plate([[-4, top], [4, top], [4, top + height], [1.9, top + height], [0, axisZ - 1.6], [-1.9, top + height], [-4, top + height]], 1.5, brass);
      stand.add(named(at(post, 0, y, 0), "standCradle"));
    } else if (variant === "forks") {
      // two slim round posts with ball tips either side of the shaft
      for (const dx of [-1, 1]) {
        stand.add(named(at(cylinder(0.75, REST_HEIGHT + 1.2, "z", brass, 12), dx * 2.2, y, top + (REST_HEIGHT + 1.2) / 2), "standCradle"));
        const ball = at(cylinder(1.15, 2.3, "z", brass, 12), dx * 2.2, y, top + REST_HEIGHT + 1.2);
        stand.add(ball);
      }
    } else {
      // an oak saddle with two inclined brass strips forming the V
      stand.add(named(at(box(10, 5, REST_HEIGHT - 1.2, wood), 0, y, top + (REST_HEIGHT - 1.2) / 2), "standSaddle"));
      for (const dx of [-1, 1]) {
        const strip = at(box(0.9, 5.2, 4.6, brass), dx * 3.3, y, axisZ - 0.1);
        strip.rotation.y = dx * 0.62;
        stand.add(named(strip, "standCradle"));
      }
    }
  }
  stand.add(hitBox("stand", [BLOCK_WIDTH + 4, BLOCK_DEPTH + 4, BLOCK_HEIGHT + REST_HEIGHT + 9], [0, 0, (BLOCK_HEIGHT + REST_HEIGHT + 9) / 2]));
  return stand;
}
