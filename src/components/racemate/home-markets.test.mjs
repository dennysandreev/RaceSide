import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import { getConfirmedSeasonChampion } from "../../data/season-champions.ts";

function loadFunction(file, name, bindings) {
  const source = ts.createSourceFile(file, readFileSync(new URL(file, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, name);
  const { outputText } = ts.transpileModule(fn.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  return new Function(...Object.keys(bindings), `${outputText}\nreturn ${name};`)(...Object.values(bindings));
}

function buildSlide(overrides = {}, season = 2026) {
  const buildMarketSlide = loadFunction("../../app/page.tsx", "buildMarketSlide", {
    CURRENT_F1_SEASON: season,
    getConfirmedSeasonChampion,
    getTeamAssetForMarketOutcome: () => ({ color: "#27f4d2" }),
  });
  return buildMarketSlide({
    emptyText: "На Polymarket пока нет рынка чемпионства сезона.",
    id: "drivers",
    odds: null,
    standings: [],
    title: "Шансы на титул",
    ...overrides,
  });
}

const wrap = (tag) => function WrappedElement({ children, ...props }) {
  return createElement(tag, props, children);
};
const Icon = (props) => createElement("svg", props);
const MarketCarousel = loadFunction("./home-sidebar-carousels.tsx", "MarketCarousel", {
  React: { createElement, Fragment },
  useCarousel: () => ({ activeIndex: 0, dragProps: {}, transitionKey: 0 }),
  Card: wrap("section"), CardContent: wrap("div"), CardHeader: wrap("header"), CardTitle: wrap("h3"),
  CarouselCounter: () => null, CarouselNavigation: () => null,
  TrendingUp: Icon, Trophy: Icon, ExternalLink: Icon,
  Image: (props) => createElement("img", props),
  Link: ({ children, href, rel, target, className }) => createElement("a", { href, rel, target, className }, children),
  TeamColorProgress: ({ value }) => createElement("span", { "data-probability": value }),
});
const renderSlide = (slide) => renderToStaticMarkup(createElement(MarketCarousel, { slides: [slide] }));

test("an absent driver-title market uses only the current season's confirmed champion", () => {
  assert.equal(buildSlide().champion?.driverSlug, "andrea-kimi-antonelli");
  for (const season of [2024, 2025, 2027]) {
    assert.equal(buildSlide({}, season).champion, null);
  }
  assert.equal(buildSlide({ id: "constructors" }).champion, null);
});

test("the champion placeholder has no portrait, fake odds or market-update metadata", () => {
  const html = renderSlide(buildSlide());
  assert.match(html, /K Antonelli/);
  assert.match(html, /Чемпион мира 2026/);
  assert.match(html, /href="https:\/\/polymarket.com\/\?r=raceside"/);
  assert.match(html, /src="\/brands\/polymarket-mark-v2.png"/);
  assert.ok(existsSync(new URL("../../../public/brands/polymarket-mark-v2.png", import.meta.url)));
  assert.doesNotMatch(html, /\/drivers\/|avatars|data-probability|%|обновлено|пока нет рынка/);
});

test("unresolved titles keep real market odds and the existing team-color mapping", () => {
  const odds = {
    marketTitle: "Formula 1 Drivers Champion 2026",
    marketUrl: "https://polymarket.com/event/f1-2026?r=raceside",
    source: "Polymarket", updatedAt: "12:00",
    outcomes: [{ name: "Kimi Antonelli", probability: 0.99, label: "99%" }],
  };
  const slide = buildSlide({ odds }, 2027);
  assert.equal(slide.champion, null);
  assert.equal(slide.odds.outcomes[0].color, "#27f4d2");
  const html = renderSlide({ ...slide, champion: getConfirmedSeasonChampion(2026) });
  assert.match(html, /99%/);
  assert.match(html, /обновлено 12:00/);
  assert.doesNotMatch(html, /Чемпион мира/);
});

test("a confirmed title replaces lingering market odds instead of showing a stale forecast", () => {
  const slide = buildSlide({ odds: {
    marketTitle: "F1 Drivers' Champion", outcomes: [{ name: "Kimi Antonelli", probability: 1, label: "100%" }],
  } });
  assert.equal(slide.odds, null);
  assert.equal(slide.champion?.driverSlug, "andrea-kimi-antonelli");
  assert.match(renderSlide(slide), /Чемпион мира 2026/);
  assert.doesNotMatch(renderSlide(slide), /100%/);
});

test("constructor and unconfirmed-season empty states remain unchanged", () => {
  const emptyText = "На Polymarket пока нет рынка Кубка конструкторов.";
  const html = renderSlide(buildSlide({ id: "constructors", emptyText }));
  assert.ok(html.includes(emptyText));
  assert.doesNotMatch(html, /Antonelli|Чемпион мира/);
  assert.match(renderSlide(buildSlide({}, 2027)), /пока нет рынка чемпионства/);
});
