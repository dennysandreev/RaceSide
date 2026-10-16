import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adminAiPromptCatalog,
  makeAdminAiPromptChecksum,
  validateAdminAiPromptCatalog,
  validateAdminAiPromptContent,
  validateAdminAiRuntime,
} from "./admin-ai-prompts.ts";

test("AI prompt catalog covers every declared task and validates its templates", () => {
  const validation = validateAdminAiPromptCatalog();

  assert.equal(validation.ok, true);
  assert.equal(adminAiPromptCatalog.length, 10);
  assert.ok(adminAiPromptCatalog.every(item => item.modelFallback === "openai/gpt-6-luna"));
  assert.ok(adminAiPromptCatalog.some(item => item.key === "news.compose"));
  assert.ok(!adminAiPromptCatalog.some(item => item.key === "news.extract" || item.key === "news.article"));
  assert.deepEqual(
    [...new Set(adminAiPromptCatalog.map((definition) => definition.key))].length,
    adminAiPromptCatalog.length,
  );
});

test("admin cannot publish a retired model or exceed the task answer limit", () => {
  assert.equal(validateAdminAiRuntime("google/gemini-2.5-flash", 1000).ok, false);
  assert.equal(validateAdminAiRuntime("openai/gpt-6-luna", 1000, [], 900).ok, false);
  assert.equal(validateAdminAiRuntime("openai/gpt-6-luna", 900, [], 900).ok, true);
});

test("AI prompt validation keeps the exact runtime variables", () => {
  const definition = adminAiPromptCatalog.find(
    (item) => item.key === "news.highlights",
  );
  assert.ok(definition);

  const missing = validateAdminAiPromptContent(
    definition,
    definition.defaultSystemPrompt,
    "Лид: {{summary}}",
  );
  assert.equal(missing.ok, false);
  assert.match(missing.fieldErrors.userTemplate[0], /\{\{details\}\}/);

  const unexpected = validateAdminAiPromptContent(
    definition,
    definition.defaultSystemPrompt,
    `${definition.defaultUserTemplate}\n{{secret}}`,
  );
  assert.equal(unexpected.ok, false);
  assert.match(unexpected.fieldErrors.userTemplate[0], /\{\{secret\}\}/);

  const systemVariable = validateAdminAiPromptContent(
    definition,
    `${definition.defaultSystemPrompt} {{summary}}`,
    definition.defaultUserTemplate,
  );
  assert.equal(systemVariable.ok, false);
  assert.match(systemVariable.fieldErrors.systemPrompt[0], /только в шаблоне/);
});

test("AI prompt checksum is stable and changes with content", () => {
  const source = {
    promptKey: "news.daily_digest",
    systemPrompt: "Системная инструкция достаточной длины",
    userTemplate: "{{articles_text}}",
    model: "google/gemini-2.5-flash-lite",
    maxTokens: 800,
  };

  assert.equal(
    makeAdminAiPromptChecksum(source),
    makeAdminAiPromptChecksum({ ...source }),
  );
  assert.notEqual(
    makeAdminAiPromptChecksum(source),
    makeAdminAiPromptChecksum({
      ...source,
      systemPrompt: `${source.systemPrompt}.`,
    }),
  );
  assert.notEqual(
    makeAdminAiPromptChecksum(source),
    makeAdminAiPromptChecksum({
      ...source,
      model: "openai/gpt-4.1-mini",
    }),
  );
  assert.notEqual(
    makeAdminAiPromptChecksum(source),
    makeAdminAiPromptChecksum({
      ...source,
      maxTokens: 1_200,
    }),
  );
});

test("production image includes the shared AI prompt catalog for the worker", () => {
  const dockerfile = readFileSync(
    new URL("../../Dockerfile", import.meta.url),
    "utf8",
  );

  assert.match(
    dockerfile,
    /COPY --from=builder \/app\/src\/config\/ai-prompts\.json \.\/src\/config\/ai-prompts\.json/,
  );
});
