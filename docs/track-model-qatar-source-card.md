# Qatar / Lusail — источники 3D-модели

Снимок источников: 5 октября 2026. Геометрия в EPSG:32639 (UTM 39N), единица — метр. Вертикальное усиление отсутствует.

| Слой | Источник и ограничения |
| --- | --- |
| Ось 5417,922 м, пит-лейн, здания, посадки, ограждения | [OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL 1.0; закреплённый XML от 05.10.2026. Основные ways 152483595 / 1553605580, pit ways 1037707300 / 196193732. Полотно 12 м, pit 8 м; ширина реконструирована по официальной карте и фотографиям, локальные изменения ширины не обмерены. |
| 16 поворотов, контрольные точки, 50 гаражей | [FIA Qatar 2025, circuit / pit map](https://www.fia.com/system/files/decision-document/2025_qatar_grand_prix_-_event_notes_-_circuit_map._pit_lane_drawing_emergency_exits_map_ers_battery_containment_area_red_zones_map.pdf), 27.11.2025. S2 за 80 м до T6, S3 за 75 м до T12; speed trap за 205 м до T1. RaceStart — приблизительная метрическая привязка отдельного символа старта. Документ 2026 ещё не подтверждён. |
| Трибуны события | [LIC event map 2026](https://www.lcsc.qa/event-map), публикация августа 2026, и [каталог этапа 2026](https://www.lcsc.qa/formula-1r-qatar-airways-qatar-grand-prix-2026). Main / T2 / T3 используют OSM-контуры; North / T16 реконструированы по карте и спутниковому контексту. Постоянная северо-восточная терраса показана отдельно, без утверждения о продаже билетов на неё в 2026. Lusail Hill сохранён как участок земли. |
| Реальные цвета земли | Copernicus Sentinel-2C, RGB TCI от 30.09.2026, [COG Element 84](https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/39/R/WJ/2026/9/S2C_39RWJ_20260930_0_L2A/TCI.tif). Native 10 м, free/full/open use. Contains modified Copernicus Sentinel data (2026), processed by ESA. Географическая текстура дополнена картографированными OSM материалами и дорожками; её разрешение 2048 × 2270 не означает съёмку с таким пространственным разрешением. |
| Рельеф | OpenGeoHub / Ho et al. (2025), [GEDTM30](https://s3.opengeohub.org/global/edtm/gedtm_rf_m_30m_s_20060101_20151231_go_epsg.4326.3855_v20250611.tif), CC BY 4.0; историческая bare-earth оценка 2006–2015, native около 30 м, EGM2008. Профиль сглажен на 24 м; пересекающая полотно земля локально понижена в дорожном коридоре. Современные банковки и малые насыпи не обмерены. |
| Цвета и архитектура | [Focus Design Partners](https://www.fdpme.com/projects/lusail-international-circuit), фотографии комплекса после реконструкции 2023; актуальная фотография Main Grandstand от LIC. Светлый песочный бетон, тёмное стекло, кремовые навесы, серые кресла, бордовая pit wall, красно-белые поребрики и сине-бирюзовый узор вдоль прямой. Фотографии используются для наблюдения; их пиксели не встроены. |

Все физические примитивы содержат встроенные текстуры и UV: минеральная поверхность, авторский рисунок фасадов, сидений, сетки и окрашенного фартука. Высоты зданий, фасадный ритм, ряды кресел и размеры/положение мачт восстановлены приблизительно. Контуры зданий остаются картографированными; это не LoD2 и не фотограмметрия фасадов. Четыре постоянных hospitality-павильона показаны по OSM. Неподтверждённые моторхоумы 2026 не добавлены.

URL, даты, лицензии, bbox, CRS, размер и SHA-256 каждого файла: [manifest](track-model-qatar-source-manifest.json). Та же информация включена в `/f1/tracks/3d/qatar-metadata.json`. За пределами сцены линии ограждений обрезаны по географическому bbox.

Повторная сборка:

```sh
PYTHON_BIN=.track-model-build/qatar-python/bin/python pnpm track:3d:build qatar --offline
pnpm track:3d:validate qatar
node --experimental-strip-types --test src/data/qatar-model.test.mjs
```

Подготовка использует Python с numpy, Pillow, rasterio, pyproj, scipy и shapely; Blender 5.2. Это зависимости инструментов сборки, не сайта. Исходники кешируются в `.track-model-build/qatar-source/`; без `--pin` изменения закреплённых файлов вызывают ошибку SHA-256.
