// Build PostgreSQL upserts for the Prisma schema from out/recipes.jsonl + out/ingredients.jsonl.
//   node dataset/scripts/build-sql.mjs                    -> out/recipes.sql (one file, one transaction)
//   node dataset/scripts/build-sql.mjs --chunk 1000       -> out/sql/000_catalog.sql, 001_recipes.sql, ...
//   node dataset/scripts/build-sql.mjs --with-images      also insert source images (check the rights first!)
// Load it with `npm run dataset:import` (builds, then runs the SQL against DATABASE_URL).
//
// Re-runnable, and a re-run *refreshes*: dish ids are deterministic (uuidFor(code)), dish and
// ingredient rows are upserted, and an imported dish's ingredient lines and appliance needs are
// replaced in full. The JSONL is the source of truth for imported dishes — an admin-panel edit
// to one of them is overwritten by the next import. Images are the exception: they are only
// ever added (--with-images), never replaced, so photos uploaded in the admin panel survive.
//
// Ingredients are referenced by `code`, not by id: before inserting, a catalog row an admin
// typed in by hand under the same name is adopted (given the code), so the catalog doesn't end
// up with two "Onion"s and pantry matching keeps working for both kinds of recipes.
import fs from 'node:fs';
import path from 'node:path';
import { P, OUT, VOCAB, readJsonl, uuidFor, codeToColumn, acquireLock } from './lib.mjs';

const argv = process.argv.slice(2);
const chunkArg = argv.indexOf('--chunk');
const CHUNK = chunkArg >= 0 ? Math.max(1, Number(argv[chunkArg + 1]) || 1000) : 0;
const WITH_IMAGES = argv.includes('--with-images');
const BATCH_ROWS = 500;

const SEEDED_CUISINES = ['ITALIAN', 'JAPANESE', 'CHINESE', 'MEXICAN', 'INDIAN', 'THAI', 'FRENCH', 'AMERICAN', 'MEDITERRANEAN', 'KOREAN'];

const SERVER_APPLIANCES = new Set(VOCAB.server_appliances);
// Equipment the app's kitchen question doesn't ask about, mapped to the closest appliance it
// does ask about. null = it can be done by hand (a whisk instead of a mixer), so it's no need.
const APPLIANCE_FALLBACK = { PRESSURE_COOKER: 'MULTICOOKER', FOOD_PROCESSOR: 'BLENDER', STEAMER: 'STOVE', TOASTER: 'OVEN', MIXER: null };

const lit = (v) => {
  if (v == null) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (v && v.raw) return v.raw;
  return `'${String(v).replace(/\u0000/g, '').replace(/'/g, "''")}'`;
};
const raw = (s) => ({ raw: s });
const NOW = raw('CURRENT_TIMESTAMP');
const enumArray = (values, type) => raw(`ARRAY[${values.map(lit).join(', ')}]::"${type}"[]`);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const q = (c) => `"${c}"`;

const valuesList = (rows) => rows.map((r) => `(${r.map(lit).join(', ')})`).join(',\n  ');
const batches = (rows) => {
  const out = [];
  for (let i = 0; i < rows.length; i += BATCH_ROWS) out.push(rows.slice(i, i + BATCH_ROWS));
  return out;
};

/**
 * INSERT ... VALUES in batches. With `conflictTarget`, a conflicting row is updated from the new
 * values for `updateCols` (or left alone when none are given); without it, no ON CONFLICT clause.
 */
function inserts(table, cols, rows, conflictTarget, updateCols = null) {
  const action = updateCols?.length ? `DO UPDATE SET ${updateCols.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(', ')}` : 'DO NOTHING';
  const conflict = conflictTarget ? `\nON CONFLICT ${conflictTarget} ${action}` : '';
  return batches(rows)
    .map((b) => `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES\n  ${valuesList(b)}${conflict};`)
    .join('\n');
}

/**
 * INSERT ... SELECT from a VALUES list joined to `ingredients` by code — how every row that
 * points at an ingredient is written, since an adopted admin ingredient keeps its own id.
 * `vcols` names the VALUES columns (one of them `code`); `select` is the SELECT list over `v`/`i`.
 */
function insertsByIngredientCode(table, cols, vcols, select, rows, conflict = '') {
  return batches(rows)
    .map(
      (b) =>
        `INSERT INTO ${q(table)} (${cols.map(q).join(', ')})\nSELECT ${select}\nFROM (VALUES\n  ${valuesList(b)}\n) AS v(${vcols.join(', ')})\n` +
        `JOIN "ingredients" i ON i."code" = v.code${conflict ? `\n${conflict}` : ''};`,
    )
    .join('\n');
}

function catalogSql(ingredients, usedCuisines) {
  const newCuisines = [...usedCuisines].filter((c) => !SEEDED_CUISINES.includes(c));
  const parts = [];
  if (newCuisines.length)
    parts.push(inserts('cuisines', ['id', 'code', 'sortOrder', 'updatedAt'], newCuisines.map((c) => [uuidFor(`cuisine:${c}`), c, 100 + VOCAB.cuisines.indexOf(c), NOW]), '("code")'));

  // Adopt hand-made catalog rows with the same name (either language, case-insensitive). The
  // ORDER BY ... LIMIT 1 picks one row if an admin made the same ingredient twice; the NOT
  // EXISTS keeps a code that's already taken from being handed out a second time.
  for (const b of batches(ingredients)) {
    parts.push(
      `UPDATE "ingredients" AS i SET "code" = d.code, "updatedAt" = CURRENT_TIMESTAMP\nFROM (VALUES\n  ${valuesList(b.map((d) => [d.code, d.name.en, d.name.ru]))}\n) AS d(code, en, ru)\n` +
        `WHERE i."code" IS NULL\n  AND NOT EXISTS (SELECT 1 FROM "ingredients" x WHERE x."code" = d.code)\n` +
        `  AND i."id" = (\n    SELECT t."ingredientId" FROM "ingredient_translations" t JOIN "ingredients" j ON j."id" = t."ingredientId"\n` +
        `    WHERE j."code" IS NULL AND ((t."language" = 'en' AND lower(t."name") = lower(d.en)) OR (t."language" = 'ru' AND lower(t."name") = lower(d.ru)))\n` +
        `    ORDER BY t."createdAt", t."ingredientId" LIMIT 1\n  );`,
    );
  }
  parts.push(
    inserts(
      'ingredients',
      ['id', 'code', 'category', 'isStaple', 'updatedAt'],
      ingredients.map((d) => [uuidFor(`ingredient:${d.code}`), d.code, d.category ?? null, !!d.is_staple, NOW]),
      '("code")',
      ['category', 'isStaple', 'updatedAt'],
    ),
  );
  parts.push(
    insertsByIngredientCode(
      'ingredient_translations',
      ['id', 'ingredientId', 'language', 'name', 'updatedAt'],
      ['id', 'code', 'language', 'name'],
      'v.id::uuid, i."id", v.language, v.name, CURRENT_TIMESTAMP',
      ingredients.flatMap((d) => VOCAB.languages.map((l) => [uuidFor(`ingredient:${d.code}:tr:${l}`), d.code, l, d.name[l]])),
      'ON CONFLICT ("ingredientId", "language") DO UPDATE SET "name" = EXCLUDED."name", "updatedAt" = EXCLUDED."updatedAt"',
    ),
  );
  return parts.filter(Boolean).join('\n\n');
}

const TAG_TABLES = [
  ['food_allergens', 'allergens', VOCAB.allergens],
  ['food_dietary_restrictions', 'dietary_restrictions', VOCAB.dietary_restrictions],
  ['food_intolerances', 'intolerances', VOCAB.intolerances],
  ['food_features', 'features', VOCAB.features],
  ['food_diets', 'diets', VOCAB.diets],
];

/**
 * The dataset's appliance groups ("STOVE and (OVEN or AIR_FRYER)") in the server's terms: a
 * group with one appliance left is a plain requirement (food_appliances), a group with several
 * is a choice (food_appliance_options). A choice a requirement already satisfies is dropped.
 */
function applianceNeeds(groups) {
  const required = new Set();
  const choices = [];
  for (const group of groups) {
    const known = [...new Set(group.map((a) => (SERVER_APPLIANCES.has(a) ? a : APPLIANCE_FALLBACK[a] ?? null)).filter(Boolean))];
    if (known.length === 1) required.add(known[0]);
    else if (known.length > 1) choices.push(known);
  }
  const seen = new Set();
  const options = choices.filter((c) => {
    const key = [...c].sort().join('|');
    if (c.some((a) => required.has(a)) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { required, options };
}

const FOOD_COLS = [
  'id', 'code', 'cuisineId', 'sourceUrl', 'course', 'mealTypes', 'prepTimeMin', 'cookTimeMin', 'totalTimeMin',
  'difficulty', 'priceLevel', 'spiceLevel', 'minAgeYears', 'containsAlcohol', 'storageDays', 'freezable', 'onePot', 'updatedAt',
];
const NUTRITION_COLS = ['foodId', 'calories', 'servings', 'protein', 'fat', 'carbs', 'sugar', 'fiber', 'saturatedFat', 'sodium', 'servingWeight'];

function recipesSql(recipes) {
  const t = { foods: [], tr: [], nut: [], ing: [], img: [], app: [], opt: [] };
  const tags = Object.fromEntries(TAG_TABLES.map(([table]) => [table, []]));
  const ids = [];
  for (const r of recipes) {
    const id = uuidFor(`food:${r.code}`);
    ids.push(id);
    t.foods.push([
      id,
      r.code,
      r.cuisine ? raw(`(SELECT "id" FROM "cuisines" WHERE "code" = ${lit(r.cuisine)})`) : null,
      r.source_url ?? null,
      r.course ?? null,
      enumArray(r.meal_types ?? [], 'MealType'),
      r.prep_time_min ?? null,
      r.cook_time_min ?? null,
      r.total_time_min ?? null,
      r.difficulty ?? null,
      r.price_level ?? null,
      r.spice_level ?? null,
      r.min_age_years ?? null,
      r.contains_alcohol ?? null,
      r.storage_days ?? null,
      r.freezable ?? null,
      r.one_pot ?? null,
      NOW,
    ]);
    for (const l of VOCAB.languages) {
      const tr = r.translations[l];
      const steps = r.steps.map((s) => `<li>${esc(s.text[l])}</li>`).join('');
      const content = `<ol>${steps}</ol>${tr.serving_tip ? `<p><em>${esc(tr.serving_tip)}</em></p>` : ''}`;
      t.tr.push([uuidFor(`food:${r.code}:tr:${l}`), id, l, tr.name, tr.description, content, NOW]);
    }
    for (const [table, key, codes] of TAG_TABLES) {
      const have = new Set(r.tags?.[key] ?? []);
      tags[table].push([id, ...codes.map((c) => have.has(c))]);
    }
    const { required, options } = applianceNeeds(r.appliances);
    if (required.size) t.app.push([id, ...VOCAB.server_appliances.map((a) => required.has(a))]);
    options.forEach((o, position) => t.opt.push([uuidFor(`food:${r.code}:appliance-option:${position}`), id, enumArray(o, 'KitchenAppliance'), position]));
    const n = r.nutrition;
    t.nut.push([id, Math.round(n.calories), r.servings, r1(n.protein), r1(n.fat), r1(n.carbs), r1(n.sugar_g), r1(n.fiber_g), r1(n.saturated_fat_g), r1(n.sodium_mg), r1(n.serving_weight_g)]);
    // One row per (food, ingredient): lines repeated in different groups are merged. A merged
    // line is optional / to-taste only if every line it came from was.
    const merged = new Map();
    r.ingredients.forEach((l) => {
      const prev = merged.get(l.code);
      if (!prev) merged.set(l.code, { amount: l.amount ?? 0, unit: l.unit, optional: !!l.optional, toTaste: !!l.to_taste });
      else {
        if (prev.unit === l.unit) prev.amount += l.amount ?? 0;
        prev.optional &&= !!l.optional;
        prev.toTaste &&= !!l.to_taste;
      }
    });
    let pos = 0;
    for (const [code, m] of merged)
      t.ing.push([uuidFor(`food:${r.code}:ing:${code}`), id, code, r1(m.amount) ?? 0, m.unit, pos++, m.optional, m.toTaste]);
    if (WITH_IMAGES && r.source_image_url) t.img.push([uuidFor(`food:${r.code}:img:0`), id, r.source_image_url, 0]);
  }

  const idArray = `ARRAY[${ids.map(lit).join(', ')}]::uuid[]`;
  const parts = [
    inserts('foods', FOOD_COLS, t.foods, '("id")', FOOD_COLS.filter((c) => c !== 'id')),
    // Replaced in full below, so a line or appliance dropped from the JSONL disappears too.
    `DELETE FROM "food_ingredients" WHERE "foodId" = ANY (${idArray});`,
    `DELETE FROM "food_appliances" WHERE "foodId" = ANY (${idArray});`,
    `DELETE FROM "food_appliance_options" WHERE "foodId" = ANY (${idArray});`,
    inserts('food_translations', ['id', 'foodId', 'language', 'name', 'description', 'content', 'updatedAt'], t.tr, '("foodId", "language")', ['name', 'description', 'content', 'updatedAt']),
    ...TAG_TABLES.map(([table, , codes]) => inserts(table, ['foodId', ...codes.map(codeToColumn)], tags[table], '("foodId")', codes.map(codeToColumn))),
    t.app.length ? inserts('food_appliances', ['foodId', ...VOCAB.server_appliances.map(codeToColumn)], t.app) : '',
    t.opt.length ? inserts('food_appliance_options', ['id', 'foodId', 'appliances', 'position'], t.opt) : '',
    inserts('food_nutrition', NUTRITION_COLS, t.nut, '("foodId")', NUTRITION_COLS.filter((c) => c !== 'foodId')),
    insertsByIngredientCode(
      'food_ingredients',
      ['id', 'foodId', 'ingredientId', 'amount', 'unit', 'position', 'optional', 'toTaste'],
      ['id', 'food_id', 'code', 'amount', 'unit', 'position', 'optional', 'to_taste'],
      'v.id::uuid, v.food_id::uuid, i."id", v.amount, v.unit, v.position, v.optional, v.to_taste',
      t.ing,
    ),
    t.img.length ? inserts('food_images', ['id', 'foodId', 'url', 'position'], t.img, '("foodId", "position")') : '',
  ];
  return parts.filter(Boolean).join('\n\n');
}

// Read both files while holding the data lock, so a parallel add.mjs can't leave us a half-written line.
const releaseData = await acquireLock('data');
const recipes = [...readJsonl(P.recipes)];
const ingredients = [...readJsonl(P.ingredients)];
releaseData();
const usedCuisines = new Set(recipes.map((r) => r.cuisine).filter(Boolean));
const header = `-- Generated by dataset/scripts/build-sql.mjs at ${new Date().toISOString()}\n-- ${recipes.length} recipes, ${ingredients.length} ingredients. Safe to re-run: upserts, refreshes imported dishes in place.\n`;
const tx = (body) => `${header}BEGIN;\n\n${body}\n\nCOMMIT;\n`;

if (!CHUNK) {
  const file = path.join(OUT, 'recipes.sql');
  fs.writeFileSync(file, tx(`${catalogSql(ingredients, usedCuisines)}\n\n${recipes.length ? recipesSql(recipes) : ''}`));
  console.log(`wrote ${file}: ${recipes.length} recipes, ${ingredients.length} ingredients`);
} else {
  const dir = path.join(OUT, 'sql');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '000_catalog.sql'), tx(catalogSql(ingredients, usedCuisines)));
  let n = 0;
  for (let i = 0; i < recipes.length; i += CHUNK)
    fs.writeFileSync(path.join(dir, `${String(++n).padStart(3, '0')}_recipes.sql`), tx(recipesSql(recipes.slice(i, i + CHUNK))));
  console.log(`wrote ${dir}: catalog + ${n} chunk(s), ${recipes.length} recipes`);
}
