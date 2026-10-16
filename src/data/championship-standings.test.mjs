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

// Exercise the repository's real matrix builders without Next.js request state.
function loadMatrixBuilder(kind, entries, resultPoints = new Map()) {
  const functionName = kind === "driver"
    ? "getDriverChampionshipMatrix"
    : "getConstructorChampionshipMatrix";
  const names = new Set([
    functionName,
    "sumRoundPoints",
    "getCumulativeScoredRounds",
    "getCumulativeRoundPoints",
    "getCumulativeRoundPointsAfterDisplayedTotal",
    "getPodiumFinish",
  ]);
  const functions = source.statements
    .filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
    .map((node) => node.getText(source).replace(/^export /, ""));
  assert.equal(functions.length, names.size);

  const query = {
    select() { return this; },
    eq() { return this; },
    lte() { return this; },
    order() { return this; },
    then(resolve, reject) {
      return Promise.resolve({ data: entries, error: null }).then(resolve, reject);
    },
  };
  const bindings = {
    CURRENT_F1_SEASON: 2026,
    resolvePublishedSeason: async (season) => season,
    createSupabaseServerClient: async () => ({ from: () => query }),
    getLatestCompleteStandingRound: async () => ({ season_year: 2026, round: 1 }),
    getChampionshipRoundPointTotals: async () => ({
      scoredRounds: [1, 2],
      driverPoints: resultPoints,
      constructorPoints: resultPoints,
      driverRacePositions: new Map(),
    }),
    getRaceRoundVisualsForRounds: async () => [{ round: 1 }, { round: 2 }],
    getTeamProfiles: async () => [],
    getDriverSeasonProfilesByIds: async () => new Map(),
    getTeamVisualFields: (team) => ({ team: team.name }),
    getRelationName: (driver) => driver.full_name,
    getRelationObject: (relation) => relation,
  };
  const { outputText } = ts.transpileModule(functions.join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return new Function(...Object.keys(bindings), `${outputText}\nreturn ${functionName};`)(
    ...Object.values(bindings),
  );
}

function standing(id, position, points) {
  return {
    driver_id: id,
    team_id: id,
    round: 1,
    position,
    points,
    drivers: { full_name: id, slug: id },
    teams: { name: id },
  };
}

for (const kind of ["driver", "constructor"]) {
  const nameKey = kind === "driver" ? "driver" : "team";
  const pointsKey = kind === "driver" ? "total" : "points";

  test(`${kind} standings rerank after adding results newer than the standings snapshot`, async () => {
    const entries = [standing("norris", 1, 186), standing("leclerc", 2, 179)];
    const points = new Map([
      ["norris", new Map([[1, 186], [2, 2]])],
      ["leclerc", new Map([[1, 179], [2, 12]])],
    ]);
    const { rows } = await loadMatrixBuilder(kind, entries, points)(2026);

    assert.deepEqual(rows.map((row) => [row[nameKey], row.position, row[pointsKey]]), [
      ["leclerc", 1, 191],
      ["norris", 2, 188],
    ]);
    assert.deepEqual(rows[0].pointsByRound, { 1: 179, 2: 12 });
    assert.equal(entries[0].position, 1);
  });

  test(`${kind} standings rerank when corrected results change the current round total`, async () => {
    const entries = [standing("norris", 1, 186), standing("leclerc", 2, 179)];
    const points = new Map([
      ["norris", new Map([[1, 188]])],
      ["leclerc", new Map([[1, 191]])],
    ]);
    const { rows } = await loadMatrixBuilder(kind, entries, points)(2026);

    assert.deepEqual(rows.map((row) => [row[nameKey], row.position, row[pointsKey]]), [
      ["leclerc", 1, 191],
      ["norris", 2, 188],
    ]);
  });

  test(`${kind} standings retain the source's order on equal points and include zero points`, async () => {
    const entries = [standing("zero", 3, 0), standing("second", 2, 7), standing("first", 1, 7)];
    const { rows } = await loadMatrixBuilder(kind, entries)(2026);

    assert.deepEqual(rows.map((row) => [row[nameKey], row.position, row[pointsKey]]), [
      ["first", 1, 7],
      ["second", 2, 7],
      ["zero", 3, 0],
    ]);
  });

  test(`${kind} standings rank by the final total when results are incomplete`, async () => {
    const entries = [standing("leader", 1, 100.5), standing("second", 2, 90)];
    const points = new Map([["leader", new Map([[1, 80]])]]);
    const { rows } = await loadMatrixBuilder(kind, entries, points)(2026);

    assert.deepEqual(rows.map((row) => [row[nameKey], row.position, row[pointsKey]]), [
      ["leader", 1, 100.5],
      ["second", 2, 90],
    ]);
  });
}
