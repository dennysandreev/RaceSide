import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDailyDigestBody } from "./daily-digest-content.ts";

test("existing digests display without Подробнее links or raw Markdown", () => {
  const stored = "- **Алонсо остаётся в Aston Martin** Подтвердил контракт. [Подробнее](https://raceside.online/news/alonso-2027)\n\n- **Итоги Williams** Пилоты набрали очки. [Подробнее](https://raceside.online/news/williams-baku)";
  assert.equal(normalizeDailyDigestBody(stored), "• Алонсо остаётся в Aston Martin Подтвердил контракт.\n\n• Итоги Williams Пилоты набрали очки.");
});

test("new plain-text digests remain unchanged", () => {
  const body = "• События дня\nКороткое описание без ссылки.";
  assert.equal(normalizeDailyDigestBody(body), body);
});

test("bare URLs are removed from saved summaries", () => {
  assert.equal(normalizeDailyDigestBody("• Новость\nДетали: https://raceside.online/news/example"), "• Новость\nДетали:");
});
