import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const sharp = require("sharp");
const backupDirectory = path.join(os.tmpdir(), "raceside-trajectory-original-plus");
const filenames = ["live-dark.png", "live-light.png", "live.png", "telemetry-dark.png", "telemetry-light.png", "telemetry.png"];

async function nestedArtwork(name, x, y, width, height, viewBox) {
  const source = await fs.readFile(path.join(root, `public/brand/raceside/raceside-${name}.svg`), "utf8");
  return source.replace(/<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${viewBox}">`);
}

async function main() {
  await fs.mkdir(backupDirectory, { recursive: true });
  const { layouts } = JSON.parse(await fs.readFile(path.join(root, "output/raceside-trajectory-kit/manifest.json"), "utf8"));
  for (const filename of filenames) {
    const file = path.join(root, "public/plus", filename);
    const original = await fs.readFile(file);
    try {
      await fs.writeFile(path.join(backupDirectory, filename), original, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const { data, info } = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x, y) => Array.from(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 3));
    const color = (values) => `rgb(${values.join(",")})`;
    const light = filename.includes("light");
    const telemetry = filename.startsWith("telemetry");
    const boxes = telemetry ? [[24, 12, 224, 54], [34, 794, 47, 32]] : [[54, 14, 134, 30]];
    let definitions = "";
    let background = "";
    // Reconstruct the local smooth background between each logo block's clear edges.
    for (const [index, [x, y, width, height]] of boxes.entries()) {
      for (let row = y; row < y + height; row++) {
        const id = `background-${index}-${row}`;
        definitions += `<linearGradient id="${id}"><stop stop-color="${color(pixel(x, row))}"/><stop offset="1" stop-color="${color(pixel(x + width, row))}"/></linearGradient>`;
        background += `<rect x="${x}" y="${row}" width="${width}" height="1" fill="url(#${id})"/>`;
      }
    }
    const palette = light ? "light" : "dark";
    let logos = telemetry
      ? await nestedArtwork(`signature-${palette}`, 32, 16, 191, 191 * layouts.signature.height / layouts.signature.width, `16 16 ${layouts.signature.width} ${layouts.signature.height}`)
      : await nestedArtwork(`horizontal-${palette}`, 58, 17, 128, 128 * layouts.horizontal.height / layouts.horizontal.width, `16 16 ${layouts.horizontal.width} ${layouts.horizontal.height}`);
    if (telemetry) logos += await nestedArtwork("plus-mark-red", 38, 800, 26, 20.3125, "14 14 128 100");
    const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}"><defs>${definitions}</defs>${background}${logos}</svg>`;
    const updatedPng = await sharp(original).composite([{ input: Buffer.from(overlay) }]).png().toBuffer();
    const updatedPixels = await sharp(updatedPng).ensureAlpha().raw().toBuffer();
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (boxes.some(([bx, by, bw, bh]) => x >= bx && x < bx + bw && y >= by && y < by + bh)) continue;
        const offset = (y * info.width + x) * 4;
        if (!data.subarray(offset, offset + 4).equals(updatedPixels.subarray(offset, offset + 4))) {
          throw new Error(`Unexpected change outside branding in ${filename} at ${x},${y}`);
        }
      }
    }
    await fs.writeFile(file, updatedPng);
    if (filename.includes("-dark") || filename.includes("-light")) {
      for (const suffix of ["logo-20261005", "trajectory-20261005"]) {
        await fs.writeFile(path.join(root, "public/plus", filename.replace(".png", `-${suffix}.png`)), updatedPng);
      }
    }
    console.log(`PASS ${filename}: all pixels outside the logo areas are unchanged.`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
