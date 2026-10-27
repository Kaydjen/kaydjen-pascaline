import { Vector2 } from "three";
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
    this.uiZone = nearButtons(event.clientX, event.clientY);
    this.inside = !this.uiZone;
    if (!this.ctx.ghost.running && !this.ctx.stylus.dragging) this.ctx.stylus.setPointer(this.uiZone ? null : this.ndc); // the ghost stylus owns the pointer while it runs
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
    const { stylus } = this.ctx;
    if (hit?.name === "stand" || hit?.name === "stylus") {
      if (stylus.state === "slot" || stylus.state === "returning") stylus.pickUp();
      else if (stylus.state === "hand") stylus.park();
      return;
    }
    if (isStripHandle(hit?.name)) this.ctx.session.setVisibleRow(this.ctx.session.visibleRow === "ascending" ? "descending" : "ascending");
  }

  /** Target under the pointer this frame (null when the pointer is outside), and the pointer in client pixels. */
  hovered: Hit | null = null;
  client = { x: 0, y: 0 };

  /** Called every frame: hover target and the cursor. */
  update(): void {
    const { stylus, canvas } = this.ctx;
    this.hovered = this.inside ? this.pick() : null;
    // the stylus in the hand is the pointer: no system cursor then; while it rests on its stand the cursor is there to find it
    const inHand = (stylus.state === "hand" || stylus.state === "inserted") && !this.uiZone;
    const wanted = this.uiZone ? "default" : inHand ? "none" : this.hovered?.name === "stand" || this.hovered?.name === "stylus" ? "grab" : isStripHandle(this.hovered?.name) ? "pointer" : "";
    if (canvas.style.cursor !== wanted) canvas.style.cursor = wanted;
  }
}
