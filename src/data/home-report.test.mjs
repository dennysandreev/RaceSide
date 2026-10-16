import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile("page.tsx",
  readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = source.statements.find((node) =>
  ts.isFunctionDeclaration(node) && node.name?.text === "HomeReportDialog");
assert.ok(fn);
const { outputText } = ts.transpileModule(fn.getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
});

async function renderDialog(slug, report) {
  const analytics = { drivers: [], championship: { drivers: [], teams: [] } };
  const calls = [];
  const bindings = {
    React: { createElement: (_component, props) => props },
    GrandPrixReportDialog: () => null,
    getGrandPrixReportBySlug: async (value) => { calls.push(["report", value]); return report; },
    getHomeDriverSlugs: async () => ({}),
    getGrandPrixReportAnalytics: async (value) => { calls.push(["analytics", value]); return analytics; },
  };
  const render = new Function(...Object.keys(bindings), `${outputText}\nreturn HomeReportDialog;`)(
    ...Object.values(bindings));
  return { props: await render({ slug }), calls, analytics };
}

test("home report passes stored analytics to the same dialog used by calendar", async () => {
  const report = { raceSlug: "2026-malaysian" };
  const result = await renderDialog(report.raceSlug, report);
  assert.equal(result.props.open, true);
  assert.equal(result.props.analytics, result.analytics);
  assert.deepEqual(result.calls, [["report", report.raceSlug], ["analytics", report]]);
});

test("normal home navigation does not load report analytics", async () => {
  const result = await renderDialog(undefined, null);
  assert.equal(result.props, null);
  assert.deepEqual(result.calls, []);
});

test("missing or mismatched report does not load analytics", async () => {
  for (const report of [null, { raceSlug: "other-race" }]) {
    const result = await renderDialog("2026-malaysian", report);
    assert.equal(result.props.open, false);
    assert.equal(result.props.analytics, null);
    assert.deepEqual(result.calls, [["report", "2026-malaysian"]]);
  }
});
