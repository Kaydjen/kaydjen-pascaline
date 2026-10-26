import { Box3, type Matrix4, Mesh, type Object3D, Vector3 } from "three";
import { OBB } from "three/examples/jsm/math/OBB.js";

/** Test helper: overlap detection between collision proxies (hidden boxes and cylinders, see proxies.ts). */

/** Parts count as overlapping only when they penetrate by more than this (touching is the design). */
export const SHRINK = 0.4;

type Shape = { kind: "box"; half: Vector3 } | { kind: "cylinder"; radius: number; halfHeight: number };

export interface Part {
  mesh: Mesh;
  body: string;
  shape: Shape;
  /** Surface and interior sample points in the part's own frame. */
  samples: Vector3[];
  label: string;
}

/** Nearest non-empty name of a proxy's visual or one of its ancestors (for readable failure messages). */
function nameOf(proxy: Object3D): string {
  for (let o: Object3D | null = (proxy.userData.of as Object3D | undefined) ?? proxy; o; o = o.parent) if (o.name) return o.name;
  return "?";
}

export function bodyOf(object: Object3D): string | null {
  for (let o: Object3D | null = object; o; o = o.parent) {
    if (typeof o.userData.body === "string") return o.userData.body;
  }
  return null;
}

function sampleShape(shape: Shape): Vector3[] {
  const points: Vector3[] = [];
  if (shape.kind === "box") {
    for (const fx of [-1, 0, 1]) for (const fy of [-1, 0, 1]) for (const fz of [-1, 0, 1]) {
      points.push(new Vector3(fx * shape.half.x, fy * shape.half.y, fz * shape.half.z));
    }
  } else {
    for (const fy of [-1, -0.5, 0, 0.5, 1]) {
      points.push(new Vector3(0, fy * shape.halfHeight, 0));
      for (const fr of [0.5, 1]) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          points.push(new Vector3(Math.cos(a) * fr * shape.radius, fy * shape.halfHeight, Math.sin(a) * fr * shape.radius));
        }
      }
    }
  }
  return points;
}

/** All proxies under `root`; `bodyName` decides which rigid body a proxy belongs to (default: the nearest `userData.body`). */
export function collectParts(root: Object3D, bodyName: (o: Object3D) => string | null = bodyOf): Part[] {
  const parts: Part[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh) || o.userData.proxy !== true) return;
    const type = o.geometry.type;
    // tori and the toothed wheel have no proxy; their meshing is covered by the meshing tests
    if (type !== "BoxGeometry" && type !== "CylinderGeometry") throw new Error(`unsupported proxy shape ${type}`);
    const body = bodyName(o);
    if (body === null) throw new Error(`part without body tag: ${type}`);
    let shape: Shape;
    if (type === "BoxGeometry") {
      const p = o.geometry.parameters as { width: number; height: number; depth: number };
      shape = { kind: "box", half: new Vector3(p.width / 2, p.height / 2, p.depth / 2) };
    } else {
      const p = o.geometry.parameters as { radiusTop: number; height: number };
      shape = { kind: "cylinder", radius: p.radiusTop, halfHeight: p.height / 2 };
    }
    parts.push({ mesh: o, body, shape, samples: sampleShape(shape), label: `${type}[${nameOf(o)}] in ${body}` });
  });
  return parts;
}

const flags = (part: Part): Record<string, unknown> => (part.mesh.userData.of as Mesh).userData;

/** Overlaps that are the design: shafts run through the hubs and the bushed bars they sit in. */
export function allowedOverlap(a: Part, b: Part): boolean {
  const level = (key: string): string => key.split(":")[1] ?? "";
  const shaftThroughBody = (shaft: Part, other: Part): boolean => flags(shaft).shaft === true && other.body.startsWith("body:") && level(shaft.body) === level(other.body);
  // a shaft runs through a bearing bar and through the body hub sitting on it
  const shaftThroughBearing = (shaft: Part, other: Part): boolean => (flags(shaft).shaft === true || flags(shaft).pin === true) && flags(other).bearing === true;
  return shaftThroughBody(a, b) || shaftThroughBody(b, a) || shaftThroughBearing(a, b) || shaftThroughBearing(b, a);
}

const tmp = new Vector3();

/** True when a world-space point lies inside the part shrunk by SHRINK. */
export function inside(part: Part, inverse: Matrix4, world: Vector3): boolean {
  const p = tmp.copy(world).applyMatrix4(inverse);
  if (part.shape.kind === "box") {
    const h = part.shape.half;
    return Math.abs(p.x) < h.x - SHRINK && Math.abs(p.y) < h.y - SHRINK && Math.abs(p.z) < h.z - SHRINK;
  }
  return Math.hypot(p.x, p.z) < part.shape.radius - SHRINK && Math.abs(p.y) < part.shape.halfHeight - SHRINK;
}

export function overlap(a: Part, b: Part): boolean {
  a.mesh.updateWorldMatrix(true, false);
  b.mesh.updateWorldMatrix(true, false);
  if (a.shape.kind === "box" && b.shape.kind === "box") {
    const oa = new OBB(new Vector3(), a.shape.half.clone().subScalar(SHRINK)).applyMatrix4(a.mesh.matrixWorld);
    const ob = new OBB(new Vector3(), b.shape.half.clone().subScalar(SHRINK)).applyMatrix4(b.mesh.matrixWorld);
    return oa.intersectsOBB(ob);
  }
  const invA = a.mesh.matrixWorld.clone().invert();
  const invB = b.mesh.matrixWorld.clone().invert();
  const world = new Vector3();
  for (const s of a.samples) {
    if (inside(b, invB, world.copy(s).applyMatrix4(a.mesh.matrixWorld))) return true;
  }
  for (const s of b.samples) {
    if (inside(a, invA, world.copy(s).applyMatrix4(b.mesh.matrixWorld))) return true;
  }
  return false;
}

/** Descriptions of every unintended overlap between parts of different bodies (`skip` may exempt a pair). */
export function findOverlaps(parts: Part[], skip: (a: Part, b: Part) => boolean = () => false): Set<string> {
  const found = new Set<string>();
  const boxes = parts.map((p) => new Box3().setFromObject(p.mesh));
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i]!;
      const b = parts[j]!;
      if (a.body === b.body || skip(a, b)) continue;
      if (!boxes[i]!.intersectsBox(boxes[j]!)) continue;
      if (allowedOverlap(a, b)) continue;
      if (overlap(a, b)) {
        const c = boxes[i]!.getCenter(new Vector3());
        found.add(`${a.label} x ${b.label} near three(${c.x.toFixed(0)}, ${c.y.toFixed(0)}, ${c.z.toFixed(0)})`);
      }
    }
  }
  return found;
}

/** True when a world-space point lies inside the (shrunk) proxy. */
export function pointInside(part: Part, world: Vector3): boolean {
  part.mesh.updateWorldMatrix(true, false);
  return inside(part, part.mesh.matrixWorld.clone().invert(), world);
}
