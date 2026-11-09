import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const { outputText } = ts.transpileModule(
  readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
);

function loadConfig(env) {
  const exports = {};
  const require = (name) => {
    if (name === "@sentry/nextjs") return { withSentryConfig: (config) => config };
    if (name === "./sentry-scrub.mjs") return { resolveSentryRelease: () => undefined };
    throw new Error(`Unexpected config dependency: ${name}`);
  };
  new Function("exports", "require", "process", outputText)(exports, require, { env });
  return exports.default;
}

test("production WebSocket rewrites reach the Docker LIVE service even without build env", async () => {
  const rewrites = await loadConfig({ NODE_ENV: "production" }).rewrites();
  assert.equal(rewrites.find((rewrite) => rewrite.source === "/ws/live")?.destination, "http://live:3002/ws/live");
});

test("development WebSocket rewrites retain the local LIVE process", async () => {
  const rewrites = await loadConfig({ NODE_ENV: "development" }).rewrites();
  assert.equal(rewrites.find((rewrite) => rewrite.source === "/ws/live")?.destination, "http://127.0.0.1:3002/ws/live");
});

test("an explicit LIVE origin overrides the default at build time", async () => {
  const rewrites = await loadConfig({ NODE_ENV: "production", LIVE_INTERNAL_ORIGIN: "http://custom-live:4002" }).rewrites();
  assert.equal(rewrites.find((rewrite) => rewrite.source === "/ws/live")?.destination, "http://custom-live:4002/ws/live");
});
