import { type Object3D, type PerspectiveCamera, Ray, Raycaster, Vector2, Vector3 } from "three";
import { HIT_LAYER } from "../parts/proxies";
import type { Assembly } from "../scene/assembly";

export interface Hit {
  /** `userData.hit` of the target: "wheel:2", "gear:2", "stylus", "barrel:0", "strip", "label", "lid", "frame", "box". */
  name: string;
  object: Object3D;
  /** World position of the intersection. */
  point: Vector3;
  distance: number;
}

/** Picks the nearest mouse target under a pointer; works on the hit layer only. */
export class HitTester {
  private readonly raycaster = new Raycaster();
  private targets: Object3D[] = [];
  private forAssembly: Assembly | null = null;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly assembly: () => Assembly,
  ) {
    this.raycaster.layers.set(HIT_LAYER);
  }

  private refresh(): void {
    const assembly = this.assembly();
    if (assembly === this.forAssembly) return;
    this.forAssembly = assembly;
    this.targets = assembly.hitTargets();
  }

  /** Pointer ray in world space. */
  ray(ndc: Vector2): Ray {
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.clone();
  }

  /** Nearest target for which `accept(name)` holds, or null. */
  pick(ndc: Vector2, accept: (name: string) => boolean = () => true): Hit | null {
    this.refresh();
    this.assembly().root.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.targets, false)) {
      const name = hit.object.userData.hit as string;
      if (accept(name)) return { name, object: hit.object, point: hit.point, distance: hit.distance };
    }
    return null;
  }
}
