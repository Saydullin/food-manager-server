/**
 * Unit tests for the "cook dinner" rules. Like ranking.test.ts, no database or `.env`
 * needed — the filters are plain Prisma `WHERE` objects, compared structurally.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DINNER_WEIGHTS,
  MEDICAL_LIMITS,
  ageFilters,
  applianceFilters,
  appliancesToUse,
  buildDinnerFilters,
  compareDinner,
  cookableFromPantry,
  dailyShuffle,
  dinnerDishFilters,
  dinnerFit,
  medicalFilter,
  missingIngredientIds,
  varietySeed,
  type DinnerCandidate,
  type DinnerEater,
  type DishIngredient,
} from './dinner';

const eater = (over: Partial<DinnerEater> = {}): DinnerEater => ({
  diets: [],
  foodExceptions: [],
  foodPreferences: [],
  medicalRestrictions: [],
  age: null,
  ...over,
});

const asJson = (value: unknown): string => JSON.stringify(value);
const has = (where: unknown[], fragment: unknown): boolean =>
  where.some((w) => asJson(w) === asJson(fragment));

const notTag = (group: string, key: string) => ({ NOT: { [group]: { is: { [key]: true } } } });
const tag = (group: string, key: string) => ({ [group]: { is: { [key]: true } } });

describe('buildDinnerFilters', () => {
  it('asks only for a dinner dish from an unconstrained table with an unknown kitchen', () => {
    assert.deepEqual(buildDinnerFilters([eater(), eater()], null).where, dinnerDishFilters());
  });

  it("applies the youngest eater's age", () => {
    const { where } = buildDinnerFilters([eater({ age: 35 }), eater({ age: 4 })], null);
    assert.ok(has(where, { OR: [{ minAgeYears: null }, { minAgeYears: { lte: 4 } }] }));
  });

  it("applies every eater's allergy — one allergic person excludes the dish for all", () => {
    const { where } = buildDinnerFilters([eater(), eater({ foodExceptions: ['PEANUTS'] })], null);
    assert.ok(has(where, notTag('allergens', 'peanuts')));
  });

  it('uses the feed diet rules, so LACTOSE_FREE means "no milk", not "tagged lactose-free"', () => {
    const { where } = buildDinnerFilters([eater({ diets: ['LACTOSE_FREE'] })], null);
    assert.ok(has(where, notTag('intolerances', 'lactose')));
    assert.ok(has(where, notTag('allergens', 'milk')));
  });

  it('turns a taste exception into an exclusion (the feed only ranks it down)', () => {
    const { where } = buildDinnerFilters([eater({ foodExceptions: ['SPICY'] })], null);
    assert.ok(has(where, notTag('features', 'spicy')));
  });

  it('treats an unknown exception as an ingredient name, like the feed', () => {
    const { where } = buildDinnerFilters([eater({ foodExceptions: ['кинза'] })], null);
    assert.ok(where.some((w) => asJson(w).includes('кинза') && 'ingredients' in w));
  });

  it("reports diets no dish column can express instead of pretending they're enforced", () => {
    const { unmappedDiets } = buildDinnerFilters([eater({ diets: ['RAW_FOOD'] })], null);
    assert.deepEqual(unmappedDiets, ['RAW_FOOD']);
  });

  it('includes each medical restriction', () => {
    const { where } = buildDinnerFilters([eater({ medicalRestrictions: ['LOW_SALT'] })], null);
    assert.ok(has(where, notTag('features', 'highSodium')));
  });
});

describe('medicalFilter', () => {
  it('LOW_CALORIE accepts the flag or calories under the limit', () => {
    assert.deepEqual(medicalFilter('LOW_CALORIE'), {
      OR: [
        tag('features', 'lowCalorie'),
        { nutrition: { is: { calories: { lte: MEDICAL_LIMITS.lowCalorieMaxKcal } } } },
      ],
    });
  });

  it('LOW_CARB also accepts keto dishes', () => {
    assert.ok(asJson(medicalFilter('LOW_CARB')).includes(asJson(tag('diets', 'keto'))));
  });

  it('NO_SPICY excludes both spice levels', () => {
    assert.deepEqual(medicalFilter('NO_SPICY'), {
      AND: [notTag('features', 'spicy'), notTag('features', 'verySpicy')],
    });
  });

  it('LOW_SUGAR excludes high-sugar dishes', () => {
    assert.deepEqual(medicalFilter('LOW_SUGAR'), notTag('features', 'highSugar'));
  });
});

describe('applianceFilters', () => {
  it('constrains nothing when the kitchen was never described', () => {
    assert.deepEqual(applianceFilters(null), []);
  });

  const kitchen = ['STOVE', 'OVEN', 'MICROWAVE', 'GRILL', 'MULTICOOKER', 'BLENDER'];

  it('excludes dishes needing equipment the kitchen lacks', () => {
    const where = applianceFilters(kitchen);
    assert.ok(has(where, notTag('appliances', 'airFryer')));
    assert.equal(where.filter((w) => 'NOT' in w).length, 1);
  });

  it('needs one appliance the kitchen has from every "any one of these" choice', () => {
    assert.ok(
      has(applianceFilters(kitchen), {
        applianceOptions: { every: { appliances: { hasSome: kitchen } } },
      }),
    );
  });

  it('an empty kitchen excludes every appliance-needing dish, choices included', () => {
    const where = applianceFilters([]);
    assert.equal(where.filter((w) => 'NOT' in w).length, 7);
    assert.ok(has(where, { applianceOptions: { none: {} } }));
  });
});

describe('appliancesToUse', () => {
  it("shows the choice the kitchen has, not the recipe's first one", () => {
    assert.deepEqual(appliancesToUse(['STOVE'], [['OVEN', 'AIR_FRYER']], ['STOVE', 'AIR_FRYER']), [
      'STOVE',
      'AIR_FRYER',
    ]);
  });

  it("falls back to the recipe's first choice without a kitchen", () => {
    assert.deepEqual(appliancesToUse([], [['OVEN', 'AIR_FRYER']], null), ['OVEN']);
  });

  it('lists an appliance once even if a choice repeats a requirement', () => {
    assert.deepEqual(appliancesToUse(['OVEN'], [['OVEN', 'GRILL']], ['GRILL', 'OVEN']), ['OVEN']);
  });
});

describe('dinner dishes', () => {
  it('lets dishes with an unknown course or meal through, but not ones without ingredients', () => {
    const json = asJson(dinnerDishFilters());
    assert.ok(json.includes('{"course":null}'));
    assert.ok(json.includes('{"mealTypes":{"isEmpty":true}}'));
    assert.ok(json.includes('{"ingredients":{"some":{}}}'));
  });

  it('does not constrain age when nobody gave one', () => {
    assert.deepEqual(ageFilters([eater(), eater()]), []);
  });
});

describe('pantry', () => {
  const pantry = new Set(['egg', 'flour']);
  const line = (ingredientId: string, over: Partial<DishIngredient> = {}): DishIngredient => ({
    ingredientId,
    optional: false,
    staple: false,
    ...over,
  });

  it('lists what is missing, in recipe order', () => {
    assert.deepEqual(
      missingIngredientIds([line('milk'), line('egg'), line('sugar'), line('flour')], pantry),
      ['milk', 'sugar'],
    );
  });

  it('never counts staples or optional lines as missing', () => {
    assert.deepEqual(
      missingIngredientIds(
        [line('salt', { staple: true }), line('dill', { optional: true }), line('egg')],
        pantry,
      ),
      [],
    );
  });

  it('allows up to maxMissing purchases', () => {
    assert.equal(cookableFromPantry([line('egg'), line('flour'), line('milk')], pantry, 1), true);
    assert.equal(cookableFromPantry([line('egg'), line('milk'), line('sugar')], pantry, 1), false);
  });

  it('never counts a dish without an ingredient list as cookable from home', () => {
    assert.equal(cookableFromPantry([], pantry, 5), false);
  });
});

describe('dinnerFit', () => {
  const traits = { course: null, totalTimeMin: null, difficulty: null };

  it('is neutral for a dish nothing is known about', () => {
    assert.equal(dinnerFit(traits), 0);
  });

  it('prefers a main course over a soup or salad', () => {
    assert.ok(dinnerFit({ ...traits, course: 'MAIN' }) > dinnerFit({ ...traits, course: 'SOUP' }));
  });

  it('sinks long and hard recipes, a weekend project the most', () => {
    const quick = dinnerFit({ ...traits, totalTimeMin: 40 });
    const long = dinnerFit({ ...traits, totalTimeMin: 120 });
    const project = dinnerFit({ ...traits, totalTimeMin: 240 });
    assert.ok(quick > long && long > project);
    assert.ok(dinnerFit({ ...traits, difficulty: 3 }) < dinnerFit({ ...traits, difficulty: 2 }));
  });

  it('never outweighs one declared taste preference (worth 2)', () => {
    assert.ok(DINNER_WEIGHTS.mainCourse + DINNER_WEIGHTS.variety <= 2);
  });
});

describe('dailyShuffle', () => {
  const day1 = varietySeed('user', new Date('2026-11-15T18:00:00Z'));
  const day2 = varietySeed('user', new Date('2026-11-16T18:00:00Z'));
  const ids = Array.from({ length: 200 }, (_, i) => `food-${i}`);

  it('stays the same within a day', () => {
    assert.equal(
      dailyShuffle(day1, 'a'),
      dailyShuffle(varietySeed('user', new Date('2026-11-15T07:00:00Z')), 'a'),
    );
  });

  it('is in [0, 1) and reorders dishes from one day to the next', () => {
    const values = ids.map((id) => dailyShuffle(day1, id));
    assert.ok(values.every((v) => v >= 0 && v < 1));
    const order = (seed: string) =>
      [...ids].sort((a, b) => dailyShuffle(seed, a) - dailyShuffle(seed, b));
    assert.notDeepEqual(order(day1).slice(0, 20), order(day2).slice(0, 20));
  });

  it('spreads evenly enough that no tenth of the range is empty', () => {
    const buckets = new Set(ids.map((id) => Math.floor(dailyShuffle(day1, id) * 10)));
    assert.equal(buckets.size, 10);
  });
});

describe('compareDinner', () => {
  const candidate = (id: string, score: number, missing: string[]): DinnerCandidate => ({
    id,
    score,
    missing,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    cuisine: null,
    tags: [],
  });

  it('from the pantry, fewer missing ingredients beat a better taste score', () => {
    const sorted = [candidate('a', 5, ['x', 'y']), candidate('b', 0, [])].sort(compareDinner(true));
    assert.deepEqual(
      sorted.map((c) => c.id),
      ['b', 'a'],
    );
  });

  it('otherwise orders by taste score alone', () => {
    const sorted = [candidate('a', 5, ['x', 'y']), candidate('b', 0, [])].sort(
      compareDinner(false),
    );
    assert.deepEqual(
      sorted.map((c) => c.id),
      ['a', 'b'],
    );
  });
});
