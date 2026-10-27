import "./style.css";
import { boxContent, createStage } from "./scene/stage";
import { buildTextures } from "./materials/factory";
import { FINAL_LOOK } from "./materials/looks";
import { installLook } from "./materials/lookRuntime";
import { Ghost } from "./input/ghost";
import { HitTester } from "./input/hits";
import { mountKeyboard } from "./input/keyboard";
import { PointerRouter } from "./input/pointerRouter";
import { StylusController } from "./input/stylusController";
import { TimeControl } from "./input/controls";
import { createPrototype } from "./scene/prototype";
import { mountUi } from "./ui";
import { showLoading } from "./ui/loading";
import { TeardownPlayer } from "./scene/teardownPlayer";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const fallback = document.getElementById("fallback") as HTMLElement;

const showFatal = (message: string): void => {
  canvas.hidden = true;
  fallback.textContent = message;
  fallback.hidden = false;
};

const query = new URLSearchParams(location.search);
const levels = Math.min(Math.max(Number(query.get("levels")) || 6, 2), 6);
const useBox = query.get("scene") === "box"; // M0 camera-spike scene, kept for scripts/probe.mjs

const REVEAL_MS = 1500;

/** Brightens the frame from black over REVEAL_MS (instantly under automation, so that scripts photograph the finished look). */
function revealScene(debug: { fade: number }): void {
  if (navigator.webdriver || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    debug.fade = 1;
    return;
  }
  const began = performance.now();
  const step = (now: number): void => {
    const t = Math.min((now - began) / REVEAL_MS, 1);
    debug.fade = t * t * (3 - 2 * t);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** A frame slower than this (median over the window) at the current quality step means the machine cannot keep up. */
const SLOW_FRAME_MS = 22;
/** Frames skipped after the start or after a quality change (hitches), and frames measured. */
const SKIP_FRAMES = 12;
const WINDOW_FRAMES = 24;

/**
 * Runs while the page is still hidden: waits for steady frames and lowers the quality step until the median frame time is fine, so
 * that the machine does not stutter for seconds after the reveal while the adaptive quality finds its level. Gives up after 12 s.
 */
function steadyFrames(debug: { lowerQuality(): boolean }): Promise<void> {
  return new Promise((resolve) => {
    const began = performance.now();
    let last = began;
    let skipped = 0;
    let samples: number[] = [];
    const tick = (now: number): void => {
      const delta = now - last;
      last = now;
      if (skipped < SKIP_FRAMES) skipped++;
      else samples.push(delta);
      if (now - began > 12000) return resolve();
      if (samples.length >= WINDOW_FRAMES) {
        const sorted = [...samples].sort((a, b) => a - b);
        const median = sorted[sorted.length >> 1]!;
        if (median > SLOW_FRAME_MS && debug.lowerQuality()) skipped = 0; // measure again at the new step
        else if (median <= SLOW_FRAME_MS && sorted[sorted.length - 1]! < 60) return resolve();
        else if (median > SLOW_FRAME_MS) return resolve(); // already at the lowest step
        samples = [];
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function start(): Promise<void> {
  const loading = showLoading();
  let armStylusHint: (() => void) | undefined;
  if (!useBox) await buildTextures(1652);
  performance.mark("textures");
  // ?plain skips the finished look (plain materials, plain render)
  const look = useBox || query.has("plain") ? null : installLook(FINAL_LOOK);
  const session = useBox ? null : createPrototype(levels, query.get("lid") !== "0", !query.has("nomerge")) // ?nomerge keeps the meshes apart so that scripts/sheet.mjs can edit geometry;
  performance.mark("assembly");
  const stage = createStage(canvas, showFatal, session ? session.content : boxContent(), { compileTarget: look?.compileTarget });
  if (stage && session) {
    session.onTeardown = (s) => stage.rig?.setTeardown(s);
    const hits = new HitTester(stage.debug.camera, () => session.assembly);
    const stylus = new StylusController({ assembly: () => session.assembly, mechanism: () => session.mechanism, teardown: () => session.teardown }, hits);
    armStylusHint = () => stylus.armHint();
    const player = new TeardownPlayer(() => session.teardown, (s) => session.setTeardown(s));
    const time = new TimeControl(session.clock);
    const host = { assembly: () => session.assembly, mechanism: () => session.mechanism, teardown: () => session.teardown, close: () => player.play(0), preset: (digits: number[]) => session.reset(digits), slow: (on: boolean) => time.setSpeed(on ? 0.25 : 1) };
    const ghost = new Ghost(host, stylus, stage.debug.camera);
    const router = new PointerRouter({ canvas, stage, session, stylus, hits, player, ghost });
    mountKeyboard({ stage, session, stylus, player, time, ghost });
    const ui = mountUi({ session, player, time, stylus, router, ghost });
    const advance = session.content.update;
    session.content.update = (dt) => {
      player.update(dt);
      ghost.update(dt);
      stylus.update(dt);
      router.update();
      ui.update(dt);
      advance?.(dt);
    };
    if (import.meta.env.DEV) {
      (window as unknown as { __app: unknown }).__app = { stylus, player, time, hits, ghost };
    }
  }
  await Promise.all([stage?.ready, stage && look ? look.attach(stage.debug) : undefined]);
  if (look?.compileTarget) stage?.begin();
  performance.mark("stage");
  // the first frames hitch (AO shaders, first uploads): the loading line keeps running and the canvas stays invisible until the frames are steady, then it fades in
  if (stage) await steadyFrames(stage.debug);
  loading.done();
  if (stage) {
    stage.debug.adaptive = true;
    canvas.classList.add("ready");
    revealScene(stage.debug);
    armStylusHint?.();
  }

  if (import.meta.env.DEV && stage) {
    (window as unknown as { __stage: unknown }).__stage = stage.debug;
    if (session) {
      (window as unknown as { __proto: unknown }).__proto = session;
      void import("./materials/factory").then((m) => ((window as unknown as { __textures: unknown }).__textures = m.textureStats));
      if (query.has("debug")) void import("./ui/debugPanel").then((m) => m.mountDebugPanel(session));
      void import("./dev/look").then((m) => {
        (window as unknown as { __look: unknown }).__look = () => m.measure(session, stage.debug.camera);
      });
    }
  }
}

void start();
