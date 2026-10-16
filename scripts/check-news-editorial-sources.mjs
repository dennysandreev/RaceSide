// Opt-in quality check on real, already published sources. SELECT only; no article writes.
// node --env-file=.env.local scripts/check-news-editorial-sources.mjs --run
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { resolveWorkerAiPrompt } from "../worker/ai-prompt-registry.mjs";
import { loadNewsContext, selectNewsContext } from "../worker/news-context.mjs";
import { runNewsEditorialPipeline, isUsableRussianNewsPayload, verificationPasses, sourceSnapshotHash, newsDraftParagraphs } from "../worker/news-editorial.mjs";
import { parseNewsEditorialMetadata, rankNewsDedupCandidates } from "../worker/news-deduplication.mjs";
import { newsResponseFormat, newsRequestOptions } from "../worker/news-response-format.mjs";
import { createNewsTokenBudget } from "../worker/news-token-budget.mjs";
import { extractNewsSourceHtml, extractNewsSourceMarkdown, decodeNewsEntities, cleanNewsRssText, hasUsableNewsSourceText, truncateNewsSourceText } from "../worker/news-source-text.mjs";

if (!process.argv.includes("--run")) {
  console.log("Pass --run for a paid check of real source articles. No database writes.");
  process.exit(0);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ids = ["b62a9a39-d6b8-4648-bb9e-c53e804ea0ba", "8b29c6a3-864c-458c-ba5b-1fa8d392cabd", "8483dcf2-572d-440f-aaa3-b929eadeb76d", "a9ea25e6-947c-4dbb-abd7-c8e73f5b0ebe"];
const heldIds = ["1092afbd-3853-4b6b-b26b-a8217cf8c269", "b88807b5-3ca4-4a37-8500-35b2df51425f", "71b3cde0-4ed2-4a0a-9108-5d8098f06773", "1b96cf1f-7be3-4475-add3-7a23c2ffcfc8", "cdeb61fe-1f25-419f-84eb-0d2d11008c46",
  // Numeric formats, local verification edits and a long practice report.
  "8786634b-01f4-45bc-86cf-526fa3070a0a", "8970cdef-6091-4446-9641-b6ff81a1506a",
  "8b7cc5b7-0372-476a-a850-f85b2adcde18", "9c339fbd-fab2-4c0b-83c2-4ae93d2a0f5e",
  // Fresh production holds: whole-second lap time, long report, risk and thousands.
  "9aa3c52a-e39a-4fc7-b89d-ed57b568f4a4", "14da0fbd-edec-4558-85b5-9d610d59a8a5",
  "22e357f3-aae3-4aa4-adc5-787fa5acdf7f", "b1862cc1-7f16-4697-98f1-f47276764070",
  // October 5: source voice, fragile literal edits, unit conversion, long rankings and context IDs.
  "8b1943d6-adfa-4d69-a6b1-c42444d6595b", "69798d46-07fc-499f-80b4-7facb770dfd0",
  "21b5e0dc-114f-4f3c-bb8d-3104b8cf6c74", "82c1bdd6-4d67-4eb9-9e09-5e5fed996bee",
  "79bc720d-425c-4941-9930-ea785fcf6ff5", "e0057c6e-8165-4e77-9235-44d701c454f1",
  "d31b3179-6c0e-4e50-87fa-89f4e6b5d83b", "3f7441e3-3429-4601-8691-15ba428e6fd5",
  "7caf92a1-c0c1-4bfd-9c88-bd8a0a7be67e"];

const requestedIds = process.argv.find(value => value.startsWith("--ids="))?.slice(6).split(",") ?? ids;
if (!requestedIds.length || requestedIds.some(id => ![...ids, ...heldIds].includes(id))) throw new Error("Choose IDs from the audit fixtures");
const costLimit = Number(process.argv.find(value => value.startsWith("--max-cost="))?.slice(11) ?? 0.50);
if (!Number.isFinite(costLimit) || costLimit <= 0 || costLimit > 0.50) throw new Error("Diagnostic cost limit must be within $0.50");
const { data: articles, error } = await db.from("news_articles").select("id,canonical_url,original_title,original_description,source_published_at,source_image_url,raw_payload,news_sources(name)").in("id", requestedIds);
if (error) throw error;
const context = await loadNewsContext(db, { season: new Date().getUTCFullYear() });
const { data: teamRows, error: teamsError } = await db.from("teams").select("id,name,short_name,code").eq("is_active", true);
if (teamsError) throw teamsError;
const teams = (teamRows ?? []).map(team => ({ name: team.short_name ?? team.name,
  slug: `team-${String(team.code ?? team.short_name ?? team.name ?? team.id).toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-+|-+$/g, "")}` }));
const pricingResponse = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(20_000) });
if (!pricingResponse.ok) throw new Error("Cannot confirm diagnostic model pricing");
const model = (await pricingResponse.json()).data?.find(item => item.id === "openai/gpt-6-luna");
const inputPrice = Number(model?.pricing?.prompt);
const outputPrice = Number(model?.pricing?.completion);
if (!(inputPrice > 0 && outputPrice > 0)) throw new Error("Diagnostic model pricing unavailable");
const noOverrides = { from: () => ({ select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, async maybeSingle() { return { data: null }; } }) };
const folder = "/tmp/raceside-editorial-luna-sources";
await mkdir(folder, { recursive: true });
const summary = [];
let negativeCheck = null;
let duplicateCheckDone = false;
let totalCost = 0;
let calls = 0;
for (const article of articles ?? []) {
  const url = article.canonical_url;
  let sourceText;
  let coverage = "article";
  let snapshot = null;
  if (process.argv.includes("--snapshot")) {
    const { data, error } = await db.from("news_editorial_reviews").select("source_snapshot").eq("article_id", article.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    snapshot = data?.source_snapshot;
    if (!snapshot?.text || snapshot.sources?.length) throw new Error("A single public-source snapshot is required");
    sourceText = extractNewsSourceHtml(snapshot.text, value => value, url, context.drivers);
    coverage = snapshot.coverage;
  } else try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "RaceSide/1.0 (+https://raceside.online)", accept: "text/html" } });
    if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
    sourceText = extractNewsSourceHtml(await response.text(), value => value, url, context.drivers);
    if (!sourceText || !hasUsableNewsSourceText(sourceText)) throw new Error("Incomplete source response");
  } catch (error) {
    if (!new URL(url).hostname.endsWith("racefans.net")) throw error;
    const response = await fetch(`https://r.jina.ai/${url}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      const entry = { id: article.id, decision: "SOURCE_UNAVAILABLE", reason: `Reader HTTP ${response.status}` };
      summary.push(entry);
      console.log(JSON.stringify(entry));
      continue;
    }
    sourceText = extractNewsSourceMarkdown(await response.text());
  }
  if (!sourceText || !hasUsableNewsSourceText(sourceText)) throw new Error(`Insufficient source text: ${article.id}`);
  if (coverage === "rss_only") sourceText = cleanNewsRssText(sourceText);
  if (sourceText.length > 12000) coverage = "article_truncated";
  const source = snapshot ? { ...snapshot, text: truncateNewsSourceText(sourceText), description: cleanNewsRssText(snapshot.description) } : { article_id: article.id, url, name: article.news_sources.name, title: decodeNewsEntities(article.original_title), description: cleanNewsRssText(article.original_description), text: truncateNewsSourceText(sourceText), authors: [article.raw_payload?.author].filter(value => typeof value === "string"), published_at: article.source_published_at, coverage };
  // Include real published candidates for production-sized prompts, excluding
  // the tested articles themselves. No private drafts or manual edits are read.
  const candidates = [];
  const selectedContext = selectNewsContext(context, source, teams ?? []);
  if (process.argv.includes("--candidates")) {
    const cutoff = new Date(snapshot?.retrieved_at ?? Date.now());
    const since = new Date(cutoff.getTime() - 7 * 24 * 60 * 60 * 1000);
    const { data, error } = await db.from("news_articles").select("id,original_title,original_description,ai_title_ru,main_fact,event_type,event_stage,event_date,event_fingerprint,normalized_entities,ingested_at,published_at,publication_status")
      .eq("publication_status", "published").is("duplicate_of", null).not("id", "in", `(${requestedIds.join(",")})`)
      .gte("ingested_at", since.toISOString()).lt("ingested_at", cutoff.toISOString()).lte("published_at", cutoff.toISOString())
      .order("ingested_at", { ascending: false }).limit(250);
    if (error) throw error;
    const selected = rankNewsDedupCandidates({ id: article.id, title: source.title, original_title: source.title,
      original_description: source.description, normalizedEntities: selectedContext.facts.filter(fact => fact.kind === "driver_team")
        .map(fact => ({ type: "driver", name: fact.subject })) }, data ?? [], { windowHours: 168, maxCandidates: 10, preflight: true, referenceTime: cutoff.toISOString() });
    candidates.push(...selected.map(item => ({ id: item.id, original_title: String(item.original_title ?? "").slice(0,180), title: String(item.ai_title_ru ?? "").slice(0,180),
      main_fact: String(item.main_fact ?? "").slice(0,260), event_type: item.event_type, event_stage: item.event_stage, event_date: item.event_date })));
  }

  const usage = [];
  const previous = process.argv.includes("--resume-verification") || process.argv.includes("--verify-existing")
    ? JSON.parse(await readFile(`${folder}/${article.id}.json`, "utf8")) : null;
  if (previous && (!process.argv.includes("--snapshot") || previous.result?.source_hash !== sourceSnapshotHash(source) ||
      previous.usage?.[0]?.key !== "news.compose" || !previous.result?.draft || !previous.result?.extraction ||
      (process.argv.includes("--resume-verification") && (previous.usage.length !== 1 || previous.result.issues?.[0] !== "news_token_budget_exceeded"))))
    throw new Error("Only a local AI draft with the unchanged public source can be verified");
  let tokenBudget = createNewsTokenBudget();
  const request = async (key, payload) => {
    if (calls >= 24 || totalCost >= costLimit) throw new Error("Diagnostic cost/call limit reached");
    const prompt = await resolveWorkerAiPrompt({ client: noOverrides, promptKey: key, variables: { payload_json: JSON.stringify(payload) } });
    const body = { model: prompt.model, ...newsRequestOptions(key, prompt.model), max_completion_tokens: prompt.maxTokens, response_format: newsResponseFormat(key), messages: [{ role: "system", content: prompt.systemPrompt }, { role: "user", content: prompt.userPrompt }] };
    const charge = tokenBudget.reserve(body);
    if (previous && key === "news.compose") {
      // Replay the paid first response locally. Only the previously blocked
      // verification is sent; native usage still counts toward this news budget.
      charge(previous.usage[0].usage);
      usage.push(previous.usage[0]);
      return { decision: "ARTICLE", duplicate_of: null, extraction: previous.result.extraction,
        draft: previous.result.attempts?.[0]?.original_draft ?? previous.result.draft };
    }
    // A byte-per-token bound plus framing is intentionally generous; provider
    // price ceilings prevent routing to a more expensive endpoint than budgeted.
    const maximumCost = (Buffer.byteLength(JSON.stringify({ messages: body.messages, response_format: body.response_format })) + 512) * inputPrice + body.max_completion_tokens * outputPrice;
    if (totalCost + maximumCost > costLimit) throw new Error("Diagnostic cost limit would be exceeded");
    body.provider.max_price = { prompt: inputPrice * 1_000_000, completion: outputPrice * 1_000_000 };
    calls += 1;
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", signal: AbortSignal.timeout(90_000),
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    charge(result.usage);
    if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}: ${String(result.error?.message ?? "Request rejected").slice(0, 500)}`);
    totalCost += Number(result.usage?.cost ?? 0);
    usage.push({ key, model: prompt.model, usage: result.usage });
    const content = result.choices?.[0]?.message?.content;
    try {
      return JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
    } catch {
      usage.at(-1).invalid_json = true;
      return null;
    }
  };
  const result = await runNewsEditorialPipeline({ source, context: previous?.result.context ?? selectedContext, candidates, request });
  const publishable = result.decision === "PASS" && Boolean(parseNewsEditorialMetadata(result.extraction)) &&
    isUsableRussianNewsPayload({ title: result.draft?.title_ru, summary: result.draft?.summary_ru, details: result.draft?.details_ru });
  await writeFile(`${folder}/${article.id}.json`, JSON.stringify({ result, usage, source_image_url: article.source_image_url }, null, 2));
  const entry = { id: article.id, decision: result.decision, publishable, title: result.draft?.title_ru, type: result.extraction?.article_type, issues: result.issues, calls: usage.length, tokens: tokenBudget.spent, words: result.draft?.details_ru?.split(/\s+/).length, candidates: candidates.length, source_image: Boolean(article.source_image_url) };
  summary.push(entry);
  console.log(JSON.stringify(entry));
  if (process.argv.includes("--negative-check") && publishable && !negativeCheck) {
    // This never becomes an article: verify an intentionally unsupported claim
    // without allowing edits, to prove the factual gate still blocks it.
    tokenBudget = createNewsTokenBudget();
    const startCalls = calls;
    const review = await request("news.verify", { source, context: result.context,
      draft: { title_ru: result.draft.title_ru, summary_ru: result.draft.summary_ru,
        paragraphs: [...newsDraftParagraphs(result.draft), "FIA официально отменила Гран-при Малайзии 2026 года после этих тренировок."] },
      hard_issues: [], editorial_suggestions: [], risk_hint: "normal", allow_edits: false });
    const foundFalseClaim = ["MANUAL_REVIEW", "REJECT"].includes(review?.decision) &&
      review.blocking_issues?.some(issue => /отмен/i.test(issue.excerpt ?? issue.draft_excerpt ?? "") && Boolean(issue.reason ?? issue.explanation_ru));
    negativeCheck = { decision: review?.decision, blocked: !verificationPasses(review) && Boolean(foundFalseClaim), calls: calls - startCalls,
      tokens: tokenBudget.spent, review };
    console.log(JSON.stringify({ negative_check: true, decision: negativeCheck.decision, blocked: negativeCheck.blocked }));
    await writeFile(`${folder}/negative-check.json`, JSON.stringify(negativeCheck, null, 2));
  }
  if (process.argv.includes("--duplicate-check") && result.decision === "PASS" && !duplicateCheckDone) {
    tokenBudget = createNewsTokenBudget();
    const startCalls = calls;
    const duplicate = await runNewsEditorialPipeline({ source: { ...source, name: "Another reporting source" }, context: result.context, request, candidates: [{ id: article.id, original_title: source.title, title: result.draft.title_ru, main_fact: result.extraction.main_fact, event_type: result.extraction.event_type, event_stage: result.extraction.event_stage, event_date: result.extraction.event_date }] });
    if (duplicate.decision !== "DUPLICATE" || calls - startCalls !== 1) throw new Error("Repeated event was not suppressed in one request");
    duplicateCheckDone = true;
    const duplicateEntry = { duplicate_of: article.id, decision: duplicate.decision, calls: calls - startCalls, tokens: tokenBudget.spent };
    summary.push(duplicateEntry);
    console.log(JSON.stringify(duplicateEntry));
  }
}
await writeFile(`${folder}/summary.json`, JSON.stringify({ summary, negativeCheck, totalCost, calls }, null, 2));
console.log(JSON.stringify({ totalCost, calls, folder }));
if (summary.some(entry => !["PASS", "DUPLICATE"].includes(entry.decision) || (entry.decision === "PASS" && !entry.publishable)) ||
    (process.argv.includes("--negative-check") && !negativeCheck?.blocked)) process.exitCode = 1;
