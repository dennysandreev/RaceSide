import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source=readFileSync(new URL("../../../app/api/share-image/session-metrics/[session]/route.ts",import.meta.url),"utf8");
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function api({user={id:"user"},full=true,ready=true,limited=false}={}) {
  const exports={},calls=[];let rendered;
  const data={session:{id:1,season:2026,meetingId:7},laps:[]};
  const require=name=>{
    if(name==="react")return {createElement:(_,props)=>props};
    if(name==="next/og")return {ImageResponse:class {constructor(props,options){rendered={props,options};return new Response("PNG");}}};
    if(name.endsWith("/auth"))return {getSessionUser:async()=>user};
    if(name.endsWith("billing/access"))return {getSubscriptionAccess:async()=>({entitlements:{telemetry_full:full}})};
    if(name.endsWith("billing/config"))return {billingFlags:{entitlementsEnforced:true}};
    if(name.endsWith("demo-access"))return {getTelemetryDemoScope:async()=>({sessions:[{id:1}]})};
    if(name.endsWith("/flags"))return {telemetryFlags:{telemetryHub:true,telemetryShare:true}};
    if(name.endsWith("rate-limit"))return {consumeIpRateLimit:async()=>({ok:!limited,resetAt:100}),getRetryAfterSeconds:()=>"60"};
    if(name.endsWith("prediction-share-fonts"))return {getPredictionShareFonts:async()=>[]};
    if(name.endsWith("/server"))return {resultKey:JSON.stringify,telemetryStore:()=>({get:async key=>{calls.push(key);return key.startsWith("meetings:")?[]:ready?data:null;}})};
    if(name.endsWith("/share-image"))return {shareFormats:{horizontal:[1600,900],vertical:[1080,1920]},shareImageScale:2};
    return {};
  };
  vm.runInNewContext(code,{exports,require,Response,URL,Number,Promise});
  return {calls,rendered:()=>rendered,get:(query="",session="1")=>exports.GET(new Request(`http://localhost/api/share-image/session-metrics/${session}?${query}`),{params:Promise.resolve({session})})};
}
test("metric images enforce sign-in, demo scope, rate limit and cached data",async()=>{
  for(const [options,session,status] of [[{user:null},"1",401],[{full:false},"2",403],[{limited:true},"1",429],[{ready:false},"1",409]]){
    assert.equal((await api(options).get("",session)).status,status);
  }
  assert.equal((await api({full:false}).get()).status,200);
  assert.equal((await api().get("format=invalid")).status,400);
  assert.equal((await api().get("","0")).status,400);
});
test("each PNG loads the metric cache and preserves metric and orientation",async()=>{
  for(const metric of ["speed","throttle","map"]){
    const handler=api();const response=await handler.get(`metric=${metric}&format=vertical`);
    assert.equal(response.status,200);
    assert.equal(handler.rendered().props.metric,metric);
    assert.equal(handler.rendered().options.width,2160);
    assert.equal(handler.rendered().options.height,3840);
    assert.deepEqual(handler.calls,['{"kind":"session-metrics","session":1}',"meetings:2026"]);
  }
});
