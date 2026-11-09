import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import sharp from "sharp";
import { normalizeDriverAvatarSlug } from "../lib/driver-avatar-slug.ts";

function load(file, names, bindings) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const statements = source.statements.filter(node => (
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
  ) || (
    ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source)))
  )).map(node => node.getText(source).replace(/^export /, ""));
  assert.equal(statements.length, names.length);
  const { outputText } = ts.transpileModule(statements.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  return new Function(...Object.keys(bindings), `${outputText}\nreturn {${names.join(",")}};`)(...Object.values(bindings));
}

test("Camara uses his local helmet avatar without leaking it into historical seasons", () => {
  const { getLocalDriverAvatarSrc } = load("../components/racemate/driver-avatar-badge.tsx", ["localDriverAvatarSlugs", "getLocalDriverAvatarSrc"], { normalizeDriverAvatarSlug, CURRENT_F1_SEASON: 2026 });
  assert.equal(getLocalDriverAvatarSrc("Rafael CÂMARA"), "/drivers/avatars/2026/rafael-camara.webp");
  assert.equal(getLocalDriverAvatarSrc("rafael-camara", 2025), null);
  assert.equal(getLocalDriverAvatarSrc("unknown-driver"), null);
});

test("Camara's prediction avatar uses the same seasonal image and the existing PNG export path", () => {
  const { getFantasyPredictionDriverAvatarUrl, getLocalPredictionDriverAvatarUrl } = load("./racemate-repository.ts", ["localPredictionDriverAvatarSlugs", "getFantasyPredictionDriverAvatarUrl", "getLocalPredictionDriverAvatarUrl"], {
    slugify: normalizeDriverAvatarSlug, CURRENT_F1_SEASON: 2026,
    getSeasonDriverAvatarPath: (season, slug) => `/drivers/avatars/${season}/${slug}.webp`,
    getSiteUrl: () => "https://raceside.online",
  });
  assert.equal(getFantasyPredictionDriverAvatarUrl("rafael-camara"), "/drivers/avatars/2026/rafael-camara.webp");
  assert.equal(getLocalPredictionDriverAvatarUrl("rafael-camara"), "https://raceside.online/drivers/avatars/rafael-camara.png");
});

test("Camara's reviewed avatar has matching provenance, checksum and a genuinely transparent square cutout", async () => {
  const manifest = JSON.parse(readFileSync(new URL("../../public/drivers/avatars/2026/manifest.json", import.meta.url), "utf8"));
  const entry = manifest.drivers.find(driver => driver.externalId === "rafael_camara");
  assert.ok(entry);
  assert.equal(entry.manualReview.status, "approved");
  assert.equal(entry.source.kind, "generated");
  assert.equal(entry.code, "CAM");
  assert.equal(entry.team.externalId, "haas");
  for (const [file, expectedHash] of [[entry.file, entry.sha256], [entry.source.sourceFile, entry.source.sha256]]) {
    const buffer = readFileSync(new URL(`../../public${file}`, import.meta.url));
    assert.equal(createHash("sha256").update(buffer).digest("hex"), expectedHash);
    const metadata = await sharp(buffer).metadata();
    assert.equal(metadata.width, metadata.height);
    assert.ok(metadata.width >= 512 && metadata.width <= 2048);
    assert.equal(metadata.hasAlpha, true);
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(data[3], 0);
    assert.equal(data[(info.width - 1) * 4 + 3], 0);
    assert.ok(data[(Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4 + 3] > 240);
  }
});
