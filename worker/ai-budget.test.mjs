import assert from "node:assert/strict";
import test from "node:test";
import { requireAiBudget } from "./ai-budget.mjs";
test("all paid workers use the same budget RPC and fail closed", async () => {
  const calls = [];
  const db = { rpc: async (...args) => { calls.push(args); return { data: [{ scope: "default", allowed: true }] }; } };
  await requireAiBudget(db, "radio.translation");
  assert.deepEqual(calls, [["get_ai_budget_guard", { p_purpose: "radio.translation" }]]);
  await assert.rejects(requireAiBudget({ rpc: async () => ({ error: new Error("offline") }) }, "news"), /AI_BUDGET_UNAVAILABLE/);
  await assert.rejects(requireAiBudget({ rpc: async () => ({ data: [] }) }, "news"), /AI_BUDGET_UNAVAILABLE/);
  await assert.rejects(requireAiBudget({ rpc: async () => ({ data: [{ scope: "default", allowed: false }] }) }, "radio.translation"), /AI_BUDGET_EXCEEDED/);
});
