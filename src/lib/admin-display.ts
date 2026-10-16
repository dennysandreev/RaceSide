import jobCatalog from "@/config/admin-jobs.json";
import aiCatalog from "@/config/ai-prompts.json";

type AdminDisplayCopy = {
  title: string;
  description: string;
};

const auditActionCopy: Record<string, AdminDisplayCopy> = {
  "ai_budget.update": {
    title: "Лимиты AI изменены",
    description: "Сохранены новые дневной и месячный пределы расходов.",
  },
  "ai_prompt.publish": {
    title: "Инструкция AI опубликована",
    description: "Новая версия начнёт применяться к следующим фоновым задачам.",
  },
  "ai_prompt.save_draft": {
    title: "Черновик инструкции AI сохранён",
    description: "Изменения сохранены, но пока не влияют на новые обработки.",
  },
  "digest.update": {
    title: "Дневная сводка изменена",
    description: "Сохранены текст, заголовок или состояние публикации сводки.",
  },
  "driver.avatar_clear": {
    title: "Аватар гонщика скрыт",
    description: "Текущий AI-аватар убран из публичного профиля.",
  },
  "driver.avatar_upload": {
    title: "Аватар гонщика загружен",
    description: "Для публичного профиля сохранено новое изображение.",
  },
  "job.enqueue": {
    title: "Задача добавлена в очередь",
    description: "Она начнёт выполняться после проверки разрешённых параметров.",
  },
  "job.retry": {
    title: "Задача запущена повторно",
    description: "Для прежней ошибки или запроса создан новый безопасный запуск.",
  },
  "news.reprocess_ai": {
    title: "Материал отправлен на переработку",
    description: "Русский заголовок и текст будут подготовлены заново.",
  },
  "news.reprocess_dedup": {
    title: "Проверка дублей запущена повторно",
    description: "Материал снова проверяется на совпадение с другими новостями.",
  },
  "news.update": {
    title: "Материал изменён",
    description: "Сохранены редакционный текст, теги или состояние публикации.",
  },
  "news.hide": {
    title: "Материал убран из ленты",
    description: "Материал сохранён в админке как черновик и больше не виден читателям.",
  },
  "external_api_budget.update": {
    title: "Бюджет X API изменён",
    description: "Сохранены цена чтения поста, дневной и месячный пределы расходов.",
  },
  "news_source.pause": {
    title: "RSS-источник поставлен на паузу",
    description: "Новые материалы из него временно не загружаются.",
  },
  "news_source.resume": {
    title: "RSS-источник включён",
    description: "Источник снова участвует в плановой загрузке новостей.",
  },
  "notification.retry": {
    title: "Уведомление возвращено в очередь",
    description: "Подтверждённо неотправленная запись будет отправлена повторно.",
  },
  "notification.test": {
    title: "Тестовое уведомление создано",
    description: "В Telegram-очередь добавлена безопасная проверочная отправка.",
  },
  "poll.create": {
    title: "Опрос создан",
    description: "Создан новый опрос.",
  },
  "poll.update": {
    title: "Опрос изменён",
    description: "Сохранены вопрос, сроки или состояние публикации опроса.",
  },
  "report.update": {
    title: "Отчёт Гран-при изменён",
    description: "Сохранены краткий вывод редактора или видимость отчёта.",
  },
  "schedule.run_now": {
    title: "Плановая проверка запущена вручную",
    description: "Разрешённая задача добавлена в очередь без изменения расписания.",
  },
  "schedule.update": {
    title: "Расписание изменено",
    description: "Сохранены время запуска, состояние или число безопасных повторов.",
  },
  "social.manual_x": {
    title: "Пост из X добавлен на проверку",
    description: "Ручная публикация сохранена в очереди модерации.",
  },
  "social.publish": {
    title: "Публикация из соцсети одобрена",
    description: "Пост прошёл модерацию и появился в публичной ленте.",
  },
  "social.reject": {
    title: "Публикация из соцсети отклонена",
    description: "Пост снят с очереди модерации и не показывается в ленте.",
  },
  "social.hide": {
    title: "Публикация убрана из ленты",
    description: "Публикация сохранена в админке и больше не видна читателям.",
  },
  "social.retry": {
    title: "Публикация отправлена на переработку",
    description: "Русский текст, тема и решение о публикации будут подготовлены заново.",
  },
  "social_source.pause": {
    title: "Социальный источник поставлен на паузу",
    description: "Новые публикации из него временно не загружаются.",
  },
  "social_source.resume": {
    title: "Социальный источник включён",
    description: "Источник снова участвует в плановой загрузке публикаций.",
  },
  "social_source.save": {
    title: "Социальный источник сохранён",
    description: "Сохранены площадка, адрес и правила загрузки публикаций.",
  },
  "telegram.disconnect": {
    title: "Связь с Telegram отключена",
    description: "Проблемное подключение удалено, аккаунт RaceSide остался активным.",
  },
  "subscription.grant": {
    title: "RaceSide Plus выдан",
    description: "Пользователю добавлен новый период доступа без платёжной операции.",
  },
  "subscription.revoke": {
    title: "RaceSide Plus отозван",
    description: "Доступ пользователя закрыт вручную с обязательной причиной.",
  },
  "billing.confirmation_resend": {
    title: "Подтверждение отправлено повторно",
    description: "Письмо по оплаченному заказу заново поставлено в очередь.",
  },
  "billing.payment_reconcile": {
    title: "Оплата подтверждена вручную",
    description: "Проверенная операция применена к заказу через защищённую транзакцию.",
  },
  "billing.refund_record": {
    title: "Возврат зафиксирован",
    description: "Фактически выполненный возврат сохранён, доступ пользователя пересчитан.",
  },
  "user_error_report.update": {
    title: "Сообщение об ошибке обновлено",
    description: "Сохранены состояние обращения и заметка администратора.",
  },
};

const entityLabels: Record<string, string> = {
  ai_budget: "Лимиты AI",
  ai_prompt: "Инструкция AI",
  external_api_budget: "Бюджет внешнего API",
  digest: "Дневная сводка",
  driver: "Гонщик",
  grand_prix_report: "Отчёт Гран-при",
  job: "Задача",
  job_run: "Запуск задачи",
  news_article: "Новостной материал",
  news_source: "RSS-источник",
  notification_queue: "Уведомление",
  poll: "Опрос",
  profile: "Профиль",
  job_schedule: "Расписание",
  social_post: "Публикация из соцсети",
  social_source: "Социальный источник",
  subscription: "Подписка RaceSide Plus",
  billing_order: "Заказ RaceSide Plus",
  user_error_report: "Сообщение об ошибке",
};

const aiPurposeLabels: Record<string, string> = {
  "news.compose": "Подготовка новости и проверка дубля",
  "news.extract": "Факты и авторство",
  "news.verify": "Проверка перед публикацией",
  "news.audit_metadata": "Проверка метаданных новости",
  "news.daily_digest": "Дневная сводка",
  "news.dedup": "Проверка дублей",
  "news.highlights": "Ключевые фразы новости",
  "news.metadata": "Теги и связи новости",
  "news.summary": "Русский текст новости",
  "polls.generate": "Подготовка опросов гонки",
  "reports.summary": "Краткий вывод отчёта Гран-при",
  "social.reddit": "Обработка публикации из Reddit",
  "social.telegram": "Классификация публикации из Telegram",
  "social.x": "Обработка публикации из X",
  social_post: "Обработка публикации из соцсети",
};

const notificationEventLabels: Record<string, string> = {
  admin_test: "Тестовое уведомление",
  FANTASY_DEADLINE: "Закрытие прогнозов",
  IMPORTANT_NEWS: "Важная новость",
  SESSION_CANCELLED: "Сессия отменена",
  SESSION_STARTING: "Сессия скоро начнётся",
  SESSION_TIME_CHANGED: "Время сессии изменилось",
  TEST_NOTIFICATION: "Тестовое уведомление",
};

export function getAdminAuditActionCopy(action: string): AdminDisplayCopy {
  return auditActionCopy[action] ?? {
    title: "Действие в админке",
    description: "Изменение выполнено через защищённый интерфейс. Технический код доступен в деталях.",
  };
}

export function getAdminEntityLabel(entityType: string) {
  return entityLabels[entityType] ?? "Объект админки";
}

export function getAdminJobCopy(jobName: string): AdminDisplayCopy {
  const definition = jobCatalog.find(job => job.name === jobName);

  return definition
    ? { title: definition.title, description: definition.description }
    : {
        title: "Архивная задача",
        description: "Запуск создан вне текущего каталога. Код доступен в технических деталях.",
      };
}

export function getAdminAiPurposeLabel(purpose: string) {
  return aiPurposeLabels[purpose] ?? "Другая AI-обработка";
}

export function getAdminAiPromptLabel(promptKey: string | null) {
  if (!promptKey) return null;
  return aiCatalog.find(prompt => prompt.key === promptKey)?.title ?? "AI-задача из прежней версии";
}

export function getAdminNotificationEventLabel(eventType: string) {
  return notificationEventLabels[eventType] ?? "Событие RaceSide";
}
