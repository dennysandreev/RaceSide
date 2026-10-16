import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";

const source = ts.createSourceFile(
  "page.tsx",
  readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const fn = source.statements.find((node) =>
  ts.isFunctionDeclaration(node) && node.name?.text === "getHomeStandings",
);
assert.ok(fn);
const { outputText } = ts.transpileModule(fn.getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});

function loadHomeStandings(drivers, constructors) {
  const bindings = {
    CURRENT_F1_SEASON: 2026,
    withServerTtlCache: (_key, _ttl, load) => load(),
    getDriverChampionshipMatrix: async (season) => {
      assert.equal(season, 2026);
      return { rows: drivers };
    },
    getConstructorChampionshipMatrix: async (season) => {
      assert.equal(season, 2026);
      return { rows: constructors };
    },
  };
  return new Function(...Object.keys(bindings), `${outputText}\nreturn getHomeStandings;`)(
    ...Object.values(bindings),
  );
}

test("home uses championship totals and positions instead of the older standings snapshot", async () => {
  const drivers = [
    { driver: "Leclerc", driverSlug: "charles-leclerc", team: "Ferrari", position: 4, total: 191 },
    { driver: "Norris", driverSlug: "lando-norris", team: "McLaren", position: 5, total: 188 },
  ];
  const constructors = [{ team: "Ferrari", teamCode: "FER", position: 2, points: 405, wins: 2 }];
  const [driverRows, constructorRows] = await loadHomeStandings(drivers, constructors)();

  assert.deepEqual(driverRows.map((row) => [row.driver, row.position, row.points]), [
    ["Leclerc", 4, 191], ["Norris", 5, 188],
  ]);
  assert.equal(driverRows[0].driverSlug, "charles-leclerc");
  assert.deepEqual(constructorRows, constructors);
  assert.equal(drivers[0].points, undefined);
});

test("home preserves championship ordering, ties and zero-point entries", async () => {
  const drivers = [
    { driver: "First", position: 1, total: 10 },
    { driver: "Second", position: 2, total: 10 },
    { driver: "Zero", position: 3, total: 0 },
  ];
  const [rows] = await loadHomeStandings(drivers, [])();
  assert.deepEqual(rows.map((row) => [row.driver, row.position, row.points]), [
    ["First", 1, 10], ["Second", 2, 10], ["Zero", 3, 0],
  ]);
});

test("home handles missing championship data without fabricated standings", async () => {
  assert.deepEqual(await loadHomeStandings([], [])(), [[], []]);
});

test("home standings pass driver portraits and slugs without changing constructor logos", async () => {
  const panel = source.statements.find((node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === "HomeStandingsPanel",
  );
  assert.ok(panel);
  const { outputText } = ts.transpileModule(panel.getText(source), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
    },
  });
  const drivers = [
    { driver: "Norris", driverSlug: "lando-norris", avatarUrl: "/norris.webp", points: 188, position: 1 },
    { driver: "Leclerc", driverSlug: "charles-leclerc", points: 180, position: 2 },
    { driver: "Unknown", points: 0, position: 3 },
    { driver: "Andrea Kimi Antonelli", driverSlug: "andrea-kimi-antonelli", points: 340, position: 4 },
  ];
  const constructors = [{ team: "McLaren", teamCode: "MCL", teamLogo: "/mcl.svg", points: 400, position: 1 }];
  const bindings = {
    React: { createElement },
    HomeStandingsCarousel: "home-standings",
    getHomeStandings: async () => [drivers, constructors],
    getTeamProfileAsset: () => null,
  };
  const loadPanel = new Function(...Object.keys(bindings), `${outputText}\nreturn HomeStandingsPanel;`)(
    ...Object.values(bindings),
  );
  const { slides } = (await loadPanel()).props;

  assert.equal(slides[0].rows[0].avatarUrl, "/norris.webp");
  assert.equal(slides[0].rows[0].driverSlug, "lando-norris");
  assert.equal(slides[0].rows[0].href, "/drivers/lando-norris");
  assert.equal(slides[0].rows[1].avatarUrl, undefined);
  assert.equal(slides[0].rows[1].driverSlug, "charles-leclerc");
  assert.equal(slides[0].rows[2].driverSlug, undefined);
  assert.equal(slides[0].rows[3].name, "Andrea K Antonelli");
  assert.equal(slides[0].rows[3].href, "/drivers/andrea-kimi-antonelli");
  assert.equal(drivers[3].driver, "Andrea Kimi Antonelli");
  assert.equal(slides[0].rows[0].name, "Norris");
  assert.equal(slides[1].rows[0].teamLogo, "/mcl.svg");
});
