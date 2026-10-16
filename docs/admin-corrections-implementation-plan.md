# План реализации исправлений админки RaceSide

Документ описывает реализацию 19 замечаний из аудита админки от 4 октября 2026 года: достоверность мониторинга, Telegram, AI-бюджет, диагностику оплат, аудит действий, повторы задач и работу интерфейса.

**Статус: выбранные исправления A01–A19 реализованы локально 4 октября 2026 года.** Итоги, проверки, снимки экранов и порядок выпуска — в [результатах реализации](admin-corrections-implementation-results.md). Миграция подготовлена, но не применена к рабочей базе; worker/LIVE и web не опубликованы. Отмеченные пункты подтверждены локальными тестами, SQL-стендом, браузером или указанной проверкой только чтением. Неотмеченные пункты сохраняют статус приёмки на рабочем окружении и не означают отсутствия реализации.

Основной источник — [подробный аудит админки](/Users/denisandreev/.codex/visualizations/2026/10/04/01a1068b-fcd8-7091-a361-3a37e8ff2b5e/output/admin-audit/RaceSide-admin-audit.html). Номера A01–A19 сохранены для связи с замечаниями отчёта. Числа из аудита относятся к снимкам 4 октября 2026 года в 16:49 и 17:06 МСК; перед реализацией их следует повторно проверить.

## Основа и границы работ

Следовать [PRODUCT.md](/Users/denisandreev/Documents/RaceMate/PRODUCT.md), [DESIGN.md](/Users/denisandreev/Documents/RaceMate/DESIGN.md), [SKILLS.md](/Users/denisandreev/Documents/RaceMate/SKILLS.md) и [11_admin_operations.md](/Users/denisandreev/Documents/RaceMate/11_admin_operations.md). Для связанных областей использовать [07_bot_spec.md](/Users/denisandreev/Documents/RaceMate/07_bot_spec.md), [09_telegram_social_ingestion.md](/Users/denisandreev/Documents/RaceMate/09_telegram_social_ingestion.md), [12_autonomous_site_administration.md](/Users/denisandreev/Documents/RaceMate/12_autonomous_site_administration.md), [17_telemetry_hub_development_plan.md](/Users/denisandreev/Documents/RaceMate/17_telemetry_hub_development_plan.md), [19_subscription_payment_integration.md](/Users/denisandreev/Documents/RaceMate/19_subscription_payment_integration.md) и [docs/subscription-operations-runbook.md](/Users/denisandreev/Documents/RaceMate/docs/subscription-operations-runbook.md).

План рассчитан на текущие Next.js App Router, TypeScript, Supabase и Node worker. Сначала исправлять существующие repository, actions, RPC и компоненты. Новые зависимости и смена архитектуры не требуются.

Сохранить следующие свойства:

- Каждая привилегированная загрузка и Server Action проверяет администратора.
- Внешние API вызываются только сервером или воркером; браузер читает подготовленные данные.
- Спортивные результаты, выборы пользователей и начисленные очки защищены от произвольной административной правки.
- Опубликованные адреса новостей, история модерации, платежей, цен и запусков сохраняются.
- Финансовые действия остаются идемпотентными и не подтверждают платёж по redirect или словам пользователя.
- Токены, chat ID, buyer email, полный webhook payload и другие чувствительные данные не попадают в общую диагностику или аудит.
- Существующие чужие изменения в рабочей папке не перезаписываются.

Порядок работы по каждому пункту: проверить актуальный код и миграции, воспроизвести дефект, реализовать локальное исправление, выполнить проверки и записать результат. Локальную правку, применённую миграцию и опубликованную версию учитывать раздельно.

## Принятые решения

Это варианты, реализованные в локальном коде. Поведение опубликованного сайта изменится после применения миграции и выпуска совместимых процессов.

| Область | Решение |
| --- | --- |
| Telegram | Использовать существующие статусы базы `pending`, `sending`, `sent`, `failed`, `cancelled`. Не вводить вторую модель статусов. |
| Мониторинг | Получать полный итог и последний запуск каждой задачи в базе. Ограничивать только список подробной истории. |
| Телеметрия | Согласовать сохранённое состояние запроса, ошибку и связанный запуск. Отделить текущую доступность от ошибок за период. |
| AI-бюджет | Подключить радио к существующему `get_ai_budget_guard`. Сохранить дневное окно UTC и скользящие 30 дней. |
| Аудит | При отсутствии новых metadata сохранять исходные. Не восстанавливать утраченные причины предположениями. |
| Автоповторы | В первом выпуске убрать неработающую настройку и обещание повторов. Политика автоматических повторов — отдельное продолжение. |
| Опросы | Сохранить текущую автопубликацию, явно назвать действие и подтвердить ручной запуск. |
| Новости | В первом выпуске показывать публичную ссылку только для доступного на сайте материала. Использовать существующий редактор для остальных состояний. |
| Старые интеграции | Отделить поддержку прошлых оплат от текущего Lava-checkout. Не отключать сверки и не удалять историю автоматически. |
| Plus | Раздельно показывать оплаченный доступ и состояние автопродления. Отзыв доступа не отменяет продление молча. |

Проверка AI-бюджета перед запросом ограничивает новые обращения по уже записанным расходам. Она не резервирует стоимость параллельных запросов и не гарантирует абсолютно точный финансовый потолок. Резервирование расходов не входит в текущие исправления.

## Этапы реализации

| Этап | Пункты | Результат |
| --- | --- | --- |
| 1 | A01, A06, A15 | Исправлены Telegram-действия, сохранение причин в аудите и общие параметры списков. |
| 2 | A02, A03, A11, A12 | Обзор и Системы показывают реальные запуски, ошибки, паузы и рабочие переходы. |
| 3 | A04, A05, A07, A17 | Бюджет охватывает радио; текущие ошибки оплат, валюта, время и автопродление понятны. |
| 4 | A08, A09, A10, A13, A14 | Действия повтора и публикации выполняют именно то, что обещает интерфейс. |
| 5 | A16, A18, A19 | Общие итоги не зависят от срезов, мобильная навигация и тексты согласованы. |

Каждый этап можно выпускать отдельной проверенной группой изменений. A06 должен быть готов до новых административных изменений подписок, оплаты и массового повтора. A15 следует сделать до расширения фильтров и пагинации.

## Telegram и тестовые сообщения

Связь с аудитом: **A01, P1**.

Основные файлы: [src/app/admin/operations.ts](/Users/denisandreev/Documents/RaceMate/src/app/admin/operations.ts), [src/app/admin/notifications/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/notifications/page.tsx), [src/data/admin-repository.ts](/Users/denisandreev/Documents/RaceMate/src/data/admin-repository.ts), [src/types/supabase.ts](/Users/denisandreev/Documents/RaceMate/src/types/supabase.ts), [worker/index.mjs](/Users/denisandreev/Documents/RaceMate/worker/index.mjs).

Реализация:

1. В `sendTestNotificationAction` создавать запись со статусом `pending`; в `retryNotificationAction` возвращать неотправленную ошибочную запись в `pending`.
2. Исправить фильтры: «В очереди» соответствует `pending`, «Отправляются» — `sending`. Добавить отображение отменённых записей.
3. Исправить счётчик ожидающих уведомлений в обзоре; получать полный count с правильным статусом.
4. Использовать тип статуса из существующей схемы. Общий словарь отображения должен покрывать все значения, но не определять правила воркера.
5. Для явного повтора сбрасывать текущий счётчик попыток и ошибку, устанавливать доступное время. Прежние попытки сохранять в безопасных данных аудита.
6. Изменение выполнять условно по `status=failed` и `sent_at IS NULL`. Проверять результат условного обновления; второй конкурентный повтор не должен создавать дубль.
7. Тестовое сообщение подчиняется текущим правилам Plus, привязки Telegram и настроек уведомлений. Проверять эти условия и объяснять отказ до обещания отправки. Не вводить скрытый обход правил доступа.

Миграция статусов не нужна: существующий CHECK базы уже правильный. Статусы `job_runs` и `billing_email_deliveries` не заменять — там `queued` имеет другой смысл.

Приёмка:

- [ ] Тест на тестовом получателе проходит `pending → sending → sent`.
- [ ] Отказ доступа/настроек имеет понятное сообщение и не выглядит успешной отправкой.
- [ ] Повтор ошибочного неотправленного сообщения приводит к одной доставке.
- [x] Уже отправленное сообщение повторить нельзя.
- [ ] Два одновременных запроса повтора не создают две отправки.
- [ ] Фильтры и счётчики совпадают с SELECT по очереди.

## Сохранение данных административного аудита

Связь с аудитом: **A06, P1**.

Основные файлы: [src/lib/admin-audit.ts](/Users/denisandreev/Documents/RaceMate/src/lib/admin-audit.ts), [src/app/admin/operations.ts](/Users/denisandreev/Documents/RaceMate/src/app/admin/operations.ts), [src/app/admin/audit/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/audit/page.tsx), [src/lib/admin-operations.test.mjs](/Users/denisandreev/Documents/RaceMate/src/lib/admin-operations.test.mjs).

В `finishAdminAudit` не включать `metadata` в UPDATE, когда вызывающая сторона не передала это поле. Это минимальный вариант, который сохраняет metadata из `startAdminAudit` и не требует чтения строки перед обновлением.

Если конкретному действию нужны дополнительные поля при завершении, передавать полный безопасный набор явно. Объединение metadata при конкурирующих записях выполнять атомарным RPC только при реальной необходимости; не использовать незащищённую последовательность SELECT → UPDATE.

Проверить все вызовы выдачи/отзыва Plus, ручной сверки, возврата, очереди задач и модерации. Причина, срок, ссылка на подтверждённую операцию и допустимые параметры должны оставаться после успеха и после ошибки. Полные тексты AI-инструкций в аудит не добавлять.

Приёмка:

- [x] Успешное и неуспешное действие сохраняет исходную причину.
- [ ] `before_data`, `after_data`, outcome и время завершения остаются корректными.
- [x] Явно переданные metadata очищаются существующим sanitizer.
- [x] Секреты, Telegram ID и email не раскрываются.
- [x] Старые пустые записи остаются историческими; вымышленных причин не появляется.

## Поиск и параметры списков

Связь с аудитом: **A15, P2**.

Основные файлы: [src/data/admin-repository.ts](/Users/denisandreev/Documents/RaceMate/src/data/admin-repository.ts), [src/components/admin/admin-ui.tsx](/Users/denisandreev/Documents/RaceMate/src/components/admin/admin-ui.tsx), [src/components/admin/admin-filters.tsx](/Users/denisandreev/Documents/RaceMate/src/components/admin/admin-filters.tsx), [src/components/admin/admin-url-tabs.tsx](/Users/denisandreev/Documents/RaceMate/src/components/admin/admin-url-tabs.tsx), [src/types/admin.ts](/Users/denisandreev/Documents/RaceMate/src/types/admin.ts).

Реализация:

1. Отличать отсутствующий/пустой `pageSize` от числового нуля. Применять default из options, валидировать целое число и разрешённый диапазон.
2. Сохранять буквальное поисковое значение, включая подчёркивание. Отдельно безопасно экранировать шаблон поиска и синтаксис PostgREST. Простое удаление символов или сырая вставка в `.or()` не подходит.
3. Проверить поиск с `_`, `%`, запятой, скобками, кавычками, кириллицей и длинным вводом. Служебные символы не должны расширять запрос или менять его смысл.
4. Передавать в пагинацию проверенные параметры `pageSize`, `search`, `status`, `sort`, `tab` и фильтры раздела. GET-форма сохраняет нужные параметры скрытыми полями и сбрасывает страницу при новом поиске.
5. Заменить фиксированный предел в 10 000 страниц границей, согласованной с точным total/pageSize. Проверять безопасный диапазон offset; неверную страницу приводить к допустимой с понятным результатом.
6. Для истории задач добавить фильтр периода и стабильную сортировку с ID при одинаковом времени. Переход на cursor-пагинацию оставить последующей оптимизацией, если измерения покажут проблему с OFFSET.

Приёмка:

- [x] `news.audit_recent` находится как полное имя, а не превращается в другую строку.
- [x] Пустой `pageSize` даёт объявленный default; явный допустимый размер сохраняется.
- [x] Следующая/предыдущая страница сохраняет вкладку, сортировку и фильтры.
- [x] Смена поиска начинает выдачу с первой страницы.
- [ ] Старая запись доступна за пределами прежней границы, при стабильной сортировке.
- [x] Спецсимволы не приводят к ошибке запроса или поиску всех записей.

## Последние запуски и общие показатели задач

Связь с аудитом: **A02, P1**.

Основные файлы: [src/data/admin-repository.ts](/Users/denisandreev/Documents/RaceMate/src/data/admin-repository.ts), [src/types/admin.ts](/Users/denisandreev/Documents/RaceMate/src/types/admin.ts), [src/app/admin/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/page.tsx), [src/app/admin/systems/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/systems/page.tsx), [src/app/admin/schedules/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/schedules/page.tsx), [supabase/migrations/20261002132631_optimize_job_run_monitoring.sql](/Users/denisandreev/Documents/RaceMate/supabase/migrations/20261002132631_optimize_job_run_monitoring.sql).

Добавить серверный RPC, который для переданных разрешённых расписаний/имён возвращает последний запуск, последний успех и counts текущей очереди/ошибок за выбранный период. Название нового RPC определить при реализации; существующий RPC с таким контрактом сначала поискать в базе и миграциях.

Для истории расписания использовать `last_job_run_id` и `metadata.scheduleKey`; ручной запуск той же команды показывать отдельно. Если ссылка отсутствует, различать отсутствие истории расписания и наличие запусков команды. Не объявлять «никогда не запускалась» только потому, что запись не попала в последние 300 строк.

Использовать существующие индексы, проверить EXPLAIN на объёме истории. Добавлять новый индекс только при необходимости; новые чтения не должны сканировать всю историю ради текущей очереди. Не создавать одну RPC/SQL-сессию на каждую строку интерфейса.

RPC доступен service_role; публичные роли не получают историю задач. Новая миграция additive, существующие данные и расписания сохраняются.

Приёмка:

- [x] Последний ежедневный запуск виден после тысяч новых коротких задач.
- [x] Последний успех и последняя ошибка не подменяют друг друга.
- [x] Ручной запуск не меняет историю другого расписания той же команды.
- [x] Queue counts охватывают всю актуальную очередь, а не 120 строк.
- [ ] Все три экрана используют одинаковую семантику и явно указанный период.
- [ ] Запросы используют подходящие индексы и не создают N+1 загрузку.

## Состояние телеметрии

Связь с аудитом: **A03, P1**.

Основные файлы: [worker/telemetry/store.mjs](/Users/denisandreev/Documents/RaceMate/worker/telemetry/store.mjs), [worker/telemetry/store.d.mts](/Users/denisandreev/Documents/RaceMate/worker/telemetry/store.d.mts), [worker/telemetry/service.mjs](/Users/denisandreev/Documents/RaceMate/worker/telemetry/service.mjs), [src/data/admin-repository.ts](/Users/denisandreev/Documents/RaceMate/src/data/admin-repository.ts), [worker/ops-watcher.mjs](/Users/denisandreev/Documents/RaceMate/worker/ops-watcher.mjs), [worker/ops-watcher-rules.mjs](/Users/denisandreev/Documents/RaceMate/worker/ops-watcher-rules.mjs), [src/app/api/telemetry/[...path]/route.ts](/Users/denisandreev/Documents/RaceMate/src/app/api/telemetry/[...path]/route.ts).

Реализация:

1. При окончательном отказе записывать `status=failed` вместе с error_code. Успех сохраняет `ready` и очищает ошибку.
2. Согласовать API, admin loader и watcher: запрос с терминальной ошибкой/неуспешной связанной job не считается здоровым ожиданием.
3. Получать `error_code`, `job_id` и состояние связанной job; считать totals по всему нужному периоду. Лимит списка задач не должен ограничивать итог.
4. Раздельно показывать готовые сравнения, текущую очередь, зависшие запросы и ошибки за сутки. Отсутствие запросов — «Нет запросов», а не авария.
5. Зависание определять по превышению существующего ожидаемого времени/lease и состоянию связанного запуска. Порог должен иметь один источник, с учётом разных типов телеметрии.
6. Проверить повторную постановку: новая попытка должна атомарно очистить прежнюю ошибку и связаться с новой job. Старый завершившийся запуск не должен перезаписать результат новой попытки.
7. Для исторических `queued + error_code` предусмотреть контролируемую сверку с job. Исправление старых строк — отдельная ограниченная операция с предварительным SELECT, а не массовый UPDATE всех queued.

Существующие статусы таблицы достаточны. Если для агрегации/безопасного повторного запуска нужен RPC, добавить отдельную additive-миграцию; текущие кэши и сравнения не удалять.

Приёмка:

- [ ] INVALID_TASK, ошибка провайдера и failed job одинаково интерпретируются API, админкой и watcher.
- [ ] Долгое queued отображается как зависшее с объяснением.
- [ ] Повтор после ошибки действительно приводит к новому актуальному результату.
- [x] Историческая ошибка остаётся в истории, но не объявляет восстановившийся сервис вечной аварией.
- [x] Кэш не считается доказательством работоспособности исполнителя.

## Паузы и поддержка прошлых интеграций

Связь с аудитом: **A11, P2**.

Основные файлы: [src/data/admin-repository.ts](/Users/denisandreev/Documents/RaceMate/src/data/admin-repository.ts), [src/types/admin.ts](/Users/denisandreev/Documents/RaceMate/src/types/admin.ts), [src/app/admin/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/page.tsx), [src/app/admin/systems/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/systems/page.tsx), [src/components/admin/admin-schedule-list.tsx](/Users/denisandreev/Documents/RaceMate/src/components/admin/admin-schedule-list.tsx), [src/config/admin-jobs.json](/Users/denisandreev/Documents/RaceMate/src/config/admin-jobs.json).

Ввести различение текущей ошибки, устаревших данных, намеренной паузы и недоступной конфигурации. Пауза отображается нейтрально и считается отдельно. Старая ошибка отключённого источника остаётся исторической и не увеличивает текущие аварии.

Обзор сначала показывает активные ошибки и просроченные проверки, затем отдельный сворачиваемый блок пауз. Добавить объяснение, когда одна задача заменяет другую: `notifications.enqueue` уже выполняет доставку, поэтому пауза отдельного dispatch не означает остановку Telegram.

В каталоге/расписаниях отделить текущие Lava-процессы от поддержки старых ЮMoney/Tribute-заказов. Готовность внешнего адаптера определять безопасным серверным признаком без выдачи ENV. Выключенное расписание само по себе не означает, что ручной запуск запрещён.

Причину/дату намеренной паузы хранить в существующем безопасном metadata/аудите, если его хватает. Новые поля добавлять только после проверки модели и нужды в постоянном отображении. Не выводить выдуманную причину для старых пауз.

Приёмка:

- [x] Намеренные паузы не увеличивают количество аварий.
- [ ] Для ненастроенной интеграции объяснён отказ запуска.
- [x] Действующий Telegram не выглядит остановленным из-за отдельного dispatch.
- [x] Исходные провайдеры, цены и история заказов сохранены.
- [ ] Отключение старых сверок оформляется отдельным решением после проверки незавершённых операций.

## Переход к настройке источника

Связь с аудитом: **A12, P2**.

Основные файлы: [src/data/admin-repository.ts](/Users/denisandreev/Documents/RaceMate/src/data/admin-repository.ts), [src/app/admin/systems/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/systems/page.tsx), [src/app/admin/news/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/news/page.tsx), [src/app/admin/social/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/social/page.tsx), [src/app/admin/schedules/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/schedules/page.tsx).

Разделить ссылку на диагностическую строку и ссылку на управление источником. «Открыть источник» ведёт на вкладку RSS/соцсетей с ID нужной записи. Для расписания «Настроить» фокусирует конкретную строку/диалог. При неверном или удалённом ID показывать список и понятное сообщение.

Приёмка:

- [x] RSS открывает нужный RSS-источник, соцсеть — нужный социальный источник.
- [ ] Прямая ссылка работает после обновления страницы.
- [x] Переход не вызывает сохранение, запуск или другие изменения.
- [ ] Возврат в диагностику сохраняет полезный контекст.

## Общий AI бюджет и радио LIVE

Связь с аудитом: **A04, P1**.

Основные файлы: [worker/index.mjs](/Users/denisandreev/Documents/RaceMate/worker/index.mjs), [worker/live/server.mjs](/Users/denisandreev/Documents/RaceMate/worker/live/server.mjs), [worker/live/radio.mjs](/Users/denisandreev/Documents/RaceMate/worker/live/radio.mjs), [src/app/admin/ai/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/ai/page.tsx), [src/config/ai-prompts.json](/Users/denisandreev/Documents/RaceMate/src/config/ai-prompts.json), [supabase/migrations/20260724130000_admin_ai_models_budgets_schedules.sql](/Users/denisandreev/Documents/RaceMate/supabase/migrations/20260724130000_admin_ai_models_budgets_schedules.sql).

Подключить оба этапа радио — транскрибацию и перевод — к существующему `get_ai_budget_guard(p_purpose)`. Не импортировать исполняемый `worker/index.mjs` в LIVE-сервер. Переиспользовать доступный helper или вынести небольшую проверку в отдельный модуль только для устранения реального дублирования.

Убрать календарный месяц и самостоятельные ENV-лимиты из основной логики радио. Везде использовать сутки UTC и последние 30 дней, с одинаковыми подписями и значениями в UI. Явно закрепить UTC в SQL дневной границе, не полагаясь на часовую зону сессии БД. Существующие ENV не удалять в этом изменении, если они нужны для совместимости конфигурации; их фактическую роль объяснить в runbook.

**Предлагаемая политика отказа:** когда guard недоступен или вернул неоднозначный/пустой результат, приостановить новые платные AI-запросы и показать диагностический статус. Это изменение текущего fail-open поведения основного воркера; проверить его отдельно, чтобы временная ошибка бюджета не теряла новости и радио-задания.

Если расход неизвестен из-за записей без цены, не объявлять его нулевым. Не обещать абсолютную финансовую гарантию при параллельных обращениях.

Инструкции радио в первом выпуске явно обозначить как не редактируемые в текущем реестре. Добавление радио в registry — отдельное расширение с сохранением формата, модели и лимитов; не обещать управление всеми инструкциями до него.

Приёмка:

- [ ] Лимит из админки одинаково останавливает следующий запрос новости и радио.
- [x] Перед переводом повторно проверяется оставшийся бюджет после транскрибации.
- [x] Ошибка guard не запускает новый платный запрос и не теряет исходное задание.
- [ ] UI показывает тот же дневной/30-дневный расход, что guard.
- [x] X API остаётся отдельным бюджетом.
- [ ] Учёт стоимости сохраняет фактические ответы и ошибки провайдера.

## Диагностика текущих оплат

Связь с аудитом: **A05, P1**.

Основные файлы: [src/app/admin/billing/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/billing/page.tsx), [src/data/admin-repository.ts](/Users/denisandreev/Documents/RaceMate/src/data/admin-repository.ts), [src/lib/billing/order-state.ts](/Users/denisandreev/Documents/RaceMate/src/lib/billing/order-state.ts), [src/lib/billing/catalog.ts](/Users/denisandreev/Documents/RaceMate/src/lib/billing/catalog.ts), [src/app/api/payments/lava/webhook/route.ts](/Users/denisandreev/Documents/RaceMate/src/app/api/payments/lava/webhook/route.ts), [docs/subscription-operations-runbook.md](/Users/denisandreev/Documents/RaceMate/docs/subscription-operations-runbook.md).

Вынести чтение оплат в существующий admin repository и выполнять поиск/фильтрацию на сервере до ограничения выборки. Разделить текущие ошибки оформления, события провайдера, споры и историю.

Добавить продуктовый словарь причин: отказ платёжного email, ошибка создания счёта, ошибка сохранения заказа и истечение попытки. Технический код оставить в подробностях. Не раскрывать сырые ответы/контакты в общих таблицах.

Счётчик внимания формировать по активным состояниям и периоду, а не по всем старым rejected событиям. Истечение неоплаченного checkout учитывать отдельно от отказа интеграции. Не суммировать один заказ и его событие как две разные текущие проблемы без пояснения.

Для Lava серверной диагностике разрешено использовать существующую проверку invoice. Legacy reconciliation и `billing.retry_failed_events` не представлять как проверку статуса Lava. Сам исправленный экран не устраняет внешнюю причину `LAVA_EMAIL_REJECTED` или ошибку записи заказа: такие случаи диагностировать по конкретной операции.

Приёмка:

- [ ] Видны причина, дата, провайдер, сумма/валюта и допустимый следующий шаг.
- [ ] Обычное истечение не выдаётся за аварию интеграции.
- [ ] Старые invalid_signature доступны в истории, но не перекрывают актуальные Lava-ошибки.
- [ ] Платёж не отмечается подтверждённым без проверенного серверного основания.
- [x] Поиск работает по всей истории, включая заказ старше первых 150 записей.

## Валюта и дата ручной сверки

Связь с аудитом: **A07, P2**.

Основные файлы: [src/app/admin/billing/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/billing/page.tsx), [src/app/admin/operations.ts](/Users/denisandreev/Documents/RaceMate/src/app/admin/operations.ts), [src/lib/billing/catalog.ts](/Users/denisandreev/Documents/RaceMate/src/lib/billing/catalog.ts).

Передавать `currency` в форму сверки. Показывать «Зачислено, USD» или «Зачислено, ₽» по заказу; рядом выводить сумму и валюту исходной операции. Не выполнять автоматическую конвертацию.

Для ручного ввода использовать явно подписанное время МСК. Преобразовывать его на сервере в UTC с определённым смещением, а не через зависимый от зоны сервера `new Date(raw)`. Не заполнять дату текущим моментом как будто это время найденной операции.

Проверять формат, реальную календарную дату и допустимые значения до RPC. Не принимать невозможную дату после автоматической нормализации Date. Суммы разбирать существующим механизмом minor units.

Приёмка:

- [x] RUB/USD/EUR корректно подписаны; значение трактуется в валюте заказа.
- [x] Браузер и сервер с разными зонами сохраняют один момент.
- [x] Пустая/невозможная дата и неправильная сумма отклоняются.
- [x] Подтверждение показывает итоговую сумму, дату, заказ и действие.
- [ ] Повтор сверки не создаёт второй оплаченный период.

## Доступ Plus и автопродление

Связь с аудитом: **A17, P2**.

Основные файлы: [src/app/admin/users/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/users/page.tsx), [src/app/admin/billing/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/billing/page.tsx), [src/data/admin-repository.ts](/Users/denisandreev/Documents/RaceMate/src/data/admin-repository.ts), [src/app/admin/operations.ts](/Users/denisandreev/Documents/RaceMate/src/app/admin/operations.ts), [src/lib/billing/repository.ts](/Users/denisandreev/Documents/RaceMate/src/lib/billing/repository.ts), [src/lib/billing/providers/lava.ts](/Users/denisandreev/Documents/RaceMate/src/lib/billing/providers/lava.ts).

Показать отдельно:

- Оплаченный доступ и дату окончания.
- Автопродление Lava: включено, отменено или не подтверждено.
- Исходный контракт, связь продления с ним, дату отмены и последнее подтверждённое событие.
- Следующую ожидаемую оплату только при наличии надёжного источника. Не приравнивать её автоматически к концу доступа.

Переиспользовать `lava_auto_renew`, `lava_cancelled_at`, `lava_parent_contract_id` и существующее сопоставление контрактов. Подпись отзыва явно объясняет, что изменяется доступ; она не обещает остановки списаний.

Административную отмену продления делать отдельным подтверждаемым Server Action с `requireAdmin`, обязательной причиной и защищённым целевым контрактом. Переиспользовать существующую серверную отмену Lava; не дублировать вызов провайдера в UI. Принимать состояние «уже отменено» идемпотентно. Оплаченный срок при отмене продления сохранять.

Этот план не предусматривает фактической отмены существующих подписок во время разработки или тестирования production.

Приёмка:

- [x] Отзыв доступа и отмена продления имеют разные названия и объяснения.
- [ ] Ошибка внешней отмены не показывается как успех.
- [ ] Подтверждённая отмена сохраняет оплаченный остаток.
- [ ] Повтор отмены не повреждает договор/историю.
- [ ] Контракт другого пользователя не может быть выбран подменой formData.

## Массовый повтор проблемных постов

Связь с аудитом: **A08, P2**.

Основные файлы: [worker/index.mjs](/Users/denisandreev/Documents/RaceMate/worker/index.mjs), [src/config/admin-jobs.json](/Users/denisandreev/Documents/RaceMate/src/config/admin-jobs.json), [src/app/admin/social/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/social/page.tsx), [src/app/admin/operations.ts](/Users/denisandreev/Documents/RaceMate/src/app/admin/operations.ts), [supabase/migrations/20260914115411_harden_admin_operations.sql](/Users/denisandreev/Documents/RaceMate/supabase/migrations/20260914115411_harden_admin_operations.sql).

Согласовать `social.retry_failed` с защищённым повтором одной публикации. Возвращать только выбранные проблемные записи в реально исполнимое состояние: `pending`, актуальное время, сброшенные попытки и ошибка.

Не вызывать по одному существующий RPC, создающий множество новых jobs, если партия уже обрабатывается плановым `social.process_ai`. Предпочтительно ограниченная атомарная выборка/обновление через RPC с проверкой текущего статуса и защитой конкуренции. Сохранить единый queued/running запуск обработки и существующую защиту от дублирования.

Добавить лимит партии, понятное подтверждение и аудит: сколько записей выбрано, сколько возвращено, сколько пропущено. Явно предупредить о новой AI-обработке и её расходах. Новые параметры команды должны одновременно появиться в web- и worker-каталоге.

Приёмка:

- [x] Запись с 8 попытками после явного повтора попадает в обработку.
- [x] Published/rejected/duplicate посты не возвращаются случайно.
- [ ] Параллельная модерация не перезаписывается массовым повтором.
- [x] UI и worker отчитываются о фактически изменённых записях.
- [ ] Бюджетный guard остаётся действующим.

## Настройка числа автоматических повторов

Связь с аудитом: **A09, P2**.

Основные файлы: [src/components/admin/admin-schedule-list.tsx](/Users/denisandreev/Documents/RaceMate/src/components/admin/admin-schedule-list.tsx), [src/app/admin/operations.ts](/Users/denisandreev/Documents/RaceMate/src/app/admin/operations.ts), [src/config/admin-jobs.json](/Users/denisandreev/Documents/RaceMate/src/config/admin-jobs.json), [11_admin_operations.md](/Users/denisandreev/Documents/RaceMate/11_admin_operations.md), [DESIGN.md](/Users/denisandreev/Documents/RaceMate/DESIGN.md).

В текущем выпуске убрать редактирование «Попыток при временной ошибке» и обещание автоматических повторов из формы. Сохранить `max_attempts` в схеме и очереди для совместимости; не сбрасывать его значения на всех расписаниях.

Server Action не должен незаметно заменять существующий max_attempts, если поле больше не отправляется. Сохранить корректное поведение существующих защищённых параметров и тайминга.

Документы 11 и DESIGN синхронизировать с фактической возможностью: через админку меняются время и пауза; автоматический retry ещё не реализован.

Приёмка:

- [x] Форма не обещает поведение, которого нет.
- [x] Сохранение времени/паузы не меняет max_attempts случайно.
- [ ] Ручной повтор и следующий плановый запуск работают по прежним правилам.

Автоматический retry вынесен в отдельную задачу: классификация временных ошибок, backoff, предел, lease, идемпотентность и терминальный failed. Для оплат, отправок и публикаций его нельзя включать общей механической заменой failed → queued.

## Повтор архивных команд

Связь с аудитом: **A10, P2**.

Основные файлы: [src/app/admin/jobs/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/jobs/page.tsx), [src/app/admin/operations.ts](/Users/denisandreev/Documents/RaceMate/src/app/admin/operations.ts), [src/lib/admin-job-catalog.ts](/Users/denisandreev/Documents/RaceMate/src/lib/admin-job-catalog.ts), [src/lib/admin-jobs-server.ts](/Users/denisandreev/Documents/RaceMate/src/lib/admin-jobs-server.ts).

При загрузке истории вычислять возможность повтора по текущему каталогу и валидности сохранённых `metadata.args`, а не только по status. Использовать тот же validator, который вызывается при enqueue; сервер повторно валидирует всё независимо от UI.

Архивным командам показывать «Архивная задача» без неработающей кнопки. Актуальную замену предлагать только при явно проверенном соответствии; старые аргументы не переносить в другую команду автоматически.

Приёмка:

- [x] Старые `news.audit_recent` и другие отсутствующие команды не имеют ложного повтора.
- [ ] Текущая разрешённая команда с валидными аргументами повторяется.
- [x] Отсутствующий обязательный параметр имеет объяснение.
- [x] Legacy-записи не начинают выполняться автоматически.

## Публичные ссылки и предпросмотр новостей

Связь с аудитом: **A13, P2**.

Основные файлы: [src/app/admin/news/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/news/page.tsx), [src/components/admin/admin-article-editor-dialog.tsx](/Users/denisandreev/Documents/RaceMate/src/components/admin/admin-article-editor-dialog.tsx), [src/data/admin-repository.ts](/Users/denisandreev/Documents/RaceMate/src/data/admin-repository.ts), [src/data/racemate-repository.ts](/Users/denisandreev/Documents/RaceMate/src/data/racemate-repository.ts).

Определять доступность публичной страницы по тем же условиям, что `getNewsArticle`: processed, published, отсутствие duplicate_of и допустимый AI-результат. Публичную кнопку назвать «На сайте» и показывать только когда материал действительно доступен.

Для остальных состояний оставить редактор и ссылку на оригинал, если он есть. Отдельный защищённый read-only preview можно добавить следующим шагом, но исправление не должно требовать публикации черновика или ослабления публичной выборки.

Приёмка:

- [x] У дубля/черновика/обрабатываемого материала нет публичной кнопки, ведущей на 404.
- [ ] Published материал открывается на сайте.
- [ ] Снятый материал сохраняет адрес и историю.
- [x] Публичный API не начинает выдавать неопубликованный контент.
- [ ] Открытие редактора/оригинала не изменяет материал.

## Явная публикация опросов

Связь с аудитом: **A14, P2**.

Основные файлы: [src/config/admin-jobs.json](/Users/denisandreev/Documents/RaceMate/src/config/admin-jobs.json), [src/app/admin/community/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/community/page.tsx), [src/app/admin/jobs/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/jobs/page.tsx), [src/components/admin/admin-schedule-list.tsx](/Users/denisandreev/Documents/RaceMate/src/components/admin/admin-schedule-list.tsx), [worker/index.mjs](/Users/denisandreev/Documents/RaceMate/worker/index.mjs).

Сохранить существующее поведение `polls.generate_next_race`: подготовка отсутствующих опросов ближайшего этапа и публикация. Обновить описание в общем каталоге и все места использования.

Ручное действие назвать «Создать и опубликовать опросы» и проводить через существующее подтверждение. В нём объяснить, что новые опросы появятся на сайте, а завершённые AI-опросы могут закрыться. Подтверждение должно действовать также в каталоге и ручном запуске расписания; не добавлять одно ложное обещание только на странице Сообщества.

Не менять ежедневное время или переходить на draft без отдельного продуктового решения.

Приёмка:

- [x] В UI и каталоге нет обещания черновиков.
- [x] Ручная публикация раскрывает публичные изменения до подтверждения.
- [ ] Повтор команды не создаёт дубли существующих типов опросов.
- [x] Плановая автопубликация сохраняет прежнюю периодичность.

## Полные итоги и история разделов

Связь с аудитом: **A16, P2**.

Основные файлы: [src/data/admin-repository.ts](/Users/denisandreev/Documents/RaceMate/src/data/admin-repository.ts), [src/app/admin/community/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/community/page.tsx), [src/app/admin/billing/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/billing/page.tsx), [src/app/admin/reports/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/reports/page.tsx), [src/app/admin/sport/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/sport/page.tsx), [src/app/admin/ai/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/ai/page.tsx), [src/components/admin/admin-ai-prompt-registry.tsx](/Users/denisandreev/Documents/RaceMate/src/components/admin/admin-ai-prompt-registry.tsx).

Реализация:

1. «Ожидают подсчёта» считать точным count по всем нужным прогнозам, не по последним 30. Определить охват явно: все незасчитанные либо только завершённые гонки; не менять спортивную логику подсчёта.
2. Опросы/лиги, историю сводок, заказы и историю AI-версий пагинировать/фильтровать на сервере, до limit.
3. Для лиг добавить заявленный поиск; состояние закрытой лиги показывать понятным текстом.
4. Для спорта добавить сезон в диагностику; полные counts обозначать как глобальные, ограниченные списки — как последние записи. Полный readiness gate архива сохраняется.
5. Историю инструкций получать по конкретному prompt_key, чтобы активность других задач её не обрезала.
6. Оставлять точные totals отдельно от page items. Лимит PostgREST учитывать для связанных голосов/участников, если они нужны для корректного агрегата.

Приёмка:

- [x] Старая незасчитанная запись влияет на общий итог вне текущей страницы.
- [x] Поиск находит старый заказ и старую лигу.
- [x] Версии одной инструкции не исчезают после сотни изменений других.
- [x] Фильтр сезона не меняет публичный выбор текущего сезона.
- [x] У ограниченного диагностического списка явно указан охват.

## Мобильная навигация

Связь с аудитом: **A18, P3**.

Основные файлы: [src/components/admin/admin-shell.tsx](/Users/denisandreev/Documents/RaceMate/src/components/admin/admin-shell.tsx), [src/components/ui/sidebar.tsx](/Users/denisandreev/Documents/RaceMate/src/components/ui/sidebar.tsx).

Закрывать мобильный drawer после выбора пункта и после успешной смены pathname. Переиспользовать существующий `useSidebar`; не менять глобальную desktop-навигацию ради админки.

После перехода фокус должен оставаться осмысленным: новый заголовок/основное содержимое либо trigger по существующему паттерну. Отмена открытия возвращает фокус на trigger.

Приёмка:

- [x] На 375 px выбор раздела закрывает меню и показывает новый экран.
- [x] Keyboard-навигация, Escape и возврат фокуса работают.
- [x] Desktop sidebar не сворачивается сам при смене раздела.

## Названия статусов и действий

Связь с аудитом: **A19, P3**.

Основные файлы: [src/components/admin/admin-ui.tsx](/Users/denisandreev/Documents/RaceMate/src/components/admin/admin-ui.tsx), [src/lib/admin-display.ts](/Users/denisandreev/Documents/RaceMate/src/lib/admin-display.ts), [src/app/admin/users/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/users/page.tsx), [src/app/admin/issues/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/issues/page.tsx), [src/app/admin/jobs/page.tsx](/Users/denisandreev/Documents/RaceMate/src/app/admin/jobs/page.tsx), [src/components/ui/sidebar.tsx](/Users/denisandreev/Documents/RaceMate/src/components/ui/sidebar.tsx), [src/config/admin-jobs.json](/Users/denisandreev/Documents/RaceMate/src/config/admin-jobs.json).

Дополнить словари реально используемыми статусами: например «Закрыто» для dismissed сообщения, «Закрытая лига» для private и «Скрыто» в подходящем контексте suppressed. Не переводить одно общее слово так, чтобы смысл разных сущностей смешивался. Технический код доступен в подробностях.

Desktop/mobile должны одинаково называть Telegram-тест «Отправить тест». Для taskId и других служебных параметров добавить понятные подписи.

Уточнить подписи команд с внешними эффектами: сбор уведомлений выполняет и отправку; обновление социальных метрик делает запросы к источникам. Доступные имена Sidebar/trigger перевести, проверив влияние общего компонента на другие поверхности.

Приёмка:

- [ ] Реальные статусы отображаются по-русски в нужном контексте.
- [ ] Desktop/mobile одинаково описывают действия.
- [ ] Подпись кнопки раскрывает существенный результат.
- [x] Читатель экрана получает русские доступные имена.

## Дополнительные пункты после основных исправлений

Эти пункты отмечены в ограничениях аудита и не подменяют A01–A19.

| Пункт | Реализация | Условие готовности |
| --- | --- | --- |
| Свежесть watcher и сервисов | Проверять возраст heartbeat, enabled и последний цикл; вывести worker, cron, runner, web, watcher, LIVE. Порог брать из фактической периодичности каждого сервиса. | Остановленный watcher не остаётся «Работает» по вчерашней записи; отсутствие данных отличается от подтверждённого отказа. |
| Рекомендации watcher | Показать существующие proposed `admin_action_requests`, основание и безопасный переход к действию. | Режим рекомендаций даёт доступный результат; автоматическое выполнение не включено. |
| Закрытие находок | Отличать восстановление сигнала от исправления причины и ручного закрытия. | «Исправлено» имеет проверяемое основание, история не переписывается. |
| Возвраты | Согласовать ручной полный возврат с `refunded_amount_minor`; определить поддержку частичного возврата, не вызывая реальное движение денег. | Статус, возвращённая сумма и доступ согласованы, событие идемпотентно. |
| Предварительный срок Plus | Сервером показывать новый конец доступа до подтверждения, а RPC повторно рассчитывает его при записи. | Превью понятно; конкурентное изменение не сокращает доступ и не делает старое превью гарантией. |
| Закрытые опросы | Оставить только допустимые переходы в select, сохранив backend guard. | UI не предлагает переоткрытие закрытого опроса. |
| Общая обратная связь | Сверить текущую локальную/опубликованную версию feedback и миграцию `20261004134233_site_feedback.sql`. | Пожелание приватно сохраняется, доставка/повтор работают в тестовом support-канале; не дублируется уже реализованная функция. |

## Миграции и совместимость

Предварительная карта; существующие RPC и применённые версии нужно проверить перед созданием файлов.

| Изменение | Нужна ли миграция |
| --- | --- |
| Telegram-статусы, фильтры, audit metadata, URL-параметры, тексты/навигация | Обычно нет: используются существующие поля и ограничения. |
| Последние запуски и полные агрегаты мониторинга | Да, если нужного закрытого RPC ещё нет; проверить индексы текущей миграции оптимизации. |
| Телеметрия | Новые статусы не нужны; закрытый агрегат/атомарный повтор и сверка истории могут потребовать миграцию. |
| Общий AI-budget guard | RPC уже есть; может понадобиться уточнить UTC и политику неполного учёта. |
| Массовый повтор соцсетей | Вероятно, закрытый атомарный RPC и ограниченная партия. |
| Причины паузы | Только если существующих metadata/аудита недостаточно. |
| Отображение Lava-автопродления | Поля уже есть; сначала переиспользовать существующую модель. |

Все новые RPC: ограниченный контракт, фиксированный search_path, запрет PUBLIC/anon/authenticated на привилегированное исполнение, service_role после server guard. SECURITY DEFINER использовать только при необходимости; следовать существующему безопасному паттерну проекта.

Новые миграции additive. Не редактировать уже применённый SQL-файл ради изменения production. При изменении контракта RPC сохранить обратную совместимость на время обновления web и worker.

Если появляется новый RPC/поле, синхронизировать [src/types/supabase.ts](/Users/denisandreev/Documents/RaceMate/src/types/supabase.ts) и [src/types/admin.ts](/Users/denisandreev/Documents/RaceMate/src/types/admin.ts). Обновить соответствующие требования и runbook в том же этапе реализации.

## Проверки после реализации

Текущая задача меняет только документацию. Команды ниже — обязательные проверки будущей реализации, а не отчёт об их выполнении сейчас.

Общий набор:

```bash
pnpm lint
pnpm typecheck
pnpm test:admin
pnpm test:ops
pnpm test:notifications
pnpm test:billing
pnpm test:telemetry
pnpm build
```

Дополнительно запускать точечные worker-тесты для изменённых бюджетов, радио, очереди и социальных повторов. Скрипты подтверждены текущим package.json; перед выполнением проверить, что они не сменились.

Регрессионные тесты должны воспроизводить реальные границы: несовпадение статусов БД, сохранение причин после завершения, точный поиск с подчёркиванием, редкая задача вне общей выборки, исчерпанные попытки, неправильная валюта/зона и конкурентный повтор. Проверка текстового совпадения исходников не заменяет поведенческий тест.

Для SQL-изменений проверить функции на тестовой базе: разрешения, точность агрегатов, конкуренцию, идемпотентность и планы запросов. Не использовать production как площадку для тестовых начислений, отправок и публикаций.

Браузерная приёмка:

- Все 16 разделов открываются без новых ошибок.
- Проверены 375, 768, 1024 и 1440 px, обе темы, клавиатура и фокус.
- Формы показывают inline error, pending и успешный результат.
- Фильтры, вкладки и страницы сохраняют корректный URL.
- Есть loading, empty, error, stale, paused и unknown состояния.
- Изменяющие проверки используют тестовые аккаунты, каналы и операции с контролируемыми данными.

## Выпуск и откат

1. Зафиксировать SHA исходников/образов и применённые миграции; проверить совпадение web, worker, cron, runner и LIVE.
2. Сохранить резервную копию БД и доступ к предыдущим образам.
3. Применить только новые совместимые миграции, проверить права и read-only SQL.
4. Обновить необходимые worker/LIVE-сервисы, затем web; временно смешанные версии должны понимать один контракт.
5. Проверить свежие heartbeat, очередь, показатели и UI. Один безопасный тестовый сценарий не заменяет проверку каждого изменённого конвейера.
6. Сопоставить отображаемые totals с базой, проверить сохранение аудита и отсутствие неожиданного роста отправок/публикаций/AI-запросов.
7. Только после этого отметить соответствующие пункты приёмки выполненными.

При откате вернуть совместимые web/worker-образы, не удалять новые данные и аудит. Additive-миграции по умолчанию сохранить. Не возвращать старый клиент к несовместимому контракту; при необходимости использовать переходную версию.

Webhook Lava остаётся доступным для действующих контрактов. Откат интерфейса или выключение новых checkout не отменяет продление и не должен потерять финансовые события.

## Общий критерий завершения

- [ ] Все A01–A19 реализованы выбранным в этом документе способом и проверены.
- [ ] UI, worker и база согласованы по статусам, периодам и смыслу действий.
- [ ] Показатели охватывают заявленные данные, а ограниченные списки обозначены.
- [ ] Нет ложных кнопок для архивных/недоступных операций.
- [ ] Новые административные действия сохраняют автора, причину, результат и безопасный контекст.
- [ ] История оплат, публикаций, спортивных данных и пользовательских решений сохранена.
- [x] Обязательные проверки прошли; ограничения и непроверенные места явно записаны.
- [ ] Документы и опубликованная версия соответствуют фактической реализации.
