export async function requireAiBudget(db, purpose) {
  if (!db) throw new Error("AI_BUDGET_UNAVAILABLE");
  const { data, error } = await db.rpc("get_ai_budget_guard", { p_purpose: purpose });
  if (error || !Array.isArray(data) || !data.some((budget) => budget.scope === "default") || data.some((budget) => typeof budget.allowed !== "boolean")) {
    throw new Error("AI_BUDGET_UNAVAILABLE");
  }
  if (data.some((budget) => !budget.allowed)) throw new Error("AI_BUDGET_EXCEEDED");
}
