import { Vector2 } from "three";
import type { PrototypeSession } from "../scene/prototype";
import type { Stage } from "../scene/stage";
import type { TeardownPlayer } from "../scene/teardownPlayer";
import type { Ghost } from "./ghost";
import type { Hit, HitTester } from "./hits";
import type { StylusController } from "./stylusController";

/** A press that moved less than this many pixels is a click. */
const CLICK_SLOP = 5;
/** The cursor only changes after the pointer has rested on a target this long (seconds). */
const HOVER_DELAY = 0.08;

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
  private cursor = "";
  private pendingCursor = "";
  private pendingFor = 0;
  private locked = false;

  constructor(private readonly ctx: PointerContext) {
    const { canvas } = ctx;
    canvas.addEventListener("pointerdown", this.onDown, { capture: true });
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onCancel);
    canvas.addEventListener("pointerleave", this.onLeave);
  }

  dispose(): void {
    const { canvas } = this.ctx;
    canvas.removeEventListener("pointerdown", this.onDown, { capture: true });
    canvas.removeEventListener("pointermove", this.onMove);
    canvas.removeEventListener("pointerup", this.onUp);
    canvas.removeEventListener("pointercancel", this.onCancel);
    canvas.removeEventListener("pointerleave", this.onLeave);
  }

  private setNdc(event: PointerEvent | MouseEvent): void {
    this.client = { x: event.clientX, y: event.clientY };
    const rect = this.ctx.canvas.getBoundingClientRect();
    this.ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.inside = true;
    if (!this.ctx.ghost.running) this.ctx.stylus.setPointer(this.ndc); // the ghost stylus owns the pointer while it runs
  }

  /** The target under the pointer for click purposes (the stylus in hand never blocks the view). */
  private pick(): Hit | null {
    const { stylus, hits } = this.ctx;
    const inHand = stylus.state === "hand" || stylus.state === "inserted";
    return hits.pick(this.ndc, (name) => !(inHand && name === "stylus"));
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
  };

  private onMove = (event: PointerEvent): void => {
    this.setNdc(event);
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
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < CLICK_SLOP) this.click(down.hit);
  };

  private onCancel = (): void => {
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
    if (hit?.name === "strip") this.ctx.session.setVisibleRow(this.ctx.session.visibleRow === "ascending" ? "descending" : "ascending");
  }

  /** Target under the pointer this frame (null when the pointer is outside), and the pointer in client pixels. */
  hovered: Hit | null = null;
  client = { x: 0, y: 0 };

  /** Called every frame: hover target, lamp and the cursor with its delay. */
  update(dt: number): void {
    const { stylus, canvas } = this.ctx;
    const hit = this.inside ? this.pick() : null;
    this.hovered = hit;
    let wanted = "";
    if (stylus.state === "inserted") wanted = "grabbing";
    else if (stylus.state === "hand" && stylus.hovered) wanted = "grab";
    else if (hit?.name === "strip") wanted = "pointer";
    if (wanted !== this.pendingCursor) {
      this.pendingCursor = wanted;
      this.pendingFor = 0;
    } else this.pendingFor += dt;
    const immediate = stylus.state === "inserted" || wanted === "";
    if (wanted !== this.cursor && (immediate || this.pendingFor >= HOVER_DELAY)) {
      this.cursor = wanted;
      canvas.style.cursor = wanted;
    }
  }
}
