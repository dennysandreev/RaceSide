import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
