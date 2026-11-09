import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile(
  "racemate-repository.ts",
  readFileSync(new URL("./racemate-repository.ts", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const builder = source.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "getPolymarketEventUrl",
);
assert.ok(builder, "The shared Polymarket link builder must exist");
const { outputText } = ts.transpileModule(builder.getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const getPolymarketEventUrl = new Function(`${outputText}\nreturn getPolymarketEventUrl;`)();

test("adds the RaceSide referral without losing the event destination", () => {
  assert.equal(
    getPolymarketEventUrl({ slug: "f1-mexico-grand-prix-winner", id: 123 }),
    "https://polymarket.com/event/f1-mexico-grand-prix-winner?r=raceside",
  );
});

test("keeps the referral when an event only has an ID", () => {
  for (const id of [123, "456", 0]) {
    assert.equal(getPolymarketEventUrl({ id }), `https://polymarket.com/event/${id}?r=raceside`);
  }
});

test("falls back to the referral homepage when the event has no destination", () => {
  for (const event of [{}, { slug: "" }]) {
    assert.equal(getPolymarketEventUrl(event), "https://polymarket.com/?r=raceside");
  }
});

test("preserves other query parameters and replaces an existing referral", () => {
  const url = new URL(getPolymarketEventUrl({ slug: "f1-champion?view=all&r=old#markets" }));
  assert.equal(url.pathname, "/event/f1-champion");
  assert.equal(url.searchParams.get("view"), "all");
  assert.deepEqual(url.searchParams.getAll("r"), ["raceside"]);
  assert.equal(url.hash, "#markets");
});

test("all three odds feeds use the shared referral link builder", () => {
  for (const name of ["getRaceWinnerOdds", "getSeasonChampionOdds", "getConstructorChampionOdds"]) {
    const feed = source.statements.find(
      (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
    );
    assert.ok(feed, `${name} must exist`);
    const marketUrls = [];
    function visit(node) {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === "marketUrl") {
        marketUrls.push(node.initializer.getText(source));
      }
      ts.forEachChild(node, visit);
    }
    visit(feed);
    assert.deepEqual(marketUrls, ["getPolymarketEventUrl(selected.event)"], name);
  }
});
