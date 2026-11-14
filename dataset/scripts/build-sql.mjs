// Build PostgreSQL inserts for the CURRENT Prisma schema from out/recipes.jsonl + out/ingredients.jsonl.
//   node dataset/scripts/build-sql.mjs                    -> out/recipes.sql (one file, one transaction)
//   node dataset/scripts/build-sql.mjs --chunk 1000       -> out/sql/000_catalog.sql, 001_recipes.sql, ...
//   node dataset/scripts/build-sql.mjs --with-images      also insert source images (check the rights first!)
// Idempotent: ids are deterministic (uuidFor(code)) and every insert is ON CONFLICT DO NOTHING.
// Fields the schema has no column for yet (steps as rows, times, meal_types, is_staple, ...) stay in the
// JSONL — rerun this script after the migration that adds them, with the mapping extended.
import fs from 'node:fs';
import path from 'node:path';
import { P, OUT, VOCAB, readJsonl, uuidFor, codeToColumn, acquireLock } from './lib.mjs';

const argv = process.argv.slice(2);
const chunkArg = argv.indexOf('--chunk');
const CHUNK = chunkArg >= 0 ? Math.max(1, Number(argv[chunkArg + 1]) || 1000) : 0;
const WITH_IMAGES = argv.includes('--with-images');
const BATCH_ROWS = 500;

const SEEDED_CUISINES = ['ITALIAN', 'JAPANESE', 'CHINESE', 'MEXICAN', 'INDIAN', 'THAI', 'FRENCH', 'AMERICAN', 'MEDITERRANEAN', 'KOREAN'];

const lit = (v) => {
  if (v == null) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (v && v.raw) return v.raw;
  return `'${String(v).replace(/\u0000/g, '').replace(/'/g, "''")}'`;
};
const raw = (s) => ({ raw: s });
const NOW = raw('CURRENT_TIMESTAMP');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

function inserts(table, cols, rows, conflict) {
  const out = [];
  for (let i = 0; i < rows.length; i += BATCH_ROWS) {
    const vals = rows.slice(i, i + BATCH_ROWS).map((r) => `(${r.map(lit).join(', ')})`);
    out.push(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES\n  ${vals.join(',\n  ')}\nON CONFLICT ${conflict} DO NOTHING;`);
  }
  return out.join('\n');
}

function catalogSql(ingredients, usedCuisines) {
  const newCuisines = [...usedCuisines].filter((c) => !SEEDED_CUISINES.includes(c));
  const parts = [];
  if (newCuisines.length)
    parts.push(inserts('cuisines', ['id', 'code', 'sortOrder', 'updatedAt'], newCuisines.map((c) => [uuidFor(`cuisine:${c}`), c, 100 + VOCAB.cuisines.indexOf(c), NOW]), '("code")'));
  parts.push(inserts('ingredients', ['id', 'updatedAt'], ingredients.map((d) => [uuidFor(`ingredient:${d.code}`), NOW]), '("id")'));
  parts.push(
    inserts(
      'ingredient_translations',
      ['id', 'ingredientId', 'language', 'name', 'updatedAt'],
      ingredients.flatMap((d) => VOCAB.languages.map((l) => [uuidFor(`ingredient:${d.code}:tr:${l}`), uuidFor(`ingredient:${d.code}`), l, d.name[l], NOW])),
      '("ingredientId", "language")',
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

function recipesSql(recipes) {
  const t = { foods: [], tr: [], nut: [], ing: [], img: [], app: [] };
  const tags = Object.fromEntries(TAG_TABLES.map(([table]) => [table, []]));
  for (const r of recipes) {
    const id = uuidFor(`food:${r.code}`);
    const image = WITH_IMAGES ? r.source_image_url ?? null : null;
    t.foods.push([id, image, r.cuisine ? raw(`(SELECT "id" FROM "cuisines" WHERE "code" = ${lit(r.cuisine)})`) : null, NOW]);
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
    // The server treats every true appliance column as REQUIRED, so only the first
    // server-known option of each group is marked (OVEN in ["OVEN","AIR_FRYER"]).
    const need = new Set();
    for (const g of r.appliances) {
      const first = g.find((a) => VOCAB.server_appliances.includes(a));
      if (first) need.add(first);
    }
    if (need.size) t.app.push([id, ...VOCAB.server_appliances.map((a) => need.has(a))]);
    const n = r.nutrition;
    t.nut.push([id, Math.round(n.calories), r.servings, r1(n.protein), r1(n.fat), r1(n.carbs)]);
    // One row per (food, ingredient): lines repeated in different groups are merged.
    const merged = new Map();
    r.ingredients.forEach((l, i) => {
      const prev = merged.get(l.code);
      if (!prev) merged.set(l.code, { amount: l.amount ?? 0, unit: l.unit, position: i });
      else if (prev.unit === l.unit) prev.amount += l.amount ?? 0;
    });
    let pos = 0;
    for (const [code, m] of merged)
      t.ing.push([uuidFor(`food:${r.code}:ing:${code}`), id, uuidFor(`ingredient:${code}`), r1(m.amount) ?? 0, m.unit, pos++]);
    if (image) t.img.push([uuidFor(`food:${r.code}:img:0`), id, image, 0]);
  }
  const parts = [
    inserts('foods', ['id', 'imageUrl', 'cuisineId', 'updatedAt'], t.foods, '("id")'),
    inserts('food_translations', ['id', 'foodId', 'language', 'name', 'description', 'content', 'updatedAt'], t.tr, '("foodId", "language")'),
    ...TAG_TABLES.map(([table, , codes]) => inserts(table, ['foodId', ...codes.map(codeToColumn)], tags[table], '("foodId")')),
    t.app.length ? inserts('food_appliances', ['foodId', ...VOCAB.server_appliances.map(codeToColumn)], t.app, '("foodId")') : '',
    inserts('food_nutrition', ['foodId', 'calories', 'servings', 'protein', 'fat', 'carbs'], t.nut, '("foodId")'),
    inserts('food_ingredients', ['id', 'foodId', 'ingredientId', 'amount', 'unit', 'position'], t.ing, '("foodId", "ingredientId")'),
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
const header = `-- Generated by dataset/scripts/build-sql.mjs at ${new Date().toISOString()}\n-- ${recipes.length} recipes, ${ingredients.length} ingredients. Safe to re-run (ON CONFLICT DO NOTHING).\n`;
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
