// Compares two folders of screenshots (png/webp) and reports the share of changed pixels per shot.
// Usage: npm run compare [-- --a=docs/golden --b=<look output> --threshold=24]   report only, never fails
//        npm run compare -- --update [--b=<look output>]                          write the shots of b as WebP goldens into docs/golden
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const b = flag("b") ?? join(tmpdir(), "look");
const a = flag("a") ?? "docs/golden";
const threshold = Number(flag("threshold") ?? 24);
const update = args.includes("--update");

const images = (dir) => readdirSync(dir).filter((f) => /\.(png|webp)$/.test(f)).sort();
const mime = (f) => (extname(f) === ".png" ? "image/png" : "image/webp");
const load = (dir, f) => `data:${mime(f)};base64,${readFileSync(join(dir, f)).toString("base64")}`;

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
await page.goto("about:blank");

if (update) {
  mkdirSync(a, { recursive: true });
  for (const f of images(b)) {
    const url = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      c.getContext("2d").drawImage(img, 0, 0);
      return c.toDataURL("image/webp", 0.85);
    }, load(b, f));
    writeFileSync(join(a, `${basename(f, extname(f))}.webp`), Buffer.from(url.split(",")[1], "base64"));
  }
  console.log(`golden images written to ${a}`);
  await browser.close();
  process.exit(0);
}

const names = new Map(images(a).map((f) => [basename(f, extname(f)), f]));
let worst = 0;
for (const f of images(b)) {
  const key = basename(f, extname(f));
  const other = names.get(key);
  if (!other) {
    console.log(`${key}: no golden`);
    continue;
  }
  const pct = await page.evaluate(
    async ([x, y, limit]) => {
      const draw = async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height);
      };
      const p = await draw(x);
      const q = await draw(y);
      if (p.width !== q.width || p.height !== q.height) return 100;
      let changed = 0;
      for (let i = 0; i < p.data.length; i += 4) {
        const d = Math.abs(p.data[i] - q.data[i]) + Math.abs(p.data[i + 1] - q.data[i + 1]) + Math.abs(p.data[i + 2] - q.data[i + 2]);
        if (d > limit) changed++;
      }
      return (changed / (p.width * p.height)) * 100;
    },
    [load(a, other), load(b, f), threshold],
  );
  worst = Math.max(worst, pct);
  console.log(`${key}: ${pct.toFixed(2)}% pixels changed`);
}
console.log(`worst: ${worst.toFixed(2)}%`);
await browser.close();
