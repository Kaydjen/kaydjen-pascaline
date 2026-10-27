import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, Points, PointsMaterial } from "three";

/** Number of specks, and the box they drift in (mm, world axes: y up). */
const COUNT = 70;
const BOX = { x: 260, yFrom: 6, yTo: 190, z: 190 };

function speckTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.4)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new CanvasTexture(canvas);
}

/** Tiny pseudo-random generator so that every visit starts with the same specks. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Dust {
  points: Points;
  update(dt: number): void;
}

/** A few dozen warm specks drifting very slowly in the air round the machine: dust in the light of a lamp. Additive, no depth write. */
export function createDust(): Dust {
  const random = seeded(1642);
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const phase: number[] = [];
  const speed: number[] = [];
  const tint = new Color(0xffd9a0);
  for (let i = 0; i < COUNT; i++) {
    positions[3 * i] = (random() * 2 - 1) * BOX.x;
    positions[3 * i + 1] = BOX.yFrom + random() * (BOX.yTo - BOX.yFrom);
    positions[3 * i + 2] = (random() * 2 - 1) * BOX.z;
    const glow = 0.15 + 0.85 * random() ** 2; // most are faint, a few catch the light
    colors[3 * i] = tint.r * glow;
    colors[3 * i + 1] = tint.g * glow;
    colors[3 * i + 2] = tint.b * glow;
    phase.push(random() * Math.PI * 2);
    speed.push(0.6 + random() * 1.2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  const material = new PointsMaterial({ map: speckTexture(), size: 1.3, sizeAttenuation: true, vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.55 });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 5;
  let clock = 0;
  return {
    points,
    update(dt) {
      clock += Math.min(Math.max(dt, 0), 0.1);
      const attribute = geometry.getAttribute("position") as BufferAttribute;
      for (let i = 0; i < COUNT; i++) {
        // a slow rise with a lazy sideways sway; a speck that leaves the box comes back in at the other end
        let y = attribute.getY(i) + 0.9 * speed[i]! * dt;
        if (y > BOX.yTo) y = BOX.yFrom;
        attribute.setY(i, y);
        attribute.setX(i, attribute.getX(i) + 2.2 * Math.sin(clock * 0.21 * speed[i]! + phase[i]!) * dt);
        attribute.setZ(i, attribute.getZ(i) + 2.2 * Math.cos(clock * 0.17 * speed[i]! + phase[i]!) * dt);
      }
      attribute.needsUpdate = true;
    },
  };
}
