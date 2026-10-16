# Lava.top: подписка RaceSide Plus

Все новые платежи проходят через Lava.top с автоматическим продлением: карты российских банков в RUB, зарубежных — в USD. Криптовалютные способы не предлагаются. Исторические заказы и уведомления продолжают обрабатываться с исходными провайдерами.

## Настройка перед включением

1. Примените `supabase/migrations/20260929144700_lava_billing.sql` сначала на тестовой БД, затем на рабочей. Миграция обновляет рублёвые цены и создаёт международные тарифы.
2. В Lava.top создайте **подписочный** продукт с фиксированными ценами для одного `offerId`: `MONTHLY` — 390 RUB и 5 USD; `PERIOD_YEAR` — 3900 RUB и 49.90 USD. Убедитесь, что для обеих валют и периодов доступны повторные списания по банковской карте. Продукт **Price on request via API** с произвольной суммой для этой задачи не подходит: используйте фиксированные цены подписочного предложения.

   [Справка Lava.top](https://faq.lava.top/article/57447) указывает минимум $5 для подписки. Код сверяет цену и не отправит покупателя на счёт с другой суммой.
3. В **Integrations → Public API** создайте API key и сохраните его только на сервере как `LAVA_API_KEY`. Сохраните ID опубликованного предложения как `LAVA_OFFER_ID`.
4. Создайте отдельный секрет для webhook, сохраните в `LAVA_WEBHOOK_SECRET` и настройте **Your service’s API key** в Lava.top. Это не тот же ключ, что `LAVA_API_KEY`.
5. Настройте webhook `https://raceside.online/api/payments/lava/webhook` для `payment.success`, `payment.failed`, `subscription.recurring.payment.success`, `subscription.recurring.payment.failed`, `subscription.cancelled`, `refund.success`, `chargeback.initiated`. Если рабочий домен отличается, замените его.
6. После проверок включите серверные `BILLING_CHECKOUT_ENABLED=true`, `BILLING_LAVA_ENABLED=true`, `BILLING_YOOMONEY_ENABLED=false`. `LAVA_API_BASE` по умолчанию `https://gate.lava.top`. Не используйте `NEXT_PUBLIC_` для ключей.

Сайт создаёт подписку через `POST /api/v3/invoice`, с `paymentMethod=CARD`, `SMART_GLOCAL` для RUB и `UNLIMINT` для USD. Ответ создания содержит `amountTotal`; тип и сумму первой подписочной оплаты сайт дополнительно проверяет через `GET /api/v2/invoices/{id}` (`SUBSCRIPTION_FIRST_INVOICE`). Этот метод отличает первую подписочную оплату от обычного разового счёта и продления (`SUBSCRIPTION_RENEWAL`). Созданный валютный счёт может появляться в API чтения с задержкой; только для такого счёта временный 404 повторяется до трёх раз с паузами 1, 2 и 4 секунды.

Перед переходом на страницу Lava.top сайт сверяет сумму и валюту счёта с локальной ценой, а доступ выдаёт только после серверной проверки оплаченного счёта. Повторное списание добавляет один период даже при повторной доставке webhook. Отмена из аккаунта вызывает `DELETE /api/v1/subscriptions` и отключает будущие списания, сохраняя уже оплаченный доступ. После оплаты пользователь может открыть `/account/subscription`; API также поддерживает URL возврата, но текущий checkout их не передаёт.

## Проверка перед запуском

На тестовом аккаунте выполните покупки для всех четырёх сочетаний периода и валюты. Сверьте суммы на странице Lava.top с ценами выше, затем убедитесь в `/admin/billing`, что первый webhook создал доступ. Проверьте повторную доставку первого webhook, повторное списание, повторную доставку его webhook и кнопку отключения продления. Проверьте, что не создаются дополнительные периоды и что отмена сохраняет уже оплаченный срок. Отдельно проверьте отклонённый платёж и возврат.

События `refund.success` и `chargeback.initiated` не содержат invoice ID. Обработчик связывает их с заказом только при единственном подходящем платеже по email и валюте. При нескольких подходящих списаниях событие остаётся в журнале `/admin/billing` для ручной сверки; чужой заказ не меняется.

## Настройка кабинета от 1 октября 2026

Подписка **RaceSide Plus** опубликована в аккаунте автора:

- Product ID: `184d4020-7cce-425a-b1be-e4220d56f433`.
- Offer ID: `d3045505-aed5-44a5-ac9a-ffe3776610ec` (сохранён в локальном `LAVA_OFFER_ID`).
- Месяц: 390 RUB / 5 USD. Год: 3900 RUB / 49.90 USD.
- Кабинет требует заполнить EUR: задано 5 EUR / 49.61 EUR (годовая сумма округлена из автоматического пересчёта). Checkout сайта не предлагает EUR.

Через фактический код провайдера созданы четыре неоплаченных проверочных счёта на синтетический email `lava-integration-test@example.com`. Для каждого подтверждены сумма, валюта и тип `SUBSCRIPTION_FIRST_INVOICE`. Списание денег не выполнялось. Состояние production после запуска приведено ниже; доставка webhook после реальной оплаты, повторное списание и реальная отмена ещё не проверены.

## Production deployment, 1 October 2026

- Release `17a0106aefdd27ecccbb5a816b4141a7379f6a89d85b9c58908cc1b4dd26b477` is deployed on `raceside.online`.
- Migration `20260929144700_lava_billing.sql` is applied and recorded under that version. Existing orders, subscriptions and paid periods are preserved.
- The RUB webhook now passes the saved `lava_rub` payment method to `billing_apply_payment`, rather than the international `lava` method.
- Local lint, typecheck, build and 38 billing tests passed. Production database tests for first payment, duplicate delivery, renewal and cancellation passed for RUB and USD inside rolled-back transactions.
- Four unpaid invoices were created from the VPS and verified for RUB/USD monthly/yearly prices. No money was charged.
- Production secrets are installed. `BILLING_LAVA_ENABLED=true` and `BILLING_CHECKOUT_ENABLED=true`. Only the web service was recreated to load these settings. Historical payment notifications remain supported with their original providers.
- The Lava webhook is saved with the production URL, seven events and service API key authentication. Two identical webhook entries are present; disabling the lower duplicate awaits explicit user confirmation. The handler's duplicate-payment protection was tested.
- Production health returns 200 with a healthy database. An unsigned webhook request returns 403, an authenticated unknown-event probe returns 200 without activating access, and GET returns 405.
- Browser checks passed for monthly/yearly selection and both card methods. A guest is directed to sign in with the selected plan and method preserved. A real payment, provider webhook delivery and end-to-end access activation remain unverified.
- Backup: `/home/racemate/backups/raceside-pre-lava-20261001.tar.gz`; previous image: `raceside:pre-lava-20261001`.

## Checkout email recovery and payment marks

The failed production checkout was traced to Lava's HTTP 400 response `Incorrect email to purchase`. The same offer and settings returned 201 with a synthetic test email; repeating the failed buyer's request, with permission, returned the email rejection again. The precise restriction behind that provider response is not documented here and must not be assumed to be an invalid API key or an outage.

The site now distinguishes this rejection, offers another payment email and retains the same RaceSide user ID. Retrying after this rejection generates a fresh idempotency key because the original order is already failed. The account email is not changed. Provider error bodies and buyer emails are not exposed in application errors.

Payment choices use a card icon and Mir mark for Russian cards, and Visa/Mastercard marks for international cards. Provider subtitles and the card-renewal paragraph are removed at the user's request; recurring billing itself is unchanged.

Final patch release: `7495938f84e9d5cf6c023c4e6f6d7dc3fc24ea31b28fc7538fc315c40ae7cc41`. Lint, typecheck and 40 billing tests passed. Browser validation at 375, 768 and 1440 pixels confirms that payment labels fit their cards; the grid uses two columns when there are two methods. The full rebuild reached image extraction but ran out of disk space without changing the working container. Only that unused failed candidate was removed. The final web image was successfully rebuilt on the existing production runtime, retaining dependencies and FastF1; only web was restarted. The pre-layout source/env backup is `/home/racemate/backups/raceside-pre-plus-layout-20261001.tar.gz`, with rollback image `raceside:pre-plus-layout-20261001`.

Static logo sources: [Mir](https://commons.wikimedia.org/wiki/File:Mir-logo.SVG.svg), [Visa / Simple Icons 14.15.0](https://cdn.jsdelivr.net/npm/simple-icons@14.15.0/icons/visa.svg), [Mastercard / Simple Icons 5.0.0](https://cdn.jsdelivr.net/npm/simple-icons@5.0.0/icons/mastercard.svg). These local SVG files contain no scripts or remote references. The marks remain trademarks of their respective owners.

## Единый провайдер, 4 октября 2026

Текущие требования 01/18/19/20, PRODUCT, DESIGN и эксплуатационный регламент описывают только Lava.top для новых оплат. Из checkout удалены криптовалютный вариант, создание новых заказов прежнего провайдера и неиспользуемые флаги его включения. Сервер отклоняет прежние методы оплаты и повторное открытие прежних checkout. Исторические миграции, записи и обработчики уведомлений сохранены. Эта правка подготовлена в рабочем дереве; отдельное развёртывание на production в рамках этой правки не выполнялось.

Проверки этой правки: 45 billing-тестов, typecheck и production build прошли. Lint прошёл с исключением `.track-model-build/**`: обычный запуск затронул сгенерированные сборки трасс. Браузер на 375 и 1440 px подтвердил две карточные опции без прежних способов, рублёвые цены, сохранение выбора после перехода на вход и отсутствие горизонтального скролла. Внешние счета и списания в ходе этой правки не создавались.
