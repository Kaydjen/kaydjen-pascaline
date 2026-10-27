import { STEP_DEG } from "../sim/params";

/**
 * Layout constants and small helpers shared by the box and the lid. Spec coordinates (+x right, +y away, +z up), millimetres,
 * x = 0 at the middle of the machine. Shapes follow the photos of specimen CnAM 823-1;
 * sizes the photos cannot give are my estimates [inference].
 */
/** Flat brass lid: the input wheels end flush with its top face, the crown numerals sit on it. */
export const LID_TOP = 46.8;
export const LID_THICKNESS = 1.2;
export const LID_BOTTOM = LID_TOP - LID_THICKNESS;
/** The lid overhangs the walls on every side. */
export const LID_OVERHANG = 1.5;

/** The museum case is 128 mm deep but the mechanism fills only about 100 mm: the case is sized to the mechanism so that there is no empty space. */
export const CASE_Y_FRONT = -42;
export const CASE_Y_BACK = 56;
export const CASE_Z_BOTTOM = -26;
export const WALL = 3;
export const FLOOR_TOP = -22;
export const PLINTH_HEIGHT = 8;
export const PLINTH_OVERHANG = 2.5;

/** Inner radius of the crown ring around an input wheel (the wheel itself is 16); the lid is closed under it. */
export const CROWN_HOLE_RADIUS = 16.4;
/** Neighbouring crowns touch: the outer diameter is the level pitch. */
export const crownOuterRadius = (pitch: number): number => pitch / 2 - 0.05;
/** The crown stands this high above the lid: a thick ring with a thin numeral plate on it (mm). */
export const CROWN_EDGE = 2.2;
/** Dark closed disc on the lid under every wheel (the real plate under the spokes). */
export const WHEEL_PLATE_THICKNESS = 0.12;

/**
 * One small window per drum (photos): about as wide as a digit cell and a bit taller. The opening is cut with a 45 degree
 * bevel that widens towards the top, so that the lid edge does not hide the digit when seen from the side.
 */
export const WINDOW_Y_FROM = 32.6;
export const WINDOW_Y_TO = 44.7;
export const WINDOW_HALF_WIDTH = 5.6;

/** Label strip between the wheels and the windows. */
export const LABEL_Y_FROM = 17.5;
export const LABEL_Y_TO = 26;
export const LABEL_THICKNESS = 0.8;
export const LABELS = ["Nombre\nsimple", "dizaine", "Centaine", "mille", "dizaines\nde mille", "Centaine\nde mille"];

/**
 * Sliding strip (paper item 33) lies on the lid just behind the windows and is pulled by hand along y: at rest in
 * its rear position it covers the rear half of every window (front row visible), pulled forward it covers the front half.
 * A hollow barrel lies on each end of it with its open end towards the wheels (photos); the stylus rests in the right one.
 */
export const STRIP_LENGTH = 9;
export const BAR_TRAVEL = STRIP_LENGTH / 2;
/**
 * Rows of digits on the drum (y of the digit centres). They sit 8 mm apart so that the strip edge, which stands 2.5 mm above
 * the paper and hides a further 3 mm behind it from the default camera, never clips a digit of the row that is wanted.
 */
export const DRUM_ROW_Y = { ascending: 34.9, descending: 43.1 } as const;
/** Digit height on the paper, mm. */
export const DIGIT_HEIGHT = 3.6;
/** Row boundary on the drums (y) = centre of the strip at zero offset. */
export const STRIP_CENTRE_Y = 37.5;
export const STRIP_THICKNESS = 0.6;
export const SLOT_HALF_WIDTH = 1.7;
export const STRIP_LEG_LENGTH = 3.4;
export const BARREL_OUTER = 2.5;
export const BARREL_INNER = 1.7;
export const BARREL_LENGTH = 7;

/**
 * Rotation (radians, clockwise) of a numeral that stands at `angleRad` (clockwise from up) on a dial: the bottoms turn
 * towards the viewer (upright at the front and the back) and lean only part of the way to the radial angle at the sides.
 */
export const numeralRotation = (angleRad: number): number => 0.4 * (Math.PI / 2) * Math.sin(angleRad);

/** Small deterministic generator for the hand-cut jitter (the same engraving on every build). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Numerals around an input wheel: digit d stands d steps short of the stop, which is at the front (180 degrees, clockwise from up). */
export const crownAngleDeg = (digit: number): number => 180 - digit * STEP_DEG;

export const COVER_WALLS = ["front", "back", "left", "right"] as const;
export type WallName = (typeof COVER_WALLS)[number];

