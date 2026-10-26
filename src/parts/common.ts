import { BoxGeometry, CylinderGeometry, Group, Mesh, type Material, type Object3D } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { DIM } from "./dimensions";

export const RAD = Math.PI / 180;
/** Pin circle radius of every gear. */
export const R = DIM.pinCircleRadius;
/** Thickness of the support bars. */
export const BAR = 3;

/** What a part builder returns: the group to mount, named anchors, collision proxies and mouse hit targets. */
export interface PartResult {
  root: Group;
  anchors: Record<string, Object3D>;
  proxies: Object3D[];
  hits: Object3D[];
}

/** Build-time helpers. The whole machine lives in spec coordinates (+x right, +y away, +z up). */
export function cylinder(radius: number, length: number, axis: "x" | "y" | "z", mat: Material, segments = 20): Mesh {
  // the cylinder axis is local y; other axes are posed by the mesh rotation so geometry stays a plain cylinder
  const mesh = new Mesh(new CylinderGeometry(radius, radius, length, segments), mat);
  if (axis === "z") mesh.rotation.x = Math.PI / 2;
  if (axis === "x") mesh.rotation.z = Math.PI / 2;
  return mesh;
}

/** Shaft: a cylinder flagged so that bearings and hubs may sit around it. */
export function shaft(radius: number, length: number, axis: "x" | "y" | "z", mat: Material): Mesh {
  const mesh = cylinder(radius, length, axis, mat);
  mesh.userData.shaft = true;
  return mesh;
}

export function box(sx: number, sy: number, sz: number, mat: Material): Mesh {
  return new Mesh(new BoxGeometry(sx, sy, sz), mat);
}

/**
 * A forged (edge-rounded) bar: the visual is a rounded box, its collision proxy the plain box of the same size.
 * `userData` flags (kind, hook, shaft) go on the visual; tests read the proxy through `userData.of`.
 */
export function forgedBox(sx: number, sy: number, sz: number, mat: Material, radius = 0.35): Mesh {
  const visual = new Mesh(new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(radius, Math.min(sx, sy, sz) / 2 - 0.01)), mat);
  const proxy = new Mesh(new BoxGeometry(sx, sy, sz));
  proxy.visible = false;
  proxy.userData.proxy = true;
  proxy.userData.of = visual;
  visual.add(proxy);
  return visual;
}

export function at<T extends Object3D>(object: T, x: number, y: number, z: number): T {
  object.position.set(x, y, z);
  return object;
}

export function named<T extends Object3D>(object: T, name: string): T {
  object.name = name;
  return object;
}

/** Names the rigid body a part belongs to; the collision test only compares parts of different bodies. */
export function tag<T extends Object3D>(object: T, body: string): T {
  object.userData.body = body;
  return object;
}
