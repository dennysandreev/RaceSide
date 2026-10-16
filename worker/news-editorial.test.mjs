import assert from "node:assert/strict";
import test from "node:test";
import { NEWS_PIPELINE_VERSION, runNewsEditorialPipeline, checkNewsDraft, verificationPasses, applyNewsReviewCorrections, newsDraftParagraphs, buildDigestInput, renderVerifiedDigest, isUsableRussianNewsPayload, canRetryNewsSystemHold } from "./news-editorial.mjs";
import { parseNewsEditorialMetadata } from "./news-deduplication.mjs";

const source = { title: "Hamilton at Ferrari", text: "Lewis Hamilton drives for Ferrari. The gap is a quarter of a second. He joined in 2025.", url: "https://example.com/f1", name: "The Race", authors: ["Gary Anderson"] };
const context = { current_date: "2026-10-05", season: 2026, facts: [{ id: "driver:ham:team", kind: "driver_team", subject: "Lewis Hamilton", value: "Ferrari", scope: "current", as_of: "2026-10-05" }], races: [{ round: 16 }], teams: [] };
const draft = () => ({ title_ru: "Хэмилтон продолжает выступать за Ferrari", summary_ru: "Льюис Хэмилтон продолжает выступать за Ferrari после перехода в команду.", details_ru: "Пилот присоединился к команде в 2025 году. Отрыв составляет четверть секунды; впереди работа над настройками машины.", highlight_phrases_ru: ["четверть секунды"], race_round: 16 });
const metadata = () => ({ article_type: "news", source_authors: ["Gary Anderson"], source_author_aliases: ["Гэри Андерсон"], main_fact: "Хэмилтон выступает за Ferrari", event_type: "driver_transfer", event_stage: "announcement", event_date: null, entities: [{ type: "driver", name: "Lewis Hamilton", role: "primary" }] });
const composed = (article = draft(), extraction = metadata()) => ({ decision: "ARTICLE", duplicate_of: null, duplicate_confidence: 0, extraction, draft: article });
const pass = () => ({ policy_version: 3, blocking_issues: [], corrections: { title_ru: null, summary_ru: null, paragraphs: [] }, checked_claims: true, decision: "PASS" });
const run = (writer = composed(), review = pass()) => runNewsEditorialPipeline({ source, context, request: async key => key === "news.compose" ? writer : review });

test("the simplified article flow uses the complete original and two requests", async () => {
  const calls = [];
  const result = await runNewsEditorialPipeline({ source, context, request: async (key, payload) => {
    calls.push(key); assert.equal(payload.source.text, source.text);
    if (key === "news.compose") return composed();
    assert.deepEqual(payload.draft.paragraphs, newsDraftParagraphs(draft()));
    assert.equal(payload.context.facts[0].value, "Ferrari");
    assert.equal(payload.context.facts[0].as_of, "2026-10-05");
    assert.equal(payload.context.facts[0].id, undefined);
    return pass();
  } });
  assert.equal(NEWS_PIPELINE_VERSION, 3);
  assert.equal(result.decision, "PASS");
  assert.deepEqual(calls, ["news.compose", "news.verify"]);
  assert.ok(parseNewsEditorialMetadata(result.extraction));
  assert.deepEqual(result.context, context);
  assert.deepEqual(result.attempts[0].draft, result.draft);
});

test("audit IDs, source quote formatting and numeric units do not override a semantic pass", async () => {
  const article = { ...draft(), context_claims: [{ id: "bad-id", value: "Ferrari" }], used_fact_ids: ["missing-id"], details_ru: "Пилот присоединился к команде в 2025 году. Отрыв составляет 250 миллисекунд, что соответствует четверти секунды." };
  const result = await run(composed(article, { ...metadata(), facts: [{ evidence: "A malformed audit quotation." }] }));
  assert.equal(result.decision, "PASS");
  assert.deepEqual(result.draft.context_claims, []);
});

test("a real unsupported claim still prevents publication after local checks are simplified", async () => {
  const review = { ...pass(), decision: "MANUAL_REVIEW", blocking_issues: [{ excerpt: "FIA отменила гонку", reason: "Отмена гонки не подтверждается оригиналом." }] };
  const result = await run(composed({ ...draft(), details_ru: draft().details_ru + " FIA отменила гонку." }), review);
  assert.equal(result.decision, "MANUAL_REVIEW");
  assert.ok(result.issues.includes("Отмена гонки не подтверждается оригиналом."));
});

test("missing or malformed routing metadata gets a usable topic fallback", async () => {
  for (const value of [null, {}, { entities: [null], event_type: null }, { ...metadata(), event_type: "!!!", event_stage: "???", main_fact: "" }]) {
    const result = await run(composed(draft(), value));
    assert.equal(result.decision, "PASS");
    assert.ok(parseNewsEditorialMetadata(result.extraction));
    assert.equal(result.extraction.main_fact, draft().title_ru);
  }
});

test("primary participant roles survive normalization for driver and team tags", async () => {
  const result = await run();
  assert.equal(result.extraction.entities[0].role, "primary");
});

test("candidates and digests receive the corrected verified headline as their main fact", async () => {
  const result = await run(composed(draft(), { ...metadata(), main_fact: "FIA отменила гонку." }),
    { ...pass(), corrections: { title_ru: "Хэмилтон продолжает работу в Ferrari", summary_ru: null, paragraphs: [] } });
  assert.equal(result.decision, "PASS");
  assert.equal(result.extraction.main_fact, result.draft.title_ru);
  assert.equal(buildDigestInput([{ id: "article", main_fact: result.extraction.main_fact }])[0].articles[0].main_fact, result.draft.title_ru);
});

test("recovery retries system holds once and protects manual edits and factual holds", () => {
  const generated = draft();
  const article = { publication_status: "draft", published_manually: false, editorial_meta: { algorithm_version: 2 },
    ai_processed_at: "2026-10-05T12:00:00Z", updated_at: "2026-10-05T12:00:01Z",
    ai_title_ru: generated.title_ru, ai_summary_ru: generated.summary_ru, ai_summary_long_ru: generated.details_ru };
  const review = { issues: ["invalid_review_edits"], attempts: [{ draft: generated, review: { decision: "PASS" } }] };
  assert.equal(canRetryNewsSystemHold(article, review), true);
  for (const patch of [{ editorial_meta: { algorithm_version: 3 } }, { published_manually: true },
    { publication_status: "published" }, { ai_summary_long_ru: "Правка редактора" }, { updated_at: "2026-10-05T12:01:00Z" }]) {
    assert.equal(canRetryNewsSystemHold({ ...article, ...patch }, review), false);
  }
  assert.equal(canRetryNewsSystemHold(article, { ...review, issues: ["Неподтверждённое обвинение в мошенничестве."] }), false);
  assert.equal(canRetryNewsSystemHold(article, { ...review, attempts: [{ draft: generated, review: { decision: "MANUAL_REVIEW" } }] }), false);
  assert.equal(canRetryNewsSystemHold(article, { issues: ["news_token_budget_exceeded"], attempts: [{ draft: generated, review: null }] }), true);
});

test("unknown race tags are removed without blocking supported prose", async () => {
  const result = await run(composed({ ...draft(), race_round: 100, team_slugs: ["unknown"] }));
  assert.equal(result.decision, "PASS");
  assert.equal(result.draft.race_round, null);
});

test("a confirmed duplicate from another outlet takes one request", async () => {
  const calls = [];
  const result = await runNewsEditorialPipeline({ source, context, candidates: [{ id: "published" }], request: async key => {
    calls.push(key); return { decision: "DUPLICATE", duplicate_of: "published", duplicate_confidence: 0.98, extraction: null, draft: null };
  } });
  assert.equal(result.decision, "DUPLICATE");
  assert.equal(result.duplicate.duplicateOf, "published");
  assert.deepEqual(calls, ["news.compose"]);
});

test("invented or uncertain duplicate targets cannot suppress news", async () => {
  for (const [duplicate_of, duplicate_confidence] of [["invented", 1], ["published", 0.89]]) {
    const result = await runNewsEditorialPipeline({ source, context, candidates: [{ id: "published" }], request: async () => ({ decision: "DUPLICATE", duplicate_of, duplicate_confidence }) });
    assert.equal(result.decision, "MANUAL_REVIEW"); assert.equal(result.duplicate, undefined);
  }
});

test("paragraph corrections support long replacements, deletions and repeated phrases", async () => {
  const first = "Отрыв составляет 146 очков. ".repeat(13);
  const second = "Отрыв составляет 146 очков. Это важная подробность второго абзаца, которую нужно сохранить.";
  const article = { ...draft(), details_ru: first + "\n\n" + second };
  const replacement = first.replaceAll("146", "145");
  const review = { ...pass(), corrections: { title_ru: null, summary_ru: null, paragraphs: [{ index: 0, text: replacement }, { index: 1, text: second.replace("146", "145") }] } };
  const result = await run(composed(article), review);
  assert.equal(result.decision, "PASS");
  assert.equal(newsDraftParagraphs(result.draft)[0], replacement.trim());
  assert.ok(result.draft.details_ru.includes("важная подробность второго абзаца"));
  assert.equal(result.attempts[0].original_draft.details_ru, article.details_ru);
  assert.equal(applyNewsReviewCorrections(article, { ...pass(), corrections: { title_ru: null, summary_ru: null, paragraphs: [{ index: 0, text: "" }] } }).details_ru, second);
});

test("corrections never select an invented paragraph or apply conflicting edits", async () => {
  for (const paragraphs of [[{ index: 3, text: "Новая подробность" }], [{ index: -1, text: "Новая подробность" }], [{ index: 0, text: "a" }, { index: 0, text: "b" }], [null]]) {
    const review = { ...pass(), corrections: { title_ru: null, summary_ru: null, paragraphs } };
    assert.equal(applyNewsReviewCorrections(draft(), review), null);
    assert.equal((await run(composed(), review)).decision, "MANUAL_REVIEW");
  }
});

test("writer and verifier cannot publish source-author narration", async () => {
  const article = { ...draft(), summary_ru: "Гэри Андерсон считает, что Хэмилтон продолжает выступать за Ferrari." };
  assert.ok(checkNewsDraft(article, metadata(), source).includes("source_meta_narration"));
  assert.equal((await run(composed(article))).decision, "MANUAL_REVIEW");
  const review = { ...pass(), corrections: { title_ru: null, summary_ru: draft().summary_ru, paragraphs: [] } };
  assert.equal((await run(composed(article), review)).decision, "PASS");
  for (const phrase of ["Авторы The Race предлагают пересмотреть правила.", "В подкасте The Race разбирают старт гонки.", "В доступном фрагменте не уточняются последствия."]) {
    assert.ok(checkNewsDraft({ ...draft(), details_ru: phrase }, metadata(), source).includes("source_meta_narration"));
  }
});

test("a byline surname is a whole name, not a substring in technical Russian words", () => {
  const byline = { ...metadata(), source_author_aliases: ["Эдд Стро", "Джон Ноубл"] };
  const prose = { ...draft(), details_ru: "Команды установили настройки энергоменеджмента. Строительство объекта продолжается." };
  assert.ok(!checkNewsDraft(prose, byline, source).includes("source_meta_narration"));
  assert.ok(checkNewsDraft({ ...prose, details_ru: "Эдд Стро предложил изменить настройки." }, byline, source).includes("source_meta_narration"));
});

test("regulatory articles and physical power sources are not publication narration", () => {
  const prose = { ...draft(), details_ru: "В статье B1.8.1 регламента сказано, что пилот должен управлять машиной самостоятельно. В источнике питания выявили неисправность." };
  assert.ok(!checkNewsDraft(prose, metadata(), source).includes("source_meta_narration"));
});

test("conditional source framing is removed without changing its claim or adding a paid call", async () => {
  const article = { ...draft(), details_ru: "Льюису Хэмилтону помогла сильная гонка, хотя автор оценки считал, что Ferrari могла претендовать на лучший результат благодаря выбору промежуточных шин на старте." };
  const result = await run(composed(article));
  assert.equal(result.decision, "PASS");
  assert.equal(result.draft.details_ru, article.details_ru.replace("автор оценки считал, что ", ""));
  const corrected = await run(composed(), { ...pass(), corrections: { title_ru: null, summary_ru: null, paragraphs: [{ index: 0, text: article.details_ru }] } });
  assert.equal(corrected.decision, "PASS");
  const unsafe = await run(composed({ ...article, details_ru: article.details_ru.replace("Ferrari могла претендовать", "FIA официально утвердила") }));
  assert.equal(unsafe.decision, "MANUAL_REVIEW");
});

test("links and Markdown cannot survive a final factual pass", async () => {
  const result = await run(composed({ ...draft(), details_ru: draft().details_ru + " [Подробнее](https://example.com)" }));
  assert.equal(result.decision, "MANUAL_REVIEW"); assert.ok(result.issues.includes("reader_markup"));
});

test("a supported analysis or sensitive sporting report has no blanket genre hold", async () => {
  for (const article_type of ["analysis", "opinion", "legal", "technical_analysis"]) {
    const result = await run(composed(draft(), { ...metadata(), article_type, risk: "high" }));
    assert.equal(result.decision, "PASS");
  }
});

test("a bare PASS and legacy reviews cannot approve a new article", async () => {
  for (const review of [{ decision: "PASS" }, { ...pass(), checked_claims: false }, { ...pass(), policy_version: 2 }, { ...pass(), corrections: null }]) {
    assert.equal((await run(composed(), review)).decision, "MANUAL_REVIEW");
  }
});

test("an empty corrected headline is held without crashing metadata normalization", async () => {
  const result = await run(composed(), { ...pass(), corrections: { title_ru: "", summary_ru: null, paragraphs: [] } });
  assert.equal(result.decision, "MANUAL_REVIEW");
  assert.ok(result.issues.includes("incomplete_draft"));
});

test("digest verification must leave the checked text unchanged", () => {
  assert.equal(verificationPasses(pass()), true);
  const changed = { ...pass(), corrections: { title_ru: "Новый заголовок", summary_ru: null, paragraphs: [] } };
  assert.equal(verificationPasses(changed), false);
  assert.equal(verificationPasses(changed, { allowEdits: true }), true);
});

test("unusable text and irrelevant material do not incur a verification call", async () => {
  for (const writer of [composed({ ...draft(), details_ru: "" }), { decision: "REJECT", reason: "Реклама" }]) {
    const calls = []; const result = await runNewsEditorialPipeline({ source, context, request: async key => { calls.push(key); return writer; } });
    assert.notEqual(result.decision, "PASS"); assert.deepEqual(calls, ["news.compose"]);
  }
});

test("API failure or exhausted budget cannot become a pass or a paid repair loop", async () => {
  await assert.rejects(runNewsEditorialPipeline({ source, context, request: async () => { throw new Error("API unavailable"); } }), /API unavailable/);
  for (const code of ["news_token_budget_exceeded", "news_invalid_response"]) {
    const calls = []; const result = await runNewsEditorialPipeline({ source, context, request: async key => {
      calls.push(key); if (key === "news.compose") return composed(); throw Object.assign(new Error(code), { code });
    } });
    assert.equal(result.decision, "MANUAL_REVIEW"); assert.equal(result.draft.title_ru, draft().title_ru);
    assert.deepEqual(result.issues, [code]); assert.equal(calls.length, 2);
  }
});

test("Russian prose normalization preserves brand names and usable paragraphs", async () => {
  const article = { ...draft(), details_ru: "Льюис Хэмилтoн продолжает работу в Ferrari. Команда улучшает настройки.\\n\\nПодготовка продолжается, пилот изучает новые данные." };
  const result = await run(composed(article));
  assert.equal(result.decision, "PASS"); assert.ok(result.draft.details_ru.includes("Хэмилтон"));
  assert.equal(newsDraftParagraphs(result.draft).length, 2);
  assert.ok(isUsableRussianNewsPayload({ title: result.draft.title_ru, summary: result.draft.summary_ru, details: result.draft.details_ru }));
});

test("digest groups the same event but retains source references", () => {
  const result = buildDigestInput([{ id: "a", event_fingerprint: "same_event", ai_title_ru: "A", canonical_url: "https://one.test" }, { id: "b", event_fingerprint: "same_event", ai_title_ru: "B", canonical_url: "https://two.test" }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].articles.length, 2);
});

test("digest rejects invented references, numbers and repeated events", () => {
  const articles = [{ id: "a", slug: "one", event_fingerprint: "event", ai_title_ru: "Отрыв 145 очков", ai_summary_ru: "Отрыв 145 очков" }];
  const item = { headline: "Отрыв 145 очков", summary: "Отрыв 145 очков", article_ids: ["a"] };
  assert.equal(renderVerifiedDigest({ items: [item] }, articles), "• Отрыв 145 очков\nОтрыв 145 очков");
  assert.equal(renderVerifiedDigest({ items: [{ ...item, article_ids: ["fake"] }] }, articles), null);
  assert.equal(renderVerifiedDigest({ items: [{ ...item, summary: "Отрыв 146 очков" }] }, articles), null);
  assert.equal(renderVerifiedDigest({ items: [item, item] }, articles), null);
  assert.equal(renderVerifiedDigest({ items: [{ ...item, summary: "**Отрыв 145 очков** [Подробнее](https://raceside.online/news/one)" }] }, articles), "• Отрыв 145 очков\nОтрыв 145 очков");
  assert.equal(renderVerifiedDigest({ items: [{ ...item, summary: "[Подробнее](https://raceside.online/news/one)" }] }, articles), null);
});
