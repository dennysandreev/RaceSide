# Telemetry Hub: локальная проверка

## Распределение темпа — 13 октября 2026

В «Темпе гонки» появилась третья вкладка «Распределение темпа»: box plot всего пелотона либо выбранных пилотов, сортировка по медиане, реальные количества кругов, среднее время, медиана, стандартное отклонение и средние 50% времён. Наведение/нажатие/фокус показывает значения пилота; «Таблица» открывает все значения. Фильтры шин, SC/VSC и диапазон гонки общие с динамикой темпа. Статистика рассчитана по исходным временам независимо от сглаживания и неизвестного возраста шин. Необычные времена остаются в расчёте и показаны отдельными точками. Подробная методика и границы интерпретации записаны в `21_race_pace_analytics.md`.

Проверки:

- Сингапур 2026 и Малайзия 2026 прочитаны из существующего `race-pace-3` через Supabase без записи; Монца 2025 взята из прежнего локального примера. Сверка с независимыми `statistics.mean/median/pstdev/quantiles(method="inclusive")` в Python: 54 сочетания фильтров, 454 распределения пилотов, максимальное расхождение `5,68 × 10⁻¹⁴` с. Аудит: `race-pace-distribution-audit-2026-10-13.json`.
- Все 190 тестов телеметрии прошли. Новые случаи покрывают квартили, измеренные усы, сохранение необычных кругов, один/два круга, нулевой IQR, неправильные времена, постоянные исключения, SC/VSC, шины, диапазон, неизвестный возраст, ранжирование, безопасный CSV и параметры/доступ PNG.
- Lint исходников (без `.track-model-build` и `.codex-tmp`) и TypeScript прошли. Production-сборка с Webpack проверена в отдельной временной копии: основной checkout используется другим сервером. База, зависимости, infra и env-файлы не менялись.
- Chromium: 320×667, 375×812, 430×932, 768×1024, 1024×768, 1280×720, 1440×900 и 1920×1080; обе темы. На компьютере нет вертикального скролла страницы, на телефоне сохранена обычная прокрутка; горизонтальный скролл ограничен диаграммой. Проверены клавиатура, таблица/CSV (22 строки Сингапура), выбор пилотов, возврат к возрасту шин, один круг (9 пилотов с измерениями), фильтр SC/VSC, пустое состояние и восстановление ссылки после перезагрузки. На Сингапуре/Малайзии показаны 22 пилота, на Монце — 19 с подходящими кругами. В завершающем прогоне ошибок JavaScript нет.
- Оба PNG получены через настоящий HTTP endpoint локальной production-сборки (`200 image/png`): 3200×1800 и 2160×3840. Вертикальный формат выносит все числовые значения в два столбца под диаграммой, горизонтальный располагает их под соответствующими пилотами. Дополнены недостающие кириллические символы существующего векторного шрифта; ширина подписей измеряется им же. Обе картинки осмотрены после исправлений.

Скриншоты: `race-pace-distribution-desktop.png`, `race-pace-distribution-share-horizontal.png`, `race-pace-distribution-share-vertical.png`. Работа проверена локально; production не публиковался. Safari и Firefox отдельно не проверялись.

## Секторный тайминг и профиль всех трасс — 8 октября 2026

В `track-analysis-6` устранено ложное отсутствие всех данных в профиле Монцы GAS 17 / RUS 16 и в сравнении Мадринга NOR 18 / NOR 9. Официальные времена секторов определяют момент пересечения контрольных линий каждого круга. Их общая позиция — медиана позиций выбранных кругов. Дистанция между линиями корректируется линейно; время и измеренные каналы остаются исходными, статическая разметка трасс не перезаписывается. Ошибка относительного тайминга Монцы снизилась с 0,514011 до 0,004052 с, Мадринга — с 0,359992 до 0,000162 с.

Поправка ограничена 0,35 с на контрольной линии и 6% масштаба каждого сектора. Нужны три времени секторов, их сумма в пределах 0,005 с от времени круга и отсчёты вокруг линий с интервалом до 0,6 с. Усреднённые круги не калибруются. Отсчёты не добавляются: реальные пропуски продолжают исключать затронутые участки. Дополнительные круги повторяемости получают ту же привязку; непригодные кандидаты исключаются. Старые ссылки пересчитывают также график отрыва и метрики перед сокращением данных, без записи в базу. Повторный пересчёт не сдвигает измерения снова.

Времена и отрывы секторов в интерфейсе и изображении для публикации берутся из тайминга. При отсутствующем времени сектора приблизительный отрыв больше не выдаётся за точный результат и не назначает победителя.

Проверены 23 модели трасс, 26 052 уникальные записи кругов в каталогах и 131 телеметрический круг. Прогон включает 237 сравнений: все 50 сохранённых/кешированных сравнений и 187 дополнительных пар в одной сессии. Исправление восстановило проверку профиля в 36 случаях, новых отказов нет. Во всех 50 существующих сравнениях профиль проходит проверку. На 16 трассах использованы круги 2026 года, на семи ещё недоступных этапах — реальные квалификационные круги 2025 года; будущие данные 2026 года не подтверждены. Максимальный сдвиг отсчёта в выборке — 23,52 м, остаточная ошибка индивидуального пересечения сектора — 2,63 мс.

В 30 дополнительных парах сохраняется ограничение расчёта из-за отсутствующих секторных времён, пропусков или превышения допустимой поправки. В источнике найден один круг с противоречивой суммой секторов (`11330:31:6`); он не калибруется. Значения для отсутствующих данных не выдумываются. Границы поворотов остаются приблизительными: перенос отсчёта через границу может изменить длину события и прохождение порогов детектора. Такие изменения перечислены в отчёте; неизменность количества сигналов не заявляется.

Постоянные тесты воспроизводят исходные ошибки Монцы и Мадринга, независимость от опорного пилота, сохранение каналов и пропусков, стабильность старых ссылок, ограничения поправки и отсутствие тайминга. Chromium проверил все 17 сохранённых ссылок: профиль, три секторных отрыва и ползунок до конца круга. Монца проверена на 1440 и 375 px в обоих оформлениях без горизонтального переполнения и ошибок страницы. Lint исходников с исключением существующей `.track-model-build`, typecheck, 174 теста и production-сборка прошли. Полный отчёт: [timing-audit-2026-10-08.json](./timing-audit-2026-10-08.json).

## Загрузка и выбор в заголовке — 8 октября 2026

Во всех четырёх состояниях загрузки используется «Загрузка может занять время»: открытие страницы, подготовка настроек, сравнение и темп гонки. Заголовок сразу показывает выбранный сезон, Гран-при и сессии, включая вторую сессию. При смене этапа прежняя сессия скрывается до получения нового списка. Отмена настроек и ошибка сравнения возвращают заголовок показанного сравнения; название его Гран-при сохраняется даже после смены списка сезонов.

В Chromium прошли 22 проверки с управляемой задержкой API на локальных данных Спа/Монцы и тестовых метаданных сессий: первая загрузка, выбор этапа, обеих сессий и сезона, отмена, запоздалый ответ, ошибки каталога/сравнения, успешная загрузка, мобильный экран 375 px и темп гонки. Ошибок страницы нет. Проверки не обращались к рабочей базе и не меняли её данные. Проверка типов, lint, 159 тестов телеметрии и production-сборка прошли.

## Правило суперклиппинга — 8 октября 2026

Версия `track-analysis-5` ищет замедление только при полном газе: не ниже 98% в каждом отсчёте, известный отпущенный тормоз и стабильные передача/DRS. Эпизод начинается со скорости от 300 км/ч и теряет минимум 8 км/ч за минимум 1 с и 60 м. Порог применяется к началу объединённого эпизода: замедление может продолжаться ниже 300 км/ч. Это осторожный продуктовый фильтр, не физическая нижняя граница рекуперации. Официальные описания [Formula 1](https://www.formula1.com/en/latest/article/f1-2026-regulations-explained-the-key-terms-for-formula-1s-new-for-2026-rules.3T5BU6TC9quGcIpGzoWkY0) и [Honda](https://global.honda/jp/tech/motorsports/Formula-1/glossary/terms/Super_Clipping/) связывают суперклиппинг с зарядкой батареи при полном газе; скорость сама по себе не подтверждает энергетическую причину.

Соседние фрагменты объединяются при интервале до 1,5 с и 150 м, полном газе и отсутствии торможения, переключения/смены DRS и восстановления скорости больше 2 км/ч от текущего минимума. Между фрагментами допускается быстрый поворот, но не медленный/средний. Восстановление скорости разделяет эпизоды и внутри непрерывной серии, даже если скорость не вернулась к прежнему максимуму. Неизвестные педали, передача или некорректные измерения не подтверждают событие. Усреднённые круги не используются.

Гипотезы проверены на 72 реальных кругах пяти трасс, включая 64 круга с пригодной общей телеметрией и восемь кругов выезда/охлаждения для проверки устойчивости. Проверены пороги начала 250/260/280/290/300/310 км/ч, паузы 0,5–3 с, расстояния 60–250 м и восстановления 0–8 км/ч. Порог 300 убирает сомнительные эпизоды 243→230 и 283/286 км/ч в Спа, сохраняет высокоскоростные кандидаты Баку, Монцы и Мадринга. После полного правила число событий: Баку 14→13 (19 кругов), Сепанг 7→0 (21), Монца 20→16 (12), Мадринг 11→8 (10), Спа 29→12 (10); всего 81→49. Снижение числа событий не является оценкой точности без данных MGU-K.

Объединены шесть пар в Спа. В исходном сравнении VER 11 два события на 1753–2312 м стали одним, 6,36 с и 328→283 км/ч; ANT 14 на 5720–6130 м — один эпизод, 4,561 с и 336→306. Итоговый код совпал с первоначальным прототипом на 71 круге. Отличие на ANT 53 в Монце разобрано по отсчётам: восстановление 295→299 км/ч разрывает кажущееся общее замедление; новое замедление начинается ниже порога. Этот случай добавлен в постоянный тест. Для всех оставшихся событий отдельно проверены исходные педали, передача, DRS, время между отсчётами, скорость и участки; смена индекса пилота не меняет интервал.

Постоянные тесты покрывают исходные фрагменты Спа и Монцы, частичный/неизвестный газ, торможение, переключения, повторный разгон, шум до 2 км/ч, ограничения паузы/расстояния, разные категории промежуточных поворотов, некорректные измерения и продолжение ниже порога. В браузере исходное сравнение Спа показывает по два события для VER/ANT, правильные интервалы и длительность. Проверены фильтры, пустое состояние, переключение пилотов, отсутствие прокрутки правого блока на 1440×900, 1280×720 и 1024×768, мобильная ширина 375 px и ползунок всей трассы. Сохранённые сравнения пересчитываются через существующую проверку версии; raw-данные и записи в production не изменялись.

Дополнительная проверка соседнего типа событий нашла два новых срабатывания ослабления разгона в Сепанге из-за разделения серии на полном газе. Причина устранена: для ослабления сохранена исходная серия нажатого газа, для суперклиппинга — серия полного газа. Регрессия подтверждена сначала падающим, затем проходящим тестом; на всех 72 кругах сохранились прежние 18 событий ослабления разгона. Повторная сверка оставила те же 49 событий суперклиппинга. Lint исходников, typecheck, 159 тестов телеметрии и production-сборка прошли. Браузер дополнительно проверил оба выбранных пилота Баку, Сепанга, Монцы и Мадринга без ошибок приложения и прокрутки правой панели.

Ограничения: без мощности MGU-K и заряда батареи причина остаётся гипотезой; реальные эпизоды, начинающиеся ниже 300 км/ч, могут быть пропущены. В ненаблюдаемой паузе нельзя гарантировать неизменность педалей. Приближённая дистанция и границы поворотов влияют на положение интервала; хвост без самостоятельного подтверждённого замедления через поворот не дорисовывается. Проверка не охватывает весь календарь.

Полные результаты и перебор порогов: `superclipping-rule-audit-2026-10-08.json`. Более ранние прототипы сохранены в `superclipping-filter-audit-2026-10-07.json` и `signal-grouping-audit-2026-10-08.json`.

## Позиция на карте, подсказки и сигналы — 8 октября 2026

«Трасса» использует существующий нижний ползунок для всего круга, даже при выбранном повороте. Проверены мышь, стрелки, Home/End и движение маркеров пилотов; обычные графики после выбора поворота сохраняют полный диапазон. Для трёх групп поворотов добавлены компактные подсказки по наведению, фокусу и нажатию, без модального окна. Hover не меняет выбор группы, Enter/клик меняет, Escape закрывает подсказку. Проверены тёмная и светлая темы, клавиатура и touch на 375 px.

Правый блок сигналов адаптирует высоту графика к оставшемуся месту. Весь текст и нижняя подпись видны без внутренней прокрутки. Проверены реальные события замедления/ослабления разгона в Баку, Сепанге, Монце и Мадринге; для наката использован отдельный временный UI fixture. На 1440×900, 1280×720, 1024×768 и 768×800 проверены размеры панелей; на телефоне остаётся общая прокрутка раздела. Пустое состояние после выключения фильтров работает. Использован локальный сервер, разрешающий только чтение; production не менялся.

Lint исходников с исключением существующей `.track-model-build`, typecheck, 148 тестов телеметрии и production-сборка прошли.

### Проверка Монцы и соседних сигналов в Спа

Историческая проверка до исправления: Монца, GAS 17 / RUS 16, — расхождение общего отрыва по сектору 1 составляло 0,514011 с и скрывало преимущество во всех группах. Исправление общей привязки в `track-analysis-6` описано выше.

Спа, VER 11: интервалы 1753–1974 и 2059–2312 м разделены отсчётами через 0,961 с при полном газе, тормозе 0 и передаче 8. ANT 14: интервалы 5720–5850 и 5980–6130 м разделены быстрым T16 и отсчётами через 1,24 с. Детектор ограничен прямыми и паузой 0,5 с, поэтому считает части отдельно.

Первый исследовательский прототип на 56 кругах объединял только две указанные пары в Спа: VER 5→4 события, ANT 3→2; 11 временных тестов проверяли запреты объединения. После расширения выборки правило включено в `track-analysis-5`, как описано выше. Исторический отчёт сохраняет результаты первоначального прототипа.

Материалы: `superclipping-filter-audit-2026-10-07.json`, `signal-grouping-audit-2026-10-08.json`.

## Компактный профиль трассы — 7 октября 2026

Версия `track-analysis-4` сохраняет скорость каждого пилота в профиле до сокращения данных для графиков. Для поворотов показана медиана минимальных скоростей в выбранной группе; для прямых — максимальная измеренная скорость. Пустая группа и отсутствующие скорости не превращаются в ноль. Общие границы и категория не зависят от порядка пилотов; индивидуальные значения следуют своему пилоту.

Подробные таблицы профиля заменены двумя строками главного выигрыша каждого пилота за круг и сравнением скорости выбранной группы. Нажатие на поворот открывает «Выходы и разгон», на прямую — полный круг скорости с курсором в соответствующем месте. Выбор категории и подсветка карты сохранены. На коротких экранах строки расположены компактнее; диаграмма не сжимается ниже высоты своих строк. Блок повторяемости переименован в «Повторяемость преимущества». «Как читать этот разбор» убран из всех аналитических экранов по просьбе пользователя.

Проверки:

- 148 тестов телеметрии прошли, включая 25 тестов анализа: индивидуальные минимумы, медиана нескольких поворотов, максимум прямых, смена опорного пилота и порядка трасс, отсутствующие скорости и независимость от сокращения отображаемых данных.
- TypeScript, lint исходников с исключением существующей `.track-model-build` и production-сборка прошли.
- В браузере проверены все четыре категории на сохранённых сравнениях Баку, Монцы, Мадринга и Сепанга. Например, средние повороты Монцы: GAS 207 / RUS 196 км/ч; Мадринга: NOR 221 / ANT 215; Сепанга: VER 191 / HAM 186. В Баку средняя группа пуста. При недостоверном тайминге главный выигрыш не выдумывается, скорости доступны отдельно.
- Для выбранных кругов Баку главный выигрыш RUS — прямая после T2, 0,189 с; VER — прямая перед T1, 0,164 с. Проверены переход на скорость и новый заголовок повторяемости.
- Проверены тёмная и светлая темы, 375 px и desktop-окна 1440×900, 1366×768, 1280×720, 1024×768/720 и 768×800/720. На ноутбуках сводка помещается без внутренней прокрутки и наложений; подпись карты видна. На телефоне сохраняется внутренний скролл рабочего пространства без горизонтального переполнения.

Проверка использует локальный read-only gateway и копии реальной телеметрии. Production не менялся. Время участков и их границы остаются приближёнными; проверка четырёх трасс не охватывает весь календарь.

## Повторяемость по участкам и курсор — 7 октября 2026

Версия анализа `track-analysis-3` подбирает до четырёх независимых пар отдельно для выхода из поворота и следующей прямой. Флаг, удаление круга, погода и возраст шин не исключают пригодный участок. Приоритет — выбранная пара и временная близость; шины и известный возраст показаны в таблице. Пропуск данных в другом месте не отменяет локальный результат. Сверка выполняется только по пересекаемым секторам; непроверенная оценка «≈» не входит в число преимуществ. Вывод показывает число преимуществ и медианную разницу с учётом близкого темпа. Worker ограничен восемью дополнительными загрузками; старые ссылки читают доступные нормализованные круги из кеша без внешних запросов и записи сохранённого сравнения.

В «Выходах и разгоне» убрана кнопка «Открыть на графике». Поперечный маркер карты следует за курсором скорости и газа, включая нажатие на график. «Скорость», «Педали» и «Мотор и передачи» показывают полный круг независимо от ранее выбранного поворота. Подзаголовок профиля — «Выигранное время на участках»; подробная таблица медленных поворотов убрана, категория и подсветка карты сохранены. Дополнительная подпись о пропусках не добавлялась по просьбе пользователя.

Проверки:

- 145 тестов телеметрии прошли, в том числе 22 теста анализа. Проверены независимые пары, раздельные интервалы, неизвестный возраст шин, жёлтые флаги, пропуски, неполный секторный тайминг, смена опорного пилота, ограничения загрузки и чтения кеша.
- TypeScript, lint исходников с исключением существующей `.track-model-build` и `pnpm build` прошли.
- Повторный расчёт на 23 реальных кругах совпал с исследовательским прототипом: минимум две проверенные пары доступны для 20/11/15 выходов и 14/9/14 следующих прямых в Баку / квалификации Сепанга / гонке Сепанга. Это покрытие проездов, включая круги охлаждения, а не доказательство равных условий.
- В Chromium на 1440 px маркер переместился с 325 на 529 м при движении по графику. После выбора T5 на карте все три обычных раздела вернулись к диапазону 0–6003 м. Кнопки открытия нет, таблицы медленных поворотов нет.
- На 375/768/1024 px проверены выбор T4, движение маркера, результат VER «2 из 2» на прямой и медиана 0,139 с. Нет ошибок приложения или горизонтального переполнения; проверены светлая и тёмная темы.
- На сохранённой телеметрии Монцы, Мадринга и Сепанга найдены соответственно 6, 7 и 4 средних поворота; обработаны все 11, 22 и 15 размеченных поворотов. В выбранном сравнении Баку — 14 медленных и 6 быстрых; средних нет по текущему диапазону 150–230 км/ч.

Браузер работает с локальным read-only gateway и копиями настоящей телеметрии. Production не менялся. Приближённые границы и ограниченное покрытие данных остаются ограничениями расчёта; проверка не охватывает весь календарь.

## Аналитика участков — 7 октября 2026

Добавлены «Профиль трассы», «Выходы и разгон» и «Сигналы на трассе». Все разделы, включая прежний «Разбор круга», находятся в одном верхнем меню на всю ширину. На узких экранах доступен один список. Переключатель «Весь круг» убран; при приближении графика доступна кнопка «Сбросить масштаб».

Профиль использует общие для пилотов границы и показывает число участков с совместно непрерывными данными. Выходы показывают скорость, точки полного газа, раздельный выигрыш на выходе и прямой; повторяемость проверяется только на независимых парах кругов с известными сопоставимыми условиями. Сигналы содержат карту, фильтры, описание события и график скорости. Название «Суперклиппинг» принято для устойчивого замедления при нажатом газе и отпущенном тормозе. По запросу пользователя убраны отдельные графики педалей, кнопка перехода, метки «Эксперимент» и «Оценка по телеметрии», а также подзаголовок сигналов. Полный метод и ограничения записаны в разделе «Аналитика участков» документа `17_telemetry_hub_development_plan.md`.

Проверено:

- `pnpm typecheck` — успешно.
- `pnpm test:telemetry` — 139 тестов, включая 16 тестов анализа участков, успешно.
- `pnpm exec eslint . --ignore-pattern '.track-model-build/**'` и точечный lint изменённых компонентов/расчётов — успешно. Обычный `pnpm lint` захватывает существующие сгенерированные файлы `.track-model-build` и падает на них; конфигурация lint не изменялась.
- `pnpm build` — production-сборка успешно.
- Chromium: все девять разделов на ширинах 375, 768, 1024 и 1440 px, три новых режима в обеих темах, растянутое меню на 1300, 1366, 1440 и 1920 px; горизонтального переполнения нет. Проверены выбор категории и поворота, клавиатурный переход с карты, переход на скорость и сброс масштаба, выбор пилота, фильтры и пустые события. Отдельные браузерные контексты не зарегистрировали ошибок приложения.

Браузерная проверка использует локальную копию сохранённых кругов Баку и read-only gateway. Запись в production, реальные отправки аналитических событий и развёртывание не выполнялись. Подбор дополнительных кругов проверен тестами worker; приёмка повторяемости на реальной новой выборке остаётся задачей после развёртывания. Границы и локальный тайминг приблизительные; большие расхождения с секторным таймингом скрывают выигрыш времени, а заряд батареи и количество энергии не рассчитываются.

## Средний гоночный темп

В завершённых гоночных сессиях селектор круга содержит вариант «Средний темп гонки». Worker получает и кэширует диапазон `car_data` выбранного пилота за гонку, нормализует каждый пригодный круг на общую дистанцию и строит один средний профиль времени, скорости, газа, торможения и оборотов; передача выбирается по наиболее частому значению в каждой точке. Из расчёта исключаются круг заезда в боксы, следующий круг выезда, помеченные OpenF1 pit-out круги, удалённые и неполные круги, а также круги под жёлтым или красным флагом, SC и VSC. В карточке сравнения показывается фактическое количество использованных кругов.

## Полный редизайн

После дополнительного запроса пользователя полностью изменены композиция и визуальная система: компактная боковая навигация, графитовый фон, общая панель пилотов с портретами, отдельные панели графиков и карты, интерактивные сводки по секторам. Стартовый экран получил предпросмотр выбранных пилотов. На телефоне шапка и панель сравнения адаптируются к активному представлению.

Проверены восемь представлений на шести размерах: 375×667, 390×844, 768×1024, 1024×768, 1280×720, 1440×900. Переключение темы, настройки, создание сравнения, выбор сектора и поворота работают. Typecheck, lint, 16 тестов и production-сборка прошли. Проверка локальная, в Chromium.

Актуальные изображения: [сравнение](redesign-desktop.png), [стартовый экран](redesign-setup.png), [телефон](redesign-mobile.png), [карта на телефоне](redesign-mobile-track.png), [светлая тема](redesign-light.png).

## Изменения интерфейса от 12 сентября 2026

По уточнению пользователя экран `/telemetry` занимает высоту окна и не показывает общий подвал. Настройки после загрузки доступны через «Изменить», подробные расчёты — во вкладке «Анализ», условия и источники — во вкладке «Условия». На телефоне канал выбирается списком. Длинные таблицы и настройки прокручиваются внутри своей панели; страница остаётся неподвижной.

Геометрия карты исправлена: из controller-моделей берутся `worldX/worldY`, а не высота `worldZ`. Вертикальная ось отражается для SVG; масштаб по обеим осям одинаков. Обновлены 14 карт, введена версия `telemetry-2`. Старые сохранённые сравнения получают исправленный контур при чтении без изменения измерений.

Воспроизводимая генерация: `node scripts/sync-telemetry-track-geometry.mjs` (Node с поддержкой TypeScript stripping, как в текущем окружении проекта).

Проверки:

- `pnpm typecheck` — успешно.
- `pnpm lint` — успешно.
- `node --test worker/telemetry/*.test.mjs` — 16 проверок успешно, включая соответствие плоскости всех карт исходным моделям и пропорции Монцы.
- Браузер: 375×667, 768×1024, 1024×768, 1440×900, 1280×600. Во всех восьми представлениях размеры документа совпадают с окном, горизонтальной и вертикальной прокрутки страницы нет.
- Проверены создание сравнения GAS/RUS, открытие/закрытие настроек, переключение вкладок, мобильный выбор представления и доступность всех 11 поворотов Монцы.
- Проверки API выполнялись на отдельном локальном PostgreSQL/PostgREST с реальными сохранёнными ответами OpenF1, без изменений production.

Изображения: [desktop](desktop-viewport.png), [mobile](mobile-viewport.png), [Monza mobile](mobile-track.png).

## Известные границы проверки

Проверен Chromium с эмуляцией размеров; физические iOS/Android и Safari в этой проверке не использовались. Границы анализа поворотов приблизительные, дистанция оценивается интегрированием скорости; это обозначено в интерфейсе. Исправление контура само по себе не подтверждает инженерную точность положения машины.

Миграция `20260912125010_raceside_telemetry_hub.sql` подготовлена и проверена в изолированной базе. Публичный запуск и миграция production в этой работе не выполнялись.

### UI corrections — 12 September 2026

- Restored the standard RaceSide sidebar; Telemetry follows Current Weekend. Footer stays hidden and the workspace fits the viewport.
- Replaced oversized setup with a compact session strip and driver/lap selections. Removed duplicate routes to best/manual/teammate comparisons; current fixture lap IDs themselves were unique.
- Corner detail now has four local metrics and a local time advantage, matched by corner number. Removed the 27-row mixture of lap and corner statistics from this panel.
- Added corner apex markers to every chart above the distance ticks, including zoom filtering and staggered nearby labels.
- Browser evidence: `settings-v4-desktop.png`, `settings-v4-mobile.png`, `corner-detail-v4.png`, `graph-corners-1440.png`, `graph-corners-375.png`. First and last corner values were checked against the saved comparison. Desktop and mobile document bounds match their viewport.

### Stage-style panels and share cards — 12 September 2026

The telemetry container now matches `/weekend`: at 1440px viewport, both start at x=288 and have 1120px content width. The entry title, setup and recent comparisons are framed consistently; the comparison title and driver strip share one panel. Grand Prix names come from the cached meeting catalog, including saved pages. The Conditions tab was removed and the map renamed «Карта трассы».

Share cards use the existing RaceSide logo component, embedded local portraits and Geist fonts, with distinct overview/chart/map/corner/insight compositions. The three sizes remain 1600×900, 1080×1350 and 1080×1920. A versioned preview URL refreshes the former cached design. Corner cards report corner times rather than whole-lap times. Seven representative format/variant combinations returned PNG successfully and were visually inspected. Lint, typecheck, 16 telemetry tests and production build passed. These checks used the isolated local preview and cached Monza comparison, not a production deployment.

The Analysis tab now always shows the whole lap, regardless of a corner selected on the Track tab. Corner switches and generated insight paragraphs were removed from Analysis. Verified in the browser by selecting corner 1, then opening Analysis: whole-lap metrics present, zero corner buttons, no insight text.

### Corner navigation and shared cursor

Replaced the Whole Lap action with a shared corner menu and previous/next arrows, removed the duplicate corner row and zoom/pan selector. Whole-lap Analysis remains independent. The controlled distance slider, readout, chart cursors and track dots share one subscribed position. Cursor cleanup resets the cancelled animation frame so later subscribers continue receiving updates. A regression test is included in `pnpm test:telemetry`. Browser checks covered 3000m positioning on the map, corner 5 → 6 → 5, whole-lap reset, and the mobile dropdown.

### 12 September — compact data workspace and image-only sharing

- Combined gear/RPM in one «Мотор и передачи» view and removed DRS from the Hub display contract, charts and analysis. Existing raw provider cache is unchanged.
- Grand Prix options use short names (for example «Италии»); comparison headings retain the complete race name.
- Driver summaries are 70px tall at 1440px, with 32px portraits. Setup portraits and spacing are also reduced. Sector rows align with the bottom of the map.
- All 15 share format/variant combinations rendered HTTP 200 on the local Monza comparison. Corner labels appear on the track and distance axis. Cards contain no route breadcrumb or website URL.
- Share dialog prepares a PNG before the click and passes only `files` to native sharing. File sharing was checked with a browser API stub; no real social post was sent. Unsupported browsers download PNG and explain how to attach it. Download fallback was verified in Chromium.
- Browser checks at 375, 768, 1024 and 1440px confirmed no document overflow. Gear/RPM, DRS absence in analysis, and shortened Grand Prix options were checked.
- Screenshots: `compact-v7-desktop.png`, `compact-v7-mobile.png`, `share-v7-{landscape,post,story}-{overview,telemetry,advantage,corner,insight}.png`.

Validation for this update: `pnpm lint`, the final targeted ESLint run, `pnpm typecheck`, and all 17 telemetry tests passed. Format changes and closing/reopening the share dialog were verified with a 1080×1350 PNG and no alerts. Production build is not confirmed: the default Turbopack run stalled; `next build --webpack` failed on the unrelated existing client import chain `admin-schedule-list.tsx → admin-job-catalog.ts → node:crypto`. Those admin files were not changed in this task. No deployment or real social post was performed.

### Analytics export and shared page introduction

Added «Аналитика круга» in all three export sizes, with map/chart corner labels and nine whole-lap rows (no gears or DRS). Screen and image use `lapAnalysisRows` so missing data and values are consistent. PNG renders and dialog selection were checked locally. Header typography and padding were compared with `/social` computed styles: 30px/800 desktop title, 14px/400 description with 24px line-height, red stitch-label and 20px padding. Recent history was removed, including storage reads/writes and CSS. Header has content-based height, and the red label remains in saved comparisons. Browser confirmed 20px top inset, no history even with old localStorage entries, and no mobile page overflow.

Lint, TypeScript and 17 telemetry tests passed. The production build still fails in the unrelated admin client import of `node:crypto` (`admin-job-catalog.ts`); no admin changes or deployment were made.

### Shared desktop sidebar density

Reduced AppShell sidebar spacing and navigation row heights site-wide. Browser checks at 1440px wide and 500/600/650/700/768/900px high confirmed all nine public links fit with no scrolling; account/theme controls stay visible. CSS admin overflow was verified by inserting a local DOM-only Admin link in an isolated browser context (no access or roles were changed). The admin row remains controlled by the existing server permission check. Also checked keyboard focus on the last link at 1280×600 and unchanged mobile menu at 375×667.

Full lint and TypeScript passed. Four existing season-navigation tests passed when run directly without the obsolete `--experimental-default-type=module` flag rejected by installed Node 26. The production Webpack build failed with a Next.js uncaught TypeError (`Cannot read properties of undefined (reading 'length')`); production build remains unconfirmed and no deployment was made.

### Tab overflow and loading indicator

Removed the shared TabsTrigger underline pseudo-element from telemetry's bordered tabs: its negative bottom offset made both 40px rows have 42px scroll height. Both strips now measure 40/40px, with vertical overflow disabled and an inset keyboard focus outline. Checked setup and all six comparison views at 375, 768, 1024, 1280 and 1440px widths; horizontal tab navigation remains available where needed.

Replaced the skeleton grid with a compact status panel, a rotating Lucide gear and «Готовим данные / Первый запуск может занять немного времени». The panel reserves its height so it stays visible during preparation, including at 1280×600 and 375×667. Mocked 202 responses in an isolated browser context verified initial loading and preparation after submitting a comparison, zero skeletons, no document overflow, and reduced-motion support. Screenshots: `tabs-no-scroll-desktop.png`, `loading-gear-desktop.png`, `loading-gear-1280.png`, `loading-gear-375.png`.

Full lint, TypeScript and all 17 telemetry tests passed. Webpack production build remains blocked by the unrelated admin client import chain `admin-schedule-list.tsx → admin-job-catalog.ts → node:crypto`. No deployment was made.

### Team colors across telemetry

Charts, cursor values, driver accents, analysis headings, track segments and share exports now use the cached OpenF1 driver team color. The first trace is solid, the second dashed; matching colors receive a background outline below the second chart trace so complete overlaps retain a visible dash pattern. Legends use the same solid/dashed convention, and map cursors are filled/hollow. Hex validation keeps provider colors safe for generated SVG and missing colors fall back to neutral gray. Share preview cache version is now 5.

Browser checks covered every chart channel with Alpine/Mercedes data, a mocked same-color/full-overlap comparison (no stored data changed), mobile width 375px, and track/legend patterns. Overview, analysis and telemetry share cards returned valid PNGs with team colors. Full lint, final scoped lint, TypeScript and 19 tests passed, including color ordering, matching colors and unsafe/missing color inputs. Production Webpack build still fails on the existing unrelated admin `node:crypto` import. No deployment was made.

### 13 September — setup mode switch and header height

Replaced the three uppercase mode buttons with a single segmented control, sentence-case labels, desktop icons and a raised active segment. Removed the obsolete mode-tab overrides. Setup header now matches News at 160px on desktop and uses its 184px minimum on smaller screens; the comparison header remains 131.5px tall on desktop. Browser checks covered 1440×900, 1280×600, 768×800 and 375×667: all three mode selections and keyboard arrows work, tab client/scroll heights match, and the document does not overflow. Screenshots: `mode-switch-1440.png` and `mode-switch-375.png`.

Lint, TypeScript and 19 telemetry tests passed. Production build remains blocked by the unrelated existing admin client import of `node:crypto`; no deployment was made.

The loading panel was subsequently enlarged to a 180px minimum with a 48px rotating gear and centered 16px title/13px description. Browser checks with a pending comparison at 1440×900, 1280×600 and 375×667 confirmed the entire panel remains visible without document overflow. Screenshots: `loading-large-1440.png`, `loading-large-1280.png`, `loading-large-375.png`.

### 13 September — editing flow, teammate colors and analysis clarity

Catalog loading during comparison editing now stays in the open dialog: the current workspace remains visible, controls are temporarily disabled and the action reads «Обновляем выбор». Selecting a driver requires no request or loading state. Submitting closes the dialog and uses the full loading panel once for the new comparison. The browser flow verified all three states with a real uncached session/catalog request.

Removed dashed telemetry traces throughout the hub and share exports. Different teams keep their OpenF1 colors; teammates and two laps of one driver use the team color plus neutral `#9aa1ad`. Track segments with near-equal pace use a darker gray so the neutral driver remains distinguishable. Browser validation with Norris/Piastri confirmed orange and neutral solid lines, matching legends, no page overflow and no `stroke-dasharray` on data traces.

Whole-lap analysis now calls the braking metric «Путь под торможением» and explains that it is the sum of sections where the brake is pressed beyond halfway. Gear 0 is omitted. The stronger value is bold for speed, full-throttle, sector and gear-share comparisons; braking distance and braking positions stay neutral because lower or later is not inherently better. The same ranking is used by the analytics share card, whose cache version is 6. Mobile validation confirmed no horizontal overflow. Full lint, TypeScript, 17 telemetry tests and five focused formatting tests passed. The generated 1600×900 analytics PNG was inspected. Production Webpack build remains blocked by the existing unrelated admin client import of `node:crypto`; no deployment was made.

### 13 September — sectors and delta in share cards

Share maps now place readable numbered corner markers with collision handling and label all three sectors. Whole-lap graphs show S1–S3, sector boundaries and corner numbers on the distance axis. The «Аналитика круга» export always uses a delta graph with a signed seconds scale and a visible zero line. OpenF1/source metadata was removed from every telemetry image, and the recovered footer space is used by the data panels.

The dense 22-corner Madring comparison and the 11-corner Monza comparison were rendered as 1600×900 PNGs. Madring analytics was also checked at 1080×1350 and 1080×1920, plus the overview card. Lint, TypeScript, all 17 telemetry tests and five formatting tests passed. Production Webpack build remains blocked by the existing unrelated admin client import chain `admin-schedule-list.tsx → admin-job-catalog.ts → node:crypto`; no deployment was made.

Corner-number overlays were subsequently removed from share maps and graph axes to reduce visual noise; S1–S3 remain as the only spatial annotations. Graphs use the released axis space for a taller data plot. The dedicated corner card still names its selected corner because that context is required to understand the local comparison. The red acquisition band follows the Fantasy share layout with a two-line telemetry message on the left and `raceside.online/telemetry` plus a compact invitation on the right. Madring exports use «Гран-при Испании» as the primary title and keep Madring in the secondary circuit line. Share preview cache version is 9.

Share graph labels use small font-independent vector glyphs instead of SVG text. This keeps the delta scale, distance labels and S1–S3 headings readable in every `ImageResponse` render process, including environments where nested SVG fonts are ignored. Map sector pills were removed; two short perpendicular cuts now cross the circuit at the exact starts of sectors 2 and 3. Share preview cache version is 11.

The comparison view switch («Обзор», «Скорость», «Педали», «Мотор и передачи», «Трасса», «Анализ») now reuses the setup mode's segmented surface, Geist Sans labels and raised active state. At widths below 900px the existing compact select takes over before the long row can clip. Browser checks at 1024, 900 and 768px confirmed complete labels, working tab selection and no horizontal control overflow.

### 15 September — two fixed sharing dashboards

Telemetry sharing now offers only horizontal 1600×900 and vertical 1080×1920 cards. Variant and graph selectors were removed from the dialog and image route. Both orientations contain the complete comparison dashboard: weather and circuit length, two drivers, finish delta, delta/speed/throttle/braking/gear/RPM plots, track map with corner positions and sector results, and the whole-lap analysis table. Graph headers omit the live or summary values shown in the design references. Legacy `landscape`, `post` and `story` query values remain mapped to one of the two current orientations so existing links do not fail. Share preview cache version is 13.

Both dashboard images were generated from the saved Norris/Antonelli Madring qualifying comparison and inspected at their full output sizes. The share dialog was checked in a browser: switching orientation replaces the preview and keeps native sharing plus PNG download as the only actions. Graph distance ticks were subsequently removed and corner numbers moved to the lower axis. The vertical lap-analysis table uses larger labels and values.

Sector gaps now use the provider's lap-sector times, matching «Разбор круга». Telemetry elapsed time at the geometric sector boundaries is retained only as a fallback when complete lap-sector timing is unavailable. The renderer derives gaps again from stored lap timing, so comparisons saved before this change also display consistent sector results. Share graph corner labels use bare numbers without the `T` prefix. Share preview cache version is 14.

## Карта трассы и название энергетического раздела — 8 октября 2026

В разделе «Трасса» карта использует всю доступную высоту слева. Текущий лидер, отрыв во времени, расстояние между болидами, легенда и три результата по секторам собраны в колонке справа. На 1440×900 высота контура Венгрии выросла с 247 до 378 px. Карты в обзоре и аналитике сохраняют прежнюю компоновку. Для выбранного поворота оставлена отдельная панель достаточной ширины, чтобы оба пилота помещались в таблице.

Ниже 1024 px сводка находится под картой. В коротком окне содержимое панели карты прокручивается, сохраняя минимум 200 px для карты и доступный нижний ползунок полного круга. На коротких настольных экранах сводка уплотняется, чтобы не пересекаться с ползунком.

«Сигналы на трассе» переименованы в «Управление энергией» в верхнем меню, мобильном списке и заголовке раздела. Из пустого состояния удалена фраза об отсутствии сигналов и использовании электрической тяги. Внутренний ключ `signals`, сохранённые ссылки и правила определения событий не менялись.

Проверено:

- TypeScript, lint исходников (без существующих сгенерированных `.track-model-build` и локальных `.codex-tmp`), все 174 теста телеметрии и production-сборка прошли.
- Chromium: Венгрия, Монца и Баку; светлая и тёмная темы; размеры 1920×1080, 1440×900, 1280×720, 1024×768, 1024×720, 768×1024, 375×900 и 375×667. Горизонтального переполнения страницы нет; в проверенных настольных размерах сводка целиком помещается.
- Ползунок перемещает маркеры и обновляет отрыв; клавиши Home/End достигают начала и конца круга. Выбор поворота показывает данные обоих пилотов, выбор сектора продолжает работать, ползунок остаётся в диапазоне полного круга.
- Размер карты в обзоре на 1440×900 сохранился (359×305 px); новое название и оба пустых состояния раздела управления энергией проверены в браузере. Ошибок JavaScript в проверке не зарегистрировано.

Браузер и сборка использовали локальный read-only шлюз и копии настоящей телеметрии. Production и источники данных не изменялись. Проверка интерфейса выполнена в Chromium; Safari и Firefox отдельно не проверялись.

## Название сравнения участков — 8 октября 2026

Вкладка и заголовок раздела теперь называются «Сравнение участков», подпись — «Где выиграно время». Расчёты и внутренний ключ `profile` сохранены. Проверены lint изменённых компонентов, TypeScript, 174 теста телеметрии и production-сборка. В Chromium новые тексты видны в меню и заголовке на 1300 px и в мобильном списке на 375 px; переполнения и ошибок JavaScript нет. Проверка использовала локальные копии данных.

## Мобильный блок пилотов и гэпа — 8 октября 2026

Ниже 768 px пилоты занимают равные колонки: аватар, фамилия, номер круга и шины; крупное время круга находится на одной линии у обоих пилотов. Флаги не сдвигают одно время относительно другого. Гэп вынесен в отдельную строку: подпись и более быстрый пилот слева, разница справа. Длинные подписи среднего темпа переносятся. Шапка Гран-при и кнопки сохраняют прежнюю компоновку; расчёты не менялись.

Проверены lint исходников (без сгенерированных `.track-model-build` и локальных `.codex-tmp`), TypeScript, 174 теста телеметрии и production-сборка — все прошли. Chromium: 320/375/402/430/767/768/1440 px и горизонтальный экран 667×375; все девять вкладок, обе темы, круги с разными флагами и средний темп. Переполнения нет, время пилотов выровнено, исходные времена и гэп сохранены. Диалог публикации открывается и закрывается с клавиатуры, фокус остаётся внутри. У новой подписи победителя контраст выше 10:1 в обеих темах. На исходном сравнении Сепанга высота восстановленной шапки на 402 px осталась 162 px. Данные взяты из локальных копий через read-only шлюз; production не менялся. Safari и Firefox отдельно не проверялись.

## Выбор сессии в диалоге — 8 октября 2026

В «Изменить сравнение» сезон и Гран-при выровнены в верхней строке, а сессии занимают всю ширину ниже. Кнопки сессий имеют равную ширину и общую рамку; активная сохраняет красное выделение. На экранах до 639 px используются две колонки, нечётная последняя сессия занимает обе. Высота кнопок — 44 px. Изменения ограничены CSS блока в диалоге; начальная форма и обработчики выбора сохранены.

Прошли lint исходников (без `.track-model-build` и `.codex-tmp`), TypeScript, 174 теста телеметрии и production-сборка. В Chromium проверены 320/375/430/639/640/768/1024/1440 px, обе темы, переключение сессий мышью и стрелками, фокус внутри диалога, блокировка выбора во время загрузки, пустой список и ошибка каталога, восстановление выбора после отмены и доступность кнопки сравнения на 1280×720. Горизонтального переполнения и ошибок JavaScript в завершающей проверке нет. Использованы локальные копии телеметрии и управляемые тестовые метаданные спринтового уикенда. Production не менялся; Safari и Firefox отдельно не проверялись.
