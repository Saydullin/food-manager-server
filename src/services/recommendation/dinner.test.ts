/**
 * Unit tests for the "cook dinner" rules. Like ranking.test.ts, no database or `.env`
 * needed — the filters are plain Prisma `WHERE` objects, compared structurally.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MEDICAL_LIMITS,
  applianceFilters,
  buildDinnerFilters,
  compareDinner,
  cookableFromPantry,
  medicalFilter,
  missingIngredientIds,
  type DinnerCandidate,
  type DinnerEater,
} from './dinner';

const eater = (over: Partial<DinnerEater> = {}): DinnerEater => ({
  diets: [],
  foodExceptions: [],
  foodPreferences: [],
  medicalRestrictions: [],
  ...over,
});

const asJson = (value: unknown): string => JSON.stringify(value);
const has = (where: unknown[], fragment: unknown): boolean =>
  where.some((w) => asJson(w) === asJson(fragment));

const notTag = (group: string, key: string) => ({ NOT: { [group]: { is: { [key]: true } } } });
const tag = (group: string, key: string) => ({ [group]: { is: { [key]: true } } });

describe('buildDinnerFilters', () => {
  it('puts nothing in the way of an unconstrained table with an unknown kitchen', () => {
    assert.deepEqual(buildDinnerFilters([eater(), eater()], null).where, []);
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

  it('excludes dishes needing equipment the kitchen lacks', () => {
    const where = applianceFilters([
      'STOVE',
      'OVEN',
      'MICROWAVE',
      'GRILL',
      'MULTICOOKER',
      'BLENDER',
    ]);
    assert.deepEqual(where, [notTag('appliances', 'airFryer')]);
  });

  it('an empty kitchen excludes every appliance-needing dish', () => {
    assert.equal(applianceFilters([]).length, 7);
  });
});

describe('pantry', () => {
  const pantry = new Set(['egg', 'flour']);

  it('lists what is missing, in recipe order', () => {
    assert.deepEqual(missingIngredientIds(['milk', 'egg', 'sugar', 'flour'], pantry), [
      'milk',
      'sugar',
    ]);
  });

  it('allows up to maxMissing purchases', () => {
    assert.equal(cookableFromPantry(['egg', 'flour', 'milk'], pantry, 1), true);
    assert.equal(cookableFromPantry(['egg', 'milk', 'sugar'], pantry, 1), false);
  });

  it('never counts a dish without an ingredient list as cookable from home', () => {
    assert.equal(cookableFromPantry([], pantry, 5), false);
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
