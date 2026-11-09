import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile("racemate-repository.ts",
  readFileSync(new URL("./racemate-repository.ts", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true);
const names = new Set([
  "getSeasonChampionOdds", "getConstructorChampionOdds", "scoreSeasonChampionEvent",
  "scoreConstructorChampionEvent", "parsePolymarketEventOutcomes", "parsePolymarketYesNoOutcome",
  "isPolymarketOutcomeMarket", "isDriverChampionMarket", "isConstructorChampionMarket",
  "isDriverWinnerMarket", "getPolymarketEntityName", "getEventVolume", "getPolymarketUpdatedAt",
  "getPolymarketEventUrl", "parsePolymarketOutcomes", "parseStringArray", "isLikelyNamedOutcome",
  "normalizeText", "isNonTitleChampionshipMarket", "isPolymarketEventForSeason",
]);
const functions = source.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
  .map((node) => node.getText(source).replace(/^export /, ""));
const { outputText } = ts.transpileModule(functions.join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
});

function loadOdds(events) {
  const bindings = {
    CURRENT_F1_SEASON: 2026,
    fetchPolymarketRaceEvents: async () => events,
    getActiveDriverNames: async () => new Set(["antonelli", "russell", "verstappen"]),
    getActiveTeamNames: async () => new Set(["mercedes", "ferrari", "mclaren"]),
    formatRelativeTime: () => "сейчас",
  };
  return new Function(...Object.keys(bindings), `${outputText}\nreturn {getSeasonChampionOdds, getConstructorChampionOdds};`)(
    ...Object.values(bindings));
}

function market(name, probability, question, extra = {}) {
  return { groupItemTitle: name, question, active: true, closed: false,
    outcomes: '["Yes", "No"]', outcomePrices: JSON.stringify([probability, 1 - probability]), ...extra };
}

function event(title = "F1 Drivers' Champion", markets = [], extra = {}) {
  return { title, slug: "2026-f1-drivers-champion", active: true, closed: false,
    volume24hr: 100, markets, ...extra };
}

const winner = () => event(undefined, [
  market("Kimi Antonelli", 0.999, "Will Kimi Antonelli be the 2026 F1 Drivers' Champion?"),
  market("George Russell", 0, "Will George Russell be the 2026 F1 Drivers' Champion?", { closed: true }),
]);
const runnerUp = (place = "2nd", word = "second") => event(`F1 Drivers' Champion: ${place} Place`, [
  market("Kimi Antonelli", 0.01, `Will Kimi Antonelli finish ${word} in the 2026 F1 Drivers' Championship?`),
  market("George Russell", 0.6, `Will George Russell finish ${word} in the 2026 F1 Drivers' Championship?`),
], { slug: `2026-f1-drivers-champion-${place}-place`, volume24hr: 10000 });

test("keeps the real title market when only the winner remains open", async () => {
  const odds = await loadOdds([runnerUp(), winner()]).getSeasonChampionOdds();
  assert.equal(odds?.marketTitle, "F1 Drivers' Champion");
  assert.deepEqual(odds.outcomes.map(({ name, probability }) => [name, probability]), [["Kimi Antonelli", 0.999]]);
});

test("never substitutes second, third or fifth place when the title market is closed", async () => {
  for (const [place, word] of [["2nd", "second"], ["3rd", "third"], ["5th", "fifth"]]) {
    assert.equal(await loadOdds([{ ...winner(), closed: true }, runnerUp(place, word)]).getSeasonChampionOdds(), null);
  }
});

test("rejects a different season rather than merely giving it a lower score", async () => {
  const wrongSeason = event("2027 F1 Drivers' Champion", [
    market("Kimi Antonelli", 0.4, "Will Kimi Antonelli be the 2027 F1 Drivers' Champion?"),
    market("George Russell", 0.3, "Will George Russell be the 2027 F1 Drivers' Champion?"),
  ], { slug: "2027-f1-drivers-champion" });
  assert.equal(await loadOdds([wrongSeason]).getSeasonChampionOdds(), null);
});

test("uses market questions to verify the year when the constructors event slug has none", async () => {
  const constructors = event("F1 Constructors' Champion", [
    market("Mercedes", 0.997, "Will Mercedes be the 2026 F1 Constructors' Champion?"),
    market("Ferrari", 0, "Will Ferrari be the 2026 F1 Constructors' Champion?", { closed: true }),
  ], { slug: "f1-constructors-champion" });
  const odds = await loadOdds([constructors]).getConstructorChampionOdds();
  assert.equal(odds?.outcomes[0].name, "Mercedes");
  assert.equal(odds.outcomes[0].probability, 0.997);
});

test("rejects constructors finishing-position and stale-season markets too", async () => {
  for (const title of ["2026 F1 Constructors' Championship: 2nd Place", "2027 F1 Constructors' Champion"]) {
    const year = title.includes("2027") ? 2027 : 2026;
    const markets = ["Mercedes", "Ferrari"].map((name) => market(name, 0.4, `${title}: Will ${name} win?`));
    assert.equal(await loadOdds([event(title, markets, { slug: `f1-constructors-${year}` })]).getConstructorChampionOdds(), null);
  }
});

test("does not merge a second-place or wrong-year submarket into title probabilities", async () => {
  const title = winner();
  title.markets.push(
    market("Kimi Antonelli", 0.9999, "Will Kimi Antonelli finish second in the 2026 F1 Drivers' Championship?"),
    market("George Russell", 0.8, "Will George Russell be the 2027 F1 Drivers' Champion?"),
  );
  const odds = await loadOdds([title]).getSeasonChampionOdds();
  assert.deepEqual(odds?.outcomes.map(({ name, probability }) => [name, probability]), [["Kimi Antonelli", 0.999]]);
});

test("reads the Yes price by its outcome index, without swapping it with No", async () => {
  const title = winner();
  title.markets[0].outcomes = '["No", "Yes"]';
  title.markets[0].outcomePrices = '["0.14", "0.86"]';
  const odds = await loadOdds([title]).getSeasonChampionOdds();
  assert.equal(odds?.outcomes[0].probability, 0.86);
  assert.equal(odds?.outcomes[0].label, "86%");
});

test("keeps genuine named-outcome winner markets but rejects named-outcome positional markets", async () => {
  const named = market("", 0, "Who will be the 2026 F1 Drivers' Champion?", {
    outcomes: '["Kimi Antonelli", "George Russell"]', outcomePrices: '["0.8", "0.2"]',
  });
  const odds = await loadOdds([event(undefined, [named])]).getSeasonChampionOdds();
  assert.equal(odds?.outcomes[0].probability, 0.8);
  named.question = "Who will finish second in the 2026 F1 Drivers' Championship?";
  assert.equal(await loadOdds([event(undefined, [named])]).getSeasonChampionOdds(), null);
});

test("missing or wholly closed title data stays unavailable instead of inventing odds", async () => {
  assert.equal(await loadOdds([]).getSeasonChampionOdds(), null);
  const title = winner();
  title.markets.forEach((entry) => { entry.closed = true; });
  assert.equal(await loadOdds([title]).getSeasonChampionOdds(), null);
});
