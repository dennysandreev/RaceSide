import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import { getConfirmedSeasonChampion } from "../../data/season-champions.ts";

function loadComponent(file, name, bindings = {}) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, name);
  const { outputText } = ts.transpileModule(fn.getText(source).replace(/^export /, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  const scope = {
    React: { createElement },
    cn: (...values) => values.filter(Boolean).join(" "),
    getConfirmedSeasonChampion,
    ...bindings,
  };
  return new Function(...Object.keys(scope), `${outputText}\nreturn ${name};`)(...Object.values(scope));
}

const Link = ({ children, href, className, "aria-label": label }) => createElement("a", {
  href, className, "aria-label": label,
}, children);
const Icon = () => createElement("svg", { "aria-hidden": true });
const SeasonChampionBadge = loadComponent("./season-champion-badge.tsx", "SeasonChampionBadge", {
  Link, Trophy: Icon,
  DriverAvatarBadge: ({ name, season, slug }) => createElement("span", {
    "data-avatar-name": name, "data-avatar-season": season, "data-avatar-slug": slug,
  }),
});
const HomeSeasonProgress = loadComponent("./season-globe/season-globe-explorer.tsx", "HomeSeasonProgress", {
  SeasonChampionBadge,
});
const SeasonProgress = loadComponent("./season-progress.tsx", "SeasonProgress", {
  SeasonChampionBadge, Link, CalendarClock: Icon, RaceFlag: Icon,
});

function homeData(season = 2026, completed = 19, total = 23) {
  return { season, events: Array.from({ length: total }, (_, index) => ({
    round: index + 1, phase: index < completed ? "completed" : "upcoming",
  })) };
}

test("only the explicitly confirmed 2026 title is shown, never an inferred or cross-season leader", () => {
  const champion = getConfirmedSeasonChampion(2026);
  assert.equal(champion?.driverSlug, "andrea-kimi-antonelli");
  assert.equal(champion?.name, "K Antonelli");
  assert.doesNotMatch(champion.name, /Антонелли/);
  for (const season of [2020, 2021, 2022, 2023, 2024, 2025, 2027, NaN]) {
    assert.equal(getConfirmedSeasonChampion(season), null);
  }
});

test("the champion has a real existing avatar and a season-local accessible profile link", () => {
  const champion = getConfirmedSeasonChampion(2026);
  assert.ok(existsSync(new URL(`../../../public/drivers/avatars/2026/${champion.driverSlug}.webp`, import.meta.url)));
  const html = renderToStaticMarkup(createElement(SeasonChampionBadge, { champion }));
  assert.match(html, /href="\/drivers\/andrea-kimi-antonelli\?season=2026"/);
  assert.match(html, /aria-label="K Antonelli, чемпион мира 2026\. Открыть профиль"/);
  assert.match(html, /data-avatar-season="2026"/);
  assert.match(html, /Чемпион мира/);
});

test("home celebrates the title without turning an unfinished season into 100 percent", () => {
  const html = renderToStaticMarkup(createElement(HomeSeasonProgress, { data: homeData() }));
  assert.match(html, /K Antonelli/);
  assert.match(html, /aria-valuenow="83"/);
  assert.match(html, /Завершено 19 из 23 этапов/);
  assert.doesNotMatch(html, /hidden lg:block/);
});

test("home preserves the compact non-champion layout and empty-data fallback", () => {
  const html = renderToStaticMarkup(createElement(HomeSeasonProgress, { data: homeData(2024) }));
  assert.match(html, /hidden lg:block/);
  assert.doesNotMatch(html, /Чемпион мира|Антонелли/);
  assert.equal(renderToStaticMarkup(createElement(HomeSeasonProgress, { data: homeData(2026, 0, 0) })), "");
});

test("calendar and championship keep counts and the next-stage link alongside the champion", () => {
  const html = renderToStaticMarkup(createElement(SeasonProgress, {
    season: 2026, completedCount: 19, totalCount: 23,
    nextRace: { country: "Brazil", race: "Гран-при Бразилии", date: "8 ноября" },
  }));
  assert.match(html, /K Antonelli/);
  assert.match(html, /aria-valuenow="83"/);
  assert.match(html, /19 \/ 23/);
  assert.match(html, /href="\/weekend"/);
  assert.match(html, /Гран-при Бразилии/);
});

test("archived progress never inherits Antonelli and completed seasons retain their final status", () => {
  const html = renderToStaticMarkup(createElement(SeasonProgress, {
    season: 2024, completedCount: 24, totalCount: 24, nextRace: null,
  }));
  assert.doesNotMatch(html, /Чемпион мира|Антонелли/);
  assert.match(html, /aria-valuenow="100"/);
  assert.match(html, /Сезон завершён/);
});
