import { createHash } from "node:crypto";
import { parseNewsEditorialMetadata } from "./news-deduplication.mjs";

export const NEWS_EDITORIAL_VERSION = 1;
// Keep the existing database trigger: only the exact verified text can publish.
export const NEWS_PIPELINE_VERSION = 3;
export const NEWS_ARTICLE_TYPES = ["breaking_news", "news", "report", "interview", "opinion", "column", "analysis", "rumour", "legal", "historical", "technical_analysis"];
const SCORE_KEYS = ["fact_grounding", "source_fidelity", "attribution", "headline_fidelity", "information_density", "language_quality"];
const text = value => typeof value === "string" ? value.trim() : "";
const strings = value => Array.isArray(value) && value.every(item => typeof item === "string");

export function sourceSnapshotHash(source) {
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

// Recover only untouched drafts held by the retired algorithm's system checks.
// A new algorithm version makes this a one-time retry, not a paid retry loop.
export function canRetryNewsSystemHold(article, review) {
  if (article.publication_status !== "draft" || article.published_manually || article.duplicate_of ||
      article.editorial_meta?.algorithm_version !== 2 || !review ||
      !Array.isArray(review.issues) || !review.issues.length) return false;
  const systemIssues = new Set(["invalid_review_edits", "news_token_budget_exceeded", "invalid_duplicate_decision",
    "invalid_extraction", "invalid_event_metadata", "source_meta_narration", "context_claim_mismatch",
    "race_context_mismatch", "team_context_mismatch", "unknown_source_fact", "essential_fact_missing"]);
  if (!review.issues.every(issue => systemIssues.has(issue) || (typeof issue === "string" && issue.startsWith("invented_number:")))) return false;
  const attempt = Array.isArray(review.attempts) ? review.attempts.at(-1) : null;
  if (attempt?.review && attempt.review.decision !== "PASS") return false;
  const checked = Date.parse(article.ai_processed_at);
  const updated = Date.parse(article.updated_at);
  if (!Number.isFinite(checked) || !Number.isFinite(updated) || updated > checked + 5_000) return false;
  return [["ai_title_ru", "title_ru"], ["ai_summary_ru", "summary_ru"], ["ai_summary_long_ru", "details_ru"]]
    .every(([field, draftField]) => (article[field] ?? "") === (attempt?.draft?.[draftField] ?? ""));
}

export function newsDraftParagraphs(draft) {
  return text(draft?.details_ru).split(/\n\s*\n/).map(text).filter(Boolean);
}

function normalizeConditionalSourceFraming(draft) {
  if (!draft) return draft;
  const normalize = value => typeof value === "string" ? value.replace(
    /автор(?:ы)? (?:оценки|разбора|статьи|материала) (?:считал[аи]?|считает|считают|полагал[аи]?|полагает|полагают),? что\s+/gi,
    (framing, offset, full) => {
      const remaining = full.slice(offset + framing.length);
      // Only remove the editorial introducer when the principal claim itself
      // starts with an explicit conditional. Never turn a belief into a fact.
      return /^(?:[A-ZА-ЯЁ][\p{L}\d-]*(?:\s+[A-ZА-ЯЁ][\p{L}\d-]*){0,2})\s+(?:не\s+)?(?:мог(?:ла|ло|ли)?|может|могут)\s/u.test(remaining) ? "" : framing;
    }) : value;
  return { ...draft, title_ru: normalize(draft.title_ru), summary_ru: normalize(draft.summary_ru), details_ru: normalize(draft.details_ru) };
}

// Structural checks only. Quantities, actors and historical affiliations need
// semantic comparison with the original, not scalar sets or generated fact IDs.
export function checkNewsDraft(draft, metadata = {}, source = {}) {
  if (!draft || !["title_ru", "summary_ru", "details_ru"].every(key => text(draft[key]))) return ["incomplete_draft"];
  const body = `${draft.title_ru}\n${draft.summary_ru}\n${draft.details_ru}`;
  const issues = [];
  if (!/[а-яё]/i.test(body)) issues.push("non_russian_draft");
  if (/https?:\/\/|\[[^\]]+\]\(|\*\*|^#{1,6}\s/m.test(body)) issues.push("reader_markup");
  if (/автор[а-яё]* (?:стать|материал|источник|портал|оценк|разбор)|(?:автор|издание|редакция|журналист|подкаст|портал)[^.!?\n]{0,35}(?:The Race|RaceFans|Autosport)|(?:редакция|журналист|читатель|комментатор)[а-яё]*[^.!?\n]{0,45}(?:счита|предлага|отмеча|полага|пишет)|по (?:оценке|мнению) (?:автор|материал|источник|издани|читател|комментатор)[а-яё]*|(?:доступн|исходн|предоставленн)[а-яё]* (?:фрагмент|отрывок|текст)|(?:в|из) (?:статье|материале|источнике|публикации|разборе)\s+(?:The Race|RaceFans|Autosport|говорится|указано|отмечается|сказано|е[её] |его )/i.test(body)) issues.push("source_meta_narration");
  for (const author of [...(source.authors ?? []), ...(metadata.source_authors ?? []), ...(metadata.source_author_aliases ?? [])]) {
    if (typeof author !== "string" || author.length < 4) continue;
    const surname = author.split(/\s+/).at(-1);
    const stem = /[а-яё]/i.test(surname) ? surname.replace(/[ая]$/i, "") : surname;
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ending = /[а-яё]/i.test(stem) && stem.length >= 5 ? "(?:а|у|ом|е|ой|ых|ым|ами)?" : "";
    if (new RegExp(`(?<![\\p{L}])${escaped}${ending}(?![\\p{L}])`, "iu").test(body)) issues.push("source_meta_narration");
  }
  if (/RaceSide[^.!?\n]{0,30}(?:счита|предлага|полага)|(?:мы считаем|на наш взгляд)/i.test(body) && !/RaceSide/i.test(source.text ?? "")) issues.push("raceside_opinion");
  return [...new Set(issues)];
}

// Shared with the worker and diagnostics; tags and audit metadata do not decide
// whether a reader can use the article.
export function isUsableRussianNewsPayload({ details, summary, title }) {
  return [[title, 4, 0.25], [summary, 32, 0.45], [details, 64, 0.45]].every(([value, minimum, ratio]) => {
    const prose = text(value);
    const cyrillic = (prose.match(/[А-Яа-яЁё]/g) ?? []).length;
    const latin = (prose.match(/[A-Za-z]/g) ?? []).length;
    return cyrillic >= minimum && cyrillic >= latin * ratio;
  });
}

export function verificationPasses(review, { allowEdits = false } = {}) {
  if (review?.decision !== "PASS" || review.checked_claims !== true) return false;
  if (review.policy_version === 3) {
    const corrections = review.corrections;
    return Array.isArray(review.blocking_issues) && review.blocking_issues.length === 0 &&
      corrections && [corrections.title_ru, corrections.summary_ru].every(value => value === null || typeof value === "string") &&
      Array.isArray(corrections.paragraphs) && (allowEdits ||
        (corrections.title_ru === null && corrections.summary_ru === null && corrections.paragraphs.length === 0));
  }
  // Existing saved reviews and daily digests remain readable during rollout.
  const legacy = review.policy_version == null && review.blocking_issues == null && review.suggestions == null;
  const current = review.policy_version === 2 && Array.isArray(review.blocking_issues) && !review.blocking_issues.length && strings(review.suggestions);
  return Array.isArray(review.issues) && !review.issues.length && (legacy || current) &&
    (review.edits == null || (Array.isArray(review.edits) && (allowEdits || !review.edits.length))) &&
    SCORE_KEYS.every(key => typeof review.scores?.[key] === "number" && review.scores[key] >= (current ? 0 : 0.9) && review.scores[key] <= 1);
}

export function applyNewsReviewCorrections(draft, review) {
  const corrections = review?.corrections;
  if (!corrections || ![corrections.title_ru, corrections.summary_ru].every(value => value === null || typeof value === "string") ||
      !Array.isArray(corrections.paragraphs) || corrections.paragraphs.length > 16) return null;
  const paragraphs = newsDraftParagraphs(draft);
  const seen = new Set();
  for (const correction of corrections.paragraphs) {
    if (!correction || !Number.isInteger(correction.index) || correction.index < 0 || correction.index >= paragraphs.length ||
        seen.has(correction.index) || typeof correction.text !== "string") return null;
    seen.add(correction.index);
    paragraphs[correction.index] = text(correction.text);
  }
  const final = { ...draft, title_ru: corrections.title_ru ?? draft.title_ru,
    summary_ru: corrections.summary_ru ?? draft.summary_ru, details_ru: paragraphs.filter(Boolean).join("\n\n") };
  const body = `${final.summary_ru}\n${final.details_ru}`;
  final.highlight_phrases_ru = (draft.highlight_phrases_ru ?? []).filter(phrase => typeof phrase === "string" && body.includes(phrase));
  return final;
}

function normalizeNewsMetadata(payload, draft, source, context) {
  const value = payload && typeof payload === "object" ? payload : {};
  const entities = Array.isArray(value.entities) ? value.entities.filter(entity => entity && text(entity.name)) : [];
  const mainFact = draft.title_ru;
  // A missing routing tag is not a missing source fact. The title provides a
  // stable topic fallback; semantic duplicates are still compared before writing.
  const candidate = { ...value, main_fact: mainFact, event_type: text(value.event_type) || "news",
    event_stage: text(value.event_stage) || "unknown", event_date: value.event_date ?? null,
    entities: entities.length ? entities : [{ type: "other", name: mainFact, role: "primary" }] };
  const parsed = parseNewsEditorialMetadata(candidate) ?? parseNewsEditorialMetadata({
    main_fact: draft.title_ru, event_type: "news", event_stage: "unknown",
    entities: [{ type: "other", name: draft.title_ru }],
  });
  draft.race_round = (context.races ?? []).some(race => race.round === draft.race_round) ? draft.race_round : null;
  draft.race_confidence = draft.race_round === null ? 0 : 0.95;
  draft.context_claims = [];
  return { article_type: NEWS_ARTICLE_TYPES.includes(value.article_type) ? value.article_type : "news",
    main_fact: parsed.mainFact, event_type: parsed.eventType, event_stage: parsed.eventStage,
    event_date: parsed.eventDate, event_fingerprint: parsed.eventFingerprint,
    entities: parsed.normalizedEntities.map(entity => ({ ...entity,
      role: candidate.entities.find(item => item.name === entity.name)?.role ?? "primary" })),
    source_authors: [...new Set([...(source.authors ?? []), ...(strings(value.source_authors) ? value.source_authors : [])])].filter(author => typeof author === "string"),
    source_author_aliases: strings(value.source_author_aliases) ? value.source_author_aliases : [] };
}

function compactRequestContext(context) {
  return { ...context, teams: undefined, facts: (context.facts ?? []).map(fact => {
    const value = { ...fact }; delete value.id; delete value.aliases; delete value.reference;
    return value;
  }) };
}

/** One writing/dedup request, one independent verification, no paid repair loop. */
export async function runNewsEditorialPipeline({ source, context, request, candidates = [], confidenceThreshold = 0.9 }) {
  const result = { version: NEWS_EDITORIAL_VERSION, algorithm_version: NEWS_PIPELINE_VERSION,
    source, source_hash: sourceSnapshotHash(source), context, extraction: null, attempts: [], decision: "MANUAL_REVIEW", issues: [] };
  const requestSource = { ...source }; delete requestSource.article_id; delete requestSource.retrieved_at;
  let composed;
  try { composed = await request("news.compose", { source: requestSource, context: compactRequestContext(context), candidates }); }
  catch (error) {
    if (!["news_token_budget_exceeded", "news_invalid_response"].includes(error?.code)) throw error;
    return { ...result, issues: [error.code] };
  }
  if (composed?.decision === "DUPLICATE") {
    const candidate = candidates.find(item => item.id === composed.duplicate_of);
    const confidence = composed.duplicate_confidence;
    if (!candidate || typeof confidence !== "number" || confidence < Math.max(0.9, confidenceThreshold) || confidence > 1)
      return { ...result, issues: ["invalid_duplicate_decision"] };
    return { ...result, decision: "DUPLICATE", duplicate: { duplicateOf: candidate.id, confidence, relation: "duplicate", reason: text(composed.reason).slice(0, 1000) } };
  }
  if (composed?.decision === "REJECT") return { ...result, decision: "REJECT", issues: [text(composed.reason) || "irrelevant_source"] };
  const draft = removeExactLeadRepeat(normalizeConditionalSourceFraming(normalizeRussianLetters(composed?.decision === "ARTICLE" ? composed.draft : null)));
  const usable = value => value && isUsableRussianNewsPayload({ title: value.title_ru, summary: value.summary_ru, details: value.details_ru });
  if (!usable(draft)) return { ...result, draft, issues: ["incomplete_draft"] };
  const metadata = normalizeNewsMetadata(composed.extraction, draft, source, context);
  result.extraction = metadata;
  const checks = checkNewsDraft(draft, metadata ?? {}, source);
  let review;
  try {
    review = await request("news.verify", { source: requestSource, context: compactRequestContext(context),
      draft: { title_ru: draft.title_ru, summary_ru: draft.summary_ru, paragraphs: newsDraftParagraphs(draft) },
      hard_issues: checks, allow_edits: true });
  } catch (error) {
    if (!["news_token_budget_exceeded", "news_invalid_response"].includes(error?.code)) throw error;
    result.attempts.push({ draft, review: null, hard_issues: [error.code] });
    return { ...result, draft, issues: [error.code] };
  }
  const final = review?.decision === "PASS" && review.policy_version === 3
    ? normalizeConditionalSourceFraming(normalizeRussianLetters(applyNewsReviewCorrections(draft, review))) : draft;
  const issues = final ? checkNewsDraft(final, metadata ?? {}, source) : ["invalid_review_edits"];
  if (final && !usable(final)) issues.push("incomplete_draft");
  if (Array.isArray(review?.blocking_issues)) issues.push(...review.blocking_issues.map(issue => text(issue?.reason ?? issue?.explanation_ru)).filter(Boolean));
  if (Array.isArray(review?.issues)) issues.push(...review.issues.filter(issue => typeof issue === "string"));
  result.draft = final ?? draft; result.review = review;
  if (final && metadata && text(final.title_ru)) {
    // Candidate matching and digests must not inherit an unverified generated
    // assertion after the reviewer corrected the headline.
    metadata.main_fact = final.title_ru;
    metadata.event_fingerprint = parseNewsEditorialMetadata({ ...metadata, event_fingerprint: null }).eventFingerprint;
  }
  result.attempts.push({ draft: result.draft, original_draft: final && JSON.stringify(final) !== JSON.stringify(draft) ? draft : undefined,
    review, hard_issues: [...new Set(issues)] });
  if (!issues.length && metadata && review?.policy_version === 3 && verificationPasses(review, { allowEdits: true }))
    return { ...result, decision: "PASS", issues: [] };
  return { ...result, issues: [...new Set(issues.length ? issues : ["invalid_verification"])] };
}

function removeExactLeadRepeat(draft) {
  if (!text(draft?.summary_ru) || !text(draft?.details_ru)) return draft;
  const lead = text(draft.summary_ru);
  const details = text(draft.details_ru);
  // Only remove a verbatim prefix with remaining content; never discard a
  // paraphrase that may contain a new qualification or a different fact.
  const remainder = details.startsWith(lead) ? details.slice(lead.length).trim() : "";
  return remainder ? { ...draft, details_ru: remainder } : draft;
}

function normalizeRussianLetters(draft) {
  if (!draft) return draft;
  const lookalikes = { a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", y: "у", A: "А", B: "В", C: "С", E: "Е", H: "Н", K: "К", M: "М", O: "О", P: "Р", T: "Т", X: "Х", Y: "У" };
  const normalize = value => typeof value === "string" ? value.replace(/(?:\\n\s*){2,}/g, "\n\n").replace(/[\p{L}]+/gu, word => {
    const latin = word.match(/[A-Za-z]/g);
    // Correct isolated visually identical letters inside Russian words. Keep
    // Latin names, model codes and mixed tokens with other letters unchanged.
    return /[а-яё]/i.test(word) && latin?.every(letter => lookalikes[letter])
      ? word.replace(/[A-Za-z]/g, letter => lookalikes[letter]) : word;
  }) : value;
  return { ...draft, title_ru: normalize(draft.title_ru), summary_ru: normalize(draft.summary_ru),
    details_ru: normalize(draft.details_ru), highlight_phrases_ru: draft.highlight_phrases_ru?.map(normalize) };
}

function numbers(value) {
  const numberWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
  const wordPattern = numberWords.join("|");
  const english = !/[а-яё]/i.test(String(value));
  const normalized = String(value)
    .replace(/(?:Формул[а-яё]*|Formula)\s*[- ]?[123]\b/giu, "формульной серии")
    // The disease name is not a quantitative claim (sources often say Covid).
    .replace(/\bCOVID[-\s]?19\b/gi, "COVID")
    // English thousands and Russian decimal commas have different meanings.
    .replace(/\b\d{1,3}(?:,\d{3})+\b/g, match => english ? match.replaceAll(",", "") : match)
    .replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, "$1")
    .replace(new RegExp(`\\b(${wordPattern}) and a half(?:[- ](tenths?))?\\b`, "gi"), (_, word, tenths) =>
      String((numberWords.indexOf(word.toLowerCase()) + 0.5) / (tenths ? 10 : 1)))
    .replace(new RegExp(`\\b(${wordPattern})[- ]tenths?\\b`, "gi"), (_, word) => String(numberWords.indexOf(word.toLowerCase()) / 10))
    .replace(/\bhalf (?:a |an |one )?(?:second|tenth)\b/gi, match => match.toLowerCase().includes("tenth") ? "0.05" : "0.5")
    // Expand compact lap-time notation, including the abbreviated range 44.7-8.
    .replace(/\b(\d+)m(\d{1,2})\.(\d+)[-–](\d+)s\b/g, (_, minute, second, start, end) =>
      `${minute}:${second}.${start} ${minute}:${second}.${start.slice(0, -end.length)}${end}`)
    .replace(/\b(\d+)m\s*(\d{1,2})(?:[.,](\d+))?\s*(?:s|seconds?)\b/gi, (_, minute, second, fraction) =>
      `${minute}:${second}${fraction == null ? "" : `.${fraction}`}`)
    .replace(/\b(1[0-2]|0?[1-9])(?:[.:]([0-5]\d))?\s*([ap])m\b/gi, (match, hour, minute, period) =>
      `${match} ${Number(hour) % 12 + (period.toLowerCase() === "p" ? 12 : 0)}:${minute ?? "00"}`)
    .replace(/(\d)(?:million|billion|thousand|km|kg|mph|bhp|hp|ms|bn|m|k|s)\b/gi, "$1 ")
    .replace(/\b\d{1,3}(?:[ \u00a0\u202f]\d{3})+\b/g, match => match.replace(/\s/g, ""))
    .replace(new RegExp(`\\b(${numberWords.join("|")})\\b`, "gi"), word => String(numberWords.indexOf(word.toLowerCase())));
  return [...normalized.matchAll(/(?<![\p{L}\d])\d+(?:[.,]\d+)?(?![\p{L}\d])/gu)].map(match => String(Number(match[0].replace(",", "."))));
}

export function buildDigestInput(articles) {
  const events = new Map();
  for (const article of articles) {
    const key = article.event_fingerprint || article.id;
    if (!events.has(key)) events.set(key, { event: key, articles: [] });
    events.get(key).articles.push({ id: article.id, title: article.ai_title_ru ?? article.original_title, summary: article.ai_summary_ru, main_fact: article.main_fact, type: article.editorial_meta?.article_type ?? "news", source: article.canonical_url, source_name: article.news_sources?.name, source_authors: article.editorial_meta?.source_authors ?? [] });
  }
  return [...events.values()];
}

export function renderVerifiedDigest(payload, articles) {
  if (!Array.isArray(payload?.items) || !payload.items.length || payload.items.length > 6) return null;
  const seen = new Set();
  const lines = [];
  for (const item of payload.items) {
    if (!text(item.headline) || !text(item.summary) || !strings(item.article_ids) || !item.article_ids.length) return null;
    const references = item.article_ids.map(id => articles.find(article => article.id === id));
    if (references.some(article => !article)) return null;
    const events = references.map(article => article.event_fingerprint || article.id);
    if (events.some(event => seen.has(event))) return null;
    events.forEach(event => seen.add(event));
    const headline = plainDigestText(item.headline);
    const summary = plainDigestText(item.summary);
    if (!headline || !summary) return null;
    const allowedNumbers = new Set(numbers(references.map(article => `${article.ai_title_ru} ${article.ai_summary_ru} ${article.ai_summary_long_ru}`).join("\n")));
    if (numbers(`${headline} ${summary}`).some(value => !allowedNumbers.has(value))) return null;
    lines.push(`• ${headline}\n${summary}`);
  }
  return lines.join("\n\n");
}

function plainDigestText(value) {
  return text(value).replace(/\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/\S+/giu, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}
