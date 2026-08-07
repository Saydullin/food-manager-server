/**
 * Unit tests for the feed's ranking logic. Runs without a database or a populated
 * `.env` — the module under test is pure, which is the reason it's a separate module
 * from `recommendationService`.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeRankCursor, encodeRankCursor } from '../../utils/cursor';
import {
  buildDeclaredScoring,
  buildHardFilters,
  compareRank,
  emptySignals,
  rankCandidates,
  resolveTagAliases,
  scoreCandidate,
  type Candidate,
  type TasteProfile,
  type TasteSignals,
} from './ranking';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const profile = (over: Partial<TasteProfile> = {}): TasteProfile => ({
  diets: [],
  foodExceptions: [],
  foodPreferences: [],
  ...over,
});

const dish = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  cuisine: null,
  tags: [],
  ...over,
});

const signals = (over: Partial<TasteSignals> = {}): TasteSignals => ({
  ...emptySignals(),
  hasAnySignal: true,
  ...over,
});

const noDeclared = buildDeclaredScoring(profile(), [], []);

/** Stringified for comparison — the filter fragments are nested plain objects. */
const asJson = (value: unknown): string => JSON.stringify(value);

// ---------------------------------------------------------------------------

describe('resolveTagAliases', () => {
  it('resolves a code, its UPPER_SNAKE form, and its spaced form', () => {
    for (const alias of ['treeNuts', 'TREE_NUTS', 'tree nuts', 'Tree nuts']) {
      assert.deepEqual(resolveTagAliases(alias), [{ group: 'allergens', key: 'treeNuts' }], alias);
    }
  });

  it('resolves localized labels, since exceptions are typed in the user language', () => {
    assert.deepEqual(resolveTagAliases('Арахис'), [{ group: 'allergens', key: 'peanuts' }]);
    assert.deepEqual(resolveTagAliases('  МОЛОКО  '), [{ group: 'allergens', key: 'milk' }]);
    assert.deepEqual(resolveTagAliases('Острое'), [{ group: 'features', key: 'spicy' }]);
  });

  it('resolves an ambiguous alias to every column it means, not just the first', () => {
    // "gluten" is both an allergen and an intolerance; a user who typed it means both.
    assert.deepEqual(resolveTagAliases('gluten'), [
      { group: 'allergens', key: 'gluten' },
      { group: 'intolerances', key: 'gluten' },
    ]);
  });

  it('returns nothing for free text that names no tag', () => {
    assert.deepEqual(resolveTagAliases('mushrooms'), []);
    assert.deepEqual(resolveTagAliases(''), []);
  });
});

describe('buildHardFilters — allergens and intolerances', () => {
  it('excludes dishes flagged with a declared allergen', () => {
    const { where } = buildHardFilters(profile({ foodExceptions: ['peanuts'] }));
    assert.equal(where.length, 1);
    assert.equal(asJson(where[0]), asJson({ NOT: { allergens: { is: { peanuts: true } } } }));
  });

  it('excludes via a localized label too — the safety path must not be English-only', () => {
    const { where } = buildHardFilters(profile({ foodExceptions: ['арахис'] }));
    assert.equal(asJson(where[0]), asJson({ NOT: { allergens: { is: { peanuts: true } } } }));
  });

  it('keeps a dish with no tag row at all (absence of a claim is not a claim)', () => {
    // NOT { is } rather than isNot, so a null relation passes. Guards the asymmetry
    // documented on excludeTag: exclusions keep untagged dishes, requires reject them.
    const { where } = buildHardFilters(profile({ foodExceptions: ['milk'] }));
    assert.ok('NOT' in where[0]!, 'exclusion must be expressed as NOT { is }');
  });

  it('excludes both columns for an ambiguous allergen/intolerance alias', () => {
    const { where } = buildHardFilters(profile({ foodExceptions: ['gluten'] }));
    assert.equal(where.length, 2);
  });

  it('treats unrecognized free text as an exact ingredient-name exclusion', () => {
    const { where, penalizedTags } = buildHardFilters(profile({ foodExceptions: ['Mushrooms'] }));
    assert.equal(penalizedTags.length, 0);
    assert.equal(
      asJson(where[0]),
      asJson({
        ingredients: {
          none: {
            ingredient: { translations: { some: { name: { equals: 'Mushrooms', mode: 'insensitive' } } } },
          },
        },
      }),
    );
  });

  it('ranks a taste exception down instead of filtering it out', () => {
    const { where, penalizedTags } = buildHardFilters(profile({ foodExceptions: ['spicy'] }));
    assert.deepEqual(where, [], 'a matter of taste must not empty the deck');
    assert.deepEqual(penalizedTags, ['SPICY']);
  });

  it('ignores blank exception entries', () => {
    const { where } = buildHardFilters(profile({ foodExceptions: ['   ', ''] }));
    assert.deepEqual(where, []);
  });
});

describe('buildHardFilters — diets', () => {
  it('requires the compliance flag for a compliance-style diet', () => {
    const { where } = buildHardFilters(profile({ diets: ['VEGAN'] }));
    assert.equal(asJson(where[0]), asJson({ dietaryRestrictions: { is: { vegan: true } } }));
  });

  it('expresses a "free of X" diet as the absence of the offending trait', () => {
    // The schema has no lactoseFree flag, so LACTOSE_FREE has to exclude the
    // intolerance and the milk allergen instead of requiring anything.
    const { where } = buildHardFilters(profile({ diets: ['LACTOSE_FREE'] }));
    assert.equal(where.length, 2);
    assert.equal(asJson(where[0]), asJson({ NOT: { intolerances: { is: { lactose: true } } } }));
    assert.equal(asJson(where[1]), asJson({ NOT: { allergens: { is: { milk: true } } } }));
  });

  it('treats wheat as disqualifying for GLUTEN_FREE', () => {
    const { where } = buildHardFilters(profile({ diets: ['GLUTEN_FREE'] }));
    assert.equal(where.length, 3);
    assert.ok(asJson(where).includes('wheat'));
  });

  it('accepts a lowercase diet code', () => {
    const { where, unmappedDiets } = buildHardFilters(profile({ diets: ['vegan'] }));
    assert.deepEqual(unmappedDiets, []);
    assert.equal(where.length, 1);
  });

  it('reports a diet code no dish flag can express rather than silently dropping it', () => {
    const { where, unmappedDiets } = buildHardFilters(profile({ diets: ['VEGAN', 'RAW_FOOD'] }));
    assert.deepEqual(unmappedDiets, ['RAW_FOOD']);
    assert.equal(where.length, 1, 'the mappable diet still filters');
  });

  it('ANDs several declared diets together', () => {
    const { where } = buildHardFilters(profile({ diets: ['VEGAN', 'HALAL'] }));
    assert.equal(where.length, 2);
  });
});

describe('scoreCandidate', () => {
  it('scores everything 0 for a user with no profile and no history', () => {
    const score = scoreCandidate(dish('a', { cuisine: 'ITALIAN', tags: ['SPICY'] }), emptySignals(), noDeclared);
    assert.equal(score, 0);
  });

  it('lifts a cuisine the user keeps liking', () => {
    const liked = signals({ likedCuisines: new Map([['ITALIAN', 0.5]]) });
    const italian = scoreCandidate(dish('a', { cuisine: 'ITALIAN' }), liked, noDeclared);
    const thai = scoreCandidate(dish('b', { cuisine: 'THAI' }), liked, noDeclared);
    assert.ok(italian > thai, `${italian} should beat ${thai}`);
  });

  it('sinks a cuisine explicitly rejected with WRONG_CUISINE', () => {
    const rejected = signals({ explicitCuisineDislikes: new Map([['THAI', 2]]) });
    assert.ok(scoreCandidate(dish('a', { cuisine: 'THAI' }), rejected, noDeclared) < 0);
  });

  it('sinks a tag explicitly rejected with DISLIKE_TAG', () => {
    const rejected = signals({ explicitTagDislikes: new Map([['SPICY', 1]]) });
    const spicy = scoreCandidate(dish('a', { tags: ['SPICY'] }), rejected, noDeclared);
    const mild = scoreCandidate(dish('b', { tags: ['LOW_FAT'] }), rejected, noDeclared);
    assert.ok(spicy < mild);
  });

  it('weights an explicit rejection above an inferred one', () => {
    const explicit = scoreCandidate(
      dish('a', { cuisine: 'THAI' }),
      signals({ explicitCuisineDislikes: new Map([['THAI', 1]]) }),
      noDeclared,
    );
    const inferred = scoreCandidate(
      dish('b', { cuisine: 'THAI' }),
      signals({ implicitCuisineDislikes: new Map([['THAI', 1]]) }),
      noDeclared,
    );
    assert.ok(explicit < inferred, 'saying why must count for more than us guessing');
  });

  it('saturates repeated rejections', () => {
    const three = scoreCandidate(
      dish('a', { cuisine: 'THAI' }),
      signals({ explicitCuisineDislikes: new Map([['THAI', 3]]) }),
      noDeclared,
    );
    const thirty = scoreCandidate(
      dish('a', { cuisine: 'THAI' }),
      signals({ explicitCuisineDislikes: new Map([['THAI', 30]]) }),
      noDeclared,
    );
    assert.equal(three, thirty);
  });

  it('ranks an unexplored cuisine above one already rejected, so the deck keeps opening up', () => {
    const learned = signals({
      likedCuisines: new Map([['ITALIAN', 1]]),
      implicitCuisineDislikes: new Map([['THAI', 1]]),
    });
    const novel = scoreCandidate(dish('a', { cuisine: 'KOREAN' }), learned, noDeclared);
    const rejected = scoreCandidate(dish('b', { cuisine: 'THAI' }), learned, noDeclared);
    assert.ok(novel > rejected);
    assert.ok(novel > 0, 'an unexplored cuisine should carry a positive exploration bonus');
  });

  it('gives no exploration bonus to a brand-new account (everything is novel then)', () => {
    assert.equal(scoreCandidate(dish('a', { cuisine: 'KOREAN' }), emptySignals(), noDeclared), 0);
  });

  it('lifts a declared preference, by tag and by cuisine', () => {
    const declared = buildDeclaredScoring(
      profile({ foodPreferences: ['spicy', 'italian'] }),
      ['ITALIAN', 'THAI'],
      [],
    );
    assert.ok(scoreCandidate(dish('a', { tags: ['SPICY'] }), emptySignals(), declared) > 0);
    assert.ok(scoreCandidate(dish('b', { cuisine: 'ITALIAN' }), emptySignals(), declared) > 0);
    assert.equal(scoreCandidate(dish('c', { cuisine: 'THAI' }), emptySignals(), declared), 0);
  });

  it('applies the penalty for a taste tag the user asked to avoid', () => {
    const declared = buildDeclaredScoring(profile(), [], ['SPICY']);
    assert.ok(scoreCandidate(dish('a', { tags: ['SPICY'] }), emptySignals(), declared) < 0);
  });
});

describe('buildDeclaredScoring', () => {
  it('matches a cuisine catalog code case-insensitively and with spaces for underscores', () => {
    const declared = buildDeclaredScoring(
      profile({ foodPreferences: ['Middle East'] }),
      ['MIDDLE_EAST'],
      [],
    );
    assert.ok(declared.preferredCuisines.has('MIDDLE_EAST'));
  });

  it('drops free text that matches neither a tag nor a cuisine', () => {
    const declared = buildDeclaredScoring(profile({ foodPreferences: ['whatever i feel like'] }), ['ITALIAN'], []);
    assert.equal(declared.preferredTags.size, 0);
    assert.equal(declared.preferredCuisines.size, 0);
  });
});

describe('compareRank / rankCandidates', () => {
  const older = new Date('2026-01-01T00:00:00.000Z');
  const newer = new Date('2026-06-01T00:00:00.000Z');

  it('orders by score first', () => {
    assert.ok(compareRank({ score: 5, createdAt: older, id: 'a' }, { score: 1, createdAt: newer, id: 'z' }) < 0);
  });

  it('breaks a score tie by newest first, then by id descending', () => {
    assert.ok(compareRank({ score: 1, createdAt: newer, id: 'a' }, { score: 1, createdAt: older, id: 'z' }) < 0);
    assert.ok(compareRank({ score: 1, createdAt: older, id: 'b' }, { score: 1, createdAt: older, id: 'a' }) < 0);
  });

  it('is a total order — no two distinct dishes ever compare equal', () => {
    // What lets the cursor say "resume strictly after this key" without an offset.
    assert.equal(compareRank({ score: 1, createdAt: older, id: 'a' }, { score: 1, createdAt: older, id: 'a' }), 0);
    assert.notEqual(compareRank({ score: 1, createdAt: older, id: 'a' }, { score: 1, createdAt: older, id: 'b' }), 0);
  });

  it('sorts the best-fitting dish to the front of the deck', () => {
    const liked = signals({ likedCuisines: new Map([['ITALIAN', 1]]) });
    const ranked = rankCandidates(
      [dish('thai', { cuisine: 'THAI' }), dish('italian', { cuisine: 'ITALIAN' })],
      liked,
      noDeclared,
    );
    assert.equal(ranked[0]!.id, 'italian');
  });

  it('leaves recency ordering intact for a user with no signal at all', () => {
    const ranked = rankCandidates(
      [dish('old', { createdAt: older }), dish('new', { createdAt: newer })],
      emptySignals(),
      noDeclared,
    );
    assert.deepEqual(
      ranked.map((r) => r.id),
      ['new', 'old'],
      'a fresh account should still see the newest dishes first',
    );
  });
});

describe('rank cursor', () => {
  const key = { score: -2.25, createdAt: new Date('2026-03-04T05:06:07.000Z'), id: 'dish-1' };

  it('round-trips a rank key exactly, so the cursor row compares equal', () => {
    const decoded = decodeRankCursor(encodeRankCursor(key));
    assert.deepEqual(decoded, key);
    assert.equal(compareRank(key, decoded!), 0, 'an inexact score round-trip would shift the page boundary');
  });

  it('resumes strictly after the cursor', () => {
    const ranked = rankCandidates(
      [dish('a', { cuisine: 'ITALIAN' }), dish('b'), dish('c')],
      emptySignals(),
      noDeclared,
    );
    const cursor = decodeRankCursor(encodeRankCursor(ranked[0]!))!;
    const start = ranked.findIndex((candidate) => compareRank(candidate, cursor) > 0);
    assert.equal(start, 1, 'the cursor row itself must not repeat');
  });

  it('treats a legacy two-part cursor as "start from the top" instead of failing', () => {
    const legacy = Buffer.from('2026-03-04T05:06:07.000Z|dish-1', 'utf8').toString('base64url');
    assert.equal(decodeRankCursor(legacy), null);
  });

  it('rejects a malformed cursor', () => {
    for (const bad of ['not-a-cursor', Buffer.from('a|b|c|d').toString('base64url'), Buffer.from('x|2026-03-04T05:06:07.000Z|id').toString('base64url')]) {
      assert.throws(() => decodeRankCursor(bad), /Malformed cursor/, bad);
    }
  });
});
