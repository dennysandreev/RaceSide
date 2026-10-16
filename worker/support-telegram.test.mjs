import assert from "node:assert/strict";
import test from "node:test";

import { sendSupportTelegramMessage } from "./support-telegram.mjs";

test("support delivery resolves a confirmed Telegram account when getUpdates is empty", async (context) => {
  const requestedTables = [];
  const client = {
    from(table) {
      requestedTables.push(table);
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        ilike() {
          return query;
        },
        limit() {
          return query;
        },
        async maybeSingle() {
          return {
            data: { chat_id: 123456789, is_active: true, username: "dennnysandreev" },
            error: null,
          };
        },
      };
      return query;
    },
  };
  const telegramRequests = [];
  context.mock.method(globalThis, "fetch", async (url, init) => {
    telegramRequests.push({ init, url: String(url) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  });

  const result = await sendSupportTelegramMessage({ text: "Проверка" }, {
    botToken: "test-token",
    client,
    username: "@dennnysandreev",
  });

  assert.deepEqual(result, { ok: true, status: "sent" });
  assert.deepEqual(requestedTables, ["telegram_accounts"]);
  assert.equal(telegramRequests.length, 1);
  assert.match(telegramRequests[0].url, /\/sendMessage$/);
  assert.equal(JSON.parse(telegramRequests[0].init.body).chat_id, "123456789");
});

test("feedback can disable HTML parsing for literal user messages", async (context) => {
  context.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.text, "<идея> & пожелание");
    assert.equal(body.parse_mode, undefined);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  assert.equal((await sendSupportTelegramMessage({ text: "<идея> & пожелание", parseMode: null }, {
    botToken: "test-token", chatId: "123456789",
  })).ok, true);
});
