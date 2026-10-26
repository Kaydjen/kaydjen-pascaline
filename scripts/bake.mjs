// Bakes the CC0 scans and the studio HDRI from the git-ignored lab-assets/ into small files in public/. Usage: npm run bake
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { FloatType } from "three";

/** Edge length in pixels per scan and map (the lid, the wall and the plank are seen close up, the rest is small). */
const SCANS = {
  Metal007: { color: 1024, normal: 1024, roughness: 512 },
  Metal047B: { color: 1024, normal: 1024, roughness: 512 },
  Wood060: { color: 1024, normal: 1024, roughness: 512 },
  Metal048C: { color: 1024, normal: 1024, roughness: 512 },
  Metal042B: { color: 1024, normal: 1024, roughness: 512 },
  Metal008: { color: 1024, normal: 1024, roughness: 512 },
};
const QUALITY = { color: 82, normal: 90, roughness: 80 };
const HDRI = { file: "brown_photostudio_01", width: 512 };

let total = 0;
const size = (path) => {
  const bytes = statSync(path).size;
  total += bytes;
  return `${(bytes / 1024).toFixed(0)} KB`;
};

for (const [id, maps] of Object.entries(SCANS)) {
  mkdirSync(`public/scans/${id}`, { recursive: true });
  for (const [kind, px] of Object.entries(maps)) {
    const out = `public/scans/${id}/${kind}.webp`;
    let image = sharp(`lab-assets/scans/${id}/${kind}.jpg`).resize(px, px);
    if (kind === "roughness") image = image.greyscale();
    await image.webp({ quality: QUALITY[kind], effort: 5 }).toFile(out);
    console.log(out, size(out));
  }
}

// HDRI: decoded with the three.js loader, resampled (box filter) and written back as a run-length encoded Radiance file
const source = readFileSync(`lab-assets/hdri/${HDRI.file}.hdr`);
const parsed = new HDRLoader().setDataType(FloatType).parse(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
const { width: sw, height: sh, data } = parsed;
const width = HDRI.width;
const height = width / 2;
const rgbe = Buffer.alloc(width * height * 4);
const kx = sw / width;
const ky = sh / height;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = Math.floor(y * ky); sy < Math.max(Math.floor((y + 1) * ky), Math.floor(y * ky) + 1); sy++) {
      for (let sx = Math.floor(x * kx); sx < Math.max(Math.floor((x + 1) * kx), Math.floor(x * kx) + 1); sx++) {
        const i = (sy * sw + sx) * 4;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    }
    r /= n; g /= n; b /= n;
    const max = Math.max(r, g, b);
    const o = (y * width + x) * 4;
    if (max < 1e-32) continue;
    const e = Math.ceil(Math.log2(max) + 1e-9);
    const scale = 256 / 2 ** e;
    rgbe[o] = Math.min(255, Math.round(r * scale));
    rgbe[o + 1] = Math.min(255, Math.round(g * scale));
    rgbe[o + 2] = Math.min(255, Math.round(b * scale));
    rgbe[o + 3] = e + 128;
  }
}
const chunks = [Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`)];
for (let y = 0; y < height; y++) {
  chunks.push(Buffer.from([2, 2, width >> 8, width & 255]));
  for (let c = 0; c < 4; c++) {
    const row = Array.from({ length: width }, (_, x) => rgbe[(y * width + x) * 4 + c]);
    for (let x = 0; x < width; ) {
      let run = 1;
      while (x + run < width && run < 127 && row[x + run] === row[x]) run++;
      if (run >= 4) {
        chunks.push(Buffer.from([128 + run, row[x]]));
        x += run;
      } else {
        let end = x;
        while (end < width && end - x < 128 && !(end + 3 < width && row[end] === row[end + 1] && row[end] === row[end + 2] && row[end] === row[end + 3])) end++;
        if (end === x) end = x + 1;
        chunks.push(Buffer.from([end - x, ...row.slice(x, end)]));
        x = end;
      }
    }
  }
}
mkdirSync("public/hdri", { recursive: true });
writeFileSync("public/hdri/studio.hdr", Buffer.concat(chunks));
console.log("public/hdri/studio.hdr", size("public/hdri/studio.hdr"));
console.log(`total ${(total / 1048576).toFixed(2)} MB`);
