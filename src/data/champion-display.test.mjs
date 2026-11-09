import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import { getConfirmedSeasonChampion } from "./season-champions.ts";

const profileSource = ts.createSourceFile("page.tsx",
  readFileSync(new URL("../app/drivers/[slug]/page.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const hero = profileSource.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "DriverHero");
assert.ok(hero);
let championCondition;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(profileSource) === "isChampion") {
    championCondition = node.initializer?.getText(profileSource);
  }
  ts.forEachChild(node, visit);
}
visit(hero);
assert.ok(championCondition);
const isProfileChampion = new Function("profile", "CURRENT_F1_SEASON", "getConfirmedSeasonChampion",
  `return ${championCondition};`);

const podiumSource = ts.createSourceFile("grand-prix-podium-preview.tsx",
  readFileSync(new URL("../components/racemate/grand-prix-podium-preview.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const abbreviation = podiumSource.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "getShortDriverName");
assert.ok(abbreviation);
const { outputText } = ts.transpileModule(abbreviation.getText(podiumSource), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
});
const getShortDriverName = new Function(`${outputText}\nreturn getShortDriverName;`)();

function champion(slug, season, position) {
  return isProfileChampion({ slug, season, stats: { championshipPosition: position } }, 2026, getConfirmedSeasonChampion);
}

test("Antonelli's confirmed current title uses the existing profile champion badge", () => {
  assert.equal(champion("andrea-kimi-antonelli", 2026, 1), true);
  assert.equal(champion("andrea-kimi-antonelli", 2026, null), true);
  assert.equal(getConfirmedSeasonChampion(2026)?.name, "K Antonelli");
});

test("a current leader is not automatically a champion, while historic champions keep their badge", () => {
  assert.equal(champion("george-russell", 2026, 1), false);
  assert.equal(champion("andrea-kimi-antonelli", 2025, 2), false);
  assert.equal(champion("max-verstappen", 2024, 1), true);
  assert.equal(champion("lewis-hamilton", 2020, 1), true);
  assert.equal(champion("lando-norris", 2024, 2), false);
  assert.equal(champion("andrea-kimi-antonelli", 2027, 1), false);
});

test("every report podium variant uses K, never Andrea's A, for Antonelli", () => {
  for (const name of ["Andrea Kimi Antonelli", "Andrea K Antonelli", "Kimi Antonelli", "A. Antonelli", "Antonelli", "  Andrea   Kimi   Antonelli  "]) {
    assert.equal(getShortDriverName(name), "K. Antonelli");
  }
});

test("other report names and empty values keep their existing abbreviations", () => {
  assert.equal(getShortDriverName("Max Verstappen"), "M. Verstappen");
  assert.equal(getShortDriverName("Lewis Hamilton"), "L. Hamilton");
  assert.equal(getShortDriverName("Alonso"), "Alonso");
  assert.equal(getShortDriverName(""), "");
});
