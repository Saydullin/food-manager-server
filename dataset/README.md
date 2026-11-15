# Датасет рецептов

Пайплайн сбора рецептов из интернета для таблицы блюд. Его выполняет агент `recipe-collector`
(`.claude/agents/recipe-collector.md`). Скрипты написаны на Node без зависимостей, запускать из корня репозитория.

```
сайты ──discover.mjs──▶ work/queue.json ──fetch-recipe.mjs──▶ сырой JSON-LD
        (sitemap/robots)                   (robots.txt, 3 с/хост)         │
                                                          агент нормализует,
                                                          классифицирует, переводит
                                                                          ▼
out/recipes.sql ◀──build-sql.mjs── out/recipes.jsonl ◀──add.mjs── work/batch.json
                                    out/ingredients.jsonl   (валидация + вывод тегов)
```

| Скрипт | Назначение |
|---|---|
| `status.mjs [--target N]` | прогресс, распределения, советы по балансу |
| `discover.mjs --site <origin>` / `<sitemap\|page>` | найти URL рецептов и положить в очередь |
| `fetch-recipe.mjs --next 5` / `<url>` | скачать страницы, извлечь schema.org/Recipe |
| `ingredients.mjs find <слово>...` | найти код ингредиента в реестре |
| `add.mjs work/batch_<id>.json` | проверить и принять записи |
| `queue.mjs skip <url> <причина>` / `block-host` / `stats` | управление очередью |
| `build-sql.mjs [--chunk N] [--with-images]` | собрать SQL под текущую схему Prisma |

### Параллельная работа

Несколько сессий агента могут работать одновременно. Это безопасно, потому что скрипты защищены блокировками
(файлы в `work/locks/`, устаревшие блокировки умерших процессов снимаются сами):

- `add.mjs` весь цикл «прочитать индекс → проверить → дописать jsonl → сохранить индекс» выполняет под
  блокировкой `data`, поэтому дубли блюд и ингредиентов (по коду, URL и названию) ловятся и между сессиями.
  Повторное описание уже существующего ингредиента в `new_ingredients` не ошибка: остаётся существующее.
- `fetch-recipe.mjs --next` выбирает и сразу резервирует (`taken`) URL под блокировкой `queue`, сессии не
  получают одинаковые страницы. Все изменения очереди (`queue.mjs`, `discover.mjs`) атомарны.
- Пауза 3 секунды на хост общая для всех процессов: слот запроса резервируется под блокировкой `hosts`.
- Файл пачки у каждой сессии свой: `work/batch_<id>.json` (общий `batch.json` перезаписывали бы друг другу).
- `build-sql.mjs` читает `out/*.jsonl` под той же блокировкой `data`.

Если сессию убили на середине, её `taken`-URL вернутся в очередь через 2 часа.

Каталоги `work/` (состояние) и `out/` (результат) в git не попадают. **Источник правды — `out/*.jsonl`**,
SQL из них пересобирается в любой момент.

Заливка: `npm run dataset:import` (после `prisma migrate deploy`). Команда пересобирает `out/recipes.sql`
и выполняет его на `DATABASE_URL` через `prisma db execute`. Скрипт можно запускать повторно, и повторный
запуск **обновляет** данные: id блюд детерминированные, блюда и ингредиенты делают upsert (по `code`),
а строки рецепта и приборы импортированного блюда заменяются целиком. Правки импортированного блюда в
админке следующий импорт перезапишет: источник правды — JSONL. Картинки только добавляются, загруженные
в админке фото не трогаются.

### Как данные ложатся в схему

- Блюдо: `foods.code`, `course`, `mealTypes`, время, `difficulty`, `priceLevel`, `spiceLevel`, `minAgeYears`,
  `containsAlcohol`, `storageDays`, `freezable`, `onePot`, `sourceUrl`. КБЖУ целиком в `food_nutrition`,
  включая сахар, клетчатку, насыщенные жиры, натрий (мг) и вес порции.
- Ингредиент: `ingredients.code`, `category`, `isStaple`. Строки рецепта ссылаются на ингредиент через
  `code`. Ингредиент, который админ завёл вручную с тем же названием (ru или en, без учёта регистра), не
  дублируется: импорт присваивает ему `code`.
- Строка рецепта: `optional`, `toTaste`. `to_taste` без количества пишется как `amount = 0`.
- Приборы: группа из одного прибора — обязательный прибор (`food_appliances`). Группа из нескольких —
  выбор «любой из» (`food_appliance_options`). Приборы, о которых приложение не спрашивает, заменяются
  ближайшим: `PRESSURE_COOKER`→`MULTICOOKER`, `FOOD_PROCESSOR`→`BLENDER`, `STEAMER`→`STOVE`,
  `TOASTER`→`OVEN`. `MIXER` не требуется вовсе: можно венчиком.
- Новые кухни (RUSSIAN, GEORGIAN, …) вставляются в `cuisines`. Android-enum `Cuisine` их пока не знает:
  блюда приходят, но выбрать такую кухню в «нравится» нельзя.

### Что пока не попадает в БД

- Шаги отдельными строками. Сейчас они пишутся HTML-списком в `content`, вместе с `serving_tip`.
- `group` и `note` у строк рецепта, `allergens`/`excludes`/`default_unit` ингредиентов. Аллергены и
  ограничения блюда уже посчитаны `add.mjs`, так что ингредиентные не нужны для фильтрации.
- Картинки по умолчанию **не** вставляются (`--with-images` включает): у фото с чужих сайтов свои права.

---

## Формат записи (то, что агент кладёт в `work/batch.json`)

Файл содержит массив записей. Все коды берутся из `vocab.json`. Тексты на двух языках, `ru` и `en`.
Пример:

```json
{
  "code": "chicken_plov_uzbek",
  "source_url": "https://example.ru/recipes/plov-s-kuricej",
  "source_image_url": "https://example.ru/img/plov.jpg",
  "cuisine": "UZBEK",
  "meal_types": ["LUNCH", "DINNER"],
  "course": "MAIN",
  "servings": 4,
  "prep_time_min": 20,
  "cook_time_min": 60,
  "total_time_min": 80,
  "difficulty": 2,
  "price_level": 1,
  "spice_level": 1,
  "min_age_years": 3,
  "contains_alcohol": false,
  "storage_days": 3,
  "freezable": true,
  "one_pot": true,
  "translations": {
    "ru": { "name": "Плов с курицей", "description": "Рассыпчатый рис с курицей, морковью и зирой, всё в одном казане.",
            "serving_tip": "Подавайте с салатом из свежих овощей.", "search_keywords": ["плов", "ош", "рис с курицей"] },
    "en": { "name": "Chicken plov", "description": "Fluffy rice with chicken, carrots and cumin cooked in one pot.",
            "serving_tip": "Serve with a fresh vegetable salad.", "search_keywords": ["pilaf", "plov"] }
  },
  "steps": [
    { "text": { "ru": "Нарежьте курицу кусками, лук полукольцами, морковь соломкой.", "en": "Cut the chicken into pieces, the onion into half-rings and the carrots into strips." }, "duration_min": 15, "appliance": null },
    { "text": { "ru": "Обжарьте курицу в разогретом масле до румяности, добавьте лук и морковь.", "en": "Brown the chicken in hot oil, then add the onion and carrots." }, "duration_min": 15, "appliance": "STOVE" }
  ],
  "ingredients": [
    { "code": "chicken_thigh", "amount": 600, "unit": "g", "to_taste": false, "optional": false, "group": null, "note": null },
    { "code": "long_grain_rice", "amount": 400, "unit": "g", "to_taste": false, "optional": false, "group": null, "note": { "ru": "промыть", "en": "rinsed" } },
    { "code": "salt", "amount": null, "unit": "pinch", "to_taste": true, "optional": false, "group": null, "note": null }
  ],
  "new_ingredients": [
    { "code": "long_grain_rice", "name": { "ru": "Рис длиннозёрный", "en": "Long-grain rice" }, "category": "GRAIN",
      "allergens": [], "excludes": [], "is_staple": false, "default_unit": "g", "grams_per_unit": null }
  ],
  "appliances": [["STOVE", "MULTICOOKER"]],
  "nutrition": { "source": "estimated", "calories": 620, "protein": 32, "fat": 22, "carbs": 72,
                 "sugar_g": 6, "sodium_mg": 650, "fiber_g": 3, "saturated_fat_g": 5, "serving_weight_g": 380 },
  "tags": { "allergens": [], "dietary_restrictions": ["HALAL"], "intolerances": [], "features": [], "diets": [] }
}
```

### Поля

| Поле | Правило |
|---|---|
| `code` | латиница snake_case, ≤ 60 символов, уникальный и осмысленный: `borsch_with_beans`, а не `recipe_123` |
| `source_url` | URL страницы ровно в том виде, в каком он стоит в очереди (поле `url` в выводе fetch-recipe) |
| `source_image_url` | URL обложки или `null`. Сами файлы не скачиваем |
| `cuisine` | код из `vocab.cuisines` или `null`. Неочевидную кухню не выдумывать: `INTERNATIONAL` |
| `meal_types` | для каких приёмов пищи подходит, минимум один |
| `course` | `MAIN` — основное блюдо, которое можно съесть на ужин само по себе. `SIDE` — гарнир. `APPETIZER` — закуска |
| `servings` | число порций в исходном рецепте. Количества ингредиентов указываются **на это число порций** |
| `prep_time_min` / `cook_time_min` / `total_time_min` | минуты. total включает ожидание (маринад, тесто, остывание), обязателен |
| `difficulty` | 1 — справится новичок, 2 — нужны базовые навыки, 3 — сложные техники или много этапов |
| `price_level` | 1 — бюджетно (крупы, курица, овощи), 2 — средне, 3 — дорого (говяжья вырезка, красная рыба, морепродукты) |
| `spice_level` | 0 — совсем не остро, 1 — чуть пикантно (детям обычно нормально), 2 — острое, 3 — очень острое |
| `min_age_years` | с какого возраста блюдо обычно дают детям. 1 — простые мягкие блюда, 3 — обычные семейные, 6+ — острое, жареное во фритюре, с целыми орехами, 12+ — сырая рыба и сложная острота, 18 — заметный алкоголь, не выпаренный при готовке. Мёд — не младше 1 |
| `storage_days` | сколько дней готовое блюдо хранится в холодильнике (`null`, если его едят только сразу) |
| `freezable` / `one_pot` | можно ли заморозить; готовится ли в одной посуде |
| `translations.*.name` | обычное название блюда на этом языке («Борщ», а не «Борщ от бабушки Нины!!!»). Варианты различать по сути: «Борщ с фасолью» |
| `translations.*.description` | 1–2 предложения **своими словами**, без копирования с сайта |
| `steps` | 2–15 шагов, **пересказ своими словами**, повелительное наклонение. `appliance` — прибор этого шага, он обязан быть в `appliances` |
| `ingredients[].amount/unit` | метрические единицы: г, мл, шт, ст. л. (`tbsp`), ч. л. (`tsp`). Чашки, унции и фунты перевести в г/мл |
| `ingredients[].to_taste` | «по вкусу»: тогда `amount` может быть `null` |
| `ingredients[].optional` | ингредиент необязательный («по желанию», «для подачи») |
| `ingredients[].group` | заголовок секции рецепта («Для соуса» / «For the sauce») или `null` |
| `appliances` | список групп, внутри группы — взаимозаменяемые приборы. `[["STOVE"], ["OVEN","AIR_FRYER"]]` значит «плита И (духовка ИЛИ аэрогриль)». Блюдо без готовки — `[]`. Альтернативу добавлять только если она реально работает |
| `nutrition` | **на одну порцию**. `site`, если КБЖУ взяты со страницы (пересчитать на порцию). Иначе `estimated`: посчитать по ингредиентам. `sodium_mg` ≈ соль в граммах × 393. Соль «по вкусу» считать ~1 г на порцию основного блюда |
| `tags.dietary_restrictions` | ставить, если блюдо подходит. `HALAL` — нет свинины, алкоголя, желатина и других нехаляльных добавок; мясо подразумевается купленным халяльным. `KOSHER` — только если источник явно пишет «кошерное» |
| `tags.diets` | `KETO` (углеводов ≤ 20 г, жир основной), `PALEO`, `MEDITERRANEAN`, `DIABETIC_FRIENDLY` (мало сахара и быстрых углеводов), `LOW_GI` |
| `tags.features` | агент ставит только `SWEET` и `SUGAR_FREE`. Остальное вычисляется из КБЖУ и `spice_level` |
| `tags.allergens` / `intolerances` | можно оставить пустыми: `add.mjs` выведет их из ингредиентов. Но `FRUCTOSE` (мёд, много фруктов, сиропы) и `HISTAMINE` (выдержанные сыры, ферментированное, копчёное, консервированная рыба, вино, квашеная капуста) ставит агент |

### Ингредиенты (`new_ingredients`)

Реестр ингредиентов общий для всех рецептов. От него зависит, будут ли работать кладовка и список покупок,
поэтому дубли в нём недопустимы.

| Поле | Правило |
|---|---|
| `code` | английский snake_case в единственном числе, без брендов: `onion`, `chicken_breast`, `canned_tomatoes`, `tomato_paste`. Разные формы, важные для покупки, — разные коды (`tomato` ≠ `canned_tomatoes`). Синонимы — один код |
| `name` | название в именительном падеже: `{ "ru": "Лук репчатый", "en": "Onion" }` |
| `category` | из `vocab.ingredient_categories` |
| `allergens` | **консервативно**: если сомневаешься, ставь. Пшеничная мука, хлеб, паста → `WHEAT`, `GLUTEN`. Рожь, ячмень, овёс, булгур, манка, кускус → `GLUTEN` (у пшеничных ещё `WHEAT`). Соевый соус → `SOY`, `WHEAT`, `GLUTEN`. Сливочное масло, сыр, сливки, йогурт → `MILK`. Майонез → `EGGS` (+ `MUSTARD`). Песто → `MILK`, `TREE_NUTS`. Креветки, крабы → `SHELLFISH`. Кальмары, мидии → `MOLLUSCS`. Вино, сухофрукты → `SULFITES`. Вустерский соус → `FISH`. Тахини → `SESAME` |
| `excludes` | какие ограничения ингредиент нарушает. Мясо и птица → `VEGETARIAN, VEGAN, PESCATARIAN, KOSHER`, у свинины (и колбас, сала, бекона из неё) ещё `HALAL`. Рыба → `VEGETARIAN, VEGAN`. Морепродукты → `VEGETARIAN, VEGAN, KOSHER`. Молочное, яйца, мёд → `VEGAN`. Алкоголь → `HALAL`. Желатин → `VEGETARIAN, VEGAN, HALAL, KOSHER`. |
| `is_staple` | `true` для того, что есть почти на любой кухне: соль, чёрный перец, вода, сахар, растительное масло, мука пшеничная, уксус. В кладовке они не считаются недостающими |
| `default_unit` / `grams_per_unit` | например, `egg`: `pcs`, 55; `garlic`: `clove`, 5; для `tbsp` указывать вес столовой ложки этого продукта |

### Что делает `add.mjs` сам

- Отклоняет запись при ошибке формата, неизвестном коде, дубле `code` / URL / названия блюда, дубле названия
  ингредиента под другим кодом, русском тексте без кириллицы или английском с кириллицей.
- **Добавляет** аллергены всех ингредиентов в блюдо (`WHEAT` ⇒ `GLUTEN`), `LACTOSE` при `MILK` и `GLUTEN`
  при `GLUTEN`. **Снимает** ограничения, которые нарушает хотя бы один ингредиент.
- Вычисляет признаки на порцию: `LOW_CALORIE` (≤ 450 ккал для основного блюда или супа, ≤ 250 для остальных),
  `HIGH_PROTEIN` (≥ 20 г и ≥ 20 % калорий), `LOW_FAT` (≤ 10/5 г), `LOW_CARB` (≤ 15 г), `HIGH_FIBER` (≥ 6 г),
  `HIGH_SUGAR` (≥ 20 г), `HIGH_SODIUM` (≥ 800 мг), `SPICY` (spice ≥ 2), `VERY_SPICY` (= 3).
  Снимает `KETO` при углеводах > 20 г и `DIABETIC_FRIENDLY` при сахаре > 15 г.
