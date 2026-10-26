// Contact sheet of a part: rows = camera views, first column = the reference photo (when a view has one), then one column per variant.
// Usage: npm run sheet -- --config=scripts/sheets/example.mjs [--out=file.png] [--w=500] [--variants=now,dark] [--views=front]
// A config exports { views, variants }:
//   views:    [{ name, pos: [x, y, z], target: [x, y, z], fov?, js?, photo? }]   (three coordinates: x, z + 30, -y of the spec; `js` runs in the page, `photo` is a path)
//   (a variant `js` runs in the page too, after the materials: for geometry variants that have no run-time switch)
//   variants: [{ name, note?, js?, materials?: { "steel-ring": { scan: { tint: "#3a3228" } } }, grime?, ao? }]   (values are relative to the shipped look; a material not named is restored)
// Variants are switched at run time through the dev hook `__tune` (src/dev/tune.ts), so one page load serves the whole sheet.
// A value that needs a shader feature the material was built without is reported ("needs ...") and shows nothing until it is in looks.ts.
// Starts its own dev server (port 5196).
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import sharp from "sharp";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const configPath = flag("config");
if (!configPath) {
  console.log("usage: npm run sheet -- --config=scripts/sheets/<file>.mjs [--out=file.png] [--w=500] [--variants=a,b] [--views=x,y]");
  process.exit(1);
}
const config = (await import(pathToFileURL(resolve(configPath)).href)).default;
const out = flag("out") ?? `docs/look-rounds/${configPath.split(/[\\/]/).pop().replace(/\.mjs$/, "")}.png`;
mkdirSync(dirname(out), { recursive: true });
// without --out the folder holds only the newest sheet: older ones move to old/ (so the one to look at is always easy to find)
const dir = dirname(out);
for (const f of flag("out") ? [] : readdirSync(dir)) {
  if (!f.endsWith(".png") || resolve(dir, f) === resolve(out)) continue;
  mkdirSync(resolve(dir, "old"), { recursive: true });
  renameSync(resolve(dir, f), resolve(dir, "old", f));
}

const variantFilter = flag("variants")?.split(",");
const viewFilter = flag("views")?.split(",");
const variants = config.variants.filter((v) => !variantFilter || variantFilter.includes(v.name));
const views = config.views.filter((v) => !viewFilter || viewFilter.includes(v.name));
const touched = [...new Set(config.variants.flatMap((v) => Object.keys(v.materials ?? {})))];
const withPhoto = views.some((v) => v.photo);

const port = 5196;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(port), "--strictPort"], { stdio: "ignore" });
process.on("exit", () => server.kill());
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://localhost:${port}/`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/?levels=${flag("levels") ?? 6}${config.nomerge ? "&nomerge" : ""}`, { waitUntil: "load" });
await page.waitForFunction(() => window.__stage && window.__tune && window.__proto, null, { timeout: 90000 });
await page.waitForFunction(() => document.getElementById("scene")?.classList.contains("ready"), null, { timeout: 90000 });
await page.addStyleTag({ content: "body > *:not(canvas) { display: none !important; }" });
await page.waitForTimeout(3000); // the occlusion shaders finish compiling in the background

const W = Number(flag("w") ?? 500);
const H = Math.round((W * 1000) / 1600);
const LABEL = 22;
const columns = (withPhoto ? 1 : 0) + variants.length;
const tiles = [];
const needs = new Set();
for (const [row, view] of views.entries()) {
  const top = row * (H + LABEL) + LABEL;
  if (view.photo) {
    const photo = await sharp(view.photo).resize(W, H, { fit: "contain", background: "#111" }).toBuffer();
    tiles.push({ input: photo, left: 0, top });
  }
  await page.evaluate((v) => {
    const p = window.__proto;
    p.setVisibleRow("ascending");
    p.setTeardown(0);
    window.__stage.rig?.setPreset("default", { instant: true });
    for (const c of ["lid", "label", "bar", "wall:front", "wall:back", "wall:left", "wall:right"]) p.setCover(c, true);
    if (v.js) eval(v.js);
    const st = window.__stage;
    st.camera.fov = v.fov ?? 35;
    st.camera.updateProjectionMatrix();
    st.controls.target.set(...v.target);
    st.camera.position.set(...v.pos);
    st.controls.update();
  }, view);
  for (const [col, variant] of variants.entries()) {
    const missing = await page.evaluate(
      async ([names, v]) => {
        const lacking = [];
        for (const name of names) {
          const r = await window.__tune.material(name, v.materials?.[name] ?? {});
          if (r.missing.length) lacking.push(`${name}: ${r.missing.join(",")}`);
        }
        if (v.js) eval(v.js);
        if (v.grime) window.__tune.grime(v.grime);
        if (v.ao) window.__tune.ao(v.ao);
        return lacking;
      },
      [touched, variant],
    );
    for (const m of missing) needs.add(`${variant.name} needs ${m}`);
    await page.waitForTimeout(1000);
    const shot = await page.screenshot({ timeout: 90000 });
    tiles.push({ input: await sharp(shot).resize(W, H).toBuffer(), left: (col + (withPhoto ? 1 : 0)) * W, top });
  }
}
await browser.close();
server.kill();

const label = (text, x, y) => `<text x="${x}" y="${y}" font-family="Segoe UI, Arial" font-size="14" fill="#e8dcc0">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`;
const width = columns * W;
const height = views.length * (H + LABEL);
const names = [...(withPhoto ? ["photo"] : []), ...variants.map((v) => `${v.name}${v.note ? ": " + v.note : ""}`)];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${views.map((v, row) => names.map((n, col) => label(col === 0 ? `${v.name}  |  ${n}` : n, col * W + 6, row * (H + LABEL) + 16)).join("")).join("")}</svg>`;
await sharp({ create: { width, height, channels: 3, background: "#111" } })
  .composite([...tiles, { input: Buffer.from(svg), left: 0, top: 0 }])
  .png()
  .toFile(out);
console.log(out);
for (const n of needs) console.log(n);
if (errors.length) console.log("console errors:", errors.slice(0, 5).join(" | "));
