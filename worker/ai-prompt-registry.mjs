import { readFileSync } from "node:fs";

const catalog = JSON.parse(
  readFileSync(new URL("../src/config/ai-prompts.json", import.meta.url), "utf8"),
);
const definitions = new Map(catalog.map((definition) => [definition.key, definition]));
export const TEXT_AI_MODEL = catalog[0].modelFallback;
if (catalog.some(definition => definition.modelFallback !== TEXT_AI_MODEL)) {
  throw new Error("Text AI tasks must use the shared model");
}

export function textAiRequestOptions() {
  return { reasoning: { effort: "none", exclude: true } };
}
const placeholderPattern = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;
const publishedPromptCache = new Map();
const cacheTtlMs = 60_000;

export function getWorkerAiPromptDefinition(promptKey) {
  return definitions.get(promptKey) ?? null;
}

export function validateWorkerAiPromptContent(definition, systemPrompt, userTemplate) {
  const normalizedSystemPrompt = normalizeString(systemPrompt);
  const normalizedUserTemplate = normalizeString(userTemplate);

  if (
    !definition ||
    !normalizedSystemPrompt ||
    normalizedSystemPrompt.length < 20 ||
    normalizedSystemPrompt.length > 20_000 ||
    !normalizedUserTemplate ||
    normalizedUserTemplate.length > 30_000
  ) {
    return { ok: false, reason: "invalid_prompt_length" };
  }

  if (extractVariables(normalizedSystemPrompt).length) {
    return { ok: false, reason: "system_prompt_has_variables" };
  }

  const expected = definition.variables.map((variable) => variable.name).sort();
  const actual = extractVariables(normalizedUserTemplate).sort();

  if (
    expected.length !== actual.length ||
    expected.some((name, index) => name !== actual[index])
  ) {
    return { ok: false, reason: "invalid_template_variables" };
  }

  return {
    ok: true,
    systemPrompt: normalizedSystemPrompt,
    userTemplate: normalizedUserTemplate,
  };
}

export async function resolveWorkerAiPrompt({
  client,
  promptKey,
  variables,
  now = Date.now(),
}) {
  const definition = getWorkerAiPromptDefinition(promptKey);

  if (!definition) {
    throw new Error(`Unknown AI prompt: ${promptKey}`);
  }

  assertRuntimeVariables(definition, variables);
  const published = await loadPublishedPrompt(client, definition, now);
  const selected = published ?? {
    id: null,
    version: null,
    system_prompt: definition.defaultSystemPrompt,
    user_template: definition.defaultUserTemplate,
    model: definition.modelFallback,
    max_tokens: definition.maxTokens,
    source: "default",
  };
  const validation = validateWorkerAiPromptContent(
    definition,
    selected.system_prompt,
    selected.user_template,
  );
  const effective = validation.ok
    ? {
      systemPrompt: validation.systemPrompt,
      userTemplate: validation.userTemplate,
      promptVersionId: selected.id,
      promptVersion: selected.version,
      source: selected.source,
      // Persisted prompt versions cannot silently restore a retired model.
      model: TEXT_AI_MODEL,
      maxTokens: Math.min(normalizeMaxTokens(selected.max_tokens) ?? definition.maxTokens, definition.maxTokens),
    }
    : {
      systemPrompt: definition.defaultSystemPrompt,
      userTemplate: definition.defaultUserTemplate,
      promptVersionId: null,
      promptVersion: null,
      source: "default",
      model: definition.modelFallback,
      maxTokens: definition.maxTokens,
    };

  return {
    key: definition.key,
    purpose: definition.purpose,
    promptVersionId: effective.promptVersionId,
    promptVersion: effective.promptVersion,
    source: effective.source,
    model: effective.model,
    maxTokens: effective.maxTokens,
    systemPrompt: `${effective.systemPrompt}\n\n${definition.protectedInstruction}`,
    userPrompt: renderTemplate(effective.userTemplate, variables),
  };
}

export function clearWorkerAiPromptCache() {
  publishedPromptCache.clear();
}

async function loadPublishedPrompt(client, definition, now) {
  const cached = publishedPromptCache.get(definition.key);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  let value = null;

  try {
    const { data, error } = await client
      .from("ai_prompt_versions")
      .select("id, prompt_key, version, status, system_prompt, user_template, model, max_tokens")
      .eq("prompt_key", definition.key)
      .eq("status", "published")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      const validation = validateWorkerAiPromptContent(
        definition,
        data.system_prompt,
        data.user_template,
      );
      if (validation.ok) {
        value = {
          ...data,
          system_prompt: validation.systemPrompt,
          user_template: validation.userTemplate,
          source: "published",
        };
      }
    }
  } catch {
    value = null;
  }

  publishedPromptCache.set(definition.key, {
    expiresAt: now + cacheTtlMs,
    value,
  });
  return value;
}

function assertRuntimeVariables(definition, variables) {
  const input = isRecord(variables) ? variables : {};
  const missing = definition.variables
    .map((variable) => variable.name)
    .filter((name) => !Object.hasOwn(input, name));

  if (missing.length) {
    throw new Error(`Missing AI prompt variables for ${definition.key}: ${missing.join(", ")}`);
  }
}

function renderTemplate(template, variables) {
  placeholderPattern.lastIndex = 0;
  return template.replace(placeholderPattern, (_, name) => stringifyVariable(variables[name]));
}

function stringifyVariable(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function extractVariables(template) {
  const result = new Set();
  let match = null;
  placeholderPattern.lastIndex = 0;

  while ((match = placeholderPattern.exec(template)) !== null) {
    result.add(match[1]);
  }

  return [...result];
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeMaxTokens(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 16 && parsed <= 32_768
    ? parsed
    : null;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
