import assert from "node:assert/strict";
import test from "node:test";
import { newsResponseFormat, newsRequestOptions } from "./news-response-format.mjs";

test("strict schemas require every property, including nullable compose fields", () => {
  function inspect(schema) {
    if (schema.enum) assert.ok(schema.enum.every(value => typeof value === "string"));
    if (schema.properties) {
      assert.deepEqual(schema.required, Object.keys(schema.properties));
      assert.equal(schema.additionalProperties, false);
      Object.values(schema.properties).forEach(inspect);
    }
    if (schema.items) inspect(schema.items);
    if (schema.anyOf) schema.anyOf.forEach(inspect);
  }
  for (const key of ["news.compose", "news.verify", "news.dedup"]) {
    const format = newsResponseFormat(key);
    assert.equal(format.type, "json_schema");
    inspect(format.json_schema.schema);
  }
});

test("verification uses concrete issues and indexed paragraphs instead of audit IDs or scores", () => {
  const fields = newsResponseFormat("news.verify").json_schema.schema.properties;
  assert.equal(fields.policy_version.const, 3);
  assert.ok(fields.blocking_issues.items.required.includes("reason"));
  assert.equal(fields.scores, undefined);
  assert.equal(fields.edits, undefined);
  assert.deepEqual(fields.decision.enum, ["PASS", "REJECT", "MANUAL_REVIEW"]);
  assert.ok(Object.keys(fields).indexOf("decision") > Object.keys(fields).indexOf("corrections"));
  const composition = newsResponseFormat("news.compose").json_schema.schema.properties;
  assert.equal(composition.extraction.anyOf[0].properties.facts, undefined);
  assert.equal(composition.draft.anyOf[0].properties.used_fact_ids, undefined);
  assert.equal(composition.draft.anyOf[0].properties.context_claims, undefined);
  assert.equal(newsRequestOptions().reasoning.effort, "none");
  assert.equal(newsRequestOptions().provider.require_parameters, true);
});
