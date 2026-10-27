import { Group, LatheGeometry, Mesh, Vector2 } from "three";

/** The one accent colour of the interface (verdigris). */
export const ACCENT = 0x5fb3a1;
import { getMaterial } from "../materials/factory";
import { STRIP_CENTRE_Y, BARREL_LENGTH, BARREL_OUTER, LID_TOP } from "./case";
import { at, named } from "./common";
import { hitCylinder } from "./proxies";

/** Overall length, mm (paper Fig 21, p17). */
export const STYLUS_LENGTH = 70;
/** Distance from the tip to the middle of the collar. */
const COLLAR_AT = 52;

function lathe(points: [number, number][], mat: ReturnType<typeof getMaterial>, segments = 24): Mesh {
  // profile in (radius, height along the axis); the lathe axis is local y
  return new Mesh(new LatheGeometry(points.map(([r, h]) => new Vector2(r, h)), segments), mat);
}

/**
 * The stylus (paper Fig 21): a long tapered steel point, a brass shaft, a collar and a round rear knob. Group frame: the tip at the
 * origin, the axis along +y (towards the knob).
 */
export function buildStylus(): Group {
  const stylus = named(new Group(), "stylusModel");
  const steel = getMaterial("steel");
  const brass = getMaterial("brass-brushed");
  stylus.add(named(lathe([[0, 0], [0.3, 0.4], [0.9, 13], [1.0, 16]], steel), "stylusPoint"));
  // shaft with a slight swell, collar and grip
  stylus.add(named(lathe([[1.0, 16], [1.15, 30], [1.25, COLLAR_AT - 2], [1.9, COLLAR_AT - 1.2], [1.9, COLLAR_AT + 1.2], [1.35, COLLAR_AT + 2], [1.5, 62], [0, 62]], brass), "stylusBody"));
  // round rear knob: a sphere seated on the end of the shaft (the shaft is capped so that no gap shows)
  const knob: [number, number][] = [];
  for (let k = 0; k <= 12; k++) {
    const a = (k / 12) * Math.PI;
    knob.push([Math.sin(a) * 2.6 + 0.01, 61.2 + 2.6 - Math.cos(a) * 2.6]);
  }
  stylus.add(named(lathe(knob, brass), "stylusKnob"));
  stylus.add(at(hitCylinder("stylus", 3.5, STYLUS_LENGTH + 2, "y"), 0, STYLUS_LENGTH / 2, 0));
  return stylus;
}

/** Where the stylus rests: tip deep in the right barrel, the knob out of its open end, lying along y (z of the barrel axis). */
export function stylusParkedPose(halfSpan: number): { x: number; y: number; z: number; yaw: number } {
  const stripWidth = 2 * (halfSpan - 1);
  const barrelFrontY = STRIP_CENTRE_Y - BARREL_LENGTH / 2;
  return {
    x: stripWidth / 2 - BARREL_OUTER - 0.5,
    y: barrelFrontY + BARREL_LENGTH - 0.6,
    z: LID_TOP + BARREL_OUTER,
    yaw: Math.PI, // local +y (knob) points to -y, towards the wheels
  };
}
