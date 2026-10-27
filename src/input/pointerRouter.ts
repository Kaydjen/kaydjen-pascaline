import { Vector2 } from "three";
import { NO_LID_S } from "../scene/teardown";
import type { PrototypeSession } from "../scene/prototype";
import type { Stage } from "../scene/stage";
import type { TeardownPlayer } from "../scene/teardownPlayer";
import type { Ghost } from "./ghost";
import type { Hit, HitTester } from "./hits";
import type { StylusController } from "./stylusController";

/** A press that moved less than this many pixels is a click. */
const CLICK_SLOP = 5;

/** How far (px) around a dock button the pointer already counts as "at the dock": the cursor returns before the button is reached. */
const DOCK_MARGIN = 56;

function nearButtons(x: number, y: number): boolean {
  for (const button of document.querySelectorAll(".dock button")) {
    const r = button.getBoundingClientRect();
    if (r.width > 0 && x >= r.left - DOCK_MARGIN && x <= r.right + DOCK_MARGIN && y >= r.top - DOCK_MARGIN && y <= r.bottom + DOCK_MARGIN) return true;
  }
  return false;
}

/** The sliding strip and its two rolled ends (the handles people reach for). */
const isStripHandle = (name: string | undefined): boolean => name === "strip" || name === "barrel:0" || name === "barrel:1";

export interface PointerContext {
  canvas: HTMLCanvasElement;
  stage: Stage;
  session: PrototypeSession;
  stylus: StylusController;
  hits: HitTester;
  player: TeardownPlayer;
  ghost: Ghost;
}

/**
 * Routes mouse input: the stylus (always in the hand: it snaps into a gap under the pointer, a drag turns the wheel), the strip
 * click, hover cursors, and the camera lock while a wheel is being dragged. A drag on anything else orbits the camera.
 */
export class PointerRouter {
  private readonly ndc = new Vector2();
  private inside = false;
  private down: { x: number; y: number; hit: Hit | null } | null = null;
  private locked = false;
  /** The pointer is on or near a dock button: the stylus stays where it is and the system cursor is back. */
  private uiZone = false;
  /** A click on the resting stylus while the lid is up: it is taken as soon as the machine is closed. */
  private takeWhenClosed = false;
  /** A press on the sliding strip: dragging it moves the strip along y, a click flips it. */
  private stripGrab: { planeZ: number; y0: number; offset0: number; active: boolean } | null = null;

  constructor(private readonly ctx: PointerContext) {
    const { canvas } = ctx;
    canvas.addEventListener("pointerdown", this.onDown, { capture: true });
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
    canvas.addEventListener("pointerleave", this.onLeave);
    canvas.addEventListener("dblclick", this.onDouble);
  }

  dispose(): void {
    const { canvas } = this.ctx;
    canvas.removeEventListener("pointerdown", this.onDown, { capture: true });
    canvas.removeEventListener("pointermove", this.onMove);
    canvas.removeEventListener("pointerup", this.onUp);
    canvas.removeEventListener("pointercancel", this.onCancel);
    canvas.removeEventListener("pointerleave", this.onLeave);
    canvas.removeEventListener("dblclick", this.onDouble);
  }

  private setNdc(event: PointerEvent | MouseEvent): void {
    this.client = { x: event.clientX, y: event.clientY };
    const rect = this.ctx.canvas.getBoundingClientRect();
    this.ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.uiZone = nearButtons(event.clientX, event.clientY);
    this.inside = !this.uiZone;
    if (!this.ctx.ghost.running && !this.ctx.stylus.dragging) this.ctx.stylus.setPointer(this.uiZone ? null : this.ndc); // the ghost stylus owns the pointer while it runs
  }

  /** The target under the pointer for click purposes (the stylus in hand never blocks the view). */
  private pick(): Hit | null {
    const { stylus, hits } = this.ctx;
    const inHand = stylus.state === "hand" || stylus.state === "inserted";
    // the lid pins are small and sit close behind the strip ends: they win over the larger targets in front of them
    return hits.pick(this.ndc, (name) => name.startsWith("pin:")) ?? hits.pick(this.ndc, (name) => !(inHand && name === "stylus"));
  }

  private lockCamera(on: boolean): void {
    if (this.locked === on) return;
    this.locked = on;
    this.ctx.stage.debug.controls.enabled = !on;
    this.ctx.stage.debug.locked = on;
  }

  private onDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.ctx.ghost.cancel(); // any click cancels the demo or the reset; the stylus stays in the hand
    this.setNdc(event);
    const hit = this.pick();
    if (this.ctx.stylus.press(hit)) {
      this.ctx.player.cancel();
      this.lockCamera(true);
      this.ctx.canvas.setPointerCapture(event.pointerId);
      this.down = null;
      return;
    }
    this.down = { x: event.clientX, y: event.clientY, hit };
    if (hit && isStripHandle(hit.name)) {
      const assembly = this.ctx.session.assembly;
      const planeZ = assembly.machine.worldToLocal(hit.point.clone()).z;
      const y0 = this.stripY(planeZ);
      if (y0 !== null) this.stripGrab = { planeZ, y0, offset0: assembly.slideOffset(), active: false };
    }
  };

  /** Where the pointer ray meets the horizontal plane `z` (machine frame): the y position along the strip's travel. */
  private stripY(z: number): number | null {
    const machine = this.ctx.session.assembly.machine;
    machine.updateWorldMatrix(true, false);
    const ray = this.ctx.hits.ray(this.ndc).clone().applyMatrix4(machine.matrixWorld.clone().invert());
    if (Math.abs(ray.direction.z) < 1e-4) return null;
    const t = (z - ray.origin.z) / ray.direction.z;
    return t > 0 ? ray.origin.y + t * ray.direction.y : null;
  }

  /** Double click on the background: the camera glides back to the standard view. */
  private onDouble = (): void => {
    if (!this.pick()) this.ctx.stage.rig?.setPreset("default");
  };

  private onMove = (event: PointerEvent): void => {
    this.setNdc(event);
    const grab = this.stripGrab;
    if (!grab || !this.down) return;
    if (!grab.active && Math.hypot(event.clientX - this.down.x, event.clientY - this.down.y) > CLICK_SLOP) {
      grab.active = true;
      this.lockCamera(true);
      this.ctx.canvas.setPointerCapture(event.pointerId);
    }
    const y = grab.active ? this.stripY(grab.planeZ) : null;
    if (y === null) return;
    const { session } = this.ctx;
    const offset = grab.offset0 + (y - grab.y0);
    session.assembly.holdPanel(offset);
    const row = offset >= 0 ? "ascending" : "descending";
    if (session.visibleRow !== row) session.setVisibleRow(row);
  };

  private onUp = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.setNdc(event);
    const { stylus } = this.ctx;
    if (stylus.dragging) {
      stylus.release();
      this.lockCamera(false);
      return;
    }
    this.lockCamera(false);
    const down = this.down;
    this.down = null;
    const grab = this.stripGrab;
    this.stripGrab = null;
    if (grab?.active) {
      this.ctx.session.assembly.holdPanel(null); // the spring takes the strip to the nearest stop
      return;
    }
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < CLICK_SLOP) this.click(down.hit);
  };

  private onCancel = (): void => {
    this.stripGrab = null;
    this.ctx.session.assembly.holdPanel(null);
    this.ctx.stylus.release();
    this.lockCamera(false);
    this.down = null;
  };

  private onLeave = (): void => {
    this.inside = false;
    if (!this.ctx.stylus.dragging) this.ctx.stylus.setPointer(null);
  };

  /** The only click behaviour left: the sliding strip flips between adding and subtracting. Everything else is the stylus. */
  private click(hit: Hit | null): void {
    const { stylus } = this.ctx;
    if (hit?.name === "stand" || hit?.name === "stylus") {
      if (stylus.cursorMode) {
        // lid up: close the machine, then the stylus flies into the hand
        this.ctx.player.play(0);
        this.takeWhenClosed = true;
        return;
      }
      if (stylus.state === "slot" || stylus.state === "returning") stylus.pickUp();
      else if (stylus.state === "hand") stylus.park();
      return;
    }
    if (hit?.name.startsWith("pin:") && !stylus.cursorMode) {
      // the four lid pins: the fourth one out lifts the lid
      const out = this.ctx.session.assembly.togglePin(Number(hit.name.split(":")[1]));
      if (out === 4) this.ctx.player.play(NO_LID_S);
      return;
    }
    if (isStripHandle(hit?.name)) this.ctx.session.setVisibleRow(this.ctx.session.visibleRow === "ascending" ? "descending" : "ascending");
  }

  /** Target under the pointer this frame (null when the pointer is outside), and the pointer in client pixels. */
  hovered: Hit | null = null;
  client = { x: 0, y: 0 };

  /** Called every frame: hover target and the cursor. */
  update(): void {
    const { stylus, canvas, player } = this.ctx;
    if (this.takeWhenClosed) {
      if (!stylus.cursorMode) {
        stylus.pickUp();
        this.takeWhenClosed = false;
      } else if (!player.active) this.takeWhenClosed = false; // the closing was interrupted
    }
    this.hovered = this.inside ? this.pick() : null;
    // the stylus in the hand is the pointer: no system cursor then; while it rests on its stand the cursor is there to find it
    const inHand = (stylus.state === "hand" || stylus.state === "inserted") && !this.uiZone;
    // lid up: the stylus rests, the pointer itself grabs wheels and gears
    const onDial = stylus.cursorMode && (stylus.dragging || stylus.hovered !== null);
    const onStylus = (this.hovered?.name === "stand" || this.hovered?.name === "stylus");
    const onPin = !stylus.cursorMode && this.hovered?.name.startsWith("pin:") === true;
    const wanted = this.uiZone ? "default" : inHand ? "none" : onDial ? (stylus.dragging ? "grabbing" : "grab") : onStylus ? "grab" : onPin ? "pointer" : isStripHandle(this.hovered?.name) ? (this.stripGrab?.active ? "grabbing" : "grab") : "";
    if (canvas.style.cursor !== wanted) canvas.style.cursor = wanted;
  }
}
