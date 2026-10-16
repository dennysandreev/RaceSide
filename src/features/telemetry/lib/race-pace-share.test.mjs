import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { compoundColors, selectedCompounds, paceSeries, paceShareCompounds, paceValue, parsePaceLapRange, paceLapRange, paceDistribution, paceDistributionDomain } from "./race-pace.ts";

const source = readFileSync(new URL("../../../app/api/share-image/race-pace/[session]/route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function api({ user = { id: "user" }, full = true, ready = true, limited = false } = {}) {
  const calls = [], exports = {};
  let rendered;
  const data = { session: { id: 1, season: 2026, meetingId: 7 }, totalLaps: 55, drivers: Array.from({ length: 8 }, (_, i) => ({ number: i+1 })) };
  const require = (name) => {
    if (name === "react") return { createElement: (_, props) => props };
    if (name === "next/og") return { ImageResponse: class { constructor(props, options) { rendered = { props, options }; return new Response("PNG", { status: 200 }); } } };
    if (name.endsWith("/auth")) return { getSessionUser: async () => user };
    if (name.endsWith("billing/access")) return { getSubscriptionAccess: async () => ({ entitlements: { telemetry_full: full } }) };
    if (name.endsWith("billing/config")) return { billingFlags: { entitlementsEnforced: true } };
    if (name.endsWith("demo-access")) return { getTelemetryDemoScope: async () => ({ sessions: [{ id: 1 }] }) };
    if (name.endsWith("/flags")) return { telemetryFlags: { telemetryHub: true, telemetryShare: true } };
    if (name.endsWith("rate-limit")) return { consumeIpRateLimit: async () => ({ ok: !limited, resetAt: 100 }), getRetryAfterSeconds: () => "60" };
    if (name.endsWith("prediction-share-fonts")) return { getPredictionShareFonts: async () => [] };
    if (name.endsWith("/server")) return { presentRacePace: (data) => data, resultKey: (input) => JSON.stringify(input), telemetryStore: () => ({ get: async (key) => { calls.push(key); return key.startsWith("meetings:") ? [] : ready ? data : null; } }) };
    if (name.endsWith("/race-pace")) return { selectedCompounds, parsePaceLapRange, paceLapRange };
    if (name.endsWith("/share-image")) return { shareFormats: { horizontal: [1600,900], vertical: [1080,1920] }, shareImageScale: 2 };
    return {};
  };
  vm.runInNewContext(code, { exports, require, Response, URL, Number, Set, Promise });
  return { calls, rendered: () => rendered, get: (query, session = "1") => exports.GET(new Request(`http://localhost/api/share-image/race-pace/${session}?${query}`), { params: Promise.resolve({ session }) }) };
}
test("race pace PNG requires sign-in and limits free accounts to the demo session", async () => {
  const guest = api({ user: null });
  assert.equal((await guest.get("drivers=1")).status, 401);
  assert.deepEqual(guest.calls, []);
  const free = api({ full: false });
  assert.equal((await free.get("drivers=1", "2")).status, 403);
  assert.deepEqual(free.calls, []);
  assert.equal((await free.get("drivers=1")).status, 200);
  assert.ok(free.calls.length > 0);
});
test("distribution export preserves filters and allows all drivers without a selected subset", async () => {
  const handler = api();
  assert.equal((await handler.get("view=distribution&scope=field&from=8&to=20&safety=0&compounds=HARD")).status,200);
  assert.equal(handler.rendered().props.view.section,"distribution");
  assert.equal(handler.rendered().props.view.distributionScope,"field");
  assert.deepEqual(Array.from(handler.rendered().props.view.drivers),[]);
  assert.deepEqual(Array.from(handler.rendered().props.view.lapRange),[8,20]);
  assert.equal(handler.rendered().props.view.hideSafetyCar,false);
  assert.equal((await api().get("view=distribution&scope=selected")).status,400);
  assert.equal((await api({user:null}).get("view=distribution&scope=field")).status,401);
  assert.equal((await api({full:false}).get("view=distribution&scope=field","2")).status,403);
});
test("invalid session, format, empty drivers and unavailable pace have explicit responses", async () => {
  assert.equal((await api().get("drivers=1", "NaN")).status, 400);
  assert.equal((await api().get("drivers=1&format=__proto__")).status, 400);
  assert.equal((await api().get("drivers=999")).status, 400);
  assert.equal((await api({ ready: false }).get("drivers=1")).status, 409);
  assert.equal((await api({ limited: true }).get("drivers=1")).status, 429);
});
test("PNG uses cached timing, validated drivers, multiple tyres and current display settings", async () => {
  const handler = api();
  const response = await handler.get("drivers=1,1,2,3,4,5,6,7,999&compounds=HARD,WET,INVALID,__proto__,toString&axis=age&safety=0&trend=0&field=1&format=vertical");
  assert.equal(response.status, 200);
  const { props, options } = handler.rendered();
  assert.deepEqual(Array.from(props.view.drivers), [1,2,3,4,5,6]);
  assert.deepEqual(Array.from(props.view.compounds), ["HARD","WET"]);
  assert.equal(props.view.axis, "age");
  assert.equal(props.view.hideSafetyCar, false);
  assert.equal(props.view.trend, false);
  assert.equal(props.view.field, true);
  assert.equal(options.width, 2160); assert.equal(options.height, 3840);
  assert.equal(options.headers["Cache-Control"], "private, no-store");
  assert.deepEqual(handler.calls, ['{"kind":"race-pace","session":1}', "meetings:2026"]);
});
test("horizontal export matches lap PNG dimensions and preserves all-off tyre selection", async () => {
  const handler = api();
  assert.equal((await handler.get("drivers=1&compounds=")).status, 200);
  assert.deepEqual(Array.from(handler.rendered().props.view.compounds), []);
  assert.equal(handler.rendered().options.width, 3200);
  assert.equal(handler.rendered().options.height, 1800);
});
test("PNG preserves the selected race segment, clamps its endpoints and ignores invalid input", async () => {
  for (const [query, expected] of [["from=10&to=30", [10,30]], ["from=30&to=99", [30,55]], ["from=NaN&to=30", [1,55]], ["from=12&to=12", [12,12]]]) {
    const handler = api();
    assert.equal((await handler.get(`drivers=1&${query}`)).status, 200);
    assert.deepEqual(Array.from(handler.rendered().props.view.lapRange), expected);
  }
});
test("vector font contains race-axis labels and lap-time punctuation", () => {
  const font = JSON.parse(readFileSync(new URL("./share-chart-font.json", import.meta.url), "utf8"));
  for (const letter of "Круг гонкиВозраст шин, кругов1:42.0S M H I W ?ВСЕСреднееМедианаРазброс") assert.ok(font.glyphs[letter], letter);
});

test("PNG omits unselected tyre stints without shifting their race-lap positions", () => {
  const source = readFileSync(new URL("./race-pace-share-image.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  const require = (name) => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "./race-pace") return { compoundColors, selectedCompounds, paceSeries, paceShareCompounds, paceValue, paceLapRange };
    if (name === "./format") return { lapTime: (time) => String(time), teamColor: () => "#00d7b6" };
    if (name === "./share-image") return { shareFormats: { horizontal: [1600,900] }, renderAtExportScale: (root) => root, chartText: () => "", ShareFooter: () => null };
    if (name.endsWith("race-display")) return { formatGrandPrixNameRu: (name) => name };
    return { RaceSideShareLogo: () => null };
  };
  vm.runInNewContext(code, { exports, require, Buffer });
  const data = { session: { season: 2026, country: "China", circuit: "Shanghai" }, totalLaps: 10,
    drivers: [{ number: 4, code: "NOR", name: "Lando Norris" }], points: [],
    stints: [{ driver: 4, compound: "MEDIUM", from: 1, to: 2 }, { driver: 4, compound: "HARD", from: 3, to: 10 }] };
  const bars = (compounds) => {
    const root = exports.RacePaceShareImage({ data, format: "horizontal", view: { axis: "lap", compounds, drivers: [4], hideSafetyCar: true, trend: true, field: false } });
    const result = [];
    const visit = (node) => {
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (!node?.props) return;
      if (node.props.style?.position === "absolute" && node.props.style?.left) result.push(node.props.style);
      visit(node.props.children);
    };
    visit(root); return result;
  };
  assert.equal(bars(selectedCompounds("ALL")).length, 2);
  const hard = bars(["HARD"]);
  assert.equal(hard.length, 1);
  assert.equal(hard[0].left, "20%"); assert.equal(hard[0].width, "80%");
  assert.equal(hard[0].background, compoundColors.HARD);
  assert.equal(hard[0].opacity, undefined);
  assert.deepEqual(bars(["WET"]), []);
});

test("PNG chart contains only laps within the selection on both axes and supports one lap", () => {
  const source = readFileSync(new URL("./race-pace-share-image.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  const require = (name) => {
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "./race-pace") return { paceSeries, paceValue, paceLapRange };
    if (name === "./format") return { lapTime: (time) => String(time), teamColor: () => "#00d7b6" };
    if (name === "./share-image") return { chartText: (label) => `<text>${label}</text>` };
    return {};
  };
  vm.runInNewContext(code, { exports, require, Buffer });
  const data = { totalLaps: 6, drivers: [{number:4}],
    points: [2,3,4,5,6].map(lap => ({driver:4,lap,tyreAge:lap+10,time:80+lap,stint:1,compound:"HARD",clean:true,reasons:[],trend:null})) };
  const graphic = (axis, lapRange) => Buffer.from(exports.racePaceGraphic(data,
    {axis,lapRange,compounds:["HARD"],drivers:[4],hideSafetyCar:true,trend:true,field:false}, 800,400).split(",")[1], "base64").toString();
  for (const axis of ["age","lap"]) {
    const svg = graphic(axis, [3,5]);
    assert.equal((svg.match(/<circle /g) ?? []).length, 3);
    assert.ok(!/NaN|Infinity/.test(svg));
    if (axis === "lap") assert.ok(svg.includes("<text>3</text>") && svg.includes("<text>5</text>") && !svg.includes("<text>6</text>"));
    const single = graphic(axis, [4,4]);
    assert.equal((single.match(/<circle /g) ?? []).length, 1);
    assert.ok(!/NaN|Infinity/.test(single));
  }
});

test("distribution PNG uses the same quartiles, outliers and summary values as the screen", () => {
  const source=readFileSync(new URL("./race-pace-share-image.tsx",import.meta.url),"utf8");
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};
  const require=name=>name==="react/jsx-runtime"?jsxRuntime:name==="./race-pace"?{paceDistribution,paceDistributionDomain}:
    name==="./format"?{lapTime:value=>String(value),teamColor:()=>"#00d7b6"}:
    name==="./share-image"?{chartText:label=>`<text>${label}</text>`,chartTextWidth:label=>label.length}:{};
  vm.runInNewContext(code,{exports,require,Buffer});
  const data={totalLaps:9,drivers:[{number:4,code:"NOR"}],points:[80,81,82,83,84,85,86,110].map((time,i)=>({driver:4,lap:i+2,time,tyreAge:null,compound:"HARD",stint:1,clean:true,reasons:[],trend:null}))};
  const rows=paceDistribution(data,"ALL",{hidePits:true,hideSafetyCar:true});
  const graphic=(rows)=>Buffer.from(exports.racePaceDistributionGraphic(rows,1000,500).split(",")[1],"base64").toString();
  const svg=graphic(rows);
  assert.equal((svg.match(/<rect /g)??[]).length,1);
  assert.equal((svg.match(/<circle /g)??[]).length,1);
  assert.ok(svg.includes("<text>86.38</text>")&&svg.includes("<text>83.50</text>")&&svg.includes("<text>9.12</text>")&&svg.includes("<text>8</text>"));
  assert.ok(!/NaN|Infinity/.test(svg));
  assert.ok(!/NaN|Infinity/.test(graphic(paceDistribution(data,"ALL",{hidePits:true,hideSafetyCar:true,lapRange:[3,3]}))));
  assert.ok(!/NaN|Infinity/.test(graphic([])));
});
