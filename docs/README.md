# Документация RaceSide

Этот каталог хранит регламенты, источники и проверяемые результаты работ. Исторический отчёт с датой описывает состояние на момент проверки, а не обещание о текущем production.

## С чего начать

- [README проекта](../README.md): запуск, проверки, состав репозитория и выпуск.
- [PRODUCT](../PRODUCT.md): текущий продукт и границы реализации.
- [DESIGN](../DESIGN.md): визуальная система и поведение интерфейса.
- [AGENTS](../AGENTS.md), [SKILLS](../SKILLS.md): правила разработки.
- [Схема базы](../supabase/migrations): цепочка миграций, а не первоначальный SQL-черновик.

## Эксплуатация

| Область | Документы |
| --- | --- |
| Новости и AI | [Редакционный регламент](news-editorial-runbook.md), [AI-пайплайн](../06_ai_pipeline.md) |
| Подписка | [Lava.top](lava-top-setup.md), [эксплуатационный регламент](subscription-operations-runbook.md), [интеграция оплаты](../19_subscription_payment_integration.md) |
| Административные операции | [Требования](../11_admin_operations.md), [план исправлений](admin-corrections-implementation-plan.md), [проверки и ограничения](admin-corrections-implementation-results.md) |
| Авторизация и Telegram | [Авторизация и привязка](../04_auth_telegram.md), [бот](../07_bot_spec.md), [загрузка Telegram](../09_telegram_social_ingestion.md), [письма](../supabase/templates/auth/README.md) |
| Результаты сессий | [Синхронизация](../10_session_results_sync.md), [уикенд и LIVE](../16_raceside_live_weekend_sessions.md) |
| LIVE и повторы | [LIVE](../15_raceside_live.md), [алгоритм Race Replay](../08_race_replay_algorithm.md), [пит-лейны](replay-pit-lanes.md), [подготовка трасс](live-track-preparation-2026.md) |
| Телеметрия | [Обзор](telemetry/README.md), [требования](../17_telemetry_hub_development_plan.md), [гоночный темп](../21_race_pace_analytics.md) |
| Фентези | [Прогнозы и лиги](../14_fantasy_league_redesign.md) |
| Безопасность | [Проверки перед запуском](../SECURITY_LAUNCH_GATE.md), [ручные сценарии](../SECURITY_MANUAL_TESTS.md), [исторический аудит](../SECURITY_AUDIT.md) |

## Модели и ассеты

- [Инструменты сборки трасс](../scripts/track-model-blender/README.md).
- [Источники моделей трасс](track-model-sources-2026.md) и [контракт 3D-просмотра](track-model-3d-guide.md).
- Для конкретной трассы: `track-model-<slug>-source-card.md`, `*-source-manifest.json` и `*-build-report.md`, если они существуют.
- [Болид: источники, проверки и ограничения](anatomy/w17-reference-review.md).
- [Единый логотип](../public/brand/raceside/README.txt), [внедрение айдентики](raceside-trajectory-rollout.md).
- [Атрибуция F1](../public/f1/ATTRIBUTION.md) и [геоданных](../public/geo/ATTRIBUTION.md).

Готовые runtime-ассеты хранятся в `public/`. Исходные растры, загрузки поставщиков, Blender-кэш и полные матрицы скриншотов остаются локальными. Тестовые JSON-fixtures сохраняются: они нужны для воспроизведения регрессий.

## История требований

Нумерованные документы в корне сохраняются, потому что на них ссылаются код, регламенты и следующие этапы разработки. Начальные [продуктовый scope](../01_product_and_scope.md), [матрица возможностей](../02_features_matrix.md), [архитектура](../03_architecture.md) и [первичная SQL-схема](../05_database_schema.sql) содержат исторические решения. Не считайте старый список API или предложенный стек точным описанием текущего кода и не применяйте первоначальную SQL-схему поверх существующей базы.

## Как добавлять материалы

- Описывайте цель, проверенные факты, команды, источники и ограничения. Не выдавайте локальную проверку за production-приёмку.
- Не добавляйте реальные секреты, cookies, полные платёжные payload или пользовательские данные. В примерах используйте вымышленные адреса и идентификаторы.
- Сохраняйте только полезные контрольные изображения и ссылайтесь на них из документа. Разрешённые изображения перечислены в [.gitignore](.gitignore); остальные остаются на компьютере.
- Логи прогонов, временные концепты и необработанные экспорты размещайте в игнорируемых `output/` или `tmp/`. Историю Git не переписывайте ради удаления старых картинок.
