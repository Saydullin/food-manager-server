// Validate normalized recipe records and append the accepted ones to out/recipes.jsonl.
//   node dataset/scripts/add.mjs <batch.json>     (a record or an array of records; format: dataset/README.md)
// Accepted records are removed from the batch file; rejected ones stay there so you can fix and re-run.
// Exit code 0 = all accepted, 1 = some rejected.
//
// Safety-relevant tags are DERIVED here, not trusted from the record:
//   - dish allergens   ⊇ allergens of all its ingredients (WHEAT also implies GLUTEN)
//   - intolerances     LACTOSE if MILK, GLUTEN if GLUTEN (added, never removed)
//   - dietary restrictions conflicting with any ingredient's `excludes` are removed
//   - nutrition features (LOW_CALORIE, HIGH_PROTEIN, ...) are computed from per-serving numbers
//   - SPICY / VERY_SPICY come from spice_level; contains_alcohol from ALCOHOL ingredients
import fs from 'node:fs';
import { P, VOCAB, loadIndex, updateQueue, acquireLock, writeJson, normName, hostOf, die } from './lib.mjs';

const file = process.argv[2];
if (!file) die('usage: add.mjs <batch.json>');
let input;
try {
  input = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  die(`cannot parse ${file}: ${e.message}`);
}
const records = Array.isArray(input) ? input : [input];

// Exclusive lock for the whole load-index → validate → append → save-index cycle, so parallel sessions
// always validate against the latest index (no duplicate dishes/ingredients, no lost index entries).
const releaseData = await acquireLock('data');
const idx = loadIndex();
const doneUrls = [];

const CYR = /[а-яё]/i;
const CODE_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const str = (v) => typeof v === 'string' && v.trim().length > 0;
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const num = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isUrl = (v) => {
  try {
    return /^https?:$/.test(new URL(v).protocol);
  } catch {
    return false;
  }
};

const NUTRITION_FEATURES = ['LOW_CALORIE', 'HIGH_PROTEIN', 'LOW_FAT', 'LOW_CARB', 'HIGH_FIBER', 'HIGH_SUGAR', 'HIGH_SODIUM'];

function checkBilingual(o, path, max, err, { required = true } = {}) {
  if (o == null) {
    if (required) err(`${path}: required {ru, en}`);
    return;
  }
  if (typeof o !== 'object') return err(`${path}: must be {ru, en}`);
  for (const lang of ['ru', 'en']) {
    if (!str(o[lang])) err(`${path}.${lang}: required non-empty string`);
    else if (o[lang].length > max) err(`${path}.${lang}: longer than ${max} chars`);
  }
  if (str(o.ru) && !CYR.test(o.ru)) err(`${path}.ru: must be Russian (no Cyrillic found)`);
  if (str(o.en) && CYR.test(o.en)) err(`${path}.en: must be English (Cyrillic found)`);
}

function checkSubset(list, allowed, path, err) {
  if (!Array.isArray(list)) return err(`${path}: must be an array`);
  for (const v of list) if (!allowed.includes(v)) err(`${path}: unknown code "${v}" (allowed: ${allowed.join(', ')})`);
}

function validateIngredientDef(d, i, err, pending) {
  const p = `new_ingredients[${i}]`;
  if (!str(d.code) || !CODE_RE.test(d.code) || d.code.length > 50) return err(`${p}.code: snake_case latin, <= 50 chars`);
  if (idx.ingredients[d.code] || pending.has(d.code)) return 'exists';
  checkBilingual(d.name, `${p}.name`, 80, err);
  if (!VOCAB.ingredient_categories.includes(d.category)) err(`${p}.category: one of ${VOCAB.ingredient_categories.join(', ')}`);
  checkSubset(d.allergens ?? [], VOCAB.allergens, `${p}.allergens`, err);
  checkSubset(d.excludes ?? [], VOCAB.dietary_restrictions, `${p}.excludes`, err);
  if (typeof d.is_staple !== 'boolean') err(`${p}.is_staple: boolean required`);
  if (!VOCAB.units.includes(d.default_unit)) err(`${p}.default_unit: one of ${VOCAB.units.join(', ')}`);
  if (d.grams_per_unit != null && !num(d.grams_per_unit, 0.01, 10000)) err(`${p}.grams_per_unit: null or a positive number`);
  for (const lang of ['ru', 'en']) {
    const n = normName(d.name?.[lang]);
    const other = n && idx.ingredientNames[n];
    if (other && other !== d.code) err(`${p}: an ingredient named "${d.name[lang]}" already exists as "${other}" — use that code`);
  }
  return 'new';
}

function validateRecipe(r, err, warn) {
  if (!str(r.code) || !CODE_RE.test(r.code) || r.code.length > 60) err('code: snake_case latin, <= 60 chars');
  else if (idx.recipes[r.code]) err(`code: "${r.code}" already exists — duplicate or pick a more specific code`);
  if (!isUrl(r.source_url)) err('source_url: http(s) URL required');
  else if (idx.urls[r.source_url]) err(`source_url: already used by "${idx.urls[r.source_url]}"`);
  if (r.source_image_url != null && !isUrl(r.source_image_url)) err('source_image_url: null or URL');

  if (r.cuisine != null && !VOCAB.cuisines.includes(r.cuisine)) err(`cuisine: null or one of ${VOCAB.cuisines.join(', ')}`);
  if (!Array.isArray(r.meal_types) || !r.meal_types.length) err('meal_types: non-empty array');
  else checkSubset(r.meal_types, VOCAB.meal_types, 'meal_types', err);
  if (!VOCAB.courses.includes(r.course)) err(`course: one of ${VOCAB.courses.join(', ')}`);

  if (!int(r.servings, 1, 50)) err('servings: integer 1..50');
  for (const k of ['prep_time_min', 'cook_time_min']) if (r[k] != null && !int(r[k], 0, 4320)) err(`${k}: null or integer 0..4320`);
  if (!int(r.total_time_min, 1, 4320)) err('total_time_min: integer 1..4320');
  if (!int(r.difficulty, 1, 3)) err('difficulty: 1..3');
  if (!int(r.price_level, 1, 3)) err('price_level: 1..3');
  if (!int(r.spice_level, 0, 3)) err('spice_level: 0..3');
  if (!int(r.min_age_years, 0, 18)) err('min_age_years: integer 0..18');
  if (r.storage_days != null && !int(r.storage_days, 0, 30)) err('storage_days: null or 0..30');
  for (const k of ['contains_alcohol', 'freezable', 'one_pot']) if (typeof r[k] !== 'boolean') err(`${k}: boolean required`);

  const t = r.translations || {};
  for (const lang of ['ru', 'en']) {
    const tr = t[lang];
    if (!tr) {
      err(`translations.${lang}: required`);
      continue;
    }
    if (!str(tr.name) || tr.name.length > 120) err(`translations.${lang}.name: required, <= 120 chars`);
    if (!str(tr.description) || tr.description.length > 500) err(`translations.${lang}.description: required, <= 500 chars`);
    if (tr.serving_tip != null && (!str(tr.serving_tip) || tr.serving_tip.length > 300)) err(`translations.${lang}.serving_tip: null or <= 300 chars`);
    if (tr.search_keywords != null && (!Array.isArray(tr.search_keywords) || tr.search_keywords.length > 10 || !tr.search_keywords.every(str)))
      err(`translations.${lang}.search_keywords: array of <= 10 strings`);
    const cyr = CYR.test(`${tr.name ?? ''} ${tr.description ?? ''}`);
    if (lang === 'ru' && str(tr.name) && !cyr) err('translations.ru: must be Russian');
    if (lang === 'en' && cyr) err('translations.en: must be English (Cyrillic found)');
    const n = normName(tr.name);
    if (n && idx.recipeNames[n]) err(`translations.${lang}.name: a dish named "${tr.name}" already exists ("${idx.recipeNames[n]}") — skip it or name the variant distinctly`);
  }

  if (!Array.isArray(r.appliances)) err('appliances: array of option groups, e.g. [["STOVE"], ["OVEN","AIR_FRYER"]] or []');
  else
    r.appliances.forEach((g, i) => {
      if (!Array.isArray(g) || !g.length) err(`appliances[${i}]: non-empty array`);
      else checkSubset(g, VOCAB.appliances, `appliances[${i}]`, err);
    });
  const applianceSet = new Set((r.appliances || []).flat());

  if (!Array.isArray(r.steps) || r.steps.length < 1 || r.steps.length > 40) err('steps: 1..40 items');
  else
    r.steps.forEach((s, i) => {
      checkBilingual(s.text, `steps[${i}].text`, 1000, err);
      if (s.duration_min != null && !int(s.duration_min, 0, 4320)) err(`steps[${i}].duration_min: null or integer`);
      if (s.appliance != null) {
        if (!VOCAB.appliances.includes(s.appliance)) err(`steps[${i}].appliance: unknown`);
        else if (!applianceSet.has(s.appliance)) err(`steps[${i}].appliance: ${s.appliance} is not in the dish's appliances`);
      }
    });

  const n = r.nutrition;
  if (!n || typeof n !== 'object') err('nutrition: required');
  else {
    if (!['site', 'estimated'].includes(n.source)) err('nutrition.source: "site" or "estimated"');
    if (!int(n.calories, 1, 3000)) err('nutrition.calories: integer kcal per serving, 1..3000');
    for (const k of ['protein', 'fat', 'carbs', 'sugar_g']) if (!num(n[k], 0, 500)) err(`nutrition.${k}: grams per serving required`);
    if (!num(n.sodium_mg, 0, 10000)) err('nutrition.sodium_mg: mg per serving required');
    for (const k of ['fiber_g', 'saturated_fat_g']) if (n[k] != null && !num(n[k], 0, 300)) err(`nutrition.${k}: null or grams`);
    if (n.serving_weight_g != null && !num(n.serving_weight_g, 1, 5000)) err('nutrition.serving_weight_g: null or grams');
    if (num(n.calories, 1, 3000) && num(n.protein, 0, 500) && num(n.fat, 0, 500) && num(n.carbs, 0, 500)) {
      const est = 4 * n.protein + 9 * n.fat + 4 * n.carbs;
      if (Math.abs(est - n.calories) / n.calories > 0.35) warn(`nutrition: macros give ~${Math.round(est)} kcal vs calories ${n.calories} — double-check`);
    }
    if (num(n.sugar_g, 0, 500) && num(n.carbs, 0, 500) && n.sugar_g > n.carbs + 0.5) err('nutrition.sugar_g: cannot exceed carbs');
  }

  const tg = r.tags || {};
  checkSubset(tg.allergens ?? [], VOCAB.allergens, 'tags.allergens', err);
  checkSubset(tg.dietary_restrictions ?? [], VOCAB.dietary_restrictions, 'tags.dietary_restrictions', err);
  checkSubset(tg.intolerances ?? [], VOCAB.intolerances, 'tags.intolerances', err);
  checkSubset(tg.features ?? [], VOCAB.features, 'tags.features', err);
  checkSubset(tg.diets ?? [], VOCAB.diets, 'tags.diets', err);
}

function checkIngredients(r, err, lookup) {
  if (!Array.isArray(r.ingredients) || r.ingredients.length < 2) return err('ingredients: at least 2 lines');
  if (r.ingredients.length > 40) err('ingredients: more than 40 lines — skip such recipes');
  const seen = new Set();
  r.ingredients.forEach((l, i) => {
    const p = `ingredients[${i}]`;
    if (!lookup(l.code)) err(`${p}.code: unknown ingredient "${l.code}" — find it with ingredients.mjs or define it in new_ingredients`);
    if (l.to_taste === true) {
      if (l.amount != null && !num(l.amount, 0.0001, 100000)) err(`${p}.amount: null or positive when to_taste`);
    } else if (!num(l.amount, 0.0001, 100000)) err(`${p}.amount: positive number required (or to_taste: true)`);
    if (!VOCAB.units.includes(l.unit)) err(`${p}.unit: one of ${VOCAB.units.join(', ')}`);
    if (l.optional != null && typeof l.optional !== 'boolean') err(`${p}.optional: boolean`);
    if (l.group != null) checkBilingual(l.group, `${p}.group`, 60, err);
    if (l.note != null) checkBilingual(l.note, `${p}.note`, 120, err);
    const key = `${l.code}|${l.group?.en ?? ''}`;
    if (seen.has(key)) err(`${p}: "${l.code}" listed twice in the same group — merge the amounts`);
    seen.add(key);
  });
}

/** Fills in the derived, safety-relevant tags. Returns a list of human-readable changes. */
function derive(r, lookup) {
  const changes = [];
  const tg = (r.tags ||= {});
  const defs = r.ingredients.map((l) => lookup(l.code));
  const set = (k) => new Set(tg[k] ?? []);

  const allergens = set('allergens');
  for (const d of defs) for (const a of d.allergens ?? []) if (!allergens.has(a)) (allergens.add(a), changes.push(`+allergen ${a} (from ${d.code})`));
  if (allergens.has('WHEAT') && !allergens.has('GLUTEN')) (allergens.add('GLUTEN'), changes.push('+allergen GLUTEN (wheat)'));
  tg.allergens = VOCAB.allergens.filter((a) => allergens.has(a));

  const intol = set('intolerances');
  if (allergens.has('MILK') && !intol.has('LACTOSE')) (intol.add('LACTOSE'), changes.push('+intolerance LACTOSE'));
  if (allergens.has('GLUTEN') && !intol.has('GLUTEN')) (intol.add('GLUTEN'), changes.push('+intolerance GLUTEN'));
  tg.intolerances = VOCAB.intolerances.filter((a) => intol.has(a));

  const excluded = new Set(defs.flatMap((d) => d.excludes ?? []));
  const restr = set('dietary_restrictions');
  for (const x of [...restr]) if (excluded.has(x)) (restr.delete(x), changes.push(`-restriction ${x} (an ingredient breaks it)`));
  if (restr.has('VEGAN')) restr.add('VEGETARIAN');
  if (restr.has('VEGETARIAN') && !excluded.has('PESCATARIAN')) restr.add('PESCATARIAN');
  tg.dietary_restrictions = VOCAB.dietary_restrictions.filter((a) => restr.has(a));

  if (!r.contains_alcohol && defs.some((d) => d.category === 'ALCOHOL')) (r.contains_alcohol = true, changes.push('contains_alcohol=true'));

  const n = r.nutrition;
  const feats = new Set((tg.features ?? []).filter((f) => VOCAB.agent_features.includes(f)));
  const ignored = (tg.features ?? []).filter((f) => !VOCAB.agent_features.includes(f));
  if (ignored.length) changes.push(`features ${ignored.join(',')} recomputed from nutrition/spice_level`);
  const main = ['MAIN', 'SOUP'].includes(r.course);
  if (n.calories <= (main ? 450 : 250)) feats.add('LOW_CALORIE');
  if (n.protein >= 20 && (n.protein * 4) / n.calories >= 0.2) feats.add('HIGH_PROTEIN');
  if (n.fat <= (main ? 10 : 5)) feats.add('LOW_FAT');
  if (n.carbs <= 15) feats.add('LOW_CARB');
  if (n.fiber_g != null && n.fiber_g >= 6) feats.add('HIGH_FIBER');
  if (n.sugar_g >= 20) feats.add('HIGH_SUGAR');
  if (n.sodium_mg >= 800) feats.add('HIGH_SODIUM');
  if (r.spice_level >= 2) feats.add('SPICY');
  if (r.spice_level >= 3) feats.add('VERY_SPICY');
  const sweetened = defs.some((d) => d.category === 'SWEETENER' && /sugar|honey|syrup|molasses|jam|condensed/.test(d.code));
  if (feats.has('SUGAR_FREE') && (sweetened || n.sugar_g > 5)) (feats.delete('SUGAR_FREE'), changes.push('-feature SUGAR_FREE (sugar present)'));
  tg.features = VOCAB.features.filter((f) => feats.has(f));

  const diets = set('diets');
  if (diets.has('KETO') && n.carbs > 20) (diets.delete('KETO'), changes.push('-diet KETO (carbs > 20 g)'));
  if (diets.has('DIABETIC_FRIENDLY') && n.sugar_g > 15) (diets.delete('DIABETIC_FRIENDLY'), changes.push('-diet DIABETIC_FRIENDLY (sugar > 15 g)'));
  tg.diets = VOCAB.diets.filter((d) => diets.has(d));
  if (r.prep_time_min != null && r.cook_time_min != null && r.total_time_min < r.prep_time_min + r.cook_time_min)
    (r.total_time_min = r.prep_time_min + r.cook_time_min), changes.push('total_time_min raised to prep+cook');
  return changes;
}

const accepted = [];
const acceptedIngredients = [];
const rejected = [];
const pendingIngredients = new Map();

for (const r of records) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);
  const localDefs = new Map();
  const newDefs = Array.isArray(r.new_ingredients) ? r.new_ingredients : [];
  newDefs.forEach((d, i) => {
    const res = validateIngredientDef(d, i, err, pendingIngredients);
    if (res === 'new') localDefs.set(d.code, d);
    if (res === 'exists') warn(`new_ingredients[${i}]: "${d.code}" already exists — existing definition kept`);
  });
  const lookup = (code) => localDefs.get(code) || pendingIngredients.get(code) || idx.ingredients[code];
  validateRecipe(r, err, warn);
  checkIngredients(r, err, lookup);

  const label = r.code || r.source_url || '(no code)';
  if (errors.length) {
    rejected.push(r);
    console.log(`REJECTED ${label}\n  - ${errors.join('\n  - ')}`);
    continue;
  }
  const changes = derive(r, lookup);
  for (const [code, d] of localDefs) {
    const def = { code, name: d.name, category: d.category, allergens: d.allergens ?? [], excludes: d.excludes ?? [], is_staple: d.is_staple, default_unit: d.default_unit, grams_per_unit: d.grams_per_unit ?? null };
    pendingIngredients.set(code, def);
    acceptedIngredients.push(def);
    idx.ingredients[code] = def;
    for (const lang of ['ru', 'en']) idx.ingredientNames[normName(d.name[lang])] = code;
  }
  const { new_ingredients, ...rest } = r;
  void new_ingredients;
  const rec = { ...rest, host: hostOf(r.source_url), added_at: new Date().toISOString() };
  accepted.push(rec);
  idx.recipes[r.code] = { course: r.course, cuisine: r.cuisine ?? null, meal_types: r.meal_types, host: rec.host };
  idx.urls[r.source_url] = r.code;
  for (const lang of ['ru', 'en']) idx.recipeNames[normName(r.translations[lang].name)] = r.code;
  doneUrls.push({ url: r.source_url, host: rec.host });
  console.log(`OK ${label}${changes.length ? `\n  derived: ${changes.join('; ')}` : ''}${warnings.length ? `\n  warn: ${warnings.join('; ')}` : ''}`);
}

if (acceptedIngredients.length) fs.appendFileSync(P.ingredients, acceptedIngredients.map((d) => JSON.stringify(d)).join('\n') + '\n');
if (accepted.length) fs.appendFileSync(P.recipes, accepted.map((d) => JSON.stringify(d)).join('\n') + '\n');
if (accepted.length) {
  writeJson(P.index, idx);
  releaseData();
  await updateQueue((q) => {
    for (const { url, host } of doneUrls) q[url] = { ...(q[url] || { h: host }), s: 'done', t: Date.now() };
  });
}
releaseData();
fs.writeFileSync(file, JSON.stringify(rejected, null, 1));
console.log(`\naccepted ${accepted.length}, rejected ${rejected.length}, total recipes ${Object.keys(idx.recipes).length}`);
process.exit(rejected.length ? 1 : 0);
