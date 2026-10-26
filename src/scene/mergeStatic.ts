import { BufferAttribute, type BufferGeometry, Mesh, type Material, type Object3D } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Performance pass: everything that moves as one rigid body is merged into one mesh per material (and per shadow
 * behaviour). A rigid root is any object flagged `userData.rigid`; the meshes below it that do not belong to a nested rigid root
 * are baked into the root's frame. Meshes flagged `userData.keep` (digit paper, stylus knob), dynamic ones (`userData.dynamic`,
 * the leaf spring), instanced meshes, hit targets and collision proxies are left alone (proxies are dropped: only tests read them).
 */
function normalised(source: BufferGeometry): BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  for (const name of Object.keys(geometry.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") geometry.deleteAttribute(name);
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  if (!geometry.getAttribute("uv")) geometry.setAttribute("uv", new BufferAttribute(new Float32Array(geometry.getAttribute("position").count * 2), 2));
  return geometry;
}

interface Bucket {
  material: Material;
  cast: boolean;
  receive: boolean;
  geometries: BufferGeometry[];
}

function mergeRoot(root: Object3D): { before: number; after: number } {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const buckets = new Map<string, Bucket>();
  const removed: Mesh[] = [];

  const visit = (object: Object3D): void => {
    for (const child of [...object.children]) {
      if (child.userData.rigid === true || child.userData.keep === true || child.userData.hit !== undefined) continue;
      if (child.userData.proxy === true) {
        child.removeFromParent();
        continue;
      }
      if (child instanceof Mesh && !("isInstancedMesh" in child) && child.userData.dynamic !== true && !Array.isArray(child.material)) {
        const geometry = normalised(child.geometry);
        geometry.applyMatrix4(inverse.clone().multiply(child.matrixWorld));
        const key = `${child.material.uuid}:${child.castShadow}:${child.receiveShadow}`;
        let bucket = buckets.get(key);
        if (!bucket) buckets.set(key, (bucket = { material: child.material, cast: child.castShadow, receive: child.receiveShadow, geometries: [] }));
        bucket.geometries.push(geometry);
        removed.push(child);
        // children of a merged mesh (collision proxies, hit targets) are handled by the recursion below only when they are not baked
      }
      visit(child);
    }
  };
  visit(root);
  for (const mesh of removed) mesh.removeFromParent();
  let after = 0;
  for (const bucket of buckets.values()) {
    const merged = mergeGeometries(bucket.geometries, false);
    if (!merged) continue;
    const mesh = new Mesh(merged, bucket.material);
    mesh.castShadow = bucket.cast;
    mesh.receiveShadow = bucket.receive;
    mesh.name = `${root.name || "merged"}:${bucket.material.name || "material"}${bucket.cast ? "" : ":small"}`;
    root.add(mesh);
    after++;
  }
  return { before: removed.length, after };
}

/** Merges every rigid root below `scene`; returns how many meshes were replaced by how many. */
export function mergeStatic(scene: Object3D): { before: number; after: number } {
  const roots: Object3D[] = [];
  scene.traverse((o) => o.userData.rigid === true && roots.push(o));
  let before = 0;
  let after = 0;
  for (const root of roots) {
    const result = mergeRoot(root);
    before += result.before;
    after += result.after;
  }
  return { before, after };
}
