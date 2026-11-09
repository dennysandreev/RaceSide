import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
const ast = ts.createSourceFile("index.mjs", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);

function loadFunction(name, globals) {
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `${name} must exist`);
  const context = vm.createContext({ exports: {}, ...globals });
  const code = ts.transpileModule(`${declaration.getText(ast)}\nexports.fn = ${name};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInContext(code, context);
  return context.exports.fn;
}

test("queue checks and non-Telegram jobs do not import the Telegram SDK at startup", () => {
  const imports = ast.statements.filter(ts.isImportDeclaration).map((node) => node.moduleSpecifier.text);
  assert.deepEqual(imports.filter((name) => name === "telegram" || name.startsWith("telegram/")), []);
});

test("Telegram credentials are checked before loading the SDK", async () => {
  const createClient = loadFunction("createTelegramClient", {
    process: { env: {} },
    require() { assert.fail("SDK loaded for an unconfigured client"); },
  });
  await assert.rejects(createClient(), /TELEGRAM_API_ID is missing or invalid/);
});

test("configured Telegram jobs load the SDK and retain the authorization check", async () => {
  const imported = [];
  const calls = [];
  class TelegramClient {
    constructor(session, apiId, apiHash, options) {
      assert.equal(session.value, "test-session");
      assert.equal(apiId, 123);
      assert.equal(apiHash, "test-hash");
      assert.equal(options.floodSleepThreshold, 0);
    }
    setLogLevel(level) { calls.push(level); }
    async connect() { calls.push("connect"); }
    async checkAuthorization() { calls.push("authorization"); return true; }
  }
  const createClient = loadFunction("createTelegramClient", {
    process: { env: { TELEGRAM_API_ID: "123", TELEGRAM_API_HASH: "test-hash", TELEGRAM_SESSION: "test-session" } },
    require(name) {
      imported.push(name);
      if (name === "telegram") return { TelegramClient };
      if (name === "telegram/sessions/index.js") return { StringSession: class { constructor(value) { this.value = value; } } };
      assert.fail(`Unexpected module: ${name}`);
    },
    createTelegramSourceError: (error) => error,
  });
  assert.ok(await createClient() instanceof TelegramClient);
  assert.deepEqual(imported, ["telegram", "telegram/sessions/index.js"]);
  assert.deepEqual(calls, ["none", "connect", "authorization"]);
});

test("numeric Telegram sources still resolve peer IDs lazily", async () => {
  const imported = [];
  const entity = { id: 12345 };
  const resolve = loadFunction("resolveTelegramEntity", {
    require(name) {
      imported.push(name);
      assert.equal(name, "telegram/Utils.js");
      return { getPeerId: () => "-10012345" };
    },
    createTelegramSourceError: (error) => error,
  });
  assert.equal(await resolve({ async getDialogs() { return [{ entity }]; } }, { external_key: "-10012345" }), entity);
  assert.deepEqual(imported, ["telegram/Utils.js"]);
});

test("username lookup does not load peer-ID utilities", async () => {
  const resolve = loadFunction("resolveTelegramEntity", {
    require() { assert.fail("SDK utility loaded for a username lookup"); },
    createTelegramSourceError: (error) => error,
  });
  assert.equal(await resolve({ async getEntity(name) { return name; } }, { external_key: "@raceside_news" }), "raceside_news");
});
