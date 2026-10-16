# Внедрение логотипа RaceSide — аудит размещения

Дата: 5 октября 2026 года.

Этот документ фиксирует первичный аудит размещения прежнего набора RS. Актуальная замена на выбранную «Траекторию» и версия RaceSide Plus описаны в [raceside-trajectory-rollout.md](raceside-trajectory-rollout.md); текущие правила находятся в DESIGN.md.

Аудит охватывает фирменную графику всех 61 файлов `src/app/**/page.tsx`, их layouts, загрузку/404, общие компоненты, PNG-превью Plus, карточки для публикации и иконки. Динамические маршруты проверены по общим шаблонам; это не перебор каждой записи новостей, каждого пользователя или каждого заказа.

## Выбор исполнения

| Где | Исполнение | Причина |
| --- | --- | --- |
| Боковая навигация, мобильная шапка, футер | RS + RaceSide с «Гоночный центр» | Единый фирменный блок с подписью, выбранный для постоянной навигации. |
| Загрузка | Горизонтальный RS + RaceSide | Сохраняет компактный заголовок панели. |
| Админка | С «Гоночный центр»; RS при свёрнутом меню | Совпадает с основным меню и сохраняет пропорции в обоих состояниях Sidebar. |
| LIVE / Replay | Горизонтальный 128 px + отдельный LIVE/REPLAY | Не конкурирует с названием этапа, погодой и таймингом. При текущем узком breakpoint фирменный блок скрывается. |
| Приглашение Plus | Горизонтальный 136 px + Plus | Использует ту же графику в компактном заголовке диалога. |
| Маленькие Plus-плашки | RS + плюс | Полное название уже есть рядом; в значке оно было бы нечитаемым. |
| Сравнение пилотов, телеметрия, темп гонки, полный прогноз | Горизонтальный с «Гоночный центр» | Крупные экспортные карточки дают подписи достаточно места. |
| Итоги Гран-при, компактный OG прогноза | Горизонтальный без подписи | Сохраняет короткую шапку и место для сезона/раунда. |
| Favicon, Apple Touch Icon, аватар | Знак RS | Узнаваемость и безопасное поле при малом размере и круглом обрезании. |
| Вертикальный вариант | Сохранён в наборе | Подходит для квадратных брендовых композиций; текущие панели сайта горизонтальные. |

Название переведено в контуры. Общие векторные данные — `src/components/racemate/raceside-logo-artwork.ts`; интерфейс и `next/og` используют `RaceSideLogoSvg`. Знак остаётся красным, название меняется со светлой/тёмной темой.

## Найденные и заменённые старые исполнения

- Общий `RaceMateLogo`: навигация, мобильная шапка, футер, админка.
- Отдельные RS + текст: LIVE/Replay, приглашение Plus, экран загрузки.
- Независимые рисунки в трёх генераторах: сравнение пилотов, прогноз, итоги Гран-при. Телеметрия, темп гонки и OG сравнения наследуют новый общий логотип.
- Мелкие RS+ блоки: account dock и активная подписка в профиле.
- Шесть PNG-превью LIVE/Telemetry для Plus: обновлены только области логотипов; остальной RGBA сравнен с оригиналами и совпадает. Для четырёх используемых PNG добавлены имена с `-logo-20261005`: это обновляет кэш и соответствует `images.localPatterns` без query-параметров. Старые пути сохранены с обновлённой графикой. Fantasy WebP не содержат логотипа и сохранены.
- `src/app/icon.svg`, новый `src/app/apple-icon.png`, квадратная картинка Organization в JSON-LD.
- Подготовленные локальные Telegram avatar/preview SVG/JPG. Изменение самого профиля бота не выполнялось.

Упоминания RaceSide в текстах продукта, эмблемы команд/пилотов, партнёрская графика и исторические скриншоты в `docs/` не являются старым интерфейсным логотипом и сохранены.

## Покрытие маршрутов

| Маршрут | Фирменная оболочка | Проверка |
| --- | --- | --- |
| `/[staticSlug]` | AppShell | Код + браузер: все 14 обслуживаемых статических slug (feedback/drivers имеют отдельные страницы) |
| `/account` | AppShell | Браузер: переход на `/auth`; содержимое после входа — по коду |
| `/account/subscription` | AppShell | Браузер: переход на `/auth`; содержимое после входа — по коду |
| `/admin/ai` | AdminShell layout; requireAdmin | Код общего AdminShell; гость /admin перенаправляется на /auth |
| `/admin/audit` | AdminShell layout; requireAdmin | Код общего AdminShell; гость /admin перенаправляется на /auth |
| `/admin/billing` | AdminShell layout; requireAdmin | Код общего AdminShell; гость /admin перенаправляется на /auth |
| `/admin/community` | AdminShell layout; requireAdmin | Код общего AdminShell; гость /admin перенаправляется на /auth |
| `/admin/findings` | AdminShell layout; requireAdmin | Код общего AdminShell; гость /admin перенаправляется на /auth |
| `/admin/issues` | AdminShell layout; requireAdmin | Код общего AdminShell; гость /admin перенаправляется на /auth |
| `/admin/jobs` | AdminShell layout; requireAdmin | Код общего AdminShell; гость /admin перенаправляется на /auth |
| `/admin/news` | AdminShell layout; requireAdmin | Код общего AdminShell; гость /admin перенаправляется на /auth |
| `/admin/notifications` | AdminShell layout; requireAdmin | Код общего AdminShell; гость /admin перенаправляется на /auth |
| `/admin` | AdminShell layout; requireAdmin | Код общего AdminShell; гость /admin перенаправляется на /auth |
| `/admin/reports` | AdminShell layout; requireAdmin | Код общего AdminShell; гость /admin перенаправляется на /auth |
| `/admin/schedules` | AdminShell layout; requireAdmin | Код общего AdminShell; гость /admin перенаправляется на /auth |
| `/admin/social` | AdminShell layout; requireAdmin | Код общего AdminShell; гость /admin перенаправляется на /auth |
| `/admin/sport` | AdminShell layout; requireAdmin | Код общего AdminShell; гость /admin перенаправляется на /auth |
| `/admin/systems` | AdminShell layout; requireAdmin | Код общего AdminShell; гость /admin перенаправляется на /auth |
| `/admin/users` | AdminShell layout; requireAdmin | Код общего AdminShell; гость /admin перенаправляется на /auth |
| `/auth/check-email` | AppShell | Браузер: новый логотип |
| `/auth/forgot-password` | AppShell | Браузер: новый логотип |
| `/auth` | AppShell | Браузер: новый логотип |
| `/auth/update-password` | AppShell | Браузер: переход на `/auth/forgot-password`; содержимое после входа — по коду |
| `/calendar/[season]/[round]` | AppShell | Код + браузер: 2026/16, завершённый этап |
| `/calendar` | AppShell | Браузер: новый логотип |
| `/data-sources` | redirect to /feedback | Браузер: переход на `/feedback`; содержимое после входа — по коду |
| `/drivers/[slug]` | AppShell via drivers/layout | Код + браузер: профиль Max Verstappen |
| `/drivers/compare` | AppShell via drivers/layout | Браузер: новый логотип |
| `/drivers` | AppShell via drivers/layout | Браузер: новый логотип |
| `/fantasy/leaderboard` | AppShell | Браузер: новый логотип |
| `/fantasy/leagues/[leagueId]` | AppShell | Код шаблона и общей оболочки |
| `/fantasy/leagues` | AppShell via FantasyPage | Браузер: новый логотип |
| `/fantasy` | AppShell | Браузер: новый логотип |
| `/fantasy/prediction` | AppShell via FantasyPage | Браузер: новый логотип |
| `/feedback` | AppShell | Браузер: новый логотип |
| `/leaderboard` | AppShell | Браузер: новый логотип |
| `/leagues` | redirect to /fantasy/leagues | Браузер: переход на `/fantasy/leagues`; содержимое после входа — по коду |
| `/legal/[slug]` | AppShell | Код + браузер: terms, privacy, cookies, disclaimer |
| `/live` | LiveTerminal; AppShell SubscriptionGate when locked | Браузер: новый логотип |
| `/news/[slug]` | AppShell | Код + браузер: опубликованная статья |
| `/news` | AppShell | Браузер: новый логотип |
| `/onboarding` | AppShell | Браузер: переход на `/auth`; содержимое после входа — по коду |
| `/` | AppShell | Код + браузер: обе темы, desktop/mobile |
| `/payment/cancelled` | AppShell via LavaReturn; user/order required | Браузер: переход на `/auth`; содержимое после входа — по коду |
| `/payment/confirmation/[orderNumber]` | AppShell | Код шаблона и общей оболочки |
| `/payment/failed` | AppShell via LavaReturn; user/order required | Браузер: переход на `/auth`; содержимое после входа — по коду |
| `/payment/return` | AppShell | Браузер: переход на `/auth`; содержимое после входа — по коду |
| `/payment/success` | AppShell via LavaReturn; user/order required | Браузер: переход на `/auth`; содержимое после входа — по коду |
| `/plus` | AppShell | Код + браузер: обе темы, новые превью, desktop/mobile |
| `/polls` | AppShell | Браузер: новый логотип |
| `/prediction/[shareSlug]` | AppShell | Код шаблона и общей оболочки |
| `/predictions` | redirect to /fantasy/prediction | Браузер: переход на `/fantasy/prediction`; содержимое после входа — по коду |
| `/race-replay/[sessionKey]` | LiveTerminal; AppShell notFound fallback | Код + браузер: реальный повтор 11731, desktop/mobile |
| `/social` | AppShell | Браузер: новый логотип |
| `/teams/[slug]` | AppShell | Код + браузер: профиль Mercedes |
| `/teams` | AppShell | Браузер: новый логотип |
| `/telemetry/[season]/[meeting]/[session]` | AppShell viewport via telemetry/layout; no footer | Код шаблона и общей оболочки |
| `/telemetry/[season]/[meeting]` | AppShell viewport via telemetry/layout; no footer | Код шаблона и общей оболочки |
| `/telemetry/compare/[id]` | AppShell viewport via telemetry/layout; no footer | Код шаблона и общей оболочки |
| `/telemetry` | AppShell viewport via telemetry/layout; no footer | Браузер: новый логотип |
| `/weekend` | AppShell | Браузер: новый логотип |

## Проверки

- ESLint по проекту: 744 файла, 0 ошибок, 0 предупреждений. Исключены `.track-model-build`, `output`, `tmp`, `.codex-tmp`: это временные и сгенерированные файлы, не исходники. Обычный `pnpm lint` в нынешнем checkout захватывает `.track-model-build/.next` и не даёт полезного результата.
- TypeScript: финальный `pnpm typecheck` — успешно. Промежуточные ошибки параллельно редактируемого отчёта Гран-при исчезли после появления его CSS и компонента графиков; эти файлы в рамках брендинга не изменялись.
- 29 профильных тестов share assets, итогов Гран-при, векторной телеметрии и race pace — успешно.
- Production: финальный `pnpm build --webpack` — успешно, включая компиляцию, TypeScript и все маршруты. Default Turbopack build не подтверждён. Во время проверки закончился диск и параллельно редактировался отчёт Гран-при; после освобождения восстановимых webpack/dev кэшей и завершения тех правок сборка прошла. Исходники, изображения и данные сохранены; dev-сервер восстановлен на прежнем порту 3001.
- Реальные API PNG сравнения пилотов и итогов Гран-при ответили успешно; новые логотипы проверены в полученных файлах. Прогнозы story 1080×1350 и OG 1200×630 отрисованы реальным ImageResponse с явно обозначенными тестовыми данными, без записи прогнозов в базу.
- Приглашение Plus проверено в настоящем гостевом диалоге: тёмная тема, desktop и 375 px. Новый логотип и скриншоты читаются, кнопка закрытия работает.
- Homepage и Plus: обе темы; ширины 375/768/1024/1280. В проверенных фирменных блоках нет растяжения и обрезания; ширина документа равна viewport. Replay: 375/768/1024/1280, без горизонтального переполнения.
- Публичные страницы и гостевые перенаправления проверены в браузере. Закрытые страницы администратора, содержимое реальных заказов и личные состояния аккаунта проверены по коду, без обхода авторизации.

## Артефакты и ограничения

- Скриншоты и browser-audit.json: `output/playwright/raceside-logo-rollout/`.
- Инвентаризация 61 маршрута: `output/raceside-logo-page-inventory.json`.
- Правила применения: `DESIGN.md`, раздел RaceSide logo system.
- Установка в production и изменение Telegram-аккаунта не выполнялись. Кэш существующих share/OG ссылок обновится по текущему TTL; внешние социальные сервисы могут сохранять ранее скачанные картинки.
