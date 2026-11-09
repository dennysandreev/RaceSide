import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const file = new URL("./racemate-repository.ts", import.meta.url);
const source = ts.createSourceFile(file.pathname, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
const race = { id: "brazil", season: 2026, round: 20 };
const ocon = { id: "ocon-id", name: "Esteban Ocon", slug: "esteban-ocon", team: "Haas F1 Team" };
const bearman = { id: "bearman-id", name: "Oliver Bearman", slug: "oliver-bearman", team: "Haas F1 Team" };
const camara = { id: "camara-id", full_name: "Rafael Camara", slug: "rafael-camara", code: "CAM", permanent_number: 51, teams: { name: "Haas F1 Team", code: "HAA" } };

function fixture({ replacement = camara, error = null } = {}) {
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getFantasyDriverOptionsForRace");
  assert.ok(declaration, "a fantasy-only roster resolver must exist");
  const { outputText } = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  const reads = [];
  const query = {
    select() { return this; }, eq() { return this; },
    async maybeSingle() { reads.push("driver"); return { data: replacement, error }; },
  };
  const bindings = {
    createSupabaseServerClient: async () => ({ from(table) { assert.equal(table, "drivers"); return query; } }),
    withServerTtlCache: async (_key, _ttl, load) => load(),
    getRelationObject: relation => Array.isArray(relation) ? relation[0] : relation,
    getRelationName: relation => (Array.isArray(relation) ? relation[0] : relation)?.name ?? "Команда уточняется",
    getTeamAsset: () => ({ color: "#9C9FA2" }),
    getFantasyPredictionDriverAvatarUrl: slug => `/drivers/avatars/2026/${slug}.webp`,
  };
  const resolve = new Function(...Object.keys(bindings), `${outputText}\nreturn getFantasyDriverOptionsForRace;`)(...Object.values(bindings));
  return { resolve, reads };
}

test("new Brazil predictions replace Ocon with Camara, including the Haas identity and avatar", async () => {
  const { resolve } = fixture();
  const options = [ocon, bearman];
  const before = JSON.stringify(options);
  const drivers = await resolve(options, race, null);
  assert.deepEqual(drivers.map(driver => driver.id), ["camara-id", "bearman-id"]);
  assert.equal(drivers[0].team, "Haas F1 Team");
  assert.equal(drivers[0].number, 51);
  assert.equal(drivers[0].avatarUrl, "/drivers/avatars/2026/rafael-camara.webp");
  assert.equal(JSON.stringify(options), before);
});

test("the replacement remains scoped to new 2026 picks from Brazil onward", async () => {
  const { resolve, reads } = fixture();
  const options = [ocon, bearman];
  for (const context of [null, { season: 2025, round: 20 }, { season: 2026, round: 19 }, { season: 2027, round: 20 }]) {
    assert.equal(await resolve(options, context, null), options);
  }
  assert.equal(reads.length, 0);
  const drivers = await resolve(options, { ...race, round: 21 }, null);
  assert.equal(drivers.some(driver => driver.id === ocon.id), false);
});

test("Ocon remains resolvable for every saved pick without changing old IDs, scores or breakdowns", async () => {
  for (const field of ["top10DriverIds", "poleDriverId", "winnerDriverId", "fastestLapDriverId", "dnfDriverId"]) {
    const { resolve } = fixture();
    const current = { [field]: field === "top10DriverIds" ? [ocon.id] : ocon.id, score: 42, scoreBreakdown: { qualification: 8, race: 34 }, shareSlug: "old-prediction" };
    const before = JSON.stringify(current);
    const drivers = await resolve([ocon, bearman], race, current);
    assert.ok(drivers.some(driver => driver.id === ocon.id));
    assert.ok(drivers.some(driver => driver.id === "camara-id"));
    assert.equal(JSON.stringify(current), before);
  }
});

test("a saved Camara prediction still resolves after reopening the form", async () => {
  const { resolve } = fixture();
  const current = { top10DriverIds: ["camara-id"], poleDriverId: "camara-id", score: null };
  const drivers = await resolve([ocon, bearman], race, current);
  assert.ok(drivers.some(driver => driver.id === "camara-id"));
  assert.equal(drivers.some(driver => driver.id === ocon.id), false);
  assert.deepEqual(current.top10DriverIds, ["camara-id"]);
});

test("an existing Camara option is not duplicated and no unrelated driver is filtered", async () => {
  const { resolve, reads } = fixture();
  const existing = { ...bearman, id: "camara-id", slug: "rafael-camara", name: "Rafael Camara" };
  const drivers = await resolve([ocon, bearman, existing], race, null);
  assert.deepEqual(drivers, [bearman, existing]);
  assert.equal(reads.length, 0);
});

test("a missing or unavailable replacement never deletes a usable roster", async () => {
  const options = [ocon, bearman];
  for (const response of [{ replacement: null }, { replacement: null, error: { code: "timeout" } }]) {
    const { resolve } = fixture(response);
    assert.equal(await resolve(options, race, null), options);
  }
});

test("only the current fantasy form applies the replacement, not shared standings or historical readers", () => {
  const state = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getPredictionState");
  assert.match(state.getText(source), /getFantasyDriverOptionsForRace\(/);
  const options = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getCurrentSeasonPredictionOptions");
  assert.doesNotMatch(options.getText(source), /getFantasyDriverOptionsForRace|rafael.camara|esteban.ocon/);
});

test("loading the fantasy page preserves persisted old picks, score, breakdown and previous-round results", async () => {
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getPredictionState");
  const { outputText } = ts.transpileModule(declaration.getText(source).replace(/^export /, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  const stored = { pole_driver_id: ocon.id, winner_driver_id: ocon.id, fastest_lap_driver_id: ocon.id, dnf_driver_id: bearman.id, top10_driver_ids: [ocon.id, bearman.id], score: 42, score_breakdown: { race: 34, qualification: 8 }, share_slug: "old-prediction", share_image_version: 3 };
  const original = JSON.stringify(stored);
  const previous = { total: 88, picks: [ocon.id] };
  const summary = { totalScore: 130 };
  const query = { select() { return this; }, eq() { return this; }, is() { return this; }, maybeSingle: async () => ({ data: stored }) };
  const { resolve } = fixture();
  const bindings = {
    withServerTtlCache: async () => ({ drivers: [ocon, bearman], currentRace: { season_year: 2026 }, race, teams: [], startingGrid: null }),
    getPublicPredictionState: () => {},
    emptyPredictionSeasonSummary: () => ({}),
    createSupabaseServerClient: async () => ({ from(table) { assert.equal(table, "predictions"); return query; } }),
    getPreviousPredictionResult: async () => previous,
    getPredictionSeasonSummary: async () => summary,
    normalizeDriverIdList: values => [...values],
    mapFantasyScoreBreakdown: value => value,
    getFantasyDriverOptionsForRace: resolve,
  };
  const loadState = new Function(...Object.keys(bindings), `${outputText}\nreturn getPredictionState;`)(...Object.values(bindings));
  const state = await loadState("test-user");
  assert.deepEqual(state.current.top10DriverIds, stored.top10_driver_ids);
  assert.equal(state.current.poleDriverId, ocon.id);
  assert.equal(state.current.score, 42);
  assert.deepEqual(state.current.scoreBreakdown, stored.score_breakdown);
  assert.equal(state.current.shareSlug, stored.share_slug);
  assert.equal(state.previousResult, previous);
  assert.equal(state.seasonSummary, summary);
  assert.equal(JSON.stringify(stored), original);
});
