import { Box3, Mesh, Object3D, PerspectiveCamera, Raycaster, Vector3 } from "three";
import { DIM, OUTPUT_SHAFT_Z } from "../parts/dimensions";
import type { PrototypeSession } from "../scene/prototype";

/**
 * Dev-only measurements for `npm run look` (scripts/look.mjs): numbers that catch gross visual defects.
 * Spec coordinates (+x right, +y away, +z up) turn into three coordinates as (x, z + 30, -y).
 */
const toThree = (x: number, y: number, z: number): Vector3 => new Vector3(x, z + 30, -y);

function isShell(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) {
    if (o.name === "box" || o.name === "floor" || o.name === "plinth" || o.name.startsWith("wall:") || o.name === "lid" || o.name === "label" || o.name === "slider") return true;
  }
  return false;
}

export interface LookReport {
  /** Share of the case floor (inner area) whose top view is covered by some part of the mechanism or frame. */
  floorCoverage: number;
  /** Largest empty strip along y and along x on the floor, millimetres. */
  largestGapY: number;
  largestGapX: number;
  /** Per level and row: share of sample points on the visible digit cell that the camera really sees. */
  digitVisibility: { level: number; row: string; seen: number; missed: string[] }[];
}

export async function measure(session: PrototypeSession, camera: PerspectiveCamera): Promise<LookReport> {
  const root = session.content.object;
  root.updateMatrixWorld(true);
  const boxes: Box3[] = [];
  let floor: Box3 | null = null;
  root.traverse((o) => {
    if (!(o instanceof Mesh) || !o.visible) return;
    if (o.name === "floor") {
      floor = new Box3().setFromObject(o);
      return;
    }
    if (isShell(o)) return;
    boxes.push(new Box3().setFromObject(o));
  });
  const f = floor as Box3 | null;
  if (!f) throw new Error("no floor");
  // top view: three x, three z; inner area inside the walls (3 mm)
  const x0 = f.min.x + 3;
  const x1 = f.max.x - 3;
  const z0 = f.min.z + 3;
  const z1 = f.max.z - 3;
  const step = 2;
  let covered = 0;
  let total = 0;
  const columnCovered = new Map<number, boolean>();
  const rowCovered = new Map<number, boolean>();
  for (let x = x0; x < x1; x += step) {
    for (let z = z0; z < z1; z += step) {
      total++;
      const hit = boxes.some((b) => x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z);
      if (hit) covered++;
      const cx = Math.round((x - x0) / step);
      const cz = Math.round((z - z0) / step);
      if (hit) {
        columnCovered.set(cx, true);
        rowCovered.set(cz, true);
      }
    }
  }
  const longestRun = (covered: Map<number, boolean>, count: number): number => {
    let best = 0;
    let run = 0;
    for (let i = 0; i < count; i++) {
      run = covered.get(i) ? 0 : run + 1;
      best = Math.max(best, run);
    }
    return best * step;
  };
  const largestGapX = longestRun(columnCovered, Math.round((x1 - x0) / step));
  const largestGapY = longestRun(rowCovered, Math.round((z1 - z0) / step));

  // digit visibility from the camera, for both rows
  const raycaster = new Raycaster();
  raycaster.camera = camera; // sprites (contact lamps) need it
  const digitVisibility: LookReport["digitVisibility"] = [];
  const saved = session.visibleRow;
  const topZ = OUTPUT_SHAFT_Z + DIM.drumRadius - 0.05;
  const rowY = { ascending: [33.5, 34.4, 35.4, 36.3], descending: [41.7, 42.6, 43.6, 44.5] } as const;
  const pitch = 40;
  const n = session.levelCount;
  for (const row of ["ascending", "descending"] as const) {
    session.setVisibleRow(row, true);
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    root.updateMatrixWorld(true);
    for (let i = 0; i < n; i++) {
      const cx = ((n - 1) / 2 - i) * pitch;
      let seen = 0;
      let count = 0;
      const missed: string[] = [];
      for (const y of rowY[row]) {
        for (const dx of [-3, 0, 3]) {
          const target = toThree(cx + dx, y, topZ);
          const direction = target.clone().sub(camera.position);
          const distance = direction.length();
          raycaster.set(camera.position, direction.normalize());
          const hits = raycaster.intersectObject(root, true).filter((h) => h.object.visible && h.object.parent !== null);
          const first = hits.find((h) => h.object.type === "Mesh" && !((h.object as Mesh).material as { transparent?: boolean }).transparent);
          count++;
          if (first && Math.abs(first.distance - distance) < 0.9 && first.object.parent?.name === `drum:${i}`) seen++;
          else missed.push(`y${y} x${dx}: ${first ? `${first.object.name || first.object.type} (${first.object.parent?.name})` : "nothing"}`);
        }
      }
      digitVisibility.push({ level: i, row, seen: seen / count, missed });
    }
  }
  session.setVisibleRow(saved, true);
  return { floorCoverage: covered / total, largestGapX, largestGapY, digitVisibility };
}
