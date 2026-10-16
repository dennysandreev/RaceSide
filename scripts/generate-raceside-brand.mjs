import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const sharp = require("sharp");
const createFont = require("next/dist/compiled/@next/font/dist/fontkit").default;
const publicDirectory = path.join(root, "public/brand/raceside");
const outputDirectory = path.join(root, "output/raceside-trajectory-kit");
const round = (value) => Math.round(value * 10000) / 10000;

// Two counterposed ribbons leave the racing line open between them.
// The second ribbon is the first rotated by 180 degrees around (50, 50).
const markPaths = [
  "M52 0H100L65 24C63 26 61 27 58 27H40C29 27 22 31 22 37C22 44 39 49 53 56L62 61C66 63 65 67 60 67L29 61C9 57 1 50 1 39C1 27 15 19 32 9L46 1C48 0 50 0 52 0Z",
  "M48 100H0L35 76C37 74 39 73 42 73H60C71 73 78 69 78 63C78 56 61 51 47 44L38 39C34 37 35 33 40 33L71 39C91 43 99 50 99 61C99 73 85 81 68 91L54 99C52 100 50 100 48 100Z",
];
const plusPaths = ["M8 0H14V8H22V14H14V22H8V14H0V8H8Z"];
const plusSign = (transform, fill) => `<g fill="${fill}" transform="${transform}">${plusPaths.map((d) => `<path d="${d}"/>`).join("")}</g>`;
const palettes = {
  dark: { mark: "#E10600", wordmark: "#F5F4F2", descriptor: "#BDB8B6" },
  light: { mark: "#E10600", wordmark: "#191313", descriptor: "#6E5E5A" },
  black: { mark: "#131313", wordmark: "#131313", descriptor: "#131313" },
  white: { mark: "#FFFFFF", wordmark: "#FFFFFF", descriptor: "#FFFFFF" },
  red: { mark: "#E10600", wordmark: "#E10600", descriptor: "#E10600" },
};

function outlineText(text, font, size, tracking = 0) {
  const run = font.layout(text);
  let cursor = 0;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const paths = run.glyphs.map((glyph, index) => {
    if (!glyph.id) throw new Error(`Missing glyph in ${text}`);
    const position = run.positions[index];
    const x = cursor + position.xOffset;
    const y = position.yOffset;
    if (glyph.path.commands.length) {
      bounds.minX = Math.min(bounds.minX, x + glyph.bbox.minX);
      bounds.minY = Math.min(bounds.minY, y + glyph.bbox.minY);
      bounds.maxX = Math.max(bounds.maxX, x + glyph.bbox.maxX);
      bounds.maxY = Math.max(bounds.maxY, y + glyph.bbox.maxY);
    }
    cursor += position.xAdvance + tracking * font.unitsPerEm;
    return { transform: `translate(${round(x)} ${round(y)})`, d: glyph.path.toSVG() };
  });
  const scale = size / font.unitsPerEm;
  return {
    paths,
    width: (bounds.maxX - bounds.minX) * scale,
    height: (bounds.maxY - bounds.minY) * scale,
    transform: (x, y) => `translate(${round(x - bounds.minX * scale)} ${round(y + bounds.maxY * scale)}) scale(${round(scale)} ${round(-scale)})`,
  };
}

const renderPaths = (paths) => paths.map(({ d, transform }) => `<path d="${d}" transform="${transform}"/>`).join("");
const mark = (transform, fill) => `<g fill="${fill}" transform="${transform}">${markPaths.map((d) => `<path d="${d}"/>`).join("")}</g>`;
const svg = (width, height, content, title = "RaceSide — Траектория") => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}"><title>${title}</title>${content}</svg>\n`;

async function main() {
  await fs.mkdir(publicDirectory, { recursive: true });
  await fs.mkdir(path.join(outputDirectory, "svg"), { recursive: true });
  await fs.mkdir(path.join(outputDirectory, "png"), { recursive: true });
  const sans = createFont(await fs.readFile(path.join(root, "node_modules/geist/dist/fonts/geist-sans/Geist-Variable.ttf")));
  const regular = sans.getVariation({ wght: 500 });
  const bold = sans.getVariation({ wght: 800 });
  const wordmark = outlineText("RaceSide", bold, 60, -0.024);
  const descriptor = outlineText("Гоночный центр", regular, 20, 0.01);
  const layouts = {
    horizontal: {
      width: Math.ceil(84 + wordmark.width), height: 68,
      markTransform: "scale(0.68)",
      wordmarkTransform: wordmark.transform(84, (68 - wordmark.height) / 2),
    },
    signature: {
      width: Math.ceil(120 + wordmark.width), height: 100,
      markTransform: "translate(0 0)",
      wordmarkTransform: wordmark.transform(120, 18),
      descriptorTransform: descriptor.transform(120, 72),
    },
  };
  const plusLayouts = {
    horizontal: { ...layouts.horizontal, width: layouts.horizontal.width + 30, plusTransform: `translate(${layouts.horizontal.width + 8} 8)` },
    signature: { ...layouts.signature, width: layouts.signature.width + 30, plusTransform: `translate(${layouts.signature.width + 8} 16)` },
  };
  const artwork = {
    markPaths, plusPaths, wordmarkPaths: wordmark.paths, descriptorPaths: descriptor.paths, layouts, plusLayouts,
    mark: { width: 100, height: 100, transform: "translate(0 0)" },
    plusMark: { width: 128, height: 100, transform: "translate(0 0)", plusTransform: "translate(106 4)" },
  };
  await fs.writeFile(path.join(root, "src/components/racemate/raceside-logo-artwork.ts"),
    `// Generated by scripts/generate-raceside-brand.mjs from the approved Trajectory concept.\n// Geist Sans outlines; license: public/brand/raceside/FONT-LICENSE.txt.\nexport const raceSideLogoArtwork = ${JSON.stringify(artwork, null, 2)} as const;\n`);

  function render(layoutName, paletteName, plus = false) {
    const layout = plus ? plusLayouts[layoutName] : layouts[layoutName];
    const colors = palettes[paletteName];
    return mark(layout.markTransform, colors.mark)
      + `<g fill="${colors.wordmark}" transform="${layout.wordmarkTransform}">${renderPaths(wordmark.paths)}</g>`
      + (layoutName === "signature" ? `<g fill="${colors.descriptor}" transform="${layouts.signature.descriptorTransform}">${renderPaths(descriptor.paths)}</g>` : "")
      + (plus ? plusSign(plusLayouts[layoutName].plusTransform, colors.mark) : "");
  }
  const stackedWidth = Math.ceil(wordmark.width);
  const stackedHeight = 226;
  const stacked = (paletteName) => {
    const colors = palettes[paletteName];
    return mark(`translate(${round((stackedWidth - 128) / 2)} 0) scale(1.28)`, colors.mark)
      + `<g fill="${colors.wordmark}" transform="${wordmark.transform(0, 154)}">${renderPaths(wordmark.paths)}</g>`
      + `<g fill="${colors.descriptor}" transform="${descriptor.transform((stackedWidth - descriptor.width) / 2, 208)}">${renderPaths(descriptor.paths)}</g>`;
  };
  const items = [];
  for (const layoutName of ["horizontal", "signature", "stacked", "mark"]) {
    const variants = layoutName === "mark" ? ["red", "black", "white"] : Object.keys(palettes);
    const width = layoutName === "mark" ? 100 : layoutName === "stacked" ? stackedWidth : layouts[layoutName].width;
    const height = layoutName === "mark" ? 100 : layoutName === "stacked" ? stackedHeight : layouts[layoutName].height;
    const pad = layoutName === "mark" ? 14 : 16;
    for (const variant of variants) {
      const filename = `raceside-${layoutName}-${variant}`;
      const content = layoutName === "mark" ? mark("translate(0 0)", palettes[variant].mark)
        : layoutName === "stacked" ? stacked(variant) : render(layoutName, variant);
      const source = svg(width + pad * 2, height + pad * 2, `<desc>Знак из двух гоночных лент. RaceSide, Гоночный центр. Прозрачный фон, векторные контуры.</desc><g transform="translate(${pad} ${pad})">${content}</g>`);
      await fs.writeFile(path.join(publicDirectory, `${filename}.svg`), source);
      await fs.writeFile(path.join(outputDirectory, "svg", `${filename}.svg`), source);
      await sharp(Buffer.from(source)).resize({ width: layoutName === "mark" ? 1024 : 2400 }).png().toFile(path.join(outputDirectory, "png", `${filename}.png`));
      items.push({ filename, layout: layoutName, palette: variant, width: width + pad * 2, height: height + pad * 2 });
    }
  }
  for (const [variant, background, fill] of [["dark", "#131313", "#E10600"], ["light", "#F5F4F2", "#E10600"], ["red", "#E10600", "#FFFFFF"]]) {
    const filename = `raceside-avatar-${variant}`;
    const source = svg(1024, 1024, `<rect width="1024" height="1024" fill="${background}"/>${mark("translate(192 192) scale(6.4)", fill)}`);
    await fs.writeFile(path.join(publicDirectory, `${filename}.svg`), source);
    await fs.writeFile(path.join(outputDirectory, "svg", `${filename}.svg`), source);
    await sharp(Buffer.from(source)).png().toFile(path.join(outputDirectory, "png", `${filename}.png`));
    items.push({ filename, layout: "avatar", palette: variant, width: 1024, height: 1024 });
    if (variant === "dark") {
      const png = await sharp(Buffer.from(source)).resize(512, 512).png().toBuffer();
      await fs.writeFile(path.join(publicDirectory, "avatar-dark.png"), png);
      await fs.writeFile(path.join(publicDirectory, "avatar-trajectory-dark.png"), png);
    }
  }
  for (const layoutName of ["horizontal", "signature", "mark", "avatar"]) {
    const variants = layoutName === "mark" ? ["red", "black", "white"] : layoutName === "avatar" ? ["dark", "light", "red"] : Object.keys(palettes);
    for (const variant of variants) {
      const filename = `raceside-plus-${layoutName}-${variant}`;
      const avatar = layoutName === "avatar";
      const symbol = layoutName === "mark" || avatar;
      const width = avatar ? 1024 : symbol ? 128 : plusLayouts[layoutName].width;
      const height = avatar ? 1024 : symbol ? 100 : plusLayouts[layoutName].height;
      const pad = avatar ? 0 : symbol ? 14 : 16;
      const fill = avatar && variant === "red" ? "#FFFFFF" : palettes[variant].mark;
      const compositeMark = mark("translate(0 0)", fill) + plusSign(artwork.plusMark.plusTransform, fill);
      const content = avatar
        ? `<rect width="1024" height="1024" fill="${variant === "red" ? "#E10600" : variant === "dark" ? "#131313" : "#F5F4F2"}"/><g transform="translate(192 262) scale(5)">${compositeMark}</g>`
        : symbol ? compositeMark : render(layoutName, variant, true);
      const source = svg(width + pad * 2, height + pad * 2, `<g transform="translate(${pad} ${pad})">${content}</g>`, "RaceSide Plus — Траектория");
      await fs.writeFile(path.join(publicDirectory, `${filename}.svg`), source);
      await fs.writeFile(path.join(outputDirectory, "svg", `${filename}.svg`), source);
      await sharp(Buffer.from(source)).resize({ width: symbol ? 1024 : 2400 }).png().toFile(path.join(outputDirectory, "png", `${filename}.png`));
      items.push({ filename, layout: layoutName, plus: true, palette: variant, width: width + pad * 2, height: height + pad * 2 });
    }
  }
  const appIcon = svg(64, 64, `<rect width="64" height="64" rx="12" fill="#131313"/>${mark("translate(12 12) scale(0.4)", "#E10600")}`, "RaceSide");
  await fs.writeFile(path.join(root, "src/app/icon.svg"), appIcon);
  await sharp(Buffer.from(svg(180, 180, `<rect width="180" height="180" rx="32" fill="#131313"/>${mark("translate(34 34) scale(1.12)", "#E10600")}`))).png().toFile(path.join(root, "src/app/apple-icon.png"));

  const label = (text, x, y, color, size = 22) => {
    const shape = outlineText(text, regular, size);
    return `<g fill="${color}" transform="${shape.transform(x, y)}">${renderPaths(shape.paths)}</g>`;
  };
  const fitted = (layoutName, paletteName, x, y, width, height, plus = false) => {
    const layout = plus ? plusLayouts[layoutName] : layouts[layoutName];
    const scale = Math.min(width / layout.width, height / layout.height);
    return `<g transform="translate(${round(x + (width - layout.width * scale) / 2)} ${round(y + (height - layout.height * scale) / 2)}) scale(${round(scale)})">${render(layoutName, paletteName, plus)}</g>`;
  };
  let board = `<rect width="1600" height="1060" fill="#131313"/><rect x="800" width="800" height="530" fill="#F5F4F2"/><rect y="530" width="800" height="530" fill="#F5F4F2"/>`;
  board += label("RaceSide / Траектория", 48, 40, "#BDB8B6", 23);
  board += fitted("signature", "dark", 64, 140, 672, 230);
  board += fitted("signature", "light", 864, 140, 672, 230);
  board += label("Для тёмного фона", 48, 468, "#BDB8B6");
  board += label("Для светлого фона", 848, 468, "#6E5E5A");
  board += label("Знак без названия", 48, 574, "#6E5E5A");
  board += mark("translate(80 700) scale(2)", "#E10600");
  board += mark("translate(410 700) scale(2)", "#131313");
  board += label("Меню, иконка и компактный логотип", 848, 574, "#BDB8B6");
  board += fitted("signature", "dark", 880, 674, 250, 70);
  board += `<rect x="1260" y="652" width="144" height="144" rx="28" fill="#242424"/>${mark("translate(1287 679) scale(0.9)", "#E10600")}`;
  board += fitted("horizontal", "white", 880, 860, 285, 60);
  board += label("SVG + PNG · Геометрия и текст в контурах", 848, 1000, "#BDB8B6", 18);
  const overview = svg(1600, 1060, board, "RaceSide — система логотипа Траектория");
  await fs.writeFile(path.join(outputDirectory, "overview.svg"), overview);
  await sharp(Buffer.from(overview)).png().toFile(path.join(outputDirectory, "overview.png"));
  let plusBoard = `<rect width="1600" height="900" fill="#131313"/><rect x="800" width="800" height="450" fill="#F5F4F2"/><rect y="450" width="800" height="450" fill="#F5F4F2"/>`;
  plusBoard += label("RaceSide Plus", 48, 40, "#BDB8B6", 23);
  plusBoard += fitted("signature", "dark", 64, 124, 672, 200, true);
  plusBoard += fitted("signature", "light", 864, 124, 672, 200, true);
  plusBoard += label("Самостоятельный знак Plus", 48, 494, "#6E5E5A");
  plusBoard += `<g transform="translate(84 580) scale(2.3)">${mark("translate(0 0)", "#E10600")}${plusSign(artwork.plusMark.plusTransform, "#E10600")}</g>`;
  plusBoard += `<g transform="translate(434 580) scale(2.3)">${mark("translate(0 0)", "#131313")}${plusSign(artwork.plusMark.plusTransform, "#131313")}</g>`;
  plusBoard += label("Приглашение и значок подписки", 848, 494, "#BDB8B6");
  plusBoard += fitted("horizontal", "dark", 880, 595, 300, 74, true);
  plusBoard += `<rect x="1250" y="560" width="180" height="180" rx="32" fill="#242424"/><g transform="translate(1278 602) scale(0.96)">${mark("translate(0 0)", "#E10600")}${plusSign(artwork.plusMark.plusTransform, "#E10600")}</g>`;
  const plusOverview = svg(1600, 900, plusBoard, "RaceSide Plus — система логотипа");
  await fs.writeFile(path.join(outputDirectory, "plus-overview.svg"), plusOverview);
  await sharp(Buffer.from(plusOverview)).png().toFile(path.join(outputDirectory, "plus-overview.png"));
  await fs.copyFile(path.join(root, "node_modules/geist/LICENSE.txt"), path.join(outputDirectory, "FONT-LICENSE.txt"));
  await fs.copyFile(path.join(root, "node_modules/geist/LICENSE.txt"), path.join(publicDirectory, "FONT-LICENSE.txt"));
  await fs.writeFile(path.join(outputDirectory, "manifest.json"), JSON.stringify({ brand: "RaceSide", concept: "Траектория", descriptor: "Гоночный центр", palettes, layouts, plusLayouts, items }, null, 2) + "\n");
  await fs.writeFile(path.join(outputDirectory, "GUIDE.txt"), "RaceSide — Траектория\n\nЗнак: две встречные ленты с открытой гоночной траекторией между ними.\nОсновной вариант: знак, RaceSide и «Гоночный центр».\nМеню и подвал: signature-dark / signature-light.\nКомпактные заголовки LIVE, Plus и загрузки: horizontal.\nИконки, аватары и маленькие Plus-плашки: отдельный знак.\nВсе SVG и PNG прозрачные, кроме готовых аватаров. Все буквы — векторные контуры.\nТёмная и светлая версии имеют красный знак. Одноцветные: white, black, red.\nНе растягивать, не вращать и не менять пропорции лент. Сохранять свободное поле.\nИсходная геометрия и генератор: scripts/generate-raceside-brand.mjs.\nОбщие данные сайта: src/components/racemate/raceside-logo-artwork.ts.\nШрифт: Geist Sans, лицензия приложена.\n");
  await fs.appendFile(path.join(outputDirectory, "GUIDE.txt"), "\nRaceSide Plus: raceside-plus-horizontal / signature — название с плюсом; raceside-plus-mark — самостоятельный знак с плюсом. Плюс — часть векторного рисунка, сохраняйте его размер и положение. Готовые аватары Plus: raceside-plus-avatar.\n");
  // Local Telegram artwork is an asset export; this never changes the bot account.
  const telegramDirectory = path.join(root, "public/brand/telegram");
  const telegramAvatar = await fs.readFile(path.join(publicDirectory, "raceside-avatar-dark.svg"));
  await fs.writeFile(path.join(telegramDirectory, "raceside-telegram-avatar.svg"), telegramAvatar);
  await sharp(telegramAvatar).jpeg({ quality: 95 }).toFile(path.join(telegramDirectory, "raceside-telegram-avatar.jpg"));
  const telegramFile = path.join(telegramDirectory, "raceside-telegram-preview.svg");
  const nestedLogo = (x, y, width, height, layoutName, opacity = 1) => {
    const layout = layouts[layoutName];
    return `<svg x="${x}" y="${y}" width="${width}" height="${height}" opacity="${opacity}" viewBox="0 0 ${layout.width} ${layout.height}">${render(layoutName, "dark")}</svg>`;
  };
  const telegramPreview = (await fs.readFile(telegramFile, "utf8"))
    .replace(/<svg x="(?:900|1079)"[^>]*>[\s\S]*?<\/svg>/, `<svg x="1079" y="296" width="322" height="322" opacity="0.09" viewBox="0 0 100 100">${mark("translate(0 0)", palettes.dark.mark)}</svg>`)
    .replace(/<svg x="96"[^>]*>[\s\S]*?<\/svg>/, nestedLogo(96, 74, 450, 450 * layouts.signature.height / layouts.signature.width, "signature"));
  await fs.writeFile(telegramFile, telegramPreview);
  await sharp(Buffer.from(telegramPreview)).jpeg({ quality: 95 }).toFile(path.join(telegramDirectory, "raceside-telegram-preview.jpg"));
  console.log(`Generated ${items.length} SVG/PNG pairs, application icons and overview.`);
  console.log(JSON.stringify({ layouts, descriptorHeight: descriptor.height }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
