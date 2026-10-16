import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const sharp = require("sharp");
const createFont = require("next/dist/compiled/@next/font/dist/fontkit").default;
const output = path.join(root, "output/telegram-bot-kit-20261006");
const publicDirectory = path.join(root, "public/brand/telegram");
const artworkSource = await fs.readFile(path.join(root, "src/components/racemate/raceside-logo-artwork.ts"), "utf8");
const artworkMatch = artworkSource.match(/raceSideLogoArtwork = ([\s\S]+) as const;/);
if (!artworkMatch) throw new Error("The shared RaceSide artwork must contain its generated JSON data.");
const artwork = JSON.parse(artworkMatch[1]);
const font = createFont(await fs.readFile(path.join(root, "node_modules/geist/dist/fonts/geist-sans/Geist-Variable.ttf"))).getVariation({ wght: 500 });
const run = font.layout("Поддержка");
let cursor = 0;
const descriptor = run.glyphs.map((glyph, index) => {
  if (!glyph.id) throw new Error("The brand font must support the support descriptor.");
  const position = run.positions[index];
  const item = `<path d="${glyph.path.toSVG()}" transform="translate(${cursor + position.xOffset} ${position.yOffset})"/>`;
  cursor += position.xAdvance + font.unitsPerEm * 0.01;
  return item;
}).join("");
const palettes = {
  dark: { mark: "#E10600", word: "#F5F4F2", descriptor: "#BDB8B6", background: "#111111" },
  light: { mark: "#E10600", word: "#191313", descriptor: "#6E5E5A", background: "#F5F4F2" },
  black: { mark: "#131313", word: "#131313", descriptor: "#131313" },
  white: { mark: "#FFFFFF", word: "#FFFFFF", descriptor: "#FFFFFF" },
};
const bubble = "M686 628H808Q860 628 860 680V747Q860 799 808 799H714L660 839V777Q634 762 634 727V680Q634 628 686 628Z";
const normalize = "translate(-30 -23.125) scale(0.15625)";
const title = "RaceSide — Поддержка";
const wordmark = artwork.wordmarkPaths.map(({ d, transform }) => `<path d="${d}" transform="${transform}"/>`).join("");

function symbol(variant) {
  const colors = palettes[variant];
  const clearId = `support-clear-${variant}`;
  const dotsId = `support-dots-${variant}`;
  return `<defs>
    <mask id="${clearId}" maskUnits="userSpaceOnUse" x="-4" y="-4" width="114" height="116">
      <rect x="-4" y="-4" width="114" height="116" fill="white"/>
      <path d="${bubble}" transform="${normalize}" fill="black" stroke="black" stroke-width="26" stroke-linejoin="round"/>
    </mask>
    <mask id="${dotsId}" maskUnits="userSpaceOnUse" x="-4" y="-4" width="114" height="116">
      <rect x="-4" y="-4" width="114" height="116" fill="white"/>
      <g fill="black" transform="${normalize}">
        <circle cx="700" cy="714" r="13"/><circle cx="747" cy="714" r="13"/><circle cx="794" cy="714" r="13"/>
      </g>
    </mask>
  </defs>
  <g fill="${colors.mark}" mask="url(#${clearId})">${artwork.markPaths.map((d) => `<path d="${d}"/>`).join("")}</g>
  <g mask="url(#${dotsId})"><path d="${bubble}" transform="${normalize}" fill="${colors.word}"/></g>`;
}

function svg(width, height, content, viewBox = `0 0 ${width} ${height}`) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" role="img" aria-label="${title}"><title>${title}</title>${content}</svg>\n`;
}

function signature(variant) {
  const colors = palettes[variant];
  return svg(414, 124,
    `<g transform="translate(8 8)">${symbol(variant)}</g>`
    + `<g fill="${colors.word}" transform="translate(14 6)"><g transform="${artwork.layouts.signature.wordmarkTransform}">${wordmark}</g></g>`
    + `<g fill="${colors.descriptor}" transform="translate(134 98) scale(${20 / font.unitsPerEm} ${-20 / font.unitsPerEm})">${descriptor}</g>`);
}

await fs.mkdir(output, { recursive: true });
await fs.mkdir(publicDirectory, { recursive: true });
const signatures = {};
const symbols = {};
const manifest = [];
for (const variant of Object.keys(palettes)) {
  signatures[variant] = signature(variant);
  symbols[variant] = svg(114, 116, symbol(variant), "-4 -4 114 116");
  for (const [layout, source, width] of [["logo", signatures[variant], 2400], ["mark", symbols[variant], 1024]]) {
    const filename = `raceside-support-${layout}-${variant}`;
    await fs.writeFile(path.join(output, `${filename}.svg`), source);
    await fs.writeFile(path.join(publicDirectory, `${filename}-20261006.svg`), source);
    await sharp(Buffer.from(source)).resize({ width }).png().toFile(path.join(output, `${filename}.png`));
    manifest.push({ filename, palette: variant, layout, transparent: true, pngWidth: width });
  }
}
for (const variant of ["dark", "light"]) {
  const source = svg(1024, 1024, `<rect width="1024" height="1024" fill="${palettes[variant].background}"/><g transform="translate(192 148) scale(6.4)">${symbol(variant)}</g>`);
  const filename = `raceside-support-avatar-${variant}`;
  await fs.writeFile(path.join(output, `${filename}.svg`), source);
  await sharp(Buffer.from(source)).png().toFile(path.join(output, `${filename}.png`));
  await sharp(Buffer.from(source)).jpeg({ quality: 96, chromaSubsampling: "4:4:4" }).toFile(path.join(output, `${filename}.jpg`));
  manifest.push({ filename, palette: variant, layout: "avatar", transparent: false, pngWidth: 1024 });
  if (variant === "dark") {
    await fs.writeFile(path.join(publicDirectory, "raceside-support-avatar-20261006.svg"), source);
    for (const extension of ["svg", "png", "jpg"]) await fs.copyFile(path.join(output, `${filename}.${extension}`), path.join(output, `raceside-support-avatar.${extension}`));
    await fs.copyFile(path.join(output, `${filename}.jpg`), path.join(publicDirectory, "raceside-support-avatar-20261006.jpg"));
  }
}
const nest = (source, x, y, width, height) => source.replace(/<svg /, `<svg x="${x}" y="${y}" `).replace(/width="[\d.]+" height="[\d.]+"/, `width="${width}" height="${height}"`);
const preview = svg(1600, 900,
  '<rect width="800" height="900" fill="#111111"/><rect x="800" width="800" height="900" fill="#F5F4F2"/>'
  + nest(signatures.dark, 60, 124, 680, 680 * 124 / 414)
  + nest(signatures.light, 860, 124, 680, 680 * 124 / 414)
  + nest(symbols.dark, 250, 488, 300, 300 * 116 / 114)
  + nest(symbols.light, 1050, 488, 300, 300 * 116 / 114));
await fs.writeFile(path.join(output, "support-logo-preview.svg"), preview);
await sharp(Buffer.from(preview)).png().toFile(path.join(output, "support-logo-preview.png"));
const avatar = await fs.readFile(path.join(output, "raceside-support-avatar.svg"));
const circle = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><circle cx="128" cy="128" r="128" fill="white"/></svg>');
await sharp(avatar).resize(256, 256).composite([{ input: circle, blend: "dest-in" }]).png().toFile(path.join(output, "support-avatar-circle-check.png"));
await sharp(avatar).resize(48, 48).png().toFile(path.join(output, "support-avatar-48-check.png"));
await fs.copyFile(path.join(root, "public/brand/raceside/FONT-LICENSE.txt"), path.join(output, "FONT-LICENSE.txt"));
await fs.writeFile(path.join(output, "support-logo-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Exported ${manifest.length} support logo variants; canonical RaceSide symbol and wordmark reused.`);
