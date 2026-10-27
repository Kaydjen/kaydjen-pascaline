import { AdditiveBlending, CanvasTexture, Color, Group, Mesh, type Object3D, Sprite, SpriteMaterial } from "three";
import { Mechanism } from "../sim/mechanism";
import { STEP_DEG } from "../sim/params";
import { BAR_TRAVEL, CASE_Y_BACK, CASE_Y_FRONT, CASE_Z_BOTTOM, COVER_WALLS, LABEL_Y_FROM, LABEL_Y_TO, LID_BOTTOM, LID_TOP, STRIP_CENTRE_Y, STRIP_LENGTH, type WallName } from "../parts/case";
import { buildBox, outerHalfWidth, type BoxParts } from "../parts/boxCase";
import { buildLid, type LidParts } from "../parts/lid";
import { buildCarry, buildPawl, poseCarry, type CarryParts } from "../parts/carry";
import { buildOutput } from "../parts/drums";
import { buildFrame, buildUnderLidBar } from "../parts/frame";
import { buildAccumulator } from "../parts/gears";
import { attachPrimitiveProxies, hitBox } from "../parts/proxies";
import { buildStylus, stylusParkedPose } from "../parts/stylus";
import { buildStylusStand, STAND_VARIANTS, standPlacement } from "../parts/stylusStand";
import { buildWheelGroup } from "../parts/wheelGroup";
import { mergeStatic } from "./mergeStatic";
import { ASSEMBLED_S, layout } from "./teardown";

const RAD = Math.PI / 180;
/**
 * Sliding strip: a lightly under-damped spring (about 5 % overshoot at the ends); the longest frame time that counts is
 * clamped (a stalled frame must not teleport it).
 */
const PANEL_OMEGA = 13;
const PANEL_DAMPING = 2 * 0.7 * PANEL_OMEGA;
const PANEL_MAX_DT = 1 / 20;
/** How far a lid pin rises when it is pulled out, mm. */
const PIN_PULL = 7;
const ACCENT = 0x5fb3a1;

/** Soft round glow for the contact lamps (accent colour, additive, shown only while a contact works). */
function glowTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

/** Parts that can be taken off to look inside; the lid also carries the label strip and the back bar. */
export type CoverName = "lid" | "label" | "bar" | `wall:${WallName}`;
export const COVER_NAMES: readonly CoverName[] = ["lid", "label", "bar", ...COVER_WALLS.map((w): CoverName => `wall:${w}`)];

/** Wheel positions (steps) and carry body lifts (degrees) to draw; lift is 0 on the units level. */
export interface Pose {
  u: number[];
  lift: number[];
}

export function currentPose(m: Mechanism): Pose {
  return { u: m.levels.map((l) => l.u), lift: m.levels.map((_, i) => m.carryOn(i)?.lift ?? 0) };
}

interface Glow {
  sprite: Sprite;
  level: number;
}

interface LevelParts {
  acc: Group;
  /** Pin cage, shaft, star wheel and hub: rides in the lid assembly. */
  wheel: Group;
  output: Group;
  pawlLever: Group;
  carry: CarryParts | null;
}

/**
 * The machine as three rigid groups that part in the teardown: `box` (fixed), `frame` (the mechanism that stays on the
 * floor until it is lifted out second) and `lidAssembly` (lid, label, sliding strip, input wheels with their shafts and cages,
 * the bearing bar under the lid). Nothing here feeds back into the simulation.
 */
export class Assembly {
  /** Three.js scene root; the machine group inside converts spec axes (z up, y away) to y up. */
  readonly root = new Group();
  readonly machine = new Group();
  readonly box = new Group();
  readonly frame: Group;
  readonly lidAssembly = new Group();
  readonly stylus = new Group();
  /** True while the stylus rests on its stand (fixed on the table). The stylus controller clears it. */
  stylusParked = true;
  /** First visit: the stand breathes quietly until the stylus is taken for the first time. Set by the stylus controller. */
  standHint = false;
  private standGlow!: Sprite;
  private standClock = 0;
  private readonly levels: LevelParts[] = [];
  private readonly bounce: { t: number; amp: number; previous: number }[] = [];
  private readonly boxParts: BoxParts;
  private readonly lidParts: LidParts;
  private readonly covers = new Map<CoverName, boolean>(COVER_NAMES.map((name) => [name, true]));
  /** Which drum row the sliding panel leaves visible, and how far (mm along y) the panel has travelled. */
  private visibleRow: "ascending" | "descending" = "ascending";
  private panelOffset = BAR_TRAVEL;
  private panelVelocity = 0;
  private readonly glows: { lift: Glow; kick: Glow; previousLift: number }[] = [];
  private readonly settleState: { t: number; moving: boolean; previous: number }[] = [];

  constructor(
    private readonly mechanism: Mechanism,
    options: { merge?: boolean } = {},
  ) {
    const machine = this.machine;
    machine.rotation.x = -Math.PI / 2;
    machine.position.y = 30;
    this.root.add(machine);

    const params = mechanism.params;
    const n = params.levelCount;
    this.box.name = "box";
    this.lidAssembly.name = "lidAssembly";
    this.stylus.name = "stylus";
    this.frame = buildFrame(params);
    machine.add(this.box, this.frame, this.lidAssembly, this.stylus);

    for (let i = 0; i < n; i++) {
      const x = ((n - 1) / 2 - i) * params.levelPitch;
      const level = new Group();
      level.name = `level:${i}`;
      level.position.x = x;
      this.frame.add(level);

      const acc = buildAccumulator(i, params);
      acc.name = `accumulator:${i}`;
      level.add(acc);
      const output = buildOutput(i);
      level.add(output);
      const pawlLever = buildPawl(level, i);
      const carry = i > 0 ? buildCarry(level, i, params) : null;
      const wheel = buildWheelGroup(i, x);
      this.lidAssembly.add(wheel);
      for (const rigid of [acc, wheel, output, pawlLever, carry?.body, carry?.sautoirLever]) if (rigid) rigid.userData.rigid = true;
      this.levels.push({ acc, wheel, output, pawlLever, carry });
      if (carry) this.addGlows(i, carry.body, carry.sautoirLever, params.armReach);
    }
    this.lidAssembly.add(buildUnderLidBar(params));

    // box: floor, plinth, walls; the lid, the label strip and the sliding strip (paper item 33) come off with the lid assembly
    this.boxParts = buildBox(n, params.levelPitch);
    this.lidParts = buildLid(n, params.levelPitch);
    this.box.add(this.boxParts.root);
    this.lidAssembly.add(this.lidParts.lid, this.lidParts.label, this.lidParts.slider);
    for (const rigid of [this.box, this.frame, this.lidAssembly, this.stylus, this.lidParts.lid, this.lidParts.label, this.lidParts.slider]) rigid.userData.rigid = true;
    this.addHits(n, params.levelPitch);
    this.stylus.add(buildStylus());
    const standVariant = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("stand");
    const stand = buildStylusStand(STAND_VARIANTS.find((v) => v === standVariant) ?? "saddle");
    this.standGlow = new Sprite(new SpriteMaterial({ map: glowTexture(), color: new Color(0xb8924a).multiplyScalar(2.2), blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
    this.standGlow.scale.set(40, 40, 1);
    this.standGlow.position.set(0, 0, standPlacement(this.levelHalfSpan()).restZ - standPlacement(this.levelHalfSpan()).tableZ);
    stand.add(this.standGlow); // always "visible" at opacity 0: its shader program is built with the others, not at the first breath
    const standAt = standPlacement(this.levelHalfSpan());
    stand.position.set(standAt.x, standAt.y, standAt.tableZ);
    stand.userData.rigid = true;
    machine.add(stand);
    const park = stylusParkedPose(this.levelHalfSpan());
    this.stylus.position.set(park.x, park.y, park.z);
    this.stylus.rotation.z = park.yaw;
    this.stylus.rotation.x = 0;
    attachPrimitiveProxies(machine);
    // small parts only receive shadows (no acne in the dense interior); bodies larger than 8 mm radius cast them too
    machine.traverse((o) => {
      if (!(o instanceof Mesh) || o.userData.proxy === true || o.userData.hit !== undefined) return;
      o.receiveShadow = true;
      o.geometry.computeBoundingSphere();
      o.castShadow = !("isInstancedMesh" in o) && o.userData.noShadow !== true && o.geometry.boundingSphere!.radius > 8;
    });
    if (options.merge) mergeStatic(machine);
    this.update();
  }

  private teardownAmount = 0;
  /** The four locating pins of the lid (clicked out one by one), their wanted state and how far each is pulled up now, mm. */
  private readonly pinOut = [false, false, false, false];
  private readonly pinLift = [0, 0, 0, 0];
  private lidWasUp = false;

  /** Pulls a lid pin out (or pushes it back); returns how many pins are out now. */
  togglePin(k: number): number {
    if (k >= 0 && k < this.pinOut.length) this.pinOut[k] = !this.pinOut[k];
    return this.pinOut.filter(Boolean).length;
  }

  private updatePins(dt: number): void {
    // once the lid has come up and gone back down, the pins drop into the frame ears again
    if (this.teardownAmount >= ASSEMBLED_S) this.lidWasUp = true;
    else if (this.lidWasUp) {
      this.lidWasUp = false;
      this.pinOut.fill(false);
    }
    this.pinLift.forEach((lift, k) => {
      const wanted = this.pinOut[k] ? PIN_PULL : 0;
      const next = Math.abs(wanted - lift) < 0.01 ? wanted : lift + (wanted - lift) * (1 - Math.exp(-Math.max(dt, 0) / 0.09));
      this.pinLift[k] = next;
      const clip = this.lidParts.lid.getObjectByName(`lidClip:${k}`);
      if (clip) clip.position.z = LID_TOP + next;
    });
  }

  /** Exploded view, 0 = assembled .. 1 = fully apart (see teardown.ts). */
  setTeardown(s: number): void {
    this.teardownAmount = Math.min(Math.max(s, 0), 1);
    const { lidZ, frameZ } = layout(this.teardownAmount);
    this.lidAssembly.position.z = lidZ;
    this.frame.position.z = frameZ;
  }

  get teardown(): number {
    return this.teardownAmount;
  }

  /** Which of the two drum rows shows through the windows; the panel slides over the other one. `instant` skips the glide. */
  setVisibleRow(row: "ascending" | "descending", instant = false): void {
    this.visibleRow = row;
    if (instant) {
      this.panelOffset = this.panelTarget();
      this.panelVelocity = 0;
    }
  }

  /** The panel covers the rear half of every window while the (front) ascending row is wanted, the front half otherwise. */
  private panelTarget(): number {
    return this.visibleRow === "ascending" ? BAR_TRAVEL : -BAR_TRAVEL;
  }

  /** Takes a cover off (or puts it back) to look at the mechanism. Things standing on the lid go with it. */
  setCover(name: CoverName, visible: boolean): void {
    this.covers.set(name, visible);
    this.applyCovers();
  }

  cover(name: CoverName): boolean {
    return this.covers.get(name) ?? true;
  }

  private applyCovers(): void {
    const lid = this.cover("lid");
    this.lidParts.lid.visible = lid;
    this.lidParts.label.visible = lid && this.cover("label");
    this.lidParts.slider.visible = lid && this.cover("bar");
    for (const wall of COVER_WALLS) this.boxParts.walls[wall].visible = this.cover(`wall:${wall}`);
  }

  get visibleDrumRow(): "ascending" | "descending" {
    return this.visibleRow;
  }

  /** Mouse targets that are not part of a builder: lid, label, strip, barrels, frame, box (sizes follow the level count). */
  private addHits(levelCount: number, pitch: number): void {
    const halfSpan = (levelCount * pitch) / 2;
    const outer = outerHalfWidth(levelCount, pitch);
    const yMid = (CASE_Y_BACK + CASE_Y_FRONT) / 2;
    const yLength = CASE_Y_BACK - CASE_Y_FRONT;
    const labelLength = levelCount * pitch - 6;
    this.lidParts.lid.add(hitBox("lid", [2 * outer + 3, yLength + 3, 3], [0, yMid, LID_TOP - 0.8]));
    this.lidParts.label.add(hitBox("label", [labelLength, LABEL_Y_TO - LABEL_Y_FROM, 3], [0, (LABEL_Y_FROM + LABEL_Y_TO) / 2, LID_TOP + 0.5]));
    const strip = this.lidParts.slider;
    strip.add(hitBox("strip", [2 * (halfSpan - 12), STRIP_LENGTH + 2, 4], [0, STRIP_CENTRE_Y, LID_TOP + 1]));
    const stripHalf = halfSpan - 1;
    strip.add(hitBox("barrel:0", [9, STRIP_LENGTH + 4, 8], [-(stripHalf - 3), STRIP_CENTRE_Y, LID_TOP + 3.5]));
    strip.add(hitBox("barrel:1", [9, STRIP_LENGTH + 4, 8], [stripHalf - 3, STRIP_CENTRE_Y, LID_TOP + 3.5]));
    this.frame.add(hitBox("frame", [2 * (halfSpan + 1.5), CASE_Y_BACK - CASE_Y_FRONT - 8, 66], [0, yMid, 11]));
    this.box.add(hitBox("box", [2 * outer, yLength, LID_BOTTOM - CASE_Z_BOTTOM], [0, yMid, (LID_BOTTOM + CASE_Z_BOTTOM) / 2]));
  }

  /** All mouse targets (`userData.hit`) of the machine. */
  hitTargets(): Object3D[] {
    const found: Object3D[] = [];
    this.machine.traverse((o) => o.userData.hit !== undefined && found.push(o));
    return found;
  }

  /** Contact lamps of a carry: where the body lifts on the bars, and where the sautoir kicks. */
  private addGlows(level: number, body: Group, sautoirLever: Group, armReach: number): void {
    const map = glowTexture();
    const make = (parent: Group, x: number, y: number, z: number): Glow => {
      const sprite = new Sprite(new SpriteMaterial({ map, color: new Color(ACCENT).multiplyScalar(2.4), blending: AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
      sprite.scale.set(11, 11, 1);
      sprite.position.set(x, y, z);
      sprite.renderOrder = 10;
      parent.add(sprite); // stays visible at opacity 0 so that its program is compiled with the rest (a first-use compile froze the page)
      return { sprite, level };
    };
    this.glows[level] = { lift: make(body, -1.7, 10, armReach - 1), kick: make(sautoirLever, 10, 0, -3.5), previousLift: 0 };
  }

  mechanismParams(): Mechanism["params"] {
    return this.mechanism.params;
  }

  /** Holds the sliding strip at `offset` (clamped to its travel) while the pointer drags it; null lets the spring take it to the wanted stop. */
  holdPanel(offset: number | null): void {
    this.panelHeld = offset === null ? null : Math.min(Math.max(offset, -BAR_TRAVEL), BAR_TRAVEL);
  }

  private panelHeld: number | null = null;

  /** Current offset of the sliding strip along y (the stylus parked in its barrel rides with it). */
  slideOffset(): number {
    return this.panelOffset;
  }

  private levelHalfSpan(): number {
    const params = this.mechanism.params;
    return (params.levelCount * params.levelPitch) / 2;
  }

  /**
   * Visual only: when a carry body lands on its stop bar it bounces once (about 15 % of the last fall, damped in ~0.1 s of sim time).
   * Returns the extra lift in degrees.
   */
  private bounceOf(level: number, lift: number, simDt: number): number {
    const state = (this.bounce[level] ??= { t: Infinity, amp: 0, previous: lift });
    if (simDt > 0) {
      const landed = state.previous > 1 && lift <= 0.05;
      if (landed) {
        const speed = (state.previous - lift) / simDt; // degrees per second of sim time
        state.amp = Math.min(Math.max(speed * 0.012, 0.6), 2.4);
        state.t = 0;
      } else if (state.t !== Infinity) state.t += simDt;
      state.previous = lift;
    }
    if (state.t === Infinity || state.t > 0.4) return 0;
    return state.amp * Math.exp(-state.t / 0.05) * Math.abs(Math.sin((Math.PI * state.t) / 0.09));
  }

  /**
   * Visual only: a wheel that comes to rest in its detent overshoots by a few degrees and settles (about 0.15 s of sim time).
   * Returns the extra position in steps.
   */
  private settleOf(level: number, u: number, simDt: number): number {
    const state = (this.settleState[level] ??= { t: Infinity, moving: false, previous: u });
    if (simDt > 0) {
      const moved = Math.abs(u - state.previous) > 1e-5;
      if (!moved && state.moving && Math.abs(u - Math.round(u)) < 1e-6) state.t = 0;
      else if (state.t !== Infinity) state.t += simDt;
      state.moving = moved;
      state.previous = u;
    }
    if (state.t === Infinity || state.t > 0.5) return 0;
    return 0.05 * Math.exp(-state.t / 0.07) * Math.sin((2 * Math.PI * state.t) / 0.14);
  }

  /** Accent contact lamps: lit only while the body is being lifted by the bars or while the sautoir kicks; 250 ms fade. */
  private glowOf(level: number, lift: number, dt: number): void {
    const glow = this.glows[level];
    const carry = this.mechanism.carryOn(level);
    if (!glow || !carry) return;
    const rising = lift - glow.previousLift > 1e-4;
    glow.previousLift = lift;
    const fade = (g: Glow, wanted: boolean): void => {
      const material = g.sprite.material;
      const next = material.opacity + ((wanted ? 1 : 0) - material.opacity) * (1 - Math.exp(-Math.max(dt, 0) / 0.08));
      material.opacity = next < 0.01 && !wanted ? 0 : next;
    };
    fade(glow.lift, carry.phase === "contact" && rising && lift > 0.3);
    fade(glow.kick, carry.phase === "kicking");
  }

  /** Poses every part from the simulation state. */
  poseFromSim(mech: Mechanism, dt: number): void {
    this.update(currentPose(mech), dt, dt);
  }

  /**
   * Poses every part. `pose` is the simulation state, optionally blended between two steps
   * (render interpolation keeps slow motion smooth); it defaults to the current state.
   */
  update(pose: Pose = currentPose(this.mechanism), dt = 0, simDt = dt): void {
    // spring towards the target, sub-stepped; at rest it snaps exactly onto the target
    if (this.panelHeld !== null) {
      this.panelOffset = this.panelHeld;
      this.panelVelocity = 0;
    }
    const target = this.panelHeld !== null ? this.panelHeld : this.panelTarget();
    const span = Math.min(Math.max(dt, 0), PANEL_MAX_DT);
    const substeps = Math.ceil(span * 240);
    for (let k = 0; k < substeps; k++) {
      const h = span / substeps;
      this.panelVelocity += (PANEL_OMEGA * PANEL_OMEGA * (target - this.panelOffset) - PANEL_DAMPING * this.panelVelocity) * h;
      this.panelOffset += this.panelVelocity * h;
    }
    if (Math.abs(target - this.panelOffset) < 0.004 && Math.abs(this.panelVelocity) < 0.05) {
      this.panelOffset = target;
      this.panelVelocity = 0;
    }
    this.lidParts.slider.position.y = this.panelOffset;

    this.updatePins(dt);
    const glowMaterial = this.standGlow.material;
    if (!this.standHint) this.standClock = 0; // the breathing starts from its dimmest point whenever it (re)starts
    else this.standClock += Math.max(dt, 0);
    const wanted = this.standHint && this.stylusParked ? 0.07 + 0.33 * (0.5 - 0.5 * Math.cos((2 * Math.PI * this.standClock) / 4)) : 0;
    glowMaterial.opacity += (wanted - glowMaterial.opacity) * (1 - Math.exp(-Math.max(dt, 0) / 0.3));
    if (wanted === 0 && glowMaterial.opacity < 0.005) glowMaterial.opacity = 0;

    const params = this.mechanism.params;
    if (this.stylusParked) {
      const park = stylusParkedPose(this.levelHalfSpan());
      this.stylus.position.set(park.x, park.y, park.z);
    }
    this.levels.forEach((parts, i) => {
      const u = pose.u[i]! + this.settleOf(i, pose.u[i]!, simDt);
      const angle = u * STEP_DEG * RAD;
      parts.acc.rotation.y = angle;
      parts.wheel.rotation.z = -angle;
      parts.output.rotation.y = -angle;
      poseCarry(parts.pawlLever, parts.carry, u, pose.lift[i]! + this.bounceOf(i, pose.lift[i]!, simDt), params);
      this.glowOf(i, pose.lift[i]!, dt);
    });
  }
}
