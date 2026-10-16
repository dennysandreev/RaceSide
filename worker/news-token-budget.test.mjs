import assert from "node:assert/strict";
import test from "node:test";
import { createNewsTokenBudget } from "./news-token-budget.mjs";

const body = { messages: [{ role: "user", content: "Публичная новость F1" }], max_completion_tokens: 1000 };

test("paid usage replaces the reservation and every received response is charged", () => {
  const budget = createNewsTokenBudget();
  const charge = budget.reserve(body);
  assert.ok(budget.spent > 1000);
  charge({ prompt_tokens: 500, completion_tokens: 700 });
  assert.equal(budget.spent, 1200);
  const second = budget.reserve(body);
  second({ prompt_tokens: 800, completion_tokens: 900 });
  assert.equal(budget.spent, 2900);
  assert.throws(() => budget.reserve(body), { code: "news_token_budget_exceeded" });
});

test("large inputs cannot start a paid request and missing usage is not treated as free", () => {
  const budget = createNewsTokenBudget(2000);
  assert.throws(() => budget.reserve({ ...body, messages: [{ role: "user", content: "Данные ".repeat(5000) }] }), { code: "news_token_budget_exceeded" });
  assert.equal(budget.calls, 0);
  const charge = budget.reserve(body);
  const reserved = budget.spent;
  charge(undefined);
  assert.equal(budget.spent, reserved);
});

test("verification uses the remaining output allowance instead of stopping early", () => {
  const budget = createNewsTokenBudget(4000);
  const charge = budget.reserve({ ...body });
  charge({ prompt_tokens: 1200, completion_tokens: 1200 });
  const verification = { ...body, max_completion_tokens: 1800 };
  budget.reserve(verification);
  assert.ok(verification.max_completion_tokens >= 800);
  assert.ok(verification.max_completion_tokens < 1800);
  assert.equal(budget.spent, 4000);
  assert.equal(budget.calls, 2);
});

test("verification stops if too little room remains for a complete review", () => {
  const budget = createNewsTokenBudget(3000);
  const charge = budget.reserve({ ...body });
  charge({ prompt_tokens: 1200, completion_tokens: 1200 });
  const verification = { ...body, max_completion_tokens: 1800 };
  assert.throws(() => budget.reserve(verification), { code: "news_token_budget_exceeded" });
  assert.equal(verification.max_completion_tokens, 1800);
  assert.equal(budget.spent, 2400);
  assert.equal(budget.calls, 1);
});

test("the writing allowance is never shortened to fit an oversized first request", () => {
  const budget = createNewsTokenBudget(1400);
  const writing = { ...body, max_completion_tokens: 4800 };
  assert.throws(() => budget.reserve(writing), { code: "news_token_budget_exceeded" });
  assert.equal(writing.max_completion_tokens, 4800);
  assert.equal(budget.calls, 0);
});

test("a complete long Russian article can be verified after observed composing usage", () => {
  const budget = createNewsTokenBudget();
  budget.reserve({ ...body })({ prompt_tokens: 7279, completion_tokens: 3043 });
  const content = "Mercedes investigates tyre degradation. ".repeat(515) + "Команды готовятся к гонке. ".repeat(140);
  const verification = { messages: [{ role: "user", content }], max_completion_tokens: 1800 };
  budget.reserve(verification);
  assert.ok(verification.max_completion_tokens >= 800);
  assert.equal(verification.messages[0].content, content);
  assert.ok(budget.spent <= 18_000);
});

test("transport JSON escaping does not consume the text input reservation", () => {
  const budget = createNewsTokenBudget(4600);
  const content = "\\n".repeat(6000);
  budget.reserve({ messages: [{ role: "user", content }], max_completion_tokens: 1000 });
  assert.ok(budget.spent <= 4600);
});
