import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateFeedback } from "./feedback.ts";

test("feedback delivery respects the production scheduler's two-minute minimum", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20261004134233_site_feedback.sql", import.meta.url), "utf8");
  assert.match(migration, /'support_feedback_delivery', 'support\.dispatch_feedback', 'interval', 2,/);
});

test("feedback trims the suggestion and accepts an optional reply contact", () => {
  assert.deepEqual(validateFeedback("  Хочу сравнивать результаты гонщиков  ", " @fan "), {
    ok: true, message: "Хочу сравнивать результаты гонщиков", contact: "@fan",
  });
  assert.equal(validateFeedback("Хочу больше статистики", "  ").contact, null);
});

test("feedback rejects missing, short and oversized messages", () => {
  for (const message of [null, {}, "         ", "коротко", "а".repeat(2_001)]) {
    const result = validateFeedback(message, "");
    assert.equal(result.ok, false);
    assert.equal(result.field, "message");
  }
  assert.equal(validateFeedback("а".repeat(10), "").ok, true);
  assert.equal(validateFeedback("а".repeat(2_000), "").ok, true);
});

test("feedback rejects multiline contacts and excessive contact length", () => {
  for (const contact of ["а".repeat(161), "@fan\nДругая строка", "email\u0000@test.ru"]) {
    const result = validateFeedback("Хочу больше статистики", contact);
    assert.equal(result.ok, false);
    assert.equal(result.field, "contact");
  }
});
