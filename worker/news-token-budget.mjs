// Below the observed 20,969-token mean of the previous pipeline. Actual provider
// usage is charged after every call; estimates reserve room before the next one.
export const NEWS_TOKEN_BUDGET = 18_000;
const MIN_REVIEW_OUTPUT = 800;

export function createNewsTokenBudget(limit = NEWS_TOKEN_BUDGET) {
  let spent = 0;
  let calls = 0;
  return {
    get spent() { return spent; },
    get calls() { return calls; },
    reserve(body) {
      // Tokens belong to message content, not the HTTP JSON that escapes it.
      const input = body.messages.map(message => typeof message.content === "string"
        ? message.content : JSON.stringify(message.content)).join("\n") + JSON.stringify(body.response_format ?? {});
      const unicode = [...input].filter(character => character.charCodeAt(0) > 127).length;
      const cyrillic = (input.match(/[а-яё]/gi) ?? []).length;
      // Calibrated for typical Luna/Russian news, with framing padding.
      // Keep a larger allowance for other Unicode; actual usage is still charged.
      const estimatedInput = Math.ceil((input.length - unicode) / 4 + cyrillic / 3 + (unicode - cyrillic) / 2) + 400;
      // Keep the full writing allowance. The second request is verification and
      // can use a smaller output cap without shortening the generated article.
      const output = calls === 1
        ? Math.min(body.max_completion_tokens, Math.floor(limit - spent - estimatedInput))
        : body.max_completion_tokens;
      const reserved = estimatedInput + output;
      if (calls >= 2 || output < Math.min(body.max_completion_tokens, MIN_REVIEW_OUTPUT) || spent + reserved > limit) {
        const error = new Error("Лимит обработки этой новости достигнут.");
        error.code = "news_token_budget_exceeded";
        throw error;
      }
      body.max_completion_tokens = output;
      calls += 1;
      spent += reserved;
      return usage => {
        const actual = Number(usage?.prompt_tokens) + Number(usage?.completion_tokens);
        if (Number.isFinite(actual) && actual > 0) spent += actual - reserved;
      };
    },
  };
}
