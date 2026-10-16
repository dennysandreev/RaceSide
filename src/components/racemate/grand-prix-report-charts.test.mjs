import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
import * as helpers from "../../lib/grand-prix-report.ts";

function load(file, extra = {}) {
  let cursor = 0;
  const states = [], effects = [];
  const stub = new Proxy({}, { get: () => () => null });
  const context = vm.createContext({
    exports: {}, ...extra.globals,
    require: (name) => ({
      "react/jsx-runtime": jsx,
      react: {
        useState: (initial) => {
          const slot = cursor++;
          if (!(slot in states)) states[slot] = typeof initial === "function" ? initial() : initial;
          return [states[slot], (value) => { states[slot] = typeof value === "function" ? value(states[slot]) : value; }];
        },
        useMemo: (fn) => fn(), useCallback: (fn) => fn, useRef: () => ({ current: null }),
        useEffect: (fn) => effects.push(fn),
      },
      "@/lib/grand-prix-report": helpers,
      "@/data/f1-assets": { getTeamAsset: () => null },
      "@/lib/race-display": { formatGrandPrixNameRu: (name) => name },
      "@/lib/utils": { cn: (...names) => names.filter(Boolean).join(" ") },
      ...extra.modules,
    })[name] ?? stub,
  });
  vm.runInContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return {
    render: (name, props) => { cursor = 0; effects.length = 0; return context.exports[name](props); },
    effects,
  };
}

function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return tree?.props ? [tree, ...elements(tree.props.children)] : [];
}
const drivers = [1, 2, 3, 4].map((number) => ({
  number, driver: `Driver ${number}`, team: "Team", code: `D${number}`,
  positions: [{ lap: 1, value: number }], gaps: [{ lap: 1, value: number - 1 }],
  pace: [{ lap: 1, value: 100 }], tyres: [],
}));

for (const mode of ["positions", "pace"]) test(`${mode}: late timing selects the first pilots and preserves later user choices`, () => {
  const component = load("./grand-prix-report-charts.tsx");
  const render = (available) => component.render("ReportTimingCharts", { mode, analytics: { drivers: available, totalLaps: 1 } });
  const selected = (tree) => elements(tree).filter((node) => node.type?.name === "TimingChart").map((node) => Array.from(node.props.drivers, (driver) => driver.number));
  const empty = render([]);
  assert.ok(selected(empty).every((numbers) => numbers.length === 0));
  let tree = render(drivers);
  assert.ok(selected(tree).every((numbers) => JSON.stringify(numbers) === "[1,2,3]"));
  for (const number of [1, 2, 3]) {
    elements(tree).find((node) => node.type === "button" && node.props.children[1] === String(number)).props.onClick();
    tree = render(drivers);
  }
  assert.ok(selected(tree).every((numbers) => numbers.length === 0), "an explicit empty selection must remain empty");
  assert.ok(selected(render([...drivers])).every((numbers) => numbers.length === 0));
});

test("pending report refreshes only while open and visible and cleans up its timer", () => {
  let refreshes = 0, hidden = false, timer;
  const listeners = new Map();
  const router = { refresh: () => refreshes++, replace: () => {} };
  const component = load("./grand-prix-report-dialog.tsx", {
    modules: { "next/navigation": { useRouter: () => router } },
    globals: {
      window: {
        setInterval: (fn, ms) => { assert.equal(ms, 30_000); timer = fn; return 1; },
        clearInterval: (id) => { assert.equal(id, 1); timer = null; },
      },
      document: {
        get hidden() { return hidden; },
        addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: (name, fn) => { assert.equal(listeners.get(name), fn); listeners.delete(name); },
      },
    },
  });
  component.render("GrandPrixReportDialog", { open: true, report: null, analytics: { timingPending: true } });
  const cleanup = component.effects[0]();
  timer(); assert.equal(refreshes, 1);
  hidden = true; timer(); assert.equal(refreshes, 1);
  hidden = false; listeners.get("visibilitychange")(); assert.equal(refreshes, 2);
  cleanup(); assert.equal(timer, null); assert.equal(listeners.size, 0);
  for (const props of [{ open: false, analytics: { timingPending: true } }, { open: true, analytics: { timingPending: false } }]) {
    component.render("GrandPrixReportDialog", { ...props, report: null });
    assert.equal(component.effects[0](), undefined);
    assert.equal(timer, null);
  }
});
