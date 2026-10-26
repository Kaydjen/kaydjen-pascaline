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

async function start(): Promise<void> {
  const loading = showLoading();
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
    const player = new TeardownPlayer(() => session.teardown, (s) => session.setTeardown(s));
    const time = new TimeControl(session.clock);
    const host = { assembly: () => session.assembly, mechanism: () => session.mechanism, teardown: () => session.teardown };
    const ghost = new Ghost(host, stylus, stage.debug.camera);
    const router = new PointerRouter({ canvas, stage, session, stylus, hits, player, ghost });
    mountKeyboard({ stage, session, stylus, player, time, ghost });
    const ui = mountUi({ session, player, time, stylus, router, ghost });
    const advance = session.content.update;
    session.content.update = (dt) => {
      player.update(dt);
      ghost.update(dt);
      stylus.update(dt);
      router.update(dt);
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
  loading.done();
  if (stage) requestAnimationFrame(() => requestAnimationFrame(() => canvas.classList.add("ready")));

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
