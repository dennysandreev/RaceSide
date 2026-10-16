import { createHash } from "node:crypto";

import rawCatalog from "../config/ai-prompts.json" with { type: "json" };
import type { AdminAiPromptDefinition } from "@/types/admin";

const PROMPT_KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const MODEL_PATTERN = /^[a-zA-Z0-9._:-]+\/[a-zA-Z0-9._:-]+$/;
const PLACEHOLDER_PATTERN = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

export const adminAiPromptCatalog = Object.freeze(
  rawCatalog as AdminAiPromptDefinition[],
);

const definitionsByKey = new Map(
  adminAiPromptCatalog.map((definition) => [definition.key, definition]),
);
export const adminTextAiModel = adminAiPromptCatalog[0].modelFallback;

export function getAdminAiPromptDefinition(promptKey: string) {
  return definitionsByKey.get(promptKey) ?? null;
}

export function validateAdminAiPromptCatalog() {
  const keys = new Set<string>();
  const purposes = new Set<string>();

  for (const definition of adminAiPromptCatalog) {
    if (!PROMPT_KEY_PATTERN.test(definition.key) || keys.has(definition.key)) {
      return { ok: false as const, message: `Некорректный ключ AI-задачи: ${definition.key}` };
    }
    if (!definition.purpose.trim() || !definition.title.trim() || !definition.description.trim()) {
      return { ok: false as const, message: `Не заполнено описание AI-задачи: ${definition.key}` };
    }
    if (!Number.isInteger(definition.maxTokens) || definition.maxTokens < 1) {
      return { ok: false as const, message: `Некорректный лимит ответа: ${definition.key}` };
    }
    const variableNames = definition.variables.map((variable) => variable.name);
    if (
      new Set(variableNames).size !== variableNames.length ||
      variableNames.some((name) => !/^[a-z][a-z0-9_]*$/.test(name))
    ) {
      return { ok: false as const, message: `Некорректные переменные AI-задачи: ${definition.key}` };
    }
    const validation = validateAdminAiPromptContent(
      definition,
      definition.defaultSystemPrompt,
      definition.defaultUserTemplate,
    );
    if (!validation.ok) return validation;
    keys.add(definition.key);
    purposes.add(definition.purpose);
  }

  return {
    ok: true as const,
    taskCount: keys.size,
    purposeCount: purposes.size,
  };
}

export function validateAdminAiPromptContent(
  definition: AdminAiPromptDefinition,
  systemPrompt: string,
  userTemplate: string,
):
  | { ok: true; systemPrompt: string; userTemplate: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> } {
  const normalizedSystemPrompt = systemPrompt.trim();
  const normalizedUserTemplate = userTemplate.trim();
  const fieldErrors: Record<string, string[]> = {};

  if (normalizedSystemPrompt.length < 20 || normalizedSystemPrompt.length > 20_000) {
    fieldErrors.systemPrompt = ["Инструкция должна содержать от 20 до 20 000 символов."];
  }
  if (normalizedUserTemplate.length < 3 || normalizedUserTemplate.length > 30_000) {
    fieldErrors.userTemplate = ["Шаблон задачи должен содержать от 3 до 30 000 символов."];
  }

  const systemVariables = extractPromptVariables(normalizedSystemPrompt);
  if (systemVariables.length) {
    fieldErrors.systemPrompt = [
      "Переменные можно использовать только в шаблоне задачи.",
    ];
  }

  const expectedVariables = definition.variables.map((variable) => variable.name).sort();
  const actualVariables = extractPromptVariables(normalizedUserTemplate).sort();
  const missingVariables = expectedVariables.filter((name) => !actualVariables.includes(name));
  const unexpectedVariables = actualVariables.filter((name) => !expectedVariables.includes(name));

  if (missingVariables.length || unexpectedVariables.length) {
    const messages = [];
    if (missingVariables.length) {
      messages.push(`Верни переменные: ${missingVariables.map(toPlaceholder).join(", ")}.`);
    }
    if (unexpectedVariables.length) {
      messages.push(`Убери неизвестные переменные: ${unexpectedVariables.map(toPlaceholder).join(", ")}.`);
    }
    fieldErrors.userTemplate = messages;
  }

  if (Object.keys(fieldErrors).length) {
    return {
      ok: false,
      message: "Проверь инструкцию и шаблон задачи.",
      fieldErrors,
    };
  }

  return {
    ok: true,
    systemPrompt: normalizedSystemPrompt,
    userTemplate: normalizedUserTemplate,
  };
}

export function validateAdminAiRuntime(
  model: string,
  maxTokens: number,
  availableModels?: ReadonlyArray<{
    id: string;
    maxCompletionTokens: number | null;
  }>,
  maxAllowedTokens = 32_768,
):
  | { ok: true; model: string; maxTokens: number }
  | { ok: false; message: string; fieldErrors: Record<string, string[]> } {
  const normalizedModel = model.trim();
  const fieldErrors: Record<string, string[]> = {};

  if (
    normalizedModel.length < 3 ||
    normalizedModel.length > 160 ||
    !MODEL_PATTERN.test(normalizedModel)
  ) {
    fieldErrors.model = ["Для всех текстовых задач используется GPT-6 Luna."];
  } else if (normalizedModel !== adminTextAiModel) {
    fieldErrors.model = ["Для всех текстовых задач используется GPT-6 Luna."];
  }
  if (!Number.isInteger(maxTokens) || maxTokens < 16 || maxTokens > maxAllowedTokens) {
    fieldErrors.maxTokens = [`Ответ может занимать от 16 до ${maxAllowedTokens.toLocaleString("ru-RU")} токенов.`];
  }

  if (availableModels?.length && !fieldErrors.model) {
    const selected = availableModels.find((item) => item.id === normalizedModel);

    if (!selected) {
      fieldErrors.model = ["Этой модели нет в доступном каталоге OpenRouter."];
    } else if (
      selected.maxCompletionTokens !== null &&
      maxTokens > selected.maxCompletionTokens
    ) {
      fieldErrors.maxTokens = [
        `Для этой модели доступно не больше ${selected.maxCompletionTokens.toLocaleString("ru-RU")} токенов ответа.`,
      ];
    }
  }

  if (Object.keys(fieldErrors).length) {
    return {
      ok: false,
      message: "Проверь модель и лимит ответа.",
      fieldErrors,
    };
  }

  return { ok: true, model: normalizedModel, maxTokens };
}

export function makeAdminAiPromptChecksum(input: {
  promptKey: string;
  systemPrompt: string;
  userTemplate: string;
  model: string;
  maxTokens: number;
}) {
  return createHash("sha256")
    .update(JSON.stringify([
      input.promptKey,
      input.systemPrompt,
      input.userTemplate,
      input.model,
      input.maxTokens,
    ]))
    .digest("hex");
}

export function extractPromptVariables(template: string) {
  const names = new Set<string>();
  let match: RegExpExecArray | null;
  PLACEHOLDER_PATTERN.lastIndex = 0;

  while ((match = PLACEHOLDER_PATTERN.exec(template)) !== null) {
    names.add(match[1]);
  }

  return [...names];
}

function toPlaceholder(name: string) {
  return `{{${name}}}`;
}
