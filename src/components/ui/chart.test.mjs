import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const context = vm.createContext({
  exports: {},
  require: (name) => name === "@/lib/utils"
    ? { cn: (...classes) => classes.filter(Boolean).join(" ") }
    : require(name),
});
vm.runInContext(ts.transpileModule(
  readFileSync(new URL("./chart.tsx", import.meta.url), "utf8"),
  { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  } },
).outputText, context);
const { ChartContainer, ChartTooltipContent } = context.exports;

function tooltip(value, props = {}) {
  return renderToStaticMarkup(React.createElement(ChartContainer, {
    config: { driver3: { label: "Max Verstappen" } },
  }, React.createElement(ChartTooltipContent, {
    active: true,
    label: 0,
    payload: [{ dataKey: "driver3", name: "driver3", value }],
    ...props,
  })));
}

test("race positions and lap labels use their supplied formatters", () => {
  const html = tooltip(1, {
    labelFormatter: (lap) => `Круг ${lap}`,
    formatter: (position) => `P${position}`,
  });
  assert.match(html, /Круг 0/);
  assert.match(html, /P1/);
  assert.doesNotMatch(html, /\$/);
});

test("race gaps keep zero seconds and never acquire currency", () => {
  const html = tooltip(0, { formatter: (value) => `${value} с` });
  assert.match(html, /0 с/);
  assert.doesNotMatch(html, /\$/);
});

test("existing cost charts retain their default USD display", () => {
  assert.match(tooltip(0.125), /\$0\.1250/);
});
