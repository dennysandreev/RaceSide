export type NewsEditorialMeta = {
  algorithm_version?: number;
  token_usage?: number;
  request_count?: number;
  article_type?: string;
  source_authors?: string[];
  status?: string;
  context?: { kind: string; subject: string; value: string | number; scope: string; as_of?: string }[];
};
export const NEWS_ARTICLE_TYPE_OPTIONS = ["news", "breaking_news", "report", "interview", "opinion", "column", "analysis", "rumour", "legal", "historical", "technical_analysis"] as const;

export function newsArticleTypeLabel(type?: string) {
  return ({ breaking_news: "Срочная новость", news: "Новость", report: "Репортаж", interview: "Интервью", opinion: "Мнение", column: "Авторская колонка", analysis: "Анализ", rumour: "Неподтверждённая информация", legal: "Судебное разбирательство", historical: "История", technical_analysis: "Технический разбор" } as Record<string, string>)[type ?? ""] ?? "Новость";
}

export function formatNewsDate(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(value));
}

export function newsReviewIssueLabel(issue: string) {
  const labels: Record<string, string> = {
    sensitive_material: "Чувствительная тема: проверь формулировки и оговорки источника.",
    analysis_requires_editor: "Перед публикацией проверь аргументы, условные формулировки и отсутствие пересказа чужих мнений.",
    invalid_extraction: "Предыдущая проверка остановилась на разборе оригинала. Попробуй обработать новость заново.",
    invalid_event_metadata: "Не удалось определить событие и участников новости.",
    invalid_verification: "Проверка текста не завершилась.",
    news_token_budget_exceeded: "Достигнут лимит обработки этой новости. Текст можно проверить и опубликовать вручную.",
    news_invalid_response: "AI вернул неполный ответ. Проверь текст перед публикацией.",
    invalid_duplicate_decision: "Не удалось подтвердить, что событие уже опубликовано.",
    invalid_review_edits: "Не удалось применить исправление текста. Попробуй обработать новость заново.",
    reader_markup: "Убери из текста ссылки и служебную разметку.",
    quality_threshold_not_met: "Текст не прошёл проверку точности и полноты.",
    essential_fact_missing: "В пересказе пропущена важная подробность источника.",
    driver_team_conflict: "Команда пилота не совпадает с актуальными данными.",
    raceside_opinion: "Чужое мнение приписано RaceSide.",
    opinion_attribution_missing: "Мнение автора подано как обычная новость.",
    source_meta_narration: "Передай суть материала без фраз об авторах и редакции источника.",
    unnatural_language: "Перепиши неестественные обороты простым русским языком.",
    rumour_attribution_missing: "Не указано, что информация не подтверждена.",
    context_claim_mismatch: "Контекст статьи расходится с данными сайта.",
    race_context_mismatch: "Проверь, к какому Гран-при относится новость.",
    team_context_mismatch: "Не удалось подтвердить команду для этой новости.",
    unknown_source_fact: "Предыдущая проверка остановилась на служебных данных. Попробуй обработать новость заново.",
    repeated_lead: "Начало статьи повторяет лид.",
    headline_scope_changed: "Заголовок обобщает частный случай на всю аудиторию.",
    incomplete_draft: "Текст статьи получен не полностью.",
    irrelevant_source: "Материал не подходит для новостной ленты.",
    update_target_changed: "Исходная статья изменилась во время подготовки обновления.",
  };
  if (issue.startsWith("invented_number:")) return `Предыдущая проверка отметила число ${issue.slice("invented_number:".length)}. Сверь значение и единицы с оригиналом.`;
  return labels[issue] ?? (/[а-яё]/i.test(issue) ? issue : "Требуется сверка с оригиналом.");
}

export function formatNewsContext(fact: NonNullable<NewsEditorialMeta["context"]>[number]) {
  const scope = fact.scope.match(/^season_(\d{4})_after_round_(\d+)$/);
  if (!scope) return null;
  const detail = ({ championship_position: `${fact.value}-е место`, championship_points: `${fact.value} очк.`, championship_wins: `Побед: ${fact.value}` } as Record<string, string>)[fact.kind];
  return detail ? `${fact.subject} — ${detail}. Сезон ${scope[1]}, после ${scope[2]}-го этапа.` : null;
}
