"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { finishAdminAudit, startAdminAudit } from "@/lib/admin-audit";
import { parseMoscowPaymentDate } from "@/lib/admin-billing-policy";
import { cancelUserLavaSubscription } from "@/lib/billing/repository";
import {
  getAdminAiPromptDefinition,
  makeAdminAiPromptChecksum,
  validateAdminAiPromptContent,
  validateAdminAiRuntime,
} from "@/lib/admin-ai-prompts";
import { getAdminJobDefinition, makeAdminJobRequestKey, validateAdminJobRequest } from "@/lib/admin-job-catalog";
import { enqueueAdminJob } from "@/lib/admin-jobs-server";
import { canTransitionAdminStatus } from "@/lib/admin-policies";
import { requireAdmin } from "@/lib/auth";
import { getSubscriptionAccess, invalidateSubscriptionAccess } from "@/lib/billing/access";
import { parseMinorUnits } from "@/lib/billing/money";
import { normalizeDailyDigestBody } from "@/lib/daily-digest-content";
import { loadOpenRouterModels } from "@/lib/openrouter-models";
import { NEWS_ARTICLE_TYPE_OPTIONS } from "@/lib/news-editorial";
import { consumeRateLimit } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { AdminActionResult } from "@/types/admin";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function transitionAdminFindingAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const findingId = uuid(formData, "findingId");
  const status = enumValue(formData, "status", ["acknowledged", "resolved", "ignored"]);
  const resolution = optionalText(formData, "resolution", 1_000);

  if (!admin || !findingId || !status) return { ok: false, message: "Находка не найдена." };
  const { data: before, error } = await admin
    .from("admin_findings")
    .select("id, status, severity, title")
    .eq("id", findingId)
    .maybeSingle();
  if (error || !before) return { ok: false, message: "Находка не найдена." };
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: `finding.${status}`,
    entityType: "admin_finding",
    entityId: findingId,
    beforeData: before,
  });

  try {
    const { error: transitionError } = await admin.rpc("transition_admin_finding", {
      p_finding_id: findingId,
      p_status: status,
      p_actor_kind: "human",
      p_actor_user_id: user.id,
      p_resolution: resolution,
    });
    if (transitionError) throw transitionError;
    await finishAdminAudit(admin, auditId, {
      outcome: "succeeded",
      afterData: { status, resolution },
    });
    revalidateAdminPaths(["/admin", "/admin/findings"]);
    return {
      ok: true,
      message: status === "acknowledged"
        ? "Находка принята в работу."
        : status === "resolved"
          ? "Находка отмечена как исправленная."
          : "Находка больше не требует действий.",
    };
  } catch (transitionError) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error: transitionError });
    return actionError(transitionError, "Не удалось обновить находку.");
  }
}

export async function saveAdminAgentSettingsAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const mode = enumValue(formData, "mode", ["shadow", "recommend"]);
  const isEnabled = text(formData, "isEnabled", 8) === "true";
  const telegramAlertsEnabled = text(formData, "telegramAlertsEnabled", 8) === "true";

  if (!admin || !mode) return { ok: false, message: "Проверь настройки наблюдения." };
  const { data: before, error } = await admin
    .from("admin_agent_settings")
    .select("is_enabled, mode, telegram_alerts_enabled, r2_actions_enabled, shadow_started_at")
    .eq("singleton", true)
    .single();
  if (error) return { ok: false, message: "Настройки наблюдения недоступны." };
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "agent.settings.update",
    entityType: "admin_agent_settings",
    entityId: "singleton",
    beforeData: before,
  });
  const update = {
    is_enabled: isEnabled,
    mode,
    telegram_alerts_enabled: telegramAlertsEnabled,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };
  const { error: updateError } = await admin
    .from("admin_agent_settings")
    .update(update)
    .eq("singleton", true);

  if (updateError) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error: updateError });
    return actionError(updateError, "Не удалось сохранить настройки.");
  }
  await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: update });
  revalidateAdminPaths(["/admin/findings"]);
  return {
    ok: true,
    message: isEnabled ? "Наблюдение включено." : "Наблюдение остановлено.",
  };
}

export async function runAdminJobAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();

  if (!admin) return { ok: false, message: "Серверный клиент недоступен." };
  const jobName = text(formData, "jobName", 120);
  const definition = getAdminJobDefinition(jobName);
  const rateLimit = consumeRateLimit("admin:queue-job", `user:${user.id}`, 12, 60_000);

  if (!definition) return { ok: false, message: "Эту задачу нельзя запускать из админки." };
  if (!rateLimit.ok) return { ok: false, message: "Слишком много запусков. Подожди минуту." };

  const args = Object.fromEntries(
    definition.parameters
      .map((parameter) => [parameter.name, formData.get(parameter.name)])
      .filter(([, value]) => value !== null && value !== ""),
  );
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "job.enqueue",
    entityType: "job",
    entityId: jobName,
    metadata: { args },
  });

  try {
    const queued = await enqueueAdminJob(admin, {
      args,
      jobName,
      requestedBy: user.id,
      requestKey: text(formData, "requestKey", 120) || undefined,
    });

    if (!queued.ok) {
      await finishAdminAudit(admin, auditId, { outcome: "failed", error: queued.message });
      return { ok: false, message: queued.message };
    }
    await finishAdminAudit(admin, auditId, {
      outcome: "succeeded",
      afterData: { jobRunId: queued.jobRunId },
    });
    revalidateAdminPaths(["/admin", "/admin/jobs"]);
    return {
      ok: true,
      message: `«${queued.definition.title}» добавлена в очередь.`,
      data: { jobRunId: queued.jobRunId },
    };
  } catch (error) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error });
    return actionError(error, "Не удалось добавить задачу в очередь.");
  }
}

export async function retryAdminJobAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const jobRunId = uuid(formData, "jobRunId");

  if (!admin || !jobRunId) return { ok: false, message: "Запуск не найден." };
  const { data: previous, error } = await admin
    .from("job_runs")
    .select("id, job_name, status, metadata, queue_version")
    .eq("id", jobRunId)
    .maybeSingle();

  if (error || !previous) return { ok: false, message: "Запуск не найден." };
  if (previous.status !== "failed" && !(previous.status === "queued" && previous.queue_version !== 1)) {
    return { ok: false, message: "Повтор доступен только для ошибки или прежнего запроса." };
  }
  const args = isRecord(previous.metadata) && isRecord(previous.metadata.args)
    ? previous.metadata.args
    : {};
  const validation = validateAdminJobRequest(previous.job_name, args);
  if (!validation.ok) return { ok: false, message: "Эта команда или её параметры больше недоступны. Выбери текущую задачу в каталоге." };
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "job.retry",
    entityType: "job_run",
    entityId: jobRunId,
    beforeData: { status: previous.status, jobName: previous.job_name },
  });

  try {
    let queuedJobId: string;
    if (previous.job_name === "telemetry.prepare") {
      const { data, error: retryError } = await admin.rpc("admin_retry_telemetry_task", {
        p_task_id: String(validation.args.taskId), p_previous_job_id: previous.id, p_actor_user_id: user.id,
      });
      if (retryError || !data) throw retryError ?? new Error("Запрос уже изменился. Обнови страницу.");
      queuedJobId = data;
    } else {
      const queued = await enqueueAdminJob(admin, {
        args: validation.args, jobName: previous.job_name, requestedBy: user.id, retryOf: previous.id,
      });
      if (!queued.ok) throw new Error(queued.message);
      queuedJobId = queued.jobRunId;
    }
    await finishAdminAudit(admin, auditId, {
      outcome: "succeeded",
      afterData: { jobRunId: queuedJobId },
    });
    revalidateAdminPaths(["/admin", "/admin/jobs", "/admin/systems"]);
    return { ok: true, message: "Повтор добавлен в очередь." };
  } catch (retryError) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error: retryError });
    return actionError(retryError, "Не удалось повторить задачу.");
  }
}

export async function saveNewsArticleAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const articleId = uuid(formData, "articleId");
  const publicationStatus = enumValue(formData, "publicationStatus", ["draft", "published", "rejected"]);
  const title = optionalText(formData, "title", 240);
  const summary = optionalText(formData, "summary", 1_500);
  const body = optionalText(formData, "body", 20_000);
  const tagNames = parseTags(text(formData, "tags", 800));
  const articleType = enumValue(formData, "articleType", NEWS_ARTICLE_TYPE_OPTIONS);
  const sourceAuthors = [...new Set(text(formData, "sourceAuthors", 800).split(",").map(value => value.trim()).filter(Boolean))].slice(0, 8);

  if (!admin || !articleId || !publicationStatus || !articleType) {
    return { ok: false, message: "Проверь материал и выбранное действие." };
  }
  if (publicationStatus === "published" && (!title || !summary || !body)) {
    return { ok: false, message: "Для публикации нужны заголовок, лид и текст статьи." };
  }
  const { data: before, error } = await admin
    .from("news_articles")
    .select("id, slug, ai_title_ru, ai_summary_ru, ai_summary_long_ru, publication_status, published_at, editorial_meta")
    .eq("id", articleId)
    .maybeSingle();
  if (error || !before) return { ok: false, message: "Материал не найден." };
  const currentEditorialStatus = ["draft", "published", "rejected"].includes(before.publication_status)
    ? before.publication_status
    : "draft";
  if (!canTransitionAdminStatus("news", currentEditorialStatus, publicationStatus)) {
    return { ok: false, message: "Такое изменение состояния материала не разрешено." };
  }
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "news.update",
    entityType: "news_article",
    entityId: articleId,
    beforeData: before,
  });

  try {
    const { error: updateError } = await admin.rpc("admin_save_news_article_editorial", {
      p_actor_user_id: user.id,
      p_article_id: articleId,
      p_body: body,
      p_now: new Date().toISOString(),
      p_publication_status: publicationStatus,
      p_summary: summary,
      p_tag_names: tagNames,
      p_title: title,
      p_article_type: articleType,
      p_source_authors: sourceAuthors,
    });
    if (updateError) throw updateError;
    await finishAdminAudit(admin, auditId, {
      outcome: "succeeded",
      afterData: { publicationStatus, title, summary, body, tagNames, articleType, sourceAuthors, slug: before.slug },
    });
    revalidateAdminPaths(["/admin", "/admin/news", "/news", `/news/${before.slug}`]);
    return {
      ok: true,
      message: publicationStatus === "published"
        ? "Материал опубликован."
        : publicationStatus === "draft"
          ? "Черновик сохранён."
          : "Материал отклонён.",
    };
  } catch (saveError) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error: saveError });
    return actionError(saveError, "Не удалось сохранить материал.");
  }
}

export async function hideNewsArticleAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const articleId = uuid(formData, "articleId");
  if (!admin || !articleId) return { ok: false, message: "Материал не найден." };
  const { data: before, error } = await admin
    .from("news_articles")
    .select("id, slug, publication_status, published_at")
    .eq("id", articleId)
    .maybeSingle();
  if (error || !before) return { ok: false, message: "Материал не найден." };
  if (before.publication_status !== "published") {
    return { ok: false, message: "Материал уже не показывается в ленте." };
  }
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "news.hide",
    entityType: "news_article",
    entityId: articleId,
    beforeData: before,
  });
  const { data: updated, error: updateError } = await admin
    .from("news_articles")
    .update({ publication_status: "draft", updated_at: new Date().toISOString() })
    .eq("id", articleId)
    .eq("publication_status", "published")
    .select("id")
    .maybeSingle();
  if (updateError || !updated) {
    await finishAdminAudit(admin, auditId, {
      outcome: "failed",
      error: updateError ?? "Материал изменился до снятия с публикации.",
    });
    return updateError
      ? actionError(updateError, "Не удалось убрать материал из ленты.")
      : { ok: false, message: "Материал уже изменился. Обнови страницу и попробуй снова." };
  }
  await finishAdminAudit(admin, auditId, {
    outcome: "succeeded",
    afterData: { publicationStatus: "draft", slug: before.slug },
  });
  revalidateAdminPaths(["/admin", "/admin/news", "/news", `/news/${before.slug}`, "/"]);
  return { ok: true, message: "Материал убран из ленты. Его можно опубликовать снова." };
}

export async function publishDuplicateNewsAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const articleId = uuid(formData, "articleId");
  if (!admin || !articleId) return { ok: false, message: "Материал не найден." };

  const { data: before, error } = await admin
    .from("news_articles")
    .select("id, slug, publication_status, duplicate_of, duplicate_confidence, duplicate_relation, duplicate_reason, dedup_decision_history, ai_title_ru, ai_summary_ru, ai_summary_long_ru")
    .eq("id", articleId)
    .maybeSingle();
  if (error || !before) return { ok: false, message: "Материал не найден." };
  if (before.publication_status !== "duplicate") {
    return { ok: false, message: "Материал уже не отмечен как дубль." };
  }
  if (!before.ai_title_ru || !before.ai_summary_ru || !before.ai_summary_long_ru) {
    return { ok: false, message: "Сначала пересобери текст этого источника или подготовь отдельную статью в редакторе." };
  }

  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "news.duplicate.publish",
    entityType: "news_article",
    entityId: articleId,
    beforeData: before,
  });
  const publishedAt = new Date().toISOString();
  const previousHistory = Array.isArray(before.dedup_decision_history)
    ? before.dedup_decision_history
    : [];
  const previousDecision = {
    duplicateOf: before.duplicate_of,
    confidence: before.duplicate_confidence,
    relation: before.duplicate_relation,
    reason: before.duplicate_reason,
    overriddenAt: publishedAt,
    overriddenBy: user.id,
  };

  try {
    const { data: updated, error: updateError } = await admin
      .from("news_articles")
      .update({
        publication_status: "published",
        status: "processed",
        dedup_status: "unique",
        published_at: publishedAt,
        duplicate_of: null,
        duplicate_confidence: null,
        duplicate_relation: null,
        duplicate_reason: null,
        published_manually: true,
        manual_published_at: publishedAt,
        manual_published_by: user.id,
        dedup_decision_history: [...previousHistory.slice(-19), previousDecision],
        updated_at: publishedAt,
      })
      .eq("id", articleId)
      .eq("publication_status", "duplicate")
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      await finishAdminAudit(admin, auditId, {
        outcome: "failed",
        error: "Материал изменился до публикации.",
      });
      return { ok: false, message: "Материал уже изменился. Обнови страницу и попробуй снова." };
    }

    const { error: decisionError } = await admin.from("news_dedup_decisions").insert({
      article_id: articleId,
      duplicate_of: before.duplicate_of,
      candidate_count: before.duplicate_of ? 1 : 0,
      is_duplicate: false,
      confidence: before.duplicate_confidence,
      relation: before.duplicate_relation,
      reason: "Редактор опубликовал материал вручную.",
      dedup_status: "unique",
      publication_status: "published",
      decision_source: "manual_override",
    });
    await finishAdminAudit(admin, auditId, {
      outcome: "succeeded",
      afterData: { publicationStatus: "published", slug: before.slug },
      metadata: {
        dedupDecisionRecorded: !decisionError,
        ...(decisionError ? { dedupDecisionError: decisionError.message } : {}),
      },
    });
    revalidateAdminPaths(["/admin", "/admin/news", "/news", `/news/${before.slug}`, "/"]);
    return { ok: true, message: "Дубль опубликован как отдельный материал." };
  } catch (publishError) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error: publishError });
    return actionError(publishError, "Не удалось опубликовать дубль.");
  }
}

export async function reprocessNewsArticleAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const articleId = uuid(formData, "articleId");
  const mode = enumValue(formData, "mode", ["ai", "dedup"]);

  if (!admin || !articleId || !mode) return { ok: false, message: "Материал не найден." };
  const jobName = mode === "ai" ? "ai.process_news" : "news.retry_dedup";
  const { data: before, error: readError } = await admin
    .from("news_articles")
    .select("status, publication_status, duplicate_of, dedup_status, raw_payload")
    .eq("id", articleId)
    .maybeSingle();
  if (readError || !before) return { ok: false, message: "Материал не найден." };
  if (mode === "dedup" && before.raw_payload && typeof before.raw_payload === "object" && !Array.isArray(before.raw_payload) && before.raw_payload.aiFailureReason === "editorial_review_required") {
    return { ok: false, message: "Сначала проверь факты или пересобери текст. Проверка дублей не заменяет редакционную проверку." };
  }
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: mode === "ai" ? "news.reprocess_ai" : "news.reprocess_dedup",
    entityType: "news_article",
    entityId: articleId,
    beforeData: before,
  });
  let articleUpdated = false;

  try {
    const { error } = await admin
      .from("news_articles")
      .update(
        mode === "ai"
          ? { status: "pending", publication_status: "processing", duplicate_of: null }
          : { status: "processed", publication_status: "processing_dedup", dedup_status: "pending" },
      )
      .eq("id", articleId);
    if (error) throw error;
    articleUpdated = true;
    const queued = await enqueueAdminJob(admin, {
      args: { articleId },
      jobName,
      requestedBy: user.id,
    });
    if (!queued.ok) throw new Error(queued.message);
    await finishAdminAudit(admin, auditId, {
      outcome: "succeeded",
      afterData: { jobRunId: queued.jobRunId },
    });
    revalidateAdminPaths(["/admin/news", "/admin/jobs"]);
    return { ok: true, message: "Материал добавлен в повторную обработку." };
  } catch (reprocessError) {
    if (articleUpdated) {
      await admin
        .from("news_articles")
        .update(before)
        .eq("id", articleId);
    }
    await finishAdminAudit(admin, auditId, { outcome: "failed", error: reprocessError });
    return actionError(reprocessError, "Не удалось запустить повторную обработку.");
  }
}

export async function toggleNewsSourceAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const sourceId = uuid(formData, "sourceId");
  if (!admin || !sourceId) return { ok: false, message: "Источник не найден." };
  const { data: source } = await admin.from("news_sources").select("id, name, is_active").eq("id", sourceId).maybeSingle();
  if (!source) return { ok: false, message: "Источник не найден." };
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: source.is_active ? "news_source.pause" : "news_source.resume",
    entityType: "news_source",
    entityId: sourceId,
    beforeData: source,
  });
  const { error } = await admin.from("news_sources").update({ is_active: !source.is_active }).eq("id", sourceId);
  if (error) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error });
    return actionError(error, "Не удалось изменить источник.");
  }
  await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { isActive: !source.is_active } });
  revalidateAdminPaths(["/admin", "/admin/news"]);
  return { ok: true, message: source.is_active ? "Источник поставлен на паузу." : "Источник включён." };
}

export async function moderateSocialPostAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const postId = uuid(formData, "postId");
  const action = enumValue(formData, "moderationAction", ["publish", "reject", "retry"]);
  const topic = enumValue(formData, "topic", [
    "social-race-weekend",
    "social-technical",
    "social-transfers",
    "social-statements",
    "social-incidents",
    "social-rumors",
    "social-discussion",
  ]);
  if (!admin || !postId || !action) return { ok: false, message: "Публикация не найдена." };
  const { data: before } = await admin.from("social_posts").select("id, status, platform, ai_title_ru").eq("id", postId).maybeSingle();
  if (!before) return { ok: false, message: "Публикация не найдена." };
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: `social.${action}`,
    entityType: "social_post",
    entityId: postId,
    beforeData: before,
  });

  try {
    const topicNames: Record<string, string> = {
      "social-race-weekend": "Этап и результаты",
      "social-technical": "Техника и регламент",
      "social-transfers": "Трансферы и контракты",
      "social-statements": "Комментарии команд и гонщиков",
      "social-incidents": "Инциденты и штрафы",
      "social-rumors": "Слухи",
      "social-discussion": "Обсуждения",
    };
    const { error } = await admin.rpc("admin_moderate_social_post", {
      p_action: action,
      p_actor_user_id: user.id,
      p_now: new Date().toISOString(),
      p_post_id: postId,
      p_request_key: makeAdminJobRequestKey({
        args: { postId },
        jobName: "social.process_ai",
        requestedBy: user.id,
      }),
      p_topic_name: topic ? topicNames[topic] : null,
      p_topic_slug: topic,
    });
    if (error) throw error;
    await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { action, topic } });
    revalidateAdminPaths(["/admin", "/admin/social", "/social"]);
    return { ok: true, message: action === "publish" ? "Публикация вышла в ленту." : action === "reject" ? "Публикация отклонена." : "Повторная обработка запущена." };
  } catch (moderationError) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error: moderationError });
    return actionError(moderationError, "Не удалось обработать публикацию.");
  }
}

export async function hideSocialPostAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const postId = uuid(formData, "postId");
  if (!admin || !postId) return { ok: false, message: "Публикация не найдена." };
  const { data: before, error } = await admin
    .from("social_posts")
    .select("id, status, platform, ai_title_ru")
    .eq("id", postId)
    .maybeSingle();
  if (error || !before) return { ok: false, message: "Публикация не найдена." };
  if (before.status !== "published") {
    return { ok: false, message: "Публикация уже не показывается в ленте." };
  }
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "social.hide",
    entityType: "social_post",
    entityId: postId,
    beforeData: before,
  });
  const { data: updated, error: updateError } = await admin
    .from("social_posts")
    .update({ status: "rejected", next_retry_at: null, updated_at: new Date().toISOString() })
    .eq("id", postId)
    .eq("status", "published")
    .select("id")
    .maybeSingle();
  if (updateError || !updated) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error: updateError });
    return updateError
      ? actionError(updateError, "Не удалось убрать публикацию из ленты.")
      : { ok: false, message: "Публикация уже изменилась. Обнови страницу и попробуй снова." };
  }
  await finishAdminAudit(admin, auditId, {
    outcome: "succeeded",
    afterData: { status: "rejected" },
  });
  revalidateAdminPaths(["/admin", "/admin/social", "/social", "/"]);
  return { ok: true, message: "Публикация убрана из ленты. Её можно опубликовать снова." };
}

export async function saveSocialSourceAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const platform = enumValue(formData, "platform", ["x", "reddit", "telegram"]);
  const name = text(formData, "name", 120);
  const rawUrl = text(formData, "url", 2_048);
  const externalKey = text(formData, "externalKey", 160).replace(/^@/, "");
  const publicationMode = enumValue(formData, "publicationMode", ["auto", "review"]) ?? "review";
  const interval = clampNumber(text(formData, "fetchIntervalMinutes", 10), 5, 1_440, 15);

  if (!admin || !platform || !name || !externalKey) {
    return { ok: false, message: "Проверь площадку, название и адрес источника." };
  }
  const url = normalizeSocialSourceUrl(platform, rawUrl, externalKey);
  if (!url) return { ok: false, message: "Адрес источника не похож на рабочую ссылку." };
  const adapter = platform === "x"
    ? "x-api-user"
    : platform === "reddit"
      ? "reddit-oauth"
      : "telegram-mtproto";
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "social_source.save",
    entityType: "social_source",
    metadata: { platform, name, url, publicationMode, interval },
  });
  try {
    const { data, error } = await admin.from("social_sources").upsert({
      platform,
      name,
      url,
      external_key: externalKey,
      adapter,
      source_type: "api",
      feed_kind: platform === "reddit" ? "new" : platform === "x" ? "user" : "channel",
      trust_level: platform === "reddit" ? "community" : "media",
      publication_mode: publicationMode,
      fetch_interval_minutes: interval,
      initial_backfill_days: 30,
      include_reposts: formData.get("includeReposts") === "on",
      include_replies: formData.get("includeReplies") === "on",
      next_fetch_at: new Date().toISOString(),
      is_active: true,
    }, { onConflict: "platform,url" }).select("id").single();
    if (error) throw error;
    await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { sourceId: data.id } });
    revalidateAdminPaths(["/admin", "/admin/social"]);
    return { ok: true, message: "Источник сохранён." };
  } catch (sourceError) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error: sourceError });
    return actionError(sourceError, "Не удалось сохранить источник.");
  }
}

export async function toggleSocialSourceAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const sourceId = uuid(formData, "sourceId");
  if (!admin || !sourceId) return { ok: false, message: "Источник не найден." };
  const { data: source } = await admin.from("social_sources").select("id, platform, name, is_active").eq("id", sourceId).maybeSingle();
  if (!source) return { ok: false, message: "Источник не найден." };
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: source.is_active ? "social_source.pause" : "social_source.resume",
    entityType: "social_source",
    entityId: sourceId,
    beforeData: source,
  });
  const { error } = await admin.from("social_sources").update({ is_active: !source.is_active }).eq("id", sourceId);
  if (error) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error });
    return actionError(error, "Не удалось изменить источник.");
  }
  await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { isActive: !source.is_active } });
  revalidateAdminPaths(["/admin", "/admin/social", "/social"]);
  return { ok: true, message: source.is_active ? "Источник поставлен на паузу." : "Источник включён." };
}

export async function addManualXPostAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const url = normalizeHttpsUrl(text(formData, "url", 2_048));
  const author = optionalText(formData, "author", 100);
  const title = optionalText(formData, "title", 500);
  const imageUrl = normalizeHttpsUrl(text(formData, "imageUrl", 2_048)) || null;
  if (!admin || !url || !isXUrl(url)) return { ok: false, message: "Нужна ссылка на публикацию в X." };
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "social.manual_x",
    entityType: "social_post",
    metadata: { url, author, title, imageUrl },
  });
  try {
    const { data: source, error: sourceError } = await admin.from("social_sources").upsert({
      platform: "x",
      name: "Ручные публикации X",
      source_type: "manual",
      url: "manual:x",
      adapter: "manual",
      feed_kind: "manual",
      is_active: true,
    }, { onConflict: "platform,url" }).select("id").single();
    if (sourceError) throw sourceError;
    const { data: post, error } = await admin.from("social_posts").upsert({
      platform: "x",
      source_id: source.id,
      external_id: url.match(/\/status\/(\d+)/i)?.[1] ?? url,
      author,
      title: title ?? "Публикация из X",
      body: title,
      original_url: url,
      image_url: imageUrl,
      published_at: new Date().toISOString(),
      popularity_score: 0,
      status: "review",
      last_synced_at: new Date().toISOString(),
    }, { onConflict: "platform,external_id" }).select("id").single();
    if (error) throw error;
    await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { postId: post.id } });
    revalidateAdminPaths(["/admin/social", "/social"]);
    return { ok: true, message: "Публикация добавлена на проверку." };
  } catch (postError) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error: postError });
    return actionError(postError, "Не удалось добавить публикацию.");
  }
}

export async function saveGrandPrixReportAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const reportId = uuid(formData, "reportId");
  const summary = optionalText(formData, "summary", 8_000);
  const isHidden = formData.get("isHidden") === "true";
  if (!admin || !reportId) return { ok: false, message: "Отчёт не найден." };
  const { data: before } = await admin.from("grand_prix_reports").select("id, season, round, race_slug, ai_summary, is_hidden, status").eq("id", reportId).maybeSingle();
  if (!before) return { ok: false, message: "Отчёт не найден." };
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "report.update",
    entityType: "grand_prix_report",
    entityId: reportId,
    beforeData: before,
  });
  const { error } = await admin.from("grand_prix_reports").update({
    ai_summary: summary,
    is_hidden: isHidden,
    summary_status: summary ? "edited" : "pending",
    status: summary ? "ready" : "partial",
  }).eq("id", reportId);
  if (error) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error });
    return actionError(error, "Не удалось сохранить отчёт.");
  }
  await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { summary, isHidden } });
  revalidateAdminPaths(["/admin", "/admin/reports", "/", "/calendar", `/calendar/${before.season}/${before.round}`]);
  return { ok: true, message: "Отчёт сохранён." };
}

export async function saveDigestAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const digestId = uuid(formData, "digestId");
  const title = text(formData, "title", 240);
  const body = normalizeDailyDigestBody(text(formData, "body", 20_000));
  const status = enumValue(formData, "status", ["draft", "published", "hidden"]);
  if (!admin || !digestId || !title || !body || !status) return { ok: false, message: "Проверь заголовок, текст и состояние сводки." };
  const { data: before } = await admin.from("digests").select("id, title, body_md, status").eq("id", digestId).maybeSingle();
  if (!before) return { ok: false, message: "Сводка не найдена." };
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "digest.update",
    entityType: "digest",
    entityId: digestId,
    beforeData: before,
  });
  const { error } = await admin.from("digests").update({ title, body_md: body, status }).eq("id", digestId);
  if (error) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error });
    return actionError(error, "Не удалось сохранить сводку.");
  }
  await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { title, body, status } });
  revalidateAdminPaths(["/admin/news", "/admin/reports", "/news"]);
  return { ok: true, message: "Сводка сохранена." };
}

export async function savePollAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const pollId = optionalUuid(formData, "pollId");
  const question = text(formData, "question", 320);
  const status = enumValue(formData, "status", ["draft", "published", "closed"]);
  const closesAt = optionalText(formData, "closesAt", 60);
  const options = parseLines(text(formData, "options", 2_000), 8, 160);
  if (!admin || !question || !status || options.length < 2) {
    return { ok: false, message: "Нужен вопрос и хотя бы два варианта ответа." };
  }
  const before = pollId
    ? (await admin.from("polls").select("id, question, status, closes_at").eq("id", pollId).maybeSingle()).data
    : null;
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: pollId ? "poll.update" : "poll.create",
    entityType: "poll",
    entityId: pollId,
    beforeData: before ?? {},
  });

  try {
    if (pollId) {
      const currentPollStatus = before && ["draft", "published", "closed"].includes(before.status)
        ? before.status
        : "draft";
      if (!canTransitionAdminStatus("poll", currentPollStatus, status)) {
        throw new Error("Такое изменение состояния опроса не разрешено.");
      }
    }
    const { data: targetPollId, error } = await admin.rpc("admin_save_poll", {
      p_closes_at: closesAt || null,
      p_options: options,
      p_poll_id: pollId,
      p_question: question,
      p_status: status,
    });
    if (error) throw error;
    await finishAdminAudit(admin, auditId, {
      outcome: "succeeded",
      afterData: { pollId: targetPollId, question, status, closesAt, options },
    });
    revalidateAdminPaths(["/admin/community", "/polls"]);
    return { ok: true, message: pollId ? "Опрос сохранён." : "Опрос создан." };
  } catch (pollError) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error: pollError });
    return actionError(pollError, "Не удалось сохранить опрос.");
  }
}

export async function retryNotificationAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const queueId = uuid(formData, "queueId");
  if (!admin || !queueId) return { ok: false, message: "Уведомление не найдено." };
  const { data: before } = await admin.from("notification_queue").select("id, status, attempts, event_type, sent_at").eq("id", queueId).maybeSingle();
  if (!before || before.status !== "failed" || before.sent_at) {
    return { ok: false, message: "Повтор доступен только для подтверждённо неотправленной записи." };
  }
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "notification.retry",
    entityType: "notification_queue",
    entityId: queueId,
    beforeData: before,
  });
  const { data: updated, error } = await admin.from("notification_queue").update({ status: "pending", attempts: 0, available_at: new Date().toISOString(), last_error: null }).eq("id", queueId).eq("status", "failed").is("sent_at", null).select("id").maybeSingle();
  if (error || !updated) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error });
    return error
      ? actionError(error, "Не удалось вернуть уведомление в очередь.")
      : { ok: false, message: "Уведомление уже изменилось. Обнови страницу и попробуй снова." };
  }
  await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { status: "pending", attempts: 0 } });
  revalidateAdminPaths(["/admin/notifications"]);
  return { ok: true, message: "Уведомление вернулось в очередь." };
}

export async function disconnectTelegramAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const targetUserId = uuid(formData, "userId");
  if (!admin || !targetUserId) return { ok: false, message: "Профиль не найден." };
  const { data: before } = await admin.from("telegram_accounts").select("user_id, is_active, connected_at, last_delivery_at, last_error").eq("user_id", targetUserId).maybeSingle();
  if (!before) return { ok: false, message: "Telegram не подключён." };
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "telegram.disconnect",
    entityType: "profile",
    entityId: targetUserId,
    beforeData: before,
  });
  const { error } = await admin.from("telegram_accounts").update({ is_active: false, disconnected_at: new Date().toISOString() }).eq("user_id", targetUserId);
  if (error) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error });
    return actionError(error, "Не удалось отключить Telegram.");
  }
  await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { isActive: false } });
  revalidateAdminPaths(["/admin/users", "/admin/notifications"]);
  return { ok: true, message: "Проблемная связь отключена." };
}

export async function sendTestNotificationAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const targetUserId = uuid(formData, "userId");
  if (!admin || !targetUserId) return { ok: false, message: "Профиль не найден." };
  const { data: account } = await admin.from("telegram_accounts").select("user_id, is_active").eq("user_id", targetUserId).maybeSingle();
  if (!account?.is_active) return { ok: false, message: "Сначала подключи активный Telegram." };
  const [{ data: preference, error: preferenceError }, access] = await Promise.all([
    admin.from("notification_preferences").select("telegram_enabled").eq("user_id", targetUserId).maybeSingle(),
    getSubscriptionAccess(targetUserId),
  ]);
  if (preferenceError) return actionError(preferenceError, "Не удалось проверить настройки уведомлений.");
  if (!preference?.telegram_enabled) return { ok: false, message: "Сначала включи уведомления Telegram в профиле пользователя." };
  if (!access.entitlements.telegram_notifications) return { ok: false, message: "Для отправки уведомлений нужен активный RaceSide Plus." };
  const now = new Date();
  const dedupeKey = `admin-test:${targetUserId}:${now.toISOString().slice(0, 16)}`;
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "notification.test",
    entityType: "profile",
    entityId: targetUserId,
  });
  const { error } = await admin.from("notification_queue").insert({
    user_id: targetUserId,
    event_type: "admin_test",
    entity_type: "profile",
    entity_id: targetUserId,
    payload: { kind: "admin_test", title: "Проверка RaceSide", body: "Telegram подключён и готов получать уведомления." },
    available_at: now.toISOString(),
    status: "pending",
    dedupe_key: dedupeKey,
    attempts: 0,
  });
  if (error) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error });
    return actionError(error, "Не удалось добавить тестовое уведомление.");
  }
  await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { queued: true } });
  revalidateAdminPaths(["/admin/users", "/admin/notifications"]);
  return { ok: true, message: "Тестовое уведомление добавлено в очередь." };
}

export async function uploadDriverAvatarAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const driverId = uuid(formData, "driverId");
  const slug = text(formData, "slug", 120);
  const file = formData.get("avatar");
  if (!admin || !driverId || !slug || !(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Выбери изображение гонщика." };
  }
  if (!["image/webp", "image/png", "image/jpeg"].includes(file.type) || file.size > 2_097_152) {
    return { ok: false, message: "Нужен PNG, JPEG или WebP до 2 МБ." };
  }
  const { data: before } = await admin.from("drivers").select("id, slug, ai_avatar_url").eq("id", driverId).maybeSingle();
  if (!before) return { ok: false, message: "Гонщик не найден." };
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "driver.avatar_upload",
    entityType: "driver",
    entityId: driverId,
    beforeData: before,
    metadata: { contentType: file.type, size: file.size },
  });
  try {
    const extension = file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : "webp";
    const path = `${driverId}/${Date.now()}.${extension}`;
    const { error: uploadError } = await admin.storage.from("driver-avatars").upload(path, file, { contentType: file.type, upsert: true });
    if (uploadError) throw uploadError;
    const { data } = admin.storage.from("driver-avatars").getPublicUrl(path);
    const { error } = await admin.from("drivers").update({ ai_avatar_url: data.publicUrl }).eq("id", driverId);
    if (error) throw error;
    await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { avatarChanged: true } });
    revalidateAdminPaths(["/admin/sport", `/drivers/${slug}`]);
    return { ok: true, message: "Аватар обновлён." };
  } catch (avatarError) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error: avatarError });
    return actionError(avatarError, "Не удалось загрузить аватар.");
  }
}

export async function saveAiBudgetAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const scope = enumValue(formData, "scope", ["default"]);
  const dailyLimit = Number(text(formData, "dailyLimitUsd", 20));
  const monthlyLimit = Number(text(formData, "monthlyLimitUsd", 20));
  if (
    !admin ||
    !scope ||
    !Number.isFinite(dailyLimit) ||
    !Number.isFinite(monthlyLimit) ||
    dailyLimit <= 0 ||
    monthlyLimit <= 0 ||
    dailyLimit > monthlyLimit ||
    monthlyLimit > 100_000
  ) {
    return { ok: false, message: "Проверь лимиты. Дневной лимит должен быть меньше месячного." };
  }
  const { data: before } = await admin.from("admin_ai_budgets").select("daily_limit_usd, monthly_limit_usd").eq("scope", scope).maybeSingle();
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "ai_budget.update",
    entityType: "ai_budget",
    entityId: scope,
    beforeData: before ?? {},
  });
  const { error } = await admin.from("admin_ai_budgets").upsert({
    scope,
    daily_limit_usd: dailyLimit,
    monthly_limit_usd: monthlyLimit,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error });
    return actionError(error, "Не удалось сохранить лимиты.");
  }
  await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { dailyLimit, monthlyLimit } });
  revalidateAdminPaths(["/admin", "/admin/ai"]);
  return {
    ok: true,
    message: "Общий AI-бюджет сохранён.",
  };
}

export async function saveXApiBudgetAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const unitCost = Number(text(formData, "unitCostUsd", 20));
  const dailyLimit = Number(text(formData, "dailyLimitUsd", 20));
  const monthlyLimit = Number(text(formData, "monthlyLimitUsd", 20));
  if (
    !admin ||
    !Number.isFinite(unitCost) ||
    !Number.isFinite(dailyLimit) ||
    !Number.isFinite(monthlyLimit) ||
    unitCost <= 0 ||
    unitCost > 100 ||
    dailyLimit <= 0 ||
    monthlyLimit <= 0 ||
    dailyLimit > monthlyLimit ||
    monthlyLimit > 100_000
  ) {
    return { ok: false, message: "Проверь цену и лимиты X API. Дневной лимит должен быть меньше месячного." };
  }
  const { data: before } = await admin
    .from("admin_external_api_costs")
    .select("unit_cost_usd, daily_limit_usd, monthly_limit_usd")
    .eq("provider", "x")
    .maybeSingle();
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "external_api_budget.update",
    entityType: "external_api_budget",
    entityId: "x",
    beforeData: before ?? {},
  });
  const update = {
    provider: "x" as const,
    resource_type: "post_read" as const,
    unit_cost_usd: unitCost,
    daily_limit_usd: dailyLimit,
    monthly_limit_usd: monthlyLimit,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("admin_external_api_costs").upsert(update);
  if (error) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error });
    return actionError(error, "Не удалось сохранить бюджет X API.");
  }
  await finishAdminAudit(admin, auditId, {
    outcome: "succeeded",
    afterData: { unitCost, dailyLimit, monthlyLimit },
  });
  revalidateAdminPaths(["/admin", "/admin/ai"]);
  return { ok: true, message: "Цена и лимиты X API сохранены." };
}

export async function updateUserErrorReportAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const reportId = uuid(formData, "reportId");
  const status = enumValue(formData, "status", ["new", "in_progress", "resolved", "dismissed"]);
  const adminNote = optionalText(formData, "adminNote", 2_000);
  if (!admin || !reportId || !status) return { ok: false, message: "Сообщение не найдено." };
  const { data: before, error } = await admin
    .from("user_error_reports")
    .select("id, status, admin_note, resolved_at")
    .eq("id", reportId)
    .maybeSingle();
  if (error || !before) return { ok: false, message: "Сообщение не найдено." };
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "user_error_report.update",
    entityType: "user_error_report",
    entityId: reportId,
    beforeData: before,
  });
  const isClosed = status === "resolved" || status === "dismissed";
  const update = {
    status,
    admin_note: adminNote,
    resolved_by: isClosed ? user.id : null,
    resolved_at: isClosed ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const { error: updateError } = await admin.from("user_error_reports").update(update).eq("id", reportId);
  if (updateError) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error: updateError });
    return actionError(updateError, "Не удалось обновить сообщение.");
  }
  await finishAdminAudit(admin, auditId, {
    outcome: "succeeded",
    afterData: { status, hasAdminNote: Boolean(adminNote) },
  });
  revalidateAdminPaths(["/admin", "/admin/issues"]);
  return { ok: true, message: "Сообщение обновлено." };
}

export async function retryFeedbackDeliveryAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const reportId = uuid(formData, "reportId");
  if (!admin || !reportId) return { ok: false, message: "Пожелание не найдено." };
  const { data: before, error } = await admin.from("user_error_reports")
    .select("id, telegram_status, telegram_attempts, telegram_retry_at")
    .eq("id", reportId).eq("report_kind", "feedback").maybeSingle();
  if (error || !before) return { ok: false, message: "Пожелание не найдено." };
  if (before.telegram_status === "sent") return { ok: true, message: "Пожелание уже доставлено." };
  const now = new Date().toISOString();
  if (before.telegram_status === "pending" || before.telegram_retry_at > now) {
    return { ok: true, message: "Повторная доставка уже запланирована." };
  }
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "user_error_report.retry_delivery",
    entityType: "user_error_report",
    entityId: reportId,
    beforeData: before,
  });
  const { data: updated, error: updateError } = await admin.from("user_error_reports").update({
    telegram_status: "pending", telegram_error: null, telegram_attempts: 0,
    telegram_last_attempt_at: null, telegram_retry_at: now,
  }).eq("id", reportId).eq("report_kind", "feedback")
    .in("telegram_status", ["failed", "not_configured"]).lte("telegram_retry_at", now)
    .select("id").maybeSingle();
  if (updateError) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error: updateError });
    return actionError(updateError, "Не удалось повторить доставку.");
  }
  await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { queued: Boolean(updated) } });
  revalidateAdminPaths(["/admin/issues"]);
  return { ok: true, message: updated ? "Пожелание снова в очереди отправки." : "Доставка уже обрабатывается." };
}

export async function saveAiPromptVersionAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const promptKey = text(formData, "promptKey", 120);
  const intent = enumValue(formData, "intent", ["draft", "publish"]);
  const definition = getAdminAiPromptDefinition(promptKey);
  const systemPrompt = text(formData, "systemPrompt", 20_000);
  const userTemplate = text(formData, "userTemplate", 30_000);
  const model = text(formData, "model", 160);
  const maxTokens = Number(text(formData, "maxTokens", 10));
  const changeNote = text(formData, "changeNote", 500);
  const rateLimit = consumeRateLimit("admin:save-ai-prompt", `user:${user.id}`, 20, 60_000);

  if (!admin || !definition || !intent) {
    return { ok: false, message: "AI-задача не найдена." };
  }
  if (!rateLimit.ok) {
    return { ok: false, message: "Слишком много изменений. Подожди минуту." };
  }

  const validation = validateAdminAiPromptContent(
    definition,
    systemPrompt,
    userTemplate,
  );
  if (!validation.ok) {
    return validation;
  }
  const availableModels = await loadOpenRouterModels().catch(() => []);
  const runtimeValidation = validateAdminAiRuntime(
    model,
    maxTokens,
    availableModels,
    definition.maxTokens,
  );
  if (!runtimeValidation.ok) {
    return runtimeValidation;
  }

  const checksum = makeAdminAiPromptChecksum({
    promptKey,
    systemPrompt: validation.systemPrompt,
    userTemplate: validation.userTemplate,
    model: runtimeValidation.model,
    maxTokens: runtimeValidation.maxTokens,
  });
  const { data: before } = await admin
    .from("ai_prompt_versions")
    .select("id, version, status, checksum, model, max_tokens")
    .eq("prompt_key", promptKey)
    .in("status", ["published", "draft"])
    .order("version", { ascending: false })
    .limit(3);
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: intent === "publish" ? "ai_prompt.publish" : "ai_prompt.save_draft",
    entityType: "ai_prompt",
    entityId: promptKey,
    beforeData: {
      versions: (before ?? []).map((version) => ({
        id: version.id,
        version: version.version,
        status: version.status,
        checksum: version.checksum,
      })),
    },
    metadata: {
      changedFields: ["systemPrompt", "userTemplate", "model", "maxTokens"],
      hasChangeNote: Boolean(changeNote),
    },
  });
  const { data, error } = await admin.rpc("save_admin_ai_prompt_version", {
    p_prompt_key: promptKey,
    p_system_prompt: validation.systemPrompt,
    p_user_template: validation.userTemplate,
    p_model: runtimeValidation.model,
    p_max_tokens: runtimeValidation.maxTokens,
    p_change_note: changeNote,
    p_actor: user.id,
    p_publish: intent === "publish",
    p_checksum: checksum,
  });

  if (error || !data?.[0]) {
    await finishAdminAudit(admin, auditId, {
      outcome: "failed",
      error: error ?? "prompt_version_not_saved",
    });
    return {
      ok: false,
      message: intent === "publish"
        ? "Не удалось опубликовать новую версию. Проверь текст и попробуй ещё раз."
        : "Не удалось сохранить черновик. Проверь текст и попробуй ещё раз.",
    };
  }

  const saved = data[0];
  await finishAdminAudit(admin, auditId, {
    outcome: "succeeded",
    afterData: {
      promptKey,
      versionId: saved.saved_id,
      version: saved.saved_version,
      status: saved.saved_status,
      checksum,
      model: runtimeValidation.model,
      maxTokens: runtimeValidation.maxTokens,
    },
  });
  revalidateAdminPaths(["/admin", "/admin/ai", "/admin/audit"]);

  return {
    ok: true,
    message: intent === "publish"
      ? `Версия ${saved.saved_version} опубликована. Новые обработки начнут использовать её в течение минуты.`
      : `Черновик версии ${saved.saved_version} сохранён.`,
    data: {
      promptKey,
      version: saved.saved_version,
      published: intent === "publish",
    },
  };
}

export async function saveAdminScheduleAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const scheduleId = uuid(formData, "scheduleId");
  const scheduleKind = enumValue(formData, "scheduleKind", ["interval", "daily", "adaptive"]);
  const intervalMinutes = Number(text(formData, "intervalMinutes", 10));
  const dailyTimeUtc = text(formData, "dailyTimeUtc", 5);
  const isEnabled = formData.get("isEnabled") === "on";

  if (!admin || !scheduleId || !scheduleKind) {
    return { ok: false, message: "Расписание не найдено." };
  }
  if (
    scheduleKind === "interval" &&
    (!Number.isInteger(intervalMinutes) || intervalMinutes < 2 || intervalMinutes > 10_080)
  ) {
    return {
      ok: false,
      message: "Проверь интервал.",
      fieldErrors: { intervalMinutes: ["Интервал — от 2 минут до 7 дней."] },
    };
  }
  if (
    scheduleKind === "daily" &&
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyTimeUtc)
  ) {
    return {
      ok: false,
      message: "Проверь время запуска.",
      fieldErrors: { dailyTimeUtc: ["Укажи время в UTC, например 12:00."] },
    };
  }

  const { data: before, error: beforeError } = await admin
    .from("admin_job_schedules")
    .select("id, schedule_key, job_name, schedule_kind, interval_minutes, daily_time_utc, max_attempts, is_enabled, next_run_at")
    .eq("id", scheduleId)
    .maybeSingle();
  const definition = before ? getAdminJobDefinition(before.job_name) : null;
  if (beforeError || !before || !definition) {
    return {
      ok: false,
      message: "Расписание не найдено или задача больше недоступна.",
    };
  }
  if (
    (before.schedule_kind === "adaptive" && scheduleKind !== "adaptive") ||
    (scheduleKind === "adaptive" && !definition.adaptiveSchedule)
  ) {
    return {
      ok: false,
      message: "Адаптивный режим этой проверки нельзя заменить фиксированным интервалом.",
    };
  }

  const nextRunAt = scheduleKind === "adaptive"
    ? isEnabled && !before.is_enabled
      ? new Date().toISOString()
      : before.next_run_at
    : getNextScheduleRun({
      scheduleKind,
      intervalMinutes,
      dailyTimeUtc,
    });
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "schedule.update",
    entityType: "job_schedule",
    entityId: before.schedule_key,
    beforeData: before,
  });
  const update = {
    schedule_kind: scheduleKind,
    interval_minutes: scheduleKind === "interval"
      ? intervalMinutes
      : scheduleKind === "adaptive"
        ? 1_440
        : null,
    daily_time_utc: scheduleKind === "daily" ? dailyTimeUtc : null,
    max_attempts: before.max_attempts,
    is_enabled: isEnabled,
    next_run_at: nextRunAt,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin
    .from("admin_job_schedules")
    .update(update)
    .eq("id", scheduleId);

  if (error) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error });
    return actionError(error, "Не удалось сохранить расписание.");
  }
  await finishAdminAudit(admin, auditId, {
    outcome: "succeeded",
    afterData: update,
  });
  revalidateAdminPaths([
    "/admin",
    "/admin/schedules",
    "/admin/systems",
    "/admin/audit",
  ]);
  return {
    ok: true,
    message: isEnabled
      ? "Расписание сохранено."
      : "Расписание поставлено на паузу.",
  };
}

export async function runAdminScheduleNowAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const scheduleId = uuid(formData, "scheduleId");

  if (!admin || !scheduleId) {
    return { ok: false, message: "Расписание не найдено." };
  }
  const { data: schedule, error } = await admin
    .from("admin_job_schedules")
    .select("id, schedule_key, job_name, args")
    .eq("id", scheduleId)
    .maybeSingle();
  if (error || !schedule || !getAdminJobDefinition(schedule.job_name)) {
    return {
      ok: false,
      message: "Эту проверку нельзя запустить из админки.",
    };
  }
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "schedule.run_now",
    entityType: "job_schedule",
    entityId: schedule.schedule_key,
  });

  try {
    const queued = await enqueueAdminJob(admin, {
      args: isRecord(schedule.args) ? schedule.args : {},
      jobName: schedule.job_name,
      requestedBy: user.id,
      requestKey: `schedule-manual:${schedule.schedule_key}:${Date.now()}`,
    });
    if (!queued.ok) {
      await finishAdminAudit(admin, auditId, {
        outcome: "failed",
        error: queued.message,
      });
      return { ok: false, message: queued.message };
    }
    await finishAdminAudit(admin, auditId, {
      outcome: "succeeded",
      afterData: { jobRunId: queued.jobRunId },
    });
    revalidateAdminPaths([
      "/admin",
      "/admin/jobs",
      "/admin/schedules",
      "/admin/systems",
    ]);
    return { ok: true, message: "Проверка добавлена в очередь." };
  } catch (runError) {
    await finishAdminAudit(admin, auditId, {
      outcome: "failed",
      error: runError,
    });
    return actionError(runError, "Не удалось запустить проверку.");
  }
}

export async function clearDriverAvatarAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const user = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const driverId = uuid(formData, "driverId");
  const slug = text(formData, "slug", 120);
  if (!admin || !driverId || !slug) return { ok: false, message: "Гонщик не найден." };
  const { data: before } = await admin.from("drivers").select("id, slug, ai_avatar_url").eq("id", driverId).maybeSingle();
  if (!before) return { ok: false, message: "Гонщик не найден." };
  const auditId = await startAdminAudit(admin, {
    actorUserId: user.id,
    action: "driver.avatar_clear",
    entityType: "driver",
    entityId: driverId,
    beforeData: before,
  });
  const { error } = await admin.from("drivers").update({ ai_avatar_url: null }).eq("id", driverId);
  if (error) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error });
    return actionError(error, "Не удалось убрать аватар.");
  }
  await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { avatarChanged: true } });
  revalidateAdminPaths(["/admin/sport", `/drivers/${slug}`]);
  return { ok: true, message: "Аватар убран из профиля." };
}

export async function grantSubscriptionAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const actor = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const targetUserId = uuid(formData, "userId");
  const duration = enumValue(formData, "duration", ["month", "year", "custom"] as const);
  const reason = text(formData, "reason", 500);
  const idempotencyKey = text(formData, "idempotencyKey", 80);
  const customEndRaw = text(formData, "customEnd", 40);
  const customEnd = duration === "custom" && customEndRaw ? new Date(customEndRaw) : null;
  if (!admin || !targetUserId || !duration || reason.length < 3 || idempotencyKey.length < 16 || (customEnd && Number.isNaN(customEnd.getTime()))) {
    return { ok: false, message: "Проверьте срок и причину выдачи." };
  }
  const { data: before } = await admin.from("subscriptions").select("status, current_period_start, current_period_end").eq("user_id", targetUserId).maybeSingle();
  const auditId = await startAdminAudit(admin, {
    action: "subscription.grant",
    actorUserId: actor.id,
    beforeData: before ?? {},
    entityId: targetUserId,
    entityType: "subscription",
    metadata: { duration, reason },
  });
  const { data, error } = await admin.rpc("billing_admin_grant", {
    p_actor_user_id: actor.id,
    p_custom_end: customEnd?.toISOString() ?? null,
    p_duration_kind: duration,
    p_idempotency_key: idempotencyKey,
    p_reason: reason,
    p_target_user_id: targetUserId,
  });
  if (error || !data?.[0]) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error: error ?? "grant_failed" });
    return actionError(error, "Не удалось выдать подписку.");
  }
  await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: data[0] });
  invalidateSubscriptionAccess(targetUserId);
  revalidateAdminPaths(["/admin/users", "/account", "/account/subscription"]);
  return { ok: true, message: `Plus выдан до ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(new Date(data[0].ends_at))}.` };
}

export async function revokeSubscriptionAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const actor = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const targetUserId = uuid(formData, "userId");
  const reason = text(formData, "reason", 500);
  if (!admin || !targetUserId || reason.length < 3) {
    return { ok: false, message: "Добавьте причину отзыва подписки." };
  }
  const { data: before } = await admin
    .from("subscriptions")
    .select("status, current_period_start, current_period_end")
    .eq("user_id", targetUserId)
    .maybeSingle();
  const auditId = await startAdminAudit(admin, {
    action: "subscription.revoke",
    actorUserId: actor.id,
    beforeData: before ?? {},
    entityId: targetUserId,
    entityType: "subscription",
    metadata: { reason },
  });
  const { data, error } = await admin.rpc("billing_admin_revoke", {
    p_actor_user_id: actor.id,
    p_reason: reason,
    p_target_user_id: targetUserId,
  });
  if (error || !data?.[0]?.revoked) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error: error ?? "subscription_not_active" });
    return actionError(error, "Активная подписка не найдена.");
  }
  await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { status: "revoked" } });
  invalidateSubscriptionAccess(targetUserId);
  revalidateAdminPaths(["/admin/users", "/account", "/account/subscription"]);
  return { ok: true, message: "RaceSide Plus отозван." };
}

export async function cancelAdminLavaSubscriptionAction(
  _previousState: AdminActionResult, formData: FormData,
): Promise<AdminActionResult> {
  const actor = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const userId = uuid(formData, "userId"), orderId = uuid(formData, "orderId");
  const reason = text(formData, "reason", 500);
  if (!admin || !userId || !orderId || reason.length < 3) return { ok: false, message: "Добавь причину отключения автопродления." };
  const { data: before, error } = await admin.from("billing_orders")
    .select("id, user_id, provider, status, lava_auto_renew, lava_cancelled_at, lava_parent_contract_id")
    .eq("id", orderId).eq("user_id", userId).eq("provider", "lava").is("lava_parent_contract_id", null).maybeSingle();
  if (error || !before || !["paid", "partially_refunded", "refunded"].includes(before.status)) return { ok: false, message: "Договор автопродления не найден." };
  const auditId = await startAdminAudit(admin, { actorUserId: actor.id, action: "billing.cancel_auto_renew", entityType: "billing_order", entityId: orderId, beforeData: before, metadata: { reason } });
  try {
    const result = await cancelUserLavaSubscription(userId, orderId);
    await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { autoRenew: false, ...result } });
    revalidateAdminPaths(["/admin/users", "/admin/billing", "/account/subscription"]);
    return { ok: true, message: result.alreadyCancelled ? "Автопродление уже отключено. Оплаченный доступ сохранён." : "Автопродление отключено. Оплаченный доступ сохранён." };
  } catch (cancelError) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error: cancelError });
    return { ok: false, message: "Платёжный сервис не подтвердил отключение. Проверь договор и попробуй снова." };
  }
}

export async function resendBillingConfirmationAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const actor = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const orderId = uuid(formData, "orderId");
  if (!admin || !orderId) return { ok: false, message: "Заказ не найден." };
  const { data: order } = await admin.from("billing_orders").select("id, order_number, status").eq("id", orderId).maybeSingle();
  if (!order || order.status !== "paid") return { ok: false, message: "Подтверждение доступно только для оплаченного заказа." };
  const auditId = await startAdminAudit(admin, { action: "billing.confirmation_resend", actorUserId: actor.id, entityId: orderId, entityType: "billing_order" });
  const { error } = await admin.from("billing_email_deliveries").insert({
    available_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
    order_id: orderId,
    provider_message_id: null,
    recipient_email: null,
    sent_at: null,
    status: "queued",
    template: `payment_confirmation_resend:${randomUUID()}`,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error });
    return actionError(error, "Не удалось поставить письмо в очередь.");
  }
  await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { orderNumber: order.order_number, status: "queued" } });
  revalidateAdminPaths(["/admin/billing"]);
  return { ok: true, message: "Подтверждение поставлено в очередь." };
}

export async function reconcileBillingPaymentAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const actor = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const orderId = uuid(formData, "orderId");
  const operationReference = text(formData, "operationReference", 160);
  const reason = text(formData, "reason", 500);
  const paidAtRaw = text(formData, "paidAt", 40);
  const netAmountRaw = text(formData, "netAmount", 30);
  const paidAt = parseMoscowPaymentDate(paidAtRaw);
  let netAmountMinor = 0;
  try { netAmountMinor = parseMinorUnits(netAmountRaw); } catch { return { ok: false, message: "Проверьте зачисленную сумму." }; }
  if (!admin || !orderId || operationReference.length < 3 || reason.length < 3 || !paidAt) {
    return { ok: false, message: "Добавьте ссылку на операцию, дату и причину сверки." };
  }
  const { data: order } = await admin.from("billing_orders").select("id, user_id, provider, payment_method, amount_minor, currency, status, failure_reason").eq("id", orderId).maybeSingle();
  if (!order || !["pending", "failed"].includes(order.status) || (order.status === "failed" && order.failure_reason !== "CHECKOUT_EXPIRED")) {
    return { ok: false, message: "Этот заказ нельзя подтвердить ручной сверкой." };
  }
  if (netAmountMinor < 0 || netAmountMinor > Number(order.amount_minor)) return { ok: false, message: "Зачисленная сумма не может быть больше суммы заказа." };
  const referenceHash = createHash("sha256").update(`${order.provider}:${operationReference}`).digest("hex");
  const auditId = await startAdminAudit(admin, { action: "billing.payment_reconcile", actorUserId: actor.id, entityId: orderId, entityType: "billing_order", metadata: { reason, reference: shortAuditReference(operationReference) } });
  const { error } = await admin.rpc("billing_apply_payment", {
    p_currency: order.currency,
    p_gross_amount_minor: Number(order.amount_minor),
    p_net_amount_minor: netAmountMinor,
    p_occurred_at: paidAt,
    p_order_id: order.id,
    p_payload_hash: referenceHash,
    p_payment_method: order.payment_method,
    p_provider: order.provider,
    p_provider_event_id: `manual:${referenceHash}`,
    p_provider_event_type: "manual_reconciliation",
    p_provider_reference: operationReference,
    p_provider_transaction_id: operationReference,
    p_safe_payload: { reconciledBy: actor.id },
  });
  if (error) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error });
    return actionError(error, "Не удалось подтвердить оплату.");
  }
  await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { status: "paid" } });
  invalidateSubscriptionAccess(order.user_id);
  revalidateAdminPaths(["/admin/billing", "/admin/users", "/account/subscription"]);
  return { ok: true, message: "Оплата подтверждена, доступ выдан." };
}

export async function recordBillingRefundAction(
  _previousState: AdminActionResult,
  formData: FormData,
): Promise<AdminActionResult> {
  const actor = await requireAdmin();
  const admin = createSupabaseAdminClient();
  const orderId = uuid(formData, "orderId");
  const refundReference = text(formData, "refundReference", 160);
  const reason = text(formData, "reason", 500);
  if (!admin || !orderId || refundReference.length < 3 || reason.length < 3) {
    return { ok: false, message: "Добавьте ссылку на возврат и причину." };
  }
  const { data: order } = await admin.from("billing_orders").select("id, user_id, provider, amount_minor, status").eq("id", orderId).maybeSingle();
  if (!order || order.status !== "paid") return { ok: false, message: "Возврат можно зафиксировать только для оплаченного заказа." };
  const referenceHash = createHash("sha256").update(`${order.provider}:${refundReference}`).digest("hex");
  const auditId = await startAdminAudit(admin, { action: "billing.refund_record", actorUserId: actor.id, entityId: orderId, entityType: "billing_order", metadata: { reason, reference: shortAuditReference(refundReference) } });
  const { error } = await admin.rpc("billing_apply_refund", {
    p_amount_minor: Number(order.amount_minor),
    p_order_id: order.id,
    p_payload_hash: referenceHash,
    p_provider: order.provider,
    p_provider_event_id: `manual_refund:${referenceHash}`,
    p_provider_event_type: "manual_refund",
  });
  if (error) {
    await finishAdminAudit(admin, auditId, { outcome: "failed", error });
    return actionError(error, "Не удалось зафиксировать возврат.");
  }
  await finishAdminAudit(admin, auditId, { outcome: "succeeded", afterData: { status: "refunded" } });
  invalidateSubscriptionAccess(order.user_id);
  revalidateAdminPaths(["/admin/billing", "/admin/users", "/account/subscription"]);
  return { ok: true, message: "Возврат зафиксирован, доступ пересчитан." };
}

function shortAuditReference(value: string) {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function revalidateAdminPaths(paths: string[]) {
  for (const path of paths) revalidatePath(path);
}

function text(formData: FormData, key: string, maxLength: number) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function optionalText(formData: FormData, key: string, maxLength: number) {
  return text(formData, key, maxLength) || null;
}

function uuid(formData: FormData, key: string) {
  const value = text(formData, key, 64);
  return UUID_PATTERN.test(value) ? value : null;
}

function optionalUuid(formData: FormData, key: string) {
  const value = text(formData, key, 64);
  return value ? (UUID_PATTERN.test(value) ? value : null) : null;
}

function enumValue<const T extends string>(formData: FormData, key: string, values: readonly T[]) {
  const value = text(formData, key, 60);
  return values.includes(value as T) ? value as T : null;
}

function parseTags(value: string) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))].slice(0, 8);
}

function parseLines(value: string, maxItems: number, maxLength: number) {
  return [...new Set(value.split(/\r?\n/).map((item) => item.trim().slice(0, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function normalizeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizeSocialSourceUrl(platform: "reddit" | "telegram" | "x", rawUrl: string, externalKey: string) {
  if (platform === "telegram") {
    if (/^-?\d+$/.test(externalKey)) return `telegram:${externalKey}`;
    if (/^[A-Za-z][A-Za-z0-9_]{3,}$/.test(externalKey)) return `https://t.me/${externalKey}`;
    return "";
  }
  const url = normalizeHttpsUrl(rawUrl);
  if (!url) return "";
  const hostname = new URL(url).hostname.toLowerCase();
  if (platform === "x" && !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(hostname)) return "";
  if (platform === "reddit" && !["reddit.com", "www.reddit.com", "old.reddit.com"].includes(hostname)) return "";
  return url;
}

function getNextScheduleRun(input: {
  scheduleKind: "interval" | "daily";
  intervalMinutes: number;
  dailyTimeUtc: string;
}) {
  if (input.scheduleKind === "interval") {
    return new Date(Date.now() + input.intervalMinutes * 60_000).toISOString();
  }

  const [hours, minutes] = input.dailyTimeUtc.split(":").map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hours, minutes, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

function isXUrl(value: string) {
  const hostname = new URL(value).hostname.toLowerCase();
  return ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(hostname);
}

function clampNumber(value: string, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function actionError(_error: unknown, fallback: string): AdminActionResult {
  return {
    ok: false,
    message: fallback,
  };
}
