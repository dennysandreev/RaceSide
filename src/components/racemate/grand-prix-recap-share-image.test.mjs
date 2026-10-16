import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { createElement } from "react";
import { ImageResponse } from "next/og.js";
import ts from "typescript";
import { buildGrandPrixRecapData } from "../../lib/grand-prix-recap.ts";

// Exercise the actual TSX with ImageResponse: a React HTML render alone does
// not catch unsupported styles in Satori's PNG renderer.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const mod = { exports: {} };
  modules.set(file, mod);
  const require = createRequire(file);
  const localRequire = (name) => {
    if (name.startsWith("@/") || name.startsWith(".")) {
      const base = name.startsWith("@/") ? resolve(root, "src", name.slice(2)) : resolve(dirname(file), name);
      const target = [base, base + ".ts", base + ".tsx"].find(existsSync);
      if (target && /\.tsx?$/.test(target)) return load(target);
    }
    return require(name);
  };
  const js = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInThisContext("(function(require,module,exports){" + js + "\n})", { filename: file })(localRequire, mod, mod.exports);
  return mod.exports;
}
const { GrandPrixRecapShareImage } = load(resolve(root, "src/components/racemate/grand-prix-recap-share-image.tsx"));
const { getPredictionShareFonts } = load(resolve(root, "src/lib/prediction-share-fonts.ts"));

const results = ["Max Verstappen", "Andrea Kimi Antonelli", "Lewis Hamilton"].map((driver, index) => ({
  driver, position: index + 1, driverNumber: index + 1, team: ["Red Bull", "Mercedes", "Ferrari"][index],
  teamColor: ["#3671C6", "#27F4D2", "#E10600"][index], time: index ? "+2.307" : "1:47:14.808",
  points: [25, 18, 15][index], grid: index + 2, laps: 55, status: "Finished", bestLap: "1:38.220",
}));
const analytics = {
  totalLaps: 55,
  drivers: results.map((row, index) => ({ number: row.driverNumber, driver: row.driver, code: ["VER", "ANT", "HAM"][index], positions: [{ lap: 1, value: 3 - index }, { lap: 2, value: row.position }] })),
  championship: { drivers: results.map((row, index) => ({ id: String(index), name: row.driver, team: row.team, position: row.position, points: 320 - index * 40 })), teams: [] },
};

for (const populated of [true, false]) test(`renders a complete PNG with ${populated ? "timing and standings" : "missing timing, standings and portraits"}`, async () => {
  const data = buildGrandPrixRecapData({
    race: { season: 2026, round: 16, race: "Malaysian Grand Prix", circuit: "Sepang", startsAtIso: "2026-10-04T07:00:00Z" },
    report: { highlights: {}, weather: {}, raceStatistics: { laps: 55 }, strategies: [], pitStops: [], results: [] },
    resultsBySession: new Map([["race", results]]), sessions: [{ id: "race", type: "race" }], analytics: populated ? analytics : null,
  });
  const response = new ImageResponse(createElement(GrandPrixRecapShareImage, {
    data: { ...data, podium: data.podium.map((row) => ({ ...row, avatarUrl: null })) },
  }), { width: 1080, height: 1350, fonts: await getPredictionShareFonts() });
  const png = Buffer.from(await response.arrayBuffer());
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1350);
  assert.ok(png.length > 10_000);
});
