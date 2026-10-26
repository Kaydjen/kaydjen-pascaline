import { type BoxGeometry, ExtrudeGeometry, Group, Mesh, Shape } from "three";
import { getMaterial, getWoodMaterial } from "../materials/factory";
import { at, box, cylinder, named, tag } from "./common";
import { unevenBox, type WallRelief } from "./unevenBox";
import { CASE_Y_BACK, CASE_Y_FRONT, CASE_Z_BOTTOM, COVER_WALLS, LID_BOTTOM, PLINTH_HEIGHT, PLINTH_OVERHANG, WALL, type WallName } from "./case";

/** Ledge strip under the lid along the front and back walls (the lid rests on it): width and height, mm. The frame bars at the back must pass beside it when the frame is lifted out. */
const LEDGE_WIDTH = 2.5;
const LEDGE_HEIGHT = 4;
const LINER = 0.3;

/** A plank of the given outer size with all edges rounded by `ROUND` mm (frame: x width, y depth, z up; the origin is at the middle of the bottom face). */
const ROUND = 1.6;
function plinthPlank(width: number, depth: number, height: number, material: Mesh["material"]): Mesh {
  const shape = new Shape();
  const hx = width / 2 - ROUND;
  const hy = depth / 2 - ROUND;
  shape.moveTo(-hx, -hy);
  shape.lineTo(hx, -hy);
  shape.lineTo(hx, hy);
  shape.lineTo(-hx, hy);
  shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth: height - 2 * ROUND, bevelEnabled: true, bevelThickness: ROUND, bevelSize: ROUND, bevelSegments: 4 });
  geometry.translate(0, 0, ROUND);
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / width + 0.5, uv.getY(i) / depth + 0.5); // top face 0..1 like a box face
  return new Mesh(geometry, material);
}

/** Which side of its thin axis faces the inside of the box (x for the side walls, y for front and back): that side stays flat under the liner. */
const INNER_SIDE: Record<WallName, -1 | 1> = { left: 1, right: -1, front: 1, back: -1 };

/** Bent-sheet unevenness of the four walls; null (the default, and in the tests) keeps them plain boxes. Set before the box is built. */
let wallRelief: WallRelief | null = null;
export function setWallRelief(relief: WallRelief | null): void {
  wallRelief = relief;
}

export interface BoxParts {
  /** Group `box`: floor, plinth, walls, liners, ledge, note. Never moves. */
  root: Group;
  /** The four walls, each removable by the dev covers. */
  walls: Record<WallName, Mesh>;
}

/** Outer half width of the walls (x) for a machine of `levelCount` levels. */
export const outerHalfWidth = (levelCount: number, pitch: number): number => (levelCount * pitch) / 2 + 3 + WALL / 2;

/**
 * The box: patinated brass walls on a lighter wooden plinth, pale raw wood inside and a ledge under the lid.
 */
export function buildBox(levelCount: number, pitch: number): BoxParts {
  const outerHalf = outerHalfWidth(levelCount, pitch);
  const wallX = outerHalf - WALL / 2;
  const yLength = CASE_Y_BACK - CASE_Y_FRONT;
  const yMid = (CASE_Y_BACK + CASE_Y_FRONT) / 2;
  const wallHeight = LID_BOTTOM - CASE_Z_BOTTOM;
  const wallZ = CASE_Z_BOTTOM + wallHeight / 2;

  const rawMaterial = getWoodMaterial("wood-raw", 100, 40);
  const frontBackWall = getWoodMaterial("wood-dark", 2 * outerHalf, wallHeight);
  const sideWall = getWoodMaterial("wood-dark", yLength, wallHeight);
  const root = tag(new Group(), "fixed");
  root.name = "box";
  const part = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat = frontBackWall): Mesh => {
    return at(box(sx, sy, sz, mat), x, y, z);
  };
  // the floor lies inside the walls (not as wide as their outside): a floor as wide as the walls shared their outer faces and flickered through them (z-fighting)
  const floor = named(part(2 * (outerHalf - WALL) - 0.1, yLength - 2 * WALL - 0.1, 4, 0, yMid, CASE_Z_BOTTOM + 2, getWoodMaterial("wood-raw", 2 * outerHalf, yLength)), "floor"); // top face at FLOOR_TOP
  floor.userData.keep = true; // the look checks measure it
  root.add(floor);
  // the base is one thick plank; its top edge is planed round by hand (a flat step would be a machine-made moulding)
  const plank = plinthPlank(2 * (outerHalf + PLINTH_OVERHANG), yLength + 2 * PLINTH_OVERHANG, PLINTH_HEIGHT, getWoodMaterial("wood-plinth", 2 * outerHalf, yLength));
  plank.position.set(0, yMid, CASE_Z_BOTTOM - PLINTH_HEIGHT);
  root.add(named(plank, "plinth"));
  const walls: Record<WallName, Mesh> = {
    // the side walls stand between the front and back walls: a full-length side wall shared its outer face and its end faces with them (z-fighting at the corners)
    left: named(part(WALL, yLength - 2 * WALL, wallHeight, -wallX, yMid, wallZ, sideWall), "wall:left"),
    right: named(part(WALL, yLength - 2 * WALL, wallHeight, wallX, yMid, wallZ, sideWall), "wall:right"),
    front: named(part(2 * outerHalf, WALL, wallHeight, 0, CASE_Y_FRONT + WALL / 2, wallZ), "wall:front"),
    back: named(part(2 * outerHalf, WALL, wallHeight, 0, CASE_Y_BACK - WALL / 2, wallZ), "wall:back"),
  };
  for (const wall of COVER_WALLS) {
    if (wallRelief) walls[wall].geometry = unevenBox(walls[wall].geometry as BoxGeometry, wallRelief, INNER_SIDE[wall]);
    walls[wall].userData.body = "fixed";
    walls[wall].userData.rigid = true; // each wall merges its liners and ledge, and stays hideable on its own
    root.add(walls[wall]);
  }

  // pale raw wood inside: thin liners on the inner faces; they hide with their wall
  const innerX = wallX - WALL / 2;
  const linerHeight = wallHeight - 4;
  const linerZ = CASE_Z_BOTTOM + 4 + linerHeight / 2;
  const lz = linerZ - wallZ;
  walls.left.add(named(part(LINER, yLength - 2 * WALL, linerHeight, WALL / 2 + LINER / 2, 0, lz, rawMaterial), "liner:left"));
  walls.right.add(named(part(LINER, yLength - 2 * WALL, linerHeight, -WALL / 2 - LINER / 2, 0, lz, rawMaterial), "liner:right"));
  walls.front.add(named(part(2 * innerX, LINER, linerHeight, 0, WALL / 2 + LINER / 2, linerZ - wallZ, rawMaterial), "liner:front"));
  walls.back.add(named(part(2 * innerX, LINER, linerHeight, 0, -WALL / 2 - LINER / 2, linerZ - wallZ, rawMaterial), "liner:back"));

  // ledge strips along the front and back walls (the side walls are too close to the strip legs and the bars)
  const ledgeZ = LID_BOTTOM - 0.2 - LEDGE_HEIGHT / 2;
  walls.front.add(named(part(2 * (innerX - 1.5), LEDGE_WIDTH, LEDGE_HEIGHT, 0, WALL / 2 + LEDGE_WIDTH / 2, ledgeZ - wallZ, rawMaterial), "ledge:front"));
  walls.back.add(named(part(2 * (innerX - 1.5), LEDGE_WIDTH, LEDGE_HEIGHT, 0, -WALL / 2 - LEDGE_WIDTH / 2, ledgeZ - wallZ, rawMaterial), "ledge:back"));

  // tiny pin heads on the outer front face (photo: dots along the wall)
  for (let k = 0; k < 8; k++) {
    const x = (k - 3.5) * 33;
    const pin = at(cylinder(0.5, 0.4, "y", getMaterial("brass-dark"), 8), x, CASE_Y_FRONT - 0.15, LID_BOTTOM - 4);
    pin.name = `wallPin:${k}`;
    root.add(pin);
  }
  return { root, walls };
}
