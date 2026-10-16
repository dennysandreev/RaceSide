import assert from "node:assert/strict";
import test from "node:test";

import {
  clearWorkerAiPromptCache,
  getWorkerAiPromptDefinition,
  resolveWorkerAiPrompt,
} from "./ai-prompt-registry.mjs";

test("worker renders the default prompt and always appends the protected contract", async () => {
  clearWorkerAiPromptCache();
  const definition = getWorkerAiPromptDefinition("news.highlights");
  const prompt = await resolveWorkerAiPrompt({
    client: makeClient({ data: null, error: { message: "migration pending" } }),
    promptKey: definition.key,
    variables: {
      summary: "Короткий лид",
      details: "Подробный текст",
    },
  });

  assert.equal(prompt.source, "default");
  assert.equal(prompt.promptVersionId, null);
  assert.equal(prompt.model, definition.modelFallback);
  assert.equal(prompt.maxTokens, definition.maxTokens);
  assert.match(prompt.userPrompt, /Короткий лид/);
  assert.match(prompt.userPrompt, /Подробный текст/);
  assert.match(prompt.systemPrompt, /Верни только JSON/);
});

test("worker uses a valid published version and exposes its id for usage accounting", async () => {
  clearWorkerAiPromptCache();
  const definition = getWorkerAiPromptDefinition("reports.summary");
  const prompt = await resolveWorkerAiPrompt({
    client: makeClient({
      data: {
        id: "72a8c840-1bd7-4f0d-b04d-7ed516c240df",
        prompt_key: definition.key,
        version: 4,
        status: "published",
        system_prompt: "Подготовь очень короткий и спокойный итог только по фактам.",
        user_template: "Факты этапа:\n{{facts_json}}",
        model: "openai/gpt-4.1-mini",
        max_tokens: 640,
      },
      error: null,
    }),
    promptKey: definition.key,
    variables: {
      facts_json: "{\"winner\":\"Пилот\"}",
    },
  });

  assert.equal(prompt.source, "published");
  assert.equal(prompt.promptVersion, 4);
  assert.equal(
    prompt.promptVersionId,
    "72a8c840-1bd7-4f0d-b04d-7ed516c240df",
  );
  assert.match(prompt.userPrompt, /Пилот/);
  assert.match(prompt.systemPrompt, /Верни только готовый текст/);
  assert.equal(prompt.model, "openai/gpt-6-luna");
  assert.equal(prompt.maxTokens, definition.maxTokens);
});

test("worker falls back when a published template loses a required variable", async () => {
  clearWorkerAiPromptCache();
  const definition = getWorkerAiPromptDefinition("news.daily_digest");
  const prompt = await resolveWorkerAiPrompt({
    client: makeClient({
      data: {
        id: "3460c3e6-8363-4476-bb92-03138cb26940",
        prompt_key: definition.key,
        version: 2,
        status: "published",
        system_prompt: "Собери спокойную дневную сводку по переданным материалам.",
        user_template: "Шаблон без обязательной переменной",
      },
      error: null,
    }),
    promptKey: definition.key,
    variables: {
      articles_text: "Новость дня",
    },
  });

  assert.equal(prompt.source, "default");
  assert.equal(prompt.promptVersionId, null);
  assert.match(prompt.userPrompt, /Новость дня/);
});

test("social editorial prompt requires JSON score ranges", async () => {
  clearWorkerAiPromptCache();
  const definition = getWorkerAiPromptDefinition("social.editorial");
  const prompt = await resolveWorkerAiPrompt({
    client: makeClient({ data: null, error: null }),
    promptKey: definition.key,
    variables: {
      categories: "social-technical",
      teams: "Ferrari",
      drivers: "Charles Leclerc",
      races: "Гран-при Италии",
      source: "@F1TelemetryData",
      author: "@F1TelemetryData",
      title: "Telemetry update",
      body: "Details",
    },
  });

  assert.match(prompt.systemPrompt, /importance - целое JSON-число от 0 до 100/);
  assert.match(prompt.systemPrompt, /relevance и confidence - JSON-числа от 0 до 1 включительно/);
});

function makeClient(result) {
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return this;
    },
    async maybeSingle() {
      return result;
    },
  };

  return {
    from() {
      return query;
    },
  };
}
