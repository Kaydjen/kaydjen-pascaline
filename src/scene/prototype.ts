import { Group, Vector3 } from "three";
import { DEFAULT_PARAMS } from "../sim/params";
import { machineViews } from "./cameraRig";
import { Assembly, COVER_NAMES, currentPose, type CoverName, type Pose } from "./assembly";
import { Clock } from "../sim/clock";
import { Mechanism, type SimEvent } from "../sim/mechanism";
import type { StageContent } from "./stage";

/** The M1 prototype: a few levels with the simulation running in real time. */
export interface PrototypeSession {
  readonly content: StageContent;
  readonly clock: Clock;
  readonly levelCount: number;
  /** Replaced by `reset`; read it fresh every frame. */
  mechanism: Mechanism;
  /** Newest sim events, oldest first (capped), for the debug panel. */
  readonly recentEvents: SimEvent[];
  /** Runs fixed simulation steps (also used by scripts to reach a state deterministically). */
  advance(steps: number): void;
  /** Builds a fresh mechanism with the given digits (units first, default all zero). */
  reset(digits?: number[]): void;
  /** Slides the display panel so that only this drum row shows (kept across `reset`). */
  setVisibleRow(row: "ascending" | "descending", instant?: boolean): void;
  readonly visibleRow: "ascending" | "descending";
  /** Takes a cover (lid, label strip, bar, a wall) off or puts it back; kept across `reset`. */
  setCover(name: CoverName, on: boolean): void;
  cover(name: CoverName): boolean;
  /** Lid on or off (the label strip and the bar stand on it). */
  setLid(on: boolean): void;
  readonly lidOn: boolean;
  /** Teardown view 0..1 (0 = assembled); kept across `reset`. */
  setTeardown(amount: number): void;
  readonly teardown: number;
  /** Called with the new value after every `setTeardown` (the camera rig listens). */
  onTeardown?: (amount: number) => void;
  /** The current assembly (replaced by `reset`); for dev scripts. */
  readonly assembly: Assembly;
}

export function createPrototype(levelCount: number, lidOn = true): PrototypeSession {
  const spread = levelCount * DEFAULT_PARAMS.levelPitch;
  const root = new Group();
  const clock = new Clock();
  const recentEvents: SimEvent[] = [];
  let view: Assembly;
  let previous: Pose;
  let row: "ascending" | "descending" = "ascending";
  const covers = new Map<CoverName, boolean>(COVER_NAMES.map((name) => [name, name !== "lid" || lidOn]));
  let teardown = 0;
  const applyCovers = (): void => covers.forEach((on, name) => view.setCover(name, on));

  const session: PrototypeSession = {
    clock,
    levelCount,
    mechanism: new Mechanism({ levelCount }),
    recentEvents,
    advance(steps) {
      for (let i = 0; i < steps; i++) {
        previous = currentPose(session.mechanism);
        session.mechanism.step(clock.step);
        for (const e of session.mechanism.takeEvents()) {
          recentEvents.push(e);
          if (recentEvents.length > 200) recentEvents.shift();
        }
      }
    },
    reset(digits) {
      session.mechanism = new Mechanism({ levelCount });
      if (digits) session.mechanism.presetDigits(digits);
      view.root.removeFromParent();
      view = new Assembly(session.mechanism, { merge: true });
      view.setVisibleRow(row, true);
      applyCovers();
      view.setTeardown(teardown);
      root.add(view.root);
      previous = currentPose(session.mechanism);
      recentEvents.length = 0;
    },
    setVisibleRow(next, instant = false) {
      row = next;
      view.setVisibleRow(next, instant);
    },
    get visibleRow() {
      return row;
    },
    setCover(name, on) {
      covers.set(name, on);
      view.setCover(name, on);
    },
    cover: (name) => covers.get(name) ?? true,
    setTeardown(amount) {
      teardown = Math.min(Math.max(amount, 0), 1);
      view.setTeardown(teardown);
      session.onTeardown?.(teardown);
    },
    get teardown() {
      return teardown;
    },
    setLid: (on) => session.setCover("lid", on),
    get lidOn() {
      return covers.get("lid") ?? true;
    },
    get assembly() {
      return view;
    },
    content: {
      object: root,
      views: machineViews(levelCount, DEFAULT_PARAMS.levelPitch),
      target: new Vector3(0, 48, -7),
      cameraOffset: new Vector3(25, 135, 105).multiplyScalar(Math.max(1, spread / 130)),
      extent: Math.max(90, spread * 0.9),
      update(realDelta) {
        session.advance(clock.advance(realDelta));
        // blend the last two steps so slow motion does not advance in visible ticks
        const now = currentPose(session.mechanism);
        const a = clock.alpha;
        view.update(
          {
            u: now.u.map((v, i) => previous.u[i]! + (v - previous.u[i]!) * a),
            lift: now.lift.map((v, i) => previous.lift[i]! + (v - previous.lift[i]!) * a),
          },
          realDelta,
          realDelta * clock.timeScale,
        );
      },
    },
  };
  view = new Assembly(session.mechanism, { merge: true });
  applyCovers();
  root.add(view.root);
  previous = currentPose(session.mechanism);
  return session;
}
