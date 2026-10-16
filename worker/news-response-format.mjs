import { NEWS_ARTICLE_TYPES } from "./news-editorial.mjs";
import { textAiRequestOptions } from "./ai-prompt-registry.mjs";

const string = { type: "string" };
const nullableString = { type: ["string", "null"] };
const array = items => ({ type: "array", items });
const object = properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const score = { type: "number", minimum: 0, maximum: 1 };
const schemas = {
  "news.dedup": object({
    is_duplicate: { type: "boolean" }, duplicate_of: nullableString,
    relation: { type: "string", enum: ["duplicate", "update", "official_confirmation", "decision", "result", "analysis", "reaction", "related", "unrelated"] },
    confidence: score, reason: string, update_of: nullableString, merge_recommended: { type: "boolean" },
  }),
};

schemas["news.compose"] = object({
  decision: { type: "string", enum: ["ARTICLE", "DUPLICATE", "REJECT"] },
  duplicate_of: nullableString, duplicate_confidence: score, reason: string,
  extraction: { anyOf: [object({
    article_type: { type: "string", enum: NEWS_ARTICLE_TYPES }, source_authors: array(string), source_author_aliases: array(string),
    event_type: string, event_stage: nullableString, event_date: nullableString,
    entities: array(object({ type: string, name: string, role: { type: "string", enum: ["primary", "secondary", "mention"] } })),
  }), { type: "null" }] },
  draft: { anyOf: [object({
    title_ru: string, summary_ru: string, details_ru: string, highlight_phrases_ru: array(string),
    race_round: { type: ["integer", "null"] },
  }), { type: "null" }] },
});

schemas["news.verify"] = object({
  policy_version: { type: "integer", const: 3 },
  blocking_issues: array(object({ excerpt: string, reason: string })),
  corrections: object({
    title_ru: nullableString, summary_ru: nullableString,
    paragraphs: { type: "array", maxItems: 16, items: object({ index: { type: "integer", minimum: 0 }, text: string }) },
  }),
  checked_claims: { type: "boolean" },
  decision: { type: "string", enum: ["PASS", "REJECT", "MANUAL_REVIEW"] },
});

export function newsResponseFormat(key) {
  return schemas[key] ? { type: "json_schema", json_schema: { name: key.replaceAll(".", "_"), strict: true, schema: schemas[key] } } : { type: "json_object" };
}

export function newsRequestOptions(key) {
  return { ...textAiRequestOptions(),
    reasoning: { effort: ["news.compose", "news.verify"].includes(key) ? "low" : "none", exclude: true },
    provider: { require_parameters: true },
  };
}
