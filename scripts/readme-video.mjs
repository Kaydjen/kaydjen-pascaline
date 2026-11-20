// Records the README demo video frame by frame in headless Edge under virtual time (every output frame advances the page by exactly
// 1/30 s), then encodes it with ffmpeg.
// Usage: node scripts/readme-video.mjs [--measure] [--stop=N] [--encode-only] [--crf=N]
//   (starts its own dev server on port 5197; needs ffmpeg on PATH; writes .ai/video/: frames/, check/, readme-demo.mp4)
//   --measure      only time the carry of 99,997 + 3 at the slow speed (seconds after the press, when each wheel flips), record nothing
//   --stop=N       stop after shot N (fast look at the first shots); --encode-only: re-encode the frames of the last run
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

// ---- wording: shot-relative seconds; `to: null` = until the end of the shot (the fade-out starts there) ----------------------------
const CAPTIONS = [
  { shot: 1, text: "1642. No chips. Just gears.", from: 0, to: 2.1, fadeIn: 0 },
  { shot: 3, text: "99,997 + 3 = ?", from: 0.4, to: null }, // until the readout reaches 100000
  { shot: 4, text: "= 100,000", from: 0, to: null },
  { shot: 6, text: "Your turn.", sub: "Add \u00b7 Subtract \u00b7 Part names", from: 3.0, to: null },
];
const FADE = 0.4;

// ---- settings ----------------------------------------------------------------------------------------------------------------
const FPS = 30;
const DT = 1000 / FPS;
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const flagValue = (name, fallback) => {
  const f = flag(name);
  return f && f.includes("=") ? Number(f.split("=")[1]) : fallback;
};
const MEASURE = !!flag("measure");
const STOP = flagValue("stop", 99);
const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".ai", "video");
const FRAMES = join(OUT, "frames");
const CHECK = join(OUT, "check");
const MP4 = join(OUT, "readme-demo.mp4");
const port = 5197;
const MAX_BYTES = 9.5 * 1024 * 1024;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

function encode(crf) {
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-framerate", String(FPS), "-i", join(FRAMES, "%05d.jpg"), "-vf", "scale=1280:720:flags=lanczos:in_range=pc:out_range=tv,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", MP4], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg failed");
  return statSync(MP4).size;
}
function encodeAndSheet() {
  let crf = flagValue("crf", 23);
  let size = encode(crf);
  while (size > MAX_BYTES && crf < 34) size = encode(++crf);
  console.log(`encoded: crf ${crf}, ${(size / 1048576).toFixed(2)} MB`);
  check("video is under 9.5 MB", size <= MAX_BYTES, `${(size / 1048576).toFixed(2)} MB at crf ${crf}`);
  spawnSync("ffmpeg", ["-y", "-v", "error", "-i", MP4, "-vf", "fps=1,scale=256:-1,tile=8x6", "-frames:v", "1", join(CHECK, "sheet.png")], { stdio: "inherit" });
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=nb_frames,width,height,r_frame_rate", "-of", "default=nw=1", MP4], { encoding: "utf8" });
  console.log(probe.stdout);
}

mkdirSync(CHECK, { recursive: true });
if (flag("encode-only")) {
  encodeAndSheet();
  process.exit(0);
}
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

// ---- the page under virtual time -----------------------------------------------------------------------------------------------
// Replaces the clocks and the frame/timer queues before the app starts: nothing runs unless `__vt.tick` is called.
const VIRTUAL_TIME = () => {
  const vt = { now: 1000, rafs: [], rafId: 0, timers: [], timerId: 0, cam: null };
  performance.now = () => vt.now;
  const epoch = Date.UTC(2026, 0, 1);
  Date.now = () => epoch + Math.floor(vt.now);
  window.requestAnimationFrame = (cb) => {
    const id = ++vt.rafId;
    vt.rafs.push({ id, cb });
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    vt.rafs = vt.rafs.filter((r) => r.id !== id);
  };
  const addTimer = (cb, ms, rest, every) => {
    const id = ++vt.timerId;
    vt.timers.push({ id, due: vt.now + Math.max(0, Number(ms) || 0), cb, rest, every: every ? Math.max(1, Number(ms) || 1) : 0 });
    return id;
  };
  window.setTimeout = (cb, ms, ...rest) => addTimer(cb, ms, rest, false);
  window.setInterval = (cb, ms, ...rest) => addTimer(cb, ms, rest, true);
  window.clearTimeout = window.clearInterval = (id) => {
    vt.timers = vt.timers.filter((t) => t.id !== id);
  };
  const guard = (fn, ...a) => {
    try {
      fn(...a);
    } catch (e) {
      console.error(String(e && e.stack ? e.stack : e));
    }
  };
  /** Advances the page by `ms`: due timers in order, then every frame callback once with the new time. */
  vt.tick = (ms) => {
    const end = vt.now + ms;
    for (;;) {
      let next = null;
      for (const t of vt.timers) if (t.due <= end && (!next || t.due < next.due || (t.due === next.due && t.id < next.id))) next = t;
      if (!next) break;
      vt.now = Math.max(vt.now, next.due);
      if (next.every) next.due += next.every;
      else vt.timers = vt.timers.filter((t) => t !== next);
      guard(next.cb, ...next.rest);
    }
    vt.now = end;
    const queue = vt.rafs;
    vt.rafs = [];
    for (const r of queue) guard(r.cb, vt.now);
  };
  // camera: a planned path is applied before every frame, so that it is a function of the frame number. A path is a list of keyframes
  // (target, log r, el, az), interpolated by a cubic Hermite spline with Catmull-Rom tangents: the velocity is continuous at every keyframe, and a
  // new path starts with the velocity the camera has at that moment, so chained paths flow into each other. Only a `stop` key ends at rest.
  const toRad = (d) => (d * Math.PI) / 180;
  const wrap = (d) => ((((d % 360) + 540) % 360) - 180);
  vt.getView = () => {
    const { camera, controls } = window.__stage;
    const o = camera.position.clone().sub(controls.target);
    const r = o.length();
    return { t: controls.target.toArray(), r, el: (Math.asin(o.y / r) * 180) / Math.PI, az: (Math.atan2(o.x, o.z) * 180) / Math.PI, fov: camera.fov };
  };
  vt.setView = (v) => {
    const { camera, controls } = window.__stage;
    controls.target.set(...v.t);
    const c = Math.cos(toRad(v.el));
    camera.position.set(v.t[0] + v.r * c * Math.sin(toRad(v.az)), v.t[1] + v.r * Math.sin(toRad(v.el)), v.t[2] + v.r * c * Math.cos(toRad(v.az)));
    camera.fov = v.fov ?? 35;
    camera.updateProjectionMatrix();
    camera.lookAt(...v.t);
    camera.updateMatrixWorld();
  };
  /** A view given with `loc` (a point in machine coordinates) is converted to a world target. */
  vt.resolve = (v) => {
    if (!v.loc) return v;
    const m = window.__proto.assembly.machine;
    const p = m.localToWorld(m.position.clone().set(...v.loc));
    return { ...v, t: p.toArray() };
  };
  const pack = (v) => [...v.t, Math.log(v.r), v.el, v.az, v.fov ?? 35];
  const unpack = (p) => ({ t: p.slice(0, 3), r: Math.exp(p[3]), el: p[4], az: p[5], fov: p[6] });
  const still = [0, 0, 0, 0, 0, 0, 0];
  vt.vel = still; // camera velocity per second in the packed space
  /** The camera is already moving towards `v`, which it reaches in `at` seconds (the velocity of a straight run there): a path planned next starts with it. */
  vt.carryVelocity = (v, at) => {
    const a = pack(vt.getView());
    const b = pack(vt.resolve(v));
    vt.vel = a.map((x, i) => (b[i] - x) / at);
  };
  /** A cut: the camera stands at `v` at once. */
  vt.jump = (v) => {
    vt.cam = null;
    vt.vel = still;
    vt.setView(vt.resolve(v));
  };
  /** Flies from the current view (and its velocity) through `keys` = [{ view, at: seconds from now, stop? }]. */
  vt.planPath = (keys, fps) => {
    const from = pack(vt.getView());
    const pts = [{ t: 0, p: from }];
    for (const k of keys) {
      const p = pack(vt.resolve(k.view));
      const prev = pts[pts.length - 1].p[5];
      p[5] = prev + wrap(p[5] - prev);
      pts.push({ t: k.at, p, stop: !!k.stop });
    }
    const n = pts.length - 1;
    pts.forEach((q, i) => {
      if (i === 0) q.m = vt.vel;
      else if (q.stop) q.m = still;
      else {
        const a = pts[i - 1];
        const b = pts[Math.min(i + 1, n)];
        q.m = q.p.map((_, c) => (b.p[c] - a.p[c]) / (b.t - a.t));
      }
    });
    vt.cam = { pts, i: 0, fps };
  };
  const stepCam = () => {
    const c = vt.cam;
    if (!c) return;
    const time = ++c.i / c.fps;
    const last = c.pts[c.pts.length - 1];
    if (time >= last.t) {
      vt.setView(unpack(last.p));
      vt.vel = still;
      vt.cam = null;
      return;
    }
    let j = 0;
    while (c.pts[j + 1].t < time) j++;
    const a = c.pts[j];
    const b = c.pts[j + 1];
    const h = b.t - a.t;
    const s = (time - a.t) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    const q = a.p.map((_, k) => (2 * s3 - 3 * s2 + 1) * a.p[k] + (s3 - 2 * s2 + s) * h * a.m[k] + (-2 * s3 + 3 * s2) * b.p[k] + (s3 - s2) * h * b.m[k]);
    vt.vel = a.p.map((_, k) => ((6 * s2 - 6 * s) * a.p[k] + (-6 * s2 + 6 * s) * b.p[k]) / h + (3 * s2 - 4 * s + 1) * a.m[k] + (3 * s2 - 2 * s) * b.m[k]);
    vt.setView(unpack(q));
  };
  vt.caption = (text, sub, opacity) => {
    let e = document.getElementById("readme-caption");
    if (!e) {
      e = document.createElement("div");
      e.id = "readme-caption";
      e.append(document.createElement("div"), document.createElement("div"));
      e.lastChild.className = "sub";
      const band = document.createElement("div");
      band.id = "readme-band";
      document.body.append(band, e);
    }
    document.getElementById("readme-band").style.opacity = String(opacity);
    if (e.firstChild.textContent !== text) e.firstChild.textContent = text;
    if (e.lastChild.textContent !== sub) e.lastChild.textContent = sub;
    e.lastChild.style.display = sub ? "block" : "none";
    e.style.opacity = String(opacity);
  };
  vt.step = (ms, text, sub, opacity) => {
    stepCam();
    vt.caption(text, sub, opacity);
    vt.tick(ms);
    vt.track.push(window.__stage.camera.position.toArray());
  };
  vt.track = []; // the camera position after every frame
  window.__vt = vt;
};

// ---- start --------------------------------------------------------------------------------------------------------------------
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(port), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://localhost:${port}/`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(VIRTUAL_TIME);
// the stand glow of a first visit is left out of the picture
await page.addInitScript(() => {
  try {
    localStorage.setItem("pascaline.stylusTaken", "1");
  } catch {}
});
// no `?still`: it also hides the dust; the lamp flicker is a function of the (virtual) time and the same on every run, but it is held steady below
await page.goto(`http://localhost:${port}/`, { waitUntil: "load" });

// loading: run the clock at 60 Hz until the app is ready (timers, frames, and the real downloads in between)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isReady = () => page.evaluate(() => !!(window.__app && window.__proto && window.__stage && document.getElementById("scene").classList.contains("ready") && !document.querySelector(".loading-dots")));
for (let i = 0; i < 6000 && !(await isReady()); i++) {
  await page.evaluate(() => window.__vt.tick(1000 / 60));
  await sleep(3);
}
check("the app reaches ready under virtual time", await isReady());
for (let i = 0; i < 60; i++) await page.evaluate(() => window.__vt.tick(1000 / 60));

// what the site shows by default, pinned to the best quality; the page itself
await page.addStyleTag({
  content: `@font-face { font-family: "EB Garamond Caption"; font-weight: 600; font-style: normal; src: url("/node_modules/@fontsource/eb-garamond/files/eb-garamond-latin-600-normal.woff2") format("woff2"); }
.dock { opacity: 0 !important; } /* the dock stays clickable, but is not in the picture */
*, *::before, *::after { transition: none !important; animation-duration: 0s !important; cursor: none !important; }
#readme-caption { position: fixed; left: 50%; bottom: 60px; transform: translateX(-50%); z-index: 50; pointer-events: none; white-space: nowrap; opacity: 0;
  font: 600 35px/1.2 "EB Garamond Caption", "EB Garamond", serif; letter-spacing: 0.01em; color: #eadfc8; text-align: center; text-shadow: 0 2px 14px rgba(0, 0, 0, 0.85), 0 0 3px rgba(0, 0, 0, 0.9), 0 1px 2px rgba(0, 0, 0, 0.8); }
#readme-band { position: fixed; left: 0; right: 0; bottom: 0; height: 22%; z-index: 49; pointer-events: none; opacity: 0; background: linear-gradient(to bottom, rgba(0, 0, 0, 0), rgba(0, 0, 0, 0.55)); }
#readme-caption .sub { font-size: 21px; line-height: 1.3; margin-top: 4px; opacity: 0.85; }`,
});
// the caption face must be there before the first frame: no fallback font anywhere in the video
const fontLoaded = await page.evaluate(async () => {
  await document.fonts.load('600 35px "EB Garamond Caption"', "1642. Aa");
  return document.fonts.check('600 35px "EB Garamond Caption"', "1642. Aa");
});
if (!fontLoaded) throw new Error("the caption font did not load");
const setup = await page.evaluate(() => {
  const dbg = window.__stage;
  dbg.adaptive = false;
  const quality = dbg.quality;
  const dpr = window.devicePixelRatio;
  dbg.rig.enabled = false; // the script places the camera itself, through the same camera and controls
  const d = document.getElementById("debug");
  if (d) d.style.display = "none";
  // `?still` without hiding the dust: a steady lamp
  window.__proto.assembly.dust.points.visible = true;
  const style = document.createElement("style");
  document.head.append(style);
  return { quality, dpr, size: [document.getElementById("scene").width, document.getElementById("scene").height], levels: window.__proto.levelCount };
});
console.log("setup", JSON.stringify(setup));
check("quality step 0 (top), adaptive off", setup.quality === 0, `quality ${setup.quality}`);
check("canvas renders 1920x1080", setup.size[0] === 1920 && setup.size[1] === 1080, setup.size.join("x"));

// frame clock probe: the real delta every frame gets from the page's own clock
await page.evaluate(() => {
  const clock = window.__proto.clock;
  const advance = clock.advance.bind(clock);
  const log = { deltas: [], steps: 0 };
  clock.advance = (d) => {
    const s = advance(d);
    log.deltas.push(d);
    log.steps += s;
    return s;
  };
  window.__clockLog = log;
});

// ---- frame loop ---------------------------------------------------------------------------------------------------------------
let capturing = !MEASURE;
let frameNo = 0;
const shotStart = {};
const shotEnd = {};
let tracing = false; // reads the digits after every frame (the carry timing, and the caption of the answer)
const trace = [];
let dialing = false; // the dial and the carry: the caption of the answer starts when the readout reaches 100000
const START_DIGITS = [7, 9, 0, 9, 9, 0]; // units wheel first: the windows read 099097; the hundreds wheel is turned to 9 inside the open box
const DIAL_DIGITS = [7, 9, 9, 9, 9, 0]; // 099997, ready for +3
const TURN_AT = 7.0; // seconds from the first frame: the hundreds wheel starts to turn, to 9 in TURN_FOR seconds
const TURN_FOR = 2.4;
const SHOT1 = 2.4; // seconds of the poster shot
const SHOT2 = 9.6; // seconds inside the open box
const LID_CLOSE = 7.4; // the lid starts to come down this long after the lid went up
/** Measured at quarter speed, seconds after the clock is started again (the dial is released and the clock paused before the tens wheel flips): wheels 1..5 flip at these times, a second apart. The camera is above window i when wheel i flips. */
const CARRY_FLIPS = [0.81, 1.81, 2.77, 3.77, 4.74];

function captionAt(t) {
  let best = { text: "", sub: "", opacity: 0 };
  for (const c of CAPTIONS) {
    const s = shotStart[c.shot];
    if (s === undefined) continue;
    const a = s + c.from;
    const fadeIn = c.fadeIn ?? FADE;
    const end = c.to !== null ? s + c.to : shotEnd[c.shot];
    let o = fadeIn > 0 ? Math.min((t - a) / fadeIn, 1) : t >= a ? 1 : 0;
    if (end !== undefined) o = Math.min(o, (end + FADE - t) / FADE);
    o = Math.max(0, Math.min(o, 1));
    if (o > best.opacity) best = { text: c.text, sub: c.sub ?? "", opacity: o };
  }
  return best;
}

let turn = null; // a wheel turned by the script: { level, from, to, start, frames }
async function frame() {
  const cap = captionAt(frameNo / FPS);
  if (turn) {
    const k = Math.min(1, (frameNo - turn.start) / turn.frames);
    await page.evaluate(([l, v, end]) => window.__proto.mechanism.setDrive(l, end ? null : v), [turn.level, turn.from + (turn.to - turn.from) * ease(k), k >= 1]);
    if (k >= 1) turn = null;
  }
  await page.evaluate(([ms, text, sub, op]) => window.__vt.step(ms, text, sub, op), [DT, cap.text, cap.sub, cap.opacity]);
  frameNo++;
  if (tracing) {
    const { d, st } = await page.evaluate(() => ({ d: window.__proto.mechanism.levels.map((_, i) => window.__proto.mechanism.digit(i)), st: window.__app.stylus.state }));
    trace.push({ f: frameNo, d, st });
    // the answer appears: the question caption hands over to it
    if (dialing && shotStart[4] === undefined && JSON.stringify(d) === "[0,0,0,0,0,1]") shotStart[4] = shotEnd[3] = frameNo / FPS;
  }
  if (capturing) await page.screenshot({ path: join(FRAMES, `${String(frameNo).padStart(5, "0")}.jpg`), type: "jpeg", quality: 95 });
}
const frames = async (n) => {
  for (let i = 0; i < n; i++) await frame();
};
/** Runs frames until `pred` (evaluated in the page, or a function) holds; returns the frames it took, or -1 after `max`. */
async function until(pred, max = 600) {
  for (let i = 0; i <= max; i++) {
    if (await (typeof pred === "function" ? pred() : page.evaluate(pred))) return i;
    await frame();
  }
  return -1;
}
/** Flies on through keyframes `[view, seconds from now]`; the velocity carries over from the path before. */
const fly = (...keys) => page.evaluate(([k, fps]) => window.__vt.planPath(k, fps), [keys.map(([view, at, stop]) => ({ view, at, stop })), FPS]);
const jump = (view) => page.evaluate((v) => window.__vt.jump(v), view);
const camDone = () => page.evaluate(() => window.__vt.cam === null);
const wait = (seconds) => frames(Math.round(seconds * FPS));

async function shot(n, body) {
  shotStart[n] = frameNo / FPS;
  const first = frameNo;
  await body();
  shotEnd[n] = frameNo / FPS;
  console.log(`shot ${n}: ${(frameNo - first) / FPS} s (frames ${first + 1}-${frameNo})`);
}
// first / last frame of a shot as PNG: the current page state (called right after a frame, no time passes)
const png = (name) => (capturing ? page.screenshot({ path: join(CHECK, `${name}.png`), type: "png" }) : null);

// ---- helpers: the mouse and the machine -----------------------------------------------------------------------------------------
let mouse = { x: 640, y: 360 };
const ease = (k) => k * k * (3 - 2 * k);
/** Moves the real mouse to (x, y) in `n` frames, eased. */
async function glide(x, y, n = 14) {
  const from = { ...mouse };
  for (let i = 1; i <= n; i++) {
    const k = ease(i / n);
    mouse = { x: from.x + (x - from.x) * k, y: from.y + (y - from.y) * k };
    await page.mouse.move(mouse.x, mouse.y);
    await frame();
  }
}
const project = (x, y, z) =>
  page.evaluate(([px, py, pz]) => {
    const m = window.__proto.assembly.machine;
    const v = m.localToWorld(m.position.clone().set(px, py, pz));
    v.project(window.__stage.camera);
    const rect = document.getElementById("scene").getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }, [x, y, z]);
const mech = (fn, arg) => page.evaluate(fn, arg);
const digits = () => mech(() => window.__proto.mechanism.levels.map((_, i) => window.__proto.mechanism.digit(i)));
const settled = () => page.evaluate(() => window.__proto.mechanism.settled());
const center = (selector) =>
  page.evaluate((s) => {
    const r = [...document.querySelectorAll(s)][0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
const buttonCenter = (label) =>
  page.evaluate((text) => {
    const b = [...document.querySelectorAll(".dock button")].find((e) => e.textContent.trim() === text);
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, label);
/** A real click on a dock button: the mouse glides there, presses for two frames, comes back to rest above the scene. */
async function clickDock(label, glideFrames = 14) {
  const at = await buttonCenter(label);
  await glide(at.x, at.y, glideFrames);
  await frames(3);
  await page.mouse.down();
  await frames(2);
  await page.mouse.up();
  await frames(2);
}
/** The speed buttons are on screen only while the machine runs or is not at normal speed: the key 2 (quarter speed) is pressed before the dial, so that the stylus can follow the drag; the real click on the slowest speed comes right after the release. */
async function quarter() {
  await page.keyboard.press("2");
  await frames(3);
}
const REST = { x: 70, y: 70 };
const LID_TOP = 46.8;
const levelX = (i) => (2.5 - i) * 40;
const rad = (d) => (d * Math.PI) / 180;

/** Dials `digit` on `level` while assembled with the stylus in the hand: glide to the gap at the numeral, press, drag clockwise to the stop. */
async function dialWheel(level, digit, { onPress, onRelease, settle: doSettle = true } = {}) {
  const u = await mech(() => window.__proto.mechanism.levels.map((l) => l.u));
  const cx = levelX(level);
  const cy = -14;
  const numeral = (((180 - digit * 36) % 360) + 360) % 360;
  const gap = Math.round(numeral / 36 - u[level]);
  const startAngle = ((((gap + u[level]) * 36) % 360) + 360) % 360;
  const at = (angle, r = 11) => project(cx + r * Math.sin(rad(angle)), cy + r * Math.cos(rad(angle)), LID_TOP);
  const start = await at(startAngle);
  await glide(start.x, start.y, 12);
  // the camera keeps drifting: aim at the numeral again where it stands now, before the hover check and right before the press
  const aim = async () => {
    const p = await at(startAngle);
    await page.mouse.move(p.x, p.y);
    mouse = p;
  };
  await aim();
  const over = await until(async () => {
    await aim();
    return mech(([l, g]) => { const h = window.__app.stylus.hovered; return h !== null && h.level === l && h.gap === g; }, [level, gap]);
  }, 60);
  await frames(3);
  await aim();
  await frames(1);
  await page.mouse.down();
  if (onPress) await onPress();
  await frames(3);
  const total = digit * 36;
  const n = Math.max(16, digit * 5);
  for (let k = 1; k <= n; k++) {
    const p = await at(startAngle + (total * k) / n);
    await page.mouse.move(p.x, p.y);
    mouse = p;
    await frame();
  }
  await frames(10);
  await page.mouse.up();
  if (onRelease) await onRelease();
  const settle = doSettle ? await until(settled, 1200) : 0;
  return { hovered: over, settleFrames: settle };
}
// views (machine coordinates for the targets: x along the wheels, units wheel at +100, y toward the viewer, z up); the readout windows sit at
// y 38.6 on the lid top (z 46.8); with the lid raised it is 90 higher; the Apart frame is at z ~110
// a view with the distance `r` it would have at the default field of view of 35 degrees: a narrower field (`fov`) moves the camera back, so that the
// subject keeps its size and the plate edges look squarer
const T35 = Math.tan(rad(17.5));
const V = (loc, r, el, az, fov = 35) => ({ loc, r: (r * T35) / Math.tan(rad(fov / 2)), el, az, fov });
const CLOSE = 26; // the field of view of the close-ups
const POSTER = V([0, 0, 10], 335, 30, 0);
const POSTER_PUSH = V([0, 0, 12], 305, 31, 0);
const LIFT = V([0, 0, 64], 350, 38, 0); // pulled back and pitched up while the lid rises: it stays in frame
const IN_L = V([-60, -2, 36], 240, 52, 4); // lid lifted: from above, looking down into the box
const DRUM_A = V([8, 8, 66], 205, 42, 0, CLOSE); // the hundreds drum (x 20) and its numerals, with the neighbours; the lid still hangs above it, seen from the front, under the lid edge
const DRUM_B = V([26, 8, 66], 205, 42, 0, CLOSE);
const RISE = V([84, 8, 42], 250, 50, 0); // out again while the lid comes down
const DIAL = V([94, 6, 46], 185, 62, 0, CLOSE); // from above: the units wheel, its window and the stylus right of the middle, margin above the windows
const DIAL_DRIFT = V([92, 6, 46], 175, 62, 0, CLOSE);
/** Close on the windows, the flipping window (at x) a little right of the middle and the next ones to its left. */
const windowView = (x) => V([x - 12, 6, 46], 165, 64, 0, CLOSE);
const WHOLE = V([0, 6, 28], 360, 36, 0);
const APART_A = V([-5, 0, 104], 620, 24, -12);
const APART_B = V([-10, 0, 112], 560, 28, 4);
const APART_C = V([-12, 0, 112], 510, 30, 14);
const END_MID = V([0, 0, 50], 440, 32, 0);
const END_VIEW = POSTER;

// ---- measurements -----------------------------------------------------------------------------------------------------------------
/** Prints when each wheel of the carry changes its digit, seconds after the stylus is pressed on the units wheel, at the slow speed. */
async function measure() {
  capturing = false;
  tracing = true;
  const sec = (n) => (n / FPS).toFixed(2) + " s";
  await jump(DIAL);
  await mech((d) => window.__proto.reset(d), START_DIGITS);
  await frames(10);
  const t0 = frameNo;
  await quarter();
  await page.evaluate(() => window.__app.stylus.pickUp());
  await frames(10);
  const t = {};
  await dialWheel(0, 3, { onPress: () => (t.press = frameNo), onRelease: () => (t.release = frameNo) });
  await frames(20);
  console.log(`press at ${sec(t.press - t0)}, release at ${sec(t.release - t0)}; times below are seconds after the press`);
  console.log("digit changes: " + JSON.stringify(carryFlips(t.press)));
  console.log("last frame at " + sec(trace.at(-1).f - t.press) + ", digits " + JSON.stringify(trace.at(-1).d));
}
/** From the frame trace: for each wheel the first frame after `press` at which its digit differs from the one it had then, in seconds after `press`. */
function carryFlips(press) {
  const after = trace.filter((e) => e.f >= press);
  const flips = [];
  for (let i = 0; i < 6; i++) {
    const was = after[0].d[i];
    const e = after.find((x) => x.d[i] !== was);
    flips.push(e ? Number(((e.f - press) / FPS).toFixed(2)) : null);
  }
  return flips;
}

// ---- scenario --------------------------------------------------------------------------------------------------------------------
// The camera flies one continuous path: it is planned at the start and replanned at a few moments from the camera's current position and
// velocity, always with keys that reach beyond the moment of the next replan, so that there is no stop and no cut anywhere. The camera moves on frame 1;
// it comes to rest only for a moment while the clock is stopped before the carry, and at the very end of the video.
async function scenario() {
  const t = {};
  tracing = true;
  await jump(POSTER);
  await page.mouse.move(REST.x, REST.y);
  mouse = { ...REST };
  await page.evaluate(([v, at]) => window.__vt.carryVelocity(v, at), [POSTER_PUSH, 2.4]); // already moving on frame 1: a slow push-in
  // the readout shows 099097 before the first frame
  await mech((d) => window.__proto.reset(d), START_DIGITS);

  // 1. the whole machine, closed, level and centred; frame 1 is the poster. The camera path starts here and goes on through shot 2 into shot 3
  await fly([POSTER_PUSH, 2.4], [LIFT, 4.3], [IN_L, 5.6], [DRUM_A, 7.0], [DRUM_B, 9.4], [RISE, 11.4], [DIAL, 14.0], [DIAL_DRIFT, 19]);
  await shot(1, async () => {
    await frame();
    t.frame1 = await mech(() => ({ digits: window.__proto.mechanism.levels.map((_, i) => window.__proto.mechanism.digit(i)), value: window.__proto.mechanism.value(), teardown: window.__proto.teardown }));
    await png("shot1-first");
    await wait(SHOT1 - 1 / FPS);
    await png("shot1-last");
  });
  check("readout 099097 on frame 1", JSON.stringify(t.frame1.digits) === JSON.stringify(START_DIGITS) && t.frame1.teardown === 0, `digits ${JSON.stringify(t.frame1.digits)} value ${t.frame1.value}`);
  if (STOP <= 1) return;

  // 2. the lid lifts, the camera glides in over the open box, looks down into the mechanism and flies along it, then rises as the lid closes
  await shot(2, async () => {
    await frame();
    await png("shot2-first");
    await page.evaluate(() => window.__app.player.play(0.4));
    // the hundreds wheel turns from 0 to 9 under the camera (no wrap: no carry)
    await wait(TURN_AT - SHOT1 - 1 / FPS);
    turn = { level: 2, from: 0, to: 9, start: frameNo, frames: Math.round(TURN_FOR * FPS) };
    await wait(LID_CLOSE - (TURN_AT - SHOT1));
    await png("shot2-mid");
    await page.evaluate(() => window.__app.player.play(0));
    await wait(SHOT2 - LID_CLOSE);
    await png("shot2-last");
  });
  if (STOP <= 2) return;

  // 3. quarter speed (the key 2: the speed buttons are not on screen while the machine rests), the stylus, dial +3 on the units wheel: 99,997 + 3
  // 4. the carry runs through the windows, the camera follows it; at 100000 the caption turns to the answer
  shotStart[3] = frameNo / FPS;
  dialing = true;
  await frame();
  await png("shot3-first");
  await until(settled, 200);
  t.before = await digits();
  check("readout 099997 just before the dial", JSON.stringify(t.before) === JSON.stringify(DIAL_DIGITS), JSON.stringify(t.before));
  await quarter();
  await page.evaluate(() => window.__app.stylus.pickUp()); // a click on the stand misses from above: the pick-up itself is the same call
  await frames(6);
  t.dial = await dialWheel(0, 3, {
    settle: false,
    onPress: () => (t.press = frameNo),
    onRelease: async () => {
      // the stylus has done its +3: stop the clock where the carry stands, the stylus goes home, the camera comes close, then the carry runs on
      t.release = frameNo;
      await page.evaluate(() => window.__app.time.togglePause());
      t.atRelease = await digits();
      await png("shot3-last");
    },
  });
  await page.keyboard.press("Escape");
  await fly([windowView(60), 2.4, true]);
  await glide(REST.x, REST.y, 12);
  await until(() => mech(() => window.__app.stylus.state === "slot"), 200);
  await until(camDone, 200);
  await wait(0.3);
  console.log(`dial: press at frame ${t.press}, release at ${t.release}, digits at the release ${JSON.stringify(t.atRelease)}, clock stopped for ${((frameNo - t.release) / FPS).toFixed(2)} s`);
  await png("shot4-first");
  await page.evaluate(() => window.__app.time.setSpeed(0.25)); // the carry runs on, at quarter speed
  t.resume = frameNo;
  const lastFlip = CARRY_FLIPS[4];
  await fly(...CARRY_FLIPS.map((at, i) => [windowView(levelX(i + 1)), at]), [WHOLE, lastFlip + 3.4], [END_MID, lastFlip + 6.6]);
  await until(() => frameNo >= t.resume + Math.round((lastFlip + 3.3) * FPS), 600);
  await until(settled, 600);
  t.after = await digits();
  check("99,997 + 3 gives 100000: digits [0,0,0,0,0,1]", JSON.stringify(t.after) === "[0,0,0,0,0,1]", JSON.stringify(t.after));
  const carry = trace.filter((e) => e.f > t.resume && e.f <= shotStart[4] * FPS);
  check("the stylus rests on its stand during the carry", carry.length > 0 && carry.every((e) => e.st === "slot"), `${carry.length} frames, states ${[...new Set(carry.map((e) => e.st))].join(",")}`);
  console.log("carry after the restart (seconds): " + JSON.stringify(carryFlips(t.resume)));
  await until(() => frameNo >= t.resume + Math.round((lastFlip + 4.0) * FPS), 600); // the whole machine with the answer for a moment
  shotEnd[4] = frameNo / FPS;
  await png("shot4-last");
  console.log(`shot 3-4: ${(shotEnd[4] - shotStart[3]).toFixed(2)} s`);
  dialing = false;
  if (STOP <= 4) return;

  // 5. Apart: the camera flies a slow arc round the exploded mechanism, close
  await fly([APART_A, 2.6], [APART_B, 5.2], [APART_C, 8.4]);
  await shot(5, async () => {
    await frame();
    await png("shot5-first");
    await clickDock("1×", 5); // quarter speed back to normal, then Apart
    t.speed = await mech(() => window.__app.time.speed);
    await clickDock("Apart", 5);
    await png("shot5-mid");
    await until(() => mech(() => !window.__app.player.active), 300);
    await wait(2.4);
    await png("shot5-last");
  });
  t.s5 = await mech(() => window.__proto.teardown);
  check("the clock is back to 1x", t.speed === 1, `speed ${t.speed}`);
  check("Apart reaches s = 1 (teardown)", t.s5 > 0.98, `s=${t.s5.toFixed(3)}`);
  if (STOP <= 5) return;

  // 6. Closed, the camera settles on the whole machine, "Your turn."
  await fly([END_MID, 2.6], [END_VIEW, 5.8, true]);
  await shot(6, async () => {
    await frame();
    await png("shot6-first");
    await clickDock("Closed", 6);
    await glide(REST.x, REST.y, 10);
    await until(() => mech(() => !window.__app.player.active), 300);
    await until(camDone, 300);
    await wait(1.2);
    await png("shot6-last");
  });
  t.end = await mech(() => ({ teardown: window.__proto.teardown, active: window.__app.player.active }));
  check("back to Closed at the end", t.end.teardown < 0.02 && !t.end.active, `s=${t.end.teardown.toFixed(3)}`);
}

try {
  if (process.env.VIEWS) {
    // development aid: VIEWS='[{"loc":[0,0,20],"r":330,"el":30,"az":20}, ...]' shoots each view into check/view-N.png
    const list = JSON.parse(process.env.VIEWS);
    if (process.env.STATE) await page.evaluate(process.env.STATE);
    for (const [i, v] of list.entries()) {
      await jump(v);
      await frames(3);
      await page.screenshot({ path: join(CHECK, `view-${i}.png`) });
    }
    capturing = false;
  } else if (MEASURE) {
    await measure();
  } else {
    await scenario();
    check("no console errors", errors.length === 0, errors.join(" | "));
    const log = await page.evaluate(() => window.__clockLog);
    const worst = Math.max(...log.deltas.map((d) => Math.abs(d - 1 / FPS)));
    check("the sim clock advances 1/30 s per frame", log.deltas.length === frameNo && worst < 1e-9, `${log.deltas.length} advances for ${frameNo} frames, total ${log.deltas.reduce((a, b) => a + b, 0).toFixed(4)} s of ${(frameNo / FPS).toFixed(4)} s, worst deviation ${worst.toExponential(2)}`);
    // smoothness of the camera: the biggest changes of its velocity from one frame to the next (world units per frame squared)
    const track = await page.evaluate(() => window.__vt.track);
    const acc = track.slice(2).map((p, i) => Math.hypot(...p.map((v, c) => v - 2 * track[i + 1][c] + track[i][c])));
    const jerks = acc.map((a, i) => ({ a, frame: i + 2 })).sort((x, y) => y.a - x.a).slice(0, 3);
    console.log(`camera: biggest velocity change per frame ${jerks.map((w) => `${w.a.toFixed(3)} at frame ${w.frame}`).join(", ")}`);
    console.log(`recorded ${frameNo} frames = ${(frameNo / FPS).toFixed(2)} s`);
  }
} finally {
  await browser.close();
  server.kill();
}
if (!MEASURE && !process.env.VIEWS) {
  console.log(`frames: ${readdirSync(FRAMES).length} in ${FRAMES}`);
  encodeAndSheet();
}
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed; output in ${OUT}`);
process.exit(failed.length ? 1 : 0);
