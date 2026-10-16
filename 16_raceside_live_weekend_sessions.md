# Дополнение к ТЗ RaceSide LIVE
## Поддержка всех сессий гоночного уик-энда

Правила подписочного доступа из `18_subscription_concept.md` распространяются на все перечисленные ниже сессии и состояния LIVE Hub.

RaceSide LIVE необходимо реализовать **не только для основной гонки**, а для всех доступных сессий текущего гоночного уик-энда.

LIVE Hub является единым интерфейсом для:

- Practice 1;
- Practice 2;
- Practice 3;
- Qualifying;
- Sprint Qualifying / Sprint Shootout, если такой формат используется;
- Sprint;
- Race.

Архитектура не должна быть завязана исключительно на Race.

---

# 1. Автоматическое определение активной сессии

При открытии RaceSide LIVE backend должен автоматически определить:

1. текущий этап;
2. текущую либо ближайшую сессию;
3. тип сессии;
4. статус сессии;
5. идентификатор сессии в источнике live-data.

Frontend не должен требовать от пользователя вручную выбирать технический `session_key`.

---

# 2. Одна кнопка LIVE для всего этапа

Кнопка LIVE на странице текущего этапа должна работать в течение всего гоночного уик-энда.

Текст кнопки может динамически меняться в зависимости от текущей сессии.

Например:

```text
● LIVE — FP1
```

```text
● LIVE — QUALIFYING
```

```text
● LIVE — SPRINT
```

```text
● LIVE — RACE
```

Если прямо сейчас нет активной сессии:

```text
LIVE HUB
```

или просто:

```text
LIVE
```

При этом кнопка всё равно должна открывать Live Hub.

---

# 3. Состояние между сессиями

Если пользователь открыл LIVE между сессиями, не закрывать Hub и не показывать ошибку.

Показать полноценный waiting state.

Например:

```text
SPANISH GRAND PRIX

Следующая сессия

QUALIFYING

Начало через
01:24:18
```

Также можно показать:

- предыдущую завершённую сессию;
- время следующей сессии;
- погоду;
- расписание оставшихся сессий этапа.

Когда следующая сессия начинается, LIVE Hub должен автоматически перейти в активное состояние без необходимости покидать страницу.

---

# 4. Session-aware UI

Основной fullscreen layout остаётся одинаковым:

```text
LIVE TIMING
|
ТРАССА / ТАЙМИНГ / ПИЛОТ / АНАЛИТИКА
|
СОБЫТИЯ / РАДИО
```

Но содержимое Timing и некоторых блоков автоматически адаптируется под тип сессии.

Не создавать четыре совершенно разных страницы.

Должен существовать единый:

```text
RaceSide Live Hub
```

с session-specific presentation logic.

---

# 5. Practice

Для:

- FP1;
- FP2;
- FP3;

основной Timing Tower должен ориентироваться на лучшее время круга.

Показывать минимум:

```text
POS
DRIVER
TYRE
BEST
GAP
LAST
LAPS
```

Пример:

```text
01 HAM   M   1:18.422
02 NOR   S     +0.142
03 RUS   M     +0.317
```

Для Practice обычный race-style `gap_to_leader` по расположению машин на трассе не должен становиться основной метрикой.

Основное значение:

```text
gap to fastest lap
```

---

# 6. Practice — подробный Timing

Центральная вкладка:

```text
ТАЙМИНГ
```

для Practice должна показывать:

```text
POS
DRIVER
TYRE
BEST
GAP
LAST
S1
S2
S3
LAPS
PITS
```

Если возможно:

- personal best sectors;
- session best sectors;
- current lap status;
- out lap;
- pit.

---

# 7. Practice — карта

В режиме:

```text
ТРАССА
```

машины продолжают отображаться и двигаться в live точно так же, как во время Race.

Доступны:

- положение машин;
- speed;
- throttle;
- brake;
- gear;
- DRS;
- selected driver;
- weather;
- Race Control.

---

# 8. Qualifying

LIVE Hub должен полноценно работать для квалификации.

Не использовать Race layout без изменений.

Для Qualifying основной Timing Tower:

```text
POS
DRIVER
TYRE
BEST
GAP
```

Например:

```text
01 HAM   S   1:19.221
02 RUS   S     +0.081
03 NOR   S     +0.147
```

Дополнительно отображать состояние пилота:

```text
PIT
OUT LAP
FLYING
IN LAP
```

если эти состояния можно определить из доступных данных.

---

# 9. Q1 / Q2 / Q3

LIVE Hub должен понимать текущую фазу квалификации.

В Top HUD:

```text
● LIVE · QUALIFYING · Q1
```

```text
● LIVE · QUALIFYING · Q2
```

```text
● LIVE · QUALIFYING · Q3
```

При переходе:

```text
Q1 → Q2 → Q3
```

страница не перезагружается.

State обновляется внутри существующего Live Hub.

---

# 10. Qualifying elimination zones

Для Qualifying Timing Tower желательно визуально показывать зону вылета.

Например в Q1:

нижние пилоты, которые на данный момент не проходят в Q2, получают отдельный визуальный separator / danger zone.

Аналогично для Q2.

Не хардкодить количество проходящих пилотов без проверки актуального формата сессии.

### Корректировки после окончания сегмента

`SESSION FINISHED` означает окончание отсчёта сегмента, но пилоты ещё могут завершать начатые круги. Пока есть незавершённый быстрый круг, начатый до сигнала окончания, выбывшие в этом сегменте не фиксируются. Выездные круги и пилоты в боксах/сошедшие не задерживают список; переход к следующему сегменту подтверждает окончание предыдущего. Список выбывших пересчитывается после поступления времени круга, удаления/восстановления времени и итогов источника. Прежняя отметка о выбывании не должна мешать такому пересчёту.

Каждый круг относится к Q/SQ по времени начала круга, а сравнение для вылета использует лучшие времена именно этого сегмента. Запоздавшее сообщение о Q1 не переводит активный Q2 назад. При восстановлении LIVE из сохранённого снимка фазы и выбывшие заново собираются из полной доступной истории Race Control и кругов.

Регрессионная проверка: реальная история Singapore Sprint Qualifying, 9 октября 2026, `session_key=11379`. SQ1 закончился в 12:52:09 UTC, круг VER 1:33.477 завершился в 12:52:57 UTC. После обработки этого круга VER не отмечается выбывшим. Фикстура и проверки находятся в `worker/live/fixtures/singapore-sq1-2026.json` и `worker/live/qualifying.test.mjs`.

---

# 11. Qualifying countdown

Вместо:

```text
LAP 37/57
```

в HUD квалификации отображать:

```text
Q2 · 06:42
```

то есть оставшееся время активной части сессии, если источник предоставляет достаточно данных.

---

# 12. Qualifying Timing Table

Detailed Timing должен содержать:

```text
POS
DRIVER
TYRE
BEST
GAP
LAST
S1
S2
S3
LAPS
STATUS
```

Race-specific поля вроде race interval не должны занимать центральное место.

---

# 13. Qualifying — Selected Driver

Карточка выбранного пилота меняется.

Например:

```text
HAM

P2
+0.081

SOFT
2 LAPS

BEST
1:19.302

LAST
1:19.302

S1
27.410

S2
30.201

S3
21.691
```

---

# 14. Sprint

Sprint считать race-type session.

Интерфейс практически совпадает с Race:

```text
position
gap
interval
tyres
tyre age
laps
pit stops
sectors
telemetry
Race Control
radio
```

HUD:

```text
● LIVE · SPRINT · LAP 12 / 19
```

---

# 15. Race

Для Race оставить логику основного ТЗ:

```text
POS
DRIVER
TYRE
TYRE AGE
GAP
INTERVAL
LAST
BEST
PITS
```

и всю уже описанную функциональность.

---

# 16. Sprint Qualifying / Sprint Shootout

Не хардкодить исключительно строку:

```text
Qualifying
```

Архитектура session type должна позволять отображать дополнительные официальные session names.

Например:

```text
SPRINT QUALIFYING
```

или другое название, которое приходит из текущих данных.

Если структура данной сессии похожа на Qualifying, использовать qualifying-style timing logic.

---

# 17. Унифицированная модель session mode

Создать нормализованный тип.

Пример:

```ts
type LiveSessionMode =
  | 'practice'
  | 'qualifying'
  | 'sprint_qualifying'
  | 'sprint'
  | 'race'
  | 'unknown'
```

Точное название адаптировать под архитектуру проекта.

Не делать UI проверки вида:

```ts
if (sessionName === "Race")
```

во множестве компонентов.

Использовать единый session mode / capability model.

---

# 18. Session capabilities

Желательно создать слой capabilities.

Например:

```ts
SessionCapabilities {
  showRaceGap: boolean
  showIntervals: boolean
  showLapCounter: boolean
  showCountdown: boolean
  showQualifyingPhase: boolean
  showEliminationZone: boolean
  showPitCount: boolean
}
```

Пример:

### Race

```text
raceGap = true
intervals = true
lapCounter = true
countdown = false
```

### Qualifying

```text
raceGap = false
intervals = false
lapCounter = false
countdown = true
qualifyingPhase = true
```

Это предпочтительнее большого количества hardcoded условий в React-компонентах.

---

# 19. Events работают во всех сессиях

Вкладка:

```text
СОБЫТИЯ
```

должна работать для всех session types.

В Practice и Qualifying также показывать:

- flags;
- Race Control;
- Red Flag;
- track limits;
- incidents;
- session stopped;
- session resumed;
- DRS status;
- pit events;
- fastest lap improvements;
- другие важные события.

---

# 20. Radio работает во всех сессиях

Team Radio не должно быть связано только с Race.

Если radio message доступно во время:

- Practice;
- Qualifying;
- Sprint;
- Race;

оно должно появляться в общей вкладке RADIO.

Pipeline остаётся одинаковым.

---

# 21. Session switch

Если RaceSide LIVE остаётся открытым между сессиями одного этапа:

например:

```text
FP3
↓
ожидание
↓
QUALIFYING
```

необходимо автоматически:

1. завершить предыдущую live session;
2. сохранить её финальное состояние;
3. переключить backend на новую session;
4. очистить session-specific current state;
5. загрузить initial snapshot новой сессии;
6. продолжить тот же frontend WebSocket/session mechanism.

По возможности без полного browser reload.

Плановое `date_end` не подтверждает завершение сессии. После перезапуска или
переподключения backend проверяет Race Control предыдущей сессии без ограничения
в 30 минут: затянувшаяся гонка или остановка остаётся текущей до фактического
завершения либо подтверждённого старта следующей сессии. При временной ошибке API
уже известная активная сессия сохраняется. Восстановление координат и телеметрии
охватывает время до текущего момента, а после финиша — до фактического завершения
плюс две минуты, независимо от планового `date_end`.

---

# 22. Хранение данных

Исторические данные должны сохраняться отдельно для каждой сессии.

Не объединять FP1, Qualifying и Race в одну temporal sequence.

Минимальная связь:

```text
meeting
↓
sessions
↓
session data
```

Например:

```text
Spanish GP
├── FP1
├── FP2
├── FP3
├── Qualifying
└── Race
```

Для sprint weekend:

```text
Grand Prix
├── FP1
├── Sprint Qualifying
├── Sprint
├── Qualifying
└── Race
```

или по фактической структуре этапа.

---

# 23. Replay для всех сессий

Архитектура persistence должна в будущем позволять Replay не только Race, но и:

- Practice;
- Qualifying;
- Sprint.

Даже если текущий RaceSide Replay UI первоначально ориентирован на гонки, данные всех live sessions необходимо сохранять.

---

# 24. Development simulator

ReplaySimulationSource также не должен быть race-only.

Его интерфейс должен позволять подать session metadata:

```text
sessionType
sessionName
sessionStart
sessionEnd
```

и правильно симулировать соответствующую session logic.

---

# 25. LIVE-кнопка и активная сессия

На странице текущего этапа логика кнопки должна быть:

### Active session

Например:

```text
● LIVE — FP2
```

### Session начинается скоро

Можно оставить:

```text
LIVE HUB
```

или:

```text
LIVE — QUALIFYING
```

без active indicator.

### Weekend завершён

Кнопку можно заменить на переход к Replay/результатам в соответствии с текущей логикой сайта.

Не отображать ложный статус `LIVE`, если live session завершена.

---

# 26. Top HUD examples

### Practice

```text
← AUSTRALIAN GP
● LIVE · FP2
42:18 remaining
```

### Qualifying

```text
← AUSTRALIAN GP
● LIVE · QUALIFYING · Q2
06:42 remaining
```

### Sprint

```text
← AUSTRALIAN GP
● LIVE · SPRINT
LAP 11 / 19
```

### Race

```text
← AUSTRALIAN GP
● LIVE · RACE
LAP 37 / 57
```

---

# 27. Главное требование

Не воспринимать RaceSide LIVE как:

> Live Race.

В архитектуре и интерфейсе это должен быть:

> **Live Hub всего Formula 1 weekend.**

Один и тот же fullscreen RaceSide terminal используется от первой практики до финиша основной гонки.

Он автоматически адаптирует представление данных под текущий тип сессии, при этом сохраняет:

- общий визуальный язык;
- одну архитектуру;
- один frontend;
- один backend live-state;
- один WebSocket protocol;
- одни базовые компоненты.

---

# 28. Acceptance Criteria дополнения

Функциональность считается реализованной корректно, если:

1. RaceSide LIVE запускается во время Practice.
2. RaceSide LIVE запускается во время Qualifying.
3. RaceSide LIVE запускается во время Sprint.
4. RaceSide LIVE запускается во время Race.
5. Тип сессии определяется автоматически.
6. Timing Tower меняется в зависимости от session type.
7. Qualifying показывает Q1/Q2/Q3.
8. Practice ориентируется на best lap и gap to fastest.
9. Race/Sprint ориентируются на position/gap/interval.
10. Машины отображаются на трассе во всех поддерживаемых сессиях.
11. Events доступны во всех сессиях.
12. Radio доступно во всех сессиях, если источник содержит сообщения.
13. Данные каждой сессии сохраняются отдельно.
14. Между сессиями LIVE Hub показывает waiting state.
15. Архитектура не содержит race-only hardcoded assumptions в общих компонентах.
16. При смене сессии не требуется создавать отдельный новый Live Hub.
17. LIVE является единым центром всего гоночного уик-энда.
