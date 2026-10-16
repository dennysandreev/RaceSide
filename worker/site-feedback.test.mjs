import assert from "node:assert/strict";
import test from "node:test";

import { dispatchSiteFeedback, formatSiteFeedbackMessage } from "./site-feedback.mjs";

const report = {
  id: "62f020c1-01b2-4222-89f5-9165dbf50d13",
  message: "Добавьте сравнение результатов",
  contact: "@fan",
  telegram_attempts: 1,
  telegram_last_attempt_at: "2026-10-04T10:00:00.000Z",
};

function makeClient(reports = [report], updateError = null) {
  const updates = [];
  const client = {
    async rpc(name) {
      assert.equal(name, "claim_site_feedback_delivery");
      return { data: reports, error: null };
    },
    from(table) {
      assert.equal(table, "user_error_reports");
      return {
        update(values) {
          const entry = { values, conditions: [] };
          updates.push(entry);
          const query = {
            eq(column, value) { entry.conditions.push([column, value]); return query; },
            then(resolve) { return Promise.resolve({ error: updateError }).then(resolve); },
          };
          return query;
        },
      };
    },
  };
  return { client, updates };
}

test("feedback delivers full literal text and an admin link then records success", async () => {
  const { client, updates } = makeClient([{ ...report, message: "<b>Не HTML</b> & текст\nНовая строка" }]);
  const result = await dispatchSiteFeedback(client, {
    async send(input) {
      assert.equal(input.parseMode, null);
      assert.ok(input.text.includes("<b>Не HTML</b> & текст\nНовая строка"));
      assert.match(input.replyMarkup.inline_keyboard[0][0].url, /\/admin\/issues#message-/);
      return { ok: true, status: "sent" };
    },
  });
  assert.deepEqual(result, { itemsProcessed: 1, sent: 1, failed: 0 });
  assert.equal(updates[0].values.telegram_status, "sent");
  assert.equal(updates[0].values.telegram_error, null);
  assert.ok(updates[0].values.telegram_sent_at);
  assert.deepEqual(updates[0].conditions, [["id", report.id], ["telegram_last_attempt_at", report.telegram_last_attempt_at]]);
});

test("maximum feedback and contact lengths fit one Telegram message without truncation", () => {
  const text = formatSiteFeedbackMessage({ ...report, message: ">".repeat(2_000), contact: "а".repeat(160) });
  assert.ok(text.length < 4_096);
  assert.ok(text.includes(">".repeat(2_000)));
  assert.match(formatSiteFeedbackMessage({ ...report, contact: null }), /Контакт: не оставлен/);
});

test("network failures are sanitized and leave feedback available for retry", async () => {
  const { client, updates } = makeClient();
  const result = await dispatchSiteFeedback(client, { send() { throw new Error("secret-bot-token"); } });
  assert.equal(result.failed, 1);
  assert.equal(updates[0].values.telegram_status, "failed");
  assert.equal(updates[0].values.telegram_error, "telegram_unavailable");
  assert.equal(updates[0].values.telegram_sent_at, null);
  assert.ok(new Date(updates[0].values.telegram_retry_at).getTime() > Date.now());
});

test("missing destination is recorded and retried after configuration", async () => {
  const { client, updates } = makeClient();
  await dispatchSiteFeedback(client, { send: async () => ({ ok: false, status: "not_configured", reason: "support_chat_not_found" }) });
  assert.equal(updates[0].values.telegram_status, "not_configured");
  assert.ok(new Date(updates[0].values.telegram_retry_at).getTime() >= Date.now() + 59 * 60_000);
});

test("an empty claimed queue does not send anything", async () => {
  const { client } = makeClient([]);
  assert.deepEqual(await dispatchSiteFeedback(client, { send() { assert.fail("Nothing should be sent"); } }), {
    itemsProcessed: 0, sent: 0, failed: 0,
  });
});

test("database failures are surfaced so the existing worker job can retry", async () => {
  const { client } = makeClient([report], new Error("database unavailable"));
  await assert.rejects(() => dispatchSiteFeedback(client, { send: async () => ({ ok: true, status: "sent" }) }), /database unavailable/);
});
