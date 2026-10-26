// Headless Edge probe: WebGL info, console errors, screenshot, indicative FPS, camera spike.
// Usage: node scripts/probe.mjs [url] [--fps=seconds] [--spike] [--out=dir]
// The spike needs the dev server (window.__stage is exposed only in dev) and runs on the M0 test box (?scene=box).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const url = args.find((a) => !a.startsWith("--")) ?? "http://localhost:4173/";
const fpsSeconds = Number(flag("fps") ?? 0);
const spike = args.includes("--spike");
const outDir = flag("out") ?? process.env.TEMP ?? ".";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const problems = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

const target = spike && !url.includes("scene=") ? url + (url.includes("?") ? "&" : "?") + "scene=box" : url;
await page.goto(target, { waitUntil: "load" });
await page.waitForTimeout(1500);

const gl = await page.evaluate(() => {
  const c = document.createElement("canvas");
  const ctx = c.getContext("webgl2");
  if (!ctx) return { webgl2: false };
  const ext = ctx.getExtension("WEBGL_debug_renderer_info");
  return { webgl2: true, renderer: ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown" };
});
console.log("webgl:", JSON.stringify(gl));

const shot = join(outDir, "probe.png");
await page.screenshot({ path: shot });
console.log("screenshot:", shot);

if (fpsSeconds > 0) {
  const fps = await page.evaluate(
    (s) =>
      new Promise((resolve) => {
        let n = 0;
        const t0 = performance.now();
        const tick = (now) => {
          n++;
          if (now - t0 >= s * 1000) resolve((n * 1000) / (now - t0));
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    fpsSeconds,
  );
  console.log(`fps (indicative, headless): ${fps.toFixed(1)}`);
}

if (spike) {
  const stage = () => page.evaluate(() => {
    const s = window.__stage;
    return { p: s.camera.position.toArray(), locked: s.locked, enabled: s.controls.enabled };
  });
  const moved = (a, b) => Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]) > 0.01;
  const results = {};

  await page.evaluate(() => {
    window.__ctx = { defaultPrevented: null, outside: 0, captured: null };
    document.addEventListener("contextmenu", (e) => (window.__ctx.defaultPrevented = e.defaultPrevented));
    const c = document.getElementById("scene");
    c.addEventListener("pointermove", (e) => {
      if (e.clientX < 0 || e.clientX > innerWidth) window.__ctx.outside++;
    });
  });

  // (a)+(b): pointer-down on the object locks the camera, drag does not orbit, no drift after release.
  const before = await stage();
  await page.mouse.move(640, 400);
  await page.mouse.down();
  const lockedState = await stage();
  await page.mouse.move(700, 430, { steps: 8 });
  await page.mouse.move(760, 450, { steps: 8 });
  const during = await stage();
  results.a_locked_on_down = lockedState.locked && !lockedState.enabled;
  results.a_no_orbit_while_locked = !moved(before, during);
  // (d): drag outside the viewport, events must keep arriving thanks to pointer capture.
  await page.mouse.move(-80, 400, { steps: 10 });
  const captured = await page.evaluate(() => ({
    outside: window.__ctx.outside,
    has: document.getElementById("scene").hasPointerCapture(1),
  }));
  results.d_events_outside_canvas = captured.outside > 0;
  await page.mouse.up();
  await page.waitForTimeout(400);
  const afterRelease = await stage();
  results.a_unlocked_after_up = !afterRelease.locked && afterRelease.enabled;
  results.a_no_drift_after_release = !moved(during, afterRelease);

  // Left drag on empty space must NOT move the camera (RMB only, D26).
  await page.mouse.move(60, 60);
  await page.mouse.down();
  await page.mouse.move(160, 90, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterLeftEmpty = await stage();
  results.left_empty_does_not_orbit = !moved(afterRelease, afterLeftEmpty);

  // (c): right button drag orbits and the context menu is suppressed, also over the object.
  await page.mouse.move(640, 400);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(700, 430, { steps: 8 });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(300);
  const afterRight = await stage();
  results.c_right_drag_orbits = moved(afterLeftEmpty, afterRight);
  results.c_contextmenu_prevented = (await page.evaluate(() => window.__ctx.defaultPrevented)) === true;

  // Middle button pans, wheel zooms.
  await page.mouse.move(300, 300);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(360, 330, { steps: 6 });
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(300);
  const afterMiddle = await page.evaluate(() => window.__stage.controls.target.toArray());
  results.middle_pans = Math.hypot(afterMiddle[0], afterMiddle[1] - 40, afterMiddle[2]) > 0.01;
  const distBefore = await page.evaluate(() => window.__stage.camera.position.distanceTo(window.__stage.controls.target));
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(400);
  const distAfter = await page.evaluate(() => window.__stage.camera.position.distanceTo(window.__stage.controls.target));
  results.wheel_zooms = distAfter < distBefore;

  console.log("camera spike:", JSON.stringify(results, null, 2));
}

console.log("console problems:", problems.length ? problems : "none");
await browser.close();
