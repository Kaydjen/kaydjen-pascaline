/** Geometry assumptions of one level, millimetres. */
const BASE = {
  pinCount: 10,
  pinCircleRadius: 14,
  pinRadius: 1.2,
  /** Pin length of the vertical input gear 40 (z-span) and of the accumulator gears (y-span). */
  inputPinSpanZ: 4,
  accPinSpanY: 4,
  /** The pins of gear 40 are offset against gear 45 by half a pitch. */
  inputPinPhaseDeg: 18,
  /** Spacing used by the output-stage tooth generator (gap between pin surface and tooth flank). */
  toothClearance: 0.12,
  /** Tip radius of the 10-tooth output wheel 56. */
  toothTipRadius: 17.2,
  /** Axial layout along the accumulator shaft (y), accumulator axis at x = 0, z = 0 of each level. Own bars occupy y 3.5..9.5, the carry leg 8..12, the carry hub and bridge 12..15 (they must not meet the own bars of the same shaft); gear 48 pins 18..22. */
  y: { gear45: 0, bars: 6.5, leg: 10, hub: 14, gear48: 20, gear50: 30 },
  /** Not in the paper [unknown]: sized so that the paper sits just under the flat lid (wheel 56 tips reach z = 45.2). */
  drumRadius: 17.2,
  drumLength: 12,
} as const;

type Widen<T> = T extends number ? number : { -readonly [K in keyof T]: Widen<T[K]> };
export type Dimensions = Widen<typeof BASE>;
export const DIM: Dimensions = BASE;

/** Input shaft position (y) and the z of gear 40's disc: the pins hang down and straddle the y-pins at z = R. */
export const INPUT_SHAFT_Y = -DIM.pinCircleRadius;
export const INPUT_GEAR_Z = DIM.pinCircleRadius + DIM.inputPinSpanZ / 2;
/** Output shaft (wheel 56 and drum) sits straight above the accumulator at the pitch distance. */
export const OUTPUT_SHAFT_Z = 2 * DIM.pinCircleRadius;
