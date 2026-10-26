// Look variants on the hot spots, one contact sheet: rows = camera spots, columns = variants (docs/look-rounds/spots.png).
// Usage: npm run spots [-- --variants=base,A,F] [--spots=nuts,gap] [--out=file.png]
// The variants are switched at run time through the dev hook `__tune` (src/dev/tune.ts), so one page load serves the whole sheet.
// Starts its own dev server (port 5195). To add a variant, add an entry below; keep each one complete (it overwrites the previous).
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright-core";
import sharp from "sharp";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const out = flag("out") ?? "docs/look-rounds/spots.png";
mkdirSync(dirname(out), { recursive: true });

const GRIME = { core: [0.16, 0.5], skirt: [0.02, 0.2] };
/** The shipped look (grime line 0.7 mm, AO faded on bright pixels). */
const AO = { on: true, intensity: 1.9, radius: 2.5, direct: 0.25, from: 0.15, to: 0.8 };
/** Each variant: the grime (footprint blur and strength) and the screen-space occlusion. Keep each one complete (it overwrites the previous). */
const VARIANTS = {
  now: { note: "the shipped look", grime: { ...GRIME, sigma: 0.7, skirtWeight: 0, noise: 0.3, halo: 1.6 }, ao: AO },
  old: { note: "before the fix (wide grime, plain AO)", grime: { ...GRIME, sigma: 2.2, skirtWeight: 0.12, noise: 0.8, halo: 1.6 }, ao: { ...AO, direct: 1 } },
  nograime: { note: "no grime", grime: { ...GRIME, sigma: 0.7, skirtWeight: 0, noise: 0.3, halo: 0 }, ao: AO },
  noao: { note: "no screen AO", grime: { ...GRIME, sigma: 0.7, skirtWeight: 0, noise: 0.3, halo: 1.6 }, ao: { ...AO, on: false } },
};
/** Camera spots (three coordinates: x, z + 30, -y of the spec); `lidOff` hides the lid. */
const SPOTS = {
  nuts: { pos: [100, 92, 58], target: [100, 76, 30] },
  gap: { pos: [40, 100, 48], target: [40, 76, 0] },
  clip: { pos: [-132, 100, 58], target: [-118, 76, 36] },
  wheels: { pos: [60, 120, 90], target: [60, 50, 15] },
  inside: { pos: [60, 120, 60], target: [-110, 40, -10], lidOff: true },
};
const variants = (flag("variants")?.split(",") ?? Object.keys(VARIANTS)).filter((v) => VARIANTS[v]);
const spots = (flag("spots")?.split(",") ?? Object.keys(SPOTS)).filter((s) => SPOTS[s]);

const port = 5195;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(port), "--strictPort"], { stdio: "ignore" });
process.on("exit", () => server.kill());
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://localhost:${port}/`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 630 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://localhost:${port}/`, { waitUntil: "load" });
await page.waitForFunction(() => window.__stage && window.__tune, null, { timeout: 90000 });
await page.addStyleTag({ content: "body > *:not(canvas) { display: none !important; }" });
await page.waitForTimeout(3000); // the occlusion shaders finish compiling in the background

const W = Number(flag("w") ?? 500);
const H = Math.round((W * 630) / 900);
const tiles = [];
for (const [row, spotName] of spots.entries()) {
  const spot = SPOTS[spotName];
  await page.evaluate((s) => {
    window.__proto.setCover("lid", !s.lidOff);
    const st = window.__stage;
    st.controls.target.set(...s.target);
    st.camera.position.set(...s.pos);
    st.controls.update();
  }, spot);
  for (const [col, name] of variants.entries()) {
    const v = VARIANTS[name];
    await page.evaluate((v) => {
      window.__tune.grime(v.grime);
      window.__tune.ao(v.ao);
    }, v);
    await page.waitForTimeout(1500);
    const shot = await page.screenshot({ timeout: 90000 });
    tiles.push({ input: await sharp(shot).resize(W, H).toBuffer(), left: col * W, top: row * H + 22 * (row + 1) });
  }
}
await browser.close();
server.kill();

const label = (text, x, y) => `<text x="${x}" y="${y}" font-family="Segoe UI, Arial" font-size="14" fill="#e8dcc0">${text}</text>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${variants.length * W}" height="${spots.length * (H + 22) + 22}">${spots.map((s, row) => label(s, 6, row * (H + 22) + 16)).join("")}${variants.map((v, col) => label(`${v}: ${VARIANTS[v].note}`, col * W + 90, 16)).join("")}</svg>`;
await sharp({ create: { width: variants.length * W, height: spots.length * (H + 22) + 22, channels: 3, background: "#111" } })
  .composite([...tiles, { input: Buffer.from(svg), left: 0, top: 0 }])
  .png()
  .toFile(out);
console.log(out);
if (errors.length) console.log("console errors:", errors.slice(0, 5).join(" | "));
