import { BoxGeometry, type BufferGeometry, CylinderGeometry, Mesh, type Object3D } from "three";

/**
 * Collision proxies. A proxy is a hidden mesh with `userData.proxy = true` and `userData.of` pointing at the visual it stands
 * for; tests and the mouse read proxies, never the visual shapes (the visuals may be any forged shape).
 * Visuals that are plain boxes or cylinders get their proxy automatically (a child with the same geometry);
 * other visuals must bring their own proxy.
 */
export function attachPrimitiveProxies(root: Object3D): number {
  const visuals: Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh) || o.userData.proxy === true || o.userData.hit !== undefined) return;
    const type = o.geometry.type;
    if (type === "BoxGeometry" || type === "CylinderGeometry") visuals.push(o);
  });
  for (const visual of visuals) {
    const proxy = new Mesh(visual.geometry);
    proxy.visible = false;
    proxy.userData.proxy = true;
    proxy.userData.of = visual;
    visual.add(proxy);
  }
  return visuals.length;
}

export const isProxy = (o: Object3D): boolean => o.userData.proxy === true;

/** Adds a hidden box proxy (centre x, y, z in the local frame of `visual`) for a visual that is not a plain primitive. */
export function addBoxProxy(visual: Mesh, size: [number, number, number], centre: [number, number, number]): Mesh {
  const proxy = new Mesh(new BoxGeometry(...size));
  proxy.position.set(...centre);
  proxy.visible = false;
  proxy.userData.proxy = true;
  proxy.userData.of = visual;
  visual.add(proxy);
  return proxy;
}

/** Layer of the mouse hit proxies: the main camera never draws it, the picking raycaster looks at nothing else. */
export const HIT_LAYER = 1;

/**
 * Larger-than-visual, invisible target for the mouse (`userData.hit` names it: "wheel:2", "gear:2", "stylus", "barrel:0",
 * "strip", "label", "lid", "frame", "box"). Distinct from the collision proxies.
 */
export function makeHit(name: string, geometry: BufferGeometry): Mesh {
  const hit = new Mesh(geometry);
  hit.visible = false;
  hit.layers.set(HIT_LAYER);
  hit.userData.hit = name;
  hit.name = `hit:${name}`;
  return hit;
}

/** Hit disc or cylinder along z (axis "z") or y. */
export function hitCylinder(name: string, radius: number, length: number, axis: "y" | "z"): Mesh {
  const hit = makeHit(name, new CylinderGeometry(radius, radius, length, 24));
  if (axis === "z") hit.rotation.x = Math.PI / 2;
  return hit;
}

export function hitBox(name: string, size: [number, number, number], centre: [number, number, number]): Mesh {
  const hit = makeHit(name, new BoxGeometry(...size));
  hit.position.set(...centre);
  return hit;
}
