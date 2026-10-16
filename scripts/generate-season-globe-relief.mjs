import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import sharp from "sharp";

const input = process.argv[2];
const output = process.argv[3] ?? "public/geo/world-relief.webp";
if (!input) throw new Error("Usage: node scripts/generate-season-globe-relief.mjs elevation.jpg [output.webp]");

const width = 2048;
const height = 1024;
const source = await readFile(input);
const elevation = await sharp(source).resize(width, height).grayscale().raw().toBuffer();
const pixels = Buffer.alloc(width * height * 3);
const sample = (x, y) => elevation[Math.max(0, Math.min(height - 1, y)) * width + ((x + width) % width)];

// Pack tangent-space slopes into RG and elevation into B. The shader needs
// only one relief sample; longitude wraps so there is no seam at the dateline.
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 3;
    const latitudeScale = Math.max(0.25, Math.cos(((y / height) - 0.5) * Math.PI));
    const slopeX = (sample(x + 1, y) - sample(x - 1, y)) / latitudeScale;
    const slopeY = sample(x, y - 1) - sample(x, y + 1);
    pixels[index] = Math.round(Math.max(0, Math.min(255, 128 - slopeX * 1.7)));
    pixels[index + 1] = Math.round(Math.max(0, Math.min(255, 128 - slopeY * 1.7)));
    pixels[index + 2] = sample(x, y);
  }
}

await sharp(pixels, { raw: { width, height, channels: 3 } }).webp({ quality: 88, effort: 6 }).toFile(output);
const asset = await readFile(output);
process.stdout.write(JSON.stringify({
  sourceSha256: createHash("sha256").update(source).digest("hex"),
  runtimeSha256: createHash("sha256").update(asset).digest("hex"),
  bytes: asset.length,
  width,
  height,
}, null, 2) + "\n");
