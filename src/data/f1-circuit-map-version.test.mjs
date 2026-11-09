import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";

import { getCircuitAsset, getVersionedCircuitMapUrl } from "./f1-assets.ts";

test("Singapore maps use the current asset revision across local aliases", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../public/f1/circuits/2026/manifest.json", import.meta.url), "utf8"));
  const source = manifest.sources.find((entry) => entry.layoutSlug === "singapore");
  const revision = source.sha256.slice(0, 16);
  for (const path of [source.file, "/f1/circuits/2026/16-singapore.webp", "/f1/circuits/singapore.webp"]) {
    const bytes = await readFile(new URL(`../../public${path}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256);
    assert.equal(getVersionedCircuitMapUrl(`${path}?v=old`), `${path}?v=${revision}`);
  }
  assert.equal(getCircuitAsset("Marina Bay", 2026)?.src, `${source.file}?v=${revision}`);
});

test("historical Singapore maps keep their original season asset", () => {
  const historical = "/f1/circuits/2025/18-singapore.webp";
  assert.equal(getVersionedCircuitMapUrl(historical), historical);
});

test("United States maps use the current official asset across local aliases", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../public/f1/circuits/2026/manifest.json", import.meta.url), "utf8"));
  const source = manifest.sources.find((entry) => entry.layoutSlug === "united-states");
  const revision = source.sha256.slice(0, 16);
  for (const path of [source.file, "/f1/circuits/2026/17-united-states.webp", "/f1/circuits/usa.webp"]) {
    const bytes = await readFile(new URL(`../../public${path}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256);
    assert.equal(getVersionedCircuitMapUrl(path), `${path}?v=${revision}`);
    assert.equal(getVersionedCircuitMapUrl(`${path}?v=old#map`), `${path}?v=${revision}`);
    assert.equal(getVersionedCircuitMapUrl(`${path}?v=${revision}`), `${path}?v=${revision}`);
  }
  for (const name of ["United States", "USA", "Circuit of The Americas", "Austin", "COTA"]) {
    assert.equal(getCircuitAsset(name, 2026)?.src, `${source.file}?v=${revision}`);
  }
});

test("historical United States maps and unrelated assets retain their URLs", () => {
  for (const path of [
    "/f1/circuits/2025/19-united-states.webp",
    "/f1/circuits/2024/19-united-states.webp?v=historic",
    "/f1/circuits/2026/04-miami.webp",
    "/f1/circuits/2026/21-las-vegas.webp",
    "https://example.com/f1/circuits/usa.webp",
  ]) {
    assert.equal(getVersionedCircuitMapUrl(path), path);
  }
  assert.equal(getCircuitAsset("Austin", 2025), null);
});

test("United States share previews are derived from the current map", async () => {
  const source = new URL("../../public/f1/circuits/2026/18-united-states.webp", import.meta.url);
  const expected = await sharp(await readFile(source)).resize(640, 360).ensureAlpha().raw().toBuffer();
  for (const round of [17, 18]) {
    const preview = new URL(`../../public/f1/circuits/share/2026/${round}-united-states.png`, import.meta.url);
    const { data, info } = await sharp(await readFile(preview)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 640);
    assert.equal(info.height, 360);
    assert.equal(
      createHash("sha256").update(data).digest("hex"),
      createHash("sha256").update(expected).digest("hex"),
    );
  }
});

test("Mexico maps use the current official asset across local aliases", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../public/f1/circuits/2026/manifest.json", import.meta.url), "utf8"));
  const source = manifest.sources.find((entry) => entry.layoutSlug === "mexico");
  const revision = source.sha256.slice(0, 16);
  for (const path of [source.file, "/f1/circuits/2026/18-mexico.webp", "/f1/circuits/mexico.webp"]) {
    const bytes = await readFile(new URL(`../../public${path}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256);
    assert.equal(getVersionedCircuitMapUrl(path), `${path}?v=${revision}`);
    assert.equal(getVersionedCircuitMapUrl(`${path}?v=old#map`), `${path}?v=${revision}`);
    assert.equal(getVersionedCircuitMapUrl(`${path}?v=${revision}`), `${path}?v=${revision}`);
  }
  for (const name of ["Mexico", "Mexico City", "Autódromo Hermanos Rodríguez"]) {
    assert.equal(getCircuitAsset(name, 2026)?.src, `${source.file}?v=${revision}`);
  }
});

test("historical Mexico maps retain their original season asset", () => {
  for (const path of [
    "/f1/circuits/2025/20-mexico.webp",
    "/f1/circuits/2024/20-mexico.webp?v=historic",
    "https://example.com/f1/circuits/mexico.webp",
  ]) {
    assert.equal(getVersionedCircuitMapUrl(path), path);
  }
  assert.equal(getCircuitAsset("Mexico", 2025), null);
});

test("Mexico share previews are derived from the current map", async () => {
  const source = new URL("../../public/f1/circuits/2026/19-mexico.webp", import.meta.url);
  const expected = await sharp(await readFile(source)).resize(640, 360).ensureAlpha().raw().toBuffer();
  for (const round of [18, 19]) {
    const preview = new URL(`../../public/f1/circuits/share/2026/${round}-mexico.png`, import.meta.url);
    const { data, info } = await sharp(await readFile(preview)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 640);
    assert.equal(info.height, 360);
    assert.equal(
      createHash("sha256").update(data).digest("hex"),
      createHash("sha256").update(expected).digest("hex"),
    );
  }
});

test("Brazil maps use the fresh official asset across current and legacy local aliases", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../public/f1/circuits/2026/manifest.json", import.meta.url), "utf8"));
  const source = manifest.sources.find((entry) => entry.layoutSlug === "brazil");
  const revision = source.sha256.slice(0, 16);
  for (const path of [source.file, "/f1/circuits/2026/19-brazil.webp", "/f1/circuits/brazil.webp"]) {
    const bytes = await readFile(new URL(`../../public${path}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256);
    assert.equal(getVersionedCircuitMapUrl(path), `${path}?v=${revision}`);
    assert.equal(getVersionedCircuitMapUrl(`${path}?v=old#map`), `${path}?v=${revision}`);
    assert.equal(getVersionedCircuitMapUrl(`${path}?v=${revision}`), `${path}?v=${revision}`);
  }
  assert.equal(source.sourceImageSha256, "560141f6d73a7ac18f831e04861d0585790d1e2aa49d9263d8583bd99e295374");
  for (const name of ["Brazil", "Interlagos", "Autódromo José Carlos Pace", "São Paulo"]) {
    assert.equal(getCircuitAsset(name, 2026)?.src, `${source.file}?v=${revision}`);
  }
});

test("historical Brazil maps and external URLs retain their original images", () => {
  for (const path of [
    "/f1/circuits/2025/21-brazil.webp",
    "/f1/circuits/2024/21-brazil.webp?v=historic",
    "https://example.com/f1/circuits/brazil.webp",
  ]) {
    assert.equal(getVersionedCircuitMapUrl(path), path);
  }
  assert.equal(getCircuitAsset("Brazil", 2025), null);
});

test("Brazil share previews are derived from the refreshed official map", async () => {
  const source = new URL("../../public/f1/circuits/2026/20-brazil.webp", import.meta.url);
  const expected = await sharp(await readFile(source)).resize(640, 360).ensureAlpha().raw().toBuffer();
  for (const round of [19, 20]) {
    const preview = new URL(`../../public/f1/circuits/share/2026/${round}-brazil.png`, import.meta.url);
    const { data, info } = await sharp(await readFile(preview)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 640);
    assert.equal(info.height, 360);
    assert.equal(createHash("sha256").update(data).digest("hex"), createHash("sha256").update(expected).digest("hex"));
  }
});
