# RaceSide LIVE
## Полное техническое задание

Весь LIVE-раздел доступен только с активной подпиской RaceSide Plus. Маршрут может показывать предложение подписки гостю или пользователю без доступа, но LIVE-данные, API и WebSocket требуют серверной проверки подписки. Стоимость и правила доступа определены в `18_subscription_concept.md`.

## 1. Цель проекта

Необходимо добавить в существующий сайт **RaceSide** полноценный центр отслеживания гоночной сессии в реальном времени — **RaceSide LIVE**.

Это не должна быть обычная веб-страница с блоками, расположенными друг под другом.

RaceSide LIVE должен восприниматься как отдельное гоночное приложение / race terminal:

- открывается практически на весь экран;
- использует 100% доступной площади браузера;
- на desktop не имеет вертикального скролла страницы;
- основные данные остаются на экране постоянно;
- дополнительные наборы данных переключаются через вкладки;
- машины движутся по трассе в реальном времени;
- доступны позиции, интервалы, шины, круги, сектора, pit stops, погода, Race Control и telemetry;
- есть отдельная live-лента событий;
- есть отдельная лента Team Radio с транскрипцией;
- все гоночные данные сохраняются для последующего Replay;
- аудиофайлы Team Radio постоянно не хранятся.

RaceSide LIVE должен соответствовать текущему визуальному стилю RaceSide, но иметь собственную более плотную интерфейсную компоновку, ориентированную на просмотр гонки.

---

# 2. Перед началом разработки

Перед внесением изменений обязательно изучить существующий RaceSide:

- frontend framework;
- backend;
- структуру routes;
- текущую БД;
- систему авторизации;
- глобальную тему;
- design tokens;
- компоненты кнопок;
- компоненты пилотов;
- модели команд;
- существующую страницу текущего этапа;
- существующий Race Replay;
- источник и формат replay-данных;
- существующий 3D/2D компонент трассы;
- mapping пилотов;
- данные шин;
- компоненты timing;
- существующие API endpoints RaceSide.

Особенно изучить:

`/race-replay/11334`

Сейчас Replay уже содержит:

- статус гонки;
- номер круга;
- выбранного пилота;
- позицию пилота;
- команду;
- состав шин;
- gap;
- последний круг;
- лучший круг;
- количество pit stops;
- 3D-визуализацию;
- Live Timing;
- Race Control;
- Pit Stops;
- темп круга;
- темп шин;
- погоду;
- подробную timing-таблицу;
- S1;
- S2;
- S3;
- pace.

Все эти данные должны оставаться доступными и в RaceSide LIVE.

При этом **не копировать layout Replay**.

LIVE получает новый fullscreen UI.

---

# 3. Главный UX-принцип

RaceSide LIVE — это:

> не длинная веб-страница, а фиксированный гоночный терминал.

На desktop:

```text
body
overflow: hidden
```

Основной экран:

```text
width: 100vw
height: 100dvh
```

Никакого общего вертикального page scroll.

Прокрутка допустима только внутри:

- Events feed;
- Radio feed;
- Timing table;
- небольших внутренних списков.

Пользователь не должен прокручивать страницу вниз, чтобы посмотреть pit stops, weather или sectors.

Вместо этого данные переключаются внутри фиксированных областей интерфейса.

---

# 4. Вход в LIVE

На существующей странице **«Текущий этап»** найти текущую кнопку:

**Смотреть онлайн**

Её существующую функциональность не менять.

Рядом добавить вторую кнопку:

**● LIVE**

Итог:

```text
┌──────────────────────┐ ┌──────────────────────┐
│   Смотреть онлайн    │ │       ● LIVE         │
└──────────────────────┘ └──────────────────────┘
```

Требования:

- две кнопки находятся на одной строке;
- одинаковая высота;
- визуально образуют единую группу действий;
- существующая кнопка не должна сломаться;
- на mobile также стараться сохранять две кнопки на одной строке;
- `LIVE` ведёт в новый RaceSide LIVE.

Если прямо сейчас идёт сессия:

```text
● LIVE
```

может иметь активную live-анимацию точки.

---

# 5. Route

Создать отдельный route LIVE.

Предпочтительно:

```text
/live
```

или существующий аналогичный route convention проекта.

LIVE route должен автоматически определять:

- текущий meeting;
- текущую сессию;
- session key;
- статус сессии.

Не заставлять пользователя выбирать session key вручную.

Если LIVE открыт напрямую и активной сессии нет, показать состояние ожидания следующей сессии текущего этапа.

---

# 6. Fullscreen layout

RaceSide LIVE не должен показывать обычные:

- navbar;
- footer;
- sidebar сайта;
- стандартный header.

LIVE имеет собственный компактный HUD.

Основной desktop layout:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ TOP LIVE HUD                                                               │
├──────────────────┬───────────────────────────────────────┬───────────────────┤
│                  │                                       │                   │
│                  │                                       │                   │
│ LIVE TIMING      │          MAIN WORKSPACE               │ EVENTS / RADIO    │
│                  │                                       │                   │
│                  │                                       │                   │
│                  │                                       │                   │
│                  │                                       │                   │
│                  │                                       │                   │
│                  │                                       │                   │
├──────────────────┤                                       │                   │
│ SELECTED DRIVER  │                                       │                   │
└──────────────────┴───────────────────────────────────────┴───────────────────┘
```

Примерные размеры на 1920×1080:

```text
Top HUD:        50–54 px
Left column:    270–300 px
Right column:   340–380 px
Center:         всё оставшееся пространство
```

Не привязывать layout жёстко к этим значениям.

Использовать responsive CSS Grid.

---

# 7. Выход из LIVE

В левом верхнем углу всегда находится:

```text
←
```

Стрелка должна быть доступна даже если:

- API недоступно;
- WebSocket оборвался;
- UI находится в состоянии loading;
- session закончилась;
- произошла backend ошибка.

При hover:

```text
Вернуться
```

При нажатии:

1. вернуться на страницу текущего этапа;
2. если известен `returnUrl`, использовать его;
3. если LIVE открыт напрямую — fallback на страницу текущего этапа.

---

# 8. Browser fullscreen

Кроме app-fullscreen добавить маленькую кнопку:

```text
⛶
```

Использовать Browser Fullscreen API там, где поддерживается.

Это дополнительная функция.

Основной LIVE должен корректно работать и без Browser Fullscreen API.

Нажатие `Esc` должно выходить только из browser fullscreen, но не закрывать route LIVE.

---

# 9. Верхний LIVE HUD

### LIVE / Перемотка

В шапке LIVE есть переключатель `LIVE` / `Перемотка`. В режиме перемотки внизу экрана появляется общая шкала последних трёх минут, пауза и кнопки ±5 секунд. Пользователь выбирает момент и продолжает просмотр с постоянным отставанием; `LIVE` возвращает к текущему состоянию.

Все панели используют один момент просмотра: карта 2D/3D, тайминг и сектора, телеметрия и максимальная скорость, питы и комплекты, флаги SC/VSC, квалификационные фазы и выбывшие, события, готовые тексты радио, погода и очки. Countdown также использует время просмотра. Готовность перевода и исправления классификации относятся к моменту публикации; более ранний timestamp источника не позволяет показать их до получения.

Сервер поддерживает одно общее скользящее окно с небольшим служебным запасом для телеметрии. Персональными остаются только курсор и режим просмотра. У нового зрителя история доступна сразу, без накопления в его браузере. В начале сессии или после холодного старта доступное окно может быть короче трёх минут. Пауза фиксирует момент; если он выходит из окна, интерфейс предлагает продолжить с начала доступного окна.

Задержка или пауза сохраняются локально на устройстве и восстанавливаются после reload/reconnect. Состояние подключения показывается по настоящему времени. Общий кеш периодически сохраняется атомарно в каталоге LIVE spool; обычный перезапуск сохраняет историю. Подробности и ограничения: `docs/live-rewind.md`.

Высота порядка 50–54 px.

Пример:

```text
←  SPANISH GP      ● LIVE   RACE   LAP 37/57      🟢 GREEN
                                      AIR 24°  TRACK 38°   ● CONNECTED    ⛶
```

HUD должен отображать:

### Слева

- Back;
- название Grand Prix.

### Центр

- LIVE;
- session type;
- текущий круг;
- общее количество кругов.

Например:

```text
● LIVE · RACE · LAP 37 / 57
```

Для Qualifying:

```text
● LIVE · QUALIFYING · Q2
```

Для Practice:

```text
● LIVE · FP2
```

### Справа

- air temperature;
- track temperature;
- rain indicator;
- connection state;
- fullscreen.

---

# 10. Session Status

Показывать текущий общий статус.

Например:

```text
🟢 GREEN
```

```text
🟡 YELLOW
```

```text
🟡 VSC
```

```text
🟡 SAFETY CAR
```

```text
🔴 RED FLAG
```

```text
🏁 CHEQUERED FLAG
```

Status должен поступать из live-data/Race Control.

Не определять статус исключительно по frontend эвристике.

---

# 11. Левая колонка — LIVE TIMING

Timing Tower остаётся видимым всегда независимо от выбранного центрального режима.

Пример:

```text
LIVE TIMING

01  ANT    M  12
    LEADER

02  RUS    M  18
    +1.284

03  HAM    H  05
    +3.471

04  LEC    H  05
    +4.091

05  NOR    M  22
    +7.102
```

Для каждого пилота показывать:

- position;
- team colour indicator;
- acronym;
- tyre compound;
- tyre age;
- interval/gap.

По возможности различать:

```text
gap to leader
```

и:

```text
interval to car ahead
```

Через компактный UI/tooltip.

OpenF1 предоставляет отдельные `gap_to_leader` и `interval`; во время гонки эти данные обновляются примерно раз в несколько секунд.

---

# 12. Tyre display

Compound:

```text
S = Soft
M = Medium
H = Hard
I = Intermediate
W = Wet
```

Использовать привычное визуальное кодирование шин.

Рядом показывать возраст:

```text
M 12
```

означает:

Medium, 12 кругов.

---

# 13. Состояния пилота

Timing Tower должен уметь показывать:

- RUNNING;
- PIT;
- OUT LAP;
- IN LAP;
- RETIRED;
- DNS;
- DNF;
- lapped car;
- +1 LAP;
- +2 LAPS.

Например:

```text
PIT
```

вместо interval.

Retired driver визуально приглушается, но не исчезает из списка.

---

# 14. Выбор пилота

Клик по строке пилота:

```text
selectedDriver = driver
```

Выбранный пилот должен синхронно меняться:

- на карте;
- в нижней карточке;
- в режиме «Пилот»;
- в telemetry;
- в radio filter shortcut.

Выбранная строка Timing Tower должна иметь очевидное выделение.

---

# 15. Карточка Selected Driver

Под Timing Tower в левой колонке постоянно находится компактная карточка выбранного пилота.

Пример:

```text
HAM
Lewis Hamilton
Ferrari

P3          +3.471

HARD
5 LAPS

LAST        1:26.421
BEST        1:25.931

PITS        1
```

Показывать:

- acronym;
- full name;
- team;
- position;
- gap;
- compound;
- tyre age;
- last lap;
- best lap;
- pit count.

Использовать team colour как accent.

---

# 16. Центральная область — Workspace

Главная концепция:

центральная область имеет переключаемые режимы.

Верхняя навигация:

```text
ТРАССА   ТАЙМИНГ   ПИЛОТ   АНАЛИТИКА
```

Default:

```text
ТРАССА
```

Переключение вкладок не должно:

- перезагружать страницу;
- создавать новые API соединения;
- терять selected driver;
- сбрасывать состояние гонки.

---

# 17. Режим «ТРАССА»

Это основной экран LIVE.

Максимально большую часть центральной области занимает трасса.

Предусмотреть:

```text
3D | 2D
```

Если существующий Race Replay уже содержит пригодную 3D-модель — максимально переиспользовать её.

Однако live-state и animation logic должны быть отделены от Replay controls.

---

# 18. Машины на трассе

Все автомобили должны двигаться в реальном времени.

Источник:

```text
v1/location
```

OpenF1 передаёт приблизительное положение автомобиля через `x/y/z` примерно 3.7 раза в секунду. Эти координаты предназначены для оценки продвижения машины по трассе, а не точного положения по ширине полотна.

Для каждого автомобиля отображать:

```text
● HAM
```

или компактный аналог.

Использовать:

- team colour;
- driver acronym;
- selected state.

---

# 19. Smooth movement

Нельзя передвигать маркеры машины скачками 3–4 раза в секунду.

Использовать interpolation.

Пример:

```text
location A
timestamp A

location B
timestamp B
```

Frontend должен плавно интерполировать позицию автомобиля между A и B через:

```text
requestAnimationFrame
```

Цель:

```text
visual animation ≈ 60 FPS
```

Нужно предусмотреть небольшой interpolation buffer.

При коротком отсутствии следующей точки допускается краткая extrapolation, но нельзя позволять машине улетать далеко от последней подтверждённой позиции.

---

# 20. Производительность карты

Не делать полный React rerender всего RaceCenter при каждом location update.

Для быстро обновляющихся координат использовать подход, соответствующий текущему frontend stack:

- refs;
- external store;
- selective subscriptions;
- requestAnimationFrame;
- canvas/WebGL/optimised SVG.

22 машины × несколько updates/sec не должны вызывать layout thrashing.

---

# 21. Track coordinates

OpenF1 coordinates необходимо преобразовывать в систему координат существующей RaceSide трассы.

Создать abstraction:

```text
TrackGeometry
```

Пример:

```ts
type TrackGeometry = {
  circuitKey: number
  viewBox: ...
  rotation: number
  scale: number
  offsetX: number
  offsetY: number
  ...
}
```

Pipeline:

```text
OpenF1 x/y
↓
normalize
↓
rotate
↓
scale
↓
offset
↓
screen coordinates
```

Не привязывать map calibration к разрешению монитора.

Для календаря сайта 2026 года LIVE поставляется со встроенными картами всех 23 трасс, включая Сепанг. Карта должна открываться с первой практики без предварительно созданного Replay, записи `track_maps` или привязки новой сессии к календарю. Трасса определяется по OpenF1 `circuit_key`; когда числового ключа нет — по точному названию трассы или месту проведения. Название перенесённого Гран-при не определяет трассу.

Готовая геометрия текущего сезона из базы имеет приоритет над встроенной картой; для Мадринга сохраняется отдельная проверенная привязка. Встроенные карты не изменяются при смене сессии. Они включаются в worker-образ вместе с остальным каталогом `worker/live/tracks`.

Оставшиеся этапы сезона — Сингапур, Остин, Мехико, Интерлагос, Лас-Вегас, Катар и Абу-Даби — заранее поддерживают 2D и существующие 3D-модели с пит-лейнами. Привязки подготовлены по историческим координатам OpenF1 2025 и проверены на отдельных кругах, не использованных для калибровки. Новые координаты прямого эфира 2026 могут требовать уточнения, если провайдер изменит систему координат; отсутствие самой карты не должно зависеть от такого уточнения. Покрытие календаря и направление движения проверяет `worker/live/track-registry.test.mjs`.

---

# 22. Bottom telemetry strip в режиме «ТРАССА»

Внизу центрального блока использовать компактную строку выбранного пилота:

```text
HAM | P3 | +3.471 | LAST 1:26.421 | S1 28.10 | S2 31.22 | S3 27.10 | PITS 1
```

Она не должна закрывать значительную часть трассы.

---

# 23. Режим «ТАЙМИНГ»

При выборе:

```text
ТАЙМИНГ
```

карта заменяется профессиональной подробной timing table.

Не открывать новую страницу.

---

# 23A. Очки и чемпионат

Вкладка «Очки» рядом с «Аналитикой» показывает прогноз личного и командного зачёта на одном экране. На десктопе таблицы стоят рядом, на телефоне идут друг под другом внутри общего скролла. Пилоты показывают место в чемпионате, изменение места, позицию в заезде, очки до этапа, очки за текущие позиции и итог. Команды показывают сумму обоих пилотов и прогноз места. Выбор пилота сохраняет контекст остальных панелей LIVE.

Расчёт использует точный снимок зачёта предыдущего этапа, не последний доступный снимок; текущий этап не прибавляется дважды. Завершённый спринт текущего уикенда добавляется один раз к прогнозу гонки. Практики и квалификация не начисляют очки. Равенство очков разрешается количеством первых, вторых и последующих мест в гонках сезона, включая предполагаемый финиш гонки; спринт не добавляет победу в этот расчёт. Если история неполная, сохраняется порядок предыдущего зачёта с пояснением. Неполный снимок зачёта не заменяется вымышленными нулевыми очками.

Прогноз предполагает полное начисление очков; штрафы и сокращённая дистанция могут изменить итог. После финиша подтверждённые очки из сохранённых результатов заезда имеют приоритет; неполный итог не заменяется нулями. Данные чемпионата читает LIVE-worker из существующего кеша Supabase, обновляет раз в минуту и передаёт общим потоком; позиции и очки по ним обновляются вместе с таймингом. Отдельные внешние запросы из браузера и новая схема базы не требуются. В Replay эта вкладка не добавляется.

---

# 24. Detailed Timing Table

Сохранить все данные, которые есть в текущем Replay:

```text
POS
DRIVER
TYRE
BEST
INTERVAL
PITS
LAST
S1
S2
S3
PACE
```

Добавить также `GAP`, если позволяет пространство.

Пример:

```text
POS DRIVER   TYRE  GAP     INT     LAST      S1      S2      S3      BEST      PITS

01  ANT      M12   —       —       1:26.320  28.1    31.0    27.2    1:25.801   1
02  RUS      M17   +1.28   +1.28   1:26.122  28.0    31.1    27.0    1:25.741   1
03  HAM      H05   +3.47   +2.19   1:25.991  27.9    31.0    27.0    1:25.931   1
```

---

# 25. Timing colours

Для sector/lap cells использовать motorsport convention:

### Purple
лучшее значение всей сессии.

### Green
personal best пилота.

### Yellow/neutral
хуже personal best.

Также корректно отображать:

- PIT;
- OUT LAP;
- IN LAP;
- deleted/invalid lap, если источник позволяет определить.

Не делать весь интерфейс чрезмерно разноцветным.

---

# 26. Timing Table scrolling

На desktop общий экран не скроллится.

Если на небольшой высоте экрана 22 строки не помещаются:

```text
TimingTable
overflow-y: auto
```

Прокручивается только таблица.

Header таблицы sticky.

---

# 27. Режим «ПИЛОТ»

Вся центральная область посвящается выбранному автомобилю.

Пример:

```text
LEWIS HAMILTON
FERRARI

P3

GAP TO LEADER       +3.471
INTERVAL AHEAD      +1.284

HARD
5 LAPS

LAST                1:26.421
BEST                1:25.931

S1                  28.101
S2                  31.220
S3                  27.100
```

---

# 28. Live car telemetry

Использовать данные автомобиля:

- speed;
- throttle;
- brake;
- rpm;
- gear;
- DRS.

OpenF1 `car_data` содержит эти параметры и также работает с высокой частотой обновлений.

Пример UI:

```text
286 KM/H

GEAR
7

THROTTLE
████████████████   100%

BRAKE
██░░░░░░░░░░░░░    12%

RPM
11,240

DRS
OPEN
```

---

# 29. Telemetry graphs

В режиме «Пилот» добавить компактные live-графики за последние примерно 30–60 секунд:

- Speed;
- Throttle;
- Brake.

Не сохранять frontend бесконечный массив значений.

Использовать ring buffer.

Данные при этом backend должен сохранять полностью для Replay.

---

# 30. Режим «АНАЛИТИКА»

Это место для данных, которые сейчас находятся ниже основного Replay.

Layout приблизительно:

```text
┌───────────────────────────────┬──────────────────────────────┐
│ PIT STOPS                     │ LAP PACE                     │
│                               │                              │
│                               │                              │
├───────────────────────────────┼──────────────────────────────┤
│ TYRE PACE                     │ WEATHER                      │
│                               │                              │
│                               │                              │
└───────────────────────────────┴──────────────────────────────┘
```

---

# 31. Pit Stops

Показывать:

- driver;
- lap;
- tyre before;
- tyre after;
- stationary stop duration;
- pit lane duration, если нужно;
- количество stops.

Последние события сверху.

Вкладка «Пит-стопы» в центральном LIVE workspace показывает общую шкалу кругов для всех пилотов. Каждый комплект — отдельный цветной отрезок; замена на тот же состав не объединяет отрезки. Отметки заездов открывают нижний блок с кругом и временем заезда, остановкой, полным временем в пит-лейне, шинами до/после и пробегом комплекта. Фильтр ограничивает шкалу одним пилотом. На телефоне шкала прокручивается внутри панели, подробности остаются под ней. История stints сохраняется в LIVE snapshot; запаздывающие сведения о новом комплекте не подменяются предположением о составе, неизвестные значения показываются как «—». Проезд без остановки не считается подтверждённой заменой шин.

---

# 32. Lap Pace

Сохранить существующую логику Replay.

Показывать минимум:

```text
Лучший в сессии
Лучший последний круг
```

Дополнительно можно показать top 5 по текущему pace.

---

# 33. Tyre Pace

Сохранить текущий блок:

```text
Темп шин
```

Например:

```text
SOFT        1:25.422     2 drivers
MEDIUM      1:26.102    12 drivers
HARD        1:26.842     5 drivers
```

Расчёты должны исключать явно нерепрезентативные:

- pit laps;
- out laps;
- аномальные круги;

если текущая RaceSide логика уже это делает — переиспользовать её.

---

# 34. Weather

Показывать:

```text
AIR
TRACK
RAIN
WIND
HUMIDITY
```

Минимум сохранить текущие:

- Воздух;
- Трасса;
- Дождь;
- Ветер.

Weather data у OpenF1 обновляется примерно раз в минуту.

Погода находится в верхнем HUD рядом с температурой: влажность, ветер и осадки видны на десктопе; на телефоне они занимают одну компактную строку под статусом сессии. Нажатие на температуру раскрывает подписанные показатели и время обновления, на планшете это основной способ просмотра подробностей. Вместо погоды во вкладке «Аналитика» показывается список максимальных скоростей пилотов за сессию, по убыванию уже измеренного `maxSpeed`. Пока замера нет, показывается «—».

---

# 35. Правая колонка

Правая колонка постоянно находится на экране.

В верхней части:

```text
СОБЫТИЯ    РАДИО
```

Две вкладки переключают содержимое одной и той же области.

---

# 36. Вкладка «СОБЫТИЯ»

Это не только сырой Race Control.

Необходимо создать **RaceSide Event Feed** — единую хронологию важных событий сессии.

В feed объединять:

### Race Control
- Green Flag;
- Yellow Flag;
- Double Yellow;
- Red Flag;
- SC;
- VSC;
- DRS enabled/disabled;
- investigations;
- penalties;
- track limits;
- session status.

### RaceSide-derived events
- overtake;
- pit stop;
- tyre change;
- retirement;
- fastest lap;
- lead change;
- session start;
- session restart;
- session finish.

---

# 37. Event cards

Пример:

```text
LAP 34

🟡 YELLOW FLAG

Sector 2
```

---

Пример:

```text
LAP 33

⚔ OVERTAKE

HAM → LEC

Hamilton moves to P3
```

---

Пример:

```text
LAP 31

🛞 PIT STOP

RUS
Medium → Hard

2.3 sec
```

---

Пример:

```text
LAP 29

⚖ INVESTIGATION

CAR 44 / CAR 16

Causing a collision
```

---

# 38. Event ordering

По умолчанию:

**самые новые события сверху.**

Feed должен иметь внутренний scroll.

Если пользователь вручную прокрутил feed вниз для чтения старых сообщений:

- не прыгать автоматически наверх;
- показать компактный индикатор:

```text
3 новых события
```

По клику вернуться к последним событиям.

---

# 39. Event deduplication

Одно событие не должно отображаться несколько раз после:

- reconnect;
- повторного REST snapshot;
- повторной доставки WebSocket/MQTT message.

Создать deterministic event key.

Пример:

```text
sessionKey
+
eventType
+
driverNumber
+
timestamp
+
lapNumber
```

или source identifier.

---

# 40. Race Control translation

Основной интерфейс RaceSide русскоязычный.

Для часто встречающихся системных сообщений использовать deterministic templates.

Например:

```text
YELLOW FLAG IN SECTOR 2
```

→

```text
Жёлтый флаг — сектор 2
```

Но оригинальный source message желательно сохранять.

Для неоднозначных сообщений не пытаться агрессивно менять смысл.

---

# 41. Вкладка «РАДИО»

Здесь отображается поток Team Radio.

Карточки должны быть визуально вдохновлены официальным F1 live interface, но **не копировать его пиксель-в-пиксель**.

Стиль RaceSide.

Основные признаки:

- плотная тёмная карточка;
- Team Radio label;
- team colour accent;
- driver acronym;
- driver name;
- team;
- lap/time;
- waveform/progress visual;
- transcript.

---

# 42. Radio Card

Пример:

```text
┌────────────────────────────────┐
│ ))) TEAM RADIO         LAP 32 │
│                                │
│ HAM                            │
│ Lewis Hamilton                 │
│ Ferrari                        │
│                                │
│ ▶ ━━━━━━━━━━━━━━━━━━━         │
│                                │
│ Rear tyres are gone.           │
│                                │
│ Задние шины закончились.       │
└────────────────────────────────┘
```

---

# 43. Radio processing states

Карточка может иметь состояния:

### RECEIVED

```text
TEAM RADIO
HAM

Получено сообщение…
```

### TRANSCRIBING

```text
Расшифровываем…
```

### READY

Показан transcript.

### FAILED

```text
Не удалось расшифровать радио
```

При ошибке остальной Live Hub продолжает работать.

---

# 44. Язык радио

Хранить:

```text
transcript_original
transcript_ru
```

В UI русский текст сделать основным.

Оригинал можно:

- показать ниже меньшим размером;
- либо переключателем:

```text
RU | EN
```

---

# 45. Radio filter

Добавить:

```text
Все пилоты ▼
```

Возможность выбрать конкретного пилота.

Также рядом с Selected Driver можно добавить shortcut:

```text
Радио HAM
```

который:

1. переключает правую панель на RADIO;
2. устанавливает filter = selected driver.

---

# 46. Новые radio messages

Если пользователь находится во вкладке Events и приходит новое radio:

```text
СОБЫТИЯ    РАДИО •2
```

Число означает непрочитанные radio messages.

Не показывать большой modal поверх гонки.

---

# 47. Аудиофайлы Team Radio

КРИТИЧЕСКОЕ ТРЕБОВАНИЕ.

**Не хранить MP3 Team Radio в постоянном storage.**

Не сохранять:

- в permanent filesystem;
- S3/object storage;
- БД;
- backup.

---

# 48. Radio pipeline

Pipeline:

```text
OpenF1 Team Radio event
        ↓
recording_url
        ↓
temporary fetch / stream
        ↓
speech-to-text
        ↓
EN transcript
        ↓
RU translation
        ↓
save text + metadata
        ↓
delete temporary audio
```

После успешной обработки аудиофайл должен быть немедленно удалён из temporary storage.

Удаление также обязательно выполнять в `finally` при ошибке.

---

# 49. Прослушивание radio

Если пользователь нажимает Play во время LIVE, не требуется сохранять MP3 локально постоянно.

Предпочтительно:

```text
RaceSide backend
↓
proxy/stream source audio
↓
browser
```

или другой временный streaming mechanism.

Не создавать permanent audio archive.

После завершения сессии Replay должен работать без MP3.

---

# 50. Что сохраняем от Radio

В БД оставить только:

```text
session_key
meeting_key
driver_number
lap_number
source_timestamp
transcript_original
transcript_ru
processing_status
created_at
```

При необходимости:

```text
duration
```

но только как числовое metadata.

Сам аудиофайл не сохранять.

После окончания live session можно удалить transient `recording_url`, если он использовался только для realtime playback.

---

# 51. Radio unavailable

Team Radio может отсутствовать в конкретной сессии — источник предоставляет только опубликованный набор переговоров, а не полную запись. OpenF1 отдельно предупреждает, что radio coverage может отсутствовать.

UI должен корректно показывать:

```text
Радиосообщений пока нет
```

Это не считается ошибкой Live Hub.

---

# 52. Источник live data

Основной realtime source:

**OpenF1**

Использовать backend integration.

Frontend не должен самостоятельно напрямую подключаться к OpenF1.

---

# 53. Используемые OpenF1 datasets

Минимально предусмотреть:

```text
sessions
drivers
position
intervals
location
car_data
laps
stints
pit
race_control
weather
overtakes
team_radio
```

При необходимости дополнить другими datasets после изучения API.

---

# 54. Realtime transport

Для live ingestion использовать realtime push transport.

OpenF1 рекомендует для realtime MQTT/WebSocket вместо постоянного REST polling; realtime topics соответствуют API endpoint paths.

Архитектура:

```text
OpenF1 realtime
       ↓
RaceSide Live Ingest
       ↓
RaceSide Live State
       ↓
RaceSide WebSocket
       ↓
Browsers
```

---

# 55. НЕ делать

Нельзя делать:

```text
Browser user 1 → OpenF1
Browser user 2 → OpenF1
Browser user 3 → OpenF1
...
```

Внешний realtime source подключается на backend RaceSide.

Далее RaceSide самостоятельно broadcast данные пользователям.

---

# 56. Initial hydration

При открытии LIVE пользователь не должен ждать поступления следующего события для заполнения интерфейса.

Pipeline:

```text
open LIVE
↓
backend REST snapshot / current state
↓
send full snapshot browser
↓
connect RaceSide WebSocket
↓
receive delta updates
```

То есть frontend сначала получает текущее состояние всей сессии, затем realtime changes.

---

# 57. RaceSide Live State

Создать централизованное server-side состояние текущей сессии.

Пример:

```ts
LiveSessionState {
  meeting
  session
  status
  currentLap
  totalLaps

  drivers: Map<driverNumber, DriverLiveState>

  weather
  raceControl
  pits
  overtakes
  radio
}
```

---

# 58. DriverLiveState

Ориентировочно:

```ts
DriverLiveState {
  driverNumber
  acronym
  fullName

  team
  teamColour

  position

  gapToLeader
  intervalAhead

  compound
  tyreAge
  stintNumber

  lastLap
  bestLap

  sector1
  sector2
  sector3

  pitCount

  speed
  throttle
  brake
  rpm
  gear
  drs

  x
  y
  z

  isInPit
  isOutLap
  isRetired

  lastUpdatedAt
}
```

Использовать реальные типы текущего проекта, где возможно.

---

# 59. RaceSide WebSocket

Frontend должен подключаться только к RaceSide backend.

Например:

```text
/ws/live/{sessionKey}
```

При подключении:

```json
{
  "type": "snapshot",
  "data": {}
}
```

Последующие сообщения:

```json
{
  "type": "location",
  "driverNumber": 44,
  "data": {}
}
```

```json
{
  "type": "timing",
  "driverNumber": 44,
  "data": {}
}
```

```json
{
  "type": "race_control",
  "data": {}
}
```

```json
{
  "type": "radio",
  "data": {}
}
```

Не обязательно использовать именно эти названия, если существующая архитектура проекта предлагает более правильный protocol.

---

# 60. Batching

Высокочастотные location/car_data updates можно группировать на backend небольшими batches.

Не отправлять браузеру тысячи мелких React-triggering messages без необходимости.

Цель:

- минимальная latency;
- плавное движение;
- умеренная CPU load;
- минимальный network overhead.

---

# 61. Connection indicator

HUD показывает:

```text
● CONNECTED
```

При кратком разрыве:

```text
● RECONNECTING
```

При продолжительной ошибке:

```text
● OFFLINE
```

Последние корректные значения должны оставаться на экране.

Не очищать весь интерфейс при кратковременном reconnect.

---

# 62. Reconnect

Backend и frontend должны иметь:

- automatic reconnect;
- exponential backoff;
- heartbeat;
- stale connection detection.

После reconnect:

1. запросить current snapshot;
2. reconcile state;
3. не создавать дубликаты events.

---

# 63. Persistence

КРИТИЧЕСКОЕ ТРЕБОВАНИЕ.

**Все гоночные данные LIVE сохранять.**

Исключение:

**аудиофайлы Team Radio.**

---

# 64. Какие данные сохранять

Сохранять raw/normalised history:

- location;
- car telemetry;
- positions;
- intervals;
- laps;
- sectors;
- stints;
- tyres;
- pits;
- Race Control;
- weather;
- overtakes;
- session status;
- radio transcripts.

Не ограничиваться сохранением только конечного state.

Нужна временная история.

---

# 65. Цель сохранения

После окончания сессии данные должны позволять воспроизвести её как Replay.

То есть:

```text
LIVE
↓
persistent race data
↓
REPLAY
```

Нельзя после гонки заново собирать историю из внешнего источника, если мы уже получили её во время LIVE.

---

# 66. Database design

Сначала изучить существующую БД RaceSide.

Если там уже есть подходящие таблицы Replay — расширить их.

Не создавать параллельную несовместимую схему без необходимости.

Для high-frequency data желательно разделить таблицы.

Например:

```text
live_sessions

live_location
live_car_data

live_positions
live_intervals

live_laps
live_stints
live_pits

live_race_control
live_weather
live_overtakes

live_radio_text
```

Названия адаптировать под текущий style проекта.

---

# 67. High-frequency tables

Для:

```text
location
car_data
```

не хранить каждую запись как тяжёлый JSONB, если существующая БД позволяет typed columns.

Пример `location`:

```text
session_key
driver_number
timestamp
x
y
z
```

Index:

```text
(session_key, driver_number, timestamp)
```

---

# 68. Batch writes

Не делать отдельную DB transaction на каждую telemetry point.

Использовать batch insert.

Например:

- flush каждые 500–1000 ms;
- либо после N записей.

При graceful shutdown flush remaining buffer.

---

# 69. Retention

Live race data не удалять автоматически.

Raw telemetry сохраняется.

При необходимости позже можно создать downsample tables для быстрого Replay, но raw данные оставлять.

---

# 70. Replay integration

Не требуется немедленно полностью переписывать существующий Replay UI.

Но создать адаптер:

```text
LiveSessionData
↓
ReplayDataAdapter
↓
existing Replay format
```

После завершения сессии Live данные должны быть совместимы с существующим Replay.

---

# 71. Radio в Replay

В Replay сохранять:

- время;
- круг;
- пилота;
- оригинальную транскрипцию;
- русский перевод.

MP3 в Replay отсутствует.

Radio Card в Replay:

```text
TEAM RADIO · LAP 32

HAM

Rear tyres are gone.

Задние шины закончились.
```

Без Play, если аудио больше недоступно.

---

# 72. Session types

LIVE должен работать минимум с:

- Practice;
- Qualifying;
- Sprint;
- Race.

Не делать всю логику исключительно под Race.

---

# 73. Race-specific UI

Для Race/Sprint показывать:

- lap;
- total laps;
- interval;
- gap;
- tyre age;
- pit count;
- positions.

---

# 74. Qualifying-specific UI

Для Qualifying основными становятся:

- Q1/Q2/Q3;
- position;
- best lap;
- gap to P1;
- last lap;
- sectors;
- tyre;
- pit/out status.

Если обычные race intervals отсутствуют, не показывать бессмысленные `—` там, где можно показать qualifying gap.

---

# 75. Practice-specific UI

Practice:

- position;
- best lap;
- last lap;
- gap to fastest;
- tyre;
- lap count;
- sectors.

---

# 76. Waiting state

Если пользователь открыл LIVE до начала сессии:

показывать тот же fullscreen shell.

Центр:

```text
Следующая сессия

QUALIFYING

Начало через
00:42:17
```

Timing и Events могут быть пустыми.

Не отправлять пользователя обратно на обычную страницу.

---

# 77. Finished state

После CHEQUERED FLAG:

LIVE продолжает показывать финальное состояние.

HUD:

```text
🏁 FINISHED
```

Показать кнопку:

```text
Открыть повтор
```

когда Replay готов.

---

# 78. Development without live session

КРИТИЧЕСКИ ВАЖНО.

Разработка LIVE не должна зависеть от того, идёт ли прямо сейчас реальная гонка.

Создать abstraction:

```ts
interface LiveDataSource
```

Минимум две реализации:

```text
OpenF1LiveSource
ReplaySimulationSource
```

---

# 79. ReplaySimulationSource

Для development использовать уже имеющиеся RaceSide replay data.

Например данные:

```text
/race-replay/11334
```

должны иметь возможность проигрываться как будто это LIVE.

Симулятор:

```text
existing historical data
↓
respect original timestamps
↓
emit as realtime messages
↓
same LiveState
↓
same frontend
```

Это позволит полностью разработать:

- map animation;
- Timing Tower;
- events;
- tyres;
- sectors;
- pits;
- weather;
- reconnection;
- persistence;
- frontend;

без ожидания реальной сессии.

---

# 80. Development switch

Например:

```text
LIVE_DATA_SOURCE=replay
```

или:

```text
LIVE_DATA_SOURCE=openf1
```

Не выводить dev controls обычным пользователям production.

---

# 81. Architecture principle

Frontend не должен знать, откуда пришли данные.

Для него:

```text
OpenF1 live
```

и:

```text
Replay simulator
```

дают одинаковый RaceSide WebSocket protocol.

---

# 82. Mobile / tablet

Desktop является основной версией.

Однако mobile не должен быть сломан.

На узком экране не пытаться ужать три колонки.

Использовать mobile layout.

Например:

```text
TOP HUD

MAIN MODE

bottom navigation:
Трасса
Тайминг
Пилот
События
```

Events/Radio становятся отдельным fullscreen panel/tab.

Timing Tower можно открывать drawer.

---

# 83. Laptop layouts

Проверить обязательно:

```text
1366×768
1440×900
1536×864
1920×1080
2560×1440
```

На всех desktop размерах:

**никакого page vertical scroll.**

Внутренние элементы должны адаптироваться.

---

# 84. Responsive density

На небольшом ноутбуке:

- уменьшить width sidebars;
- уменьшить paddings;
- сократить full driver names;
- уменьшить font;
- скрыть второстепенные labels;
- использовать tooltips.

Но не удалять сами данные из системы.

---

# 85. State management

Live данные обновляются очень часто.

Не использовать архитектуру, при которой каждый update:

```text
location
```

перерендеривает весь React tree.

Разделить состояние на slices:

```text
session
drivers
locations
timing
telemetry
events
radio
weather
```

Компоненты подписываются только на нужный slice.

---

# 86. Memory management

Не держать всю гонку в browser memory.

Frontend хранит:

- current state;
- небольшой telemetry buffer;
- текущие events;
- текущие radio messages.

Полная историческая запись находится на backend/DB.

---

# 87. Event feed limits

Frontend может держать, например, последние:

```text
200–500 events
```

Старые подгружать по необходимости.

Не держать тысячи React nodes.

---

# 88. Security

Никакие внешние:

- access tokens;
- secrets;
- credentials;

не должны попадать в client bundle.

Все внешние integrations — backend only.

---

# 89. API proxy

Frontend взаимодействует только с RaceSide:

```text
/api/live/...
/ws/live/...
```

Не делать прямые fetch к external realtime source из browser.

---

# 90. Error isolation

Отказ отдельного data stream не должен ломать весь LIVE.

Например:

Radio error:

```text
Radio unavailable
```

Но:

- timing;
- map;
- telemetry;
- events;

продолжают работать.

Weather error:

показываем stale weather + timestamp.

---

# 91. Stale data indication

Если отдельный driver давно не обновлялся:

не двигать его бесконечно extrapolation.

После заданного timeout:

- остановить marker;
- отметить state как stale.

Если весь stream stale:

HUD:

```text
RECONNECTING
```

---

# 92. Loading

При первом открытии не использовать один большой spinner.

Показать skeleton shell:

- Timing Tower skeleton;
- Track skeleton;
- Events skeleton.

Как только отдельные данные готовы — показывать их.

---

# 93. Keyboard / accessibility

Добавить keyboard navigation по возможности:

```text
1 → Трасса
2 → Тайминг
3 → Пилот
4 → Аналитика
```

Не использовать горячие клавиши внутри input.

Buttons должны иметь aria-label.

Tabs использовать корректную tab semantics.

---

# 94. Visual design

Использовать существующий RaceSide design system.

LIVE должен выглядеть:

- плотнее обычных страниц;
- технологичнее;
- как motorsport dashboard;
- но оставаться узнаваемым RaceSide.

Не создавать отдельный несвязанный visual language.

---

# 95. Dark mode

LIVE особенно ориентирован на dark UI.

Если RaceSide поддерживает light/dark theme:

обе темы не должны ломаться.

Но допустимо оптимизировать основной motorsport experience прежде всего под dark mode.

---

# 96. Не копировать официальный F1 интерфейс

Team Radio может быть визуально вдохновлено официальным live-style.

Но:

- не копировать layout pixel-perfect;
- не копировать proprietary assets;
- не копировать шрифты/иконки F1;
- использовать RaceSide components.

---

# 97. Не менять существующее без необходимости

Не ломать:

- Новости;
- Соцсети;
- Чемпионат;
- Пилоты;
- Команды;
- Календарь;
- Fantasy;
- текущий Race Replay;
- Смотреть онлайн.

LIVE должен быть новым модулем.

---

# 98. Логи

Backend должен логировать:

- session connection;
- reconnect;
- stream errors;
- DB write errors;
- radio processing errors;
- missing session mappings.

Не логировать secrets.

---

# 99. Monitoring

Предусмотреть health state:

```text
live source connected
RaceSide websocket active
database writer active
last event received at
```

Это понадобится для диагностики во время реальной гонки.

---

# 100. Минимальный backend health endpoint

Например:

```text
/api/live/health
```

Response:

```json
{
  "status": "ok",
  "sessionKey": "...",
  "sourceConnected": true,
  "lastMessageAt": "...",
  "connectedClients": 123
}
```

Не отдавать secrets.

---

# 101. Производительность — целевые показатели

На desktop:

### Track animation
стремиться к 60 FPS.

### UI
не должен заметно зависать при непрерывной telemetry.

### Interaction
переключение:

```text
Трасса → Тайминг → Пилот
```

должно быть практически мгновенным.

### Connection
reconnect без reload страницы.

---

# 102. Acceptance Criteria — UI

Задача считается выполненной только если:

1. На странице текущего этапа появились две кнопки в одной строке:

```text
Смотреть онлайн | LIVE
```

2. LIVE открывается в собственном fullscreen layout.

3. Обычные header/footer RaceSide отсутствуют.

4. В левом верхнем углу всегда есть Back arrow.

5. На desktop нет общего вертикального page scroll.

6. Слева всегда виден Timing Tower.

7. В центре доступны:

```text
Трасса
Тайминг
Пилот
Аналитика
```

8. Справа доступны:

```text
События
Радио
```

9. Все данные текущего Race Replay доступны в новом LIVE интерфейсе.

---

# 103. Acceptance Criteria — Track

1. На трассе отображаются все доступные автомобили.
2. Position updates приходят realtime.
3. Машины двигаются плавно.
4. Нет рывка от каждой telemetry point.
5. Driver marker можно выбрать.
6. Selected Driver синхронизирован с Timing Tower.
7. Reconnect не сбрасывает карту.

---

# 104. Acceptance Criteria — Timing

Показываются:

- position;
- driver;
- tyre;
- tyre age;
- gap;
- interval;
- last lap;
- best lap;
- sectors;
- pit count;
- pace.

Timing обновляется без full page refresh.

---

# 105. Acceptance Criteria — Events

Feed отображает минимум:

- Race Control;
- flags;
- SC/VSC;
- pit stops;
- overtakes;
- penalties/investigations;
- session events.

Нет дублей после reconnect.

---

# 106. Acceptance Criteria — Radio

1. Team Radio отображается отдельной вкладкой.
2. Карточка имеет driver/team context.
3. Показывается EN transcript.
4. Показывается RU transcript.
5. Есть processing state.
6. Новые сообщения получают unread indicator.
7. Есть filter by driver.
8. MP3 не сохраняется в persistent storage.
9. Temporary audio удаляется после обработки.
10. Replay может показывать текст радио без MP3.

---

# 107. Acceptance Criteria — Persistence

После live session в БД остаётся история:

- location;
- telemetry;
- positions;
- intervals;
- laps;
- sectors;
- tyres;
- stints;
- pits;
- race control;
- weather;
- overtakes;
- radio text.

Из этих данных возможно построить Replay.

---

# 108. Acceptance Criteria — Development simulator

LIVE полностью запускается без реальной active session через:

```text
ReplaySimulationSource
```

Existing replay data можно проиграть через тот же:

- backend state;
- WebSocket protocol;
- frontend UI.

---

# 109. Порядок реализации

Не пытаться сразу писать всё хаотично.

## Этап 1 — Audit

Изучить:

- текущую архитектуру;
- Replay;
- schema;
- current stage;
- track renderer.

Зафиксировать, что можно переиспользовать.

---

## Этап 2 — Unified Live Types

Создать:

```text
LiveSessionState
DriverLiveState
FeedEvent
RadioMessage
WeatherState
```

и provider abstraction.

---

## Этап 3 — Replay Simulator

Сначала запустить существующую Replay session как realtime stream.

Это станет fixture для всей разработки.

---

## Этап 4 — Fullscreen UI Shell

Реализовать:

- `/live`;
- HUD;
- left tower;
- center workspace;
- right panel;
- no-scroll desktop layout.

---

## Этап 5 — Track

Подключить:

- existing geometry;
- moving markers;
- interpolation;
- driver selection.

---

## Этап 6 — Timing

Реализовать:

- Timing Tower;
- detailed Timing;
- tyre state;
- sectors;
- gap;
- interval.

---

## Этап 7 — Driver

Подключить:

- car telemetry;
- speed;
- throttle;
- brake;
- gear;
- DRS;
- live charts.

---

## Этап 8 — Analytics

Перенести данные существующего Replay:

- pits;
- lap pace;
- tyre pace;
- weather.

---

## Этап 9 — Events

Создать объединённую RaceSide event timeline.

---

## Этап 10 — Radio

Создать:

- ingestion;
- temporary audio processing;
- transcription;
- translation;
- Radio UI;
- deletion of temporary audio.

---

## Этап 11 — Persistence

Записывать полный live history.

---

## Этап 12 — Replay Bridge

Сделать возможность использовать сохранённые LIVE данные в Replay.

---

## Этап 13 — Real Live Source

Подключить realtime source через backend provider без изменения frontend protocol.

---

## Этап 14 — Testing

Прогнать:

- simulated race;
- reconnect;
- page refresh;
- multiple clients;
- 1366×768;
- 1920×1080;
- browser fullscreen;
- finish session;
- radio failures;
- missing weather;
- missing radio.

---

# 110. Основной принцип архитектуры

В итоге структура должна концептуально выглядеть так:

```text
                   ┌─────────────────────┐
                   │   LIVE DATA SOURCE  │
                   └──────────┬──────────┘
                              │
                    OpenF1 / Simulator
                              │
                              ▼
                   ┌─────────────────────┐
                   │ LIVE INGEST SERVICE │
                   └──────────┬──────────┘
                              │
                 ┌────────────┴────────────┐
                 │                         │
                 ▼                         ▼
         LIVE STATE STORE              PERSISTENCE
                 │                         │
                 │                         ▼
                 │                      REPLAY
                 │
                 ▼
        RACESIDE WEBSOCKET
                 │
                 ▼
┌───────────────────────────────────────────────────┐
│                RACESIDE LIVE                      │
│                                                   │
│ TIMING │ TRACK / TIMING / DRIVER / ANALYTICS     │
│        │                               │          │
│        │                               │ EVENTS   │
│        │                               │ RADIO    │
└───────────────────────────────────────────────────┘
```

---

# 111. Ключевой продуктовый принцип

RaceSide LIVE должен ощущаться не как:

> страница с данными о гонке.

А как:

> приложение, которое пользователь держит открытым рядом с трансляцией на протяжении всей гонки.

Поэтому:

- экран не должен прыгать;
- страница не должна скроллиться;
- layout остаётся стабильным;
- данные обновляются внутри него;
- пользователь сам выбирает, какой слой информации ему сейчас важнее;
- наиболее критичные данные остаются видимыми постоянно.

---

# 112. Финальное desktop расположение

Ориентир:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ ← SPAIN GP  ● LIVE  RACE  LAP 37/57  🟢 GREEN        24° / 38°  ● ONLINE │
├───────────────────┬─────────────────────────────────────┬───────────────────┤
│ LIVE TIMING       │ ТРАССА ТАЙМИНГ ПИЛОТ АНАЛИТИКА   │ СОБЫТИЯ | РАДИО  │
│                   │ ━━━━━━                              │                   │
│ 1 ANT M12         │                                     │ 🟡 YELLOW        │
│                   │             ● ANT                   │ Sector 2          │
│ 2 RUS M18 +1.2    │        ● RUS                        │                   │
│                   │                                     │ ⚔ OVERTAKE       │
│ 3 HAM H05 +3.4    │                    ● HAM            │ HAM → LEC         │
│                   │                                     │                   │
│ 4 LEC H05 +4.1    │                                     │ 🛞 PIT STOP       │
│                   │                                     │ NOR · 2.3 sec     │
│ ...               │                                     │                   │
│                   │                                     │                   │
├───────────────────┤                                     │                   │
│ HAM               │                                     │                   │
│ P3 · +3.471       │                                     │                   │
│ HARD · 5 LAPS     │                                     │                   │
│ LAST 1:26.421     │                                     │                   │
│ BEST 1:25.931     │                                     │                   │
└───────────────────┴─────────────────────────────────────┴───────────────────┘
```

Это является основным UX-ориентиром для desktop-версии RaceSide LIVE.
