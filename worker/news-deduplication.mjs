import { createHash } from "node:crypto";
import { TEXT_AI_MODEL } from "./ai-prompt-registry.mjs";

const TRACKING_QUERY_PARAMS = new Set([
  "fbclid",
  "gclid",
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_source",
  "utm_term",
]);

export const NEWS_DEDUP_RELATIONS = Object.freeze([
  "duplicate",
  "update",
  "official_confirmation",
  "decision",
  "result",
  "analysis",
  "reaction",
  "related",
  "unrelated",
]);

const RELATION_SET = new Set(NEWS_DEDUP_RELATIONS);
const EVENT_TYPE_ALIASES = {
  racing_driver_move: "driver_transfer", driver_move: "driver_transfer", driver_signing: "driver_transfer",
  driver_contract_renewal: "contract_extension", contract_renewal: "contract_extension",
  contract_signing: "contract_extension", driver_contract_extension: "contract_extension",
};
const EVENT_STAGE_ALIASES = { announced: "announcement", announcement_made: "announcement", rumored: "rumour", rumor: "rumour", confirmed: "official_confirmation" };
const eventTypeKey = value => EVENT_TYPE_ALIASES[normalizeEventKey(value)] ?? normalizeEventKey(value);
const eventStageKey = value => EVENT_STAGE_ALIASES[normalizeEventKey(value)] ?? normalizeEventKey(value);
const COMPARISON_STOP_WORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "the", "to", "with",
  "а", "без", "был", "была", "были", "в", "во", "для", "до", "и", "из", "к", "как", "на",
  "о", "об", "от", "по", "после", "при", "про", "с", "со", "у", "что", "это",
]);

export function getNewsDedupConfig(env = process.env) {
  return {
    enabled: parseBoolean(env.NEWS_DEDUP_ENABLED, true),
    windowHours: clampInteger(env.NEWS_DEDUP_WINDOW_HOURS, 168, 1, 168),
    maxCandidates: clampInteger(env.NEWS_DEDUP_MAX_CANDIDATES, 10, 1, 25),
    confidenceThreshold: clampNumber(env.NEWS_DEDUP_CONFIDENCE_THRESHOLD, 0.85, 0, 1),
    failMode: env.NEWS_DEDUP_FAIL_MODE === "publish" ? "publish" : "hold",
    aiRetryCount: clampInteger(env.NEWS_DEDUP_AI_RETRY_COUNT, 2, 0, 5),
  };
}

export function isNewsFeedItemPublishable(item) {
  const title = normalizeComparableText(item?.title);
  const sourceUrl = normalizeString(item?.link ?? item?.guid);
  let pathname = "";

  if (sourceUrl) {
    try {
      pathname = new URL(sourceUrl).pathname;
    } catch {
      pathname = sourceUrl;
    }
  }

  return !(
    /^video draft \d+(?: formula 1)?$/.test(title) ||
    /(?:^|\/)video-draft-\d+(?:\/|$)/i.test(pathname) ||
    /^(?:sponsored content|advertorial|paid partnership|paid post)\b/i.test(title) ||
    /(?:^|\/)(?:promoted|sponsored-content|partner-content|advertorial)(?:\/|$)/i.test(pathname)
  );
}

export function resolveNewsDedupModel() {
  return TEXT_AI_MODEL;
}

export function normalizeNewsSourceUrl(value) {
  const source = normalizeString(value);

  if (!source) {
    return null;
  }

  try {
    const url = new URL(source);
    url.hash = "";

    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_QUERY_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    url.searchParams.sort();

    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    return url.toString().replace(/\?$/, "");
  } catch {
    return source;
  }
}

export function createNewsSourceContentHash({ title, description, content }) {
  const normalized = [title, description, content]
    .map(normalizeContentBlock)
    .filter(Boolean)
    .join("\n");

  return normalized
    ? createHash("sha256").update(normalized).digest("hex")
    : null;
}

export function parseNewsEditorialMetadata(payload) {
  if (!isPlainObject(payload)) {
    return null;
  }

  const mainFact = normalizeString(payload.main_fact ?? payload.mainFact);
  const eventType = eventTypeKey(payload.event_type ?? payload.eventType);
  const eventStage = eventStageKey(payload.event_stage ?? payload.eventStage);
  const eventDate = normalizeEventDate(payload.event_date ?? payload.eventDate);
  const normalizedEntities = normalizeEntities(
    payload.entities ?? payload.normalized_entities ?? payload.normalizedEntities,
  );

  if (!mainFact || !eventType || !eventStage || !normalizedEntities.length) {
    return null;
  }

  const suppliedFingerprint = normalizeFingerprint(
    payload.event_fingerprint ?? payload.eventFingerprint,
  );
  const eventFingerprint = suppliedFingerprint ?? buildFallbackFingerprint({
    eventType,
    normalizedEntities,
    mainFact,
  });

  return {
    mainFact,
    eventType,
    eventStage,
    eventDate,
    eventFingerprint,
    normalizedEntities,
  };
}

export function parseNewsDedupDecision(payload, candidateIds) {
  if (!isPlainObject(payload) || typeof payload.is_duplicate !== "boolean") {
    return null;
  }

  const relation = normalizeString(payload.relation)?.toLowerCase();
  const confidence = Number(payload.confidence);
  const suppliedReason = normalizeString(payload.reason);
  const duplicateOf = normalizeString(payload.duplicate_of);

  if (!relation || !RELATION_SET.has(relation) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return null;
  }

  if (payload.is_duplicate && (!duplicateOf || !candidateIds.has(duplicateOf))) {
    return null;
  }

  return {
    isDuplicate: payload.is_duplicate,
    duplicateOf: payload.is_duplicate ? duplicateOf : null,
    relation,
    confidence,
    reason: (suppliedReason ?? getFallbackDedupReason(payload.is_duplicate, relation)).slice(0, 1_000),
  };
}

function getFallbackDedupReason(isDuplicate, relation) {
  if (isDuplicate) {
    return "Совпадают центральное событие и основные участники.";
  }

  if (relation === "related") {
    return "Материалы связаны темой, но сообщают разные факты.";
  }

  return "Совпадений центрального факта не найдено.";
}

export function makeNewsDedupLockKey(article) {
  const fingerprint = normalizeFingerprint(article.eventFingerprint ?? article.event_fingerprint);

  if (fingerprint) {
    return fingerprint;
  }

  const eventType = normalizeSlug(article.eventType ?? article.event_type) ?? "event";
  const entities = getEntityNames(article).sort().join("_") || "no_entities";
  const fact = normalizeComparableText(article.mainFact ?? article.main_fact ?? article.title ?? "");
  const suffix = createHash("sha256").update(`${eventType}|${entities}|${fact}`).digest("hex").slice(0, 16);

  return `${eventType}_${entities}_${suffix}`.slice(0, 240);
}

export function rankNewsDedupCandidates(article, candidates, options = {}) {
  const windowHours = clampInteger(options.windowHours, 24, 1, 168);
  const maxCandidates = clampInteger(options.maxCandidates, 10, 1, 25);
  const referenceTime = toTimestamp(options.referenceTime ?? article.ingestedAt ?? article.ingested_at) ?? Date.now();
  const windowStart = referenceTime - windowHours * 3_600_000;
  const newFingerprint = normalizeFingerprint(article.eventFingerprint ?? article.event_fingerprint);
  const newEventType = eventTypeKey(article.eventType ?? article.event_type);
  const newEntities = new Set(getEntityNames(article));
  const newMainFact = article.mainFact ?? article.main_fact;
  const newTitle = article.title ?? article.ai_title_ru ?? article.original_title;

  return (candidates ?? [])
    .flatMap((candidate) => {
      if (!candidate?.id || candidate.id === article.id) {
        return [];
      }

      const candidateIngestedAt = toTimestamp(candidate.ingestedAt ?? candidate.ingested_at);
      const candidatePublishedAt = toTimestamp(candidate.publishedAt ?? candidate.published_at);
      const comparisonTime = candidateIngestedAt ?? candidatePublishedAt;
      const archivedEntityMatch = options.preflight && getEntityNames(candidate).some(entity => newEntities.has(entity));

      if (
        comparisonTime === null ||
        (comparisonTime < windowStart && !archivedEntityMatch) ||
        comparisonTime > referenceTime ||
        (candidateIngestedAt !== null && candidateIngestedAt >= referenceTime)
      ) {
        return [];
      }

      const publicationStatus = candidate.publicationStatus ?? candidate.publication_status;

      if (publicationStatus && !["published", "processing_dedup"].includes(publicationStatus)) {
        return [];
      }

      const candidateFingerprint = normalizeFingerprint(
        candidate.eventFingerprint ?? candidate.event_fingerprint,
      );
      const candidateEventType = eventTypeKey(candidate.eventType ?? candidate.event_type);
      const candidateEntities = new Set(getEntityNames(candidate));
      const entityOverlap = [...newEntities].filter((entity) => candidateEntities.has(entity)).length;
      const fingerprintMatch = Boolean(newFingerprint && newFingerprint === candidateFingerprint);
      const eventTypeMatch = Boolean(newEventType && newEventType === candidateEventType);
      const mainFactSimilarity = textSimilarity(
        newMainFact,
        candidate.mainFact ?? candidate.main_fact,
      );
      const titleSimilarity = textSimilarity(
        newTitle,
        candidate.title ?? candidate.ai_title_ru ?? candidate.original_title,
      );
      const originalSimilarity = textSimilarity(
        `${article.original_title ?? newTitle ?? ""} ${article.original_description ?? ""}`,
        `${candidate.original_title ?? ""} ${candidate.original_description ?? ""}`,
      );
      const matches =
        fingerprintMatch ||
        (eventTypeMatch && entityOverlap >= 1) ||
        entityOverlap >= 2 ||
        mainFactSimilarity >= 0.58 ||
        titleSimilarity >= 0.62 ||
        (options.preflight && (entityOverlap >= 1 || originalSimilarity >= 0.15));

      if (!matches) {
        return [];
      }

      const freshness = Math.max(0, 1 - (referenceTime - comparisonTime) / (windowHours * 3_600_000));
      const score =
        (fingerprintMatch ? 100 : 0) +
        entityOverlap * 18 +
        (eventTypeMatch ? 14 : 0) +
        mainFactSimilarity * 12 +
        titleSimilarity * 10 + originalSimilarity * 20 +
        freshness;

      return [{ ...candidate, _dedupScore: score }];
    })
    .sort((left, right) => {
      if (right._dedupScore !== left._dedupScore) {
        return right._dedupScore - left._dedupScore;
      }

      return (toTimestamp(right.publishedAt ?? right.published_at) ?? 0) -
        (toTimestamp(left.publishedAt ?? left.published_at) ?? 0);
    })
    .slice(0, maxCandidates)
    .map((candidate) => {
      const result = { ...candidate };
      delete result._dedupScore;
      return result;
    });
}

export async function runNewsDeduplicationPipeline({
  article,
  config,
  acquireLock,
  releaseLock,
  loadCandidates,
  classify,
  saveDecision,
  onError = async () => {},
  now = () => new Date(),
}) {
  const startedAt = Date.now();
  const publicationTime = article.publishedAt ?? article.published_at ?? now().toISOString();

  if (!config.enabled) {
    const decision = makePublicationDecision({
      article,
      candidateCount: 0,
      dedupStatus: "skipped",
      publicationStatus: "published",
      publishedAt: publicationTime,
      processingTimeMs: Date.now() - startedAt,
    });
    await saveDecision(decision);
    return decision;
  }

  const lockKey = makeNewsDedupLockKey(article);
  let lockAcquired = false;

  try {
    lockAcquired = await acquireLock(lockKey, article.id);

    if (!lockAcquired) {
      throw new Error("news_dedup_lock_unavailable");
    }

    const candidates = await loadCandidates(article, config);

    if (!candidates.length) {
      const decision = makePublicationDecision({
        article,
        candidateCount: 0,
        dedupStatus: "unique",
        publicationStatus: "published",
        publishedAt: publicationTime,
        processingTimeMs: Date.now() - startedAt,
      });
      await saveDecision(decision);
      return decision;
    }

    const classified = await classify(article, candidates, config);

    if (!classified) {
      throw new Error("news_dedup_invalid_ai_response");
    }

    const duplicateCandidate = candidates.find(
      (candidate) => candidate.id === classified.duplicateOf,
    );
    const matchingIdentity = duplicateCandidate
      ? isNewsDedupIdentityMatch(article, duplicateCandidate)
      : false;
    const rejectedByIdentityGuard = Boolean(
      classified.isDuplicate &&
      classified.relation === "duplicate" &&
      duplicateCandidate &&
      !matchingIdentity,
    );
    const suppress =
      classified.isDuplicate === true &&
      classified.relation === "duplicate" &&
      classified.confidence >= config.confidenceThreshold &&
      duplicateCandidate &&
      matchingIdentity;
    const decision = makePublicationDecision({
      article,
      candidateCount: candidates.length,
      dedupStatus: suppress ? "duplicate" : "unique",
      publicationStatus: suppress ? "duplicate" : "published",
      publishedAt: suppress ? null : publicationTime,
      duplicateOf: suppress ? classified.duplicateOf : null,
      confidence: classified.confidence,
      relation: rejectedByIdentityGuard ? "related" : classified.relation,
      reason: rejectedByIdentityGuard
        ? `Опубликовано: тип или стадия события отличаются. Исходная оценка: ${classified.reason}`
        : classified.reason,
      processingTimeMs: Date.now() - startedAt,
    });
    await saveDecision(decision);
    return decision;
  } catch (error) {
    await onError(error);
    const errorMessage = getErrorMessage(error);
    const lockUnavailable = errorMessage === "news_dedup_lock_unavailable";
    const publish = config.failMode === "publish" && !lockUnavailable;
    const decision = makePublicationDecision({
      article,
      candidateCount: 0,
      dedupStatus: "error",
      publicationStatus: publish ? "published" : "processing_dedup",
      publishedAt: publish ? publicationTime : null,
      reason: errorMessage,
      processingTimeMs: Date.now() - startedAt,
    });
    await saveDecision(decision);
    return decision;
  } finally {
    if (lockAcquired) {
      await releaseLock(lockKey, article.id);
    }
  }
}

export function makeNewsDedupClassifierInput(article, candidates) {
  return {
    new_article: toClassifierArticle(article),
    existing_articles: candidates.map((candidate) => ({
      ...toClassifierArticle(candidate),
      id: candidate.id,
      published_at: candidate.publishedAt ?? candidate.published_at ?? null,
    })),
  };
}

function makePublicationDecision({
  article,
  candidateCount,
  dedupStatus,
  publicationStatus,
  publishedAt,
  duplicateOf = null,
  confidence = null,
  relation = null,
  reason = null,
  processingTimeMs,
}) {
  return {
    articleId: article.id,
    candidateCount,
    dedupStatus,
    publicationStatus,
    publishedAt,
    duplicateOf,
    confidence,
    relation,
    reason,
    processingTimeMs,
  };
}

function toClassifierArticle(article) {
  return {
    article_type: article.articleType ?? article.editorial_meta?.article_type ?? null,
    title: article.title ?? article.ai_title_ru ?? article.original_title ?? null,
    summary: article.summary ?? article.ai_summary_ru ?? article.original_description ?? null,
    main_fact: article.mainFact ?? article.main_fact ?? null,
    event_type: article.eventType ?? article.event_type ?? null,
    event_stage: article.eventStage ?? article.event_stage ?? null,
    event_fingerprint: article.eventFingerprint ?? article.event_fingerprint ?? null,
    entities: getEntityNames(article),
    event_date: article.eventDate ?? article.event_date ?? null,
  };
}

export function isNewsDedupIdentityMatch(article, candidate) {
  const genre = value => ["analysis", "technical_analysis", "opinion", "column"].includes(value) ? "analysis" : ["news", "breaking_news", "report"].includes(value) ? "news" : value;
  const articleGenre = genre(article.articleType ?? article.editorial_meta?.article_type);
  const candidateGenre = genre(candidate.articleType ?? candidate.editorial_meta?.article_type);
  if (articleGenre && candidateGenre && articleGenre !== candidateGenre) return false;
  const articleType = eventTypeKey(article.eventType ?? article.event_type);
  const candidateType = eventTypeKey(candidate.eventType ?? candidate.event_type);
  const articleStage = eventStageKey(article.eventStage ?? article.event_stage);
  const candidateStage = eventStageKey(candidate.eventStage ?? candidate.event_stage);
  if (articleStage && candidateStage && articleStage !== candidateStage) return false;
  if (articleType && candidateType && articleType !== candidateType &&
      /analysis|reaction|interview|opinion|result/.test(`${articleType} ${candidateType}`)) return false;
  const articleFingerprint = normalizeFingerprint(
    article.eventFingerprint ?? article.event_fingerprint,
  );
  const candidateFingerprint = normalizeFingerprint(
    candidate.eventFingerprint ?? candidate.event_fingerprint,
  );

  if (articleFingerprint && candidateFingerprint && articleFingerprint === candidateFingerprint) {
    return true;
  }

  return Boolean(
    articleType &&
    candidateType &&
    articleType === candidateType &&
    articleStage &&
    candidateStage &&
    articleStage === candidateStage
  );
}

function normalizeEntities(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();

  return value.flatMap((entity) => {
    if (typeof entity === "string") {
      const normalizedName = normalizeEntityKey(entity);

      if (!normalizedName || seen.has(normalizedName)) {
        return [];
      }

      seen.add(normalizedName);
      return [{ type: "other", name: entity.trim(), normalized_name: normalizedName }];
    }

    if (!isPlainObject(entity)) {
      return [];
    }

    const type = normalizeSlug(entity.type) ?? "other";
    const name = normalizeString(entity.name);
    const normalizedName = normalizeEntityKey(entity.normalized_name ?? entity.normalizedName) ?? normalizeEntityKey(name);

    if (!name || !normalizedName || seen.has(normalizedName)) {
      return [];
    }

    seen.add(normalizedName);
    return [{ type, name, normalized_name: normalizedName }];
  }).slice(0, 12);
}

function getEntityNames(article) {
  return normalizeEntities(
    article.normalizedEntities ?? article.normalized_entities ?? article.entities,
  ).map((entity) => entity.normalized_name);
}

function buildFallbackFingerprint({ eventType, normalizedEntities, mainFact }) {
  const entityPart = normalizedEntities.map((entity) => entity.normalized_name).sort().join("_");
  const suffix = createHash("sha256").update(mainFact).digest("hex").slice(0, 12);

  // Broad articles can list many drivers. Keep the distinguishing hash even
  // when their names fill the fingerprint's storage allowance.
  return `${`${eventType}_${entityPart}`.slice(0, 227)}_${suffix}`;
}

function textSimilarity(left, right) {
  const leftTokens = new Set(tokenizeComparableText(left));
  const rightTokens = new Set(tokenizeComparableText(right));

  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;

  return intersection / union;
}

function tokenizeComparableText(value) {
  return normalizeComparableText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !COMPARISON_STOP_WORDS.has(token));
}

function normalizeComparableText(value) {
  return String(value ?? "")
    .toLocaleLowerCase("ru-RU")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zа-яё0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeContentBlock(value) {
  return normalizeComparableText(value);
}

function normalizeFingerprint(value) {
  const normalized = normalizeString(value)?.toLowerCase().replace(/-+/g, "_");

  return normalized && /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(normalized)
    ? normalized.slice(0, 240)
    : null;
}

function normalizeSlug(value) {
  return normalizeFingerprint(value);
}

function normalizeEntityKey(value) {
  const normalized = normalizeString(value)?.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
  return normalized ? normalized.slice(0, 240) : null;
}

function normalizeEventKey(value) {
  // These are private semantic labels, not URL slugs. A Russian label or
  // spaces from the model must not veto otherwise verified reader content.
  const normalized = normalizeString(value)?.normalize("NFKC").toLowerCase().replace(/[\s-]+/g, "_");
  return normalized && /^[a-zа-яё0-9]+(?:_[a-zа-яё0-9]+)*$/i.test(normalized)
    ? normalized.slice(0, 240) : null;
}

function normalizeEventDate(value) {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return !["0", "false", "off", "no"].includes(String(value).trim().toLowerCase());
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function toTimestamp(value) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getErrorMessage(error) {
  return (error instanceof Error ? error.message : String(error ?? "unknown_error")).slice(0, 1_000);
}
