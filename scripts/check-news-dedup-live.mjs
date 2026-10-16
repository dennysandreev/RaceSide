// Opt-in cross-source regression. Public F1 articles only; no database writes.
import { mkdir, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { resolveWorkerAiPrompt } from "../worker/ai-prompt-registry.mjs";
import { loadNewsContext, selectNewsContext } from "../worker/news-context.mjs";
import { runNewsEditorialPipeline } from "../worker/news-editorial.mjs";
import { newsResponseFormat, newsRequestOptions } from "../worker/news-response-format.mjs";
import { createNewsTokenBudget } from "../worker/news-token-budget.mjs";
import { extractNewsSourceHtml } from "../worker/news-source-text.mjs";

if (!process.argv.includes("--run")) {
  console.log("Pass --run to check public cross-source duplicates. No articles are published.");
  process.exit(0);
}
const incomingId = "fe120f9e-d203-4de1-af08-254ade514318"; // The Race announcement.
const candidateIds = ["9521b484-a0e4-45f2-9152-f6ead31d36d8", "2cafef07-ded0-4b45-87b4-b88e7e762d55"];
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: articles, error } = await db.from("news_articles").select("id,publication_status,canonical_url,original_title,original_description,source_published_at,main_fact,event_type,event_stage,event_date,ai_title_ru,news_sources(name)")
  .in("id", [incomingId, ...candidateIds]);
if (error) throw error;
const incoming = articles?.find(article => article.id === incomingId);
if (!incoming || articles.length !== 3 || articles.some(article => article.id !== incomingId && article.publication_status !== "published")) throw new Error("The public-source fixtures or published candidates are unavailable");
const page = await fetch(incoming.canonical_url, { signal: AbortSignal.timeout(20_000) });
if (!page.ok) throw new Error(`Public source HTTP ${page.status}`);
const source = { url: incoming.canonical_url, title: incoming.original_title, description: incoming.original_description,
  text: extractNewsSourceHtml(await page.text()).slice(0, 12_000), name: incoming.news_sources.name, authors: [],
  published_at: incoming.source_published_at, coverage: "article" };
const context = selectNewsContext(await loadNewsContext(db, { season: new Date().getUTCFullYear() }), source, []);
const noOverrides = { from: () => ({ select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, async maybeSingle() { return { data: null }; } }) };
let totalCost = 0;
let calls = 0;
const checks = [];
for (const candidateId of candidateIds) {
  const article = articles.find(article => article.id === candidateId);
  const candidate = { id: article.id, original_title: article.original_title, title: article.ai_title_ru,
    main_fact: article.main_fact, event_type: article.event_type, event_stage: article.event_stage, event_date: article.event_date };
  const budget = createNewsTokenBudget();
  const beforeCalls = calls;
  const request = async (key, payload) => {
    if (++calls > 4 || totalCost > 0.10) throw new Error("Diagnostic limit reached");
    const prompt = await resolveWorkerAiPrompt({ client: noOverrides, promptKey: key, variables: { payload_json: JSON.stringify(payload) } });
    const body = { model: prompt.model, ...newsRequestOptions(key), max_completion_tokens: prompt.maxTokens,
      response_format: newsResponseFormat(key), messages: [{ role: "system", content: prompt.systemPrompt }, { role: "user", content: prompt.userPrompt }] };
    const charge = budget.reserve(body);
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", signal: AbortSignal.timeout(90_000),
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    charge(result.usage);
    totalCost += Number(result.usage?.cost ?? 0);
    if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}`);
    return JSON.parse(result.choices[0].message.content);
  };
  const result = await runNewsEditorialPipeline({ source, context, candidates: [candidate], request });
  const check = { source: source.name, candidate_source: article.news_sources.name, candidate_event_type: article.event_type,
    decision: result.decision, duplicate_of: result.duplicate?.duplicateOf, calls: calls - beforeCalls, tokens: budget.spent };
  checks.push(check);
  console.log(JSON.stringify(check));
  if (result.decision !== "DUPLICATE" || calls - beforeCalls !== 1) throw new Error("Repeated announcement was not suppressed");
}
await mkdir("/tmp/raceside-editorial-luna-sources", { recursive: true });
await writeFile("/tmp/raceside-editorial-luna-sources/cross-source.json", JSON.stringify({ checks, totalCost }, null, 2));
console.log(JSON.stringify({ totalCost, calls }));
