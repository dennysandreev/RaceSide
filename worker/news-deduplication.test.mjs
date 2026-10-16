import assert from "node:assert/strict";
import test from "node:test";

import {
  createNewsSourceContentHash,
  getNewsDedupConfig,
  isNewsFeedItemPublishable,
  isNewsDedupIdentityMatch,
  normalizeNewsSourceUrl,
  parseNewsDedupDecision,
  parseNewsEditorialMetadata,
  rankNewsDedupCandidates,
  resolveNewsDedupModel,
  runNewsDeduplicationPipeline,
} from "./news-deduplication.mjs";

const baseArticle = {
  id: "new-article",
  title: "Mercedes продлила контракт с Джорджем Расселлом",
  summary: "Команда объявила о новом соглашении с британским пилотом.",
  mainFact: "Mercedes официально продлила контракт с Джорджем Расселлом.",
  eventType: "driver_contract",
  eventStage: "official_confirmation",
  eventFingerprint: "mercedes_george_russell_contract_extension",
  normalizedEntities: [
    { type: "team", name: "Mercedes", normalized_name: "mercedes" },
    { type: "person", name: "George Russell", normalized_name: "george_russell" },
  ],
  ingestedAt: "2026-07-19T12:00:00.000Z",
};

test("broad articles retain distinct fingerprints when entity names fill the storage limit", () => {
  const entities = Array.from({ length: 12 }, (_, index) => ({ type: "driver", name: `A very long driver name ${index}` }));
  const metadata = { event_type: "race_analysis", event_stage: "post_race", entities };
  const first = parseNewsEditorialMetadata({ ...metadata, main_fact: "Отдельный разбор стратегии первого пилота." });
  const second = parseNewsEditorialMetadata({ ...metadata, main_fact: "Отдельный разбор стратегии другого пилота." });
  assert.equal(first.eventFingerprint.length, 240);
  assert.notEqual(first.eventFingerprint, second.eventFingerprint);
  assert.match(first.eventFingerprint, /_[a-f0-9]{12}$/);
});

test("classification keeps an opinion separate from an announcement with the same fingerprint", () => {
  assert.equal(isNewsDedupIdentityMatch({ ...baseArticle, articleType: "opinion" }, { ...baseArticle, articleType: "news" }), false);
});

test("Slater transfer synonyms do not override a correct duplicate decision", () => {
  const first = { eventType: "racing_driver_move", eventStage: "announced", eventFingerprint: "freddie_slater_f2_move_2027" };
  const second = { eventType: "driver_transfer", eventStage: "announcement", eventFingerprint: "freddie_slater_joins_invicta_f2_2027" };
  assert.equal(isNewsDedupIdentityMatch(first, second), true);
});

test("the same fingerprint cannot suppress a different stage or an independent analysis", () => {
  assert.equal(isNewsDedupIdentityMatch(baseArticle, { ...baseArticle, eventStage: "rumour" }), false);
  assert.equal(isNewsDedupIdentityMatch(baseArticle, { ...baseArticle, eventType: "technical_analysis" }), false);
});

test("retired environment models cannot override Luna for deduplication", () => {
  assert.equal(
    resolveNewsDedupModel({
      NEWS_DEDUP_AI_MODEL: "",
      AI_SUMMARY_MODEL: "google/gemini-2.5-flash-lite",
      OPENROUTER_MODEL: "openai/gpt-4.1-mini",
    }),
    "openai/gpt-6-luna",
  );
});

test("normalizeNewsSourceUrl removes tracking parameters and normalizes equivalent URLs", () => {
  assert.equal(
    normalizeNewsSourceUrl(
      "HTTPS://Example.com/news/story/?utm_source=rss&gclid=123&b=2&a=1#section",
    ),
    "https://example.com/news/story?a=1&b=2",
  );
  assert.equal(
    normalizeNewsSourceUrl("https://example.com/news/story/?fbclid=abc"),
    "https://example.com/news/story",
  );
});

test("createNewsSourceContentHash is stable across whitespace-only changes", () => {
  const first = createNewsSourceContentHash({
    title: "Antonelli takes pole",
    description: "Mercedes driver is fastest.",
    content: "Full race report",
  });
  const second = createNewsSourceContentHash({
    title: "  Antonelli   takes pole ",
    description: "Mercedes driver is fastest.\n",
    content: "Full   race report",
  });

  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("technical video draft feed items are rejected before ingestion", () => {
  assert.equal(
    isNewsFeedItemPublishable({
      title: "Video draft 42 | Formula 1",
      link: "https://www.racefans.net/2026/08/01/video-draft-42",
    }),
    false,
  );
  assert.equal(
    isNewsFeedItemPublishable({
      title: "Norris ends Red Bull's winning streak",
      link: "https://www.racefans.net/2026/08/01/norris-ends-red-bull-streak",
    }),
    true,
  );
});

test("promoted feed stories are rejected before paid editorial requests", () => {
  assert.equal(isNewsFeedItemPublishable({ title: "Unique items from Schumacher and Senna's careers auctioned", link: "https://www.the-race.com/promoted/unique-f1-items-auctioned" }), false);
});

test("parseNewsEditorialMetadata prepares normalized entities", () => {
  assert.deepEqual(
    parseNewsEditorialMetadata({
      main_fact: "Red Bull Racing прекратила сотрудничество с Кристианом Хорнером.",
      event_type: "team_management_change",
      event_stage: "official_confirmation",
      event_date: "2026-07-19",
      event_fingerprint: "red_bull_racing_christian_horner_management_departure",
      entities: [
        { type: "team", name: "Red Bull Racing", normalized_name: "red_bull_racing" },
        { type: "person", name: "Christian Horner", normalized_name: "christian_horner" },
      ],
    }),
    {
      mainFact: "Red Bull Racing прекратила сотрудничество с Кристианом Хорнером.",
      eventType: "team_management_change",
      eventStage: "official_confirmation",
      eventDate: "2026-07-19",
      eventFingerprint: "red_bull_racing_christian_horner_management_departure",
      normalizedEntities: [
        { type: "team", name: "Red Bull Racing", normalized_name: "red_bull_racing" },
        { type: "person", name: "Christian Horner", normalized_name: "christian_horner" },
      ],
    },
  );
});

test("human-readable entity keys are normalized without vetoing verified content", () => {
  const metadata = parseNewsEditorialMetadata({
    main_fact: "Пилоты могут высказываться откровенно.", event_type: "driver_comments", event_stage: "public_reaction",
    entities: [
      { type: "person", name: "Ландо Норрис", normalized_name: "Lando Norris" },
      { type: "person", name: "Франко Колапинто", normalized_name: "Franco-Colapinto" },
      { type: "person", name: "Нико Хюлькенберг", normalized_name: "Nico Hülkenberg" },
      { type: "reader", name: "@GongTong", normalized_name: "@GongTong" },
    ],
  });
  assert.ok(metadata);
  assert.deepEqual(metadata.normalizedEntities.map(entity => entity.normalized_name), ["lando_norris", "franco_colapinto", "nico_hulkenberg", "gongtong"]);
  assert.equal(parseNewsEditorialMetadata({ main_fact: "Новость", event_type: "news", event_stage: "announcement", entities: [{ name: "", normalized_name: "!!!" }] }), null);
});

test("Russian event labels and spaced English labels do not block a verified article", () => {
  const payload = { main_fact: "Леклер возглавил пятничные тренировки.", event_type: "practice_day_analysis", event_fingerprint: "malaysia_friday_practice", entities: [{ type: "race", name: "Гран-при Малайзии", normalized_name: "malaysian_grand_prix" }] };
  for (const [stage, key] of [
    ["пятничные тренировки", "пятничные_тренировки"],
    ["пятничные свободные тренировки", "пятничные_свободные_тренировки"],
    ["Friday practice", "friday_practice"],
  ]) {
    const parsed = parseNewsEditorialMetadata({ ...payload, event_stage: stage });
    assert.equal(parsed?.eventStage, key);
    assert.equal(parsed?.eventFingerprint, payload.event_fingerprint);
  }
  assert.equal(parseNewsEditorialMetadata({ ...payload, event_type: "Анализ тренировок", event_stage: "Практика" }).eventType, "анализ_тренировок");
  assert.equal(parseNewsEditorialMetadata({ ...payload, event_stage: "!!!" }), null);
  assert.equal(parseNewsEditorialMetadata({ ...payload, event_stage: "practice", entities: [] }), null);
});

test("rankNewsDedupCandidates keeps the same fact and rejects a new event stage", () => {
  const candidates = rankNewsDedupCandidates(baseArticle, [
    {
      id: "same-fact",
      title: "Расселл останется в Mercedes после подписания нового соглашения",
      summary: "Новое соглашение между командой и пилотом подтверждено.",
      mainFact: "Mercedes официально продлила соглашение с Джорджем Расселлом.",
      eventType: "driver_contract",
      eventStage: "official_confirmation",
      eventFingerprint: "mercedes_george_russell_contract_extension",
      normalizedEntities: baseArticle.normalizedEntities,
      ingestedAt: "2026-07-19T11:55:00.000Z",
      publishedAt: "2026-07-19T11:58:00.000Z",
      publicationStatus: "published",
    },
    {
      id: "older-rumor",
      title: "Mercedes готовит новый контракт Расселлу",
      summary: "СМИ пишут о переговорах.",
      mainFact: "Mercedes обсуждает новый контракт с Джорджем Расселлом.",
      eventType: "driver_contract",
      eventStage: "rumor",
      eventFingerprint: "mercedes_george_russell_contract_negotiation",
      normalizedEntities: baseArticle.normalizedEntities,
      ingestedAt: "2026-07-19T09:00:00.000Z",
      publishedAt: "2026-07-19T09:05:00.000Z",
      publicationStatus: "published",
    },
    {
      id: "outside-window",
      title: "Mercedes продлила контракт с Расселлом",
      mainFact: baseArticle.mainFact,
      eventType: baseArticle.eventType,
      eventStage: baseArticle.eventStage,
      eventFingerprint: baseArticle.eventFingerprint,
      normalizedEntities: baseArticle.normalizedEntities,
      ingestedAt: "2026-07-18T10:00:00.000Z",
      publishedAt: "2026-07-18T10:05:00.000Z",
      publicationStatus: "published",
    },
  ], { windowHours: 24, maxCandidates: 10 });

  assert.deepEqual(candidates.map((candidate) => candidate.id), ["same-fact", "older-rumor"]);
});

test("preflight finds cross-source originals before Russian metadata exists", () => {
  const article = {
    id: "incoming",
    original_title: "Alonso extends F1 career into 2027",
    original_description: "Aston Martin retains Fernando Alonso for another season.",
    ingested_at: "2026-10-02T12:00:00.000Z",
  };
  const candidates = rankNewsDedupCandidates(article, [{
    id: "published",
    original_title: "Aston Martin retains Alonso and Stroll for F1 2027",
    original_description: "Fernando Alonso will stay for another season.",
    event_type: "contract_signing",
    ingested_at: "2026-10-01T12:00:00.000Z",
    publication_status: "published",
  }], { preflight: true, windowHours: 168 });
  assert.deepEqual(candidates.map(candidate => candidate.id), ["published"]);
});

test("preflight retains archived driver matches but excludes unrelated old stories", () => {
  const article = { ...baseArticle, ingestedAt: "2026-10-02T12:00:00.000Z" };
  const older = {
    id: "archived-contract",
    title: baseArticle.title,
    normalizedEntities: baseArticle.normalizedEntities,
    ingestedAt: "2026-08-02T12:00:00.000Z",
    publicationStatus: "published",
  };
  const unrelated = { ...older, id: "unrelated", normalizedEntities: [] };
  const candidates = rankNewsDedupCandidates(article, [older, unrelated], {
    preflight: true, windowHours: 168,
  });
  assert.deepEqual(candidates.map(candidate => candidate.id), ["archived-contract"]);
  assert.deepEqual(rankNewsDedupCandidates(article, [older], { windowHours: 168 }), []);
});

test("parseNewsDedupDecision rejects a duplicate target outside the candidate set", () => {
  assert.equal(
    parseNewsDedupDecision(
      {
        is_duplicate: true,
        duplicate_of: "unknown-id",
        relation: "duplicate",
        confidence: 0.97,
        reason: "Одинаковый факт.",
      },
      new Set(["known-id"]),
    ),
    null,
  );
});

test("parseNewsDedupDecision accepts an unrelated response with an empty explanation", () => {
  assert.deepEqual(
    parseNewsDedupDecision(
      {
        is_duplicate: false,
        duplicate_of: null,
        relation: "unrelated",
        confidence: 0,
        reason: "",
      },
      new Set(["known-id"]),
    ),
    {
      isDuplicate: false,
      duplicateOf: null,
      relation: "unrelated",
      confidence: 0,
      reason: "Совпадений центрального факта не найдено.",
    },
  );
});

test("pipeline suppresses only high-confidence duplicate decisions", async () => {
  const saved = [];
  const result = await runNewsDeduplicationPipeline({
    article: baseArticle,
    config: getNewsDedupConfig({ NEWS_DEDUP_ENABLED: "true" }),
    acquireLock: async () => true,
    releaseLock: async () => {},
    loadCandidates: async () => [{ ...baseArticle, id: "first-article" }],
    classify: async () => ({
      isDuplicate: true,
      duplicateOf: "first-article",
      relation: "duplicate",
      confidence: 0.96,
      reason: "Обе новости сообщают об одном продлении контракта.",
    }),
    saveDecision: async (decision) => saved.push(decision),
  });

  assert.equal(result.publicationStatus, "duplicate");
  assert.equal(result.duplicateOf, "first-article");
  assert.equal(saved.length, 1);
});

test("pipeline publishes official confirmation of a rumor", async () => {
  const result = await runNewsDeduplicationPipeline({
    article: baseArticle,
    config: getNewsDedupConfig({ NEWS_DEDUP_ENABLED: "true" }),
    acquireLock: async () => true,
    releaseLock: async () => {},
    loadCandidates: async () => [{ ...baseArticle, id: "rumor" }],
    classify: async () => ({
      isDuplicate: false,
      duplicateOf: null,
      relation: "official_confirmation",
      confidence: 0.94,
      reason: "Официальное объявление переводит событие на новый этап.",
    }),
    saveDecision: async () => {},
  });

  assert.equal(result.publicationStatus, "published");
  assert.equal(result.dedupStatus, "unique");
  assert.equal(result.relation, "official_confirmation");
});

test("pipeline keeps a race result separate from a qualifying result", async () => {
  const result = await runNewsDeduplicationPipeline({
    article: {
      ...baseArticle,
      eventType: "race_result",
      eventStage: "result",
      eventFingerprint: "belgian_grand_prix_2026_race_result",
    },
    config: getNewsDedupConfig({ NEWS_DEDUP_ENABLED: "true" }),
    acquireLock: async () => true,
    releaseLock: async () => {},
    loadCandidates: async () => [{
      ...baseArticle,
      id: "qualifying-result",
      eventType: "qualifying_result",
      eventStage: "result",
      eventFingerprint: "belgian_grand_prix_2026_qualifying_result",
    }],
    classify: async () => ({
      isDuplicate: true,
      duplicateOf: "qualifying-result",
      relation: "duplicate",
      confidence: 0.96,
      reason: "Один этап и один пилот.",
    }),
    saveDecision: async () => {},
  });

  assert.equal(result.publicationStatus, "published");
  assert.equal(result.dedupStatus, "unique");
});

test("feature flag bypasses classifier and publishes the article", async () => {
  let classifierCalled = false;
  const result = await runNewsDeduplicationPipeline({
    article: baseArticle,
    config: getNewsDedupConfig({ NEWS_DEDUP_ENABLED: "false" }),
    acquireLock: async () => true,
    releaseLock: async () => {},
    loadCandidates: async () => [],
    classify: async () => {
      classifierCalled = true;
      return null;
    },
    saveDecision: async () => {},
  });

  assert.equal(classifierCalled, false);
  assert.equal(result.dedupStatus, "skipped");
  assert.equal(result.publicationStatus, "published");
});

test("fail mode publish keeps a unique material visible after classifier failure", async () => {
  const result = await runNewsDeduplicationPipeline({
    article: baseArticle,
    config: getNewsDedupConfig({
      NEWS_DEDUP_ENABLED: "true",
      NEWS_DEDUP_FAIL_MODE: "publish",
    }),
    acquireLock: async () => true,
    releaseLock: async () => {},
    loadCandidates: async () => [{ ...baseArticle, id: "candidate" }],
    classify: async () => {
      throw new Error("AI unavailable");
    },
    saveDecision: async () => {},
  });

  assert.equal(result.dedupStatus, "error");
  assert.equal(result.publicationStatus, "published");
});

test("classifier failure holds an article by default", async () => {
  const result = await runNewsDeduplicationPipeline({
    article: baseArticle,
    config: getNewsDedupConfig({ NEWS_DEDUP_ENABLED: "true" }),
    acquireLock: async () => true,
    releaseLock: async () => {},
    loadCandidates: async () => [{ ...baseArticle, id: "candidate" }],
    classify: async () => {
      throw new Error("AI unavailable");
    },
    saveDecision: async () => {},
  });

  assert.equal(result.dedupStatus, "error");
  assert.equal(result.publicationStatus, "processing_dedup");
});

test("lock contention keeps an article held even in publish fail mode", async () => {
  const result = await runNewsDeduplicationPipeline({
    article: baseArticle,
    config: getNewsDedupConfig({
      NEWS_DEDUP_ENABLED: "true",
      NEWS_DEDUP_FAIL_MODE: "publish",
    }),
    acquireLock: async () => false,
    releaseLock: async () => {},
    loadCandidates: async () => [],
    classify: async () => null,
    saveDecision: async () => {},
  });

  assert.equal(result.dedupStatus, "error");
  assert.equal(result.publicationStatus, "processing_dedup");
});

test("concurrent identical articles publish exactly one result", async () => {
  let locked = false;
  let published = null;
  const acquireLock = async () => {
    while (locked) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    locked = true;
    return true;
  };
  const releaseLock = async () => {
    locked = false;
  };
  const run = (article) => runNewsDeduplicationPipeline({
    article,
    config: getNewsDedupConfig({ NEWS_DEDUP_ENABLED: "true" }),
    acquireLock,
    releaseLock,
    loadCandidates: async () => published ? [{ ...baseArticle, id: published }] : [],
    classify: async (_article, candidates) => ({
      isDuplicate: true,
      duplicateOf: candidates[0].id,
      relation: "duplicate",
      confidence: 0.99,
      reason: "Одинаковый центральный факт.",
    }),
    saveDecision: async (decision) => {
      if (decision.publicationStatus === "published") {
        published = article.id;
      }
    },
  });

  const results = await Promise.all([
    run({ ...baseArticle, id: "first", ingestedAt: "2026-07-19T12:00:00.000Z" }),
    run({ ...baseArticle, id: "second", ingestedAt: "2026-07-19T12:00:01.000Z" }),
  ]);

  assert.equal(results.filter((result) => result.publicationStatus === "published").length, 1);
  assert.equal(results.filter((result) => result.publicationStatus === "duplicate").length, 1);
});
