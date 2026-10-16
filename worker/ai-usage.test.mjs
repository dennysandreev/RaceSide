import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildOpenRouterUsageLog } from "./ai-usage.mjs";

test("OpenRouter usage keeps native token counts and the charged cost", () => {
  assert.deepEqual(
    buildOpenRouterUsageLog(
      {
        model: "google/gemini-2.5-flash-lite",
        usage: {
          prompt_tokens: 1_250,
          completion_tokens: 340,
          cost: 0.004321,
        },
      },
      {
        model: "fallback/model",
        purpose: "news.summary",
        relatedArticleId: "53ffb865-23b7-4bad-8b95-08844949896a",
      },
    ),
    {
      estimated_cost_usd: 0.004321,
      input_tokens: 1_250,
      model: "google/gemini-2.5-flash-lite",
      output_tokens: 340,
      provider: "openrouter",
      prompt_key: null,
      prompt_version_id: null,
      purpose: "news.summary",
      related_article_id: "53ffb865-23b7-4bad-8b95-08844949896a",
      related_digest_id: null,
    },
  );
});

test("OpenRouter usage records every received response even when usage is absent", () => {
  assert.deepEqual(
    buildOpenRouterUsageLog(
      { error: { message: "Provider returned invalid output" } },
      { model: "openai/gpt-4.1-mini", purpose: "news.metadata" },
    ),
    {
      estimated_cost_usd: null,
      input_tokens: null,
      model: "openai/gpt-4.1-mini",
      output_tokens: null,
      provider: "openrouter",
      prompt_key: null,
      prompt_version_id: null,
      purpose: "news.metadata",
      related_article_id: null,
      related_digest_id: null,
    },
  );
});

test("worker routes every OpenRouter completion through one accounting boundary", () => {
  const source = readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
  const endpointOccurrences = source.match(
    /https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/g,
  ) ?? [];

  assert.equal(endpointOccurrences.length, 1);
  assert.match(source, /async function requestOpenRouterCompletion/);
  assert.match(source, /await recordOpenRouterUsage/);
  assert.match(source, /signal: AbortSignal\.timeout\(getOpenRouterTimeoutMs\(\)\)/);
  assert.match(source, /function getOpenRouterTimeoutMs\(\)/);
  assert.doesNotMatch(source, /\bmax_tokens\s*:/);
  const calls = [...source.matchAll(/requestOpenRouterCompletion\(\{([\s\S]*?)\n\s*\}\);/g)]
    .slice(1)
    .map((match) => match[1]);
  // News requests prepare a body before reserving their per-article token budget.
  assert.ok(calls.length >= 6);
  for (const call of calls) {
    assert.match(call, /model: prompt\.model/);
    assert.ok(/max_completion_tokens: prompt\.maxTokens/.test(call) || /body, onUsage/.test(call));
  }
  assert.match(source, /tokenBudget\?\.reserve\(body\)/);
  assert.match(source, /body: JSON\.stringify\(\{ \.\.\.textAiRequestOptions\(\), \.\.\.parameters, model \}\)/);
});
